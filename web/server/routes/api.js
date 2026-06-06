const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { readOnly, withStore } = require('../lib/store');
const { requireAuth, publicUser, signUser } = require('../lib/auth');
const { canViewCmr, enrichCmr } = require('../lib/cmrAccess');
const {
  TASK_STATUS,
  isTaskClosed,
  isTaskDone,
  isTaskInProgress,
  isValidTaskStatus,
  normalizeTaskStatus,
  canTransitionTaskStatus,
  taskStageLabel: workflowTaskStageLabel,
} = require('../lib/taskWorkflow');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'wyceny');
const UP_TASK_PHOTOS = path.join(__dirname, '..', 'uploads', 'tasks');
const UP_OGLEDZINY_MEDIA = path.join(__dirname, '..', 'uploads', 'ogledziny');
const UP_EMPLOYEE_DOCUMENTS = path.join(__dirname, '..', 'uploads', 'employee-documents');
const KOMMO_WEBHOOK_URL =
  (process.env.KOMMO_WEBHOOK_URL || process.env.KOMMO_CMR_WEBHOOK_URL || '').trim();
/** Osobny URL dla pushy CRM (zlecenie / klient). Gdy pusty — używany jest KOMMO_WEBHOOK_URL. */
const KOMMO_CRM_WEBHOOK_URL = (process.env.KOMMO_CRM_WEBHOOK_URL || '').trim();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'arbor-api-local',
    mode: 'file-db',
    crm: { overview: true },
  });
});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsvStrings(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const KOMMO_WEBHOOK_SECRET_HEADER = (process.env.KOMMO_WEBHOOK_SECRET_HEADER || '').trim();
const KOMMO_WEBHOOK_SECRET = (process.env.KOMMO_WEBHOOK_SECRET || '').trim();
const KOMMO_PIPELINE_ID = toNum(process.env.KOMMO_PIPELINE_ID);
const KOMMO_STATUS_ID = toNum(process.env.KOMMO_STATUS_ID);
const KOMMO_RESPONSIBLE_USER_ID = toNum(process.env.KOMMO_RESPONSIBLE_USER_ID);
const KOMMO_TAGS = parseCsvStrings(process.env.KOMMO_TAGS || 'CMR,Arbor');
const KOMMO_CF_CMR_NUMBER_ID = toNum(process.env.KOMMO_CF_CMR_NUMBER_ID);
const KOMMO_CF_ORDER_ID = toNum(process.env.KOMMO_CF_ORDER_ID);
/** Oddział w Kommo = z powiązanego zlecenia (task), nie z rekordu CMR. */
const KOMMO_CF_BRANCH_ID = toNum(process.env.KOMMO_CF_BRANCH_ID);
const KOMMO_CF_PLATE_ID = toNum(process.env.KOMMO_CF_PLATE_ID);
const KOMMO_CF_DRIVER_ID = toNum(process.env.KOMMO_CF_DRIVER_ID);
const KOMMO_CF_STATUS_ID = toNum(process.env.KOMMO_CF_STATUS_ID);
const KOMMO_CF_LOAD_DATE_ID = toNum(process.env.KOMMO_CF_LOAD_DATE_ID);
const KOMMO_CF_UNLOAD_DATE_ID = toNum(process.env.KOMMO_CF_UNLOAD_DATE_ID);
const KOMMO_CF_GOODS_SUMMARY_ID = toNum(process.env.KOMMO_CF_GOODS_SUMMARY_ID);
/** ID rekordu klienta w ARBOR — pole leada w Kommo (opcjonalnie). */
const KOMMO_CF_KLIENT_RECORD_ID = toNum(process.env.KOMMO_CF_KLIENT_RECORD_ID);
/** Telefon kontaktu — dla zlecenia / klienta (opcjonalnie). */
const KOMMO_CF_PHONE_ID = toNum(process.env.KOMMO_CF_PHONE_ID);
const KOMMO_CRM_TAGS = parseCsvStrings(process.env.KOMMO_CRM_TAGS || 'Arbor,CRM');

function userName(state, id) {
  if (!id) return null;
  const u = state.users.find((x) => x.id === id);
  return u ? `${u.imie} ${u.nazwisko}` : null;
}

function latestOgledzinyFieldEvent(state, ogledzinyId) {
  const id = Number(ogledzinyId);
  return (state.ogledzinyFieldEvents || [])
    .filter((event) => Number(event.ogledziny_id) === id)
    .sort((a, b) => {
      const byTime = new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime();
      if (byTime !== 0) return byTime;
      return Number(b.id || 0) - Number(a.id || 0);
    })[0] || null;
}

function withOgledzinyLive(state, row) {
  const event = latestOgledzinyFieldEvent(state, row.id);
  if (!event) return row;
  return {
    ...row,
    live_event_type: event.event_type,
    live_recorded_at: event.recorded_at,
    live_lat: event.lat,
    live_lng: event.lng,
    live_eta_min: event.eta_min,
    live_note: event.note,
  };
}

function dateYmd(value) {
  return String(value || '').slice(0, 10);
}

function resourceDate(value) {
  return dateYmd(value) || new Date().toISOString().slice(0, 10);
}

function buildLocalPlannedDateTime(dataPlanowana, godzinaRozpoczecia) {
  const rawDate = String(dataPlanowana || '').trim();
  if (!rawDate) return rawDate;
  const rawHour = String(godzinaRozpoczecia || '').trim().slice(0, 5);
  if (!rawHour) return rawDate;
  const datePart = rawDate.includes('T') ? rawDate.slice(0, 10) : rawDate.split(' ')[0];
  const hourMatch = rawHour.match(/^(\d{1,2}):(\d{2})$/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || !hourMatch) return rawDate;
  const hh = String(Math.min(23, Number(hourMatch[1]))).padStart(2, '0');
  const mm = String(Math.min(59, Number(hourMatch[2]))).padStart(2, '0');
  return `${datePart}T${hh}:${mm}:00`;
}

function localPlanMinutes(value, fallbackTime = '08:00') {
  const raw = String(value || '').trim();
  const time = raw.includes('T') ? raw.split('T')[1]?.slice(0, 5) : String(fallbackTime || '08:00').slice(0, 5);
  const match = String(time || '08:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 8 * 60;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

function localTaskBusyRanges(state, teamId, day, ignoreTaskId = null) {
  return (state.zlecenia || [])
    .filter((task) => Number(task.ekipa_id) === Number(teamId))
    .filter((task) => Number(task.id) !== Number(ignoreTaskId))
    .filter((task) => !isTaskClosed(task.status))
    .filter((task) => resourceDate(task.data_planowana) === day)
    .map((task) => {
      const start = localPlanMinutes(task.data_planowana, task.godzina_rozpoczecia);
      const duration = Math.max(15, Math.round(Number(task.czas_planowany_godziny || 2) * 60));
      return { start, end: start + duration, taskId: task.id };
    });
}

function localPlanConflicts(ranges, start, duration) {
  const end = start + duration;
  return ranges.some((range) => start < range.end && end > range.start);
}

const CLOSED_DELEGATION_STATUSES = new Set(['Anulowana', 'Zakonczona', 'Zakończona']);

function isActiveDelegation(d, day = resourceDate()) {
  if (!d || CLOSED_DELEGATION_STATUSES.has(String(d.status || ''))) return false;
  const from = dateYmd(d.data_od);
  const to = dateYmd(d.data_do);
  return (!from || from <= day) && (!to || to >= day);
}

function branchName(state, id) {
  const branch = (state.oddzialy || []).find((o) => String(o.id) === String(id));
  return branch?.nazwa || null;
}

function delegationUserId(d) {
  return toNum(d?.user_id ?? d?.wyceniajacy_id);
}

function isEstimatorRole(role) {
  const raw = String(role || '').toLowerCase();
  return raw.includes('wyceniaj') || raw.includes('wyceniajä');
}

function teamDelegationForBranch(state, teamId, branchId, day = resourceDate()) {
  if (!teamId || !branchId) return null;
  return (state.delegacje || []).find((d) =>
    toNum(d.ekipa_id) === Number(teamId) &&
    toNum(d.oddzial_do) === Number(branchId) &&
    isActiveDelegation(d, day)
  ) || null;
}

function userDelegationForBranch(state, userId, branchId, day = resourceDate()) {
  if (!userId || !branchId) return null;
  return (state.delegacje || []).find((d) =>
    delegationUserId(d) === Number(userId) &&
    toNum(d.oddzial_do) === Number(branchId) &&
    isActiveDelegation(d, day)
  ) || null;
}

function teamAvailableForBranch(state, teamId, branchId, day = resourceDate()) {
  if (!teamId || !branchId) return true;
  const team = (state.teams || []).find((t) => Number(t.id) === Number(teamId));
  if (!team) return false;
  return Number(team.oddzial_id) === Number(branchId) || Boolean(teamDelegationForBranch(state, teamId, branchId, day));
}

function userAvailableForBranch(state, userId, branchId, day = resourceDate()) {
  if (!userId || !branchId) return true;
  const user = (state.users || []).find((u) => Number(u.id) === Number(userId));
  if (!user) return false;
  return Number(user.oddzial_id) === Number(branchId) || Boolean(userDelegationForBranch(state, userId, branchId, day));
}

function enrichTeamForBranch(state, team, branchId = null, day = resourceDate()) {
  const homeBranchId = toNum(team.oddzial_id);
  const delegation = branchId ? teamDelegationForBranch(state, team.id, branchId, day) : null;
  return {
    ...team,
    oddzial_nazwa: branchName(state, homeBranchId),
    oddzial_macierzysty_id: homeBranchId,
    oddzial_macierzysty_nazwa: branchName(state, homeBranchId),
    dostepny_w_oddziale_id: branchId || homeBranchId,
    dostepny_w_oddziale_nazwa: branchName(state, branchId || homeBranchId),
    delegowany: Boolean(delegation && Number(homeBranchId) !== Number(branchId)),
    delegacja_id: delegation?.id || null,
    delegowany_do_oddzial_id: delegation ? toNum(delegation.oddzial_do) : null,
    delegowany_do_oddzial_nazwa: delegation ? branchName(state, delegation.oddzial_do) : null,
    delegacja_cel: delegation?.cel || null,
  };
}

function enrichUserForBranch(state, user, branchId = null, day = resourceDate()) {
  const homeBranchId = toNum(user.oddzial_id);
  const delegation = branchId ? userDelegationForBranch(state, user.id, branchId, day) : null;
  return {
    ...stripUser(user),
    oddzial_nazwa: branchName(state, homeBranchId),
    oddzial_macierzysty_id: homeBranchId,
    oddzial_macierzysty_nazwa: branchName(state, homeBranchId),
    dostepny_w_oddziale_id: branchId || homeBranchId,
    dostepny_w_oddziale_nazwa: branchName(state, branchId || homeBranchId),
    delegowany: Boolean(delegation && Number(homeBranchId) !== Number(branchId)),
    delegacja_id: delegation?.id || null,
    delegowany_do_oddzial_id: delegation ? toNum(delegation.oddzial_do) : null,
    delegowany_do_oddzial_nazwa: delegation ? branchName(state, delegation.oddzial_do) : null,
    delegacja_cel: delegation?.cel || null,
  };
}

function buildBranchResources(state, branchId, day = resourceDate()) {
  const bid = toNum(branchId);
  const ekipy = (state.teams || [])
    .filter((team) => Number(team.oddzial_id) === Number(bid) || teamDelegationForBranch(state, team.id, bid, day))
    .map((team) => enrichTeamForBranch(state, team, bid, day));
  const wyceniajacy = (state.users || [])
    .filter((user) => isEstimatorRole(user.rola))
    .filter((user) => Number(user.oddzial_id) === Number(bid) || userDelegationForBranch(state, user.id, bid, day))
    .map((user) => enrichUserForBranch(state, user, bid, day));
  return { oddzial_id: bid, date: day, ekipy, wyceniajacy };
}

function teamBranchError(state, teamId, branchId, day = resourceDate()) {
  if (!teamId || !branchId || teamAvailableForBranch(state, teamId, branchId, day)) return null;
  const team = (state.teams || []).find((t) => Number(t.id) === Number(teamId));
  const teamName = team?.nazwa || `Ekipa #${teamId}`;
  const from = branchName(state, team?.oddzial_id) || 'inny oddzial';
  const to = branchName(state, branchId) || `oddzial #${branchId}`;
  return `${teamName} nalezy do ${from}. Do ${to} mozna ja przypisac tylko przez aktywna delegacje.`;
}

function enrichWycena(state, z) {
  const wyceniajacy_nazwa = userName(state, z.created_by);
  const ekipa = state.teams.find((t) => t.id === z.ekipa_id);
  const zatwierdzone_przez_nazwa = userName(state, z.zatwierdzone_przez);
  const oddzial = (state.oddzialy || []).find((o) => o.id === z.oddzial_id);
  return {
    ...z,
    wyceniajacy_nazwa,
    ekipa_nazwa: ekipa?.nazwa || null,
    zatwierdzone_przez_nazwa,
    oddzial_nazwa: oddzial?.nazwa || null,
    kierownik_nazwa: userName(state, z.kierownik_id),
  };
}

function enrichQuotation(state, z) {
  const row = enrichWycena(state, z);
  return {
    ...row,
    status: row.status || (row.wyceniajacy_id ? 'Umowiana' : 'OczekujePrzypisania'),
    quotation_id: row.id,
    approval_id: row.approval_id || `demo-${row.id}`,
    wymagany_typ: row.wymagany_typ || 'Kierownik',
    decyzja: row.decyzja || 'Pending',
    due_at: row.due_at || row.data_wykonania || row.data_planowana || null,
  };
}

function canSeeAllZlecenia(user) {
  return ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);
}

function isEstimatorUser(user) {
  return user?.rola === 'Wyceniający' || user?.rola === 'Wyceniajacy';
}

function isSalesDirector(user) {
  return [
    'Dyrektor Sprzedazy',
    'Dyrektor Sprzedaży',
    'Dyrektor dzialu sprzedaz',
    'Dyrektor działu sprzedaż',
  ].includes(user?.rola);
}

function canSeeAllBranches(user) {
  return canSeeAllZlecenia(user) || isSalesDirector(user);
}

function canSeeAllTaskRows(user) {
  return canSeeAllZlecenia(user) || isSalesDirector(user);
}

function canManageTaskRows(user) {
  return canSeeAllZlecenia(user) || user?.rola === 'Kierownik';
}

function canViewTeamRanking(user) {
  return canManageTaskRows(user) || isSalesDirector(user);
}

function canAccessOddzial(user, oddzialId) {
  return canSeeAllBranches(user) || String(user?.oddzial_id) === String(oddzialId);
}

function canTransferSpecialist(user, target) {
  if (canSeeAllZlecenia(user)) return true;
  return isSalesDirector(user) && target?.rola === 'Specjalista';
}

function visibleZlecenia(state, user) {
  const rows = state.zlecenia || [];
  if (canSeeAllTaskRows(user)) return rows;
  if (user.rola === 'Kierownik') return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  if (['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(user.rola) && user.ekipa_id) {
    return rows.filter((z) => String(z.ekipa_id) === String(user.ekipa_id));
  }
  if (isEstimatorUser(user)) {
    return rows.filter((z) => String(z.wyceniajacy_id || '') === String(user.id || ''));
  }
  if (user.oddzial_id != null) return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  return [];
}

function canUserViewZlecenie(state, user, taskId) {
  const z = state.zlecenia.find((x) => x.id === taskId);
  if (!z) return false;
  if (canSeeAllTaskRows(user)) return true;
  return visibleZlecenia(state, user).some((x) => x.id === taskId);
}

function canUserUpdateFieldTask(user, task) {
  if (canManageTaskRows(user)) return true;
  if (user?.ekipa_id && task?.ekipa_id && Number(user.ekipa_id) === Number(task.ekipa_id)) return true;
  if (user?.id && task?.wyceniajacy_id && Number(user.id) === Number(task.wyceniajacy_id)) return true;
  const role = String(user?.rola || '').toLowerCase();
  return role.includes('brygadz') || role.includes('pomoc') || role.includes('wycen');
}

function ensureTaskPhotoStore(state) {
  if (!state.taskZdjecia || typeof state.taskZdjecia !== 'object') state.taskZdjecia = {};
  if (!state.nextTaskZdjecieId) state.nextTaskZdjecieId = 1;
}

function taskPhotos(state, taskId) {
  ensureTaskPhotoStore(state);
  const key = String(taskId);
  if (!Array.isArray(state.taskZdjecia[key])) state.taskZdjecia[key] = [];
  return state.taskZdjecia[key];
}

function ensureTaskProblemStore(state) {
  if (!state.taskProblemy || typeof state.taskProblemy !== 'object') state.taskProblemy = {};
  if (!state.nextTaskProblemId) state.nextTaskProblemId = 1;
}

function taskProblems(state, taskId) {
  ensureTaskProblemStore(state);
  const key = String(taskId);
  if (!Array.isArray(state.taskProblemy[key])) state.taskProblemy[key] = [];
  return state.taskProblemy[key];
}

function ensureTaskLogStore(state) {
  if (!state.taskLogi || typeof state.taskLogi !== 'object') state.taskLogi = {};
  if (!state.nextTaskLogId) state.nextTaskLogId = 1;
}

function taskLogs(state, taskId) {
  ensureTaskLogStore(state);
  const key = String(taskId);
  if (!Array.isArray(state.taskLogi[key])) state.taskLogi[key] = [];
  return state.taskLogi[key];
}

function normalizeLogStatus(status) {
  return String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();
}

function isCheckinLog(log) {
  const key = normalizeLogStatus(log?.status || log?.tresc);
  return key.includes('check_in') || key.includes('checkin') || key.includes('przyjazd') || key.includes('dojechal');
}

function isStartLog(log) {
  const key = normalizeLogStatus(log?.status || log?.tresc);
  return key === 'start' || key.includes('start_work') || key.includes('rozpoczecie') || key.includes('rozpoczeto');
}

function isFinishLog(log) {
  const key = normalizeLogStatus(log?.status || log?.tresc);
  return key === 'finish' || key.includes('finish_work') || key.includes('zakonczenie') || key.includes('zakonczono');
}

function buildTaskLogRow(state, log) {
  const author = userName(state, log.user_id);
  return {
    ...log,
    user_name: author,
    autor: author,
  };
}

function addTaskLog(state, taskId, user, patch) {
  ensureTaskLogStore(state);
  const log = {
    id: state.nextTaskLogId++,
    task_id: Number(taskId),
    user_id: user?.id ?? null,
    status: patch.status || null,
    tresc: String(patch.tresc || '').trim().slice(0, 3000),
    lat: toNum(patch.lat),
    lng: toNum(patch.lng),
    created_at: patch.created_at || new Date().toISOString(),
  };
  taskLogs(state, taskId).push(log);
  return log;
}

function normalizeTaskProblemType(value) {
  const allowed = new Set(['zakres', 'dojazd', 'sprzet', 'bhp', 'klient', 'inne']);
  const raw = String(value || '').trim().toLowerCase();
  return allowed.has(raw) ? raw : 'inne';
}

function buildTaskProblemRow(state, problem) {
  return {
    ...problem,
    zglaszajacy: userName(state, problem.user_id),
    created_at: problem.created_at || problem.data_zgloszenia,
    data_zgloszenia: problem.data_zgloszenia || problem.created_at,
  };
}

function normalizePhotoTags(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function photoCountByType(photos, aliases) {
  const set = new Set(aliases.map((x) => String(x).toLowerCase()));
  return photos.filter((p) => set.has(String(p.typ || '').toLowerCase())).length;
}

function buildTaskPhotoSummary(state, task) {
  const photos = taskPhotos(state, task.id);
  const photoWycena = photoCountByType(photos, ['wycena', 'przed', 'checkin']);
  const photoSzkic = photoCountByType(photos, ['szkic', 'sketch']);
  const photoDojazd = photoCountByType(photos, ['dojazd', 'posesja', 'dojazd_posesja']);
  return {
    photo_total: photos.length,
    photo_wycena: photoWycena,
    photo_szkic: photoSzkic,
    photo_dojazd: photoDojazd,
  };
}

function buildTaskProblemSummary(state, task) {
  const problems = taskProblems(state, task.id);
  const open = problems.filter((row) => {
    const status = String(row.status || '').trim().toLowerCase();
    return !status.startsWith('rozwi') && !status.startsWith('zamkn') && !status.startsWith('resolved') && !status.startsWith('done');
  }).length;
  return {
    problem_total: problems.length,
    problem_open: open,
    issues_count: problems.length,
    issues_open: open,
  };
}

function buildTaskWorkSummary(state, task) {
  const logs = taskLogs(state, task.id)
    .slice()
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  const lastCheckin = logs.filter(isCheckinLog).at(-1);
  const lastStart = logs.filter(isStartLog).at(-1);
  const lastFinish = logs.filter(isFinishLog).at(-1);
  const lastStartAt = lastStart?.created_at ? new Date(lastStart.created_at).getTime() : 0;
  const lastFinishAt = lastFinish?.created_at ? new Date(lastFinish.created_at).getTime() : 0;
  const active = Boolean(lastStartAt && (!lastFinishAt || lastStartAt > lastFinishAt));
  return {
    work_logs_total: logs.length,
    active_work_count: active ? 1 : 0,
    last_checkin_at: task.last_checkin_at || lastCheckin?.created_at || null,
    active_work_started_at: active ? (task.active_work_started_at || lastStart?.created_at || null) : null,
    last_work_finished_at: task.last_work_finished_at || lastFinish?.created_at || task.data_zakonczenia || null,
    last_work_log_at: logs.at(-1)?.created_at || null,
  };
}

function buildTaskRow(state, task) {
  return {
    ...enrichWycena(state, task),
    ...buildTaskPhotoSummary(state, task),
    ...buildTaskProblemSummary(state, task),
    ...buildTaskWorkSummary(state, task),
  };
}

function buildFieldDraftRow(state, task) {
  const row = buildTaskRow(state, task);
  const missingItems = [
    row.photo_wycena === 0 ? 'zdjecie ogolne / wycena' : null,
    row.photo_szkic === 0 ? 'szkic zakresu' : null,
    row.photo_dojazd === 0 ? 'dojazd / posesja' : null,
    task.wartosc_planowana == null || task.wartosc_planowana === '' ? 'cena / budzet' : null,
    task.czas_planowany_godziny == null || task.czas_planowany_godziny === '' ? 'czas pracy' : null,
    task.ekipa_id == null || task.ekipa_id === '' ? 'ekipa' : null,
  ].filter(Boolean);
  return {
    ...row,
    missing_items: missingItems,
  };
}

function toYmd(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function localPeriodRanges(asOfValue) {
  const anchor = asOfValue ? new Date(asOfValue) : new Date();
  const today = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const halfStart = new Date(start.getFullYear(), start.getMonth() < 6 ? 0 : 6, 1);
  const yearStart = new Date(start.getFullYear(), 0, 1);
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const addMonths = (d, n) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
  };
  return [
    { key: 'week', label: 'Najlepsza ekipa tygodnia', from: weekStart, to: addDays(weekStart, 7) },
    { key: 'month', label: 'Najlepsza ekipa miesiaca', from: monthStart, to: addMonths(monthStart, 1) },
    { key: 'half_year', label: 'Najlepsza ekipa polrocza', from: halfStart, to: addMonths(halfStart, 6) },
    { key: 'year', label: 'Najlepsza ekipa roku', from: yearStart, to: new Date(start.getFullYear() + 1, 0, 1) },
  ];
}

function taskActivityDate(task) {
  return new Date(task.data_zakonczenia || task.data_wykonania || task.data_planowana || task.created_at || 0);
}

function completedStatus(status) {
  return ['zakonczone', 'zakończone', 'zakonczony', 'zakończony'].includes(String(status || '').toLowerCase());
}

function scoreLocalTeam(row) {
  const total = Number(row.total_tasks) || 0;
  const done = Number(row.completed_tasks) || 0;
  const revenue = Number(row.revenue) || 0;
  const hours = Number(row.logged_hours || row.planned_hours) || 0;
  const photos = Number(row.photos_count) || 0;
  const issues = Number(row.issues_count) || 0;
  const completionRate = total > 0 ? done / total : 0;
  const photosPerTask = done > 0 ? photos / done : 0;
  return Math.max(0, Math.round(done * 35 + completionRate * 30 + Math.min(revenue / 500, 100) + Math.min(hours * 2, 80) + Math.min(photosPerTask * 8, 30) - issues * 10));
}

function buildLocalTeamRanking(state, user, query = {}) {
  const requestedBranch = toNum(query.oddzial_id);
  const branchId = canSeeAllZlecenia(user) ? requestedBranch : toNum(user?.oddzial_id);
  const periods = {};
  for (const period of localPeriodRanges(query.as_of)) {
    const fromMs = period.from.getTime();
    const toMs = period.to.getTime();
    const teams = new Map();
    for (const task of state.zlecenia || []) {
      if (task.typ === 'wycena' || !task.ekipa_id) continue;
      if (branchId && Number(task.oddzial_id) !== Number(branchId)) continue;
      const when = taskActivityDate(task);
      if (Number.isNaN(when.getTime()) || when.getTime() < fromMs || when.getTime() >= toMs) continue;
      const teamId = Number(task.ekipa_id);
      const prev = teams.get(teamId) || {
        team_id: teamId,
        ekipa_id: teamId,
        total_tasks: 0,
        completed_tasks: 0,
        revenue: 0,
        planned_hours: 0,
        logged_hours: 0,
        photos_count: 0,
        issues_count: 0,
      };
      prev.total_tasks += 1;
      prev.planned_hours += Number(task.czas_planowany_godziny || 0);
      if (completedStatus(task.status)) {
        prev.completed_tasks += 1;
        prev.revenue += Number(task.wartosc_rzeczywista || task.wartosc_planowana || 0);
      }
      prev.photos_count += taskPhotos(state, task.id).length;
      prev.issues_count += Array.isArray(state.taskProblemy?.[String(task.id)]) ? state.taskProblemy[String(task.id)].length : 0;
      teams.set(teamId, prev);
    }
    const items = Array.from(teams.values())
      .map((row) => {
        const team = (state.teams || []).find((x) => Number(x.id) === Number(row.team_id));
        const branch = (state.oddzialy || []).find((x) => Number(x.id) === Number(team?.oddzial_id || row.oddzial_id));
        const leader = (state.users || []).find((x) => Number(x.id) === Number(team?.brygadzista_id));
        const score = scoreLocalTeam(row);
        return {
          ...row,
          oddzial_id: team?.oddzial_id ?? null,
          ekipa_nazwa: team?.nazwa || `Ekipa #${row.team_id}`,
          oddzial_nazwa: branch?.nazwa || '',
          brygadzista_nazwa: leader ? `${leader.imie || ''} ${leader.nazwisko || ''}`.trim() : '',
          score,
          completion_rate: row.total_tasks ? Math.round((row.completed_tasks / row.total_tasks) * 100) : 0,
        };
      })
      .sort((a, b) => b.score - a.score || b.completed_tasks - a.completed_tasks || b.revenue - a.revenue)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    periods[period.key] = {
      key: period.key,
      label: period.label,
      from: toYmd(period.from),
      to: toYmd(new Date(period.to.getTime() - 86400000)),
      winner: items[0] || null,
      items,
    };
  }
  return {
    generated_at: new Date().toISOString(),
    as_of: toYmd(query.as_of || new Date()),
    oddzial_id: branchId || null,
    periods,
  };
}

const CLIENT_CONTACT_STATUSES = new Set(['todo', 'informed', 'waiting', 'risk']);

function ensureTaskClientContactStore(state) {
  if (!state.taskClientContacts) state.taskClientContacts = {};
  if (!state.taskClientContactEvents) state.taskClientContactEvents = [];
  if (!state.nextTaskClientContactEventId) state.nextTaskClientContactEventId = 1;
}

function ensureTaskClosureDecisionStore(state) {
  if (!state.taskClosureEvents) state.taskClosureEvents = [];
  if (!state.nextTaskClosureEventId) state.nextTaskClosureEventId = 1;
}

function ensureOperatorTaskStore(state) {
  if (!state.operatorTasks) state.operatorTasks = [];
  if (!state.nextOperatorTaskId) state.nextOperatorTaskId = 1;
}

function ensurePositionCardStore(state) {
  if (!state.positionCards) state.positionCards = {};
  if (!state.positionCardAcknowledgements) state.positionCardAcknowledgements = {};
}

function ensureEmployeeDocumentStore(state) {
  if (!state.employeeDocuments) state.employeeDocuments = [];
  if (!state.nextEmployeeDocumentId) state.nextEmployeeDocumentId = 1;
}

function normalizeContactStatus(status) {
  const value = String(status || '').trim();
  return CLIENT_CONTACT_STATUSES.has(value) ? value : 'todo';
}

function buildClientContactRow(state, taskId) {
  const key = String(taskId);
  const row = state.taskClientContacts?.[key] || {};
  const history = (state.taskClientContactEvents || [])
    .filter((event) => Number(event.task_id) === Number(taskId))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 20);
  return {
    task_id: Number(taskId),
    status: row.status || '',
    note: row.note || '',
    due_at: row.due_at || row.dueAt || null,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    actor: row.actor || null,
    history,
  };
}

function taskContactActor(state, userId) {
  const name = userName(state, userId);
  return name || 'Operator';
}

function normalizeDecisionItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((item) => ({
    key: String(item?.key || '').slice(0, 80),
    label: String(item?.label || '').slice(0, 140),
    detail: String(item?.detail || '').slice(0, 500),
    required: Boolean(item?.required),
  }));
}

function buildClosureEventRow(state, event) {
  return {
    id: event.id,
    task_id: Number(event.task_id),
    action: event.action || '',
    severity: event.severity || '',
    status_before: event.status_before || null,
    status_after: event.status_after || null,
    blockers: normalizeDecisionItems(event.blockers),
    warnings: normalizeDecisionItems(event.warnings),
    risk_score: Number(event.risk_score) || 0,
    quality_score: Number(event.quality_score) || 0,
    value: Number(event.value) || 0,
    note: event.note || '',
    created_at: event.created_at || null,
    created_by: event.created_by || null,
    actor: event.actor || taskContactActor(state, event.created_by),
  };
}

const TASK_PUT_NUM = new Set([
  'ekipa_id',
  'oddzial_id',
  'kierownik_id',
  'czas_planowany_godziny',
  'wartosc_planowana',
  'dodatkowe_uslugi_liczba',
  'bony_liczba',
]);

function parseAdnotacje(body) {
  const raw = body.zdjecia_adnotowane_json;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, 3);
  } catch {
    return null;
  }
}

