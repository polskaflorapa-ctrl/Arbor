/** Etapy pipeline zgodne z os/src/routes/crm.js (CRM_STAGES). */
export const CRM_PIPELINE_STAGES = [
  'Lead',
  'Oględziny',
  'Do zatwierdzenia',
  'Plan ekipy',
  'W realizacji',
  'Wygrane',
  'Przegrane',
  'Techniczny',
] as const;

export type CrmPipelineStage = (typeof CRM_PIPELINE_STAGES)[number];

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
] as const;

export const CRM_CLOSED_STAGES = new Set<CrmPipelineStage>(['Przegrane', 'Techniczny']);

export function isClosedLeadStage(stage: string): boolean {
  return CRM_CLOSED_STAGES.has(stage as CrmPipelineStage);
}

export function pipelineStageIndex(stage: string): number {
  const idx = CRM_PIPELINE_STAGES.indexOf(stage as CrmPipelineStage);
  return idx >= 0 ? idx : 0;
}
