export const CRM_LEAD_STAGES = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane', 'Techniczny'];

export const CRM_CLOSE_REASONS = [
  'Rezygnacja klienta',
  'Drogo',
  'Znaleźli szybszy termin oględzin',
  'Znaleźli szybszą realizację',
  'Znaleźli taniej',
  'Pomyłka',
  'Praca innego miasta',
  'Nie odbiera',
  'Dubl',
  'Nie pracujemy w tym rejonie',
  'Nie wykonujemy podobnych prac',
  'Informacja dla znajomych',
  'Kontakt w sprawie oferty pracy',
];

export const CRM_TECHNICAL_CLOSE_REASONS = new Set([
  'Pomyłka',
  'Praca innego miasta',
  'Dubl',
  'Nie pracujemy w tym rejonie',
  'Nie wykonujemy podobnych prac',
  'Informacja dla znajomych',
  'Kontakt w sprawie oferty pracy',
]);

export const CRM_CLOSED_STAGES = new Set(['Przegrane', 'Techniczny']);

export function isClosedLeadStage(stage) {
  return CRM_CLOSED_STAGES.has(String(stage || '').trim());
}

export function isTechnicalCloseReason(reason) {
  return CRM_TECHNICAL_CLOSE_REASONS.has(String(reason || '').trim());
}

export function stageForCloseReason(reason) {
  return isTechnicalCloseReason(reason) ? 'Techniczny' : 'Przegrane';
}