// ── Auth (demo) ─────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { login, haslo } = req.body || {};
  if (!login || !haslo) return res.status(400).json({ error: 'Login i hasło są wymagane' });
  const state = readOnly((s) => s);
  const u = state.users.find((x) => x.login === login);
  if (!u || u.haslo !== haslo) {
    return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
  }
  const token = signUser(u);
  res.json({ token, user: publicUser(u) });
});

// Local compatibility for `/api/quotations/*`.
// The production OS has a dedicated quotations module; this file-db server keeps
// field quotes in `zlecenia`, so we expose the same panel contract here.
function localQuotationStatus(z) {
  if (z.status_akceptacji === 'zatwierdzono') return 'Zatwierdzona';
  if (z.status_akceptacji === 'odrzucono') return 'Odrzucona';
  if (z.status_akceptacji === 'do_specjalisty') return 'Umowiana';
  if (z.status_akceptacji === 'rezerwacja_wstepna') return 'W_zatwierdzeniu';
  return 'OczekujePrzypisania';
}

function localQuotationFromWycena(state, z, extra = {}) {
  const row = enrichWycena(state, z);
  return {
    ...row,
    status: localQuotationStatus(z),
    quotation_status: localQuotationStatus(z),
    priorytet: z.priorytet || 'Normalny',
    lat: z.lat ?? z.pin_lat ?? null,
    lon: z.lon ?? z.pin_lng ?? null,
    lng: z.lng ?? z.pin_lng ?? null,
    client_acceptance_token: z.client_acceptance_token || `demo-${z.id}`,
    pdf_url: z.pdf_url || null,
    offer_sms_status: z.offer_sms_status || null,
    offer_email_status: z.offer_email_status || null,
    ...extra,
  };
}

function isEstimatorRole(role) {
  return String(role || '').toLowerCase().includes('wycen');
}

