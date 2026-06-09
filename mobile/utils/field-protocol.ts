export type FieldProtocolForm = {
  work: string[];
  equipment: string[];
  risks: string[];
  haul: boolean;
  stumpRemoval: boolean;
  people: string;
  time: string;
  budget: string;
  discount: string;
  minPrice: string;
  acceptedPrice: string;
  chips: string;
  wood: string;
  arborist: string;
  workDetails: string;
  banner: boolean;
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
  haul: false,
  stumpRemoval: false,
  people: '3',
  time: '',
  budget: '',
  discount: '',
  minPrice: '',
  acceptedPrice: '',
  chips: '',
  wood: '',
  arborist: '',
  workDetails: '',
  banner: false,
  result: 'Do opracowania przez biuro',
  access: '',
  notes: '',
};

export const FIELD_PROTOCOL_MARKER = 'FORMULARZ OGLĘDZIN TERENOWYCH';

export const FIELD_PROTOCOL_WORK_OPTIONS = ['Przycinka', 'Wycinka', 'Formowanie', 'Usuwanie pnia', 'Wywóz', 'Sprzątanie'];
export const FIELD_PROTOCOL_EQUIPMENT_OPTIONS = ['Rębak', 'Podnośnik', 'Alpiniści', 'Piła spalinowa', 'Frezarka', 'Kontener'];
export const FIELD_PROTOCOL_RISK_OPTIONS = ['Brak szczegolnych ryzyk', 'Linie energetyczne', 'Ogrodzenie', 'Dach / elewacja', 'Trudny dojazd', 'Ruch pieszy', 'Zgoda na wycinkę'];
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

function yesNo(value: boolean) {
  return value ? 'tak' : 'nie';
}

function protocolHasEquipment(field: FieldProtocolForm, values: string[]) {
  return values.some((value) => field.equipment.includes(value));
}

export function getFieldProtocolBooleans(field: FieldProtocolForm) {
  return {
    wywoz: field.haul || field.work.includes('Wywóz') || field.work.includes('Wywoz'),
    usuwanie_pni: field.stumpRemoval || field.work.includes('Usuwanie pnia'),
    rebak: protocolHasEquipment(field, ['Rębak', 'Rebak']),
    pila_wysiegniku: protocolHasEquipment(field, ['Piła na wysięgniku', 'Pila na wysiegniku', 'Wysięgnik / piła na wysięgniku', 'Wysiegnik / pila na wysiegniku', 'Podnośnik', 'Podnosnik']),
    nozyce_dlugie: protocolHasEquipment(field, ['Nożyce długie', 'Nozyce dlugie', 'Długie nożyce', 'Dlugie nozyce']),
    kosiarka: protocolHasEquipment(field, ['Kosiarka']),
    podkaszarka: protocolHasEquipment(field, ['Kosa ręczna', 'Kosa reczna', 'Podkaszarka']),
    lopata: protocolHasEquipment(field, ['Łopata', 'Lopata']),
    mulczer: protocolHasEquipment(field, ['Mulczer']),
    arborysta: Boolean(field.arborist.trim()) || protocolHasEquipment(field, ['Arborysta', 'Alpiniści', 'Alpinisci']),
  };
}

export function buildFieldProtocolWorkDescription(field: FieldProtocolForm) {
  return [
    field.work.length ? field.work.join(', ') : '',
    field.workDetails.trim(),
  ].filter(Boolean).join(' - ');
}

export function buildFieldProtocolTaskExtra(field: FieldProtocolForm) {
  const flags = getFieldProtocolBooleans(field);
  const workDescription = buildFieldProtocolWorkDescription(field);
  return {
    opis_pracy: workDescription || null,
    opis: workDescription || null,
    wywoz: flags.wywoz,
    usuwanie_pni: flags.usuwanie_pni,
    czas_realizacji_godz: field.time || null,
    rebak: flags.rebak,
    pila_wysiegniku: flags.pila_wysiegniku,
    nozyce_dlugie: flags.nozyce_dlugie,
    kosiarka: flags.kosiarka,
    podkaszarka: flags.podkaszarka,
    lopata: flags.lopata,
    mulczer: flags.mulczer,
    ilosc_osob: field.people || null,
    arborysta: flags.arborysta,
    wynik: field.result || null,
    budzet: field.budget || null,
    rabat: field.discount || null,
    kwota_minimalna: field.minPrice || null,
    zrebki: field.chips || null,
    drzewno: field.wood || null,
  };
}

export function buildFieldProtocolSummary(field: FieldProtocolForm, title = FIELD_PROTOCOL_MARKER) {
  const flags = getFieldProtocolBooleans(field);
  const workDescription = buildFieldProtocolWorkDescription(field);
  const lines = [
    title,
    `1. Opis: ${workDescription || joinOrDash(field.work)}`,
    `2. Wywoz: ${yesNo(flags.wywoz)}`,
    `3. Usuwanie pni: ${yesNo(flags.usuwanie_pni)}`,
    `4. Czas wykonania: ${field.time || '-'}`,
    `5. Szczegoly pracy: ${field.workDetails || '-'}`,
    `6. Rebak: ${yesNo(flags.rebak)}`,
    `7. Wysiegnik / pila na wysiegniku: ${yesNo(flags.pila_wysiegniku)}`,
    `8. Dlugie nozyce: ${yesNo(flags.nozyce_dlugie)}`,
    `9. Liczba osob: ${field.people || '-'}`,
    `10. Rezultat: ${field.result || '-'}`,
    `11. Budzet: ${field.budget || '-'}`,
    `12. Minimalna cena: ${field.minPrice || '-'}`,
    `13. Znizka: ${field.discount || '-'}`,
    `14. Zrebki: ${field.chips || '-'}`,
    `15. Drewno: ${field.wood || '-'}`,
    `16. Arborysta: ${field.arborist || yesNo(flags.arborysta)}`,
    `17. Kosiarka: ${yesNo(flags.kosiarka)}`,
    `18. Kosa reczna: ${yesNo(flags.podkaszarka)}`,
    `19. Baner: ${yesNo(field.banner)}`,
    `20. Cena, na ktora zgadza sie klient: ${field.acceptedPrice || '-'}`,
    `21. Lopata: ${yesNo(flags.lopata)}`,
    `22. Mulczer: ${yesNo(flags.mulczer)}`,
    `Ryzyka: ${joinOrDash(field.risks)}`,
    `Dostep / parking / uwagi posesji: ${field.access || '-'}`,
    `Dodatkowe notatki specjalisty oględzin: ${field.notes || '-'}`,
  ];
  return lines.join('\n');
}

export function mergeProtocolNotes(existing: string | null | undefined, protocolBlock: string) {
  const current = String(existing || '').trim();
  const markerIndex = current.indexOf(FIELD_PROTOCOL_MARKER);
  const prefix = markerIndex >= 0 ? current.slice(0, markerIndex).trim() : current;
  return [prefix, protocolBlock].filter(Boolean).join('\n\n');
}
