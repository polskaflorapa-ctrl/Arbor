const TASK_STATUS = Object.freeze({
  NOWE: 'Nowe',
  WYCENA_TERENOWA: 'Wycena_Terenowa',
  DO_ZATWIERDZENIA: 'Do_Zatwierdzenia',
  ZAPLANOWANE: 'Zaplanowane',
  W_REALIZACJI: 'W_Realizacji',
  ZAKONCZONE: 'Zakonczone',
  ANULOWANE: 'Anulowane',
});

const TASK_STATUSES = [
  TASK_STATUS.NOWE,
  TASK_STATUS.WYCENA_TERENOWA,
  TASK_STATUS.DO_ZATWIERDZENIA,
  TASK_STATUS.ZAPLANOWANE,
  TASK_STATUS.W_REALIZACJI,
  TASK_STATUS.ZAKONCZONE,
  TASK_STATUS.ANULOWANE,
];

const TASK_STATUS_ALIASES = new Map([
  ['Zako\u0144czone', TASK_STATUS.ZAKONCZONE],
  ['W realizacji', TASK_STATUS.W_REALIZACJI],
]);

const VALID_TASK_STATUSES = new Set(TASK_STATUSES);
const CLOSED_TASK_STATUSES = new Set([TASK_STATUS.ZAKONCZONE, TASK_STATUS.ANULOWANE]);

function normalizeTaskStatus(status) {
  const key = String(status || '').trim();
  return TASK_STATUS_ALIASES.get(key) || key;
}

function isValidTaskStatus(status) {
  return VALID_TASK_STATUSES.has(normalizeTaskStatus(status));
}

function isTaskClosed(status) {
  return CLOSED_TASK_STATUSES.has(normalizeTaskStatus(status));
}

function isTaskDone(status) {
  return normalizeTaskStatus(status) === TASK_STATUS.ZAKONCZONE;
}

function isTaskInProgress(status) {
  return normalizeTaskStatus(status) === TASK_STATUS.W_REALIZACJI;
}

function taskStageLabel(status) {
  switch (normalizeTaskStatus(status)) {
    case TASK_STATUS.NOWE:
      return 'Lead';
    case TASK_STATUS.WYCENA_TERENOWA:
      return 'Ogl\u0119dziny';
    case TASK_STATUS.DO_ZATWIERDZENIA:
      return 'Do zatwierdzenia';
    case TASK_STATUS.ZAPLANOWANE:
      return 'Plan ekipy';
    case TASK_STATUS.W_REALIZACJI:
      return 'W realizacji';
    case TASK_STATUS.ZAKONCZONE:
      return 'Wygrane';
    case TASK_STATUS.ANULOWANE:
      return 'Przegrane';
    default:
      return 'Inne';
  }
}

module.exports = {
  TASK_STATUS,
  TASK_STATUSES,
  VALID_TASK_STATUSES,
  normalizeTaskStatus,
  isValidTaskStatus,
  isTaskClosed,
  isTaskDone,
  isTaskInProgress,
  taskStageLabel,
};
