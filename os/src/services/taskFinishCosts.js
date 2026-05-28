const DEFAULT_BRANCH_RATES = Object.freeze({
  stawka_roboczogodzina_pln: 85,
  stawka_motogodzina_pln: 120,
  stawka_dojazd_km_pln: 3.5,
  utylizacja_m3_pln: 80,
});

const CATEGORY_LABELS = Object.freeze({
  sprzet: 'Sprzet',
  paliwo: 'Paliwo',
  utylizacja: 'Utylizacja',
  inne: 'Inne',
});

function money(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
}

function positiveMoney(value, fallback = 0) {
  const n = money(value, fallback);
  return n > 0 ? n : fallback;
}

function branchRates(branch = {}) {
  return {
    stawka_roboczogodzina_pln: positiveMoney(
      branch.stawka_roboczogodzina_pln,
      DEFAULT_BRANCH_RATES.stawka_roboczogodzina_pln
    ),
    stawka_motogodzina_pln: positiveMoney(
      branch.stawka_motogodzina_pln,
      DEFAULT_BRANCH_RATES.stawka_motogodzina_pln
    ),
    stawka_dojazd_km_pln: positiveMoney(branch.stawka_dojazd_km_pln, DEFAULT_BRANCH_RATES.stawka_dojazd_km_pln),
    utylizacja_m3_pln: positiveMoney(branch.utylizacja_m3_pln, DEFAULT_BRANCH_RATES.utylizacja_m3_pln),
  };
}

function plannedHours(task = {}) {
  const hours = Number(task.czas_planowany_godziny ?? task.czas_realizacji_godz ?? 0);
  if (Number.isFinite(hours) && hours > 0) return Math.min(hours, 12);
  const minutes = Number(task.czas_obslugi_min ?? 0);
  if (Number.isFinite(minutes) && minutes > 0) return Math.min(minutes / 60, 12);
  return 2;
}

function revenueForTask(task = {}) {
  return positiveMoney(
    task.wartosc_rzeczywista ?? task.wartosc_netto_do_rozliczenia ?? task.wartosc_planowana ?? task.budzet,
    0
  );
}

function finishCostLimits(task = {}) {
  const revenue = revenueForTask(task);
  return {
    category_max: Math.max(5000, revenue * 1.5),
    total_operational_max: Math.max(10000, revenue * 3),
    material_total_max: Math.max(5000, revenue * 1.5),
  };
}

function buildFinishCostSuggestions({ task = {}, branch = {}, equipment = [] } = {}) {
  const rates = branchRates(branch);
  const hours = plannedHours(task);
  const revenue = revenueForTask(task);
  const equipmentHourlyCosts = equipment
    .map((item) => Number(item.koszt_motogodziny))
    .filter((n) => Number.isFinite(n) && n > 0);
  const equipmentRate = equipmentHourlyCosts.length
    ? equipmentHourlyCosts.reduce((sum, n) => sum + n, 0)
    : rates.stawka_motogodzina_pln;
  const hasEquipment =
    equipment.length > 0 ||
    task.rebak === true ||
    task.pila_wysiegniku === true ||
    task.kosiarka === true ||
    task.podkaszarka === true ||
    task.mulczer === true;
  const disposalUnits = task.wywoz === true || String(task.zrebki || task.drzewno || '').trim() ? 1 : 0;
  const fuelKm = 25;

  const suggestions = [
    {
      category: 'sprzet',
      label: CATEGORY_LABELS.sprzet,
      amount: hasEquipment ? money(equipmentRate * Math.max(hours, 1)) : 0,
      source: equipmentHourlyCosts.length ? 'equipment_items.koszt_motogodziny' : 'branches.stawka_motogodzina_pln',
      basis: hasEquipment
        ? `${money(hours)}h x ${money(equipmentRate)} PLN/h`
        : 'Brak zarezerwowanego lub oznaczonego sprzetu',
    },
    {
      category: 'paliwo',
      label: CATEGORY_LABELS.paliwo,
      amount: money(fuelKm * rates.stawka_dojazd_km_pln),
      source: 'branches.stawka_dojazd_km_pln',
      basis: `${fuelKm} km x ${rates.stawka_dojazd_km_pln} PLN/km`,
    },
    {
      category: 'utylizacja',
      label: CATEGORY_LABELS.utylizacja,
      amount: disposalUnits ? money(disposalUnits * rates.utylizacja_m3_pln) : 0,
      source: 'branches.utylizacja_m3_pln',
      basis: disposalUnits ? `${disposalUnits} m3 x ${rates.utylizacja_m3_pln} PLN/m3` : 'Brak oznaczonego wywozu',
    },
    {
      category: 'inne',
      label: CATEGORY_LABELS.inne,
      amount: 0,
      source: 'manual',
      basis: 'Tylko realny koszt z terenu',
    },
  ];

  return {
    branch_id: task.oddzial_id ?? branch.id ?? null,
    revenue_reference: revenue,
    planned_hours: money(hours),
    rates,
    suggestions,
    validation_limits: finishCostLimits(task),
  };
}