router.get('/quotations/panel/do-przypisania', requireAuth, (req, res) => {
  try {
    const rows = readOnly((state) =>
      (state.zlecenia || [])
        .filter((z) => z.typ === 'wycena')
        .filter((z) => !z.wyceniajacy_id || z.status_akceptacji === 'oczekuje')
        .filter((z) => canAccessOddzial(req.user, z.oddzial_id))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .map((z) => localQuotationFromWycena(state, z))
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quotations/panel/moje-zatwierdzenia', requireAuth, (req, res) => {
  try {
    const rows = readOnly((state) =>
      (state.zlecenia || [])
        .filter((z) => z.typ === 'wycena')
        .filter((z) => z.status_akceptacji === 'do_specjalisty' || z.status_akceptacji === 'rezerwacja_wstepna')
        .filter((z) => canSeeAllBranches(req.user) || Number(z.wyceniajacy_id) === Number(req.user.id) || canAccessOddzial(req.user, z.oddzial_id))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .map((z) =>
          localQuotationFromWycena(state, z, {
            approval_id: `local-${z.id}`,
            wymagany_typ: req.user?.rola || 'Kierownik',
          })
        )
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quotations/panel/sla-przeterminowane', requireAuth, (_req, res) => {
  res.json([]);
});

router.get('/quotations/:id', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const row = readOnly((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      if (!canAccessOddzial(req.user, z.oddzial_id)) return { _forbidden: true };
      return localQuotationFromWycena(state, z);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/assign', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const wyceniajacyId = toNum(req.body?.wyceniajacy_id);
    if (!wyceniajacyId) return res.status(400).json({ error: 'Podaj wyceniajacy_id' });
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      if (!canAccessOddzial(req.user, z.oddzial_id)) return { _forbidden: true };
      const assigned = (state.users || []).find((u) => Number(u.id) === Number(wyceniajacyId));
      if (!assigned || !isEstimatorRole(assigned.rola)) return { _badEstimator: true };
      if (!canAccessOddzial(req.user, assigned.oddzial_id) || String(assigned.oddzial_id) !== String(z.oddzial_id)) {
        return { _branchMismatch: true };
      }
      z.wyceniajacy_id = wyceniajacyId;
      z.status_akceptacji = 'do_specjalisty';
      z.updated_at = new Date().toISOString();
      return localQuotationFromWycena(state, z);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (row?._badEstimator) return res.status(400).json({ error: 'Wybrany uzytkownik nie jest wyceniajacym' });
    if (row?._branchMismatch) return res.status(403).json({ error: 'Wyceniajacy musi byc z tego samego oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/approvals/:approvalId/decision', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const decyzja = String(req.body?.decyzja || '');
    const komentarz = String(req.body?.komentarz || '').trim();
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      if (!canAccessOddzial(req.user, z.oddzial_id)) return { _forbidden: true };
      if (decyzja === 'Rejected' && !komentarz) return { _commentRequired: true };
      if (decyzja === 'Approved') z.status_akceptacji = 'zatwierdzono';
      else if (decyzja === 'Returned') z.status_akceptacji = 'rezerwacja_wstepna';
      else if (decyzja === 'Rejected') z.status_akceptacji = 'odrzucono';
      else return { _badDecision: true };
      z.zatwierdzone_przez = req.user.id;
      z.zatwierdzone_at = new Date().toISOString();
      if (komentarz) {
        z.wycena_uwagi = `${z.wycena_uwagi ? `${z.wycena_uwagi}\n` : ''}[${decyzja}] ${komentarz}`;
      }
      return localQuotationFromWycena(state, z);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (row?._commentRequired) return res.status(400).json({ error: 'Odrzucenie wymaga komentarza' });
    if (row?._badDecision) return res.status(400).json({ error: 'Nieznana decyzja' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/resend-client-offer', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      if (!canAccessOddzial(req.user, z.oddzial_id)) return { _forbidden: true };
      z.wyslano_klientowi_at = new Date().toISOString();
      z.offer_sms_status = z.klient_telefon ? 'sent' : 'skipped_no_phone';
      z.offer_email_status = z.klient_email ? 'sent' : 'skipped_no_email';
      z.client_acceptance_token = z.client_acceptance_token || `demo-${z.id}`;
      return localQuotationFromWycena(state, z, { status: 'Wyslana_Klientowi' });
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Wyceny ──────────────────────────────────────────────────
router.get('/wyceny', requireAuth, (req, res) => {
  try {
    const { status_akceptacji, oddzial_id } = req.query;
    const rows = readOnly((st) => {
      let list = st.zlecenia.filter((z) => z.typ === 'wycena');
      if (!canSeeAllZlecenia(req.user) && req.user.oddzial_id != null) {
        list = list.filter((z) => String(z.oddzial_id) === String(req.user.oddzial_id));
      }
      if (status_akceptacji) list = list.filter((z) => z.status_akceptacji === status_akceptacji);
      const scopedOddzialId = canSeeAllBranches(req.user) ? toNum(oddzial_id) : req.user.oddzial_id;
      if (scopedOddzialId) list = list.filter((z) => String(z.oddzial_id) === String(scopedOddzialId));
      return list
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 300)
        .map((z) => enrichWycena(st, z));
    });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quotations', requireAuth, (req, res) => {
  try {
    const rows = readOnly((state) => {
      let list = (state.zlecenia || []).filter((z) => z.typ === 'wycena');
      if (!canSeeAllZlecenia(req.user) && req.user.oddzial_id != null) {
        list = list.filter((z) => String(z.oddzial_id) === String(req.user.oddzial_id));
      }
      return list
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 300)
        .map((z) => enrichQuotation(state, z));
    });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quotations/norms/service-times', requireAuth, (_req, res) => {
  res.json([
    { gatunek_key: 'lipa', wysokosc_pas: 'do_10m', typ_pracy_key: 'przycinka' },
    { gatunek_key: 'dab', wysokosc_pas: '10_20m', typ_pracy_key: 'ciecie_techniczne' },
    { gatunek_key: 'sosna', wysokosc_pas: '20m_plus', typ_pracy_key: 'usuwanie' },
  ]);
});

router.get('/quotations/panel/do-przypisania', requireAuth, (req, res) => {
  try {
    const rows = readOnly((state) => {
      let list = (state.zlecenia || []).filter((z) => z.typ === 'wycena');
      if (!canSeeAllZlecenia(req.user) && req.user.oddzial_id != null) {
        list = list.filter((z) => String(z.oddzial_id) === String(req.user.oddzial_id));
      }
      return list
        .filter((z) => !z.wyceniajacy_id && z.status_akceptacji !== 'zatwierdzono')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 200)
        .map((z) => enrichQuotation(state, z));
    });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quotations/panel/moje-zatwierdzenia', requireAuth, (req, res) => {
  try {
    const rows = readOnly((state) => {
      let list = (state.zlecenia || []).filter((z) => z.typ === 'wycena');
      if (!canSeeAllZlecenia(req.user) && req.user.oddzial_id != null) {
        list = list.filter((z) => String(z.oddzial_id) === String(req.user.oddzial_id));
      }
      return list
        .filter((z) => z.status_akceptacji === 'oczekuje' && z.wyceniajacy_id)
        .sort((a, b) => new Date(a.data_wykonania || a.created_at || 0) - new Date(b.data_wykonania || b.created_at || 0))
        .slice(0, 200)
        .map((z) => enrichQuotation(state, z));
    });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quotations/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
    return z ? enrichQuotation(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
  res.json(row);
});

router.get('/quotations/:id/items', requireAuth, (_req, res) => {
  res.json([]);
});

router.post('/quotations/:id/items', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const exists = readOnly((state) => (state.zlecenia || []).some((x) => Number(x.id) === Number(id) && x.typ === 'wycena'));
  if (!exists) return res.status(404).json({ error: 'Wycena nie znaleziona' });
  res.status(201).json({
    id: Date.now(),
    quotation_id: id,
    gatunek: req.body?.gatunek || null,
    wysokosc_pas: req.body?.wysokosc_pas || null,
    typ_pracy: req.body?.typ_pracy || null,
  });
});

router.patch('/quotations/:id', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      Object.assign(z, req.body || {}, { updated_at: new Date().toISOString() });
      return enrichQuotation(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/visit/start', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      z.visit_started_at = new Date().toISOString();
      z.visit_start_lat = req.body?.lat ?? null;
      z.visit_start_lng = req.body?.lng ?? null;
      z.status = 'W_Terenie';
      return enrichQuotation(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/visit/end', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      z.visit_ended_at = new Date().toISOString();
      z.visit_end_lat = req.body?.lat ?? null;
      z.visit_end_lng = req.body?.lng ?? null;
      z.waznosc_do = req.body?.waznosc_do || z.waznosc_do || null;
      z.status = 'W_Zatwierdzeniu';
      return enrichQuotation(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/assign', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const wyceniajacyId = toNum(req.body?.wyceniajacy_id);
    if (!wyceniajacyId) return res.status(400).json({ error: 'Wybierz wyceniajacego' });
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      z.wyceniajacy_id = wyceniajacyId;
      z.status = 'Umowiana';
      z.updated_at = new Date().toISOString();
      return enrichQuotation(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/approvals/:aid/decision', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const decision = String(req.body?.decyzja || '').trim();
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      z.status_akceptacji =
        decision === 'Approved' ? 'zatwierdzono' : decision === 'Rejected' ? 'odrzucono' : 'oczekuje';
      z.status = decision === 'Approved' ? 'Zatwierdzona' : decision === 'Rejected' ? 'Odrzucona' : 'Zwrocona';
      z.zatwierdzone_przez = req.user.id;
      z.zatwierdzone_at = new Date().toISOString();
      if (req.body?.komentarz) {
        z.wycena_uwagi = [z.wycena_uwagi, `[${decision}] ${req.body.komentarz}`].filter(Boolean).join('\n');
      }
      return enrichQuotation(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quotations/:id/resend-client-offer', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const row = withStore((state) => {
      const z = (state.zlecenia || []).find((x) => Number(x.id) === Number(id) && x.typ === 'wycena');
      if (!z) return null;
      z.status = 'Wyslana_Klientowi';
      z.wyslano_klientowi_at = new Date().toISOString();
      z.offer_sms_status = z.klient_telefon ? 'sent_demo' : 'brak_numeru';
      z.offer_email_status = 'sent_demo';
      z.client_acceptance_token = z.client_acceptance_token || `demo-${id}-${Date.now()}`;
      return enrichQuotation(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wyceny', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const zdjecia = parseAdnotacje(b);
    const result = withStore((state) => {
      const branchId = toNum(b.oddzial_id) ?? req.user.oddzial_id ?? null;
      const teamId = toNum(b.ekipa_id);
      const day = resourceDate(b.data_wykonania || b.data_planowana);
      const error = teamBranchError(state, teamId, branchId, day);
      if (error) return { error, status: 409 };
      const id = state.nextZlecenieId++;
      const now = new Date().toISOString();
      const oddzialId = canSeeAllBranches(req.user) ? toNum(b.oddzial_id) : req.user.oddzial_id;
      const z = {
        id,
        typ: 'wycena',
        status: 'Nowe',
        status_akceptacji: 'oczekuje',
        klient_nazwa: b.klient_nazwa || null,
        adres: b.adres,
        miasto: b.miasto || null,
        oddzial_id: branchId,
        ekipa_id: teamId,
        typ_uslugi: b.typ_uslugi || null,
        data_wykonania: b.data_wykonania || null,
        godzina_rozpoczecia: b.godzina_rozpoczecia || null,
        czas_planowany_godziny: toNum(b.czas_planowany_godziny),
        wartosc_planowana: toNum(b.wartosc_planowana),
        notatki_wewnetrzne: b.notatki_wewnetrzne || null,
        wycena_uwagi: b.wycena_uwagi || null,
        zdjecia_adnotowane: zdjecia,
        created_by: req.user.id,
        wyceniajacy_id: null,
        zatwierdzone_przez: null,
        zatwierdzone_at: null,
        created_at: now,
      };
      state.zlecenia.push(z);
      return { row: enrichWycena(state, z) };
    });
    if (result?.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result.row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wyceny/:id/zatwierdz', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((state) => {
      const z = state.zlecenia.find((x) => x.id === id && x.typ === 'wycena' && x.status_akceptacji === 'oczekuje');
      if (!z) return null;
      const nextTeamId = toNum(b.ekipa_id) || z.ekipa_id;
      const branchId = z.oddzial_id || req.user.oddzial_id || null;
      const day = resourceDate(b.data_wykonania || z.data_wykonania || z.data_planowana);
      const error = teamBranchError(state, nextTeamId, branchId, day);
      if (error) return { error, status: 409 };
      z.status_akceptacji = 'zatwierdzono';
      z.zatwierdzone_przez = req.user.id;
      z.zatwierdzone_at = new Date().toISOString();
      z.status = 'Zaplanowane';
      z.typ = 'zlecenie';
      z.wyceniajacy_id = z.wyceniajacy_id ?? z.created_by;
      if (nextTeamId) z.ekipa_id = nextTeamId;
      if (b.data_wykonania) z.data_wykonania = b.data_wykonania;
      if (b.godzina_rozpoczecia) z.godzina_rozpoczecia = b.godzina_rozpoczecia;
      if (toNum(b.wartosc_planowana) != null) z.wartosc_planowana = toNum(b.wartosc_planowana);
      if (b.uwagi) z.wycena_uwagi = b.uwagi;
      return { row: enrichWycena(state, z) };
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona lub już rozpatrzona' });
    if (row?.error) return res.status(row.status || 400).json({ error: row.error });
    res.json(row.row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wyceny/:id/odrzuc', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const powod = (req.body && req.body.powod) || '';
    const row = withStore((state) => {
      const z = state.zlecenia.find((x) => x.id === id && x.typ === 'wycena');
      if (!z) return null;
      if (!canAccessOddzial(req.user, z.oddzial_id)) return { _forbidden: true };
      z.status_akceptacji = 'odrzucono';
      z.zatwierdzone_przez = req.user.id;
      z.zatwierdzone_at = new Date().toISOString();
      const add = `[Odrzucono] ${powod}`;
      z.wycena_uwagi = (z.wycena_uwagi ? `${z.wycena_uwagi}\n` : '') + add;
      return enrichWycena(state, z);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const disk = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.params.id));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});
const up = multer({ storage: disk, limits: { fileSize: 250 * 1024 * 1024 } });

const diskTaskPhotos = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UP_TASK_PHOTOS, safeUploadName(req.params.id));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const base = safeUploadName(path.basename(file.originalname || 'photo', ext));
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upTaskPhoto = multer({ storage: diskTaskPhotos, limits: { fileSize: 25 * 1024 * 1024 } });

const diskOgledzinyMedia = multer.diskStorage({
  destination: (_, __, cb) => {
    ensureDir(UP_OGLEDZINY_MEDIA);
    cb(null, UP_OGLEDZINY_MEDIA);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.mp4';
    cb(null, `ogl_${req.params.id}_${Date.now()}${ext}`);
  },
});
const upOgledzinyMedia = multer({
  storage: diskOgledzinyMedia,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '');
    if (mime.startsWith('image/') || mime.startsWith('video/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Dozwolone sa tylko pliki image/video'));
  },
});

function safeUploadName(value) {
  return String(value || 'plik')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 140) || 'plik';
}

const diskEmployeeDocuments = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = safeUploadName(req.params.userId);
    const dir = path.join(UP_EMPLOYEE_DOCUMENTS, userId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = safeUploadName(path.basename(file.originalname || 'dokument', ext));
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upEmployeeDocument = multer({ storage: diskEmployeeDocuments, limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/wyceny/:id/wideo', requireAuth, up.single('wideo'), (req, res) => {
  try {
    const zlecenieId = toNum(req.params.id);
    if (!zlecenieId || !req.file) {
      return res.status(400).json({ error: 'Brak pliku (pole: wideo) lub id' });
    }
    const rel = path.relative(path.join(__dirname, '..'), req.file.path).split(path.sep).join('/');
    withStore((state) => {
      const zid = state.zalaczniki.length ? Math.max(...state.zalaczniki.map((z) => z.id)) + 1 : 1;
      state.zalaczniki.push({
        id: zid,
        zlecenie_id: zlecenieId,
        typ: 'video',
        nazwa_pliku: req.file.originalname,
        sciezka_relatywna: rel,
        rozmiar_bajtow: req.file.size,
        created_at: new Date().toISOString(),
      });
    });
    res.status(201).json({ ok: true, sciezka_relatywna: rel, rozmiar: req.file.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/wyceny/:id/zalaczniki', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const list = readOnly((state) =>
      state.zalaczniki.filter((z) => z.zlecenie_id === id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    );
    res.json({ zalaczniki: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Wynagrodzenie wyceniających ─────────────────────────────
function toInt(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function canEditUserRules(req, targetUserId) {
  const r = req.user?.rola;
  if (['Prezes', 'Dyrektor', 'Kierownik'].includes(r)) return true;
  if (r === 'Wyceniający' && req.user.id === targetUserId) return true;
  return false;
}

router.get('/wynagrodzenie-wyceniajacy/reguly/:userId', requireAuth, (req, res) => {
  const uid = toInt(req.params.userId);
  if (!uid) return res.status(400).json({ error: 'Nieprawidłowe userId' });
  if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });
  const u = readOnly((state) => state.users.find((x) => x.id === uid));
  if (!u) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json({
    id: u.id,
    wynagrodzenie_stawka_dzienna_pln: u.wynagrodzenie_stawka_dzienna_pln ?? 0,
    wynagrodzenie_procent_realizacji: u.wynagrodzenie_procent_realizacji ?? 0,
    wynagrodzenie_dodatki_pln: u.wynagrodzenie_dodatki_pln ?? 0,
    wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis ?? '',
  });
});

router.put('/wynagrodzenie-wyceniajacy/reguly/:userId', requireAuth, (req, res) => {
  const uid = toInt(req.params.userId);
  if (!uid) return res.status(400).json({ error: 'Nieprawidłowe userId' });
  if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });
  const b = req.body || {};
  const row = withStore((state) => {
    const u = state.users.find((x) => x.id === uid);
    if (!u) return null;
    if (b.wynagrodzenie_stawka_dzienna_pln != null) u.wynagrodzenie_stawka_dzienna_pln = Number(b.wynagrodzenie_stawka_dzienna_pln);
    if (b.wynagrodzenie_procent_realizacji != null) u.wynagrodzenie_procent_realizacji = Number(b.wynagrodzenie_procent_realizacji);
    if (b.wynagrodzenie_dodatki_pln != null) u.wynagrodzenie_dodatki_pln = Number(b.wynagrodzenie_dodatki_pln);
    if (b.wynagrodzenie_dodatki_opis !== undefined) u.wynagrodzenie_dodatki_opis = b.wynagrodzenie_dodatki_opis;
    return {
      id: u.id,
      wynagrodzenie_stawka_dzienna_pln: u.wynagrodzenie_stawka_dzienna_pln,
      wynagrodzenie_procent_realizacji: u.wynagrodzenie_procent_realizacji,
      wynagrodzenie_dodatki_pln: u.wynagrodzenie_dodatki_pln,
      wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis,
    };
  });
  if (!row) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json(row);
});

router.get('/wynagrodzenie-wyceniajacy/podsumowanie', requireAuth, (req, res) => {
  const uid = toInt(req.query.user_id);
  const rok = toInt(req.query.rok) || new Date().getFullYear();
  const miesiac = toInt(req.query.miesiac) || new Date().getMonth() + 1;
  const dniRobocze = toInt(req.query.dni_robocze);
  const dni = dniRobocze == null ? 22 : dniRobocze;

  if (!uid) return res.status(400).json({ error: 'Brak user_id' });
  if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });

  const data = readOnly((state) => {
    const u = state.users.find((x) => x.id === uid);
    if (!u) return null;
    const start = new Date(rok, miesiac - 1, 1);
    const end = new Date(rok, miesiac, 0);
    const isoStart = start.toISOString().slice(0, 10);
    const isoEnd = end.toISOString().slice(0, 10);

    let suma = 0;
    for (const z of state.zlecenia) {
      if (z.typ === 'wycena') continue;
      if (!isTaskDone(z.status)) continue;
      if (Number(z.wyceniajacy_id) !== uid) continue;
      const d = (z.data_wykonania || '').slice(0, 10);
      if (!d || d < isoStart || d > isoEnd) continue;
      suma += parseFloat(z.wartosc_planowana) || 0;
    }
    suma = Math.round(suma * 100) / 100;

    const stawka = parseFloat(u.wynagrodzenie_stawka_dzienna_pln) || 0;
    const proc = parseFloat(u.wynagrodzenie_procent_realizacji) || 0;
    const dod = parseFloat(u.wynagrodzenie_dodatki_pln) || 0;
    const czescDzienna = Math.round(stawka * dni * 100) / 100;
    const czescProcentowa = Math.round(suma * (proc / 100) * 100) / 100;
    const razem = Math.round((czescDzienna + czescProcentowa + dod) * 100) / 100;

    return {
      user: { id: u.id, imie: u.imie, nazwisko: u.nazwisko, rola: u.rola },
      okres: { rok, miesiac, dni_robocze: dni },
      suma_zrealizowanych_pln: suma,
      reguly: {
        wynagrodzenie_stawka_dzienna_pln: stawka,
        wynagrodzenie_procent_realizacji: proc,
        wynagrodzenie_dodatki_pln: dod,
        wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis,
      },
      wyliczenie: {
        czesc_dzienna: czescDzienna,
        czesc_procentowa: czescProcentowa,
        dodatki: dod,
        razem,
      },
    };
  });

  if (!data) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json(data);
});

// ── Minimalne stuby pod resztę panelu (ten sam plik danych) ──
function stripUser(u) {
  const { haslo, ...rest } = u;
  return rest;
}

router.get('/uzytkownicy', requireAuth, (req, res) => {
  const rolaQ = req.query.rola;
  const branchId = toNum(req.query.oddzial_id);
  const includeDelegacje = ['1', 'true', true].includes(req.query.include_delegacje);
  const day = resourceDate(req.query.date);
  const list = readOnly((state) => {
    let rows = state.users || [];
    const scopedBranch = branchId || (!canSeeAllZlecenia(req.user) ? req.user.oddzial_id : null);
    if (scopedBranch) {
      rows = rows.filter((x) =>
        Number(x.oddzial_id) === Number(scopedBranch) ||
        (includeDelegacje && userDelegationForBranch(state, x.id, scopedBranch, day))
      );
    }
    if (rolaQ) {
      rows = rows.filter((x) => x.rola === rolaQ || (isEstimatorRole(rolaQ) && isEstimatorRole(x.rola)));
    }
    if (scopedBranch && includeDelegacje) return rows.map((x) => enrichUserForBranch(state, x, scopedBranch, day));
    rows = rows.map((x) => enrichUserForBranch(state, x, null, day));
    return rows;
  });
  res.json(list);
});

function przeniesSpecjaliste(req, res) {
  const userId = toNum(req.params.id);
  const oddzialId = toNum(req.body?.oddzial_id);
  if (!userId || !oddzialId) return res.status(400).json({ error: 'Nieprawidlowe dane' });
  const row = withStore((state) => {
    const target = (state.users || []).find((u) => Number(u.id) === Number(userId));
    const oddzial = (state.oddzialy || []).find((o) => Number(o.id) === Number(oddzialId));
    if (!target || !oddzial) return null;
    if (!canTransferSpecialist(req.user, target)) return { _forbidden: true };
    target.oddzial_id = oddzialId;
    target.oddzial_nazwa = oddzial.nazwa;
    return stripUser(target);
  });
  if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  return res.json(row);
}

router.patch('/uzytkownicy/:id/oddzial', requireAuth, przeniesSpecjaliste);
router.put('/uzytkownicy/:id/oddzial', requireAuth, przeniesSpecjaliste);

router.get('/tasks/wszystkie', requireAuth, (req, res) => {
  const list = readOnly((state) => {
    const rows = canSeeAllZlecenia(req.user) ? state.zlecenia : visibleZlecenia(state, req.user);
    return rows.map((z) => buildTaskRow(state, z));
  });
  res.json(list);
});

router.get('/tasks/field-drafts', requireAuth, (req, res) => {
  const limit = toInt(req.query.limit);
  const offset = toInt(req.query.offset) || 0;
  const rows = readOnly((state) => {
    const visible = canSeeAllZlecenia(req.user) ? state.zlecenia : visibleZlecenia(state, req.user);
    return visible
      .filter((z) => z.typ !== 'wycena')
      .filter((z) => z.ankieta_uproszczona === true)
      .filter((z) => !isTaskClosed(z.status))
      .map((z) => buildFieldDraftRow(state, z))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  });
  if (limit) {
    return res.json({ items: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
  }
  res.json(rows);
});

router.post('/tasks/nowe', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!String(b.klient_nazwa || '').trim() || !String(b.adres || '').trim() || !String(b.miasto || '').trim() || !String(b.data_planowana || '').trim()) {
    return res.status(400).json({ error: 'Brak wymaganych danych zlecenia' });
  }
  const created = withStore((state) => {
    if (!state.nextZlecenieId) {
      const maxId = Math.max(0, ...(state.zlecenia || []).map((z) => Number(z.id) || 0));
      state.nextZlecenieId = maxId + 1;
    }
    const now = new Date().toISOString();
    const finalOddzialId = canSeeAllZlecenia(req.user) ? (toNum(b.oddzial_id) || req.user.oddzial_id || null) : req.user.oddzial_id;
    const initialStatus = isValidTaskStatus(b.status)
      ? normalizeTaskStatus(b.status)
      : (toNum(b.wyceniajacy_id) ? TASK_STATUS.WYCENA_TERENOWA : TASK_STATUS.NOWE);
    const id = state.nextZlecenieId++;
    const task = {
      id,
      typ: 'zlecenie',
      status: initialStatus,
      status_akceptacji: b.ankieta_uproszczona ? 'oczekuje' : null,
      klient_nazwa: String(b.klient_nazwa || '').trim(),
      klient_telefon: b.klient_telefon || null,
      klient_email: b.klient_email || null,
      adres: String(b.adres || '').trim(),
      miasto: String(b.miasto || '').trim(),
      oddzial_id: toNum(finalOddzialId),
      ekipa_id: toNum(b.ekipa_id),
      typ_uslugi: b.typ_uslugi || 'Wycinka',
      priorytet: b.priorytet || 'Normalny',
      data_planowana: b.data_planowana,
      data_wykonania: null,
      godzina_rozpoczecia: b.godzina_rozpoczecia || null,
      czas_planowany_godziny: toNum(b.czas_planowany_godziny),
      wartosc_planowana: toNum(b.wartosc_planowana),
      notatki_wewnetrzne: b.notatki_wewnetrzne || null,
      opis_pracy: b.opis_pracy || null,
      opis: b.opis || b.opis_pracy || null,
      created_by: req.user.id,
      kierownik_id: req.user.id,
      wyceniajacy_id: toNum(b.wyceniajacy_id) || (b.ankieta_uproszczona ? req.user.id : null),
      source_ogledziny_id: toNum(b.source_ogledziny_id),
      ankieta_uproszczona: b.ankieta_uproszczona === true,
      pin_lat: toNum(b.pin_lat),
      pin_lng: toNum(b.pin_lng),
      created_at: now,
      updated_at: now,
    };
    state.zlecenia.push(task);

    let wycenaId = null;
    if (task.wyceniajacy_id) {
      wycenaId = state.nextZlecenieId++;
      state.zlecenia.push({
        id: wycenaId,
        typ: 'wycena',
        status: 'Nowa',
        status_akceptacji: 'oczekuje',
        klient_nazwa: task.klient_nazwa,
        klient_telefon: task.klient_telefon,
        klient_email: task.klient_email,
        adres: task.adres,
        miasto: task.miasto,
        oddzial_id: task.oddzial_id,
        ekipa_id: task.ekipa_id,
        typ_uslugi: task.typ_uslugi,
        priorytet: task.priorytet,
        data_planowana: task.data_planowana,
        data_wykonania: task.data_planowana,
        godzina_rozpoczecia: task.godzina_rozpoczecia,
        czas_planowany_godziny: task.czas_planowany_godziny,
        wartosc_planowana: task.wartosc_planowana,
        wartosc_szacowana: task.wartosc_planowana,
        notatki_wewnetrzne: task.notatki_wewnetrzne,
        wycena_uwagi: `AUTO zlecenie #${id}`,
        created_by: req.user.id,
        autor_id: task.wyceniajacy_id,
        wyceniajacy_id: task.wyceniajacy_id,
        ankieta_uproszczona: task.ankieta_uproszczona,
        created_at: now,
        updated_at: now,
      });
    }
    if (task.source_ogledziny_id) {
      const inspection = (state.ogledziny || []).find((row) => Number(row.id) === Number(task.source_ogledziny_id));
      if (inspection) {
        const note = [
          `Draft terenowy zapisany automatycznie jako zlecenie #${id}.`,
          wycenaId ? `Powiazana wycena: #${wycenaId}.` : 'Brak powiazanej wyceny w odpowiedzi tworzenia zlecenia.',
          'Dla biura: sprawdzic opis, termin ekipy, rezerwacje czasu i szczegoly z klientem.',
        ].join('\n');
        inspection.wycena_id = wycenaId || inspection.wycena_id || null;
        inspection.status = 'Zakonczone';
        inspection.notatki_wyniki = [inspection.notatki_wyniki, note].filter(Boolean).join('\n');
        inspection.updated_at = now;
        if (!state.ogledzinyFieldEvents) state.ogledzinyFieldEvents = [];
        state.ogledzinyFieldEvents.push({
          id: state.ogledzinyFieldEvents.length ? Math.max(...state.ogledzinyFieldEvents.map((event) => Number(event.id) || 0)) + 1 : 1,
          ogledziny_id: inspection.id,
          user_id: req.user.id,
          event_type: 'done',
          note,
          recorded_at: now,
        });
      }
    }
    return { id, wycena_id: wycenaId, task: enrichWycena(state, task) };
  });
  res.json(created);
});

router.get('/tasks/client-contacts', requireAuth, (req, res) => {
  const payload = readOnly((state) => {
    const visibleIds = new Set(visibleZlecenia(state, req.user).map((z) => Number(z.id)));
    const contacts = {};
    for (const [taskId] of Object.entries(state.taskClientContacts || {})) {
      const id = Number(taskId);
      if (visibleIds.has(id)) contacts[String(id)] = buildClientContactRow(state, id);
    }
    return { contacts };
  });
  res.json(payload);
});

router.get('/tasks/closure-events', requireAuth, (req, res) => {
  const payload = readOnly((state) => {
    ensureTaskClosureDecisionStore(state);
    const visibleIds = new Set(visibleZlecenia(state, req.user).map((z) => Number(z.id)));
    const events = {};
    for (const event of state.taskClosureEvents || []) {
      const id = Number(event.task_id);
      if (!visibleIds.has(id)) continue;
      const key = String(id);
      if (!events[key]) events[key] = [];
      events[key].push(buildClosureEventRow(state, event));
    }
    Object.values(events).forEach((list) =>
      list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    );
    return { events };
  });
  res.json(payload);
});

router.get('/tasks', requireAuth, (req, res) => {
  const list = readOnly((state) => visibleZlecenia(state, req.user).map((z) => buildTaskRow(state, z)));
  res.json(list);
});

router.get('/tasks/:id(\\d+)/client-contact', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    return buildClientContactRow(state, id);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostępu' });
  res.json(row);
});

router.get('/tasks/:id(\\d+)/closure-events', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    ensureTaskClosureDecisionStore(state);
    return (state.taskClosureEvents || [])
      .filter((event) => Number(event.task_id) === Number(id))
      .map((event) => buildClosureEventRow(state, event))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json({ events: row });
});

router.post('/tasks/:id(\\d+)/closure-events', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    ensureTaskClosureDecisionStore(state);
    const now = new Date().toISOString();
    const task = (state.zlecenia || []).find((z) => Number(z.id) === Number(id)) || {};
    const event = {
      id: state.nextTaskClosureEventId++,
      task_id: id,
      action: String(req.body?.action || 'note').slice(0, 80),
      severity: String(req.body?.severity || '').slice(0, 40),
      status_before: String(req.body?.status_before || task.status || '').slice(0, 40),
      status_after: req.body?.status_after ? String(req.body.status_after).slice(0, 40) : null,
      blockers: normalizeDecisionItems(req.body?.blockers),
      warnings: normalizeDecisionItems(req.body?.warnings),
      risk_score: toNum(req.body?.risk_score) || 0,
      quality_score: toNum(req.body?.quality_score) || 0,
      value: toNum(req.body?.value) || 0,
      note: String(req.body?.note || '').slice(0, 1000),
      created_at: now,
      created_by: req.user.id,
      actor: taskContactActor(state, req.user.id),
    };
    state.taskClosureEvents.push(event);
    return buildClosureEventRow(state, event);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.status(201).json(row);
});

router.patch('/tasks/:id(\\d+)/client-contact', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    ensureTaskClientContactStore(state);
    const key = String(id);
    const prev = state.taskClientContacts[key] || {};
    const now = new Date().toISOString();
    const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
    const hasNote = Object.prototype.hasOwnProperty.call(req.body || {}, 'note');
    const hasDueAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'due_at')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'dueAt');
    const status = hasStatus ? normalizeContactStatus(req.body.status) : (prev.status || '');
    const note = hasNote ? String(req.body.note || '').slice(0, 2000) : (prev.note || '');
    const dueAtRaw = Object.prototype.hasOwnProperty.call(req.body || {}, 'due_at')
      ? req.body.due_at
      : req.body?.dueAt;
    const dueAt = hasDueAt ? (dueAtRaw ? String(dueAtRaw).slice(0, 80) : null) : (prev.due_at || prev.dueAt || null);
    const actor = taskContactActor(state, req.user.id);
    const next = {
      task_id: id,
      status,
      note,
      due_at: dueAt,
      updated_at: now,
      updated_by: req.user.id,
      actor,
    };
    state.taskClientContacts[key] = next;
    state.taskClientContactEvents.push({
      id: state.nextTaskClientContactEventId++,
      task_id: id,
      status,
      note,
      due_at: dueAt,
      created_at: now,
      created_by: req.user.id,
      actor,
    });
    return buildClientContactRow(state, id);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostępu' });
  res.json(row);
});

router.get('/tasks/:id(\\d+)/zdjecia', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const rows = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    return taskPhotos(state, id)
      .map((p) => ({
        ...p,
        autor: userName(state, p.user_id),
        sciezka: p.sciezka || p.url,
        data_dodania: p.data_dodania || p.timestamp || p.created_at,
      }))
      .sort((a, b) => new Date(a.data_dodania || 0).getTime() - new Date(b.data_dodania || 0).getTime());
  });
  if (!rows) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json(rows);
});

router.post('/tasks/:id(\\d+)/zdjecia', requireAuth, upTaskPhoto.single('zdjecie'), (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  if (!req.file) return res.status(400).json({ error: 'Brak pliku zdjecia' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const photos = taskPhotos(state, id);
    const rel = path.relative(path.join(__dirname, '..', 'uploads'), req.file.path).split(path.sep).join('/');
    const photo = {
      id: state.nextTaskZdjecieId++,
      task_id: id,
      user_id: req.user.id,
      typ: String(req.body?.typ || 'Przed').slice(0, 80),
      url: `/api/uploads/${rel}`,
      sciezka: `/api/uploads/${rel}`,
      lat: toNum(req.body?.lat),
      lon: toNum(req.body?.lon),
      opis: req.body?.opis ? String(req.body.opis).trim().slice(0, 4000) : null,
      tagi: normalizePhotoTags(req.body?.tagi),
      data_dodania: new Date().toISOString(),
    };
    photos.push(photo);
    return { ...photo, autor: userName(state, req.user.id) };
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json({ message: 'Zdjecie dodane', id: row.id, sciezka: row.sciezka, photo: row });
});

router.patch('/tasks/:id(\\d+)/zdjecia/:photoId(\\d+)', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const photoId = toNum(req.params.photoId);
  if (!id || !photoId) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const photo = taskPhotos(state, id).find((p) => Number(p.id) === Number(photoId));
    if (!photo) return false;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'typ')) photo.typ = String(req.body.typ || '').slice(0, 80);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'opis')) photo.opis = req.body.opis ? String(req.body.opis).trim().slice(0, 4000) : null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tagi')) photo.tagi = normalizePhotoTags(req.body.tagi);
    return { ...photo, autor: userName(state, photo.user_id), sciezka: photo.sciezka || photo.url };
  });
  if (row === null) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  if (row === false) return res.status(404).json({ error: 'Nie znaleziono zdjecia' });
  res.json(row);
});

router.delete('/tasks/:id(\\d+)/zdjecia/:photoId(\\d+)', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const photoId = toNum(req.params.photoId);
  if (!id || !photoId) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const deleted = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const photos = taskPhotos(state, id);
    const idx = photos.findIndex((p) => Number(p.id) === Number(photoId));
    if (idx === -1) return false;
    const [photo] = photos.splice(idx, 1);
    return photo;
  });
  if (deleted === null) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  if (deleted === false) return res.status(404).json({ error: 'Nie znaleziono zdjecia' });
  if (deleted.sciezka) {
    const rel = String(deleted.sciezka).replace(/^\/api\/uploads\/?/, '');
    const uploadRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
    const abs = path.resolve(path.join(uploadRoot, rel));
    try {
      if (abs.startsWith(uploadRoot) && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore local cleanup */
    }
  }
  res.json({ ok: true });
});

router.get('/tasks/:id(\\d+)/problemy', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const rows = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    return taskProblems(state, id)
      .map((problem) => buildTaskProblemRow(state, problem))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  });
  if (!rows) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json(rows);
});

