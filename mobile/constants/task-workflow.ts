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
