const express = require('express');
const pool = require('../config/database');
const { env } = require('../config/env');
const {
  authMiddleware,
  requireRole,
  isDyrektorOrAdmin,
  scopedOddzialId,
} = require('../middleware/auth');
const logger = require('../config/logger');
const { pushToUser } = require('./notifications');
const { sendSmsOptional } = require('../services/twilioSms');
const { sendSystemEmailOptional } = require('../services/systemEmail');
const { runUploadStorageSelfTest, uploadStorageMode } = require('../services/upload-storage');
const { calculateTaskMargin } = require('../services/taskMargin');
const { sendSmsGateway, resolveBranchSmsSender } = require('../services/smsGateway');
const { requestCallback } = require('../services/zadarma');

const router = express.Router();

const MANAGER_ROLES = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor'];
const CLOSED_TASK_STATUSES = new Set(['Zakonczone', 'Anulowane']);
const IN_PROGRESS_TASK_STATUS = 'W_Realizacji';
const PLAN_REAL_REASON_LABELS = {
  dojazd: 'Dojazd',
  zakres: 'Wiekszy zakres',
  sprzet: 'Sprzet',
  klient: 'Klient',
  pogoda: 'Pogoda',
  inne: 'Inne',
};
const PLAN_REAL_ISSUE_LABELS = {
  missing_duration: 'Brak czasu planu',
  not_started: 'Nie wystartowalo',
  overrun: 'Przekroczenie planu',
  missing_finish: 'Brak zamkniecia',
  under_plan: 'Ponizej planu',
};
const OPS_ACTION_LABELS = {
  set_duration: 'Ustawienie czasu',
  mark_reason: 'Powod odchylenia',
  remind_team: 'Przypomnienie ekipy',
  recommendation_feedback: 'Feedback rekomendacji',
  risk_resend_sms: 'Ponowienie SMS ryzyka',
  risk_queue_call: 'Telefon Zadarma z ryzyka',
  risk_acknowledge: 'Potwierdzenie ryzyka',
  risk_owner_escalate: 'Eskalacja ownera ryzyka',
  risk_owner_resolve: 'Zamkniecie petli ownera',
  risk_owner_auto_remediate: 'Auto-remediacja ownera',
  risk_owner_remediation_blocked: 'Blokada auto-remediacji ownera',
  risk_reassign_team: 'Przepiecie ekipy z ryzyka',
  risk_replace_equipment: 'Przepiecie sprzetu z ryzyka',
  dispatch_auto_assign_team: 'Auto-przypisanie ekipy',
  dispatch_gps_checklist: 'Checklist GPS dispatchera',
};

const ALERT_SOURCE_FILTERS = {
  kommo: ['kommo_sync'],
  sms: ['sms_delivery'],
};

const RISK_OWNER_META = {
  kommo_sync: {
    owner_role: 'Dyspozytor/Admin',
    owner_label: 'Owner: integracje Kommo',
    escalation: 'P1 gdy dead-letter > 0 po 30 min',
  },
  sms_delivery: {
    owner_role: 'Kierownik/Dyspozytor',
    owner_label: 'Owner: kontakt z klientem',
    escalation: 'P2 gdy brak dostarczenia po 30 min',
  },
  client_window: {
    owner_role: 'Kierownik',
    owner_label: 'Owner: plan dnia',
    escalation: 'P2 przed startem ekipy',
  },
  team_conflict: {
    owner_role: 'Dyspozytor',
    owner_label: 'Owner: dispatcher',
    escalation: 'P1 jesli konflikt blokuje start',
  },
  equipment_conflict: {
    owner_role: 'Kierownik floty/Dyspozytor',
    owner_label: 'Owner: zasoby',
    escalation: 'P1 jesli brak zamiennika',
  },
  margin: {
    owner_role: 'Dyrektor/Ksiegowosc',
    owner_label: 'Owner: rentownosc',
    escalation: 'P2 przed zamknieciem dnia',
  },
};

let opsActionEventsReady = false;
let riskTelephonyCallbacksReady = false;

const BLOCKER_META = {
  team: {
    label: 'Brak ekipy',
    action: 'Przypisz ekipe',
    tone: 'danger',
    path: '/kierownik',
  },
  phone: {
    label: 'Brak telefonu',
    action: 'Uzupelnij kontakt',
    tone: 'warning',
    path: '/zlecenia',
  },
  address: {
    label: 'Brak adresu',
    action: 'Uzupelnij adres',
    tone: 'warning',
    path: '/zlecenia',
  },
  gps: {
    label: 'Brak pinezki GPS',
    action: 'Ustaw lokalizacje',
    tone: 'danger',
    path: '/zlecenia',
  },
  duration: {
    label: 'Brak czasu pracy',
    action: 'Wpisz czas uslugi',
    tone: 'warning',
    path: '/zlecenia',
  },
  issue: {
    label: 'Otwarte problemy',
    action: 'Sprawdz zgloszenia',
    tone: 'danger',
    path: '/zlecenia',
  },
  margin: {
    label: 'Marza ponizej progu',
    action: 'Sprawdz koszty',
    tone: 'danger',
    path: '/bi',
  },
  gps_stale: {
    label: 'GPS ekip opozniony',
    action: 'Otworz mape live',
    tone: 'warning',
    path: '/mapa-live',
  },
  notification: {
    label: 'Nowe powiadomienia',
    action: 'Otworz powiadomienia',
    tone: 'info',
    path: '/powiadomienia',
  },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateParam(value) {
  const date = String(value || todayIso()).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function truthyText(value) {
  return String(value || '').trim().length > 0;
}

function numericPositive(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0;
}

function isTaskClosed(status) {
  return CLOSED_TASK_STATUSES.has(String(status || ''));
}

function taskBlockers(task) {
  const blockers = [];
  if (!task.ekipa_id) blockers.push('team');
  if (!truthyText(task.klient_telefon)) blockers.push('phone');
  if (!truthyText(task.adres)) blockers.push('address');
  if (task.pin_lat == null || task.pin_lng == null) blockers.push('gps');
  if (!numericPositive(task.czas_obslugi_min) && !numericPositive(task.czas_planowany_godziny)) blockers.push('duration');
  if (Number(task.open_issues || 0) > 0) blockers.push('issue');
  return blockers;
}

function gpsStatus(recordedAt) {
  if (!recordedAt) return { status: 'missing', ageMin: null };
  const ts = new Date(recordedAt).getTime();
  if (!Number.isFinite(ts)) return { status: 'missing', ageMin: null };
  const ageMin = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (ageMin <= 20) return { status: 'online', ageMin };
  if (ageMin <= 90) return { status: 'stale', ageMin };
  return { status: 'offline', ageMin };
}

function buildTaskPath(task, date) {
  const params = new URLSearchParams();
  const blockers = task.blockers || [];
  if (blockers.includes('team')) {
    params.set('mode', 'edit');
    params.set('step', 'planning');
    params.set('field', 'ekipa_id');
  } else if (blockers.includes('phone')) {
    params.set('mode', 'edit');
    params.set('step', 'client');
    params.set('field', 'klient_telefon');
  } else if (blockers.includes('address')) {
    params.set('mode', 'edit');
    params.set('step', 'client');
    params.set('field', 'adres');
  } else if (blockers.includes('duration')) {
    params.set('mode', 'edit');
    params.set('step', 'finance');
    params.set('field', 'czas_planowany_godziny');
  } else if (blockers.includes('gps')) {
    params.set('focus', 'officePlan');
  } else if (blockers.includes('issue')) {
    params.set('tab', 'problemy');
  }
  params.set('returnTo', `/kierownik?date=${encodeURIComponent(date)}`);
  params.set('returnLabel', 'Cockpit kierownika');
  const query = params.toString();
  return `/zlecenia/${task.id}${query ? `?${query}` : ''}`;
}

function bumpBlocker(counts, key, amount = 1) {
  counts.set(key, (counts.get(key) || 0) + amount);
}

function blockerRows(counts) {
  return Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      count,
      ...(BLOCKER_META[key] || { label: key, action: 'Otworz', tone: 'info', path: '/kierownik' }),
    }))
    .sort((a, b) => {
      const toneRank = { danger: 0, warning: 1, info: 2 };
      return (toneRank[a.tone] ?? 9) - (toneRank[b.tone] ?? 9) || b.count - a.count;
    });
}

function dateTimeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function taskPlannedMinutes(task) {
  return Math.max(0, Math.round(
    numberValue(task.czas_obslugi_min) || numberValue(task.czas_planowany_godziny) * 60
  ));
}

function sameDayClockMinutes(dateValue) {
  const date = new Date(dateValue || 0);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function buildRiskText(report) {
  const lines = [
    `Raport ryzyk dnia ARBOR - ${report.date}`,
    `Ryzyka: ${report.counts.total}, krytyczne: ${report.counts.critical}, ostrzezenia: ${report.counts.warning}.`,
  ];
  if (!report.items.length) {
    lines.push('Brak ryzyk wymagajacych natychmiastowej reakcji.');
    return lines.join('\n');
  }
  lines.push('');
  report.items.slice(0, 20).forEach((item, index) => {
    lines.push(`${index + 1}. [${item.severity.toUpperCase()}] ${item.title}`);
    if (item.detail) lines.push(`   ${item.detail}`);
    if (item.action) lines.push(`   Akcja: ${item.action}`);
  });
  return lines.join('\n');
}

function riskOwner(type) {
  return RISK_OWNER_META[type] || {
    owner_role: 'Kierownik',
    owner_label: 'Owner: operacje',
    escalation: 'P2 do przegladu dziennego',
  };
}

function ownerAlertSla(riskType, severity, alertAt) {
  const startedAt = new Date(alertAt || Date.now()).getTime();
  const now = Date.now();
  const agingMinutes = Number.isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 60000)) : 0;
  const overdue = agingMinutes >= 30;
  const isCritical = String(severity || '').toLowerCase() === 'critical';
  const escalationLevel = riskType === 'kommo_sync'
    ? (overdue || isCritical ? 'P1' : 'watch')
    : (overdue || isCritical ? 'P2' : 'watch');
  return {
    aging_minutes: agingMinutes,
    sla_minutes: 30,
    sla_status: overdue ? 'overdue' : 'watch',
    escalation_level: escalationLevel,
    sla_deadline_at: Number.isFinite(startedAt) ? new Date(startedAt + 30 * 60000).toISOString() : null,
  };
}

function ownerAlertAckKeys(riskType, riskId, taskId) {
  return [
    riskId ? `id:${riskId}` : '',
    taskId ? `task:${riskType}:${taskId}` : '',
    `type:${riskType}`,
  ].filter(Boolean);
}

function buildManagerRiskReport({ date, tasks = [], marginRisks = [], smsRows = [], proposalRows = [], equipmentRows = [], kommoRows = [] }) {
  const items = [];
  const add = (item) => {
    const owner = riskOwner(item.type);
    items.push({
      id: item.id || `${item.type}:${items.length + 1}`,
      type: item.type,
      severity: item.severity || 'warning',
      task_id: item.task_id || null,
      title: item.title,
      detail: item.detail || '',
      action: item.action || 'Sprawdz w kokpicie kierownika.',
      action_path: item.action_path || (item.task_id ? `/zlecenia/${item.task_id}` : '/kierownik'),
      owner_role: item.owner_role || owner.owner_role,
      owner_label: item.owner_label || owner.owner_label,
      escalation: item.escalation || owner.escalation,
    });
  };

  for (const task of tasks || []) {
    if (isTaskClosed(task.status) || !task.data_planowana) continue;
    const plannedStart = sameDayClockMinutes(task.data_planowana);
    const duration = taskPlannedMinutes(task);
    const plannedEnd = plannedStart == null || duration <= 0 ? null : plannedStart + duration;
    const windowFrom = task.okno_od == null ? null : Number(task.okno_od);
    const windowTo = task.okno_do == null ? null : Number(task.okno_do);
    if (plannedStart != null && plannedEnd != null && windowFrom != null && windowTo != null) {
      if (plannedStart < windowFrom || plannedEnd > windowTo) {
        add({
          id: `client_window:${task.id}`,
          type: 'client_window',
          severity: 'critical',
          task_id: task.id,
          title: `Okno klienta poza planem: ${task.numer || `#${task.id}`}`,
          detail: `${task.klient_nazwa || 'Klient'} ma okno ${formatActionMinutes(windowFrom)}-${formatActionMinutes(windowTo)}, plan wychodzi ${formatActionMinutes(plannedStart)}-${formatActionMinutes(plannedEnd)}.`,
          action: 'Przesun plan albo wyslij nowa propozycje terminu przez Zadarma SMS.',
          action_path: buildTaskPath({ ...task, blockers: [] }, date),
        });
      }
    }
  }

  for (const row of proposalRows || []) {
    const status = String(row.status || '').toLowerCase();
    if (!['pending', 'rejected', 'expired'].includes(status)) continue;
    add({
      id: `time_window_proposal:${row.id || row.task_id}`,
      type: 'client_window',
      severity: status === 'pending' ? 'warning' : 'critical',
      task_id: row.task_id,
      title: `${status === 'pending' ? 'Termin czeka na klienta' : 'Termin niepotwierdzony'}: ${row.numer || `#${row.task_id}`}`,
      detail: `${row.klient_nazwa || 'Klient'} / status propozycji: ${row.status || 'pending'}.`,
      action: 'Sprawdz historie okien i ponow wysylke Zadarma SMS lub ustal termin telefonicznie.',
      action_path: `/zlecenia/${row.task_id}`,
    });
  }

  for (const row of smsRows || []) {
    add({
      id: `sms_delivery:${row.id}`,
      type: 'sms_delivery',
      severity: String(row.status || '').toLowerCase().includes('blad') || row.delivery_error_code ? 'critical' : 'warning',
      task_id: row.task_id,
      title: `Zadarma/SMS do sprawdzenia: ${row.numer || `#${row.task_id || row.id}`}`,
      detail: `${row.telefon || 'brak numeru'} / ${row.provider_status || row.status || 'brak statusu'}${row.delivery_error_code ? ` / ${row.delivery_error_code}` : ''}.`,
      action: 'Ponow kontakt z Telefonii albo zadzwon przez Zadarma.',
      action_path: row.task_id ? `/zlecenia/${row.task_id}` : '/telefonia',
    });
  }

  for (const row of kommoRows || []) {
    const status = String(row.status || '').toLowerCase();
    add({
      id: `kommo_sync:${row.id || row.task_id}`,
      type: 'kommo_sync',
      severity: status === 'dead_letter' ? 'critical' : 'warning',
      task_id: row.task_id || null,
      title: `Kommo sync ${status === 'dead_letter' ? 'dead-letter' : 'do retry'}: ${row.numer || `#${row.task_id || row.id}`}`,
      detail: `${row.event || 'task.sync'} / proby: ${Number(row.retry_count || 0)}${row.last_error ? ` / ${String(row.last_error).slice(0, 120)}` : ''}.`,
      action: status === 'dead_letter'
        ? 'Sprawdz konflikt w Integracjach i wykonaj kommo-retry z force=true po decyzji ownera.'
        : 'Sprawdz kolejke Kommo i poczekaj na retry albo ponow pojedyncze zlecenie.',
      action_path: row.task_id ? `/zlecenia/${row.task_id}?tab=integracje` : '/integracje',
    });
  }

  const activeByTeam = new Map();
  for (const task of tasks || []) {
    if (!task.ekipa_id || isTaskClosed(task.status) || !task.data_planowana) continue;
    const start = dateTimeMs(task.data_planowana);
    const minutes = taskPlannedMinutes(task);
    if (start == null || minutes <= 0) continue;
    const end = start + minutes * 60000;
    const list = activeByTeam.get(task.ekipa_id) || [];
    list.push({ ...task, start, end });
    activeByTeam.set(task.ekipa_id, list);
  }
  for (const list of activeByTeam.values()) {
    const sorted = list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (current.start < previous.end) {
        add({
          id: `team_conflict:${previous.id}:${current.id}`,
          type: 'team_conflict',
          severity: 'critical',
          task_id: current.id,
          title: `Konflikt ekipy: ${current.ekipa_nazwa || `ekipa #${current.ekipa_id}`}`,
          detail: `${previous.numer || `#${previous.id}`} nachodzi na ${current.numer || `#${current.id}`}.`,
          action: 'Rozdziel zlecenia w planie biura albo zmien ekipe.',
          action_path: `/zlecenia/${current.id}`,
        });
      }
    }
  }

  for (const row of equipmentRows || []) {
    add({
      id: `equipment_conflict:${row.sprzet_id}`,
      type: 'equipment_conflict',
      severity: 'critical',
      task_id: row.task_id || null,
      title: `Kolizja sprzetu: ${row.sprzet_nazwa || `sprzet #${row.sprzet_id}`}`,
      detail: `${row.conflict_pairs || 1} kolizji rezerwacji w planie dnia.`,
      action: 'Zmien rezerwacje sprzetu zanim ekipa ruszy w teren.',
      action_path: row.task_id ? `/zlecenia/${row.task_id}` : '/flota',
    });
  }

  for (const risk of marginRisks || []) {
    add({
      id: `margin:${risk.id}`,
      type: 'margin',
      severity: 'critical',
      task_id: risk.id,
      title: `Marza ponizej progu: ${risk.numer || `#${risk.id}`}`,
      detail: `${risk.margin_pct ?? '-'}% przy progu ${risk.threshold_pct}%, klient: ${risk.klient_nazwa || 'brak'}.`,
      action: 'Sprawdz koszty, roboczogodziny i doplaty przed zamknieciem dnia.',
      action_path: risk.action_path || `/zlecenia/${risk.id}`,
    });
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || String(a.title).localeCompare(String(b.title)));
  const counts = {
    total: items.length,
    critical: items.filter((item) => item.severity === 'critical').length,
    warning: items.filter((item) => item.severity === 'warning').length,
    client_window: items.filter((item) => item.type === 'client_window').length,
    sms_delivery: items.filter((item) => item.type === 'sms_delivery').length,
    kommo_sync: items.filter((item) => item.type === 'kommo_sync').length,
    team_conflict: items.filter((item) => item.type === 'team_conflict').length,
    equipment_conflict: items.filter((item) => item.type === 'equipment_conflict').length,
    margin: items.filter((item) => item.type === 'margin').length,
  };
  const report = {
    date,
    generated_at: new Date().toISOString(),
    counts,
    items: items.slice(0, 30),
  };
  return {
    ...report,
    text: buildRiskText({ ...report, items }),
  };
}

