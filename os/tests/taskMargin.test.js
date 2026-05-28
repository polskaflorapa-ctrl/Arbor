const {
  calculateTaskMargin,
  isLowMarginRisk,
  money,
  percent,
} = require('../src/services/taskMargin');

describe('taskMargin service', () => {
  it('calculates revenue, cost buckets, gross margin and percent from task settlement data', () => {
    const margin = calculateTaskMargin({
      wartosc_netto_do_rozliczenia: '2160.00',
      rozliczenie_koszt_pomocnikow: '200',
      rozliczenie_wynagrodzenie_brygadzisty: '270',
      equipment_cost: '120.55',
      fuel_cost: '50',
      material_cost: '25.49',
      disposal_cost: '30',
    });

    expect(margin).toMatchObject({
      revenue_net: 2160,
      total_known_cost: 696.04,
      gross_margin: 1463.96,
      margin_pct: 67.8,
      costs: {
        direct_labor_cost: 470,
        helper_cost: 200,
        crew_lead_pay: 270,
        equipment_cost: 120.55,
        fuel_cost: 50,
        material_cost: 25.49,
        disposal_cost: 30,
      },
    });
  });

  it('uses explicit margin when the source record already has an approved value', () => {
    const margin = calculateTaskMargin({
      revenue_net: 1000,
      total_known_cost: 900,
      marza_pct: '12.34',
    });

    expect(margin.margin_pct).toBe(12.3);
    expect(margin.gross_margin).toBe(100);
  });

  it('detects low margin risk from known cost ratio', () => {
    expect(isLowMarginRisk(calculateTaskMargin({ revenue_net: 1000, total_known_cost: 800 }))).toBe(true);
    expect(isLowMarginRisk(calculateTaskMargin({ revenue_net: 1000, total_known_cost: 799 }))).toBe(false);
  });

  it('detects low margin risk from branch percentage threshold', () => {
    expect(isLowMarginRisk({ revenue_net: 1000, total_known_cost: 880, marginThresholdPct: 15 })).toBe(true);
    expect(isLowMarginRisk({ revenue_net: 1000, total_known_cost: 800, marginThresholdPct: 15 })).toBe(false);
  });

  it('rounds money and percent consistently', () => {
    expect(money('12.345')).toBe(12.35);
    expect(percent('78.24')).toBe(78.2);
  });
});
