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

const router = express.Router();

const MANAGER_ROLES = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik'];
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
};

let opsActionEventsReady = false;

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
      suggested_action: 'Otworz pierwsze zlecenie z blokada i napraw dane planowania.',
      action_kind: 'open_tasks',
      primary_label: 'Otworz zlecenia',
      secondary_label: '',
      task_count: dispatchBlockers.length,
      task_ids: dispatchBlockers.slice(0, 8).map((task) => task.id),
      task_preview: recommendationTaskPreview(dispatchBlockers, date),
      target_path: buildTaskPath({ ...dispatchBlockers[0], blockers: dispatchBlockers[0].blockers || [] }, date),
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
        createdAt,
      });
    }
  }
  return latest;
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

  try {
    const [tasksResult, teamsResult, notificationsResult] = await Promise.all([
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
        unread_notifications: unreadNotifications,
        active_teams: teams.length,
        assigned_teams: teams.filter((team) => team.tasks_total > 0).length,
        gps_online: teams.filter((team) => team.tasks_total > 0 && team.gps_status === 'online').length,
        gps_attention: gpsStaleTeams.length,
      },
      blockers: blockerRows(blockerCounts),
      tasks: riskyTasks,
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
      details: { decision, date, oddzial_id: oddzialId },
    });

    return res.json({
      message: decision === 'dismissed' ? 'Rekomendacja ukryta na dzis' : 'Decyzja zapisana',
      feedback: {
        recommendation_id: recommendationId,
        decision,
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