function createLocalTaskProblem(req, res) {
  const id = toNum(req.params.id);
  const opis = String(req.body?.opis || '').trim();
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  if (!opis) return res.status(400).json({ error: 'Opis problemu jest wymagany' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const task = (state.zlecenia || []).find((z) => Number(z.id) === Number(id));
    if (!task) return null;
    ensureTaskProblemStore(state);
    const problem = {
      id: state.nextTaskProblemId++,
      task_id: id,
      user_id: req.user.id,
      typ: normalizeTaskProblemType(req.body?.typ),
      opis: opis.slice(0, 3000),
      status: 'Zgloszony',
      data_zgloszenia: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    taskProblems(state, id).push(problem);
    task.updated_at = new Date().toISOString();
    return buildTaskProblemRow(state, problem);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.status(201).json(row);
}

router.post('/tasks/:id(\\d+)/problemy', requireAuth, createLocalTaskProblem);
router.post('/tasks/:id(\\d+)/problem', requireAuth, createLocalTaskProblem);

router.get('/tasks/:id(\\d+)/logi', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const rows = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    return taskLogs(state, id)
      .slice()
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .map((log) => buildTaskLogRow(state, log));
  });
  if (!rows) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json(rows);
});

router.post('/tasks/:id(\\d+)/logi', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const log = addTaskLog(state, id, req.user, {
      tresc: String(req.body?.tresc || '').trim().slice(0, 3000),
      status: String(req.body?.status || '').trim().slice(0, 80) || null,
      lat: req.body?.lat,
      lng: req.body?.lng,
    });
    return buildTaskLogRow(state, log);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.status(201).json(row);
});

router.post('/tasks/:id(\\d+)/checkin', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const result = withStore((state) => {
    const task = (state.zlecenia || []).find((z) => Number(z.id) === Number(id));
    if (!task || !canUserViewZlecenie(state, req.user, id)) return null;
    if (!canUserUpdateFieldTask(req.user, task)) return { _forbidden: true };
    if (isTaskClosed(task.status)) return { _closed: true };
    const now = new Date().toISOString();
    task.last_checkin_at = now;
    task.last_checkin_lat = toNum(req.body?.lat);
    task.last_checkin_lng = toNum(req.body?.lng);
    task.updated_at = now;
    const log = addTaskLog(state, id, req.user, {
      status: 'check_in',
      tresc: req.body?.note || 'Check-in GPS: ekipa potwierdzila przyjazd do klienta.',
      lat: req.body?.lat,
      lng: req.body?.lng,
      created_at: now,
    });
    return { task: buildTaskRow(state, task), log: buildTaskLogRow(state, log) };
  });
  if (result?._forbidden) return res.status(403).json({ error: 'Brak uprawnien do check-in' });
  if (result?._closed) return res.status(400).json({ error: 'Zlecenie jest juz zamkniete' });
  if (!result) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.status(201).json(result);
});

router.post('/tasks/:id(\\d+)/start', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const result = withStore((state) => {
    const task = (state.zlecenia || []).find((z) => Number(z.id) === Number(id));
    if (!task || !canUserViewZlecenie(state, req.user, id)) return null;
    if (!canUserUpdateFieldTask(req.user, task)) return { _forbidden: true };
    if (isTaskClosed(task.status)) return { _closed: true };
    const now = new Date().toISOString();
    task.status = TASK_STATUS.W_REALIZACJI;
    task.started_at = task.started_at || now;
    task.active_work_started_at = now;
    task.last_start_lat = toNum(req.body?.lat);
    task.last_start_lng = toNum(req.body?.lng);
    task.updated_at = now;
    const log = addTaskLog(state, id, req.user, {
      status: 'start',
      tresc: 'Start pracy z aplikacji mobilnej.',
      lat: req.body?.lat,
      lng: req.body?.lng,
      created_at: now,
    });
    return { task: buildTaskRow(state, task), log: buildTaskLogRow(state, log) };
  });
  if (result?._forbidden) return res.status(403).json({ error: 'Brak uprawnien do startu pracy' });
  if (result?._closed) return res.status(400).json({ error: 'Zlecenie jest juz zamkniete' });
  if (!result) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.status(201).json(result);
});

router.post('/tasks/:id(\\d+)/finish', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  const result = withStore((state) => {
    const task = (state.zlecenia || []).find((z) => Number(z.id) === Number(id));
    if (!task || !canUserViewZlecenie(state, req.user, id)) return null;
    if (!canUserUpdateFieldTask(req.user, task)) return { _forbidden: true };
    if (isTaskClosed(task.status)) return { task: buildTaskRow(state, task), already_closed: true };
    const now = new Date().toISOString();
    const payment = req.body?.payment && typeof req.body.payment === 'object' ? req.body.payment : null;
    task.status = TASK_STATUS.ZAKONCZONE;
    task.data_zakonczenia = task.data_zakonczenia || now;
    task.last_work_finished_at = now;
    task.active_work_started_at = null;
    task.last_finish_lat = toNum(req.body?.lat);
    task.last_finish_lng = toNum(req.body?.lng);
    if (payment) task.payment = { ...(task.payment || {}), ...payment, updated_at: now };
    task.updated_at = now;
    const log = addTaskLog(state, id, req.user, {
      status: 'finish',
      tresc: req.body?.notatki || 'Zakonczono prace z aplikacji mobilnej.',
      lat: req.body?.lat,
      lng: req.body?.lng,
      created_at: now,
    });
    return { task: buildTaskRow(state, task), log: buildTaskLogRow(state, log) };
  });
  if (result?._forbidden) return res.status(403).json({ error: 'Brak uprawnien do zakonczenia pracy' });
  if (!result) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.status(201).json(result);
});

router.put('/tasks/:id(\\d+)/status', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const nextStatus = normalizeTaskStatus(req.body?.status);
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  if (!isValidTaskStatus(nextStatus)) return res.status(400).json({ error: 'Nieprawidlowy status' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const task = (state.zlecenia || []).find((z) => Number(z.id) === Number(id));
    if (!task) return null;
    const crewCanUpdate = req.user?.ekipa_id && String(req.user.ekipa_id) === String(task.ekipa_id);
    if (!canManageTaskRows(req.user) && !crewCanUpdate) return { _forbidden: true };
    if (isTaskClosed(task.status) && !canManageTaskRows(req.user)) return { _closed: true };
    if (!canTransitionTaskStatus(task.status, nextStatus, { allowCancel: canManageTaskRows(req.user) })) {
      return { _badTransition: { from: task.status, to: nextStatus } };
    }
    task.status = nextStatus;
    if (nextStatus === TASK_STATUS.W_REALIZACJI && !task.started_at) task.started_at = new Date().toISOString();
    if (nextStatus === TASK_STATUS.ZAKONCZONE) task.data_zakonczenia = task.data_zakonczenia || new Date().toISOString();
    task.updated_at = new Date().toISOString();
    return buildTaskRow(state, task);
  });
  if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien do zmiany statusu' });
  if (row?._closed) return res.status(400).json({ error: 'Zlecenie jest juz zamkniete' });
  if (row?._badTransition) {
    return res.status(409).json({
      error: `Niedozwolona zmiana statusu: ${row._badTransition.from || 'brak'} -> ${row._badTransition.to || 'brak'}`,
      code: 'TASK_STATUS_TRANSITION_BLOCKED',
    });
  }
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json(row);
});

router.get('/tasks/:id(\\d+)', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    return z ? buildTaskRow(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/tasks/:id(\\d+)', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  if (!canManageTaskRows(req.user)) return res.status(403).json({ error: 'Brak uprawnien do edycji zlecen' });
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    if (!z) return null;
    if (b.status !== undefined && !canTransitionTaskStatus(z.status, normalizeTaskStatus(b.status), { allowCancel: canManageTaskRows(req.user) })) {
      return { _badTransition: { from: z.status, to: normalizeTaskStatus(b.status) } };
    }
    const targetBranchId = b.oddzial_id !== undefined ? toNum(b.oddzial_id) : z.oddzial_id;
    const targetTeamId = b.ekipa_id !== undefined ? toNum(b.ekipa_id) : z.ekipa_id;
    const day = resourceDate(b.data_wykonania || b.data_planowana || z.data_wykonania || z.data_planowana);
    const error = teamBranchError(state, targetTeamId, targetBranchId, day);
    if (error) return null;
    const mergeKeys = Object.keys(b).filter((k) => k !== 'id' && !String(k).endsWith('_nazwa'));
    for (const k of mergeKeys) {
      if (b[k] === undefined) continue;
      if (TASK_PUT_NUM.has(k)) {
        if (k === 'dodatkowe_uslugi_liczba' || k === 'bony_liczba') {
          const n = parseInt(String(b[k]), 10);
          z[k] = Number.isFinite(n) && n >= 0 ? n : 0;
        } else {
          const n = toNum(b[k]);
          z[k] = n ?? b[k];
        }
      } else {
        z[k] = b[k];
      }
    }
    if (b.data_planowana || b.data_wykonania) {
      if (b.data_planowana) z.data_planowana = b.data_planowana;
      if (b.data_wykonania) z.data_wykonania = b.data_wykonania;
    }
    return buildTaskRow(state, z);
  });
  if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (row?._badTransition) {
    return res.status(409).json({
      error: `Niedozwolona zmiana statusu: ${row._badTransition.from || 'brak'} -> ${row._badTransition.to || 'brak'}`,
      code: 'TASK_STATUS_TRANSITION_BLOCKED',
    });
  }
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostępu' });
  res.json(row);
});

