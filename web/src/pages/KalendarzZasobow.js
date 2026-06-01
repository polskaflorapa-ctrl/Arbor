import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import Sidebar from '../components/Sidebar';

const TEAM_ROW_H = 154;
const TEAM_COL_W = 184;
const TEAM_LABEL_W = 224;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18;
const DAY_HOUR_HEIGHT = 78;
const DAY_TIME_LABEL_W = 76;
const DAY_TEAM_COL_W = 248;
const MIN_VISIBLE_GAP_MINUTES = 45;
const TASK_STATUS_COLOR = {
  Do_Zatwierdzenia: '#f59e0b',
  Zaplanowane: '#22c55e',
  W_Realizacji: '#0ea5e9',
  Zakonczone: '#64748b',
  Anulowane: '#94a3b8',
};
const ACTIVE_TASK_STATUSES = new Set(['Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji']);
const CLOSED_TASK_STATUSES = new Set(['Zakonczone', 'Anulowane']);
const PLANNING_QUEUE_FILTERS = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'ready', label: 'Gotowe' },
  { key: 'missing', label: 'Z brakami' },
  { key: 'photos', label: 'Bez zdjec' },
  { key: 'risk', label: 'Bez BHP' },
  { key: 'price', label: 'Bez ceny' },
  { key: 'equipment', label: 'Bez sprzetu' },
  { key: 'teamTime', label: 'Bez ekipy/terminu' },
];

// ─── stałe ────────────────────────────────────────────────────────────────────
const ROW_H = 48;           // px — wysokość wiersza zasobu
const COL_W = 46;           // px — szerokość kolumny dnia
const HEADER_H = 56;        // px — nagłówek z datami
const LABEL_W = 200;        // px — lewa kolumna z nazwą sprzętu
const DNI_PL  = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
const MIESIACE = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze',
                  'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

const STATUS_COLOR = {
  Zarezerwowane: '#3b82f6',
  Wydane:        '#f59e0b',
  Zwrócone:      '#10b981',
  Anulowane:     '#6b7280',
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const toISO = (d) => d.toISOString().split('T')[0];

function dateFromRouteSearch(search) {
  const value = new URLSearchParams(search || '').get('date') || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function anchorFromISODate(value) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a, b) {
  // dni między datami (a, b to stringi YYYY-MM-DD lub Date)
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return DAY_START_HOUR * 60;
  return clamp(Number(match[1]), 0, 23) * 60 + clamp(Number(match[2]), 0, 59);
}

function minutesToTime(minutes) {
  const safe = clamp(Math.round(minutes), 0, 23 * 60 + 59);
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function planDateTimeForSlot(dayISO, time) {
  const safeTime = String(time || '08:00').slice(0, 5);
  return `${dayISO}T${safeTime}:00`;
}

function durationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function roundUpToStep(minutes, step = 30) {
  return Math.ceil(minutes / step) * step;
}

function taskDate(task) {
  return String(task?.data_planowana || '').slice(0, 10);
}

function taskTime(task) {
  const planned = String(task?.data_planowana || '');
  if (task?.godzina_rozpoczecia) return String(task.godzina_rozpoczecia).slice(0, 5);
  if (planned.includes('T')) return planned.split('T')[1]?.slice(0, 5) || '08:00';
  return '08:00';
}

function taskHours(task) {
  const value = Number(task?.czas_planowany_godziny || task?.czas_realizacji_godz || 2);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

function formDurationMinutes(form, task) {
  const value = Number(form?.czas_planowany_godziny);
  const hours = Number.isFinite(value) && value > 0 ? value : taskHours(task);
  return Math.max(30, Math.round(hours * 60));
}

function taskRangeMinutes(task) {
  const start = timeToMinutes(taskTime(task));
  const duration = Math.max(30, Math.round(taskHours(task) * 60));
  return { start, end: start + duration, duration };
}

function taskBranchId(task) {
  return task?.oddzial_id == null || task.oddzial_id === '' ? '' : String(task.oddzial_id);
}

function teamBranchId(team) {
  return team?.dostepny_w_oddziale_id || team?.oddzial_id || team?.oddzial_macierzysty_id || '';
}

function teamHomeBranchId(team) {
  return team?.oddzial_macierzysty_id || team?.oddzial_id || '';
}

function isTeamDelegatedToView(team) {
  const home = String(teamHomeBranchId(team) || '');
  const available = String(teamBranchId(team) || '');
  return Boolean(team?.delegowany || (home && available && home !== available));
}

function teamBranchLabel(team) {
  return team?.dostepny_w_oddziale_nazwa || team?.oddzial_nazwa || 'Oddzial';
}

function teamDelegationLabel(team) {
  const from = team?.delegacja_oddzial_z_nazwa || team?.oddzial_macierzysty_nazwa || team?.oddzial_nazwa || 'Oddzial macierzysty';
  const to = team?.dostepny_w_oddziale_nazwa || 'oddzial docelowy';
  return `${from} -> ${to}`;
}

function mergeTeamRows(base = [], extra = []) {
  const map = new Map();
  const keyFor = (team) => `${team?.id || ''}|${teamBranchId(team) || ''}|${team?.delegacja_id || 'native'}`;
  for (const team of base || []) {
    if (!team?.id) continue;
    map.set(keyFor(team), team);
  }
  for (const team of extra || []) {
    if (!team?.id) continue;
    map.set(keyFor(team), team);
  }
  return [...map.values()];
}

function normalizeAttendanceItem(item, fallbackDate) {
  const teamId = item?.teamId ?? item?.team_id;
  return {
    id: String(item?.id || `${teamId || ''}_${fallbackDate}`),
    dateYmd: String(item?.dateYmd || item?.date_ymd || fallbackDate),
    teamId: String(teamId || ''),
    teamName: item?.teamName || item?.team_name || item?.nazwa || (teamId ? `Ekipa #${teamId}` : 'Ekipa'),
    present: item?.present !== false,
    note: String(item?.note || ''),
    actor: String(item?.actor || item?.actor_name || ''),
    at: String(item?.at || item?.updated_at || item?.created_at || ''),
  };
}

function attendanceLine(entry) {
  if (!entry) return '';
  if (entry.present !== false) return 'Obecna';
  return entry.note ? `Nieobecna - ${entry.note}` : 'Nieobecna';
}

function taskClientLabel(task) {
  return task?.klient_nazwa || task?.adres || `Zlecenie #${task?.id}`;
}

function taskAssetUrl(pathMaybe) {
  if (!pathMaybe) return '';
  const value = String(pathMaybe);
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function extractTaskNoteLine(task, label) {
  const raw = String(task?.notatki_wewnetrzne || task?.notatki || '');
  const wanted = `${String(label || '').toLowerCase()}:`;
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(wanted));
  return line ? line.slice(String(label).length + 1).trim() : '';
}

function taskWorkBrief(task) {
  return task?.opis_pracy || task?.opis || extractTaskNoteLine(task, 'Zakres prac') || task?.wynik || '';
}

function taskRiskBrief(task) {
  return task?.ryzyka || extractTaskNoteLine(task, 'Ryzyka') || '';
}

function taskFieldEquipment(task) {
  return task?.sprzet_notatka || extractTaskNoteLine(task, 'Sprzet / uwagi') || extractTaskNoteLine(task, 'Sprzet') || '';
}

function taskFieldSettlement(task) {
  return extractTaskNoteLine(task, 'Warunki rozliczenia') || extractTaskNoteLine(task, 'Budzet klienta') || '';
}

function taskClientAccepted(task) {
  const raw = extractTaskNoteLine(task, 'Klient zaakceptowal') || extractTaskNoteLine(task, 'Klient zaakceptował');
  return /^tak|yes|true|1$/i.test(String(raw || '').trim());
}

function equipmentBranchId(item) {
  return item?.oddzial_id == null || item.oddzial_id === '' ? '' : String(item.oddzial_id);
}

function isEquipmentUnavailable(item) {
  const status = String(item?.status || '').toLowerCase();
  return status.includes('serwis') || status.includes('awari') || status.includes('wycof');
}

function activeReservation(rez) {
  const status = String(rez?.status || '').toLowerCase();
  return !status.includes('anul') && !status.includes('zwr');
}

function reservationOverlapsDay(rez, day) {
  const start = String(rez?.data_od || '').slice(0, 10);
  const end = String(rez?.data_do || '').slice(0, 10);
  return Boolean(day && start && end && start <= day && end >= day);
}

function taskReservationEquipmentIds(rezerwacje, taskId) {
  return [...new Set((rezerwacje || [])
    .filter((rez) => String(rez?.task_id || '') === String(taskId || ''))
    .filter(activeReservation)
    .map((rez) => String(rez.sprzet_id))
    .filter(Boolean))];
}

function taskEquipmentLabel(rezerwacje, task) {
  const reserved = taskReservationEquipmentIds(rezerwacje, task?.id);
  const note = taskFieldEquipment(task);
  if (reserved.length) return `${reserved.length} sprz.`;
  if (note) return 'uwagi sprz.';
  return 'sprz. -';
}

function compactText(value, fallback = '-') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function taskAddressLabel(task) {
  return [task?.adres, task?.miasto]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function taskPhoneNumber(task) {
  return String(task?.klient_telefon || task?.telefon || '').trim();
}

function taskMapSearchLink(task) {
  const address = taskAddressLabel(task);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
}

function taskEndTime(task) {
  return minutesToTime(taskRangeMinutes(task).end);
}

function taskValueLabel(task) {
  const value = Number(task?.wartosc_planowana || task?.budzet || task?.wartosc_zaproponowana || task?.wartosc_szacowana || 0) || 0;
  return value ? `${value.toLocaleString('pl-PL')} PLN` : 'brak ceny';
}

function taskReservationEquipmentRows(rezerwacje, task, day) {
  return (rezerwacje || [])
    .filter(activeReservation)
    .filter((rez) => String(rez?.task_id || '') === String(task?.id || ''))
    .filter((rez) => !day || reservationOverlapsDay(rez, day));
}

function reservationEquipmentName(rez, equipmentById) {
  const item = equipmentById?.get?.(String(rez?.sprzet_id || ''));
  return compactText(item?.nazwa || rez?.sprzet_nazwa || (rez?.sprzet_id ? `Sprzet #${rez.sprzet_id}` : ''), '');
}

function taskBriefEquipmentLabel(rezerwacje, task, day, equipmentById) {
  const rows = taskReservationEquipmentRows(rezerwacje, task, day);
  const names = rows
    .map((rez) => reservationEquipmentName(rez, equipmentById))
    .filter(Boolean);
  const note = compactText(taskFieldEquipment(task), '');
  const uniqueNames = [...new Set(names)];
  if (note && uniqueNames.length) return `${uniqueNames.join(', ')} | ${note}`;
  if (note) return note;
  if (uniqueNames.length) return uniqueNames.join(', ');
  return 'brak rezerwacji';
}

function buildTaskDayBriefLine(task, index, rezerwacje, day, equipmentById, teamsById) {
  const range = taskRangeMinutes(task);
  const team = teamsById?.get?.(String(task?.ekipa_id || ''));
  const risk = compactText(taskRiskBrief(task), 'brak wpisu BHP');
  const settlement = compactText(taskFieldSettlement(task), taskValueLabel(task));
  const phone = taskPhoneNumber(task);
  const mapLink = taskMapSearchLink(task);
  return [
    `${index + 1}. #${task?.id || '-'} | ${minutesToTime(range.start)}-${taskEndTime(task)} | ${taskClientLabel(task)}`,
    `Adres: ${compactText(taskAddressLabel(task), 'brak adresu')}`,
    `Ekipa: ${team?.nazwa || task?.ekipa_nazwa || (task?.ekipa_id ? `#${task.ekipa_id}` : 'brak')}`,
    `Zakres: ${compactText(taskWorkBrief(task), 'brak opisu')}`,
    `BHP / ryzyka: ${risk}`,
    `Sprzet: ${taskBriefEquipmentLabel(rezerwacje, task, day, equipmentById)}`,
    `Czas: ${taskHours(task)} h | Cena: ${settlement} | Foto: ${taskPhotoTotal(task)}`,
    `Akceptacja klienta: ${taskClientAccepted(task) ? 'tak' : 'do potwierdzenia'}`,
    phone ? `Telefon: ${phone}` : '',
    mapLink ? `Mapa: ${mapLink}` : '',
  ].filter(Boolean).join('\n');
}

function buildDayBrief({
  dayISO,
  dayLabel,
  scheduledTasks,
  visibleTeams,
  attendanceByTeam,
  rezerwacje,
  equipmentById,
  teamsById,
  branchOptions,
  selectedBranchId,
  dayOpsSummary,
  delegationSummary,
}) {
  const branchName = selectedBranchId
    ? branchOptions.find((branch) => String(branch.id) === String(selectedBranchId))?.nazwa || `Oddzial #${selectedBranchId}`
    : 'wszystkie oddzialy';
  const visibleTeamIds = new Set((visibleTeams || []).map((team) => String(team.id)));
  const dayTasks = (scheduledTasks || [])
    .filter((task) => taskDate(task) === dayISO)
    .filter((task) => !visibleTeamIds.size || visibleTeamIds.has(String(task?.ekipa_id || '')))
    .slice()
    .sort((a, b) => {
      const teamA = String(a?.ekipa_id || '');
      const teamB = String(b?.ekipa_id || '');
      return teamA.localeCompare(teamB) || taskTime(a).localeCompare(taskTime(b)) || String(a.id).localeCompare(String(b.id));
    });

  const header = [
    'ARBOR-OS | Odprawa dnia',
    `Data: ${dayISO} (${dayLabel})`,
    `Oddzial: ${branchName}`,
    `Zlecenia: ${dayOpsSummary.tasks} | Rezerwacje sprzetu: ${dayOpsSummary.equipment} | Kolizje: ${dayOpsSummary.teamConflicts + dayOpsSummary.equipmentConflicts}`,
    `Braki: zdjecia ${dayOpsSummary.noPhotos}, opis ${dayOpsSummary.noBrief}, sprzet ${dayOpsSummary.noEquipment}`,
    `Nieobecne ekipy: ${dayOpsSummary.absentTeams || 0}`,
    `Delegacje: ${delegationSummary.delegated.length}`,
  ];
  const absentTeamNotes = (visibleTeams || [])
    .map((team) => {
      const attendance = attendanceByTeam?.get?.(String(team.id));
      if (attendance?.present !== false) return '';
      return `${team.nazwa || `Ekipa #${team.id}`}${attendance.note ? ` - ${attendance.note}` : ''}`;
    })
    .filter(Boolean);
  const headerRows = absentTeamNotes.length ? [...header, `Nieobecne: ${absentTeamNotes.join('; ')}`] : header;

  if (!dayTasks.length) {
    return `${headerRows.join('\n')}\n\nBrak zaplanowanych zlecen na ten dzien.`;
  }

  const teamOrder = new Map((visibleTeams || []).map((team, index) => [String(team.id), index]));
  const grouped = new Map();
  for (const task of dayTasks) {
    const key = String(task?.ekipa_id || 'bez-ekipy');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }

  const teamSections = [...grouped.entries()]
    .sort(([a], [b]) => (teamOrder.get(a) ?? 9999) - (teamOrder.get(b) ?? 9999) || a.localeCompare(b))
    .map(([teamId, rows]) => {
      const team = teamsById?.get?.(teamId);
      const title = team?.nazwa || rows[0]?.ekipa_nazwa || (teamId === 'bez-ekipy' ? 'Bez ekipy' : `Ekipa #${teamId}`);
      const delegation = team && isTeamDelegatedToView(team) ? ` (${teamDelegationLabel(team)})` : '';
      const attendanceStatus = attendanceLine(attendanceByTeam?.get?.(teamId));
      return [
        `\n=== ${title}${delegation} ===`,
        attendanceStatus ? `Status ekipy: ${attendanceStatus}` : '',
        ...rows.map((task, index) => buildTaskDayBriefLine(task, index, rezerwacje, dayISO, equipmentById, teamsById)),
      ].filter(Boolean).join('\n\n');
    });

  return `${headerRows.join('\n')}\n${teamSections.join('\n')}`;
}

function dayReservationConflicts(rezerwacje, day, visibleEquipmentIds = null) {
  const byEquipment = new Map();
  for (const rez of rezerwacje || []) {
    if (!activeReservation(rez) || !reservationOverlapsDay(rez, day)) continue;
    const equipmentId = String(rez?.sprzet_id || '');
    if (!equipmentId) continue;
    if (visibleEquipmentIds && !visibleEquipmentIds.has(equipmentId)) continue;
    if (!byEquipment.has(equipmentId)) byEquipment.set(equipmentId, []);
    byEquipment.get(equipmentId).push(rez);
  }
  return [...byEquipment.values()].filter((rows) => rows.length > 1);
}

function buildSlotSuggestions(tasks, task, form) {
  const teamId = String(form?.ekipa_id || '');
  const day = String(form?.data_planowana || '');
  if (!teamId || !day) return [];
  const duration = formDurationMinutes(form, task);
  const workStart = DAY_START_HOUR * 60;
  const workEnd = DAY_END_HOUR * 60;
  const ranges = (tasks || [])
    .filter((row) => String(row?.id) !== String(task?.id))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDate(row) === day)
    .filter((row) => ACTIVE_TASK_STATUSES.has(row.status))
    .map((row) => taskRangeMinutes(row))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const suggestions = [];
  let cursor = workStart;
  const addFromGap = (start, end) => {
    let value = roundUpToStep(start, 30);
    while (value + duration <= end && suggestions.length < 6) {
      suggestions.push({
        time: minutesToTime(value),
        end: minutesToTime(value + duration),
        minutes: duration,
      });
      value += 30;
    }
  };

  for (const range of ranges) {
    const start = clamp(range.start, workStart, workEnd);
    const end = clamp(range.end, workStart, workEnd);
    if (start - cursor >= duration) addFromGap(cursor, start);
    cursor = Math.max(cursor, end);
    if (suggestions.length >= 6) break;
  }
  if (workEnd - cursor >= duration) addFromGap(cursor, workEnd);
  return suggestions;
}

function formPlanRange(form, task) {
  const start = timeToMinutes(form?.godzina_rozpoczecia || taskTime(task));
  const duration = formDurationMinutes(form, task);
  return { start, end: start + duration, duration };
}

function buildPlanWarnings(tasks, task, form) {
  const teamId = String(form?.ekipa_id || '');
  const day = String(form?.data_planowana || '');
  if (!teamId || !day) return { conflicts: [], outsideWorkday: false };
  const range = formPlanRange(form, task);
  const workStart = DAY_START_HOUR * 60;
  const workEnd = DAY_END_HOUR * 60;
  const outsideWorkday = range.start < workStart || range.end > workEnd;
  const conflicts = (tasks || [])
    .filter((row) => String(row?.id) !== String(task?.id))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDate(row) === day)
    .filter((row) => ACTIVE_TASK_STATUSES.has(row.status))
    .filter((row) => {
      const busy = taskRangeMinutes(row);
      return range.start < busy.end && range.end > busy.start;
    })
    .slice(0, 3);
  return { conflicts, outsideWorkday };
}

function taskPhotoTotal(task) {
  return Number(task?.photo_total || task?.photos_count || task?.zdjecia_count || 0) || 0;
}

function taskFieldEvidenceTotal(task) {
  return (
    Number(task?.photo_wycena || task?.photos_wycena || 0) +
    Number(task?.photo_szkic || task?.photos_szkic || 0) +
    Number(task?.photo_dojazd || task?.photos_dojazd || 0)
  ) || 0;
}

function normalizePlanningMissingKey(keyOrLabel) {
  const key = String(keyOrLabel || '').toLowerCase();
  if (key.includes('photo') || key.includes('zdj') || key.includes('dowod')) return 'photos';
  if (key.includes('scope') || key.includes('brief') || key.includes('zakres')) return 'brief';
  if (key.includes('risk') || key.includes('bhp')) return 'risk';
  if (key.includes('money') || key.includes('price') || key.includes('cena')) return 'price';
  if (key.includes('equipment') || key.includes('sprzet')) return 'equipment';
  if (key.includes('team') || key.includes('ekipa') || key.includes('slot') || key.includes('date') || key.includes('termin') || key.includes('time') || key.includes('czas')) return 'teamTime';
  return 'teamTime';
}

function getOfficePlanChecksFromApi(task) {
  const rows = Array.isArray(task?.office_plan_checks) ? task.office_plan_checks : [];
  return rows
    .map((row) => {
      const label = String(row?.label || row?.key || '').trim();
      if (!label) return null;
      const ready = row?.ready === true || row?.ok === true;
      return {
        key: normalizePlanningMissingKey(row?.key || label),
        label,
        ready,
      };
    })
    .filter(Boolean);
}

function buildPlanningQueueRow(task) {
  const photoTotal = taskPhotoTotal(task);
  const fieldEvidence = taskFieldEvidenceTotal(task);
  const apiChecks = getOfficePlanChecksFromApi(task);
  const missing = apiChecks.length ? apiChecks.filter((item) => !item.ready) : [
    photoTotal > 0 ? null : { key: 'photos', label: 'zdjecia' },
    fieldEvidence > 0 ? null : { key: 'photos', label: 'szkic' },
    taskWorkBrief(task) ? null : { key: 'brief', label: 'zakres' },
    taskRiskBrief(task) ? null : { key: 'risk', label: 'BHP' },
    task?.wartosc_planowana || task?.budzet ? null : { key: 'price', label: 'cena' },
    task?.czas_planowany_godziny || task?.czas_realizacji_godz ? null : { key: 'teamTime', label: 'czas' },
    task?.data_planowana ? null : { key: 'teamTime', label: 'data' },
    task?.ekipa_id ? null : { key: 'teamTime', label: 'ekipa' },
  ].filter(Boolean);
  return {
    task,
    photoTotal,
    fieldEvidence,
    missing,
    ready: typeof task?.office_plan_ready === 'boolean' ? task.office_plan_ready : missing.length === 0,
    value: Number(task?.wartosc_planowana || task?.budzet || 0) || 0,
  };
}

function getPlanningQueueFocus(row) {
  const keys = new Set((row?.missing || []).map((item) => item.key));
  if (keys.has('photos')) return 'photos';
  if (keys.has('brief') || keys.has('risk')) return 'crewBrief';
  if (keys.has('equipment')) return 'equipment';
  if (keys.has('price')) return 'decision';
  return 'officePlan';
}

function isPlanningQueuePlanAction(row) {
  const keys = new Set((row?.missing || []).map((item) => item.key));
  const hasFieldOrOfficeMissing = ['photos', 'brief', 'risk', 'price', 'equipment'].some((key) => keys.has(key));
  return Boolean(row?.ready || !hasFieldOrOfficeMissing);
}

function getPlanningQueueRepairLabel(row) {
  const keys = new Set((row?.missing || []).map((item) => item.key));
  if (keys.has('photos')) return 'Dodaj zdjecia';
  if (keys.has('brief') || keys.has('risk')) return 'Pakiet terenowy';
  if (keys.has('equipment')) return 'Sprzet';
  if (keys.has('price')) return 'Cena/decyzja';
  if (isPlanningQueuePlanAction(row)) return 'Planuj';
  return 'Napraw braki';
}

function canSeeAllBranches(user) {
  return ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);
}

function buildRange(anchor, days) {
  // zwraca tablicę Date — `days` dni zaczynając od poniedziałku tygodnia anchor
  const d = new Date(anchor);
  const dow = d.getDay();
  const pon = new Date(d);
  pon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: days }, (_, i) => addDays(pon, i));
}

