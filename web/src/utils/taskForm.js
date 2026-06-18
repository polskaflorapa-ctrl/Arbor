import { TASK_STATUS } from './taskWorkflow';

export const TASK_SERVICE_TYPES = [
  'Wycinka drzew',
  'Pielęgnacja drzew',
  'Mycie / malowanie dachów',
  'Czyszczenie kostki / elewacji',
  'Ogrodnictwo',
  'Inne',
];

export const TASK_PRIORITIES = ['Niski', 'Normalny', 'Wysoki', 'Pilny'];

export const TASK_SCOPE_PRESETS = Object.freeze([
  {
    key: 'crown_pruning',
    label: 'Pielęgnacja drzew',
    serviceType: 'Pielęgnacja drzew',
    scopeLine: 'Przycinka i pielęgnacja korony zgodnie z ustaleniami z oględzin.',
  },
  {
    key: 'removal',
    label: 'Wycinka drzewa',
    serviceType: 'Wycinka drzew',
    scopeLine: 'Wycinka drzewa sekcyjnie, zabezpieczenie otoczenia i uporządkowanie terenu.',
  },
  {
    key: 'stump',
    label: 'Pniak / frezowanie',
    serviceType: 'Wycinka drzew',
    scopeLine: 'Usunięcie albo frezowanie pniaka, zasypanie urobku i oczyszczenie miejsca pracy.',
  },
  {
    key: 'roof_wash',
    label: 'Dach',
    serviceType: 'Mycie / malowanie dachów',
    scopeLine: 'Mycie lub malowanie dachu po oględzinach, z zabezpieczeniem elewacji i dojścia.',
  },
  {
    key: 'paving_facade',
    label: 'Kostka / elewacja',
    serviceType: 'Czyszczenie kostki / elewacji',
    scopeLine: 'Czyszczenie kostki brukowej albo elewacji po sprawdzeniu dojazdu, wody i odpływu.',
  },
  {
    key: 'hedge',
    label: 'Żywopłot / ogród',
    serviceType: 'Ogrodnictwo',
    scopeLine: 'Formowanie żywopłotu i prace ogrodnicze według ustalonego zakresu.',
  },
  {
    key: 'cleanup',
    label: 'Porządki / wywóz',
    serviceType: 'Inne',
    scopeLine: 'Zebranie gałęzi, wywóz odpadów zielonych i pozostawienie czystego terenu.',
  },
]);

export const TASK_EQUIPMENT_OPTIONS = Object.freeze([
  { key: 'rebak', label: 'Rębak', field: 'rebak' },
  { key: 'pila_wysiegniku', label: 'Piła na wysięgniku', field: 'pila_wysiegniku' },
  { key: 'nozyce_dlugie', label: 'Nożyce długie', field: 'nozyce_dlugie' },
  { key: 'kosiarka', label: 'Kosiarka', field: 'kosiarka' },
  { key: 'podkaszarka', label: 'Podkaszarka', field: 'podkaszarka' },
  { key: 'lopata', label: 'Łopata', field: 'lopata' },
  { key: 'mulczer', label: 'Mulczer', field: 'mulczer' },
]);

export const TASK_RISK_PRESETS = Object.freeze([
  { key: 'power', label: 'Linie / przewody', note: 'Ryzyko BHP: linie, przewody albo instalacje w strefie pracy.' },
  { key: 'access', label: 'Wąski dojazd', note: 'Ryzyko logistyczne: wąski dojazd, ograniczone miejsce dla auta albo rębaka.' },
  { key: 'property', label: 'Ogrodzenie / dach', note: 'Ryzyko szkody: ogrodzenie, dach, elewacja albo rabaty blisko zakresu.' },
  { key: 'client', label: 'Klient na miejscu', note: 'Uzgodnić z klientem strefę bezpieczną i przestawienie aut przed startem.' },
  { key: 'permit', label: 'Zgoda / decyzja', note: 'Sprawdzić zgodę albo decyzję administracyjną przed wykonaniem pracy.' },
]);

export const TASK_SETTLEMENT_OPTIONS = Object.freeze([
  { key: 'fixed', label: 'Cena za zakres', note: 'Warunki rozliczenia: cena ryczałtowa za zaakceptowany zakres.' },
  { key: 'hourly', label: 'Godzinowo', note: 'Warunki rozliczenia: rozliczenie godzinowe według realnego czasu pracy.' },
  { key: 'mixed', label: 'Zakres + dopłaty', note: 'Warunki rozliczenia: cena za zakres podstawowy, dopłaty po akceptacji klienta.' },
  { key: 'office', label: 'Do weryfikacji biura', note: 'Warunki rozliczenia: biuro potwierdza finalną cenę przed planowaniem.' },
]);

