import {
  CRM_CLOSE_REASONS,
  isClosedLeadStage,
  isTechnicalCloseReason,
  stageForCloseReason,
} from './crmLeadClosure';

describe('crmLeadClosure', () => {
  it('keeps all required close reasons available', () => {
    expect(CRM_CLOSE_REASONS).toEqual([
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
    ]);
  });

  it('routes junk reasons to the technical funnel', () => {
    expect(isTechnicalCloseReason('Dubl')).toBe(true);
    expect(isTechnicalCloseReason('Pomyłka')).toBe(true);
    expect(isTechnicalCloseReason('Kontakt w sprawie oferty pracy')).toBe(true);
    expect(stageForCloseReason('Nie pracujemy w tym rejonie')).toBe('Techniczny');
  });

  it('keeps real sales losses in lost stage', () => {
    expect(isTechnicalCloseReason('Drogo')).toBe(false);
    expect(stageForCloseReason('Drogo')).toBe('Przegrane');
    expect(isClosedLeadStage('Przegrane')).toBe(true);
    expect(isClosedLeadStage('Techniczny')).toBe(true);
  });
});