// ─── modal nowej rezerwacji ───────────────────────────────────────────────────
function NowaRezerwacjaModal({ sprzet, ekipy, defaultSprzet, defaultDate, onSave, onClose, saving, error }) {
  const [form, setForm] = useState({
    sprzet_id:  String(defaultSprzet || ''),
    ekipa_id:   '',
    data_od:    defaultDate || toISO(new Date()),
    data_do:    defaultDate || toISO(new Date()),
    status:     'Zarezerwowane',
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={mStyles.panel} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Nowa rezerwacja sprzętu</h3>

        <label style={mStyles.label}>Sprzęt</label>
        <select style={mStyles.select} value={form.sprzet_id} onChange={e => set('sprzet_id', e.target.value)}>
          <option value="">— wybierz —</option>
          {sprzet.map(s => <option key={s.id} value={s.id}>{s.nazwa}{s.typ ? ` (${s.typ})` : ''}</option>)}
        </select>

        <label style={mStyles.label}>Ekipa</label>
        <select style={mStyles.select} value={form.ekipa_id} onChange={e => set('ekipa_id', e.target.value)}>
          <option value="">— wybierz —</option>
          {ekipy.map(e => (
            <option key={`${e.id}-${teamBranchId(e)}-${e.delegacja_id || 'native'}`} value={e.id}>
              {e.nazwa}{isTeamDelegatedToView(e) ? ` (${teamDelegationLabel(e)})` : ''}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={mStyles.label}>Od</label>
            <input type="date" style={mStyles.input} value={form.data_od} onChange={e => set('data_od', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={mStyles.label}>Do</label>
            <input type="date" style={mStyles.input} value={form.data_do} onChange={e => set('data_do', e.target.value)} />
          </div>
        </div>

        <label style={mStyles.label}>Status</label>
        <select style={mStyles.select} value={form.status} onChange={e => set('status', e.target.value)}>
          {['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {error && <div style={{ color: 'var(--error)', fontSize: 13, margin: '8px 0 0' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button style={mStyles.btnCancel} onClick={onClose}>Anuluj</button>
          <button style={mStyles.btnSave} disabled={saving}
            onClick={() => onSave(form)}>
            {saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

const mStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  panel:   { background: 'var(--surface-glass)', borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 460, width: '90vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
  label:   { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, marginTop: 12 },
  select:  { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14 },
  input:   { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  textarea: { width: '100%', minHeight: 84, resize: 'vertical', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  modalHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  subtle: { marginTop: 4, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.35 },
  statusPill: { padding: '4px 8px', borderRadius: 999, background: 'rgba(34,197,94,0.14)', color: 'var(--accent)', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  fieldPackagePanel: {
    border: '1px solid rgba(34,197,94,0.28)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(34,197,94,0.1), var(--surface-field))',
    padding: 12,
    marginBottom: 12,
    display: 'grid',
    gap: 10,
  },
  fieldPackageHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  fieldPackageEyebrow: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  fieldPackageTitle: {
    display: 'block',
    marginTop: 2,
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 900,
  },
  fieldPackagePill: {
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900,
    border: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  fieldPackagePillOk: {
    color: '#16a34a',
    border: '1px solid rgba(34,197,94,0.36)',
    background: 'rgba(34,197,94,0.12)',
  },
  fieldPackagePillWarn: {
    color: '#b45309',
    border: '1px solid rgba(245,158,11,0.36)',
    background: 'rgba(245,158,11,0.12)',
  },
  fieldPackageChecks: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
    gap: 7,
  },
  fieldPackageCheck: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: '7px 8px',
    display: 'grid',
    gap: 3,
    minWidth: 0,
  },
  fieldPackageCheckOk: {
    border: '1px solid rgba(34,197,94,0.28)',
    background: 'rgba(34,197,94,0.08)',
  },
  fieldPackageCheckWarn: {
    border: '1px solid rgba(245,158,11,0.32)',
    background: 'rgba(245,158,11,0.08)',
  },
  fieldPackageCheckStatus: {
    color: 'var(--text-muted)',
    fontSize: 9.5,
    lineHeight: 1,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  fieldPackageCheckLabel: {
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.15,
    fontWeight: 900,
  },
  fieldPackageCheckDetail: {
    color: 'var(--text-muted)',
    fontSize: 10.5,
    lineHeight: 1.25,
    fontWeight: 700,
    overflowWrap: 'anywhere',
  },
  fieldPackageBriefGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
  },
  fieldPackageTextBlock: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.08)',
    padding: '8px 9px',
    minWidth: 0,
  },
  fieldPackageTextLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    lineHeight: 1.1,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  fieldPackageTextBody: {
    margin: '5px 0 0',
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 700,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  fieldPhotoStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(124px, 1fr))',
    gap: 8,
  },
  fieldPhotoCard: {
    display: 'grid',
    gap: 5,
    textDecoration: 'none',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    overflow: 'hidden',
    minWidth: 0,
  },
  fieldPhotoImg: {
    width: '100%',
    height: 92,
    objectFit: 'cover',
    display: 'block',
    background: 'var(--surface-field)',
  },
  fieldPhotoType: {
    padding: '0 8px 8px',
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.2,
    fontWeight: 900,
    textTransform: 'uppercase',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fieldPhotoEmpty: {
    gridColumn: '1 / -1',
    border: '1px dashed var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    background: 'rgba(0,0,0,0.08)',
    padding: 10,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  slotPanel: { marginTop: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(34,197,94,0.06)' },
  slotHead: { display: 'flex', justifyContent: 'space-between', gap: 10, color: 'var(--text)', fontSize: 12, marginBottom: 8, flexWrap: 'wrap' },
  slotList: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  slotBtn: { border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)', color: 'var(--text)', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, fontSize: 12, fontWeight: 800 },
  slotEmpty: { color: 'var(--text-muted)', fontSize: 12, fontWeight: 700 },
  planWarning: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e', fontSize: 12, fontWeight: 700, lineHeight: 1.45 },
  absenceGuard: { marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.34)', color: '#991b1b', fontSize: 12, fontWeight: 800, lineHeight: 1.45, display: 'grid', gap: 7 },
  absenceConfirm: { display: 'flex', alignItems: 'flex-start', gap: 8, color: '#7f1d1d', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  warningList: { margin: '6px 0 0', paddingLeft: 18 },
  errorBox: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.32)', color: '#ef4444', fontSize: 12, fontWeight: 700 },
  linkedTaskBox: { marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.24)', lineHeight: 1.55 },
  multiSelect: { minHeight: 112, lineHeight: 1.35 },
  equipmentHint: { marginTop: 6, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.35, fontWeight: 700 },
  equipmentActions: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  tinyBtn: { padding: '5px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  actionsRow: { display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end', flexWrap: 'wrap' },
  btnCancel: { padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 14 },
  btnGhost: { padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  btnSave:   { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
};

// ─── podgląd/edycja istniejącej rezerwacji ────────────────────────────────────
function RezerwacjaDetailModal({ rez, ekipy, onStatusChange, onOpenTask, onClose, saving }) {
  const [status, setStatus] = useState(rez.status);
  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={mStyles.panel} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Rezerwacja #{rez.id}</h3>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <div><b>Sprzęt:</b> {rez.sprzet_nazwa}</div>
          <div><b>Ekipa:</b> {rez.ekipa_nazwa}</div>
          <div><b>Od:</b> {rez.data_od?.slice(0,10)}</div>
          <div><b>Do:</b> {rez.data_do?.slice(0,10)}</div>
          {rez.task_id && (
            <div style={mStyles.linkedTaskBox}>
              <div><b>Zlecenie:</b> #{rez.task_id} {rez.task_klient_nazwa || ''}</div>
              {rez.task_adres && <div><b>Adres:</b> {rez.task_adres}</div>}
              {rez.notatki && <div><b>Uwagi:</b> {rez.notatki}</div>}
            </div>
          )}
        </div>
        <label style={mStyles.label}>Status</label>
        <select style={mStyles.select} value={status} onChange={e => setStatus(e.target.value)}>
          {['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button style={mStyles.btnCancel} onClick={onClose}>Zamknij</button>
          {rez.task_id && <button style={mStyles.btnGhost} onClick={onOpenTask}>Otworz zlecenie</button>}
          <button style={mStyles.btnSave} disabled={saving || status === rez.status}
            onClick={() => onStatusChange(rez.id, status)}>
            {saving ? 'Zapisuję…' : 'Zapisz status'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── główny komponent ────────────────────────────────────────────────────────
function TaskPlanModal({ task, teams, tasks, sprzet, rezerwacje, attendanceByTeam, onSave, onClose, onOpenTask, saving, error }) {
  const existingEquipmentIds = useMemo(
    () => taskReservationEquipmentIds(rezerwacje, task?.id),
    [rezerwacje, task?.id],
  );
  const fieldEquipmentNote = taskFieldEquipment(task);
  const [form, setForm] = useState({
    data_planowana: taskDate(task) || toISO(new Date()),
    godzina_rozpoczecia: taskTime(task),
    czas_planowany_godziny: String(taskHours(task)),
    ekipa_id: task.ekipa_id ? String(task.ekipa_id) : '',
    sprzet_notatka: fieldEquipmentNote,
    sprzet_ids: existingEquipmentIds,
  });
  const [taskPhotos, setTaskPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState('');
  const [absenceOverride, setAbsenceOverride] = useState(false);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setEquipment = (selectedOptions) => {
    const ids = Array.from(selectedOptions || []).map((option) => option.value).filter(Boolean);
    set('sprzet_ids', ids);
  };
  useEffect(() => {
    let ignore = false;
    async function loadTaskPhotos() {
      if (!task?.id) return;
      setPhotosLoading(true);
      setPhotosError('');
      try {
        const token = getStoredToken();
        const { data } = await api.get(`/tasks/${task.id}/zdjecia`, { headers: authHeaders(token), dedupe: false });
        if (!ignore) setTaskPhotos(Array.isArray(data) ? data : []);
      } catch {
        if (!ignore) {
          setTaskPhotos([]);
          setPhotosError('Nie udalo sie pobrac zdjec z pakietu terenowego.');
        }
      } finally {
        if (!ignore) setPhotosLoading(false);
      }
    }
    loadTaskPhotos();
    return () => {
      ignore = true;
    };
  }, [task?.id]);
  const { ekipa_id, data_planowana, godzina_rozpoczecia, czas_planowany_godziny } = form;
  const fieldBrief = taskWorkBrief(task);
  const fieldRisk = taskRiskBrief(task);
  const fieldSettlement = taskFieldSettlement(task);
  const acceptedByClient = taskClientAccepted(task);
  const photoTotal = taskPhotos.length || Number(task?.photo_total || task?.photos_count || 0) || 0;
  const fieldEvidenceCount = taskPhotos.filter((photo) => {
    const type = String(photo?.typ || '').toLowerCase();
    return ['wycena', 'szkic', 'sketch', 'przed', 'checkin', 'dojazd', 'posesja', 'dojazd_posesja'].includes(type);
  }).length || Number(task?.photo_wycena || 0) + Number(task?.photo_szkic || 0) + Number(task?.photo_dojazd || 0);
  const packageChecks = [
    { key: 'photos', label: 'Zdjecia', ok: photoTotal > 0, detail: photoTotal ? `${photoTotal} razem, ${fieldEvidenceCount || 0} z terenu` : 'brak zdjec/szkicu' },
    { key: 'brief', label: 'Zakres', ok: Boolean(fieldBrief), detail: fieldBrief ? 'jest opis dla brygady' : 'brak opisu prac' },
    { key: 'time', label: 'Czas', ok: Number(czas_planowany_godziny) > 0, detail: Number(czas_planowany_godziny) > 0 ? `${czas_planowany_godziny} h` : 'brak czasu' },
    { key: 'budget', label: 'Budzet', ok: Boolean(task?.wartosc_planowana || task?.budzet), detail: task?.wartosc_planowana ? `${Number(task.wartosc_planowana).toLocaleString('pl-PL')} PLN` : 'brak ceny' },
    { key: 'risk', label: 'BHP', ok: Boolean(fieldRisk), detail: fieldRisk ? 'ryzyka wpisane' : 'brak ryzyk' },
    { key: 'accepted', label: 'Klient', ok: acceptedByClient || task.status !== 'Do_Zatwierdzenia', detail: acceptedByClient ? 'akceptacja w terenie' : 'sprawdz akceptacje' },
  ];
  const packageReadyCount = packageChecks.filter((item) => item.ok).length;
  const packageReady = packageReadyCount === packageChecks.length;
  const selectedTeam = useMemo(
    () => (teams || []).find((team) => String(team.id) === String(ekipa_id)),
    [ekipa_id, teams],
  );
  const selectedAttendance = attendanceByTeam?.get?.(String(ekipa_id));
  const selectedTeamAbsent = selectedAttendance?.present === false;
  useEffect(() => {
    setAbsenceOverride(false);
  }, [data_planowana, ekipa_id]);
  const previewPhotos = taskPhotos
    .filter((photo) => photo?.sciezka || photo?.url)
    .filter((photo) => ['wycena', 'szkic', 'sketch', 'przed', 'checkin', 'dojazd', 'posesja', 'dojazd_posesja'].includes(String(photo?.typ || '').toLowerCase()))
    .concat(taskPhotos
      .filter((photo) => photo?.sciezka || photo?.url)
      .filter((photo) => !['wycena', 'szkic', 'sketch', 'przed', 'checkin', 'dojazd', 'posesja', 'dojazd_posesja'].includes(String(photo?.typ || '').toLowerCase())))
    .slice(0, 4);
  const equipmentOptions = useMemo(() => {
    const selected = new Set((form.sprzet_ids || []).map(String));
    const taskBranch = taskBranchId(task);
    return [...(sprzet || [])]
      .filter((item) => {
        const sameBranch = !taskBranch || !equipmentBranchId(item) || equipmentBranchId(item) === taskBranch;
        return selected.has(String(item.id)) || (sameBranch && !isEquipmentUnavailable(item));
      })
      .sort((a, b) => {
        const aTeam = ekipa_id && String(a.ekipa_id || '') === String(ekipa_id) ? 0 : 1;
        const bTeam = ekipa_id && String(b.ekipa_id || '') === String(ekipa_id) ? 0 : 1;
        if (aTeam !== bTeam) return aTeam - bTeam;
        return String(a.typ || '').localeCompare(String(b.typ || ''), 'pl') || String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl');
      });
  }, [ekipa_id, form.sprzet_ids, sprzet, task]);
  const selectedEquipment = useMemo(
    () => equipmentOptions.filter((item) => (form.sprzet_ids || []).some((id) => String(id) === String(item.id))),
    [equipmentOptions, form.sprzet_ids],
  );
  const equipmentConflicts = useMemo(() => {
    if (!data_planowana || !(form.sprzet_ids || []).length) return [];
    const selected = new Set((form.sprzet_ids || []).map(String));
    return (rezerwacje || [])
      .filter(activeReservation)
      .filter((rez) => selected.has(String(rez.sprzet_id)))
      .filter((rez) => String(rez.task_id || '') !== String(task?.id || ''))
      .filter((rez) => reservationOverlapsDay(rez, data_planowana))
      .slice(0, 6);
  }, [data_planowana, form.sprzet_ids, rezerwacje, task?.id]);
  const teamEquipmentIds = useMemo(
    () => equipmentOptions
      .filter((item) => ekipa_id && String(item.ekipa_id || '') === String(ekipa_id))
      .map((item) => String(item.id)),
    [ekipa_id, equipmentOptions],
  );
  const slotSuggestions = useMemo(
    () => buildSlotSuggestions(tasks, task, { ekipa_id, data_planowana, czas_planowany_godziny }),
    [tasks, task, ekipa_id, data_planowana, czas_planowany_godziny],
  );
  const planWarnings = useMemo(
    () => buildPlanWarnings(tasks, task, { ekipa_id, data_planowana, godzina_rozpoczecia, czas_planowany_godziny }),
    [tasks, task, ekipa_id, data_planowana, godzina_rozpoczecia, czas_planowany_godziny],
  );

  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={{ ...mStyles.panel, maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
        <div style={mStyles.modalHead}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>Plan zlecenia #{task.id}</h3>
            <div style={mStyles.subtle}>{taskClientLabel(task)} · {task.miasto || task.adres || 'brak adresu'}</div>
          </div>
          <span style={mStyles.statusPill}>{task.status || 'Nowe'}</span>
        </div>

        <section style={mStyles.fieldPackagePanel}>
          <div style={mStyles.fieldPackageHead}>
            <div>
              <div style={mStyles.fieldPackageEyebrow}>Pakiet z terenu</div>
              <strong style={mStyles.fieldPackageTitle}>
                {packageReady ? 'Gotowe do planowania ekipy' : `Gotowosc ${packageReadyCount}/${packageChecks.length}`}
              </strong>
            </div>
            <span style={{ ...mStyles.fieldPackagePill, ...(packageReady ? mStyles.fieldPackagePillOk : mStyles.fieldPackagePillWarn) }}>
              {packageReady ? 'komplet' : 'sprawdz braki'}
            </span>
          </div>

          <div style={mStyles.fieldPackageChecks}>
            {packageChecks.map((item) => (
              <div
                key={item.key}
                style={{
                  ...mStyles.fieldPackageCheck,
                  ...(item.ok ? mStyles.fieldPackageCheckOk : mStyles.fieldPackageCheckWarn),
                }}
              >
                <span style={mStyles.fieldPackageCheckStatus}>{item.ok ? 'OK' : 'Brak'}</span>
                <strong style={mStyles.fieldPackageCheckLabel}>{item.label}</strong>
                <small style={mStyles.fieldPackageCheckDetail}>{item.detail}</small>
              </div>
            ))}
          </div>

          <div style={mStyles.fieldPackageBriefGrid}>
            <div style={mStyles.fieldPackageTextBlock}>
              <span style={mStyles.fieldPackageTextLabel}>Zakres dla brygady</span>
              <p style={mStyles.fieldPackageTextBody}>{fieldBrief || 'Brak opisu prac. Otworz pelne zlecenie albo uzupelnij pakiet przed planowaniem.'}</p>
            </div>
            <div style={mStyles.fieldPackageTextBlock}>
              <span style={mStyles.fieldPackageTextLabel}>Ryzyka / BHP</span>
              <p style={mStyles.fieldPackageTextBody}>{fieldRisk || 'Brak wpisanych ryzyk. Kierownik powinien sprawdzic dojazd, linie, ogrodzenia i strefe pracy.'}</p>
            </div>
            <div style={mStyles.fieldPackageTextBlock}>
              <span style={mStyles.fieldPackageTextLabel}>Warunki klienta</span>
              <p style={mStyles.fieldPackageTextBody}>{fieldSettlement || (acceptedByClient ? 'Klient zaakceptowal zakres i budzet w terenie.' : 'Brak warunkow rozliczenia z pakietu terenowego.')}</p>
            </div>
          </div>

          <div style={mStyles.fieldPhotoStrip}>
            {photosLoading ? (
              <div style={mStyles.fieldPhotoEmpty}>Ladowanie zdjec...</div>
            ) : photosError ? (
              <div style={mStyles.fieldPhotoEmpty}>{photosError}</div>
            ) : previewPhotos.length ? (
              previewPhotos.map((photo) => (
                <a
                  key={photo.id || photo.sciezka || photo.url}
                  href={taskAssetUrl(photo.sciezka || photo.url)}
                  target="_blank"
                  rel="noreferrer"
                  style={mStyles.fieldPhotoCard}
                >
                  <img src={taskAssetUrl(photo.sciezka || photo.url)} alt={photo.opis || photo.typ || 'Zdjecie z terenu'} style={mStyles.fieldPhotoImg} />
                  <span style={mStyles.fieldPhotoType}>{photo.typ || 'Zdjecie'}</span>
                </a>
              ))
            ) : (
              <div style={mStyles.fieldPhotoEmpty}>Brak zdjec z wyceny. To ryzyko sporu z klientem i blednej odprawy ekipy.</div>
            )}
          </div>
        </section>

        <div style={mStyles.formGrid}>
          <div>
            <label style={mStyles.label}>Data</label>
            <input type="date" style={mStyles.input} value={form.data_planowana} onChange={(e) => set('data_planowana', e.target.value)} />
          </div>
          <div>
            <label style={mStyles.label}>Godzina</label>
            <input type="time" style={mStyles.input} value={form.godzina_rozpoczecia} onChange={(e) => set('godzina_rozpoczecia', e.target.value)} />
          </div>
          <div>
            <label style={mStyles.label}>Czas pracy (h)</label>
            <input type="number" min="0.25" step="0.25" style={mStyles.input} value={form.czas_planowany_godziny} onChange={(e) => set('czas_planowany_godziny', e.target.value)} />
          </div>
          <div>
            <label style={mStyles.label}>Ekipa</label>
            <select style={mStyles.select} value={form.ekipa_id} onChange={(e) => set('ekipa_id', e.target.value)}>
              <option value="">- wybierz ekipe -</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.nazwa || `Ekipa #${team.id}`}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedTeamAbsent && (
          <div style={mStyles.absenceGuard}>
            <strong>Ekipa jest nieobecna</strong>
            <span>
              {selectedTeam?.nazwa || `Ekipa #${ekipa_id}`} ma status: {attendanceLine(selectedAttendance)}.
              Zapis planu wymaga swiadomego potwierdzenia kierownika.
            </span>
            <label style={mStyles.absenceConfirm}>
              <input
                type="checkbox"
                checked={absenceOverride}
                onChange={(event) => setAbsenceOverride(event.target.checked)}
              />
              Potwierdzam decyzje kierownika i plan mimo braku gotowosci ekipy.
            </label>
          </div>
        )}

        <label style={mStyles.label}>Sprzet do zlecenia</label>
        <select
          multiple
          style={{ ...mStyles.select, ...mStyles.multiSelect }}
          value={form.sprzet_ids || []}
          onChange={(e) => setEquipment(e.target.selectedOptions)}
        >
          {equipmentOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {[item.typ, item.nazwa || `Sprzet #${item.id}`, item.ekipa_nazwa ? `(${item.ekipa_nazwa})` : ''].filter(Boolean).join(' - ')}
            </option>
          ))}
        </select>
        <div style={mStyles.equipmentHint}>
          {selectedEquipment.length
            ? `Wybrano: ${selectedEquipment.map((item) => item.nazwa || `#${item.id}`).join(', ')}`
            : 'Brak wybranego sprzetu - plan zapisze sam termin i ekipe.'}
        </div>
        <div style={mStyles.equipmentActions}>
          <button
            type="button"
            style={mStyles.tinyBtn}
            disabled={!teamEquipmentIds.length}
            onClick={() => set('sprzet_ids', teamEquipmentIds)}
          >
            Sprzet tej ekipy
          </button>
          <button
            type="button"
            style={mStyles.tinyBtn}
            onClick={() => set('sprzet_ids', [])}
          >
            Wyczysc
          </button>
        </div>

        {equipmentConflicts.length > 0 && (
          <div style={mStyles.planWarning}>
            <div>Uwaga: wybrany sprzet ma rezerwacje w tym dniu:</div>
            <ul style={mStyles.warningList}>
              {equipmentConflicts.map((rez) => (
                <li key={rez.id}>
                  {rez.sprzet_nazwa || `#${rez.sprzet_id}`} - {rez.ekipa_nazwa || 'inna ekipa'}{rez.task_id ? `, zlecenie #${rez.task_id}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={mStyles.slotPanel}>
          <div style={mStyles.slotHead}>
            <strong>Najblizsze wolne sloty</strong>
            <span>
              {form.ekipa_id && form.data_planowana
                ? `${form.data_planowana} - ${form.czas_planowany_godziny || taskHours(task)} h`
                : 'wybierz ekipe i date'}
            </span>
          </div>
          {slotSuggestions.length ? (
            <div style={mStyles.slotList}>
              {slotSuggestions.map((slot) => (
                <button
                  key={`${slot.time}-${slot.end}`}
                  type="button"
                  style={mStyles.slotBtn}
                  onClick={() => set('godzina_rozpoczecia', slot.time)}
                >
                  <strong>{slot.time}</strong>
                  <span>do {slot.end}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={mStyles.slotEmpty}>Brak wolnego slotu dla wybranej dlugosci w godzinach 08:00-18:00.</div>
          )}
        </div>

        {(planWarnings.outsideWorkday || planWarnings.conflicts.length > 0) && (
          <div style={mStyles.planWarning}>
            {planWarnings.outsideWorkday && <div>Wybrany czas wychodzi poza standardowe godziny pracy 08:00-18:00.</div>}
            {planWarnings.conflicts.length > 0 && (
              <>
                <div>Konflikt z innym zleceniem tej ekipy:</div>
                <ul style={mStyles.warningList}>
                  {planWarnings.conflicts.map((row) => {
                    const busy = taskRangeMinutes(row);
                    return (
                      <li key={row.id}>
                        #{row.id} {minutesToTime(busy.start)}-{minutesToTime(busy.end)} {taskClientLabel(row)}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        <label style={mStyles.label}>Uwagi dla brygady / sprzet</label>
        <textarea
          style={mStyles.textarea}
          value={form.sprzet_notatka}
          placeholder="np. zabrac rebak, zwyzka od 10:00, wjazd od bramy bocznej"
          onChange={(e) => set('sprzet_notatka', e.target.value)}
        />

        {error && <div style={mStyles.errorBox}>{error}</div>}

        <div style={mStyles.actionsRow}>
          <button style={mStyles.btnCancel} onClick={onClose}>Zamknij</button>
          <button style={mStyles.btnGhost} onClick={onOpenTask}>Pelne zlecenie</button>
          <button
            style={{
              ...mStyles.btnSave,
              ...((selectedTeamAbsent && !absenceOverride) ? mStyles.btnDisabled : {}),
            }}
            disabled={saving || (selectedTeamAbsent && !absenceOverride)}
            onClick={() => onSave(task, { ...form, absence_override: selectedTeamAbsent ? absenceOverride : false })}
          >
            {saving ? 'Zapisuje...' : 'Zapisz plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KalendarzZasobow() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialRouteDate = dateFromRouteSearch(location.search);
  const [currentUser, setCurrentUser] = useState(null);
  const [sprzet, setSprzet]   = useState([]);   // lista equipment_items
  const [ekipy, setEkipy]     = useState([]);
  const [branchTeams, setBranchTeams] = useState([]);
  const [tasks, setTasks]     = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [rezerwacje, setRezerwacje] = useState([]);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attendanceError, setAttendanceError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('teams');
  const [teamViewMode, setTeamViewMode] = useState('day');
  const [planningQueueFilter, setPlanningQueueFilter] = useState('all');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [rangeLen, setRangeLen] = useState(14);  // 14 lub 28 dni
  const [anchor, setAnchor]   = useState(() => anchorFromISODate(initialRouteDate) || new Date());
  const [msg, setMsg]         = useState('');
  const [msgType, setMsgType] = useState('ok');
  const [modalNew, setModalNew]  = useState(null);   // { sprzetId, date }
  const [modalDet, setModalDet]  = useState(null);   // rez object
  const [modalTaskPlan, setModalTaskPlan] = useState(null);
  const [saving, setSaving]  = useState(false);
  const [modalErr, setModalErr]  = useState('');
  const [taskPlanErr, setTaskPlanErr] = useState('');
  const deepLinkHandledRef = useRef('');

  // drag & drop state (ref — nie triggeruje re-renderu)
  const drag = useRef(null);
  const taskDrag = useRef(null);
  // highlight drop target
  const [dropTarget, setDropTarget] = useState(null); // { sprzetId, date }
  const [teamDropTarget, setTeamDropTarget] = useState(null);

  const canEdit = useMemo(() => {
    if (!currentUser) return false;
    return ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik'].includes(currentUser.rola);
  }, [currentUser]);

  const userCanSeeAllBranches = useMemo(() => canSeeAllBranches(currentUser), [currentUser]);

  // ─── zakres dat ──────────────────────────────────────────────────────────
  const days = useMemo(() => buildRange(anchor, rangeLen), [anchor, rangeLen]);
  const from = useMemo(() => toISO(days[0]), [days]);
  const to   = useMemo(() => toISO(days[days.length - 1]), [days]);
  const dayISO = useMemo(() => toISO(anchor), [anchor]);
  const daySlots = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i),
    []
  );
  const dayHourMarks = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    []
  );
  const dayTimelineHeight = (DAY_END_HOUR - DAY_START_HOUR) * DAY_HOUR_HEIGHT;

  const periodLabel = useMemo(() => {
    const a = days[0];
    const b = days[days.length - 1];
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()}–${b.getDate()} ${MIESIACE[a.getMonth()]} ${a.getFullYear()}`;
    }
    return `${a.getDate()} ${MIESIACE[a.getMonth()]} — ${b.getDate()} ${MIESIACE[b.getMonth()]} ${b.getFullYear()}`;
  }, [days]);

  const dayLabel = useMemo(() => {
    const d = new Date(anchor);
    return `${DNI_PL[d.getDay()]} ${d.getDate()} ${MIESIACE[d.getMonth()]} ${d.getFullYear()}`;
  }, [anchor]);

  const todayISO = toISO(new Date());
  const deepLinkParams = useMemo(() => new URLSearchParams(location.search || ''), [location.search]);
  const focusedTeamId = deepLinkParams.get('team') || '';
  const focusedDate = deepLinkParams.get('date') || '';
  const focusedEquipmentIds = useMemo(() => new Set(
    String(deepLinkParams.get('equipment') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  ), [deepLinkParams]);

  // ─── ładowanie danych ─────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const h = authHeaders(token);
    const user = getLocalStorageJson('user');
    const tasksEndpoint = canSeeAllBranches(user) ? '/tasks/wszystkie' : '/tasks';
    setLoading(true);
    try {
      const [sRes, eRes, oRes, tRes] = await Promise.all([
        api.get('/flota/sprzet', { headers: h }),
        api.get('/ekipy', { headers: h }),
        api.get('/oddzialy', { headers: h }).catch(() => ({ data: [] })),
        api.get(tasksEndpoint, { headers: h }).catch(() => ({ data: [] })),
      ]);
      setSprzet(Array.isArray(sRes.data) ? sRes.data : sRes.data?.items || []);
      setEkipy(Array.isArray(eRes.data) ? eRes.data : eRes.data?.ekipy || []);
      setOddzialy(Array.isArray(oRes.data) ? oRes.data : []);
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [navigate]);

  const loadRezerwacje = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    const h = authHeaders(token);
    try {
      const res = await api.get(`/flota/rezerwacje?from=${from}&to=${to}`, { headers: h });
      setRezerwacje(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRezerwacje([]);
    }
  }, [from, to]);

  useEffect(() => {
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    loadRezerwacje();
  }, [loadRezerwacje]);

  useEffect(() => {
    let cancelled = false;
    const loadAttendance = async () => {
      const token = getStoredToken();
      if (!token) return;
      const query = new URLSearchParams({ date: dayISO });
      if (selectedBranchId) query.set('oddzial_id', selectedBranchId);
      try {
        const res = await api.get(`/ekipy/attendance?${query.toString()}`, {
          headers: authHeaders(token),
        });
        const items = Array.isArray(res.data?.items)
          ? res.data.items.map((item) => normalizeAttendanceItem(item, dayISO))
          : [];
        if (!cancelled) {
          setAttendanceRows(items);
          setAttendanceError(false);
        }
      } catch {
        if (!cancelled) {
          setAttendanceRows([]);
          setAttendanceError(true);
        }
      }
    };
    loadAttendance();
    return () => {
      cancelled = true;
    };
  }, [dayISO, selectedBranchId]);

  useEffect(() => {
    if (!currentUser) return;
    if (!userCanSeeAllBranches && currentUser.oddzial_id) {
      setSelectedBranchId(String(currentUser.oddzial_id));
    }
  }, [currentUser, userCanSeeAllBranches]);

  useEffect(() => {
    let cancelled = false;
    const loadBranchTeams = async () => {
      if (!selectedBranchId) {
        setBranchTeams([]);
        return;
      }
      const token = getStoredToken();
      if (!token) return;
      try {
        const res = await api.get(`/ekipy?oddzial_id=${encodeURIComponent(selectedBranchId)}&include_delegacje=1&date=${encodeURIComponent(dayISO)}`, {
          headers: authHeaders(token),
        });
        if (!cancelled) setBranchTeams(Array.isArray(res.data) ? res.data : res.data?.ekipy || res.data?.items || []);
      } catch {
        if (!cancelled) setBranchTeams([]);
      }
    };
    loadBranchTeams();
    return () => {
      cancelled = true;
    };
  }, [dayISO, selectedBranchId]);

  // ─── mapa: sprzetId → lista rezerwacji w zakresie ─────────────────────────
  const rezBySprzet = useMemo(() => {
    const map = {};
    for (const r of rezerwacje) {
      if (!map[r.sprzet_id]) map[r.sprzet_id] = [];
      map[r.sprzet_id].push(r);
    }
    return map;
  }, [rezerwacje]);

  const teamsForPlanning = useMemo(() => {
    return selectedBranchId ? mergeTeamRows(ekipy, branchTeams) : ekipy;
  }, [branchTeams, ekipy, selectedBranchId]);

  const branchOptions = useMemo(() => {
    const byId = new Map();
    for (const oddzial of oddzialy) {
      if (oddzial?.id == null) continue;
      byId.set(String(oddzial.id), oddzial.nazwa || `Oddzial #${oddzial.id}`);
    }
    for (const team of teamsForPlanning) {
      const id = teamBranchId(team);
      if (id) byId.set(String(id), teamBranchLabel(team) || byId.get(String(id)) || `Oddzial #${id}`);
    }
    for (const task of tasks) {
      const id = taskBranchId(task);
      if (id && !byId.has(String(id))) byId.set(String(id), task.oddzial_nazwa || `Oddzial #${id}`);
    }
    return Array.from(byId.entries()).map(([id, nazwa]) => ({ id, nazwa }));
  }, [oddzialy, tasks, teamsForPlanning]);

  const visibleTeams = useMemo(() => {
    return teamsForPlanning.filter((team) => !selectedBranchId || String(teamBranchId(team)) === String(selectedBranchId));
  }, [selectedBranchId, teamsForPlanning]);

  const attendanceByTeam = useMemo(() => {
    const map = new Map();
    for (const item of attendanceRows || []) {
      if (item?.teamId) map.set(String(item.teamId), item);
    }
    return map;
  }, [attendanceRows]);

  const visibleSprzet = useMemo(() => {
    return sprzet.filter((item) => !selectedBranchId || equipmentBranchId(item) === String(selectedBranchId));
  }, [selectedBranchId, sprzet]);

  const equipmentById = useMemo(() => {
    const map = new Map();
    for (const item of sprzet || []) {
      map.set(String(item.id), item);
    }
    return map;
  }, [sprzet]);

  const plannerTeams = useMemo(() => {
    if (!modalTaskPlan) return visibleTeams.length ? visibleTeams : teamsForPlanning;
    const taskBranch = taskBranchId(modalTaskPlan);
    const currentTeamId = modalTaskPlan.ekipa_id ? String(modalTaskPlan.ekipa_id) : '';
    const scoped = teamsForPlanning.filter((team) => (
      !taskBranch ||
      String(teamBranchId(team)) === String(taskBranch) ||
      String(team.id) === currentTeamId
    ));
    return scoped.length ? scoped : teamsForPlanning;
  }, [modalTaskPlan, teamsForPlanning, visibleTeams]);

  const scheduledTasks = useMemo(() => {
    const firstISO = toISO(days[0]);
    const lastISO = toISO(days[days.length - 1]);
    return tasks
      .filter((task) => task?.typ !== 'wycena')
      .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
      .filter((task) => !selectedBranchId || String(taskBranchId(task)) === String(selectedBranchId))
      .filter((task) => task.ekipa_id && taskDate(task) >= firstISO && taskDate(task) <= lastISO)
      .sort((a, b) => `${taskDate(a)} ${taskTime(a)}`.localeCompare(`${taskDate(b)} ${taskTime(b)}`));
  }, [days, selectedBranchId, tasks]);

  const planningQueueRows = useMemo(() => {
    return tasks
      .filter((task) => task?.typ !== 'wycena')
      .filter((task) => !CLOSED_TASK_STATUSES.has(task.status))
      .filter((task) => task.status === 'Do_Zatwierdzenia' || !task.ekipa_id || !task.data_planowana)
      .filter((task) => !selectedBranchId || String(taskBranchId(task)) === String(selectedBranchId))
      .slice()
      .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
      .map(buildPlanningQueueRow);
  }, [selectedBranchId, tasks]);
  const planningQueueStats = useMemo(() => {
    const countByProblem = (problemKey) => planningQueueRows.filter((row) => row.missing.some((item) => item.key === problemKey)).length;
    return {
      all: planningQueueRows.length,
      ready: planningQueueRows.filter((row) => row.ready).length,
      missing: planningQueueRows.filter((row) => !row.ready).length,
      photos: countByProblem('photos'),
      risk: countByProblem('risk'),
      price: countByProblem('price'),
      equipment: countByProblem('equipment'),
      teamTime: countByProblem('teamTime'),
    };
  }, [planningQueueRows]);
  const filteredPlanningQueue = useMemo(() => {
    const rows = planningQueueRows.filter((row) => {
      if (planningQueueFilter === 'ready') return row.ready;
      if (planningQueueFilter === 'missing') return !row.ready;
      if (planningQueueFilter === 'all') return true;
      return row.missing.some((item) => item.key === planningQueueFilter);
    });
    return rows.slice(0, 12);
  }, [planningQueueFilter, planningQueueRows]);

  const tasksByTeamDay = useMemo(() => {
    const map = new Map();
    for (const task of scheduledTasks) {
      const key = `${task.ekipa_id}|${taskDate(task)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    return map;
  }, [scheduledTasks]);

  const dayTasksByTeam = useMemo(() => {
    const map = new Map();
    for (const task of scheduledTasks) {
      if (taskDate(task) !== dayISO) continue;
      const key = String(task.ekipa_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    for (const list of map.values()) {
      list.sort((a, b) => taskTime(a).localeCompare(taskTime(b)));
    }
    return map;
  }, [dayISO, scheduledTasks]);

  const dayAnalysisByTeam = useMemo(() => {
    const map = new Map();
    const workStart = DAY_START_HOUR * 60;
    const workEnd = DAY_END_HOUR * 60;
    for (const team of visibleTeams) {
      const teamId = String(team.id);
      const ranges = (dayTasksByTeam.get(teamId) || [])
        .map((task) => ({ task, ...taskRangeMinutes(task) }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      const conflictIds = new Set();
      for (let i = 0; i < ranges.length; i += 1) {
        for (let j = i + 1; j < ranges.length; j += 1) {
          if (ranges[j].start >= ranges[i].end) break;
          conflictIds.add(String(ranges[i].task.id));
          conflictIds.add(String(ranges[j].task.id));
        }
      }
      const gaps = [];
      let cursor = workStart;
      for (const range of ranges) {
        const start = clamp(range.start, workStart, workEnd);
        const end = clamp(range.end, workStart, workEnd);
        if (start - cursor >= MIN_VISIBLE_GAP_MINUTES) {
          gaps.push({ start: cursor, end: start, minutes: start - cursor });
        }
        cursor = Math.max(cursor, end);
      }
      if (workEnd - cursor >= MIN_VISIBLE_GAP_MINUTES) {
        gaps.push({ start: cursor, end: workEnd, minutes: workEnd - cursor });
      }
      map.set(teamId, {
        ranges,
        gaps,
        conflictIds,
        loadMinutes: ranges.reduce((sum, range) => sum + range.duration, 0),
      });
    }
    return map;
  }, [dayTasksByTeam, visibleTeams]);

  const dayOpsSummary = useMemo(() => {
    const visibleEquipmentIds = new Set((visibleSprzet || []).map((item) => String(item.id)));
    const dayTasks = scheduledTasks.filter((task) => taskDate(task) === dayISO);
    const equipmentRows = (rezerwacje || [])
      .filter(activeReservation)
      .filter((rez) => reservationOverlapsDay(rez, dayISO))
      .filter((rez) => !visibleEquipmentIds.size || visibleEquipmentIds.has(String(rez.sprzet_id)));
    const equipmentConflictGroups = dayReservationConflicts(rezerwacje, dayISO, visibleEquipmentIds.size ? visibleEquipmentIds : null);
    const teamConflictCount = [...dayAnalysisByTeam.values()]
      .reduce((sum, analysis) => sum + (analysis?.conflictIds?.size || 0), 0);
    const absentTeams = visibleTeams.filter((team) => attendanceByTeam.get(String(team.id))?.present === false);
    const absentTeamsWithTasks = absentTeams.filter((team) => (dayTasksByTeam.get(String(team.id)) || []).length > 0);
    const noEquipment = dayTasks.filter((task) => !taskReservationEquipmentIds(rezerwacje, task.id).length && !taskFieldEquipment(task)).length;
    const noPhotos = dayTasks.filter((task) => taskPhotoTotal(task) <= 0).length;
    const noBrief = dayTasks.filter((task) => !taskWorkBrief(task)).length;
    return {
      tasks: dayTasks.length,
      readyQueue: planningQueueStats.ready,
      queueMissing: planningQueueStats.missing,
      equipment: equipmentRows.length,
      equipmentConflicts: equipmentConflictGroups.length,
      teamConflicts: teamConflictCount,
      noEquipment,
      noPhotos,
      noBrief,
      absentTeams: absentTeams.length,
      absentTeamsWithTasks: absentTeamsWithTasks.length,
      attendanceError,
    };
  }, [attendanceByTeam, attendanceError, dayAnalysisByTeam, dayISO, dayTasksByTeam, planningQueueStats.missing, planningQueueStats.ready, rezerwacje, scheduledTasks, visibleSprzet, visibleTeams]);

  const teamsByIdForPlanning = useMemo(() => {
    const map = new Map();
    for (const team of teamsForPlanning || []) {
      if (team?.id) map.set(String(team.id), team);
    }
    return map;
  }, [teamsForPlanning]);

  const delegationSummary = useMemo(() => {
    const delegated = visibleTeams.filter(isTeamDelegatedToView);
    const dayTasks = scheduledTasks.filter((task) => taskDate(task) === dayISO);
    const delegatedTasks = dayTasks.filter((task) => {
      const team = teamsByIdForPlanning.get(String(task?.ekipa_id || ''));
      if (!team) return false;
      const taskBranch = String(taskBranchId(task) || '');
      const homeBranch = String(teamHomeBranchId(team) || '');
      return Boolean(taskBranch && homeBranch && taskBranch !== homeBranch);
    });
    return {
      delegated,
      nativeCount: Math.max(0, visibleTeams.length - delegated.length),
      delegatedTasks,
    };
  }, [dayISO, scheduledTasks, teamsByIdForPlanning, visibleTeams]);

  const dayOpsAlerts = useMemo(() => {
    const alerts = [];
    if (attendanceError) {
      alerts.push({
        key: 'attendance-load-error',
        tone: 'warn',
        kind: 'attendance',
        category: 'Potwierdzenia ekip',
        title: 'Brak aktualnej gotowosci',
        detail: 'Nie udalo sie pobrac potwierdzen obecnosci ekip dla tego dnia.',
        action: 'Sprawdz',
      });
    }
    for (const team of visibleTeams) {
      const attendance = attendanceByTeam.get(String(team.id));
      const teamTasks = dayTasksByTeam.get(String(team.id)) || [];
      if (attendance?.present === false) {
        alerts.push({
          key: `attendance-${team.id}`,
          tone: teamTasks.length ? 'bad' : 'warn',
          kind: 'attendance',
          team,
          category: 'Nieobecna ekipa',
          title: team.nazwa || `Ekipa #${team.id}`,
          detail: teamTasks.length
            ? `${teamTasks.length} zlecen zaplanowanych mimo braku gotowosci${attendance.note ? ` - ${attendance.note}` : ''}.`
            : (attendance.note || 'Ekipa oznaczona jako niedostepna na ten dzien.'),
          action: teamTasks.length ? 'Przeplanuj' : 'Potwierdzenia',
        });
      }
      const analysis = dayAnalysisByTeam.get(String(team.id));
      const ranges = analysis?.ranges || [];
      for (let i = 0; i < ranges.length; i += 1) {
        for (let j = i + 1; j < ranges.length; j += 1) {
          if (ranges[j].start >= ranges[i].end) break;
          alerts.push({
            key: `team-${team.id}-${ranges[i].task.id}-${ranges[j].task.id}`,
            tone: 'bad',
            kind: 'task',
            task: ranges[i].task,
            category: 'Kolizja ekipy',
            title: team.nazwa || `Ekipa #${team.id}`,
            detail: `#${ranges[i].task.id} ${minutesToTime(ranges[i].start)}-${minutesToTime(ranges[i].end)} nachodzi na #${ranges[j].task.id} ${minutesToTime(ranges[j].start)}-${minutesToTime(ranges[j].end)}.`,
            action: 'Przeplanuj',
          });
        }
      }
    }

    const visibleEquipmentIds = new Set((visibleSprzet || []).map((item) => String(item.id)));
    for (const group of dayReservationConflicts(rezerwacje, dayISO, visibleEquipmentIds.size ? visibleEquipmentIds : null)) {
      const first = group[0];
      const item = equipmentById.get(String(first?.sprzet_id || ''));
      alerts.push({
        key: `equipment-${first?.sprzet_id}-${group.map((row) => row.id).join('-')}`,
        tone: 'bad',
        kind: 'equipment',
        category: 'Kolizja sprzętu',
        title: item?.nazwa || first?.sprzet_nazwa || `Sprzęt #${first?.sprzet_id || '-'}`,
        detail: group
          .map((row) => row.task_id ? `#${row.task_id} ${row.task_klient_nazwa || row.ekipa_nazwa || ''}`.trim() : (row.ekipa_nazwa || 'rezerwacja'))
          .slice(0, 3)
          .join(' / '),
        action: 'Pokaż sprzęt',
      });
    }

    const dayTasks = scheduledTasks.filter((task) => taskDate(task) === dayISO);
    for (const task of dayTasks) {
      const missing = [
        taskPhotoTotal(task) > 0 ? null : 'zdjęcia',
        taskWorkBrief(task) ? null : 'opis',
        taskReservationEquipmentIds(rezerwacje, task.id).length || taskFieldEquipment(task) ? null : 'sprzęt',
      ].filter(Boolean);
      if (!missing.length) continue;
      alerts.push({
        key: `package-${task.id}`,
        tone: 'warn',
        kind: 'task',
        task,
        category: 'Pakiet brygady',
        title: `#${task.id} ${taskClientLabel(task)}`,
        detail: `Brakuje: ${missing.join(', ')}.`,
        action: 'Uzupełnij',
      });
    }

    for (const row of planningQueueRows.filter((item) => item.ready).slice(0, 4)) {
      alerts.push({
        key: `ready-${row.task.id}`,
        tone: 'good',
        kind: 'queue',
        row,
        task: row.task,
        category: 'Gotowe do planu',
        title: `#${row.task.id} ${taskClientLabel(row.task)}`,
        detail: `${row.photoTotal} zdjęć, ${row.value ? `${row.value.toLocaleString('pl-PL')} PLN` : 'bez ceny'}, można przypisać termin i ekipę.`,
        action: 'Planuj',
      });
    }

    return alerts
      .sort((a, b) => {
        const order = { bad: 0, warn: 1, good: 2 };
        return (order[a.tone] ?? 9) - (order[b.tone] ?? 9);
      })
      .slice(0, 10);
  }, [attendanceByTeam, attendanceError, dayAnalysisByTeam, dayISO, dayTasksByTeam, equipmentById, planningQueueRows, rezerwacje, scheduledTasks, visibleSprzet, visibleTeams]);

  // ─── nawigacja ────────────────────────────────────────────────────────────
  const isTeamDayView = activeTab === 'teams' && teamViewMode === 'day';
  const prev = () => setAnchor(a => addDays(a, isTeamDayView ? -1 : -rangeLen));
  const next = () => setAnchor(a => addDays(a, isTeamDayView ? 1 : rangeLen));
  const goToday = () => setAnchor(new Date());

  // ─── flash message ────────────────────────────────────────────────────────
  const showMsg = useCallback((txt, type = 'ok') => {
    setMsg(txt); setMsgType(type);
    setTimeout(() => setMsg(''), 3000);
  }, []);

  const copyTextToClipboard = useCallback(async (text, successMessage) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } else {
        throw new Error('Clipboard is not available');
      }
      showMsg(successMessage);
    } catch {
      showMsg('Nie udalo sie skopiowac odprawy.', 'err');
    }
  }, [showMsg]);

  const copyDayBrief = useCallback(() => {
    const brief = buildDayBrief({
      dayISO,
      dayLabel,
      scheduledTasks,
      visibleTeams,
      attendanceByTeam,
      rezerwacje,
      equipmentById,
      teamsById: teamsByIdForPlanning,
      branchOptions,
      selectedBranchId,
      dayOpsSummary,
      delegationSummary,
    });
    void copyTextToClipboard(brief, 'Odprawa dnia skopiowana.');
  }, [
    branchOptions,
    copyTextToClipboard,
    attendanceByTeam,
    dayISO,
    dayLabel,
    dayOpsSummary,
    delegationSummary,
    equipmentById,
    rezerwacje,
    scheduledTasks,
    selectedBranchId,
    teamsByIdForPlanning,
    visibleTeams,
  ]);

  const copyTeamBrief = useCallback((team) => {
    const teamId = String(team?.id || '');
    const teamTasks = scheduledTasks.filter((task) => taskDate(task) === dayISO && String(task?.ekipa_id || '') === teamId);
    const teamTaskIds = new Set(teamTasks.map((task) => String(task.id)));
    const equipmentRows = (rezerwacje || [])
      .filter(activeReservation)
      .filter((rez) => reservationOverlapsDay(rez, dayISO))
      .filter((rez) => teamTaskIds.has(String(rez?.task_id || '')));
    const analysis = dayAnalysisByTeam.get(teamId);
    const teamAttendance = attendanceByTeam.get(teamId);
    const teamSummary = {
      tasks: teamTasks.length,
      readyQueue: 0,
      queueMissing: 0,
      equipment: equipmentRows.length,
      equipmentConflicts: 0,
      teamConflicts: analysis?.conflictIds?.size || 0,
      noEquipment: teamTasks.filter((task) => !taskReservationEquipmentIds(rezerwacje, task.id).length && !taskFieldEquipment(task)).length,
      noPhotos: teamTasks.filter((task) => taskPhotoTotal(task) <= 0).length,
      noBrief: teamTasks.filter((task) => !taskWorkBrief(task)).length,
      absentTeams: teamAttendance?.present === false ? 1 : 0,
      absentTeamsWithTasks: teamAttendance?.present === false && teamTasks.length ? 1 : 0,
      attendanceError,
    };
    const teamName = team?.nazwa || (teamId ? `Ekipa #${teamId}` : 'Ekipa');
    let brief = buildDayBrief({
      dayISO,
      dayLabel,
      scheduledTasks: teamTasks,
      visibleTeams: team ? [team] : [],
      attendanceByTeam,
      rezerwacje,
      equipmentById,
      teamsById: teamsByIdForPlanning,
      branchOptions,
      selectedBranchId,
      dayOpsSummary: teamSummary,
      delegationSummary: {
        delegated: team && isTeamDelegatedToView(team) ? [team] : [],
        delegatedTasks: [],
      },
    }).replace('ARBOR-OS | Odprawa dnia', 'ARBOR-OS | Odprawa ekipy');
    if (!teamTasks.length) {
      brief = `${brief}\n\n=== ${teamName} ===\nBrak zaplanowanych zlecen dla tej ekipy.`;
    }
    void copyTextToClipboard(brief, `Odprawa ekipy ${teamName} skopiowana.`);
  }, [
    attendanceByTeam,
    attendanceError,
    branchOptions,
    copyTextToClipboard,
    dayAnalysisByTeam,
    dayISO,
    dayLabel,
    equipmentById,
    rezerwacje,
    scheduledTasks,
    selectedBranchId,
    teamsByIdForPlanning,
  ]);

  // ─── tworzenie rezerwacji ─────────────────────────────────────────────────
  const handleNewSave = async (form) => {
    if (!form.sprzet_id || !form.ekipa_id) {
      setModalErr('Wybierz sprzęt i ekipę.'); return;
    }
    setSaving(true); setModalErr('');
    try {
      const token = getStoredToken();
      await api.post('/flota/rezerwacje', {
        sprzet_id: Number(form.sprzet_id),
        ekipa_id:  Number(form.ekipa_id),
        data_od:   form.data_od,
        data_do:   form.data_do,
        status:    form.status,
      }, { headers: authHeaders(token) });
      setModalNew(null);
      showMsg('Rezerwacja dodana.');
      await loadRezerwacje();
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) setModalErr('Kolizja — sprzęt już zarezerwowany w tym terminie.');
      else setModalErr(code || 'Błąd zapisu.');
    } finally {
      setSaving(false);
    }
  };

  // ─── zmiana statusu ────────────────────────────────────────────────────────
  const handleStatusChange = async (id, status) => {
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/flota/rezerwacje/${id}/status`, { status }, { headers: authHeaders(token) });
      setModalDet(null);
      showMsg('Status zaktualizowany.');
      await loadRezerwacje();
    } catch {
      showMsg('Błąd zapisu statusu.', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ─── drag & drop ──────────────────────────────────────────────────────────
  const handleDragStart = (e, rez, dayISO) => {
    if (!canEdit) { e.preventDefault(); return; }
    drag.current = { rez, dragDayISO: dayISO };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rez.id));
  };

  const handleDragOver = (e, sprzetId, dayISO) => {
    if (!drag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ sprzetId, dayISO });
  };

  const handleDragLeave = () => setDropTarget(null);

  const handleDrop = async (e, sprzetId, dayISO) => {
    e.preventDefault();
    setDropTarget(null);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (String(sprzetId) !== String(d.rez.sprzet_id)) return; // tylko w obrębie tego samego sprzętu

    const delta = diffDays(d.dragDayISO, dayISO);
    if (delta === 0) return;

    const newOd = toISO(addDays(new Date(d.rez.data_od), delta));
    const newDo = toISO(addDays(new Date(d.rez.data_do), delta));

    try {
      const token = getStoredToken();
      await api.patch(`/flota/rezerwacje/${d.rez.id}`, { data_od: newOd, data_do: newDo }, { headers: authHeaders(token) });
      showMsg('Rezerwacja przesunięta.');
      await loadRezerwacje();
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) showMsg('Kolizja — termin zajęty.', 'err');
      else showMsg(code || 'Błąd przesunięcia.', 'err');
    }
  };

  // ─── renderowanie paska rezerwacji ────────────────────────────────────────
  // Zwraca element bar dla danej rezerwacji; oblicza pozycję i szerokość
  const openTaskPlan = (task) => {
    setTaskPlanErr('');
    setModalTaskPlan(task);
  };

  const closeTaskPlan = () => {
    setTaskPlanErr('');
    setModalTaskPlan(null);
  };

  useEffect(() => {
    if (loading) return;
    const params = deepLinkParams;
    const focusedTaskId = params.get('task') || params.get('zlecenie');
    const wantsPlanningQueue = params.get('queue') === 'planning';
    const requestedTab = params.get('tab');
    const requestedDate = params.get('date');
    const requestedBranch = params.get('oddzial') || params.get('branch');
    const shouldOpenModal = params.get('modal') !== '0';
    if (!focusedTaskId && !wantsPlanningQueue && !requestedDate && !requestedTab) return;
    if (deepLinkHandledRef.current === location.search) return;

    setActiveTab(requestedTab === 'equipment' ? 'equipment' : 'teams');
    setTeamViewMode(params.get('view') === 'range' ? 'range' : 'day');
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      setAnchor(new Date(`${requestedDate}T12:00:00`));
    }
    if (userCanSeeAllBranches && requestedBranch) {
      setSelectedBranchId(String(requestedBranch));
    }

    if (!focusedTaskId) {
      deepLinkHandledRef.current = location.search;
      return;
    }

    const task = tasks.find((row) => String(row?.id) === String(focusedTaskId));
    if (!task) return;
    const day = taskDate(task);
    const branchId = taskBranchId(task);
    if (day) {
      setAnchor(new Date(`${day}T12:00:00`));
    }
    if (userCanSeeAllBranches && branchId) {
      setSelectedBranchId(branchId);
    }
    if (shouldOpenModal && requestedTab !== 'equipment') {
      setTaskPlanErr('');
      setModalTaskPlan(task);
    }
    deepLinkHandledRef.current = location.search;
  }, [deepLinkParams, loading, location.search, tasks, userCanSeeAllBranches]);

  const openFullTask = (task, focus = '') => {
    if (!task?.id) return;
    const suffix = focus ? `?focus=${encodeURIComponent(focus)}` : '';
    navigate(`/zlecenia/${task.id}${suffix}`);
  };

  const openQueueRepair = (row) => {
    if (!row?.task) return;
    if (isPlanningQueuePlanAction(row)) {
      openTaskPlan(row.task);
      return;
    }
    openFullTask(row.task, getPlanningQueueFocus(row));
  };

  const handleTaskPlanSave = async (task, form) => {
    if (!task?.id) return;
    if (!form.data_planowana || !form.godzina_rozpoczecia || !form.czas_planowany_godziny || !form.ekipa_id) {
      setTaskPlanErr('Uzupelnij date, godzine, czas pracy i ekipe.');
      return;
    }
    const selectedAttendance = attendanceByTeam.get(String(form.ekipa_id));
    if (selectedAttendance?.present === false && !form.absence_override) {
      setTaskPlanErr('Ekipa jest nieobecna. Potwierdz wyjatek kierownika albo wybierz inna ekipe.');
      return;
    }
    const absenceOverride = selectedAttendance?.present === false && form.absence_override === true;
    setSaving(true);
    setTaskPlanErr('');
    try {
      const token = getStoredToken();
      await api.put(`/tasks/${task.id}/office-plan`, {
        data_planowana: form.data_planowana,
        godzina_rozpoczecia: form.godzina_rozpoczecia,
        czas_planowany_godziny: form.czas_planowany_godziny,
        ekipa_id: form.ekipa_id,
        sprzet_ids: form.sprzet_ids || [],
        sprzet_notatka: form.sprzet_notatka || 'Zmieniono w panelu harmonogramu.',
        absence_override: absenceOverride,
      }, { headers: authHeaders(token) });
      showMsg(`Zapisano plan zlecenia #${task.id}.`);
      setModalTaskPlan(null);
      await Promise.all([loadAll(), loadRezerwacje()]);
    } catch (err) {
      const code = err.response?.data?.error;
      setTaskPlanErr(code || 'Nie udalo sie zapisac planu.');
    } finally {
      setSaving(false);
    }
  };

  const handleTaskDragStart = (e, task) => {
    if (!canEdit) { e.preventDefault(); return; }
    taskDrag.current = { task };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  };

  const handleTaskDragOver = (e, teamId, dayISO, time = null) => {
    if (!taskDrag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setTeamDropTarget({ teamId, dayISO, time });
  };

  const handleTaskDragLeave = () => setTeamDropTarget(null);

  const handleTaskDrop = async (e, teamId, dayISO, time = null) => {
    e.preventDefault();
    setTeamDropTarget(null);
    const payload = taskDrag.current;
    taskDrag.current = null;
    if (!payload?.task) return;
    const task = payload.task;
    const nextTime = time || taskTime(task);
    const nextHours = taskHours(task);
    if (String(task.ekipa_id || '') === String(teamId) && taskDate(task) === dayISO && taskTime(task) === nextTime) return;
    const warnings = buildPlanWarnings(tasks, task, {
      ekipa_id: teamId,
      data_planowana: dayISO,
      godzina_rozpoczecia: nextTime,
      czas_planowany_godziny: nextHours,
    });
    if (warnings.outsideWorkday) {
      showMsg('Nie mozna przesunac zlecenia poza dzien roboczy kalendarza.', 'err');
      return;
    }
    if (warnings.conflicts.length) {
      const conflict = warnings.conflicts[0];
      showMsg(`Konflikt terminu: ${taskClientLabel(conflict)} ma juz slot ${taskTime(conflict)}-${taskEndTime(conflict)}.`, 'err');
      return;
    }
    const targetAttendance = attendanceByTeam.get(String(teamId));
    let absenceOverride = false;
    if (targetAttendance?.present === false) {
      const targetTeam = teamsByIdForPlanning.get(String(teamId));
      const confirmed = typeof window !== 'undefined' && window.confirm
        ? window.confirm(`${targetTeam?.nazwa || `Ekipa #${teamId}`} jest oznaczona jako ${attendanceLine(targetAttendance)}. Czy kierownik potwierdza zaplanowanie mimo braku gotowosci?`)
        : false;
      if (!confirmed) {
        showMsg('Planowanie przerwane: ekipa jest nieobecna.', 'err');
        return;
      }
      absenceOverride = true;
    }

    setSaving(true);
    try {
      const token = getStoredToken();
      await api.patch(`/tasks/${task.id}/plan`, {
        data_planowana: planDateTimeForSlot(dayISO, nextTime),
        godzina_rozpoczecia: nextTime,
        ekipa_id: teamId,
        absence_override: absenceOverride,
      }, { headers: authHeaders(token) });
      showMsg(`Zlecenie #${task.id} zaplanowane: ${dayISO} ${nextTime}.`);
      await Promise.all([loadAll(), loadRezerwacje()]);
    } catch (err) {
      const code = err.response?.data?.error;
      showMsg(code || 'Nie udalo sie przesunac zlecenia.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const renderTaskCard = (task) => {
    const color = TASK_STATUS_COLOR[task.status] || '#64748b';
    const photoTotal = taskPhotoTotal(task);
    const hasBrief = Boolean(taskWorkBrief(task));
    const equipmentLabel = taskEquipmentLabel(rezerwacje, task);
    const hasEquipment = equipmentLabel !== 'sprz. -';
    return (
      <div
        key={task.id}
        data-testid={`task-card-${task.id}`}
        draggable={canEdit}
        onDragStart={(e) => handleTaskDragStart(e, task)}
        onClick={(e) => { e.stopPropagation(); openTaskPlan(task); }}
        title={`${taskClientLabel(task)}\n${taskTime(task)} | ${taskHours(task)} h\n${task.adres || ''}`}
        style={{ ...st.taskCard, borderLeft: `4px solid ${color}` }}
      >
        <div style={st.taskCardTop}>
          <strong>#{task.id} {taskTime(task)}</strong>
          <span style={{ ...st.taskStatus, background: color }}>{task.status}</span>
        </div>
        <div style={st.taskTitle}>{taskClientLabel(task)}</div>
        <div style={st.taskBadges}>
          <span style={{ ...st.taskBadge, ...(photoTotal ? st.taskBadgeOk : st.taskBadgeWarn) }}>
            {photoTotal ? `${photoTotal} zdj.` : 'zdj. -'}
          </span>
          <span style={{ ...st.taskBadge, ...(hasEquipment ? st.taskBadgeOk : st.taskBadgeWarn) }}>
            {equipmentLabel}
          </span>
          <span style={{ ...st.taskBadge, ...(hasBrief ? st.taskBadgeOk : st.taskBadgeWarn) }}>
            {hasBrief ? 'opis' : 'opis -'}
          </span>
        </div>
        <div style={st.taskMeta}>{task.miasto || task.adres || 'Brak adresu'} · {taskHours(task)} h</div>
      </div>
    );
  };

  const renderPlanningQueueCard = (row) => (
    <div key={row.task.id} style={{ ...st.queueTaskWrap, ...(row.ready ? st.queueTaskWrapReady : {}) }}>
      {renderTaskCard(row.task)}
      <div style={st.queueTaskMeta}>
        <span style={{ ...st.queueReadyPill, ...(row.ready ? st.queueReadyPillOk : st.queueReadyPillWarn) }}>
          {row.ready ? 'Gotowe' : `${row.missing.length} brakow`}
        </span>
        <span>{row.photoTotal} zdj. / {row.fieldEvidence} teren</span>
        {row.value ? <span>{row.value.toLocaleString('pl-PL')} PLN</span> : <span>bez ceny</span>}
      </div>
      {!row.ready && (
        <div style={st.queueMissingList}>
          {row.missing.slice(0, 5).map((item) => (
            <span key={`${row.task.id}-${item.key}-${item.label}`} style={st.queueMissingPill}>{item.label}</span>
          ))}
        </div>
      )}
      <div style={st.queueActions}>
        <button
          type="button"
          style={{
            ...st.queueActionBtn,
            ...(isPlanningQueuePlanAction(row) ? st.queueActionBtnPrimary : {}),
          }}
          onClick={() => openQueueRepair(row)}
        >
          {getPlanningQueueRepairLabel(row)}
        </button>
        <button
          type="button"
          style={st.queueActionBtn}
          onClick={() => openTaskPlan(row.task)}
        >
          Plan
        </button>
        <button
          type="button"
          style={st.queueActionBtn}
          onClick={() => openFullTask(row.task, getPlanningQueueFocus(row))}
        >
          Karta
        </button>
      </div>
    </div>
  );

  const renderDayTaskBlock = (task) => {
    const color = TASK_STATUS_COLOR[task.status] || '#64748b';
    const start = clamp(timeToMinutes(taskTime(task)), DAY_START_HOUR * 60, DAY_END_HOUR * 60 - 15);
    const duration = Math.max(30, Math.round(taskHours(task) * 60));
    const top = ((start - DAY_START_HOUR * 60) / 60) * DAY_HOUR_HEIGHT + 4;
    const height = Math.max(48, (duration / 60) * DAY_HOUR_HEIGHT - 8);
    const analysis = dayAnalysisByTeam.get(String(task.ekipa_id));
    const hasConflict = analysis?.conflictIds?.has(String(task.id));
    return (
      <div
        key={task.id}
        data-testid={`day-task-${task.id}`}
        draggable={canEdit}
        onDragStart={(e) => handleTaskDragStart(e, task)}
        onClick={(e) => { e.stopPropagation(); openTaskPlan(task); }}
        style={{
          ...st.dayTaskBlock,
          ...(hasConflict ? st.dayTaskBlockConflict : {}),
          top,
          height,
          borderLeft: `4px solid ${hasConflict ? '#ef4444' : color}`,
        }}
        title={`${taskClientLabel(task)}\n${taskTime(task)} | ${taskHours(task)} h\n${task.adres || ''}`}
      >
        <div style={st.dayTaskTime}>
          {taskTime(task)} · {taskHours(task)} h{hasConflict ? ' · konflikt' : ''}
        </div>
        <strong style={st.dayTaskTitle}>#{task.id} {taskClientLabel(task)}</strong>
        <span style={st.dayTaskMeta}>{task.miasto || task.adres || 'Brak adresu'}</span>
      </div>
    );
  };

  const renderBar = (rez, rowIndex) => {
    const rezOd = rez.data_od?.slice(0, 10);
    const rezDo = rez.data_do?.slice(0, 10);
    const firstISO = toISO(days[0]);
    const lastISO  = toISO(days[days.length - 1]);

    // Przytnij do widocznego zakresu
    const startISO = rezOd < firstISO ? firstISO : rezOd;
    const endISO   = rezDo > lastISO  ? lastISO  : rezDo;

    const colStart = diffDays(firstISO, startISO);
    const spanDays = diffDays(startISO, endISO) + 1;
    if (spanDays <= 0 || colStart >= days.length) return null;

    const left   = colStart * COL_W + 2;
    const width  = spanDays * COL_W - 4;
    const color  = STATUS_COLOR[rez.status] || '#6b7280';
    const isAnulowana = rez.status === 'Anulowane';
    const taskLabel = rez.task_id ? `#${rez.task_id} ${rez.task_klient_nazwa || ''}`.trim() : '';
    const barLabel = taskLabel || rez.ekipa_nazwa || rez.status || '';

    return (
      <div
        key={rez.id}
        draggable={canEdit && !isAnulowana}
        onDragStart={(e) => handleDragStart(e, rez, startISO)}
        onClick={(e) => { e.stopPropagation(); setModalDet(rez); }}
        title={`${rez.sprzet_nazwa} | ${rez.ekipa_nazwa}\n${rezOd} -> ${rezDo}\nStatus: ${rez.status}${taskLabel ? `\nZlecenie: ${taskLabel}` : ''}${rez.task_adres ? `\n${rez.task_adres}` : ''}`}
        style={{
          position: 'absolute',
          left:     left,
          top:      (rowIndex * ROW_H) + 7,
          width:    width,
          height:   ROW_H - 14,
          background: color,
          borderRadius: 6,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          opacity: isAnulowana ? 0.45 : 1,
          cursor: canEdit && !isAnulowana ? 'grab' : 'pointer',
          userSelect: 'none',
          zIndex: 2,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {barLabel}
      </div>
    );
  };

  // ─── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="app-shell zasoby-shell" style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div className="app-main zasoby-main" style={{ padding: 40, color: 'var(--text-muted)' }}>Ładowanie kalendarza zasobów…</div>
      </div>
    );
  }

  const equipmentTotalW = LABEL_W + days.length * COL_W;
  const teamTotalW = TEAM_LABEL_W + days.length * TEAM_COL_W;
  const dayTotalW = DAY_TIME_LABEL_W + Math.max(visibleTeams.length, 1) * DAY_TEAM_COL_W;
  const totalW = activeTab === 'teams'
    ? (teamViewMode === 'day' ? dayTotalW : teamTotalW)
    : equipmentTotalW;

  return (
    <div className="app-shell zasoby-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div className="app-main zasoby-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── nagłówek strony ───────────────────────────────────────────── */}
        <div className="zasoby-header" style={st.pageHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={st.navBtn} onClick={prev}>‹</button>
            <button style={st.todayBtn} onClick={goToday}>Dziś</button>
            <button style={st.navBtn} onClick={next}>›</button>
            <span style={st.periodLabel}>{isTeamDayView ? dayLabel : periodLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              style={{ ...st.viewBtn, background: activeTab === 'teams' ? 'var(--accent)' : 'var(--surface-field)', color: activeTab === 'teams' ? 'var(--on-accent)' : 'var(--text)' }}
              onClick={() => setActiveTab('teams')}>Ekipy</button>
            {activeTab === 'teams' && (
              <>
                <button
                  style={{ ...st.viewBtn, background: teamViewMode === 'day' ? 'var(--accent)' : 'var(--surface-field)', color: teamViewMode === 'day' ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setTeamViewMode('day')}>Dzien</button>
                <button
                  style={{ ...st.viewBtn, background: teamViewMode === 'range' ? 'var(--accent)' : 'var(--surface-field)', color: teamViewMode === 'range' ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setTeamViewMode('range')}>Zakres</button>
              </>
            )}
            <button
              style={{ ...st.viewBtn, background: activeTab === 'equipment' ? 'var(--accent)' : 'var(--surface-field)', color: activeTab === 'equipment' ? 'var(--on-accent)' : 'var(--text)' }}
              onClick={() => setActiveTab('equipment')}>Sprzet</button>
            <select
              style={st.branchSelect}
              value={selectedBranchId}
              disabled={!userCanSeeAllBranches}
              onChange={(event) => setSelectedBranchId(event.target.value)}
            >
              {userCanSeeAllBranches && <option value="">Wszystkie oddzialy</option>}
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.nazwa}</option>
              ))}
            </select>
            {(!isTeamDayView) && (
              <>
                <button
                  style={{ ...st.viewBtn, background: rangeLen === 14 ? 'var(--accent)' : 'var(--surface-field)', color: rangeLen === 14 ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setRangeLen(14)}>2 tygodnie</button>
                <button
                  style={{ ...st.viewBtn, background: rangeLen === 28 ? 'var(--accent)' : 'var(--surface-field)', color: rangeLen === 28 ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setRangeLen(28)}>4 tygodnie</button>
              </>
            )}
          </div>
          <h2 style={st.pageTitle}>Kalendarz zasobów</h2>
        </div>

        {/* ── flash message ─────────────────────────────────────────────── */}
        {msg && (
          <div style={{ ...st.flash, background: msgType === 'ok' ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)', color: msgType === 'ok' ? '#065f46' : '#991b1b' }}>
            {msg}
          </div>
        )}

        {/* ── legenda statusów ──────────────────────────────────────────── */}
        <div className="zasoby-legend" style={st.legend}>
          {Object.entries(activeTab === 'teams' ? TASK_STATUS_COLOR : STATUS_COLOR).map(([s, c]) => (
            <span key={s} style={st.legendItem}>
              <span style={{ ...st.legendDot, background: c }} />
              {s}
            </span>
          ))}
          {canEdit && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>Kliknij komórkę — nowa rezerwacja · Przeciągnij bar — zmień termin</span>}
        </div>

        {/* ── główna siatka ─────────────────────────────────────────────── */}
        {activeTab === 'teams' && (
          <div className="zasoby-ops-panel" style={st.opsPanel}>
            <div style={st.opsTitle}>
              <strong>Dyspozytornia dnia</strong>
              <span>{dayLabel}</span>
            </div>
            <div style={st.opsGrid}>
              <div style={st.opsMetric}>
                <span>Zlecenia</span>
                <strong>{dayOpsSummary.tasks}</strong>
              </div>
              <div style={st.opsMetric}>
                <span>Gotowe w kolejce</span>
                <strong>{dayOpsSummary.readyQueue}</strong>
              </div>
              <div style={{ ...st.opsMetric, ...((dayOpsSummary.absentTeamsWithTasks || dayOpsSummary.absentTeams) ? st.opsMetricBad : {}) }}>
                <span>Nieobecne</span>
                <strong>{dayOpsSummary.absentTeams}</strong>
              </div>
              <div style={{ ...st.opsMetric, ...(dayOpsSummary.noPhotos ? st.opsMetricWarn : {}) }}>
                <span>Bez zdjec</span>
                <strong>{dayOpsSummary.noPhotos}</strong>
              </div>
              <div style={{ ...st.opsMetric, ...(dayOpsSummary.noBrief ? st.opsMetricWarn : {}) }}>
                <span>Bez opisu</span>
                <strong>{dayOpsSummary.noBrief}</strong>
              </div>
              <div style={{ ...st.opsMetric, ...(dayOpsSummary.noEquipment ? st.opsMetricWarn : {}) }}>
                <span>Bez sprzetu</span>
                <strong>{dayOpsSummary.noEquipment}</strong>
              </div>
              <div style={st.opsMetric}>
                <span>Rezerwacje</span>
                <strong>{dayOpsSummary.equipment}</strong>
              </div>
              <div style={{ ...st.opsMetric, ...(delegationSummary.delegated.length ? st.opsMetricInfo : {}) }}>
                <span>Delegacje</span>
                <strong>{delegationSummary.delegated.length}</strong>
              </div>
              <div style={{ ...st.opsMetric, ...((dayOpsSummary.teamConflicts || dayOpsSummary.equipmentConflicts) ? st.opsMetricBad : {}) }}>
                <span>Kolizje</span>
                <strong>{dayOpsSummary.teamConflicts + dayOpsSummary.equipmentConflicts}</strong>
              </div>
              <button type="button" style={st.opsAction} onClick={() => setPlanningQueueFilter('ready')}>
                Pokaz gotowe
              </button>
              <button type="button" style={st.opsAction} onClick={() => setActiveTab('equipment')}>
                Sprzet dnia
              </button>
              <button type="button" style={st.opsAction} onClick={() => navigate('/oddzialy')}>
                Delegacje
              </button>
              <button type="button" style={st.opsAction} onClick={copyDayBrief}>
                Kopiuj odprawe
              </button>
            </div>
            {(selectedBranchId && delegationSummary.delegated.length > 0) && (
              <div style={st.delegationStrip}>
                <div style={st.delegationStripHead}>
                  <strong>Aktywne delegacje w oddziale</strong>
                  <span>{delegationSummary.delegatedTasks.length} zlecenia dzisiaj na ekipach delegowanych</span>
                </div>
                <div style={st.delegationChips}>
                  {delegationSummary.delegated.slice(0, 6).map((team) => (
                    <button
                      key={`${team.id}-${teamBranchId(team)}-${team.delegacja_id || 'delegacja'}`}
                      type="button"
                      style={st.delegationChip}
                      onClick={() => {
                        setTeamViewMode('day');
                        navigate(`/kalendarz-zasobow?team=${team.id}&date=${dayISO}`);
                      }}
                    >
                      <strong>{team.nazwa}</strong>
                      <span>{teamDelegationLabel(team)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dayOpsAlerts.length ? (
              <div style={st.opsAlerts}>
                {dayOpsAlerts.map((alert) => (
                  <button
                    key={alert.key}
                    type="button"
                    style={{
                      ...st.opsAlert,
                      ...(alert.tone === 'bad' ? st.opsAlertBad : alert.tone === 'warn' ? st.opsAlertWarn : st.opsAlertGood),
                    }}
                    onClick={() => {
                      if (alert.kind === 'equipment') {
                        setActiveTab('equipment');
                        return;
                      }
                      if (alert.kind === 'queue' && alert.row) {
                        openQueueRepair(alert.row);
                        return;
                      }
                      if (alert.kind === 'attendance') {
                        navigate(`/potwierdzenia-ekip?date=${dayISO}`);
                        return;
                      }
                      if (alert.task) {
                        openTaskPlan(alert.task);
                      }
                    }}
                  >
                    <span style={st.opsAlertCategory}>{alert.category}</span>
                    <strong style={st.opsAlertTitle}>{alert.title}</strong>
                    <small style={st.opsAlertDetail}>{alert.detail}</small>
                    <span style={st.opsAlertAction}>{alert.action}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={st.opsClear}>
                Brak alertów dla tego dnia. Można planować kolejne zlecenia albo sprawdzić sprzęt.
              </div>
            )}
          </div>
        )}

        <div className="zasoby-calendar-scroll" style={{ flex: 1, overflow: 'auto' }}>
          <div className="zasoby-calendar-board" style={{ minWidth: totalW }}>
            {activeTab === 'teams' ? (
              <>
                {planningQueueRows.length > 0 && (
                  <div className="zasoby-queue-panel" style={st.queuePanel}>
                    <div style={st.queueHead}>
                      <div>
                        <strong>Do zaplanowania</strong>
                        <span>{planningQueueStats.all} pozycji w kolejce biura</span>
                      </div>
                      <div style={st.queueSummary}>
                        <span style={st.queueSummaryOk}>{planningQueueStats.ready} gotowe</span>
                        <span style={st.queueSummaryWarn}>{planningQueueStats.missing} z brakami</span>
                      </div>
                    </div>
                    <div style={st.queueFilters}>
                      {PLANNING_QUEUE_FILTERS.map((filter) => (
                        <button
                          key={filter.key}
                          type="button"
                          style={{
                            ...st.queueFilterBtn,
                            ...(planningQueueFilter === filter.key ? st.queueFilterBtnActive : {}),
                          }}
                          onClick={() => setPlanningQueueFilter(filter.key)}
                        >
                          <span>{filter.label}</span>
                          <strong>{planningQueueStats[filter.key] || 0}</strong>
                        </button>
                      ))}
                    </div>
                    <div style={st.queueList}>
                      {filteredPlanningQueue.length ? (
                        filteredPlanningQueue.map((row) => renderPlanningQueueCard(row))
                      ) : (
                        <div style={st.queueEmpty}>Brak pozycji w tym filtrze.</div>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: teamViewMode === 'day' ? 'none' : 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface-glass)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: TEAM_LABEL_W, minWidth: TEAM_LABEL_W, height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, fontWeight: 700, fontSize: 13, borderRight: '1px solid var(--border)', color: 'var(--text-muted)', flexShrink: 0 }}>
                    Ekipa / dzien
                  </div>
                  {days.map((d, i) => {
                    const iso = toISO(d);
                    const isToday = iso === todayISO;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const firstOfMonth = d.getDate() === 1;
                    return (
                      <div key={iso} style={{
                        width: TEAM_COL_W, minWidth: TEAM_COL_W, height: HEADER_H,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: isToday ? 'var(--accent-surface)' : isWeekend ? 'var(--surface-field)' : 'var(--surface-glass)',
                        fontSize: 11, flexShrink: 0,
                      }}>
                        {(i === 0 || firstOfMonth) && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                            {MIESIACE[d.getMonth()]}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{DNI_PL[d.getDay()]}</span>
                        <span style={{
                          fontSize: 14, fontWeight: isToday ? 800 : 500,
                          background: isToday ? 'var(--accent)' : 'transparent',
                          color: isToday ? '#fff' : isWeekend ? 'var(--text-muted)' : 'var(--text)',
                          borderRadius: 20, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {d.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {visibleTeams.length === 0 && (
                  <div style={{ padding: '40px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Brak ekip w wybranym oddziale.
                  </div>
                )}

                {teamViewMode === 'day' ? (
                  <div style={st.dayPlanner}>
                    <div style={st.dayPlannerHeader}>
                      <div style={st.dayTimeHeader}>Godzina</div>
                      {visibleTeams.map((team) => {
                        const teamAttendance = attendanceByTeam.get(String(team.id));
                        const isAbsent = teamAttendance?.present === false;
                        const analysis = dayAnalysisByTeam.get(String(team.id));
                        const hasConflict = (analysis?.conflictIds?.size || 0) > 0;
                        return (
                          <div
                            key={team.id}
                            style={{
                              ...st.dayTeamHeader,
                              ...(isAbsent ? st.dayTeamHeaderAbsent : {}),
                              ...(focusedTeamId && String(team.id) === String(focusedTeamId) ? st.focusedTeamHeader : {}),
                            }}
                          >
                                <span style={st.dayTeamHeaderTop}>
                                  <strong style={st.dayTeamName}>{team.nazwa}</strong>
                                  <button
                                    type="button"
                                    style={st.teamBriefBtn}
                                    aria-label={`Kopiuj odprawe ekipy ${team.nazwa || team.id}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      copyTeamBrief(team);
                                    }}
                                  >
                                    Brief
                                  </button>
                                </span>
                            <span style={isAbsent ? st.teamAttendanceAbsent : undefined}>
                              {isAbsent ? attendanceLine(teamAttendance) : `${teamBranchLabel(team)}${isTeamDelegatedToView(team) ? ' - delegacja' : ''}`}
                            </span>
                            <span style={{ ...st.dayTeamHeaderMeta, ...(hasConflict || isAbsent ? st.dayTeamHeaderMetaConflict : {}) }}>
                              {durationLabel(analysis?.loadMinutes || 0)} pracy - {analysis?.gaps?.length || 0} luk{hasConflict ? ' - konflikt' : ''}{isAbsent ? ' - niedostepna' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={st.dayPlannerBody}>
                      <div style={{ ...st.dayTimeRail, height: dayTimelineHeight }}>
                        {dayHourMarks.map((hour) => (
                          <span
                            key={hour}
                            style={{
                              ...st.dayHourMark,
                              top: Math.max(0, (hour - DAY_START_HOUR) * DAY_HOUR_HEIGHT - 7),
                            }}
                          >
                            {hourLabel(hour)}
                          </span>
                        ))}
                      </div>
                      {visibleTeams.map((team) => {
                        const teamTasks = dayTasksByTeam.get(String(team.id)) || [];
                        const analysis = dayAnalysisByTeam.get(String(team.id));
                        const isFocusedTeam = focusedTeamId && String(team.id) === String(focusedTeamId);
                        const isAbsent = attendanceByTeam.get(String(team.id))?.present === false;
                        return (
                          <div
                            key={team.id}
                            style={{
                              ...st.dayTeamColumn,
                              ...(isAbsent ? st.dayTeamColumnAbsent : {}),
                              ...(isFocusedTeam ? st.focusedTeamColumn : {}),
                              height: dayTimelineHeight,
                            }}
                          >
                            {daySlots.map((hour) => {
                              const slotTime = hourLabel(hour);
                              const isDropHere =
                                String(teamDropTarget?.teamId || '') === String(team.id) &&
                                teamDropTarget?.dayISO === dayISO &&
                                teamDropTarget?.time === slotTime;
                              return (
                                <div
                                  key={`${team.id}-${slotTime}`}
                                  data-testid={`team-slot-${team.id}-${dayISO}-${slotTime}`}
                                  style={{
                                    ...st.dayHourSlot,
                                    top: (hour - DAY_START_HOUR) * DAY_HOUR_HEIGHT,
                                    height: DAY_HOUR_HEIGHT,
                                    background: isDropHere ? 'rgba(34,197,94,0.18)' : 'transparent',
                                  }}
                                  onDragOver={(e) => handleTaskDragOver(e, team.id, dayISO, slotTime)}
                                  onDragLeave={handleTaskDragLeave}
                                  onDrop={(e) => handleTaskDrop(e, team.id, dayISO, slotTime)}
                                />
                              );
                            })}
                            {(analysis?.gaps || []).map((gap) => {
                              const top = ((gap.start - DAY_START_HOUR * 60) / 60) * DAY_HOUR_HEIGHT + 3;
                              const height = Math.max(22, (gap.minutes / 60) * DAY_HOUR_HEIGHT - 6);
                              return (
                                <div
                                  key={`${team.id}-gap-${gap.start}-${gap.end}`}
                                  style={{ ...st.dayGapBlock, top, height }}
                                  title={`Wolne ${minutesToTime(gap.start)}-${minutesToTime(gap.end)}`}
                                >
                                  wolne {minutesToTime(gap.start)}-{minutesToTime(gap.end)}
                                </div>
                              );
                            })}
                            {teamTasks.length ? teamTasks.map(renderDayTaskBlock) : (
                              <div style={{ ...st.dayEmptyColumn, ...(isAbsent ? st.dayEmptyColumnAbsent : {}) }}>
                                {isAbsent ? 'Ekipa nieobecna' : 'Brak zlecen w tym dniu'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : visibleTeams.map((team) => {
                  const teamAttendance = attendanceByTeam.get(String(team.id));
                  const isAbsent = teamAttendance?.present === false;
                  return (
                  <div
                    key={team.id}
                    style={{
                      display: 'flex',
                      borderBottom: '1px solid var(--border)',
                      minHeight: TEAM_ROW_H,
                      ...(isAbsent ? st.absentTeamRangeRow : {}),
                      ...(focusedTeamId && String(team.id) === String(focusedTeamId) ? st.focusedTeamRangeRow : {}),
                    }}
                  >
                    <div style={{
                      width: TEAM_LABEL_W, minWidth: TEAM_LABEL_W, minHeight: TEAM_ROW_H,
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      paddingLeft: 16, paddingRight: 12,
                      borderRight: '1px solid var(--border)',
                      flexShrink: 0, overflow: 'hidden',
                    }}>
                      <div style={st.rangeTeamTop}>
                        <div style={st.rangeTeamName}>{team.nazwa}</div>
                        <button
                          type="button"
                          style={st.teamBriefBtn}
                          aria-label={`Kopiuj odprawe ekipy ${team.nazwa || team.id}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            copyTeamBrief(team);
                          }}
                        >
                          Brief
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, ...(isAbsent ? st.teamAttendanceAbsent : {}) }}>
                        {isAbsent ? attendanceLine(teamAttendance) : `${teamBranchLabel(team)}${isTeamDelegatedToView(team) ? ' - delegacja' : ''}`}
                      </div>
                    </div>
                    {days.map((d) => {
                      const iso = toISO(d);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = iso === todayISO;
                      const firstOfMonth = d.getDate() === 1;
                      const isDropHere = String(teamDropTarget?.teamId || '') === String(team.id) && teamDropTarget?.dayISO === iso;
                      const isFocusedTeamDay =
                        focusedTeamId &&
                        focusedDate &&
                        String(team.id) === String(focusedTeamId) &&
                        iso === focusedDate;
                      const isAbsentCell = isAbsent && iso === dayISO;
                      const cellTasks = tasksByTeamDay.get(`${team.id}|${iso}`) || [];
                      return (
                        <div
                          key={`${team.id}-${iso}`}
                          data-testid={`team-day-${team.id}-${iso}`}
                          style={{
                            width: TEAM_COL_W,
                            minWidth: TEAM_COL_W,
                            minHeight: TEAM_ROW_H,
                            borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: isDropHere
                              ? 'rgba(34,197,94,0.18)'
                              : isFocusedTeamDay
                              ? 'rgba(34,197,94,0.2)'
                              : isAbsentCell
                              ? 'rgba(239,68,68,0.1)'
                              : isToday
                              ? 'var(--accent-surface)'
                              : isWeekend
                              ? 'var(--surface-field)'
                              : 'transparent',
                            padding: 8,
                            boxSizing: 'border-box',
                            overflowY: 'auto',
                          }}
                          onDragOver={(e) => handleTaskDragOver(e, team.id, iso)}
                          onDragLeave={handleTaskDragLeave}
                          onDrop={(e) => handleTaskDrop(e, team.id, iso)}
                        >
                          {cellTasks.length ? cellTasks.map(renderTaskCard) : <div style={{ ...st.emptyTeamCell, ...(isAbsentCell ? st.emptyTeamCellAbsent : {}) }}>{isAbsentCell ? 'nieobecna' : 'wolne'}</div>}
                        </div>
                      );
                    })}
                  </div>
                  );
                })}
              </>
            ) : (
              <>

            {/* nagłówek dat */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface-glass)', borderBottom: '1px solid var(--border)' }}>
              {/* lewa kolumna — sprzęt */}
              <div style={{ width: LABEL_W, minWidth: LABEL_W, height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, fontWeight: 700, fontSize: 13, borderRight: '1px solid var(--border)', color: 'var(--text-muted)', flexShrink: 0 }}>
                Sprzęt / Zasób
              </div>
              {/* kolumny dni */}
              {days.map((d, i) => {
                const iso = toISO(d);
                const isToday = iso === todayISO;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const firstOfMonth = d.getDate() === 1;
                return (
                  <div key={iso} style={{
                    width: COL_W, minWidth: COL_W, height: HEADER_H,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: isToday ? 'var(--accent-surface)' : isWeekend ? 'var(--surface-field)' : 'var(--surface-glass)',
                    fontSize: 11, flexShrink: 0,
                  }}>
                    {(i === 0 || firstOfMonth) && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        {MIESIACE[d.getMonth()]}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{DNI_PL[d.getDay()]}</span>
                    <span style={{
                      fontSize: 14, fontWeight: isToday ? 800 : 500,
                      background: isToday ? 'var(--accent)' : 'transparent',
                      color: isToday ? '#fff' : isWeekend ? 'var(--text-muted)' : 'var(--text)',
                      borderRadius: 20, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* wiersze sprzętu */}
            {visibleSprzet.length === 0 && (
              <div style={{ padding: '40px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                Brak sprzetu w wybranym oddziale. Dodaj urzadzenia w module Flota albo zmien filtr oddzialu.
              </div>
            )}

            {visibleSprzet.map((s) => {
              const rowRez = rezBySprzet[s.id] || [];
              const isFocusedEquipment = focusedEquipmentIds.has(String(s.id));

              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    borderBottom: '1px solid var(--border)',
                    minHeight: ROW_H,
                    ...(isFocusedEquipment ? st.focusedEquipmentRow : {}),
                  }}
                >
                  {/* etykieta sprzętu */}
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W, height: ROW_H,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    paddingLeft: 16, paddingRight: 8,
                    borderRight: '1px solid var(--border)',
                    flexShrink: 0, overflow: 'hidden',
                    ...(isFocusedEquipment ? st.focusedEquipmentLabel : {}),
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nazwa}</div>
                    {s.typ && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.typ}</div>}
                  </div>

                  {/* komórki dni — wrapper relatywny dla absolutnych barów */}
                  <div style={{ flex: 1, position: 'relative', height: ROW_H }}>
                    {/* tło komórek — drop zones */}
                    {days.map((d) => {
                      const iso = toISO(d);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = iso === todayISO;
                      const isDropHere = dropTarget?.sprzetId === s.id && dropTarget?.dayISO === iso;
                      const isFocusedEquipmentDay = isFocusedEquipment && focusedDate && iso === focusedDate;
                      const colIdx = diffDays(toISO(days[0]), iso);
                      const firstOfMonth = d.getDate() === 1;
                      return (
                        <div
                          key={iso}
                          style={{
                            position: 'absolute',
                            left: colIdx * COL_W,
                            top: 0,
                            width: COL_W,
                            height: ROW_H,
                            borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: isDropHere
                              ? 'rgba(59,130,246,0.25)'
                              : isFocusedEquipmentDay
                              ? 'rgba(59,130,246,0.2)'
                              : isToday
                              ? 'var(--accent-surface)'
                              : isWeekend
                              ? 'var(--surface-field)'
                              : 'transparent',
                            cursor: canEdit ? 'pointer' : 'default',
                            zIndex: 1,
                          }}
                          onClick={() => canEdit && setModalNew({ sprzetId: s.id, date: iso })}
                          onDragOver={(e) => handleDragOver(e, s.id, iso)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, s.id, iso)}
                        />
                      );
                    })}

                    {/* paski rezerwacji */}
                    {rowRez.map((rez) => renderBar(rez, 0))}
                  </div>
                </div>
              );
            })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── modals ──────────────────────────────────────────────────────────── */}
      {modalNew && (
        <NowaRezerwacjaModal
          sprzet={visibleSprzet.length ? visibleSprzet : sprzet}
          ekipy={teamsForPlanning}
          defaultSprzet={modalNew.sprzetId}
          defaultDate={modalNew.date}
          onSave={handleNewSave}
          onClose={() => { setModalNew(null); setModalErr(''); }}
          saving={saving}
          error={modalErr}
        />
      )}
      {modalDet && (
        <RezerwacjaDetailModal
          rez={modalDet}
          ekipy={teamsForPlanning}
          onStatusChange={handleStatusChange}
          onOpenTask={() => {
            setModalDet(null);
            navigate(`/zlecenia?search=${modalDet.task_id}`);
          }}
          onClose={() => setModalDet(null)}
          saving={saving}
        />
      )}
      {modalTaskPlan && (
        <TaskPlanModal
          key={modalTaskPlan.id}
          task={modalTaskPlan}
          teams={plannerTeams}
          tasks={tasks}
          sprzet={visibleSprzet.length ? visibleSprzet : sprzet}
          rezerwacje={rezerwacje}
          attendanceByTeam={attendanceByTeam}
          onSave={handleTaskPlanSave}
          onClose={closeTaskPlan}
          onOpenTask={() => openFullTask(modalTaskPlan)}
          saving={saving}
          error={taskPlanErr}
        />
      )}
    </div>
  );
}

// ─── style ───────────────────────────────────────────────────────────────────
const st = {
  pageHeader: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px',
    margin: '22px clamp(16px, 2.4vw, 30px) 14px',
    border: '1px solid rgba(15,95,58,0.14)',
    borderRadius: 8,
    background:
      'linear-gradient(90deg, rgba(15,107,63,0.045) 1px, transparent 1px), linear-gradient(0deg, rgba(15,107,63,0.04) 1px, transparent 1px), linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,249,244,0.96))',
    backgroundSize: '34px 34px, 34px 34px, auto',
    boxShadow: '0 16px 40px rgba(31,79,50,0.09)',
    flexWrap: 'wrap',
  },
  pageTitle: {
    margin: 0, fontSize: 22, fontWeight: 950, color: '#12251a',
    marginLeft: 'auto',
  },
  navBtn: {
    width: 34, height: 34, border: '1px solid rgba(15,95,58,0.16)', borderRadius: 8,
    background: '#ffffff', cursor: 'pointer', fontSize: 18,
    color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  },
  todayBtn: {
    padding: '7px 12px', border: '1px solid rgba(15,95,58,0.16)', borderRadius: 8,
    background: '#ffffff', cursor: 'pointer', fontSize: 13,
    color: 'var(--text)', fontWeight: 850,
  },
  periodLabel: {
    fontSize: 15, fontWeight: 600, color: 'var(--text)',
  },
  viewBtn: {
    padding: '7px 12px', border: '1px solid rgba(15,95,58,0.13)', borderRadius: 8,
    cursor: 'pointer', fontSize: 13, fontWeight: 850,
  },
  branchSelect: {
    minWidth: 170,
    height: 32,
    padding: '5px 10px',
    border: '1px solid rgba(15,95,58,0.16)',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 600,
  },
  flash: {
    padding: '8px 24px', fontSize: 13, fontWeight: 500,
  },
  legend: {
    display: 'flex', alignItems: 'center', gap: 16,
    margin: '0 clamp(16px, 2.4vw, 30px) 14px',
    padding: '10px 12px',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
    fontSize: 12,
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)',
  },
  legendDot: {
    width: 10, height: 10, borderRadius: 3, flexShrink: 0,
  },
  opsPanel: {
    margin: '0 clamp(16px, 2.4vw, 30px) 14px',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 12px 30px rgba(31,79,50,0.07)',
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  opsTitle: {
    minWidth: 180,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    color: 'var(--text)',
    fontSize: 13,
  },
  opsGrid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
    gap: 8,
    alignItems: 'stretch',
    minWidth: 260,
  },
  opsMetric: {
    minHeight: 46,
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    padding: '7px 9px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
    boxSizing: 'border-box',
  },
  opsMetricWarn: {
    border: '1px solid rgba(245,158,11,0.45)',
    background: 'rgba(245,158,11,0.1)',
  },
  opsMetricInfo: {
    border: '1px solid rgba(14,165,233,0.45)',
    background: 'rgba(14,165,233,0.1)',
  },
  opsMetricBad: {
    border: '1px solid rgba(239,68,68,0.55)',
    background: 'rgba(239,68,68,0.12)',
  },
  opsAction: {
    minHeight: 46,
    border: '1px solid rgba(34,197,94,0.38)',
    borderRadius: 8,
    background: 'rgba(34,197,94,0.13)',
    color: 'var(--accent)',
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  delegationStrip: {
    width: '100%',
    border: '1px solid rgba(14,165,233,0.24)',
    borderRadius: 8,
    background: 'rgba(14,165,233,0.08)',
    padding: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  delegationStripHead: {
    minWidth: 210,
    display: 'grid',
    gap: 2,
    color: 'var(--text)',
    fontSize: 12,
  },
  delegationChips: {
    flex: 1,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  delegationChip: {
    border: '1px solid rgba(14,165,233,0.32)',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--text)',
    padding: '7px 10px',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 850,
  },
  opsAlerts: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
  },
  opsAlert: {
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    padding: '9px 10px',
    display: 'grid',
    gap: 3,
    textAlign: 'left',
    cursor: 'pointer',
    minHeight: 92,
  },
  opsAlertBad: {
    border: '1px solid rgba(239,68,68,0.46)',
    background: 'rgba(239,68,68,0.1)',
  },
  opsAlertWarn: {
    border: '1px solid rgba(245,158,11,0.42)',
    background: 'rgba(245,158,11,0.1)',
  },
  opsAlertGood: {
    border: '1px solid rgba(34,197,94,0.34)',
    background: 'rgba(34,197,94,0.09)',
  },
  opsAlertCategory: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  opsAlertTitle: {
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.2,
    fontWeight: 950,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  opsAlertDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.3,
    fontWeight: 750,
    overflowWrap: 'anywhere',
  },
  opsAlertAction: {
    marginTop: 'auto',
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 950,
  },
  opsClear: {
    width: '100%',
    border: '1px dashed rgba(34,197,94,0.3)',
    borderRadius: 8,
    background: 'rgba(34,197,94,0.07)',
    color: 'var(--text-muted)',
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 850,
  },
  queuePanel: {
    margin: '0 clamp(16px, 2.4vw, 30px) 14px',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 12px 30px rgba(31,79,50,0.07)',
    padding: 14,
  },
  queueHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
    color: 'var(--text)',
    fontSize: 13,
    flexWrap: 'wrap',
  },
  queueSummary: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 900,
  },
  queueSummaryOk: {
    color: '#16a34a',
  },
  queueSummaryWarn: {
    color: '#b45309',
  },
  queueFilters: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  queueFilterBtn: {
    minHeight: 31,
    border: '1px solid rgba(15,95,58,0.16)',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    padding: '5px 8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 850,
  },
  queueFilterBtnActive: {
    border: '1px solid rgba(34,197,94,0.42)',
    background: 'rgba(34,197,94,0.14)',
    color: 'var(--accent)',
  },
  queueList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
    gap: 8,
  },
  queueTaskWrap: {
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    background: '#ffffff',
    padding: 6,
    minWidth: 0,
  },
  queueTaskWrapReady: {
    border: '1px solid rgba(34,197,94,0.32)',
    background: 'rgba(34,197,94,0.07)',
  },
  queueTaskMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    color: 'var(--text-muted)',
    fontSize: 10.5,
    fontWeight: 800,
    lineHeight: 1.2,
  },
  queueReadyPill: {
    borderRadius: 999,
    padding: '3px 6px',
    border: '1px solid rgba(15,95,58,0.13)',
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 950,
  },
  queueReadyPillOk: {
    color: '#16a34a',
    border: '1px solid rgba(34,197,94,0.35)',
    background: 'rgba(34,197,94,0.12)',
  },
  queueReadyPillWarn: {
    color: '#b45309',
    border: '1px solid rgba(245,158,11,0.35)',
    background: 'rgba(245,158,11,0.12)',
  },
  queueMissingList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  queueMissingPill: {
    borderRadius: 999,
    padding: '3px 6px',
    border: '1px solid rgba(245,158,11,0.32)',
    background: 'rgba(245,158,11,0.1)',
    color: '#b45309',
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 900,
  },
  queueActions: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 6,
    marginTop: 8,
  },
  queueActionBtn: {
    minWidth: 0,
    border: '1px solid var(--border)',
    borderRadius: 7,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '6px 8px',
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  queueActionBtnPrimary: {
    border: '1px solid rgba(34,197,94,0.42)',
    background: 'rgba(34,197,94,0.14)',
    color: 'var(--accent)',
  },
  queueEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    background: 'rgba(0,0,0,0.08)',
    padding: 14,
    fontSize: 12,
    fontWeight: 800,
  },
  taskCard: {
    minHeight: 54,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    padding: '7px 8px',
    marginBottom: 6,
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
    cursor: 'grab',
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  taskCardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    fontSize: 11,
  },
  taskStatus: {
    color: '#fff',
    borderRadius: 999,
    padding: '2px 6px',
    fontSize: 9,
    fontWeight: 800,
    maxWidth: 82,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  taskTitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskMeta: {
    marginTop: 3,
    fontSize: 10,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskBadges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 5,
  },
  taskBadge: {
    borderRadius: 999,
    padding: '2px 5px',
    fontSize: 9.5,
    lineHeight: 1.1,
    fontWeight: 900,
    border: '1px solid var(--border)',
  },
  taskBadgeOk: {
    color: '#15803d',
    border: '1px solid rgba(34,197,94,0.35)',
    background: 'rgba(34,197,94,0.11)',
  },
  taskBadgeWarn: {
    color: '#b45309',
    border: '1px solid rgba(245,158,11,0.35)',
    background: 'rgba(245,158,11,0.12)',
  },
  emptyTeamCell: {
    minHeight: 40,
    border: '1px dashed var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.72,
  },
  emptyTeamCellAbsent: {
    border: '1px dashed rgba(239,68,68,0.35)',
    background: 'rgba(239,68,68,0.08)',
    color: '#dc2626',
  },
  dayPlanner: {
    minWidth: '100%',
    background: 'var(--bg)',
  },
  dayPlannerHeader: {
    display: 'flex',
    position: 'sticky',
    top: 0,
    zIndex: 12,
    background: 'var(--surface-glass)',
    borderBottom: '1px solid var(--border)',
  },
  dayTimeHeader: {
    width: DAY_TIME_LABEL_W,
    minWidth: DAY_TIME_LABEL_W,
    height: HEADER_H,
    borderRight: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  dayTeamHeader: {
    width: DAY_TEAM_COL_W,
    minWidth: DAY_TEAM_COL_W,
    height: HEADER_H,
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '0 12px',
    boxSizing: 'border-box',
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.25,
  },
  dayTeamHeaderAbsent: {
    borderRight: '1px solid rgba(239,68,68,0.42)',
    background: 'linear-gradient(135deg, rgba(239,68,68,0.14), var(--surface-glass))',
    boxShadow: 'inset 0 -2px 0 rgba(239,68,68,0.65)',
  },
  dayTeamHeaderTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 0,
  },
  dayTeamName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rangeTeamTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 0,
  },
  rangeTeamName: {
    minWidth: 0,
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  teamBriefBtn: {
    flexShrink: 0,
    border: '1px solid rgba(34,197,94,0.34)',
    borderRadius: 7,
    background: 'rgba(34,197,94,0.1)',
    color: 'var(--accent)',
    padding: '4px 7px',
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 900,
    cursor: 'pointer',
  },
  teamAttendanceAbsent: {
    color: '#dc2626',
    fontWeight: 950,
  },
  dayTeamHeaderMeta: {
    display: 'inline-flex',
    marginTop: 4,
    color: '#16a34a',
    fontSize: 10,
    fontWeight: 900,
  },
  dayTeamHeaderMetaConflict: {
    color: '#ef4444',
  },
  focusedTeamHeader: {
    background: 'linear-gradient(135deg, rgba(34,197,94,0.18), var(--surface-glass))',
    boxShadow: 'inset 0 -2px 0 rgba(34,197,94,0.72)',
  },
  focusedTeamColumn: {
    background: 'linear-gradient(180deg, rgba(34,197,94,0.08), var(--surface-glass))',
  },
  absentTeamRangeRow: {
    boxShadow: 'inset 3px 0 0 #ef4444',
    background: 'rgba(239,68,68,0.045)',
  },
  focusedTeamRangeRow: {
    boxShadow: 'inset 3px 0 0 var(--accent)',
    background: 'rgba(34,197,94,0.05)',
  },
  focusedEquipmentRow: {
    boxShadow: 'inset 3px 0 0 #3b82f6',
    background: 'rgba(59,130,246,0.05)',
  },
  focusedEquipmentLabel: {
    background: 'linear-gradient(135deg, rgba(59,130,246,0.16), transparent)',
  },
  dayPlannerBody: {
    display: 'flex',
    alignItems: 'stretch',
  },
  dayTimeRail: {
    width: DAY_TIME_LABEL_W,
    minWidth: DAY_TIME_LABEL_W,
    position: 'relative',
    borderRight: '1px solid var(--border)',
    background: 'var(--surface-glass)',
  },
  dayHourMark: {
    position: 'absolute',
    right: 10,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1,
  },
  dayTeamColumn: {
    width: DAY_TEAM_COL_W,
    minWidth: DAY_TEAM_COL_W,
    position: 'relative',
    borderRight: '1px solid var(--border)',
    background: 'var(--surface-glass)',
    overflow: 'hidden',
  },
  dayTeamColumnAbsent: {
    background: 'linear-gradient(180deg, rgba(239,68,68,0.09), var(--surface-glass))',
  },
  dayHourSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTop: '1px solid var(--border)',
    boxSizing: 'border-box',
  },
  dayTaskBlock: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 2,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    color: 'var(--text)',
    padding: '7px 8px',
    overflow: 'hidden',
    cursor: 'grab',
    boxSizing: 'border-box',
  },
  dayTaskBlockConflict: {
    border: '1px solid rgba(239,68,68,0.72)',
    background: 'linear-gradient(135deg, rgba(239,68,68,0.16), var(--surface-field))',
    boxShadow: '0 0 0 2px rgba(239,68,68,0.16), 0 2px 8px rgba(0,0,0,0.22)',
  },
  dayTaskTime: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1.2,
  },
  dayTaskTitle: {
    display: 'block',
    marginTop: 3,
    fontSize: 12,
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dayTaskMeta: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text-muted)',
    fontSize: 10,
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dayEmptyColumn: {
    position: 'absolute',
    top: 12,
    left: 10,
    right: 10,
    border: '1px dashed var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    padding: 10,
    textAlign: 'center',
    opacity: 0.72,
  },
  dayEmptyColumnAbsent: {
    border: '1px dashed rgba(239,68,68,0.35)',
    background: 'rgba(239,68,68,0.08)',
    color: '#dc2626',
  },
  dayGapBlock: {
    position: 'absolute',
    left: 9,
    right: 9,
    zIndex: 1,
    border: '1px dashed rgba(34,197,94,0.48)',
    borderRadius: 8,
    background: 'rgba(34,197,94,0.08)',
    color: '#16a34a',
    fontSize: 10,
    fontWeight: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
};
