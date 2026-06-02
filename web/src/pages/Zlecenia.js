import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import CityInput from '../components/CityInput';
import TelemetryStatus from '../components/TelemetryStatus';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import SmsOutlined from '@mui/icons-material/SmsOutlined';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { canSendTaskSms, canViewFinance, readPermissions } from '../utils/permissions';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { telHref } from '../utils/telLink';
import {
  TASK_PRIORITIES,
  TASK_EQUIPMENT_OPTIONS,
  TASK_RISK_PRESETS,
  TASK_SCOPE_PRESETS,
  TASK_SERVICE_TYPES,
  TASK_SETTLEMENT_OPTIONS,
  appendUniqueLine,
  buildTaskCreatePayload,
  createTaskFormDefaults,
  getTaskCreateMissingFields,
} from '../utils/taskForm';
import {
  CREW_REQUIRED_TASK_STATUSES,
  FIELD_EVIDENCE_REQUIRED_TASK_STATUSES,
  PRICE_REQUIRED_TASK_STATUSES,
  TASK_STATUS,
  TASK_STATUSES,
  canTransitionTaskStatus,
  getNextTaskStatuses,
  getTaskStatusColor,
  isTaskClosed,
  isTaskDone,
  isTaskInProgress,
  mergeTaskMutationResponse,
} from '../utils/taskWorkflow';

const PUSTY_FORMULARZ = createTaskFormDefaults();
const VIEW_MODE_KEY = 'zlecenia_view_mode';
const WORKFLOW_CONFIG_KEY = 'zlecenia_workflow_config';
const SMART_FILTER_KEY = 'zlecenia_smart_filter';
const TASK_SORT_KEY = 'zlecenia_sort_mode';
const CLIENT_CONTACT_KEY = 'zlecenia_client_contact_state';
const CLOSURE_DECISION_KEY = 'zlecenia_closure_decision_events';
const QUICK_CALL_DRAFT_KEY = 'zlecenia_quick_call_draft';
const ZLECENIA_TRYBY = new Set(['lista', 'kanban', 'nowy', 'edytuj', 'szczegoly']);
const SMART_FILTERS = [
  { key: 'myTurn', label: 'Moje teraz' },
  { key: 'overdue', label: 'Przeterminowane' },
  { key: 'unassigned', label: 'Bez ekipy' },
  { key: 'urgent', label: 'Pilne' },
  { key: 'today', label: 'Dzisiaj' },
  { key: 'noDate', label: 'Bez terminu' },
  { key: 'noContact', label: 'Bez kontaktu' },
  { key: 'noMedia', label: 'Bez zdjęć' },
  { key: 'noFieldSketch', label: 'Bez szkicu' },
  { key: 'noPrice', label: 'Bez wyceny' },
  { key: 'fieldInspection', label: 'U specjalisty ds. wyceny' },
  { key: 'officeApproval', label: 'Do zatwierdzenia' },
  { key: 'officePlanBlocked', label: 'Pakiet biura blokuje' },
  { key: 'crewPackageBlocked', label: 'Pakiet ekipy blokuje' },
  { key: 'noCheckin', label: 'Brak check-in' },
  { key: 'fieldActive', label: 'Praca trwa' },
  { key: 'readyClose', label: 'Do zamknięcia' },
  { key: 'contactTodo', label: 'Do kontaktu' },
  { key: 'contactWaiting', label: 'Czeka na odp.' },
  { key: 'contactRisk', label: 'Ryzyko kontaktu' },
  { key: 'contactOverdue', label: 'Kontakt po terminie' },
  { key: 'contactToday', label: 'Kontakt dziś' },
];
const OPERATIONAL_VIEWS = [
  { key: 'myTurn', label: 'Moje teraz', detail: 'kto ma piłkę', smartFilter: 'myTurn' },
  { key: 'intake', label: '1. Telefon', detail: 'zgłoszenie z biura', status: TASK_STATUS.NOWE },
  { key: 'fieldInspection', label: '2. Oględziny', detail: 'u specjalisty ds. wyceny', status: TASK_STATUS.WYCENA_TERENOWA },
  { key: 'officeApproval', label: '3. Biuro planuje', detail: 'po akceptacji klienta', status: TASK_STATUS.DO_ZATWIERDZENIA },
  { key: 'planned', label: '4. Ekipa gotowa', detail: 'termin i brygada', status: TASK_STATUS.ZAPLANOWANE },
  { key: 'active', label: '5. Wykonanie', detail: 'ekipa w terenie', status: TASK_STATUS.W_REALIZACJI },
  { key: 'close', label: '6. Zamknięcie', detail: 'dowody i rozliczenie', smartFilter: 'readyClose' },
];
const TASK_SORT_OPTIONS = [
  { key: 'risk', label: 'Najpierw ryzyko', detail: 'Blokery, termin, pilność' },
  { key: 'date', label: 'Najbliższy termin', detail: 'Od najwcześniejszego' },
  { key: 'value', label: 'Największa wartość', detail: 'Budżetowo najpierw' },
  { key: 'newest', label: 'Najnowsze', detail: 'Ostatnio dodane' },
];
const TASK_SORT_KEYS = new Set(TASK_SORT_OPTIONS.map((option) => option.key));
const COMMAND_TABS = [
  { key: 'dispatch', label: 'Dyspozytor', detail: 'kolejka, trasa, odprawa' },
  { key: 'finance', label: 'Finanse', detail: 'marża, ryzyko, jakość' },
  { key: 'audit', label: 'Audyt', detail: 'zamykanie i poprawki' },
];
const FORM_STEPS = [
  { key: 'client', label: 'Klient', detail: 'kontakt i adres' },
  { key: 'work', label: 'Praca', detail: 'opis, logistyka, sprzęt' },
  { key: 'planning', label: 'Ekipa / BHP', detail: 'termin, priorytet, obsada' },
  { key: 'finance', label: 'Finanse', detail: 'wartość, minimum, notatki' },
  { key: 'media', label: 'Zdjęcia', detail: 'foto, szkic, dowody' },
  { key: 'summary', label: 'Podsumowanie', detail: 'kontrola przed zapisem' },
];
const FORM_STEP_KEYS = new Set(FORM_STEPS.map((step) => step.key));
const FORM_WORKFLOW_STEPS = [
  { status: TASK_STATUS.NOWE, step: '1', label: 'Telefon', detail: 'biuro przyjmuje zgłoszenie' },
  { status: TASK_STATUS.WYCENA_TERENOWA, step: '2', label: 'Oględziny', detail: 'specjalista ds. wyceny zbiera zdjęcia i zakres' },
  { status: TASK_STATUS.DO_ZATWIERDZENIA, step: '3', label: 'Biuro planuje', detail: 'klient akceptuje, biuro dopina szczegóły' },
  { status: TASK_STATUS.ZAPLANOWANE, step: '4', label: 'Ekipa gotowa', detail: 'termin, brygada i sprzęt są ustawione' },
  { status: TASK_STATUS.W_REALIZACJI, step: '5', label: 'Wykonanie', detail: 'ekipa pracuje według briefu' },
  { status: TASK_STATUS.ZAKONCZONE, step: '6', label: 'Zamknięcie', detail: 'dowody i rozliczenie są kompletne' },
];
const WORKFLOW_STATUS_ACTION_LABELS = {
  [TASK_STATUS.NOWE]: 'Telefon',
  [TASK_STATUS.WYCENA_TERENOWA]: 'Oględziny',
  [TASK_STATUS.DO_ZATWIERDZENIA]: 'Biuro planuje',
  [TASK_STATUS.ZAPLANOWANE]: 'Ekipa gotowa',
  [TASK_STATUS.W_REALIZACJI]: 'Wykonanie',
  [TASK_STATUS.ZAKONCZONE]: 'Zakończone',
  [TASK_STATUS.ANULOWANE]: 'Anulowane',
};
const TASK_CREATE_FIELD_LABELS = {
  klient_nazwa: 'klient',
  adres: 'adres',
  miasto: 'miasto',
  data_planowana: 'termin oględzin lub pracy',
  oddzial_id: 'oddział',
  wyceniajacy_id: 'specjalista ds. wyceny',
};
const TASK_CREATE_FIELD_STEPS = {
  klient_nazwa: 'client',
  adres: 'client',
  miasto: 'client',
  data_planowana: 'planning',
  oddzial_id: 'planning',
  wyceniajacy_id: 'planning',
};
const FORM_REPAIR_FIELD_STEPS = {
  klient_nazwa: 'client',
  klient_telefon: 'client',
  adres: 'client',
  miasto: 'client',
  data_planowana: 'planning',
  godzina_rozpoczecia: 'planning',
  ekipa_id: 'planning',
  wyceniajacy_id: 'planning',
  opis_pracy: 'work',
  arborysta: 'work',
  sprzet: 'work',
  wartosc_planowana: 'finance',
  budzet: 'finance',
  czas_planowany_godziny: 'finance',
};

function getSafeInternalReturnPath(value) {
  const path = String(value || '').trim();
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) return '';
  return path;
}

function getRouteEditRepair(search) {
  const params = new URLSearchParams(search || '');
  if (params.get('mode') !== 'edit') return null;
  const field = params.get('field') || '';
  if (!field || !FORM_REPAIR_FIELD_STEPS[field]) return null;
  const requestedStep = params.get('step') || FORM_REPAIR_FIELD_STEPS[field];
  return {
    field,
    step: FORM_STEP_KEYS.has(requestedStep) ? requestedStep : FORM_REPAIR_FIELD_STEPS[field],
    label: params.get('repairLabel') || 'Pole do poprawy',
    detail: params.get('repairDetail') || '',
    returnTo: getSafeInternalReturnPath(params.get('returnTo')),
    returnLabel: params.get('returnLabel') || '',
  };
}
const OFFICE_PLAN_DEFAULTS = {
  data_planowana: '',
  godzina_rozpoczecia: '08:00',
  czas_planowany_godziny: '2',
  ekipa_id: '',
  sprzet_notatka: '',
  sprzet_ids: [],
};
const OFFICE_PLAN_DAY_START_MIN = 8 * 60;
const OFFICE_PLAN_DAY_END_MIN = 18 * 60;
const OFFICE_PLAN_SLOT_STEP_MIN = 30;
const QUICK_CALL_DEFAULTS = Object.freeze({
  klient_nazwa: '',
  klient_telefon: '',
  adres: '',
  miasto: '',
  typ_uslugi: TASK_SERVICE_TYPES[0],
  data_planowana: '',
  godzina_rozpoczecia: '',
  oddzial_id: '',
  wyceniajacy_id: '',
  opis_pracy: '',
  priorytet: 'Normalny',
});
const QUICK_CALL_DRAFT_FIELDS = Object.keys(QUICK_CALL_DEFAULTS);
const QUICK_CALL_DRAFT_DIRTY_FIELDS = [
  'klient_nazwa',
  'klient_telefon',
  'adres',
  'miasto',
  'data_planowana',
  'wyceniajacy_id',
  'opis_pracy',
];
const QUICK_CALL_DAILY_TARGET = 12;
const QUICK_CALL_DAILY_LIMIT = 17;

function normalizeQuickCallDraft(raw) {
  const next = { ...QUICK_CALL_DEFAULTS };
  if (!raw || typeof raw !== 'object') return next;
  for (const field of QUICK_CALL_DRAFT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      next[field] = raw[field] == null ? '' : String(raw[field]);
    }
  }
  return next;
}

function hasQuickCallDraftData(draft) {
  return QUICK_CALL_DRAFT_DIRTY_FIELDS.some((field) => String(draft?.[field] || '').trim());
}

function formatQuickCallInspectionSlot(draft) {
  const day = String(draft?.data_planowana || '').trim();
  const time = String(draft?.godzina_rozpoczecia || '').trim();
  return [day, time].filter(Boolean).join(' ');
}

function taskDateOnly(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function teamHomeBranchId(team) {
  return team?.oddzial_macierzysty_id || team?.oddzial_id || '';
}

function teamAvailableBranchId(team) {
  return team?.dostepny_w_oddziale_id || team?.delegowany_do_oddzial_id || teamHomeBranchId(team);
}

function isDelegatedTeam(team) {
  const homeBranchId = String(teamHomeBranchId(team) || '');
  const availableBranchId = String(teamAvailableBranchId(team) || '');
  return Boolean(
    team?.delegowany ||
    team?.delegacja_id ||
    (homeBranchId && availableBranchId && homeBranchId !== availableBranchId)
  );
}

function getTeamOptionKey(team) {
  return [
    team?.id || 'team',
    teamAvailableBranchId(team) || 'branch',
    team?.delegacja_id || 'native',
  ].join('-');
}

function getTeamOptionLabel(team) {
  const name = team?.nazwa || team?.name || `Ekipa #${team?.id || '-'}`;
  if (!isDelegatedTeam(team)) return name;
  const from = team?.delegacja_oddzial_z_nazwa || team?.oddzial_macierzysty_nazwa || team?.oddzial_nazwa || 'oddzial macierzysty';
  const to = team?.dostepny_w_oddziale_nazwa || team?.delegowany_do_oddzial_nazwa || 'oddzial docelowy';
  return `${name} (delegacja: ${from} -> ${to})`;
}

function mergeTeamOptions(baseTeams = [], branchTeams = []) {
  const rows = new Map();
  for (const team of [...baseTeams, ...branchTeams]) {
    if (!team?.id) continue;
    rows.set(getTeamOptionKey(team), team);
  }
  return [...rows.values()];
}

function mergeEquipmentOptions(baseItems = [], branchItems = []) {
  const rows = new Map();
  for (const item of [...baseItems, ...branchItems]) {
    if (!item?.id) continue;
    rows.set(String(item.id), item);
  }
  return [...rows.values()];
}

function isEquipmentAssignedToTeam(item, teamId) {
  return Boolean(teamId && item?.ekipa_id && String(item.ekipa_id) === String(teamId));
}

function resourceStatusBlocksPlanning(status) {
  const text = String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return text.includes('napraw') || text.includes('serwis') || text.includes('awari') || text.includes('wycof');
}

function getTeamResourceRepairSummary(teamId, equipment = [], vehicles = []) {
  const selectedTeamId = String(teamId || '').trim();
  if (!selectedTeamId) {
    return { readyToCheck: false, ok: true, hardConflict: false, items: [], label: 'Zasoby ekipy', detail: 'Wybierz ekipe, aby sprawdzic przypisany sprzet i auta.' };
  }
  const items = [
    ...vehicles
      .filter((item) => String(item.ekipa_id || '') === selectedTeamId && resourceStatusBlocksPlanning(item.status))
      .map((item) => ({
        id: item.id,
        kind: 'Auto',
        label: [item.marka, item.model, item.nr_rejestracyjny].filter(Boolean).join(' ') || `Auto #${item.id}`,
        status: item.status,
      })),
    ...equipment
      .filter((item) => String(item.ekipa_id || '') === selectedTeamId && resourceStatusBlocksPlanning(item.status))
      .map((item) => ({
        id: item.id,
        kind: 'Sprzet',
        label: [item.nazwa, item.typ].filter(Boolean).join(' / ') || `Sprzet #${item.id}`,
        status: item.status,
      })),
  ];
  return {
    readyToCheck: true,
    ok: items.length === 0,
    hardConflict: items.length > 0,
    items,
    label: items.length ? `${items.length} zasob ekipy w naprawie` : 'Zasoby ekipy gotowe',
    detail: items.length
      ? items.slice(0, 3).map((item) => `${item.kind}: ${item.label} (${item.status || 'status'})`).join(' | ')
      : 'Przypisane auta i sprzet wybranej ekipy nie sa oznaczone jako awaria/naprawa.',
  };
}

function getEquipmentPlanLabel(item, { teamId = '', taskBranchId = '', getBranchLabel = null } = {}) {
  const name = item?.nazwa || `Sprzet #${item?.id || '-'}`;
  const parts = [item?.typ, name].filter(Boolean);
  const meta = [];
  if (item?.ekipa_nazwa) meta.push(item.ekipa_nazwa);
  const fromOtherBranch = taskBranchId && item?.oddzial_id && String(item.oddzial_id) !== String(taskBranchId);
  if (fromOtherBranch && isEquipmentAssignedToTeam(item, teamId)) {
    meta.push('sprzet ekipy delegowanej');
  } else if (item?.oddzial_nazwa) {
    meta.push(item.oddzial_nazwa);
  } else if (item?.oddzial_id && typeof getBranchLabel === 'function') {
    meta.push(getBranchLabel(item.oddzial_id));
  }
  return meta.length ? `${parts.join(' - ')} (${meta.join(' / ')})` : parts.join(' - ');
}

function normalizeTimeHM(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function minutesToTimeHM(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function inspectionSlotSuggestions() {
  const slots = [];
  for (let minute = 8 * 60; minute <= 18 * 60; minute += 45) {
    slots.push(minutesToTimeHM(minute));
  }
  return slots;
}

function getQuickCallScheduleDiagnostics({ tasks = [], estimatorId, day, time }) {
  const selectedEstimatorId = String(estimatorId || '').trim();
  const selectedDay = taskDateOnly(day);
  const selectedTime = normalizeTimeHM(time);
  if (!selectedEstimatorId || !selectedDay) {
    return {
      tone: 'info',
      count: 0,
      label: 'Wybierz datę i specjalistę',
      detail: 'System pokaże obciążenie dnia przed utworzeniem oględzin.',
      items: [],
      blockingReason: '',
      suggestedTime: '',
    };
  }

  const items = tasks
    .filter((task) => String(task.wyceniajacy_id || '') === selectedEstimatorId)
    .filter((task) => taskDateOnly(task.data_planowana || task.data_wykonania) === selectedDay)
    .filter((task) => !isTaskClosed(task.status))
    .map((task) => ({
      id: task.id,
      client: task.klient_nazwa || `Zlecenie #${task.id}`,
      time: normalizeTimeHM(task.godzina_rozpoczecia || task.data_planowana),
      status: task.status || '',
      city: task.miasto || '',
    }))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));

  const usedTimes = new Set(items.map((item) => item.time).filter(Boolean));
  const exactConflict = Boolean(selectedTime && usedTimes.has(selectedTime));
  const suggestedTime = exactConflict
    ? inspectionSlotSuggestions().find((slot) => !usedTimes.has(slot)) || ''
    : '';
  const overTarget = items.length >= QUICK_CALL_DAILY_TARGET;
  const overLimit = items.length >= QUICK_CALL_DAILY_LIMIT;
  const tone = exactConflict || overLimit ? 'danger' : overTarget ? 'warning' : 'success';
  const label = `${items.length}/${QUICK_CALL_DAILY_LIMIT} oględzin w tym dniu`;
  const detail = exactConflict
    ? `Konflikt godziny ${selectedTime}. Wybierz inną godzinę dla tego specjalisty.`
    : overLimit
      ? 'Dzień jest już bardzo mocno obciążony. Możesz dopisać tylko świadomie.'
      : overTarget
        ? 'Dzień jest gęsty. Sprawdź trasę i czas dojazdu.'
        : 'Wyceniający ma jeszcze miejsce na oględziny.';

  return {
    tone,
    count: items.length,
    label,
    detail,
    items,
    blockingReason: exactConflict ? detail : '',
    suggestedTime,
  };
}

function timeHMToMinutes(value) {
  const normalized = normalizeTimeHM(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getTaskStartTimeHM(task = {}) {
  return normalizeTimeHM(
    task.godzina_rozpoczecia ||
    (String(task.data_planowana || '').includes('T') ? String(task.data_planowana).slice(11, 16) : '')
  );
}

function getTaskDurationMinutes(task = {}) {
  const hours = Number(task.czas_planowany_godziny || task.czas_realizacji_godz || 2);
  return Math.max(15, Math.round((Number.isFinite(hours) && hours > 0 ? hours : 2) * 60));
}

function timeWindowStatusLabel(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'accepted') return 'zaakceptowane';
  if (value === 'rejected') return 'odrzucone';
  if (value === 'expired') return 'wygasle';
  if (value === 'superseded') return 'zastapione';
  return 'czeka';
}

function timeWindowStatusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'accepted') return 'good';
  if (value === 'rejected' || value === 'expired') return 'danger';
  if (value === 'superseded') return 'warning';
  return 'info';
}

function timeWindowSmsLabel(sms) {
  if (!sms) return 'SMS: brak';
  if (sms.delivered_at) return 'SMS: dostarczony';
  if (sms.delivery_error_code) return `SMS: blad ${sms.delivery_error_code}`;
  return `SMS: ${sms.provider_status || sms.status || sms.provider || 'wyslany'}`;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function getTeamDayRanges(tasks = [], { teamId, day, excludeTaskId } = {}) {
  const selectedTeamId = String(teamId || '').trim();
  const selectedDay = taskDateOnly(day);
  if (!selectedTeamId || !selectedDay) return [];
  return tasks
    .filter((task) => String(task.id || '') !== String(excludeTaskId || ''))
    .filter((task) => String(task.ekipa_id || '') === selectedTeamId)
    .filter((task) => taskDateOnly(task.data_planowana || task.data_wykonania) === selectedDay)
    .filter((task) => !isTaskClosed(task.status))
    .map((task) => {
      const start = timeHMToMinutes(getTaskStartTimeHM(task));
      if (start == null) return null;
      const duration = getTaskDurationMinutes(task);
      return {
        id: task.id,
        start,
        end: start + duration,
        startLabel: minutesToTimeHM(start),
        endLabel: minutesToTimeHM(start + duration),
        client: task.klient_nazwa || `Zlecenie #${task.id}`,
        city: task.miasto || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function getOfficePlanSuggestion({ tasks = [], teams = [], task, day, durationHours, preferredTeamId } = {}) {
  const selectedDay = taskDateOnly(day);
  const duration = Math.max(15, Math.round((Number(durationHours) || 2) * 60));
  const availableTeams = [...teams].sort((a, b) => {
    if (preferredTeamId && String(a.id) === String(preferredTeamId)) return -1;
    if (preferredTeamId && String(b.id) === String(preferredTeamId)) return 1;
    return String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl');
  });
  if (!selectedDay || !availableTeams.length) {
    return {
      ok: false,
      tone: 'warning',
      label: !selectedDay ? 'Wybierz datę pracy' : 'Brak ekipy do podpowiedzi',
      detail: !selectedDay ? 'Asystent znajdzie wolny slot po wyborze daty.' : 'Najpierw dodaj ekipę albo delegację do oddziału.',
      teamId: '',
      time: '',
      ranges: [],
    };
  }

  let bestBusyFallback = null;
  for (const team of availableTeams) {
    const ranges = getTeamDayRanges(tasks, {
      teamId: team.id,
      day: selectedDay,
      excludeTaskId: task?.id,
    });
    for (
      let start = OFFICE_PLAN_DAY_START_MIN;
      start + duration <= OFFICE_PLAN_DAY_END_MIN;
      start += OFFICE_PLAN_SLOT_STEP_MIN
    ) {
      const end = start + duration;
      const conflict = ranges.some((range) => rangesOverlap(start, end, range.start, range.end));
      if (!conflict) {
        return {
          ok: true,
          tone: ranges.length ? 'success' : 'info',
          label: `${team.nazwa || `Ekipa #${team.id}`} · ${minutesToTimeHM(start)}-${minutesToTimeHM(end)}`,
          detail: ranges.length
            ? `W tym dniu ekipa ma ${ranges.length} inne prace, ale ten slot jest wolny.`
            : 'Ekipa nie ma innych prac w tym dniu.',
          teamId: String(team.id),
          teamName: team.nazwa || `Ekipa #${team.id}`,
          date: selectedDay,
          time: minutesToTimeHM(start),
          endTime: minutesToTimeHM(end),
          ranges,
        };
      }
    }
    if (!bestBusyFallback || ranges.length < bestBusyFallback.ranges.length) {
      bestBusyFallback = {
        team,
        ranges,
      };
    }
  }

  return {
    ok: false,
    tone: 'danger',
    label: 'Brak wolnego slotu w godzinach 08:00-18:00',
    detail: bestBusyFallback?.team
      ? `Najmniej obciążona: ${bestBusyFallback.team.nazwa || `Ekipa #${bestBusyFallback.team.id}`}. Otwórz harmonogram i wybierz ręcznie.`
      : 'Brak dostępnych ekip w tym oddziale.',
    teamId: bestBusyFallback?.team ? String(bestBusyFallback.team.id) : '',
    date: selectedDay,
    time: '',
    ranges: bestBusyFallback?.ranges || [],
  };
}

function getOfficePlanTeamConflictSummary(tasks = [], task = {}, plan = {}) {
  const teamId = String(plan.ekipa_id || task.ekipa_id || '').trim();
  const day = taskDateOnly(plan.data_planowana || task.data_planowana || task.data_wykonania);
  const start = timeHMToMinutes(plan.godzina_rozpoczecia || getTaskStartTimeHM(task));
  if (!teamId || !day || start == null) {
    return {
      readyToCheck: false,
      ok: false,
      hardConflict: false,
      warning: false,
      outsideWorkday: false,
      conflicts: [],
      label: 'Najpierw wybierz termin i ekipe',
      detail: 'Radar konfliktow ruszy po wyborze daty, godziny i ekipy.',
    };
  }

  const duration = Math.max(15, Math.round((Number(plan.czas_planowany_godziny || task.czas_planowany_godziny || task.czas_realizacji_godz) || 2) * 60));
  const end = start + duration;
  const outsideWorkday = start < OFFICE_PLAN_DAY_START_MIN || end > OFFICE_PLAN_DAY_END_MIN;
  const conflicts = getTeamDayRanges(tasks, {
    teamId,
    day,
    excludeTaskId: task.id,
  })
    .filter((range) => rangesOverlap(start, end, range.start, range.end))
    .slice(0, 5);

  return {
    readyToCheck: true,
    ok: conflicts.length === 0,
    hardConflict: conflicts.length > 0,
    warning: outsideWorkday && conflicts.length === 0,
    outsideWorkday,
    conflicts,
    label: conflicts.length
      ? `${conflicts.length} kolizja grafiku`
      : outsideWorkday
        ? 'Poza standardowymi godzinami'
        : 'Slot ekipy wolny',
    detail: conflicts.length
      ? conflicts.map((range) => `${range.startLabel}-${range.endLabel} #${range.id} ${range.client}`).join(' | ')
      : outsideWorkday
        ? `Wybrany zakres ${minutesToTimeHM(start)}-${minutesToTimeHM(end)} wychodzi poza 08:00-18:00.`
      : `${minutesToTimeHM(start)}-${minutesToTimeHM(end)} bez kolizji w grafiku ekipy.`,
  };
}

function activeEquipmentReservation(row) {
  const status = String(row?.status || '').toLowerCase();
  return !status.includes('anul') && !status.includes('zwr');
}

function equipmentReservationOverlapsDay(row, day) {
  const start = String(row?.data_od || '').slice(0, 10);
  const end = String(row?.data_do || '').slice(0, 10);
  return Boolean(day && start && end && start <= day && end >= day);
}

function getOfficePlanEquipmentConflictSummary(reservations = [], task = {}, plan = {}, options = {}) {
  const selected = new Set((plan.sprzet_ids || []).map(String).filter(Boolean));
  const day = taskDateOnly(plan.data_planowana || task.data_planowana || task.data_wykonania);
  const teamId = String(plan.ekipa_id || task.ekipa_id || '').trim();
  if (!selected.size) {
    return {
      readyToCheck: false,
      ok: true,
      hardConflict: false,
      warning: false,
      pending: false,
      conflicts: [],
      label: 'Sprzet nie wybrany',
      detail: 'Mozesz zapisac plan z uwaga logistyczna zamiast konkretnej rezerwacji.',
    };
  }
  if (!day) {
    return {
      readyToCheck: false,
      ok: false,
      hardConflict: false,
      warning: true,
      pending: false,
      conflicts: [],
      label: 'Wybierz date',
      detail: 'Radar sprzetu sprawdza rezerwacje dopiero po wyborze dnia.',
    };
  }
  if (options.loading) {
    return {
      readyToCheck: true,
      ok: false,
      hardConflict: false,
      warning: false,
      pending: true,
      conflicts: [],
      label: 'Sprawdzam sprzet',
      detail: 'Pobieram rezerwacje sprzetu dla wybranego dnia.',
    };
  }
  if (options.error) {
    return {
      readyToCheck: true,
      ok: false,
      hardConflict: false,
      warning: true,
      pending: false,
      conflicts: [],
      label: 'Radar sprzetu nie odpowiada',
      detail: options.error,
    };
  }

  const conflicts = (reservations || [])
    .filter(activeEquipmentReservation)
    .filter((row) => selected.has(String(row?.sprzet_id || '')))
    .filter((row) => String(row?.task_id || '') !== String(task?.id || ''))
    .filter((row) => !teamId || String(row?.ekipa_id || '') !== teamId)
    .filter((row) => equipmentReservationOverlapsDay(row, day))
    .slice(0, 8);

  return {
    readyToCheck: true,
    ok: conflicts.length === 0,
    hardConflict: conflicts.length > 0,
    warning: false,
    pending: false,
    conflicts,
    label: conflicts.length ? `${conflicts.length} kolizja sprzetu` : 'Sprzet wolny',
    detail: conflicts.length
      ? conflicts.map((row) => `${row.sprzet_nazwa || `Sprzet #${row.sprzet_id}`} - ${row.ekipa_nazwa || 'inna ekipa'}${row.task_id ? `, zlecenie #${row.task_id}` : ''}`).join(' | ')
      : 'Wybrany sprzet nie ma aktywnej rezerwacji innej ekipy w tym dniu.',
  };
}

function buildQuickCallInspectionPackage({
  quickCall,
  branchLabel = '',
  estimatorLabel = '',
  operatorName = 'biuro',
}) {
  const serviceType = quickCall?.typ_uslugi || TASK_SERVICE_TYPES[0];
  const client = String(quickCall?.klient_nazwa || '').trim();
  const phone = String(quickCall?.klient_telefon || '').trim();
  const address = [quickCall?.adres, quickCall?.miasto].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  const slot = formatQuickCallInspectionSlot(quickCall);
  const callNote = String(quickCall?.opis_pracy || '').trim();
  const fieldBrief = [
    callNote || 'Oględziny po telefonie z biura.',
    'Na miejscu: zdjęcia, szkic zakresu, czas pracy, budżet, ryzyka, decyzja klienta.',
    'Po akceptacji klienta odeślij zlecenie do biura do planowania ekipy.',
  ].filter(Boolean).join('\n');
  const internalNotes = [
    'PAKIET OGLĘDZIN Z TELEFONU',
    `Źródło: telefon do biura`,
    `Telefon przyjął: ${operatorName}`,
    `Klient: ${client || 'brak'}`,
    `Telefon klienta: ${phone || 'brak'}`,
    `Adres oględzin: ${address || 'brak'}`,
    `Typ prac: ${serviceType}`,
    `Termin oględzin: ${slot || 'brak'}`,
    `Oddział: ${branchLabel || 'brak'}`,
    `Specjalista ds. wyceny: ${estimatorLabel || 'brak'}`,
    callNote ? `Notatka z rozmowy: ${callNote}` : null,
    'Zadanie specjalisty ds. wyceny: zdjęcia + szkic, zakres, czas, budżet, ryzyka BHP/logistyki, decyzja klienta.',
  ].filter(Boolean).join('\n');
  return {
    fieldBrief,
    internalNotes,
    serviceType,
    slot,
    address,
  };
}
const FIELD_PHOTO_TYPES = [
  { key: 'Wycena', label: 'Wycena u klienta' },
  { key: 'Szkic', label: 'Szkic / rysunek' },
  { key: 'Przed', label: 'Przed pracą' },
  { key: 'Po', label: 'Po pracy' },
  { key: 'Inne', label: 'Inne' },
];
const CREW_ISSUE_TYPES = [
  { key: 'zakres', label: 'Zakres pracy' },
  { key: 'dojazd', label: 'Dojazd / dostep' },
  { key: 'sprzet', label: 'Sprzet' },
  { key: 'bhp', label: 'BHP / ryzyko' },
  { key: 'klient', label: 'Klient' },
  { key: 'inne', label: 'Inne' },
];
function formatMoneyBrief(value) {
  return `${(Number(value) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

const CLIENT_CONTACT_STATUSES = [
  { key: 'todo', label: 'Do kontaktu', tone: 'warning' },
  { key: 'informed', label: 'Klient poinformowany', tone: 'good' },
  { key: 'waiting', label: 'Czeka na odpowiedź', tone: 'warning' },
  { key: 'risk', label: 'Ryzyko kontaktu', tone: 'danger' },
];
const DEFAULT_WORKFLOW_CONFIG = {
  logEnabled: true,
  notificationsEnabled: true,
  remindersEnabled: true,
  smsEnabled: true,
};
const WORKFLOW_PRESETS = {
  minimal: {
    logEnabled: true,
    notificationsEnabled: false,
    remindersEnabled: false,
    smsEnabled: false,
  },
  standard: {
    logEnabled: true,
    notificationsEnabled: true,
    remindersEnabled: true,
    smsEnabled: false,
  },
  full: {
    logEnabled: true,
    notificationsEnabled: true,
    remindersEnabled: true,
    smsEnabled: true,
  },
};

function Toggle({ value, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => !disabled && onChange(!value)}
      style={{ width: 52, height: 28, borderRadius: 14, border: value ? 'none' : '1px solid var(--border)', cursor: disabled ? 'default' : 'pointer',
        backgroundColor: value ? '#34D399' : 'var(--surface-field)', position: 'relative', transition: 'background 0.2s',
        flexShrink: 0, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: 'var(--surface-glass)', position: 'absolute',
        top: 3, left: value ? 27 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

function TakNie({ label, field, form, onChange, disabled }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 14, color: 'var(--text-sub)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: form[field] ? 'var(--accent-dk)' : 'var(--text-muted)', fontWeight: '600', minWidth: 24 }}>
          {form[field] ? t('common.yes') : t('common.no')}
        </span>
        <Toggle value={form[field]} onChange={v => onChange(field, v)} disabled={disabled} />
      </div>
    </div>
  );
}

function taskAssetUrl(pathMaybe) {
  if (!pathMaybe) return '';
  const value = String(pathMaybe);
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function formatTaskPhotoDate(value) {
  if (!value) return 'brak daty';
  try {
    return new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return 'brak daty';
  }
}

function taskPhotoTypeLabel(type) {
  const found = FIELD_PHOTO_TYPES.find((item) => item.key === type);
  return found?.label || type || 'Inne';
}

function isFieldEvidencePhoto(photo) {
  const kind = String(photo?.typ || photo?.type || '').toLowerCase();
  return ['wycen', 'szkic', 'rys', 'przed'].some((needle) => kind.includes(needle));
}

function TaskPhotosPanel({
  styles,
  title,
  subtitle,
  taskId,
  photos,
  loading,
  uploading,
  draft,
  inputRef,
  onDraftChange,
  onPickFiles,
  onDraw,
  onDelete,
  onSaveDraft,
  repairFocus,
  onCloseRepair,
}) {
  const canUpload = Boolean(taskId);
  return (
    <div className="zlecenia-task-photos-panel" style={styles.taskPhotosPanel}>
      <div style={styles.taskPhotosHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Zdjęcia i szkice</div>
          <div style={styles.taskPhotosTitle}>{title}</div>
          <div style={styles.taskPhotosSubtitle}>{subtitle}</div>
        </div>
        <span style={styles.taskPhotosCount}>{loading ? '...' : photos.length}</span>
      </div>

      {repairFocus ? (
        <div style={styles.taskPhotosRepairBanner}>
          <div>
            <span style={styles.formRepairEyebrow}>Tryb naprawy dokumentacji</span>
            <strong style={styles.formRepairTitle}>{repairFocus.label || 'Dodaj zdjecia / szkic'}</strong>
            <small style={styles.formRepairDetail}>
              {repairFocus.detail || 'Po dodaniu zdjecia karta zlecenia zostanie odswiezona automatycznie.'}
            </small>
          </div>
          {onCloseRepair ? (
            <button type="button" style={styles.formRepairCloseBtn} onClick={onCloseRepair}>
              Zamknij tryb
            </button>
          ) : null}
        </div>
      ) : null}

      {canUpload ? (
        <>
          <div style={styles.taskPhotosToolbar}>
            <select
              style={styles.taskPhotosSelect}
              value={draft.typ}
              onChange={(event) => onDraftChange({ ...draft, typ: event.target.value })}
              disabled={uploading}
            >
              {FIELD_PHOTO_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            <input
              style={styles.taskPhotosInput}
              value={draft.opis}
              onChange={(event) => onDraftChange({ ...draft, opis: event.target.value })}
              placeholder="Krótki opis dla ekipy, np. co ciąć, czego nie ruszać"
              disabled={uploading}
            />
            <input
              style={styles.taskPhotosInputSmall}
              value={draft.tagi}
              onChange={(event) => onDraftChange({ ...draft, tagi: event.target.value })}
              placeholder="Tagi: wycena, granica, ryzyko"
              disabled={uploading}
            />
            <button type="button" style={styles.taskPhotosBtn} onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Wgrywanie...' : '+ Dodaj zdjęcia'}
            </button>
            <button type="button" style={styles.taskPhotosBtnSecondary} onClick={onDraw} disabled={uploading}>
              Rysuj na zdjęciu
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => onPickFiles(event.target.files)}
            />
          </div>
          <div style={styles.taskPhotosHint}>
            Najważniejsze: zdjęcia z oględzin są instrukcją dla ekipy i dowodem zakresu dla klienta. Zdjęcia z telefonu można dodać seriami.
          </div>
        </>
      ) : (
        <div style={styles.taskPhotosDraftBox}>
          <strong>Zapisz szybki draft zlecenia, potem od razu dodaj zdjęcia.</strong>
          <span>To jest tryb dla specjalisty ds. wyceny u klienta: minimum danych, zapis, zdjęcia, szkic, następny klient.</span>
          <button type="button" style={styles.taskPhotosBtn} onClick={onSaveDraft}>
            Zapisz draft i dodaj zdjęcia
          </button>
        </div>
      )}

      {loading ? (
        <div style={styles.taskPhotosEmpty}>Ładowanie dokumentacji...</div>
      ) : photos.length === 0 ? (
        <div style={styles.taskPhotosEmpty}>Brak zdjęć. Dodaj zdjęcia z oględzin albo szkic z zaznaczeniem drzew.</div>
      ) : (
        <div style={styles.taskPhotosGrid}>
          {photos.map((photo) => (
            <div key={photo.id || photo.sciezka} style={styles.taskPhotoCard}>
              <a href={taskAssetUrl(photo.sciezka || photo.url)} target="_blank" rel="noreferrer" style={styles.taskPhotoImageLink}>
                <img src={taskAssetUrl(photo.sciezka || photo.url)} alt={photo.opis || 'Zdjęcie zlecenia'} style={styles.taskPhotoImage} />
              </a>
              <div style={styles.taskPhotoMeta}>
                <strong>{taskPhotoTypeLabel(photo.typ)}</strong>
                <span>{formatTaskPhotoDate(photo.created_at || photo.data_dodania)}</span>
              </div>
              {photo.opis ? <div style={styles.taskPhotoOpis}>{photo.opis}</div> : null}
              {Array.isArray(photo.tagi) && photo.tagi.length ? (
                <div style={styles.taskPhotoTags}>
                  {photo.tagi.slice(0, 4).map((tag) => <span key={tag} style={styles.taskPhotoTag}>{tag}</span>)}
                </div>
              ) : null}
              {onDelete ? (
                <button type="button" style={styles.taskPhotoDelete} onClick={() => onDelete(photo.id)}>
                  Usuń
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowPathPanel({ styles, task, canChange, statusBusy, onChangeStatus, focused = false, statusBlockers = {} }) {
  if (!task) return null;
  const currentStatus = task.status || TASK_STATUS.NOWE;
  const nextStatuses = getNextTaskStatuses(currentStatus, { allowCancel: canChange });
  const activeIndex = Math.max(0, FORM_WORKFLOW_STEPS.findIndex((step) => step.status === currentStatus));
  const actionableNext = nextStatuses.filter((status) => status !== TASK_STATUS.ANULOWANE);
  const cancelAllowed = nextStatuses.includes(TASK_STATUS.ANULOWANE);

  return (
    <section
      className="zlecenia-workflow-path"
      data-detail-section="workflowPath"
      data-focused={focused ? 'true' : 'false'}
      style={{ ...styles.workflowPathPanel, ...(focused ? styles.workflowPathPanelFocused : {}) }}
    >
      <div style={styles.workflowPathHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Oś statusów</div>
          <div style={styles.workflowPathTitle}>Telefon -> oględziny -> biuro -> ekipa -> zamknięcie</div>
          <p style={styles.workflowPathSubtitle}>
            System pokazuje tylko następny logiczny ruch. Przeskoki bokiem są blokowane, żeby zlecenia nie wpadały w chaos.
          </p>
        </div>
        <span style={{ ...styles.businessHealth, ...styles.businessHealth_good }}>
          Etap {FORM_WORKFLOW_STEPS[activeIndex]?.step || '1'}
        </span>
      </div>
      <div style={styles.workflowPathSteps}>
        {FORM_WORKFLOW_STEPS.map((step, index) => {
          const active = step.status === currentStatus;
          const done = index < activeIndex;
          return (
            <div
              key={step.status}
              style={{
                ...styles.workflowPathStep,
                ...(active ? styles.workflowPathStepActive : done ? styles.workflowPathStepDone : {}),
              }}
            >
              <span style={styles.workflowPathNo}>{step.step}</span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          );
        })}
      </div>
      <div style={styles.workflowPathActions}>
        {actionableNext.length ? actionableNext.map((status) => {
          const blocker = statusBlockers[status];
          const disabled = !canChange || statusBusy || Boolean(blocker);
          return (
            <button
              key={status}
              type="button"
              style={{
                ...styles.workflowPathBtn,
                ...(blocker ? styles.workflowPathBtnBlocked : {}),
                ...(disabled ? styles.detailWorkflowActionDisabled : {}),
              }}
              disabled={disabled}
              title={blocker?.detail || undefined}
              onClick={() => !blocker && onChangeStatus(status)}
            >
              {blocker ? `Najpierw: ${blocker.label}` : `Przejdź do: ${WORKFLOW_STATUS_ACTION_LABELS[status] || status}`}
            </button>
          );
        }) : (
          <span style={styles.workflowPathDone}>Brak następnego kroku w czystej ścieżce.</span>
        )}
        {cancelAllowed ? (
          <button
            type="button"
            style={styles.workflowPathCancelBtn}
            disabled={!canChange || statusBusy}
            onClick={() => onChangeStatus(TASK_STATUS.ANULOWANE)}
          >
            Anuluj
          </button>
        ) : null}
      </div>
    </section>
  );
}

function getDetailWorkflowCommandRows({ task, meta, qualityChecklist = [], safetyChecklist = [], photos = [], contact = {}, showOfficePlanPanel = false }) {
  if (!task) return [];
  const currentStatus = task.status || TASK_STATUS.NOWE;
  const activeIndex = Math.max(0, FORM_WORKFLOW_STEPS.findIndex((step) => step.status === currentStatus));
  const q = Object.fromEntries(qualityChecklist.map((item) => [item.key, item]));
  const s = Object.fromEntries(safetyChecklist.map((item) => [item.key, item]));
  const photoSummary = meta?.diagnostics?.photos || getTaskPhotoSummary(task);
  const hasFieldPackage = Boolean(
    photoSummary.total > 0 ||
    task.opis_pracy ||
    task.wynik ||
    Number(task.wartosc_planowana) ||
    Number(task.budzet) ||
    Number(task.czas_planowany_godziny)
  );
  const isStepDone = (status) => {
    const index = FORM_WORKFLOW_STEPS.findIndex((step) => step.status === status);
    if (index < 0) return false;
    return activeIndex > index || currentStatus === TASK_STATUS.ZAKONCZONE;
  };
  const isStepCurrent = (status) => status === currentStatus;
  const missingLabels = (items) => items
    .filter(Boolean)
    .filter((item) => item.required !== false && !item.ok)
    .map((item) => item.label);
  const optionalMissingLabels = (items) => items
    .filter(Boolean)
    .filter((item) => item.required === false && !item.ok)
    .map((item) => item.label);
  const rowState = (status, missing, optional = [], forcedDone = false) => {
    if (currentStatus === TASK_STATUS.ANULOWANE) return 'muted';
    if (forcedDone || isStepDone(status)) return 'done';
    if (isStepCurrent(status)) return missing.length ? 'blocked' : optional.length ? 'warning' : 'active';
    if (missing.length) return 'blocked';
    if (optional.length) return 'warning';
    return 'ready';
  };

  const intakeRequired = [q.phone, q.address, q.date].filter(Boolean);
  if (!task.wyceniajacy_id && currentStatus === TASK_STATUS.NOWE) {
    intakeRequired.push({ key: 'estimator', label: 'Specjalista ds. wyceny', ok: false, required: true });
  }
  const fieldRequired = [
    q.media,
    q.price,
    Number(task.czas_planowany_godziny) ? null : { key: 'hours', label: 'Plan godzin', ok: false, required: true },
    task.opis_pracy || task.wynik ? null : { key: 'brief', label: 'Zakres prac', ok: false, required: true },
  ].filter(Boolean);
  const officeRequired = [q.team, q.date].filter(Boolean);
  const crewRequired = [s.team, s.address, s.brief].filter(Boolean);
  const executionRequired = [s.arborist].filter(Boolean);
  const executionMissing = missingLabels(executionRequired);
  const executionBlocker = executionRequired.find((item) => item?.required !== false && !item.ok);
  const executionRepairAction = executionBlocker
    ? getRepairActionForItem(executionBlocker, 'safety', showOfficePlanPanel)
    : null;
  const closeRequired = [...qualityChecklist, ...safetyChecklist].filter((item) => item.required && !item.ok);
  const closeBlocker = closeRequired[0] || null;
  const closeRepairAction = closeBlocker
    ? getRepairActionForItem(closeBlocker, 'close', showOfficePlanPanel)
    : null;

  return [
    {
      key: 'intake',
      step: '1',
      title: 'Telefon i zgłoszenie',
      owner: 'Specjalista biura',
      status: TASK_STATUS.NOWE,
      state: rowState(TASK_STATUS.NOWE, missingLabels(intakeRequired), [], isStepDone(TASK_STATUS.NOWE)),
      primary: task.klient_nazwa || 'Nowy klient',
      detail: task.klient_telefon ? `Tel. ${task.klient_telefon}` : 'Brak telefonu utrudni potwierdzenie terminu.',
      missing: missingLabels(intakeRequired),
      actionLabel: missingLabels(intakeRequired).length ? 'Uzupełnij dane' : 'Wyślij do specjalisty ds. wyceny',
      action: missingLabels(intakeRequired).length
        ? { target: 'edit', formStep: 'client' }
        : { target: 'status', nextStatus: TASK_STATUS.WYCENA_TERENOWA },
    },
    {
      key: 'field',
      step: '2',
      title: 'Oględziny i pakiet terenowy',
      owner: 'Specjalista ds. wyceny',
      status: TASK_STATUS.WYCENA_TERENOWA,
      state: rowState(TASK_STATUS.WYCENA_TERENOWA, missingLabels(fieldRequired), optionalMissingLabels([q['field-sketch']]), isStepDone(TASK_STATUS.WYCENA_TERENOWA) && hasFieldPackage),
      primary: `${photoSummary.total || photos.length || 0} zdjęć / ${photoSummary.fieldEvidence || 0} wycena i szkic`,
      detail: task.opis_pracy || task.wynik || 'Zakres, cena, czas i ryzyka mają wrócić z terenu.',
      missing: missingLabels(fieldRequired),
      optionalMissing: optionalMissingLabels([q['field-sketch']]),
      actionLabel: missingLabels(fieldRequired).some((label) => label.toLowerCase().includes('zdj')) ? 'Dodaj zdjęcia' : 'Uzupełnij pakiet',
      action: missingLabels(fieldRequired).some((label) => label.toLowerCase().includes('zdj'))
        ? { target: 'photos' }
        : { target: 'edit', formStep: 'work' },
    },
    {
      key: 'office',
      step: '3',
      title: 'Plan biura',
      owner: 'Specjalista / kierownik',
      status: TASK_STATUS.DO_ZATWIERDZENIA,
      state: rowState(TASK_STATUS.DO_ZATWIERDZENIA, missingLabels(officeRequired), [], isStepDone(TASK_STATUS.DO_ZATWIERDZENIA)),
      primary: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Ekipa nie wybrana'),
      detail: task.data_planowana ? `Termin: ${String(task.data_planowana).slice(0, 10)} ${task.godzina_rozpoczecia || ''}` : 'Biuro dopina termin, ekipę i sprzęt.',
      missing: missingLabels(officeRequired),
      actionLabel: showOfficePlanPanel ? 'Zaplanuj ekipę' : 'Edytuj plan',
      action: showOfficePlanPanel ? { target: 'officePlan' } : { target: 'edit', formStep: 'planning' },
    },
    {
      key: 'crew',
      step: '4',
      title: 'Odprawa ekipy',
      owner: 'Brygadzista',
      status: TASK_STATUS.ZAPLANOWANE,
      state: rowState(TASK_STATUS.ZAPLANOWANE, missingLabels(crewRequired), optionalMissingLabels([s.equipment]), isStepDone(TASK_STATUS.ZAPLANOWANE)),
      primary: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Bez ekipy'),
      detail: safetyChecklist.find((item) => item.required && !item.ok)?.detail || 'Ekipa widzi brief, zdjęcia, ryzyka i dojazd.',
      missing: missingLabels(crewRequired),
      optionalMissing: optionalMissingLabels([s.equipment]),
      actionLabel: missingLabels(crewRequired).length ? 'Popraw odprawę' : 'Kopiuj brief',
      action: missingLabels(crewRequired).length ? { target: 'edit', formStep: 'work' } : { target: 'copyBrief' },
    },
    {
      key: 'execution',
      step: '5',
      title: 'Wykonanie pracy',
      owner: 'Ekipa w terenie',
      status: TASK_STATUS.W_REALIZACJI,
      state: rowState(TASK_STATUS.W_REALIZACJI, executionMissing, [], isStepDone(TASK_STATUS.W_REALIZACJI)),
      primary: currentStatus === TASK_STATUS.W_REALIZACJI ? 'Praca w toku' : 'Czeka na start',
      detail: executionBlocker?.detail || 'Po starcie ekipa raportuje problemy i dowody wykonania.',
      missing: executionMissing,
      actionLabel: executionMissing.length
        ? (executionBlocker?.key === 'arborist' ? 'Oznacz arborystę' : 'Popraw BHP')
        : currentStatus === TASK_STATUS.ZAPLANOWANE
          ? 'Rozpocznij'
          : currentStatus === TASK_STATUS.W_REALIZACJI ? 'Zamknij pracę' : 'Pokaż odprawę',
      action: executionMissing.length
        ? {
            ...(executionRepairAction || { target: 'edit', formStep: 'work' }),
            repairLabel: executionBlocker?.label,
            repairDetail: executionBlocker?.detail,
          }
        : currentStatus === TASK_STATUS.ZAPLANOWANE
          ? { target: 'status', nextStatus: TASK_STATUS.W_REALIZACJI }
          : currentStatus === TASK_STATUS.W_REALIZACJI
            ? { target: 'status', nextStatus: TASK_STATUS.ZAKONCZONE }
            : { target: 'crewBrief' },
    },
    {
      key: 'close',
      step: '6',
      title: 'Zamknięcie i rozliczenie',
      owner: 'Biuro / kierownik',
      status: TASK_STATUS.ZAKONCZONE,
      state: currentStatus === TASK_STATUS.ZAKONCZONE ? 'done' : closeRequired.length ? 'blocked' : meta?.diagnostics?.readyToClose ? 'active' : 'ready',
      primary: currentStatus === TASK_STATUS.ZAKONCZONE
        ? 'Zamknięte'
        : closeRequired.length ? 'Blokada przed zamknięciem' : meta?.diagnostics?.readyToClose ? 'Gotowe do zamknięcia' : 'Jeszcze przed finalną kontrolą',
      detail: closeBlocker?.detail || (contact.status === 'risk'
        ? 'Sprawdź kontakt, cenę, zdjęcia i kompletność danych.'
        : 'Po wykonaniu zostaje kontrola jakości i rozliczenie.'),
      missing: closeRequired.map((item) => item.label),
      actionLabel: closeRequired.length
        ? (closeBlocker?.key === 'arborist' ? 'Oznacz arborystę' : 'Napraw blokadę')
        : meta?.diagnostics?.readyToClose ? 'Zamknij zlecenie' : 'Centrum decyzji',
      action: closeRequired.length
        ? {
            ...(closeRepairAction || { target: 'decision' }),
            repairLabel: closeBlocker?.label,
            repairDetail: closeBlocker?.detail,
          }
        : meta?.diagnostics?.readyToClose
          ? { target: 'status', nextStatus: TASK_STATUS.ZAKONCZONE }
          : { target: 'decision' },
    },
  ];
}

function DetailWorkflowCommandCenter({ styles, rows, statusBusy, canChangeStatus, onCommand }) {
  if (!rows.length) return null;
  return (
    <section style={styles.detailWorkflowPanel}>
      <div style={styles.detailWorkflowHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Sterowanie zleceniem</div>
          <div style={styles.detailWorkflowTitle}>Jedna ścieżka od telefonu do wykonania</div>
          <p style={styles.detailWorkflowSubtitle}>
            Każdy etap ma właściciela, listę braków i jeden następny ruch. To ma zastąpić skakanie po różnych formularzach.
          </p>
        </div>
        <span style={styles.detailWorkflowBadge}>
          {rows.filter((row) => row.state === 'done').length}/{rows.length} etapów
        </span>
      </div>
      <div style={styles.detailWorkflowGrid}>
        {rows.map((row) => {
          const stateStyle = styles[`detailWorkflowStep_${row.state}`] || {};
          const disabled = statusBusy || (row.action?.target === 'status' && !canChangeStatus);
          return (
            <article key={row.key} style={{ ...styles.detailWorkflowStep, ...stateStyle }}>
              <div style={styles.detailWorkflowStepTop}>
                <span style={styles.detailWorkflowStepNo}>{row.step}</span>
                <span style={styles.detailWorkflowOwner}>{row.owner}</span>
              </div>
              <strong style={styles.detailWorkflowStepTitle}>{row.title}</strong>
              <span style={styles.detailWorkflowPrimary}>{row.primary}</span>
              <small style={styles.detailWorkflowDetail}>{row.detail}</small>
              {row.missing?.length ? (
                <div style={styles.detailWorkflowMissing}>
                  {row.missing.slice(0, 3).map((label) => <span key={label} style={styles.detailWorkflowPill}>{label}</span>)}
                </div>
              ) : row.optionalMissing?.length ? (
                <div style={styles.detailWorkflowOptional}>
                  {row.optionalMissing.slice(0, 2).map((label) => <span key={label} style={styles.detailWorkflowOptionalPill}>Opcj.: {label}</span>)}
                </div>
              ) : (
                <div style={styles.detailWorkflowOk}>Gotowe</div>
              )}
              <button
                type="button"
                style={{ ...styles.detailWorkflowAction, ...(disabled ? styles.detailWorkflowActionDisabled : {}) }}
                disabled={disabled}
                onClick={() => onCommand(row.action)}
              >
                {row.actionLabel}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DetailStageOwnerPanel({ styles, task, rows, currentUser, statusBusy, canChangeStatus, onCommand, onShowPath }) {
  if (!task || !rows?.length) return null;
  const currentStatus = task.status || TASK_STATUS.NOWE;
  const currentIndex = rows.findIndex((row) => row.status === currentStatus);
  const currentRow = currentIndex >= 0 ? rows[currentIndex] : rows[0];
  const nextRow = currentIndex >= 0 ? rows[currentIndex + 1] : null;
  const missing = currentRow.missing || [];
  const optionalMissing = currentRow.optionalMissing || [];
  const tone = currentRow.state === 'blocked'
    ? 'danger'
    : currentRow.state === 'warning'
      ? 'warning'
      : currentRow.state === 'done'
        ? 'good'
        : 'active';
  const actionDisabled = statusBusy || !currentRow.action || (currentRow.action.target === 'status' && !canChangeStatus);
  const ownerText = missing.length
    ? `${currentRow.owner} musi domknąć: ${missing.slice(0, 3).join(', ')}.`
    : optionalMissing.length
      ? `${currentRow.owner} może dopiąć: ${optionalMissing.slice(0, 2).join(', ')}.`
      : nextRow
        ? `Etap jest gotowy do przekazania dalej: ${nextRow.owner}.`
        : 'Ścieżka jest domknięta, zostaje kontrola i archiwum.';

  return (
    <section className="zlecenia-stage-owner" style={{ ...styles.detailOwnerPanel, ...(styles[`detailOwnerPanel_${tone}`] || {}) }}>
      <div style={styles.detailOwnerMain}>
        <div style={styles.detailOpsEyebrow}>Właściciel etapu</div>
        <div style={styles.detailOwnerTitle}>
          Teraz odpowiada: <strong>{currentRow.owner}</strong>
        </div>
        <p style={styles.detailOwnerText}>{ownerText}</p>
        <div style={styles.detailOwnerMeta}>
          <span style={styles.detailOwnerMetaPill}>Status: {currentStatus}</span>
          <span style={styles.detailOwnerMetaPill}>Twoja rola: {getRoleDisplayName(currentUser?.rola, 'brak')}</span>
          <span style={styles.detailOwnerMetaPill}>Następny etap: {nextRow?.title || 'koniec ścieżki'}</span>
        </div>
      </div>
      <div style={styles.detailOwnerActionBox}>
        <span style={styles.detailDecisionLabel}>Co robimy teraz</span>
        <strong style={styles.detailOwnerActionTitle}>{currentRow.actionLabel || 'Sprawdź etap'}</strong>
        <small style={styles.detailOwnerActionDetail}>{currentRow.detail}</small>
        <button
          type="button"
          data-testid="detail-stage-owner-action"
          style={{ ...styles.detailOwnerActionBtn, ...(actionDisabled ? styles.detailWorkflowActionDisabled : {}) }}
          disabled={actionDisabled}
          onClick={() => onCommand(currentRow.action)}
        >
          {statusBusy ? 'Pracuję...' : currentRow.actionLabel || 'Otwórz'}
        </button>
        <button
          type="button"
          data-testid="detail-stage-owner-path"
          style={styles.detailOwnerSecondaryBtn}
          onClick={onShowPath}
        >
          Pokaż całą ścieżkę
        </button>
      </div>
    </section>
  );
}

function OfficeDecisionBoard({
  styles,
  cards,
  recommendation,
  nextActionLabel,
  nextActionDetail,
  primaryDisabled,
  onPrimary,
  onAction,
}) {
  if (!cards?.length) return null;
  return (
    <section className="zlecenia-office-decision-board" style={styles.officeDecisionBoard}>
      <div style={styles.officeDecisionHead}>
        <div>
          <div style={styles.detailOpsEyebrow}>Panel dyspozytora biura</div>
          <div style={styles.officeDecisionTitle}>{recommendation}</div>
          <p style={styles.officeDecisionSubtitle}>
            Jeden ekran decyzji: pakiet z oględzin, plan ekipy, dokumentacja, klient i następny ruch.
          </p>
        </div>
        <div style={styles.officeDecisionNext}>
          <span style={styles.detailDecisionLabel}>Następny ruch</span>
          <strong style={styles.officeDecisionNextTitle}>{nextActionLabel}</strong>
          <small style={styles.officeDecisionNextDetail}>{nextActionDetail}</small>
          <button
            type="button"
            style={{ ...styles.bulkBtn, ...(primaryDisabled ? styles.formWizardBtnDisabled : {}) }}
            disabled={primaryDisabled}
            onClick={onPrimary}
          >
            Wykonaj teraz
          </button>
        </div>
      </div>
      <div style={styles.officeDecisionCards}>
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            style={{
              ...styles.officeDecisionCard,
              ...(styles[`officeDecisionCard_${card.tone}`] || {}),
            }}
            onClick={() => onAction?.(card.action)}
          >
            <span style={styles.officeDecisionCardLabel}>{card.label}</span>
            <strong style={styles.officeDecisionCardValue}>{card.value}</strong>
            <small style={styles.officeDecisionCardDetail}>{card.detail}</small>
            <span style={styles.officeDecisionCardAction}>{card.actionLabel}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DetailRepairPanel({ styles, items, score, onAction }) {
  if (!items?.length) return null;
  const blockers = items.filter((item) => item.required);
  const warnings = items.filter((item) => !item.required);
  const lead = blockers[0] || warnings[0] || items[0];
  return (
    <section className="zlecenia-detail-repair-panel" style={styles.detailRepairPanel}>
      <div style={styles.detailRepairHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Napraw braki</div>
          <div style={styles.detailRepairTitle}>
            {blockers.length ? 'Najpierw zamknij blokady zlecenia' : 'Dopnij ostrzezenia przed przekazaniem ekipie'}
          </div>
          <p style={styles.detailRepairSubtitle}>
            Jeden panel pokazuje, co blokuje przejscie od ogledzin do planu ekipy. Klikniecie prowadzi od razu do miejsca naprawy.
          </p>
        </div>
        <div style={styles.detailRepairScore}>
          <span style={styles.detailRepairScoreLabel}>Gotowosc</span>
          <strong style={styles.detailRepairScoreValue}>{score ?? '-'}/100</strong>
          <small style={styles.detailRepairScoreDetail}>{blockers.length} blokad / {warnings.length} uwag</small>
        </div>
      </div>

      <div style={styles.detailRepairLead}>
        <div>
          <span style={styles.detailRepairLeadLabel}>{lead.owner}</span>
          <strong style={styles.detailRepairLeadTitle}>{lead.label}</strong>
          <small style={styles.detailRepairLeadDetail}>{lead.detail}</small>
        </div>
        <button type="button" style={styles.detailRepairPrimaryBtn} onClick={() => onAction?.(lead.action)}>
          {lead.actionLabel}
        </button>
      </div>

      <div style={styles.detailRepairGrid}>
        {items.slice(0, 8).map((item) => (
          <button
            key={item.key}
            type="button"
            style={{
              ...styles.detailRepairItem,
              ...(item.required ? styles.detailRepairItemDanger : styles.detailRepairItemWarning),
            }}
            onClick={() => onAction?.(item.action)}
          >
            <span style={styles.detailRepairItemTop}>
              <strong>{item.required ? 'Blokada' : 'Uwaga'}</strong>
              <small>{item.owner}</small>
            </span>
            <span style={styles.detailRepairItemLabel}>{item.label}</span>
            <small style={styles.detailRepairItemDetail}>{item.detail}</small>
            <span style={styles.detailRepairItemAction}>{item.actionLabel}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function OfficePlanningQueue({
  styles,
  rows,
  total,
  ready,
  blocked,
  value,
  onPlan,
  onOpenCalendar,
  onApplyView,
  onCopy,
}) {
  if (!rows?.length) return null;
  const focusedCalendarTask = rows.length === 1 ? rows[0]?.task : null;
  return (
    <section className="zlecenia-office-planning-queue" style={styles.officePlanningQueue}>
      <div style={styles.officePlanningQueueHead}>
        <div>
          <div style={styles.detailOpsEyebrow}>Kolejka biura</div>
          <div style={styles.officePlanningQueueTitle}>Pakiety z terenu do zaplanowania</div>
          <p style={styles.officePlanningQueueSubtitle}>
            Tu trafiają zlecenia zaakceptowane przez klienta w terenie. Biuro tylko dopina ekipę, termin, sprzęt i puszcza do harmonogramu.
          </p>
        </div>
        <div style={styles.officePlanningQueueStats}>
          <span style={styles.officePlanningQueueStat}><strong>{total}</strong> pakietów</span>
          <span style={styles.officePlanningQueueStat}><strong>{ready}</strong> gotowe</span>
          <span style={styles.officePlanningQueueStat}><strong>{blocked}</strong> z brakami</span>
          <span style={styles.officePlanningQueueStat}><strong>{formatMoneyBrief(value)}</strong></span>
        </div>
      </div>
      <div style={styles.officePlanningQueueRows}>
        {rows.map((row) => (
          <article key={row.task.id} style={styles.officePlanningQueueRow}>
            <button type="button" style={styles.officePlanningQueueMain} onClick={() => onPlan(row.task)}>
              <span style={styles.officePlanningQueueId}>#{row.task.id}</span>
              <span style={styles.officePlanningQueueBody}>
                <strong>{row.task.klient_nazwa || 'Bez klienta'}</strong>
                <small>{row.address || 'Brak adresu'} · {row.branchLabel}</small>
              </span>
            </button>
            <div style={styles.officePlanningQueueMeta}>
              <span>{row.slotLabel}</span>
              <span>{row.teamLabel}</span>
              <span>{row.equipmentLabel}</span>
              <span>{row.photos.total} zdjęć / {row.photos.fieldEvidence} wycena</span>
            </div>
            <div style={styles.officePlanningQueueBadges}>
              {row.missing.length ? (
                row.missing.slice(0, 3).map((label) => (
                  <span key={label} style={{ ...styles.officePlanningBadge, ...styles.officePlanningBadgeDanger }}>{label}</span>
                ))
              ) : (
                <span style={{ ...styles.officePlanningBadge, ...styles.officePlanningBadgeGood }}>plan OK</span>
              )}
              {row.warnings.slice(0, 2).map((label) => (
                <span key={label} style={{ ...styles.officePlanningBadge, ...styles.officePlanningBadgeWarning }}>{label}</span>
              ))}
            </div>
            <div style={styles.officePlanningQueueActions}>
              <button type="button" style={styles.officePlanningQueueBtn} onClick={() => onPlan(row.task)}>
                Planuj
              </button>
              <button type="button" style={styles.officePlanningQueueBtnSecondary} onClick={() => onOpenCalendar?.(row.task)}>
                Kalendarz
              </button>
            </div>
          </article>
        ))}
      </div>
      <div style={styles.officePlanningQueueFoot}>
        <button type="button" style={styles.bulkBtn} onClick={onApplyView}>
          Pokaż pełną kolejkę
        </button>
        <button type="button" style={styles.bulkBtnSecondary} onClick={() => onOpenCalendar?.(focusedCalendarTask)}>
          Harmonogram ekip
        </button>
        <button type="button" style={styles.bulkBtnSecondary} onClick={onCopy}>
          Kopiuj odprawę planowania
        </button>
      </div>
    </section>
  );
}

function OfficePlanHandoffCard({
  styles,
  task,
  branchLabel,
  photos = [],
  fieldPhotoCount = 0,
  readinessItems = [],
  statusLabel,
  statusTone,
  teamLabel,
  planLabel,
  equipmentLabel,
  priceLabel,
  scopeLabel,
  riskLabel,
  canPlan,
  onPlan,
  onCalendar,
  onCopy,
  onPhotos,
}) {
  if (!task) return null;
  const requiredMissing = readinessItems.filter((item) => item.required && !item.ok);
  const warnings = readinessItems.filter((item) => !item.required && !item.ok);
  const leadIssue = requiredMissing[0] || warnings[0] || null;
  const handoffTone = requiredMissing.length ? 'danger' : warnings.length ? 'warning' : 'good';
  const cards = [
    {
      key: 'client',
      label: 'Klient / adres',
      value: task.klient_nazwa || `Zlecenie #${task.id}`,
      detail: [getTaskAddressLine(task), branchLabel].filter(Boolean).join(' | ') || 'Brak adresu',
      ok: Boolean(task.klient_nazwa && getTaskAddressLine(task)),
    },
    {
      key: 'field',
      label: 'Dowody z terenu',
      value: `${fieldPhotoCount}/${photos.length || 0}`,
      detail: fieldPhotoCount ? 'Zdjecia lub szkic z ogledzin sa w pakiecie.' : 'Brakuje zdjec z ogledzin.',
      ok: fieldPhotoCount > 0,
      action: onPhotos,
    },
    {
      key: 'scope',
      label: 'Zakres / ryzyka',
      value: scopeLabel ? 'Opisany' : 'Brak opisu',
      detail: [scopeLabel, riskLabel].filter(Boolean).join(' | ') || 'Dopisz zakres i ryzyka dla brygady.',
      ok: Boolean(scopeLabel),
    },
    {
      key: 'money',
      label: 'Budzet',
      value: priceLabel,
      detail: 'Cena, czas i warunki musza byc jasne przed planowaniem.',
      ok: Boolean(task.wartosc_planowana || task.budzet),
    },
    {
      key: 'crew',
      label: 'Ekipa / termin',
      value: teamLabel || 'Bez ekipy',
      detail: planLabel || 'Wybierz date, godzine i czas pracy.',
      ok: Boolean(teamLabel && planLabel),
      action: onPlan,
    },
    {
      key: 'equipment',
      label: 'Sprzet',
      value: equipmentLabel ? 'Ustalony' : 'Do dopiecia',
      detail: equipmentLabel || 'Wybierz sprzet albo dopisz uwagi logistyczne.',
      ok: Boolean(equipmentLabel),
      action: onPlan,
    },
  ];

  return (
    <section className="zlecenia-office-handoff" style={{ ...styles.officeHandoffPanel, ...(styles[`officeHandoffPanel_${handoffTone}`] || {}) }}>
      <div style={styles.officeHandoffHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Pakiet planowania</div>
          <div style={styles.officeHandoffTitle}>Jedna karta od telefonu do ekipy</div>
          <p style={styles.officeHandoffSubtitle}>
            Biuro widzi tu wszystko, co musi byc gotowe przed wrzuceniem pracy do harmonogramu: klient, teren, zakres, cena, ekipa, termin i sprzet.
          </p>
        </div>
        <div style={styles.officeHandoffStatusBox}>
          <span style={{ ...styles.businessHealth, ...styles[`businessHealth_${statusTone || handoffTone}`] }}>
            {statusLabel || (leadIssue ? 'Do poprawy' : 'Gotowe')}
          </span>
          <small>{leadIssue ? leadIssue.detail : 'Pakiet mozna przekazac do planowania.'}</small>
        </div>
      </div>

      <div style={styles.officeHandoffGrid}>
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            style={{
              ...styles.officeHandoffCard,
              ...(card.ok ? styles.officeHandoffCardOk : styles.officeHandoffCardWarn),
              ...(card.action ? styles.officeHandoffCardClickable : {}),
            }}
            onClick={card.action || undefined}
          >
            <span style={styles.officeHandoffCardLabel}>{card.label}</span>
            <strong style={styles.officeHandoffCardValue}>{card.value}</strong>
            <small style={styles.officeHandoffCardDetail}>{card.detail}</small>
          </button>
        ))}
      </div>

      <div style={styles.officeHandoffActions}>
        <button type="button" style={styles.bulkBtn} disabled={!canPlan} onClick={onPlan}>
          Otworz plan biura
        </button>
        <button
          type="button"
          style={styles.bulkBtnSecondary}
          aria-label={`Harmonogram ekip dla zlecenia #${task.id}`}
          onClick={onCalendar}
        >
          Harmonogram ekip
        </button>
        <button type="button" style={styles.bulkBtnSecondary} onClick={onCopy}>
          Kopiuj pakiet
        </button>
      </div>
    </section>
  );
}

function CrewExecutionBrief({
  styles,
  task,
  photos,
  issues,
  safetyChecklist,
  equipment,
  issueDraft,
  issueSaving,
  statusBusy,
  canChangeStatus,
  onIssueDraftChange,
  onReportIssue,
  onStart,
  onFinish,
  onCopy,
}) {
  if (!task) return null;
  const description = getTaskCrewDescription(task);
  const risk = getTaskCrewRisk(task);
  const equipmentNote = getTaskCrewEquipmentNote(task);
  const crewEquipment = equipment || [];
  const fieldPhotos = (photos || [])
    .filter(isFieldEvidencePhoto)
    .slice(0, 4);
  const visibleChecklist = (safetyChecklist || []).slice(0, 6);
  const crewReadiness = buildCrewBriefReadiness({
    task,
    fieldPhotos,
    safetyChecklist,
    equipment: crewEquipment,
    description,
    risk,
    equipmentNote,
  });
  const readinessTone = crewReadiness.blockers.length
    ? 'danger'
    : crewReadiness.warnings.length
      ? 'warning'
      : 'good';
  const readinessLabel = crewReadiness.blockers.length
    ? `Brakuje: ${crewReadiness.blockers[0].label}`
    : crewReadiness.warnings.length
      ? `Do doprecyzowania: ${crewReadiness.warnings[0].label}`
      : 'Gotowe do wyjazdu';
  const phoneHref = telHref(task.klient_telefon);
  const mapHref = getMapsHref(task);
  const canStart = canChangeStatus && task.status === TASK_STATUS.ZAPLANOWANE;
  const canFinish = canChangeStatus && isTaskInProgress(task.status);

  return (
    <section className="zlecenia-crew-brief" style={styles.crewBriefPanel}>
      <div style={styles.crewBriefHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Brief brygady</div>
          <div style={styles.crewBriefTitle}>Jedna instrukcja wykonania pracy</div>
          <p style={styles.crewBriefSubtitle}>
            To jest pakiet dla ekipy: co robimy, gdzie, jakim sprzetem, jakie ryzyka i jakie zdjecia pokazal wyceniajacy.
          </p>
        </div>
        <span style={{ ...styles.businessHealth, ...styles[`businessHealth_${readinessTone}`] }}>
          Pakiet {crewReadiness.score}%
        </span>
      </div>

      <div data-testid="crew-readiness-panel" style={styles.crewPackagePanel}>
        <div style={styles.crewPackageSummary}>
          <span style={styles.detailDecisionLabel}>Gotowość wyjazdu</span>
          <strong style={styles.crewPackageTitle}>{readinessLabel}</strong>
          <small style={styles.crewPackageDetail}>
            {crewReadiness.blockers.length
              ? 'Nie puszczaj ekipy, dopóki wymagane braki nie są zamknięte.'
              : crewReadiness.warnings.length
                ? 'Ekipę można odprawić, ale biuro powinno doprecyzować ostrzeżenia.'
                : 'Ekipa ma komplet informacji do wykonania pracy.'}
          </small>
        </div>
        <div style={styles.crewPackageGrid}>
          {crewReadiness.items.map((item) => (
            <div
              key={item.key}
              style={{
                ...styles.crewPackageItem,
                ...(item.ok ? styles.crewPackageItemOk : item.required ? styles.crewPackageItemDanger : styles.crewPackageItemWarn),
              }}
            >
              <span>{item.ok ? 'OK' : item.required ? 'Brak' : 'Uwaga'}</span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.crewBriefGrid}>
        <div style={styles.crewBriefMain}>
          <div style={styles.crewBriefRow}>
            <span>Termin</span>
            <strong>{formatTaskPlanLine(task)}</strong>
          </div>
          <div style={styles.crewBriefRow}>
            <span>Klient</span>
            <strong>{task.klient_nazwa || 'Brak klienta'}{task.klient_telefon ? ` | ${task.klient_telefon}` : ''}</strong>
          </div>
          <div style={styles.crewBriefRow}>
            <span>Adres</span>
            <strong>{getTaskAddressLine(task) || 'Brak adresu'}</strong>
          </div>
          <div style={styles.crewBriefBlock}>
            <span>Zakres prac</span>
            <p>{description || 'Brak jasnego opisu. Biuro albo specjalista ds. wyceny musi dopisac zakres przed wyjazdem ekipy.'}</p>
          </div>
          <div style={styles.crewBriefTwoCol}>
            <div style={styles.crewBriefBlock}>
              <span>Sprzet i logistyka</span>
              <p>{[crewEquipment.join(', '), equipmentNote].filter(Boolean).join(' | ') || 'Sprzet nie zostal doprecyzowany.'}</p>
            </div>
            <div style={styles.crewBriefBlock}>
              <span>Ryzyka / BHP</span>
              <p>{risk || 'Brak wpisanych ryzyk. Sprawdzic teren przed startem pracy.'}</p>
            </div>
          </div>
        </div>

        <aside style={styles.crewBriefSide}>
          <div style={styles.crewBriefActions}>
            {phoneHref ? (
              <a href={phoneHref} style={styles.crewActionBtnSecondary}>
                Telefon
              </a>
            ) : null}
            {mapHref ? (
              <a href={mapHref} target="_blank" rel="noreferrer" style={styles.crewActionBtnSecondary}>
                Mapa
              </a>
            ) : null}
            <button type="button" style={styles.crewActionBtn} disabled={!canStart || statusBusy} onClick={onStart}>
              Start pracy
            </button>
            <button type="button" style={styles.crewActionBtn} disabled={!canFinish || statusBusy} onClick={onFinish}>
              Zakoncz
            </button>
            <button type="button" style={styles.crewActionBtnSecondary} onClick={onCopy}>
              Kopiuj brief
            </button>
          </div>
          <div style={styles.crewIssueBox}>
            <div style={styles.detailDecisionLabel}>Szybkie zgloszenie problemu</div>
            <select
              style={styles.crewIssueSelect}
              value={issueDraft.typ}
              onChange={(event) => onIssueDraftChange({ ...issueDraft, typ: event.target.value })}
              disabled={issueSaving}
            >
              {CREW_ISSUE_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            <textarea
              style={styles.crewIssueTextarea}
              value={issueDraft.opis}
              placeholder="Co blokuje prace? Np. brak dostepu, klient zmienil zakres, potrzebna zwyzka."
              onChange={(event) => onIssueDraftChange({ ...issueDraft, opis: event.target.value })}
              disabled={issueSaving}
            />
            <button type="button" style={styles.crewIssueBtn} disabled={issueSaving} onClick={onReportIssue}>
              {issueSaving ? 'Zglaszam...' : 'Zglos problem'}
            </button>
            <small style={styles.crewIssueCount}>Zgloszenia: {issues.length}</small>
          </div>
        </aside>
      </div>

      <div style={styles.crewBriefBottom}>
        <div style={styles.crewChecklist}>
          {visibleChecklist.map((item) => (
            <div
              key={item.key}
              style={{
                ...styles.crewChecklistItem,
                ...(item.ok ? styles.detailChecklistOk : item.required ? styles.detailChecklistDanger : styles.detailChecklistWarn),
              }}
            >
              <span>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
        <div style={styles.crewPhotoStrip}>
          {fieldPhotos.length ? fieldPhotos.map((photo) => (
            <a key={photo.id || photo.sciezka} href={taskAssetUrl(photo.sciezka || photo.url)} target="_blank" rel="noreferrer" style={styles.crewPhotoLink}>
              <img src={taskAssetUrl(photo.sciezka || photo.url)} alt={photo.opis || 'Zdjecie z wyceny'} style={styles.crewPhotoThumb} />
              <span style={styles.crewPhotoLabel}>{taskPhotoTypeLabel(photo.typ)}</span>
            </a>
          )) : (
            <div style={styles.crewPhotoEmpty}>Brak zdjec wyceny/szkicu dla ekipy.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function buildCrewBriefReadiness({
  task,
  fieldPhotos = [],
  safetyChecklist = [],
  equipment = [],
  description = '',
  risk = '',
  equipmentNote = '',
}) {
  const hasDate = Boolean(task?.data_planowana);
  const hasStartTime = Boolean(task?.godzina_rozpoczecia || String(task?.data_planowana || '').includes('T'));
  const safetyBlockers = safetyChecklist.filter((item) => item.required && !item.ok);
  const items = [
    {
      key: 'slot',
      label: 'Termin',
      detail: hasDate && hasStartTime ? formatTaskPlanLine(task) : 'brak daty albo godziny startu',
      ok: hasDate && hasStartTime,
      required: true,
    },
    {
      key: 'address',
      label: 'Adres',
      detail: getTaskAddressLine(task) || 'brak adresu do mapy',
      ok: Boolean(getTaskAddressLine(task)),
      required: true,
    },
    {
      key: 'contact',
      label: 'Kontakt',
      detail: task?.klient_telefon || 'brak telefonu klienta',
      ok: Boolean(task?.klient_telefon),
      required: true,
    },
    {
      key: 'scope',
      label: 'Zakres',
      detail: description ? 'opis pracy jest w briefie' : 'brak jasnego opisu pracy',
      ok: Boolean(description),
      required: true,
    },
    {
      key: 'photos',
      label: 'Zdjęcia',
      detail: fieldPhotos.length ? `${fieldPhotos.length} dowodów z oględzin` : 'brak zdjęć z wyceny/szkicu',
      ok: fieldPhotos.length > 0,
      required: true,
    },
    {
      key: 'team',
      label: 'Ekipa',
      detail: task?.ekipa_nazwa || (task?.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'brak przypisanej ekipy'),
      ok: Boolean(task?.ekipa_id || task?.ekipa_nazwa),
      required: true,
    },
    {
      key: 'equipment',
      label: 'Sprzęt',
      detail: [equipment.join(', '), equipmentNote].filter(Boolean).join(' | ') || 'sprzęt nie został doprecyzowany',
      ok: equipment.length > 0 || Boolean(equipmentNote),
      required: false,
    },
    {
      key: 'risk',
      label: 'BHP / ryzyka',
      detail: risk || safetyBlockers[0]?.detail || 'brak wpisanych ryzyk terenowych',
      ok: Boolean(risk) && safetyBlockers.length === 0,
      required: false,
    },
  ];
  const okCount = items.filter((item) => item.ok).length;
  return {
    items,
    score: Math.round((okCount / items.length) * 100),
    blockers: items.filter((item) => item.required && !item.ok),
    warnings: items.filter((item) => !item.required && !item.ok),
  };
}

function getTaskDay(task) {
  return task.data_planowana || task.data_wykonania
    ? String(task.data_planowana || task.data_wykonania).slice(0, 10)
    : '';
}

function getTaskAddressLine(task) {
  return [task.adres, task.miasto].filter(Boolean).join(', ');
}

function extractTaskNoteLine(task, label) {
  const raw = String(task?.notatki_wewnetrzne || '');
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(`${String(label).toLowerCase()}:`));
  return line ? line.slice(String(label).length + 1).trim() : '';
}

function getTaskCrewDescription(task) {
  return task?.opis_pracy || task?.opis || extractTaskNoteLine(task, 'Zakres prac') || task?.wynik || '';
}

function getTaskCrewRisk(task) {
  const explicitRisk = task?.ryzyka || extractTaskNoteLine(task, 'Ryzyka') || extractTaskNoteLine(task, 'Ryzyko');
  if (explicitRisk) return explicitRisk;
  const rawNotes = String(task?.notatki_wewnetrzne || task?.notatki || '');
  return rawNotes
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /ryzyko|bhp|bezpiecz|dojazd|zgod|stref/i.test(item)) || '';
}

function getTaskCrewEquipmentNote(task) {
  return task?.sprzet_notatka || extractTaskNoteLine(task, 'Sprzet / uwagi') || extractTaskNoteLine(task, 'Sprzet') || '';
}

function formatTaskPlanLine(task) {
  const day = task?.data_planowana ? String(task.data_planowana).slice(0, 10) : 'brak daty';
  const time = task?.godzina_rozpoczecia || (String(task?.data_planowana || '').includes('T') ? String(task.data_planowana).split('T')[1]?.slice(0, 5) : '');
  const hours = task?.czas_planowany_godziny ? `${task.czas_planowany_godziny} h` : 'brak czasu';
  return [day, time, hours].filter(Boolean).join(' | ');
}

function getMapsHref(task) {
  const address = getTaskAddressLine(task);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
}

function getDirectionsHref(tasks) {
  const addresses = tasks
    .map(getTaskAddressLine)
    .filter(Boolean)
    .slice(0, 10);
  if (addresses.length === 0) return '';
  if (addresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addresses[0])}`;
  }
  const destination = addresses[addresses.length - 1];
  const waypoints = addresses.slice(0, -1).join('|');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;
}

function todayLocalDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function taskGpsHistoryDate(task) {
  return taskDateOnly(task?.data_planowana) || taskDateOnly(task?.data_rozpoczecia) || todayLocalDateKey();
}

function buildTaskGpsHistoryParams(task, dateOverride) {
  const params = new URLSearchParams({
    date: dateOverride || taskGpsHistoryDate(task),
    limit: '360',
  });
  if (task?.ekipa_id) params.set('team_id', task.ekipa_id);
  else if (task?.wyceniajacy_id) params.set('user_id', task.wyceniajacy_id);
  else if (task?.uzytkownik_id) params.set('user_id', task.uzytkownik_id);
  else if (task?.vehicle_id) params.set('vehicle_id', task.vehicle_id);
  else if (task?.pojazd_id) params.set('vehicle_id', task.pojazd_id);
  else if (task?.nr_rejestracyjny) params.set('plate_number', task.nr_rejestracyjny);
  else return null;
  return params;
}

function gpsFiniteCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function taskGpsMapUrl(lat, lng) {
  const latN = gpsFiniteCoord(lat);
  const lngN = gpsFiniteCoord(lng);
  if (latN == null || lngN == null) return '';
  return `https://maps.google.com/?q=${latN},${lngN}`;
}

function normalizeTaskGpsHistoryRows(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return items
    .map((row) => ({
      ...row,
      lat: gpsFiniteCoord(row.lat),
      lng: gpsFiniteCoord(row.lng),
      speed_kmh: Number.isFinite(Number(row.speed_kmh)) ? Number(row.speed_kmh) : null,
      accuracy_m: Number.isFinite(Number(row.accuracy_m)) ? Number(row.accuracy_m) : null,
    }))
    .filter((row) => row.lat != null && row.lng != null)
    .sort((a, b) => new Date(a.recorded_at || 0).getTime() - new Date(b.recorded_at || 0).getTime());
}

function taskGpsHistoryRangeLabel(rows) {
  if (!rows.length) return 'brak danych';
  const fmt = (value) => value ? new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  return `${fmt(rows[0]?.recorded_at)} - ${fmt(rows[rows.length - 1]?.recorded_at)}`;
}

function taskGpsHistoryMaxSpeed(rows) {
  const max = rows.reduce((acc, row) => Math.max(acc, Number(row.speed_kmh) || 0), 0);
  return max ? `${Math.round(max)} km/h` : 'brak';
}

function taskGpsHistoryRouteUrl(rows) {
  if (!rows.length) return '';
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (rows.length < 2) return taskGpsMapUrl(last.lat, last.lng);
  return `https://www.google.com/maps/dir/?api=1&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}`;
}

function taskGpsSourceLabel(row) {
  if (!row) return 'brak';
  if (row.provider === 'mobile') return 'telefon';
  if (row.provider === 'juwentus') return 'GPS auta';
  return row.provider || 'GPS';
}

function taskGpsPointLabel(row) {
  const time = row?.recorded_at ? new Date(row.recorded_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const speed = Number.isFinite(Number(row?.speed_kmh)) ? `${Math.round(Number(row.speed_kmh))} km/h` : 'predkosc b.d.';
  return `${time} / ${speed}`;
}

function getDayDistance(day, todayIso) {
  if (!day) return Number.POSITIVE_INFINITY;
  const target = new Date(`${day}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function firstNumericValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function getTaskPhotoSummary(task = {}) {
  const fallbackPhotos = Array.isArray(task.zdjecia) ? task.zdjecia.length : 0;
  const total = firstNumericValue(task.photo_total, task.photos_count, task.zdjecia_count, fallbackPhotos);
  const valuation = firstNumericValue(task.photo_wycena, task.photos_wycena);
  const sketch = firstNumericValue(task.photo_szkic, task.photos_szkic);
  const access = firstNumericValue(task.photo_dojazd, task.photos_dojazd);
  return {
    total,
    valuation,
    sketch,
    access,
    fieldEvidence: valuation + sketch,
  };
}

function formatTaskFieldStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function getTaskFieldExecutionSummary(task = {}, photoSummary = getTaskPhotoSummary(task)) {
  const status = String(task.status || '');
  const activeCount = Number(task.active_work_count || 0) || 0;
  const hasActiveWork = activeCount > 0 || Boolean(task.active_work_started_at);
  const hasCheckin = Boolean(task.last_checkin_at);
  const hasFinishedWork = Boolean(task.last_work_finished_at);
  const needsCrewSignal = [TASK_STATUS.ZAPLANOWANE, TASK_STATUS.W_REALIZACJI].includes(status) && !isTaskClosed(status);
  const photoChecks = [
    { key: 'wycena', label: 'Wycena', count: photoSummary.valuation, required: true },
    { key: 'szkic', label: 'Szkic', count: photoSummary.sketch, required: true },
    { key: 'dojazd', label: 'Dojazd', count: photoSummary.access, required: true },
  ];
  const missingPhotos = photoChecks.filter((item) => item.required && item.count <= 0);

  if (hasActiveWork) {
    return {
      tone: missingPhotos.length ? 'warning' : 'good',
      label: 'Praca trwa',
      detail: `start ${formatTaskFieldStamp(task.active_work_started_at) || 'z mobilki'}`,
      photoChecks,
      missingPhotos,
    };
  }
  if (hasFinishedWork || isTaskClosed(status)) {
    return {
      tone: missingPhotos.length ? 'warning' : 'good',
      label: 'Teren zamkniety',
      detail: hasFinishedWork ? `koniec ${formatTaskFieldStamp(task.last_work_finished_at)}` : 'status zamkniety',
      photoChecks,
      missingPhotos,
    };
  }
  if (hasCheckin) {
    return {
      tone: missingPhotos.length ? 'warning' : 'good',
      label: 'Dojechali',
      detail: `check-in ${formatTaskFieldStamp(task.last_checkin_at)}`,
      photoChecks,
      missingPhotos,
    };
  }
  if (needsCrewSignal) {
    return {
      tone: 'danger',
      label: 'Brak check-in',
      detail: 'ekipa nie potwierdzila miejsca',
      photoChecks,
      missingPhotos,
    };
  }
  if (status === TASK_STATUS.DO_ZATWIERDZENIA) {
    return {
      tone: missingPhotos.length ? 'warning' : 'good',
      label: 'Czeka na plan',
      detail: missingPhotos.length ? `brakuje: ${missingPhotos.map((item) => item.label).join(', ')}` : 'pakiet terenowy gotowy',
      photoChecks,
      missingPhotos,
    };
  }
  if (status === TASK_STATUS.WYCENA_TERENOWA) {
    return {
      tone: missingPhotos.length ? 'warning' : 'good',
      label: 'U specjalisty ds. wyceny',
      detail: missingPhotos.length ? 'zbieramy zdjecia i szkic' : 'zdjecia terenowe sa',
      photoChecks,
      missingPhotos,
    };
  }
  return {
    tone: 'muted',
    label: 'Przed terenem',
    detail: 'jeszcze bez pracy ekipy',
    photoChecks,
    missingPhotos,
  };
}

function getTaskWorkflowMissingFromApi(task = {}) {
  const rawItems = Array.isArray(task.workflow_missing_items) ? task.workflow_missing_items : [];
  const labels = Array.isArray(task.workflow_missing_labels) ? task.workflow_missing_labels : [];
  const items = [
    ...rawItems.map((item) => ({
      key: String(item?.key || item?.label || '').trim(),
      label: String(item?.label || item?.key || '').trim(),
      required: item?.required !== false,
    })),
    ...labels.map((label) => ({
      key: String(label || '').trim(),
      label: String(label || '').trim(),
      required: true,
    })),
  ].filter((item) => item.label);

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.key || item.label}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTaskReadinessChecksFromApi(task = {}, field = '') {
  const rows = Array.isArray(task?.[field]) ? task[field] : [];
  return rows
    .map((row) => {
      const key = String(row?.key || '').trim();
      const label = String(row?.label || key || '').trim();
      if (!label) return null;
      const ok = row?.ready === true || row?.ok === true;
      return {
        key: key || label,
        label,
        detail: row?.value != null ? String(row.value) : ok ? 'OK' : 'brak',
        ok,
        required: row?.required !== false,
      };
    })
    .filter(Boolean);
}

function getTaskPackageReadiness(task = {}, type = 'office') {
  const isOffice = type === 'office';
  const checks = getTaskReadinessChecksFromApi(task, isOffice ? 'office_plan_checks' : 'crew_execution_checks');
  const readyFlag = isOffice ? task.office_plan_ready : task.crew_execution_ready;
  const readyCountRaw = Number(isOffice ? task.office_plan_ready_count : task.crew_execution_ready_count);
  const totalCountRaw = Number(isOffice ? task.office_plan_total_count : task.crew_execution_total_count);
  const missingItems = Array.isArray(isOffice ? task.office_plan_missing_items : task.crew_execution_missing_items)
    ? (isOffice ? task.office_plan_missing_items : task.crew_execution_missing_items)
    : [];
  const missingLabels = Array.isArray(isOffice ? task.office_plan_missing_labels : task.crew_execution_missing_labels)
    ? (isOffice ? task.office_plan_missing_labels : task.crew_execution_missing_labels)
    : [];
  const missing = [
    ...missingItems.map((item) => String(item?.label || item?.key || '').trim()),
    ...missingLabels.map((label) => String(label || '').trim()),
  ].filter(Boolean);
  const fallbackMissing = checks.filter((item) => !item.ok).map((item) => item.label);
  const uniqueMissing = uniqueTextValues([...missing, ...fallbackMissing]);
  const total = Number.isFinite(totalCountRaw) && totalCountRaw > 0 ? totalCountRaw : checks.length;
  const readyCount = Number.isFinite(readyCountRaw) && readyCountRaw >= 0
    ? readyCountRaw
    : checks.filter((item) => item.ok).length;
  const ready = readyFlag === true || (total > 0 && readyCount >= total && uniqueMissing.length === 0);
  const relevantStatuses = isOffice
    ? [TASK_STATUS.DO_ZATWIERDZENIA, TASK_STATUS.ZAPLANOWANE, TASK_STATUS.W_REALIZACJI]
    : [TASK_STATUS.ZAPLANOWANE, TASK_STATUS.W_REALIZACJI];
  const relevant = relevantStatuses.includes(String(task.status || '')) && !isTaskClosed(task.status);
  const score = total > 0 ? Math.round((Math.min(readyCount, total) / total) * 100) : (ready ? 100 : 0);
  const leadMissing = uniqueMissing[0] || '';
  return {
    type,
    relevant,
    ready,
    score,
    readyCount,
    total,
    missing: uniqueMissing,
    label: isOffice ? 'Pakiet biura' : 'Pakiet ekipy',
    status: ready ? 'OK' : leadMissing || 'do sprawdzenia',
    tone: ready ? 'good' : uniqueMissing.length ? 'danger' : 'warning',
  };
}

function taskWorkflowBlockerTone(item) {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('phone') || key.includes('telefon') || key.includes('client') || key.includes('klient')) return 'danger';
  return 'warning';
}

function normalizeTaskWorkflowBlockerKey(item) {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('phone') || key.includes('telefon')) return 'noContact';
  if (key.includes('team') || key.includes('ekipa')) return 'unassigned';
  if (key.includes('date') || key.includes('termin')) return 'noDate';
  if (key.includes('price') || key.includes('cena') || key.includes('budzet') || key.includes('budżet')) return 'noPrice';
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdję')) return 'noMedia';
  if (key.includes('sketch') || key.includes('szkic')) return 'noFieldSketch';
  if (key.includes('estimator') || key.includes('wyceniacz') || key.includes('specjalista ds. wyceny')) return 'estimator';
  if (key.includes('brief') || key.includes('opis') || key.includes('zakres')) return 'brief';
  return `api_${key || 'workflow'}`.replace(/\s+/g, '_');
}

function getTaskWorkflowStageFromApi(task = {}) {
  if (!task.workflow_stage && !task.workflow_stage_label) return null;
  const status = String(task.status || '');
  let tone = 'blue';
  if (task.workflow_blockers_count > 0) tone = 'warning';
  else if (status === TASK_STATUS.ANULOWANE) tone = 'danger';
  else if (isTaskClosed(status)) tone = 'good';
  else if ([TASK_STATUS.DO_ZATWIERDZENIA, TASK_STATUS.ZAPLANOWANE].includes(status)) tone = 'good';

  return {
    key: task.workflow_stage || status || 'workflow',
    step: task.workflow_stage_step || '',
    label: task.workflow_stage_label || status || 'Workflow',
    detail: task.workflow_stage_detail || task.workflow_next_action || '',
    tone,
  };
}

function getTaskDiagnostics(task, todayIso) {
  const day = getTaskDay(task);
  const status = String(task.status || '');
  const isClosed = isTaskClosed(status);
  const photos = getTaskPhotoSummary(task);
  const fieldExecution = getTaskFieldExecutionSummary(task, photos);
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(status);
  const needsFieldEvidence = FIELD_EVIDENCE_REQUIRED_TASK_STATUSES.has(status);
  const needsPrice = PRICE_REQUIRED_TASK_STATUSES.has(status);
  const hasPrice = Boolean(Number(task.wartosc_planowana) || Number(task.budzet));
  const has = {
    overdue: Boolean(day && day < todayIso && !isClosed),
    unassigned: Boolean(!task.ekipa_id && needsCrew && !isClosed),
    urgent: Boolean(task.priorytet === 'Pilny' && !isClosed),
    today: Boolean(day === todayIso && !isClosed),
    noDate: Boolean(!day && !isClosed),
    noContact: Boolean(!String(task.klient_telefon || '').trim() && !isClosed),
    noMedia: Boolean(photos.total === 0 && needsFieldEvidence && !isClosed),
    noFieldSketch: Boolean(photos.total > 0 && photos.fieldEvidence === 0 && needsFieldEvidence && !isClosed),
    noPrice: Boolean(!hasPrice && needsPrice && !isClosed),
    noCheckin: Boolean(fieldExecution.label === 'Brak check-in' && !isClosed),
    fieldActive: Boolean(fieldExecution.label === 'Praca trwa' && !isClosed),
  };

  const localBlockers = [
    has.noContact ? { key: 'noContact', label: 'Brak telefonu', tone: 'danger' } : null,
    has.unassigned ? { key: 'unassigned', label: 'Brak ekipy', tone: 'warning' } : null,
    has.noDate ? { key: 'noDate', label: 'Brak terminu', tone: 'warning' } : null,
    has.noCheckin ? { key: 'noCheckin', label: 'Brak check-in', tone: 'danger' } : null,
    has.noMedia ? { key: 'noMedia', label: 'Brak zdjęć', tone: 'warning' } : null,
    has.noFieldSketch ? { key: 'noFieldSketch', label: 'Brak wyceny/szkicu', tone: 'warning' } : null,
    has.noPrice ? { key: 'noPrice', label: 'Brak ceny', tone: 'warning' } : null,
  ].filter(Boolean);
  const apiBlockers = getTaskWorkflowMissingFromApi(task)
    .filter((item) => item.required !== false)
    .map((item) => ({
      key: normalizeTaskWorkflowBlockerKey(item),
      label: item.label,
      tone: taskWorkflowBlockerTone(item),
    }));
  const blockerSeen = new Set();
  const blockers = [...localBlockers, ...apiBlockers].filter((item) => {
    const key = String(item.key || item.label || '').toLowerCase();
    if (blockerSeen.has(key)) return false;
    blockerSeen.add(key);
    return true;
  });

  const risks = [
    has.overdue ? { key: 'overdue', label: 'Po terminie', tone: 'danger' } : null,
    has.urgent ? { key: 'urgent', label: 'Pilne', tone: 'warning' } : null,
  ].filter(Boolean);

  const readyToClose = isTaskInProgress(status) && blockers.length === 0;
  const readyForOfficeApproval = status === TASK_STATUS.WYCENA_TERENOWA && blockers.length === 0;
  const readyForCrewPlan = status === TASK_STATUS.DO_ZATWIERDZENIA && blockers.length === 0;
  const score = Math.max(
    0,
    100 -
      blockers.length * 22 -
      risks.length * 12 -
      (status === TASK_STATUS.NOWE && !isClosed ? 8 : 0)
  );

  let nextAction = { label: task.workflow_next_action || 'Otwórz szczegóły', target: 'details' };
  if (blockers.length) {
    const first = blockers[0];
    const key = String(first.key || first.label || '').toLowerCase();
    const isOfficePlanBlocker = status === TASK_STATUS.DO_ZATWIERDZENIA && (
      key.includes('unassigned') ||
      key.includes('team') ||
      key.includes('ekip') ||
      key.includes('date') ||
      key.includes('termin') ||
      key.includes('time') ||
      key.includes('godzin') ||
      key.includes('hours') ||
      key.includes('czas')
    );
    nextAction = {
      label: `Uzupełnij: ${first.label}`,
      target: key.includes('media') || key.includes('photo') || key.includes('sketch') || key.includes('zdj') || key.includes('szkic')
        ? 'photos'
        : isOfficePlanBlocker
          ? 'officePlan'
          : 'edit',
    };
  }
  else if (has.noContact) nextAction = { label: 'Uzupełnij kontakt', target: 'edit' };
  else if (has.unassigned) nextAction = { label: 'Przypisz ekipę', target: status === TASK_STATUS.DO_ZATWIERDZENIA ? 'officePlan' : 'edit' };
  else if (has.noDate) nextAction = { label: 'Ustal termin', target: status === TASK_STATUS.DO_ZATWIERDZENIA ? 'officePlan' : 'edit' };
  else if (has.noMedia || has.noFieldSketch) nextAction = { label: 'Dodaj zdjęcia', target: 'photos' };
  else if (has.noPrice) nextAction = { label: 'Uzupełnij wycenę', target: 'edit' };
  else if (status === TASK_STATUS.NOWE && has.overdue) nextAction = { label: 'Przeplanuj oględziny', target: 'edit' };
  else if (status === TASK_STATUS.NOWE) nextAction = { label: 'Wyślij do specjalisty ds. wyceny', target: 'status', nextStatus: TASK_STATUS.WYCENA_TERENOWA };
  else if (readyForOfficeApproval) nextAction = { label: 'Klient akceptuje', target: 'status', nextStatus: TASK_STATUS.DO_ZATWIERDZENIA };
  else if (readyForCrewPlan) nextAction = { label: 'Zatwierdź plan ekipy', target: 'status', nextStatus: TASK_STATUS.ZAPLANOWANE };
  else if (status === TASK_STATUS.ZAPLANOWANE && has.overdue) nextAction = { label: 'Przeplanuj termin ekipy', target: 'edit' };
  else if (status === TASK_STATUS.ZAPLANOWANE) nextAction = { label: 'Rozpocznij realizację', target: 'status', nextStatus: TASK_STATUS.W_REALIZACJI };
  else if (readyToClose) nextAction = { label: 'Zamknij zlecenie', target: 'status', nextStatus: TASK_STATUS.ZAKONCZONE };
  else if (has.overdue) nextAction = { label: 'Przeplanuj termin', target: 'edit' };

  return {
    day,
    has: { ...has, readyClose: readyToClose, readyForOfficeApproval, readyForCrewPlan },
    items: [...blockers, ...risks],
    blockers,
    risks,
    readyToClose,
    readyForOfficeApproval,
    readyForCrewPlan,
    score,
    photos,
    level: blockers.length || has.overdue ? 'danger' : has.urgent || score < 85 ? 'warning' : 'good',
    nextAction,
  };
}

function getTaskInspectionWorkflow(task = {}, diagnostics = null) {
  const apiStage = getTaskWorkflowStageFromApi(task);
  if (apiStage) return apiStage;

  const status = String(task.status || '');
  const photos = diagnostics?.photos || getTaskPhotoSummary(task);
  const isClosed = isTaskClosed(status);
  const hasTeam = Boolean(task.ekipa_id || task.ekipa_nazwa);
  const hasPrice = Boolean(Number(task.wartosc_planowana) || Number(task.budzet));
  const hasFieldPackage = photos.total > 0 && hasPrice;

  if (status === TASK_STATUS.ANULOWANE) {
    return { key: 'cancelled', step: 'X', label: 'Anulowane', detail: 'Zlecenie wycofane', tone: 'danger' };
  }
  if (isClosed) {
    return { key: 'done', step: '6', label: 'Zamknięte', detail: 'Praca zakończona i rozliczana', tone: 'good' };
  }
  if (isTaskInProgress(status)) {
    return { key: 'execution', step: '5', label: 'Praca brygady', detail: 'Ekipa realizuje lub kończy pracę', tone: 'blue' };
  }
  if (status === TASK_STATUS.ZAPLANOWANE) {
    return { key: 'crewPlan', step: '4', label: 'Plan ekipy', detail: 'Biuro zatwierdziło termin i obsadę brygady', tone: 'blue' };
  }
  if (status === TASK_STATUS.DO_ZATWIERDZENIA || (!status && hasFieldPackage && hasTeam)) {
    return { key: 'officeApproval', step: '3', label: 'Biuro zatwierdza', detail: 'Klient zaakceptował, biuro dopina ekipę i termin', tone: 'good' };
  }
  if (status === TASK_STATUS.WYCENA_TERENOWA) {
    return { key: 'fieldInspection', step: '2', label: 'Oględziny / wycena', detail: 'Specjalista ds. wyceny zbiera zdjęcia, zakres i cenę', tone: 'warning' };
  }
  return { key: 'intake', step: '1', label: 'Biuro umawia', detail: 'Telefon, adres i termin oględzin', tone: 'muted' };
}

function getTaskStageOwnerSummary(task = {}, diagnostics = null, workflowStage = null) {
  const status = String(task.status || '');
  const has = diagnostics?.has || {};
  const hasBlockers = Boolean(diagnostics?.blockers?.length);
  const hasRisks = Boolean(diagnostics?.risks?.length);
  const baseTone = hasBlockers ? 'danger' : hasRisks ? 'warning' : workflowStage?.tone || 'good';
  const action = diagnostics?.nextAction || { label: 'Otwórz szczegóły', target: 'details' };

  if (status === TASK_STATUS.ANULOWANE) {
    return {
      owner: 'Biuro',
      nextOwner: 'Archiwum',
      title: 'Zlecenie anulowane',
      detail: 'Sprawdź powód anulowania i kontakt z klientem.',
      tone: 'danger',
      action,
    };
  }
  if (isTaskClosed(status)) {
    return {
      owner: 'Biuro / kierownik',
      nextOwner: 'Rozliczenie',
      title: 'Po wykonaniu',
      detail: 'Zostaje kontrola dokumentów, rozliczenie i historia klienta.',
      tone: 'good',
      action,
    };
  }
  if (isTaskInProgress(status)) {
    return {
      owner: 'Ekipa w terenie',
      nextOwner: 'Biuro / kierownik',
      title: 'Wykonanie pracy',
      detail: 'Ekipa pracuje według briefu i zgłasza problemy z terenu.',
      tone: hasBlockers ? 'danger' : 'blue',
      action,
    };
  }
  if (status === TASK_STATUS.ZAPLANOWANE) {
    return {
      owner: 'Brygadzista',
      nextOwner: 'Ekipa w terenie',
      title: 'Odprawa ekipy',
      detail: has.overdue ? 'Termin wymaga przeplanowania przed startem.' : 'Brief, zdjęcia, ryzyka i sprzęt powinny być gotowe dla brygady.',
      tone: has.overdue ? 'danger' : baseTone,
      action,
    };
  }
  if (status === TASK_STATUS.DO_ZATWIERDZENIA) {
    return {
      owner: 'Biuro / kierownik',
      nextOwner: 'Brygadzista',
      title: 'Plan po akceptacji',
      detail: has.unassigned || has.noDate ? 'Dopnij ekipę, termin, godzinę i sprzęt.' : 'Plan jest gotowy do przekazania ekipie.',
      tone: baseTone,
      action,
    };
  }
  if (status === TASK_STATUS.WYCENA_TERENOWA) {
    return {
      owner: 'Specjalista ds. wyceny',
      nextOwner: 'Biuro',
      title: 'Pakiet z oględzin',
      detail: has.noMedia || has.noFieldSketch || has.noPrice
        ? 'Potrzebne zdjęcia, szkic, zakres, czas i budżet z terenu.'
        : 'Pakiet z oględzin może wrócić do biura.',
      tone: baseTone,
      action,
    };
  }
  return {
    owner: 'Specjalista biura',
    nextOwner: 'Specjalista ds. wyceny',
    title: 'Telefon i oględziny',
    detail: has.noContact || has.noDate ? 'Domknij kontakt, adres, termin i specjalistę ds. wyceny.' : 'Gotowe do wysłania na oględziny.',
    tone: baseTone,
    action,
  };
}

function getTaskQueueMeta(task, todayIso) {
  const diagnostics = getTaskDiagnostics(task, todayIso);
  const daysLeft = getDayDistance(diagnostics.day, todayIso);
  const value = Number(task.wartosc_planowana) || 0;
  let score = 0;
  const reasons = [];

  if (diagnostics.has.noContact) {
    score += 42;
    reasons.push('brak telefonu');
  }
  if (diagnostics.has.overdue) {
    score += 38 + Math.min(24, Math.abs(daysLeft) * 3);
    reasons.push('po terminie');
  }
  if (diagnostics.has.unassigned) {
    score += 32;
    reasons.push('brak ekipy');
  }
  if (diagnostics.has.noDate) {
    score += 24;
    reasons.push('brak terminu');
  }
  if (diagnostics.has.noMedia) {
    score += 28;
    reasons.push('brak zdjęć');
  } else if (diagnostics.has.noFieldSketch) {
    score += 16;
    reasons.push('brak szkicu');
  }
  if (diagnostics.has.noPrice) {
    score += 20;
    reasons.push('brak wyceny');
  }
  if (diagnostics.has.urgent) {
    score += 22;
    reasons.push('pilne');
  }
  if (diagnostics.has.today) {
    score += 18;
    reasons.push('dzisiaj');
  }
  if (diagnostics.readyToClose) {
    score += 16;
    reasons.push('do zamknięcia');
  }
  if (isTaskInProgress(task.status)) score += 8;
  score += Math.min(18, value / 1000);

  return {
    diagnostics,
    daysLeft,
    value,
    score,
    reasons: reasons.slice(0, 3),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTaskBusinessMeta(task, todayIso, contact = {}) {
  const diagnostics = getTaskDiagnostics(task, todayIso);
  const followup = getContactFollowupMeta(contact);
  const value = Number(task.wartosc_planowana) || 0;
  const minimum = Number(task.kwota_minimalna) || 0;
  const budget = Number(task.budzet) || 0;
  const plannedHours = Number(task.czas_planowany_godziny) || 0;
  const bufferBase = minimum || budget;
  const buffer = value && bufferBase ? value - bufferBase : null;
  const revenuePerHour = value && plannedHours ? value / plannedHours : null;
  const flags = [];
  let riskWeight = 0;

  if (diagnostics.has.overdue) {
    riskWeight += 0.3;
    flags.push('po terminie');
  }
  if (diagnostics.has.unassigned) {
    riskWeight += 0.24;
    flags.push('brak ekipy');
  }
  if (diagnostics.has.noDate) {
    riskWeight += 0.18;
    flags.push('brak terminu');
  }
  if (diagnostics.has.noContact) {
    riskWeight += 0.16;
    flags.push('brak telefonu');
  }
  if (diagnostics.has.noMedia) {
    riskWeight += 0.24;
    flags.push('brak zdjęć');
  } else if (diagnostics.has.noFieldSketch) {
    riskWeight += 0.12;
    flags.push('brak szkicu/wyceny');
  }
  if (diagnostics.has.noPrice) {
    riskWeight += 0.18;
    flags.push('brak wyceny');
  }
  if (diagnostics.has.urgent) {
    riskWeight += 0.12;
    flags.push('pilne');
  }
  if (contact.status === 'risk') {
    riskWeight += 0.32;
    flags.push('ryzyko kontaktu');
  }
  if (contact.status === 'waiting') {
    riskWeight += 0.1;
    flags.push('czeka na klienta');
  }
  if (followup.overdue) {
    riskWeight += 0.22;
    flags.push('follow-up po terminie');
  } else if (followup.today) {
    riskWeight += 0.08;
    flags.push('follow-up dziś');
  }
  if (buffer !== null && buffer < 0) {
    riskWeight += 0.2;
    flags.push('poniżej minimum');
  }
  if (diagnostics.readyToClose) {
    riskWeight = Math.max(0, riskWeight - 0.08);
  }

  const normalizedRisk = clamp(riskWeight, 0, 0.95);
  return {
    diagnostics,
    followup,
    value,
    minimum,
    budget,
    plannedHours,
    buffer,
    bufferRatio: buffer !== null && value ? buffer / value : null,
    revenuePerHour,
    flags,
    riskScore: Math.round(normalizedRisk * 100),
    riskValue: Math.round(value * normalizedRisk),
    severity: normalizedRisk >= 0.5 || (buffer !== null && buffer < 0) ? 'danger' : normalizedRisk >= 0.22 ? 'warning' : 'good',
  };
}

function buildBusinessGuardSummary(tasks, todayIso, getContact) {
  const rows = tasks.map((task) => ({
    task,
    meta: getTaskBusinessMeta(task, todayIso, getContact(task.id)),
  }));
  const totalValue = rows.reduce((sum, row) => sum + row.meta.value, 0);
  const riskValue = rows.reduce((sum, row) => sum + row.meta.riskValue, 0);
  const readyRows = rows.filter((row) => row.meta.diagnostics.readyToClose);
  const readyValue = readyRows.reduce((sum, row) => sum + row.meta.value, 0);
  const criticalRows = rows.filter((row) => row.meta.severity === 'danger');
  const totalHours = rows.reduce((sum, row) => sum + row.meta.plannedHours, 0);
  const pricedHoursValue = rows.reduce((sum, row) => row.meta.plannedHours ? sum + row.meta.value : sum, 0);
  const bufferRows = rows.filter((row) => row.meta.buffer !== null);
  const totalBuffer = bufferRows.reduce((sum, row) => sum + row.meta.buffer, 0);
  const avgReadiness = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.meta.diagnostics.score, 0) / rows.length)
    : 100;
  const riskRatio = totalValue ? riskValue / totalValue : 0;
  const health = riskRatio >= 0.35 || criticalRows.length >= 3
    ? 'danger'
    : riskRatio >= 0.16 || criticalRows.length
      ? 'warning'
      : 'good';

  const topRisks = rows
    .filter((row) => row.meta.riskScore > 0 || row.meta.riskValue > 0)
    .sort((a, b) => {
      if (b.meta.riskValue !== a.meta.riskValue) return b.meta.riskValue - a.meta.riskValue;
      return b.meta.riskScore - a.meta.riskScore;
    })
    .slice(0, 3);

  return {
    rows,
    totalValue,
    riskValue,
    riskRatio,
    readyCount: readyRows.length,
    readyValue,
    criticalCount: criticalRows.length,
    avgReadiness,
    totalBuffer,
    hasBuffer: bufferRows.length > 0,
    revenuePerHour: totalHours ? pricedHoursValue / totalHours : null,
    health,
    healthLabel: health === 'danger' ? 'Alarm' : health === 'warning' ? 'Uwaga' : 'Stabilnie',
    topRisks,
    signals: [
      {
        key: 'overdue',
        label: 'Po terminie',
        count: rows.filter((row) => row.meta.diagnostics.has.overdue).length,
        value: rows.filter((row) => row.meta.diagnostics.has.overdue).reduce((sum, row) => sum + row.meta.value, 0),
        filter: 'overdue',
      },
      {
        key: 'unassigned',
        label: 'Bez ekipy',
        count: rows.filter((row) => row.meta.diagnostics.has.unassigned).length,
        value: rows.filter((row) => row.meta.diagnostics.has.unassigned).reduce((sum, row) => sum + row.meta.value, 0),
        filter: 'unassigned',
      },
      {
        key: 'contactOverdue',
        label: 'Kontakt po terminie',
        count: rows.filter((row) => row.meta.followup.overdue).length,
        value: rows.filter((row) => row.meta.followup.overdue).reduce((sum, row) => sum + row.meta.value, 0),
        filter: 'contactOverdue',
      },
      {
        key: 'readyClose',
        label: 'Do zamknięcia',
        count: readyRows.length,
        value: readyValue,
        filter: 'readyClose',
      },
    ],
  };
}

function getTaskPriceGuidance(task, meta) {
  const value = meta?.value || 0;
  const minimum = meta?.minimum || 0;
  const budget = meta?.budget || 0;
  const plannedHours = meta?.plannedHours || 0;
  const revenuePerHour = meta?.revenuePerHour || 0;
  const base = Math.max(minimum, budget);
  const recommended = base ? Math.max(value, Math.ceil(base * 1.08 / 50) * 50) : value;
  const buffer = base ? value - base : null;
  const minLabel = minimum ? 'kwoty minimalnej' : budget ? 'budżetu' : 'braku progu';

  if (!value && !base) {
    return {
      tone: 'warning',
      label: 'Brak danych ceny',
      detail: 'Uzupełnij wartość zlecenia oraz minimum lub budżet, żeby system pilnował marży.',
      recommended: null,
      buffer: null,
      revenuePerHour: null,
      minLabel,
    };
  }

  if (base && value < base) {
    return {
      tone: 'danger',
      label: 'Cena poniżej minimum',
      detail: `Zlecenie jest poniżej ${minLabel}; podnieś cenę albo oznacz wyjątek w notatce.`,
      recommended,
      buffer,
      revenuePerHour,
      minLabel,
    };
  }

  if (base && value < recommended) {
    return {
      tone: 'warning',
      label: 'Cena bez bufora',
      detail: `Cena spełnia próg, ale bufor jest mały. Rekomendacja daje około 8% zapasu.`,
      recommended,
      buffer,
      revenuePerHour,
      minLabel,
    };
  }

  return {
    tone: 'good',
    label: base ? 'Cena bezpieczna' : 'Cena wpisana',
    detail: plannedHours && revenuePerHour
      ? 'Cena jest spójna z progiem i ma policzoną stawkę godzinową.'
      : 'Cena jest wpisana; dodaj plan godzin, żeby pilnować stawki pracy.',
    recommended: recommended || value || null,
    buffer,
    revenuePerHour,
    minLabel,
  };
}

function getTaskQualityChecklist(task, meta, contact = {}) {
  const diagnostics = meta?.diagnostics || getTaskDiagnostics(task, new Date().toISOString().slice(0, 10));
  const photos = diagnostics.photos || getTaskPhotoSummary(task);
  const price = getTaskPriceGuidance(task, meta || getTaskBusinessMeta(task, new Date().toISOString().slice(0, 10), contact));
  const status = String(task.status || '');
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(status);
  const needsFieldEvidence = FIELD_EVIDENCE_REQUIRED_TASK_STATUSES.has(status);
  const needsPrice = PRICE_REQUIRED_TASK_STATUSES.has(status);
  const hasPrice = Boolean(Number(task.wartosc_planowana) || Number(task.budzet));
  return [
    {
      key: 'phone',
      label: 'Telefon klienta',
      detail: task.klient_telefon ? task.klient_telefon : 'brak numeru do klienta',
      ok: Boolean(String(task.klient_telefon || '').trim()),
      required: true,
    },
    {
      key: 'address',
      label: 'Adres realizacji',
      detail: getTaskAddressLine(task) || 'brak adresu do trasy',
      ok: Boolean(getTaskAddressLine(task)),
      required: true,
    },
    {
      key: 'date',
      label: 'Termin',
      detail: diagnostics.day || 'brak daty planowanej',
      ok: Boolean(diagnostics.day),
      required: true,
    },
    {
      key: 'team',
      label: 'Ekipa',
      detail: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'brak przypisanej ekipy'),
      ok: !needsCrew || Boolean(task.ekipa_id || task.ekipa_nazwa),
      required: needsCrew,
    },
    {
      key: 'media',
      label: 'Zdjęcia z wyceny',
      detail: photos.total ? `${photos.total} zdjęć, ${photos.fieldEvidence} wycena/szkic` : 'brak dowodu zdjęciowego',
      ok: !needsFieldEvidence || photos.total > 0,
      required: needsFieldEvidence,
    },
    {
      key: 'field-sketch',
      label: 'Szkic zakresu',
      detail: photos.fieldEvidence ? `${photos.valuation} wycena, ${photos.sketch} szkic` : 'brak szkicu lub zdjęcia z zakresem',
      ok: !needsFieldEvidence || photos.fieldEvidence > 0,
      required: false,
    },
    {
      key: 'contact',
      label: 'Status klienta',
      detail: getClientContactOption(contact.status).label,
      ok: contact.status === 'informed' || contact.status === 'waiting',
      required: false,
    },
    {
      key: 'price',
      label: 'Cena i minimum',
      detail: price.label,
      ok: !needsPrice || (hasPrice && price.tone !== 'danger'),
      required: needsPrice,
    },
    {
      key: 'hours',
      label: 'Plan godzin',
      detail: task.czas_planowany_godziny ? `${task.czas_planowany_godziny} h` : 'brak planu godzin',
      ok: Boolean(Number(task.czas_planowany_godziny)),
      required: false,
    },
    {
      key: 'brief',
      label: 'Opis lub wynik',
      detail: task.opis_pracy || task.wynik ? 'jest kontekst dla ekipy' : 'brak opisu pracy i wyniku rozmowy',
      ok: Boolean(task.opis_pracy || task.wynik),
      required: false,
    },
  ];
}

function getTaskEquipmentList(task) {
  const presetEquipment = [
    ['Rębak', task.rebak],
    ['Piła na wysięgniku', task.pila_wysiegniku],
    ['Nożyce długie', task.nozyce_dlugie],
    ['Kosiarka', task.kosiarka],
    ['Podkaszarka', task.podkaszarka],
    ['Łopata', task.lopata],
    ['Mulczer', task.mulczer],
  ].filter(([, enabled]) => Boolean(enabled)).map(([label]) => label);
  return uniqueTextValues([...presetEquipment, ...getTaskReservedEquipmentList(task)]);
}

function getTaskEquipmentReservations(task) {
  const rows = Array.isArray(task?.equipment_reservations)
    ? task.equipment_reservations
    : Array.isArray(task?.rezerwacje_sprzetu)
      ? task.rezerwacje_sprzetu
      : [];
  return rows.filter((row) => {
    const status = String(row?.status || '').toLowerCase();
    return !status.startsWith('anul') && !status.startsWith('zwr');
  });
}

function getTaskReservedEquipmentList(task) {
  return getTaskEquipmentReservations(task)
    .map((row) => row?.sprzet_nazwa || row?.nazwa_sprzetu || (row?.sprzet_id ? `Sprzet #${row.sprzet_id}` : ''))
    .filter(Boolean);
}

function getTaskReservedEquipmentIds(task) {
  return getTaskEquipmentReservations(task)
    .map((row) => row?.sprzet_id)
    .filter((id) => id !== null && id !== undefined && id !== '')
    .map(String);
}

function uniqueTextValues(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTaskSafetyChecklist(task, meta, contact = {}) {
  const diagnostics = meta?.diagnostics || getTaskDiagnostics(task, new Date().toISOString().slice(0, 10));
  const equipment = getTaskEquipmentList(task);
  const arboristWork = ['Wycinka', 'Pielęgnacja'].includes(task.typ_uslugi) || Boolean(task.arborysta);
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(String(task.status || ''));
  return [
    {
      key: 'address',
      label: 'Adres i dojazd',
      ok: Boolean(getTaskAddressLine(task)),
      detail: getTaskAddressLine(task) || 'Brak adresu do mapy i odprawy.',
      required: true,
    },
    {
      key: 'team',
      label: 'Ekipa',
      ok: !needsCrew || Boolean(task.ekipa_id || task.ekipa_nazwa),
      detail: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Brak przypisanej ekipy.'),
      required: needsCrew,
    },
    {
      key: 'brief',
      label: 'Odprawa pracy',
      ok: Boolean(task.opis_pracy || task.wynik),
      detail: task.opis_pracy || task.wynik || 'Brak jasnego opisu dla brygady.',
      required: true,
    },
    {
      key: 'arborist',
      label: 'BHP arborysty',
      ok: !arboristWork || Boolean(task.arborysta),
      detail: arboristWork
        ? (task.arborysta ? 'Wymagany arborysta oznaczony.' : 'Praca drzewna bez oznaczenia arborysty.')
        : 'Brak specjalnego wymogu arborystycznego.',
      required: arboristWork,
    },
    {
      key: 'equipment',
      label: 'Sprzęt',
      ok: equipment.length > 0 || !arboristWork,
      detail: equipment.length ? equipment.join(', ') : 'Sprzęt nie został doprecyzowany.',
      required: false,
    },
    {
      key: 'client',
      label: 'Kontakt klienta',
      ok: contact.status === 'informed' || contact.status === 'waiting' || Boolean(task.klient_telefon),
      detail: getClientContactOption(contact.status).label,
      required: false,
    },
    {
      key: 'close',
      label: 'Gotowość zamknięcia',
      ok: diagnostics.readyToClose,
      detail: diagnostics.readyToClose ? 'Można przejść do finalnej kontroli.' : diagnostics.nextAction.label,
      required: false,
    },
  ];
}

function getTaskDecisionRecommendation(task, meta, checklist, contact = {}) {
  const missingRequired = checklist.filter((item) => item.required && !item.ok);
  const price = getTaskPriceGuidance(task, meta);
  if (price.tone === 'danger') return 'Najpierw popraw cenę lub zatwierdź wyjątek, bo zlecenie schodzi poniżej progu.';
  if (contact.status === 'risk') return 'Najpierw wyjaśnij ryzyko kontaktu z klientem.';
  if (meta?.followup?.overdue) return 'Oddzwoń do klienta, follow-up jest po terminie.';
  if (missingRequired.length) return `Domknij blokadę: ${missingRequired[0].label.toLowerCase()}.`;
  if (meta?.diagnostics?.readyToClose) return 'Zlecenie wygląda gotowo do zamknięcia po finalnej kontroli jakości.';
  return meta?.diagnostics?.nextAction?.label || 'Otwórz szczegóły i przejdź po checklistach.';
}

function getTaskDetailActionDetail(action, task, meta, missingItem = null) {
  if (!action) return 'Sprawdź kartę zlecenia i wybierz kolejny krok.';
  if (missingItem?.detail) return missingItem.detail;
  if (action.target === 'photos') return 'Dodaj brakujące zdjęcia, szkic albo dokumentację z terenu.';
  if (action.target === 'contact') return 'Zapisz kontakt z klientem i kolejny termin follow-upu.';
  if (action.target === 'officePlan') return 'Uzupełnij termin, ekipę i czas pracy w planie biura.';
  if (action.target === 'edit') return 'Otwórz formularz i uzupełnij wskazane pole w karcie zlecenia.';
  if (action.target === 'status') {
    if (action.nextStatus === TASK_STATUS.ZAKONCZONE) {
      return 'Zlecenie jest kompletne. Zrób finalną kontrolę jakości i zamknij rozliczenie.';
    }
    if (action.nextStatus === TASK_STATUS.W_REALIZACJI) {
      return 'Plan jest gotowy dla ekipy. Potwierdź start pracy w terenie.';
    }
    if (action.nextStatus === TASK_STATUS.ZAPLANOWANE) {
      return 'Plan biura jest gotowy. Zatwierdź termin i przekaż odprawę ekipie.';
    }
    if (action.nextStatus === TASK_STATUS.DO_ZATWIERDZENIA) {
      return 'Pakiet z oględzin jest kompletny. Przekaż zlecenie do decyzji klienta i biura.';
    }
    if (action.nextStatus === TASK_STATUS.WYCENA_TERENOWA) {
      return 'Dane kontaktowe są gotowe. Przekaż temat specjaliście ds. wyceny.';
    }
  }
  if (meta?.diagnostics?.readyToClose) {
    return 'Zlecenie wygląda gotowo do zamknięcia po finalnej kontroli jakości.';
  }
  return 'Przejdź do wskazanego kroku i domknij najbliższą decyzję.';
}

function getTaskDetailNextAction(task, meta, checklist) {
  const price = getTaskPriceGuidance(task, meta);
  const withDetail = (action, missingItem = null) => ({
    ...action,
    detail: action.detail || getTaskDetailActionDetail(action, task, meta, missingItem),
  });
  if (price.tone === 'danger') return withDetail({ label: 'Popraw finanse', target: 'edit' });
  const missingRequired = checklist.find((item) => item.required && !item.ok);
  if (missingRequired) {
    const labels = {
      phone: 'Uzupełnij telefon',
      address: 'Uzupełnij adres',
      date: 'Ustal termin',
      team: 'Przypisz ekipę',
      price: 'Popraw finanse',
      brief: 'Uzupełnij odprawę',
      arborist: 'Oznacz arborystę',
    };
    const repairAction = getRepairActionForItem(missingRequired, 'detail', false);
    return withDetail({
      ...repairAction,
      label: labels[missingRequired.key] || `Popraw: ${missingRequired.label}`,
    }, missingRequired);
  }
  if (meta?.followup?.overdue) return withDetail({ label: 'Zapisz kontakt', target: 'contact' });
  return withDetail(meta?.diagnostics?.nextAction || { label: 'Otwórz szczegóły', target: 'details' });
}

function getRepairActionForItem(item, source, showOfficePlanPanel) {
  const key = item?.key;
  if (key === 'media' || key === 'field-sketch' || key === 'photos') return { target: 'photos' };
  if (key === 'price') return { target: 'edit', formStep: 'finance', focusField: 'wartosc_planowana' };
  if (key === 'hours') {
    return showOfficePlanPanel ? { target: 'officePlan' } : { target: 'edit', formStep: 'finance', focusField: 'czas_planowany_godziny' };
  }
  if (key === 'date' || key === 'slot') {
    return showOfficePlanPanel ? { target: 'officePlan' } : { target: 'edit', formStep: 'planning', focusField: 'data_planowana' };
  }
  if (key === 'team') {
    return showOfficePlanPanel ? { target: 'officePlan' } : { target: 'edit', formStep: 'planning', focusField: 'ekipa_id' };
  }
  if (key === 'phone') return { target: 'edit', formStep: 'client', focusField: 'klient_telefon' };
  if (key === 'address') return { target: 'edit', formStep: 'client', focusField: 'adres' };
  if (key === 'brief') return { target: 'edit', formStep: 'work', focusField: 'opis_pracy' };
  if (key === 'arborist') return { target: 'edit', formStep: 'work', focusField: 'arborysta' };
  if (key === 'equipment') return { target: 'edit', formStep: 'work', focusField: 'sprzet' };
  if (key === 'contact') return { target: 'contact' };
  if (source === 'office') return { target: 'officePlan' };
  return { target: 'decision' };
}

function getRepairActionLabel(action) {
  if (action?.target === 'photos') return 'Otworz zdjecia';
  if (action?.target === 'officePlan') return 'Otworz plan';
  if (action?.target === 'contact') return 'Kontakt';
  if (action?.target === 'decision') return 'Decyzja';
  if (action?.formStep === 'finance') return 'Popraw cene';
  if (action?.formStep === 'planning') return 'Planowanie';
  if (action?.formStep === 'work') return 'Opis / BHP';
  if (action?.formStep === 'client') return 'Dane klienta';
  return 'Napraw';
}

function getRepairItemKey(item, source) {
  if (!item) return source;
  if (item.key === 'media' || item.key === 'field-sketch' || item.key === 'photos') return 'photos';
  if (item.key === 'date' || item.key === 'slot') return 'date';
  if (item.key === 'team') return 'team';
  if (item.key === 'brief') return 'brief';
  if (item.key === 'price') return 'price';
  if (item.key === 'hours') return 'hours';
  return `${source}-${item.key || item.label}`;
}

function buildDetailRepairItems({
  qualityChecklist = [],
  safetyChecklist = [],
  officePlanReadinessItems = [],
  showOfficePlanPanel = false,
}) {
  const rows = [];
  const seen = new Set();
  const add = (item, source, owner, requiredOverride = null) => {
    if (!item || item.ok) return;
    const key = getRepairItemKey(item, source);
    if (seen.has(key)) return;
    seen.add(key);
    const required = requiredOverride ?? item.required !== false;
    const action = getRepairActionForItem(item, source, showOfficePlanPanel);
    rows.push({
      key,
      label: item.label,
      detail: item.detail,
      owner,
      required,
      tone: required ? 'danger' : 'warning',
      action: {
        ...action,
        repairLabel: item.label,
        repairDetail: item.detail,
      },
      actionLabel: getRepairActionLabel(action),
    });
  };

  qualityChecklist.filter((item) => item.required && !item.ok).forEach((item) => add(item, 'quality', 'Biuro', true));
  officePlanReadinessItems.filter((item) => item.required && !item.ok).forEach((item) => add(item, 'office', 'Plan biura', true));
  safetyChecklist.filter((item) => item.required && !item.ok).forEach((item) => add(item, 'safety', 'BHP / brygada', true));
  qualityChecklist
    .filter((item) => !item.required && !item.ok && ['field-sketch', 'hours', 'brief', 'contact'].includes(item.key))
    .forEach((item) => add(item, 'quality-warning', 'Kontrola jakosci', false));
  officePlanReadinessItems
    .filter((item) => !item.required && !item.ok)
    .forEach((item) => add(item, 'office-warning', 'Plan biura', false));
  safetyChecklist
    .filter((item) => !item.required && !item.ok && ['equipment', 'client'].includes(item.key))
    .forEach((item) => add(item, 'safety-warning', 'BHP / brygada', false));

  return rows.sort((a, b) => Number(b.required) - Number(a.required));
}

function getFormStepForEditAction(action) {
  const label = String(action?.label || '').toLowerCase();
  if (label.includes('telefon') || label.includes('kontakt') || label.includes('adres')) return 'client';
  if (label.includes('termin') || label.includes('ekip')) return 'planning';
  if (label.includes('zdj') || label.includes('szkic') || label.includes('media')) return 'media';
  if (label.includes('finans') || label.includes('cen') || label.includes('kwot') || label.includes('budżet')) return 'finance';
  if (label.includes('opis') || label.includes('pracy') || label.includes('brief')) return 'work';
  return 'client';
}

function buildTaskClosureGuard(task, todayIso, contact = {}) {
  const meta = getTaskBusinessMeta(task, todayIso, contact);
  const price = getTaskPriceGuidance(task, meta);
  const checklist = [
    ...getTaskQualityChecklist(task, meta, contact),
    ...getTaskSafetyChecklist(task, meta, contact),
  ];
  const blockers = checklist.filter((item) => item.required && !item.ok);
  const warnings = checklist.filter((item) => !item.required && !item.ok);

  if (price.tone === 'warning') {
    warnings.unshift({
      key: 'price-buffer',
      label: price.label,
      detail: price.detail,
      ok: false,
      required: false,
    });
  }

  if (meta.followup.overdue) {
    warnings.unshift({
      key: 'followup-overdue',
      label: 'Follow-up po terminie',
      detail: meta.followup.label,
      ok: false,
      required: false,
    });
  }

  return {
    task,
    meta,
    price,
    checklist,
    blockers,
    warnings,
    shouldPause: blockers.length > 0,
    canForceClose: blockers.length === 0,
  };
}

function compareTasksBySort(a, b, sortMode, todayIso) {
  const aMeta = getTaskQueueMeta(a, todayIso);
  const bMeta = getTaskQueueMeta(b, todayIso);

  if (sortMode === 'date') {
    const aDays = Number.isFinite(aMeta.daysLeft) ? aMeta.daysLeft : 9999;
    const bDays = Number.isFinite(bMeta.daysLeft) ? bMeta.daysLeft : 9999;
    if (aDays !== bDays) return aDays - bDays;
    return bMeta.score - aMeta.score;
  }

  if (sortMode === 'value') {
    if (bMeta.value !== aMeta.value) return bMeta.value - aMeta.value;
    return bMeta.score - aMeta.score;
  }

  if (sortMode === 'newest') {
    const aCreated = new Date(a.created_at || a.updated_at || 0).getTime() || 0;
    const bCreated = new Date(b.created_at || b.updated_at || 0).getTime() || 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return Number(b.id || 0) - Number(a.id || 0);
  }

  if (bMeta.score !== aMeta.score) return bMeta.score - aMeta.score;
  const aDays = Number.isFinite(aMeta.daysLeft) ? aMeta.daysLeft : 9999;
  const bDays = Number.isFinite(bMeta.daysLeft) ? bMeta.daysLeft : 9999;
  if (aDays !== bDays) return aDays - bDays;
  return Number(a.id || 0) - Number(b.id || 0);
}

function formatQueueTiming(daysLeft) {
  if (!Number.isFinite(daysLeft)) return 'bez terminu';
  if (daysLeft < 0) return `${Math.abs(daysLeft)} dni po terminie`;
  if (daysLeft === 0) return 'dzisiaj';
  return `za ${daysLeft} dni`;
}

function getClientContactOption(status) {
  return CLIENT_CONTACT_STATUSES.find((item) => item.key === status) || {
    key: 'none',
    label: 'Brak statusu kontaktu',
    tone: 'muted',
  };
}

function formatContactStamp(value) {
  if (!value) return 'brak historii';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'brak historii';
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getFollowupPresetIso(daysFromToday) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(daysFromToday === 0 ? Math.max(date.getHours() + 2, 10) : 10, 0, 0, 0);
  return date.toISOString();
}

function getContactFollowupMeta(contact) {
  if (!contact?.dueAt) {
    return { label: 'bez terminu follow-up', tone: 'muted', overdue: false, today: false };
  }
  const due = new Date(contact.dueAt);
  if (Number.isNaN(due.getTime())) {
    return { label: 'bez terminu follow-up', tone: 'muted', overdue: false, today: false };
  }
  const now = new Date();
  const dueDay = due.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const needsAction = contact.status !== 'informed';
  const overdue = needsAction && due.getTime() < now.getTime();
  const isToday = needsAction && dueDay === today;
  return {
    label: overdue ? `po terminie: ${formatContactStamp(contact.dueAt)}` : `follow-up: ${formatContactStamp(contact.dueAt)}`,
    tone: overdue ? 'danger' : isToday ? 'warning' : 'muted',
    overdue,
    today: isToday,
  };
}

function normalizeClientContact(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    task_id: row.task_id ?? row.taskId ?? null,
    status: row.status || '',
    note: row.note || '',
    dueAt: row.dueAt || row.due_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    updatedBy: row.updatedBy || row.updated_by || null,
    actor: row.actor || null,
    history: Array.isArray(row.history) ? row.history : [],
  };
}

function normalizeClientContactPatch(patch) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'status')) out.status = patch.status || '';
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'note')) out.note = patch.note || '';
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'due_at')) out.dueAt = patch.due_at || null;
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'dueAt')) out.dueAt = patch.dueAt || null;
  return out;
}

function normalizeClientContactsPayload(payload) {
  const rawContacts = payload?.contacts || payload || {};
  if (!rawContacts || typeof rawContacts !== 'object' || Array.isArray(rawContacts)) return {};
  return Object.entries(rawContacts).reduce((acc, [taskId, row]) => {
    const normalized = normalizeClientContact(row);
    if (normalized.status || normalized.note || normalized.updatedAt) {
      acc[String(taskId)] = normalized;
    }
    return acc;
  }, {});
}

function normalizeClosureDecisionItem(item) {
  return {
    key: item?.key || '',
    label: item?.label || '',
    detail: item?.detail || '',
    required: Boolean(item?.required),
  };
}

function normalizeClosureDecisionEvent(row) {
  if (!row || typeof row !== 'object') return null;
  const taskId = row.task_id ?? row.taskId;
  if (!taskId) return null;
  return {
    id: row.id || `${taskId}-${row.created_at || Date.now()}-${row.action || 'event'}`,
    task_id: Number(taskId),
    action: row.action || '',
    severity: row.severity || '',
    status_before: row.status_before || row.statusBefore || '',
    status_after: row.status_after || row.statusAfter || '',
    blockers: Array.isArray(row.blockers) ? row.blockers.map(normalizeClosureDecisionItem) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(normalizeClosureDecisionItem) : [],
    risk_score: Number(row.risk_score ?? row.riskScore) || 0,
    quality_score: Number(row.quality_score ?? row.qualityScore) || 0,
    value: Number(row.value) || 0,
    note: row.note || '',
    created_at: row.created_at || row.createdAt || null,
    created_by: row.created_by || row.createdBy || null,
    actor: row.actor || 'Operator',
  };
}

function normalizeClosureDecisionPayload(payload) {
  const rawEvents = payload?.events || payload || {};
  if (!rawEvents || typeof rawEvents !== 'object') return {};
  if (Array.isArray(rawEvents)) {
    return rawEvents.reduce((acc, row) => {
      const event = normalizeClosureDecisionEvent(row);
      if (!event) return acc;
      const key = String(event.task_id);
      acc[key] = [event, ...(acc[key] || [])].slice(0, 30);
      return acc;
    }, {});
  }
  return Object.entries(rawEvents).reduce((acc, [taskId, rows]) => {
    const list = Array.isArray(rows) ? rows : [];
    acc[String(taskId)] = list.map(normalizeClosureDecisionEvent).filter(Boolean).slice(0, 30);
    return acc;
  }, {});
}

function closureActionLabel(action) {
  const labels = {
    blocked_attempt: 'Zatrzymano zamknięcie',
    warning_review: 'Kontrola z uwagami',
    forced_close: 'Zamknięto mimo uwag',
    clean_close: 'Zamknięto bez blokad',
    fix_started: 'Wrócono do poprawy',
  };
  return labels[action] || 'Decyzja operatora';
}

function buildClosureAuditSummary(eventsByTask, tasks = []) {
  const taskMap = new Map(tasks.map((task) => [String(task.id), task]));
  const rows = Object.entries(eventsByTask || {}).flatMap(([taskId, events]) =>
    (Array.isArray(events) ? events : []).map((event) => {
      const task = taskMap.get(String(event.task_id || taskId)) || null;
      return {
        event,
        task,
        value: Number(event.value) || Number(task?.wartosc_planowana) || 0,
      };
    })
  );

  rows.sort((a, b) => {
    const aTime = new Date(a.event.created_at || 0).getTime() || 0;
    const bTime = new Date(b.event.created_at || 0).getTime() || 0;
    return bTime - aTime;
  });

  const stats = {
    total: rows.length,
    blocked: 0,
    warningReviews: 0,
    forced: 0,
    clean: 0,
    fixes: 0,
    reviewedValue: 0,
    blockedValue: 0,
  };
  const issueMap = new Map();
  const actorMap = new Map();

  rows.forEach(({ event, value }) => {
    stats.reviewedValue += value;
    if (event.action === 'blocked_attempt') {
      stats.blocked += 1;
      stats.blockedValue += value;
    } else if (event.action === 'warning_review') {
      stats.warningReviews += 1;
    } else if (event.action === 'forced_close') {
      stats.forced += 1;
    } else if (event.action === 'clean_close') {
      stats.clean += 1;
    } else if (event.action === 'fix_started') {
      stats.fixes += 1;
    }

    const actor = event.actor || 'Operator';
    const actorStats = actorMap.get(actor) || { actor, count: 0, blocked: 0, forced: 0, fixes: 0 };
    actorStats.count += 1;
    if (event.action === 'blocked_attempt') actorStats.blocked += 1;
    if (event.action === 'forced_close') actorStats.forced += 1;
    if (event.action === 'fix_started') actorStats.fixes += 1;
    actorMap.set(actor, actorStats);

    [
      ...(event.blockers || []).map((item) => ({ item, type: 'blocker' })),
      ...(event.warnings || []).map((item) => ({ item, type: 'warning' })),
    ].forEach(({ item, type }) => {
      const label = item.label || item.key || 'Nieopisany warunek';
      const key = item.key || label;
      const current = issueMap.get(key) || {
        key,
        label,
        count: 0,
        blockers: 0,
        warnings: 0,
        value: 0,
        taskIds: new Set(),
      };
      current.count += 1;
      current.value += value;
      current.taskIds.add(String(event.task_id));
      if (type === 'blocker') current.blockers += 1;
      else current.warnings += 1;
      issueMap.set(key, current);
    });
  });

  const topIssues = Array.from(issueMap.values())
    .map((issue) => ({ ...issue, taskIds: Array.from(issue.taskIds || []) }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
    .slice(0, 5);
  const topActors = Array.from(actorMap.values())
    .sort((a, b) => b.count - a.count || b.blocked - a.blocked)
    .slice(0, 4);

  let health = 'good';
  let healthLabel = 'Czysto';
  if (!stats.total) {
    health = 'warning';
    healthLabel = 'Czeka na dane';
  } else if (stats.forced > 0) {
    health = 'danger';
    healthLabel = 'Wymuszenia do przeglądu';
  } else if (stats.blocked > 0) {
    health = 'warning';
    healthLabel = 'Strażnik działa';
  }

  return {
    ...stats,
    rows,
    topIssues,
    topActors,
    recent: rows.slice(0, 6),
    health,
    healthLabel,
  };
}

function getClosureEventDecisionItems(event) {
  return [
    ...(event?.blockers || []),
    ...(event?.warnings || []),
  ].filter((item) => item?.key || item?.label);
}

function getClosureIssueKey(item) {
  return item?.key || item?.label || '';
}

function buildClosureRepairQueue(rows, issueKey = '') {
  const seen = new Set();
  const queue = [];
  (rows || []).forEach(({ event, task, value }) => {
    if (!task || !event || seen.has(String(event.task_id))) return;
    const allItems = getClosureEventDecisionItems(event);
    if (!allItems.length) return;
    const matchingItems = issueKey
      ? allItems.filter((item) => getClosureIssueKey(item) === issueKey)
      : allItems;
    if (!matchingItems.length) return;
    seen.add(String(event.task_id));
    queue.push({
      event,
      task,
      value,
      items: matchingItems.slice(0, 3),
    });
  });
  return queue.slice(0, 4);
}

function getClientMessageStatusLine(task, planned) {
  if (task.status === TASK_STATUS.WYCENA_TERENOWA) {
    return `Oględziny i wycena są zaplanowane${planned ? ` na ${planned}` : ''}.`;
  }
  if (task.status === TASK_STATUS.DO_ZATWIERDZENIA) {
    return 'Zakres prac wrócił do biura do finalnego zatwierdzenia.';
  }
  if (task.status === TASK_STATUS.ZAPLANOWANE) {
    return `Zlecenie jest zaplanowane${planned ? ` na ${planned}` : ''}.`;
  }
  if (isTaskInProgress(task.status)) return 'Ekipa jest w trakcie realizacji prac.';
  if (isTaskDone(task.status)) return 'Prace zostały oznaczone jako zakończone.';
  if (task.status === TASK_STATUS.ANULOWANE) return 'Zlecenie zostało anulowane.';
  return 'Potwierdzamy przyjęcie zgłoszenia.';
}

function getClientMessageNextStep(task, diagnostics) {
  if (isTaskDone(task.status)) {
    return 'Dziękujemy za współpracę. W razie uwag prosimy o kontakt.';
  }
  if (task.status === TASK_STATUS.ANULOWANE) return 'W razie pytań prosimy o kontakt z biurem.';
  if (diagnostics.has.noDate) return 'Skontaktujemy się, żeby potwierdzić dogodny termin.';
  if (diagnostics.has.noContact) return 'Prosimy o potwierdzenie numeru kontaktowego w odpowiedzi.';
  if (diagnostics.has.overdue) return 'Potwierdzimy najbliższe dostępne okno prac.';
  if (task.status === TASK_STATUS.WYCENA_TERENOWA) return 'Specjalista ds. wyceny przygotuje zdjęcia, zakres i propozycję ceny.';
  if (task.status === TASK_STATUS.DO_ZATWIERDZENIA) return 'Biuro dopina ekipę, godzinę i potwierdzenie prac.';
  if (task.status === TASK_STATUS.ZAPLANOWANE) return 'Przed przyjazdem potwierdzimy szczegóły organizacyjne.';
  if (isTaskInProgress(task.status)) return 'Po zakończeniu przekażemy podsumowanie prac.';
  return 'W razie pytań prosimy o kontakt z biurem.';
}
 
export default function Zlecenia() {
  const { t } = useTranslation();
  const taskPhotoInputRef = useRef(null);
  const quickCallRef = useRef(null);
  const quickCallClientInputRef = useRef(null);
  const workflowPathFocusTimerRef = useRef(null);
  const liveRefreshRef = useRef({ busy: false });
  const [zlecenia, setZlecenia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => getLocalStorageJson('user'));
  const [ekipy, setEkipy] = useState([]);
  const [branchTeams, setBranchTeams] = useState([]);
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [sprzetItems, setSprzetItems] = useState([]);
  const [branchEquipment, setBranchEquipment] = useState([]);
  const [branchVehicles, setBranchVehicles] = useState([]);
  const [tryb, setTryb] = useState(() => {
    const v = localStorage.getItem(VIEW_MODE_KEY) || 'lista';
    return ZLECENIA_TRYBY.has(v) ? v : 'lista';
  });
  const [wybraneZlecenie, setWybraneZlecenie] = useState(null);
  const [form, setForm] = useState(PUSTY_FORMULARZ);
  const [filtrStatus, setFiltrStatus] = useState('');
  const [filtrTyp, setFiltrTyp] = useState('');
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [szukaj, setSzukaj] = useState('');
  const [smartFilter, setSmartFilter] = useState(() => localStorage.getItem(SMART_FILTER_KEY) || '');
  const [sortMode, setSortMode] = useState(() => {
    const stored = localStorage.getItem(TASK_SORT_KEY) || 'risk';
    return TASK_SORT_KEYS.has(stored) ? stored : 'risk';
  });
  const [komunikat, setKomunikat] = useState({ tekst: '', typ: '' });
  const [copyFallback, setCopyFallback] = useState(null);
  const [potwierdzUsuniecie, setPotwierdzUsuniecie] = useState(null);
  const [formStep, setFormStep] = useState('client');
  const [formRepairFocus, setFormRepairFocus] = useState(null);
  const [taskPhotosById, setTaskPhotosById] = useState({});
  const [taskProblemsById, setTaskProblemsById] = useState({});
  const [taskPhotosLoading, setTaskPhotosLoading] = useState(false);
  const [detailGpsHistory, setDetailGpsHistory] = useState([]);
  const [detailGpsHistoryDate, setDetailGpsHistoryDate] = useState('');
  const [detailGpsHistoryLoading, setDetailGpsHistoryLoading] = useState(false);
  const [detailGpsHistoryError, setDetailGpsHistoryError] = useState('');
  const [uploadingTaskPhoto, setUploadingTaskPhoto] = useState(false);
  const [taskPhotoDraft, setTaskPhotoDraft] = useState({
    typ: 'Wycena',
    opis: '',
    tagi: 'wycena, teren',
  });
  const [taskPhotoRepairFocus, setTaskPhotoRepairFocus] = useState(null);
  const [closeGuard, setCloseGuard] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [activeClosureIssueKey, setActiveClosureIssueKey] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false);
  const [workflowPathFocused, setWorkflowPathFocused] = useState(false);
  const [clientContacts, setClientContacts] = useState(() =>
    normalizeClientContactsPayload(getLocalStorageJson(CLIENT_CONTACT_KEY, {}))
  );
  const [closureDecisionEvents, setClosureDecisionEvents] = useState(() =>
    normalizeClosureDecisionPayload(getLocalStorageJson(CLOSURE_DECISION_KEY, {}))
  );
  const [contactDraft, setContactDraft] = useState('');
  const [contactDueDraft, setContactDueDraft] = useState('');
  const [officePlan, setOfficePlan] = useState(OFFICE_PLAN_DEFAULTS);
  const [officePlanSaving, setOfficePlanSaving] = useState(false);
  const [timeWindowProposalBusy, setTimeWindowProposalBusy] = useState(false);
  const [timeWindowProposal, setTimeWindowProposal] = useState(null);
  const [timeWindowProposals, setTimeWindowProposals] = useState([]);
  const [timeWindowProposalsLoading, setTimeWindowProposalsLoading] = useState(false);
  const [officePlanEquipmentReservations, setOfficePlanEquipmentReservations] = useState([]);
  const [officePlanEquipmentReservationsLoading, setOfficePlanEquipmentReservationsLoading] = useState(false);
  const [officePlanEquipmentReservationsErr, setOfficePlanEquipmentReservationsErr] = useState('');
  const [quickCall, setQuickCall] = useState(() =>
    normalizeQuickCallDraft(getLocalStorageJson(QUICK_CALL_DRAFT_KEY, QUICK_CALL_DEFAULTS))
  );
  const [quickCallSaving, setQuickCallSaving] = useState(false);
  const [quickCallFocused, setQuickCallFocused] = useState(false);
  const [crewIssueDraft, setCrewIssueDraft] = useState({ typ: 'inne', opis: '' });
  const [crewIssueSaving, setCrewIssueSaving] = useState(false);
  const [commandTab, setCommandTab] = useState('dispatch');
  const [showAdvancedOps, setShowAdvancedOps] = useState(false);
  const [workflowConfig, setWorkflowConfig] = useState(() => {
    const parsed = getLocalStorageJson(WORKFLOW_CONFIG_KEY, {});
    return { ...DEFAULT_WORKFLOW_CONFIG, ...parsed };
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeTaskId } = useParams();
 
  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const isAdmin = currentUser?.rola === 'Administrator';
  const canManageAllBranches = isDyrektor || isAdmin;
  const isKierownik = currentUser?.rola === 'Kierownik';
  const isDyspozytor = currentUser?.rola === 'Dyspozytor';
  const isSpecjalista = currentUser?.rola === 'Specjalista';
  const isWyceniajacy = currentUser?.rola === 'Wyceniający' || currentUser?.rola === 'Wyceniajacy';
  const permissions = readPermissions();
  const canSeeFinance = canViewFinance(currentUser, permissions);
  const canUseTaskSms = canSendTaskSms(currentUser);
  const mozeTworzyc = canManageAllBranches || isKierownik || isDyspozytor || isSpecjalista || isWyceniajacy;
  const mozeEdytowac = canManageAllBranches || isKierownik || isDyspozytor || isSpecjalista || isWyceniajacy;
  const mozePlanowacBiuro = canManageAllBranches || isKierownik || isDyspozytor || isSpecjalista;
  const mozeUsuwac = canManageAllBranches;
  const mozePrzesuwacStatus = canManageAllBranches || isKierownik || isDyspozytor;
  const mozeObslugiwacRealizacje = mozePrzesuwacStatus || String(currentUser?.rola || '').toLowerCase().includes('bryg');

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, tryb);
  }, [tryb]);

  useEffect(() => {
    localStorage.setItem(WORKFLOW_CONFIG_KEY, JSON.stringify(workflowConfig));
  }, [workflowConfig]);

  useEffect(() => () => {
    if (workflowPathFocusTimerRef.current) {
      window.clearTimeout(workflowPathFocusTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (smartFilter) localStorage.setItem(SMART_FILTER_KEY, smartFilter);
    else localStorage.removeItem(SMART_FILTER_KEY);
  }, [smartFilter]);

  useEffect(() => {
    const query = new URLSearchParams(location.search).get('search') || '';
    if (!query) return;
    setSzukaj(query);
    setTryb('lista');
    setSmartFilter('');
    setFiltrStatus('');
    setFiltrTyp('');
    setFiltrOddzial('');
    setFiltrEkipa('');
  }, [location.search]);

  useEffect(() => {
    const focus = new URLSearchParams(location.search).get('focus') || '';
    if (focus !== 'telefon' || !mozeTworzyc) return undefined;
    setTryb('lista');
    setSmartFilter('');
    setFiltrStatus('');
    setQuickCallFocused(true);
    const focusPanelTimer = window.setTimeout(() => {
      quickCallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      quickCallClientInputRef.current?.focus({ preventScroll: true });
    }, 120);
    const focusTimer = window.setTimeout(() => setQuickCallFocused(false), 2400);
    return () => {
      window.clearTimeout(focusPanelTimer);
      window.clearTimeout(focusTimer);
    };
  }, [location.search, mozeTworzyc]);

  useEffect(() => {
    localStorage.setItem(TASK_SORT_KEY, TASK_SORT_KEYS.has(sortMode) ? sortMode : 'risk');
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem(CLIENT_CONTACT_KEY, JSON.stringify(clientContacts));
  }, [clientContacts]);

  useEffect(() => {
    localStorage.setItem(CLOSURE_DECISION_KEY, JSON.stringify(closureDecisionEvents));
  }, [closureDecisionEvents]);

  useEffect(() => {
    const normalized = normalizeQuickCallDraft(quickCall);
    if (hasQuickCallDraftData(normalized)) {
      localStorage.setItem(QUICK_CALL_DRAFT_KEY, JSON.stringify(normalized));
    } else {
      localStorage.removeItem(QUICK_CALL_DRAFT_KEY);
    }
  }, [quickCall]);
 
  useEffect(() => {
    const parsedUser = getLocalStorageJson('user') || currentUser;
    if (!parsedUser) { navigate('/'); return; }
    setCurrentUser(parsedUser);
    loadData(parsedUser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ZLECENIA_TRYBY.has(tryb)) setTryb('lista');
  }, [tryb]);

  useEffect(() => {
    if (tryb === 'szczegoly' && !wybraneZlecenie) setTryb('lista');
    const hasRoutedRepairEdit = Boolean(routeTaskId && getRouteEditRepair(location.search));
    if (tryb === 'edytuj' && !wybraneZlecenie && !hasRoutedRepairEdit) setTryb('lista');
  }, [tryb, wybraneZlecenie, routeTaskId, location.search]);

  useEffect(() => {
    if (!currentUser?.oddzial_id) return;
    setQuickCall((prev) => ({
      ...prev,
      oddzial_id: prev.oddzial_id || String(currentUser.oddzial_id),
      wyceniajacy_id: isWyceniajacy ? (prev.wyceniajacy_id || String(currentUser.id || '')) : prev.wyceniajacy_id,
    }));
  }, [currentUser?.id, currentUser?.oddzial_id, isWyceniajacy]);

  useEffect(() => {
    if (!wybraneZlecenie?.id) {
      setContactDraft('');
      setOfficePlan(OFFICE_PLAN_DEFAULTS);
      setTimeWindowProposal(null);
      setTimeWindowProposals([]);
      setCrewIssueDraft({ typ: 'inne', opis: '' });
      return;
    }
    setContactDraft(clientContacts[String(wybraneZlecenie.id)]?.note || '');
    setContactDueDraft(toDatetimeLocalValue(clientContacts[String(wybraneZlecenie.id)]?.dueAt));
    setTimeWindowProposal(null);
    setCrewIssueDraft({ typ: 'inne', opis: '' });
  }, [wybraneZlecenie?.id, clientContacts]);

  useEffect(() => {
    if (!wybraneZlecenie?.id) {
      setOfficePlan(OFFICE_PLAN_DEFAULTS);
      return;
    }
    const rawDate = String(wybraneZlecenie.data_planowana || '');
    const datePart = rawDate ? rawDate.slice(0, 10) : '';
    const timePart = wybraneZlecenie.godzina_rozpoczecia || (rawDate.includes('T') ? rawDate.split('T')[1]?.slice(0, 5) : '') || '08:00';
    setOfficePlan({
      data_planowana: datePart,
      godzina_rozpoczecia: timePart,
      czas_planowany_godziny: String(wybraneZlecenie.czas_planowany_godziny || wybraneZlecenie.czas_realizacji_godz || '2'),
      ekipa_id: wybraneZlecenie.ekipa_id ? String(wybraneZlecenie.ekipa_id) : '',
      sprzet_notatka: getTaskCrewEquipmentNote(wybraneZlecenie),
      sprzet_ids: Array.isArray(wybraneZlecenie.sprzet_ids) && wybraneZlecenie.sprzet_ids.length
        ? wybraneZlecenie.sprzet_ids.map(String)
        : getTaskReservedEquipmentIds(wybraneZlecenie),
    });
  }, [wybraneZlecenie]);

  useEffect(() => {
    if (tryb !== 'szczegoly' || !wybraneZlecenie?.id) {
      setTimeWindowProposals([]);
      setTimeWindowProposalsLoading(false);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      setTimeWindowProposalsLoading(true);
      try {
        const token = getStoredToken();
        const { data } = await api.get(`/tasks/${wybraneZlecenie.id}/time-window-proposals`, { headers: authHeaders(token) });
        if (!cancelled) setTimeWindowProposals(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (!cancelled) setTimeWindowProposals([]);
      } finally {
        if (!cancelled) setTimeWindowProposalsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tryb, wybraneZlecenie?.id]);

  useEffect(() => {
    if (tryb !== 'szczegoly' || !wybraneZlecenie?.id) {
      setDetailGpsHistory([]);
      setDetailGpsHistoryError('');
      setDetailGpsHistoryLoading(false);
      return;
    }
    const date = taskGpsHistoryDate(wybraneZlecenie);
    void loadDetailGpsHistory(wybraneZlecenie, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tryb,
    wybraneZlecenie?.id,
    wybraneZlecenie?.ekipa_id,
    wybraneZlecenie?.wyceniajacy_id,
    wybraneZlecenie?.uzytkownik_id,
    wybraneZlecenie?.vehicle_id,
    wybraneZlecenie?.pojazd_id,
    wybraneZlecenie?.nr_rejestracyjny,
    wybraneZlecenie?.data_planowana,
  ]);

  useEffect(() => {
    const branchId = String(
      wybraneZlecenie?.oddzial_id ||
      form.oddzial_id ||
      quickCall.oddzial_id ||
      currentUser?.oddzial_id ||
      ''
    ).trim();
    const planningDay = String(
      officePlan.data_planowana ||
      taskDateOnly(wybraneZlecenie?.data_planowana) ||
      form.data_planowana ||
      quickCall.data_planowana ||
      new Date().toISOString().slice(0, 10)
    ).slice(0, 10);

    if (!currentUser || !branchId) {
      setBranchTeams([]);
      setBranchEquipment([]);
      setBranchVehicles([]);
      return undefined;
    }

    let cancelled = false;
    const loadBranchTeams = async () => {
      try {
        const token = getStoredToken();
        const requestConfig = {
          headers: authHeaders(token),
          params: {
            oddzial_id: branchId,
            include_delegacje: '1',
            date: planningDay,
          },
          dedupe: false,
        };
        const [{ data }, equipmentRes, vehiclesRes] = await Promise.all([
          api.get('/ekipy', requestConfig),
          api.get('/flota/sprzet', requestConfig).catch(() => ({ data: [] })),
          api.get('/flota/pojazdy', requestConfig).catch(() => ({ data: [] })),
        ]);
        if (!cancelled) {
          setBranchTeams(Array.isArray(data) ? data : (data?.items || []));
          const equipmentData = equipmentRes.data;
          const vehiclesData = vehiclesRes.data;
          setBranchEquipment(Array.isArray(equipmentData) ? equipmentData : (equipmentData?.items || []));
          setBranchVehicles(Array.isArray(vehiclesData) ? vehiclesData : (vehiclesData?.items || []));
        }
      } catch {
        if (!cancelled) {
          setBranchTeams([]);
          setBranchEquipment([]);
          setBranchVehicles([]);
        }
      }
    };

    loadBranchTeams();
    return () => {
      cancelled = true;
    };
  }, [
    currentUser,
    currentUser?.oddzial_id,
    wybraneZlecenie?.oddzial_id,
    wybraneZlecenie?.data_planowana,
    form.oddzial_id,
    form.data_planowana,
    quickCall.oddzial_id,
    quickCall.data_planowana,
    officePlan.data_planowana,
  ]);

  useEffect(() => {
    const day = String(officePlan.data_planowana || '').slice(0, 10);
    if (!wybraneZlecenie?.id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setOfficePlanEquipmentReservations([]);
      setOfficePlanEquipmentReservationsErr('');
      setOfficePlanEquipmentReservationsLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadOfficePlanEquipmentReservations = async () => {
      const token = getStoredToken();
      if (!token) return;
      setOfficePlanEquipmentReservationsLoading(true);
      setOfficePlanEquipmentReservationsErr('');
      try {
        const { data } = await api.get(
          `/flota/rezerwacje?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
          { headers: authHeaders(token), dedupe: false }
        );
        if (!cancelled) {
          setOfficePlanEquipmentReservations(Array.isArray(data) ? data : data?.items || []);
        }
      } catch (err) {
        if (!cancelled) {
          setOfficePlanEquipmentReservations([]);
          setOfficePlanEquipmentReservationsErr(getApiErrorMessage(err, 'Nie udalo sie sprawdzic rezerwacji sprzetu.'));
        }
      } finally {
        if (!cancelled) setOfficePlanEquipmentReservationsLoading(false);
      }
    };

    loadOfficePlanEquipmentReservations();
    return () => {
      cancelled = true;
    };
  }, [officePlan.data_planowana, wybraneZlecenie?.id]);
 
  const loadData = async (user, options = {}) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const rola = user?.rola;
      const canLoadAllTasks = [
        'Prezes',
        'Dyrektor',
        'Administrator',
        'Dyrektor Sprzedazy',
        'Dyrektor Sprzedaży',
        'Dyrektor dzialu sprzedaz',
        'Dyrektor działu sprzedaż',
      ].includes(rola);
      const endpoint = canLoadAllTasks ? `/tasks/wszystkie` : `/tasks`;
      const [zRes, eRes, uRes, branchesRes, equipmentRes, contactRes, closureRes] = await Promise.allSettled([
        api.get(endpoint, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/uzytkownicy`, { headers: h }),
        api.get('/oddzialy', { headers: h }),
        api.get('/flota/sprzet', { headers: h }),
        api.get('/tasks/client-contacts', { headers: h }),
        api.get('/tasks/closure-events', { headers: h }),
      ]);
      if (zRes.status !== 'fulfilled') {
        throw zRes.reason;
      }
      const readSettledData = (result, fallback) => (
        result.status === 'fulfilled' ? result.value?.data : fallback
      );
      const taskData = zRes.value?.data;
      const taskRows = Array.isArray(taskData) ? taskData : [];
      setZlecenia(taskRows);
      const teamsData = readSettledData(eRes, []);
      const usersData = readSettledData(uRes, []);
      const branchesData = readSettledData(branchesRes, []);
      const equipmentData = readSettledData(equipmentRes, []);
      const contactData = readSettledData(contactRes, null);
      const closureData = readSettledData(closureRes, null);
      setEkipy(Array.isArray(teamsData) ? teamsData : []);
      setUzytkownicy(Array.isArray(usersData) ? usersData : []);
      setOddzialy(Array.isArray(branchesData) ? branchesData : (branchesData?.oddzialy || []));
      setSprzetItems(Array.isArray(equipmentData) ? equipmentData : (equipmentData?.items || []));
      if (contactData) {
        setClientContacts(normalizeClientContactsPayload(contactData));
      }
      if (closureData) {
        setClosureDecisionEvents(normalizeClosureDecisionPayload(closureData));
      }
      return taskRows;
    } catch (err) {
      if (!options.silent) {
        pokazKomunikat(getApiErrorMessage(err, 'Błąd ładowania danych'), 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUser || tryb === 'nowy' || tryb === 'edytuj') return undefined;

    let active = true;
    const refreshLiveTasks = async () => {
      if (!active || document.visibilityState !== 'visible' || liveRefreshRef.current.busy) return;
      liveRefreshRef.current.busy = true;
      try {
        await loadData(currentUser, { silent: true });
      } finally {
        liveRefreshRef.current.busy = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshLiveTasks();
    }, 30000);
    const handleFocus = () => {
      void refreshLiveTasks();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [currentUser, tryb]); // eslint-disable-line react-hooks/exhaustive-deps
 
  const pokazKomunikat = (tekst, typ = 'success') => {
    setKomunikat({ tekst, typ });
    setTimeout(() => setKomunikat({ tekst: '', typ: '' }), 4000);
  };

  const loadTaskPhotos = async (taskId, options = {}) => {
    if (!taskId) return [];
    setTaskPhotosLoading(true);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/tasks/${taskId}/zdjecia`, { headers: authHeaders(token), dedupe: false });
      const rows = Array.isArray(data) ? data : [];
      setTaskPhotosById((prev) => ({ ...prev, [String(taskId)]: rows }));
      return rows;
    } catch (err) {
      if (!options.silent) pokazKomunikat(getApiErrorMessage(err, 'Nie udało się pobrać zdjęć zlecenia'), 'error');
      return [];
    } finally {
      setTaskPhotosLoading(false);
    }
  };

  const loadTaskProblems = async (taskId, options = {}) => {
    if (!taskId) return [];
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/tasks/${taskId}/problemy`, { headers: authHeaders(token), dedupe: false });
      const rows = Array.isArray(data) ? data : [];
      setTaskProblemsById((prev) => ({ ...prev, [String(taskId)]: rows }));
      return rows;
    } catch (err) {
      if (!options.silent) pokazKomunikat(getApiErrorMessage(err, 'Nie udalo sie pobrac problemow zlecenia'), 'error');
      return [];
    }
  };

  async function loadDetailGpsHistory(taskArg = wybraneZlecenie, dateArg = detailGpsHistoryDate) {
    const task = taskArg || {};
    const date = dateArg || taskGpsHistoryDate(task);
    const params = buildTaskGpsHistoryParams(task, date);
    setDetailGpsHistoryDate(date);
    if (!params) {
      setDetailGpsHistory([]);
      setDetailGpsHistoryError('Brak ekipy, uzytkownika albo pojazdu do historii GPS.');
      setDetailGpsHistoryLoading(false);
      return [];
    }

    setDetailGpsHistoryLoading(true);
    setDetailGpsHistoryError('');
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/ekipy/gps-history?${params.toString()}`, {
        headers: authHeaders(token),
        dedupe: false,
      });
      const rows = normalizeTaskGpsHistoryRows(data);
      setDetailGpsHistory(rows);
      if (data?.date) setDetailGpsHistoryDate(data.date);
      return rows;
    } catch (err) {
      setDetailGpsHistory([]);
      setDetailGpsHistoryError(getApiErrorMessage(err, 'Nie udalo sie pobrac historii GPS dla zlecenia.'));
      return [];
    } finally {
      setDetailGpsHistoryLoading(false);
    }
  }

  const reportCrewIssue = async () => {
    const taskId = wybraneZlecenie?.id;
    if (!taskId) return;
    const opis = String(crewIssueDraft.opis || '').trim();
    if (!opis) {
      pokazKomunikat('Opisz problem przed wyslaniem.', 'error');
      return;
    }
    setCrewIssueSaving(true);
    try {
      const token = getStoredToken();
      await api.post(
        `/tasks/${taskId}/problemy`,
        { typ: crewIssueDraft.typ || 'inne', opis },
        { headers: authHeaders(token) }
      );
      await loadTaskProblems(taskId, { silent: true });
      setCrewIssueDraft({ typ: 'inne', opis: '' });
      pokazKomunikat(`Problem zgloszony dla zlecenia #${taskId}.`);
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udalo sie zglosic problemu'), 'error');
    } finally {
      setCrewIssueSaving(false);
    }
  };

  const uploadTaskPhotos = async (files) => {
    const taskId = wybraneZlecenie?.id;
    const list = Array.from(files || []).filter(Boolean);
    if (taskPhotoInputRef.current) taskPhotoInputRef.current.value = '';
    if (!taskId) {
      pokazKomunikat('Najpierw zapisz draft zlecenia, potem dodaj zdjęcia.', 'error');
      return;
    }
    if (!list.length) return;
    setUploadingTaskPhoto(true);
    try {
      const token = getStoredToken();
      for (const file of list) {
        const formData = new FormData();
        formData.append('zdjecie', file);
        formData.append('typ', taskPhotoDraft.typ || 'Wycena');
        const opis = String(taskPhotoDraft.opis || '').trim();
        const tagi = String(taskPhotoDraft.tagi || '').trim();
        if (opis) formData.append('opis', opis);
        if (tagi) formData.append('tagi', tagi);
        await api.post(`/tasks/${taskId}/zdjecia`, formData, { headers: authHeaders(token) });
      }
      await loadTaskPhotos(taskId, { silent: true });
      if (taskPhotoRepairFocus) {
        const refreshedTasks = (await loadData(currentUser)) || [];
        const refreshedTask = refreshedTasks.find((task) => String(task.id) === String(taskId));
        if (refreshedTask) setWybraneZlecenie(refreshedTask);
        setFormRepairFocus(null);
        setTaskPhotoRepairFocus(null);
        setTryb('szczegoly');
      }
      pokazKomunikat(taskPhotoRepairFocus ? `Dokumentacja uzupelniona: ${list.length} zdj.` : `Dodano zdjecia: ${list.length}`);
      setTaskPhotoDraft((prev) => ({ ...prev, opis: '' }));
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się dodać zdjęć'), 'error');
    } finally {
      setUploadingTaskPhoto(false);
    }
  };

  const deleteTaskPhoto = async (photoId) => {
    const taskId = wybraneZlecenie?.id;
    if (!taskId || !photoId) return;
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${taskId}/zdjecia/${photoId}`, { headers: authHeaders(token) });
      await loadTaskPhotos(taskId, { silent: true });
      pokazKomunikat('Zdjęcie usunięte');
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się usunąć zdjęcia'), 'error');
    }
  };

  const openTaskDraw = () => {
    const taskId = wybraneZlecenie?.id;
    if (!taskId) {
      pokazKomunikat('Najpierw zapisz draft zlecenia, potem otwórz rysowanie.', 'error');
      return;
    }
    navigate(`/wycena-rysuj?taskId=${encodeURIComponent(taskId)}&photoKind=${encodeURIComponent(taskPhotoDraft.typ || 'Szkic')}`);
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const applyScopePreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      typ_uslugi: preset.serviceType || prev.typ_uslugi,
      opis_pracy: appendUniqueLine(prev.opis_pracy, preset.scopeLine),
    }));
  };

  const toggleEquipmentPreset = (preset) => {
    if (!preset.field) return;
    setForm((prev) => ({ ...prev, [preset.field]: !prev[preset.field] }));
  };

  const appendRiskPreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      notatki: appendUniqueLine(prev.notatki, preset.note),
      notatki_wewnetrzne: appendUniqueLine(prev.notatki_wewnetrzne, preset.note),
    }));
  };

  const applySettlementPreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      notatki: appendUniqueLine(prev.notatki, preset.note),
      notatki_wewnetrzne: appendUniqueLine(prev.notatki_wewnetrzne, preset.note),
    }));
  };

  const handleFormStatusChange = (nextStatus) => {
    setField('status', nextStatus);
    if (tryb === 'nowy' || nextStatus !== TASK_STATUS.ZAKONCZONE || isTaskDone(wybraneZlecenie?.status)) return;
    const projectedTask = {
      ...(wybraneZlecenie || {}),
      ...form,
      status: nextStatus,
      id: wybraneZlecenie?.id,
      ekipa_nazwa: ekipy.find((ekipa) => String(ekipa.id) === String(form.ekipa_id))?.nazwa || wybraneZlecenie?.ekipa_nazwa,
    };
    const guard = buildTaskClosureGuard(projectedTask, todayIso, getClientContact(projectedTask.id));
    if (guard.shouldPause) {
      const formGuard = { ...guard, status_before: wybraneZlecenie?.status || form.status };
      recordClosureDecision(formGuard, formGuard.blockers.length ? 'blocked_attempt' : 'warning_review');
      setCloseGuard({ ...formGuard, mode: 'form' });
    }
  };
 
  const otworzNowe = () => {
    setForm(createTaskFormDefaults({
      status: isWyceniajacy ? TASK_STATUS.WYCENA_TERENOWA : TASK_STATUS.NOWE,
      oddzial_id: currentUser?.oddzial_id || '',
      wyceniajacy_id: isWyceniajacy ? currentUser?.id || '' : '',
    }));
    setWybraneZlecenie(null);
    setFormStep('client');
    setTaskPhotoDraft({ typ: 'Wycena', opis: '', tagi: 'wycena, teren' });
    setTryb('nowy');
  };

  const focusQuickCallPanel = () => {
    if (!mozeTworzyc) return;
    setTryb('lista');
    setSmartFilter('');
    setFiltrStatus('');
    setFiltrTyp('');
    setFiltrOddzial('');
    setFiltrEkipa('');
    setSzukaj('');
    setQuickCallFocused(true);
    window.setTimeout(() => {
      quickCallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      quickCallClientInputRef.current?.focus({ preventScroll: true });
    }, 120);
    window.setTimeout(() => setQuickCallFocused(false), 2400);
  };

  const focusQuickCallField = (field) => {
    focusQuickCallPanel();
    window.setTimeout(() => {
      const target = document.querySelector(`[data-quick-call-field="${field}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus?.({ preventScroll: true });
    }, 180);
  };

  const otworzPelnyFormularzZTelefonu = () => {
    const intakeNote = 'Źródło: telefon do biura. Cel: oględziny u klienta i pakiet zdjęć dla biura.';
    const operatorName = [currentUser?.imie, currentUser?.nazwisko].filter(Boolean).join(' ') || currentUser?.login || 'biuro';
    setForm({
      ...createTaskFormDefaults({
        ...quickCall,
      status: TASK_STATUS.WYCENA_TERENOWA,
      typ_uslugi: 'Wycinka',
      oddzial_id: quickCall.oddzial_id || currentUser?.oddzial_id || '',
      wyceniajacy_id: quickCall.wyceniajacy_id || (isWyceniajacy ? currentUser?.id || '' : ''),
      opis_pracy: appendUniqueLine(quickCall.opis_pracy, intakeNote),
      opis: appendUniqueLine(quickCall.opis_pracy, intakeNote),
      notatki_wewnetrzne: appendUniqueLine(
        quickCall.opis_pracy,
        `Telefon przyjął: ${operatorName}`,
      ),
      ankieta_uproszczona: true,
      }),
      typ_uslugi: quickCallInspectionPackage.serviceType,
      opis_pracy: quickCallInspectionPackage.fieldBrief,
      opis: quickCallInspectionPackage.fieldBrief,
      notatki_wewnetrzne: quickCallInspectionPackage.internalNotes,
      notatki: quickCallInspectionPackage.internalNotes,
    });
    setWybraneZlecenie(null);
    setFormStep('client');
    setTaskPhotoDraft({ typ: 'Wycena', opis: '', tagi: 'wycena, teren' });
    setTryb('nowy');
  };

  const getEstimatorOptionsForBranch = (branchId, selectedEstimatorId = '') => (
    uzytkownicy
      .filter((u) => u.rola === 'Wyceniający' || u.rola === 'Wyceniajacy' || u.rola === 'Specjalista')
      .filter((u) => (
        !branchId ||
        !u.oddzial_id ||
        String(u.oddzial_id) === String(branchId) ||
        String(u.id) === String(selectedEstimatorId)
      ))
  );

  const setQuickCallField = (field, value) => {
    if (field === 'oddzial_id') {
      const estimatorsForBranch = getEstimatorOptionsForBranch(value);
      setQuickCall((prev) => ({
        ...prev,
        oddzial_id: value,
        wyceniajacy_id: estimatorsForBranch.length === 1 ? String(estimatorsForBranch[0].id) : '',
      }));
      return;
    }
    setQuickCall((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const focusQuickCallClient = () => {
    window.setTimeout(() => {
      quickCallClientInputRef.current?.focus({ preventScroll: true });
    }, 80);
  };

  const resetQuickCallDraft = () => {
    localStorage.removeItem(QUICK_CALL_DRAFT_KEY);
    setQuickCall({
      ...QUICK_CALL_DEFAULTS,
      oddzial_id: quickCall.oddzial_id || currentUser?.oddzial_id || '',
      godzina_rozpoczecia: quickCall.godzina_rozpoczecia || '',
    });
    setQuickCallFocused(true);
    focusQuickCallClient();
    window.setTimeout(() => setQuickCallFocused(false), 1200);
  };

  const getQuickCallMissingFields = () => {
    const missing = [];
    const selectedEstimatorId = String(quickCall.wyceniajacy_id || '').trim();
    const hasValidEstimator = selectedEstimatorId && uzytkownicy.some((u) => String(u.id) === selectedEstimatorId);
    if (!String(quickCall.klient_nazwa || '').trim()) missing.push('klient');
    if (!String(quickCall.klient_telefon || '').trim()) missing.push('telefon');
    if (!String(quickCall.adres || '').trim()) missing.push('adres');
    if (!String(quickCall.miasto || '').trim()) missing.push('miasto');
    if (!String(quickCall.data_planowana || '').trim()) missing.push('data oględzin');
    if (!hasValidEstimator) missing.push('specjalista ds. wyceny');
    if (canManageAllBranches && !String(quickCall.oddzial_id || '').trim()) missing.push('oddział');
    return missing;
  };

  const utworzOgledzinyZTelefonu = async () => {
    const missing = getQuickCallMissingFields();
    if (missing.length) {
      pokazKomunikat(`Telefon do biura: uzupełnij ${missing.join(', ')}`, 'error');
      return false;
    }
    const schedule = getQuickCallScheduleDiagnostics({
      tasks: zlecenia,
      estimatorId: quickCall.wyceniajacy_id,
      day: quickCall.data_planowana,
      time: quickCall.godzina_rozpoczecia,
    });
    if (schedule.blockingReason) {
      pokazKomunikat(schedule.blockingReason, 'error');
      return false;
    }
    setQuickCallSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const payload = buildTaskCreatePayload(
        {
          ...createTaskFormDefaults({
            ...quickCall,
          status: TASK_STATUS.WYCENA_TERENOWA,
          typ_uslugi: 'Wycinka',
          opis_pracy: appendUniqueLine(
            quickCall.opis_pracy,
            'Źródło: telefon do biura. Cel: oględziny u klienta i pakiet zdjęć dla biura.',
          ),
          notatki_wewnetrzne: appendUniqueLine(
            quickCall.opis_pracy,
            `Telefon przyjął: ${[currentUser?.imie, currentUser?.nazwisko].filter(Boolean).join(' ') || currentUser?.login || 'biuro'}`,
          ),
          ankieta_uproszczona: true,
          }),
          typ_uslugi: quickCallInspectionPackage.serviceType,
          opis_pracy: quickCallInspectionPackage.fieldBrief,
          opis: quickCallInspectionPackage.fieldBrief,
          notatki_wewnetrzne: quickCallInspectionPackage.internalNotes,
          notatki: quickCallInspectionPackage.internalNotes,
        },
        currentUser,
        {
          initialStatus: TASK_STATUS.WYCENA_TERENOWA,
          extra: { source: 'office_call_intake' },
        },
      );
      const { data } = await api.post('/tasks/nowe', payload, { headers: h });
      const created = data && typeof data === 'object' ? data : {};
      pokazKomunikat(`Oględziny utworzone i wysłane do specjalisty ds. wyceny${created.id ? ` (#${created.id})` : ''}`);
      setSmartFilter('fieldInspection');
      setFiltrStatus('');
      setSzukaj('');
      resetQuickCallDraft();
      await loadData(currentUser);
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się utworzyć oględzin z telefonu'), 'error');
      return false;
    } finally {
      setQuickCallSaving(false);
    }
  };

  const quickCallHasDraft = hasQuickCallDraftData(quickCall);
  const quickCallMissingFields = getQuickCallMissingFields();
  const quickCallSchedule = getQuickCallScheduleDiagnostics({
    tasks: zlecenia,
    estimatorId: quickCall.wyceniajacy_id,
    day: quickCall.data_planowana,
    time: quickCall.godzina_rozpoczecia,
  });
  const quickCallReady = quickCallMissingFields.length === 0 && !quickCallSchedule.blockingReason;
 
  const refreshTaskDetail = async (taskId, baseTask = null) => {
    if (!taskId) return;
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/tasks/${taskId}`, { headers: authHeaders(token), dedupe: false });
      if (!data || typeof data !== 'object') return;
      const freshTask = { ...(baseTask || {}), ...data };
      setZlecenia((prev) => prev.map((item) => (String(item.id) === String(taskId) ? { ...item, ...freshTask } : item)));
      setWybraneZlecenie((prev) => (String(prev?.id || '') === String(taskId) ? { ...(prev || {}), ...freshTask } : prev));
    } catch {
      // Lista moze nadal dzialac na danych skroconych; pelny detail jest tylko wzbogaceniem.
    }
  };

  const otworzSzczegoly = (z) => {
    setWybraneZlecenie(z);
    setTryb('szczegoly');
    setFormRepairFocus(null);
    setTaskPhotoRepairFocus(null);
    if (z?.id) {
      loadTaskPhotos(z.id, { silent: true });
      loadTaskProblems(z.id, { silent: true });
      refreshTaskDetail(z.id, z);
    }
  };

  useEffect(() => {
    if (!routeTaskId || loading) return undefined;
    let cancelled = false;

    const openRouteTask = async () => {
      let task = zlecenia.find((item) => String(item.id) === String(routeTaskId));
      if (!task) {
        try {
          const token = getStoredToken();
          const { data } = await api.get(`/tasks/${routeTaskId}`, { headers: authHeaders(token), dedupe: false });
          if (!data || typeof data !== 'object') return;
          task = data;
          setZlecenia((prev) => (
            prev.some((item) => String(item.id) === String(routeTaskId))
              ? prev.map((item) => (String(item.id) === String(routeTaskId) ? { ...item, ...data } : item))
              : [data, ...prev]
          ));
        } catch {
          return;
        }
      }
      if (cancelled || !task) return;

      const routeRepair = getRouteEditRepair(location.search);
      if (routeRepair && !currentUser) return;
      if (routeRepair && mozeEdytowac) {
        if (
          String(wybraneZlecenie?.id || '') === String(routeTaskId) &&
          tryb === 'edytuj' &&
          formRepairFocus?.field === routeRepair.field
        ) return;
        otworzEdycje(task, routeRepair.step, {
          field: routeRepair.field,
          label: routeRepair.label,
          detail: routeRepair.detail,
          returnTo: routeRepair.returnTo,
          returnLabel: routeRepair.returnLabel,
        });
        return;
      }

      if (String(wybraneZlecenie?.id || '') === String(routeTaskId) && tryb === 'szczegoly') return;
      otworzSzczegoly(task);
    };

    void openRouteTask();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTaskId, loading, zlecenia, location.search, currentUser, mozeEdytowac, tryb, wybraneZlecenie?.id, formRepairFocus?.field]);

  useEffect(() => {
    if (tryb !== 'edytuj' || !formRepairFocus?.field) return undefined;
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-repair-field="${formRepairFocus.field}"]`);
      if (target?.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (target?.focus) target.focus({ preventScroll: true });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [tryb, formStep, formRepairFocus?.field]);
 
  const otworzEdycje = (z, step = 'client', repairFocus = null) => {
    setForm({
      klient_nazwa: z.klient_nazwa || '', klient_telefon: z.klient_telefon || '',
      klient_email: z.klient_email || '', adres: z.adres || '', miasto: z.miasto || '',
      typ_uslugi: z.typ_uslugi || TASK_SERVICE_TYPES[0], status: z.status || TASK_STATUS.NOWE,
      priorytet: z.priorytet || 'Normalny',
      data_planowana: z.data_planowana ? z.data_planowana.split('T')[0] : '',
      godzina_rozpoczecia: z.godzina_rozpoczecia || '',
      wartosc_planowana: z.wartosc_planowana || '', czas_planowany_godziny: z.czas_planowany_godziny || '',
      oddzial_id: z.oddzial_id || currentUser?.oddzial_id || '',
      ekipa_id: z.ekipa_id || '', kierownik_id: z.kierownik_id || '', wyceniajacy_id: z.wyceniajacy_id || '',
      opis_pracy: z.opis_pracy || '', opis: z.opis || '', notatki_wewnetrzne: z.notatki_wewnetrzne || '',
      wywoz: !!z.wywoz, usuwanie_pni: !!z.usuwanie_pni,
      czas_realizacji_godz: z.czas_realizacji_godz || '',
      rebak: !!z.rebak, pila_wysiegniku: !!z.pila_wysiegniku, nozyce_dlugie: !!z.nozyce_dlugie,
      kosiarka: !!z.kosiarka, podkaszarka: !!z.podkaszarka, lopata: !!z.lopata, mulczer: !!z.mulczer,
      ilosc_osob: z.ilosc_osob || '', arborysta: !!z.arborysta,
      wynik: z.wynik || '', budzet: z.budzet || '', rabat: z.rabat || '',
      kwota_minimalna: z.kwota_minimalna || '', zrebki: z.zrebki || '',
      drzewno: z.drzewno || '', notatki: z.notatki || '',
    });
    setWybraneZlecenie(z);
    setFormStep(FORM_STEP_KEYS.has(step) ? step : 'client');
    setFormRepairFocus(repairFocus);
    if (z?.id) {
      loadTaskPhotos(z.id, { silent: true });
      loadTaskProblems(z.id, { silent: true });
    }
    setTryb('edytuj');
  };

  const buildTaskFromForm = () => ({
    ...(wybraneZlecenie || {}),
    ...form,
    id: wybraneZlecenie?.id,
    ekipa_nazwa: ekipy.find((ekipa) => String(ekipa.id) === String(form.ekipa_id))?.nazwa || wybraneZlecenie?.ekipa_nazwa,
  });
 
  const zapiszZlecenie = async (options = {}) => {
    const repairReturnTo = options.returnToRepairSource ? getSafeInternalReturnPath(formRepairFocus?.returnTo) : '';
    const repairReturnLabel = formRepairFocus?.returnLabel || 'AI Dyspozytor';
    if (tryb === 'nowy') {
      const missing = getTaskCreateMissingFields(form, { requireBranch: canManageAllBranches });
      if (missing.length) {
        const firstMissing = missing[0];
        setFormStep(TASK_CREATE_FIELD_STEPS[firstMissing] || 'client');
        pokazKomunikat(
          `Uzupełnij: ${missing.map((field) => TASK_CREATE_FIELD_LABELS[field] || field).join(', ')}`,
          'error'
        );
        return false;
      }
    } else if (!form.klient_nazwa) {
      pokazKomunikat('Podaj nazwę klienta', 'error');
      return false;
    }
    const closesTask = tryb !== 'nowy' && form.status === TASK_STATUS.ZAKONCZONE && !isTaskDone(wybraneZlecenie?.status);
    let closureGuardForSave = null;
    if (closesTask && !options.forceClose) {
      const projectedTask = buildTaskFromForm();
      const guard = buildTaskClosureGuard(projectedTask, todayIso, getClientContact(projectedTask.id));
      if (guard.shouldPause) {
        const formGuard = { ...guard, status_before: wybraneZlecenie?.status || form.status };
        recordClosureDecision(formGuard, formGuard.blockers.length ? 'blocked_attempt' : 'warning_review');
        setCloseGuard({ ...formGuard, mode: 'form' });
        return false;
      }
      closureGuardForSave = { ...guard, status_before: wybraneZlecenie?.status || form.status };
    } else if (closesTask && options.guard) {
      closureGuardForSave = options.guard;
    }
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      let savedTask = null;
      if (tryb === 'nowy') {
        const initialStatus = form.wyceniajacy_id && form.status === TASK_STATUS.NOWE
          ? TASK_STATUS.WYCENA_TERENOWA
          : form.status || TASK_STATUS.NOWE;
        const payload = buildTaskCreatePayload(form, currentUser, { initialStatus });
        const res = await api.post(`/tasks/nowe`, payload, { headers: h });
        const created = res.data || {};
        savedTask = {
          ...payload,
          ...created,
          id: created.id || payload.id,
          status: created.status || payload.status,
        };
        pokazKomunikat('Zlecenie zostało utworzone');
      } else {
        const res = await api.put(`/tasks/${wybraneZlecenie.id}`, form, { headers: h });
        savedTask = mergeTaskMutationResponse(wybraneZlecenie, res.data, {
          ...wybraneZlecenie,
          ...form,
          id: wybraneZlecenie.id,
        });
        pokazKomunikat(
          repairReturnTo
            ? `Poprawka zapisana - wracam do ${repairReturnLabel}`
            : options.returnToDetails
              ? 'Poprawka zapisana - sprawdzam kartę zlecenia'
              : 'Zlecenie zaktualizowane'
        );
      }
      if (closesTask && closureGuardForSave) {
        await recordClosureDecision(
          closureGuardForSave,
          options.forceClose ? 'forced_close' : 'clean_close',
          options.forceClose ? 'Operator zamknął zlecenie mimo uwag.' : 'Zlecenie zamknięte bez blokad.'
        );
      }
      await loadData(currentUser);
      if (options.stayOpen && savedTask) {
        otworzEdycje(savedTask, options.nextStep || formStep);
        if (options.nextStep === 'media') await loadTaskPhotos(savedTask.id, { silent: true });
        return true;
      }
      if (options.returnToDetails && savedTask) {
        setFormRepairFocus(null);
        setWybraneZlecenie(savedTask);
        setTryb('szczegoly');
        navigate(`/zlecenia/${savedTask.id}`, { replace: true });
        await Promise.all([
          loadTaskPhotos(savedTask.id, { silent: true }),
          loadTaskProblems(savedTask.id, { silent: true }),
        ]);
        return true;
      }
      if (repairReturnTo && savedTask) {
        setFormRepairFocus(null);
        navigate(repairReturnTo);
        return true;
      }
      setTryb('lista');
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd zapisu'), 'error');
      return false;
    }
  };

  const zapiszDraftIDodajZdjecia = async () => {
    await zapiszZlecenie({ stayOpen: true, nextStep: 'media' });
  };

  const anulujFormularz = () => {
    setFormRepairFocus(null);
    setTryb(wybraneZlecenie ? 'szczegoly' : 'lista');
  };
 
  const usunZlecenie = async (id) => {
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}`, { headers: authHeaders(token) });
      pokazKomunikat('Zlecenie usunięte');
      setPotwierdzUsuniecie(null);
      setZlecenia(prev => prev.filter(z => z.id !== id));
      if (tryb === 'szczegoly') setTryb('lista');
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd usuwania zlecenia'), 'error');
    }
  };

  const parseDateSafe = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getSlaFlags = (task) => {
    const now = new Date();
    const createdAt = parseDateSafe(task.created_at);
    const plannedAt = parseDateSafe(task.data_planowana);
    const isClosed = isTaskClosed(task.status);
    const flags = [];

    if (!isClosed && plannedAt && plannedAt < new Date(now.toDateString())) {
      flags.push('Przeterminowane');
    }
    if (!isClosed && createdAt) {
      const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      if (ageHours >= 48) flags.push('48h+ bez zamknięcia');
    }
    return flags;
  };

  const slaFlagLabel = (flag) => {
    if (flag === '48h+ bez zamknięcia') return t('taskSla.stale48h');
    return t(`taskSla.${flag}`, { defaultValue: flag });
  };

  const smsTemplateForStatus = (status) => ({
    Zaplanowane: 'zaplanowane',
    W_Realizacji: 'w_drodze',
    Zakonczone: 'zakonczone',
  }[status] || null);

  const runStatusWorkflow = async (task, nextStatus) => {
    const token = getStoredToken();
    const headers = authHeaders(token);
    const workflowMessage = `Workflow: status "${task.status}" -> "${nextStatus}" dla zlecenia #${task.id}`;

    const notificationPayload = {
      typ: 'info',
      tresc: workflowMessage,
      task_id: task.id,
      do_kogo: 'Dyrektor',
    };

    const operations = [
    ];
    if (workflowConfig.logEnabled) {
      operations.push(
        api.post(`/tasks/${task.id}/logi`, { tresc: workflowMessage, status: nextStatus }, { headers })
      );
    }
    if (workflowConfig.notificationsEnabled) {
      operations.push(api.post('/notifications', notificationPayload, { headers }));
    }

    // 3) Przypomnienie po przejściu do zaplanowanych.
    if (workflowConfig.remindersEnabled && nextStatus === 'Zaplanowane') {
      operations.push(
        api.post(
          '/notifications',
          {
            typ: 'przypomnienie',
            tresc: `Sprawdź potwierdzenie terminu dla zlecenia #${task.id}.`,
            task_id: task.id,
            do_kogo: 'Kierownik',
          },
          { headers }
        )
      );
    }

    // 4) Opcjonalny SMS dla klienta (jeśli backend wspiera endpoint).
    const smsType = smsTemplateForStatus(nextStatus);
    if (canUseTaskSms && workflowConfig.smsEnabled && smsType) {
      operations.push(api.post(`/sms/zlecenie/${task.id}`, { typ: smsType }, { headers }));
    }

    // Workflow jest "best effort": nie blokuje głównej zmiany statusu.
    if (operations.length > 0) {
      await Promise.allSettled(operations);
    }
  };

  const zmienStatusInline = async (taskId, nextStatus, options = {}) => {
    const task = zlecenia.find((z) => z.id === taskId);
    if (!task || task.status === nextStatus) return true;
    if (!canTransitionTaskStatus(task.status, nextStatus, { allowCancel: mozePrzesuwacStatus })) {
      pokazKomunikat(`Ten przeskok statusu jest zablokowany: ${task.status || 'brak'} -> ${nextStatus}.`, 'error');
      return false;
    }
    if (nextStatus === TASK_STATUS.W_REALIZACJI) {
      const inProgressCount = zlecenia.filter((z) => isTaskInProgress(z.status)).length;
      if (!isTaskInProgress(task.status) && inProgressCount >= 10) {
        pokazKomunikat('Limit WIP: maksymalnie 10 zleceń w realizacji.', 'error');
        return false;
      }
    }
    let closureGuardForStatus = null;
    if (nextStatus === TASK_STATUS.ZAKONCZONE && !options.forceClose) {
      const guard = buildTaskClosureGuard(task, todayIso, getClientContact(task.id));
      if (guard.shouldPause) {
        await recordClosureDecision(guard, guard.blockers.length ? 'blocked_attempt' : 'warning_review');
        setCloseGuard({ ...guard, mode: 'status' });
        return false;
      }
      closureGuardForStatus = guard;
    } else if (nextStatus === TASK_STATUS.ZAKONCZONE && options.guard) {
      closureGuardForStatus = options.guard;
    }
    setStatusUpdatingId(taskId);
    try {
      const token = getStoredToken();
      const { data } = await api.put(
        `/tasks/${taskId}/status`,
        { status: nextStatus },
        { headers: authHeaders(token) }
      );
      const updated = mergeTaskMutationResponse(task, data, { id: taskId, status: nextStatus });
      setZlecenia((prev) => prev.map((z) => (z.id === taskId ? mergeTaskMutationResponse(z, data, updated) : z)));
      if (wybraneZlecenie?.id === taskId) {
        setWybraneZlecenie((prev) => mergeTaskMutationResponse(prev, data, updated));
      }
      await runStatusWorkflow(task, nextStatus);
      if (nextStatus === TASK_STATUS.ZAKONCZONE && closureGuardForStatus) {
        await recordClosureDecision(
          closureGuardForStatus,
          options.forceClose ? 'forced_close' : 'clean_close',
          options.forceClose ? 'Operator zamknął zlecenie mimo uwag.' : 'Zlecenie zamknięte bez blokad.'
        );
      }
      pokazKomunikat(`Status zlecenia #${taskId} -> ${nextStatus}`);
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się zmienić statusu'), 'error');
      return false;
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const setOfficePlanField = (field, value) => {
    setOfficePlan((prev) => ({ ...prev, [field]: value }));
  };

  const setOfficePlanEquipment = (selectedOptions) => {
    const ids = Array.from(selectedOptions || []).map((option) => option.value).filter(Boolean);
    setOfficePlan((prev) => ({ ...prev, sprzet_ids: ids }));
  };

  const applyOfficePlanSuggestion = (suggestion) => {
    if (!suggestion?.ok) {
      pokazKomunikat(suggestion?.detail || 'Brak gotowej podpowiedzi planu.', 'error');
      return;
    }
    setOfficePlan((prev) => ({
      ...prev,
      data_planowana: suggestion.date || prev.data_planowana,
      godzina_rozpoczecia: suggestion.time || prev.godzina_rozpoczecia,
      ekipa_id: suggestion.teamId || prev.ekipa_id,
    }));
    pokazKomunikat(`Wstawiono podpowiedź: ${suggestion.label}`);
  };

  const zapiszPlanBiura = async () => {
    if (!wybraneZlecenie?.id) return false;
    const missing = [];
    if (!officePlan.data_planowana) missing.push('data');
    if (!officePlan.godzina_rozpoczecia) missing.push('godzina');
    if (!officePlan.czas_planowany_godziny) missing.push('czas');
    if (!officePlan.ekipa_id) missing.push('ekipa');
    if (missing.length) {
      pokazKomunikat(`Uzupełnij plan: ${missing.join(', ')}`, 'error');
      return false;
    }

    const conflictSummary = getOfficePlanTeamConflictSummary(zlecenia, wybraneZlecenie, officePlan);
    if (conflictSummary.hardConflict) {
      pokazKomunikat(`Konflikt grafiku ekipy: ${conflictSummary.detail}`, 'error');
      return false;
    }
    const equipmentConflictSummary = getOfficePlanEquipmentConflictSummary(
      officePlanEquipmentReservations,
      wybraneZlecenie,
      officePlan,
      {
        loading: officePlanEquipmentReservationsLoading,
        error: officePlanEquipmentReservationsErr,
      }
    );
    if (equipmentConflictSummary.pending) {
      pokazKomunikat('Poczekaj, sprawdzam rezerwacje sprzetu.', 'error');
      return false;
    }
    if (equipmentConflictSummary.hardConflict) {
      pokazKomunikat(`Konflikt rezerwacji sprzetu: ${equipmentConflictSummary.detail}`, 'error');
      return false;
    }

    setOfficePlanSaving(true);
    try {
      const token = getStoredToken();
      const { data } = await api.put(`/tasks/${wybraneZlecenie.id}/office-plan`, officePlan, { headers: authHeaders(token) });
      const plannedTeam = ekipyPlanowania.find((e) => String(e.id) === String(officePlan.ekipa_id))
        || ekipy.find((e) => String(e.id) === String(officePlan.ekipa_id));
      const updated = {
        ...wybraneZlecenie,
        ...(data && typeof data === 'object' ? data : {}),
        id: wybraneZlecenie.id,
        status: TASK_STATUS.ZAPLANOWANE,
        data_planowana: data?.data_planowana || officePlan.data_planowana,
        godzina_rozpoczecia: officePlan.godzina_rozpoczecia,
        czas_planowany_godziny: data?.czas_planowany_godziny || officePlan.czas_planowany_godziny,
        ekipa_id: data?.ekipa_id || officePlan.ekipa_id,
        ekipa_nazwa: data?.ekipa_nazwa || plannedTeam?.nazwa || wybraneZlecenie.ekipa_nazwa,
        sprzet_ids: data?.sprzet_ids || officePlan.sprzet_ids,
        sprzet_notatka: data?.sprzet_notatka || officePlan.sprzet_notatka,
        rezerwacje_sprzetu: data?.rezerwacje_sprzetu || data?.equipment_reservations || wybraneZlecenie.rezerwacje_sprzetu,
        equipment_reservations: data?.equipment_reservations || data?.rezerwacje_sprzetu || wybraneZlecenie.equipment_reservations,
      };
      setWybraneZlecenie(updated);
      setZlecenia((prev) => prev.map((z) => (String(z.id) === String(updated.id) ? { ...z, ...updated } : z)));
      await loadData(currentUser);
      pokazKomunikat(data?.message || 'Zlecenie zaplanowane dla ekipy');
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się zaplanować zlecenia'), 'error');
      return false;
    } finally {
      setOfficePlanSaving(false);
    }
  };

  const buildTimeWindowProposalPayload = () => {
    const date = String(officePlan.data_planowana || taskDateOnly(wybraneZlecenie?.data_planowana) || '').slice(0, 10);
    const start = normalizeTimeHM(officePlan.godzina_rozpoczecia || getTaskStartTimeHM(wybraneZlecenie) || '08:00');
    const startMin = timeHMToMinutes(start);
    const durationMin = Math.max(15, Math.round((Number(officePlan.czas_planowany_godziny || wybraneZlecenie?.czas_planowany_godziny || 2) || 2) * 60));
    if (!date || startMin == null) {
      return { error: 'Najpierw wybierz datę i godzinę okna dla klienta.' };
    }
    const endMin = startMin + durationMin;
    if (endMin > 23 * 60 + 59) {
      return { error: 'Okno klienta wychodzi poza koniec dnia. Skróć czas pracy albo wybierz wcześniejszą godzinę.' };
    }
    return {
      proposed_date: date,
      okno_od: start,
      okno_do: minutesToTimeHM(endMin),
      note: 'Propozycja okna czasowego z planu biura.',
    };
  };

  const createClientTimeWindowProposal = async ({ sendSms = false, copyLink = false } = {}) => {
    if (!wybraneZlecenie?.id) return null;
    if (sendSms && !wybraneZlecenie.klient_telefon) {
      pokazKomunikat('Brak telefonu klienta - nie wyślę SMS z propozycją terminu.', 'error');
      return null;
    }
    const payload = buildTimeWindowProposalPayload();
    if (payload.error) {
      pokazKomunikat(payload.error, 'error');
      return null;
    }
    setTimeWindowProposalBusy(true);
    try {
      const token = getStoredToken();
      const { data } = await api.post(
        `/tasks/${wybraneZlecenie.id}/time-window-proposals`,
        { ...payload, send_sms: Boolean(sendSms) },
        { headers: authHeaders(token) }
      );
      const proposal = data?.proposal || null;
      setTimeWindowProposal({ proposal, sms: data?.sms || null });
      if (proposal) {
        setTimeWindowProposals((prev) => [
          { ...proposal, effective_status: proposal.effective_status || proposal.status, sms: data?.sms || null },
          ...prev.filter((item) => String(item.id) !== String(proposal.id)),
        ].slice(0, 20));
      }
      if (proposal?.url && copyLink) {
        await copyText(proposal.url, `Skopiowano link okna czasowego dla zlecenia #${wybraneZlecenie.id}.`);
      } else if (copyLink) {
        pokazKomunikat('Backend utworzył propozycję, ale nie zwrócił publicznego linku. Sprawdź PUBLIC_BASE_URL.', 'error');
      } else {
        pokazKomunikat(sendSms ? 'Wysłano SMS z propozycją okna czasowego.' : 'Utworzono propozycję okna czasowego.');
      }
      return proposal;
    } catch (err) {
      const maybeProposal = err?.response?.data?.proposal || null;
      if (maybeProposal) setTimeWindowProposal({ proposal: maybeProposal, sms: err?.response?.data?.sms || null });
      pokazKomunikat(getApiErrorMessage(err, sendSms ? 'Nie udało się wysłać SMS z propozycją terminu' : 'Nie udało się utworzyć propozycji terminu'), 'error');
      return null;
    } finally {
      setTimeWindowProposalBusy(false);
    }
  };

  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = widoczneZlecenia.map((z) => z.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.includes(id));
    if (allSelected) {
      setSelectedTaskIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setSelectedTaskIds((prev) => [...new Set([...prev, ...visibleIds])]);
  };

  const bulkUpdateStatus = async (nextStatus) => {
    if (!selectedTaskIds.length) return;
    if (!window.confirm(`Zmienić status ${selectedTaskIds.length} zleceń na "${nextStatus}"?`)) return;

    const idsToUpdate = [...selectedTaskIds];
    for (const taskId of idsToUpdate) {
      // Sequential update keeps API load predictable and UX messages clear.
      // eslint-disable-next-line no-await-in-loop
      const updated = await zmienStatusInline(taskId, nextStatus);
      if (!updated && nextStatus === TASK_STATUS.ZAKONCZONE) break;
    }
    setSelectedTaskIds([]);
  };

  const getClientContact = (taskId) => clientContacts[String(taskId)] || {};

  const getOperatorName = () =>
    currentUser?.imie_nazwisko ||
    currentUser?.name ||
    currentUser?.login ||
    currentUser?.email ||
    'Operator';

  const buildClosureDecisionPayload = (guard, action, note = '') => ({
    action,
    severity: guard.blockers?.length ? 'danger' : guard.warnings?.length ? 'warning' : 'good',
    status_before: guard.status_before || guard.task?.status || '',
    status_after: action === 'forced_close' || action === 'clean_close' ? 'Zakonczone' : '',
    blockers: (guard.blockers || []).map(normalizeClosureDecisionItem),
    warnings: (guard.warnings || []).map(normalizeClosureDecisionItem),
    risk_score: guard.meta?.riskScore || 0,
    quality_score: guard.meta?.diagnostics?.score || 0,
    value: guard.meta?.value || 0,
    note,
  });

  const recordClosureDecision = async (guard, action, note = '') => {
    if (!guard?.task?.id) return null;
    const taskId = String(guard.task.id);
    const payload = buildClosureDecisionPayload(guard, action, note);
    const optimistic = normalizeClosureDecisionEvent({
      ...payload,
      id: `local-${Date.now()}-${action}`,
      task_id: guard.task.id,
      created_at: new Date().toISOString(),
      actor: getOperatorName(),
      created_by: currentUser?.id || null,
    });
    if (!optimistic) return null;
    setClosureDecisionEvents((prev) => ({
      ...prev,
      [taskId]: [optimistic, ...(prev[taskId] || [])].slice(0, 30),
    }));
    try {
      const token = getStoredToken();
      const res = await api.post(`/tasks/${guard.task.id}/closure-events`, payload, { headers: authHeaders(token) });
      const saved = normalizeClosureDecisionEvent(res.data);
      if (saved) {
        setClosureDecisionEvents((prev) => ({
          ...prev,
          [taskId]: [saved, ...(prev[taskId] || []).filter((event) => event.id !== optimistic.id)].slice(0, 30),
        }));
      }
      return saved || optimistic;
    } catch {
      return optimistic;
    }
  };

  const saveClientContact = async (task, patch, successMessage) => {
    if (!task?.id) return;
    const taskId = String(task.id);
    const updatedAt = new Date().toISOString();
    const optimisticPatch = normalizeClientContactPatch(patch);
    const optimistic = {
      ...(clientContacts[taskId] || {}),
      ...optimisticPatch,
      updatedAt,
      actor: getOperatorName(),
    };
    setClientContacts((prev) => ({ ...prev, [taskId]: optimistic }));

    try {
      const token = getStoredToken();
      const response = await api.patch(`/tasks/${task.id}/client-contact`, patch, { headers: authHeaders(token) });
      const normalized = normalizeClientContact(response.data);
      setClientContacts((prev) => ({
        ...prev,
        [taskId]: {
          ...optimistic,
          ...normalized,
          updatedAt: normalized.updatedAt || optimistic.updatedAt,
        },
      }));
      pokazKomunikat(successMessage || `Zapisano kontakt z klientem dla zlecenia #${task.id}.`);
    } catch {
      pokazKomunikat('API kontaktu jest niedostępne. Zapisano lokalnie w tej przeglądarce.', 'error');
    }
  };

  const markClientContactStatus = (task, status) => {
    const option = getClientContactOption(status);
    saveClientContact(task, { status }, `Kontakt z klientem: ${option.label}.`);
  };

  const saveContactNote = (task) => {
    saveClientContact(task, { note: contactDraft.trim() }, `Zapisano notatkę kontaktową dla zlecenia #${task.id}.`);
  };

  const markPreparedSms = (task) => {
    const existing = getClientContact(task.id);
    saveClientContact(
      task,
      {
        status: 'waiting',
        note: contactDraft.trim() || existing.note || 'Przygotowano wiadomość do klienta, oczekuje na odpowiedź.',
        due_at: existing.dueAt || getFollowupPresetIso(1),
      },
      `Oznaczono zlecenie #${task.id}: czeka na odpowiedź klienta.`
    );
  };

  const setContactDuePreset = (task, daysFromToday) => {
    const dueAt = getFollowupPresetIso(daysFromToday);
    setContactDueDraft(toDatetimeLocalValue(dueAt));
    saveClientContact(task, { due_at: dueAt }, `Ustawiono follow-up klienta dla zlecenia #${task.id}.`);
  };

  const saveContactDue = (task) => {
    const dueAt = datetimeLocalToIso(contactDueDraft);
    saveClientContact(task, { due_at: dueAt }, `Zapisano termin follow-upu dla zlecenia #${task.id}.`);
  };

  const clearContactDue = (task) => {
    setContactDueDraft('');
    saveClientContact(task, { due_at: null }, `Wyczyszczono termin follow-upu dla zlecenia #${task.id}.`);
  };

  const copyText = async (text, successMessage) => {
    if (!text) {
      pokazKomunikat('Brak danych do skopiowania.', 'error');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopyFallback(null);
      pokazKomunikat(successMessage);
    } catch {
      setCopyFallback({ text, title: successMessage });
      pokazKomunikat('Schowek zablokowany przez przeglądarkę. Tekst jest gotowy poniżej.', 'error');
    }
  };

  const buildTaskBrief = (task, index, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    const address = getTaskAddressLine(task) || 'brak adresu';
    const phone = task.klient_telefon || 'brak telefonu';
    const planned = formatTaskPlanLine(task);
    const blockers = diagnostics.items.length ? diagnostics.items.map((item) => item.label).join(', ') : 'brak';
    const mapUrl = getMapsHref(task);
    const equipment = getTaskEquipmentList(task);
    const description = getTaskCrewDescription(task);
    const risk = getTaskCrewRisk(task);
    const equipmentNote = getTaskCrewEquipmentNote(task);
    const photos = getTaskPhotoSummary(task);
    return [
      `${index ? `${index}. ` : ''}Zlecenie #${task.id}: ${task.klient_nazwa || 'bez klienta'}`,
      `Telefon: ${phone}`,
      `Adres: ${address}`,
      `Termin: ${planned}`,
      `Ekipa: ${task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak')}`,
      `Status: ${task.status || 'brak'}`,
      `Priorytet: ${task.priorytet || 'brak'} | Wartość: ${formatCurrency(task.wartosc_planowana)}`,
      description ? `Zakres: ${description}` : null,
      equipment.length || equipmentNote ? `Sprzet: ${[equipment.join(', '), equipmentNote].filter(Boolean).join(' | ')}` : null,
      risk ? `Ryzyka: ${risk}` : null,
      `Zdjecia: ${photos.total} razem, wycena/szkic: ${photos.fieldEvidence}`,
      `Blokery: ${blockers}`,
      `Następny ruch: ${diagnostics.nextAction.label}`,
      mapUrl ? `Mapa: ${mapUrl}` : null,
    ].filter(Boolean).join('\n');
  };

  const copyTaskBrief = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    copyText(buildTaskBrief(task, null, diagnostics), `Skopiowano brief zlecenia #${task.id}.`);
  };

  const copyCrewBrief = (task) => {
    if (!task) return;
    const taskId = String(task.id);
    const photosForTask = taskId === String(wybraneZlecenie?.id || '')
      ? selectedTaskPhotos
      : (taskPhotosById[taskId] || []);
    const problemsForTask = taskId === String(wybraneZlecenie?.id || '')
      ? selectedTaskProblems
      : (taskProblemsById[taskId] || []);
    const contact = getClientContact(task.id);
    const meta = getTaskBusinessMeta(task, todayIso, contact);
    const checklist = taskId === String(wybraneZlecenie?.id || '')
      ? detailSafetyChecklist
      : getTaskSafetyChecklist(task, meta, contact);
    const equipment = getTaskEquipmentList(task);
    const description = getTaskCrewDescription(task);
    const risk = getTaskCrewRisk(task);
    const equipmentNote = getTaskCrewEquipmentNote(task);
    const fieldPhotos = photosForTask.filter(isFieldEvidencePhoto);
    const readiness = buildCrewBriefReadiness({
      task,
      fieldPhotos,
      safetyChecklist: checklist,
      equipment,
      description,
      risk,
      equipmentNote,
    });
    const photoLines = fieldPhotos.slice(0, 6).map((photo, index) => {
      const url = taskAssetUrl(photo.sciezka || photo.url);
      return `${index + 1}. ${taskPhotoTypeLabel(photo.typ)}${photo.opis ? ` - ${photo.opis}` : ''}${url ? ` | ${url}` : ''}`;
    });
    const problemLines = problemsForTask.slice(0, 5).map((problem, index) => {
      const type = CREW_ISSUE_TYPES.find((item) => item.key === problem.typ)?.label || problem.typ || problem.type || 'Problem';
      const text = problem.opis || problem.description || problem.notatka || '';
      return `${index + 1}. ${type}${text ? ` - ${text}` : ''}`;
    });
    const safetyMissing = checklist.filter((item) => !item.ok).map((item) => `${item.label}: ${item.detail}`);
    const text = [
      `ARBOR-OS | ODPRAWA BRYGADY | Zlecenie #${task.id}`,
      `Gotowość pakietu: ${readiness.score}%`,
      readiness.blockers.length ? `Blokady: ${readiness.blockers.map((item) => item.label).join(', ')}` : 'Blokady: brak',
      '',
      `Klient: ${task.klient_nazwa || 'brak'}`,
      `Telefon: ${task.klient_telefon || 'brak'}`,
      `Adres: ${getTaskAddressLine(task) || 'brak'}`,
      getMapsHref(task) ? `Mapa: ${getMapsHref(task)}` : null,
      `Termin: ${formatTaskPlanLine(task)}`,
      `Ekipa: ${task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak')}`,
      `Status: ${task.status || 'brak'}`,
      `Wartość: ${formatCurrency(task.wartosc_planowana)}`,
      '',
      `Zakres prac: ${description || 'brak opisu'}`,
      `Sprzęt/logistyka: ${[equipment.join(', '), equipmentNote].filter(Boolean).join(' | ') || 'brak doprecyzowania'}`,
      `Ryzyka/BHP: ${risk || 'brak wpisanych ryzyk'}`,
      '',
      photoLines.length ? `Zdjęcia z oględzin:\n${photoLines.join('\n')}` : 'Zdjęcia z oględzin: brak',
      safetyMissing.length ? `Braki BHP / odprawy:\n${safetyMissing.join('\n')}` : 'BHP / odprawa: bez braków krytycznych',
      problemLines.length ? `Zgłoszone problemy:\n${problemLines.join('\n')}` : 'Zgłoszone problemy: brak',
      '',
      'Instrukcja: ekipa przed startem potwierdza zakres, zdjęcia i dojazd. Każdą zmianę zakresu zgłasza w aplikacji przed wykonaniem.',
    ].filter(Boolean).join('\n');
    copyText(text, `Skopiowano odprawę brygady #${task.id}.`);
  };

  const buildClientMessage = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    const planned = task.data_planowana ? String(task.data_planowana).slice(0, 10) : '';
    const address = getTaskAddressLine(task);
    const service = task.typ_uslugi ? t(`serviceType.${task.typ_uslugi}`, { defaultValue: task.typ_uslugi }) : '';
    const mapUrl = getMapsHref(task);

    return [
      task.klient_nazwa ? `Dzień dobry, ${task.klient_nazwa}.` : 'Dzień dobry.',
      getClientMessageStatusLine(task, planned),
      service ? `Zakres: ${service}.` : null,
      planned ? `Termin: ${planned}.` : 'Termin: do potwierdzenia.',
      address ? `Adres: ${address}.` : null,
      getClientMessageNextStep(task, diagnostics),
      mapUrl ? `Mapa: ${mapUrl}` : null,
      'ARBOR-OS',
    ].filter(Boolean).join('\n');
  };

  const copyClientMessage = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    copyText(buildClientMessage(task, diagnostics), `Skopiowano SMS do klienta dla zlecenia #${task.id}.`);
  };

  const copyTaskAddress = (task) => {
    copyText(getTaskAddressLine(task), `Skopiowano adres zlecenia #${task.id}.`);
  };

  const copyDispatchManifest = (tasks, label = 'bieżącego widoku') => {
    const scopedTasks = tasks.filter(Boolean);
    if (scopedTasks.length === 0) {
      pokazKomunikat('Brak zleceń do odprawy.', 'error');
      return;
    }
    const value = scopedTasks.reduce((sum, task) => sum + (Number(task.wartosc_planowana) || 0), 0);
    const withAddress = scopedTasks.filter((task) => getTaskAddressLine(task)).length;
    const withPhone = scopedTasks.filter((task) => telHref(task.klient_telefon)).length;
    const directionsHref = getDirectionsHref(scopedTasks);
    const manifest = [
      `ARBOR-OS | Odprawa operacyjna ${label}`,
      `Zleceń: ${scopedTasks.length} | Telefony: ${withPhone}/${scopedTasks.length} | Adresy: ${withAddress}/${scopedTasks.length} | Wartość: ${formatCurrency(value)}`,
      directionsHref ? `Trasa zbiorcza: ${directionsHref}` : null,
      '',
      scopedTasks.map((task, index) => buildTaskBrief(task, index + 1)).join('\n\n'),
    ].filter((line) => line !== null).join('\n');
    copyText(manifest, `Skopiowano odprawę: ${scopedTasks.length} zleceń.`);
  };

  const buildOfficePlanHandoffText = (task) => {
    if (!task) return '';
    const taskId = String(task.id || '');
    const isCurrentTask = taskId === String(wybraneZlecenie?.id || '');
    const photosForTask = isCurrentTask
      ? selectedTaskPhotos
      : (taskPhotosById[taskId] || []);
    const fieldPhotos = photosForTask.filter(isFieldEvidencePhoto);
    const photoLines = fieldPhotos.slice(0, 8).map((photo, index) => {
      const url = taskAssetUrl(photo.sciezka || photo.url);
      return `${index + 1}. ${taskPhotoTypeLabel(photo.typ)}${photo.opis ? ` - ${photo.opis}` : ''}${url ? ` | ${url}` : ''}`;
    });
    const diagnostics = getTaskDiagnostics(task, todayIso);
    const readiness = isCurrentTask ? officePlanReadinessItems : [];
    const requiredMissing = readiness.filter((item) => item.required && !item.ok).map((item) => item.label);
    const warnings = readiness.filter((item) => !item.required && !item.ok).map((item) => item.label);
    const branchLabel = task.oddzial_id ? getBranchLabel(task.oddzial_id) : 'brak oddzialu';
    const description = getTaskCrewDescription(task);
    const risk = getTaskCrewRisk(task);
    const equipmentNote = getTaskCrewEquipmentNote(task);
    const equipmentList = getTaskEquipmentList(task);
    const planDate = isCurrentTask
      ? (officePlan.data_planowana || taskDateOnly(task.data_planowana))
      : taskDateOnly(task.data_planowana);
    const planTime = isCurrentTask
      ? (officePlan.godzina_rozpoczecia || task.godzina_rozpoczecia || '')
      : (task.godzina_rozpoczecia || '');
    const planHours = isCurrentTask
      ? (officePlan.czas_planowany_godziny || task.czas_planowany_godziny || '')
      : (task.czas_planowany_godziny || '');
    const teamLabel = isCurrentTask
      ? (officePlanTeamLabel || task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak'))
      : (task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak'));
    const equipmentLabel = isCurrentTask
      ? (officePlanHandoffEquipmentLabel || equipmentList.join(', ') || equipmentNote || 'brak')
      : ([equipmentList.join(', '), equipmentNote].filter(Boolean).join(' | ') || 'brak');
    const value = Number(task.wartosc_planowana || task.budzet || 0);
    const mapUrl = getMapsHref(task);

    return [
      `ARBOR-OS | PAKIET PLANOWANIA | Zlecenie #${task.id}`,
      `Status: ${task.status || 'brak'} | Oddzial: ${branchLabel} | Gotowosc: ${diagnostics.score}/100`,
      '',
      'KLIENT',
      `Nazwa: ${task.klient_nazwa || 'brak'}`,
      `Telefon: ${task.klient_telefon || 'brak'}`,
      `Adres: ${getTaskAddressLine(task) || 'brak'}`,
      mapUrl ? `Mapa: ${mapUrl}` : null,
      '',
      'PAKIET Z OGLEDZIN',
      `Zakres: ${description || 'brak opisu zakresu'}`,
      `Ryzyka: ${risk || 'brak ryzyk'}`,
      `Zdjecia/szkic: ${fieldPhotos.length}/${photosForTask.length || 0}`,
      photoLines.length ? photoLines.join('\n') : 'Brak linkow do zdjec z ogledzin.',
      '',
      'PLAN BIURA',
      `Termin: ${[planDate, planTime].filter(Boolean).join(' ') || 'brak'}`,
      `Czas: ${planHours ? `${planHours} h` : 'brak'}`,
      `Ekipa: ${teamLabel}`,
      `Sprzet: ${equipmentLabel}`,
      `Budzet/wartosc: ${formatCurrencyZero(value)}`,
      '',
      'BRAKI I UWAGI',
      requiredMissing.length ? `Blokady: ${requiredMissing.join(', ')}` : 'Blokady: brak',
      warnings.length ? `Uwagi: ${warnings.join(', ')}` : 'Uwagi: brak',
      `Nastepny ruch: ${diagnostics.nextAction?.label || 'sprawdz zlecenie'}`,
    ].filter(Boolean).join('\n');
  };

  const copyOfficePlanHandoff = (task) => {
    copyText(buildOfficePlanHandoffText(task), `Skopiowano pakiet planowania zlecenia #${task.id}.`);
  };

  const handleTaskNextAction = async (task, diagnostics) => {
    const action = diagnostics.nextAction;
    if (action.target === 'status' && action.nextStatus && mozePrzesuwacStatus) {
      await zmienStatusInline(task.id, action.nextStatus);
      return;
    }
    if (action.target === 'officePlan') {
      otworzSzczegoly(task);
      window.setTimeout(() => scrollToDetailSection('officePlan'), 180);
      return;
    }
    if (action.target === 'photos') {
      otworzSzczegoly(task);
      window.setTimeout(() => scrollToDetailSection('photos'), 180);
      return;
    }
    if (action.target === 'edit' && mozeEdytowac) {
      otworzEdycje(task, getFormStepForEditAction(action));
      return;
    }
    otworzSzczegoly(task);
  };

  const openClosureRepairTask = (task, mode = 'details') => {
    if (!task) return;
    if (mode === 'edit' && mozeEdytowac) {
      otworzEdycje(task);
      return;
    }
    otworzSzczegoly(task);
  };

  const handleDetailDecisionAction = async () => {
    const action = detailNextAction || detailBusinessMeta?.diagnostics?.nextAction;
    if (!wybraneZlecenie || !action) return;
    if (action.target === 'edit' && mozeEdytowac) {
      otworzEdycje(wybraneZlecenie, action.formStep || getFormStepForEditAction(action), action.focusField ? {
        field: action.focusField,
        label: action.repairLabel || action.label || 'Pole do poprawy',
        detail: action.repairDetail || action.detail || '',
      } : null);
      return;
    }
    if (action.target === 'contact') {
      scrollToDetailSection('contact');
      pokazKomunikat('Sekcja kontaktu jest poniżej. Zapisz notatkę lub ustaw follow-up po rozmowie.');
      return;
    }
    await handleTaskNextAction(wybraneZlecenie, { ...(detailBusinessMeta?.diagnostics || {}), nextAction: action });
  };

  const scrollToDetailSection = (sectionKey) => {
    const run = () => {
      const target = document.querySelector(`[data-detail-section="${sectionKey}"]`);
      if (!target) return false;
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      if (typeof window.scrollTo === 'function' && typeof target.getBoundingClientRect === 'function') {
        const currentTop = window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
        window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + currentTop - 12), behavior: 'smooth' });
        return true;
      }
      return false;
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 0);
    }
  };

  const focusWorkflowPath = () => {
    setWorkflowPathFocused(true);
    scrollToDetailSection('workflowPath');
    if (workflowPathFocusTimerRef.current) {
      window.clearTimeout(workflowPathFocusTimerRef.current);
    }
    workflowPathFocusTimerRef.current = window.setTimeout(() => {
      setWorkflowPathFocused(false);
      workflowPathFocusTimerRef.current = null;
    }, 2600);
  };

  useEffect(() => {
    const focus = new URLSearchParams(location.search).get('focus') || '';
    if (!routeTaskId || tryb !== 'szczegoly' || String(wybraneZlecenie?.id || '') !== String(routeTaskId)) return undefined;
    if (!['photos', 'officePlan', 'crewBrief', 'decision', 'contact'].includes(focus)) return undefined;
    let attempts = 0;
    let timer = null;
    const tick = () => {
      attempts += 1;
      scrollToDetailSection(focus);
      if (attempts < 6) timer = window.setTimeout(tick, 240);
    };
    timer = window.setTimeout(tick, 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, routeTaskId, tryb, wybraneZlecenie?.id]);

  const handleDetailWorkflowCommand = async (action) => {
    if (!wybraneZlecenie || !action) return;
    if (action.target === 'status' && action.nextStatus) {
      if (!mozePrzesuwacStatus) {
        pokazKomunikat('Brak uprawnień do zmiany statusu z tego panelu.', 'error');
        return;
      }
      await zmienStatusInline(wybraneZlecenie.id, action.nextStatus);
      return;
    }
    if (action.target === 'edit') {
      if (!mozeEdytowac) {
        pokazKomunikat('Brak uprawnień do edycji tego zlecenia.', 'error');
        return;
      }
      otworzEdycje(wybraneZlecenie, action.formStep || getFormStepForEditAction(action), action.focusField ? {
        field: action.focusField,
        label: action.repairLabel || action.label || 'Pole do poprawy',
        detail: action.repairDetail || action.detail || '',
      } : null);
      return;
    }
    if (action.target === 'photos') {
      if (action.repairLabel || action.repairDetail) {
        const label = action.repairLabel || 'Dokumentacja zdjeciowa';
        const detail = action.repairDetail || 'Dodaj zdjecie z wyceny albo szkic zakresu.';
        const lower = `${label} ${detail}`.toLowerCase();
        const isSketch = lower.includes('szkic') || lower.includes('rys');
        setTaskPhotoRepairFocus({ label, detail });
        setTaskPhotoDraft((prev) => ({
          ...prev,
          typ: isSketch ? 'Szkic' : 'Wycena',
          tagi: isSketch ? 'szkic, wycena, teren' : 'wycena, teren',
        }));
      }
      scrollToDetailSection('photos');
      return;
    }
    if (action.target === 'officePlan') {
      scrollToDetailSection('officePlan');
      return;
    }
    if (action.target === 'crewBrief') {
      scrollToDetailSection('crewBrief');
      return;
    }
    if (action.target === 'decision') {
      scrollToDetailSection('decision');
      return;
    }
    if (action.target === 'contact') {
      scrollToDetailSection('contact');
      return;
    }
    if (action.target === 'copyBrief') {
      copyTaskBrief(wybraneZlecenie);
    }
  };

  const handleOfficeDecisionAction = (action) => {
    if (!wybraneZlecenie || !action) return;
    if (action === 'photos') {
      scrollToDetailSection('photos');
      return;
    }
    if (action === 'officePlan') {
      scrollToDetailSection('officePlan');
      return;
    }
    if (action === 'crewBrief') {
      scrollToDetailSection('crewBrief');
      return;
    }
    if (action === 'contact') {
      scrollToDetailSection('contact');
      return;
    }
    if (action === 'finance') {
      if (mozeEdytowac) {
        otworzEdycje(wybraneZlecenie, 'finance');
        return;
      }
      scrollToDetailSection('decision');
    }
  };

  const continueCloseGuard = async () => {
    const guard = closeGuard;
    if (!guard || !guard.canForceClose) return;
    setCloseGuard(null);
    if (guard.mode === 'form') {
      await zapiszZlecenie({ forceClose: true, guard });
      return;
    }
    await zmienStatusInline(guard.task.id, 'Zakonczone', { forceClose: true, guard });
  };

  const fixCloseGuard = () => {
    const guard = closeGuard;
    setCloseGuard(null);
    if (!guard) return;
    recordClosureDecision(guard, 'fix_started', 'Operator wrócił do poprawy danych przed zamknięciem.');
    if (guard.mode === 'form') return;
    if (mozeEdytowac) {
      otworzEdycje(guard.task);
      return;
    }
    otworzSzczegoly(guard.task);
  };

  const toCsvValue = (value) => {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(';') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const exportFilteredCsv = () => {
    const headers = [
      'ID',
      'Klient',
      'Adres',
      'Miasto',
      'Typ uslugi',
      'Status',
      'Priorytet',
      'SLA',
      'Data planowana',
      'Wartosc planowana',
      'Oddzial ID',
      'Ekipa ID',
      'Kontakt status',
      'Follow-up kontakt',
    ];
    const rows = widoczneZlecenia.map((z) => [
      z.id,
      z.klient_nazwa,
      z.adres,
      z.miasto,
      z.typ_uslugi,
      z.status,
      z.priorytet,
      getSlaFlags(z).join(', ') || 'OK',
      z.data_planowana ? z.data_planowana.split('T')[0] : '',
      z.wartosc_planowana ?? '',
      z.oddzial_id ?? '',
      z.ekipa_id ?? '',
      getClientContactOption(getClientContact(z.id).status).label,
      getClientContact(z.id).dueAt ? formatContactStamp(getClientContact(z.id).dueAt) : '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `zlecenia-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pokazKomunikat(`Wyeksportowano ${rows.length} rekordów do CSV.`);
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const isTaskForCurrentUserTurn = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    if (!currentUser || !task || isTaskClosed(task.status)) return false;
    const role = String(currentUser.rola || '').toLowerCase();
    const status = String(task.status || '');
    const userId = String(currentUser.id || '');
    const userTeamId = String(currentUser.ekipa_id || '');
    const taskEstimatorId = String(task.wyceniajacy_id || '');
    const taskTeamId = String(task.ekipa_id || '');
    const taskLeaderId = String(task.brygadzista_id || '');
    const branchMatches = !currentUser.oddzial_id || !task.oddzial_id || String(task.oddzial_id) === String(currentUser.oddzial_id);

    if (role.includes('wyceniaj')) {
      return status === TASK_STATUS.WYCENA_TERENOWA && taskEstimatorId && taskEstimatorId === userId;
    }
    if (role.includes('bryg') || role.includes('pomoc')) {
      const teamMatches = (userTeamId && taskTeamId === userTeamId) || (userId && taskLeaderId === userId);
      return teamMatches && [TASK_STATUS.ZAPLANOWANE, TASK_STATUS.W_REALIZACJI].includes(status);
    }
    if (role.includes('specjal') || role.includes('sprzeda')) {
      return branchMatches && [TASK_STATUS.NOWE, TASK_STATUS.DO_ZATWIERDZENIA].includes(status);
    }
    if (role.includes('kierownik')) {
      return branchMatches && (
        [TASK_STATUS.NOWE, TASK_STATUS.DO_ZATWIERDZENIA].includes(status) ||
        diagnostics.readyToClose ||
        diagnostics.blockers.length > 0
      );
    }
    if (['prezes', 'dyrektor', 'administrator'].includes(role)) {
      return [TASK_STATUS.NOWE, TASK_STATUS.DO_ZATWIERDZENIA].includes(status) ||
        diagnostics.readyToClose ||
        diagnostics.blockers.length > 0 ||
        diagnostics.has.overdue;
    }
    return false;
  };
  const matchesSmartFilter = (task, filterKey = smartFilter) => {
    if (!filterKey) return true;
    const diagnostics = getTaskDiagnostics(task, todayIso);
    if (filterKey === 'myTurn') return isTaskForCurrentUserTurn(task, diagnostics);
    if (filterKey === 'overdue') return diagnostics.has.overdue;
    if (filterKey === 'unassigned') return diagnostics.has.unassigned;
    if (filterKey === 'urgent') return diagnostics.has.urgent;
    if (filterKey === 'today') return diagnostics.has.today;
    if (filterKey === 'noDate') return diagnostics.has.noDate;
    if (filterKey === 'noContact') return diagnostics.has.noContact;
    if (filterKey === 'noMedia') return diagnostics.has.noMedia;
    if (filterKey === 'noFieldSketch') return diagnostics.has.noFieldSketch;
    if (filterKey === 'noPrice') return diagnostics.has.noPrice;
    if (filterKey === 'noCheckin') return diagnostics.has.noCheckin;
    if (filterKey === 'fieldActive') return diagnostics.has.fieldActive;
    if (filterKey === 'fieldInspection') return getTaskInspectionWorkflow(task, diagnostics).key === 'fieldInspection';
    if (filterKey === 'officeApproval') return getTaskInspectionWorkflow(task, diagnostics).key === 'officeApproval';
    if (filterKey === 'officePlanBlocked') {
      const readiness = getTaskPackageReadiness(task, 'office');
      return readiness.relevant && !readiness.ready;
    }
    if (filterKey === 'crewPackageBlocked') {
      const readiness = getTaskPackageReadiness(task, 'crew');
      return readiness.relevant && !readiness.ready;
    }
    if (filterKey === 'readyClose') return diagnostics.has.readyClose;
    if (filterKey === 'contactTodo') {
      const contactStatus = getClientContact(task.id).status;
      return !contactStatus || contactStatus === 'todo';
    }
    if (filterKey === 'contactWaiting') return getClientContact(task.id).status === 'waiting';
    if (filterKey === 'contactRisk') return getClientContact(task.id).status === 'risk';
    if (filterKey === 'contactOverdue') return getContactFollowupMeta(getClientContact(task.id)).overdue;
    if (filterKey === 'contactToday') return getContactFollowupMeta(getClientContact(task.id)).today;
    return true;
  };
  const smartFilterCounts = SMART_FILTERS.map((item) => ({
    ...item,
    count: zlecenia.filter((task) => matchesSmartFilter(task, item.key)).length,
  }));
  const activeSmartLabel = SMART_FILTERS.find((item) => item.key === smartFilter)?.label;
  const matchesOperationalView = (task, view) => {
    if (view.smartFilter && !matchesSmartFilter(task, view.smartFilter)) return false;
    if (view.status && task.status !== view.status) return false;
    return true;
  };
  const operationalViews = OPERATIONAL_VIEWS.map((view) => {
    const viewTasks = zlecenia.filter((task) => matchesOperationalView(task, view));
    const openViewTasks = viewTasks.filter((task) => !isTaskClosed(task.status));
    const viewDiagnostics = openViewTasks.map((task) => getTaskDiagnostics(task, todayIso));
    const blocked = viewDiagnostics.filter((diagnostics) => diagnostics.blockers.length > 0).length;
    const ready = viewDiagnostics.filter((diagnostics) => diagnostics.blockers.length === 0).length;
    return {
      ...view,
      count: viewTasks.length,
      blocked,
      ready,
    };
  });
  const activeOperationalViewKey = operationalViews.find((view) =>
    (view.smartFilter || '') === (smartFilter || '') &&
    (view.status || '') === (filtrStatus || '') &&
    !filtrTyp &&
    !filtrOddzial &&
    !filtrEkipa &&
    !szukaj
  )?.key;

  const applyOperationalView = (view) => {
    setSmartFilter(view.smartFilter || '');
    setFiltrStatus(view.status || '');
    setFiltrTyp('');
    setFiltrOddzial('');
    setFiltrEkipa('');
    setSzukaj('');
    setSelectedTaskIds([]);
  };

  const filtrowane = zlecenia.filter(z => {
    if (smartFilter && !matchesSmartFilter(z)) return false;
    if (filtrStatus && z.status !== filtrStatus) return false;
    if (filtrTyp && z.typ_uslugi !== filtrTyp) return false;
    if (filtrOddzial && String(z.oddzial_id || '') !== filtrOddzial) return false;
    if (filtrEkipa && String(z.ekipa_id || '') !== filtrEkipa) return false;
    if (szukaj) {
      const q = szukaj.toLowerCase();
      if (!`${z.klient_nazwa} ${z.adres} ${z.miasto}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const widoczneZlecenia = [...filtrowane].sort((a, b) => compareTasksBySort(a, b, sortMode, todayIso));
  const activeSort = TASK_SORT_OPTIONS.find((option) => option.key === sortMode) || TASK_SORT_OPTIONS[0];
  const queueItems = widoczneZlecenia.slice(0, 3).map((task) => ({
    task,
    meta: getTaskQueueMeta(task, todayIso),
  }));
  const businessGuard = buildBusinessGuardSummary(widoczneZlecenia, todayIso, getClientContact);
  const visibleOpenTasks = widoczneZlecenia.filter((task) => !isTaskClosed(task.status));
  const visibleValue = widoczneZlecenia.reduce((sum, task) => sum + (Number(task.wartosc_planowana) || 0), 0);
  const visibleUnassigned = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.unassigned).length;
  const visibleNoDate = visibleOpenTasks.filter((task) => !getTaskDay(task)).length;
  const visibleNoContact = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noContact).length;
  const visibleNoMedia = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noMedia).length;
  const visibleNoFieldSketch = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noFieldSketch).length;
  const visibleNoPrice = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noPrice).length;
  const visibleNoCheckin = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noCheckin).length;
  const visibleFieldActive = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.fieldActive).length;
  const visibleFieldInspection = visibleOpenTasks.filter((task) => getTaskInspectionWorkflow(task, getTaskDiagnostics(task, todayIso)).key === 'fieldInspection').length;
  const visibleOfficeApproval = visibleOpenTasks.filter((task) => getTaskInspectionWorkflow(task, getTaskDiagnostics(task, todayIso)).key === 'officeApproval').length;
  const visibleOfficePlanBlocked = visibleOpenTasks.filter((task) => {
    const readiness = getTaskPackageReadiness(task, 'office');
    return readiness.relevant && !readiness.ready;
  }).length;
  const visibleCrewPackageBlocked = visibleOpenTasks.filter((task) => {
    const readiness = getTaskPackageReadiness(task, 'crew');
    return readiness.relevant && !readiness.ready;
  }).length;
  const visibleToday = widoczneZlecenia.filter((task) => getTaskDiagnostics(task, todayIso).has.today).length;
  const visibleReadyClose = widoczneZlecenia.filter((task) => getTaskDiagnostics(task, todayIso).has.readyClose).length;
  const visibleWorkflowBlocked = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).blockers.length > 0).length;
  const workflowPathStats = [
    { key: 'open', label: 'Otwarte w widoku', value: visibleOpenTasks.length, detail: 'bez zamknietych i anulowanych' },
    { key: 'ready', label: 'Gotowe do kroku', value: Math.max(0, visibleOpenTasks.length - visibleWorkflowBlocked), detail: 'bez krytycznych brakow' },
    { key: 'blocked', label: 'Z blokada', value: visibleWorkflowBlocked, detail: 'wymaga reakcji biura lub terenu' },
  ];
  const dispatchReadiness = [
    { key: 'crew', label: 'Obsada', count: visibleUnassigned, ok: 'Ekipy gotowe', danger: 'Bez ekipy', filterKey: 'unassigned' },
    { key: 'time', label: 'Termin', count: visibleNoDate, ok: 'Plan gotowy', danger: 'Bez terminu', filterKey: 'noDate' },
    { key: 'photos', label: 'Zdjęcia', count: visibleNoMedia, ok: 'Dokumentacja OK', danger: 'Bez zdjęć', filterKey: 'noMedia' },
    { key: 'sketch', label: 'Szkic', count: visibleNoFieldSketch, ok: 'Zakres opisany', danger: 'Bez szkicu', filterKey: 'noFieldSketch' },
    { key: 'price', label: 'Wycena', count: visibleNoPrice, ok: 'Cena OK', danger: 'Bez wyceny', filterKey: 'noPrice' },
    { key: 'checkin', label: 'Check-in', count: visibleNoCheckin, ok: 'Teren potwierdzony', danger: 'Brak check-in', filterKey: 'noCheckin' },
    { key: 'contact', label: 'Kontakt', count: visibleNoContact, ok: 'Kontakt OK', danger: 'Brak telefonu', filterKey: 'noContact' },
    { key: 'officePackage', label: 'Pakiet biura', count: visibleOfficePlanBlocked, ok: 'Planowanie OK', danger: 'Blokuje biuro', filterKey: 'officePlanBlocked' },
    { key: 'crewPackage', label: 'Pakiet ekipy', count: visibleCrewPackageBlocked, ok: 'Ekipa gotowa', danger: 'Blokuje ekipę', filterKey: 'crewPackageBlocked' },
  ];
  const topDispatchBlocker = dispatchReadiness.find((item) => item.count > 0);
  const decisionCommand = visibleWorkflowBlocked > 0
    ? {
        tone: 'warning',
        label: 'Najpierw usuń blokady procesu',
        detail: topDispatchBlocker
          ? `${topDispatchBlocker.danger}: ${topDispatchBlocker.count} w bieżącym widoku`
          : `${visibleWorkflowBlocked} otwartych zleceń wymaga reakcji`,
        cta: 'Pokaż blokadę',
        filterKey: topDispatchBlocker?.filterKey || 'overdue',
      }
    : businessGuard.criticalCount > 0
      ? {
          tone: 'danger',
          label: 'Sprawdź marżę i ryzyko',
          detail: `${businessGuard.criticalCount} pozycji pod kontrolą, ${formatMoneyBrief(businessGuard.riskValue)} wartości pod ryzykiem`,
          cta: 'Otwórz finanse',
          openFinance: true,
        }
      : visibleReadyClose > 0
        ? {
            tone: 'green',
            label: 'Zamknij gotowe zlecenia',
            detail: `${visibleReadyClose} zleceń czeka na finalne potwierdzenie i rozliczenie`,
            cta: 'Pokaż do zamknięcia',
            filterKey: 'readyClose',
          }
        : {
            tone: 'green',
            label: 'Widok jest operacyjnie czysty',
            detail: 'Możesz pracować według kolejki ryzyka albo przejść do planowania.',
            cta: 'Ustaw ryzyko',
            sortKey: 'risk',
          };
  const decisionKpis = [
    { key: 'blocked', label: 'Blokady', value: visibleWorkflowBlocked, detail: 'otwarte sprawy' },
    { key: 'ready', label: 'Do zamknięcia', value: visibleReadyClose, detail: 'gotowe' },
    { key: 'value', label: 'Wartość', value: formatMoneyBrief(visibleValue), detail: 'w widoku' },
  ];
  const decisionQuickActions = [
    { key: 'unassigned', label: 'Bez ekipy', value: visibleUnassigned, filterKey: 'unassigned' },
    { key: 'noDate', label: 'Bez terminu', value: visibleNoDate, filterKey: 'noDate' },
    { key: 'readyClose', label: 'Do zamknięcia', value: visibleReadyClose, filterKey: 'readyClose' },
    { key: 'finance', label: 'Ryzyko', value: businessGuard.criticalCount, openFinance: true },
  ];
  const zleceniaOpsCards = [
    { label: 'Widoczne', value: widoczneZlecenia.length, detail: `${zlecenia.length} w systemie`, tone: 'green' },
    { label: 'Wartość widoku', value: formatMoneyBrief(visibleValue), detail: 'planowana wartość prac', tone: 'green' },
    { label: 'Ryzyko', value: businessGuard.criticalCount, detail: formatMoneyBrief(businessGuard.riskValue), tone: businessGuard.criticalCount ? 'danger' : 'green' },
    { label: 'Bez ekipy', value: visibleUnassigned, detail: 'do dyspozycji', tone: visibleUnassigned ? 'warning' : 'green', filterKey: 'unassigned' },
    { label: 'Bez terminu', value: visibleNoDate, detail: 'nie wejdą do planu', tone: visibleNoDate ? 'warning' : 'green', filterKey: 'noDate' },
    { label: 'Bez zdjęć', value: visibleNoMedia, detail: 'ryzyko sporu z klientem', tone: visibleNoMedia ? 'danger' : 'green', filterKey: 'noMedia' },
    { label: 'Bez wyceny', value: visibleNoPrice, detail: 'teren bez ceny', tone: visibleNoPrice ? 'warning' : 'green', filterKey: 'noPrice' },
    { label: 'Brak check-in', value: visibleNoCheckin, detail: 'ekipa nie potwierdzila miejsca', tone: visibleNoCheckin ? 'danger' : 'green', filterKey: 'noCheckin' },
    { label: 'Praca trwa', value: visibleFieldActive, detail: 'aktywny log czasu', tone: visibleFieldActive ? 'blue' : 'green', filterKey: 'fieldActive' },
    { label: 'Pakiet biura', value: visibleOfficePlanBlocked, detail: 'blokuje plan', tone: visibleOfficePlanBlocked ? 'danger' : 'green', filterKey: 'officePlanBlocked' },
    { label: 'Pakiet ekipy', value: visibleCrewPackageBlocked, detail: 'blokuje start', tone: visibleCrewPackageBlocked ? 'warning' : 'green', filterKey: 'crewPackageBlocked' },
    { label: 'U specjalistów ds. wyceny', value: visibleFieldInspection, detail: 'oględziny / wycena', tone: 'warning', filterKey: 'fieldInspection' },
    { label: 'Do zatwierdzenia', value: visibleOfficeApproval, detail: 'biuro tylko akceptuje', tone: visibleOfficeApproval ? 'blue' : 'green', filterKey: 'officeApproval' },
    { label: 'Dzisiaj', value: visibleToday, detail: `${visibleReadyClose} do zamknięcia`, tone: 'blue', filterKey: 'today' },
  ];
  const zleceniaDailyCards = zleceniaOpsCards.slice(0, 8);
  const closureAudit = buildClosureAuditSummary(closureDecisionEvents, zlecenia);
  const effectiveClosureIssueKey = closureAudit.topIssues.some((issue) => issue.key === activeClosureIssueKey)
    ? activeClosureIssueKey
    : '';
  const activeClosureIssue = closureAudit.topIssues.find((issue) => issue.key === effectiveClosureIssueKey) || null;
  const closureRepairQueue = buildClosureRepairQueue(closureAudit.rows, effectiveClosureIssueKey);
  const visibleIds = widoczneZlecenia.map((z) => z.id);
  const selectedVisibleTasks = widoczneZlecenia.filter((z) => selectedTaskIds.includes(z.id));
  const viewRouteHref = getDirectionsHref(widoczneZlecenia.slice(0, 8));
  const selectedRouteHref = getDirectionsHref(selectedVisibleTasks);
  const hasActiveListFilters = Boolean(filtrStatus || filtrTyp || filtrEkipa || filtrOddzial || szukaj || smartFilter);
  const emptyListSteps = zlecenia.length === 0
    ? [
        { key: 'phone', label: '1. Telefon', detail: 'Zapisz klienta, adres i termin oględzin.' },
        { key: 'field', label: '2. Oględziny', detail: 'Specjalista dostaje pakiet w mobilce.' },
        { key: 'office', label: '3. Plan', detail: 'Biuro dopina ekipę, sprzęt i odprawę.' },
      ]
    : [
        { key: 'filters', label: '1. Filtry', detail: 'Wyczyść lub zmień aktywne zawężenie.' },
        { key: 'risk', label: '2. Ryzyko', detail: 'Wróć do kolejki posortowanej według blokad.' },
        { key: 'kanban', label: '3. Etapy', detail: 'Przejdź na Kanban, jeśli szukasz statusu.' },
      ];
  const detailContact = wybraneZlecenie ? getClientContact(wybraneZlecenie.id) : {};
  const detailContactOption = getClientContactOption(detailContact.status);
  const detailFollowupMeta = getContactFollowupMeta(detailContact);
  const detailBusinessMeta = wybraneZlecenie ? getTaskBusinessMeta(wybraneZlecenie, todayIso, detailContact) : null;
  const detailPriceGuidance = wybraneZlecenie && detailBusinessMeta
    ? getTaskPriceGuidance(wybraneZlecenie, detailBusinessMeta)
    : null;
  const detailQualityChecklist = wybraneZlecenie && detailBusinessMeta
    ? getTaskQualityChecklist(wybraneZlecenie, detailBusinessMeta, detailContact)
    : [];
  const detailSafetyChecklist = wybraneZlecenie && detailBusinessMeta
    ? getTaskSafetyChecklist(wybraneZlecenie, detailBusinessMeta, detailContact)
    : [];
  const detailBlockingChecklist = [
    ...detailQualityChecklist,
    ...detailSafetyChecklist,
  ];
  const detailSafetyOkCount = detailSafetyChecklist.filter((item) => item.ok).length;
  const detailSafetyRequiredIssues = detailSafetyChecklist.filter((item) => item.required && !item.ok);
  const detailEquipmentList = wybraneZlecenie ? getTaskEquipmentList(wybraneZlecenie) : [];
  const detailQualityOkCount = detailQualityChecklist.filter((item) => item.ok).length;
  const detailRequiredIssues = detailQualityChecklist.filter((item) => item.required && !item.ok);
  const detailWorkflowStatusBlockers = detailBlockingChecklist.find((item) => item.required && !item.ok)
    ? { [TASK_STATUS.ZAKONCZONE]: detailBlockingChecklist.find((item) => item.required && !item.ok) }
    : {};
  const detailDecisionRecommendation = wybraneZlecenie && detailBusinessMeta
    ? getTaskDecisionRecommendation(wybraneZlecenie, detailBusinessMeta, detailBlockingChecklist, detailContact)
    : '';
  const detailNextAction = wybraneZlecenie && detailBusinessMeta
    ? getTaskDetailNextAction(wybraneZlecenie, detailBusinessMeta, detailBlockingChecklist)
    : null;
  const detailClosureEvents = wybraneZlecenie ? (closureDecisionEvents[String(wybraneZlecenie.id)] || []) : [];
  const areAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.includes(id));
  const KANBAN_COLUMNS = TASK_STATUSES;
  const ekipyPlanowania = mergeTeamOptions(ekipy, branchTeams);
  const sprzetPlanowania = mergeEquipmentOptions(sprzetItems, branchEquipment);
  const branchLabelsById = new Map();
  if (currentUser?.oddzial_id) {
    branchLabelsById.set(String(currentUser.oddzial_id), currentUser.oddzial_nazwa || `Oddział #${currentUser.oddzial_id}`);
  }
  for (const branch of oddzialy) {
    if (branch.id) {
      const id = String(branch.id);
      branchLabelsById.set(id, branch.nazwa || branch.miasto || `Oddział #${id}`);
    }
  }
  for (const task of zlecenia) {
    if (task.oddzial_id) {
      const id = String(task.oddzial_id);
      if (!branchLabelsById.has(id) || !branchLabelsById.get(id)) {
        branchLabelsById.set(id, task.oddzial_nazwa || task.oddzial || task.miasto || `Oddział #${id}`);
      }
    }
  }
  for (const worker of uzytkownicy) {
    if (worker.oddzial_id) {
      const id = String(worker.oddzial_id);
      if (!branchLabelsById.has(id) || !branchLabelsById.get(id)) {
        branchLabelsById.set(id, worker.oddzial_nazwa || worker.oddzial || worker.miasto || `Oddział #${id}`);
      }
    }
  }
  for (const team of ekipy) {
    if (team.oddzial_id) {
      const id = String(team.oddzial_id);
      if (!branchLabelsById.has(id) || !branchLabelsById.get(id)) {
        branchLabelsById.set(id, team.oddzial_nazwa || team.oddzial || team.miasto || `Oddział #${id}`);
      }
    }
  }
  for (const team of ekipyPlanowania) {
    const id = String(teamAvailableBranchId(team) || '');
    if (id && (!branchLabelsById.has(id) || !branchLabelsById.get(id))) {
      branchLabelsById.set(
        id,
        team.dostepny_w_oddziale_nazwa ||
          team.oddzial_macierzysty_nazwa ||
          team.oddzial_nazwa ||
          team.oddzial ||
          team.miasto ||
          `Oddział #${id}`
      );
    }
  }
  for (const item of sprzetPlanowania) {
    if (item.oddzial_id) {
      const id = String(item.oddzial_id);
      if (!branchLabelsById.has(id) || !branchLabelsById.get(id)) {
        branchLabelsById.set(id, item.oddzial_nazwa || item.oddzial || item.lokalizacja || `Oddział #${id}`);
      }
    }
  }
  const getBranchLabel = (oddzialId) => {
    const id = String(oddzialId || '');
    if (!id) return 'Brak oddziału';
    return branchLabelsById.get(id) || `Oddział #${id}`;
  };
  const officePlanningRows = zlecenia
    .filter((task) => !isTaskClosed(task.status) && task.status === TASK_STATUS.DO_ZATWIERDZENIA)
    .map((task) => {
      const photos = getTaskPhotoSummary(task);
      const meta = getTaskBusinessMeta(task, todayIso, getClientContact(task.id));
      const equipment = getTaskEquipmentList(task);
      const equipmentNote = getTaskCrewEquipmentNote(task);
      const apiOfficeChecks = getTaskReadinessChecksFromApi(task, 'office_plan_checks');
      const apiOfficeMissing = apiOfficeChecks.filter((item) => !item.ok).map((item) => item.label);
      const missing = apiOfficeChecks.length ? apiOfficeMissing : [
        !task.data_planowana ? 'data' : null,
        !task.godzina_rozpoczecia ? 'godzina' : null,
        Number(task.czas_planowany_godziny) > 0 ? null : 'czas',
        !task.ekipa_id ? 'ekipa' : null,
      ].filter(Boolean);
      const warnings = apiOfficeChecks.length ? [] : [
        photos.total > 0 ? null : 'brak zdjęć',
        photos.fieldEvidence > 0 ? null : 'brak szkicu',
        getTaskCrewDescription(task) ? null : 'brak zakresu',
        getTaskCrewRisk(task) ? null : 'brak ryzyk',
        equipment.length || equipmentNote ? null : 'brak sprzetu',
      ].filter(Boolean);
      return {
        task,
        meta,
        photos,
        equipment,
        equipmentLabel: equipment.length ? `${equipment.length} sprz.` : (equipmentNote ? 'uwagi sprz.' : 'sprzet -'),
        missing,
        warnings,
        value: Number(task.wartosc_planowana) || 0,
        address: getTaskAddressLine(task),
        branchLabel: getBranchLabel(task.oddzial_id),
        slotLabel: formatTaskPlanLine(task),
        teamLabel: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Bez ekipy'),
      };
    })
    .sort((a, b) => {
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      const aDays = Number.isFinite(a.meta.daysLeft) ? a.meta.daysLeft : 9999;
      const bDays = Number.isFinite(b.meta.daysLeft) ? b.meta.daysLeft : 9999;
      if (aDays !== bDays) return aDays - bDays;
      return Number(b.task.id || 0) - Number(a.task.id || 0);
    });
  const officePlanningTopRows = officePlanningRows.slice(0, 6);
  const officePlanningReady = officePlanningRows.filter((row) => row.missing.length === 0).length;
  const officePlanningBlocked = Math.max(0, officePlanningRows.length - officePlanningReady);
  const officePlanningValue = officePlanningRows.reduce((sum, row) => sum + row.value, 0);
  const officeApprovalView = OPERATIONAL_VIEWS.find((view) => view.key === 'officeApproval') || OPERATIONAL_VIEWS[2];
  const openOfficePlanningTask = (task) => {
    otworzSzczegoly(task);
    window.setTimeout(() => scrollToDetailSection('officePlan'), 180);
  };
  const openResourceCalendarForTask = (task = null, options = {}) => {
    const params = new URLSearchParams();
    params.set('queue', 'planning');
    params.set('tab', options.tab || 'teams');
    params.set('modal', options.modal ?? (options.tab === 'equipment' ? '0' : '1'));

    if (task?.id) {
      const isCurrentTask = String(task.id) === String(wybraneZlecenie?.id || '');
      const plannedDate = String(
        (isCurrentTask ? officePlan.data_planowana : '') ||
        task.data_planowana ||
        task.data_zaplanowana ||
        ''
      ).slice(0, 10);
      const teamId = (isCurrentTask ? officePlan.ekipa_id : '') || task.ekipa_id || '';
      const branchId = task.oddzial_id || currentUser?.oddzial_id || '';
      const equipmentIds = isCurrentTask && (officePlan.sprzet_ids || []).length
        ? officePlan.sprzet_ids
        : getTaskReservedEquipmentIds(task);

      params.set('task', String(task.id));
      if (plannedDate) params.set('date', plannedDate);
      if (teamId) params.set('team', String(teamId));
      if (branchId) params.set('oddzial', String(branchId));
      if (equipmentIds.length) params.set('equipment', equipmentIds.map(String).join(','));
    }

    navigate(`/kalendarz-zasobow?${params.toString()}`);
  };

  const openCrewScheduleForTask = (task = null) => {
    const sourceTask = task || wybraneZlecenie || zlecenia.find((item) => String(item.id) === String(routeTaskId || ''));
    const params = new URLSearchParams();
    params.set('view', 'dzien');

    const fallbackTaskId = sourceTask?.id || wybraneZlecenie?.id || routeTaskId || '';
    if (fallbackTaskId) {
      const isCurrentTask = String(fallbackTaskId) === String(wybraneZlecenie?.id || routeTaskId || '');
      const plannedDate = String(
        (isCurrentTask ? officePlan.data_planowana : '') ||
        sourceTask?.data_planowana ||
        sourceTask?.data_zaplanowana ||
        wybraneZlecenie?.data_planowana ||
        wybraneZlecenie?.data_zaplanowana ||
        ''
      ).slice(0, 10);
      const teamId = (isCurrentTask ? officePlan.ekipa_id : '') || sourceTask?.ekipa_id || wybraneZlecenie?.ekipa_id || '';
      const branchId = sourceTask?.oddzial_id || wybraneZlecenie?.oddzial_id || currentUser?.oddzial_id || '';

      params.set('task', String(fallbackTaskId));
      if (plannedDate) params.set('date', plannedDate);
      if (teamId) params.set('team', String(teamId));
      if (branchId) params.set('oddzial', String(branchId));
    }

    navigate(`/harmonogram?${params.toString()}`);
  };
  const oddzialyOpcje = [
    ...new Set([
      ...zlecenia.map((z) => z.oddzial_id),
      ...oddzialy.map((oddzial) => oddzial.id),
      ...uzytkownicy.map((u) => u.oddzial_id),
      ...ekipyPlanowania.map((ekipa) => teamAvailableBranchId(ekipa)),
      ...sprzetPlanowania.map((item) => item.oddzial_id),
    ].filter(Boolean).map((value) => String(value))),
  ];
  const branchSelectOptions = [
    ...new Set([currentUser?.oddzial_id, form.oddzial_id, quickCall.oddzial_id, ...oddzialyOpcje]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map((value) => String(value)))
  ];
  const estimatorOptions = uzytkownicy
    .filter((u) => u.rola === 'Wyceniający' || u.rola === 'Wyceniajacy' || u.rola === 'Specjalista')
    .filter((u) => (
      !form.oddzial_id ||
      !u.oddzial_id ||
      String(u.oddzial_id) === String(form.oddzial_id) ||
      String(u.id) === String(form.wyceniajacy_id)
    ));
  const quickCallEstimatorOptions = getEstimatorOptionsForBranch(quickCall.oddzial_id, quickCall.wyceniajacy_id);
  const quickCallEstimator = uzytkownicy.find((u) => String(u.id) === String(quickCall.wyceniajacy_id));
  const quickCallEstimatorLabel = quickCallEstimator
    ? [quickCallEstimator.imie, quickCallEstimator.nazwisko].filter(Boolean).join(' ') || quickCallEstimator.login || `#${quickCallEstimator.id}`
    : '';
  const quickCallEstimatorReady = Boolean(quickCall.wyceniajacy_id && quickCallEstimatorLabel);
  const quickCallBranchLabel = quickCall.oddzial_id ? getBranchLabel(quickCall.oddzial_id) : '';
  const quickCallInspectionPackage = buildQuickCallInspectionPackage({
    quickCall,
    branchLabel: quickCallBranchLabel,
    estimatorLabel: quickCallEstimatorLabel,
    operatorName: getOperatorName(),
  });
  const quickCallPackagePreview = [
    { key: 'client', label: 'Klient', value: quickCall.klient_nazwa || 'Brak', ready: Boolean(quickCall.klient_nazwa), field: 'client' },
    { key: 'phone', label: 'Telefon', value: quickCall.klient_telefon || 'Brak', ready: Boolean(quickCall.klient_telefon), field: 'phone' },
    { key: 'address', label: 'Adres', value: quickCallInspectionPackage.address || 'Brak', ready: Boolean(quickCallInspectionPackage.address), field: quickCall.adres ? 'city' : 'address' },
    { key: 'slot', label: 'Oględziny', value: quickCallInspectionPackage.slot || 'Brak terminu', ready: Boolean(quickCall.data_planowana), field: 'date' },
    { key: 'branch', label: 'Oddział', value: quickCallBranchLabel || 'Brak', ready: Boolean(quickCall.oddzial_id), field: 'branch' },
    { key: 'estimator', label: 'Specjalista ds. wyceny', value: quickCallEstimatorLabel || 'Brak', ready: quickCallEstimatorReady, field: 'estimator' },
  ];
  const quickCallReadyCount = quickCallPackagePreview.filter((item) => item.ready).length;
  const quickCallCompletionPercent = Math.round((quickCallReadyCount / quickCallPackagePreview.length) * 100);
  const quickCallMissingSummary = quickCallMissingFields.length > 2
    ? `${quickCallMissingFields.slice(0, 2).join(', ')} +${quickCallMissingFields.length - 2}`
    : quickCallMissingFields.join(', ');
  const quickCallIntakeSteps = [
    {
      key: 'contact',
      label: 'Kontakt',
      detail: quickCall.klient_nazwa && quickCall.klient_telefon ? 'Klient i telefon są gotowe' : 'Uzupełnij klienta i telefon',
      ready: Boolean(quickCall.klient_nazwa && quickCall.klient_telefon),
      field: quickCall.klient_nazwa ? 'phone' : 'client',
    },
    {
      key: 'address',
      label: 'Adres',
      detail: quickCallInspectionPackage.address || 'Dodaj ulicę i miasto',
      ready: Boolean(quickCallInspectionPackage.address),
      field: quickCall.adres ? 'city' : 'address',
    },
    {
      key: 'inspection',
      label: 'Oględziny',
      detail: quickCallInspectionPackage.slot || 'Wybierz datę oględzin',
      ready: Boolean(quickCall.data_planowana),
      field: 'date',
    },
    {
      key: 'estimator',
      label: 'Wycena',
      detail: quickCallEstimatorLabel || 'Przypisz specjalistę ds. wyceny',
      ready: quickCallEstimatorReady,
      field: 'estimator',
    },
  ];
  const quickCallFieldTasks = [
    'Zdjęcia miejsca i drzew',
    'Szkic cięcia / zakresu',
    'Czas, budżet i ryzyka',
    'Decyzja klienta po wycenie',
  ];
  const quickCallBranchSelected = Boolean(String(quickCall.oddzial_id || '').trim());
  const quickCallNoEstimatorForBranch = quickCallBranchSelected && quickCallEstimatorOptions.length === 0;
  const quickCallNeedsEstimatorChoice = quickCallBranchSelected && quickCallEstimatorOptions.length > 1 && !quickCall.wyceniajacy_id;
  const quickCallAutoEstimatorId = !quickCall.wyceniajacy_id && quickCallEstimatorOptions.length === 1
    ? String(quickCallEstimatorOptions[0].id)
    : '';
  useEffect(() => {
    if (!quickCallAutoEstimatorId) return;
    setQuickCall((prev) => (
      prev.wyceniajacy_id ? prev : { ...prev, wyceniajacy_id: quickCallAutoEstimatorId }
    ));
  }, [quickCallAutoEstimatorId]);
  const teamOptions = ekipyPlanowania.filter((ekipa) => (
    !form.oddzial_id ||
    !teamAvailableBranchId(ekipa) ||
    String(teamAvailableBranchId(ekipa)) === String(form.oddzial_id) ||
    String(ekipa.id) === String(form.ekipa_id)
  ));
  const kanbanStats = KANBAN_COLUMNS.map((status) => {
    const items = widoczneZlecenia.filter((z) => z.status === status);
    const total = items.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { status, count: items.length, total };
  });
  const totalKanbanValue = kanbanStats.reduce((sum, s) => sum + s.total, 0);
 
  const getStatusColor = (st) => getTaskStatusColor(st);
  const formatCurrency = (v) => !v ? '—' : parseFloat(v).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN';
  const formatCurrencyZero = (v) => (Number(v) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN';
  const formatPercent = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
  const formStepIndex = Math.max(0, FORM_STEPS.findIndex((step) => step.key === formStep));
  const currentFormStep = FORM_STEPS[formStepIndex] || FORM_STEPS[0];
  const isFirstFormStep = formStepIndex === 0;
  const isLastFormStep = formStepIndex === FORM_STEPS.length - 1;
  const formPreviewTask = buildTaskFromForm();
  const formWorkflowStageIndex = Math.max(
    0,
    FORM_WORKFLOW_STEPS.findIndex((step) => step.status === (formPreviewTask.status || TASK_STATUS.NOWE))
  );
  const formWorkflowStage = FORM_WORKFLOW_STEPS[formWorkflowStageIndex] || FORM_WORKFLOW_STEPS[0];
  const formStatusOptions = tryb === 'nowy'
    ? [TASK_STATUS.NOWE, TASK_STATUS.WYCENA_TERENOWA]
    : getNextTaskStatuses(wybraneZlecenie?.status || form.status, {
      includeCurrent: true,
      allowCancel: mozePrzesuwacStatus,
    });
  const formPreviewContact = formPreviewTask?.id ? getClientContact(formPreviewTask.id) : {};
  const formPreviewMeta = getTaskBusinessMeta(formPreviewTask, todayIso, formPreviewContact);
  const formPreviewPrice = getTaskPriceGuidance(formPreviewTask, formPreviewMeta);
  const formPreviewSafety = getTaskSafetyChecklist(formPreviewTask, formPreviewMeta, formPreviewContact);
  const formPreviewSafetyRequired = formPreviewSafety.filter((item) => item.required && !item.ok);
  const selectedTaskPhotos = wybraneZlecenie?.id ? (taskPhotosById[String(wybraneZlecenie.id)] || []) : [];
  const selectedTaskProblems = wybraneZlecenie?.id ? (taskProblemsById[String(wybraneZlecenie.id)] || []) : [];
  const detailGpsHistoryPreview = detailGpsHistory.slice(-5).reverse();
  const detailGpsHistoryMapUrl = taskGpsHistoryRouteUrl(detailGpsHistory);
  const detailGpsHistoryLastPoint = detailGpsHistory[detailGpsHistory.length - 1] || null;
  const fieldPhotoCount = selectedTaskPhotos.filter(isFieldEvidencePhoto).length;
  const detailPlanTeamOptions = wybraneZlecenie
    ? ekipyPlanowania.filter((ekipa) => (
      !wybraneZlecenie.oddzial_id ||
      !teamAvailableBranchId(ekipa) ||
      String(teamAvailableBranchId(ekipa)) === String(wybraneZlecenie.oddzial_id) ||
      String(ekipa.id) === String(officePlan.ekipa_id)
    ))
    : [];
  const officePlanSuggestionDate = officePlan.data_planowana || taskDateOnly(wybraneZlecenie?.data_planowana) || todayIso;
  const officePlanSuggestion = wybraneZlecenie ? getOfficePlanSuggestion({
    tasks: zlecenia,
    teams: detailPlanTeamOptions,
    task: wybraneZlecenie,
    day: officePlanSuggestionDate,
    durationHours: officePlan.czas_planowany_godziny,
    preferredTeamId: officePlan.ekipa_id,
  }) : null;
  const officePlanTeam = detailPlanTeamOptions.find((ekipa) => String(ekipa.id) === String(officePlan.ekipa_id))
    || ekipyPlanowania.find((ekipa) => String(ekipa.id) === String(officePlan.ekipa_id))
    || ekipy.find((ekipa) => String(ekipa.id) === String(officePlan.ekipa_id));
  const officePlanTeamConflictSummary = wybraneZlecenie
    ? getOfficePlanTeamConflictSummary(zlecenia, wybraneZlecenie, officePlan)
    : { readyToCheck: false, ok: false, hardConflict: false, warning: false, outsideWorkday: false, conflicts: [], label: '', detail: '' };
  const officePlanTeamResourceSummary = wybraneZlecenie
    ? getTeamResourceRepairSummary(officePlan.ekipa_id || wybraneZlecenie.ekipa_id, sprzetPlanowania, branchVehicles)
    : { readyToCheck: false, ok: true, hardConflict: false, items: [], label: '', detail: '' };
  const detailEquipmentOptions = wybraneZlecenie
    ? [...sprzetPlanowania]
      .filter((item) => {
        const selected = (officePlan.sprzet_ids || []).some((id) => String(id) === String(item.id));
        const sameBranch = !wybraneZlecenie.oddzial_id || !item.oddzial_id || String(item.oddzial_id) === String(wybraneZlecenie.oddzial_id);
        const assignedToSelectedTeam = isEquipmentAssignedToTeam(item, officePlan.ekipa_id);
        const unavailable = resourceStatusBlocksPlanning(item.status);
        return selected || ((sameBranch || assignedToSelectedTeam) && !unavailable);
      })
      .sort((a, b) => {
        const aTeam = officePlan.ekipa_id && String(a.ekipa_id || '') === String(officePlan.ekipa_id) ? 0 : 1;
        const bTeam = officePlan.ekipa_id && String(b.ekipa_id || '') === String(officePlan.ekipa_id) ? 0 : 1;
        if (aTeam !== bTeam) return aTeam - bTeam;
        return String(a.typ || '').localeCompare(String(b.typ || ''), 'pl') || String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl');
      })
    : [];
  const selectedOfficeEquipment = detailEquipmentOptions.filter((item) =>
    (officePlan.sprzet_ids || []).some((id) => String(id) === String(item.id))
  );
  const officePlanEquipmentConflictSummary = wybraneZlecenie
    ? getOfficePlanEquipmentConflictSummary(
      officePlanEquipmentReservations,
      wybraneZlecenie,
      officePlan,
      {
        loading: officePlanEquipmentReservationsLoading,
        error: officePlanEquipmentReservationsErr,
      }
    )
    : { readyToCheck: false, ok: true, hardConflict: false, warning: false, pending: false, conflicts: [], label: '', detail: '' };
  const showOfficePlanPanel = Boolean(
    wybraneZlecenie &&
    mozePlanowacBiuro &&
    !isTaskClosed(wybraneZlecenie.status) &&
    [TASK_STATUS.DO_ZATWIERDZENIA, TASK_STATUS.ZAPLANOWANE].includes(wybraneZlecenie.status)
  );
  const officePlanCrewBrief = wybraneZlecenie ? getTaskCrewDescription(wybraneZlecenie) : '';
  const officePlanEquipmentNote = String(officePlan.sprzet_notatka || '').trim();
  const officePlanReadinessItems = wybraneZlecenie ? [
    {
      key: 'slot',
      label: 'Termin i start',
      detail: officePlan.data_planowana && officePlan.godzina_rozpoczecia
        ? `${officePlan.data_planowana} ${officePlan.godzina_rozpoczecia}`
        : 'wybierz datę i godzinę startu',
      ok: Boolean(officePlan.data_planowana && officePlan.godzina_rozpoczecia),
      required: true,
    },
    {
      key: 'hours',
      label: 'Czas pracy',
      detail: Number(officePlan.czas_planowany_godziny) > 0
        ? `${officePlan.czas_planowany_godziny} h`
        : 'podaj realny czas pracy brygady',
      ok: Number(officePlan.czas_planowany_godziny) > 0,
      required: true,
    },
    {
      key: 'team',
      label: 'Ekipa',
      detail: officePlanTeam?.nazwa || 'wybierz brygadę dla zlecenia',
      ok: Boolean(officePlan.ekipa_id),
      required: true,
    },
    officePlanTeamConflictSummary.readyToCheck ? {
      key: 'team-conflict',
      label: 'Radar grafiku',
      detail: officePlanTeamConflictSummary.detail,
      ok: officePlanTeamConflictSummary.ok && !officePlanTeamConflictSummary.warning,
      required: officePlanTeamConflictSummary.hardConflict,
    } : null,
    officePlanTeamResourceSummary.readyToCheck ? {
      key: 'team-resources',
      label: 'Zasoby ekipy',
      detail: officePlanTeamResourceSummary.detail,
      ok: officePlanTeamResourceSummary.ok,
      required: officePlanTeamResourceSummary.hardConflict,
    } : null,
    {
      key: 'photos',
      label: 'Zdjęcia / szkic',
      detail: fieldPhotoCount ? `${fieldPhotoCount} zdjęć z oględzin` : 'dodaj zdjęcia lub szkic przed wyjazdem ekipy',
      ok: fieldPhotoCount > 0,
      required: false,
    },
    {
      key: 'brief',
      label: 'Instrukcja dla ekipy',
      detail: officePlanCrewBrief || officePlanEquipmentNote
        ? 'jest opis zakresu albo uwagi logistyczne'
        : 'dopisz zakres pracy lub uwagi dla brygady',
      ok: Boolean(officePlanCrewBrief || officePlanEquipmentNote),
      required: false,
    },
    {
      key: 'equipment',
      label: 'Sprzęt',
      detail: selectedOfficeEquipment.length
        ? selectedOfficeEquipment.map((item) => getEquipmentPlanLabel(item, {
          teamId: officePlan.ekipa_id,
          taskBranchId: wybraneZlecenie?.oddzial_id,
          getBranchLabel,
        })).join(', ')
        : (officePlanEquipmentNote || 'brak konkretnych rezerwacji sprzętu'),
      ok: selectedOfficeEquipment.length > 0 || Boolean(officePlanEquipmentNote) || detailEquipmentList.length > 0,
      required: false,
    },
    officePlanEquipmentConflictSummary.readyToCheck ? {
      key: 'equipment-conflict',
      label: 'Radar sprzetu',
      detail: officePlanEquipmentConflictSummary.detail,
      ok: officePlanEquipmentConflictSummary.ok && !officePlanEquipmentConflictSummary.warning && !officePlanEquipmentConflictSummary.pending,
      required: officePlanEquipmentConflictSummary.hardConflict || officePlanEquipmentConflictSummary.pending,
    } : null,
  ].filter(Boolean) : [];
  const officePlanRequiredMissing = officePlanReadinessItems.filter((item) => item.required && !item.ok);
  const officePlanWarningMissing = officePlanReadinessItems.filter((item) => !item.required && !item.ok);
  const officePlanHasScheduleConflict = officePlanTeamConflictSummary.hardConflict;
  const officePlanHasTeamResourceConflict = officePlanTeamResourceSummary.hardConflict;
  const officePlanHasEquipmentConflict = officePlanEquipmentConflictSummary.hardConflict || officePlanEquipmentConflictSummary.pending;
  const officePlanStatusTone = officePlanHasScheduleConflict || officePlanHasTeamResourceConflict || officePlanHasEquipmentConflict || officePlanRequiredMissing.length ? 'danger' : officePlanWarningMissing.length ? 'warning' : 'good';
  const officePlanStatusLabel = wybraneZlecenie?.status === TASK_STATUS.ZAPLANOWANE && !officePlanRequiredMissing.length
    ? 'Zaplanowane'
    : officePlanHasScheduleConflict
      ? 'Konflikt terminu'
      : officePlanHasTeamResourceConflict
        ? 'Zasoby w naprawie'
      : officePlanHasEquipmentConflict
        ? officePlanEquipmentConflictSummary.pending ? 'Sprawdzam sprzet' : 'Konflikt sprzetu'
      : officePlanRequiredMissing.length
      ? `Brakuje: ${officePlanRequiredMissing.length}`
      : officePlanWarningMissing.length
        ? 'Do doprecyzowania'
        : 'Gotowe dla ekipy';
  const timeWindowDraft = buildTimeWindowProposalPayload();
  const timeWindowDraftReady = Boolean(!timeWindowDraft.error && wybraneZlecenie?.id);
  const timeWindowDraftLabel = timeWindowDraftReady
    ? `${timeWindowDraft.proposed_date} ${timeWindowDraft.okno_od}-${timeWindowDraft.okno_do}`
    : timeWindowDraft.error || 'Wybierz termin okna klienta.';
  const latestTimeWindowUrl = timeWindowProposal?.proposal?.url || '';
  const officePlanTeamLabel = officePlanTeam
    ? getTeamOptionLabel(officePlanTeam)
    : (wybraneZlecenie?.ekipa_nazwa || (wybraneZlecenie?.ekipa_id ? `Ekipa #${wybraneZlecenie.ekipa_id}` : ''));
  const officePlanHandoffPlanLabel = [
    officePlan.data_planowana || taskDateOnly(wybraneZlecenie?.data_planowana),
    officePlan.godzina_rozpoczecia,
    officePlan.czas_planowany_godziny ? `${officePlan.czas_planowany_godziny} h` : '',
  ].filter(Boolean).join(' | ');
  const officePlanHandoffEquipmentLabel = selectedOfficeEquipment.length
    ? selectedOfficeEquipment.map((item) => getEquipmentPlanLabel(item, {
      teamId: officePlan.ekipa_id,
      taskBranchId: wybraneZlecenie?.oddzial_id,
      getBranchLabel,
    })).join(', ')
    : (detailEquipmentList.join(', ') || officePlanEquipmentNote || '');
  const officePlanCanSubmit = !officePlanSaving && officePlanRequiredMissing.length === 0;
  const detailRepairItems = wybraneZlecenie ? buildDetailRepairItems({
    qualityChecklist: detailQualityChecklist,
    safetyChecklist: detailSafetyChecklist,
    officePlanReadinessItems,
    showOfficePlanPanel,
  }) : [];
  const officeDecisionCards = wybraneZlecenie && detailBusinessMeta ? [
    {
      key: 'field-package',
      label: 'Pakiet z oględzin',
      value: fieldPhotoCount ? `${fieldPhotoCount} dowodów` : 'Brak zdjęć',
      detail: detailRequiredIssues.find((item) => item.key === 'fieldEvidence')?.detail
        || detailPriceGuidance?.detail
        || 'Zdjęcia, szkic, zakres, czas i cena z terenu.',
      tone: fieldPhotoCount && !detailRequiredIssues.some((item) => item.key === 'fieldEvidence') ? 'good' : 'warning',
      action: 'photos',
      actionLabel: 'Zdjęcia / szkic',
    },
    {
      key: 'office-plan',
      label: 'Plan ekipy',
      value: officePlanStatusLabel,
      detail: officePlanRequiredMissing[0]?.detail || officePlanWarningMissing[0]?.detail || 'Termin, ekipa i sprzęt są gotowe do przekazania.',
      tone: officePlanStatusTone,
      action: 'officePlan',
      actionLabel: 'Plan biura',
    },
    {
      key: 'money',
      label: 'Cena i warunki',
      value: detailPriceGuidance?.label || formatMoneyBrief(wybraneZlecenie.wartosc_planowana),
      detail: `Wartość ${formatCurrencyZero(detailBusinessMeta.value)} · jakość ${detailBusinessMeta.diagnostics.score}/100`,
      tone: detailPriceGuidance?.tone || 'good',
      action: 'finance',
      actionLabel: 'Finanse',
    },
    {
      key: 'crew-brief',
      label: 'Odprawa brygady',
      value: detailSafetyRequiredIssues.length ? `BHP ${detailSafetyRequiredIssues.length}` : 'Gotowa',
      detail: detailSafetyRequiredIssues[0]?.detail || detailEquipmentList.slice(0, 3).join(', ') || 'Brief, ryzyka i sprzęt są czytelne dla ekipy.',
      tone: detailSafetyRequiredIssues.length ? 'danger' : detailSafetyChecklist.length ? 'good' : 'warning',
      action: 'crewBrief',
      actionLabel: 'Brief',
    },
    {
      key: 'client',
      label: 'Klient',
      value: detailContactOption.label,
      detail: wybraneZlecenie.klient_telefon
        ? `${wybraneZlecenie.klient_telefon}${detailContact.dueAt ? ` · ${detailFollowupMeta.label}` : ''}`
        : 'Brak telefonu klienta.',
      tone: detailContactOption.tone === 'danger' || !wybraneZlecenie.klient_telefon ? 'danger' : detailContactOption.tone === 'warning' ? 'warning' : 'good',
      action: 'contact',
      actionLabel: 'Kontakt',
    },
  ] : [];
  const detailWorkflowRows = wybraneZlecenie && detailBusinessMeta
    ? getDetailWorkflowCommandRows({
      task: wybraneZlecenie,
      meta: detailBusinessMeta,
      qualityChecklist: detailQualityChecklist,
      safetyChecklist: detailSafetyChecklist,
      photos: selectedTaskPhotos,
      contact: detailContact,
      showOfficePlanPanel,
    })
    : [];
  const detailHeroTone = detailSafetyRequiredIssues.length
    ? 'danger'
    : detailRequiredIssues.length
      ? 'warning'
      : detailBusinessMeta?.severity || 'good';
  const detailReadinessScore = detailBusinessMeta
    ? Math.max(0, detailBusinessMeta.diagnostics.score - detailSafetyRequiredIssues.length * 22)
    : null;
  const detailHeroStats = wybraneZlecenie ? [
    {
      label: 'Status',
      value: wybraneZlecenie.status || 'Nowe',
      detail: wybraneZlecenie.priorytet ? `Priorytet: ${wybraneZlecenie.priorytet}` : 'Priorytet nie ustawiony',
      tone: detailHeroTone,
    },
    {
      label: 'Wartość',
      value: formatMoneyBrief(wybraneZlecenie.wartosc_planowana),
      detail: detailPriceGuidance?.label || 'Brak rekomendacji ceny',
      tone: detailPriceGuidance?.tone || 'good',
    },
    {
      label: 'Gotowość',
      value: detailReadinessScore !== null ? `${detailReadinessScore}/100` : 'Brak',
      detail: detailRequiredIssues[0]?.label || detailSafetyRequiredIssues[0]?.label || 'Można odprawić bez blokad',
      tone: detailHeroTone,
    },
    {
      label: 'Dokumentacja',
      value: selectedTaskPhotos.length,
      detail: `${fieldPhotoCount} zdjęć z wyceny/szkicu`,
      tone: selectedTaskPhotos.length ? 'blue' : 'warning',
    },
  ] : [];
  const formRepairStep = formRepairFocus?.field ? FORM_REPAIR_FIELD_STEPS[formRepairFocus.field] : '';
  const formRepairStepLabel = FORM_STEPS.find((step) => step.key === formRepairStep)?.label || currentFormStep.label;
  const formRepairReturnLabel = formRepairFocus?.returnLabel || 'AI Dyspozytor';
  const isRepairField = (field) => Boolean(formRepairFocus?.field && formRepairFocus.field === field);
  const fgStyle = (field, extra = {}) => ({
    ...s.fg,
    ...extra,
    ...(isRepairField(field) ? s.formRepairField : {}),
  });
  const inputStyle = (field, extra = {}) => ({
    ...s.input,
    ...(isRepairField(field) ? s.inputRepairFocus : {}),
    ...extra,
  });
  const setFormStepSafe = (key) => {
    const next = FORM_STEP_KEYS.has(key) ? key : 'client';
    setFormStep(next);
    if (formRepairFocus?.field && FORM_REPAIR_FIELD_STEPS[formRepairFocus.field] !== next) {
      setFormRepairFocus(null);
    }
  };
  const goPrevFormStep = () => setFormStep(FORM_STEPS[Math.max(0, formStepIndex - 1)].key);
  const goNextFormStep = () => setFormStep(FORM_STEPS[Math.min(FORM_STEPS.length - 1, formStepIndex + 1)].key);
  const formReadinessCards = [
    {
      key: 'client',
      label: 'Klient',
      value: form.klient_nazwa ? 'Gotowy' : 'Brak',
      detail: form.klient_telefon || 'telefon do uzupelnienia',
      tone: form.klient_nazwa ? 'good' : 'warning',
    },
    {
      key: 'stage',
      label: 'Etap',
      value: formWorkflowStage.label,
      detail: formWorkflowStage.detail,
      tone: 'good',
    },
    {
      key: 'plan',
      label: 'Plan',
      value: form.data_planowana || 'Bez terminu',
      detail: form.ekipa_id ? 'ekipa wskazana' : 'ekipa do przypisania',
      tone: form.data_planowana && form.ekipa_id ? 'good' : 'warning',
    },
    {
      key: 'quality',
      label: 'Gotowosc',
      value: formPreviewSafetyRequired.length ? `${formPreviewSafetyRequired.length} brakow` : 'OK',
      detail: formPreviewPrice.detail || formPreviewPrice.label,
      tone: formPreviewSafetyRequired.length ? 'danger' : 'good',
    },
  ];
 
  return (
    <div className="app-shell zlecenia-shell">
      <Sidebar />
      <main className="app-main zlecenia-main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="zlecenia-surface" style={s.main}>
 
        <StatusMessage
          message={komunikat.tekst || ''}
          tone={komunikat.typ === 'error' ? 'error' : komunikat.typ === 'success' ? 'success' : undefined}
          style={s.komunikat}
        />

        {copyFallback && (
          <div style={s.copyFallback}>
            <div style={s.copyFallbackHeader}>
              <div>
                <div style={s.copyFallbackEyebrow}>Tekst do skopiowania</div>
                <div style={s.copyFallbackTitle}>{copyFallback.title}</div>
              </div>
              <button type="button" style={s.bulkBtnSecondary} onClick={() => setCopyFallback(null)}>Zamknij</button>
            </div>
            <textarea
              readOnly
              value={copyFallback.text}
              style={s.copyFallbackText}
              onFocus={(event) => event.target.select()}
            />
          </div>
        )}

        {potwierdzUsuniecie && (
          <div style={s.overlay}>
            <div style={s.modal}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>
                <DeleteOutline style={{ fontSize: 48 }} aria-hidden />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text)', margin: '0 0 8px' }}>{t('pages.zlecenia.deleteTitle')}</h3>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 24px' }}>
                {t('pages.zlecenia.deleteBody', { id: potwierdzUsuniecie.id, client: potwierdzUsuniecie.klient_nazwa })}
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button style={s.btnDanger} onClick={() => usunZlecenie(potwierdzUsuniecie.id)}>{t('pages.zlecenia.deleteYes')}</button>
                <button style={s.btnGray} onClick={() => setPotwierdzUsuniecie(null)}>{t('common.cancel')}</button>
              </div>
            </div>
          </div>
        )}

        {closeGuard && (
          <div style={s.overlay}>
            <div style={s.closeGuardModal}>
              <div style={s.closeGuardHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>Kontrola przed zamknięciem</div>
                  <h3 style={s.closeGuardTitle}>Zlecenie #{closeGuard.task?.id}</h3>
                </div>
                <span style={{ ...s.businessHealth, ...s[`businessHealth_${closeGuard.blockers.length ? 'danger' : 'warning'}`] }}>
                  {closeGuard.blockers.length ? 'Blokada' : 'Uwaga'}
                </span>
              </div>
              <p style={s.closeGuardLead}>
                {closeGuard.blockers.length
                  ? 'Nie zamykam zlecenia, bo są krytyczne braki. Popraw je przed finalnym statusem.'
                  : 'Zlecenie można zamknąć, ale ma uwagi jakościowe. Zamknięcie będzie świadomą decyzją operatora.'}
              </p>
              <div style={s.closeGuardMetrics}>
                <div style={s.detailDecisionMetric}><span>Wartość</span><strong>{formatCurrencyZero(closeGuard.meta.value)}</strong></div>
                <div style={s.detailDecisionMetric}><span>Jakość</span><strong>{closeGuard.meta.diagnostics.score}/100</strong></div>
                <div style={s.detailDecisionMetric}><span>Ryzyko</span><strong>{closeGuard.meta.riskScore}</strong></div>
              </div>
              {closeGuard.blockers.length > 0 ? (
                <div style={s.closeGuardSection}>
                  <div style={s.closeGuardSectionTitle}>Blokady krytyczne</div>
                  {closeGuard.blockers.map((item) => (
                    <div key={item.key} style={{ ...s.closeGuardItem, ...s.closeGuardItemDanger }}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {closeGuard.warnings.length > 0 ? (
                <div style={s.closeGuardSection}>
                  <div style={s.closeGuardSectionTitle}>Uwagi jakościowe</div>
                  {closeGuard.warnings.map((item) => (
                    <div key={item.key} style={s.closeGuardItem}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={s.closeGuardActions}>
                {closeGuard.canForceClose ? (
                  <button type="button" style={s.btnPrimary} onClick={continueCloseGuard}>
                    Zamknij mimo uwag
                  </button>
                ) : null}
                <button type="button" style={s.btnSecondary} onClick={fixCloseGuard}>
                  {closeGuard.mode === 'form' ? 'Wróć do formularza' : 'Popraw dane'}
                </button>
                <button type="button" style={s.btnGray} onClick={() => setCloseGuard(null)}>
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ LISTA ══ */}
        {tryb === 'lista' && (
          <>
            <PageHeader
              variant="hero"
              title={t('pages.zlecenia.title')}
              subtitle={t('pages.zlecenia.subtitle')}
              icon={<AssignmentOutlined style={{ fontSize: 26 }} />}
              actions={
                <>
                  <button type="button" style={s.btnSecondary} onClick={() => { setFiltrStatus(''); setTryb('kanban'); }}>{t('pages.zlecenia.kanbanTitle')}</button>
                  {mozeTworzyc && <button type="button" style={s.btnPrimary} onClick={otworzNowe}>+ {t('common.newOrder')}</button>}
                </>
              }
            />
            <div
              data-testid="zlecenia-decision-band"
              style={{
                ...s.decisionBand,
                ...(s[`decisionBand_${decisionCommand.tone}`] || {}),
              }}
            >
              <div style={s.decisionLead}>
                <span style={s.decisionEyebrow}>
                  {activeSmartLabel ? `Aktywny filtr: ${activeSmartLabel}` : 'Priorytet widoku'}
                </span>
                <strong style={s.decisionTitle}>{decisionCommand.label}</strong>
                <span style={s.decisionText}>{decisionCommand.detail}</span>
              </div>
              <div style={s.decisionKpiGrid}>
                {decisionKpis.map((item) => (
                  <div key={item.key} style={s.decisionKpi}>
                    <span style={s.decisionKpiLabel}>{item.label}</span>
                    <strong style={s.decisionKpiValue}>{item.value}</strong>
                    <small style={s.decisionKpiHint}>{item.detail}</small>
                  </div>
                ))}
              </div>
              <div style={s.decisionActions}>
                <button
                  type="button"
                  data-testid="decision-primary-action"
                  style={s.decisionPrimaryBtn}
                  onClick={() => {
                    if (decisionCommand.filterKey) setSmartFilter(decisionCommand.filterKey);
                    if (decisionCommand.sortKey) setSortMode(decisionCommand.sortKey);
                    if (decisionCommand.openFinance) {
                      setShowAdvancedOps(true);
                      setCommandTab('finance');
                      setSortMode('risk');
                    }
                    setSelectedTaskIds([]);
                  }}
                >
                  {decisionCommand.cta}
                </button>
                <div style={s.decisionQuickActions}>
                  {decisionQuickActions.map((item) => {
                    const active = item.filterKey && smartFilter === item.filterKey;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-testid={`decision-quick-${item.key}`}
                        style={{
                          ...s.decisionQuickBtn,
                          ...(active ? s.decisionQuickBtnActive : {}),
                        }}
                        onClick={() => {
                          if (item.openFinance) {
                            setShowAdvancedOps(true);
                            setCommandTab('finance');
                            setSortMode('risk');
                          }
                          if (item.filterKey) setSmartFilter(active ? '' : item.filterKey);
                          setSelectedTaskIds([]);
                        }}
                      >
                        <span style={s.decisionQuickBtnSpan}>{item.label}</span>
                        <strong style={s.decisionQuickBtnStrong}>{item.value}</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="zlecenia-daily-grid" style={s.dailyOpsGrid}>
              {zleceniaDailyCards.map((card) => (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => {
                    if (card.filterKey) {
                      setSmartFilter(smartFilter === card.filterKey ? '' : card.filterKey);
                      setSelectedTaskIds([]);
                    }
                  }}
                  style={{
                    ...s.dailyOpsCard,
                    ...(s[`dailyOpsCard_${card.tone}`] || {}),
                    ...(card.filterKey && smartFilter === card.filterKey ? s.dailyOpsCardActive : {}),
                    cursor: card.filterKey ? 'pointer' : 'default',
                  }}
                >
                  <span style={s.dailyOpsAccent} />
                  <span style={s.dailyOpsLabel}>{card.label}</span>
                  <strong style={s.dailyOpsValue}>{card.value}</strong>
                  <small style={s.dailyOpsDetail}>{card.detail}</small>
                </button>
              ))}
            </div>
            <div style={s.commandPanel}>
              <div style={s.commandHeader}>
                <div>
                  <div style={s.commandEyebrow}>Centrum pracy</div>
                  <div style={s.commandTitle}>Jedna droga zlecenia: od telefonu do wykonania pracy.</div>
                </div>
                <div style={s.commandActions}>
                  <button type="button" style={s.btnSecondary} onClick={() => setTryb('kanban')}>Kanban</button>
                  {showAdvancedOps ? (
                    <>
                      <button type="button" style={s.btnSecondary} onClick={exportFilteredCsv}>CSV</button>
                      <button type="button" style={s.btnSecondary} onClick={() => copyDispatchManifest(widoczneZlecenia, 'bieżącego widoku')}>
                        Odprawa widoku
                      </button>
                      {viewRouteHref ? (
                        <a href={viewRouteHref} target="_blank" rel="noreferrer" style={s.btnSecondary}>
                          Trasa top 8
                        </a>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              <div style={s.commandStats}>
                <div style={s.commandStat}>
                  <span>Łącznie</span>
                  <strong style={s.commandStatStrong}>{zlecenia.length}</strong>
                </div>
                <div style={s.commandStat}>
                  <span>Widoczne</span>
                  <strong style={s.commandStatStrong}>{filtrowane.length}</strong>
                </div>
                <div style={s.commandStat}>
                  <span>Wartość widoku</span>
                  <strong style={s.commandStatStrong}>{formatCurrency(filtrowane.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0))}</strong>
                </div>
              </div>
              {mozeTworzyc ? (
                <div
                  ref={quickCallRef}
                  style={{
                    ...s.quickCallPanel,
                    ...(quickCallFocused ? s.quickCallPanelFocused : {}),
                  }}
                >
                  <div style={s.quickCallHeader}>
                    <div>
                      <div style={s.dispatchEyebrow}>Telefon do biura</div>
                      <div style={s.quickCallTitle}>30 sekund: klient, adres, termin i specjalista ds. wyceny</div>
                    </div>
                    <span style={s.quickCallStatus}>Tworzy: Wycena_Terenowa</span>
                  </div>
                  <div style={s.quickCallProgressPanel}>
                    <div style={s.quickCallProgressHead}>
                      <div>
                        <span style={s.quickCallProgressLabel}>Kompletność rozmowy</span>
                        <strong style={s.quickCallProgressValue}>
                          {quickCallCompletionPercent}% · {quickCallReadyCount}/{quickCallPackagePreview.length}
                        </strong>
                      </div>
                      <span style={quickCallReady ? s.quickCallProgressReady : s.quickCallProgressMissing}>
                        {quickCallReady ? 'Można utworzyć oględziny' : `Brakuje: ${quickCallMissingSummary || 'danych'}`}
                      </span>
                    </div>
                    <div style={s.quickCallProgressTrack}>
                      <span style={{ ...s.quickCallProgressFill, width: `${quickCallCompletionPercent}%` }} />
                    </div>
                    <div style={s.quickCallStepGrid}>
                      {quickCallIntakeSteps.map((step) => (
                        <button
                          key={step.key}
                          type="button"
                          data-testid={`quick-call-step-${step.key}`}
                          style={{
                            ...s.quickCallStep,
                            ...(step.ready ? s.quickCallStepReady : s.quickCallStepMissing),
                          }}
                          onClick={() => focusQuickCallField(step.field)}
                        >
                          <span style={s.quickCallStepDot}>{step.ready ? '✓' : '!'}</span>
                          <span style={s.quickCallStepBody}>
                            <strong>{step.label}</strong>
                            <small>{step.detail}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={s.quickCallGrid}>
                    <div style={s.fg}>
                      <label style={s.label}>Klient *</label>
                      <input
                        ref={quickCallClientInputRef}
                        data-testid="quick-call-client"
                        data-quick-call-field="client"
                        style={s.input}
                        placeholder="Imię / firma"
                        value={quickCall.klient_nazwa}
                        onChange={(event) => setQuickCallField('klient_nazwa', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Telefon *</label>
                      <input
                        data-quick-call-field="phone"
                        style={s.input}
                        placeholder="+48 000 000 000"
                        value={quickCall.klient_telefon}
                        onChange={(event) => setQuickCallField('klient_telefon', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Adres *</label>
                      <input
                        data-quick-call-field="address"
                        style={s.input}
                        placeholder="ulica, numer"
                        value={quickCall.adres}
                        onChange={(event) => setQuickCallField('adres', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Miasto *</label>
                      <CityInput
                        data-quick-call-field="city"
                        style={s.input}
                        placeholder="Kraków"
                        value={quickCall.miasto}
                        onChange={(event) => setQuickCallField('miasto', event.target.value)}
                        extraCities={zlecenia.map((z) => z.miasto)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Typ prac</label>
                      <select
                        style={s.input}
                        value={quickCall.typ_uslugi || TASK_SERVICE_TYPES[0]}
                        onChange={(event) => setQuickCallField('typ_uslugi', event.target.value)}
                      >
                        {TASK_SERVICE_TYPES.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Data oględzin *</label>
                      <input
                        data-quick-call-field="date"
                        style={s.input}
                        type="date"
                        value={quickCall.data_planowana}
                        onChange={(event) => setQuickCallField('data_planowana', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Godzina</label>
                      <input
                        style={s.input}
                        type="time"
                        value={quickCall.godzina_rozpoczecia}
                        onChange={(event) => setQuickCallField('godzina_rozpoczecia', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Oddział *</label>
                      <select
                        data-quick-call-field="branch"
                        style={s.input}
                        value={quickCall.oddzial_id}
                        disabled={!canManageAllBranches && !!currentUser?.oddzial_id}
                        onChange={(event) => setQuickCallField('oddzial_id', event.target.value)}
                      >
                        <option value="">— wybierz —</option>
                        {branchSelectOptions.map((oddzialId) => (
                          <option key={oddzialId} value={oddzialId}>{getBranchLabel(oddzialId)}</option>
                        ))}
                      </select>
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Specjalista ds. wyceny *</label>
                      <select
                        data-quick-call-field="estimator"
                        style={{
                          ...s.input,
                          ...(quickCallNoEstimatorForBranch ? s.inputDanger : {}),
                        }}
                        value={quickCall.wyceniajacy_id}
                        onChange={(event) => setQuickCallField('wyceniajacy_id', event.target.value)}
                      >
                        <option value="">— wybierz —</option>
                        {quickCallEstimatorOptions.map((u) => (
                          <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>
                        ))}
                      </select>
                      {quickCallNoEstimatorForBranch ? (
                        <div style={s.quickCallFieldHintDanger}>
                          Brak specjalisty ds. wyceny w oddziale {getBranchLabel(quickCall.oddzial_id)}.
                        </div>
                      ) : quickCallNeedsEstimatorChoice ? (
                        <div style={s.quickCallFieldHint}>
                          W oddziale jest kilku specjalistów ds. wyceny. Wybierz osobę do oględzin.
                        </div>
                      ) : null}
                    </div>
                    <div style={{ ...s.fg, gridColumn: '1 / -1' }}>
                      <label style={s.label}>Notatka z rozmowy</label>
                      <textarea
                        style={{ ...s.input, minHeight: 58, resize: 'vertical' }}
                        placeholder="np. klient prosi o oględziny po 15:00, brama od strony ogrodu, do wyceny 2 drzewa"
                        value={quickCall.opis_pracy}
                        onChange={(event) => setQuickCallField('opis_pracy', event.target.value)}
                      />
                    </div>
                  </div>
                  <div style={s.quickCallPackagePanel}>
                    <div style={s.quickCallPackageHeader}>
                      <div>
                        <div style={s.dispatchEyebrow}>Pakiet dla specjalisty ds. wyceny</div>
                        <div style={s.quickCallPackageTitle}>To trafi do mobilki jako oględziny terenowe</div>
                      </div>
                      <span style={quickCallReady ? s.quickCallPackageStatusReady : s.quickCallPackageStatusMissing}>
                        {quickCallReady ? 'Komplet podstawowy' : `${quickCallMissingFields.length} braków`}
                      </span>
                    </div>
                    <div style={s.quickCallPackageGrid}>
                      {quickCallPackagePreview.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          data-testid={`quick-call-package-${item.key}`}
                          style={{
                            ...s.quickCallPackageItem,
                            ...(item.ready ? s.quickCallPackageItemReady : s.quickCallPackageItemMissing),
                          }}
                          onClick={() => focusQuickCallField(item.field)}
                        >
                          <span style={s.quickCallPackageTop}>
                            <span style={{
                              ...s.quickCallPackageDot,
                              ...(item.ready ? s.quickCallPackageDotReady : s.quickCallPackageDotMissing),
                            }}>
                              {item.ready ? '✓' : '!'}
                            </span>
                            <span style={s.quickCallPackageLabel}>{item.label}</span>
                          </span>
                          <strong style={s.quickCallPackageValue}>{item.value}</strong>
                          <small style={s.quickCallPackageHint}>
                            {item.ready ? 'Gotowe w pakiecie' : 'Kliknij, żeby uzupełnić'}
                          </small>
                        </button>
                      ))}
                    </div>
                    <div
                      style={{
                        ...s.quickCallSchedulePanel,
                        ...(s[`quickCallSchedulePanel_${quickCallSchedule.tone}`] || {}),
                      }}
                    >
                      <div style={s.quickCallScheduleMain}>
                        <span style={s.quickCallPackageLabel}>Kalendarz wyceniającego</span>
                        <strong style={s.quickCallScheduleTitle}>{quickCallSchedule.label}</strong>
                        <small style={s.quickCallScheduleDetail}>{quickCallSchedule.detail}</small>
                      </div>
                      <div style={s.quickCallScheduleSide}>
                        {quickCallSchedule.items.slice(0, 4).map((item) => (
                          <span key={item.id} style={s.quickCallScheduleItem}>
                            {item.time || '--:--'} · #{item.id} {item.city || item.client}
                          </span>
                        ))}
                        {quickCallSchedule.suggestedTime ? (
                          <button
                            type="button"
                            style={s.quickCallScheduleFixBtn}
                            onClick={() => setQuickCallField('godzina_rozpoczecia', quickCallSchedule.suggestedTime)}
                          >
                            Wstaw {quickCallSchedule.suggestedTime}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div style={s.quickCallTaskStrip}>
                      {quickCallFieldTasks.map((item) => (
                        <span key={item} style={s.quickCallTaskChip}>{item}</span>
                      ))}
                    </div>
                  </div>
                  <div style={s.quickCallFooter}>
                    <span style={s.quickCallFooterText}>
                      <span style={quickCallReady ? s.quickCallReady : s.quickCallMissing}>
                        {quickCallReady
                          ? 'Gotowe do wysłania specjaliście ds. wyceny.'
                          : quickCallSchedule.blockingReason || `Brakuje: ${quickCallMissingFields.join(', ')}`}
                      </span>
                      <span style={s.quickCallFooterHint}>
                        {quickCallHasDraft ? 'Szkic zapisany lokalnie. ' : ''}
                        Po zapisie specjalista ds. wyceny zobaczy to w mobilce jako oględziny terenowe.
                      </span>
                    </span>
                    <div style={s.quickCallActions}>
                      <button type="button" style={s.btnSecondary} onClick={otworzPelnyFormularzZTelefonu}>Pełny formularz</button>
                      <button type="button" style={s.btnSecondary} onClick={resetQuickCallDraft}>Wyczyść</button>
                      <button
                        type="button"
                        style={{ ...s.btnPrimary, ...((quickCallSaving || !quickCallReady) ? s.formWizardBtnDisabled : {}) }}
                        disabled={quickCallSaving || !quickCallReady}
                        onClick={utworzOgledzinyZTelefonu}
                      >
                        {quickCallSaving ? 'Tworzę...' : 'Utwórz oględziny'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div style={s.workflowLanePanel}>
                <div style={s.workflowLaneHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Jedna ścieżka zlecenia</div>
                    <div style={s.workflowLaneTitle}>Telefon -> oględziny -> biuro -> ekipa -> zamknięcie</div>
                  </div>
                  <span style={s.workflowLaneHint}>Kliknij etap, żeby zobaczyć tylko te sprawy.</span>
                </div>
                <div style={s.workflowHealthStrip}>
                  {workflowPathStats.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        ...s.workflowHealthItem,
                        ...(item.key === 'blocked' && item.value > 0 ? s.workflowHealthItemWarn : {}),
                      }}
                    >
                      <span style={s.workflowHealthLabel}>{item.label}</span>
                      <strong style={s.workflowHealthValue}>{item.value}</strong>
                      <small style={s.workflowHealthDetail}>{item.detail}</small>
                    </div>
                  ))}
                </div>
                <div style={s.savedViews}>
                  {operationalViews.map((view) => (
                    <button
                      key={view.key}
                      type="button"
                      onClick={() => applyOperationalView(view)}
                      style={{
                        ...s.savedViewBtn,
                        ...(activeOperationalViewKey === view.key ? s.savedViewBtnActive : {}),
                      }}
                    >
                      <span style={s.savedViewLabel}>{view.label}</span>
                      <span style={s.savedViewMeta}>{view.detail}</span>
                      <span style={s.savedViewCount}>{view.count}</span>
                      <span style={s.savedViewFoot}>
                        <span style={view.blocked ? s.savedViewWarn : s.savedViewOk}>
                          {view.blocked ? `Braki ${view.blocked}` : 'Bez blokad'}
                        </span>
                        <span>Gotowe {view.ready}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {mozePlanowacBiuro && officePlanningTopRows.length ? (
                  <OfficePlanningQueue
                    styles={s}
                    rows={officePlanningTopRows}
                    total={officePlanningRows.length}
                    ready={officePlanningReady}
                    blocked={officePlanningBlocked}
                    value={officePlanningValue}
                    onPlan={openOfficePlanningTask}
                    onOpenCalendar={openCrewScheduleForTask}
                    onApplyView={() => applyOperationalView(officeApprovalView)}
                    onCopy={() => copyDispatchManifest(officePlanningRows.map((row) => row.task), 'pakietów do planowania')}
                  />
                ) : null}
              </div>
              <div style={s.advancedOpsHeader}>
                <div>
                  <strong style={s.advancedOpsTitle}>Kontrola operacyjna</strong>
                  <span style={s.advancedOpsText}>Ryzyka, audyt, finanse i wszystkie filtry są dostępne tutaj, ale nie mieszają się z codzienną ścieżką.</span>
                </div>
                <button type="button" style={s.btnSecondary} onClick={() => setShowAdvancedOps((value) => !value)}>
                  {showAdvancedOps ? 'Ukryj kontrolę' : 'Pokaż kontrolę'}
                </button>
              </div>
              {!showAdvancedOps && smartFilter ? (
                <div style={s.activeFilterBanner}>
                  <span>Aktywny filtr: <strong>{activeSmartLabel || smartFilter}</strong></span>
                  <button type="button" style={s.clearBtn} onClick={() => setSmartFilter('')}>Wyczyść</button>
                </div>
              ) : null}
              {showAdvancedOps ? (
                <>
              <div className="zlecenia-ops-grid" style={s.opsGrid}>
                {zleceniaOpsCards.map((card) => (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => {
                      if (card.filterKey) setSmartFilter(smartFilter === card.filterKey ? '' : card.filterKey);
                    }}
                    style={{
                      ...s.opsCard,
                      ...(s[`opsCard_${card.tone}`] || {}),
                      cursor: card.filterKey ? 'pointer' : 'default',
                    }}
                  >
                    <span style={s.opsCardLabel}>{card.label}</span>
                    <strong style={s.opsCardValue}>{card.value}</strong>
                    <small style={s.opsCardDetail}>{card.detail}</small>
                  </button>
                ))}
              </div>
              <div style={s.dispatchReadinessStrip}>
                <div>
                  <div style={s.dispatchReadinessEyebrow}>Kontrola przed wysłaniem ekipy</div>
                  <strong style={s.dispatchReadinessTitle}>Najpierw zdjęcia, termin, ekipa i kontakt</strong>
                </div>
                <div style={s.dispatchReadinessItems}>
                  {dispatchReadiness.map((item) => {
                    const active = smartFilter === item.filterKey;
                    const blocked = item.count > 0;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-testid={`dispatch-readiness-${item.key}`}
                        onClick={() => setSmartFilter(active ? '' : item.filterKey)}
                        style={{
                          ...s.dispatchReadinessItem,
                          ...(active ? s.dispatchReadinessItemActive : {}),
                          ...(blocked ? s.dispatchReadinessItemBlocked : {}),
                        }}
                      >
                        <span style={s.dispatchReadinessLabel}>{item.label}</span>
                        <strong style={s.dispatchReadinessCount}>{item.count}</strong>
                        <small style={s.dispatchReadinessHint}>{blocked ? item.danger : item.ok}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={s.commandTabs}>
                {COMMAND_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCommandTab(tab.key)}
                    style={{
                      ...s.commandTab,
                      ...(commandTab === tab.key ? s.commandTabActive : {}),
                    }}
                  >
                    <span style={s.commandTabLabel}>{tab.label}</span>
                    <span style={s.commandTabDetail}>{tab.detail}</span>
                  </button>
                ))}
              </div>
              {commandTab === 'dispatch' && (
              <div style={s.dispatchPanel}>
                <div style={s.dispatchHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Kolejka dyspozytora</div>
                    <div style={s.dispatchTitle}>Sortowanie: {activeSort.label}</div>
                  </div>
                  <div style={s.sortTabs}>
                    {TASK_SORT_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSortMode(option.key)}
                        style={{
                          ...s.sortTab,
                          ...(sortMode === option.key ? s.sortTabActive : {}),
                        }}
                      >
                        <span style={s.sortTabLabel}>{option.label}</span>
                        <span style={s.sortTabDetail}>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={s.queueList}>
                  {queueItems.length === 0 ? (
                    <div style={s.queueEmpty}>Brak zleceń w bieżącym widoku.</div>
                  ) : queueItems.map(({ task, meta }) => (
                    <button
                      key={task.id}
                      type="button"
                      style={s.queueItem}
                      onClick={() => otworzSzczegoly(task)}
                    >
                      <span style={s.queueRank}>{Math.round(meta.score)}</span>
                      <span style={s.queueBody}>
                        <span style={s.queueTitle}>#{task.id} {task.klient_nazwa || 'Bez klienta'}</span>
                        <span style={s.queueMeta}>
                          {meta.reasons.length ? meta.reasons.join(' · ') : 'bez blokerów'} · {formatQueueTiming(meta.daysLeft)}
                        </span>
                      </span>
                      <span style={s.queueValue}>{formatCurrency(meta.value)}</span>
                    </button>
                  ))}
                </div>
                <div style={s.manifestBar}>
                  <span>
                    Odprawa obejmie <strong>{widoczneZlecenia.length}</strong> zleceń w aktualnej kolejności.
                  </span>
                  <button type="button" style={s.manifestBtn} onClick={() => copyDispatchManifest(widoczneZlecenia, 'bieżącego widoku')}>
                    Kopiuj odprawę
                  </button>
                </div>
              </div>
              )}
              {commandTab === 'finance' && (
              <div style={s.businessGuardPanel}>
                <div style={s.businessGuardHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Ochrona marży i jakości</div>
                    <div style={s.dispatchTitle}>Ryzyko finansowe aktualnego widoku</div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${businessGuard.health}`] }}>
                    {businessGuard.healthLabel}
                  </span>
                </div>
                <div style={s.businessKpiGrid}>
                  <button type="button" style={s.businessKpi} onClick={() => setSortMode('risk')}>
                    <span style={s.businessKpiLabel}>Wartość pod ryzykiem</span>
                    <strong style={s.businessKpiValue}>{formatCurrencyZero(businessGuard.riskValue)}</strong>
                    <span style={s.businessKpiHint}>{formatPercent(businessGuard.riskRatio)} wartości widoku</span>
                  </button>
                  <button type="button" style={s.businessKpi} onClick={() => setSmartFilter('readyClose')}>
                    <span style={s.businessKpiLabel}>Do domknięcia</span>
                    <strong style={s.businessKpiValue}>{formatCurrencyZero(businessGuard.readyValue)}</strong>
                    <span style={s.businessKpiHint}>{businessGuard.readyCount} gotowych zleceń</span>
                  </button>
                  <div style={s.businessKpiStatic}>
                    <span style={s.businessKpiLabel}>Jakość operacyjna</span>
                    <strong style={s.businessKpiValue}>{businessGuard.avgReadiness}/100</strong>
                    <span style={s.businessKpiHint}>{businessGuard.criticalCount} krytycznych pozycji</span>
                  </div>
                  <div style={s.businessKpiStatic}>
                    <span style={s.businessKpiLabel}>{businessGuard.hasBuffer ? 'Bufor ceny' : 'Stawka planu'}</span>
                    <strong style={s.businessKpiValue}>
                      {businessGuard.hasBuffer
                        ? formatCurrencyZero(businessGuard.totalBuffer)
                        : businessGuard.revenuePerHour
                          ? `${Math.round(businessGuard.revenuePerHour).toLocaleString('pl-PL')} PLN/h`
                          : '—'}
                    </strong>
                    <span style={s.businessKpiHint}>
                      {businessGuard.hasBuffer ? 'vs minimum lub budżet' : 'wg wartości i godzin'}
                    </span>
                  </div>
                </div>
                <div style={s.businessSignalRow}>
                  {businessGuard.signals.map((signal) => (
                    <button
                      key={signal.key}
                      type="button"
                      disabled={!signal.count}
                      onClick={() => {
                        setSmartFilter(signal.filter);
                        setSelectedTaskIds([]);
                      }}
                      style={{
                        ...s.businessSignal,
                        ...(signal.count ? s.businessSignalActive : s.businessSignalDisabled),
                      }}
                    >
                      <span>{signal.label}</span>
                      <strong>{signal.count}</strong>
                      <small>{formatCurrencyZero(signal.value)}</small>
                    </button>
                  ))}
                </div>
                <div style={s.businessRiskList}>
                  {businessGuard.topRisks.length === 0 ? (
                    <div style={s.businessRiskEmpty}>Brak ryzyk finansowych w aktualnym widoku.</div>
                  ) : businessGuard.topRisks.map(({ task, meta }) => (
                    <button
                      key={task.id}
                      type="button"
                      style={s.businessRiskItem}
                      onClick={() => otworzSzczegoly(task)}
                    >
                      <span style={s.businessRiskMain}>
                        <span style={s.businessRiskTitle}>#{task.id} {task.klient_nazwa || 'Bez klienta'}</span>
                        <span style={s.businessRiskFlags}>{meta.flags.slice(0, 3).join(' · ') || 'ryzyko operacyjne'}</span>
                      </span>
                      <span style={s.businessRiskScore}>{meta.riskScore}</span>
                      <strong style={s.businessRiskValue}>{formatCurrencyZero(meta.riskValue)}</strong>
                    </button>
                  ))}
                </div>
              </div>
              )}
              {commandTab === 'audit' && (
              <div style={s.closureAuditPanel}>
                <div style={s.closureAuditHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Audyt zamykania</div>
                    <div style={s.dispatchTitle}>Kto zamyka, co blokuje i gdzie ucieka jakość</div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${closureAudit.health}`] }}>
                    {closureAudit.healthLabel}
                  </span>
                </div>
                <div style={s.closureAuditKpis}>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Zatrzymane próby</span>
                    <strong style={s.businessKpiValue}>{closureAudit.blocked}</strong>
                    <span style={s.businessKpiHint}>{formatCurrencyZero(closureAudit.blockedValue)} ochronione w audycie</span>
                  </div>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Zamknięcia mimo uwag</span>
                    <strong style={s.businessKpiValue}>{closureAudit.forced}</strong>
                    <span style={s.businessKpiHint}>do kontroli kierownika</span>
                  </div>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Powroty do poprawy</span>
                    <strong style={s.businessKpiValue}>{closureAudit.fixes}</strong>
                    <span style={s.businessKpiHint}>operator poprawił dane</span>
                  </div>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Czyste zamknięcia</span>
                    <strong style={s.businessKpiValue}>{closureAudit.clean}</strong>
                    <span style={s.businessKpiHint}>{closureAudit.total} decyzji łącznie</span>
                  </div>
                </div>
                <div style={s.closureAuditColumns}>
                  <div style={s.closureAuditBox}>
                    <div style={s.closureAuditBoxTitle}>Najczęstsze blokady</div>
                    {closureAudit.topIssues.length === 0 ? (
                      <div style={s.closureAuditEmpty}>Brak zarejestrowanych blokad.</div>
                    ) : closureAudit.topIssues.map((issue) => (
                      <button
                        key={issue.key}
                        type="button"
                        data-testid={`closure-audit-issue-${issue.key}`}
                        style={{
                          ...s.closureAuditIssue,
                          ...(effectiveClosureIssueKey === issue.key ? s.closureAuditIssueActive : {}),
                        }}
                        onClick={() => setActiveClosureIssueKey(effectiveClosureIssueKey === issue.key ? '' : issue.key)}
                      >
                        <span style={s.closureAuditIssueBody}>
                          <strong>{issue.label}</strong>
                          <small>{issue.blockers} krytyczne · {issue.warnings} ostrzeżenia · {issue.taskIds.length} zleceń</small>
                        </span>
                        <span style={s.closureAuditCount}>{issue.count}</span>
                        <span style={s.closureAuditValue}>{formatCurrencyZero(issue.value)}</span>
                      </button>
                    ))}
                  </div>
                  <div style={s.closureAuditBox}>
                    <div style={s.closureAuditBoxTitle}>Operatorzy i decyzje</div>
                    {closureAudit.topActors.length === 0 ? (
                      <div style={s.closureAuditEmpty}>Rejestr decyzji jest pusty.</div>
                    ) : closureAudit.topActors.map((actor) => (
                      <div key={actor.actor} style={s.closureAuditActor}>
                        <span style={s.closureAuditIssueBody}>
                          <strong>{actor.actor}</strong>
                          <small>{actor.blocked} zatrzymane · {actor.forced} wymuszone · {actor.fixes} poprawy</small>
                        </span>
                        <span style={s.closureAuditCount}>{actor.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={s.closureRepairPanel} data-testid="closure-repair-panel">
                  <div style={s.closureRepairHeader}>
                    <div>
                      <div style={s.closureAuditBoxTitle}>Tryb naprawczy</div>
                      <div style={s.closureRepairTitle}>
                        {activeClosureIssue ? activeClosureIssue.label : 'Wszystkie aktywne blokady'}
                      </div>
                    </div>
                    {activeClosureIssue ? (
                      <button type="button" style={s.closureRepairClear} onClick={() => setActiveClosureIssueKey('')}>
                        Wszystkie
                      </button>
                    ) : null}
                  </div>
                  {closureRepairQueue.length === 0 ? (
                    <div style={s.closureAuditEmpty}>Brak zleceń do poprawy w tej kategorii.</div>
                  ) : (
                    <div style={s.closureRepairList}>
                      {closureRepairQueue.map(({ event, task, value, items }) => (
                        <div key={`${event.id}-repair`} style={s.closureRepairItem} data-testid={`closure-repair-item-${task.id}`}>
                          <span style={s.closureRepairScore}>{event.risk_score}</span>
                          <span style={s.closureRepairBody}>
                            <strong>#{task.id} {task.klient_nazwa || 'Bez klienta'}</strong>
                            <small>{items.map((item) => item.label).join(' · ')} · {closureActionLabel(event.action)}</small>
                          </span>
                          <span style={s.closureRepairValue}>{formatCurrencyZero(value)}</span>
                          <span style={s.closureRepairActions}>
                            <button type="button" data-testid={`closure-repair-details-${task.id}`} style={s.closureRepairBtn} onClick={() => openClosureRepairTask(task)}>
                              Szczegóły
                            </button>
                            <button type="button" data-testid={`closure-repair-edit-${task.id}`} style={s.closureRepairBtnPrimary} onClick={() => openClosureRepairTask(task, 'edit')}>
                              {mozeEdytowac ? 'Napraw' : 'Podgląd'}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={s.closureAuditRecent}>
                  <div style={s.closureAuditBoxTitle}>Ostatnie decyzje</div>
                  {closureAudit.recent.length === 0 ? (
                    <div style={s.closureAuditEmpty}>Zamknij lub zatrzymaj pierwsze zlecenie, a pojawi się tu ślad audytowy.</div>
                  ) : closureAudit.recent.map(({ event, task, value }, index) => (
                    <button
                      key={`${event.id}-${index}`}
                      type="button"
                      style={s.closureAuditEvent}
                      onClick={() => task && otworzSzczegoly(task)}
                      disabled={!task}
                    >
                      <span style={{ ...s.contactDot, ...(event.severity === 'danger' ? s.contactDot_danger : event.severity === 'warning' ? s.contactDot_warning : s.contactDot_good) }} />
                      <span style={s.closureAuditEventBody}>
                        <strong>#{event.task_id} {task?.klient_nazwa || 'Zlecenie bez klienta'}</strong>
                        <small>{closureActionLabel(event.action)} · {event.actor || 'Operator'} · {formatContactStamp(event.created_at)}</small>
                      </span>
                      <span style={s.closureAuditEventMeta}>
                        ryzyko {event.risk_score} · {formatCurrencyZero(value)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              )}
                </>
              ) : null}
            </div>

            {showAdvancedOps ? (
            <div style={s.smartFilterRow}>
              <span style={s.smartFilterTitle}>Inteligentne widoki</span>
              {smartFilterCounts.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSmartFilter(smartFilter === item.key ? '' : item.key)}
                  style={{
                    ...s.smartFilterChip,
                    ...(smartFilter === item.key ? s.smartFilterChipActive : {}),
                  }}
                >
                  {item.label}
                  <span style={s.smartFilterCount}>{item.count}</span>
                </button>
              ))}
              {smartFilter ? (
                <button type="button" style={s.clearBtn} onClick={() => setSmartFilter('')}>
                  Wyczyść: {activeSmartLabel}
                </button>
              ) : null}
            </div>
            ) : null}

            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder={t('pages.zlecenia.searchPlaceholder')}
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
                <option value="">{t('pages.zlecenia.allStatuses')}</option>
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(`taskStatus.${status}`, { defaultValue: status })}</option>
                ))}
              </select>
              <select style={s.filtrInput} value={filtrTyp} onChange={e => setFiltrTyp(e.target.value)}>
                <option value="">{t('pages.zlecenia.allTypes')}</option>
                {TASK_SERVICE_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                ))}
              </select>
              {ekipyPlanowania.length > 0 && (
                <select style={s.filtrInput} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                  <option value="">Wszystkie ekipy</option>
                  {ekipyPlanowania.map((ekipa) => (
                    <option key={getTeamOptionKey(ekipa)} value={ekipa.id}>{getTeamOptionLabel(ekipa)}</option>
                  ))}
                </select>
              )}
              {oddzialyOpcje.length > 0 && (
                <select style={s.filtrInput} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">Wszystkie oddziały</option>
                  {oddzialyOpcje.map((oddzial) => (
                    <option key={oddzial} value={oddzial}>{getBranchLabel(oddzial)}</option>
                  ))}
                </select>
              )}
              {(filtrStatus || filtrTyp || filtrEkipa || filtrOddzial || szukaj || smartFilter) && (
                <button style={s.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrTyp(''); setFiltrEkipa(''); setFiltrOddzial(''); setSzukaj(''); setSmartFilter(''); }}>{t('pages.zlecenia.clear')}</button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {zlecenia.length}</span>
            </div>

            {selectedTaskIds.length > 0 && (
              <div style={s.bulkBar}>
                <div style={s.bulkInfo}>{t('pages.zlecenia.bulkSelected', { count: selectedTaskIds.length })}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Wycena_Terenowa')}>Na oględziny</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Do_Zatwierdzenia')}>Do zatwierdzenia</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Zaplanowane')}>{t('pages.zlecenia.bulkToPlanned')}</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('W_Realizacji')}>{t('pages.zlecenia.bulkToProgress')}</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Zakonczone')}>{t('pages.zlecenia.bulkFinish')}</button>
                  <button style={s.bulkBtn} onClick={() => copyDispatchManifest(selectedVisibleTasks, 'zaznaczonych zleceń')}>Odprawa zazn.</button>
                  {selectedRouteHref ? (
                    <a href={selectedRouteHref} target="_blank" rel="noreferrer" style={s.bulkBtn}>Trasa zazn.</a>
                  ) : null}
                  <button style={s.bulkBtnSecondary} onClick={() => setSelectedTaskIds([])}>{t('pages.zlecenia.bulkClearSelection')}</button>
                </div>
              </div>
            )}
 
            {loading ? <div style={s.loading}>{t('pages.zlecenia.loading')}</div> : (
              <div style={s.listCardsWrap}>
                <div style={s.listCardsHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={areAllVisibleSelected} onChange={toggleSelectAllVisible} />
                    <span style={s.listCardsHeaderText}>Zaznacz wszystkie</span>
                  </div>
                  <span style={s.listCardsHeaderText}>Kliknij kartę, aby otworzyć szczegóły</span>
                </div>
                {widoczneZlecenia.length === 0 ? (
                  <div style={s.listEmptyPanel} data-testid="zlecenia-empty-state">
                    <div style={s.listEmptyMain}>
                      <span style={s.listEmptyEyebrow}>
                        {zlecenia.length === 0 ? 'Start operacyjny' : 'Widok bez wyników'}
                      </span>
                      <strong style={s.listEmptyTitle}>
                        {zlecenia.length === 0 ? 'Zacznij od telefonu do biura' : 'Ten filtr nie ma zleceń'}
                      </strong>
                      <p style={s.listEmptyText}>
                        {zlecenia.length === 0
                          ? 'Najkrótsza ścieżka to szybki formularz: klient, telefon, adres, termin i specjalista ds. wyceny.'
                          : 'Zlecenia są w systemie, ale obecne filtry nie zwracają żadnej pozycji. Wyczyść je albo wróć do kolejki ryzyka.'}
                      </p>
                      <div style={s.listEmptyActions}>
                        {mozeTworzyc ? (
                          <button type="button" data-testid="empty-state-phone" style={s.listEmptyPrimaryBtn} onClick={focusQuickCallPanel}>
                            Przyjmij telefon
                          </button>
                        ) : null}
                        {mozeTworzyc ? (
                          <button type="button" data-testid="empty-state-full-form" style={s.listEmptySecondaryBtn} onClick={otworzNowe}>
                            Pełny formularz
                          </button>
                        ) : null}
                        {hasActiveListFilters && zlecenia.length > 0 ? (
                          <button
                            type="button"
                            data-testid="empty-state-clear-filters"
                            style={s.listEmptySecondaryBtn}
                            onClick={() => {
                              setFiltrStatus('');
                              setFiltrTyp('');
                              setFiltrEkipa('');
                              setFiltrOddzial('');
                              setSzukaj('');
                              setSmartFilter('');
                              setSortMode('risk');
                            }}
                          >
                            Wyczyść filtry
                          </button>
                        ) : (
                          <button type="button" data-testid="empty-state-kanban" style={s.listEmptySecondaryBtn} onClick={() => setTryb('kanban')}>
                            Zobacz Kanban
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={s.listEmptyFlow}>
                      {emptyListSteps.map((item) => (
                        <div key={item.key} style={s.listEmptyStep}>
                          <span style={s.listEmptyStepLabel}>{item.label}</span>
                          <small style={s.listEmptyStepDetail}>{item.detail}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="zlecenia-list-grid" style={s.listCardsGrid}>
                    {widoczneZlecenia.map((z) => {
                      const diagnostics = getTaskDiagnostics(z, todayIso);
                      const photoSummary = diagnostics.photos;
                      const fieldExecution = getTaskFieldExecutionSummary(z, photoSummary);
                      const workflowStage = getTaskInspectionWorkflow(z, diagnostics);
                      const stageOwner = getTaskStageOwnerSummary(z, diagnostics, workflowStage);
                      const phoneHref = telHref(z.klient_telefon);
                      const mapsHref = getMapsHref(z);
                      const contact = getClientContact(z.id);
                      const contactOption = getClientContactOption(contact.status);
                      const followupMeta = getContactFollowupMeta(contact);
                      const officePackageReadiness = getTaskPackageReadiness(z, 'office');
                      const crewPackageReadiness = getTaskPackageReadiness(z, 'crew');
                      const packageReadinessRows = [officePackageReadiness, crewPackageReadiness].filter((item) => item.relevant);
                      return (
                      <div key={z.id} className="zlecenia-data-card" style={s.listTaskCard} onClick={() => otworzSzczegoly(z)}>
                        <div style={s.listTaskTop}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedTaskIds.includes(z.id)}
                              onChange={() => toggleTaskSelection(z.id)}
                            />
                            <span style={s.idBadge}>#{z.id}</span>
                          </div>
                          <div style={s.akcjeRow} onClick={(e) => e.stopPropagation()}>
                            <button type="button" style={s.btnSm} onClick={() => otworzSzczegoly(z)} title={t('common.details')} aria-label={t('common.details')}>
                              <VisibilityOutlined style={{ fontSize: 18, display: 'block' }} />
                            </button>
                            {mozeEdytowac && (
                              <button type="button" style={s.btnSm} onClick={() => otworzEdycje(z)} title={t('common.edit')} aria-label={t('common.edit')}>
                                <EditOutlined style={{ fontSize: 18, display: 'block' }} />
                              </button>
                            )}
                            {mozeUsuwac && (
                              <button type="button" style={{ ...s.btnSm, backgroundColor: 'rgba(248,113,113,0.1)', color: '#C62828' }} onClick={() => setPotwierdzUsuniecie(z)} title={t('common.delete')} aria-label={t('common.delete')}>
                                <DeleteOutline style={{ fontSize: 18, display: 'block' }} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={s.listTaskClient}>{z.klient_nazwa}</div>
                        <div style={s.listTaskMeta}>{z.adres ? `${z.adres}${z.miasto ? ', ' + z.miasto : ''}` : z.miasto || '—'}</div>
                        <div style={s.listTaskMeta}>{t(`serviceType.${z.typ_uslugi}`, { defaultValue: z.typ_uslugi })}</div>
                        <div style={s.contactMini}>
                          <span style={{ ...s.contactDot, ...s[`contactDot_${contactOption.tone}`] }} />
                          <span>{contactOption.label}</span>
                          {contact.updatedAt ? <strong>{formatContactStamp(contact.updatedAt)}</strong> : null}
                        </div>
                        {contact.dueAt ? (
                          <div style={{ ...s.contactMini, ...s.contactMiniFollowup, ...(followupMeta.overdue ? s.contactMiniDanger : {}) }}>
                            <span style={{ ...s.contactDot, ...s[`contactDot_${followupMeta.tone}`] }} />
                            <span>{followupMeta.label}</span>
                          </div>
                        ) : null}
                        <div style={{ ...s.workflowStageRow, ...(s[`workflowStage_${workflowStage.tone}`] || {}) }}>
                          <span style={s.workflowStageStep}>{workflowStage.step}</span>
                          <div style={s.workflowStageBody}>
                            <strong>{workflowStage.label}</strong>
                            <small>{workflowStage.detail}</small>
                          </div>
                        </div>
                        <div style={{ ...s.stageOwnerMini, ...(s[`stageOwnerMini_${stageOwner.tone}`] || {}) }}>
                          <div style={s.stageOwnerTop}>
                            <span style={s.stageOwnerLabel}>Kto ma piłkę</span>
                            <strong style={s.stageOwnerName}>{stageOwner.owner}</strong>
                          </div>
                          <div style={s.stageOwnerTitle}>{stageOwner.title}</div>
                          <small style={s.stageOwnerDetail}>{stageOwner.detail}</small>
                          <div style={s.stageOwnerFooter} onClick={(event) => event.stopPropagation()}>
                            <span style={s.stageOwnerNext}>Dalej: {stageOwner.nextOwner}</span>
                            <button
                              type="button"
                              style={s.stageOwnerAction}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleTaskNextAction(z, { ...diagnostics, nextAction: stageOwner.action });
                              }}
                            >
                              {stageOwner.action.label}
                            </button>
                          </div>
                        </div>
                        <div style={s.fieldOpsRow} onClick={(event) => event.stopPropagation()}>
                          {phoneHref ? (
                            <a href={phoneHref} style={s.fieldOpsBtn} title="Zadzwoń do klienta">
                              <PhoneOutlined style={s.fieldOpsIcon} aria-hidden />
                              Zadzwoń
                            </a>
                          ) : (
                            <span style={{ ...s.fieldOpsBtn, ...s.fieldOpsBtnDisabled }}>
                              <PhoneOutlined style={s.fieldOpsIcon} aria-hidden />
                              Brak tel.
                            </span>
                          )}
                          {canUseTaskSms && (
                            <button type="button" style={s.fieldOpsBtn} onClick={() => copyClientMessage(z, diagnostics)} title="Skopiuj SMS do klienta">
                              <SmsOutlined style={s.fieldOpsIcon} aria-hidden />
                              SMS
                            </button>
                          )}
                          {mapsHref ? (
                            <a href={mapsHref} target="_blank" rel="noreferrer" style={s.fieldOpsBtn} title="Otwórz trasę w mapie">
                              <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                              Trasa
                            </a>
                          ) : (
                            <span style={{ ...s.fieldOpsBtn, ...s.fieldOpsBtnDisabled }}>
                              <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                              Brak adresu
                            </span>
                          )}
                          <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskAddress(z)} title="Skopiuj adres">
                            <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                            Adres
                          </button>
                          <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskBrief(z, diagnostics)} title="Skopiuj brief dla ekipy">
                            <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                            Brief
                          </button>
                        </div>
                        <div
                          style={{
                            ...s.documentationRow,
                            ...(photoSummary.total === 0 ? s.documentationRowWarning : {}),
                          }}
                        >
                          <span style={s.documentationLabel}>Dokumentacja</span>
                          <span style={s.documentationMetric}>
                            <strong>{photoSummary.total}</strong> zdjęć
                          </span>
                          <span style={s.documentationMetric}>
                            <strong>{photoSummary.valuation}</strong> wycena
                          </span>
                          <span style={s.documentationMetric}>
                            <strong>{photoSummary.sketch}</strong> szkic
                          </span>
                        </div>
                        <div
                          style={{
                            ...s.fieldExecutionRow,
                            ...(s[`fieldExecutionRow_${fieldExecution.tone}`] || {}),
                          }}
                        >
                          <div style={s.fieldExecutionMain}>
                            <span style={s.fieldExecutionLabel}>Teren</span>
                            <strong>{fieldExecution.label}</strong>
                            <small>{fieldExecution.detail}</small>
                          </div>
                          <div style={s.fieldExecutionDocs}>
                            {fieldExecution.photoChecks.map((item) => (
                              <span
                                key={item.key}
                                style={{
                                  ...s.fieldExecutionChip,
                                  ...(item.count > 0 ? s.fieldExecutionChipReady : s.fieldExecutionChipMissing),
                                }}
                              >
                                {item.label}: {item.count}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={s.listTaskChips}>
                          <TelemetryStatus value={z.status} label={t(`taskStatus.${z.status}`, { defaultValue: z.status })} />
                          <TelemetryStatus state={z.priorytet === 'Pilny' ? 'warning' : 'info'} label={z.priorytet} />
                        </div>
                        <div style={s.readinessBlock}>
                          <div style={s.readinessTop}>
                            <span>Gotowość</span>
                            <strong>{diagnostics.score}%</strong>
                          </div>
                          <div style={s.readinessTrack}>
                            <span
                              style={{
                                ...s.readinessFill,
                                width: `${diagnostics.score}%`,
                                backgroundColor: diagnostics.level === 'danger' ? '#EF5350' : diagnostics.level === 'warning' ? '#F9A825' : '#34D399',
                              }}
                            />
                          </div>
                        </div>
                        {packageReadinessRows.length ? (
                          <div style={s.packageReadinessGrid}>
                            {packageReadinessRows.map((item) => (
                              <button
                                key={item.type}
                                type="button"
                                data-testid={`task-${z.id}-package-${item.type}`}
                                style={{
                                  ...s.packageReadinessTile,
                                  ...(s[`packageReadinessTile_${item.tone}`] || {}),
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSmartFilter(item.type === 'office' ? 'officePlanBlocked' : 'crewPackageBlocked');
                                }}
                                title={item.missing.length ? item.missing.join(', ') : `${item.label}: OK`}
                              >
                                <span style={s.packageReadinessLabel}>{item.label}</span>
                                <strong style={s.packageReadinessValue}>
                                  {item.total ? `${item.readyCount}/${item.total}` : `${item.score}%`}
                                </strong>
                                <small style={s.packageReadinessHint}>
                                  {item.ready ? 'OK' : item.status}
                                </small>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <div style={s.blockerWrap}>
                          {diagnostics.items.length === 0 ? (
                            <span style={{ ...s.blockerBadge, ...s.blockerGood }}>Gotowe operacyjnie</span>
                          ) : diagnostics.items.slice(0, 4).map((item) => (
                            <span
                              key={item.key}
                              style={{
                                ...s.blockerBadge,
                                ...(item.tone === 'danger' ? s.blockerDanger : s.blockerWarning),
                              }}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                        <div style={s.slaWrap}>
                          {getSlaFlags(z).length === 0 ? (
                            <span style={s.slaOk}>{t('pages.zlecenia.slaOk')}</span>
                          ) : getSlaFlags(z).map((flag) => (
                            <span key={flag} style={s.slaBadge}>{slaFlagLabel(flag)}</span>
                          ))}
                        </div>
                        <div style={s.listTaskFooter}>
                          <span style={s.listTaskDate}>{z.data_planowana ? z.data_planowana.split('T')[0] : '—'}</span>
                          {canSeeFinance && <span style={s.listTaskValue}>{formatCurrency(z.wartosc_planowana)}</span>}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══ KANBAN ══ */}
        {tryb === 'kanban' && (
          <>
            <PageHeader
              variant="plain"
              back={{ onClick: () => setTryb('lista'), label: t('common.back') }}
              title={t('pages.zlecenia.kanbanTitle')}
              subtitle={t('pages.zlecenia.kanbanSubtitle')}
              icon={<ViewKanbanOutlined style={{ fontSize: 26 }} />}
              actions={
                <>
                  <button type="button" style={s.btnSecondary} onClick={exportFilteredCsv}>{t('common.exportCsv')}</button>
                  <button type="button" style={s.btnSecondary} onClick={() => setShowWorkflowPanel((v) => !v)}>
                    {t('pages.zlecenia.workflow')}
                  </button>
                  <button type="button" style={s.btnSecondary} onClick={() => setTryb('lista')}>{t('pages.zlecenia.listView')}</button>
                  {mozeTworzyc && <button type="button" style={s.btnPrimary} onClick={otworzNowe}>+ {t('common.newOrder')}</button>}
                </>
              }
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 10 }}>
              <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '10px 12px', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Kanban control</div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-sub)' }}>Przeciągaj zlecenia między kolumnami i zarządzaj automatyzacjami workflow.</div>
              </div>
            </div>

            {showWorkflowPanel && (
              <div style={s.workflowPanel}>
                <div style={s.workflowTitle}>Automatyzacje po zmianie statusu</div>
                <div style={s.workflowPresets}>
                  <button
                    type="button"
                    style={s.workflowPresetBtn}
                    onClick={() => setWorkflowConfig(WORKFLOW_PRESETS.minimal)}>
                    Minimalny
                  </button>
                  <button
                    type="button"
                    style={s.workflowPresetBtn}
                    onClick={() => setWorkflowConfig(WORKFLOW_PRESETS.standard)}>
                    Standard
                  </button>
                  <button
                    type="button"
                    style={s.workflowPresetBtn}
                    onClick={() => setWorkflowConfig(WORKFLOW_PRESETS.full)}>
                    Full
                  </button>
                </div>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.logEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, logEnabled: e.target.checked }))}
                  />
                  Zapis logu statusu
                </label>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.notificationsEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, notificationsEnabled: e.target.checked }))}
                  />
                  Powiadomienie wewnętrzne
                </label>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.remindersEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, remindersEnabled: e.target.checked }))}
                  />
                  Przypomnienie dla statusu „Zaplanowane”
                </label>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.smsEnabled}
                    disabled={!canUseTaskSms}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, smsEnabled: e.target.checked }))}
                  />
                  SMS do klienta (jeśli endpoint dostępny)
                </label>
              </div>
            )}

            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder={t('pages.zlecenia.searchPlaceholder')}
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrTyp} onChange={e => setFiltrTyp(e.target.value)}>
                <option value="">{t('pages.zlecenia.allTypes')}</option>
                {TASK_SERVICE_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                ))}
              </select>
              <select style={s.filtrInput} value={filtrOddzial} onChange={e => { setFiltrOddzial(e.target.value); setFiltrEkipa(''); }}>
                <option value="">{t('common.allBranches')}</option>
                {oddzialyOpcje.map((id) => <option key={id} value={String(id)}>{getBranchLabel(id)}</option>)}
              </select>
              <select style={s.filtrInput} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                <option value="">{t('common.allTeams')}</option>
                {ekipyPlanowania
                  .filter((e) => !filtrOddzial || String(teamAvailableBranchId(e) || '') === filtrOddzial)
                  .map((e) => (
                    <option key={getTeamOptionKey(e)} value={String(e.id)}>{getTeamOptionLabel(e)}</option>
                  ))}
              </select>
              {(filtrTyp || szukaj || filtrOddzial || filtrEkipa || smartFilter) && (
                <button style={s.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrTyp(''); setFiltrOddzial(''); setFiltrEkipa(''); setSzukaj(''); setSmartFilter(''); }}>{t('pages.zlecenia.clear')}</button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {zlecenia.length}</span>
            </div>

            {loading ? <div style={s.loading}>{t('pages.zlecenia.loading')}</div> : (
              <>
                <div style={s.kpiWrap}>
                  {kanbanStats.map((sItem) => (
                    <div key={sItem.status} style={{ ...s.kpiItem, borderTopColor: getStatusColor(sItem.status) }}>
                      <div style={s.kpiTitle}>{t(`taskStatus.${sItem.status}`, { defaultValue: sItem.status })}</div>
                      <div style={s.kpiCount}>{sItem.count}</div>
                      <div style={s.kpiValue}>{formatCurrency(sItem.total)}</div>
                    </div>
                  ))}
                  <div style={{ ...s.kpiItem, borderTopColor: 'var(--accent)' }}>
                    <div style={s.kpiTitle}>{t('pages.zlecenia.sum')}</div>
                    <div style={s.kpiCount}>{widoczneZlecenia.length}</div>
                    <div style={s.kpiValue}>{formatCurrency(totalKanbanValue)}</div>
                  </div>
                </div>
                <div style={s.kanbanWrap}>
                {KANBAN_COLUMNS.map((status) => {
                  const items = widoczneZlecenia.filter((z) => z.status === status);
                  return (
                    <div
                      key={status}
                      style={s.kanbanCol}
                      onDragOver={(e) => {
                        if (mozePrzesuwacStatus) e.preventDefault();
                      }}
                      onDrop={async () => {
                        if (!mozePrzesuwacStatus || !draggedTaskId) return;
                        await zmienStatusInline(draggedTaskId, status);
                        setDraggedTaskId(null);
                      }}>
                      <div style={s.kanbanColHeader}>
                        <TelemetryStatus value={status} label={t(`taskStatus.${status}`, { defaultValue: status })} />
                        <span style={s.kanbanCount}>{items.length}</span>
                      </div>
                      <div style={s.kanbanColBody}>
                        {items.length === 0 ? (
                          <div style={s.kanbanEmpty}>{t('pages.zlecenia.emptyList')}</div>
                        ) : items.map((z) => {
                          const diagnostics = getTaskDiagnostics(z, todayIso);
                          return (
                          <div
                            className="zlecenia-kanban-card"
                            key={z.id}
                            draggable={mozePrzesuwacStatus && statusUpdatingId !== z.id}
                            onDragStart={() => setDraggedTaskId(z.id)}
                            onDragEnd={() => setDraggedTaskId(null)}
                            onClick={() => otworzSzczegoly(z)}
                            style={{
                              ...s.kanbanCard,
                              opacity: statusUpdatingId === z.id ? 0.6 : 1,
                              cursor: statusUpdatingId === z.id ? 'progress' : 'pointer',
                            }}>
                            <div style={s.kanbanCardTitle}>#{z.id} {z.klient_nazwa}</div>
                            <div style={s.kanbanCardMeta}>{z.adres ? `${z.adres}${z.miasto ? `, ${z.miasto}` : ''}` : (z.miasto || '—')}</div>
                            <div style={s.kanbanCardMeta}>{z.typ_uslugi ? t(`serviceType.${z.typ_uslugi}`, { defaultValue: z.typ_uslugi }) : t('common.none')}</div>
                            <div style={s.slaWrap}>
                              {getSlaFlags(z).length === 0 ? (
                                <span style={s.slaOk}>{t('pages.zlecenia.slaOk')}</span>
                              ) : getSlaFlags(z).map((flag) => (
                                <span key={flag} style={s.slaBadge}>{slaFlagLabel(flag)}</span>
                              ))}
                            </div>
                            <div style={s.kanbanDiagnostics}>
                              <span>Gotowość {diagnostics.score}%</span>
                              <span>{diagnostics.items[0]?.label || 'OK'}</span>
                            </div>
                            <div style={s.kanbanCardFooter}>
                              <TelemetryStatus state={z.priorytet === 'Pilny' ? 'warning' : 'info'} label={z.priorytet} />
                              {canSeeFinance && <span style={s.kanbanValue}>{formatCurrency(z.wartosc_planowana)}</span>}
                            </div>
                            <div style={s.kanbanActions} onClick={(e) => e.stopPropagation()}>
                              <button style={s.kanbanActionBtn} onClick={() => otworzSzczegoly(z)} title={t('common.details')} aria-label={t('common.details')}>
                                <VisibilityOutlined style={{ fontSize: 16, display: 'block' }} />
                              </button>
                              {mozeEdytowac && (
                                <button style={s.kanbanActionBtn} onClick={() => otworzEdycje(z)} title={t('common.edit')} aria-label={t('common.edit')}>
                                  <EditOutlined style={{ fontSize: 16, display: 'block' }} />
                                </button>
                              )}
                              {mozeUsuwac && (
                                <button
                                  style={{ ...s.kanbanActionBtn, color: '#C62828', backgroundColor: 'rgba(248,113,113,0.12)' }}
                                  onClick={() => setPotwierdzUsuniecie(z)}
                                  title={t('common.delete')}
                                  aria-label={t('common.delete')}>
                                  <DeleteOutline style={{ fontSize: 16, display: 'block' }} />
                                </button>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                </div>
              </>
            )}
          </>
        )}
 
        {/* ══ SZCZEGÓŁY ══ */}
        {tryb === 'szczegoly' && wybraneZlecenie && (
          <>
            <PageHeader
              variant="hero"
              back={{ onClick: () => setTryb('lista'), label: t('common.back') }}
              title={t('pages.zlecenia.detailHeading', { id: wybraneZlecenie.id })}
              subtitle={detailNextAction?.detail || detailBusinessMeta?.diagnostics?.nextAction?.detail || 'Jedna karta: klient, etap, blokady, dokumentacja, plan i decyzja.'}
              icon={<AssignmentOutlined style={{ fontSize: 26 }} />}
              actions={
                <>
                  {mozeEdytowac && (
                    <button type="button" style={s.btnSecondary} onClick={() => otworzEdycje(wybraneZlecenie)} title={t('common.edit')}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <EditOutlined style={{ fontSize: 18 }} aria-hidden />
                        {t('common.edit')}
                      </span>
                    </button>
                  )}
                  {mozeUsuwac && (
                    <button
                      type="button"
                      style={{ ...s.btnSecondary, backgroundColor: 'rgba(248,113,113,0.1)', color: '#C62828', border: '1px solid #EF9A9A' }}
                      onClick={() => setPotwierdzUsuniecie(wybraneZlecenie)}
                      title={t('common.delete')}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <DeleteOutline style={{ fontSize: 18 }} aria-hidden />
                        {t('common.delete')}
                      </span>
                    </button>
                  )}
                </>
              }
            />

            <section className="zlecenia-detail-hero" style={s.detailHeroPanel}>
              <div style={s.detailHeroMain}>
                <div className="zlecenia-detail-hero-eyebrow" style={s.detailOpsEyebrow}>Paszport operacyjny</div>
                <h2 style={s.detailHeroTitle}>
                  {wybraneZlecenie.klient_nazwa || `Zlecenie #${wybraneZlecenie.id}`}
                </h2>
                <div style={s.detailHeroMeta}>
                  <span>{getTaskAddressLine(wybraneZlecenie) || 'Brak adresu'}</span>
                  <span>{wybraneZlecenie.typ_uslugi || 'Typ pracy nie ustawiony'}</span>
                  <span>{wybraneZlecenie.ekipa_nazwa || (wybraneZlecenie.ekipa_id ? `Ekipa #${wybraneZlecenie.ekipa_id}` : 'Bez ekipy')}</span>
                </div>
                <div style={s.detailHeroCommand}>
                  <div style={s.detailHeroCommandText}>
                    <span style={s.detailHeroCommandLabel}>Następny ruch</span>
                    <strong style={s.detailHeroCommandTitle}>{detailNextAction?.label || detailBusinessMeta?.diagnostics?.nextAction?.label || 'Sprawdź zlecenie'}</strong>
                    <small style={s.detailHeroCommandDetail}>{detailNextAction?.detail || detailBusinessMeta?.diagnostics?.nextAction?.detail || 'Domknij brakujące dane przed planowaniem lub zamknięciem.'}</small>
                  </div>
                  <div style={s.detailHeroCommandActions}>
                    <button
                      type="button"
                      style={{
                        ...s.detailHeroPrimaryAction,
                        ...(statusUpdatingId === wybraneZlecenie.id || !(detailNextAction || detailBusinessMeta?.diagnostics?.nextAction) ? s.detailHeroActionDisabled : {}),
                      }}
                      disabled={statusUpdatingId === wybraneZlecenie.id || !(detailNextAction || detailBusinessMeta?.diagnostics?.nextAction)}
                      onClick={handleDetailDecisionAction}
                    >
                      Wykonaj
                    </button>
                    <button type="button" style={s.detailHeroSecondaryAction} onClick={() => scrollToDetailSection('contact')}>
                      Kontakt
                    </button>
                    <button type="button" style={s.detailHeroSecondaryAction} onClick={() => copyCrewBrief(wybraneZlecenie)}>
                      Brief
                    </button>
                  </div>
                </div>
              </div>
              <div className="zlecenia-detail-hero-stats" style={s.detailHeroStats}>
                {detailHeroStats.map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      ...s.detailHeroStat,
                      ...(s[`detailHeroStat_${stat.tone}`] || {}),
                    }}
                  >
                    <span style={s.detailHeroStatLabel}>{stat.label}</span>
                    <strong style={s.detailHeroStatValue}>{stat.value}</strong>
                    <small style={s.detailHeroStatDetail}>{stat.detail}</small>
                  </div>
                ))}
              </div>
            </section>

            <DetailStageOwnerPanel
              styles={s}
              task={wybraneZlecenie}
              rows={detailWorkflowRows}
              currentUser={currentUser}
              statusBusy={statusUpdatingId === wybraneZlecenie.id}
              canChangeStatus={mozePrzesuwacStatus}
              onCommand={handleDetailWorkflowCommand}
              onShowPath={focusWorkflowPath}
            />

            <WorkflowPathPanel
              styles={s}
              task={wybraneZlecenie}
              canChange={mozePrzesuwacStatus}
              statusBusy={statusUpdatingId === wybraneZlecenie.id}
              onChangeStatus={(nextStatus) => zmienStatusInline(wybraneZlecenie.id, nextStatus)}
              focused={workflowPathFocused}
              statusBlockers={detailWorkflowStatusBlockers}
            />

            <DetailWorkflowCommandCenter
              styles={s}
              rows={detailWorkflowRows}
              statusBusy={statusUpdatingId === wybraneZlecenie.id}
              canChangeStatus={mozePrzesuwacStatus}
              onCommand={handleDetailWorkflowCommand}
            />

            <OfficeDecisionBoard
              styles={s}
              cards={officeDecisionCards}
              recommendation={detailDecisionRecommendation || 'Ustal następny ruch zlecenia'}
              nextActionLabel={detailNextAction?.label || detailBusinessMeta?.diagnostics?.nextAction?.label || 'Sprawdź zlecenie'}
              nextActionDetail={detailNextAction?.detail || detailBusinessMeta?.diagnostics?.nextAction?.detail || 'Najpierw domknij brakujące dane w ścieżce zlecenia.'}
              primaryDisabled={statusUpdatingId === wybraneZlecenie.id || !(detailNextAction || detailBusinessMeta?.diagnostics?.nextAction)}
              onPrimary={handleDetailDecisionAction}
              onAction={handleOfficeDecisionAction}
            />

            <DetailRepairPanel
              styles={s}
              items={detailRepairItems}
              score={detailBusinessMeta?.diagnostics?.score}
              onAction={handleDetailWorkflowCommand}
            />

            <OfficePlanHandoffCard
              styles={s}
              task={wybraneZlecenie}
              branchLabel={getBranchLabel(wybraneZlecenie.oddzial_id)}
              photos={selectedTaskPhotos}
              fieldPhotoCount={fieldPhotoCount}
              readinessItems={officePlanReadinessItems}
              statusLabel={officePlanStatusLabel}
              statusTone={officePlanStatusTone}
              teamLabel={officePlanTeamLabel}
              planLabel={officePlanHandoffPlanLabel}
              equipmentLabel={officePlanHandoffEquipmentLabel}
              priceLabel={formatMoneyBrief(Number(wybraneZlecenie.wartosc_planowana || wybraneZlecenie.budzet || 0))}
              scopeLabel={officePlanCrewBrief}
              riskLabel={getTaskCrewRisk(wybraneZlecenie)}
              canPlan={showOfficePlanPanel}
              onPlan={() => scrollToDetailSection('officePlan')}
              onCalendar={() => openCrewScheduleForTask(wybraneZlecenie)}
              onCopy={() => copyOfficePlanHandoff(wybraneZlecenie)}
              onPhotos={() => scrollToDetailSection('photos')}
            />
 
            <div style={s.detailOpsPanel}>
              <div>
                <div style={s.detailOpsEyebrow}>Akcje terenowe</div>
                <div style={s.detailOpsTitle}>{getTaskAddressLine(wybraneZlecenie) || 'Brak adresu w zleceniu'}</div>
              </div>
              <div style={s.detailOpsActions}>
                {telHref(wybraneZlecenie.klient_telefon) ? (
                  <a href={telHref(wybraneZlecenie.klient_telefon)} style={s.fieldOpsBtn}>
                    <PhoneOutlined style={s.fieldOpsIcon} aria-hidden />
                    Zadzwoń
                  </a>
                ) : null}
                {getMapsHref(wybraneZlecenie) ? (
                  <a href={getMapsHref(wybraneZlecenie)} target="_blank" rel="noreferrer" style={s.fieldOpsBtn}>
                    <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                    Trasa
                  </a>
                ) : null}
                <button type="button" style={s.fieldOpsBtn} onClick={() => copyClientMessage(wybraneZlecenie)}>
                  <SmsOutlined style={s.fieldOpsIcon} aria-hidden />
                  SMS
                </button>
                <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskAddress(wybraneZlecenie)}>
                  <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                  Adres
                </button>
                <button type="button" style={s.fieldOpsBtn} onClick={() => copyCrewBrief(wybraneZlecenie)}>
                  <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                  Brief
                </button>
              </div>
            </div>

            <div data-detail-section="gpsHistory" style={s.detailGpsPanel}>
              <div style={s.detailGpsHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>GPS ekipy</div>
                  <div style={s.detailGpsTitle}>Historia GPS dnia</div>
                  <p style={s.detailGpsSubtitle}>
                    Punkty z telefonu lub auta przypisane do ekipy, uzytkownika albo pojazdu zlecenia.
                  </p>
                </div>
                <div style={s.detailGpsControls}>
                  <input
                    aria-label="Data historii GPS"
                    type="date"
                    value={detailGpsHistoryDate}
                    onChange={(event) => setDetailGpsHistoryDate(event.target.value)}
                    style={s.detailGpsDateInput}
                  />
                  <button
                    type="button"
                    style={{ ...s.fieldOpsBtn, ...(detailGpsHistoryLoading ? s.fieldOpsBtnDisabled : {}) }}
                    disabled={detailGpsHistoryLoading}
                    onClick={() => loadDetailGpsHistory(wybraneZlecenie, detailGpsHistoryDate)}
                  >
                    {detailGpsHistoryLoading ? 'Laduje...' : 'Odswiez'}
                  </button>
                  {detailGpsHistoryMapUrl ? (
                    <a href={detailGpsHistoryMapUrl} target="_blank" rel="noreferrer" style={s.fieldOpsBtn}>
                      <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                      Trasa GPS
                    </a>
                  ) : null}
                </div>
              </div>

              {detailGpsHistoryError ? (
                <div style={s.detailGpsError}>{detailGpsHistoryError}</div>
              ) : null}

              <div style={s.detailGpsSummary}>
                <div style={s.detailGpsMetric}>
                  <span>Punkty</span>
                  <strong>{detailGpsHistoryLoading ? '...' : `${detailGpsHistory.length} pkt`}</strong>
                  <small>{taskGpsHistoryRangeLabel(detailGpsHistory)}</small>
                </div>
                <div style={s.detailGpsMetric}>
                  <span>Max predkosc</span>
                  <strong>{taskGpsHistoryMaxSpeed(detailGpsHistory)}</strong>
                  <small>z danych GPS</small>
                </div>
                <div style={s.detailGpsMetric}>
                  <span>Ostatni punkt</span>
                  <strong>{detailGpsHistoryLastPoint ? taskGpsPointLabel(detailGpsHistoryLastPoint).split('/')[0].trim() : 'brak'}</strong>
                  <small>{detailGpsHistoryLastPoint ? taskGpsSourceLabel(detailGpsHistoryLastPoint) : 'bez sygnalu'}</small>
                </div>
              </div>

              {detailGpsHistory.length ? (
                <div style={s.detailGpsRouteStrip}>
                  {detailGpsHistory.slice(0, 24).map((point, index) => {
                    const pointUrl = taskGpsMapUrl(point.lat, point.lng);
                    return (
                      <a
                        key={`${point.recorded_at || index}-${point.lat}-${point.lng}`}
                        href={pointUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Mapa GPS ${taskGpsPointLabel(point)}`}
                        title={`${taskGpsPointLabel(point)} / ${taskGpsSourceLabel(point)}`}
                        style={{
                          ...s.detailGpsRouteDot,
                          opacity: 0.35 + ((index + 1) / Math.max(1, Math.min(detailGpsHistory.length, 24))) * 0.65,
                        }}
                      />
                    );
                  })}
                </div>
              ) : null}

              {detailGpsHistoryLoading ? (
                <div style={s.detailGpsEmpty}>Laduje historie GPS...</div>
              ) : detailGpsHistoryPreview.length ? (
                <div style={s.detailGpsTimeline}>
                  {detailGpsHistoryPreview.map((point, index) => {
                    const pointUrl = taskGpsMapUrl(point.lat, point.lng);
                    return (
                      <div key={`${point.recorded_at || index}-${point.lat}-${point.lng}`} style={s.detailGpsPoint}>
                        <span style={s.detailGpsPointDot} />
                        <div style={{ minWidth: 0 }}>
                          <div style={s.detailGpsPointTitle}>{taskGpsPointLabel(point)} / {taskGpsSourceLabel(point)}</div>
                          <div style={s.detailGpsPointMeta}>
                            {[point.user_name, point.nr_rejestracyjny, point.accuracy_m ? `~${Math.round(point.accuracy_m)} m` : ''].filter(Boolean).join(' | ') || 'punkt GPS'}
                          </div>
                        </div>
                        {pointUrl ? (
                          <a href={pointUrl} target="_blank" rel="noreferrer" style={s.detailGpsPointLink}>
                            Mapa
                          </a>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={s.detailGpsEmpty}>
                  Brak punktow GPS dla dnia zlecenia. Jesli ekipa ma wlaczona mobilke, punkty pojawia sie automatycznie.
                </div>
              )}
            </div>

            <div data-detail-section="crewBrief">
              <CrewExecutionBrief
                styles={s}
                task={wybraneZlecenie}
                photos={selectedTaskPhotos}
                issues={selectedTaskProblems}
                safetyChecklist={detailSafetyChecklist}
                equipment={detailEquipmentList}
                issueDraft={crewIssueDraft}
                issueSaving={crewIssueSaving}
                statusBusy={statusUpdatingId === wybraneZlecenie.id}
                canChangeStatus={mozeObslugiwacRealizacje}
                onIssueDraftChange={setCrewIssueDraft}
                onReportIssue={reportCrewIssue}
                onStart={() => zmienStatusInline(wybraneZlecenie.id, TASK_STATUS.W_REALIZACJI)}
                onFinish={() => zmienStatusInline(wybraneZlecenie.id, TASK_STATUS.ZAKONCZONE)}
                onCopy={() => copyCrewBrief(wybraneZlecenie)}
              />
            </div>

            {detailBusinessMeta ? (
              <div className="zlecenia-detail-passport" style={s.detailPassportPanel}>
                <div style={s.detailPassportHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Paszport zlecenia 360</div>
                    <div style={s.detailPassportTitle}>
                      {wybraneZlecenie.klient_nazwa || `Zlecenie #${wybraneZlecenie.id}`}
                    </div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${detailSafetyRequiredIssues.length ? 'danger' : detailBusinessMeta.severity}`] }}>
                    BHP {detailSafetyOkCount}/{detailSafetyChecklist.length}
                  </span>
                </div>
                <div className="zlecenia-detail-passport-grid" style={s.detailPassportGrid}>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>Klient</span>
                    <strong>{detailContactOption.label}</strong>
                    <small>{wybraneZlecenie.klient_telefon || 'Brak telefonu'}{detailContact.dueAt ? ` · ${detailFollowupMeta.label}` : ''}</small>
                  </div>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>Ekipa i termin</span>
                    <strong>{wybraneZlecenie.ekipa_nazwa || (wybraneZlecenie.ekipa_id ? `Ekipa #${wybraneZlecenie.ekipa_id}` : 'Bez ekipy')}</strong>
                    <small>{wybraneZlecenie.data_planowana ? `${wybraneZlecenie.data_planowana.split('T')[0]}${wybraneZlecenie.godzina_rozpoczecia ? ` ${wybraneZlecenie.godzina_rozpoczecia}` : ''}` : 'Brak terminu'}</small>
                  </div>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>BHP</span>
                    <strong>{detailSafetyRequiredIssues.length ? 'Wymaga poprawy' : 'Gotowe do odprawy'}</strong>
                    <small>{detailSafetyRequiredIssues[0]?.label || 'Krytyczne punkty są zamknięte.'}</small>
                  </div>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>Sprzęt</span>
                    <strong>{detailEquipmentList.length ? `${detailEquipmentList.length} pozycji` : 'Nie wskazano'}</strong>
                    <small>{detailEquipmentList.slice(0, 3).join(', ') || 'Uzupełnij, jeśli ekipa ma zabrać konkretny sprzęt.'}</small>
                  </div>
                </div>
                <div className="zlecenia-detail-safety-grid" style={s.detailSafetyGrid}>
                  {detailSafetyChecklist.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        ...s.detailSafetyItem,
                        ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                      }}
                    >
                      <span style={s.detailChecklistStatus}>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {showOfficePlanPanel ? (
              <div className="zlecenia-office-plan" data-detail-section="officePlan" style={s.officePlanPanel}>
                <div style={s.officePlanHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Plan biura</div>
                    <div style={s.officePlanTitle}>Do zaplanowania dla ekipy</div>
                    <p style={s.officePlanSubtitle}>
                      Biuro dopina termin, ekipę i sprzęt na podstawie pakietu z wyceny terenowej.
                    </p>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${officePlanStatusTone}`] }}>
                    {officePlanStatusLabel}
                  </span>
                </div>
                <div style={s.officePlanReadinessGrid}>
                  {officePlanReadinessItems.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        ...s.officePlanReadinessItem,
                        ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                      }}
                    >
                      <span style={s.detailChecklistStatus}>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
                <div style={s.timeWindowBox}>
                  <div style={s.timeWindowMain}>
                    <span style={s.detailOpsEyebrow}>Okno klienta</span>
                    <strong style={s.timeWindowTitle}>{timeWindowDraftLabel}</strong>
                    <small style={s.timeWindowDetail}>
                      Wyślij klientowi link do akceptacji albo skopiuj go ręcznie. Akceptacja zapisze okno na zleceniu i zablokuje planowanie poza tym zakresem.
                    </small>
                    {latestTimeWindowUrl ? (
                      <small style={s.timeWindowUrl}>{latestTimeWindowUrl}</small>
                    ) : null}
                  </div>
                  <div style={s.timeWindowActions}>
                    <button
                      type="button"
                      style={{ ...s.bulkBtn, ...(!timeWindowDraftReady || timeWindowProposalBusy ? { opacity: 0.62, cursor: 'not-allowed' } : {}) }}
                      disabled={!timeWindowDraftReady || timeWindowProposalBusy}
                      onClick={() => createClientTimeWindowProposal({ sendSms: true })}
                    >
                      {timeWindowProposalBusy ? 'Pracuję...' : 'Wyślij SMS z linkiem'}
                    </button>
                    <button
                      type="button"
                      style={s.bulkBtnSecondary}
                      disabled={!timeWindowDraftReady || timeWindowProposalBusy}
                      onClick={() => createClientTimeWindowProposal({ copyLink: true })}
                    >
                      Kopiuj link
                    </button>
                  </div>
                  <div style={s.timeWindowHistory}>
                    <span style={s.detailOpsEyebrow}>
                      Historia propozycji {timeWindowProposalsLoading ? '(laduję...)' : ''}
                    </span>
                    {timeWindowProposals.length ? (
                      timeWindowProposals.slice(0, 4).map((item) => {
                        const tone = timeWindowStatusTone(item.effective_status || item.status);
                        return (
                          <div key={item.id || item.token} style={s.timeWindowHistoryRow}>
                            <div style={s.timeWindowHistoryMain}>
                              <strong>{item.proposed_date} {item.okno_od}-{item.okno_do}</strong>
                              <small>{timeWindowSmsLabel(item.sms)}{item.client_note ? ` · klient: ${item.client_note}` : ''}</small>
                            </div>
                            <span style={{ ...s.timeWindowStatus, ...(s[`timeWindowStatus_${tone}`] || {}) }}>
                              {timeWindowStatusLabel(item.effective_status || item.status)}
                            </span>
                            {item.url ? (
                              <button type="button" style={s.timeWindowMiniBtn} onClick={() => copyText(item.url, 'Skopiowano link propozycji okna.')}>
                                Link
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <small style={s.timeWindowDetail}>Brak wcześniejszych propozycji dla tego zlecenia.</small>
                    )}
                  </div>
                </div>
                {officePlanSuggestion ? (
                  <div
                    style={{
                      ...s.officePlanAssistant,
                      ...(s[`officePlanAssistant_${officePlanSuggestion.tone}`] || {}),
                    }}
                  >
                    <div style={s.officePlanAssistantMain}>
                      <span style={s.detailOpsEyebrow}>Asystent slotu</span>
                      <strong style={s.officePlanAssistantTitle}>{officePlanSuggestion.label}</strong>
                      <small style={s.officePlanAssistantDetail}>{officePlanSuggestion.detail}</small>
                    </div>
                    <div style={s.officePlanAssistantBusy}>
                      {officePlanSuggestion.ranges.slice(0, 4).map((range) => (
                        <span key={range.id} style={s.officePlanAssistantBusyItem}>
                          {range.startLabel}-{range.endLabel} · #{range.id} {range.city || range.client}
                        </span>
                      ))}
                      {officePlanSuggestion.ok ? (
                        <button
                          type="button"
                          style={s.officePlanAssistantBtn}
                          onClick={() => applyOfficePlanSuggestion(officePlanSuggestion)}
                        >
                          Wstaw podpowiedź
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={s.officePlanAssistantBtnSecondary}
                          onClick={() => openResourceCalendarForTask(wybraneZlecenie, { tab: 'teams', modal: '1' })}
                        >
                          Otwórz harmonogram
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
                {officePlanTeamConflictSummary.readyToCheck ? (
                  <div
                    style={{
                      ...s.officePlanConflictBox,
                      ...(officePlanTeamConflictSummary.hardConflict
                        ? s.officePlanConflictBox_danger
                        : officePlanTeamConflictSummary.warning
                          ? s.officePlanConflictBox_warning
                          : s.officePlanConflictBox_good),
                    }}
                  >
                    <div>
                      <span style={s.detailOpsEyebrow}>Radar grafiku ekipy</span>
                      <strong style={s.officePlanConflictTitle}>{officePlanTeamConflictSummary.label}</strong>
                      <small style={s.officePlanConflictDetail}>{officePlanTeamConflictSummary.detail}</small>
                    </div>
                    {officePlanTeamConflictSummary.conflicts.length ? (
                      <div style={s.officePlanConflictList}>
                        {officePlanTeamConflictSummary.conflicts.map((range) => (
                          <span key={range.id}>
                            {range.startLabel}-{range.endLabel} #{range.id} {range.city || range.client}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {officePlanTeamResourceSummary.readyToCheck ? (
                  <div
                    style={{
                      ...s.officePlanConflictBox,
                      ...(officePlanTeamResourceSummary.hardConflict
                        ? s.officePlanConflictBox_danger
                        : s.officePlanConflictBox_good),
                    }}
                  >
                    <div>
                      <span style={s.detailOpsEyebrow}>Zasoby przypisane do ekipy</span>
                      <strong style={s.officePlanConflictTitle}>{officePlanTeamResourceSummary.label}</strong>
                      <small style={s.officePlanConflictDetail}>{officePlanTeamResourceSummary.detail}</small>
                    </div>
                    {officePlanTeamResourceSummary.items.length ? (
                      <>
                        <div style={s.officePlanConflictList}>
                          {officePlanTeamResourceSummary.items.map((item) => (
                            <span key={`${item.kind}-${item.id}`}>
                              {item.kind}: {item.label}{item.status ? ` - ${item.status}` : ''}
                            </span>
                          ))}
                        </div>
                        <div style={s.officePlanConflictActions}>
                          <button
                            type="button"
                            style={s.officePlanAssistantBtnSecondary}
                            onClick={() => {
                              const params = new URLSearchParams({ tab: 'naprawy' });
                              const teamId = officePlan.ekipa_id || wybraneZlecenie?.ekipa_id;
                              const firstItem = officePlanTeamResourceSummary.items[0];
                              if (teamId) params.set('team', String(teamId));
                              if (firstItem?.kind) params.set('kind', firstItem.kind);
                              if (firstItem?.id) params.set('resource', String(firstItem.id));
                              if (wybraneZlecenie?.id) {
                                params.set('returnTo', `/zlecenia/${wybraneZlecenie.id}?focus=officePlan`);
                                params.set('returnLabel', `Plan zlecenia #${wybraneZlecenie.id}`);
                              }
                              navigate(`/flota?${params.toString()}`);
                            }}
                          >
                            Otworz naprawy
                          </button>
                          <button type="button" style={s.officePlanAssistantBtnSecondary} onClick={() => navigate('/ekipy')}>
                            Otworz ekipy
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {officePlanEquipmentConflictSummary.readyToCheck ? (
                  <div
                    style={{
                      ...s.officePlanConflictBox,
                      ...(officePlanEquipmentConflictSummary.hardConflict || officePlanEquipmentConflictSummary.pending
                        ? s.officePlanConflictBox_danger
                        : officePlanEquipmentConflictSummary.warning
                          ? s.officePlanConflictBox_warning
                          : s.officePlanConflictBox_good),
                    }}
                  >
                    <div>
                      <span style={s.detailOpsEyebrow}>Radar rezerwacji sprzetu</span>
                      <strong style={s.officePlanConflictTitle}>{officePlanEquipmentConflictSummary.label}</strong>
                      <small style={s.officePlanConflictDetail}>{officePlanEquipmentConflictSummary.detail}</small>
                    </div>
                    {officePlanEquipmentConflictSummary.conflicts.length ? (
                      <div style={s.officePlanConflictList}>
                        {officePlanEquipmentConflictSummary.conflicts.map((row) => (
                          <span key={row.id}>
                            {row.sprzet_nazwa || `Sprzet #${row.sprzet_id}`} - {row.ekipa_nazwa || 'inna ekipa'}
                            {row.task_id ? `, zlecenie #${row.task_id}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div style={s.officePlanGrid}>
                  <div style={s.fg}>
                    <label style={s.label}>Data</label>
                    <input
                      type="date"
                      style={{ ...s.input, ...(!officePlan.data_planowana ? s.inputDanger : {}) }}
                      value={officePlan.data_planowana}
                      onChange={(event) => setOfficePlanField('data_planowana', event.target.value)}
                    />
                  </div>
                  <div style={s.fg}>
                    <label style={s.label}>Godzina startu</label>
                    <input
                      type="time"
                      style={{ ...s.input, ...(!officePlan.godzina_rozpoczecia ? s.inputDanger : {}) }}
                      value={officePlan.godzina_rozpoczecia}
                      onChange={(event) => setOfficePlanField('godzina_rozpoczecia', event.target.value)}
                    />
                  </div>
                  <div style={s.fg}>
                    <label style={s.label}>Czas pracy (h)</label>
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      style={{ ...s.input, ...(Number(officePlan.czas_planowany_godziny) > 0 ? {} : s.inputDanger) }}
                      value={officePlan.czas_planowany_godziny}
                      onChange={(event) => setOfficePlanField('czas_planowany_godziny', event.target.value)}
                    />
                  </div>
                  <div style={s.fg}>
                    <label style={s.label}>Ekipa</label>
                    <select
                      style={{ ...s.input, ...(!officePlan.ekipa_id ? s.inputDanger : {}) }}
                      value={officePlan.ekipa_id}
                      onChange={(event) => setOfficePlanField('ekipa_id', event.target.value)}
                    >
                      <option value="">— wybierz ekipę —</option>
                      {detailPlanTeamOptions.map((ekipa) => (
                        <option key={getTeamOptionKey(ekipa)} value={ekipa.id}>{getTeamOptionLabel(ekipa)}</option>
                      ))}
                    </select>
                    {!detailPlanTeamOptions.length ? (
                      <small style={s.officePlanFieldDanger}>Brak dostępnej ekipy w oddziale. Najpierw dodaj ekipę albo delegację.</small>
                    ) : null}
                  </div>
                  <div style={{ ...s.fg, ...s.officePlanEquipmentField }}>
                    <label style={s.label}>Sprzet do rezerwacji</label>
                    <select
                      multiple
                      style={{ ...s.input, ...s.officePlanMultiSelect }}
                      value={officePlan.sprzet_ids || []}
                      onChange={(event) => setOfficePlanEquipment(event.target.selectedOptions)}
                    >
                      {detailEquipmentOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {getEquipmentPlanLabel(item, {
                            teamId: officePlan.ekipa_id,
                            taskBranchId: wybraneZlecenie?.oddzial_id,
                            getBranchLabel,
                          })}
                        </option>
                      ))}
                    </select>
                    <small style={s.officePlanEquipmentHint}>
                      {selectedOfficeEquipment.length
                        ? `Wybrano: ${selectedOfficeEquipment.map((item) => getEquipmentPlanLabel(item, {
                          teamId: officePlan.ekipa_id,
                          taskBranchId: wybraneZlecenie?.oddzial_id,
                          getBranchLabel,
                        })).join(', ')}`
                        : 'Rezerwacja powstanie razem z planem zlecenia.'}
                    </small>
                  </div>
                  <div style={{ ...s.fg, ...s.officePlanNoteField }}>
                    <label style={s.label}>Sprzęt / uwagi dla brygady</label>
                    <textarea
                      style={{ ...s.input, ...s.officePlanTextarea }}
                      value={officePlan.sprzet_notatka}
                      placeholder="np. rębak, zwyżka, zabezpieczenie rabaty, dojazd od bramy bocznej"
                      onChange={(event) => setOfficePlanField('sprzet_notatka', event.target.value)}
                    />
                  </div>
                </div>
                <div style={s.officePlanFooter}>
                  <div style={s.officePlanSummary}>
                    <strong>{officePlanTeam ? getTeamOptionLabel(officePlanTeam) : 'Ekipa nie wybrana'}</strong>
                    <span>
                      {officePlan.data_planowana || 'brak daty'} {officePlan.godzina_rozpoczecia || ''}
                      {officePlan.czas_planowany_godziny ? ` · ${officePlan.czas_planowany_godziny} h` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    style={{ ...s.bulkBtn, ...(!officePlanCanSubmit ? { opacity: 0.62, cursor: officePlanSaving ? 'wait' : 'not-allowed' } : {}) }}
                    disabled={!officePlanCanSubmit}
                    onClick={zapiszPlanBiura}
                  >
                    {officePlanSaving ? 'Zapisuję...' : officePlanRequiredMissing.length ? 'Uzupełnij plan' : 'Zapisz i ustaw Zaplanowane'}
                  </button>
                  <button
                    type="button"
                    style={s.bulkBtnSecondary}
                    onClick={() => openCrewScheduleForTask(wybraneZlecenie)}
                  >
                    Otwórz harmonogram ekip
                  </button>
                  <button
                    type="button"
                    style={s.bulkBtnSecondary}
                    onClick={() => openResourceCalendarForTask(wybraneZlecenie, { tab: 'equipment', modal: '0' })}
                  >
                    Sprzet dnia
                  </button>
                </div>
              </div>
            ) : null}

            <div data-detail-section="photos">
              <TaskPhotosPanel
                styles={s}
                title="Dokumentacja z wyceny i wykonania"
                subtitle="To widzi biuro i ekipa: zakres wyceniony u klienta, szkice cięcia, dowody przed/po."
                taskId={wybraneZlecenie.id}
                photos={selectedTaskPhotos}
                loading={taskPhotosLoading}
                uploading={uploadingTaskPhoto}
                draft={taskPhotoDraft}
                inputRef={taskPhotoInputRef}
                onDraftChange={setTaskPhotoDraft}
                onPickFiles={uploadTaskPhotos}
                onDraw={openTaskDraw}
                onDelete={mozeEdytowac ? deleteTaskPhoto : null}
                repairFocus={taskPhotoRepairFocus}
                onCloseRepair={() => setTaskPhotoRepairFocus(null)}
              />
            </div>

            {detailBusinessMeta && detailPriceGuidance ? (
              <div className="zlecenia-detail-decision" data-detail-section="decision" style={s.detailDecisionPanel}>
                <div style={s.detailDecisionHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Centrum decyzji</div>
                    <div style={s.detailDecisionTitle}>{detailDecisionRecommendation}</div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${detailBusinessMeta.severity}`] }}>
                    Ryzyko {detailBusinessMeta.riskScore}
                  </span>
                </div>
                <div className="zlecenia-detail-decision-grid" style={s.detailDecisionGrid}>
                  <div style={s.detailDecisionHero}>
                    <span style={s.detailDecisionLabel}>Następny ruch</span>
                    <strong style={s.detailDecisionHeroText}>{detailNextAction?.label || detailBusinessMeta.diagnostics.nextAction.label}</strong>
                    <div style={s.detailDecisionActions}>
                      <button
                        type="button"
                        style={s.bulkBtn}
                        onClick={handleDetailDecisionAction}
                      >
                        Wykonaj
                      </button>
                      <button type="button" style={s.bulkBtnSecondary} onClick={() => copyTaskBrief(wybraneZlecenie)}>
                        Kopiuj brief
                      </button>
                    </div>
                  </div>
                  <div style={{ ...s.detailPriceBox, ...s[`detailPriceBox_${detailPriceGuidance.tone}`] }}>
                    <span style={s.detailDecisionLabel}>Cena</span>
                    <strong style={s.detailPriceTitle}>{detailPriceGuidance.label}</strong>
                    <span style={s.detailPriceText}>{detailPriceGuidance.detail}</span>
                    <div style={s.detailPriceMetrics}>
                      <span>Rekomendacja: <strong>{detailPriceGuidance.recommended ? formatCurrencyZero(detailPriceGuidance.recommended) : '—'}</strong></span>
                      <span>Bufor: <strong>{detailPriceGuidance.buffer === null ? '—' : formatCurrencyZero(detailPriceGuidance.buffer)}</strong></span>
                      <span>Stawka: <strong>{detailPriceGuidance.revenuePerHour ? `${Math.round(detailPriceGuidance.revenuePerHour).toLocaleString('pl-PL')} PLN/h` : '—'}</strong></span>
                    </div>
                    {mozeEdytowac ? (
                      <button type="button" style={s.detailPriceEditBtn} onClick={() => otworzEdycje(wybraneZlecenie, 'finance')}>
                        Edytuj finanse
                      </button>
                    ) : null}
                  </div>
                </div>
                <div style={s.detailDecisionMetrics}>
                  <div style={s.detailDecisionMetric}>
                    <span>Wartość</span>
                    <strong>{formatCurrencyZero(detailBusinessMeta.value)}</strong>
                  </div>
                  <div style={s.detailDecisionMetric}>
                    <span>Jakość</span>
                    <strong>{detailBusinessMeta.diagnostics.score}/100</strong>
                  </div>
                  <div style={s.detailDecisionMetric}>
                    <span>Checklist</span>
                    <strong>{detailQualityOkCount}/{detailQualityChecklist.length}</strong>
                  </div>
                  <div style={s.detailDecisionMetric}>
                    <span>Blokady krytyczne</span>
                    <strong>{detailRequiredIssues.length}</strong>
                  </div>
                </div>
                <div style={s.detailChecklistGrid}>
                  {detailQualityChecklist.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        ...s.detailChecklistItem,
                        ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                      }}
                    >
                      <span style={s.detailChecklistStatus}>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
                <div style={s.closureDecisionLog}>
                  <div style={s.closureDecisionHeader}>
                    <div>
                      <div style={s.detailOpsEyebrow}>Rejestr decyzji</div>
                      <div style={s.closureDecisionTitle}>Zamykanie i blokady</div>
                    </div>
                    <span style={s.closureDecisionCount}>{detailClosureEvents.length}</span>
                  </div>
                  {detailClosureEvents.length === 0 ? (
                    <div style={s.closureDecisionEmpty}>Brak prób zamknięcia i decyzji operatora.</div>
                  ) : detailClosureEvents.slice(0, 5).map((event) => (
                    <div key={event.id} style={s.closureDecisionItem}>
                      <span style={{ ...s.contactDot, ...(event.severity === 'danger' ? s.contactDot_danger : event.severity === 'warning' ? s.contactDot_warning : s.contactDot_good) }} />
                      <div style={s.closureDecisionBody}>
                        <div style={s.closureDecisionTop}>
                          <strong>{closureActionLabel(event.action)}</strong>
                          <span>{formatContactStamp(event.created_at)}</span>
                        </div>
                        <div style={s.closureDecisionMeta}>
                          {event.actor || 'Operator'} · ryzyko {event.risk_score} · jakość {event.quality_score}/100
                        </div>
                        {[...(event.blockers || []), ...(event.warnings || [])].length ? (
                          <div style={s.closureDecisionChips}>
                            {[...(event.blockers || []), ...(event.warnings || [])].slice(0, 4).map((item) => (
                              <span key={`${event.id}-${item.key}-${item.label}`} style={s.closureDecisionChip}>
                                {item.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div data-detail-section="contact" style={s.clientContactPanel}>
              <div style={s.clientContactHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>Kontakt z klientem</div>
                  <div style={s.clientContactTitle}>{detailContactOption.label}</div>
                </div>
                <div style={s.clientContactMeta}>
                  <span>Ostatnio: {formatContactStamp(detailContact.updatedAt)}</span>
                  {detailContact.dueAt ? <span>{detailFollowupMeta.label}</span> : null}
                  {detailContact.actor ? <strong>{detailContact.actor}</strong> : null}
                </div>
              </div>
              <div style={s.contactStatusGrid}>
                {CLIENT_CONTACT_STATUSES.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    style={{
                      ...s.contactStatusBtn,
                      ...(detailContactOption.key === option.key ? s.contactStatusBtnActive : {}),
                    }}
                    onClick={() => markClientContactStatus(wybraneZlecenie, option.key)}
                  >
                    <span style={{ ...s.contactDot, ...s[`contactDot_${option.tone}`] }} />
                    {option.label}
                  </button>
                ))}
              </div>
              <textarea
                value={contactDraft}
                onChange={(event) => setContactDraft(event.target.value)}
                style={s.contactTextarea}
                placeholder="Ostatnia rozmowa, ustalenia, obietnica oddzwonienia..."
              />
              <div style={s.contactFollowupPanel}>
                <div style={s.contactFollowupHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Termin follow-upu</div>
                    <div style={{ ...s.contactFollowupTitle, ...(detailFollowupMeta.overdue ? s.contactFollowupTitleDanger : {}) }}>
                      {detailFollowupMeta.label}
                    </div>
                  </div>
                  <div style={s.contactFollowupQuick}>
                    <button type="button" style={s.followupBtn} onClick={() => setContactDuePreset(wybraneZlecenie, 0)}>Dziś</button>
                    <button type="button" style={s.followupBtn} onClick={() => setContactDuePreset(wybraneZlecenie, 1)}>Jutro</button>
                    <button type="button" style={s.followupBtn} onClick={() => setContactDuePreset(wybraneZlecenie, 2)}>Za 2 dni</button>
                    <button type="button" style={{ ...s.followupBtn, ...s.followupClearBtn }} onClick={() => clearContactDue(wybraneZlecenie)}>Wyczyść</button>
                  </div>
                </div>
                <div style={s.contactFollowupInputRow}>
                  <input
                    type="datetime-local"
                    value={contactDueDraft}
                    onChange={(event) => setContactDueDraft(event.target.value)}
                    style={s.contactFollowupInput}
                  />
                  <button type="button" style={s.bulkBtn} onClick={() => saveContactDue(wybraneZlecenie)}>
                    Zapisz termin
                  </button>
                </div>
              </div>
              <div style={s.clientContactActions}>
                <button type="button" style={s.bulkBtn} onClick={() => saveContactNote(wybraneZlecenie)}>
                  Zapisz notatkę
                </button>
                <button type="button" style={s.bulkBtn} onClick={() => copyClientMessage(wybraneZlecenie)}>
                  Skopiuj SMS
                </button>
                <button type="button" style={s.bulkBtnSecondary} onClick={() => markPreparedSms(wybraneZlecenie)}>
                  Po SMS: czeka
                </button>
              </div>
              {Array.isArray(detailContact.history) && detailContact.history.length > 0 ? (
                <div style={s.contactHistory}>
                  <div style={s.contactHistoryTitle}>Historia kontaktu</div>
                  {detailContact.history.slice(0, 4).map((event) => {
                    const option = getClientContactOption(event.status);
                    return (
                      <div key={event.id || `${event.status}-${event.created_at}`} style={s.contactHistoryItem}>
                        <span style={{ ...s.contactDot, ...s[`contactDot_${option.tone}`] }} />
                        <div style={s.contactHistoryBody}>
                          <div style={s.contactHistoryTop}>
                            <strong>{option.label}</strong>
                            <span>{formatContactStamp(event.created_at || event.updated_at)}</span>
                          </div>
                          <div style={s.contactHistoryMeta}>
                            {event.actor || 'Operator'}{event.due_at ? ` · follow-up: ${formatContactStamp(event.due_at)}` : ''}{event.note ? ` · ${event.note}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div style={s.twoCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>Dane klienta</div>
                {[['Klient', wybraneZlecenie.klient_nazwa], ['Telefon', wybraneZlecenie.klient_telefon, 'tel'],
                  ['Email', wybraneZlecenie.klient_email], ['Adres', wybraneZlecenie.adres],
                  ['Miasto', wybraneZlecenie.miasto]].map(([l, v, kind]) => v ? (
                  <div key={l} style={s.detailRow}>
                    <span style={s.detailLabel}>{l}</span>
                    <span style={s.detailValue}>
                      {kind === 'tel' && telHref(v) ? (
                        <a href={telHref(v)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>{v}</a>
                      ) : (
                        v
                      )}
                    </span>
                  </div>
                ) : null)}
              </div>
              <div style={s.card}>
                <div style={s.cardTitle}>Planowanie</div>
                {[['Typ usługi', wybraneZlecenie.typ_uslugi], ['Status', wybraneZlecenie.status],
                  ['Priorytet', wybraneZlecenie.priorytet],
                  ['Data planowana', wybraneZlecenie.data_planowana ? wybraneZlecenie.data_planowana.split('T')[0] : null],
                  ['Czas planowany', wybraneZlecenie.czas_planowany_godziny ? wybraneZlecenie.czas_planowany_godziny + ' h' : null],
                  ['Ekipa', wybraneZlecenie.ekipa_nazwa]].map(([l, v]) => v ? (
                  <div key={l} style={s.detailRow}>
                    <span style={s.detailLabel}>{l}</span><span style={s.detailValue}>{v}</span>
                  </div>
                ) : null)}
              </div>
            </div>
 
            <div style={s.card}>
              <div style={s.cardTitle}>Specyfikacja pracy</div>
              {wybraneZlecenie.opis_pracy && (
                <div style={{ marginBottom: 16, padding: '12px 14px', backgroundColor: 'var(--surface-glass)', borderRadius: 8, fontSize: 14 }}>
                  <strong>1. Opis pracy:</strong> {wybraneZlecenie.opis_pracy}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div style={{ backgroundColor: 'var(--surface-glass)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                    <RouteOutlined style={{ fontSize: 16 }} aria-hidden />
                    Logistyka
                  </div>
                  {[['2. Wywóz', wybraneZlecenie.wywoz], ['3. Usuwanie pni', wybraneZlecenie.usuwanie_pni]].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: '600', color: v ? 'var(--accent)' : '#EF5350' }}>{v ? t('common.yes') : t('common.no')}</span>
                    </div>
                  ))}
                  {wybraneZlecenie.czas_realizacji_godz && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>4. Czas realizacji</span>
                      <span style={{ fontSize: 13 }}>{wybraneZlecenie.czas_realizacji_godz} h</span>
                    </div>
                  )}
                  {wybraneZlecenie.ilosc_osob && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>9. Ilość osób</span>
                      <span style={{ fontSize: 13 }}>{wybraneZlecenie.ilosc_osob}</span>
                    </div>
                  )}
                </div>
                <div style={{ backgroundColor: 'var(--surface-glass)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Sprzęt</div>
                  {[['6. Rębak', wybraneZlecenie.rebak], ['7. Piła na wysięgniku', wybraneZlecenie.pila_wysiegniku],
                    ['8. Nożyce długie', wybraneZlecenie.nozyce_dlugie], ['16. Arborysta', wybraneZlecenie.arborysta],
                    ['17. Kosiarka', wybraneZlecenie.kosiarka], ['18. Podkaszarka', wybraneZlecenie.podkaszarka],
                    ['19. Łopata', wybraneZlecenie.lopata], ['20. Mulczer', wybraneZlecenie.mulczer]].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: '600', color: v ? 'var(--accent)' : '#EF5350' }}>{v ? t('common.yes') : t('common.no')}</span>
                    </div>
                  ))}
                </div>
                <div style={{ backgroundColor: 'var(--surface-glass)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Finanse</div>
                  {[['11. Budżet', formatCurrency(wybraneZlecenie.budzet)],
                    ['12. Rabat', wybraneZlecenie.rabat ? wybraneZlecenie.rabat + '%' : null],
                    ['13. Kwota minimalna', formatCurrency(wybraneZlecenie.kwota_minimalna)],
                    ['Wartość zlecenia', formatCurrency(wybraneZlecenie.wartosc_planowana)],
                    ['14. Zrębki (m³)', wybraneZlecenie.zrebki],
                    ['15. Drewno', wybraneZlecenie.drzewno]].map(([l, v]) => v && v !== '—' ? (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: '600', color: 'var(--accent)' }}>{v}</span>
                    </div>
                  ) : null)}
                  {wybraneZlecenie.wynik && (
                    <div style={{ marginTop: 10, padding: '8px 10px', backgroundColor: 'var(--surface-field)', borderRadius: 6, fontSize: 13 }}>
                      <strong>10. Wynik:</strong> {wybraneZlecenie.wynik}
                    </div>
                  )}
                </div>
              </div>
              {wybraneZlecenie.notatki && (
                <div style={{ marginTop: 16, padding: '12px 14px', backgroundColor: 'var(--surface-field)', borderRadius: 8, fontSize: 14, borderLeft: '3px solid #F9A825' }}>
                  <strong>Notatki:</strong> {wybraneZlecenie.notatki}
                </div>
              )}
            </div>
          </>
        )}
 
        {/* ══ FORMULARZ NOWY / EDYTUJ ══ */}
        {(tryb === 'nowy' || tryb === 'edytuj') && (
          <>
            <PageHeader
              variant="hero"
              back={{
                onClick: anulujFormularz,
                label: t('common.back'),
              }}
              title={tryb === 'nowy' ? t('common.newOrder') : `${t('common.edit')} #${wybraneZlecenie?.id}`}
              subtitle="Najpierw klient i adres, potem termin, ekipa, zakres, dowody i podsumowanie do przekazania dalej."
              icon={<AssignmentOutlined style={{ fontSize: 26 }} />}
            />

            <div className="zlecenia-form-readiness" style={s.formReadinessGrid}>
              {formReadinessCards.map((item) => (
                <div key={item.key} style={{ ...s.formReadinessCard, ...(s[`formReadinessCard_${item.tone}`] || {}) }}>
                  <span style={s.formReadinessLabel}>{item.label}</span>
                  <strong style={s.formReadinessValue}>{item.value}</strong>
                  <small style={s.formReadinessDetail}>{item.detail}</small>
                </div>
              ))}
            </div>

            <div style={s.formWizardPanel}>
              <div style={s.formWizardHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>Wizard zlecenia</div>
                  <div style={s.formWizardTitle}>{currentFormStep.label}</div>
                  <div style={s.formWizardSubtitle}>{currentFormStep.detail}</div>
                </div>
                <span style={s.formWizardProgress}>{formStepIndex + 1}/{FORM_STEPS.length}</span>
              </div>
              <div style={s.formWizardSteps}>
                {FORM_STEPS.map((step, index) => (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setFormStepSafe(step.key)}
                    style={{
                      ...s.formWizardStep,
                      ...(formStep === step.key ? s.formWizardStepActive : {}),
                      ...(index < formStepIndex ? s.formWizardStepDone : {}),
                    }}
                  >
                    <span style={s.formWizardStepNo}>{index + 1}</span>
                    <span style={s.formWizardStepText}>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div style={s.formFlowPanel}>
                <div style={s.formFlowHeader}>
                  <span>Jedna ścieżka zlecenia</span>
                  <strong>{formWorkflowStage.label}</strong>
                </div>
                <div style={s.formFlowSteps}>
                  {FORM_WORKFLOW_STEPS.map((step, index) => (
                    <div
                      key={step.status}
                      style={{
                        ...s.formFlowStep,
                        ...(index < formWorkflowStageIndex ? s.formFlowStepDone : {}),
                        ...(index === formWorkflowStageIndex ? s.formFlowStepActive : {}),
                      }}
                    >
                      <span style={{ ...s.formFlowStepNo, border: `1px solid ${getStatusColor(step.status)}` }}>{step.step}</span>
                      <span style={s.formFlowStepText}>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {formRepairFocus ? (
                <div style={s.formRepairBanner}>
                  <div>
                    <span style={s.formRepairEyebrow}>Tryb naprawy</span>
                    <strong style={s.formRepairTitle}>{formRepairFocus.label || 'Pole do poprawy'}</strong>
                    <small style={s.formRepairDetail}>
                      {formRepairFocus.detail || `Otworzony krok: ${formRepairStepLabel}. Pole zostalo podswietlone.`}
                    </small>
                    {formRepairFocus.returnTo ? (
                      <small style={s.formRepairDetail}>
                        Po zapisie wrócisz do: {formRepairReturnLabel}.
                      </small>
                    ) : null}
                  </div>
                  <button type="button" style={s.formRepairCloseBtn} onClick={() => setFormRepairFocus(null)}>
                    Zamknij podpowiedz
                  </button>
                </div>
              ) : null}
            </div>
 
            <div style={{ ...s.card, display: formStep === 'client' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Dane klienta</div>
              <div style={s.formGrid}>
                <div style={fgStyle('klient_nazwa')}><label style={s.label}>Nazwa klienta *</label>
                  <input data-repair-field="klient_nazwa" style={inputStyle('klient_nazwa')} placeholder="Imię i nazwisko / firma" value={form.klient_nazwa} onChange={e => setField('klient_nazwa', e.target.value)} /></div>
                <div style={fgStyle('klient_telefon')}><label style={s.label}>Telefon</label>
                  <input data-repair-field="klient_telefon" style={inputStyle('klient_telefon')} placeholder="+48 000 000 000" value={form.klient_telefon} onChange={e => setField('klient_telefon', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Email</label>
                  <input style={s.input} type="email" value={form.klient_email} onChange={e => setField('klient_email', e.target.value)} /></div>
                <div style={fgStyle('adres')}><label style={s.label}>Adres realizacji</label>
                  <input data-repair-field="adres" style={inputStyle('adres')} placeholder="ul. Przykładowa 1" value={form.adres} onChange={e => setField('adres', e.target.value)} /></div>
                <div style={fgStyle('miasto')}><label style={s.label}>Miasto</label>
                  <CityInput
                    data-repair-field="miasto"
                    style={inputStyle('miasto')}
                    placeholder="Warszawa"
                    value={form.miasto}
                    onChange={e => setField('miasto', e.target.value)}
                    extraCities={zlecenia.map((z) => z.miasto)}
                  />
                </div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'planning' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Planowanie</div>
              <div style={s.formGrid}>
                <div style={s.fg}><label style={s.label}>Typ usługi</label>
                  <select style={s.input} value={form.typ_uslugi} onChange={e => setField('typ_uslugi', e.target.value)}>
                    {TASK_SERVICE_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Status</label>
                  <select style={s.input} value={form.status} onChange={e => handleFormStatusChange(e.target.value)}>
                    {formStatusOptions.map((status) => (
                      <option key={status} value={status}>{t(`taskStatus.${status}`, { defaultValue: status })}</option>
                    ))}
                  </select>
                  {tryb !== 'nowy' ? (
                    <small style={s.formStatusHint}>Aktualny etap plus następny dozwolony krok. Reszta jest blokowana przez workflow.</small>
                  ) : null}
                </div>
                <div style={s.fg}><label style={s.label}>Oddział</label>
                  <select
                    style={s.input}
                    value={form.oddzial_id}
                    disabled={!canManageAllBranches && !!currentUser?.oddzial_id}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      oddzial_id: e.target.value,
                      ekipa_id: '',
                      wyceniajacy_id: '',
                    }))}
                  >
                    <option value="">— wybierz oddział —</option>
                    {branchSelectOptions.map((oddzialId) => (
                      <option key={oddzialId} value={oddzialId}>{getBranchLabel(oddzialId)}</option>
                    ))}
                  </select></div>
                <div style={fgStyle('wyceniajacy_id')}><label style={s.label}>Specjalista ds. wyceny / oględziny</label>
                  <select
                    data-repair-field="wyceniajacy_id"
                    style={inputStyle('wyceniajacy_id')}
                    value={form.wyceniajacy_id}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      wyceniajacy_id: e.target.value,
                      status: e.target.value && prev.status === TASK_STATUS.NOWE ? TASK_STATUS.WYCENA_TERENOWA : prev.status,
                    }))}
                  >
                    <option value="">— jeszcze nie przypisano —</option>
                    {estimatorOptions.map((u) => (
                      <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Priorytet</label>
                  <select style={s.input} value={form.priorytet} onChange={e => setField('priorytet', e.target.value)}>
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select></div>
                <div style={fgStyle('data_planowana')}><label style={s.label}>Data planowana</label>
                  <input data-repair-field="data_planowana" style={inputStyle('data_planowana')} type="date" value={form.data_planowana} onChange={e => setField('data_planowana', e.target.value)} /></div>
                <div style={fgStyle('godzina_rozpoczecia')}><label style={s.label}>Godzina startu ekipy</label>
                  <input data-repair-field="godzina_rozpoczecia" style={inputStyle('godzina_rozpoczecia')} type="time" value={form.godzina_rozpoczecia} onChange={e => setField('godzina_rozpoczecia', e.target.value)} /></div>
                <div style={fgStyle('ekipa_id')}><label style={s.label}>Ekipa</label>
                  <select data-repair-field="ekipa_id" style={inputStyle('ekipa_id')} value={form.ekipa_id} onChange={e => setField('ekipa_id', e.target.value)}>
                    <option value="">— brak —</option>
                    {teamOptions.map(e => (
                      <option key={getTeamOptionKey(e)} value={e.id}>{getTeamOptionLabel(e)}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Kierownik</label>
                  <select style={s.input} value={form.kierownik_id} onChange={e => setField('kierownik_id', e.target.value)}>
                    <option value="">— brak —</option>
                    {uzytkownicy.filter(u => u.rola === 'Kierownik' || u.rola === 'Dyrektor').map(u => (
                      <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>
                    ))}
                  </select></div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'work' ? undefined : 'none' }}>
              <div style={s.cardTitle}>1. Opis pracy</div>
              <div style={s.inspectionPresetPanel}>
                <div style={s.inspectionPresetHead}>
                  <strong>Szybki zakres oględzin</strong>
                  <span>Klikasz typ pracy, a system dopisuje ten sam opis dla biura, specjalisty ds. wyceny i ekipy.</span>
                </div>
                <div style={s.inspectionPresetGrid}>
                  {TASK_SCOPE_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      style={{
                        ...s.inspectionChip,
                        ...(form.opis_pracy?.includes(preset.scopeLine) ? s.inspectionChipActive : {}),
                      }}
                      onClick={() => applyScopePreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea data-repair-field="opis_pracy" style={inputStyle('opis_pracy', { minHeight: 80, resize: 'vertical', width: '100%', boxSizing: 'border-box' })}
                placeholder="np. Przycinanie żywopłotu i drzew, usuwanie gałęzi..."
                value={form.opis_pracy} onChange={e => setField('opis_pracy', e.target.value)} />
            </div>
 
            <div style={{ ...s.twoCol, display: formStep === 'work' ? 'grid' : 'none' }}>
              <div style={s.card}>
                <div style={s.cardTitle}>2–5. Logistyka i zasoby</div>
                <TakNie label="2. Wywóz" field="wywoz" form={form} onChange={setField} />
                <TakNie label="3. Usuwanie pni" field="usuwanie_pni" form={form} onChange={setField} />
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={s.fg}><label style={s.label}>4. Czas realizacji (godziny)</label>
                    <input style={s.input} type="number" min="0" step="0.5" placeholder="np. 5"
                      value={form.czas_realizacji_godz} onChange={e => setField('czas_realizacji_godz', e.target.value)} /></div>
                  <div style={s.fg}><label style={s.label}>9. Ilość osób do realizacji</label>
                    <input style={s.input} type="number" min="1" placeholder="np. 3"
                      value={form.ilosc_osob} onChange={e => setField('ilosc_osob', e.target.value)} /></div>
                </div>
                <div data-repair-field="arborysta" style={{ marginTop: 8, ...(isRepairField('arborysta') ? s.formRepairField : {}) }}>
                  <TakNie label="16. Arborysta" field="arborysta" form={form} onChange={setField} />
                </div>
              </div>
 
              <div data-repair-field="sprzet" style={{ ...s.card, ...(isRepairField('sprzet') ? s.formRepairCard : {}) }}>
                <div style={s.cardTitle}>5–8. Cechy pracy / sprzęt</div>
                <div style={s.inspectionPresetGrid}>
                  {TASK_EQUIPMENT_OPTIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      style={{
                        ...s.inspectionChip,
                        ...(form[preset.field] ? s.inspectionChipActive : {}),
                      }}
                      onClick={() => toggleEquipmentPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <TakNie label="6. Rębak" field="rebak" form={form} onChange={setField} />
                <TakNie label="7. Piła na wysięgniku" field="pila_wysiegniku" form={form} onChange={setField} />
                <TakNie label="8. Nożyce długie" field="nozyce_dlugie" form={form} onChange={setField} />
                <TakNie label="17. Kosiarka" field="kosiarka" form={form} onChange={setField} />
                <TakNie label="18. Podkaszarka" field="podkaszarka" form={form} onChange={setField} />
                <TakNie label="19. Łopata" field="lopata" form={form} onChange={setField} />
                <TakNie label="20. Mulczer" field="mulczer" form={form} onChange={setField} />
              </div>
            </div>

            <div style={{ ...s.card, display: formStep === 'work' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Ryzyka BHP / dojazd</div>
              <div style={s.inspectionPresetGrid}>
                {TASK_RISK_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    style={{
                      ...s.inspectionChip,
                      ...(form.notatki?.includes(preset.note) ? s.inspectionChipActive : {}),
                    }}
                    onClick={() => appendRiskPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'finance' ? undefined : 'none' }}>
              <div style={s.cardTitle}>10–15. Wynik i finanse</div>
              <div style={s.inspectionPresetPanel}>
                <div style={s.inspectionPresetHead}>
                  <strong>Warunki rozliczenia</strong>
                  <span>Jedna notatka dla biura i kierownika, żeby później nie zgadywać, co uzgodniono z klientem.</span>
                </div>
                <div style={s.inspectionPresetGrid}>
                  {TASK_SETTLEMENT_OPTIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      style={{
                        ...s.inspectionChip,
                        ...(form.notatki?.includes(preset.note) ? s.inspectionChipActive : {}),
                      }}
                      onClick={() => applySettlementPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={s.formGrid}>
                <div style={{ ...s.fg, gridColumn: '1 / -1' }}><label style={s.label}>10. Wynik rozmowy z klientem</label>
                  <input style={s.input} placeholder="np. Klient zgadza się na wykonanie robót. Trzeba ustalić termin."
                    value={form.wynik} onChange={e => setField('wynik', e.target.value)} /></div>
                <div style={fgStyle('budzet')}><label style={s.label}>11. Budżet (PLN)</label>
                  <input data-repair-field="budzet" style={inputStyle('budzet')} type="number" step="0.01" placeholder="0.00" value={form.budzet} onChange={e => setField('budzet', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>12. Rabat (%)</label>
                  <input style={s.input} type="number" min="0" max="100" step="0.1" placeholder="0" value={form.rabat} onChange={e => setField('rabat', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>13. Kwota minimalna (PLN)</label>
                  <input style={s.input} type="number" step="0.01" placeholder="0.00" value={form.kwota_minimalna} onChange={e => setField('kwota_minimalna', e.target.value)} /></div>
                <div style={fgStyle('wartosc_planowana')}><label style={s.label}>Wartość zlecenia (PLN)</label>
                  <input data-repair-field="wartosc_planowana" style={inputStyle('wartosc_planowana')} type="number" step="0.01" placeholder="0.00" value={form.wartosc_planowana} onChange={e => setField('wartosc_planowana', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>14. Zrębki (m³)</label>
                  <input style={s.input} type="number" min="0" step="0.1" placeholder="0" value={form.zrebki} onChange={e => setField('zrebki', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>15. Drewno</label>
                  <input style={s.input} placeholder="np. 2 mp" value={form.drzewno} onChange={e => setField('drzewno', e.target.value)} /></div>
                <div style={fgStyle('czas_planowany_godziny')}><label style={s.label}>Czas planowany (h)</label>
                  <input data-repair-field="czas_planowany_godziny" style={inputStyle('czas_planowany_godziny')} type="number" step="0.5" placeholder="0" value={form.czas_planowany_godziny} onChange={e => setField('czas_planowany_godziny', e.target.value)} /></div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'finance' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Notatki dodatkowe</div>
              <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                placeholder="Dodatkowe uwagi..." value={form.notatki} onChange={e => setField('notatki', e.target.value)} />
            </div>

            {formStep === 'media' && (
              <TaskPhotosPanel
                styles={s}
                title="Dowody z oględzin dla ekipy i biura"
                subtitle="Zdjęcia, szkice i adnotacje z terenu trafiają prosto do zlecenia."
                taskId={wybraneZlecenie?.id}
                photos={selectedTaskPhotos}
                loading={taskPhotosLoading}
                uploading={uploadingTaskPhoto}
                draft={taskPhotoDraft}
                inputRef={taskPhotoInputRef}
                onDraftChange={setTaskPhotoDraft}
                onPickFiles={uploadTaskPhotos}
                onDraw={openTaskDraw}
                onDelete={mozeEdytowac ? deleteTaskPhoto : null}
                onSaveDraft={zapiszDraftIDodajZdjecia}
                repairFocus={taskPhotoRepairFocus}
                onCloseRepair={() => setTaskPhotoRepairFocus(null)}
              />
            )}

            {formStep === 'summary' && (
              <div style={s.formSummaryGrid}>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>Klient</span>
                  <strong>{form.klient_nazwa || 'Brak nazwy klienta'}</strong>
                  <small>{form.klient_telefon || 'Brak telefonu'}</small>
                  <small>{[form.adres, form.miasto].filter(Boolean).join(', ') || 'Brak adresu realizacji'}</small>
                </div>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>Plan operacyjny</span>
                  <strong>{form.typ_uslugi || 'Typ usługi nieustalony'}</strong>
                  <small>{form.data_planowana ? `Termin: ${form.data_planowana}${form.godzina_rozpoczecia ? ` ${form.godzina_rozpoczecia}` : ''}` : 'Brak terminu'}</small>
                  <small>{formPreviewTask.ekipa_nazwa || 'Brak ekipy'} | {form.ilosc_osob || '0'} os.</small>
                </div>
                <div style={{ ...s.formSummaryCard, ...s[`detailPriceBox_${formPreviewPrice.tone}`] }}>
                  <span style={s.detailDecisionLabel}>Finanse</span>
                  <strong>{formPreviewPrice.label}</strong>
                  <small>Wartość: {formatCurrencyZero(formPreviewMeta.value)}</small>
                  <small>{formPreviewPrice.detail}</small>
                </div>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>BHP i gotowość</span>
                  <strong>{formPreviewSafetyRequired.length ? `${formPreviewSafetyRequired.length} rzeczy do poprawy` : 'Gotowe do zapisu'}</strong>
                  <div style={s.formSummaryChecks}>
                    {formPreviewSafety.slice(0, 5).map((item) => (
                      <span
                        key={item.key}
                        style={{
                          ...s.formSummaryCheck,
                          ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                        }}
                      >
                        {item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}: {item.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>Zdjęcia terenowe</span>
                  <strong>{fieldPhotoCount ? `${fieldPhotoCount} dowodów z wyceny` : 'Brak zdjęć z wyceny'}</strong>
                  <small>{selectedTaskPhotos.length ? `Łącznie zdjęć: ${selectedTaskPhotos.length}` : 'Dodaj zdjęcia lub szkic, żeby ekipa widziała dokładny zakres.'}</small>
                  <button type="button" style={s.taskPhotosBtnSecondary} onClick={() => setFormStepSafe('media')}>
                    Przejdź do zdjęć
                  </button>
                </div>
              </div>
            )}
 
            <div style={s.formWizardActions}>
              <button
                type="button"
                style={{ ...s.btnGray, ...(isFirstFormStep ? s.formWizardBtnDisabled : {}) }}
                onClick={goPrevFormStep}
                disabled={isFirstFormStep}
              >
                Wstecz
              </button>
              {formRepairFocus && tryb === 'edytuj' ? (
                <>
                  <button
                    type="button"
                    style={s.btnPrimary}
                    onClick={() => zapiszZlecenie(formRepairFocus.returnTo ? { returnToRepairSource: true } : { returnToDetails: true })}
                  >
                    {formRepairFocus.returnTo ? `Zapisz i wróć do ${formRepairReturnLabel}` : 'Zapisz poprawkę i wróć do karty'}
                  </button>
                  {formRepairFocus.returnTo ? (
                    <button type="button" style={s.btnGray} onClick={() => zapiszZlecenie({ returnToDetails: true })}>
                      Zapisz i sprawdź kartę
                    </button>
                  ) : null}
                  <button type="button" style={s.btnGray} onClick={() => setFormStepSafe('summary')}>
                    Podsumowanie
                  </button>
                </>
              ) : isLastFormStep ? (
                <button type="button" style={s.btnPrimary} onClick={() => zapiszZlecenie()}>
                  {tryb === 'nowy' ? t('pages.zlecenia.submitCreate') : t('pages.zlecenia.submitSave')}
                </button>
              ) : (
                <button type="button" style={s.btnPrimary} onClick={goNextFormStep}>
                  Dalej
                </button>
              )}
              <button type="button" style={s.btnGray} onClick={anulujFormularz}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
      </main>
    </div>
  );
}
 
const s = {
  main: {
    flex: 1,
    minWidth: 0,
    overflowX: 'hidden',
    position: 'relative',
    maxWidth: 1560,
    width: '100%',
    margin: '0 auto',
    padding: '22px clamp(16px, 2.4vw, 30px) 32px',
  },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14 },
  backBtn: { padding: '6px 14px', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid #A5D6A7', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  filtryRow: {
    display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center',
    background:
      'linear-gradient(90deg, rgba(15,107,63,0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(15,107,63,0.035) 1px, transparent 1px), linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,249,244,0.94))',
    backgroundSize: '32px 32px, 32px 32px, auto',
    padding: '13px 14px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.14)',
    boxShadow: '0 12px 30px rgba(31,79,50,0.07)', flexWrap: 'wrap'
  },
  searchInput: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, minWidth: 220, flex: 1, backgroundColor: 'var(--surface-field)' },
  filtrInput: { padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  clearBtn: { padding: '8px 13px', backgroundColor: 'rgba(248,113,113,0.12)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  countBadge: { fontSize: 12, color: 'var(--accent)', marginLeft: 'auto', whiteSpace: 'nowrap', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', backgroundColor: 'var(--accent-surface)', fontWeight: 900 },
  decisionBand: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
    alignItems: 'stretch',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--surface-glass), var(--accent-surface))',
    padding: 14,
    marginBottom: 12,
    boxShadow: 'var(--shadow-sm)',
  },
  decisionBand_green: {
    border: '1px solid rgba(22,138,74,0.28)',
    boxShadow: 'inset 4px 0 0 var(--accent), var(--shadow-sm)',
  },
  decisionBand_warning: {
    border: '1px solid rgba(199,119,0,0.34)',
    background: 'linear-gradient(135deg, rgba(251,191,36,0.12), var(--surface-glass))',
    boxShadow: 'inset 4px 0 0 var(--warning), var(--shadow-sm)',
  },
  decisionBand_danger: {
    border: '1px solid rgba(220,38,38,0.32)',
    background: 'linear-gradient(135deg, rgba(248,113,113,0.11), var(--surface-glass))',
    boxShadow: 'inset 4px 0 0 var(--danger), var(--shadow-sm)',
  },
  decisionLead: {
    minWidth: 0,
    display: 'grid',
    alignContent: 'center',
    gap: 4,
  },
  decisionEyebrow: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0,
    lineHeight: 1.2,
  },
  decisionTitle: {
    color: 'var(--text)',
    fontSize: 18,
    fontWeight: 950,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  decisionText: {
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 760,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  decisionKpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
    gap: 8,
  },
  decisionKpi: {
    minWidth: 0,
    minHeight: 76,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.62)',
    padding: '9px 10px',
    display: 'grid',
    alignContent: 'center',
    gap: 3,
  },
  decisionKpiLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.15,
  },
  decisionKpiValue: {
    color: 'var(--text)',
    fontSize: 19,
    fontWeight: 950,
    lineHeight: 1.05,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  decisionKpiHint: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 780,
    lineHeight: 1.2,
  },
  decisionActions: {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gap: 8,
    minWidth: 0,
  },
  decisionPrimaryBtn: {
    width: '100%',
    minHeight: 40,
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent)',
    color: '#fff',
    padding: '9px 12px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 950,
    fontFamily: 'inherit',
    boxShadow: '0 10px 22px rgba(15,95,58,0.18)',
  },
  decisionQuickActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
    gap: 7,
  },
  decisionQuickBtn: {
    minWidth: 0,
    minHeight: 48,
    border: '1px solid rgba(22,138,74,0.18)',
    borderRadius: 8,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(240,247,242,0.72))',
    color: 'var(--text)',
    padding: '7px 8px',
    cursor: 'pointer',
    display: 'grid',
    gap: 2,
    alignContent: 'center',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  decisionQuickBtnActive: {
    border: '1px solid var(--accent)',
    background: 'linear-gradient(180deg, var(--accent-surface), rgba(255,255,255,0.78))',
    color: 'var(--accent)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  decisionQuickBtnSpan: {
    color: 'inherit',
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  decisionQuickBtnStrong: {
    color: 'inherit',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  commandPanel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--surface-glass), var(--surface-field))',
    backgroundImage: 'linear-gradient(135deg, var(--surface-glass), var(--surface-field)), repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 22px)',
    padding: 16,
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
    overflow: 'hidden',
  },
  commandHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  commandEyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  commandTitle: {
    marginTop: 3,
    fontSize: 16,
    color: 'var(--text)',
    fontWeight: 900,
    lineHeight: 1.25,
  },
  commandActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  commandStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  commandStat: {
    display: 'grid',
    gap: 8,
    padding: '10px 11px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'linear-gradient(180deg, var(--surface-field), rgba(255,255,255,0.015))',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  commandStatStrong: {
    color: 'var(--text)',
    fontSize: 20,
    lineHeight: 1,
    fontWeight: 950,
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  quickCallPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(34,197,94,0.11), var(--glass-bg))',
    padding: 12,
    marginBottom: 12,
    boxShadow: 'var(--shadow-sm)',
    scrollMarginTop: 18,
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
  },
  quickCallPanelFocused: {
    border: '1px solid var(--accent)',
    background: 'linear-gradient(135deg, rgba(34,197,94,0.2), var(--glass-bg-strong))',
    boxShadow: '0 0 0 3px rgba(34,197,94,0.18), var(--shadow-md)',
  },
  quickCallHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  quickCallTitle: {
    color: 'var(--text)',
    fontSize: 15,
    fontWeight: 950,
    marginTop: 2,
    lineHeight: 1.25,
  },
  quickCallStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 30,
    border: '1px solid rgba(52,211,153,0.35)',
    borderRadius: 8,
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 950,
  },
  quickCallProgressPanel: {
    border: '1px solid rgba(20,131,79,0.18)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(255,255,255,0.82), rgba(229,246,236,0.68))',
    padding: '10px 11px',
    marginBottom: 10,
    display: 'grid',
    gap: 8,
  },
  quickCallProgressHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
  },
  quickCallProgressLabel: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    lineHeight: 1.15,
    textTransform: 'uppercase',
  },
  quickCallProgressValue: {
    display: 'block',
    marginTop: 2,
    color: 'var(--text)',
    fontSize: 15,
    fontWeight: 950,
    lineHeight: 1.15,
  },
  quickCallProgressReady: {
    minHeight: 28,
    border: '1px solid rgba(20,131,79,0.22)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900,
    display: 'inline-flex',
    alignItems: 'center',
  },
  quickCallProgressMissing: {
    minHeight: 28,
    border: '1px solid rgba(199,119,0,0.28)',
    borderRadius: 8,
    background: 'rgba(251,191,36,0.1)',
    color: 'var(--warning)',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900,
    display: 'inline-flex',
    alignItems: 'center',
  },
  quickCallProgressTrack: {
    height: 8,
    borderRadius: 8,
    background: 'rgba(20,131,79,0.1)',
    overflow: 'hidden',
  },
  quickCallProgressFill: {
    display: 'block',
    height: '100%',
    borderRadius: 8,
    background: 'linear-gradient(90deg, var(--accent), #2FBF71)',
    transition: 'width 0.2s ease',
  },
  quickCallStepGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 7,
  },
  quickCallStep: {
    minWidth: 0,
    minHeight: 54,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.74)',
    color: 'var(--text)',
    padding: '8px 9px',
    display: 'grid',
    gridTemplateColumns: '22px minmax(0, 1fr)',
    gap: 7,
    alignItems: 'center',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  quickCallStepReady: {
    border: '1px solid rgba(20,131,79,0.22)',
    background: 'rgba(34,197,94,0.08)',
  },
  quickCallStepMissing: {
    border: '1px solid rgba(199,119,0,0.26)',
    background: 'rgba(251,191,36,0.08)',
  },
  quickCallStepDot: {
    width: 22,
    height: 22,
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
  },
  quickCallStepBody: {
    minWidth: 0,
    display: 'grid',
    gap: 2,
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.2,
  },
  quickCallGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
  },
  quickCallPackagePanel: {
    border: '1px solid rgba(20,131,79,0.18)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(229,246,236,0.66))',
    padding: 10,
    marginTop: 10,
    display: 'grid',
    gap: 9,
  },
  quickCallPackageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
  },
  quickCallPackageTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
    lineHeight: 1.25,
    marginTop: 2,
  },
  quickCallPackageStatusReady: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    border: '1px solid rgba(20,131,79,0.24)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 950,
  },
  quickCallPackageStatusMissing: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    border: '1px solid rgba(199,119,0,0.28)',
    borderRadius: 8,
    background: 'rgba(251,191,36,0.1)',
    color: 'var(--warning)',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 950,
  },
  quickCallPackageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 135px), 1fr))',
    gap: 7,
  },
  quickCallPackageItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.76)',
    padding: '8px 9px',
    minHeight: 76,
    display: 'grid',
    gap: 4,
    minWidth: 0,
    color: 'var(--text)',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
    appearance: 'none',
  },
  quickCallPackageItemReady: {
    border: '1px solid rgba(20,131,79,0.22)',
    background: 'rgba(34,197,94,0.08)',
  },
  quickCallPackageItemMissing: {
    border: '1px solid rgba(199,119,0,0.26)',
    background: 'rgba(251,191,36,0.08)',
  },
  quickCallPackageTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  quickCallPackageDot: {
    width: 22,
    height: 22,
    borderRadius: 8,
    display: 'inline-grid',
    placeItems: 'center',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 950,
  },
  quickCallPackageDotReady: {
    background: 'rgba(34,197,94,0.14)',
    color: 'var(--accent)',
  },
  quickCallPackageDotMissing: {
    background: 'rgba(251,191,36,0.14)',
    color: 'var(--warning)',
  },
  quickCallPackageLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.15,
  },
  quickCallPackageValue: {
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.25,
    fontWeight: 920,
    overflowWrap: 'anywhere',
  },
  quickCallPackageHint: {
    color: 'var(--text-muted)',
    fontSize: 10,
    lineHeight: 1.2,
    fontWeight: 800,
  },
  quickCallTaskStrip: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap',
  },
  quickCallTaskChip: {
    border: '1px solid rgba(52,211,153,0.24)',
    borderRadius: 8,
    background: 'rgba(52,211,153,0.08)',
    color: 'var(--accent)',
    padding: '5px 7px',
    fontSize: 10,
    lineHeight: 1.15,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  quickCallSchedulePanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 10,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    padding: 10,
  },
  quickCallSchedulePanel_success: {
    border: '1px solid rgba(22,138,74,0.24)',
    background: 'rgba(22,138,74,0.06)',
  },
  quickCallSchedulePanel_warning: {
    border: '1px solid rgba(199,119,0,0.3)',
    background: 'rgba(199,119,0,0.08)',
  },
  quickCallSchedulePanel_danger: {
    border: '1px solid rgba(220,38,38,0.3)',
    background: 'rgba(220,38,38,0.08)',
  },
  quickCallSchedulePanel_info: {
    border: '1px solid rgba(14,116,144,0.24)',
    background: 'rgba(14,116,144,0.06)',
  },
  quickCallScheduleMain: {
    display: 'grid',
    gap: 3,
    minWidth: 0,
  },
  quickCallScheduleTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  quickCallScheduleDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  quickCallScheduleSide: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 6,
    maxWidth: '100%',
  },
  quickCallScheduleItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.5)',
    color: 'var(--text-sub)',
    padding: '5px 7px',
    fontSize: 10,
    lineHeight: 1.2,
    fontWeight: 850,
  },
  quickCallScheduleFixBtn: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent)',
    color: '#fff',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900,
    cursor: 'pointer',
  },
  quickCallFieldHint: {
    marginTop: 6,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  quickCallFieldHintDanger: {
    marginTop: 6,
    color: 'var(--danger)',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.35,
  },
  quickCallFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 750,
  },
  quickCallFooterText: {
    flex: '1 1 280px',
    minWidth: 0,
    display: 'grid',
    gap: 3,
    lineHeight: 1.35,
  },
  quickCallMissing: {
    color: 'var(--danger)',
    fontWeight: 950,
  },
  quickCallReady: {
    color: 'var(--accent)',
    fontWeight: 950,
  },
  quickCallFooterHint: {
    color: 'var(--text-muted)',
    fontWeight: 750,
  },
  quickCallActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  workflowLanePanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(30,111,74,0.14), var(--glass-bg))',
    padding: 12,
    marginBottom: 12,
    boxShadow: 'var(--shadow-sm)',
  },
  workflowLaneHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  workflowLaneTitle: {
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 950,
    marginTop: 2,
  },
  workflowLaneHint: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
    maxWidth: 260,
    lineHeight: 1.35,
  },
  workflowHealthStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  workflowHealthItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: '9px 10px',
    display: 'grid',
    gap: 3,
    minHeight: 72,
  },
  workflowHealthItemWarn: {
    border: '1px solid rgba(242,184,75,0.34)',
    background: 'rgba(251,191,36,0.09)',
  },
  workflowHealthLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  workflowHealthValue: {
    color: 'var(--text)',
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
  },
  workflowHealthDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 760,
    lineHeight: 1.25,
  },
  advancedOpsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: '10px 12px',
    marginBottom: 12,
  },
  advancedOpsTitle: {
    display: 'block',
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
  },
  advancedOpsText: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 720,
    lineHeight: 1.35,
    marginTop: 2,
  },
  activeFilterBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--text)',
    padding: '9px 11px',
    marginBottom: 12,
    fontSize: 12,
    fontWeight: 850,
  },
  dailyOpsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  dailyOpsCard: {
    position: 'relative',
    minHeight: 104,
    border: '1px solid var(--glass-border)',
    borderLeft: '5px solid var(--accent)',
    borderRadius: 8,
    background: 'linear-gradient(180deg, #ffffff, rgba(246,251,247,0.9))',
    color: 'var(--text)',
    padding: '12px 12px 11px 14px',
    display: 'grid',
    alignContent: 'space-between',
    gap: 5,
    textAlign: 'left',
    boxShadow: 'var(--shadow-sm)',
    fontFamily: 'inherit',
    overflow: 'hidden',
  },
  dailyOpsCard_green: { borderLeftColor: 'var(--accent)' },
  dailyOpsCard_blue: { borderLeftColor: 'var(--info)' },
  dailyOpsCard_warning: { borderLeftColor: 'var(--warning)' },
  dailyOpsCard_danger: { borderLeftColor: 'var(--danger)' },
  dailyOpsCardActive: {
    borderColor: 'rgba(15,107,63,0.42)',
    boxShadow: '0 0 0 3px rgba(15,107,63,0.12), var(--shadow-md)',
    background: 'linear-gradient(180deg, var(--accent-surface), #ffffff)',
  },
  dailyOpsAccent: {
    position: 'absolute',
    inset: 'auto 10px 10px auto',
    width: 36,
    height: 36,
    borderRadius: 8,
    background: 'rgba(15,107,63,0.07)',
  },
  dailyOpsLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    lineHeight: 1.1,
    textTransform: 'uppercase',
  },
  dailyOpsValue: {
    color: 'var(--text)',
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  dailyOpsDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.25,
    fontWeight: 800,
  },
  opsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  opsCard: {
    minHeight: 92,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '10px 11px',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 5,
    boxShadow: 'var(--shadow-sm)',
  },
  opsCard_green: { border: '1px solid rgba(120,242,173,0.24)' },
  opsCard_blue: { border: '1px solid rgba(91,192,235,0.24)' },
  opsCard_warning: { border: '1px solid rgba(242,184,75,0.32)' },
  opsCard_danger: { border: '1px solid rgba(248,113,113,0.34)' },
  opsCardLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.15,
  },
  opsCardValue: {
    color: 'var(--text)',
    fontSize: 20,
    fontWeight: 950,
    lineHeight: 1.05,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  opsCardDetail: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.25,
  },
  dispatchReadinessStrip: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(30,111,74,0.12), var(--glass-bg))',
    padding: '11px 12px',
    marginBottom: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 12,
    alignItems: 'center',
  },
  dispatchReadinessEyebrow: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  dispatchReadinessTitle: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  dispatchReadinessItems: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
    gap: 7,
  },
  dispatchReadinessItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '8px 9px',
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
    minHeight: 54,
  },
  dispatchReadinessItemActive: {
    border: '1px solid var(--accent)',
    boxShadow: '0 0 0 2px rgba(48,128,86,0.12)',
  },
  dispatchReadinessItemBlocked: {
    border: '1px solid rgba(242,184,75,0.38)',
    backgroundColor: 'rgba(251,191,36,0.1)',
  },
  dispatchReadinessLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  dispatchReadinessCount: {
    color: 'var(--text)',
    fontSize: 18,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
  },
  dispatchReadinessHint: {
    gridColumn: '1 / -1',
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 800,
    overflowWrap: 'anywhere',
  },
  savedViews: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  savedViewBtn: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '10px 11px',
    cursor: 'pointer',
    minHeight: 62,
  },
  savedViewBtnActive: {
    border: '1px solid var(--accent)',
    background: 'linear-gradient(90deg, var(--accent-surface), rgba(255,255,255,0.82))',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  savedViewLabel: { fontSize: 13, fontWeight: 800 },
  savedViewMeta: { fontSize: 11, color: 'var(--text-muted)' },
  savedViewFoot: {
    gridColumn: 1,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.2,
  },
  savedViewOk: { color: 'var(--accent)' },
  savedViewWarn: { color: 'var(--warning)' },
  savedViewCount: {
    gridRow: '1 / 4',
    gridColumn: 2,
    minWidth: 28,
    height: 28,
    borderRadius: 8,
    background: 'var(--surface-glass)',
    border: '1px solid var(--border)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  commandTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  commandTab: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '9px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'grid',
    gap: 2,
    fontFamily: 'inherit',
  },
  commandTabActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-surface)',
    color: 'var(--text)',
  },
  commandTabLabel: { fontSize: 13, fontWeight: 850 },
  commandTabDetail: { fontSize: 11, fontWeight: 650, color: 'var(--text-muted)' },
  dispatchPanel: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  dispatchHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  dispatchEyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  dispatchTitle: {
    marginTop: 3,
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 800,
  },
  sortTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
    gap: 8,
    flex: '1 1 560px',
    maxWidth: 720,
  },
  sortTab: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    alignItems: 'flex-start',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '7px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'left',
  },
  sortTabActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
  },
  sortTabLabel: { fontSize: 12, fontWeight: 900, lineHeight: 1.2 },
  sortTabDetail: { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.2 },
  queueList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 8,
  },
  queueItem: {
    display: 'grid',
    gridTemplateColumns: '34px 1fr auto',
    gap: 9,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '8px 9px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  queueRank: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--surface-glass)',
    border: '1px solid var(--border)',
    color: 'var(--accent)',
    fontSize: 13,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  queueBody: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  queueTitle: { fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  queueMeta: { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  queueValue: { fontSize: 12, color: 'var(--accent)', fontWeight: 900, whiteSpace: 'nowrap' },
  queueEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '12px 10px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  manifestBar: {
    marginTop: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: '8px 10px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  manifestBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  },
  businessGuardPanel: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  businessGuardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  businessHealth: {
    minHeight: 28,
    borderRadius: 8,
    padding: '5px 10px',
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
  },
  businessHealth_good: {
    color: '#34D399',
    border: '1px solid rgba(52,211,153,0.28)',
    background: 'rgba(52,211,153,0.09)',
  },
  businessHealth_warning: {
    color: '#F9A825',
    border: '1px solid rgba(249,168,37,0.32)',
    background: 'rgba(249,168,37,0.1)',
  },
  businessHealth_danger: {
    color: '#EF5350',
    border: '1px solid rgba(239,83,80,0.32)',
    background: 'rgba(239,83,80,0.1)',
  },
  businessKpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  businessKpi: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 82,
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 4,
  },
  businessKpiStatic: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 82,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 4,
  },
  businessKpiLabel: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    textTransform: 'uppercase',
    lineHeight: 1.2,
  },
  businessKpiValue: {
    color: 'var(--accent)',
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  businessKpiHint: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  businessSignalRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  businessSignal: {
    borderRadius: 8,
    padding: '7px 9px',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 800,
  },
  businessSignalActive: {
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text)',
    cursor: 'pointer',
  },
  businessSignalDisabled: {
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'default',
    opacity: 0.66,
  },
  businessRiskList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 8,
  },
  businessRiskItem: {
    display: 'grid',
    gridTemplateColumns: '1fr 34px auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '8px 9px',
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
  },
  businessRiskMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  businessRiskTitle: {
    fontSize: 13,
    fontWeight: 850,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  businessRiskFlags: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  businessRiskScore: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid rgba(239,83,80,0.28)',
    background: 'rgba(239,83,80,0.1)',
    color: '#EF5350',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  businessRiskValue: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  businessRiskEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '12px 10px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  closureAuditPanel: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  closureAuditHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  closureAuditKpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  closureAuditKpi: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 4,
  },
  closureAuditColumns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  closureAuditBox: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: 10,
    minWidth: 0,
  },
  closureAuditBoxTitle: {
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  closureAuditIssue: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr 28px auto',
    gap: 8,
    alignItems: 'center',
    border: 'none',
    borderTop: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    paddingTop: 8,
    marginTop: 8,
    minWidth: 0,
    cursor: 'pointer',
    textAlign: 'left',
  },
  closureAuditIssueActive: {
    backgroundColor: 'var(--accent-surface)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
    paddingLeft: 8,
    paddingRight: 6,
    borderRadius: 8,
  },
  closureAuditActor: {
    display: 'grid',
    gridTemplateColumns: '1fr 28px',
    gap: 8,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    marginTop: 8,
    minWidth: 0,
  },
  closureAuditIssueBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  closureAuditCount: {
    width: 26,
    height: 26,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-glass)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  closureAuditValue: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  closureRepairPanel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: 10,
    marginBottom: 8,
  },
  closureRepairHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  closureRepairTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  closureRepairClear: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
  },
  closureRepairList: {
    display: 'grid',
    gap: 7,
  },
  closureRepairItem: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: '8px 9px',
    minWidth: 0,
  },
  closureRepairScore: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid rgba(239,83,80,0.28)',
    backgroundColor: 'rgba(239,83,80,0.1)',
    color: '#EF5350',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  closureRepairBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  closureRepairValue: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  closureRepairActions: {
    gridColumn: '2 / -1',
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  closureRepairBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--accent)',
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 850,
  },
  closureRepairBtnPrimary: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 900,
  },
  closureAuditEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '10px 9px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  closureAuditRecent: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: 10,
  },
  closureAuditEvent: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '12px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '8px 9px',
    marginTop: 6,
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
    outline: 'none',
  },
  closureAuditEventBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  closureAuditEventMeta: {
    gridColumn: '2',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.3,
    overflowWrap: 'anywhere',
  },
  smartFilterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
    padding: '11px 12px',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
  },
  smartFilterTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    marginRight: 4,
  },
  smartFilterChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  smartFilterChipActive: {
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
    background: 'linear-gradient(90deg, var(--accent-surface), rgba(255,255,255,0.82))',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  smartFilterCount: {
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    borderRadius: 8,
    background: 'rgba(20,131,79,0.1)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
  },
  card: {
    background: '#ffffff',
    borderRadius: 8, padding: 20, border: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-sm)', marginBottom: 16
  },
  cardTitle: { fontSize: 14, fontWeight: 950, color: 'var(--text)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: 0 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 0 },
  formReadinessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  formReadinessCard: {
    minHeight: 92,
    border: '1px solid var(--glass-border)',
    borderLeft: '5px solid var(--accent)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: 'var(--shadow-sm)',
    padding: '11px 12px',
    display: 'grid',
    alignContent: 'space-between',
    gap: 5,
    minWidth: 0,
  },
  formReadinessCard_good: { borderLeftColor: 'var(--accent)' },
  formReadinessCard_warning: { borderLeftColor: 'var(--warning)', background: 'linear-gradient(180deg, #ffffff, rgba(255,251,235,0.78))' },
  formReadinessCard_danger: { borderLeftColor: 'var(--danger)', background: 'linear-gradient(180deg, #ffffff, rgba(254,242,242,0.78))' },
  formReadinessLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  formReadinessValue: {
    color: 'var(--text)',
    fontSize: 17,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  formReadinessDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.25,
    fontWeight: 780,
    overflowWrap: 'anywhere',
  },
  formWizardPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: 'var(--shadow-md)',
    padding: 16,
    marginBottom: 14,
  },
  formWizardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  formWizardTitle: {
    color: 'var(--text)',
    fontSize: 20,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  formWizardSubtitle: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    marginTop: 3,
  },
  formWizardProgress: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    height: 32,
    padding: '0 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  formWizardSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
  },
  formWizardStep: {
    minHeight: 58,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    color: 'var(--text-sub)',
    padding: '8px 9px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    textAlign: 'left',
  },
  formWizardStepActive: {
    border: '1px solid rgba(15,107,63,0.35)',
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--text)',
    boxShadow: 'inset 4px 0 0 var(--accent)',
  },
  formWizardStepDone: {
    border: '1px solid rgba(76,175,80,0.24)',
  },
  formWizardStepNo: {
    flex: '0 0 auto',
    width: 28,
    height: 28,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  formWizardStepText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    lineHeight: 1.2,
    fontSize: 12,
  },
  formFlowPanel: {
    marginTop: 12,
    padding: 12,
    border: '1px solid rgba(15,107,63,0.18)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(240,247,242,0.96), #ffffff)',
  },
  formFlowHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 850,
    textTransform: 'uppercase',
  },
  formFlowSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  formFlowStep: {
    minHeight: 66,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text-muted)',
    padding: '9px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },
  formFlowStepActive: {
    border: '1px solid rgba(52,211,153,0.42)',
    backgroundColor: 'rgba(52,211,153,0.1)',
    color: 'var(--text)',
  },
  formFlowStepDone: {
    color: 'var(--text-sub)',
    opacity: 0.82,
  },
  formFlowStepNo: {
    flex: '0 0 auto',
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  formFlowStepText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    lineHeight: 1.25,
    fontSize: 12,
  },
  formRepairBanner: {
    marginTop: 12,
    border: '1px solid rgba(249,168,37,0.36)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(249,168,37,0.12), var(--surface-field))',
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center',
  },
  formRepairEyebrow: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    lineHeight: 1.1,
    textTransform: 'uppercase',
  },
  formRepairTitle: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  formRepairDetail: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text-sub)',
    fontSize: 12,
    lineHeight: 1.3,
    fontWeight: 720,
    overflowWrap: 'anywhere',
  },
  formRepairCloseBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    padding: '8px 10px',
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 900,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  formRepairField: {
    border: '1px solid rgba(249,168,37,0.42)',
    borderRadius: 8,
    background: 'rgba(249,168,37,0.08)',
    padding: 8,
    boxShadow: 'inset 3px 0 0 rgba(249,168,37,0.8)',
  },
  formRepairCard: {
    border: '1px solid rgba(249,168,37,0.42)',
    boxShadow: 'inset 3px 0 0 rgba(249,168,37,0.8), var(--shadow-sm)',
  },
  inspectionPresetPanel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: 10,
    marginBottom: 10,
  },
  inspectionPresetHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    color: 'var(--text-sub)',
    fontSize: 12,
    marginBottom: 8,
  },
  inspectionPresetGrid: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 8,
  },
  inspectionChip: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    minHeight: 36,
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
    fontFamily: 'inherit',
  },
  inspectionChipActive: {
    border: '1px solid var(--accent)',
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  formWizardActions: {
    display: 'flex',
    gap: 12,
    marginTop: 8,
    flexWrap: 'wrap',
    paddingBottom: 40,
    alignItems: 'center',
  },
  formWizardBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  formSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  formSummaryCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    padding: 14,
    minHeight: 130,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    color: 'var(--text-sub)',
    boxShadow: 'var(--shadow-sm)',
  },
  formSummaryChecks: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 3,
  },
  formSummaryCheck: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-sub)',
    lineHeight: 1.25,
  },
  taskPhotosPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    boxShadow: 'var(--shadow-md)',
    padding: 14,
    marginBottom: 16,
  },
  taskPhotosHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  taskPhotosTitle: {
    color: 'var(--text)',
    fontSize: 17,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  taskPhotosSubtitle: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    marginTop: 4,
    lineHeight: 1.35,
  },
  taskPhotosCount: {
    minWidth: 38,
    height: 30,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  taskPhotosRepairBanner: {
    border: '1px solid rgba(249,168,37,0.36)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(249,168,37,0.12), var(--surface-field))',
    padding: 12,
    marginBottom: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center',
  },
  taskPhotosToolbar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  taskPhotosSelect: {
    padding: '9px 10px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text)',
    fontSize: 12,
    minWidth: 0,
  },
  taskPhotosInput: {
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text)',
    fontSize: 12,
    minWidth: 0,
  },
  taskPhotosInputSmall: {
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text)',
    fontSize: 12,
    minWidth: 0,
  },
  taskPhotosBtn: {
    border: '1px solid rgba(52,211,153,0.32)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.12)',
    color: 'var(--accent)',
    padding: '9px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  taskPhotosBtnSecondary: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '9px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
    whiteSpace: 'nowrap',
  },
  taskPhotosHint: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text-muted)',
    padding: '8px 10px',
    fontSize: 12,
    lineHeight: 1.35,
    marginBottom: 10,
  },
  taskPhotosDraftBox: {
    border: '1px solid rgba(249,168,37,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(249,168,37,0.08)',
    padding: 12,
    color: 'var(--text-sub)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 1.35,
  },
  taskPhotosEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.74)',
    padding: 18,
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  taskPhotosGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
  },
  taskPhotoCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    padding: 8,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  taskPhotoImageLink: {
    display: 'block',
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#EAF5EE',
    aspectRatio: '4 / 3',
  },
  taskPhotoImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  taskPhotoMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.2,
  },
  taskPhotoOpis: {
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  taskPhotoTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  taskPhotoTag: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '2px 7px',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 800,
  },
  taskPhotoDelete: {
    marginTop: 'auto',
    alignSelf: 'flex-start',
    border: '1px solid rgba(248,113,113,0.32)',
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.1)',
    color: 'var(--danger)',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
  },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 700 },
  thCheck: { padding: '12px 8px', backgroundColor: 'var(--surface-field)', width: 28 },
  th: { padding: '12px 14px', backgroundColor: 'var(--surface-field)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11, fontFamily: 'var(--font-sans)', fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' },
  tdCheck: { padding: '12px 8px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-sans)' },
  idBadge: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent)', padding: '3px 9px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.2)', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: '800' },
  badge: { padding: '4px 10px', borderRadius: 8, color: 'var(--accent)', backgroundColor: 'var(--accent-surface)', border: '1px solid rgba(20,131,79,0.2)', fontSize: 11, fontFamily: 'var(--font-sans)', fontWeight: '800', display: 'inline-block', textTransform: 'uppercase', letterSpacing: 0 },
  akcjeRow: { display: 'flex', gap: 6 },
  btnSm: { padding: '6px 9px', backgroundColor: 'rgba(20,131,79,0.08)', color: 'var(--accent)', border: '1px solid rgba(20,131,79,0.26)', borderRadius: 10, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { padding: '10px 20px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.24)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: '900', boxShadow: 'var(--shadow-sm)', textTransform: 'none', letterSpacing: 0 },
  btnSecondary: {
    padding: '8px 16px',
    backgroundColor: 'rgba(20,131,79,0.08)',
    color: 'var(--accent)',
    border: '1px solid rgba(20,131,79,0.26)',
    borderRadius: 12,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '800',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGray: { padding: '10px 20px', backgroundColor: 'var(--surface-field)', color: 'var(--text-sub)', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', fontSize: 14 },
  btnDanger: { padding: '10px 20px', backgroundColor: 'var(--danger)', color: '#fff', border: '1px solid var(--danger)', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: '800' },
  detailRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 },
  detailLabel: { fontSize: 13, color: 'var(--text-muted)', minWidth: 130 },
  detailValue: { fontSize: 13, color: 'var(--text)', fontWeight: '500', textAlign: 'right' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  fg: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--surface-field)', color: 'var(--text)', outline: 'none' },
  inputRepairFocus: { border: '1px solid rgba(249,168,37,0.82)', boxShadow: '0 0 0 3px rgba(249,168,37,0.16)' },
  inputDanger: { border: '1px solid var(--danger)', boxShadow: '0 0 0 3px rgba(239,68,68,0.14)' },
  komunikat: { padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 14, fontWeight: '500' },
  copyFallback: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    marginBottom: 12,
  },
  copyFallbackHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  copyFallbackEyebrow: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  copyFallbackTitle: {
    marginTop: 3,
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 800,
  },
  copyFallbackText: {
    width: '100%',
    minHeight: 160,
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text)',
    padding: 10,
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  bulkBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    flexWrap: 'wrap',
  },
  bulkInfo: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  bulkBtn: {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-field)',
    color: 'var(--accent)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  },
  bulkBtnSecondary: {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    backgroundColor: 'transparent',
    color: 'var(--text-sub)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  slaWrap: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  slaBadge: {
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    backgroundColor: 'rgba(248,113,113,0.18)',
    color: '#C62828',
    border: '1px solid rgba(248,113,113,0.25)',
  },
  slaOk: {
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    backgroundColor: 'rgba(52,211,153,0.18)',
    color: 'var(--accent)',
    border: '1px solid rgba(52,211,153,0.25)',
  },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 16 },
  kpiWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  kpiItem: {
    background: 'linear-gradient(180deg, var(--surface-glass), var(--surface-field))',
    borderRadius: 8,
    border: '1px solid var(--glass-border)',
    borderTop: '3px solid var(--accent)',
    padding: '11px 12px',
    boxShadow: 'var(--shadow-sm)',
  },
  kpiTitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  kpiCount: {
    marginTop: 4,
    fontSize: 20,
    color: 'var(--text)',
    fontWeight: 800,
  },
  kpiValue: {
    marginTop: 2,
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  workflowPanel: {
    background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
  },
  workflowTitle: {
    gridColumn: '1 / -1',
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  workflowOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-sub)',
  },
  workflowPresets: {
    gridColumn: '1 / -1',
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  workflowPresetBtn: {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text-sub)',
    borderRadius: 8,
    fontSize: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  kanbanWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    alignItems: 'start',
    marginBottom: 20,
  },
  kanbanCol: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-sm)',
  },
  kanbanColHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 10px 8px',
    borderBottom: '1px solid var(--border)',
  },
  kanbanCount: {
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  kanbanColBody: {
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  kanbanEmpty: {
    fontSize: 12,
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '20px 8px',
    border: '1px dashed var(--border)',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.58)',
  },
  kanbanCard: {
    border: '1px solid var(--border)',
    borderRadius: 14,
    background: '#fff',
    padding: 10,
    transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
  },
  kanbanCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 4,
  },
  kanbanCardMeta: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginBottom: 3,
  },
  kanbanDiagnostics: {
    marginTop: 7,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    padding: '5px 7px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
  },
  kanbanCardFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  kanbanActions: {
    marginTop: 8,
    display: 'flex',
    gap: 6,
    justifyContent: 'flex-end',
  },
  kanbanActionBtn: {
    border: '1px solid rgba(20,131,79,0.26)',
    borderRadius: 10,
    minWidth: 30,
    minHeight: 28,
    padding: '4px 8px',
    fontSize: 12,
    backgroundColor: 'rgba(20,131,79,0.08)',
    color: 'var(--accent)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kanbanValue: {
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: 'var(--surface-glass)', borderRadius: 8, border: '1px solid var(--border)', padding: 32, maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: 'var(--shadow-lg)' },
  closeGuardModal: {
    backgroundColor: 'var(--surface-glass)',
    borderRadius: 8,
    border: '1px solid var(--border)',
    padding: 18,
    maxWidth: 680,
    width: 'min(92vw, 680px)',
    maxHeight: '88vh',
    overflowY: 'auto',
    boxShadow: 'var(--shadow-lg)',
  },
  closeGuardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  closeGuardTitle: {
    margin: '3px 0 0',
    color: 'var(--text)',
    fontSize: 20,
    fontWeight: 900,
  },
  closeGuardLead: {
    margin: '0 0 12px',
    color: 'var(--text-sub)',
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650,
  },
  closeGuardMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  closeGuardSection: {
    display: 'grid',
    gap: 7,
    marginTop: 10,
  },
  closeGuardSectionTitle: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  closeGuardItem: {
    border: '1px solid rgba(249,168,37,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(249,168,37,0.08)',
    color: 'var(--text)',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 12,
    lineHeight: 1.35,
  },
  closeGuardItemDanger: {
    border: '1px solid rgba(239,83,80,0.34)',
    backgroundColor: 'rgba(239,83,80,0.1)',
  },
  closeGuardActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 14,
  },
  detailOpsPanel: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailOpsEyebrow: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  detailOpsTitle: {
    marginTop: 3,
    fontSize: 14,
    color: 'var(--text)',
    fontWeight: 800,
  },
  detailOpsActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailGpsPanel: {
    border: '1px solid rgba(14,116,144,0.18)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(14,116,144,0.08), var(--glass-bg-strong))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailGpsHeader: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
    alignItems: 'start',
    marginBottom: 10,
  },
  detailGpsTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 17,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailGpsSubtitle: {
    margin: '5px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 720,
    maxWidth: 760,
  },
  detailGpsControls: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailGpsDateInput: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.86)',
    color: 'var(--text)',
    padding: '7px 9px',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 800,
  },
  detailGpsError: {
    border: '1px solid rgba(239,83,80,0.28)',
    borderRadius: 8,
    background: 'rgba(239,83,80,0.08)',
    color: '#B71C1C',
    padding: '8px 10px',
    marginBottom: 9,
    fontSize: 12,
    fontWeight: 800,
  },
  detailGpsSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(142px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  detailGpsMetric: {
    border: '1px solid rgba(14,116,144,0.16)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.72)',
    padding: '9px 10px',
    display: 'grid',
    gap: 4,
    minWidth: 0,
  },
  detailGpsRouteStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    minHeight: 16,
    marginBottom: 10,
    overflow: 'hidden',
  },
  detailGpsRouteDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    background: '#0e7490',
    boxShadow: '0 0 0 3px rgba(14,116,144,0.09)',
    flex: '0 0 auto',
  },
  detailGpsTimeline: {
    display: 'grid',
    gap: 7,
  },
  detailGpsPoint: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gap: 9,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.74)',
    padding: '8px 9px',
    minWidth: 0,
  },
  detailGpsPointDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: '#0e7490',
    boxShadow: '0 0 0 3px rgba(14,116,144,0.12)',
  },
  detailGpsPointTitle: {
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.25,
    fontWeight: 900,
    overflowWrap: 'anywhere',
  },
  detailGpsPointMeta: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.25,
    fontWeight: 700,
    overflowWrap: 'anywhere',
  },
  detailGpsPointLink: {
    border: '1px solid rgba(14,116,144,0.2)',
    borderRadius: 8,
    background: 'rgba(14,116,144,0.08)',
    color: '#0e7490',
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 900,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  detailGpsEmpty: {
    border: '1px dashed rgba(14,116,144,0.24)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.54)',
    color: 'var(--text-muted)',
    padding: '10px 11px',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 760,
  },
  detailHeroPanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: 12,
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #0B3825 0%, #0F5F3A 58%, #168A4A 100%)',
    boxShadow: '0 22px 46px rgba(11,56,37,0.16)',
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  detailHeroMain: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 8,
  },
  detailHeroTitle: {
    margin: 0,
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 1.12,
    fontWeight: 950,
    fontFamily: 'var(--font-display)',
    letterSpacing: 0,
    overflowWrap: 'anywhere',
  },
  detailHeroMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    color: 'rgba(240,253,244,0.78)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailHeroCommand: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
    gap: 10,
    alignItems: 'center',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.94)',
    padding: '10px 11px',
    marginTop: 3,
  },
  detailHeroCommandText: {
    minWidth: 0,
    display: 'grid',
    gap: 2,
  },
  detailHeroCommandLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.15,
  },
  detailHeroCommandTitle: {
    color: 'var(--text)',
    fontSize: 14,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailHeroCommandDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.3,
    fontWeight: 760,
    overflowWrap: 'anywhere',
  },
  detailHeroCommandActions: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  detailHeroPrimaryAction: {
    minHeight: 34,
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent)',
    color: '#fff',
    padding: '7px 11px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 950,
    fontFamily: 'inherit',
  },
  detailHeroSecondaryAction: {
    minHeight: 34,
    border: '1px solid rgba(20,131,79,0.22)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.82)',
    color: 'var(--accent)',
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    fontFamily: 'inherit',
  },
  detailHeroActionDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  detailHeroStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
    gap: 8,
    minWidth: 0,
  },
  detailHeroStat: {
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
    padding: '10px 11px',
    minHeight: 96,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 5,
    minWidth: 0,
  },
  detailHeroStat_good: {
    border: '1px solid rgba(20,131,79,0.2)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  detailHeroStat_blue: {
    border: '1px solid rgba(14,116,144,0.18)',
    backgroundColor: 'rgba(14,116,144,0.07)',
  },
  detailHeroStat_warning: {
    border: '1px solid rgba(199,119,0,0.28)',
    backgroundColor: 'rgba(251,191,36,0.12)',
  },
  detailHeroStat_danger: {
    border: '1px solid rgba(220,38,38,0.25)',
    backgroundColor: 'rgba(248,113,113,0.1)',
  },
  detailHeroStatLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  detailHeroStatValue: {
    color: 'var(--text)',
    fontSize: 18,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailHeroStatDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.25,
    fontWeight: 750,
  },
  officeDecisionBoard: {
    border: '1px solid rgba(52,211,153,0.34)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.13), var(--glass-bg-strong))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  officeDecisionHead: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
    alignItems: 'stretch',
    marginBottom: 10,
  },
  officeDecisionTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 17,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  officeDecisionSubtitle: {
    margin: '5px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 720,
    maxWidth: 760,
  },
  officeDecisionNext: {
    border: '1px solid rgba(52,211,153,0.28)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.72)',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
  },
  officeDecisionNextTitle: {
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  officeDecisionNextDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.3,
    fontWeight: 720,
    overflowWrap: 'anywhere',
  },
  officeDecisionCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
    gap: 8,
  },
  officeDecisionCard: {
    minHeight: 132,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.76)',
    color: 'var(--text)',
    padding: '10px 11px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    textAlign: 'left',
    cursor: 'pointer',
    minWidth: 0,
    boxShadow: 'none',
  },
  officeDecisionCard_good: {
    border: '1px solid rgba(52,211,153,0.28)',
    background: 'rgba(52,211,153,0.08)',
  },
  officeDecisionCard_warning: {
    border: '1px solid rgba(249,168,37,0.34)',
    background: 'rgba(249,168,37,0.09)',
  },
  officeDecisionCard_danger: {
    border: '1px solid rgba(239,83,80,0.36)',
    background: 'rgba(239,83,80,0.1)',
  },
  officeDecisionCardLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    lineHeight: 1.15,
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  officeDecisionCardValue: {
    color: 'var(--text)',
    fontSize: 16,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  officeDecisionCardDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.28,
    fontWeight: 720,
    overflowWrap: 'anywhere',
  },
  officeDecisionCardAction: {
    marginTop: 'auto',
    color: 'var(--laser-emerald)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  detailRepairPanel: {
    border: '1px solid rgba(249,168,37,0.34)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(249,168,37,0.11), var(--glass-bg-strong))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailRepairHeader: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(132px, auto)',
    gap: 12,
    alignItems: 'stretch',
    marginBottom: 10,
  },
  detailRepairTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 17,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailRepairSubtitle: {
    margin: '5px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 720,
    maxWidth: 780,
  },
  detailRepairScore: {
    border: '1px solid rgba(249,168,37,0.28)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.72)',
    padding: 10,
    display: 'grid',
    gap: 4,
    minWidth: 132,
  },
  detailRepairScoreLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  detailRepairScoreValue: {
    color: 'var(--text)',
    fontSize: 20,
    lineHeight: 1.1,
    fontWeight: 950,
  },
  detailRepairScoreDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.2,
    fontWeight: 760,
  },
  detailRepairLead: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center',
    border: '1px solid rgba(249,168,37,0.3)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.72)',
    padding: 10,
    marginBottom: 10,
    minWidth: 0,
  },
  detailRepairLeadLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  detailRepairLeadTitle: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailRepairLeadDetail: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text-sub)',
    fontSize: 12,
    lineHeight: 1.3,
    fontWeight: 720,
    overflowWrap: 'anywhere',
  },
  detailRepairPrimaryBtn: {
    border: '1px solid rgba(52,211,153,0.38)',
    borderRadius: 8,
    background: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '9px 12px',
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 950,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  detailRepairGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  detailRepairItem: {
    minHeight: 128,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.76)',
    color: 'var(--text)',
    padding: '9px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    textAlign: 'left',
    cursor: 'pointer',
    minWidth: 0,
  },
  detailRepairItemDanger: {
    border: '1px solid rgba(239,83,80,0.36)',
    background: 'rgba(239,83,80,0.1)',
  },
  detailRepairItemWarning: {
    border: '1px solid rgba(249,168,37,0.34)',
    background: 'rgba(249,168,37,0.09)',
  },
  detailRepairItemTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 6,
    color: 'var(--text-muted)',
    fontSize: 10,
    lineHeight: 1.1,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  detailRepairItemLabel: {
    color: 'var(--text)',
    fontSize: 14,
    lineHeight: 1.2,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailRepairItemDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.28,
    fontWeight: 720,
    overflowWrap: 'anywhere',
  },
  detailRepairItemAction: {
    marginTop: 'auto',
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  officePlanningQueue: {
    marginTop: 12,
    border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.12), var(--surface-glass))',
    padding: 12,
    boxShadow: 'var(--shadow-md)',
    backdropFilter: 'blur(20px)',
  },
  officePlanningQueueHead: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
    alignItems: 'start',
    marginBottom: 10,
  },
  officePlanningQueueTitle: {
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
    marginTop: 3,
  },
  officePlanningQueueSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 780,
  },
  officePlanningQueueStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(96px, 1fr))',
    gap: 7,
    minWidth: 0,
  },
  officePlanningQueueStat: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.72)',
    color: 'var(--text-muted)',
    padding: '7px 8px',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.2,
    minWidth: 0,
  },
  officePlanningQueueRows: {
    display: 'grid',
    gap: 8,
  },
  officePlanningQueueRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: 8,
    minWidth: 0,
  },
  officePlanningQueueMain: {
    display: 'grid',
    gridTemplateColumns: '44px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    color: 'var(--text)',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
    minWidth: 0,
  },
  officePlanningQueueId: {
    width: 42,
    height: 34,
    borderRadius: 8,
    border: '1px solid rgba(52,211,153,0.28)',
    background: 'rgba(52,211,153,0.1)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
  },
  officePlanningQueueBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.25,
  },
  officePlanningQueueMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.25,
    minWidth: 0,
  },
  officePlanningQueueBadges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    minWidth: 0,
  },
  officePlanningBadge: {
    borderRadius: 999,
    padding: '4px 7px',
    fontSize: 10.5,
    fontWeight: 900,
    lineHeight: 1,
    border: '1px solid var(--border)',
  },
  officePlanningBadgeGood: {
    color: '#34D399',
    border: '1px solid rgba(52,211,153,0.34)',
    background: 'rgba(52,211,153,0.1)',
  },
  officePlanningBadgeWarning: {
    color: '#F9A825',
    border: '1px solid rgba(249,168,37,0.36)',
    background: 'rgba(249,168,37,0.1)',
  },
  officePlanningBadgeDanger: {
    color: '#EF5350',
    border: '1px solid rgba(239,83,80,0.36)',
    background: 'rgba(239,83,80,0.1)',
  },
  officePlanningQueueActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  officePlanningQueueBtn: {
    minHeight: 36,
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
    justifySelf: 'start',
  },
  officePlanningQueueBtnSecondary: {
    minHeight: 36,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  officePlanningQueueFoot: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  officeHandoffPanel: {
    border: '1px solid rgba(14,165,233,0.28)',
    borderRadius: 10,
    background: 'linear-gradient(145deg, rgba(14,165,233,0.1), var(--glass-bg-strong))',
    padding: '13px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  officeHandoffPanel_good: {
    border: '1px solid rgba(52,211,153,0.34)',
    background: 'linear-gradient(145deg, rgba(52,211,153,0.11), var(--glass-bg-strong))',
  },
  officeHandoffPanel_warning: {
    border: '1px solid rgba(242,184,75,0.38)',
    background: 'linear-gradient(145deg, rgba(242,184,75,0.1), var(--glass-bg-strong))',
  },
  officeHandoffPanel_danger: {
    border: '1px solid rgba(248,113,113,0.38)',
    background: 'linear-gradient(145deg, rgba(248,113,113,0.1), var(--glass-bg-strong))',
  },
  officeHandoffHeader: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 1fr) minmax(210px, auto)',
    gap: 12,
    alignItems: 'start',
    marginBottom: 10,
  },
  officeHandoffTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 17,
    fontWeight: 950,
    lineHeight: 1.18,
  },
  officeHandoffSubtitle: {
    margin: '5px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 720,
    lineHeight: 1.35,
    maxWidth: 780,
  },
  officeHandoffStatusBox: {
    display: 'grid',
    gap: 6,
    justifyItems: 'end',
    textAlign: 'right',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 750,
    lineHeight: 1.3,
  },
  officeHandoffGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  officeHandoffCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 92,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'left',
    minWidth: 0,
  },
  officeHandoffCardOk: {
    border: '1px solid rgba(52,211,153,0.26)',
    background: 'rgba(52,211,153,0.08)',
  },
  officeHandoffCardWarn: {
    border: '1px solid rgba(242,184,75,0.32)',
    background: 'rgba(242,184,75,0.08)',
  },
  officeHandoffCardClickable: {
    cursor: 'pointer',
  },
  officeHandoffCardLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  officeHandoffCardValue: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 950,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  officeHandoffCardDetail: {
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 740,
    lineHeight: 1.32,
    overflowWrap: 'anywhere',
  },
  officeHandoffActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  officePlanPanel: {
    border: '1px solid rgba(52,211,153,0.34)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.12), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  officePlanHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  officePlanTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  officePlanSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 720,
  },
  officePlanReadinessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  officePlanReadinessItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: '8px 9px',
    minHeight: 82,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    color: 'var(--text)',
    minWidth: 0,
  },
  timeWindowBox: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 1fr) minmax(220px, auto)',
    alignItems: 'center',
    gap: 12,
    border: '1px solid rgba(14,116,144,0.24)',
    borderRadius: 8,
    background: 'rgba(14,116,144,0.06)',
    padding: 12,
    marginBottom: 12,
  },
  timeWindowMain: {
    display: 'grid',
    gap: 4,
    minWidth: 0,
  },
  timeWindowTitle: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  timeWindowDetail: {
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  timeWindowUrl: {
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    overflowWrap: 'anywhere',
  },
  timeWindowActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  timeWindowHistory: {
    gridColumn: '1 / -1',
    borderTop: '1px solid rgba(14,116,144,0.16)',
    paddingTop: 10,
    display: 'grid',
    gap: 7,
  },
  timeWindowHistoryRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) auto auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.62)',
    padding: '7px 8px',
    minWidth: 0,
  },
  timeWindowHistoryMain: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    color: 'var(--text)',
    fontSize: 12,
  },
  timeWindowStatus: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '4px 7px',
    fontSize: 10,
    fontWeight: 900,
    color: 'var(--text-sub)',
    background: 'var(--surface-field)',
    whiteSpace: 'nowrap',
  },
  timeWindowStatus_good: {
    border: '1px solid rgba(22,138,74,0.24)',
    color: '#166534',
    background: 'rgba(22,138,74,0.08)',
  },
  timeWindowStatus_info: {
    border: '1px solid rgba(14,116,144,0.24)',
    color: '#0e7490',
    background: 'rgba(14,116,144,0.08)',
  },
  timeWindowStatus_warning: {
    border: '1px solid rgba(199,119,0,0.28)',
    color: '#92400e',
    background: 'rgba(199,119,0,0.08)',
  },
  timeWindowStatus_danger: {
    border: '1px solid rgba(220,38,38,0.26)',
    color: '#991b1b',
    background: 'rgba(220,38,38,0.08)',
  },
  timeWindowMiniBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900,
    cursor: 'pointer',
  },
  officePlanAssistant: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 1fr) minmax(220px, auto)',
    alignItems: 'center',
    gap: 12,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    padding: 12,
    marginBottom: 12,
  },
  officePlanAssistant_success: {
    border: '1px solid rgba(22,138,74,0.26)',
    background: 'rgba(22,138,74,0.06)',
  },
  officePlanAssistant_info: {
    border: '1px solid rgba(14,116,144,0.24)',
    background: 'rgba(14,116,144,0.06)',
  },
  officePlanAssistant_warning: {
    border: '1px solid rgba(199,119,0,0.3)',
    background: 'rgba(199,119,0,0.08)',
  },
  officePlanAssistant_danger: {
    border: '1px solid rgba(220,38,38,0.3)',
    background: 'rgba(220,38,38,0.08)',
  },
  officePlanAssistantMain: {
    display: 'grid',
    gap: 4,
    minWidth: 0,
  },
  officePlanAssistantTitle: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  officePlanAssistantDetail: {
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  officePlanAssistantBusy: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    maxWidth: 420,
  },
  officePlanAssistantBusyItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.62)',
    color: 'var(--text-sub)',
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 850,
    lineHeight: 1.2,
  },
  officePlanAssistantBtn: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent)',
    color: '#fff',
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  officePlanAssistantBtnSecondary: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  officePlanConflictBox: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 1fr) minmax(180px, auto)',
    alignItems: 'center',
    gap: 10,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    padding: 12,
    marginBottom: 12,
  },
  officePlanConflictBox_good: {
    border: '1px solid rgba(52,211,153,0.28)',
    background: 'rgba(52,211,153,0.08)',
  },
  officePlanConflictBox_warning: {
    border: '1px solid rgba(242,184,75,0.38)',
    background: 'rgba(242,184,75,0.1)',
  },
  officePlanConflictBox_danger: {
    border: '1px solid rgba(248,113,113,0.36)',
    background: 'rgba(248,113,113,0.1)',
  },
  officePlanConflictTitle: {
    display: 'block',
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 950,
    lineHeight: 1.25,
    marginTop: 3,
  },
  officePlanConflictDetail: {
    display: 'block',
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 750,
    lineHeight: 1.35,
    marginTop: 4,
  },
  officePlanConflictList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    color: 'var(--danger)',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.25,
    textAlign: 'right',
  },
  officePlanConflictActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  officePlanGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10,
    alignItems: 'start',
  },
  officePlanNoteField: {
    gridColumn: '1 / -1',
  },
  officePlanEquipmentField: {
    gridColumn: '1 / -1',
  },
  officePlanMultiSelect: {
    minHeight: 118,
    lineHeight: 1.35,
    padding: '8px 10px',
  },
  officePlanEquipmentHint: {
    display: 'block',
    marginTop: 6,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  officePlanFieldDanger: {
    display: 'block',
    marginTop: 6,
    color: 'var(--danger)',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.35,
  },
  officePlanTextarea: {
    minHeight: 72,
    resize: 'vertical',
    lineHeight: 1.35,
  },
  officePlanFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  officePlanSummary: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.25,
  },
  detailOwnerPanel: {
    border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(52,211,153,0.12), var(--glass-bg-strong))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
    alignItems: 'stretch',
  },
  detailOwnerPanel_active: {
    border: '1px solid rgba(14,165,233,0.38)',
    background: 'linear-gradient(135deg, rgba(14,165,233,0.12), var(--glass-bg-strong))',
  },
  detailOwnerPanel_good: {
    border: '1px solid rgba(52,211,153,0.34)',
    background: 'linear-gradient(135deg, rgba(52,211,153,0.12), var(--glass-bg-strong))',
  },
  detailOwnerPanel_warning: {
    border: '1px solid rgba(242,184,75,0.38)',
    background: 'linear-gradient(135deg, rgba(242,184,75,0.12), var(--glass-bg-strong))',
  },
  detailOwnerPanel_danger: {
    border: '1px solid rgba(248,113,113,0.4)',
    background: 'linear-gradient(135deg, rgba(248,113,113,0.13), var(--glass-bg-strong))',
  },
  detailOwnerMain: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  detailOwnerTitle: {
    color: 'var(--text)',
    fontSize: 18,
    fontWeight: 900,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  detailOwnerText: {
    margin: 0,
    color: 'var(--text-sub)',
    fontSize: 13,
    fontWeight: 750,
    lineHeight: 1.4,
    maxWidth: 780,
  },
  detailOwnerMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  detailOwnerMetaPill: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.72)',
    color: 'var(--text-muted)',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.1,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
  },
  detailOwnerActionBox: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    padding: 11,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    minWidth: 0,
  },
  detailOwnerActionTitle: {
    color: 'var(--accent)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  detailOwnerActionDetail: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    flex: 1,
  },
  detailOwnerActionBtn: {
    border: '1px solid rgba(52,211,153,0.36)',
    borderRadius: 8,
    background: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '8px 11px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 950,
    textAlign: 'center',
  },
  detailOwnerSecondaryBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    textAlign: 'center',
  },
  workflowPathPanel: {
    border: '1px solid rgba(14,165,233,0.28)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(14,165,233,0.1), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  workflowPathPanelFocused: {
    border: '1px solid rgba(132,204,22,0.72)',
    boxShadow: '0 0 0 3px rgba(132,204,22,0.18), var(--shadow-md)',
  },
  workflowPathHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  workflowPathTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  workflowPathSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 780,
  },
  workflowPathSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
    gap: 8,
  },
  workflowPathStep: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.74)',
    padding: '8px 9px',
    minHeight: 86,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    color: 'var(--text-muted)',
  },
  workflowPathStepActive: {
    border: '1px solid rgba(14,165,233,0.42)',
    backgroundColor: 'rgba(14,165,233,0.12)',
    color: 'var(--text)',
  },
  workflowPathStepDone: {
    border: '1px solid rgba(52,211,153,0.28)',
    backgroundColor: 'rgba(52,211,153,0.08)',
    color: 'var(--text)',
  },
  workflowPathNo: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    border: '1px solid var(--border)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 950,
  },
  workflowPathActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  workflowPathBtn: {
    border: '1px solid rgba(52,211,153,0.38)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '8px 11px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  workflowPathBtnBlocked: {
    border: '1px solid rgba(239,83,80,0.32)',
    backgroundColor: 'rgba(239,83,80,0.08)',
    color: 'var(--danger)',
  },
  workflowPathCancelBtn: {
    border: '1px solid rgba(239,83,80,0.34)',
    borderRadius: 8,
    backgroundColor: 'rgba(239,83,80,0.1)',
    color: 'var(--danger)',
    padding: '8px 11px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  workflowPathDone: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailWorkflowPanel: {
    border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.1), var(--glass-bg-strong))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailWorkflowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailWorkflowTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  detailWorkflowSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 820,
  },
  detailWorkflowBadge: {
    border: '1px solid rgba(52,211,153,0.32)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.12)',
    color: 'var(--accent)',
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 950,
  },
  detailWorkflowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 9,
  },
  detailWorkflowStep: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.74)',
    padding: 10,
    minHeight: 188,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    minWidth: 0,
  },
  detailWorkflowStep_done: {
    border: '1px solid rgba(52,211,153,0.34)',
    backgroundColor: 'rgba(52,211,153,0.09)',
  },
  detailWorkflowStep_active: {
    border: '1px solid rgba(14,165,233,0.44)',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  detailWorkflowStep_ready: {
    border: '1px solid rgba(132,204,22,0.32)',
    backgroundColor: 'rgba(132,204,22,0.08)',
  },
  detailWorkflowStep_warning: {
    border: '1px solid rgba(255,145,0,0.2)',
    backgroundColor: 'rgba(255,145,0,0.1)',
  },
  detailWorkflowStep_blocked: {
    border: '1px solid rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.1)',
  },
  detailWorkflowStep_muted: {
    opacity: 0.72,
  },
  detailWorkflowStepTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  detailWorkflowStepNo: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    border: '1px solid var(--border)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
    flexShrink: 0,
  },
  detailWorkflowOwner: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  detailWorkflowStepTitle: {
    color: 'var(--text)',
    fontSize: 14,
    lineHeight: 1.2,
    fontWeight: 950,
  },
  detailWorkflowPrimary: {
    color: 'var(--accent)',
    fontSize: 12,
    lineHeight: 1.25,
    fontWeight: 900,
    overflowWrap: 'anywhere',
  },
  detailWorkflowDetail: {
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 700,
    flex: 1,
  },
  detailWorkflowMissing: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  detailWorkflowOptional: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  detailWorkflowPill: {
    border: '1px solid rgba(248,113,113,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.1)',
    color: 'var(--danger)',
    padding: '4px 6px',
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  detailWorkflowOptionalPill: {
    border: '1px solid rgba(242,184,75,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(242,184,75,0.1)',
    color: 'var(--warning)',
    padding: '4px 6px',
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  detailWorkflowOk: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
  },
  detailWorkflowAction: {
    border: '1px solid rgba(52,211,153,0.35)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 950,
    marginTop: 'auto',
  },
  detailWorkflowActionDisabled: {
    opacity: 0.54,
    cursor: 'not-allowed',
  },
  crewBriefPanel: {
    border: '1px solid rgba(34,197,94,0.32)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(22,101,52,0.18), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  crewBriefHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  crewBriefTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 17,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  crewBriefSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 760,
  },
  crewPackagePanel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.62)',
    padding: 10,
    marginBottom: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)',
    gap: 10,
    alignItems: 'stretch',
  },
  crewPackageSummary: {
    border: '1px solid rgba(34,197,94,0.18)',
    borderRadius: 8,
    backgroundColor: 'rgba(236,253,245,0.82)',
    padding: '9px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  crewPackageTitle: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  crewPackageDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  crewPackageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
    gap: 8,
  },
  crewPackageItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    padding: '7px 8px',
    minHeight: 76,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
  },
  crewPackageItemOk: {
    border: '1px solid rgba(52,211,153,0.28)',
    backgroundColor: 'rgba(236,253,245,0.7)',
  },
  crewPackageItemWarn: {
    border: '1px solid rgba(249,168,37,0.34)',
    backgroundColor: 'rgba(255,251,235,0.78)',
  },
  crewPackageItemDanger: {
    border: '1px solid rgba(239,83,80,0.34)',
    backgroundColor: 'rgba(254,242,242,0.82)',
  },
  crewBriefGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)',
    gap: 10,
    alignItems: 'stretch',
  },
  crewBriefMain: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.76)',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  },
  crewBriefSide: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  crewBriefRow: {
    display: 'grid',
    gridTemplateColumns: '110px 1fr',
    gap: 10,
    alignItems: 'baseline',
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.3,
  },
  crewBriefBlock: {
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    minWidth: 0,
  },
  crewBriefTwoCol: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
  },
  crewBriefActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(94px, 1fr))',
    gap: 8,
  },
  crewActionBtn: {
    border: '1px solid rgba(52,211,153,0.42)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.16)',
    color: 'var(--accent)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  crewActionBtnSecondary: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    textAlign: 'center',
    textDecoration: 'none',
  },
  crewIssueBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  crewIssueSelect: {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 800,
  },
  crewIssueTextarea: {
    width: '100%',
    minHeight: 70,
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '8px 9px',
    fontSize: 12,
    lineHeight: 1.35,
    boxSizing: 'border-box',
  },
  crewIssueBtn: {
    border: '1px solid rgba(249,168,37,0.36)',
    borderRadius: 8,
    backgroundColor: 'rgba(249,168,37,0.12)',
    color: 'var(--warning)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  crewIssueCount: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
  },
  formStatusHint: {
    display: 'block',
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.35,
    fontWeight: 750,
  },
  crewBriefBottom: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 360px)',
    gap: 10,
    marginTop: 10,
  },
  crewChecklist: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
  },
  crewChecklistItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.76)',
    padding: '8px 9px',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  crewPhotoStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    alignContent: 'start',
  },
  crewPhotoLink: {
    position: 'relative',
    display: 'block',
    borderRadius: 8,
    overflow: 'hidden',
    backdropFilter: 'blur(20px)',
    border: '1px solid var(--border)',
    minHeight: 92,
    backgroundColor: 'var(--surface-field)',
    textDecoration: 'none',
  },
  crewPhotoThumb: {
    width: '100%',
    height: 92,
    objectFit: 'cover',
    display: 'block',
  },
  crewPhotoLabel: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#fff',
    padding: '3px 7px',
    fontSize: 10,
    fontWeight: 900,
  },
  crewPhotoEmpty: {
    gridColumn: '1 / -1',
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: 12,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailPassportPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailPassportHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailPassportTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  detailPassportGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  detailPassportCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.76)',
    padding: '9px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minHeight: 88,
    minWidth: 0,
  },
  detailSafetyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 8,
  },
  detailSafetyItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.76)',
    padding: '8px 9px',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  detailDecisionPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailDecisionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailDecisionTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  detailDecisionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 10,
    marginBottom: 10,
  },
  detailDecisionHero: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  },
  detailDecisionLabel: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 850,
    textTransform: 'uppercase',
    lineHeight: 1.2,
  },
  detailDecisionHeroText: {
    color: 'var(--accent)',
    fontSize: 18,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  detailDecisionActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 'auto',
  },
  detailPriceBox: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    minWidth: 0,
  },
  detailPriceBox_good: {
    border: '1px solid rgba(52,211,153,0.28)',
    backgroundColor: 'rgba(52,211,153,0.08)',
  },
  detailPriceBox_warning: {
    border: '1px solid rgba(249,168,37,0.32)',
    backgroundColor: 'rgba(249,168,37,0.09)',
  },
  detailPriceBox_danger: {
    border: '1px solid rgba(239,83,80,0.34)',
    backgroundColor: 'rgba(239,83,80,0.1)',
  },
  detailPriceTitle: {
    color: 'var(--text)',
    fontSize: 16,
    lineHeight: 1.2,
  },
  detailPriceText: {
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  detailPriceMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
    gap: 6,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 750,
  },
  detailPriceEditBtn: {
    alignSelf: 'flex-start',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  },
  detailDecisionMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  detailDecisionMetric: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: '8px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailChecklistGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  detailChecklistItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: '8px 9px',
    minHeight: 74,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  detailChecklistOk: {
    border: '1px solid rgba(52,211,153,0.24)',
  },
  detailChecklistWarn: {
    border: '1px solid rgba(249,168,37,0.28)',
  },
  detailChecklistDanger: {
    border: '1px solid rgba(239,83,80,0.3)',
  },
  detailChecklistStatus: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  closureDecisionLog: {
    marginTop: 10,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: 10,
  },
  closureDecisionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  closureDecisionTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
    marginTop: 2,
  },
  closureDecisionCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
  },
  closureDecisionEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '10px 9px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  closureDecisionItem: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: 8,
    alignItems: 'flex-start',
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    marginTop: 8,
  },
  closureDecisionBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  closureDecisionTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 850,
  },
  closureDecisionMeta: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
  },
  closureDecisionChips: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  closureDecisionChip: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    padding: '3px 6px',
    fontSize: 10,
    fontWeight: 800,
  },
  clientContactPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  clientContactHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  clientContactTitle: {
    marginTop: 3,
    fontSize: 15,
    color: 'var(--text)',
    fontWeight: 900,
  },
  clientContactMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  contactStatusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  contactStatusBtn: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '7px 9px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 7,
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'left',
  },
  contactStatusBtnActive: {
    border: '1px solid var(--accent)',
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
  },
  contactTextarea: {
    width: '100%',
    minHeight: 82,
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text)',
    padding: 10,
    fontSize: 13,
    lineHeight: 1.45,
    outline: 'none',
    boxSizing: 'border-box',
  },
  contactFollowupPanel: {
    marginTop: 10,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: 10,
  },
  contactFollowupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  contactFollowupTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
  },
  contactFollowupTitleDanger: {
    color: '#C62828',
  },
  contactFollowupQuick: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  followupBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  },
  followupClearBtn: {
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
  },
  contactFollowupInputRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) auto',
    gap: 8,
    alignItems: 'center',
  },
  contactFollowupInput: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-glass)',
    color: 'var(--text)',
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: 700,
    minWidth: 0,
  },
  clientContactActions: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  contactHistory: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  contactHistoryTitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  contactHistoryItem: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: 8,
    alignItems: 'start',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: '8px 9px',
  },
  contactHistoryBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  contactHistoryTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 800,
  },
  contactHistoryMeta: {
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  listCardsWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  listCardsHeader: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    padding: '11px 13px',
    boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  listCardsHeaderText: { fontSize: 12, color: 'var(--text-muted)', fontWeight: 800 },
  listCardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 390px), 1fr))',
    gap: 14,
  },
  listEmptyPanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 14,
    alignItems: 'stretch',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(229,246,236,0.72))',
    boxShadow: 'var(--shadow-md)',
    padding: 16,
  },
  listEmptyMain: {
    minWidth: 0,
    display: 'grid',
    alignContent: 'center',
    gap: 7,
  },
  listEmptyEyebrow: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 950,
    lineHeight: 1.15,
    textTransform: 'uppercase',
  },
  listEmptyTitle: {
    color: 'var(--text)',
    fontSize: 22,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  listEmptyText: {
    margin: 0,
    color: 'var(--text-sub)',
    fontSize: 13,
    fontWeight: 740,
    lineHeight: 1.4,
    maxWidth: 680,
  },
  listEmptyActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  listEmptyPrimaryBtn: {
    minHeight: 38,
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent)',
    color: '#fff',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 950,
    fontFamily: 'inherit',
  },
  listEmptySecondaryBtn: {
    minHeight: 38,
    border: '1px solid rgba(20,131,79,0.24)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.78)',
    color: 'var(--accent)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    fontFamily: 'inherit',
  },
  listEmptyFlow: {
    display: 'grid',
    gap: 8,
  },
  listEmptyStep: {
    minWidth: 0,
    border: '1px solid rgba(20,131,79,0.16)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.72)',
    padding: '10px 11px',
    display: 'grid',
    gap: 3,
  },
  listEmptyStepLabel: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  listEmptyStepDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 760,
    lineHeight: 1.3,
  },
  listTaskCard: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderLeft: '5px solid var(--accent)',
    borderRadius: 8,
    boxShadow: '0 12px 30px rgba(31,79,50,0.07)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
    minHeight: 320,
    backdropFilter: 'none',
  },
  listTaskTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  listTaskClient: { fontSize: 17, fontWeight: 950, color: 'var(--text)', lineHeight: 1.2, overflowWrap: 'anywhere' },
  listTaskMeta: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35, overflowWrap: 'anywhere', fontWeight: 650 },
  contactMini: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    border: '1px solid var(--border)',
    borderRadius: 10,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--text-muted)',
    padding: '4px 7px',
    fontSize: 11,
    fontWeight: 800,
  },
  contactMiniFollowup: {
    color: 'var(--text-sub)',
  },
  contactMiniDanger: {
    color: 'var(--danger)',
    border: '1px solid rgba(248,113,113,0.32)',
    backgroundColor: 'rgba(248,113,113,0.09)',
  },
  contactDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: 'var(--text-muted)',
    boxShadow: '0 0 0 2px rgba(148,163,184,0.12)',
    flexShrink: 0,
  },
  contactDot_good: {
    backgroundColor: 'var(--laser-emerald)',
    boxShadow: '0 0 8px rgba(0,230,118,0.45)',
  },
  contactDot_warning: {
    backgroundColor: 'var(--supernova-orange)',
    boxShadow: '0 0 8px rgba(255,145,0,0.42)',
  },
  contactDot_danger: {
    backgroundColor: 'var(--danger)',
    boxShadow: '0 0 8px rgba(255,61,113,0.42)',
  },
  contactDot_muted: {
    backgroundColor: '#94A3B8',
    boxShadow: '0 0 0 2px rgba(148,163,184,0.12)',
  },
  workflowStageRow: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: '8px 9px',
    display: 'grid',
    gridTemplateColumns: '28px 1fr',
    gap: 8,
    alignItems: 'center',
  },
  workflowStageStep: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
  },
  workflowStageBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 900,
  },
  workflowStage_good: {
    border: '1px solid rgba(52,211,153,0.32)',
    backgroundColor: 'rgba(52,211,153,0.09)',
  },
  workflowStage_warning: {
    border: '1px solid rgba(242,184,75,0.32)',
    backgroundColor: 'rgba(251,191,36,0.1)',
  },
  workflowStage_blue: {
    border: '1px solid rgba(91,192,235,0.3)',
    backgroundColor: 'rgba(91,192,235,0.08)',
  },
  workflowStage_danger: {
    border: '1px solid rgba(248,113,113,0.28)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  workflowStage_muted: {
    border: '1px solid var(--border)',
  },
  stageOwnerMini: {
    border: '1px solid rgba(52,211,153,0.26)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.09), rgba(255,255,255,0.82))',
    padding: '9px 10px',
    display: 'grid',
    gap: 6,
    minWidth: 0,
  },
  stageOwnerMini_good: {
    border: '1px solid rgba(52,211,153,0.3)',
    background: 'linear-gradient(145deg, rgba(52,211,153,0.1), rgba(255,255,255,0.82))',
  },
  stageOwnerMini_warning: {
    border: '1px solid rgba(242,184,75,0.34)',
    background: 'linear-gradient(145deg, rgba(242,184,75,0.11), rgba(255,255,255,0.82))',
  },
  stageOwnerMini_danger: {
    border: '1px solid rgba(248,113,113,0.34)',
    background: 'linear-gradient(145deg, rgba(248,113,113,0.1), rgba(255,255,255,0.82))',
  },
  stageOwnerMini_blue: {
    border: '1px solid rgba(91,192,235,0.32)',
    background: 'linear-gradient(145deg, rgba(91,192,235,0.1), rgba(255,255,255,0.82))',
  },
  stageOwnerMini_muted: {
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
  },
  stageOwnerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  stageOwnerLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  stageOwnerName: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 950,
    lineHeight: 1.15,
    textAlign: 'right',
    overflowWrap: 'anywhere',
  },
  stageOwnerTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  stageOwnerDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 750,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  stageOwnerFooter: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
  },
  stageOwnerNext: {
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  stageOwnerAction: {
    minHeight: 30,
    border: '1px solid rgba(52,211,153,0.36)',
    borderRadius: 8,
    background: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 950,
    textAlign: 'center',
    maxWidth: 156,
    lineHeight: 1.15,
    overflowWrap: 'anywhere',
  },
  fieldOpsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
    gap: 6,
  },
  fieldOpsBtn: {
    minHeight: 32,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(20,131,79,0.08)',
    color: 'var(--accent)',
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 800,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  fieldOpsBtnDisabled: {
    color: 'var(--text-muted)',
    cursor: 'default',
    opacity: 0.7,
  },
  fieldOpsIcon: { fontSize: 15, flexShrink: 0 },
  documentationRow: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--surface-field)',
    padding: '7px 8px',
    display: 'grid',
    gridTemplateColumns: '1fr repeat(3, auto)',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 800,
  },
  documentationRowWarning: {
    border: '1px solid rgba(248,113,113,0.28)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  documentationLabel: {
    color: 'var(--text)',
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  documentationMetric: {
    whiteSpace: 'nowrap',
    color: 'var(--text-muted)',
  },
  fieldExecutionRow: {
    border: '1px solid var(--border)',
    borderRadius: 10,
    backgroundColor: 'var(--surface-field)',
    padding: '9px 10px',
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 1fr) minmax(130px, auto)',
    gap: 10,
    alignItems: 'center',
  },
  fieldExecutionRow_good: {
    borderColor: 'rgba(34,197,94,0.28)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  fieldExecutionRow_warning: {
    borderColor: 'rgba(245,158,11,0.34)',
    backgroundColor: 'rgba(245,158,11,0.1)',
  },
  fieldExecutionRow_danger: {
    borderColor: 'rgba(239,68,68,0.36)',
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  fieldExecutionRow_muted: {
    borderColor: 'rgba(148,163,184,0.18)',
    backgroundColor: 'rgba(148,163,184,0.08)',
  },
  fieldExecutionMain: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
  },
  fieldExecutionLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  fieldExecutionDocs: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  fieldExecutionChip: {
    minHeight: 20,
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '2px 7px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap',
  },
  fieldExecutionChipReady: {
    color: 'var(--accent)',
    borderColor: 'rgba(34,197,94,0.28)',
    backgroundColor: 'rgba(34,197,94,0.1)',
  },
  fieldExecutionChipMissing: {
    color: 'var(--warning)',
    borderColor: 'rgba(245,158,11,0.34)',
    backgroundColor: 'rgba(245,158,11,0.1)',
  },
  listTaskChips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  readinessBlock: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 9px',
    backgroundColor: 'var(--surface-field)',
  },
  readinessTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
  },
  readinessTrack: {
    marginTop: 6,
    height: 5,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(148,163,184,0.18)',
  },
  readinessFill: {
    display: 'block',
    height: '100%',
    borderRadius: 8,
    transition: 'width 0.18s ease',
  },
  packageReadinessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
    gap: 7,
  },
  packageReadinessTile: {
    border: '1px solid var(--border)',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.82)',
    color: 'var(--text)',
    minHeight: 58,
    padding: '8px 9px',
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
  },
  packageReadinessTile_good: {
    border: '1px solid rgba(52,211,153,0.3)',
    backgroundColor: 'rgba(52,211,153,0.09)',
  },
  packageReadinessTile_warning: {
    border: '1px solid rgba(251,191,36,0.32)',
    backgroundColor: 'rgba(251,191,36,0.1)',
  },
  packageReadinessTile_danger: {
    border: '1px solid rgba(248,113,113,0.34)',
    backgroundColor: 'rgba(248,113,113,0.1)',
  },
  packageReadinessLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  packageReadinessValue: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
    gridRow: '1 / span 2',
    gridColumn: 2,
  },
  packageReadinessHint: {
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  blockerWrap: { display: 'flex', gap: 5, flexWrap: 'wrap', minHeight: 22 },
  blockerBadge: {
    padding: '3px 7px',
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 800,
    border: '1px solid var(--border)',
    lineHeight: 1.3,
  },
  blockerDanger: {
    backgroundColor: 'rgba(248,113,113,0.14)',
    border: '1px solid rgba(248,113,113,0.28)',
    color: '#C62828',
  },
  blockerWarning: {
    backgroundColor: 'rgba(251,191,36,0.15)',
    border: '1px solid rgba(251,191,36,0.3)',
    color: '#A16207',
  },
  blockerGood: {
    backgroundColor: 'rgba(52,211,153,0.14)',
    border: '1px solid rgba(52,211,153,0.3)',
    color: 'var(--accent)',
  },
  nextActionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  nextActionText: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
  },
  nextActionBtn: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--accent), var(--accent-dk))',
    color: 'var(--on-accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    maxWidth: 170,
    textAlign: 'center',
  },
  listTaskFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  listTaskDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  listTaskValue: { fontSize: 13, color: 'var(--accent)', fontWeight: 800 },
};