router.put('/tasks/:id(\\d+)/field-package', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = withStore((state) => {
    const z = state.zlecenia.find((x) => Number(x.id) === Number(id));
    if (!z || !canUserViewZlecenie(state, req.user, id)) return null;
    const assignedEstimator = isEstimatorUser(req.user) && String(z.wyceniajacy_id || '') === String(req.user.id || '');
    if (!canManageTaskRows(req.user) && !assignedEstimator) return { _forbidden: true };

    const zakres = String(b.zakres_prac || b.opis || '').trim();
    const ryzyka = String(b.ryzyka || '').trim();
    const typyPrac = Array.isArray(b.typy_prac) ? b.typy_prac.filter(Boolean).join(', ') : '';
    const sprzet = Array.isArray(b.sprzet) ? b.sprzet.filter(Boolean).join(', ') : '';
    const warunkiRozliczenia = String(b.warunki_rozliczenia || '').trim();
    const odpady = String(b.odpady || '').trim();
    const hours = toNum(b.czas_planowany_godziny);
    const value = toNum(b.wartosc_planowana);
    const accepted = b.klient_zaakceptowal === true;
    const actor = [req.user.imie, req.user.nazwisko].filter(Boolean).join(' ') || req.user.login || `#${req.user.id}`;
    const fieldLines = [
      'PRZEKAZANIE DO BIURA',
      `Typy prac: ${typyPrac || '-'}`,
      `Zakres prac: ${zakres || '-'}`,
      `Czas pracy: ${hours != null ? `${hours} h` : '-'}`,
      `Budzet klienta: ${value != null ? `${value} PLN` : '-'}`,
      `Sprzet: ${sprzet || '-'}`,
      `Warunki rozliczenia: ${warunkiRozliczenia || '-'}`,
      `Odpady: ${odpady || '-'}`,
      `Ryzyka: ${ryzyka || '-'}`,
      `Klient zaakceptowal: ${accepted ? 'tak' : 'nie'}`,
      `Wyceniacz: ${actor}`,
      `Data przekazania: ${new Date().toISOString()}`,
    ];
    z.opis = zakres || z.opis || null;
    z.notatki_wewnetrzne = [String(z.notatki_wewnetrzne || '').trim(), fieldLines.join('\n')]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);
    if (hours != null) z.czas_planowany_godziny = hours;
    if (value != null) z.wartosc_planowana = value;
    if (b.send_to_office === true && accepted) z.status = TASK_STATUS.DO_ZATWIERDZENIA;
    z.updated_at = new Date().toISOString();
    return buildTaskRow(state, z);
  });
  if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien do pakietu terenowego' });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostępu' });
  res.json(row);
});

router.put('/tasks/:id(\\d+)/office-plan', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  if (!canManageTaskRows(req.user)) return res.status(403).json({ error: 'Brak uprawnien do planowania zlecen' });
  if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
  if (!String(b.data_planowana || '').trim()) return res.status(400).json({ error: 'Podaj termin' });
  const teamId = toNum(b.ekipa_id);
  if (!teamId) return res.status(400).json({ error: 'Wybierz ekipe' });

  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => Number(x.id) === Number(id));
    if (!z) return null;
    if (isTaskClosed(z.status)) return { _closed: true };

    const plannedDateTime = buildLocalPlannedDateTime(b.data_planowana, b.godzina_rozpoczecia);
    const hours = toNum(b.czas_planowany_godziny) ?? toNum(z.czas_planowany_godziny) ?? 2;
    const day = resourceDate(plannedDateTime);
    const branchError = teamBranchError(state, teamId, z.oddzial_id, day);
    if (branchError) return { _branchError: branchError };
    const busyRanges = localTaskBusyRanges(state, teamId, day, id);
    const startMin = localPlanMinutes(plannedDateTime, b.godzina_rozpoczecia);
    const durationMin = Math.max(15, Math.round(Number(hours || 2) * 60));
    if (localPlanConflicts(busyRanges, startMin, durationMin)) {
      return { _conflict: true };
    }

    const note = String(b.sprzet_notatka || '').trim();
    const planLines = [
      'PLAN BIURA',
      `Termin: ${plannedDateTime}`,
      `Czas: ${hours} h`,
      `Ekipa: #${teamId}`,
      note ? `Sprzet / uwagi: ${note}` : '',
      `Zaplanowal: ${req.user.login || req.user.id}`,
      `Data planowania: ${new Date().toISOString()}`,
    ].filter(Boolean);

    z.data_planowana = plannedDateTime;
    z.godzina_rozpoczecia = String(b.godzina_rozpoczecia || '').slice(0, 5) || z.godzina_rozpoczecia || null;
    z.czas_planowany_godziny = hours;
    z.ekipa_id = teamId;
    z.status = TASK_STATUS.ZAPLANOWANE;
    z.notatki_wewnetrzne = [String(z.notatki_wewnetrzne || '').trim(), planLines.join('\n')]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);
    z.updated_at = new Date().toISOString();
    return buildTaskRow(state, z);
  });

  if (row?._closed) return res.status(400).json({ error: 'Nie mozna planowac zakonczonego lub anulowanego zlecenia.' });
  if (row?._branchError) return res.status(409).json({ error: row._branchError });
  if (row?._conflict) return res.status(409).json({ error: 'Konflikt terminu: ekipa ma juz zaplanowane zlecenie w tym przedziale.', code: 'TASK_PLAN_CONFLICT' });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostepu' });
  res.json(row);
});

router.get('/tasks/stats', requireAuth, (req, res) => {
  const stats = readOnly((state) => {
    const z = state.zlecenia.filter((x) => x.typ !== 'wycena');
    const nowe = z.filter((x) => x.status === TASK_STATUS.NOWE).length;
    const wycena_terenowa = z.filter((x) => x.status === TASK_STATUS.WYCENA_TERENOWA).length;
    const do_zatwierdzenia = z.filter((x) => x.status === TASK_STATUS.DO_ZATWIERDZENIA).length;
    const zaplanowane = z.filter((x) => x.status === TASK_STATUS.ZAPLANOWANE).length;
    const w_realizacji = z.filter((x) => isTaskInProgress(x.status)).length;
    const zakonczone = z.filter((x) => isTaskDone(x.status)).length;
    return { nowe, wycena_terenowa, do_zatwierdzenia, zaplanowane, w_realizacji, zakonczone };
  });
  res.json(stats);
});

router.get('/raporty/ranking-brygad', requireAuth, (req, res) => {
  const data = readOnly((state) => buildLocalTeamRanking(state, req.user, req.query || {}));
  res.json(data);
});

function buildKommoTaskPayload(row, actor = null) {
  const client = toCompactText(row.klient_nazwa);
  const leadName = ['Zlecenie', `#${row.id}`, client].filter(Boolean).join(' · ');
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
  const customFields = [
    customField(KOMMO_CF_ORDER_ID, row.id),
    customField(KOMMO_CF_BRANCH_ID, row.oddzial_id ?? null),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.status)),
    customField(KOMMO_CF_LOAD_DATE_ID, toIsoDateStart(row.data_planowana)),
    customField(KOMMO_CF_PHONE_ID, toCompactText(row.klient_telefon)),
    customField(KOMMO_CF_GOODS_SUMMARY_ID, toCompactText(row.typ_uslugi)),
  ].filter(Boolean);
  const tags = KOMMO_CRM_TAGS.map((name) => ({ name }));
  return {
    source: 'arbor-web-local',
    event: 'task.sync',
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName || `Zlecenie ${row.id}`,
        external_id: `task:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    task: {
      id: row.id,
      status: row.status,
      typ_uslugi: toCompactText(row.typ_uslugi),
      priorytet: toCompactText(row.priorytet),
      klient_nazwa: client,
      klient_telefon: toCompactText(row.klient_telefon),
      klient_email: toCompactText(row.klient_email),
      adres: addr || null,
      oddzial_id: row.oddzial_id ?? null,
      data_planowana: toCompactText(row.data_planowana),
      wartosc_planowana: row.wartosc_planowana ?? null,
      notatki_wewnetrzne: toCompactText(row.notatki_wewnetrzne),
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

function buildKommoKlientPayload(row, actor = null) {
  const namePerson = [toCompactText(row.imie), toCompactText(row.nazwisko)].filter(Boolean).join(' ');
  const leadName = row.firma
    ? `${toCompactText(row.firma)} · ${namePerson || 'Klient'}`
    : namePerson || `Klient #${row.id}`;
  const customFields = [
    customField(KOMMO_CF_KLIENT_RECORD_ID, row.id),
    customField(KOMMO_CF_PHONE_ID, toCompactText(row.telefon)),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.zrodlo)),
  ].filter(Boolean);
  const tags = KOMMO_CRM_TAGS.map((name) => ({ name }));
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
  return {
    source: 'arbor-web-local',
    event: 'klient.sync',
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName,
        external_id: `klient:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    klient: {
      id: row.id,
      imie: toCompactText(row.imie),
      nazwisko: toCompactText(row.nazwisko),
      firma: toCompactText(row.firma),
      telefon: toCompactText(row.telefon),
      email: toCompactText(row.email),
      adres: addr || null,
      zrodlo: toCompactText(row.zrodlo),
      notatki: toCompactText(row.notatki),
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

function resolveKommoWebhookUrl(kind /* 'crm' | 'cmr' */) {
  if (kind === 'crm' && KOMMO_CRM_WEBHOOK_URL) return KOMMO_CRM_WEBHOOK_URL;
  return KOMMO_WEBHOOK_URL;
}

function kommoWebhookConfigured(kind) {
  return Boolean(resolveKommoWebhookUrl(kind));
}

async function postKommoWebhook(payload, kind = 'cmr') {
  const url = resolveKommoWebhookUrl(kind);
  const headers = { 'content-type': 'application/json' };
  if (KOMMO_WEBHOOK_SECRET_HEADER && KOMMO_WEBHOOK_SECRET) {
    headers[KOMMO_WEBHOOK_SECRET_HEADER] = KOMMO_WEBHOOK_SECRET;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  return { response, bodyText };
}

router.get('/tasks/:id(\\d+)/kommo-payload', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    return z ? enrichWycena(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  const payload = buildKommoTaskPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  return res.json(payload);
});

router.post('/tasks/:id(\\d+)/kommo-push', requireAuth, async (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    return z ? enrichWycena(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  if (!kommoWebhookConfigured('crm')) {
    return res.status(400).json({
      error:
        'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
    });
  }
  const payload = buildKommoTaskPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  const markSync = (next) =>
    withStore((state) => {
      const z = state.zlecenia.find((x) => x.id === id);
      if (!z) return null;
      z.kommo_last_sync_at = new Date().toISOString();
      z.kommo_last_sync_status = next.status || null;
      z.kommo_last_sync_http = next.http ?? null;
      z.kommo_last_sync_error = next.error || null;
      return z;
    });
  try {
    const { response, bodyText } = await postKommoWebhook(payload, 'crm');
    if (!response.ok) {
      markSync({
        status: 'error',
        http: response.status,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      });
      return res.status(502).json({
        ok: false,
        status: 'error',
        http_status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    markSync({ status: 'ok', http: response.status, error: null });
    return res.json({ ok: true, status: 'ok', http_status: response.status });
  } catch (err) {
    markSync({ status: 'error', http: null, error: err.message || 'network error' });
    return res.status(502).json({
      ok: false,
      status: 'error',
      error: err.message || 'Nie udało się wysłać danych do Kommo',
    });
  }
});

router.get('/notifications', requireAuth, (req, res) => {
  const uid = req.user.id;
  const data = readOnly((state) => {
    const list = (state.notifications || []).filter(
      (n) => n.to_user_id === uid || n.to_user_id == null
    );
    const unread = list.filter((n) => n.status === 'Nowe').length;
    return { notifications: list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), unread_count: unread };
  });
  res.json(data);
});

function resolveDoKogo(state, doKogo) {
  if (!doKogo) return [];
  const role = String(doKogo).trim();
  const matchRole = (u) => {
    if (u.aktywny === false) return false;
    if (u.rola === role) return true;
    if (role === 'Dyrektor' && u.rola === 'Prezes') return true;
    return false;
  };
  return state.users.filter(matchRole).map((u) => u.id);
}

const OPERATOR_TASK_STATUSES = new Set(['todo', 'in_progress', 'done', 'archived']);
const OPERATOR_TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function canManageOperatorTasks(user) {
  return ['Administrator', 'Dyrektor', 'Kierownik'].includes(user?.rola);
}

function canAssignOperatorTaskTo(state, actor, assigneeId) {
  if (!canManageOperatorTasks(actor)) return false;
  if (actor.rola === 'Administrator' || actor.rola === 'Dyrektor') return true;
  const assignee = state.users.find((u) => Number(u.id) === Number(assigneeId));
  if (!assignee) return false;
  return String(assignee.oddzial_id || '') === String(actor.oddzial_id || '') || Number(assignee.id) === Number(actor.id);
}

function canViewOperatorTask(state, user, task) {
  if (!task || !user) return false;
  if (Number(task.assigned_to) === Number(user.id) || Number(task.created_by) === Number(user.id)) return true;
  if (user.rola === 'Administrator' || user.rola === 'Dyrektor') return true;
  if (user.rola === 'Kierownik') {
    const assignee = state.users.find((u) => Number(u.id) === Number(task.assigned_to));
    return assignee && String(assignee.oddzial_id || '') === String(user.oddzial_id || '');
  }
  return false;
}

function buildOperatorTaskRow(state, task) {
  const assignee = state.users.find((u) => Number(u.id) === Number(task.assigned_to));
  const creator = state.users.find((u) => Number(u.id) === Number(task.created_by));
  return {
    ...task,
    assignee_name: assignee ? `${assignee.imie || ''} ${assignee.nazwisko || ''}`.trim() || assignee.login : '',
    assignee_role: assignee?.rola || '',
    created_by_name: creator ? `${creator.imie || ''} ${creator.nazwisko || ''}`.trim() || creator.login : '',
  };
}

router.get('/operator-tasks', requireAuth, (req, res) => {
  const rows = readOnly((state) => {
    ensureOperatorTaskStore(state);
    return state.operatorTasks
      .filter((task) => canViewOperatorTask(state, req.user, task))
      .map((task) => buildOperatorTaskRow(state, task))
      .sort((a, b) => {
        if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
        const aDue = a.due_at || '9999-12-31T23:59:59.999Z';
        const bDue = b.due_at || '9999-12-31T23:59:59.999Z';
        return String(aDue).localeCompare(String(bDue)) || new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  });
  res.json({ tasks: rows });
});

router.post('/operator-tasks', requireAuth, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const assignedTo = toNum(body.assigned_to);
  if (!title) return res.status(400).json({ error: 'Tytuł zadania jest wymagany' });
  if (!assignedTo) return res.status(400).json({ error: 'Wybierz pracownika' });

  const row = withStore((state) => {
    ensureOperatorTaskStore(state);
    if (!canAssignOperatorTaskTo(state, req.user, assignedTo)) return null;
    const now = new Date().toISOString();
    const priority = OPERATOR_TASK_PRIORITIES.has(body.priority) ? body.priority : 'normal';
    const task = {
      id: state.nextOperatorTaskId++,
      title,
      opis: String(body.opis || '').trim(),
      priority,
      status: 'todo',
      assigned_to: assignedTo,
      created_by: req.user.id,
      due_at: body.due_at || null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    state.operatorTasks.push(task);

    if (!state.notifications) state.notifications = [];
    if (!state.nextNotificationId) state.nextNotificationId = 1;
    state.notifications.push({
      id: state.nextNotificationId++,
      typ: 'zadanie',
      tresc: `Nowe zadanie: ${title}`,
      task_id: null,
      status: 'Nowe',
      od_user_id: req.user.id,
      to_user_id: assignedTo,
      created_at: now,
    });

    return buildOperatorTaskRow(state, task);
  });

  if (!row) return res.status(403).json({ error: 'Brak uprawnień do przypisania tego zadania' });
  res.status(201).json(row);
});

router.patch('/operator-tasks/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const body = req.body || {};
  const row = withStore((state) => {
    ensureOperatorTaskStore(state);
    const task = state.operatorTasks.find((item) => Number(item.id) === Number(id));
    if (!task || !canViewOperatorTask(state, req.user, task)) return null;

    const canEditMeta = canManageOperatorTasks(req.user) || Number(task.created_by) === Number(req.user.id);
    const now = new Date().toISOString();
    if (body.status !== undefined) {
      const status = OPERATOR_TASK_STATUSES.has(body.status) ? body.status : task.status;
      task.status = status;
      task.completed_at = status === 'done' ? (task.completed_at || now) : null;
    }
    if (canEditMeta) {
      if (body.title !== undefined) task.title = String(body.title || '').trim() || task.title;
      if (body.opis !== undefined) task.opis = String(body.opis || '').trim();
      if (body.priority !== undefined) task.priority = OPERATOR_TASK_PRIORITIES.has(body.priority) ? body.priority : task.priority;
      if (body.due_at !== undefined) task.due_at = body.due_at || null;
      if (body.assigned_to !== undefined) {
        const assignedTo = toNum(body.assigned_to);
        if (assignedTo && canAssignOperatorTaskTo(state, req.user, assignedTo)) task.assigned_to = assignedTo;
      }
    }
    task.updated_at = now;
    return buildOperatorTaskRow(state, task);
  });

  if (!row) return res.status(404).json({ error: 'Nie znaleziono zadania lub brak dostępu' });
  res.json(row);
});

const POSITION_SETTLEMENT_TYPES = new Set(['hourly', 'daily', 'fixed', 'percent_revenue', 'percent_margin', 'mixed', 'b2b']);

function canManagePositionCardsFor(state, actor, userId) {
  if (!actor || !userId) return false;
  if (actor.rola === 'Administrator' || actor.rola === 'Dyrektor') return true;
  if (actor.rola !== 'Kierownik') return false;
  const target = state.users.find((u) => Number(u.id) === Number(userId));
  if (!target) return false;
  return String(target.oddzial_id || '') === String(actor.oddzial_id || '') || Number(target.id) === Number(actor.id);
}

function canViewPositionCard(state, actor, userId) {
  if (Number(actor?.id) === Number(userId)) return true;
  return canManagePositionCardsFor(state, actor, userId);
}

function normalizeCardNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildPositionCardRow(state, userId) {
  const target = state.users.find((u) => Number(u.id) === Number(userId));
  if (!target) return null;
  const saved = state.positionCards?.[String(userId)] || {};
  const acknowledgement = state.positionCardAcknowledgements?.[String(userId)] || {};
  const editor = state.users.find((u) => Number(u.id) === Number(saved.updated_by));
  const acknowledger = state.users.find((u) => Number(u.id) === Number(acknowledgement.acknowledged_by));
  const hasSavedCard = Boolean(saved.updated_at);
  const acknowledgementConfirmed =
    hasSavedCard &&
    Boolean(acknowledgement.acknowledged_at) &&
    String(acknowledgement.card_updated_at || '') === String(saved.updated_at || '');
  return {
    user_id: Number(userId),
    employee_name: `${target.imie || ''} ${target.nazwisko || ''}`.trim() || target.login,
    employee_role: target.rola || '',
    stanowisko: saved.stanowisko ?? target.stanowisko ?? target.rola ?? '',
    cenny_produkt: saved.cenny_produkt ?? '',
    obowiazki: saved.obowiazki ?? '',
    kryteria: saved.kryteria ?? '',
    settlement_type: saved.settlement_type ?? (target.rola === 'Brygadzista' ? 'percent_revenue' : 'hourly'),
    fixed_amount_pln: saved.fixed_amount_pln ?? null,
    daily_rate_pln: saved.daily_rate_pln ?? null,
    hourly_rate_pln: saved.hourly_rate_pln ?? target.stawka_godzinowa ?? null,
    revenue_percent: saved.revenue_percent ?? target.procent_wynagrodzenia ?? null,
    margin_percent: saved.margin_percent ?? null,
    bonus_rules: saved.bonus_rules ?? '',
    settlement_notes: saved.settlement_notes ?? '',
    updated_at: saved.updated_at ?? null,
    updated_by: saved.updated_by ?? null,
    updated_by_name: editor ? `${editor.imie || ''} ${editor.nazwisko || ''}`.trim() || editor.login : '',
    acknowledgement_status: hasSavedCard ? (acknowledgementConfirmed ? 'confirmed' : 'pending') : 'draft',
    acknowledged_at: acknowledgementConfirmed ? acknowledgement.acknowledged_at : null,
    acknowledged_by: acknowledgementConfirmed ? acknowledgement.acknowledged_by : null,
    acknowledged_by_name:
      acknowledgementConfirmed && acknowledger ? `${acknowledger.imie || ''} ${acknowledger.nazwisko || ''}`.trim() || acknowledger.login : '',
    acknowledgement_note: acknowledgementConfirmed ? acknowledgement.note || '' : '',
    acknowledged_card_updated_at: acknowledgementConfirmed ? acknowledgement.card_updated_at : null,
  };
}

router.get('/position-cards', requireAuth, (req, res) => {
  const rows = readOnly((state) => {
    ensurePositionCardStore(state);
    return state.users
      .filter((user) => canViewPositionCard(state, req.user, user.id))
      .map((user) => buildPositionCardRow(state, user.id))
      .filter(Boolean);
  });
  res.json({ cards: rows });
});

router.get('/position-cards/:userId', requireAuth, (req, res) => {
  const userId = toNum(req.params.userId);
  const row = readOnly((state) => {
    ensurePositionCardStore(state);
    if (!canViewPositionCard(state, req.user, userId)) return null;
    return buildPositionCardRow(state, userId);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono karty lub brak dostępu' });
  res.json(row);
});

router.put('/position-cards/:userId', requireAuth, (req, res) => {
  const userId = toNum(req.params.userId);
  const body = req.body || {};
  const row = withStore((state) => {
    ensurePositionCardStore(state);
    if (!canManagePositionCardsFor(state, req.user, userId)) return null;
    const target = state.users.find((u) => Number(u.id) === Number(userId));
    if (!target) return null;
    const now = new Date().toISOString();
    const settlementType = POSITION_SETTLEMENT_TYPES.has(body.settlement_type) ? body.settlement_type : 'mixed';
    state.positionCards[String(userId)] = {
      ...(state.positionCards[String(userId)] || {}),
      user_id: userId,
      stanowisko: String(body.stanowisko || target.stanowisko || target.rola || '').trim(),
      cenny_produkt: String(body.cenny_produkt || '').trim(),
      obowiazki: String(body.obowiazki || '').trim(),
      kryteria: String(body.kryteria || '').trim(),
      settlement_type: settlementType,
      fixed_amount_pln: normalizeCardNumber(body.fixed_amount_pln),
      daily_rate_pln: normalizeCardNumber(body.daily_rate_pln),
      hourly_rate_pln: normalizeCardNumber(body.hourly_rate_pln),
      revenue_percent: normalizeCardNumber(body.revenue_percent),
      margin_percent: normalizeCardNumber(body.margin_percent),
      bonus_rules: String(body.bonus_rules || '').trim(),
      settlement_notes: String(body.settlement_notes || '').trim(),
      updated_by: req.user.id,
      updated_at: now,
    };

    if (!state.notifications) state.notifications = [];
    if (!state.nextNotificationId) state.nextNotificationId = 1;
    state.notifications.push({
      id: state.nextNotificationId++,
      typ: 'karta_stanowiska',
      tresc: `Zaktualizowano kartę stanowiska: ${state.positionCards[String(userId)].stanowisko}`,
      task_id: null,
      status: 'Nowe',
      od_user_id: req.user.id,
      to_user_id: userId,
      created_at: now,
    });

    return buildPositionCardRow(state, userId);
  });

  if (!row) return res.status(403).json({ error: 'Brak uprawnień do edycji karty stanowiska' });
  res.json(row);
});

router.post('/position-cards/:userId/acknowledge', requireAuth, (req, res) => {
  const userId = toNum(req.params.userId);
  const body = req.body || {};
  const row = withStore((state) => {
    ensurePositionCardStore(state);
    if (!userId || Number(req.user?.id) !== Number(userId)) return null;
    const saved = state.positionCards[String(userId)];
    if (!saved?.updated_at) return { error: 'Nie ma zapisanej karty stanowiska do potwierdzenia' };
    const now = new Date().toISOString();
    state.positionCardAcknowledgements[String(userId)] = {
      user_id: userId,
      card_updated_at: saved.updated_at,
      acknowledged_by: req.user.id,
      acknowledged_at: now,
      note: String(body.note || '').trim().slice(0, 1000),
    };

    if (saved.updated_by && Number(saved.updated_by) !== Number(req.user.id)) {
      if (!state.notifications) state.notifications = [];
      if (!state.nextNotificationId) state.nextNotificationId = 1;
      state.notifications.push({
        id: state.nextNotificationId++,
        typ: 'karta_stanowiska',
        tresc: `Potwierdzono kartę stanowiska: ${saved.stanowisko || 'karta stanowiska'}`,
        task_id: null,
        status: 'Nowe',
        od_user_id: req.user.id,
        to_user_id: saved.updated_by,
        created_at: now,
      });
    }

    return buildPositionCardRow(state, userId);
  });

  if (!row) return res.status(403).json({ error: 'Kartę może potwierdzić tylko przypisany pracownik' });
  if (row.error) return res.status(400).json(row);
  res.json(row);
});

const EMPLOYEE_DOCUMENT_TYPES = new Set([
  'contract',
  'medical',
  'bhp',
  'qualification',
  'office_card',
  'settlement',
  'id',
  'other',
]);
const EMPLOYEE_DOCUMENT_STATUSES = new Set(['valid', 'pending', 'expired', 'archived']);

function canManageEmployeeDocumentsFor(state, actor, userId) {
  if (!actor || !userId) return false;
  if (actor.rola === 'Administrator' || actor.rola === 'Dyrektor') return true;
  if (actor.rola !== 'Kierownik') return false;
  const target = state.users.find((u) => Number(u.id) === Number(userId));
  if (!target) return false;
  return String(target.oddzial_id || '') === String(actor.oddzial_id || '') || Number(target.id) === Number(actor.id);
}

function canViewEmployeeDocuments(state, actor, userId) {
  if (Number(actor?.id) === Number(userId)) return true;
  return canManageEmployeeDocumentsFor(state, actor, userId);
}

function normalizeDocumentDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function getEmployeeDocumentExpiryStatus(doc) {
  if (doc.status === 'archived') return 'archived';
  if (doc.status === 'pending') return 'pending';
  if (doc.status === 'expired') return 'expired';
  if (!doc.expires_at) return 'no_expiry';
  const expiry = new Date(`${String(doc.expires_at).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return 'no_expiry';
  const diffDays = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 45) return 'expiring';
  return 'valid';
}

