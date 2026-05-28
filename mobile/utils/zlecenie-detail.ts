import { Ionicons } from '@expo/vector-icons';

import { API_BASE_URL } from '../constants/api';
import { TASK_SETTLEMENT_OPTIONS } from '../constants/task-form';
import type { Theme } from '../constants/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export const TYP_ZDJECIA_KEYS = ['wycena', 'szkic', 'dojazd', 'checkin', 'przed', 'po', 'inne'] as const;

export const PHOTO_TYPE_LABELS: Record<(typeof TYP_ZDJECIA_KEYS)[number], string> = {
  wycena: 'Wycena u klienta',
  szkic: 'Szkic zakresu',
  dojazd: 'Dojazd / posesja',
  checkin: 'Check-in',
  przed: 'Przed pracÄ…',
  po: 'Po pracy',
  inne: 'Inne',
};

export const SAFETY_CHECKLIST_ITEMS = [
  {
    key: 'zone',
    label: 'Strefa pracy',
    hint: 'Odgradzona, klient i osoby postronne poza zasiegiem.',
    icon: 'alert-circle-outline',
  },
  {
    key: 'power',
    label: 'Linie i przeszkody',
    hint: 'Sprawdzone przewody, ogrodzenia, auta, dachy i szkody ryzyka.',
    icon: 'flash-outline',
  },
  {
    key: 'ppe',
    label: 'SprzÄ™t i PPE',
    hint: 'Kaski, uprzÄ™ĹĽe, piĹ‚a, rÄ™bak i komunikacja ekipy gotowe.',
    icon: 'construct-outline',
  },
  {
    key: 'escape',
    label: 'Droga ucieczki',
    hint: 'Ustalona strefa zrzutu, kierunek obalenia i awaryjny odwrĂłt.',
    icon: 'walk-outline',
  },
  {
    key: 'client',
    label: 'Klient poinformowany',
    hint: 'Zakres, ryzyka, odpady i ograniczenia uzgodnione na miejscu.',
    icon: 'chatbubble-ellipses-outline',
  },
] as const;

export const DEFAULT_FIELD_SETTLEMENT = TASK_SETTLEMENT_OPTIONS[0]?.note || '';

export type PhotoTypeKey = (typeof TYP_ZDJECIA_KEYS)[number];
export type PhotoFilterKey = 'all' | PhotoTypeKey;

export type FinishRequirements = {
  require_po_photo: boolean;
  require_przed_photo: boolean;
  require_material_usage: boolean;
  has_po_photo: boolean;
  has_przed_photo: boolean;
};

export type SafetyLogRow = {
  key: string;
  label: string;
  hint: string | null;
  done: boolean;
};

export type OfficePlanTeam = {
  id: string | number;
  nazwa: string;
  oddzial_id?: string | number | null;
  oddzial_nazwa?: string | null;
  delegowany?: boolean;
  natywny_oddzial?: boolean;
  zajete_minuty?: string | number | null;
  wolne_minuty?: string | number | null;
};

export type OfficePlanEquipment = {
  id: string | number;
  nazwa: string;
  typ?: string | null;
  status?: string | null;
  oddzial_id?: string | number | null;
  ekipa_id?: string | number | null;
};

export type OfficePlanForm = {
  data: string;
  godzina: string;
  czas: string;
  ekipaId: string;
  sprzetIds: string[];
  note: string;
};

export type InspectionEstimator = {
  id: string | number;
  nazwa: string;
  imie?: string | null;
  nazwisko?: string | null;
  rola?: string | null;
  telefon?: string | null;
  oddzial_id?: string | number | null;
  oddzial_nazwa?: string | null;
  delegowany?: boolean;
  natywny_oddzial?: boolean;
};

export type InspectionDispatchForm = {
  estimatorId: string;
  data: string;
  godzina: string;
  note: string;
};

export type WorkflowMissingItem = {
  key: string;
  label: string;
  required: boolean;
};

export function parseSafetyLogRows(value: unknown): SafetyLogRow[] {
  const raw = typeof value === 'string'
    ? (() => {
      try { return JSON.parse(value); } catch { return []; }
    })()
    : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      const label = String(item.label || item.key || '').trim();
      if (!label) return null;
      return {
        key: String(item.key || `bhp-${index}`).trim(),
        label,
        hint: item.hint == null ? null : String(item.hint).trim(),
        done: item.done === true,
      };
    })
    .filter((row): row is SafetyLogRow => Boolean(row));
}

export function photoTypMatches(typ: unknown, allowed: string[]) {
  const k = String(typ ?? '')
    .toLowerCase()
    .trim();
  return allowed.includes(k);
}

