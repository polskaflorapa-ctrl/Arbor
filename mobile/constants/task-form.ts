import { TASK_STATUS } from './task-workflow';

export const TASK_SERVICE_TYPES = [
  'Wycinka',
  'Pielęgnacja',
  'Ogrodnictwo',
  'Frezowanie pniaków',
  'Inne',
] as const;

export const TASK_PRIORITIES = ['Niski', 'Normalny', 'Wysoki', 'Pilny'] as const;

export type TaskServiceType = typeof TASK_SERVICE_TYPES[number];
export type TaskPriority = typeof TASK_PRIORITIES[number];

export type TaskFormState = {
  klient_nazwa: string;
  klient_telefon: string;
  klient_email: string;
  adres: string;
  miasto: string;
  typ_uslugi: string;
  status: string;
  priorytet: string;
  data_planowana: string;
  godzina_rozpoczecia: string;
  wartosc_planowana: string;
  czas_planowany_godziny: string;
  oddzial_id: string;
  ekipa_id: string;
  kierownik_id: string;
  wyceniajacy_id: string;
  opis_pracy: string;
  opis: string;
  notatki_wewnetrzne: string;
  notatki: string;
  pin_lat: string;
  pin_lng: string;
  ankieta_uproszczona: boolean;
};

export const TASK_FORM_DEFAULTS: TaskFormState = {
  klient_nazwa: '',
  klient_telefon: '',
  klient_email: '',
  adres: '',
  miasto: '',
  typ_uslugi: TASK_SERVICE_TYPES[0],
  status: TASK_STATUS.NOWE,
  priorytet: 'Normalny',
  data_planowana: '',
  godzina_rozpoczecia: '',
  wartosc_planowana: '',
  czas_planowany_godziny: '',
  oddzial_id: '',
  ekipa_id: '',
  kierownik_id: '',
  wyceniajacy_id: '',
  opis_pracy: '',
  opis: '',
  notatki_wewnetrzne: '',
  notatki: '',
  pin_lat: '',
  pin_lng: '',
  ankieta_uproszczona: true,
};

export const TASK_CREATE_REQUIRED_FIELDS = [
  'klient_nazwa',
  'adres',
  'miasto',
  'data_planowana',
] as const;

export function createTaskFormDefaults(overrides: Partial<TaskFormState> = {}) {
  return { ...TASK_FORM_DEFAULTS, ...overrides };
}

function trimOrNull(value: unknown) {
  const text = String(value || '').trim();
  return text || null;
}

function intOrNull(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

export function getTaskCreateMissingFields(
  form: Partial<TaskFormState>,
  options: { requireBranch?: boolean; requireEstimator?: boolean } = {},
) {
  const required: string[] = [...TASK_CREATE_REQUIRED_FIELDS];
  if (options.requireBranch) required.push('oddzial_id');
  if (options.requireEstimator) required.push('wyceniajacy_id');
  return required.filter((field) => !String((form as Record<string, unknown>)?.[field] || '').trim());
}

export function isTaskCreateFormValid(
  form: Partial<TaskFormState>,
  options: { requireBranch?: boolean; requireEstimator?: boolean } = {},
) {
  return getTaskCreateMissingFields(form, options).length === 0;
}

export function buildTaskCreatePayload(
  form: Partial<TaskFormState>,
  user?: { oddzial_id?: string | number | null } | null,
  options: { initialStatus?: string; extra?: Record<string, unknown> } = {},
) {
  return {
    klient_nazwa: String(form.klient_nazwa || '').trim(),
    klient_telefon: trimOrNull(form.klient_telefon),
    klient_email: trimOrNull(form.klient_email),
    adres: String(form.adres || '').trim(),
    miasto: String(form.miasto || '').trim(),
    typ_uslugi: form.typ_uslugi || TASK_SERVICE_TYPES[0],
    status: options.initialStatus || form.status || TASK_STATUS.NOWE,
    priorytet: form.priorytet || 'Normalny',
    wartosc_planowana: form.wartosc_planowana || null,
    czas_planowany_godziny: form.czas_planowany_godziny || null,
    data_planowana: form.data_planowana,
    godzina_rozpoczecia: form.godzina_rozpoczecia || null,
    opis_pracy: trimOrNull(form.opis_pracy),
    opis: trimOrNull(form.opis),
    notatki_wewnetrzne: trimOrNull(form.notatki_wewnetrzne),
    notatki: trimOrNull(form.notatki),
    oddzial_id: form.oddzial_id || user?.oddzial_id || null,
    ekipa_id: intOrNull(form.ekipa_id),
    kierownik_id: intOrNull(form.kierownik_id),
    wyceniajacy_id: intOrNull(form.wyceniajacy_id),
    pin_lat: form.pin_lat || null,
    pin_lng: form.pin_lng || null,
    ankieta_uproszczona: form.ankieta_uproszczona === true,
    ...options.extra,
  };
}