function buildEmployeeDocumentRow(state, doc) {
  const target = state.users.find((u) => Number(u.id) === Number(doc.user_id));
  const creator = state.users.find((u) => Number(u.id) === Number(doc.created_by));
  const updater = state.users.find((u) => Number(u.id) === Number(doc.updated_by));
  return {
    ...doc,
    user_id: Number(doc.user_id),
    employee_name: target ? `${target.imie || ''} ${target.nazwisko || ''}`.trim() || target.login : '',
    employee_role: target?.rola || '',
    created_by_name: creator ? `${creator.imie || ''} ${creator.nazwisko || ''}`.trim() || creator.login : '',
    updated_by_name: updater ? `${updater.imie || ''} ${updater.nazwisko || ''}`.trim() || updater.login : '',
    file_url: doc.file_path ? `/api/uploads/${doc.file_path}` : null,
    expiry_status: getEmployeeDocumentExpiryStatus(doc),
  };
}

function requireEmployeeDocumentManager(req, res, next) {
  const userId = toNum(req.params.userId);
  const allowed = readOnly((state) => {
    const target = state.users.find((u) => Number(u.id) === Number(userId));
    return Boolean(target && canManageEmployeeDocumentsFor(state, req.user, userId));
  });
  if (!allowed) return res.status(403).json({ error: 'Brak uprawnien do dokumentow tego pracownika' });
  next();
}

router.get('/employee-documents', requireAuth, (req, res) => {
  const rows = readOnly((state) => {
    ensureEmployeeDocumentStore(state);
    return state.employeeDocuments
      .filter((doc) => canViewEmployeeDocuments(state, req.user, doc.user_id))
      .map((doc) => buildEmployeeDocumentRow(state, doc))
      .sort((a, b) => {
        const aDate = a.expires_at || '9999-12-31';
        const bDate = b.expires_at || '9999-12-31';
        return String(aDate).localeCompare(String(bDate)) || new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  });
  res.json({ documents: rows });
});

router.get('/employee-documents/:userId', requireAuth, (req, res) => {
  const userId = toNum(req.params.userId);
  const rows = readOnly((state) => {
    ensureEmployeeDocumentStore(state);
    if (!canViewEmployeeDocuments(state, req.user, userId)) return null;
    return state.employeeDocuments
      .filter((doc) => Number(doc.user_id) === Number(userId))
      .map((doc) => buildEmployeeDocumentRow(state, doc))
      .sort((a, b) => {
        const aDate = a.expires_at || '9999-12-31';
        const bDate = b.expires_at || '9999-12-31';
        return String(aDate).localeCompare(String(bDate)) || new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  });
  if (!rows) return res.status(403).json({ error: 'Brak dostepu do dokumentow pracownika' });
  res.json({ documents: rows });
});

router.post('/employee-documents/:userId', requireAuth, requireEmployeeDocumentManager, upEmployeeDocument.single('file'), (req, res) => {
  const userId = toNum(req.params.userId);
  const body = req.body || {};
  const row = withStore((state) => {
    ensureEmployeeDocumentStore(state);
    if (!canManageEmployeeDocumentsFor(state, req.user, userId)) return null;
    const target = state.users.find((u) => Number(u.id) === Number(userId));
    if (!target) return null;
    const now = new Date().toISOString();
    const type = EMPLOYEE_DOCUMENT_TYPES.has(body.type) ? body.type : 'other';
    const status = EMPLOYEE_DOCUMENT_STATUSES.has(body.status) ? body.status : 'valid';
    const uploadRel = req.file
      ? path.relative(path.join(__dirname, '..', 'uploads'), req.file.path).split(path.sep).join('/')
      : null;
    const doc = {
      id: state.nextEmployeeDocumentId++,
      user_id: userId,
      type,
      title: String(body.title || '').trim().slice(0, 160) || 'Dokument pracownika',
      status,
      issued_at: normalizeDocumentDate(body.issued_at),
      expires_at: normalizeDocumentDate(body.expires_at),
      notes: String(body.notes || '').trim().slice(0, 1200),
      file_path: uploadRel,
      original_file_name: req.file?.originalname || '',
      stored_file_name: req.file?.filename || '',
      mime_type: req.file?.mimetype || '',
      size_bytes: req.file?.size || 0,
      created_by: req.user.id,
      updated_by: req.user.id,
      created_at: now,
      updated_at: now,
    };
    state.employeeDocuments.push(doc);

    if (Number(req.user.id) !== Number(userId)) {
      if (!state.notifications) state.notifications = [];
      if (!state.nextNotificationId) state.nextNotificationId = 1;
      state.notifications.push({
        id: state.nextNotificationId++,
        typ: 'dokument_pracownika',
        tresc: `Dodano dokument pracownika: ${doc.title}`,
        task_id: null,
        status: 'Nowe',
        od_user_id: req.user.id,
        to_user_id: userId,
        created_at: now,
      });
    }

    return buildEmployeeDocumentRow(state, doc);
  });

  if (!row) return res.status(403).json({ error: 'Brak uprawnien do dodania dokumentu' });
  res.status(201).json(row);
});

router.patch('/employee-documents/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const body = req.body || {};
  const row = withStore((state) => {
    ensureEmployeeDocumentStore(state);
    const doc = state.employeeDocuments.find((item) => Number(item.id) === Number(id));
    if (!doc || !canManageEmployeeDocumentsFor(state, req.user, doc.user_id)) return null;
    const type = EMPLOYEE_DOCUMENT_TYPES.has(body.type) ? body.type : doc.type;
    const status = EMPLOYEE_DOCUMENT_STATUSES.has(body.status) ? body.status : doc.status;
    if (body.type !== undefined) doc.type = type;
    if (body.title !== undefined) doc.title = String(body.title || '').trim().slice(0, 160) || doc.title;
    if (body.status !== undefined) doc.status = status;
    if (body.issued_at !== undefined) doc.issued_at = normalizeDocumentDate(body.issued_at);
    if (body.expires_at !== undefined) doc.expires_at = normalizeDocumentDate(body.expires_at);
    if (body.notes !== undefined) doc.notes = String(body.notes || '').trim().slice(0, 1200);
    doc.updated_by = req.user.id;
    doc.updated_at = new Date().toISOString();
    return buildEmployeeDocumentRow(state, doc);
  });

  if (!row) return res.status(404).json({ error: 'Nie znaleziono dokumentu lub brak dostepu' });
  res.json(row);
});

router.delete('/employee-documents/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const result = withStore((state) => {
    ensureEmployeeDocumentStore(state);
    const index = state.employeeDocuments.findIndex((item) => Number(item.id) === Number(id));
    if (index < 0) return null;
    const doc = state.employeeDocuments[index];
    if (!canManageEmployeeDocumentsFor(state, req.user, doc.user_id)) return null;
    state.employeeDocuments.splice(index, 1);
    return doc;
  });

  if (!result) return res.status(404).json({ error: 'Nie znaleziono dokumentu lub brak dostepu' });
  if (result.file_path) {
    const absolute = path.resolve(path.join(__dirname, '..', 'uploads', result.file_path));
    const root = path.resolve(UP_EMPLOYEE_DOCUMENTS);
    if (absolute.startsWith(root) && fs.existsSync(absolute)) {
      try {
        fs.unlinkSync(absolute);
      } catch {
        // File cleanup is best-effort; metadata deletion is already complete.
      }
    }
  }
  res.json({ ok: true });
});

router.post('/notifications', requireAuth, (req, res) => {
  const b = req.body || {};
  const ids = [];
  withStore((state) => {
    if (!state.notifications) state.notifications = [];
    if (!state.nextNotificationId) state.nextNotificationId = 1;
    const now = new Date().toISOString();
    const typ = b.typ || 'info';
    const tresc = b.tresc || '';
    const taskId = toNum(b.task_id);
    const recipients = [];
    if (b.to_user_id) recipients.push(toNum(b.to_user_id));
    if (b.do_kogo) recipients.push(...resolveDoKogo(state, b.do_kogo));
    const uniq = [...new Set(recipients.filter(Boolean))];
    const targets = uniq.length ? uniq : [1];
    for (const toUid of targets) {
      const id = state.nextNotificationId++;
      const row = {
        id,
        typ,
        tresc,
        task_id: taskId,
        status: 'Nowe',
        od_user_id: req.user.id,
        to_user_id: toUid,
        created_at: now,
      };
      state.notifications.push(row);
      ids.push(row);
    }
  });
  res.status(201).json(ids.length === 1 ? ids[0] : ids);
});

router.put('/notifications/:id/odczytaj', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const uid = req.user.id;
  const row = withStore((state) => {
    const n = (state.notifications || []).find((x) => x.id === id);
    if (!n || (n.to_user_id !== uid && n.to_user_id != null)) return null;
    n.status = 'Odczytane';
    return n;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/notifications/odczytaj-wszystkie', requireAuth, (req, res) => {
  const uid = req.user.id;
  withStore((state) => {
    for (const n of state.notifications || []) {
      if (n.to_user_id === uid || n.to_user_id == null) n.status = 'Odczytane';
    }
  });
  res.json({ ok: true });
});

router.delete('/notifications/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const uid = req.user.id;
  withStore((state) => {
    const arr = state.notifications || [];
    const idx = arr.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const n = arr[idx];
    if (n.to_user_id != null && n.to_user_id !== uid) return;
    arr.splice(idx, 1);
  });
  res.json({ ok: true });
});

router.get('/ekipy', requireAuth, (req, res) => {
  const branchId = toNum(req.query.oddzial_id);
  const includeDelegacje = ['1', 'true', true].includes(req.query.include_delegacje);
  const day = resourceDate(req.query.date);
  const ekipy = readOnly((state) => {
    const scopedBranch = branchId || (!canSeeAllZlecenia(req.user) ? req.user.oddzial_id : null);
    if (scopedBranch) {
      const rows = includeDelegacje
        ? buildBranchResources(state, scopedBranch, day).ekipy
        : (state.teams || [])
          .filter((team) => Number(team.oddzial_id) === Number(scopedBranch))
          .map((team) => enrichTeamForBranch(state, team, scopedBranch, day));
      return rows;
    }
    return (state.teams || []).map((team) => enrichTeamForBranch(state, team, null, day));
  });
  res.json(ekipy);
});

router.get('/ekipy/live-locations', requireAuth, (_req, res) => {
  res.json({ items: [] });
});

router.get('/oddzialy', requireAuth, (_req, res) => {
  const oddzialy = readOnly((state) => state.oddzialy || []);
  res.json(oddzialy);
});

router.get('/oddzialy/:id(\\d+)/zasoby', requireAuth, (req, res) => {
  const branchId = toNum(req.params.id);
  const day = resourceDate(req.query.date);
  if (!branchId) return res.status(400).json({ error: 'Nieprawidlowy oddzial' });
  if (!canSeeAllZlecenia(req.user) && String(req.user.oddzial_id) !== String(branchId)) {
    return res.status(403).json({ error: 'Brak uprawnien do zasobow tego oddzialu' });
  }
  const payload = readOnly((state) => buildBranchResources(state, branchId, day));
  res.json(payload);
});

router.get('/oddzialy/cele', requireAuth, (req, res) => {
  const rok = toInt(req.query.rok);
  const miesiac = toInt(req.query.miesiac);
  const cele = readOnly((state) => {
    let rows = state.oddzialCeleMiesieczne || [];
    if (rok) rows = rows.filter((x) => Number(x.rok) === rok);
    if (miesiac) rows = rows.filter((x) => Number(x.miesiac) === miesiac);
    if (!canSeeAllBranches(req.user)) {
      rows = rows.filter((x) => String(x.oddzial_id) === String(req.user.oddzial_id));
    }
    return rows;
  });
  res.json(cele);
});

router.post('/oddzialy/cele', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const rok = toInt(b.rok);
  const miesiac = toInt(b.miesiac);
  if (!oddzialId || !rok || !miesiac || miesiac < 1 || miesiac > 12) {
    return res.status(400).json({ error: 'Nieprawidłowe dane celu oddziału' });
  }
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }

  const row = withStore((state) => {
    if (!state.oddzialCeleMiesieczne) state.oddzialCeleMiesieczne = [];
    if (!state.nextOddzialCeleMiesieczneId) state.nextOddzialCeleMiesieczneId = 1;

    const plan_zlecen = toNum(b.plan_zlecen) ?? 0;
    const plan_obrotu = toNum(b.plan_obrotu) ?? 0;
    const plan_marzy = toNum(b.plan_marzy) ?? 0;
    const now = new Date().toISOString();

    const existing = state.oddzialCeleMiesieczne.find(
      (x) => Number(x.oddzial_id) === oddzialId && Number(x.rok) === rok && Number(x.miesiac) === miesiac
    );
    if (existing) {
      existing.plan_zlecen = plan_zlecen;
      existing.plan_obrotu = plan_obrotu;
      existing.plan_marzy = plan_marzy;
      existing.updated_at = now;
      existing.updated_by = req.user.id;
      return existing;
    }

    const created = {
      id: state.nextOddzialCeleMiesieczneId++,
      oddzial_id: oddzialId,
      rok,
      miesiac,
      plan_zlecen,
      plan_obrotu,
      plan_marzy,
      created_at: now,
      created_by: req.user.id,
      updated_at: now,
      updated_by: req.user.id,
    };
    state.oddzialCeleMiesieczne.push(created);
    return created;
  });

  res.status(201).json(row);
});

router.get('/oddzialy/sprzedaz', requireAuth, (req, res) => {
  const rok = toInt(req.query.rok);
  const miesiac = toInt(req.query.miesiac);
  const rows = readOnly((state) => {
    let list = state.oddzialSprzedazMiesieczna || [];
    if (rok) list = list.filter((x) => Number(x.rok) === rok);
    if (miesiac) list = list.filter((x) => Number(x.miesiac) === miesiac);
    if (!canSeeAllBranches(req.user)) {
      list = list.filter((x) => String(x.oddzial_id) === String(req.user.oddzial_id));
    }
    return list;
  });
  res.json(rows);
});