function normalizeOperationalCost(row = {}) {
  const category = String(row.category || row.kategoria || '').trim().toLowerCase();
  const amountRaw = row.amount ?? row.kwota ?? row.koszt;
  return {
    category,
    amount: amountRaw === '' || amountRaw == null ? null : Number(amountRaw),
  };
}

function validateFinishCostPayload({ task = {}, materialRows = [], operationalRows = [] } = {}) {
  const errors = [];
  const limits = finishCostLimits(task);
  let materialTotal = 0;
  let operationalTotal = 0;

  for (const row of Array.isArray(materialRows) ? materialRows : []) {
    const name = String(row?.nazwa || '').trim() || 'material';
    for (const key of ['ilosc', 'koszt_jednostkowy', 'koszt_laczny']) {
      if (row?.[key] === '' || row?.[key] == null) continue;
      const value = Number(row[key]);
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`Nieprawidlowy koszt materialu "${name}" (${key}).`);
      }
    }
    const total = Number(row?.koszt_laczny);
    if (Number.isFinite(total) && total > 0) materialTotal += total;
  }
  if (materialTotal > limits.material_total_max) {
    errors.push(`Koszt materialow ${money(materialTotal)} PLN przekracza limit ${money(limits.material_total_max)} PLN.`);
  }

  for (const row of Array.isArray(operationalRows) ? operationalRows : []) {
    const normalized = normalizeOperationalCost(row);
    if (!normalized.category && normalized.amount == null) continue;
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, normalized.category)) {
      errors.push(`Nieprawidlowa kategoria kosztu: ${normalized.category || 'brak'}.`);
      continue;
    }
    if (!Number.isFinite(normalized.amount) || normalized.amount < 0) {
      errors.push(`Nieprawidlowa kwota kosztu: ${CATEGORY_LABELS[normalized.category]}.`);
      continue;
    }
    if (normalized.amount > limits.category_max) {
      errors.push(
        `Koszt ${CATEGORY_LABELS[normalized.category]} ${money(normalized.amount)} PLN przekracza limit ${money(limits.category_max)} PLN.`
      );
    }
    operationalTotal += normalized.amount;
  }
  if (operationalTotal > limits.total_operational_max) {
    errors.push(
      `Suma kosztow operacyjnych ${money(operationalTotal)} PLN przekracza limit ${money(limits.total_operational_max)} PLN.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    totals: {
      material: money(materialTotal),
      operational: money(operationalTotal),
    },
    limits,
  };
}

async function getTaskFinishCostSuggestions(pool, taskId) {
  const taskResult = await pool.query(
    `SELECT t.*,
            b.stawka_roboczogodzina_pln,
            b.stawka_motogodzina_pln,
            b.stawka_dojazd_km_pln,
            b.utylizacja_m3_pln
       FROM tasks t
       LEFT JOIN branches b ON b.id = t.oddzial_id
      WHERE t.id = $1`,
    [taskId]
  );
  const task = taskResult.rows[0];
  if (!task) return null;
  let equipment;
  try {
    const equipmentResult = await pool.query(
      `SELECT e.id, e.nazwa, e.typ, e.koszt_motogodziny
         FROM equipment_reservations r
         JOIN equipment_items e ON e.id = r.sprzet_id
        WHERE r.task_id = $1
          AND LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%'`,
      [taskId]
    );
    equipment = equipmentResult.rows;
  } catch {
    equipment = undefined;
  }
  return buildFinishCostSuggestions({ task, branch: task, equipment: equipment || [] });
}

module.exports = {
  CATEGORY_LABELS,
  buildFinishCostSuggestions,
  getTaskFinishCostSuggestions,
  validateFinishCostPayload,
};
