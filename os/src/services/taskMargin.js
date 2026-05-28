function toNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value, fallback = 0) {
  const n = toNumber(value);
  if (n == null) return fallback;
  return Math.round(n * 100) / 100;
}

function percent(value) {
  const n = toNumber(value);
  if (n == null) return null;
  return Math.round(n * 10) / 10;
}

function firstNumber(source, keys, fallback = null) {
  if (!source) return fallback;
  for (const key of keys) {
    const n = toNumber(source[key]);
    if (n != null) return n;
  }
  return fallback;
}

function calculateTaskMargin(input = {}) {
  const revenue = money(firstNumber(input, [
    'revenue_net',
    'revenue',
    'wartosc_netto_do_rozliczenia',
    'rozliczenie_wartosc_netto',
    'wartosc_rzeczywista',
    'wartosc_planowana',
  ]));

  const helperCost = money(firstNumber(input, ['helper_cost', 'koszt_pomocnikow', 'rozliczenie_koszt_pomocnikow']));
  const crewLeadPay = money(firstNumber(input, ['crew_lead_pay', 'wynagrodzenie_brygadzisty', 'rozliczenie_wynagrodzenie_brygadzisty']));
  const directLaborCost = money(
    firstNumber(input, ['direct_labor_cost', 'labor_cost'], helperCost + crewLeadPay)
  );
  const equipmentCost = money(firstNumber(input, ['equipment_cost', 'sprzet_cost', 'koszt_sprzetu']));
  const fuelCost = money(firstNumber(input, ['fuel_cost', 'paliwo_cost', 'koszt_paliwa']));
  const materialCost = money(firstNumber(input, ['material_cost', 'materials_cost', 'koszt_materialow']));
  const disposalCost = money(firstNumber(input, ['disposal_cost', 'utylizacja_cost', 'koszt_utylizacji']));
  const otherCost = money(firstNumber(input, ['other_cost', 'koszt_inne']));
  const totalKnownCost = money(
    firstNumber(input, ['total_known_cost'], directLaborCost + equipmentCost + fuelCost + materialCost + disposalCost + otherCost)
  );
  const explicitMargin = percent(firstNumber(input, ['margin_pct', 'marza_pct', 'fallback_margin_pct']));
  const marginPct = explicitMargin != null
    ? explicitMargin
    : revenue > 0
      ? percent(((revenue - totalKnownCost) / revenue) * 100)
      : null;

  return {
    revenue_net: revenue,
    costs: {
      direct_labor_cost: directLaborCost,
      helper_cost: helperCost,
      crew_lead_pay: crewLeadPay,
      equipment_cost: equipmentCost,
      fuel_cost: fuelCost,
      material_cost: materialCost,
      disposal_cost: disposalCost,
      other_cost: otherCost,
    },
    total_known_cost: totalKnownCost,
    gross_margin: money(revenue - totalKnownCost),
    margin_pct: marginPct,
  };
}

function isLowMarginRisk(margin, thresholdCostRatio = 0.8) {
  const revenue = toNumber(margin?.revenue_net);
  const cost = toNumber(margin?.total_known_cost);
  if (revenue == null || cost == null || revenue <= 0) return false;
  const marginThresholdPct = toNumber(margin?.marginThresholdPct ?? margin?.threshold_pct);
  if (marginThresholdPct != null) {
    return ((revenue - cost) / revenue) * 100 < marginThresholdPct;
  }
  return cost / revenue >= thresholdCostRatio;
}

module.exports = {
  calculateTaskMargin,
  isLowMarginRisk,
  money,
  percent,
  toNumber,
};