export const TASK_PRIORITY_COLORS = Object.freeze({
  Niski: 'var(--text-muted)',
  Normalny: '#1d4ed8',
  Wysoki: '#b45309',
  Pilny: 'var(--danger)',
});

export const TASK_FORM_DEFAULTS = Object.freeze({
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
  wywoz: false,
  usuwanie_pni: false,
  czas_realizacji_godz: '',
  rebak: false,
  pila_wysiegniku: false,
  nozyce_dlugie: false,
  kosiarka: false,
  podkaszarka: false,
  lopata: false,
  mulczer: false,
  ilosc_osob: '',
  arborysta: false,
  wynik: '',
  budzet: '',
  rabat: '',
  kwota_minimalna: '',
  zrebki: '',
  drzewno: '',
});

export const TASK_CREATE_REQUIRED_FIELDS = [
  'klient_nazwa',
  'adres',
  'miasto',
  'data_planowana',
];

export function createTaskFormDefaults(overrides = {}) {
  return { ...TASK_FORM_DEFAULTS, ...overrides };
}

export function appendUniqueLine(value, line) {
  const nextLine = String(line || '').trim();
  if (!nextLine) return String(value || '').trim();
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.some((item) => item.toLowerCase() === nextLine.toLowerCase())) return lines.join('\n');
  return [...lines, nextLine].join('\n');
}

function trimOrNull(value) {
  const text = String(value || '').trim();
  return text || null;
}

function intOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

export function getTaskCreateMissingFields(
  form,
  { requireBranch = false, requireEstimator = false } = {},
) {
  const required = [...TASK_CREATE_REQUIRED_FIELDS];
  if (requireBranch) required.push('oddzial_id');
  if (requireEstimator) required.push('wyceniajacy_id');

  return required.filter((field) => !String(form?.[field] || '').trim());
}

export function isTaskCreateFormValid(form, options = {}) {
  return getTaskCreateMissingFields(form, options).length === 0;
}

export function buildTaskCreatePayload(
  form,
  user,
  { initialStatus = form?.status || TASK_STATUS.NOWE, extra = {} } = {},
) {
  return {
    klient_nazwa: String(form.klient_nazwa || '').trim(),
    klient_telefon: trimOrNull(form.klient_telefon),
    klient_email: trimOrNull(form.klient_email),
    adres: String(form.adres || '').trim(),
    miasto: String(form.miasto || '').trim(),
    typ_uslugi: form.typ_uslugi || TASK_SERVICE_TYPES[0],
    status: initialStatus,
    priorytet: form.priorytet || 'Normalny',
    wartosc_planowana: form.wartosc_planowana || null,
    czas_planowany_godziny: form.czas_planowany_godziny || null,
    data_planowana: form.data_planowana,
    godzina_rozpoczecia: form.godzina_rozpoczecia || null,
    opis_pracy: trimOrNull(form.opis_pracy),
    opis: trimOrNull(form.opis) || trimOrNull(form.opis_pracy),
    notatki_wewnetrzne: trimOrNull(form.notatki_wewnetrzne) || trimOrNull(form.notatki),
    notatki: trimOrNull(form.notatki),
    oddzial_id: form.oddzial_id || user?.oddzial_id || null,
    ekipa_id: intOrNull(form.ekipa_id),
    kierownik_id: intOrNull(form.kierownik_id),
    wyceniajacy_id: intOrNull(form.wyceniajacy_id),
    pin_lat: form.pin_lat || null,
    pin_lng: form.pin_lng || null,
    ankieta_uproszczona: form.ankieta_uproszczona === true,
    wywoz: form.wywoz === true,
    usuwanie_pni: form.usuwanie_pni === true,
    czas_realizacji_godz: form.czas_realizacji_godz || null,
    rebak: form.rebak === true,
    pila_wysiegniku: form.pila_wysiegniku === true,
    nozyce_dlugie: form.nozyce_dlugie === true,
    kosiarka: form.kosiarka === true,
    podkaszarka: form.podkaszarka === true,
    lopata: form.lopata === true,
    mulczer: form.mulczer === true,
    ilosc_osob: form.ilosc_osob || null,
    arborysta: form.arborysta === true,
    wynik: trimOrNull(form.wynik),
    budzet: form.budzet || null,
    rabat: form.rabat || null,
    kwota_minimalna: form.kwota_minimalna || null,
    zrebki: trimOrNull(form.zrebki),
    drzewno: trimOrNull(form.drzewno),
    ...extra,
  };
}