export function isCheckinWorkLog(log: unknown) {
  const status = typeof log === 'object' && log !== null
    ? (log as Record<string, unknown>).status
    : log;
  const key = String(status ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();
  return key === 'check_in' || key === 'checkin';
}

export function absolutePhotoUrl(pathMaybe: unknown) {
  const raw = String(pathMaybe || '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function compactLines(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractNoteValue(value: unknown, prefixes: string[]) {
  const lowerPrefixes = prefixes.map((prefix) => prefix.toLowerCase());
  const line = compactLines(value).find((item) => {
    const lower = item.toLowerCase();
    return lowerPrefixes.some((prefix) => lower.startsWith(`${prefix}:`) || lower.startsWith(prefix));
  });
  if (!line) return '';
  const valuePart = line.includes(':') ? line.split(':').slice(1).join(':') : line;
  const clean = valuePart.trim();
  return clean === '-' ? '' : clean;
}

export function noteHasClientAccepted(value: unknown) {
  const accepted = extractNoteValue(value, ['Klient zaakceptowal', 'Klient zaakceptowaĹ‚']);
  return /^(tak|yes|true|1)$/i.test(accepted);
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function todayKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ymdFromValue(value: unknown) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function timeFromTask(task: any) {
  const direct = String(task?.godzina_rozpoczecia || '').slice(0, 5);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(direct)) return direct;
  const raw = String(task?.data_planowana || '');
  const fromDate = raw.includes('T') ? raw.split('T')[1]?.slice(0, 5) || '' : '';
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(fromDate) ? fromDate : '08:00';
}

export function isYmd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isHhMm(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function positiveNumber(value: unknown) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function equipmentIdFromReservation(row: any) {
  return String(row?.sprzet_id ?? row?.sprzetId ?? row?.equipment_id ?? '').trim();
}

export function createOfficePlanForm(task: any): OfficePlanForm {
  const reserved = Array.isArray(task?.equipment_reservations)
    ? task.equipment_reservations
    : Array.isArray(task?.rezerwacje_sprzetu)
      ? task.rezerwacje_sprzetu
      : [];
  return {
    data: ymdFromValue(task?.data_planowana) || todayKey(),
    godzina: timeFromTask(task),
    czas: task?.czas_planowany_godziny != null && String(task.czas_planowany_godziny).trim()
      ? String(task.czas_planowany_godziny)
      : '2',
    ekipaId: task?.ekipa_id != null ? String(task.ekipa_id) : '',
    sprzetIds: uniqueStrings(reserved.map(equipmentIdFromReservation).filter(Boolean)),
    note: '',
  };
}

export function isCrewRole(role: unknown) {
  const value = String(role || '').toLowerCase();
  return value === 'brygadzista' || value.includes('pomocnik');
}

export function estimatorDisplayName(row: any) {
  return String(
    row?.nazwa ||
    [row?.imie, row?.nazwisko].filter(Boolean).join(' ') ||
    row?.login ||
    `Specjalista #${row?.id || '-'}`,
  ).trim();
}

export function taskWorkflowMissingItems(task: any): WorkflowMissingItem[] {
  const rawItems = Array.isArray(task?.workflow_missing_items) ? task.workflow_missing_items : [];
  const labels = Array.isArray(task?.workflow_missing_labels) ? task.workflow_missing_labels : [];
  const items = [
    ...rawItems.map((item: any) => ({
      key: String(item?.key || item?.label || '').trim(),
      label: String(item?.label || item?.key || '').trim(),
      required: item?.required !== false,
    })),
    ...labels.map((label: unknown) => ({
      key: String(label || '').trim(),
      label: String(label || '').trim(),
      required: true,
    })),
  ].filter((item) => item.label);
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.key || item.label}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatApiWorkflowError(data: any, fallback = 'Nie udaĹ‚o siÄ™ wykonaÄ‡ akcji.') {
  const labels = Array.isArray(data?.missing_labels)
    ? data.missing_labels.map((label: unknown) => String(label || '').trim()).filter(Boolean)
    : [];
  const base = String(data?.error || fallback).trim();
  if (!labels.length) return base;
  return `${base}\n\nBrakuje:\n- ${labels.join('\n- ')}`;
}

export async function readApiErrorBody(res: Response) {
  const text = await res.text().catch(() => '');
  if (!text) return { data: {}, text: '' };
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: {}, text };
  }
}

export function workflowTargetFor(item?: WorkflowMissingItem) {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdjÄ™') || key.includes('sketch') || key.includes('szkic') || key.includes('dojazd')) {
    return 'photos';
  }
  if (key.includes('brief') || key.includes('opis') || key.includes('zakres') || key.includes('price') || key.includes('cena') || key.includes('budzet') || key.includes('budĹĽet') || key.includes('hours') || key.includes('czas')) {
    return 'field';
  }
  return 'details';
}

export function workflowPhotoFilterFor(item?: WorkflowMissingItem): PhotoFilterKey {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('szkic') || key.includes('sketch')) return 'szkic';
  if (key.includes('dojazd') || key.includes('posesja')) return 'dojazd';
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdjÄ™') || key.includes('wycena')) return 'wycena';
  return 'all';
}

export function orderPrioColors(theme: Theme) {
  return {
    Pilny: theme.danger,
    Wysoki: theme.warning,
    Normalny: theme.info,
    Niski: theme.textMuted,
  };
}

export function orderPhotoTypeMeta(theme: Theme): Record<(typeof TYP_ZDJECIA_KEYS)[number], { icon: IoniconName; color: string }> {
  return {
    wycena: { icon: 'clipboard', color: theme.accent },
    szkic: { icon: 'create', color: theme.info },
    dojazd: { icon: 'navigate', color: theme.warning },
    checkin: { icon: 'location', color: theme.info },
    przed: { icon: 'camera', color: theme.warning },
    po: { icon: 'checkmark-circle', color: theme.success },
    inne: { icon: 'images', color: theme.textSub },
  };
}
