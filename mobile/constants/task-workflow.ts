import type { Theme } from './theme';

export const TASK_STATUS = {
  NOWE: 'Nowe',
  WYCENA_TERENOWA: 'Wycena_Terenowa',
  DO_ZATWIERDZENIA: 'Do_Zatwierdzenia',
  ZAPLANOWANE: 'Zaplanowane',
  W_REALIZACJI: 'W_Realizacji',
  ZAKONCZONE: 'Zakonczone',
  ANULOWANE: 'Anulowane',
} as const;

export const TASK_STATUSES = [
  TASK_STATUS.NOWE,
  TASK_STATUS.WYCENA_TERENOWA,
  TASK_STATUS.DO_ZATWIERDZENIA,
  TASK_STATUS.ZAPLANOWANE,
  TASK_STATUS.W_REALIZACJI,
  TASK_STATUS.ZAKONCZONE,
  TASK_STATUS.ANULOWANE,
] as const;

export const TASK_WORKFLOW_STEPS = [
  { status: TASK_STATUS.NOWE, step: '1', label: 'Telefon', detail: 'biuro przyjmuje zgloszenie' },
  { status: TASK_STATUS.WYCENA_TERENOWA, step: '2', label: 'Ogledziny', detail: 'specjalista ds. wyceny zbiera zdjecia, zakres i budzet' },
  { status: TASK_STATUS.DO_ZATWIERDZENIA, step: '3', label: 'Biuro planuje', detail: 'klient akceptuje, biuro dopina szczegoly' },
  { status: TASK_STATUS.ZAPLANOWANE, step: '4', label: 'Ekipa gotowa', detail: 'termin, brygada i sprzet sa ustawione' },
  { status: TASK_STATUS.W_REALIZACJI, step: '5', label: 'Wykonanie', detail: 'ekipa pracuje wedlug briefu' },
  { status: TASK_STATUS.ZAKONCZONE, step: '6', label: 'Zamkniecie', detail: 'dowody i rozliczenie sa kompletne' },
  { status: TASK_STATUS.ANULOWANE, step: 'X', label: 'Anulowane', detail: 'zlecenie wycofane z procesu' },
] as const;

export const TASK_FORWARD_TRANSITIONS: Record<string, readonly TaskStatus[]> = {
  [TASK_STATUS.NOWE]: [TASK_STATUS.WYCENA_TERENOWA],
  [TASK_STATUS.WYCENA_TERENOWA]: [TASK_STATUS.DO_ZATWIERDZENIA],
  [TASK_STATUS.DO_ZATWIERDZENIA]: [TASK_STATUS.ZAPLANOWANE],
  [TASK_STATUS.ZAPLANOWANE]: [TASK_STATUS.W_REALIZACJI],
  [TASK_STATUS.W_REALIZACJI]: [TASK_STATUS.ZAKONCZONE],
  [TASK_STATUS.ZAKONCZONE]: [],
  [TASK_STATUS.ANULOWANE]: [],
};

export const TASK_STATUS_FILTERS = ['', ...TASK_STATUSES] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_STATUS_ALIASES = new Map<string, TaskStatus>([
  ['Zako\u0144czone', TASK_STATUS.ZAKONCZONE],
]);

export const CLOSED_TASK_STATUSES = new Set<string>([
  TASK_STATUS.ZAKONCZONE,
  TASK_STATUS.ANULOWANE,
]);

export function normalizeTaskStatus(status?: string | null) {
  const key = String(status || '');
  return TASK_STATUS_ALIASES.get(key) || key;
}

export function isTaskClosed(status?: string | null) {
  return CLOSED_TASK_STATUSES.has(normalizeTaskStatus(status));
}

export function isTaskDone(status?: string | null) {
  return normalizeTaskStatus(status) === TASK_STATUS.ZAKONCZONE;
}

export function isTaskInProgress(status?: string | null) {
  return normalizeTaskStatus(status) === TASK_STATUS.W_REALIZACJI;
}

export function getTaskWorkflowStep(status?: string | null) {
  const normalized = normalizeTaskStatus(status) || TASK_STATUS.NOWE;
  return TASK_WORKFLOW_STEPS.find((step) => step.status === normalized) || TASK_WORKFLOW_STEPS[0];
}

export function getNextTaskStatuses(
  status?: string | null,
  options: { includeCurrent?: boolean; allowCancel?: boolean } = {},
) {
  const { includeCurrent = false, allowCancel = true } = options;
  const normalized = normalizeTaskStatus(status) || TASK_STATUS.NOWE;
  const next = [...(TASK_FORWARD_TRANSITIONS[normalized] || [])];
  if (allowCancel && !CLOSED_TASK_STATUSES.has(normalized) && !next.includes(TASK_STATUS.ANULOWANE)) {
    next.push(TASK_STATUS.ANULOWANE);
  }
  return includeCurrent ? [normalized as TaskStatus, ...next] : next;
}

export function canTransitionTaskStatus(
  fromStatus?: string | null,
  toStatus?: string | null,
  options: { allowCancel?: boolean } = {},
) {
  const from = normalizeTaskStatus(fromStatus) || TASK_STATUS.NOWE;
  const to = normalizeTaskStatus(toStatus);
  if (!to) return false;
  if (from === to) return true;
  return getNextTaskStatuses(from, options).includes(to as TaskStatus);
}

export function getTaskStatusColor(theme: Theme, status?: string | null) {
  switch (normalizeTaskStatus(status)) {
    case TASK_STATUS.NOWE:
      return theme.success;
    case TASK_STATUS.WYCENA_TERENOWA:
      return theme.info;
    case TASK_STATUS.DO_ZATWIERDZENIA:
      return theme.accent;
    case TASK_STATUS.ZAPLANOWANE:
      return theme.info;
    case TASK_STATUS.W_REALIZACJI:
      return theme.warning;
    case TASK_STATUS.ZAKONCZONE:
      return theme.success;
    case TASK_STATUS.ANULOWANE:
      return theme.danger;
    default:
      return theme.textMuted;
  }
}

export function makeTaskStatusColorMap(theme: Theme) {
  return TASK_STATUSES.reduce<Record<string, string>>((acc, status) => {
    acc[status] = getTaskStatusColor(theme, status);
    return acc;
  }, {});
}

export function taskMutationPayload(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const {
    message: _message,
    idempotent_replay: _idempotentReplay,
    sprzet_ids: _equipmentIds,
    rezerwacje_sprzetu: _equipmentReservations,
    ...taskFields
  } = data as Record<string, unknown>;
  return taskFields;
}

export function mergeTaskMutationResponse(
  currentTask: Record<string, unknown> | null | undefined,
  data: unknown,
  fallback: Record<string, unknown> = {},
) {
  const taskFields = taskMutationPayload(data);
  const merged = {
    ...(currentTask || {}),
    ...fallback,
    ...taskFields,
  };
  if (merged.id == null) merged.id = fallback.id ?? currentTask?.id;
  return merged;
}
