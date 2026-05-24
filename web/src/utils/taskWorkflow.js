export const TASK_STATUS = Object.freeze({
  NOWE: 'Nowe',
  WYCENA_TERENOWA: 'Wycena_Terenowa',
  DO_ZATWIERDZENIA: 'Do_Zatwierdzenia',
  ZAPLANOWANE: 'Zaplanowane',
  W_REALIZACJI: 'W_Realizacji',
  ZAKONCZONE: 'Zakonczone',
  ANULOWANE: 'Anulowane',
});

export const TASK_STATUSES = [
  TASK_STATUS.NOWE,
  TASK_STATUS.WYCENA_TERENOWA,
  TASK_STATUS.DO_ZATWIERDZENIA,
  TASK_STATUS.ZAPLANOWANE,
  TASK_STATUS.W_REALIZACJI,
  TASK_STATUS.ZAKONCZONE,
  TASK_STATUS.ANULOWANE,
];

export const TASK_WORKFLOW_STEPS = [
  { status: TASK_STATUS.NOWE, step: '1', label: 'Telefon', detail: 'biuro przyjmuje zgloszenie' },
  { status: TASK_STATUS.WYCENA_TERENOWA, step: '2', label: 'Ogledziny', detail: 'specjalista ds. wyceny zbiera zdjecia, zakres i budzet' },
  { status: TASK_STATUS.DO_ZATWIERDZENIA, step: '3', label: 'Biuro planuje', detail: 'klient akceptuje, biuro dopina szczegoly' },
  { status: TASK_STATUS.ZAPLANOWANE, step: '4', label: 'Ekipa gotowa', detail: 'termin, brygada i sprzet sa ustawione' },
  { status: TASK_STATUS.W_REALIZACJI, step: '5', label: 'Wykonanie', detail: 'ekipa pracuje wedlug briefu' },
  { status: TASK_STATUS.ZAKONCZONE, step: '6', label: 'Zamkniecie', detail: 'dowody i rozliczenie sa kompletne' },
  { status: TASK_STATUS.ANULOWANE, step: 'X', label: 'Anulowane', detail: 'zlecenie wycofane z procesu' },
];

export const TASK_FORWARD_TRANSITIONS = Object.freeze({
  [TASK_STATUS.NOWE]: [TASK_STATUS.WYCENA_TERENOWA],
  [TASK_STATUS.WYCENA_TERENOWA]: [TASK_STATUS.DO_ZATWIERDZENIA],
  [TASK_STATUS.DO_ZATWIERDZENIA]: [TASK_STATUS.ZAPLANOWANE],
  [TASK_STATUS.ZAPLANOWANE]: [TASK_STATUS.W_REALIZACJI],
  [TASK_STATUS.W_REALIZACJI]: [TASK_STATUS.ZAKONCZONE],
  [TASK_STATUS.ZAKONCZONE]: [],
  [TASK_STATUS.ANULOWANE]: [],
});

export const TASK_STATUS_ALIASES = new Map([
  ['Zako\u0144czone', TASK_STATUS.ZAKONCZONE],
]);

export const CLOSED_TASK_STATUSES = new Set([
  TASK_STATUS.ZAKONCZONE,
  TASK_STATUS.ANULOWANE,
]);

export const CREW_REQUIRED_TASK_STATUSES = new Set([
  TASK_STATUS.DO_ZATWIERDZENIA,
  TASK_STATUS.ZAPLANOWANE,
  TASK_STATUS.W_REALIZACJI,
]);

export const FIELD_EVIDENCE_REQUIRED_TASK_STATUSES = new Set([
  TASK_STATUS.WYCENA_TERENOWA,
  TASK_STATUS.DO_ZATWIERDZENIA,
  TASK_STATUS.ZAPLANOWANE,
  TASK_STATUS.W_REALIZACJI,
]);

export const PRICE_REQUIRED_TASK_STATUSES = FIELD_EVIDENCE_REQUIRED_TASK_STATUSES;