router.post('/oddzialy/sprzedaz', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const rok = toInt(b.rok);
  const miesiac = toInt(b.miesiac);
  if (!oddzialId || !rok || !miesiac || miesiac < 1 || miesiac > 12) {
    return res.status(400).json({ error: 'Nieprawidłowe dane sprzedaży oddziału' });
  }
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }

  const row = withStore((state) => {
    if (!state.oddzialSprzedazMiesieczna) state.oddzialSprzedazMiesieczna = [];
    if (!state.nextOddzialSprzedazMiesiecznaId) state.nextOddzialSprzedazMiesiecznaId = 1;

    const calls_total = toNum(b.calls_total) ?? 0;
    const calls_answered = toNum(b.calls_answered) ?? 0;
    const calls_missed = toNum(b.calls_missed) ?? 0;
    const leads_new = toNum(b.leads_new) ?? 0;
    const meetings_booked = toNum(b.meetings_booked) ?? 0;
    const now = new Date().toISOString();

    const existing = state.oddzialSprzedazMiesieczna.find(
      (x) => Number(x.oddzial_id) === oddzialId && Number(x.rok) === rok && Number(x.miesiac) === miesiac
    );
    if (existing) {
      existing.calls_total = calls_total;
      existing.calls_answered = calls_answered;
      existing.calls_missed = calls_missed;
      existing.leads_new = leads_new;
      existing.meetings_booked = meetings_booked;
      existing.updated_at = now;
      existing.updated_by = req.user.id;
      return existing;
    }

    const created = {
      id: state.nextOddzialSprzedazMiesiecznaId++,
      oddzial_id: oddzialId,
      rok,
      miesiac,
      calls_total,
      calls_answered,
      calls_missed,
      leads_new,
      meetings_booked,
      created_at: now,
      created_by: req.user.id,
      updated_at: now,
      updated_by: req.user.id,
    };
    state.oddzialSprzedazMiesieczna.push(created);
    return created;
  });

  res.status(201).json(row);
});

function taskStageLabel(status) {
  return workflowTaskStageLabel(status);
}

const CRM_LEAD_STAGES = ['Lead', 'Oględziny', 'Do zatwierdzenia', 'Plan ekipy', 'W realizacji', 'Wygrane', 'Przegrane'];

function normalizeCrmStage(stage) {
  const value = String(stage || '').trim();
  return CRM_LEAD_STAGES.includes(value) ? value : 'Lead';
}

function normalizeForCompare(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeCrmCloseReason(reason) {
  const value = normalizeForCompare(reason);
  if (!value) return '';
  return CRM_CLOSE_REASONS.find((item) => normalizeForCompare(item) === value) || '';
}

function isCrmClosedStage(stage) {
  return ['Przegrane', 'Techniczny'].includes(normalizeCrmStage(stage));
}

function isTechnicalCloseReason(reason) {
  return CRM_TECHNICAL_CLOSE_REASONS.has(normalizeCrmCloseReason(reason));
}

function crmCloseStageForReason(reason) {
  return isTechnicalCloseReason(reason) ? 'Techniczny' : 'Przegrane';
}

function mapCrmLead(row, state) {
  const client = (state.klienci || []).find((k) => Number(k.id) === Number(row.client_id));
  const owner = (state.users || []).find((u) => Number(u.id) === Number(row.owner_user_id));
  return {
    ...row,
    stage: normalizeCrmStage(row.stage),
    close_reason: row.close_reason || null,
    close_bucket: row.close_bucket || (normalizeCrmStage(row.stage) === 'Techniczny' ? 'technical' : null),
    closed_at: row.closed_at || null,
    closed_by: row.closed_by || null,
    owner_name: owner ? `${owner.imie || ''} ${owner.nazwisko || ''}`.trim() || owner.login || `#${owner.id}` : null,
    client_name: client?.nazwa || null,
  };
}

/** Statyczna ścieżka przed `/crm/leads/:id*`, żeby nic nie „zjadło” segmentu `overview`. */
router.get('/crm/overview', requireAuth, (req, res) => {
  const oddzialId = canSeeAllBranches(req.user) ? toInt(req.query.oddzial_id) : toInt(req.user.oddzial_id);
  const now = new Date();
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);

  const data = readOnly((state) => {
    const clientsAll = (state.klienci || []).filter((k) => !oddzialId || Number(k.oddzial_id) === oddzialId);
    const tasksAll = (state.zlecenia || [])
      .filter((z) => z.typ !== 'wycena')
      .filter((z) => !oddzialId || Number(z.oddzial_id) === oddzialId);
    const leadsAll = (state.crmLeads || [])
      .filter((l) => !oddzialId || Number(l.oddzial_id) === oddzialId)
      .map((l) => mapCrmLead(l, state));
    const callsAll = (state.callLogs || []).filter((c) => !oddzialId || Number(c.oddzial_id) === oddzialId);
    const callbacksAll = (state.callbackTasks || []).filter((c) => !oddzialId || Number(c.oddzial_id) === oddzialId);

    const clientsNew30 = clientsAll.filter((k) => new Date(k.created_at || 0) >= d30).length;
    const calls30 = callsAll.filter((c) => new Date(c.created_at || 0) >= d30).length;
    const won30 = tasksAll.filter((t) => isTaskDone(t.status) && new Date(t.updated_at || t.created_at || 0) >= d30).length;

    const pipelineMap = new Map();
    if (leadsAll.length > 0) {
      for (const lead of leadsAll) {
        const stageName = normalizeCrmStage(lead.stage);
        const prev = pipelineMap.get(stageName) || { stage: stageName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(lead.value || 0);
        pipelineMap.set(stageName, prev);
      }
    } else {
      for (const task of tasksAll) {
        const stageName = taskStageLabel(task.status);
        const prev = pipelineMap.get(stageName) || { stage: stageName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(task.wartosc_planowana || 0);
        pipelineMap.set(stageName, prev);
      }
    }
    const pipeline = CRM_PIPELINE_ORDER
      .map((stage) => pipelineMap.get(stage) || { stage, count: 0, value: 0 })
      .filter((x) => x.count > 0 || x.stage !== 'Inne');

    const sourceMap = new Map();
    for (const client of clientsAll) {
      const src = String(client.zrodlo || 'inne');
      sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
    }
    const sources = Array.from(sourceMap.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    const callbacksOpen = callbacksAll.filter((c) => !['done', 'cancelled'].includes(String(c.status || '').toLowerCase()));
    const callbacksOverdue = callbacksOpen.filter((c) => c.due_at && new Date(c.due_at) < now).length;
    const callbacksUpcoming = callbacksOpen
      .sort((a, b) => new Date(a.due_at || a.created_at || 0) - new Date(b.due_at || b.created_at || 0))
      .slice(0, 12);

    return {
      kpis: {
        clients_total: clientsAll.length,
        clients_new_30d: clientsNew30,
        tasks_total: tasksAll.length,
        tasks_won_30d: won30,
        technical_leads: leadsAll.filter((lead) => normalizeCrmStage(lead.stage) === 'Techniczny' || lead.close_bucket === 'technical').length,
        qualified_leads_total: leadsAll.filter((lead) => normalizeCrmStage(lead.stage) !== 'Techniczny' && lead.close_bucket !== 'technical').length,
        calls_30d: calls30,
        callbacks_open: callbacksOpen.length,
        callbacks_overdue: callbacksOverdue,
      },
      pipeline,
      sources,
      callbacks: callbacksUpcoming,
    };
  });

  res.json(data);
});

router.get('/crm/leads', requireAuth, (req, res) => {
  const oddzialId = canSeeAllBranches(req.user) ? toInt(req.query.oddzial_id) : toInt(req.user.oddzial_id);
  const ownerId = toInt(req.query.owner_user_id);
  const q = String(req.query.q || '').trim().toLowerCase();
  const stage = String(req.query.stage || '').trim();

  const rows = readOnly((state) => {
    let list = (state.crmLeads || []).map((lead) => mapCrmLead(lead, state));
    if (oddzialId) list = list.filter((x) => Number(x.oddzial_id) === oddzialId);
    if (ownerId) list = list.filter((x) => Number(x.owner_user_id) === ownerId);
    if (stage) list = list.filter((x) => String(x.stage) === stage);
    if (q) {
      list = list.filter((x) =>
        [x.title, x.client_name, x.phone, x.email, x.source, x.notes].some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });
  });

  res.json(rows);
});

router.post('/crm/leads', requireAuth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const oddzialId = toInt(b.oddzial_id);
  if (!title || !oddzialId) {
    return res.status(400).json({ error: 'title i oddzial_id są wymagane' });
  }
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }
  const requestedStage = normalizeCrmStage(b.stage);
  const closeReason = normalizeCrmCloseReason(b.close_reason || b.closure_reason || b.closeReason);
  if (isCrmClosedStage(requestedStage) && !closeReason) {
    return res.status(400).json({ error: 'Powod zamkniecia leada jest wymagany' });
  }

  const row = withStore((state) => {
    if (!Array.isArray(state.crmLeads)) state.crmLeads = [];
    if (!state.nextCrmLeadId) state.nextCrmLeadId = 1;

    const now = new Date().toISOString();
    const created = {
      id: state.nextCrmLeadId++,
      title,
      oddzial_id: oddzialId,
      client_id: toInt(b.client_id) || null,
      owner_user_id: toInt(b.owner_user_id) || null,
      stage: isCrmClosedStage(requestedStage) ? crmCloseStageForReason(closeReason) : requestedStage,
      source: String(b.source || '').trim() || 'inne',
      value: toNum(b.value) ?? 0,
      phone: String(b.phone || '').trim() || null,
      email: String(b.email || '').trim() || null,
      notes: String(b.notes || '').trim() || null,
      tags: Array.isArray(b.tags) ? b.tags.slice(0, 16).map((x) => String(x || '').trim()).filter(Boolean) : [],
      next_action_at: b.next_action_at || null,
      close_reason: closeReason || null,
      close_bucket: closeReason ? (isTechnicalCloseReason(closeReason) ? 'technical' : 'lost') : null,
      closed_at: closeReason ? now : null,
      closed_by: closeReason ? req.user.id : null,
      created_by: req.user.id,
      created_at: now,
      updated_by: req.user.id,
      updated_at: now,
    };
    state.crmLeads.push(created);
    return mapCrmLead(created, state);
  });

  res.status(201).json(row);
});

router.patch('/crm/leads/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const b = req.body || {};

  const row = withStore((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === id);
    if (!lead) return null;
    if (!canAccessOddzial(req.user, lead.oddzial_id)) return { _forbidden: true };
    if (b.oddzial_id !== undefined && !canAccessOddzial(req.user, toInt(b.oddzial_id) || lead.oddzial_id)) {
      return { _forbidden: true };
    }

    if (b.title !== undefined) {
      const title = String(b.title || '').trim();
      if (!title) return '__bad_title__';
      lead.title = title;
    }
    const hasStagePatch = b.stage !== undefined;
    const hasCloseReasonPatch = b.close_reason !== undefined || b.closure_reason !== undefined || b.closeReason !== undefined;
    const nextStage = hasStagePatch ? normalizeCrmStage(b.stage) : normalizeCrmStage(lead.stage);
    const nextCloseReason = hasCloseReasonPatch
      ? normalizeCrmCloseReason(b.close_reason || b.closure_reason || b.closeReason)
      : normalizeCrmCloseReason(lead.close_reason);
    if (hasStagePatch && isCrmClosedStage(nextStage)) {
      if (!nextCloseReason) return '__missing_close_reason__';
      lead.stage = crmCloseStageForReason(nextCloseReason);
      lead.close_reason = nextCloseReason;
      lead.close_bucket = isTechnicalCloseReason(nextCloseReason) ? 'technical' : 'lost';
      lead.closed_at = lead.closed_at || new Date().toISOString();
      lead.closed_by = req.user.id;
    } else if (hasStagePatch) {
      lead.stage = nextStage;
      lead.close_reason = null;
      lead.close_bucket = null;
      lead.closed_at = null;
      lead.closed_by = null;
    } else if (hasCloseReasonPatch && isCrmClosedStage(lead.stage)) {
      if (!nextCloseReason) return '__missing_close_reason__';
      lead.stage = crmCloseStageForReason(nextCloseReason);
      lead.close_reason = nextCloseReason;
      lead.close_bucket = isTechnicalCloseReason(nextCloseReason) ? 'technical' : 'lost';
      lead.closed_at = lead.closed_at || new Date().toISOString();
      lead.closed_by = req.user.id;
    }
    if (b.oddzial_id !== undefined) lead.oddzial_id = toInt(b.oddzial_id) || lead.oddzial_id;
    if (b.client_id !== undefined) lead.client_id = toInt(b.client_id) || null;
    if (b.owner_user_id !== undefined) lead.owner_user_id = toInt(b.owner_user_id) || null;
    if (b.source !== undefined) lead.source = String(b.source || '').trim() || 'inne';
    if (b.value !== undefined) lead.value = toNum(b.value) ?? 0;
    if (b.phone !== undefined) lead.phone = String(b.phone || '').trim() || null;
    if (b.email !== undefined) lead.email = String(b.email || '').trim() || null;
    if (b.notes !== undefined) lead.notes = String(b.notes || '').trim() || null;
    if (b.next_action_at !== undefined) lead.next_action_at = b.next_action_at || null;
    if (b.tags !== undefined) {
      lead.tags = Array.isArray(b.tags) ? b.tags.slice(0, 16).map((x) => String(x || '').trim()).filter(Boolean) : [];
    }
    lead.updated_at = new Date().toISOString();
    lead.updated_by = req.user.id;
    return mapCrmLead(lead, state);
  });

  if (row === '__missing_close_reason__') return res.status(400).json({ error: 'Powod zamkniecia leada jest wymagany' });

  if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (row === '__bad_title__') return res.status(400).json({ error: 'title nie może być pusty' });
  if (!row) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json(row);
});

router.delete('/crm/leads/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id leada' });

  const deleted = withStore((state) => {
    if (!Array.isArray(state.crmLeads)) return false;
    const idx = state.crmLeads.findIndex((x) => Number(x.id) === id);
    if (idx < 0) return false;
    if (!canAccessOddzial(req.user, state.crmLeads[idx].oddzial_id)) return 'forbidden';
    state.crmLeads.splice(idx, 1);
    if (Array.isArray(state.crmLeadActivities)) {
      state.crmLeadActivities = state.crmLeadActivities.filter((a) => Number(a.lead_id) !== id);
    }
    return true;
  });

  if (deleted === 'forbidden') return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (!deleted) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json({ ok: true });
});

const CRM_ACTIVITY_TYPES = ['note', 'call', 'task'];

function normalizeCrmActivityType(t) {
  const v = String(t || '').trim();
  return CRM_ACTIVITY_TYPES.includes(v) ? v : 'note';
}

function mapCrmLeadActivity(a, state) {
  const author = (state.users || []).find((u) => Number(u.id) === Number(a.created_by));
  return {
    ...a,
    author_name: author ? `${author.imie || ''} ${author.nazwisko || ''}`.trim() || author.login : null,
  };
}

/** Historia: notatki, telefony, zadania/follow-up przypięte do leada w pipeline CRM. */
router.get('/crm/leads/:id/activities', requireAuth, (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const rows = readOnly((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === leadId);
    if (!lead) return null;
    if (!canAccessOddzial(req.user, lead.oddzial_id)) return 'forbidden';
    const list = (state.crmLeadActivities || [])
      .filter((a) => Number(a.lead_id) === leadId)
      .map((a) => mapCrmLeadActivity(a, state));
    return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  });
  if (rows === 'forbidden') return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (rows === null) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json(rows);
});

router.post('/crm/leads/:id/activities', requireAuth, (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const b = req.body || {};
  const type = normalizeCrmActivityType(b.type);
  const text = String(b.text || b.tresc || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Pole text (tresc) jest wymagane' });
  }
  if (type === 'call' && b.call_duration_sec != null) {
    const d = toNum(b.call_duration_sec);
    if (d != null && d < 0) return res.status(400).json({ error: 'Nieprawidłowy call_duration_sec' });
  }

  const row = withStore((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === leadId);
    if (!lead) return null;
    if (!canAccessOddzial(req.user, lead.oddzial_id)) return { _forbidden: true };
    if (!Array.isArray(state.crmLeadActivities)) state.crmLeadActivities = [];
    if (!state.nextCrmLeadActivityId) state.nextCrmLeadActivityId = 1;
    const now = new Date().toISOString();
    const act = {
      id: state.nextCrmLeadActivityId++,
      lead_id: leadId,
      type,
      text,
      due_at: type === 'task' ? (b.due_at ? String(b.due_at) : null) : null,
      call_duration_sec: type === 'call' && b.call_duration_sec != null ? toNum(b.call_duration_sec) : null,
      completed_at: null,
      created_by: req.user.id,
      created_at: now,
    };
    state.crmLeadActivities.push(act);
    lead.updated_at = now;
    lead.updated_by = req.user.id;
    return mapCrmLeadActivity(act, state);
  });

  if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (!row) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.status(201).json(row);
});

router.patch('/crm/leads/:leadId/activities/:activityId', requireAuth, (req, res) => {
  const leadId = toInt(req.params.leadId);
  const activityId = toInt(req.params.activityId);
  if (!leadId || !activityId) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const completed = req.body && (req.body.completed === true || req.body.done === true);

  const row = withStore((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === leadId);
    if (!lead) return null;
    if (!canAccessOddzial(req.user, lead.oddzial_id)) return { _forbidden: true };
    const act = (state.crmLeadActivities || []).find(
      (a) => Number(a.id) === activityId && Number(a.lead_id) === leadId
    );
    if (!act) return '__nf__';
    if (completed && act.type === 'task' && !act.completed_at) {
      act.completed_at = new Date().toISOString();
    }
    lead.updated_at = new Date().toISOString();
    lead.updated_by = req.user.id;
    return mapCrmLeadActivity(act, state);
  });

  if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (row === '__nf__') return res.status(404).json({ error: 'Aktywność nie znaleziona' });
  if (!row) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json(row);
});

router.get('/telephony/calls', requireAuth, (req, res) => {
  const rok = toInt(req.query.rok);
  const miesiac = toInt(req.query.miesiac);
  const oddzialId = canSeeAllBranches(req.user) ? toInt(req.query.oddzial_id) : toInt(req.user.oddzial_id);
  const rows = readOnly((state) => {
    let list = state.callLogs || [];
    if (oddzialId) list = list.filter((x) => Number(x.oddzial_id) === oddzialId);
    if (rok || miesiac) {
      list = list.filter((x) => {
        const dt = new Date(x.created_at || x.call_time || Date.now());
        if (rok && dt.getFullYear() !== rok) return false;
        if (miesiac && dt.getMonth() + 1 !== miesiac) return false;
        return true;
      });
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  });
  res.json(rows);
});

router.post('/telephony/calls', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const status = String(b.status || '').trim() || 'missed';
  const callType = String(b.call_type || '').trim() || 'outbound';
  const phone = String(b.phone || '').trim();
  if (!oddzialId || !phone) {
    return res.status(400).json({ error: 'oddzial_id i phone są wymagane' });
  }
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }
  const row = withStore((state) => {
    if (!state.callLogs) state.callLogs = [];
    if (!state.nextCallLogId) state.nextCallLogId = 1;
    const taskId = toInt(b.task_id);
    const created = {
      id: state.nextCallLogId++,
      oddzial_id: oddzialId,
      phone,
      call_type: callType,
      status,
      duration_sec: toNum(b.duration_sec) ?? 0,
      task_id: taskId || null,
      lead_name: b.lead_name || null,
      notes: b.notes || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };
    state.callLogs.push(created);
    return created;
  });
  res.status(201).json(row);
});

router.get('/telephony/callbacks', requireAuth, (req, res) => {
  const oddzialId = canSeeAllBranches(req.user) ? toInt(req.query.oddzial_id) : toInt(req.user.oddzial_id);
  const status = String(req.query.status || '').trim();
  const rows = readOnly((state) => {
    let list = state.callbackTasks || [];
    if (oddzialId) list = list.filter((x) => Number(x.oddzial_id) === oddzialId);
    if (status) list = list.filter((x) => String(x.status) === status);
    return list.sort((a, b) => new Date(a.due_at || a.created_at) - new Date(b.due_at || b.created_at));
  });
  res.json(rows);
});

