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
  przed: 'Przed praca',
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
    label: 'Sprzet i PPE',
    hint: 'Kaski, uprzeze, pila, rebak i komunikacja ekipy gotowe.',
    icon: 'construct-outline',
  },
  {
    key: 'escape',
    label: 'Droga ucieczki',
    hint: 'Ustalona strefa zrzutu, kierunek obalenia i awaryjny odwrot.',
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

export type FinishCostCategory = 'sprzet' | 'paliwo' | 'utylizacja' | 'inne';

export type FinishOperationalCosts = Record<FinishCostCategory, string>;

export type FinishCostSuggestion = {
  category: FinishCostCategory;
  label: string;
  amount: number;
  source?: string;
  basis?: string;
};

export type FinishCostSuggestions = {
  suggestions?: FinishCostSuggestion[];
  rates?: Record<string, number>;
  validation_limits?: Record<string, number>;
};

export type FinishPaymentForm = {
  forma_platnosc: 'Gotowka' | 'Przelew' | 'Faktura_VAT' | 'Brak';
  kwota_odebrana: unknown;
  faktura_vat: boolean;
  nip: unknown;
};

export type FinishPaymentValidation =
  | { ok: true; cashAmount: number | null; nip: string | null }
  | { ok: false; reason: 'cash_amount' | 'nip' };

export type FinishMoneyParseResult =
  | { ok: true; amount: number | null }
  | { ok: false };

export type FinishOperationalCostRow = {
  category: FinishCostCategory;
  amount: number;
  label: string;
  source: 'mobile_finish';
};

export type FinishMaterialUsageRow = {
  material_id?: number;
  nazwa: string;
  ilosc?: number;
  jednostka?: 'szt';
  koszt_laczny?: number;
};

export type FinishProtocolNoteInput = {
  paymentNote: unknown;
  safetyRows: Pick<SafetyLogRow, 'done' | 'label'>[];
  afterPhotosCount: number;
  unresolvedIssuesCount: number;
  hasClientSignature: boolean;
  clientSignerName?: unknown;
  finishClientAccepted: boolean;
  usageName: unknown;
  materialUsage?: FinishMaterialUsageRow[];
};

export type FinishProtocolNotes = {
  safetyProtocolNote: string;
  closeProtocolNote: string;
  noteTrim: string;
};

export type FinishBodyInput = {
  coords?: { lat?: number | null; lng?: number | null } | null;
  notes: FinishProtocolNotes;
  materialUsage?: FinishMaterialUsageRow[];
  operationalCostRows: FinishOperationalCostRow[];
  paymentForm: Pick<FinishPaymentForm, 'forma_platnosc' | 'faktura_vat'>;
  paymentValidation: Extract<FinishPaymentValidation, { ok: true }>;
  paymentNote: unknown;
};

export type PhotoEvidenceCounts = {
  fieldWycena: number;
  fieldSketch: number;
  fieldAccess: number;
  before: number;
  after: number;
  other: number;
};

export type PhotoPreviewState<T> = {
  activePhoto: T | null;
  photoList: T[];
  safeIndex: number;
  counter: string;
};

export const EMPTY_FINISH_OPERATIONAL_COSTS: FinishOperationalCosts = {
  sprzet: '',
  paliwo: '',
  utylizacja: '',
  inne: '',
};

export const FINISH_OPERATIONAL_COST_LABELS: Record<FinishCostCategory, string> = {
  sprzet: 'sprzet',
  paliwo: 'paliwo',
  utylizacja: 'utylizacja',
  inne: 'inne',
};

export const FINISH_OPERATIONAL_COST_CATEGORIES = Object.keys(
  EMPTY_FINISH_OPERATIONAL_COSTS,
) as FinishCostCategory[];

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

export function countPhotosByTypes(photos: unknown[], allowed: string[]) {
  return photos.filter((photo: any) => photoTypMatches(photo?.typ, allowed)).length;
}

export function taskPhotoEvidenceCounts(photos: unknown[]): PhotoEvidenceCounts {
  return {
    fieldWycena: countPhotosByTypes(photos, ['wycena', 'przed', 'checkin']),
    fieldSketch: countPhotosByTypes(photos, ['szkic', 'sketch']),
    fieldAccess: countPhotosByTypes(photos, ['dojazd', 'posesja', 'dojazd_posesja']),
    before: countPhotosByTypes(photos, ['przed', 'before', 'checkin']),
    after: countPhotosByTypes(photos, ['po', 'after']),
    other: countPhotosByTypes(photos, ['inne', 'other', '']),
  };
}

export function photoMatchesFilter(photo: unknown, filter: PhotoFilterKey) {
  if (filter === 'all') return true;
  if (filter === 'inne') return photoTypMatches((photo as any)?.typ, ['inne', 'other', '']);
  return photoTypMatches((photo as any)?.typ, [filter]);
}

export function filterPhotosByGalleryFilter<T>(photos: T[], filter: PhotoFilterKey): T[] {
  return photos.filter((photo) => photoMatchesFilter(photo, filter));
}

export function photoGalleryGroupKeys(filter: PhotoFilterKey): readonly PhotoTypeKey[] {
  return filter === 'all' ? TYP_ZDJECIA_KEYS : [filter];
}

export function photoIdentity(value: unknown) {
  const photo = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return String(photo.id || photo.url || photo.sciezka || '');
}

export function photoTypeKey(value: unknown): PhotoTypeKey {
  const raw = String(value || 'inne').trim();
  return TYP_ZDJECIA_KEYS.includes(raw as PhotoTypeKey) ? raw as PhotoTypeKey : 'inne';
}

export function photoTypeLabel(value: unknown, fallback = 'Zdjęcie') {
  const key = photoTypeKey(value);
  return PHOTO_TYPE_LABELS[key] || fallback;
}

export function photoPreviewState<T>(
  allPhotos: T[],
  filteredPhotos: T[],
  previewPhoto?: T | null,
): PhotoPreviewState<T> {
  const activePhoto = previewPhoto || filteredPhotos[0] || allPhotos[0] || null;
  const photoList = filteredPhotos.length ? filteredPhotos : allPhotos;
  const activeId = photoIdentity(activePhoto);
  const activeIndex = activePhoto
    ? photoList.findIndex((photo) => photoIdentity(photo) === activeId)
    : -1;
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  return {
    activePhoto,
    photoList,
    safeIndex,
    counter: photoList.length ? `${safeIndex + 1}/${photoList.length}` : '0/0',
  };
}

export function nextPreviewPhoto<T>(photoList: T[], safeIndex: number, direction: -1 | 1): T | null {
  if (!photoList.length) return null;
  const nextIndex = (safeIndex + direction + photoList.length) % photoList.length;
  return photoList[nextIndex] || null;
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
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('file://') ||
    raw.startsWith('content://') ||
    raw.startsWith('blob:')
  ) return raw;
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

export function compactLines(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeWorkflowMatch(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/Ă¤â€¦/g, 'a')
    .replace(/Ă¤â€ˇ/g, 'c')
    .replace(/Ă¤â„˘/g, 'e')
    .replace(/ĂĄâ€š/g, 'l')
    .replace(/ĂĄâ€ž/g, 'n')
    .replace(/ĂŁÂł/g, 'o')
    .replace(/ĂĄâ€ş/g, 's')
    .replace(/ĂĄÂş/g, 'z')
    .replace(/ĂĄÂĽ/g, 'z')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

export function extractNoteValue(value: unknown, prefixes: string[]) {
  const lowerPrefixes = prefixes.map((prefix) => normalizeWorkflowMatch(prefix));
  const line = compactLines(value).find((item) => {
    const lower = normalizeWorkflowMatch(item);
    return lowerPrefixes.some((prefix) => lower.startsWith(`${prefix}:`) || lower.startsWith(prefix));
  });
  if (!line) return '';
  const valuePart = line.includes(':') ? line.split(':').slice(1).join(':') : line;
  const clean = valuePart.trim();
  return clean === '-' ? '' : clean;
}

export function noteHasClientAccepted(value: unknown) {
  const accepted = extractNoteValue(value, ['Klient zaakceptowal', 'Klient zaakceptował']);
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

export function formatApiWorkflowError(data: any, fallback = 'Nie udalo sie wykonac akcji.') {
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

export function parseOptionalFinishMoney(value: unknown): FinishMoneyParseResult {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return { ok: true, amount: null };
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false };
  return { ok: true, amount: Math.round(parsed * 100) / 100 };
}

export function validateFinishPayment(form: FinishPaymentForm): FinishPaymentValidation {
  const { forma_platnosc, kwota_odebrana, faktura_vat, nip } = form;
  let cashAmount: number | null = null;
  if (forma_platnosc === 'Gotowka') {
    const parsed = parseFloat(String(kwota_odebrana).replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, reason: 'cash_amount' };
    cashAmount = parsed;
  }
  const cleanNip = String(nip || '').replace(/\s/g, '');
  if ((faktura_vat || forma_platnosc === 'Faktura_VAT') && cleanNip.length < 10) {
    return { ok: false, reason: 'nip' };
  }
  return { ok: true, cashAmount, nip: cleanNip || null };
}

export function buildFinishOperationalCostRows(
  costs: Partial<Record<FinishCostCategory, unknown>>,
  labels: Record<FinishCostCategory, string> = FINISH_OPERATIONAL_COST_LABELS,
): { ok: true; rows: FinishOperationalCostRow[] } | { ok: false; label: string } {
  const rows: FinishOperationalCostRow[] = [];
  for (const category of FINISH_OPERATIONAL_COST_CATEGORIES) {
    const parsed = parseOptionalFinishMoney(costs[category]);
    if (!parsed.ok) return { ok: false, label: labels[category] };
    if (parsed.amount == null) continue;
    rows.push({
      category,
      amount: parsed.amount,
      label: labels[category],
      source: 'mobile_finish',
    });
  }
  return { ok: true, rows };
}

export function buildFinishMaterialUsage(
  name: unknown,
  quantity: unknown,
  cost: number | null,
  materialId?: unknown,
): FinishMaterialUsageRow[] | undefined {
  const usageName = String(name || '').trim();
  if (!usageName) return undefined;
  const quantityRaw = String(quantity || '').trim().replace(',', '.');
  const usageQuantity = quantityRaw ? parseFloat(quantityRaw) : NaN;
  const parsedMaterialId = materialId != null && materialId !== '' ? Number(materialId) : NaN;
  return [
    {
      ...(Number.isInteger(parsedMaterialId) && parsedMaterialId > 0 ? { material_id: parsedMaterialId } : {}),
      nazwa: usageName.slice(0, 200),
      ...(Number.isFinite(usageQuantity) ? { ilosc: usageQuantity, jednostka: 'szt' as const } : {}),
      ...(cost != null ? { koszt_laczny: cost } : {}),
    },
  ];
}

export function buildFinishProtocolNotes(input: FinishProtocolNoteInput): FinishProtocolNotes {
  const paymentNote = String(input.paymentNote || '').trim();
  const safetyProtocolNote = [
    `BHP przed startem: ${input.safetyRows.filter((row) => row.done).length}/${input.safetyRows.length} punktow.`,
    ...input.safetyRows.map((row) => `${row.done ? 'OK' : 'BRAK'} ${row.label}`),
  ].join('\n');
  const usageName = String(input.usageName || '').trim();
  const usageQuantity = input.materialUsage?.[0]?.ilosc;
  const closeProtocolNote = [
    safetyProtocolNote,
    `Zamknięcie mobilne: zdjęcia po ${input.afterPhotosCount}; problemy otwarte ${input.unresolvedIssuesCount}.`,
    input.hasClientSignature
      ? `Odbiór klienta: podpis ${String(input.clientSignerName || 'dodany')}.`
      : input.finishClientAccepted
        ? 'Odbiór klienta: potwierdzony bez podpisu.'
        : 'Odbiór klienta: brak potwierdzenia.',
    usageName ? `Materiały: ${usageName}${usageQuantity != null ? ` (${usageQuantity} szt.)` : ''}.` : '',
  ].filter(Boolean).join('\n');
  return {
    safetyProtocolNote,
    closeProtocolNote,
    noteTrim: [paymentNote, closeProtocolNote].filter(Boolean).join('\n'),
  };
}

export function buildFinishBody(input: FinishBodyInput): Record<string, unknown> {
  const paymentNote = String(input.paymentNote || '').trim();
  return {
    lat: input.coords?.lat ?? null,
    lng: input.coords?.lng ?? null,
    notatki: input.notes.noteTrim,
    ...(input.materialUsage ? { zuzyte_materialy: input.materialUsage } : {}),
    ...(input.operationalCostRows.length ? { koszty_operacyjne: input.operationalCostRows } : {}),
    payment: {
      forma_platnosc: input.paymentForm.forma_platnosc,
      kwota_odebrana: input.paymentValidation.cashAmount,
      faktura_vat: !!input.paymentForm.faktura_vat,
      nip: input.paymentValidation.nip,
      ...(paymentNote ? { notatki: paymentNote } : {}),
    },
  };
}

export function suggestedFinishOperationalCosts(
  suggestions: FinishCostSuggestions | null | undefined,
): FinishOperationalCosts {
  const next = { ...EMPTY_FINISH_OPERATIONAL_COSTS };
  for (const item of suggestions?.suggestions || []) {
    const amount = Number(item.amount);
    if (item.category in next && Number.isFinite(amount) && amount > 0) {
      next[item.category] = String(amount);
    }
  }
  return next;
}

export function workflowTargetFor(item?: WorkflowMissingItem) {
  const key = normalizeWorkflowMatch(item?.key || item?.label || '');
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdje') || key.includes('sketch') || key.includes('szkic') || key.includes('dojazd')) {
    return 'photos';
  }
  if (key.includes('brief') || key.includes('opis') || key.includes('zakres') || key.includes('price') || key.includes('cena') || key.includes('budzet') || key.includes('hours') || key.includes('czas')) {
    return 'field';
  }
  return 'details';
}

export function workflowPhotoFilterFor(item?: WorkflowMissingItem): PhotoFilterKey {
  const key = normalizeWorkflowMatch(item?.key || item?.label || '');
  if (key.includes('szkic') || key.includes('sketch')) return 'szkic';
  if (key.includes('dojazd') || key.includes('posesja')) return 'dojazd';
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdje') || key.includes('wycena')) return 'wycena';
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
