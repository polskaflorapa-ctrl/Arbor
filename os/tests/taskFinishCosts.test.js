const {
  buildFinishCostSuggestions,
  validateFinishCostPayload,
} = require('../src/services/taskFinishCosts');

describe('taskFinishCosts', () => {
  it('builds finish suggestions from branch rates and reserved equipment', () => {
    const out = buildFinishCostSuggestions({
      task: {
        id: 10,
        oddzial_id: 2,
        wartosc_planowana: 2000,
        czas_planowany_godziny: 3,
        wywoz: true,
      },
      branch: {
        stawka_motogodzina_pln: 150,
        stawka_dojazd_km_pln: 4,
        utylizacja_m3_pln: 90,
      },
      equipment: [{ id: 7, koszt_motogodziny: 180 }],
    });

    expect(out.branch_id).toBe(2);
    expect(out.rates).toMatchObject({
      stawka_motogodzina_pln: 150,
      stawka_dojazd_km_pln: 4,
      utylizacja_m3_pln: 90,
    });
    expect(out.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'sprzet', amount: 540, source: 'equipment_items.koszt_motogodziny' }),
      expect.objectContaining({ category: 'paliwo', amount: 100 }),
      expect.objectContaining({ category: 'utylizacja', amount: 90 }),
    ]));
    expect(out.validation_limits.category_max).toBe(5000);
  });

  it('rejects negative and unrealistic finish costs', () => {
    const result = validateFinishCostPayload({
      task: { wartosc_planowana: 1000 },
      materialRows: [{ nazwa: 'Olej', koszt_laczny: -1 }],
      operationalRows: [
        { category: 'paliwo', amount: -10 },
        { category: 'sprzet', amount: 6000 },
        { category: 'dziwne', amount: 50 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Nieprawidlowy koszt materialu');
    expect(result.errors.join(' ')).toContain('Nieprawidlowa kwota kosztu');
    expect(result.errors.join(' ')).toContain('przekracza limit');
    expect(result.errors.join(' ')).toContain('Nieprawidlowa kategoria');
  });

  it('accepts realistic finish costs and returns totals', () => {
    const result = validateFinishCostPayload({
      task: { wartosc_planowana: 3000 },
      materialRows: [{ nazwa: 'Olej', koszt_laczny: 120 }],
      operationalRows: [
        { category: 'paliwo', amount: 80 },
        { category: 'utylizacja', amount: 160 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.totals).toMatchObject({ material: 120, operational: 240 });
  });
});
