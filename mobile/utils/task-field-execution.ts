import { TASK_STATUS, isTaskClosed, normalizeTaskStatus } from '../constants/task-workflow';

export type FieldExecutionTone = 'success' | 'warning' | 'danger' | 'muted';

export type FieldExecutionPhotoItem = {
  key: 'wycena' | 'szkic' | 'dojazd';
  label: string;
  count: number;
};

export type FieldExecutionSummary = {
  key: 'active' | 'finished' | 'arrived' | 'missing' | 'waiting' | 'field';
  label: string;
  detail: string;
  tone: FieldExecutionTone;
  relevant: boolean;
  photoItems: FieldExecutionPhotoItem[];
  missingPhotoLabels: string[];
};

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizedStatus(value: unknown) {
  const raw = String(value || '').trim();
  const known = normalizeTaskStatus(raw);
  if (known) return known;
  const lower = raw.toLowerCase();
  if (lower.includes('realiz')) return TASK_STATUS.W_REALIZACJI;
  if (lower.includes('zaplan')) return TASK_STATUS.ZAPLANOWANE;
  if (lower.includes('zatwierd')) return TASK_STATUS.DO_ZATWIERDZENIA;
  if (lower.includes('wycen')) return TASK_STATUS.WYCENA_TERENOWA;
  if (lower.includes('zakon') || lower.includes('zako')) return TASK_STATUS.ZAKONCZONE;
  return raw;
}

export function formatTaskFieldTime(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function getTaskFieldPhotoItems(task: any): FieldExecutionPhotoItem[] {
  return [
    { key: 'wycena', label: 'Wycena', count: numberValue(task?.photo_wycena ?? task?.photos_wycena) },
    { key: 'szkic', label: 'Szkic', count: numberValue(task?.photo_szkic ?? task?.photos_szkic) },
    { key: 'dojazd', label: 'Dojazd', count: numberValue(task?.photo_dojazd ?? task?.photos_dojazd) },
  ];
}

export function getTaskFieldExecutionSummary(task: any): FieldExecutionSummary {
  const status = normalizedStatus(task?.status);
  const closed = isTaskClosed(status);
  const photoItems = getTaskFieldPhotoItems(task);
  const missingPhotoLabels = photoItems.filter((item) => item.count <= 0).map((item) => item.label);
  const activeCount = numberValue(task?.active_work_count);
  const hasActiveWork = activeCount > 0 || Boolean(task?.active_work_started_at);
  const hasCheckin = Boolean(task?.last_checkin_at);
  const hasFinishedWork = Boolean(task?.last_work_finished_at);
  const needsCrewSignal = [TASK_STATUS.ZAPLANOWANE, TASK_STATUS.W_REALIZACJI].includes(status as any) && !closed;
  const isFieldStage = status === TASK_STATUS.WYCENA_TERENOWA || status === TASK_STATUS.DO_ZATWIERDZENIA;

  if (hasActiveWork) {
    return {
      key: 'active',
      label: 'Praca trwa',
      detail: `start ${formatTaskFieldTime(task?.active_work_started_at) || 'z mobilki'}`,
      tone: missingPhotoLabels.length ? 'warning' : 'success',
      relevant: true,
      photoItems,
      missingPhotoLabels,
    };
  }

  if (hasFinishedWork || closed) {
    return {
      key: 'finished',
      label: 'Teren zamkniety',
      detail: hasFinishedWork ? `koniec ${formatTaskFieldTime(task?.last_work_finished_at)}` : 'status zamkniety',
      tone: missingPhotoLabels.length ? 'warning' : 'success',
      relevant: true,
      photoItems,
      missingPhotoLabels,
    };
  }

  if (hasCheckin) {
    return {
      key: 'arrived',
      label: 'Dojechali',
      detail: `check-in ${formatTaskFieldTime(task?.last_checkin_at)}`,
      tone: missingPhotoLabels.length ? 'warning' : 'success',
      relevant: true,
      photoItems,
      missingPhotoLabels,
    };
  }

  if (needsCrewSignal) {
    return {
      key: 'missing',
      label: 'Brak check-in',
      detail: 'ekipa nie potwierdzila miejsca',
      tone: 'danger',
      relevant: true,
      photoItems,
      missingPhotoLabels,
    };
  }

  if (isFieldStage) {
    return {
      key: 'field',
      label: status === TASK_STATUS.DO_ZATWIERDZENIA ? 'Czeka na plan' : 'Ogledziny',
      detail: missingPhotoLabels.length ? `brakuje: ${missingPhotoLabels.join(', ')}` : 'pakiet foto gotowy',
      tone: missingPhotoLabels.length ? 'warning' : 'success',
      relevant: true,
      photoItems,
      missingPhotoLabels,
    };
  }

  return {
    key: 'waiting',
    label: 'Przed terenem',
    detail: 'jeszcze bez pracy ekipy',
    tone: 'muted',
    relevant: false,
    photoItems,
    missingPhotoLabels,
  };
}