export const TASK_STATUS_COLORS = Object.freeze({
  [TASK_STATUS.NOWE]: 'var(--accent)',
  [TASK_STATUS.WYCENA_TERENOWA]: '#0EA5E9',
  [TASK_STATUS.DO_ZATWIERDZENIA]: '#8B5CF6',
  [TASK_STATUS.ZAPLANOWANE]: 'var(--info)',
  [TASK_STATUS.W_REALIZACJI]: 'var(--warning)',
  [TASK_STATUS.ZAKONCZONE]: 'var(--success)',
  [TASK_STATUS.ANULOWANE]: 'var(--danger)',
});

export const TASK_STATUS_BADGE_BG = Object.freeze({
  [TASK_STATUS.NOWE]: 'var(--accent-surface)',
  [TASK_STATUS.WYCENA_TERENOWA]: 'rgba(14,165,233,0.14)',
  [TASK_STATUS.DO_ZATWIERDZENIA]: 'rgba(139,92,246,0.14)',
  [TASK_STATUS.ZAPLANOWANE]: 'rgba(112,182,255,0.16)',
  [TASK_STATUS.W_REALIZACJI]: 'rgba(248,201,107,0.16)',
  [TASK_STATUS.ZAKONCZONE]: 'rgba(52,211,153,0.16)',
  [TASK_STATUS.ANULOWANE]: 'rgba(255,127,169,0.16)',
});

export function normalizeTaskStatus(status) {
  const key = String(status || '');
  return TASK_STATUS_ALIASES.get(key) || key;
}

export function isTaskClosed(status) {
  return CLOSED_TASK_STATUSES.has(normalizeTaskStatus(status));
}

export function isTaskDone(status) {
  return normalizeTaskStatus(status) === TASK_STATUS.ZAKONCZONE;
}

export function isTaskInProgress(status) {
  return normalizeTaskStatus(status) === TASK_STATUS.W_REALIZACJI;
}

export function getTaskWorkflowStep(status) {
  const normalized = normalizeTaskStatus(status) || TASK_STATUS.NOWE;
  return TASK_WORKFLOW_STEPS.find((step) => step.status === normalized) || TASK_WORKFLOW_STEPS[0];
}

export function getNextTaskStatuses(status, options = {}) {
  const {
    includeCurrent = false,
    allowCancel = true,
  } = options;
  const normalized = normalizeTaskStatus(status) || TASK_STATUS.NOWE;
  const next = [...(TASK_FORWARD_TRANSITIONS[normalized] || [])];
  if (allowCancel && !CLOSED_TASK_STATUSES.has(normalized) && !next.includes(TASK_STATUS.ANULOWANE)) {
    next.push(TASK_STATUS.ANULOWANE);
  }
  return includeCurrent ? [normalized, ...next] : next;
}

export function canTransitionTaskStatus(fromStatus, toStatus, options = {}) {
  const from = normalizeTaskStatus(fromStatus) || TASK_STATUS.NOWE;
  const to = normalizeTaskStatus(toStatus);
  if (!to) return false;
  if (from === to) return true;
  return getNextTaskStatuses(from, options).includes(to);
}

export function getTaskStatusColor(status, fallback = '#6B7280') {
  return TASK_STATUS_COLORS[normalizeTaskStatus(status)] || fallback;
}

export function getTaskStatusBadgeBg(status, fallback = 'rgba(148,163,184,0.16)') {
  return TASK_STATUS_BADGE_BG[normalizeTaskStatus(status)] || fallback;
}

export function taskMutationPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const {
    message: _message,
    idempotent_replay: _idempotentReplay,
    sprzet_ids: _equipmentIds,
    rezerwacje_sprzetu: _equipmentReservations,
    ...taskFields
  } = data;
  return taskFields;
}

export function mergeTaskMutationResponse(currentTask, data, fallback = {}) {
  const taskFields = taskMutationPayload(data);
  const merged = {
    ...(currentTask || {}),
    ...fallback,
    ...taskFields,
  };
  if (merged.id == null) merged.id = fallback.id ?? currentTask?.id;
  return merged;
}