router.post('/telephony/callbacks', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const phone = String(b.phone || '').trim();
  if (!oddzialId || !phone) {
    return res.status(400).json({ error: 'oddzial_id i phone są wymagane' });
  }
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }
  const row = withStore((state) => {
    if (!state.callbackTasks) state.callbackTasks = [];
    if (!state.nextCallbackTaskId) state.nextCallbackTaskId = 1;
    const zlecTaskId = toInt(b.task_id);
    const created = {
      id: state.nextCallbackTaskId++,
      oddzial_id: oddzialId,
      phone,
      task_id: zlecTaskId || null,
      lead_name: b.lead_name || null,
      priority: String(b.priority || 'normal'),
      due_at: b.due_at || null,
      status: 'open',
      notes: b.notes || null,
      assigned_user_id: toInt(b.assigned_user_id) || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      closed_at: null,
    };
    state.callbackTasks.push(created);
    return created;
  });
  res.status(201).json(row);
});

router.patch('/telephony/callbacks/:id/status', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!id || !status) return res.status(400).json({ error: 'id i status są wymagane' });
  const row = withStore((state) => {
    const task = (state.callbackTasks || []).find((x) => Number(x.id) === id);
    if (!task) return null;
    if (!canAccessOddzial(req.user, task.oddzial_id)) return { _forbidden: true };
    task.status = status;
    task.updated_by = req.user.id;
    task.updated_at = new Date().toISOString();
    if (status === 'done' || status === 'cancelled') task.closed_at = new Date().toISOString();
    return task;
  });
  if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  if (!row) return res.status(404).json({ error: 'Callback nie znaleziony' });
  res.json(row);
});

router.get('/ogledziny', requireAuth, (req, res) => {
  const { status } = req.query;
  const list = readOnly((state) => {
    let o = state.ogledziny || [];
    if (status) o = o.filter((x) => x.status === status);
    return o.map((row) => withOgledzinyLive(state, row));
  });
  res.json(list);
});

router.get('/ogledziny/field-events/today', requireAuth, (req, res) => {
  const day = String(req.query.date || new Date().toISOString().slice(0, 10));
  const items = readOnly((state) =>
    (state.ogledzinyFieldEvents || [])
      .filter((event) => String(event.recorded_at || '').slice(0, 10) === day)
      .sort((a, b) => new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime())
      .slice(0, 300)
      .map((event) => {
        const o = (state.ogledziny || []).find((row) => Number(row.id) === Number(event.ogledziny_id)) || {};
        return {
          ...event,
          data_planowana: o.data_planowana || null,
          adres: o.adres || '',
          miasto: o.miasto || '',
          klient_nazwa: o.klient_nazwa || null,
          klient_telefon: o.klient_telefon || null,
          user_nazwa: userName(state, event.user_id),
        };
      })
  );
  res.json({ date: day, items });
});

router.get('/ogledziny/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const o = (state.ogledziny || []).find((x) => x.id === id);
    if (!o) return null;
    const media = (state.ogledzinyMedia || [])
      .filter((m) => m.ogledziny_id === id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return withOgledzinyLive(state, {
      ...o,
      created_by_nazwa: userName(state, o.created_by),
      zdjecia: [],
      media,
    });
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/ogledziny/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const body = req.body || {};
  const row = withStore((state) => {
    const o = (state.ogledziny || []).find((x) => x.id === id);
    if (!o) return null;
    const assignString = (key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        o[key] = body[key] == null ? null : String(body[key]);
      }
    };
    if (Object.prototype.hasOwnProperty.call(body, 'brygadzista_id')) o.brygadzista_id = toNum(body.brygadzista_id);
    assignString('data_planowana');
    assignString('adres');
    assignString('miasto');
    assignString('notatki');
    assignString('notatki_wyniki');
    if (body.status) o.status = String(body.status);
    o.updated_at = new Date().toISOString();
    return { ...o, created_by_nazwa: userName(state, o.created_by) };
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/ogledziny/:id/status', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const { status, notatki_wyniki } = req.body || {};
  const row = withStore((state) => {
    const o = (state.ogledziny || []).find((x) => x.id === id);
    if (!o) return null;
    if (status) o.status = status;
    if (notatki_wyniki != null) o.notatki_wyniki = notatki_wyniki;
    return { ...o, created_by_nazwa: userName(state, o.created_by) };
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.post('/ogledziny/:id/field-event', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  const eventType = String(b.event_type || '').trim();
  if (!id || !['start', 'delay', 'done', 'heartbeat', 'note'].includes(eventType)) {
    return res.status(400).json({ error: 'Nieprawidlowe zdarzenie terenowe' });
  }
  const created = withStore((state) => {
    const o = (state.ogledziny || []).find((x) => Number(x.id) === id);
    if (!o) return null;
    if (!state.ogledzinyFieldEvents) state.ogledzinyFieldEvents = [];
    if (!state.nextOgledzinyFieldEventId) state.nextOgledzinyFieldEventId = 1;
    const event = {
      id: state.nextOgledzinyFieldEventId++,
      ogledziny_id: id,
      user_id: req.user.id,
      event_type: eventType,
      lat: toNum(b.lat),
      lng: toNum(b.lng),
      eta_min: toNum(b.eta_min),
      note: b.note ? String(b.note).slice(0, 2000) : null,
      recorded_at: new Date().toISOString(),
    };
    state.ogledzinyFieldEvents.push(event);
    if (eventType === 'start' && o.status !== 'Zakonczone') o.status = 'W_Trakcie';
    if (eventType === 'done') o.status = 'Zakonczone';
    if (eventType === 'delay' && event.note) {
      o.notatki_wyniki = [o.notatki_wyniki || '', `Opoznienie: ${event.note}`].filter(Boolean).join('\n');
    }
    return event;
  });
  if (!created) return res.status(404).json({ error: 'Nie znaleziono' });
  res.status(201).json(created);
});

router.post('/ogledziny/:id/media', requireAuth, upOgledzinyMedia.any(), (req, res) => {
  try {
    const id = toNum(req.params.id);
    const file = Array.isArray(req.files) ? req.files[0] : req.file;
    if (!id || !file) return res.status(400).json({ error: 'Brak pliku (pole: media / zdjecie / wideo) lub id' });

    const created = withStore((state) => {
      const o = (state.ogledziny || []).find((x) => x.id === id);
      if (!o) return null;
      if (!state.ogledzinyMedia) state.ogledzinyMedia = [];
      if (!state.nextOgledzinyMediaId) state.nextOgledzinyMediaId = 1;
      const mid = state.nextOgledzinyMediaId++;
      const mime = file.mimetype || 'application/octet-stream';
      const requestedKind = String(req.body?.kind || req.body?.typ || '').toLowerCase();
      const kind = requestedKind === 'photo' || requestedKind === 'image'
        ? 'photo'
        : requestedKind === 'video'
          ? 'video'
          : mime.startsWith('image/')
            ? 'photo'
            : 'video';
      const url = `/api/uploads/ogledziny/${file.filename}`;
      const rec = {
        id: mid,
        ogledziny_id: id,
        url,
        mime,
        kind,
        created_at: new Date().toISOString(),
      };
      state.ogledzinyMedia.push(rec);
      return rec;
    });

    if (!created) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      return res.status(404).json({ error: 'Nie znaleziono oględzin' });
    }
    res.status(201).json(created);
  } catch (e) {
    const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
    for (const file of files) {
      try {
        if (file?.path) fs.unlinkSync(file.path);
      } catch {
        /* ignore */
      }
    }
    res.status(500).json({ error: e.message });
  }
});

router.delete('/ogledziny/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  withStore((state) => {
    state.ogledziny = (state.ogledziny || []).filter((x) => x.id !== id);
    state.ogledzinyMedia = (state.ogledzinyMedia || []).filter((m) => m.ogledziny_id !== id);
  });
  res.json({ ok: true });
});

router.post('/ogledziny', requireAuth, (req, res) => {
  const b = req.body || {};
  const row = withStore((state) => {
    if (!state.ogledziny) state.ogledziny = [];
    const id = state.nextOgledzinyId++;
    const o = {
      id,
      klient_id: Number(b.klient_id),
      brygadzista_id: b.brygadzista_id ? Number(b.brygadzista_id) : null,
      data_planowana: b.data_planowana || null,
      adres: b.adres || '',
      miasto: b.miasto || '',
      notatki: b.notatki || '',
      status: 'Zaplanowane',
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };
    state.ogledziny.push(o);
    return o;
  });
  res.status(201).json(row);
});

router.get('/klienci', requireAuth, (_req, res) => {
  const klienci = readOnly((state) => state.klienci || []);
  res.json(klienci);
});

router.get('/klienci/:id(\\d+)/kommo-payload', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => (state.klienci || []).find((k) => k.id === id));
  if (!row) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  const payload = buildKommoKlientPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  return res.json(payload);
});

router.post('/klienci/:id(\\d+)/kommo-push', requireAuth, async (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => (state.klienci || []).find((k) => k.id === id));
  if (!row) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  if (!kommoWebhookConfigured('crm')) {
    return res.status(400).json({
      error:
        'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
    });
  }
  const payload = buildKommoKlientPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  const markSync = (next) =>
    withStore((state) => {
      const k = (state.klienci || []).find((x) => x.id === id);
      if (!k) return null;
      k.kommo_last_sync_at = new Date().toISOString();
      k.kommo_last_sync_status = next.status || null;
      k.kommo_last_sync_http = next.http ?? null;
      k.kommo_last_sync_error = next.error || null;
      return k;
    });
  try {
    const { response, bodyText } = await postKommoWebhook(payload, 'crm');
    if (!response.ok) {
      markSync({
        status: 'error',
        http: response.status,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      });
      return res.status(502).json({
        ok: false,
        status: 'error',
        http_status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    markSync({ status: 'ok', http: response.status, error: null });
    return res.json({ ok: true, status: 'ok', http_status: response.status });
  } catch (err) {
    markSync({ status: 'error', http: null, error: err.message || 'network error' });
    return res.status(502).json({
      ok: false,
      status: 'error',
      error: err.message || 'Nie udało się wysłać danych do Kommo',
    });
  }
});

// ── CMR (listy przewozowe) ───────────────────────────────────────────────────
router.get('/cmr', requireAuth, (req, res) => {
  try {
    const taskFilter = toNum(req.query.task_id);
    const list = readOnly((state) => {
      const rows = state.cmrLists || [];
      return rows
        .filter((c) => canViewCmr(state, req.user, c))
        .filter((c) => taskFilter == null || c.task_id === taskFilter)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((c) => enrichCmr(state, c));
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/cmr/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    return enrichCmr(state, c);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.post('/cmr', requireAuth, (req, res) => {
  const b = req.body || {};
  try {
    const row = withStore((state) => {
      if (!state.cmrLists) state.cmrLists = [];
      const task_id = b.task_id != null ? Number(b.task_id) : null;
      if (task_id) {
        if (!canUserViewZlecenie(state, req.user, task_id)) return { _err: 403 };
      }
      const id = state.nextCmrId++;
      const year = new Date().getFullYear();
      const numer = `CMR/PL/${year}/${String(id).padStart(6, '0')}`;
      const c = {
        id,
        numer,
        oddzial_id: null,
        task_id: task_id || null,
        vehicle_id: toNum(b.vehicle_id),
        status: (b.status && String(b.status).trim()) || 'Roboczy',
        nadawca_nazwa: b.nadawca_nazwa ?? null,
        nadawca_adres: b.nadawca_adres ?? null,
        nadawca_kraj: b.nadawca_kraj || 'PL',
        odbiorca_nazwa: b.odbiorca_nazwa ?? null,
        odbiorca_adres: b.odbiorca_adres ?? null,
        odbiorca_kraj: b.odbiorca_kraj || 'PL',
        miejsce_zaladunku: b.miejsce_zaladunku ?? null,
        miejsce_rozladunku: b.miejsce_rozladunku ?? null,
        data_zaladunku: b.data_zaladunku || null,
        data_rozladunku: b.data_rozladunku || null,
        przewoznik_nazwa: b.przewoznik_nazwa ?? null,
        przewoznik_adres: b.przewoznik_adres ?? null,
        przewoznik_kraj: b.przewoznik_kraj ?? null,
        kolejni_przewoznicy: b.kolejni_przewoznicy ?? null,
        nr_rejestracyjny: b.nr_rejestracyjny ?? null,
        nr_naczepy: b.nr_naczepy ?? null,
        kierowca: b.kierowca ?? null,
        instrukcje_nadawcy: b.instrukcje_nadawcy ?? null,
        uwagi_do_celnych: b.uwagi_do_celnych ?? null,
        umowy_szczegolne: b.umowy_szczegolne ?? null,
        zalaczniki: b.zalaczniki ?? null,
        towary: Array.isArray(b.towary) ? b.towary : [],
        platnosci: b.platnosci && typeof b.platnosci === 'object' ? b.platnosci : {},
        kommo_last_sync_at: null,
        kommo_last_sync_status: null,
        kommo_last_sync_http: null,
        kommo_last_sync_error: null,
        created_by: req.user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.cmrLists.push(c);
      return { ok: true, c };
    });
    if (row._err === 403) return res.status(403).json({ error: 'Brak dostępu' });
    res.status(201).json(enrichCmr(readOnly((s) => s), row.c));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/cmr/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  const row = withStore((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    const keys = [
      'task_id',
      'vehicle_id',
      'status',
      'nadawca_nazwa',
      'nadawca_adres',
      'nadawca_kraj',
      'odbiorca_nazwa',
      'odbiorca_adres',
      'odbiorca_kraj',
      'miejsce_zaladunku',
      'miejsce_rozladunku',
      'data_zaladunku',
      'data_rozladunku',
      'przewoznik_nazwa',
      'przewoznik_adres',
      'przewoznik_kraj',
      'kolejni_przewoznicy',
      'nr_rejestracyjny',
      'nr_naczepy',
      'kierowca',
      'instrukcje_nadawcy',
      'uwagi_do_celnych',
      'umowy_szczegolne',
      'zalaczniki',
    ];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        if (k === 'task_id' || k === 'vehicle_id') c[k] = toNum(b[k]);
        else c[k] = b[k];
      }
    }
    c.oddzial_id = null;
    if (Object.prototype.hasOwnProperty.call(b, 'towary')) c.towary = Array.isArray(b.towary) ? b.towary : [];
    if (Object.prototype.hasOwnProperty.call(b, 'platnosci') && b.platnosci && typeof b.platnosci === 'object') {
      c.platnosci = b.platnosci;
    }
    c.updated_at = new Date().toISOString();
    return c;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(enrichCmr(readOnly((s) => s), row));
});

function toCompactText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function toIsoDateStart(dateLike) {
  const d = toCompactText(dateLike);
  if (!d) return null;
  const v = `${d}T00:00:00.000Z`;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function customField(fieldId, value) {
  if (!fieldId || value === null || value === undefined || value === '') return null;
  return {
    field_id: fieldId,
    values: [{ value }],
  };
}

function buildKommoCmrPayload(row, actor = null) {
  const towary = Array.isArray(row?.towary) ? row.towary : [];
  const towaryCompact = towary
    .map((x) => ({
      nazwa: toCompactText(x?.nazwa) || toCompactText(x?.znak),
      ilosc: toCompactText(x?.ilosc),
      opakowanie: toCompactText(x?.opakowanie),
      masa_kg: toCompactText(x?.masa_kg),
      objetosc_m3: toCompactText(x?.objetosc_m3),
    }))
    .filter((x) => x.nazwa || x.ilosc || x.opakowanie || x.masa_kg || x.objetosc_m3);
  const goodsSummary = towaryCompact
    .map((x) => {
      const bits = [x.nazwa, x.ilosc ? `x${x.ilosc}` : null, x.masa_kg ? `${x.masa_kg}kg` : null].filter(Boolean);
      return bits.join(' ');
    })
    .filter(Boolean)
    .join('; ');
  const nrRejestracyjny = toCompactText(row.nr_rejestracyjny || row.pojazd_nr_rejestracyjny);
  const client = toCompactText(row.task_klient_nazwa);
  const leadName = ['CMR', toCompactText(row.numer), client].filter(Boolean).join(' · ');
  const customFields = [
    customField(KOMMO_CF_CMR_NUMBER_ID, toCompactText(row.numer)),
    customField(KOMMO_CF_ORDER_ID, row.task_id ?? null),
    customField(KOMMO_CF_BRANCH_ID, row.task_oddzial_id ?? null),
    customField(KOMMO_CF_PLATE_ID, nrRejestracyjny),
    customField(KOMMO_CF_DRIVER_ID, toCompactText(row.kierowca)),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.status)),
    customField(KOMMO_CF_LOAD_DATE_ID, toIsoDateStart(row.data_zaladunku)),
    customField(KOMMO_CF_UNLOAD_DATE_ID, toIsoDateStart(row.data_rozladunku)),
    customField(KOMMO_CF_GOODS_SUMMARY_ID, goodsSummary || null),
  ].filter(Boolean);
  const tags = KOMMO_TAGS.map((name) => ({ name }));

  return {
    source: 'arbor-web-local',
    event: 'cmr.sync',
    sent_at: new Date().toISOString(),
    integration: {
      provider: 'kommo',
      version: '1',
    },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName || `CMR ${row.id}`,
        external_id: `cmr:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    cmr: {
      id: row.id,
      numer: row.numer,
      status: row.status,
      task_id: row.task_id ?? null,
      task_oddzial_id: row.task_oddzial_id ?? null,
      client,
      nadawca: {
        nazwa: toCompactText(row.nadawca_nazwa),
        adres: toCompactText(row.nadawca_adres),
        kraj: toCompactText(row.nadawca_kraj),
      },
      odbiorca: {
        nazwa: toCompactText(row.odbiorca_nazwa),
        adres: toCompactText(row.odbiorca_adres),
        kraj: toCompactText(row.odbiorca_kraj),
      },
      transport: {
        miejsce_zaladunku: toCompactText(row.miejsce_zaladunku),
        miejsce_rozladunku: toCompactText(row.miejsce_rozladunku),
        data_zaladunku: toCompactText(row.data_zaladunku),
        data_rozladunku: toCompactText(row.data_rozladunku),
        przewoznik_nazwa: toCompactText(row.przewoznik_nazwa),
        przewoznik_adres: toCompactText(row.przewoznik_adres),
        kierowca: toCompactText(row.kierowca),
        nr_rejestracyjny: nrRejestracyjny,
        nr_naczepy: toCompactText(row.nr_naczepy),
      },
      towary: towaryCompact,
      goods_summary: goodsSummary || null,
      uwagi: {
        instrukcje_nadawcy: toCompactText(row.instrukcje_nadawcy),
        uwagi_do_celnych: toCompactText(row.uwagi_do_celnych),
        umowy_szczegolne: toCompactText(row.umowy_szczegolne),
        zalaczniki: toCompactText(row.zalaczniki),
      },
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

router.get('/cmr/:id/kommo-payload', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    return enrichCmr(state, c);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono CMR' });

  const payload = buildKommoCmrPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  return res.json(payload);
});

router.post('/cmr/:id/kommo-push', requireAuth, async (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    return enrichCmr(state, c);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono CMR' });
  if (!KOMMO_WEBHOOK_URL) {
    return res.status(400).json({
      error: 'Brak konfiguracji Kommo. Ustaw zmienną środowiskową KOMMO_WEBHOOK_URL.',
    });
  }

  const payload = buildKommoCmrPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });

  const markSync = (next) =>
    withStore((state) => {
      const c = (state.cmrLists || []).find((x) => x.id === id);
      if (!c) return null;
      c.kommo_last_sync_at = new Date().toISOString();
      c.kommo_last_sync_status = next.status || null;
      c.kommo_last_sync_http = next.http ?? null;
      c.kommo_last_sync_error = next.error || null;
      c.updated_at = new Date().toISOString();
      return c;
    });

  try {
    const { response, bodyText } = await postKommoWebhook(payload, 'cmr');
    if (!response.ok) {
      markSync({
        status: 'error',
        http: response.status,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      });
      return res.status(502).json({
        ok: false,
        status: 'error',
        http_status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    markSync({ status: 'ok', http: response.status, error: null });
    return res.json({ ok: true, status: 'ok', http_status: response.status });
  } catch (err) {
    markSync({ status: 'error', http: null, error: err.message || 'network error' });
    return res.status(502).json({
      ok: false,
      status: 'error',
      error: err.message || 'Nie udało się wysłać danych do Kommo',
    });
  }
});

require('./fullStack')(router);

module.exports = router;