function taskPlanBounds(task) {
  const startMs = dateTimeMs(task?.data_planowana);
  if (startMs == null) return null;
  const minutes = Math.max(15, taskPlannedMinutes(task) || 120);
  return {
    start: new Date(startMs),
    end: new Date(startMs + minutes * 60000),
    day: new Date(startMs).toISOString().slice(0, 10),
    minutes,
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = dateTimeMs(aStart);
  const ae = dateTimeMs(aEnd);
  const bs = dateTimeMs(bStart);
  const be = dateTimeMs(bEnd);
  if ([as, ae, bs, be].some((v) => v == null)) return false;
  return as < be && bs < ae;
}

async function getRiskTask(taskId, user) {
  const result = await pool.query(
    `SELECT t.id, t.numer, t.klient_nazwa, t.klient_telefon, t.oddzial_id,
            t.ekipa_id, t.data_planowana, t.czas_planowany_godziny, t.czas_obslugi_min,
            t.notatki_wewnetrzne, e.nazwa AS ekipa_nazwa, b.telefon AS oddzial_telefon
     FROM tasks t
     LEFT JOIN teams e ON e.id = t.ekipa_id
     LEFT JOIN branches b ON b.id = t.oddzial_id
     WHERE t.id = $1`,
    [taskId]
  );
  const task = result.rows[0] || null;
  if (!task) return { error: { status: 404, message: 'Nie znaleziono zlecenia dla ryzyka.' } };
  if (!isDyrektorOrAdmin(user) && String(task.oddzial_id || '') !== String(user.oddzial_id || '')) {
    return { error: { status: 403, message: 'Brak dostepu do zlecenia z innego oddzialu.' } };
  }
  return { task };
}

async function buildTeamConflictOptions(task, limit = 5) {
  const bounds = taskPlanBounds(task);
  if (!bounds) return [];
  const { rows } = await pool.query(
    `SELECT tm.id, tm.nazwa, tm.oddzial_id
     FROM teams tm
     WHERE tm.aktywny IS NOT FALSE
       AND tm.oddzial_id = $1
       AND tm.id IS DISTINCT FROM $2::int
     ORDER BY tm.nazwa ASC
     LIMIT 50`,
    [task.oddzial_id, task.ekipa_id || null]
  );
  const options = [];
  for (const team of rows) {
    const busy = await pool.query(
      `SELECT t.id, t.numer, t.data_planowana,
              COALESCE(t.czas_obslugi_min, t.czas_planowany_godziny * 60, 120)::int AS minutes,
              'task' AS source
       FROM tasks t
       WHERE t.ekipa_id = $1
         AND t.id <> $2
         AND t.data_planowana::date = $3::date
         AND t.status NOT IN ('Zakonczone', 'Anulowane')
       UNION ALL
       SELECT r.id, NULL::text AS numer, r.data_od::timestamptz AS data_planowana,
              1440::int AS minutes,
              'equipment' AS source
       FROM equipment_reservations r
       WHERE r.ekipa_id = $1
         AND r.data_od <= $3::date
         AND r.data_do >= $3::date
         AND LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%'
         AND LOWER(COALESCE(r.status, '')) NOT LIKE 'zwr%'`,
      [team.id, task.id, bounds.day]
    );
    const conflict = busy.rows.some((row) => {
      const start = row.source === 'equipment'
        ? `${bounds.day}T00:00:00.000Z`
        : row.data_planowana;
      const startMs = dateTimeMs(start);
      if (startMs == null) return false;
      const end = new Date(startMs + Math.max(15, Number(row.minutes || 120)) * 60000).toISOString();
      return rangesOverlap(bounds.start, bounds.end, start, end);
    });
    if (!conflict) {
      options.push({
        team_id: team.id,
        team_name: team.nazwa,
        impact: `Przepnij ${task.numer || `#${task.id}`} na ${team.nazwa}; okno ${bounds.start.toISOString()} - ${bounds.end.toISOString()} jest wolne.`,
      });
    }
    if (options.length >= limit) break;
  }
  return options;
}

async function buildEquipmentConflictOptions(task, riskId, limit = 5) {
  const bounds = taskPlanBounds(task);
  const conflictedId = Number(String(riskId || '').match(/^equipment_conflict:(\d+)$/)?.[1] || 0);
  if (!bounds || !conflictedId) return [];
  const source = await pool.query('SELECT id, nazwa, typ, oddzial_id FROM equipment_items WHERE id = $1', [conflictedId]);
  const sourceItem = source.rows[0];
  if (!sourceItem) return [];
  const { rows } = await pool.query(
    `SELECT e.id, e.nazwa, e.typ, e.oddzial_id
     FROM equipment_items e
     WHERE e.id <> $1
       AND e.oddzial_id = $2
       AND COALESCE(e.status, '') NOT ILIKE '%serwis%'
       AND COALESCE(e.status, '') NOT ILIKE '%awari%'
       AND COALESCE(e.status, '') NOT ILIKE '%wycof%'
       AND ($3::text IS NULL OR e.typ = $3)
     ORDER BY e.nazwa ASC
     LIMIT 40`,
    [conflictedId, task.oddzial_id || sourceItem.oddzial_id, sourceItem.typ || null]
  );
  const options = [];
  for (const item of rows) {
    const clash = await pool.query(
      `SELECT id
       FROM equipment_reservations
       WHERE sprzet_id = $1
         AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'
         AND LOWER(COALESCE(status, '')) NOT LIKE 'zwr%'
         AND NOT (data_do < $2::date OR data_od > $2::date)
         AND (task_id IS NULL OR task_id <> $3::int)
       LIMIT 1`,
      [item.id, bounds.day, task.id]
    );
    if (!clash.rows.length) {
      options.push({
        old_sprzet_id: conflictedId,
        sprzet_id: item.id,
        sprzet_nazwa: item.nazwa,
        impact: `Zastap ${sourceItem.nazwa || `sprzet #${conflictedId}`} sprzetem ${item.nazwa}; ${bounds.day} bez kolizji.`,
      });
    }
    if (options.length >= limit) break;
  }
  return options;
}

function numberValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundedMinutes(value) {
  return Math.max(0, Math.round(numberValue(value)));
}

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function managerActor(user) {
  return [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || user?.login || `#${user?.id || '-'}`;
}

function formatActionMinutes(minutes) {
  const total = roundedMinutes(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

function formatSignedActionMinutes(minutes) {
  const total = eventNumber(minutes) || 0;
  const sign = total < 0 ? '-' : '';
  return `${sign}${formatActionMinutes(Math.abs(total))}`;
}

function planRealNote({ title, lines = [], user }) {
  return [
    'PLAN VS REAL',
    title,
    ...lines.filter(Boolean),
    `Kierownik: ${managerActor(user)}`,
    `Data wpisu: ${new Date().toISOString()}`,
  ].join('\n');
}

function eventNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function ensureOpsActionEventsTable() {
  if (opsActionEventsReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_action_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action_type VARCHAR(50) NOT NULL,
      issue_key VARCHAR(50),
      reason_code VARCHAR(50),
      delta_minutes INTEGER,
      planned_minutes INTEGER,
      real_minutes INTEGER,
      note TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ops_action_events_created ON ops_action_events(created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ops_action_events_branch_created ON ops_action_events(oddzial_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ops_action_events_task ON ops_action_events(task_id)');
  opsActionEventsReady = true;
}

async function ensureRiskTelephonyCallbacksTable() {
  if (riskTelephonyCallbacksReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telephony_callbacks (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      phone VARCHAR(64) NOT NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      lead_name VARCHAR(255),
      priority VARCHAR(16) NOT NULL DEFAULT 'normal',
      due_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      notes TEXT,
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks_oddzial_status ON telephony_callbacks(oddzial_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks_due ON telephony_callbacks(due_at)');
  riskTelephonyCallbacksReady = true;
}

async function recordOpsActionEvent({
  task,
  user,
  actionType,
  issueKey,
  reasonCode = null,
  deltaMinutes = null,
  plannedMinutes = null,
  realMinutes = null,
  note = '',
  metadata = {},
}) {
  const { rows } = await pool.query(
    `INSERT INTO ops_action_events (
       task_id, oddzial_id, actor_id, action_type, issue_key, reason_code,
       delta_minutes, planned_minutes, real_minutes, note, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), $11::jsonb)
     RETURNING id, task_id, action_type, issue_key, reason_code, created_at`,
    [
      task?.id || null,
      task?.oddzial_id || null,
      user?.id || null,
      actionType,
      issueKey || null,
      reasonCode || null,
      eventNumber(deltaMinutes),
      eventNumber(plannedMinutes),
      eventNumber(realMinutes),
      cleanText(note, 1200),
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0] || null;
}

function buildPlanRealTaskPath(task, date) {
  const params = new URLSearchParams();
  params.set('returnTo', `/kierownik?date=${encodeURIComponent(date)}`);
  params.set('returnLabel', 'Plan vs real');
  if (task.issue_key === 'missing_duration') {
    params.set('mode', 'edit');
    params.set('step', 'finance');
    params.set('field', 'czas_planowany_godziny');
  } else if (task.issue_key === 'not_started') {
    params.set('focus', 'dispatch');
  } else if (task.issue_key === 'missing_finish') {
    params.set('tab', 'logi');
  }
  return `/zlecenia/${task.id}?${params.toString()}`;
}

function buildRecommendationTaskPath(tasks, date) {
  const task = tasks.find(Boolean);
  if (!task) return `/kierownik?date=${encodeURIComponent(date)}`;
  if (task.action_path) return task.action_path;
  return buildPlanRealTaskPath(task, date);
}

function recommendationTaskPreview(tasks = [], date, limit = 3) {
  return tasks
    .filter(Boolean)
    .slice(0, limit)
    .map((task) => {
      const blockers = Array.isArray(task.blockers) ? task.blockers : [];
      return {
        id: task.id,
        numer: task.numer || `ZLE-${String(task.id).padStart(4, '0')}`,
        klient_nazwa: task.klient_nazwa || null,
        ekipa_nazwa: task.ekipa_nazwa || null,
        issue_key: task.issue_key || null,
        issue_label: task.issue_label || (task.issue_key ? PLAN_REAL_ISSUE_LABELS[task.issue_key] || task.issue_key : null),
        blockers,
        planned_minutes: roundedMinutes(task.planned_minutes),
        real_minutes: roundedMinutes(task.real_minutes),
        delta_minutes: eventNumber(task.delta_minutes) || 0,
        target_path: task.action_path || (blockers.length ? buildTaskPath({ ...task, blockers }, date) : buildPlanRealTaskPath(task, date)),
      };
    });
}

function taskBlockerSubset(task, allowedBlockers) {
  const allowed = new Set(allowedBlockers || []);
  return (task?.blockers || []).filter((key) => allowed.has(key));
}

function recommendationBlockerTaskPreview(tasks = [], date, allowedBlockers = []) {
  return recommendationTaskPreview(
    tasks.map((task) => ({
      ...task,
      issue_key: null,
      issue_label: null,
      blockers: taskBlockerSubset(task, allowedBlockers),
      action_path: null,
    })),
    date
  );
}

function recommendationBlockerTaskPath(tasks = [], date, allowedBlockers = []) {
  const task = tasks.find(Boolean);
  if (!task) return `/kierownik?date=${encodeURIComponent(date)}`;
  return buildTaskPath({ ...task, blockers: taskBlockerSubset(task, allowedBlockers) }, date);
}

function classifyPlanRealTask(task) {
  if (task.planned_minutes <= 0) {
    return {
      key: 'missing_duration',
      label: 'Brak czasu planu',
      tone: 'warning',
      action: 'Uzupelnij czas',
      rank: 2,
    };
  }
  if (task.has_started && task.real_minutes > task.planned_minutes + 30) {
    return {
      key: 'overrun',
      label: 'Przekroczenie planu',
      tone: 'danger',
      action: 'Sprawdz zlecenie',
      rank: 0,
    };
  }
  if (task.has_started && !task.has_finished && !isTaskClosed(task.status)) {
    return {
      key: 'missing_finish',
      label: 'Brak zamkniecia',
      tone: 'warning',
      action: 'Domknij log pracy',
      rank: 1,
    };
  }
  if (!task.has_started && !isTaskClosed(task.status)) {
    return {
      key: 'not_started',
      label: 'Nie wystartowalo',
      tone: 'warning',
      action: 'Sprawdz ekipe',
      rank: 3,
    };
  }
  if (task.has_finished && task.real_minutes < Math.round(task.planned_minutes * 0.6)) {
    return {
      key: 'under_plan',
      label: 'Ponizej planu',
      tone: 'info',
      action: 'Zweryfikuj zakres',
      rank: 4,
    };
  }
  return null;
}

function topEventStat(eventStats, field) {
  const totals = new Map();
  for (const row of eventStats || []) {
    const key = row?.[field];
    if (!key) continue;
    const count = Math.max(0, Number(row.count || 0));
    const current = totals.get(key) || {
      [field]: key,
      count: 0,
      delta_sum: 0,
      delta_weight: 0,
    };
    current.count += count;
    const avgDelta = eventNumber(row.avg_delta_minutes);
    if (avgDelta != null && count > 0) {
      current.delta_sum += avgDelta * count;
      current.delta_weight += count;
    }
    totals.set(key, current);
  }

  const top = Array.from(totals.values())
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
  if (!top) return null;
  return {
    [field]: top[field],
    count: top.count,
    avg_delta_minutes: top.delta_weight > 0 ? Math.round(top.delta_sum / top.delta_weight) : null,
  };
}

function buildOpsActionRecommendations({ date, oddzialId, tasks = [], eventStats = [] }) {
  const activeTasks = tasks.filter((task) => !isTaskClosed(task.status));
  const missingDuration = activeTasks.filter((task) => task.issue_key === 'missing_duration' || task.blockers?.includes('duration'));
  const notStarted = activeTasks.filter((task) => task.issue_key === 'not_started' && task.ekipa_id);
  const overrunTasks = activeTasks.filter((task) => task.issue_key === 'overrun' || task.issue_key === 'missing_finish');
  const dispatchBlockers = activeTasks.filter((task) => task.blockers?.includes('team') || task.blockers?.includes('gps'));
  const contactBlockers = activeTasks.filter((task) => task.blockers?.includes('phone') || task.blockers?.includes('address'));
  const issueBlockers = activeTasks.filter((task) => task.blockers?.includes('issue'));
  const topReason = topEventStat(eventStats, 'reason_code');

  const recommendations = [];
  const add = (item) => {
    recommendations.push({
      oddzial_id: oddzialId,
      generated_for_date: date,
      task_preview: [],
      ...item,
    });
  };

  if (missingDuration.length > 0) {
    const suggestedMinutes = missingDuration.length >= 3 ? 120 : 90;
    add({
      id: 'set_missing_duration',
      priority: missingDuration.length >= 3 ? 'high' : 'medium',
      tone: 'warning',
      score: 90 + missingDuration.length * 8,
      title: `${missingDuration.length} zlecen bez czasu planu`,
      rationale: 'Bez czasu planu solver, obciazenie ekip i plan vs real nie maja czego liczyc.',
      suggested_action: `Ustaw ${formatActionMinutes(suggestedMinutes)} jako czas startowy i popraw wyjatki pozniej.`,
      action_kind: 'set_duration_batch',
      primary_label: 'Zastosuj',
      secondary_label: 'Otworz zlecenia',
      suggested_minutes: suggestedMinutes,
      task_count: missingDuration.length,
      task_ids: missingDuration.slice(0, 8).map((task) => task.id),
      task_preview: recommendationTaskPreview(missingDuration, date),
      target_path: buildRecommendationTaskPath(missingDuration, date),
      impact_label: `${formatActionMinutes(suggestedMinutes * missingDuration.length)} planu do uzupelnienia`,
    });
  }

  if (notStarted.length > 0) {
    add({
      id: 'remind_not_started',
      priority: notStarted.length >= 2 ? 'high' : 'medium',
      tone: 'warning',
      score: 84 + notStarted.length * 7,
      title: `${notStarted.length} zlecen nie wystartowalo`,
      rationale: 'Brak startu w logach zwykle oznacza opozniona ekipe albo zapomniany check-in.',
      suggested_action: 'Wyslij krotkie przypomnienie do przypisanych ekip.',
      action_kind: 'remind_team_batch',
      primary_label: 'Przypomnij',
      secondary_label: 'Otworz',
      task_count: notStarted.length,
      task_ids: notStarted.slice(0, 8).map((task) => task.id),
      task_preview: recommendationTaskPreview(notStarted, date),
      target_path: buildRecommendationTaskPath(notStarted, date),
      impact_label: `${notStarted.length} ekip do potwierdzenia`,
    });
  }

  if (dispatchBlockers.length > 0) {
    const missingTeams = dispatchBlockers.filter((task) => task.blockers?.includes('team')).length;
    const missingGps = dispatchBlockers.filter((task) => task.blockers?.includes('gps')).length;
    add({
      id: 'fix_dispatch_blockers',
      priority: dispatchBlockers.length >= 3 ? 'high' : 'medium',
      tone: 'danger',
      score: 78 + dispatchBlockers.length * 6,
      title: `${dispatchBlockers.length} blokad wysylki ekip`,
      rationale: `${missingTeams} bez ekipy, ${missingGps} bez pinezki GPS. To blokuje dobry plan dnia.`,
      suggested_action: 'Uruchom preflight: system przypisze wolna ekipe, a brak GPS oznaczy checklistą do uzupelnienia.',
      action_kind: 'fix_dispatch_blockers',
      primary_label: 'Napraw blokady',
      secondary_label: 'Otworz',
      task_count: dispatchBlockers.length,
      task_ids: dispatchBlockers.slice(0, 8).map((task) => task.id),
      task_preview: recommendationBlockerTaskPreview(dispatchBlockers, date, ['team', 'gps']),
      target_path: recommendationBlockerTaskPath(dispatchBlockers, date, ['team', 'gps']),
      impact_label: `${dispatchBlockers.length} zlecen blokuje dispatch`,
    });
  }

  if (contactBlockers.length > 0) {
    const missingPhones = contactBlockers.filter((task) => task.blockers?.includes('phone')).length;
    const missingAddresses = contactBlockers.filter((task) => task.blockers?.includes('address')).length;
    add({
      id: 'fix_contact_blockers',
      priority: contactBlockers.length >= 3 ? 'high' : 'medium',
      tone: 'warning',
      score: 74 + contactBlockers.length * 6,
      title: `${contactBlockers.length} zlecen z brakami kontaktowymi`,
      rationale: `${missingPhones} bez telefonu, ${missingAddresses} bez adresu. To spowalnia potwierdzenia i przygotowanie ekip.`,
      suggested_action: 'Otworz pierwsze zlecenie i uzupelnij dane klienta przed wysylka.',
      action_kind: 'open_tasks',
      primary_label: 'Napraw dane',
      secondary_label: '',
      task_count: contactBlockers.length,
      task_ids: contactBlockers.slice(0, 8).map((task) => task.id),
      task_preview: recommendationBlockerTaskPreview(contactBlockers, date, ['phone', 'address']),
      target_path: recommendationBlockerTaskPath(contactBlockers, date, ['phone', 'address']),
      impact_label: `${contactBlockers.length} zlecen wymaga danych`,
    });
  }

  if (issueBlockers.length > 0) {
    const openIssues = issueBlockers.reduce((sum, task) => sum + Number(task.open_issues || 0), 0);
    add({
      id: 'resolve_open_issues',
      priority: openIssues >= 3 ? 'high' : 'medium',
      tone: 'danger',
      score: 72 + Math.min(30, openIssues * 5),
      title: `${openIssues} otwartych problemow blokuje dzien`,
      rationale: `${issueBlockers.length} zlecen ma nierozwiazane problemy przed realizacja.`,
      suggested_action: 'Otworz zakladke problemow i domknij decyzje przed startem ekipy.',
      action_kind: 'open_tasks',
      primary_label: 'Zamknij problemy',
      secondary_label: '',
      task_count: issueBlockers.length,
      task_ids: issueBlockers.slice(0, 8).map((task) => task.id),
      task_preview: recommendationBlockerTaskPreview(issueBlockers, date, ['issue']),
      target_path: recommendationBlockerTaskPath(issueBlockers, date, ['issue']),
      impact_label: `${openIssues} problemow do decyzji`,
    });
  }

  if (overrunTasks.length > 0) {
    const totalDelta = overrunTasks.reduce((sum, task) => sum + Math.max(0, Number(task.delta_minutes || 0)), 0);
    add({
      id: 'explain_overruns',
      priority: totalDelta >= 120 ? 'high' : 'medium',
      tone: 'warning',
      score: 70 + Math.min(30, Math.round(totalDelta / 10)),
      title: `${overrunTasks.length} odchylen wymaga decyzji`,
      rationale: `Plan odbiega o ${formatActionMinutes(totalDelta)}. Powod powinien trafic do pamieci operacyjnej.`,
      suggested_action: 'Oznacz powod w Plan vs real albo otworz zlecenie do sprawdzenia.',
      action_kind: 'open_tasks',
      primary_label: 'Otworz',
      secondary_label: '',
      task_count: overrunTasks.length,
      task_ids: overrunTasks.slice(0, 8).map((task) => task.id),
      task_preview: recommendationTaskPreview(overrunTasks, date),
      target_path: buildRecommendationTaskPath(overrunTasks, date),
      impact_label: `${formatActionMinutes(totalDelta)} nad planem`,
    });
  }

  if (topReason) {
    const reasonCode = topReason.reason_code;
    const avgDelta = eventNumber(topReason.avg_delta_minutes) || 0;
    add({
      id: `reason_${reasonCode}`,
      priority: Number(topReason.count || 0) >= 3 ? 'medium' : 'low',
      tone: 'info',
      score: 58 + Number(topReason.count || 0) * 5 + Math.min(20, Math.abs(avgDelta)),
      title: `Najczestszy powod strat: ${PLAN_REAL_REASON_LABELS[reasonCode] || reasonCode}`,
      rationale: `${topReason.count} wpisow w ostatnich dniach, srednia odchylka ${formatSignedActionMinutes(avgDelta)}.`,
      suggested_action: reasonCode === 'dojazd'
        ? 'Sprawdz pinezki GPS i kolejność tras przed wysylka ekip.'
        : 'Ustal wspolna regule planowania dla tego powodu.',
      action_kind: reasonCode === 'dojazd' ? 'open_map' : 'open_tasks',
      primary_label: reasonCode === 'dojazd' ? 'Mapa live' : 'Otworz',
      secondary_label: '',
      task_count: Number(topReason.count || 0),
      task_ids: [],
      target_path: reasonCode === 'dojazd' ? '/mapa-live' : `/kierownik?date=${encodeURIComponent(date)}`,
      impact_label: `${topReason.count} podobnych decyzji`,
    });
  }

  if (recommendations.length === 0) {
    add({
      id: 'steady_day',
      priority: 'low',
      tone: 'ok',
      score: 1,
      title: 'Brak pilnych ruchow operacyjnych',
      rationale: 'Dzisiejszy plan nie pokazuje krytycznych odchylen ani powtarzalnych blokad.',
      suggested_action: 'Monitoruj start ekip i wracaj do cockpit po pierwszych logach.',
      action_kind: 'none',
      primary_label: 'OK',
      secondary_label: '',
      task_count: 0,
      task_ids: [],
      target_path: `/kierownik?date=${encodeURIComponent(date)}`,
      impact_label: 'plan stabilny',
    });
  }

  return recommendations
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function latestRecommendationFeedbackById(rows = []) {
  const latest = new Map();
  for (const row of rows || []) {
    const recommendationId = cleanText(row?.recommendation_id, 120);
    if (!recommendationId) continue;
    const ts = new Date(row?.created_at || 0).getTime();
    const createdAt = Number.isFinite(ts) ? ts : 0;
    const current = latest.get(recommendationId);
    if (!current || createdAt >= current.createdAt) {
      latest.set(recommendationId, {
        recommendation_id: recommendationId,
        decision: cleanText(row?.decision, 30),
        source: cleanText(row?.source, 50),
        createdAt,
      });
    }
  }
  return latest;
}

function safeMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function recommendationTaskIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))]
    .slice(0, 20);
}

function decisionOutcome(row) {
  const meta = safeMetadata(row.metadata);
  if (row.action_type === 'risk_acknowledge') {
    return `Potwierdzone: ${meta.risk_type || row.issue_key || 'ryzyko'}`;
  }
  if (row.action_type === 'risk_reassign_team') {
    return `Ekipa ${meta.old_team_id || '-'} -> ${meta.new_team_id || '-'}`;
  }
  if (row.action_type === 'risk_replace_equipment') {
    return `Sprzet ${meta.old_sprzet_id || '-'} -> ${meta.new_sprzet_id || '-'}`;
  }
  if (row.action_type === 'risk_queue_call') {
    if (meta.zadarma_call?.ok) return 'Telefon Zadarma uruchomiony';
    if (meta.callback_id) return `Callback #${meta.callback_id}`;
  }
  if (row.action_type === 'risk_resend_sms') {
    return meta.ok ? `SMS ${meta.provider || 'gateway'} wyslany` : `SMS blad: ${meta.error || '-'}`;
  }
  if (row.action_type === 'set_duration') {
    return row.planned_minutes ? `Plan ${formatActionMinutes(row.planned_minutes)}` : 'Czas planu zapisany';
  }
  if (row.action_type === 'mark_reason') {
    return PLAN_REAL_REASON_LABELS[row.reason_code] || row.reason_code || 'Powod zapisany';
  }
  if (row.action_type === 'remind_team') {
    return `Powiadomien: ${meta.notification_count ?? 0}`;
  }
  if (row.action_type === 'recommendation_feedback') {
    return `${meta.decision || '-'} / ${meta.recommendation_id || '-'}`;
  }
  return row.note || '';
}

function csvCell(value) {
  const text = value == null ? '' : String(value).replace(/\r?\n/g, ' ').trim();
  if (/[;"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function actionHistoryCsv(items) {
  const columns = [
    ['id', 'ID'],
    ['created_at', 'Data decyzji'],
    ['oddzial_nazwa', 'Oddzial'],
    ['actor_name', 'Operator'],
    ['action_label', 'Decyzja'],
    ['action_type', 'Kod decyzji'],
    ['risk_type', 'Typ ryzyka'],
    ['risk_id', 'ID ryzyka'],
    ['owner_label', 'Owner'],
    ['owner_ack_status', 'Status potwierdzenia'],
    ['numer', 'Zlecenie'],
    ['klient_nazwa', 'Klient'],
    ['outcome', 'Wynik'],
    ['note', 'Notatka'],
  ];
  const rows = [
    columns.map(([, label]) => csvCell(label)).join(';'),
    ...items.map((item) => columns.map(([key]) => csvCell(item[key])).join(';')),
  ];
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

router.get('/kierownik-today', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const branchSql = oddzialId != null ? 'AND t.oddzial_id = $2' : '';
  const taskParams = oddzialId != null ? [date, oddzialId] : [date];

  const teamBranchSql = oddzialId != null ? 'AND tm.oddzial_id = $2' : '';
  const reservationBranchSql = oddzialId != null ? 'AND r1.oddzial_id = $2' : '';
  const kommoSyncBranchSql = oddzialId != null ? 'AND t.oddzial_id = $1' : '';
  const kommoSyncParams = oddzialId != null ? [oddzialId] : [];

  try {
    const [
      tasksResult,
      teamsResult,
      notificationsResult,
      marginRiskResult,
      smsRiskResult,
      kommoSyncRiskResult,
      proposalRiskResult,
      equipmentConflictResult,
    ] = await Promise.all([
      pool.query(
        `WITH open_issues AS (
           SELECT task_id, COUNT(*)::int AS open_issues
           FROM issues
           WHERE LOWER(COALESCE(status, '')) NOT LIKE 'rozwi%'
             AND LOWER(COALESCE(status, '')) NOT LIKE 'zamk%'
           GROUP BY task_id
         ),
         work_state AS (
           SELECT task_id,
                  BOOL_OR(start_time IS NOT NULL) AS has_started,
                  BOOL_OR(end_time IS NOT NULL) AS has_finished
           FROM work_logs
           GROUP BY task_id
         )
         SELECT t.id, t.numer, t.klient_nazwa, t.klient_telefon, t.adres, t.miasto,
                t.status, t.priorytet, t.data_planowana, t.ekipa_id, t.oddzial_id,
                t.pin_lat, t.pin_lng, t.czas_planowany_godziny, t.czas_obslugi_min,
                t.okno_od, t.okno_do,
                e.nazwa AS ekipa_nazwa, b.nazwa AS oddzial_nazwa,
                COALESCE(oi.open_issues, 0)::int AS open_issues,
                COALESCE(ws.has_started, false) AS has_started,
                COALESCE(ws.has_finished, false) AS has_finished
         FROM tasks t
         LEFT JOIN teams e ON e.id = t.ekipa_id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         LEFT JOIN open_issues oi ON oi.task_id = t.id
         LEFT JOIN work_state ws ON ws.task_id = t.id
         WHERE t.data_planowana::date = $1::date
           ${branchSql}
         ORDER BY
           CASE t.priorytet WHEN 'Pilny' THEN 0 WHEN 'Wysoki' THEN 1 WHEN 'Normalny' THEN 2 ELSE 3 END,
           t.data_planowana ASC NULLS LAST,
           t.id ASC`,
        taskParams
      ),
      pool.query(
        `WITH today_tasks AS (
           SELECT id, ekipa_id, status
           FROM tasks t
           WHERE t.data_planowana::date = $1::date
             AND t.ekipa_id IS NOT NULL
             ${branchSql}
         ),
         latest_vehicle_gps AS (
           SELECT v.ekipa_id, MAX(g.recorded_at) AS recorded_at
           FROM vehicles v
           JOIN gps_vehicle_positions g
             ON REPLACE(REPLACE(UPPER(v.nr_rejestracyjny), ' ', ''), '-', '') =
                REPLACE(REPLACE(UPPER(g.plate_number), ' ', ''), '-', '')
           WHERE v.ekipa_id IS NOT NULL
           GROUP BY v.ekipa_id
         ),
         latest_mobile_gps AS (
           SELECT COALESCE(u.ekipa_id, tm_by_lead.id) AS ekipa_id,
                  MAX(g.recorded_at) AS recorded_at
           FROM gps_vehicle_positions g
           JOIN users u ON u.id::text = g.external_id
           LEFT JOIN teams tm_by_lead ON tm_by_lead.brygadzista_id = u.id
           WHERE g.provider = 'mobile'
             AND COALESCE(u.aktywny, true) = true
             AND (u.rola IN ('Brygadzista', 'Pomocnik') OR LOWER(u.rola) LIKE 'wyceniaj%')
             AND COALESCE(u.ekipa_id, tm_by_lead.id) IS NOT NULL
           GROUP BY COALESCE(u.ekipa_id, tm_by_lead.id)
         ),
         latest_team_gps AS (
           SELECT ekipa_id, MAX(recorded_at) AS recorded_at
           FROM (
             SELECT ekipa_id, recorded_at FROM latest_vehicle_gps
             UNION ALL
             SELECT ekipa_id, recorded_at FROM latest_mobile_gps
           ) gps_sources
           GROUP BY ekipa_id
         )
         SELECT tm.id, tm.nazwa, tm.oddzial_id,
                COUNT(tt.id)::int AS tasks_total,
                COUNT(tt.id) FILTER (WHERE tt.status = 'W_Realizacji')::int AS in_progress,
                COUNT(tt.id) FILTER (WHERE tt.status = 'Zaplanowane')::int AS planned,
                lvg.recorded_at AS last_gps_at
         FROM teams tm
         LEFT JOIN today_tasks tt ON tt.ekipa_id = tm.id
         LEFT JOIN latest_team_gps lvg ON lvg.ekipa_id = tm.id
         WHERE tm.aktywny IS NOT FALSE
           ${teamBranchSql}
         GROUP BY tm.id, tm.nazwa, tm.oddzial_id, lvg.recorded_at
         ORDER BY tm.nazwa ASC`,
        taskParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS unread
         FROM notifications
         WHERE to_user_id = $1 AND status = 'Nowe'`,
        [req.user.id]
      ),
      pool.query(
        `SELECT t.id, t.numer, t.klient_nazwa, t.status, t.oddzial_id, t.data_planowana,
                COALESCE(b.marza_prog_rentowosci_pct, 15)::numeric AS threshold_pct,
                COALESCE(t.wartosc_netto_do_rozliczenia, t.wartosc_rzeczywista, t.wartosc_planowana, tr.wartosc_brutto, 0)::numeric AS revenue_net,
                COALESCE(tr.koszt_pomocnikow, 0)::numeric AS helper_cost,
                COALESCE(tr.wynagrodzenie_brygadzisty, 0)::numeric AS crew_lead_pay,
                COALESCE(op.koszt_sprzetu, 0)::numeric AS equipment_cost,
                COALESCE(op.koszt_paliwa, 0)::numeric AS fuel_cost,
                COALESCE(mu.koszt_materialow, 0)::numeric AS material_cost,
                COALESCE(op.koszt_utylizacji, 0)::numeric AS disposal_cost,
                COALESCE(op.koszt_inne, 0)::numeric AS other_cost
         FROM tasks t
         JOIN task_rozliczenie tr ON tr.task_id = t.id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(SUM(amount) FILTER (WHERE category = 'sprzet'), 0) AS koszt_sprzetu,
             COALESCE(SUM(amount) FILTER (WHERE category = 'paliwo'), 0) AS koszt_paliwa,
             COALESCE(SUM(amount) FILTER (WHERE category = 'utylizacja'), 0) AS koszt_utylizacji,
             COALESCE(SUM(amount) FILTER (WHERE category = 'inne'), 0) AS koszt_inne
           FROM task_operational_costs c
           WHERE c.task_id = t.id
         ) op ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(koszt_laczny), 0) AS koszt_materialow
           FROM task_finish_material_usage m
           WHERE m.task_id = t.id
         ) mu ON true
         WHERE t.status = 'Zakonczone'
           AND COALESCE(t.data_zakonczenia, t.data_planowana, t.updated_at)::date = $1::date
           ${branchSql}
         ORDER BY COALESCE(t.data_zakonczenia, t.updated_at) DESC NULLS LAST
         LIMIT 50`,
        taskParams
      ),
      pool.query(
        `SELECT h.id, h.task_id, h.telefon, h.status, h.provider, h.provider_status,
                h.delivery_error_code, h.created_at, t.numer, t.klient_nazwa
         FROM sms_history h
         LEFT JOIN tasks t ON t.id = h.task_id
         WHERE h.created_at >= $1::date
           AND h.created_at < $1::date + INTERVAL '1 day'
           ${branchSql}
           AND (
             h.delivery_error_code IS NOT NULL
             OR LOWER(COALESCE(h.status, '')) LIKE 'blad%'
             OR LOWER(COALESCE(h.provider_status, '')) IN ('failed', 'undelivered', 'rejected', 'denied', 'error')
             OR (
               h.provider_status IS NULL
               AND h.created_at < NOW() - INTERVAL '30 minutes'
               AND LOWER(COALESCE(h.status, '')) NOT IN ('dostarczony', 'delivered')
             )
           )
         ORDER BY h.created_at DESC
         LIMIT 12`,
        taskParams
      ),
      pool.query(
        `SELECT q.id, q.task_id, q.event, q.status, q.retry_count, q.next_retry_at,
                q.last_error, q.last_http_status, q.updated_at, t.numer, t.klient_nazwa
         FROM task_kommo_sync_queue q
         LEFT JOIN tasks t ON t.id = q.task_id
         WHERE q.status IN ('failed', 'dead_letter')
           ${kommoSyncBranchSql}
         ORDER BY
           CASE q.status WHEN 'dead_letter' THEN 0 ELSE 1 END,
           q.updated_at DESC NULLS LAST,
           q.id DESC
         LIMIT 12`,
        kommoSyncParams
      ),
      pool.query(
        `SELECT DISTINCT ON (p.task_id)
                p.id, p.task_id, p.status, p.expires_at, p.created_at,
                t.numer, t.klient_nazwa
         FROM task_time_window_proposals p
         JOIN tasks t ON t.id = p.task_id
         WHERE t.data_planowana::date = $1::date
           ${branchSql}
           AND (
             p.status IN ('pending', 'rejected', 'expired')
             OR (p.status = 'pending' AND p.expires_at IS NOT NULL AND p.expires_at < NOW())
           )
         ORDER BY p.task_id, p.created_at DESC
         LIMIT 20`,
        taskParams
      ),
      pool.query(
        `SELECT r1.sprzet_id, COALESCE(e.nazwa, 'sprzet #' || r1.sprzet_id) AS sprzet_nazwa,
                COUNT(*)::int AS conflict_pairs,
                MIN(COALESCE(r1.task_id, r2.task_id)) AS task_id
         FROM equipment_reservations r1
         JOIN equipment_reservations r2
           ON r1.sprzet_id = r2.sprzet_id
          AND r1.id < r2.id
          AND r1.status != 'Anulowane'
          AND r1.status NOT ILIKE 'Zwr%'
          AND r2.status != 'Anulowane'
          AND r2.status NOT ILIKE 'Zwr%'
          AND NOT (r1.data_do <= r2.data_od OR r1.data_od >= r2.data_do)
         LEFT JOIN equipment_items e ON e.id = r1.sprzet_id
         WHERE r1.data_od < $1::date + INTERVAL '1 day'
           AND r1.data_do > $1::date
           ${reservationBranchSql}
         GROUP BY r1.sprzet_id, e.nazwa
         ORDER BY conflict_pairs DESC
         LIMIT 8`,
        taskParams
      ),
    ]);

    const blockerCounts = new Map();
    const openTasks = [];
    let done = 0;
    let inProgress = 0;
    let ready = 0;
    let blocked = 0;
    let unassigned = 0;
    let openIssues = 0;

    for (const row of tasksResult.rows) {
      if (isTaskClosed(row.status)) {
        done += 1;
        continue;
      }

      if (row.status === IN_PROGRESS_TASK_STATUS) {
        inProgress += 1;
      }

      const blockers = row.status === IN_PROGRESS_TASK_STATUS ? [] : taskBlockers(row);
      if (!row.ekipa_id && row.status !== IN_PROGRESS_TASK_STATUS) unassigned += 1;
      openIssues += Number(row.open_issues || 0);
      blockers.forEach((key) => bumpBlocker(blockerCounts, key));
      if (blockers.length > 0) blocked += 1;
      if (blockers.length === 0 && row.status !== IN_PROGRESS_TASK_STATUS) ready += 1;

      openTasks.push({
        id: row.id,
        numer: row.numer || `ZLE-${String(row.id).padStart(4, '0')}`,
        klient_nazwa: row.klient_nazwa,
        adres: row.adres,
        miasto: row.miasto,
        status: row.status,
        priorytet: row.priorytet,
        data_planowana: row.data_planowana,
        ekipa_id: row.ekipa_id,
        ekipa_nazwa: row.ekipa_nazwa,
        oddzial_nazwa: row.oddzial_nazwa,
        open_issues: Number(row.open_issues || 0),
        blockers,
      });
    }

    const teams = teamsResult.rows.map((row) => {
      const gps = gpsStatus(row.last_gps_at);
      return {
        id: row.id,
        nazwa: row.nazwa,
        oddzial_id: row.oddzial_id,
        tasks_total: Number(row.tasks_total || 0),
        in_progress: Number(row.in_progress || 0),
        planned: Number(row.planned || 0),
        last_gps_at: row.last_gps_at,
        gps_status: gps.status,
        gps_age_min: gps.ageMin,
      };
    });

    const gpsStaleTeams = teams.filter((team) => team.tasks_total > 0 && ['missing', 'stale', 'offline'].includes(team.gps_status));
    if (gpsStaleTeams.length > 0) bumpBlocker(blockerCounts, 'gps_stale', gpsStaleTeams.length);

    const unreadNotifications = Number(notificationsResult.rows[0]?.unread || 0);
    if (unreadNotifications > 0) bumpBlocker(blockerCounts, 'notification', unreadNotifications);

    const marginRisks = marginRiskResult.rows
      .map((row) => {
        const margin = calculateTaskMargin(row);
        const thresholdPct = Number(row.threshold_pct || 15);
        return {
          id: row.id,
          numer: row.numer || `ZLE-${String(row.id).padStart(4, '0')}`,
          klient_nazwa: row.klient_nazwa,
          status: row.status,
          oddzial_id: row.oddzial_id,
          data_planowana: row.data_planowana,
          threshold_pct: thresholdPct,
          revenue_net: margin.revenue_net,
          total_known_cost: margin.total_known_cost,
          gross_margin: margin.gross_margin,
          margin_pct: margin.margin_pct,
          action_path: buildTaskPath(row, date),
        };
      })
      .filter((row) => row.margin_pct != null && row.margin_pct < row.threshold_pct)
      .sort((a, b) => (a.margin_pct ?? 999) - (b.margin_pct ?? 999))
      .slice(0, 8);
    if (marginRisks.length > 0) bumpBlocker(blockerCounts, 'margin', marginRisks.length);

    const riskReport = buildManagerRiskReport({
      date,
      tasks: tasksResult.rows,
      marginRisks,
      smsRows: smsRiskResult.rows,
      kommoRows: kommoSyncRiskResult.rows,
      proposalRows: proposalRiskResult.rows,
      equipmentRows: equipmentConflictResult.rows,
    });

    const riskyTasks = openTasks
      .filter((task) => task.blockers.length > 0 || task.open_issues > 0)
      .sort((a, b) => b.blockers.length - a.blockers.length || b.open_issues - a.open_issues)
      .slice(0, 8)
      .map((task) => ({
        ...task,
        blocker_labels: task.blockers.map((key) => BLOCKER_META[key]?.label || key),
        action_path: buildTaskPath(task, date),
      }));

    res.json({
      date,
      oddzial_id: oddzialId,
      summary: {
        tasks_total: tasksResult.rows.length,
        open: openTasks.length,
        done,
        in_progress: inProgress,
        ready_for_dispatch: ready,
        blocked,
        unassigned,
        open_issues: openIssues,
        margin_risks: marginRisks.length,
        day_risks: riskReport.counts.total,
        critical_day_risks: riskReport.counts.critical,
        zadarma_sms_risks: riskReport.counts.sms_delivery,
        kommo_sync_risks: riskReport.counts.kommo_sync,
        unread_notifications: unreadNotifications,
        active_teams: teams.length,
        assigned_teams: teams.filter((team) => team.tasks_total > 0).length,
        gps_online: teams.filter((team) => team.tasks_total > 0 && team.gps_status === 'online').length,
        gps_attention: gpsStaleTeams.length,
      },
      blockers: blockerRows(blockerCounts),
      tasks: riskyTasks,
      margin_risks: marginRisks,
      risk_report: riskReport,
      teams: teams.filter((team) => team.tasks_total > 0 || team.gps_status !== 'missing').slice(0, 12),
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops kierownik-today', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/plan-vs-real', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const branchSql = oddzialId != null ? 'AND t.oddzial_id = $2' : '';
  const params = oddzialId != null ? [date, oddzialId] : [date];

  try {
    const { rows } = await pool.query(
      `WITH planned AS (
         SELECT t.id, t.numer, t.klient_nazwa, t.status, t.priorytet,
                t.data_planowana, t.ekipa_id, t.oddzial_id,
                t.czas_planowany_godziny, t.czas_obslugi_min,
                t.wartosc_planowana, t.wartosc_rzeczywista,
                e.nazwa AS ekipa_nazwa,
                b.nazwa AS oddzial_nazwa,
                CASE
                  WHEN COALESCE(t.czas_obslugi_min, 0) > 0 THEN t.czas_obslugi_min::numeric
                  WHEN COALESCE(t.czas_planowany_godziny, 0) > 0 THEN ROUND(t.czas_planowany_godziny::numeric * 60)
                  ELSE 0
                END AS planned_minutes
         FROM tasks t
         LEFT JOIN teams e ON e.id = t.ekipa_id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         WHERE t.data_planowana::date = $1::date
           ${branchSql}
       ),
       work_actual AS (
         SELECT wl.task_id,
                COUNT(*) FILTER (WHERE wl.start_time IS NOT NULL)::int AS logs_total,
                BOOL_OR(wl.start_time IS NOT NULL) AS has_started,
                BOOL_OR(wl.end_time IS NOT NULL) AS has_finished,
                MIN(wl.start_time) AS first_start,
                MAX(wl.end_time) AS last_finish,
                COALESCE(SUM(
                  CASE
                    WHEN COALESCE(wl.czas_pracy_minuty, 0) > 0 THEN wl.czas_pracy_minuty::numeric
                    WHEN COALESCE(wl.duration_hours, 0) > 0 THEN wl.duration_hours::numeric * 60
                    WHEN wl.start_time IS NOT NULL THEN
                      GREATEST(
                        0,
                        EXTRACT(EPOCH FROM (
                          COALESCE(wl.end_time, LEAST(NOW()::timestamp, ($1::date + INTERVAL '1 day')::timestamp)) - wl.start_time
                        )) / 60.0
                      )
                    ELSE 0
                  END
                ), 0)::numeric AS real_minutes
         FROM work_logs wl
         JOIN planned p ON p.id = wl.task_id
         WHERE (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date = $1::date
            OR wl.start_time IS NULL
         GROUP BY wl.task_id
       )
       SELECT p.*,
              COALESCE(wa.logs_total, 0)::int AS logs_total,
              COALESCE(wa.has_started, false) AS has_started,
              COALESCE(wa.has_finished, false) AS has_finished,
              wa.first_start,
              wa.last_finish,
              COALESCE(wa.real_minutes, 0)::numeric AS real_minutes
       FROM planned p
       LEFT JOIN work_actual wa ON wa.task_id = p.id
       ORDER BY
         CASE p.priorytet WHEN 'Pilny' THEN 0 WHEN 'Wysoki' THEN 1 WHEN 'Normalny' THEN 2 ELSE 3 END,
         p.data_planowana ASC NULLS LAST,
         p.id ASC`,
      params
    );

    const tasks = rows.map((row) => {
      const plannedMinutes = roundedMinutes(row.planned_minutes);
      const realMinutes = roundedMinutes(row.real_minutes);
      return {
        id: row.id,
        numer: row.numer || `ZLE-${String(row.id).padStart(4, '0')}`,
        klient_nazwa: row.klient_nazwa,
        status: row.status,
        priorytet: row.priorytet,
        data_planowana: row.data_planowana,
        ekipa_id: row.ekipa_id,
        ekipa_nazwa: row.ekipa_nazwa,
        oddzial_id: row.oddzial_id,
        oddzial_nazwa: row.oddzial_nazwa,
        planned_minutes: plannedMinutes,
        real_minutes: realMinutes,
        delta_minutes: realMinutes - plannedMinutes,
        has_started: Boolean(row.has_started),
        has_finished: Boolean(row.has_finished),
        logs_total: Number(row.logs_total || 0),
        first_start: row.first_start,
        last_finish: row.last_finish,
        wartosc_planowana: numberValue(row.wartosc_planowana),
        wartosc_rzeczywista: numberValue(row.wartosc_rzeczywista),
      };
    });

    const issueCounts = new Map();
    const annotated = tasks.map((task) => {
      const issue = classifyPlanRealTask(task);
      if (issue) bumpBlocker(issueCounts, issue.key);
      return issue
        ? {
            ...task,
            issue_key: issue.key,
            issue_label: issue.label,
            issue_action: issue.action,
            tone: issue.tone,
            issue_rank: issue.rank,
            action_path: buildPlanRealTaskPath({ ...task, issue_key: issue.key }, date),
          }
        : task;
    });

    const deviations = annotated
      .filter((task) => task.issue_key || Math.abs(task.delta_minutes) >= 30)
      .sort((a, b) => {
        const rankA = a.issue_rank ?? 9;
        const rankB = b.issue_rank ?? 9;
        return rankA - rankB || Math.abs(b.delta_minutes) - Math.abs(a.delta_minutes);
      })
      .slice(0, 8);

    const finishedTasks = tasks.filter((task) => task.status === 'Zakonczone' || task.has_finished);
    const plannedMinutesTotal = tasks.reduce((sum, task) => sum + task.planned_minutes, 0);
    const realMinutesTotal = tasks.reduce((sum, task) => sum + task.real_minutes, 0);

    res.json({
      date,
      oddzial_id: oddzialId,
      summary: {
        planned_tasks: tasks.length,
        started_tasks: tasks.filter((task) => task.has_started).length,
        finished_tasks: finishedTasks.length,
        not_started_tasks: Number(issueCounts.get('not_started') || 0),
        overrun_tasks: Number(issueCounts.get('overrun') || 0),
        missing_finish_tasks: Number(issueCounts.get('missing_finish') || 0),
        missing_duration_tasks: Number(issueCounts.get('missing_duration') || 0),
        planned_minutes: plannedMinutesTotal,
        real_minutes: realMinutesTotal,
        delta_minutes: realMinutesTotal - plannedMinutesTotal,
        value_planned: tasks.reduce((sum, task) => sum + task.wartosc_planowana, 0),
        value_done: finishedTasks.reduce((sum, task) => sum + (task.wartosc_rzeczywista || task.wartosc_planowana), 0),
      },
      issues: Array.from(issueCounts.entries()).map(([key, count]) => ({ key, count })),
      tasks: deviations,
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops plan-vs-real', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/action-insights', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const range = req.query.range === 'today' ? 'today' : 'week';
  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const fromSql = range === 'today' ? '$1::date' : "($1::date - INTERVAL '6 days')";
  const branchSql = oddzialId != null ? 'AND e.oddzial_id = $2' : '';
  const params = oddzialId != null ? [date, oddzialId] : [date];

  try {
    await ensureOpsActionEventsTable();
    const { rows } = await pool.query(
      `SELECT e.id, e.task_id, e.oddzial_id, e.actor_id, e.action_type,
              e.issue_key, e.reason_code, e.delta_minutes, e.planned_minutes,
              e.real_minutes, e.note, e.metadata, e.created_at,
              t.numer, t.klient_nazwa,
              NULLIF(TRIM(CONCAT(COALESCE(u.imie, ''), ' ', COALESCE(u.nazwisko, ''))), '') AS actor_name
       FROM ops_action_events e
       LEFT JOIN tasks t ON t.id = e.task_id
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.created_at >= ${fromSql}
         AND e.created_at < ($1::date + INTERVAL '1 day')
         ${branchSql}
       ORDER BY e.created_at DESC
       LIMIT 500`,
      params
    );

    const total = rows.length;
    const reasonCounts = new Map();
    const issueCounts = new Map();
    const actionCounts = new Map();
    const reasonDelta = new Map();
    const affectedTasks = new Set();
    let deltaSum = 0;
    let deltaCount = 0;

    for (const row of rows) {
      if (row.task_id) affectedTasks.add(Number(row.task_id));
      if (row.action_type) bumpBlocker(actionCounts, row.action_type);
      if (row.issue_key) bumpBlocker(issueCounts, row.issue_key);
      if (row.reason_code) {
        bumpBlocker(reasonCounts, row.reason_code);
        const delta = eventNumber(row.delta_minutes);
        if (delta != null) {
          reasonDelta.set(row.reason_code, (reasonDelta.get(row.reason_code) || 0) + delta);
        }
      }
      const delta = eventNumber(row.delta_minutes);
      if (delta != null) {
        deltaSum += delta;
        deltaCount += 1;
      }
    }

    const reasons = Array.from(reasonCounts.entries())
      .map(([reason_code, count]) => ({
        reason_code,
        label: PLAN_REAL_REASON_LABELS[reason_code] || reason_code,
        count,
        share: total > 0 ? Math.round((count / total) * 100) : 0,
        avg_delta_minutes: count > 0 ? Math.round((reasonDelta.get(reason_code) || 0) / count) : 0,
      }))
      .sort((a, b) => b.count - a.count || Math.abs(b.avg_delta_minutes) - Math.abs(a.avg_delta_minutes));

    const issues = Array.from(issueCounts.entries())
      .map(([issue_key, count]) => ({
        issue_key,
        label: PLAN_REAL_ISSUE_LABELS[issue_key] || issue_key,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const actions = Array.from(actionCounts.entries())
      .map(([action_type, count]) => ({
        action_type,
        label: OPS_ACTION_LABELS[action_type] || action_type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      date,
      range,
      oddzial_id: oddzialId,
      summary: {
        total_events: total,
        affected_tasks: affectedTasks.size,
        reasons_total: rows.filter((row) => row.reason_code).length,
        reminders: Number(actionCounts.get('remind_team') || 0),
        duration_updates: Number(actionCounts.get('set_duration') || 0),
        avg_delta_minutes: deltaCount > 0 ? Math.round(deltaSum / deltaCount) : 0,
        top_reason: reasons[0] || null,
      },
      reasons,
      issues,
      actions,
      recent: rows
        .filter((row) => row.action_type !== 'recommendation_feedback')
        .slice(0, 8)
        .map((row) => ({
          id: row.id,
          task_id: row.task_id,
          numer: row.numer || (row.task_id ? `#${row.task_id}` : '-'),
          klient_nazwa: row.klient_nazwa,
          action_type: row.action_type,
          action_label: OPS_ACTION_LABELS[row.action_type] || row.action_type,
          issue_key: row.issue_key,
          issue_label: PLAN_REAL_ISSUE_LABELS[row.issue_key] || row.issue_key,
          reason_code: row.reason_code,
          reason_label: PLAN_REAL_REASON_LABELS[row.reason_code] || row.reason_code,
          delta_minutes: eventNumber(row.delta_minutes),
          actor_name: row.actor_name,
          created_at: row.created_at,
        })),
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops action-insights', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/owner-alerts/open', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const riskTypeFilter = cleanText(req.query.risk_type, 60);
  const allowedRiskTypes = new Set(['kommo_sync', 'sms_delivery']);
  const activeRiskTypes = allowedRiskTypes.has(riskTypeFilter) ? [riskTypeFilter] : ['kommo_sync', 'sms_delivery'];
  const branchSql = oddzialId != null ? 'AND t.oddzial_id = $2' : '';
  const eventBranchSql = oddzialId != null ? 'AND e.oddzial_id = $2' : '';
  const params = oddzialId != null ? [date, oddzialId] : [date];

  try {
    await ensureOpsActionEventsTable();
    const [smsResult, kommoResult, ackResult] = await Promise.all([
      activeRiskTypes.includes('sms_delivery') ? pool.query(
        `/* ops.open_owner_sms_alerts */
         SELECT h.id, h.task_id, h.telefon, h.status, h.provider_status, h.delivery_error_code,
                h.created_at AS alert_at, t.numer, t.klient_nazwa, t.oddzial_id, b.nazwa AS oddzial_nazwa
         FROM sms_history h
         LEFT JOIN tasks t ON t.id = h.task_id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         WHERE h.created_at >= $1::date
           AND h.created_at < $1::date + INTERVAL '1 day'
           ${branchSql}
           AND (
             h.delivery_error_code IS NOT NULL
             OR LOWER(COALESCE(h.status, '')) LIKE 'blad%'
             OR LOWER(COALESCE(h.provider_status, '')) IN ('failed', 'undelivered', 'rejected', 'denied', 'error')
             OR (
               h.provider_status IS NULL
               AND h.created_at < NOW() - INTERVAL '30 minutes'
               AND LOWER(COALESCE(h.status, '')) NOT IN ('dostarczony', 'delivered')
             )
           )
         ORDER BY h.created_at ASC
         LIMIT 100`,
        params
      ) : Promise.resolve({ rows: [] }),
      activeRiskTypes.includes('kommo_sync') ? pool.query(
        `/* ops.open_owner_kommo_alerts */
         SELECT q.id, q.task_id, q.event, q.status, q.retry_count, q.last_error,
                COALESCE(q.updated_at, q.created_at, q.next_retry_at) AS alert_at,
                t.numer, t.klient_nazwa, t.oddzial_id, b.nazwa AS oddzial_nazwa
         FROM task_kommo_sync_queue q
         LEFT JOIN tasks t ON t.id = q.task_id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         WHERE q.status IN ('failed', 'dead_letter')
           AND COALESCE(q.updated_at, q.created_at, q.next_retry_at) >= $1::date
           AND COALESCE(q.updated_at, q.created_at, q.next_retry_at) < $1::date + INTERVAL '1 day'
           ${branchSql}
         ORDER BY CASE q.status WHEN 'dead_letter' THEN 0 ELSE 1 END, alert_at ASC NULLS LAST
         LIMIT 100`,
        params
      ) : Promise.resolve({ rows: [] }),
      pool.query(
        `/* ops.owner_alert_acknowledgements */
         SELECT e.task_id,
                e.issue_key,
                COALESCE(e.metadata->>'risk_type', e.issue_key, 'risk_report') AS risk_type,
                e.metadata->>'risk_id' AS risk_id,
                MAX(e.created_at) AS acknowledged_at
         FROM ops_action_events e
         WHERE e.created_at >= $1::date
           AND e.created_at < $1::date + INTERVAL '1 day'
           ${eventBranchSql}
           AND e.action_type = 'risk_acknowledge'
           AND COALESCE(e.metadata->>'risk_type', e.issue_key, '') = ANY($${params.length + 1}::text[])
         GROUP BY e.task_id, e.issue_key, COALESCE(e.metadata->>'risk_type', e.issue_key, 'risk_report'), e.metadata->>'risk_id'`,
        [...params, activeRiskTypes]
      ),
    ]);

    const acknowledged = new Map();
    for (const row of ackResult.rows || []) {
      for (const key of ownerAlertAckKeys(row.risk_type, row.risk_id, row.task_id)) {
        acknowledged.set(key, row.acknowledged_at);
      }
    }

    const items = [];
    for (const row of kommoResult.rows || []) {
      const riskType = 'kommo_sync';
      const riskId = `kommo_sync:${row.id || row.task_id}`;
      const ackKeys = ownerAlertAckKeys(riskType, riskId, row.task_id);
      if (ackKeys.some((key) => acknowledged.has(key))) continue;
      const owner = riskOwner(riskType);
      const severity = String(row.status || '').toLowerCase() === 'dead_letter' ? 'critical' : 'warning';
      items.push({
        id: riskId,
        risk_id: riskId,
        risk_type: riskType,
        type: riskType,
        source: 'kommo',
        severity,
        status: row.status || 'failed',
        task_id: row.task_id || null,
        numer: row.numer || null,
        klient_nazwa: row.klient_nazwa || null,
        oddzial_id: row.oddzial_id || oddzialId || null,
        oddzial_nazwa: row.oddzial_nazwa || null,
        title: `Kommo ${row.status || 'failed'}: ${row.numer || `#${row.task_id || row.id}`}`,
        detail: `${row.event || 'task.sync'} / proby: ${Number(row.retry_count || 0)}${row.last_error ? ` / ${String(row.last_error).slice(0, 120)}` : ''}`,
        alert_at: row.alert_at,
        owner_role: owner.owner_role,
        owner_label: owner.owner_label,
        escalation: owner.escalation,
        action_path: row.task_id ? `/zlecenia/${row.task_id}?tab=integracje` : '/integracje',
        ...ownerAlertSla(riskType, severity, row.alert_at),
      });
    }

    for (const row of smsResult.rows || []) {
      const riskType = 'sms_delivery';
      const riskId = `sms_delivery:${row.id}`;
      const ackKeys = ownerAlertAckKeys(riskType, riskId, row.task_id);
      if (ackKeys.some((key) => acknowledged.has(key))) continue;
      const owner = riskOwner(riskType);
      const severity = String(row.status || '').toLowerCase().includes('blad') || row.delivery_error_code ? 'critical' : 'warning';
      items.push({
        id: riskId,
        risk_id: riskId,
        risk_type: riskType,
        type: riskType,
        source: 'sms',
        severity,
        status: row.provider_status || row.status || 'pending',
        task_id: row.task_id || null,
        numer: row.numer || null,
        klient_nazwa: row.klient_nazwa || null,
        oddzial_id: row.oddzial_id || oddzialId || null,
        oddzial_nazwa: row.oddzial_nazwa || null,
        title: `SMS delivery: ${row.numer || `#${row.task_id || row.id}`}`,
        detail: `${row.telefon || 'brak numeru'} / ${row.provider_status || row.status || 'brak statusu'}${row.delivery_error_code ? ` / ${row.delivery_error_code}` : ''}`,
        alert_at: row.alert_at,
        owner_role: owner.owner_role,
        owner_label: owner.owner_label,
        escalation: owner.escalation,
        action_path: row.task_id ? `/zlecenia/${row.task_id}` : '/telefonia',
        ...ownerAlertSla(riskType, severity, row.alert_at),
      });
    }

    const sorted = items.sort((a, b) => {
      const levelRank = { P1: 0, P2: 1, watch: 2 };
      return (levelRank[a.escalation_level] ?? 9) - (levelRank[b.escalation_level] ?? 9)
        || (b.aging_minutes || 0) - (a.aging_minutes || 0);
    });
    const summary = {
      open_total: sorted.length,
      kommo_sync: sorted.filter((item) => item.risk_type === 'kommo_sync').length,
      sms_delivery: sorted.filter((item) => item.risk_type === 'sms_delivery').length,
      p1: sorted.filter((item) => item.escalation_level === 'P1').length,
      p2: sorted.filter((item) => item.escalation_level === 'P2').length,
      overdue: sorted.filter((item) => item.sla_status === 'overdue').length,
      acknowledged_total: ackResult.rows.length,
    };

    return res.json({
      date,
      oddzial_id: oddzialId,
      filters: { risk_type: riskTypeFilter || '' },
      summary,
      items: sorted.slice(0, 100),
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops owner-alerts open', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.post('/owner-alerts/actions', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const action = cleanText(req.body?.action, 50);
  const allowedActions = new Set(['acknowledge', 'escalate', 'bulk_acknowledge', 'bulk_escalate']);
  if (!allowedActions.has(action)) {
    return res.status(400).json({ error: 'Nieznana akcja owner alerts.' });
  }
  const isEscalation = action === 'escalate' || action === 'bulk_escalate';
  const normalizedBulkAction = isEscalation ? 'bulk_escalate' : 'bulk_acknowledge';

  const rawItems = Array.isArray(req.body?.items)
    ? req.body.items
    : (Array.isArray(req.body?.alerts) ? req.body.alerts : []);
  const items = rawItems
    .map((item) => ({
      risk_id: cleanText(item?.risk_id, 120),
      risk_type: cleanText(item?.risk_type || item?.type, 60),
      task_id: Number(item?.task_id || 0),
      escalation: cleanText(item?.escalation || item?.escalation_level, 20),
      sla_status: cleanText(item?.sla_status, 20),
    }))
    .filter((item) => item.risk_id && ['kommo_sync', 'sms_delivery'].includes(item.risk_type))
    .slice(0, 50);
  if (!items.length) {
    return res.status(400).json({ error: 'Brak prawidlowych alertow do zapisania.' });
  }

  const noteText = cleanText(req.body?.note, 800);

  try {
    await ensureOpsActionEventsTable();
    const results = [];
    for (const item of items) {
      let task = null;
      if (Number.isInteger(item.task_id) && item.task_id > 0) {
        const resolved = await getRiskTask(item.task_id, req.user);
        if (resolved.error) {
          results.push({ risk_id: item.risk_id, ok: false, error: resolved.error.message });
          continue;
        }
        task = resolved.task;
      } else if (!isDyrektorOrAdmin(req.user)) {
        results.push({ risk_id: item.risk_id, ok: false, error: 'Akcja bez task_id wymaga roli centralnej.' });
        continue;
      }

      const owner = riskOwner(item.risk_type);
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: isEscalation ? 'risk_owner_escalate' : 'risk_acknowledge',
        issueKey: item.risk_type,
        note: noteText || (!isEscalation
          ? `Masowo potwierdzono alert ownera ${item.risk_id}`
          : `Masowo eskalowano alert ownera ${item.risk_id}`),
        metadata: {
          risk_id: item.risk_id,
          risk_type: item.risk_type,
          owner_label: owner.owner_label,
          owner_role: owner.owner_role,
          escalation: owner.escalation || null,
          escalation_level: item.escalation || null,
          sla_status: item.sla_status || null,
          bulk_action: normalizedBulkAction,
          requested_action: action,
          bulk_owner_action: true,
        },
      });
      results.push({ risk_id: item.risk_id, ok: true, event_id: event?.id || null });
    }

    return res.json({
      message: !isEscalation ? 'Alerty ownerow potwierdzone' : 'Alerty ownerow eskalowane',
      action,
      normalized_action: normalizedBulkAction,
      requested: items.length,
      processed: results.filter((item) => item.ok).length,
      saved: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      failed_items: results.filter((item) => !item.ok),
      results,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops owner-alerts actions', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

function ownerRemediationDailyLimit() {
  const raw = Number(env.OPS_OWNER_REMEDIATION_DAILY_LIMIT || 3);
  return Number.isFinite(raw) && raw > 0 ? Math.min(20, Math.floor(raw)) : 3;
}

async function findOwnerEscalation({ riskId, riskType, user }) {
  const branchSql = isDyrektorOrAdmin(user) ? '' : 'AND e.oddzial_id = $3';
  const params = isDyrektorOrAdmin(user)
    ? [riskId, riskType]
    : [riskId, riskType, user.oddzial_id || null];
  const result = await pool.query(
    `SELECT e.id, e.created_at, e.actor_id
     FROM ops_action_events e
     WHERE e.action_type = 'risk_owner_escalate'
       AND e.metadata->>'risk_id' = $1
       AND COALESCE(e.metadata->>'risk_type', e.issue_key, '') = $2
       AND e.created_at >= CURRENT_DATE
       ${branchSql}
     ORDER BY e.created_at DESC
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function countOwnerRemediations({ riskId, riskType, user }) {
  const branchSql = isDyrektorOrAdmin(user) ? '' : 'AND e.oddzial_id = $3';
  const params = isDyrektorOrAdmin(user)
    ? [riskId, riskType]
    : [riskId, riskType, user.oddzial_id || null];
  const result = await pool.query(
    `SELECT COUNT(*)::int AS used
     FROM ops_action_events e
     WHERE e.action_type = 'risk_owner_auto_remediate'
       AND e.metadata->>'risk_id' = $1
       AND COALESCE(e.metadata->>'risk_type', e.issue_key, '') = $2
       AND e.created_at >= CURRENT_DATE
       ${branchSql}`,
    params
  );
  return Number(result.rows[0]?.used || 0);
}

router.post('/owner-alerts/remediation', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const action = cleanText(req.body?.action, 50);
  const allowedActions = new Set(['retry_kommo', 'resend_sms']);
  if (!allowedActions.has(action)) {
    return res.status(400).json({ error: 'Nieznana auto-remediacja owner alert.' });
  }

  const riskId = cleanText(req.body?.risk_id, 120);
  const riskType = cleanText(req.body?.risk_type || req.body?.type, 60);
  const taskId = Number(req.body?.task_id || 0);
  const noteText = cleanText(req.body?.note, 800);
  if (!riskId || !['kommo_sync', 'sms_delivery'].includes(riskType)) {
    return res.status(400).json({ error: 'Auto-remediacja wymaga risk_id i risk_type Kommo/SMS.' });
  }
  if ((action === 'retry_kommo' && riskType !== 'kommo_sync') || (action === 'resend_sms' && riskType !== 'sms_delivery')) {
    return res.status(400).json({ error: 'Akcja auto-remediacji nie pasuje do typu ryzyka.' });
  }

  try {
    await ensureOpsActionEventsTable();
    const escalation = await findOwnerEscalation({ riskId, riskType, user: req.user });
    if (!escalation) {
      return res.status(409).json({ error: 'Auto-remediacja wymaga jawnej eskalacji ownera z dzisiaj.' });
    }

    const dailyLimit = ownerRemediationDailyLimit();
    const usedToday = await countOwnerRemediations({ riskId, riskType, user: req.user });
    let task = null;
    if (Number.isInteger(taskId) && taskId > 0) {
      const resolved = await getRiskTask(taskId, req.user);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      task = resolved.task;
    }
    if (usedToday >= dailyLimit) {
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: 'risk_owner_remediation_blocked',
        issueKey: riskType,
        note: noteText || `Zablokowano auto-remediacje limitem dziennym: ${riskId}`,
        metadata: {
          risk_id: riskId,
          risk_type: riskType,
          remediation_action: action,
          escalation_event_id: escalation.id,
          block_reason: 'daily_limit',
          daily_limit: dailyLimit,
          used_before: usedToday,
        },
      });
      return res.status(429).json({
        error: 'Dzienny limit auto-remediacji dla tego alertu zostal wykorzystany.',
        limit: dailyLimit,
        used: usedToday,
        event,
      });
    }

    if (action === 'retry_kommo') {
      const queueId = Number(riskId.match(/^kommo_sync:(\d+)$/)?.[1] || 0) || null;
      const retry = await pool.query(
        `UPDATE task_kommo_sync_queue
         SET status = 'failed',
             next_retry_at = NOW(),
             updated_at = NOW()
         WHERE status IN ('failed', 'dead_letter')
           AND (
             ($1::int IS NOT NULL AND id = $1)
             OR ($2::int IS NOT NULL AND task_id = $2)
           )
         RETURNING id, task_id, status, retry_count, next_retry_at`,
        [queueId, task?.id || null]
      );
      if (!retry.rows.length) {
        return res.status(404).json({ error: 'Nie znaleziono kolejki Kommo do odblokowania retry.' });
      }
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: 'risk_owner_auto_remediate',
        issueKey: riskType,
        note: noteText || `Odblokowano retry Kommo po eskalacji ownera: ${riskId}`,
        metadata: {
          risk_id: riskId,
          risk_type: riskType,
          remediation_action: action,
          escalation_event_id: escalation.id,
          queue_id: retry.rows[0].id,
          daily_limit: dailyLimit,
          used_before: usedToday,
        },
      });
      return res.status(202).json({
        message: 'Retry Kommo odblokowane po eskalacji ownera',
        action,
        remediation: retry.rows[0],
        event,
        limit: dailyLimit,
        used: usedToday + 1,
        requestId: req.requestId,
      });
    }

    if (!task) return res.status(400).json({ error: 'Ponowienie SMS wymaga task_id.' });
    if (!truthyText(task.klient_telefon)) {
      return res.status(409).json({ error: 'Zlecenie nie ma telefonu klienta.' });
    }
    const smsHistoryId = Number(riskId.match(/^sms_delivery:(\d+)$/)?.[1] || 0) || null;
    let smsText = '';
    if (smsHistoryId) {
      const smsResult = await pool.query(
        `SELECT h.id, h.tresc, h.task_id
         FROM sms_history h
         LEFT JOIN tasks t ON t.id = h.task_id
         WHERE h.id = $1
           AND ($2::int IS NULL OR h.task_id = $2)
           AND ($3::int IS NULL OR t.oddzial_id = $3)
         ORDER BY h.created_at DESC
         LIMIT 1`,
        [smsHistoryId, task.id, isDyrektorOrAdmin(req.user) ? null : req.user.oddzial_id]
      );
      smsText = cleanText(smsResult.rows[0]?.tresc, 640);
    }
    if (!smsText) {
      smsText = `ARBOR: ponawiamy wiadomosc dotyczaca zlecenia ${task.numer || `#${task.id}`}. Prosimy o kontakt w sprawie terminu.`;
    }
    const sms = await sendSmsGateway({
      to: task.klient_telefon,
      body: smsText,
      taskId: task.id,
      oddzialId: task.oddzial_id,
    });
    const event = await recordOpsActionEvent({
      task,
      user: req.user,
      actionType: 'risk_owner_auto_remediate',
      issueKey: riskType,
      note: noteText || `Ponowiono SMS po eskalacji ownera: ${riskId}`,
      metadata: {
        risk_id: riskId,
        risk_type: riskType,
        remediation_action: action,
        escalation_event_id: escalation.id,
        provider: sms.provider || null,
        sid: sms.sid || sms.id || sms.message_id || null,
        ok: Boolean(sms.ok),
        error: sms.error || null,
        daily_limit: dailyLimit,
        used_before: usedToday,
      },
    });
    return res.status(sms.ok ? 200 : 502).json({
      message: sms.ok ? 'SMS ponowiony po eskalacji ownera' : 'Nie udalo sie ponowic SMS po eskalacji ownera',
      action,
      sms,
      event,
      limit: dailyLimit,
      used: usedToday + 1,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops owner-alerts remediation', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.post('/owner-alerts/resolve', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const riskId = cleanText(req.body?.risk_id, 120);
  const riskType = cleanText(req.body?.risk_type || req.body?.type, 60);
  const taskId = Number(req.body?.task_id || 0);
  const noteText = cleanText(req.body?.note, 800);
  const source = cleanText(req.body?.source, 60) || 'control';
  const allowedRiskTypes = new Set(['kommo_sync', 'sms_delivery']);
  if (!riskId || !allowedRiskTypes.has(riskType)) {
    return res.status(400).json({ error: 'Zamkniecie alertu ownera wymaga risk_id i risk_type Kommo/SMS.' });
  }

  try {
    await ensureOpsActionEventsTable();
    let task = null;
    const requestedOddzial = req.body?.oddzial_id ? Number(req.body.oddzial_id) : null;
    const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
    if (Number.isInteger(taskId) && taskId > 0) {
      const resolved = await getRiskTask(taskId, req.user);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      task = resolved.task;
    } else if (!isDyrektorOrAdmin(req.user)) {
      return res.status(403).json({ error: 'Zamkniecie alertu bez task_id wymaga roli centralnej.' });
    }

    const owner = riskOwner(riskType);
    const event = await recordOpsActionEvent({
      task: task || { oddzial_id: oddzialId },
      user: req.user,
      actionType: 'risk_owner_resolve',
      issueKey: riskType,
      note: noteText || `Oznaczono alert ownera jako rozwiazany: ${riskId}`,
      metadata: {
        risk_id: riskId,
        risk_type: riskType,
        owner_label: owner.owner_label,
        owner_role: owner.owner_role,
        source,
        follow_up: true,
        resolution_status: 'resolved',
        resolution_source: source,
      },
    });

    await req.auditLog?.({
      action: 'ops.owner_alert.resolve',
      entity: 'ops_owner_alert',
      entity_id: riskId,
      details: { risk_id: riskId, risk_type: riskType, task_id: task?.id || null, oddzial_id: task?.oddzial_id || oddzialId || null, source },
    });

    return res.json({
      message: 'Alert ownera oznaczony jako rozwiazany',
      resolved: {
        risk_id: riskId,
        risk_type: riskType,
        task_id: task?.id || null,
        oddzial_id: task?.oddzial_id || oddzialId || null,
        source,
      },
      event,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops owner-alerts resolve', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/owner-alerts/remediation-report', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }
  const range = req.query.range === 'today' ? 'today' : 'week';
  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const fromSql = range === 'today' ? '$1::date' : "($1::date - INTERVAL '6 days')";
  const branchSql = oddzialId != null ? 'AND e.oddzial_id = $2' : '';
  const params = oddzialId != null ? [date, oddzialId] : [date];
  try {
    await ensureOpsActionEventsTable();
    const { rows } = await pool.query(
      `SELECT e.id, e.task_id, e.oddzial_id, e.action_type, e.issue_key, e.note,
              e.metadata, e.created_at, t.numer, t.klient_nazwa, b.nazwa AS oddzial_nazwa
       FROM ops_action_events e
       LEFT JOIN tasks t ON t.id = e.task_id
       LEFT JOIN branches b ON b.id = e.oddzial_id
       WHERE e.created_at >= ${fromSql}
         AND e.created_at < $1::date + INTERVAL '1 day'
         ${branchSql}
         AND e.action_type IN ('risk_owner_auto_remediate', 'risk_owner_remediation_blocked')
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 80`,
      params
    );
    const items = rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return {
        id: row.id,
        task_id: row.task_id,
        numer: row.numer,
        klient_nazwa: row.klient_nazwa,
        oddzial_id: row.oddzial_id,
        oddzial_nazwa: row.oddzial_nazwa,
        action_type: row.action_type,
        risk_type: metadata.risk_type || row.issue_key,
        risk_id: metadata.risk_id || null,
        remediation_action: metadata.remediation_action || null,
        success: row.action_type === 'risk_owner_auto_remediate' && metadata.ok !== false,
        blocked: row.action_type === 'risk_owner_remediation_blocked',
        block_reason: metadata.block_reason || null,
        daily_limit: metadata.daily_limit || null,
        used_before: metadata.used_before || null,
        created_at: row.created_at,
        note: row.note,
      };
    });
    const summary = {
      total: items.length,
      retry_kommo: items.filter((item) => item.remediation_action === 'retry_kommo').length,
      resend_sms: items.filter((item) => item.remediation_action === 'resend_sms').length,
      success: items.filter((item) => item.success).length,
      failed: items.filter((item) => item.action_type === 'risk_owner_auto_remediate' && item.success === false).length,
      limit_blocks: items.filter((item) => item.block_reason === 'daily_limit').length,
      blocked: items.filter((item) => item.blocked).length,
    };
    return res.json({
      date,
      range,
      oddzial_id: oddzialId,
      summary,
      items,
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops owner-alerts remediation-report', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/action-history', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const range = req.query.range === 'today' ? 'today' : 'week';
  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const format = cleanText(req.query.format, 20).toLowerCase();
  const maxLimit = format === 'csv' ? 1000 : 100;
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit || (format === 'csv' ? 1000 : 30))));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const actionType = cleanText(req.query.action_type, 60);
  const issueKey = cleanText(req.query.issue_key, 60);
  const riskType = cleanText(req.query.risk_type, 60);
  const taskId = Number(req.query.task_id || 0);
  const search = cleanText(req.query.q, 120);
  const alertSource = cleanText(req.query.alert_source, 20).toLowerCase();
  const alertRiskTypes = ALERT_SOURCE_FILTERS[alertSource] || [];

  const filters = [];
  const params = [date];
  const fromSql = range === 'today' ? '$1::date' : "($1::date - INTERVAL '6 days')";
  if (oddzialId != null) {
    params.push(oddzialId);
    filters.push(`e.oddzial_id = $${params.length}`);
  }
  if (actionType) {
    params.push(actionType);
    filters.push(`e.action_type = $${params.length}`);
  }
  if (issueKey) {
    params.push(issueKey);
    filters.push(`e.issue_key = $${params.length}`);
  }
  if (riskType) {
    params.push(riskType);
    filters.push(`COALESCE(e.metadata->>'risk_type', e.issue_key, '') = $${params.length}`);
  }
  if (Number.isInteger(taskId) && taskId > 0) {
    params.push(taskId);
    filters.push(`e.task_id = $${params.length}`);
  }
  if (alertRiskTypes.length) {
    params.push(alertRiskTypes);
    filters.push(`COALESCE(e.metadata->>'risk_type', e.issue_key, '') = ANY($${params.length}::text[])`);
  }
  if (search) {
    params.push(`%${search.replace(/[%_]/g, '\\$&')}%`);
    filters.push(`(
      COALESCE(t.numer, '') ILIKE $${params.length} ESCAPE E'\\\\'
      OR COALESCE(t.klient_nazwa, '') ILIKE $${params.length} ESCAPE E'\\\\'
      OR COALESCE(e.note, '') ILIKE $${params.length} ESCAPE E'\\\\'
      OR COALESCE(e.metadata::text, '') ILIKE $${params.length} ESCAPE E'\\\\'
    )`);
  }

  const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  try {
    await ensureOpsActionEventsTable();
    const [countResult, rowsResult, actionResult, issueResult, acknowledgementResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ops_action_events e
         LEFT JOIN tasks t ON t.id = e.task_id
         WHERE e.created_at >= ${fromSql}
           AND e.created_at < ($1::date + INTERVAL '1 day')
           ${whereExtra}`,
        params
      ),
      pool.query(
        `SELECT e.id, e.task_id, e.oddzial_id, e.actor_id, e.action_type,
                e.issue_key, e.reason_code, e.delta_minutes, e.planned_minutes,
                e.real_minutes, e.note, e.metadata, e.created_at,
                t.numer, t.klient_nazwa,
                b.nazwa AS oddzial_nazwa,
                NULLIF(TRIM(CONCAT(COALESCE(u.imie, ''), ' ', COALESCE(u.nazwisko, ''))), '') AS actor_name
         FROM ops_action_events e
         LEFT JOIN tasks t ON t.id = e.task_id
         LEFT JOIN branches b ON b.id = e.oddzial_id
         LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.created_at >= ${fromSql}
           AND e.created_at < ($1::date + INTERVAL '1 day')
           ${whereExtra}
         ORDER BY e.created_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT e.action_type, COUNT(*)::int AS count
         FROM ops_action_events e
         LEFT JOIN tasks t ON t.id = e.task_id
         WHERE e.created_at >= ${fromSql}
           AND e.created_at < ($1::date + INTERVAL '1 day')
           ${whereExtra}
         GROUP BY e.action_type
         ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT e.issue_key, COUNT(*)::int AS count
         FROM ops_action_events e
         LEFT JOIN tasks t ON t.id = e.task_id
         WHERE e.created_at >= ${fromSql}
           AND e.created_at < ($1::date + INTERVAL '1 day')
           ${whereExtra}
           AND e.issue_key IS NOT NULL
         GROUP BY e.issue_key
         ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT COALESCE(e.metadata->>'risk_type', e.issue_key, 'risk_report') AS risk_type,
                COUNT(*)::int AS count,
                MAX(e.created_at) AS last_ack_at
         FROM ops_action_events e
         LEFT JOIN tasks t ON t.id = e.task_id
         WHERE e.created_at >= ${fromSql}
           AND e.created_at < ($1::date + INTERVAL '1 day')
           ${whereExtra}
           AND e.action_type = 'risk_acknowledge'
         GROUP BY COALESCE(e.metadata->>'risk_type', e.issue_key, 'risk_report')
         ORDER BY count DESC`,
        params
      ),
    ]);

    const items = rowsResult.rows.map((row) => {
      const metadata = safeMetadata(row.metadata);
      return {
        id: row.id,
        task_id: row.task_id,
        numer: row.numer || (row.task_id ? `#${row.task_id}` : '-'),
        klient_nazwa: row.klient_nazwa,
        oddzial_id: row.oddzial_id,
        oddzial_nazwa: row.oddzial_nazwa,
        actor_id: row.actor_id,
        actor_name: row.actor_name || (row.actor_id ? `#${row.actor_id}` : '-'),
        action_type: row.action_type,
        action_label: OPS_ACTION_LABELS[row.action_type] || row.action_type,
        issue_key: row.issue_key,
        issue_label: PLAN_REAL_ISSUE_LABELS[row.issue_key] || row.issue_key,
        reason_code: row.reason_code,
        reason_label: PLAN_REAL_REASON_LABELS[row.reason_code] || row.reason_code,
        delta_minutes: eventNumber(row.delta_minutes),
        planned_minutes: eventNumber(row.planned_minutes),
        real_minutes: eventNumber(row.real_minutes),
        note: row.note,
        metadata,
        risk_id: metadata.risk_id || null,
        risk_type: metadata.risk_type || row.issue_key || null,
        owner_label: row.action_type === 'risk_acknowledge'
          ? riskOwner(metadata.risk_type || row.issue_key || null).owner_label
          : null,
        owner_ack_status: row.action_type === 'risk_acknowledge' ? 'Domkniete w kontroli' : null,
        outcome: decisionOutcome(row),
        created_at: row.created_at,
        action_path: row.task_id ? `/zlecenia/${row.task_id}` : '/kierownik',
      };
    });

    if (format === 'csv') {
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="arbor-decyzje-operacyjne-${stamp}.csv"`);
      return res.status(200).send(actionHistoryCsv(items));
    }

    return res.json({
      date,
      range,
      oddzial_id: oddzialId,
      filters: {
        action_type: actionType || null,
        issue_key: issueKey || null,
        risk_type: riskType || null,
        alert_source: alertRiskTypes.length ? alertSource : null,
        task_id: Number.isInteger(taskId) && taskId > 0 ? taskId : null,
        q: search || null,
        format: format || null,
      },
      total: countResult.rows[0]?.total || 0,
      limit,
      offset,
      items,
      summary: {
        actions: actionResult.rows.map((row) => ({
          action_type: row.action_type,
          label: OPS_ACTION_LABELS[row.action_type] || row.action_type,
          count: Number(row.count || 0),
        })),
        issues: issueResult.rows.map((row) => ({
          issue_key: row.issue_key,
          label: PLAN_REAL_ISSUE_LABELS[row.issue_key] || row.issue_key,
          count: Number(row.count || 0),
        })),
        acknowledgements: acknowledgementResult.rows.map((row) => ({
          risk_type: row.risk_type,
          owner_label: riskOwner(row.risk_type).owner_label,
          count: Number(row.count || 0),
          last_ack_at: row.last_ack_at,
        })),
      },
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops action-history', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/action-recommendations', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const branchSql = oddzialId != null ? 'AND t.oddzial_id = $2' : '';
  const eventBranchSql = oddzialId != null ? 'AND e.oddzial_id = $2' : '';
  const params = oddzialId != null ? [date, oddzialId] : [date];

  try {
    await ensureOpsActionEventsTable();
    const [tasksResult, eventsResult, feedbackResult] = await Promise.all([
      pool.query(
        `WITH planned AS (
           SELECT t.id, t.numer, t.klient_nazwa, t.klient_telefon, t.adres, t.miasto,
                  t.status, t.priorytet, t.data_planowana, t.ekipa_id, t.oddzial_id,
                  t.pin_lat, t.pin_lng, t.czas_planowany_godziny, t.czas_obslugi_min,
                  t.wartosc_planowana, t.wartosc_rzeczywista,
                  e.nazwa AS ekipa_nazwa,
                  b.nazwa AS oddzial_nazwa,
                  COALESCE(oi.open_issues, 0)::int AS open_issues,
                  CASE
                    WHEN COALESCE(t.czas_obslugi_min, 0) > 0 THEN t.czas_obslugi_min::numeric
                    WHEN COALESCE(t.czas_planowany_godziny, 0) > 0 THEN ROUND(t.czas_planowany_godziny::numeric * 60)
                    ELSE 0
                  END AS planned_minutes
           FROM tasks t
           LEFT JOIN teams e ON e.id = t.ekipa_id
           LEFT JOIN branches b ON b.id = t.oddzial_id
           LEFT JOIN (
             SELECT task_id, COUNT(*)::int AS open_issues
             FROM issues
             WHERE LOWER(COALESCE(status, '')) NOT LIKE 'rozwi%'
               AND LOWER(COALESCE(status, '')) NOT LIKE 'zamk%'
             GROUP BY task_id
           ) oi ON oi.task_id = t.id
           WHERE t.data_planowana::date = $1::date
             ${branchSql}
         ),
         work_actual AS (
           SELECT wl.task_id,
                  COUNT(*) FILTER (WHERE wl.start_time IS NOT NULL)::int AS logs_total,
                  BOOL_OR(wl.start_time IS NOT NULL) AS has_started,
                  BOOL_OR(wl.end_time IS NOT NULL) AS has_finished,
                  COALESCE(SUM(
                    CASE
                      WHEN COALESCE(wl.czas_pracy_minuty, 0) > 0 THEN wl.czas_pracy_minuty::numeric
                      WHEN COALESCE(wl.duration_hours, 0) > 0 THEN wl.duration_hours::numeric * 60
                      WHEN wl.start_time IS NOT NULL THEN
                        GREATEST(
                          0,
                          EXTRACT(EPOCH FROM (
                            COALESCE(wl.end_time, LEAST(NOW()::timestamp, ($1::date + INTERVAL '1 day')::timestamp)) - wl.start_time
                          )) / 60.0
                        )
                      ELSE 0
                    END
                  ), 0)::numeric AS real_minutes
           FROM work_logs wl
           JOIN planned p ON p.id = wl.task_id
           WHERE (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date = $1::date
              OR wl.start_time IS NULL
           GROUP BY wl.task_id
         )
         SELECT p.*,
                COALESCE(wa.logs_total, 0)::int AS logs_total,
                COALESCE(wa.has_started, false) AS has_started,
                COALESCE(wa.has_finished, false) AS has_finished,
                COALESCE(wa.real_minutes, 0)::numeric AS real_minutes
         FROM planned p
         LEFT JOIN work_actual wa ON wa.task_id = p.id
         ORDER BY
           CASE p.priorytet WHEN 'Pilny' THEN 0 WHEN 'Wysoki' THEN 1 WHEN 'Normalny' THEN 2 ELSE 3 END,
           p.data_planowana ASC NULLS LAST,
           p.id ASC`,
        params
      ),
      pool.query(
        `SELECT e.action_type, e.issue_key, e.reason_code,
                COUNT(*)::int AS count,
                ROUND(AVG(e.delta_minutes))::int AS avg_delta_minutes
         FROM ops_action_events e
         WHERE e.created_at >= ($1::date - INTERVAL '6 days')
           AND e.created_at < ($1::date + INTERVAL '1 day')
           ${eventBranchSql}
         GROUP BY e.action_type, e.issue_key, e.reason_code
         ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT DISTINCT ON (metadata->>'recommendation_id')
                metadata->>'recommendation_id' AS recommendation_id,
                metadata->>'decision' AS decision,
                metadata->>'source' AS source,
                created_at
         FROM ops_action_events e
         WHERE e.created_at >= $1::date
           AND e.created_at < ($1::date + INTERVAL '1 day')
           AND e.action_type = 'recommendation_feedback'
           AND NULLIF(metadata->>'recommendation_id', '') IS NOT NULL
           ${eventBranchSql}
         ORDER BY metadata->>'recommendation_id', e.created_at DESC`,
        params
      ),
    ]);

    const tasks = tasksResult.rows.map((row) => {
      const plannedMinutes = roundedMinutes(row.planned_minutes);
      const realMinutes = roundedMinutes(row.real_minutes);
      const task = {
        id: row.id,
        numer: row.numer || `ZLE-${String(row.id).padStart(4, '0')}`,
        klient_nazwa: row.klient_nazwa,
        klient_telefon: row.klient_telefon,
        adres: row.adres,
        miasto: row.miasto,
        status: row.status,
        priorytet: row.priorytet,
        data_planowana: row.data_planowana,
        ekipa_id: row.ekipa_id,
        ekipa_nazwa: row.ekipa_nazwa,
        oddzial_id: row.oddzial_id,
        oddzial_nazwa: row.oddzial_nazwa,
        pin_lat: row.pin_lat,
        pin_lng: row.pin_lng,
        czas_planowany_godziny: row.czas_planowany_godziny,
        czas_obslugi_min: row.czas_obslugi_min,
        open_issues: Number(row.open_issues || 0),
        planned_minutes: plannedMinutes,
        real_minutes: realMinutes,
        delta_minutes: realMinutes - plannedMinutes,
        has_started: Boolean(row.has_started),
        has_finished: Boolean(row.has_finished),
        logs_total: Number(row.logs_total || 0),
      };
      const issue = classifyPlanRealTask(task);
      const blockers = task.status === IN_PROGRESS_TASK_STATUS || isTaskClosed(task.status) ? [] : taskBlockers(task);
      return {
        ...task,
        blockers,
        ...(issue ? {
          issue_key: issue.key,
          issue_label: issue.label,
          issue_action: issue.action,
          tone: issue.tone,
          issue_rank: issue.rank,
          action_path: buildPlanRealTaskPath({ ...task, issue_key: issue.key }, date),
        } : {
          action_path: buildTaskPath({ ...task, blockers }, date),
        }),
      };
    });

    const latestFeedback = latestRecommendationFeedbackById(feedbackResult.rows || []);
    const hiddenRecommendationIds = new Set(Array.from(latestFeedback.values())
      .filter((row) => ['dismissed', 'snoozed'].includes(row.decision))
      .map((row) => row.recommendation_id)
      .filter(Boolean));

    const allRecommendations = buildOpsActionRecommendations({
      date,
      oddzialId,
      tasks,
      eventStats: eventsResult.rows || [],
    }).map((item) => {
      const feedback = latestFeedback.get(item.id);
      const acceptedToday = feedback?.decision === 'accepted' && feedback?.source === 'action';
      return {
        ...item,
        feedback_decision: feedback?.decision || null,
        feedback_source: feedback?.source || null,
        accepted_today: acceptedToday,
      };
    });
    const recommendations = allRecommendations
      .filter((item) => !hiddenRecommendationIds.has(item.id))
      .slice(0, 5)
      .map((item, index) => ({ ...item, rank: index + 1 }));
    const hiddenRecommendations = allRecommendations.filter((item) => hiddenRecommendationIds.has(item.id));

    res.json({
      date,
      oddzial_id: oddzialId,
      summary: {
        total: recommendations.length,
        high: recommendations.filter((item) => item.priority === 'high').length,
        actionable: recommendations.filter((item) => item.action_kind && item.action_kind !== 'none').length,
        plan_tasks: tasks.length,
        memory_rows: eventsResult.rows.length,
        hidden_today: hiddenRecommendations.length,
        accepted_today: recommendations.filter((item) => item.accepted_today).length,
      },
      recommendations,
      hidden_recommendations: hiddenRecommendations,
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops action-recommendations', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.post('/action-recommendations/:recommendationId/apply', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const recommendationId = cleanText(req.params.recommendationId, 80);
  if (!recommendationId) {
    return res.status(400).json({ error: 'Nieprawidlowy identyfikator rekomendacji.' });
  }

  const date = parseDateParam(req.body?.date || req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const actionKind = cleanText(req.body?.action_kind, 60) || 'open_tasks';
  const allowedActionKinds = new Set(['set_duration_batch', 'remind_team_batch', 'fix_dispatch_blockers', 'open_tasks', 'open_task', 'open_map', 'none']);
  if (!allowedActionKinds.has(actionKind)) {
    return res.status(400).json({ error: 'Nieznany typ akcji rekomendacji.' });
  }

  const requestedOddzial = req.body?.oddzial_id || req.query.oddzial_id ? Number(req.body?.oddzial_id || req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const taskIds = recommendationTaskIds(req.body?.task_ids);
  const targetPath = cleanText(req.body?.target_path, 300) || '/kierownik';
  const title = cleanText(req.body?.title, 300) || recommendationId;

  try {
    await ensureOpsActionEventsTable();

    const result = {
      recommendation_id: recommendationId,
      action_kind: actionKind,
      date,
      oddzial_id: oddzialId,
      task_ids: taskIds,
      updated_tasks: [],
      notification_count: 0,
      dispatch_preflight: null,
      navigate_to: ['open_tasks', 'open_task', 'open_map', 'none'].includes(actionKind) ? targetPath : null,
    };

    if (['set_duration_batch', 'remind_team_batch', 'fix_dispatch_blockers'].includes(actionKind)) {
      if (taskIds.length === 0) {
        return res.status(400).json({ error: 'Akcja rekomendacji wymaga task_ids.' });
      }

      const branchSql = oddzialId != null ? 'AND t.oddzial_id = $2' : '';
      const taskParams = oddzialId != null ? [taskIds, oddzialId] : [taskIds];
      const taskResult = await pool.query(
        `SELECT t.id, t.numer, t.klient_nazwa, t.klient_telefon, t.adres, t.status, t.oddzial_id, t.ekipa_id,
                t.data_planowana, t.pin_lat, t.pin_lng, t.czas_planowany_godziny, t.czas_obslugi_min,
                t.notatki_wewnetrzne,
                e.nazwa AS ekipa_nazwa, e.brygadzista_id
         FROM tasks t
         LEFT JOIN teams e ON e.id = t.ekipa_id
         WHERE t.id = ANY($1::int[])
           ${branchSql}
         ORDER BY t.id ASC`,
        taskParams
      );
      const tasks = taskResult.rows || [];
      if (tasks.length === 0) {
        return res.status(404).json({ error: 'Nie znaleziono zlecen dla rekomendacji w dostepnym zakresie.' });
      }
      if (!isDyrektorOrAdmin(req.user) && tasks.some((task) => String(task.oddzial_id || '') !== String(req.user.oddzial_id || ''))) {
        return res.status(403).json({ error: 'Brak dostepu do zlecenia z innego oddzialu.' });
      }

      if (actionKind === 'set_duration_batch') {
        const plannedMinutes = roundedMinutes(req.body?.suggested_minutes || req.body?.planned_minutes || 120);
        if (plannedMinutes < 15 || plannedMinutes > 720) {
          return res.status(400).json({ error: 'Czas planu musi byc w zakresie 15 min - 12 h.' });
        }
        const plannedHours = Math.round((plannedMinutes / 60) * 100) / 100;
        for (const task of tasks) {
          const note = planRealNote({
            title: 'Rekomendacja kierownika: ustawiono czas planu',
            user: req.user,
            lines: [
              `Rekomendacja: ${title}`,
              `Zlecenie: ${task.numer || `#${task.id}`}`,
              `Czas planu: ${formatActionMinutes(plannedMinutes)}`,
            ],
          });
          const update = await pool.query(
            `UPDATE tasks
             SET czas_planowany_godziny = $1,
                 czas_obslugi_min = $2,
                 notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $3::text),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING id, numer, czas_planowany_godziny, czas_obslugi_min`,
            [plannedHours, plannedMinutes, note, task.id]
          );
          const event = await recordOpsActionEvent({
            task,
            user: req.user,
            actionType: 'set_duration',
            issueKey: 'missing_duration',
            plannedMinutes,
            note: `Rekomendacja: ${title}`,
            metadata: {
              recommendation_id: recommendationId,
              source: 'recommendation_apply',
              task_numer: task.numer || null,
            },
          });
          result.updated_tasks.push({ ...(update.rows[0] || { id: task.id }), event_id: event?.id || null });
        }
      }

      if (actionKind === 'fix_dispatch_blockers') {
        const preflight = {
          checked: tasks.length,
          ready: [],
          still_blocked: [],
          fixed_team_count: 0,
          gps_checklist_count: 0,
        };
        for (const task of tasks) {
          const blockers = taskBlockers(task).filter((key) => key === 'team' || key === 'gps');
          const remaining = new Set(blockers);

          if (remaining.has('team')) {
            const options = await buildTeamConflictOptions(task, 1);
            const selected = options[0] || null;
            if (selected) {
              const note = planRealNote({
                title: 'Preflight dispatchera: automatycznie przypisano ekipe',
                user: req.user,
                lines: [
                  `Rekomendacja: ${title}`,
                  `Zlecenie: ${task.numer || `#${task.id}`}`,
                  `Ekipa: ${selected.team_name} (#${selected.team_id})`,
                  `Powod: brak ekipy blokowal dispatch.`,
                ],
              });
              const updated = await pool.query(
                `UPDATE tasks
                 SET ekipa_id = $1,
                     notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $2::text),
                     updated_at = NOW()
                 WHERE id = $3
                 RETURNING id, numer, ekipa_id, notatki_wewnetrzne`,
                [selected.team_id, note, task.id]
              );
              await pool.query(
                `UPDATE equipment_reservations
                 SET ekipa_id = $1, updated_at = NOW()
                 WHERE task_id = $2
                   AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'
                   AND LOWER(COALESCE(status, '')) NOT LIKE 'zwr%'`,
                [selected.team_id, task.id]
              );
              const event = await recordOpsActionEvent({
                task,
                user: req.user,
                actionType: 'dispatch_auto_assign_team',
                issueKey: 'team',
                note: `Rekomendacja: ${title}`,
                metadata: {
                  recommendation_id: recommendationId,
                  source: 'recommendation_apply',
                  old_team_id: task.ekipa_id || null,
                  new_team_id: selected.team_id,
                  impact: selected.impact,
                  task_numer: task.numer || null,
                },
              });
              task.ekipa_id = selected.team_id;
              task.ekipa_nazwa = selected.team_name;
              preflight.fixed_team_count += 1;
              remaining.delete('team');
              result.updated_tasks.push({
                ...(updated.rows[0] || { id: task.id, ekipa_id: selected.team_id }),
                action: 'assign_team',
                option: selected,
                event_id: event?.id || null,
              });
            }
          }

          if (remaining.has('gps')) {
            const note = planRealNote({
              title: 'Preflight dispatchera: checklist GPS',
              user: req.user,
              lines: [
                `Rekomendacja: ${title}`,
                `Zlecenie: ${task.numer || `#${task.id}`}`,
                'Do dispatch: ustaw pinezke GPS na podstawie adresu lub potwierdzenia telefonicznego w Zadarma.',
                task.adres ? `Adres do weryfikacji: ${task.adres}` : 'Brak adresu do automatycznej pinezki.',
              ],
            });
            const updated = await pool.query(
              `UPDATE tasks
               SET notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $1::text),
                   updated_at = NOW()
               WHERE id = $2
               RETURNING id, numer, pin_lat, pin_lng, notatki_wewnetrzne`,
              [note, task.id]
            );
            const event = await recordOpsActionEvent({
              task,
              user: req.user,
              actionType: 'dispatch_gps_checklist',
              issueKey: 'gps',
              note: `Rekomendacja: ${title}`,
              metadata: {
                recommendation_id: recommendationId,
                source: 'recommendation_apply',
                needs_manual_gps: true,
                zadarma_first: true,
                task_numer: task.numer || null,
              },
            });
            preflight.gps_checklist_count += 1;
            result.updated_tasks.push({
              ...(updated.rows[0] || { id: task.id }),
              action: 'gps_checklist',
              event_id: event?.id || null,
            });
          }

          if (remaining.size === 0) {
            preflight.ready.push(task.id);
          } else {
            preflight.still_blocked.push({
              task_id: task.id,
              numer: task.numer || null,
              blockers: Array.from(remaining),
              target_path: buildTaskPath({ ...task, blockers: Array.from(remaining) }, date),
            });
          }
        }
        result.dispatch_preflight = preflight;
      }

      if (actionKind === 'remind_team_batch') {
        for (const task of tasks) {
          if (!task.ekipa_id) continue;
          const noteText = `Rekomendacja: ${title}`;
          const reminderText = [
            `Plan vs real: sprawdz zlecenie ${task.numer || `#${task.id}`}.`,
            task.klient_nazwa ? `Klient: ${task.klient_nazwa}.` : '',
            noteText,
          ].filter(Boolean).join(' ');
          const note = planRealNote({
            title: 'Rekomendacja kierownika: przypomnienie do ekipy',
            user: req.user,
            lines: [
              `Rekomendacja: ${title}`,
              `Zlecenie: ${task.numer || `#${task.id}`}`,
              `Ekipa: ${task.ekipa_nazwa || `#${task.ekipa_id}`}`,
            ],
          });

          const recipientsResult = await pool.query(
            `SELECT DISTINCT user_id
             FROM (
               SELECT e.brygadzista_id AS user_id
               FROM teams e
               WHERE e.id = $1 AND e.brygadzista_id IS NOT NULL
               UNION
               SELECT tm.user_id
               FROM team_members tm
               WHERE tm.team_id = $1
             ) recipients
             WHERE user_id IS NOT NULL`,
            [task.ekipa_id]
          );
          const recipientIds = recipientsResult.rows
            .map((row) => Number(row.user_id))
            .filter((id) => Number.isInteger(id) && id > 0);
          const update = await pool.query(
            `UPDATE tasks
             SET notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $1::text),
                 updated_at = NOW()
             WHERE id = $2
             RETURNING id, numer, notatki_wewnetrzne`,
            [note, task.id]
          );
          let notificationRows = [];
          if (recipientIds.length > 0) {
            const notificationsResult = await pool.query(
              `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
               SELECT $1, recipient_id, $2, 'Plan vs real', $3, 'Nowe'
               FROM UNNEST($4::int[]) AS recipient_id
               RETURNING id, to_user_id, typ, tresc, task_id, status, data_utworzenia`,
              [req.user.id, task.id, reminderText, recipientIds]
            );
            notificationRows = notificationsResult.rows || [];
            notificationRows.forEach((notification) => {
              pushToUser(notification.to_user_id, { event: 'notification', notification });
            });
          }
          const event = await recordOpsActionEvent({
            task,
            user: req.user,
            actionType: 'remind_team',
            issueKey: 'not_started',
            note: noteText,
            metadata: {
              recommendation_id: recommendationId,
              source: 'recommendation_apply',
              team_id: task.ekipa_id,
              recipients: recipientIds,
              notification_count: notificationRows.length,
              task_numer: task.numer || null,
            },
          });
          result.notification_count += notificationRows.length;
          result.updated_tasks.push({ ...(update.rows[0] || { id: task.id }), event_id: event?.id || null });
        }
      }
    }

    const feedbackEvent = await recordOpsActionEvent({
      task: { oddzial_id: oddzialId },
      user: req.user,
      actionType: 'recommendation_feedback',
      note: `Wykonano: ${title}`,
      metadata: {
        recommendation_id: recommendationId,
        decision: 'accepted',
        source: 'action',
        date,
        target_path: targetPath,
        task_ids: taskIds,
        action_kind: actionKind,
        updated_count: result.updated_tasks.length,
        notification_count: result.notification_count,
        dispatch_preflight: result.dispatch_preflight,
      },
    });

    await req.auditLog?.({
      action: 'ops.action_recommendation.apply',
      entity: 'ops_recommendation',
      entity_id: recommendationId,
      details: { action_kind: actionKind, date, oddzial_id: oddzialId, task_ids: taskIds },
    });

    return res.json({
      message: result.updated_tasks.length > 0 ? 'Rekomendacja wykonana' : 'Decyzja rekomendacji zapisana',
      ...result,
      feedback_event: feedbackEvent,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops action-recommendation apply', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.post('/action-recommendations/:recommendationId/feedback', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const recommendationId = cleanText(req.params.recommendationId, 80);
  if (!recommendationId) {
    return res.status(400).json({ error: 'Nieprawidlowy identyfikator rekomendacji.' });
  }

  const date = parseDateParam(req.body?.date || req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const decision = cleanText(req.body?.decision, 30);
  const allowedDecisions = new Set(['accepted', 'dismissed', 'snoozed']);
  if (!allowedDecisions.has(decision)) {
    return res.status(400).json({ error: 'Nieznana decyzja dla rekomendacji.' });
  }
  const source = cleanText(req.body?.source, 50) || (
    decision === 'dismissed' ? 'hide' : decision === 'snoozed' ? 'snooze' : 'manual'
  );

  const requestedOddzial = req.body?.oddzial_id || req.query.oddzial_id ? Number(req.body?.oddzial_id || req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  try {
    await ensureOpsActionEventsTable();
    const event = await recordOpsActionEvent({
      task: { oddzial_id: oddzialId },
      user: req.user,
      actionType: 'recommendation_feedback',
      note: cleanText(req.body?.note, 600),
      metadata: {
        recommendation_id: recommendationId,
        decision,
        source,
        date,
        target_path: cleanText(req.body?.target_path, 300) || null,
        task_ids: Array.isArray(req.body?.task_ids)
          ? req.body.task_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20)
          : [],
      },
    });

    await req.auditLog?.({
      action: 'ops.action_recommendation.feedback',
      entity: 'ops_recommendation',
      entity_id: recommendationId,
      details: { decision, source, date, oddzial_id: oddzialId },
    });

    return res.json({
      message: decision === 'dismissed' ? 'Rekomendacja ukryta na dzis' : 'Decyzja zapisana',
      feedback: {
        recommendation_id: recommendationId,
        decision,
        source,
        date,
        oddzial_id: oddzialId,
      },
      event,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops action-recommendation feedback', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.post('/plan-vs-real/tasks/:taskId/action', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'Nieprawidlowy identyfikator zlecenia.' });
  }

  const action = cleanText(req.body?.action, 40);
  const allowedActions = new Set(['set_duration', 'mark_reason', 'remind_team']);
  if (!allowedActions.has(action)) {
    return res.status(400).json({ error: 'Nieznana akcja plan-vs-real.' });
  }

  try {
    await ensureOpsActionEventsTable();
    const taskResult = await pool.query(
      `SELECT t.id, t.numer, t.klient_nazwa, t.status, t.oddzial_id, t.ekipa_id,
              t.data_planowana, t.notatki_wewnetrzne,
              e.nazwa AS ekipa_nazwa, e.brygadzista_id
       FROM tasks t
       LEFT JOIN teams e ON e.id = t.ekipa_id
       WHERE t.id = $1`,
      [taskId]
    );
    const task = taskResult.rows[0];
    if (!task) {
      return res.status(404).json({ error: 'Nie znaleziono zlecenia.' });
    }
    if (!isDyrektorOrAdmin(req.user) && String(task.oddzial_id || '') !== String(req.user.oddzial_id || '')) {
      return res.status(403).json({ error: 'Brak dostepu do zlecenia z innego oddzialu.' });
    }

    if (action === 'set_duration') {
      const requestedHours = Number(req.body?.planned_hours);
      const requestedMinutes = Number(req.body?.planned_minutes);
      const plannedMinutes = roundedMinutes(Number.isFinite(requestedMinutes) && requestedMinutes > 0
        ? requestedMinutes
        : requestedHours * 60);
      if (plannedMinutes < 15 || plannedMinutes > 720) {
        return res.status(400).json({ error: 'Czas planu musi byc w zakresie 15 min - 12 h.' });
      }
      const plannedHours = Math.round((plannedMinutes / 60) * 100) / 100;
      const note = planRealNote({
        title: 'Ustawiono czas planu',
        user: req.user,
        lines: [
          `Zlecenie: ${task.numer || `#${task.id}`}`,
          `Czas planu: ${formatActionMinutes(plannedMinutes)}`,
          cleanText(req.body?.note, 600) ? `Komentarz: ${cleanText(req.body.note, 600)}` : '',
        ],
      });
      const update = await pool.query(
        `UPDATE tasks
         SET czas_planowany_godziny = $1,
             czas_obslugi_min = $2,
             notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $3::text),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, numer, czas_planowany_godziny, czas_obslugi_min, notatki_wewnetrzne`,
        [plannedHours, plannedMinutes, note, taskId]
      );
      await req.auditLog?.({
        action: 'ops.plan_vs_real.set_duration',
        entity: 'task',
        entity_id: taskId,
        details: { planned_minutes: plannedMinutes },
      });
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: action,
        issueKey: cleanText(req.body?.issue_key, 50) || 'missing_duration',
        deltaMinutes: req.body?.delta_minutes,
        plannedMinutes,
        realMinutes: req.body?.real_minutes,
        note: cleanText(req.body?.note, 600),
        metadata: {
          previous_planned_minutes: eventNumber(req.body?.previous_planned_minutes),
          task_numer: task.numer || null,
        },
      });
      return res.json({
        message: 'Czas planu zapisany',
        action,
        task: update.rows[0],
        event,
        notification_count: 0,
      });
    }

    if (action === 'mark_reason') {
      const reasonCode = PLAN_REAL_REASON_LABELS[req.body?.reason_code] ? req.body.reason_code : 'inne';
      const reasonLabel = PLAN_REAL_REASON_LABELS[reasonCode];
      const noteText = cleanText(req.body?.note, 800);
      const note = planRealNote({
        title: 'Oznaczono powod odchylenia',
        user: req.user,
        lines: [
          `Zlecenie: ${task.numer || `#${task.id}`}`,
          `Powod: ${reasonLabel}`,
          noteText ? `Komentarz: ${noteText}` : '',
        ],
      });
      const update = await pool.query(
        `UPDATE tasks
         SET notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $1::text),
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, numer, notatki_wewnetrzne`,
        [note, taskId]
      );
      await req.auditLog?.({
        action: 'ops.plan_vs_real.mark_reason',
        entity: 'task',
        entity_id: taskId,
        details: { reason_code: reasonCode },
      });
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: action,
        issueKey: cleanText(req.body?.issue_key, 50) || 'overrun',
        reasonCode,
        deltaMinutes: req.body?.delta_minutes,
        plannedMinutes: req.body?.planned_minutes,
        realMinutes: req.body?.real_minutes,
        note: noteText,
        metadata: {
          reason_label: reasonLabel,
          task_numer: task.numer || null,
        },
      });
      return res.json({
        message: 'Powod zapisany',
        action,
        reason_code: reasonCode,
        task: update.rows[0],
        event,
        notification_count: 0,
      });
    }

    if (!task.ekipa_id) {
      return res.status(409).json({ error: 'Zlecenie nie ma przypisanej ekipy.' });
    }

    const noteText = cleanText(req.body?.note, 600);
    const reminderText = [
      `Plan vs real: sprawdz zlecenie ${task.numer || `#${task.id}`}.`,
      task.klient_nazwa ? `Klient: ${task.klient_nazwa}.` : '',
      noteText ? `Notatka kierownika: ${noteText}` : '',
    ].filter(Boolean).join(' ');
    const note = planRealNote({
      title: 'Wyslano przypomnienie do ekipy',
      user: req.user,
      lines: [
        `Zlecenie: ${task.numer || `#${task.id}`}`,
        `Ekipa: ${task.ekipa_nazwa || `#${task.ekipa_id}`}`,
        noteText ? `Komentarz: ${noteText}` : '',
      ],
    });

    const recipientsResult = await pool.query(
      `SELECT DISTINCT user_id
       FROM (
         SELECT e.brygadzista_id AS user_id
         FROM teams e
         WHERE e.id = $1 AND e.brygadzista_id IS NOT NULL
         UNION
         SELECT tm.user_id
         FROM team_members tm
         WHERE tm.team_id = $1
       ) recipients
       WHERE user_id IS NOT NULL`,
      [task.ekipa_id]
    );
    const recipientIds = recipientsResult.rows
      .map((row) => Number(row.user_id))
      .filter((id) => Number.isInteger(id) && id > 0);

    const update = await pool.query(
      `UPDATE tasks
       SET notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $1::text),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, numer, notatki_wewnetrzne`,
      [note, taskId]
    );

    let notificationRows = [];
    if (recipientIds.length > 0) {
      const notificationsResult = await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
         SELECT $1, recipient_id, $2, 'Plan vs real', $3, 'Nowe'
         FROM UNNEST($4::int[]) AS recipient_id
         RETURNING id, to_user_id, typ, tresc, task_id, status, data_utworzenia`,
        [req.user.id, taskId, reminderText, recipientIds]
      );
      notificationRows = notificationsResult.rows || [];
      notificationRows.forEach((notification) => {
        pushToUser(notification.to_user_id, { event: 'notification', notification });
      });
    }

    await req.auditLog?.({
      action: 'ops.plan_vs_real.remind_team',
      entity: 'task',
      entity_id: taskId,
      details: { team_id: task.ekipa_id, recipients: recipientIds },
    });
    const event = await recordOpsActionEvent({
      task,
      user: req.user,
      actionType: action,
      issueKey: cleanText(req.body?.issue_key, 50) || 'not_started',
      deltaMinutes: req.body?.delta_minutes,
      plannedMinutes: req.body?.planned_minutes,
      realMinutes: req.body?.real_minutes,
      note: noteText,
      metadata: {
        team_id: task.ekipa_id,
        recipients: recipientIds,
        notification_count: notificationRows.length,
        task_numer: task.numer || null,
      },
    });

    return res.json({
      message: recipientIds.length > 0 ? 'Przypomnienie wyslane' : 'Notatka zapisana, brak odbiorcow w ekipie',
      action,
      task: update.rows[0],
      event,
      notification_count: notificationRows.length,
    });
  } catch (e) {
    logger.error('ops plan-vs-real action', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/risk-report/actions/options', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const taskId = Number(req.query.task_id || 0);
  const riskType = cleanText(req.query.risk_type, 60);
  const riskId = cleanText(req.query.risk_id, 120);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'Opcje ryzyka wymagaja task_id.' });
  }
  try {
    const { task, error } = await getRiskTask(taskId, req.user);
    if (error) return res.status(error.status).json({ error: error.message });
    let options = [];
    if (riskType === 'team_conflict') {
      options = await buildTeamConflictOptions(task);
    } else if (riskType === 'equipment_conflict') {
      options = await buildEquipmentConflictOptions(task, riskId);
    } else {
      return res.status(400).json({ error: 'Brak automatycznych opcji dla tego typu ryzyka.' });
    }
    return res.json({
      risk_id: riskId,
      risk_type: riskType,
      task_id: task.id,
      options,
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops risk-report options', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.post('/risk-report/actions', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const action = cleanText(req.body?.action, 50);
  const allowedActions = new Set(['resend_zadarma_sms', 'queue_zadarma_call', 'acknowledge', 'reassign_team', 'replace_equipment']);
  if (!allowedActions.has(action)) {
    return res.status(400).json({ error: 'Nieznana akcja raportu ryzyk.' });
  }

  const taskId = Number(req.body?.task_id || 0);
  const riskId = cleanText(req.body?.risk_id, 120);
  const riskType = cleanText(req.body?.risk_type, 60);
  const noteText = cleanText(req.body?.note, 800);
  const smsHistoryIdMatch = riskId.match(/^sms_delivery:(\d+)$/);
  const smsHistoryId = smsHistoryIdMatch ? Number(smsHistoryIdMatch[1]) : null;

  try {
    await ensureOpsActionEventsTable();

    let task = null;
    if (Number.isInteger(taskId) && taskId > 0) {
      const resolved = await getRiskTask(taskId, req.user);
      if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
      task = resolved.task;
    }

    if (action === 'acknowledge') {
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: 'risk_acknowledge',
        issueKey: riskType || 'risk_report',
        note: noteText || `Potwierdzono ryzyko ${riskId || riskType || ''}`,
        metadata: { risk_id: riskId, risk_type: riskType },
      });
      return res.json({ message: 'Ryzyko oznaczone jako sprawdzone', action, event, requestId: req.requestId });
    }

    if (!task) return res.status(400).json({ error: 'Akcja wymaga task_id.' });

    if (action === 'reassign_team') {
      const newTeamId = Number(req.body?.team_id || req.body?.ekipa_id || 0);
      if (!Number.isInteger(newTeamId) || newTeamId <= 0) {
        return res.status(400).json({ error: 'Przepiecie ekipy wymaga team_id.' });
      }
      const options = await buildTeamConflictOptions(task, 20);
      const selected = options.find((option) => Number(option.team_id) === newTeamId);
      if (!selected) {
        return res.status(409).json({ error: 'Wybrana ekipa nie jest bezkolizyjna dla tego terminu.' });
      }
      const note = [
        'RAPORT RYZYK / PRZEPIECIE EKIPY',
        `Ryzyko: ${riskId || riskType || '-'}`,
        `Z ${task.ekipa_nazwa || `#${task.ekipa_id || '-'}`} na ${selected.team_name} (#${selected.team_id})`,
        `Skutek: ${selected.impact}`,
        noteText ? `Komentarz: ${noteText}` : '',
        `Kierownik: ${managerActor(req.user)}`,
        `Data decyzji: ${new Date().toISOString()}`,
      ].filter(Boolean).join('\n');
      const updated = await pool.query(
        `UPDATE tasks
         SET ekipa_id = $1,
             notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $2::text),
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, numer, ekipa_id, notatki_wewnetrzne`,
        [selected.team_id, note, task.id]
      );
      await pool.query(
        `UPDATE equipment_reservations
         SET ekipa_id = $1, updated_at = NOW()
         WHERE task_id = $2
           AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'
           AND LOWER(COALESCE(status, '')) NOT LIKE 'zwr%'`,
        [selected.team_id, task.id]
      );
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: 'risk_reassign_team',
        issueKey: riskType || 'team_conflict',
        note: noteText || `Przepieto ekipe z raportu ryzyk: ${riskId}`,
        metadata: {
          risk_id: riskId,
          risk_type: riskType,
          old_team_id: task.ekipa_id || null,
          new_team_id: selected.team_id,
          impact: selected.impact,
        },
      });
      return res.json({
        message: `Przepieto zlecenie na ${selected.team_name}`,
        action,
        task: updated.rows[0],
        option: selected,
        event,
        requestId: req.requestId,
      });
    }

    if (action === 'replace_equipment') {
      const newEquipmentId = Number(req.body?.sprzet_id || 0);
      const options = await buildEquipmentConflictOptions(task, riskId, 20);
      const selected = options.find((option) => Number(option.sprzet_id) === newEquipmentId);
      if (!selected) {
        return res.status(409).json({ error: 'Wybrany sprzet nie jest bezkolizyjny dla tego terminu.' });
      }
      const bounds = taskPlanBounds(task);
      const note = [
        'RAPORT RYZYK / PRZEPIECIE SPRZETU',
        `Ryzyko: ${riskId || riskType || '-'}`,
        `Nowy sprzet: ${selected.sprzet_nazwa} (#${selected.sprzet_id})`,
        `Skutek: ${selected.impact}`,
        noteText ? `Komentarz: ${noteText}` : '',
        `Kierownik: ${managerActor(req.user)}`,
        `Data decyzji: ${new Date().toISOString()}`,
      ].filter(Boolean).join('\n');
      await pool.query(
        `UPDATE equipment_reservations
         SET status = 'Anulowane', updated_at = NOW()
         WHERE task_id = $1
           AND sprzet_id = $2
           AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'`,
        [task.id, selected.old_sprzet_id]
      );
      const reservation = await pool.query(
        `INSERT INTO equipment_reservations (
           oddzial_id, sprzet_id, ekipa_id, data_od, data_do, caly_dzien,
           status, user_id, task_id, notatki
         )
         VALUES ($1,$2,$3,$4::date,$4::date,true,'Zarezerwowane',$5,$6,$7)
         RETURNING id, sprzet_id, task_id, ekipa_id, status`,
        [task.oddzial_id, selected.sprzet_id, task.ekipa_id || null, bounds.day, req.user.id, task.id, note]
      );
      const updated = await pool.query(
        `UPDATE tasks
         SET notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $1::text),
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, numer, notatki_wewnetrzne`,
        [note, task.id]
      );
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: 'risk_replace_equipment',
        issueKey: riskType || 'equipment_conflict',
        note: noteText || `Przepieto sprzet z raportu ryzyk: ${riskId}`,
        metadata: {
          risk_id: riskId,
          risk_type: riskType,
          old_sprzet_id: selected.old_sprzet_id,
          new_sprzet_id: selected.sprzet_id,
          reservation_id: reservation.rows[0]?.id || null,
          impact: selected.impact,
        },
      });
      return res.json({
        message: `Zmieniono sprzet na ${selected.sprzet_nazwa}`,
        action,
        task: updated.rows[0],
        reservation: reservation.rows[0],
        option: selected,
        event,
        requestId: req.requestId,
      });
    }

    if (!truthyText(task.klient_telefon)) {
      return res.status(409).json({ error: 'Zlecenie nie ma telefonu klienta.' });
    }

    if (action === 'resend_zadarma_sms') {
      let smsText = '';
      if (smsHistoryId) {
        const smsResult = await pool.query(
          `SELECT h.id, h.tresc, h.task_id
           FROM sms_history h
           LEFT JOIN tasks t ON t.id = h.task_id
           WHERE h.id = $1
             AND ($2::int IS NULL OR h.task_id = $2)
             AND ($3::int IS NULL OR t.oddzial_id = $3)
           ORDER BY h.created_at DESC
           LIMIT 1`,
          [smsHistoryId, task.id, isDyrektorOrAdmin(req.user) ? null : req.user.oddzial_id]
        );
        smsText = cleanText(smsResult.rows[0]?.tresc, 640);
      }
      if (!smsText) {
        const proposalResult = await pool.query(
          `SELECT p.token, p.proposed_date, p.okno_od, p.okno_do
           FROM task_time_window_proposals p
           WHERE p.task_id = $1
           ORDER BY p.created_at DESC
           LIMIT 1`,
          [task.id]
        );
        const proposal = proposalResult.rows[0];
        const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
        const link = proposal?.token && base ? `${base}/api/tasks/time-window/${proposal.token}` : '';
        smsText = [
          `ARBOR: przypomnienie dotyczace zlecenia ${task.numer || `#${task.id}`}.`,
          proposal ? `Termin ${proposal.proposed_date || ''} ${proposal.okno_od || ''}-${proposal.okno_do || ''}.` : '',
          link ? `Potwierdz tutaj: ${link}` : 'Prosimy o kontakt w sprawie terminu.',
        ].filter(Boolean).join(' ');
      }

      const sms = await sendSmsGateway({
        to: task.klient_telefon,
        body: smsText,
        taskId: task.id,
        oddzialId: task.oddzial_id,
      });
      const event = await recordOpsActionEvent({
        task,
        user: req.user,
        actionType: 'risk_resend_sms',
        issueKey: riskType || 'sms_delivery',
        note: noteText || `Ponowiono SMS z raportu ryzyk: ${riskId}`,
        metadata: {
          risk_id: riskId,
          risk_type: riskType,
          provider: sms.provider || null,
          sid: sms.sid || sms.id || sms.message_id || null,
          ok: Boolean(sms.ok),
          error: sms.error || null,
        },
      });
      return res.status(sms.ok ? 200 : 502).json({
        message: sms.ok ? 'SMS wyslany przez Zadarma/SMS gateway' : 'Nie udalo sie wyslac SMS',
        action,
        sms,
        event,
        requestId: req.requestId,
      });
    }

    await ensureRiskTelephonyCallbacksTable();
    const callbackResult = await pool.query(
      `INSERT INTO telephony_callbacks (
         oddzial_id, phone, task_id, lead_name, priority, due_at, status, notes, assigned_user_id, created_by
       )
       VALUES ($1,$2,$3,$4,'high',NOW(),'open',$5,NULL,$6)
       RETURNING *`,
      [
        task.oddzial_id,
        task.klient_telefon,
        task.id,
        task.klient_nazwa || null,
        noteText || `Raport ryzyk: ${riskType || riskId || 'kontakt z klientem'}`,
        req.user.id,
      ]
    );

    let zadarmaCall = { requested: false };
    const from = cleanText(await resolveBranchSmsSender({ oddzialId: task.oddzial_id, taskId: task.id }), 64)
      || cleanText(task.oddzial_telefon || env.ZADARMA_CALLER_ID, 64);
    if (from) {
      try {
        const result = await requestCallback({ from, to: task.klient_telefon });
        zadarmaCall = { requested: true, ok: true, from, result };
      } catch (e) {
        zadarmaCall = { requested: true, ok: false, from, error: e.message };
      }
    }

    const event = await recordOpsActionEvent({
      task,
      user: req.user,
      actionType: 'risk_queue_call',
      issueKey: riskType || 'risk_report',
      note: noteText || `Telefon Zadarma z raportu ryzyk: ${riskId}`,
      metadata: {
        risk_id: riskId,
        risk_type: riskType,
        callback_id: callbackResult.rows[0]?.id || null,
        zadarma_call: zadarmaCall,
      },
    });
    return res.status(zadarmaCall.requested && zadarmaCall.ok === false ? 202 : 200).json({
      message: zadarmaCall.requested && zadarmaCall.ok
        ? 'Telefon Zadarma uruchomiony i wpisany do kolejki'
        : 'Callback zapisany w kolejce Telefonii',
      action,
      callback: callbackResult.rows[0],
      zadarma_call: zadarmaCall,
      event,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops risk-report action', { message: e.message, requestId: req.requestId });
    return res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/smoke', authMiddleware, requireRole('Prezes', 'Dyrektor', 'Administrator'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const [dbRes, usersRes, tasksRes] = await Promise.all([
      pool.query('SELECT 1 AS ok'),
      pool.query('SELECT COUNT(*)::int AS c FROM users'),
      pool.query('SELECT COUNT(*)::int AS c FROM tasks'),
    ]);
    res.json({
      status: 'ok',
      checks: {
        db: dbRes.rows[0]?.ok === 1 ? 'up' : 'unknown',
        users_table: usersRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
        tasks_table: tasksRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
      },
      counts: {
        users: usersRes.rows[0]?.c || 0,
        tasks: tasksRes.rows[0]?.c || 0,
      },
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('Blad smoke check', { message: e.message, requestId: req.requestId });
    res.status(503).json({
      status: 'failed',
      error: e.message,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  }
});

router.get('/storage-smoke', authMiddleware, requireRole('Prezes', 'Dyrektor', 'Administrator'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await runUploadStorageSelfTest();
    res.json({
      status: 'ok',
      ...result,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('Blad storage smoke check', { message: e.message, mode: uploadStorageMode(), requestId: req.requestId });
    res.status(503).json({
      status: 'failed',
      mode: uploadStorageMode(),
      error: e.message,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  }
});

/** F1.10 — prosty tick SLA: przypomnienie dla przeterminowanych zatwierdzeń (bez eskalacji hierarchicznej). */
router.get('/quotation-sla-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const emailOn = process.env.QUOTATION_SLA_EMAIL === '1';
    const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const { rows } = await pool.query(
      `SELECT a.id, a.quotation_id, a.wymagany_typ, a.due_at
       FROM quotation_approvals a
       JOIN quotations q ON q.id = a.quotation_id
       WHERE a.decyzja = 'Pending' AND q.status = 'W_Zatwierdzeniu'
         AND a.due_at IS NOT NULL AND a.due_at < NOW()
         AND a.sla_reminder_sent_at IS NULL
       LIMIT 100`
    );
    let emailsSent = 0;
    for (const r of rows) {
      const tresc = `SLA: zatwierdzenie wyceny #${r.quotation_id} (${r.wymagany_typ}) po terminie.`;
      const linkLine = base ? `\n\nPanel: ${base}/wycena-kalendarz` : '';
      const users = await pool.query(
        `SELECT DISTINCT u.id, NULLIF(TRIM(u.email), '') AS email FROM users u
         WHERE u.aktywny IS NOT FALSE AND (
           (u.rola = 'Kierownik' AND u.oddzial_id = (SELECT oddzial_id FROM quotations WHERE id = $1))
           OR u.rola IN ('Prezes','Dyrektor')
         )`,
        [r.quotation_id]
      );
      for (const u of users.rows) {
        await pool.query(
          `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
           VALUES (NULL, $1, NULL, $2, 'quotation_sla', $3, 'Nowe')`,
          [u.id, r.quotation_id, tresc]
        );
        if (emailOn && u.email) {
          const mail = await sendSystemEmailOptional({
            to: u.email,
            subject: `[ARBOR] SLA wyceny #${r.quotation_id}`,
            text: `${tresc}${linkLine}`,
          });
          if (mail.sent) emailsSent += 1;
        }
      }
      await pool.query(`UPDATE quotation_approvals SET sla_reminder_sent_at = NOW() WHERE id = $1`, [r.id]);
    }
    res.json({ processed: rows.length, emails_sent: emailsSent });
  } catch (e) {
    logger.error('ops quotation-sla-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** Wyceny w statusie Wyslana_Klientowi po terminie ważności → Wygasla (cron z ?secret=OPS_CRON_SECRET). */
router.get('/quotation-expiry-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE quotations SET status = 'Wygasla', updated_at = NOW()
       WHERE status = 'Wyslana_Klientowi' AND waznosc_do IS NOT NULL AND waznosc_do < NOW()
       RETURNING id`
    );
    res.json({ expired: rows.length, ids: rows.map((r) => r.id) });
  } catch (e) {
    logger.error('ops quotation-expiry-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.5 — kasa zadeklarowana, brak odbioru: przypomnienia po 48 h i 7 dniach (in-app). */
router.get('/payroll-cash-reminder-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const typ = 'kasa_oddzial_nieodebrana';
  const smsOn = process.env.PAYROLL_CASH_REMINDER_SMS === '1';
  const emailOn = process.env.PAYROLL_CASH_REMINDER_EMAIL === '1';
  let emailSent48 = 0;
  let emailSent7 = 0;

  const notifyForPickup = async (row, label) => {
    const meta = await pool.query(
      `SELECT t.nazwa AS team_nazwa, b.nazwa AS oddzial_nazwa
       FROM teams t JOIN branches b ON b.id = $1 WHERE t.id = $2`,
      [row.oddzial_id, row.team_id]
    );
    const m = meta.rows[0] || {};
    const teamN = m.team_nazwa || `ekipa #${row.team_id}`;
    const oddN = m.oddzial_nazwa || `oddział #${row.oddzial_id}`;
    const cash = Math.round((Number(row.declared_cash) || 0) * 100) / 100;
    const msg =
      label === '48h'
        ? `${oddN}: wpis kasy (${teamN}, ${row.pickup_date}) ${cash} PLN — brak potwierdzenia odbioru od 48 h.`
        : `${oddN}: PILNE — kasa (${teamN}, ${row.pickup_date}) ${cash} PLN nieodebrana od 7 dni.`;
    const { rows: recipients } = await pool.query(
      `SELECT id, telefon, email FROM users WHERE aktywny IS NOT FALSE AND (
         rola IN ('Prezes','Dyrektor')
         OR (rola = 'Kierownik' AND oddzial_id = $1)
       )`,
      [row.oddzial_id]
    );
    const smsBody = msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
    const subject =
      label === '48h'
        ? `[ARBOR] Kasa oddziału — przypomnienie 48 h (${oddN})`
        : `[ARBOR] PILNE: kasa oddziału 7 dni (${oddN})`;
    const esc = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
    const html = `<p style="font-family:system-ui,sans-serif">${esc(msg)}</p>`;
    for (const u of recipients) {
      await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
         VALUES (NULL, $1, NULL, $2, $3, 'Nowe')`,
        [u.id, typ, msg]
      );
      if (smsOn && u.telefon) {
        await sendSmsOptional({ to: u.telefon, body: smsBody, taskId: null });
      }
      if (emailOn && u.email && String(u.email).trim()) {
        const r = await sendSystemEmailOptional({
          to: String(u.email).trim(),
          subject,
          text: msg,
          html,
        });
        if (r.sent) {
          if (label === '48h') emailSent48 += 1;
          else emailSent7 += 1;
        }
      }
    }
  };

  try {
    const r48 = await pool.query(
      `UPDATE branch_cash_pickups p
       SET cash_reminder_48h_sent_at = NOW()
       FROM (
         SELECT id FROM branch_cash_pickups
         WHERE received_at IS NULL
           AND created_at <= NOW() - INTERVAL '48 hours'
           AND cash_reminder_48h_sent_at IS NULL
         ORDER BY id
         LIMIT 80
       ) sub
       WHERE p.id = sub.id
       RETURNING p.id, p.oddzial_id, p.team_id, p.pickup_date, p.declared_cash`
    );
    for (const row of r48.rows) {
      await notifyForPickup(row, '48h');
    }

    const r7 = await pool.query(
      `UPDATE branch_cash_pickups p
       SET cash_reminder_7d_sent_at = NOW()
       FROM (
         SELECT id FROM branch_cash_pickups
         WHERE received_at IS NULL
           AND created_at <= NOW() - INTERVAL '7 days'
           AND cash_reminder_7d_sent_at IS NULL
         ORDER BY id
         LIMIT 80
       ) sub
       WHERE p.id = sub.id
       RETURNING p.id, p.oddzial_id, p.team_id, p.pickup_date, p.declared_cash`
    );
    for (const row of r7.rows) {
      await notifyForPickup(row, '7d');
    }

    res.json({
      reminded_48h: r48.rows.length,
      reminded_7d: r7.rows.length,
      email_reminders_48h: emailSent48,
      email_reminders_7d: emailSent7,
    });
  } catch (e) {
    if (String(e.message || '').includes('cash_reminder')) {
      return res.status(503).json({ error: 'Uruchom migrację (kolumny cash_reminder_* na branch_cash_pickups).' });
    }
    logger.error('ops payroll-cash-reminder-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
