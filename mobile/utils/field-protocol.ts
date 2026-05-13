export type FieldProtocolForm = {
  work: string[];
  equipment: string[];
  risks: string[];
  people: string;
  time: string;
  budget: string;
  discount: string;
  result: string;
  access: string;
  notes: string;
};

export type FieldProtocolPreset = {
  key: string;
  label: string;
  work: string[];
  equipment: string[];
  risks: string[];
  people: string;
  time: string;
  notes: string;
};

export const DEFAULT_FIELD_PROTOCOL: FieldProtocolForm = {
  work: ['Wycinka'],
  equipment: [],
  risks: [],
  people: '3',
  time: '',
  budget: '',
  discount: '',
  result: 'Do opracowania przez biuro',
  access: '',
  notes: '',
};

export const FIELD_PROTOCOL_MARKER = 'FORMULARZ OGLĘDZIN TERENOWYCH';

export const FIELD_PROTOCOL_WORK_OPTIONS = ['Przycinka', 'Wycinka', 'Formowanie', 'Usuwanie pnia', 'Wywóz', 'Sprzątanie'];
export const FIELD_PROTOCOL_EQUIPMENT_OPTIONS = ['Rębak', 'Podnośnik', 'Alpiniści', 'Piła spalinowa', 'Frezarka', 'Kontener'];
export const FIELD_PROTOCOL_RISK_OPTIONS = ['Linie energetyczne', 'Ogrodzenie', 'Dach / elewacja', 'Trudny dojazd', 'Ruch pieszy', 'Zgoda na wycinkę'];
export const FIELD_PROTOCOL_RESULT_OPTIONS = ['Do opracowania przez biuro', 'Klient chce termin', 'Czeka na zgodę', 'Nieopłacalne / odpuścić'];

export const FIELD_PROTOCOL_PRESETS: FieldProtocolPreset[] = [
  {
    key: 'przycinka-ogrodzenie',
    label: 'Przycinka przy ogrodzeniu',
    work: ['Przycinka', 'Sprzątanie'],
    equipment: ['Piła spalinowa'],
    risks: ['Ogrodzenie'],
    people: '3',
    time: '2',
    notes: 'Zaznaczyć na zdjęciu gałęzie nad ogrodzeniem i granicę działki.',
  },
  {
    key: 'wycinka-wywoz',
    label: 'Wycinka + wywóz',
    work: ['Wycinka', 'Wywóz', 'Sprzątanie'],
    equipment: ['Rębak', 'Piła spalinowa'],
    risks: ['Dach / elewacja'],
    people: '3',
    time: '3',
    notes: 'Zrobić zdjęcie całego drzewa i miejsca odkładania gałęzi.',
  },
  {
    key: 'pien-frezowanie',
    label: 'Pień / frezowanie',
    work: ['Usuwanie pnia', 'Sprzątanie'],
    equipment: ['Frezarka'],
    risks: ['Trudny dojazd'],
    people: '2',
    time: '1.5',
    notes: 'Dodać zdjęcie pnia z miarką albo punktem odniesienia.',
  },
  {
    key: 'trudny-dojazd',
    label: 'Trudny dojazd',
    work: ['Przycinka', 'Wywóz'],
    equipment: ['Alpiniści'],
    risks: ['Trudny dojazd', 'Ruch pieszy'],
    people: '4',
    time: '4',
    notes: 'Obowiązkowo dodać zdjęcie wjazdu, postoju auta i dojścia do drzewa.',
  },
];

export function toggleProtocolValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function mergeUniqueProtocolValues(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right]));
}

function joinOrDash(values: string[]) {
  return values.length ? values.join(', ') : '-';
}

export function buildFieldProtocolSummary(field: FieldProtocolForm, title = FIELD_PROTOCOL_MARKER) {
  const lines = [
    title,
    `Zakres prac: ${joinOrDash(field.work)}`,
    `Sprzęt / zasoby: ${joinOrDash(field.equipment)}`,
    `Ryzyka: ${joinOrDash(field.risks)}`,
    `Liczba osób: ${field.people || '-'}`,
    `Szacowany czas: ${field.time ? `${field.time} h` : '-'}`,
    `Budżet klienta / wycena: ${field.budget ? `${field.budget} PLN` : '-'}`,
    `Rabat / warunki: ${field.discount ? `${field.discount}%` : '-'}`,
    `Wynik rozmowy: ${field.result || '-'}`,
    `Dostęp / parking / uwagi posesji: ${field.access || '-'}`,
    `Dodatkowe notatki wyceniającego: ${field.notes || '-'}`,
  ];
  return lines.join('\n');
}

export function mergeProtocolNotes(existing: string | null | undefined, protocolBlock: string) {
  const current = String(existing || '').trim();
  const markerIndex = current.indexOf(FIELD_PROTOCOL_MARKER);
  const prefix = markerIndex >= 0 ? current.slice(0, markerIndex).trim() : current;
  return [prefix, protocolBlock].filter(Boolean).join('\n\n');
}
