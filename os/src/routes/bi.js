/**
 * BI (Business Intelligence) routes — director-level analytics
 *
 * All endpoints require Dyrektor / Administrator / Prezes.
 * Kierownik gets branch-scoped data only.
 *
 * GET /api/bi/overview          — headline KPIs
 * GET /api/bi/revenue-trend     — monthly revenue + task count (last N months)
 * GET /api/bi/branch-comparison — per-branch KPI table
 * GET /api/bi/service-mix       — revenue split by typ_uslugi
 * GET /api/bi/team-performance  — team ranking with revenue contribution
 * GET /api/bi/funnel            — wyceny → zlecenia conversion
 */

const express = require('express');
const pool = require('../config/database');
const { authMiddleware, isDyrektorOrAdmin, isKierownik, scopedOddzialId } = require('../middleware/auth');
const { calculateTaskMargin } = require('../services/taskMargin');

const router = express.Router();
router.use(authMiddleware);

function canViewBI(user) {
  return isDyrektorOrAdmin(user) || isKierownik(user) || String(user?.rola || '') === 'Dyspozytor';
}

function canViewTaskFinance(user) {
  return isDyrektorOrAdmin(user);
}

const TASK_FINANCIAL_FIELDS = [
  'wartosc_planowana',
  'wartosc_rzeczywista',
  'wartosc_netto_do_rozliczenia',
  'revenue_net',
  'rozliczenie_id',
  'rozliczenie_wartosc_brutto',
  'rozliczenie_wartosc_netto',
  'koszt_pomocnikow',
  'wynagrodzenie_brygadzisty',
  'koszt_sprzetu',
  'koszt_paliwa',
  'koszt_materialow',
  'koszt_utylizacji',
  'koszt_inne',
  'koszt_sprzetu_count',
  'koszt_paliwa_count',
  'koszt_materialow_count',
  'koszt_utylizacji_count',
  'koszt_inne_count',
];

function buildTaskDrilldownRow(row, user) {
  const result = {
    ...row,
    wartosc_planowana: row.wartosc_planowana == null ? null : Number(row.wartosc_planowana),
    wartosc_rzeczywista: row.wartosc_rzeczywista == null ? null : Number(row.wartosc_rzeczywista),
    wartosc_netto_do_rozliczenia: row.wartosc_netto_do_rozliczenia == null ? null : Number(row.wartosc_netto_do_rozliczenia),
    financials: buildTaskFinancialDrilldown(row),
  };

  if (canViewTaskFinance(user)) return result;

  for (const key of TASK_FINANCIAL_FIELDS) delete result[key];
  result.financials = null;
  return result;
}

function scopeClause(branchId, paramIndex, alias = 't') {
  if (!branchId) return { clause: '', params: [] };
  return { clause: ` AND ${alias}.oddzial_id = $${paramIndex}`, params: [branchId] };
}

function costSource(key, label, value, source, status = 'ok') {
  return { key, label, value, source, status };
}

function buildTaskFinancialDrilldown(row) {
  const margin = calculateTaskMargin({
    revenue_net: row.revenue_net,
    helper_cost: row.koszt_pomocnikow,
    crew_lead_pay: row.wynagrodzenie_brygadzisty,
    equipment_cost: row.koszt_sprzetu,
    fuel_cost: row.koszt_paliwa,
    material_cost: row.koszt_materialow,
    disposal_cost: row.koszt_utylizacji,
    other_cost: row.koszt_inne,
  });
  const hasSettlement = Boolean(row.rozliczenie_id);
  const missing = [];
  if (!hasSettlement) missing.push('rozliczenie');
  if (!Number(row.koszt_sprzetu_count || 0)) missing.push('sprzet');
  if (!Number(row.koszt_paliwa_count || 0)) missing.push('paliwo');
  if (!Number(row.koszt_materialow_count || 0)) missing.push('materialy');
  if (!Number(row.koszt_utylizacji_count || 0)) missing.push('utylizacja');
  if (!Number(row.koszt_inne_count || 0)) missing.push('inne');
  const marginConfidence = margin.revenue_net <= 0
    ? 'no_revenue'
    : missing.length >= 3
      ? 'high_risk_margin'
      : missing.length === 2
        ? 'medium_risk_margin'
        : missing.length === 1
          ? 'low_risk_margin'
          : 'complete_enough';

  return {
    revenue_net: margin.revenue_net,
    direct_labor_cost: margin.costs.direct_labor_cost,
    helper_cost: margin.costs.helper_cost,
    crew_lead_pay: margin.costs.crew_lead_pay,
    equipment_cost: margin.costs.equipment_cost,
    fuel_cost: margin.costs.fuel_cost,
    material_cost: margin.costs.material_cost,
    disposal_cost: margin.costs.disposal_cost,
    other_cost: margin.costs.other_cost,
    total_known_cost: margin.total_known_cost,
    gross_margin: margin.gross_margin,
    margin_pct: margin.margin_pct,
    complete: missing.length === 0,
    missing_cost_fields: missing,
    margin_confidence: marginConfidence,
    note: hasSettlement
      ? 'Marza liczona ze znanych kosztow z rozliczenia i kosztow operacyjnych zapisanych przy finish.'
      : 'Brak rozliczenia zlecenia. Marza opiera sie tylko na znanym przychodzie, bez kosztow operacyjnych.',
    cost_sources: [
      costSource('direct_labor_cost', 'Robocizna lacznie', margin.costs.direct_labor_cost, 'task_rozliczenie', hasSettlement ? 'ok' : 'missing'),
      costSource('helper_cost', 'Pomocnicy', margin.costs.helper_cost, 'task_rozliczenie.koszt_pomocnikow', hasSettlement ? 'ok' : 'missing'),
      costSource('crew_lead_pay', 'Brygadzista', margin.costs.crew_lead_pay, 'task_rozliczenie.wynagrodzenie_brygadzisty', hasSettlement ? 'ok' : 'missing'),
      costSource('equipment_cost', 'Sprzet', margin.costs.equipment_cost, 'task_operational_costs.sprzet', Number(row.koszt_sprzetu_count || 0) ? 'ok' : 'missing'),
      costSource('fuel_cost', 'Paliwo', margin.costs.fuel_cost, 'task_operational_costs.paliwo', Number(row.koszt_paliwa_count || 0) ? 'ok' : 'missing'),
      costSource('material_cost', 'Materialy', margin.costs.material_cost, 'task_finish_material_usage.koszt_laczny', Number(row.koszt_materialow_count || 0) ? 'ok' : 'missing'),
      costSource('disposal_cost', 'Utylizacja', margin.costs.disposal_cost, 'task_operational_costs.utylizacja', Number(row.koszt_utylizacji_count || 0) ? 'ok' : 'missing'),
      costSource('other_cost', 'Inne', margin.costs.other_cost, 'task_operational_costs.inne', Number(row.koszt_inne_count || 0) ? 'ok' : 'missing'),
    ],
  };
}

function profitabilityTone(marginPct, thresholdPct) {
  if (marginPct == null) return 'unknown';
  if (marginPct < thresholdPct) return 'danger';
  if (marginPct < thresholdPct + 10) return 'warning';
  return 'success';
}

function scoreFromMetrics({ completionPct = 0, marginPct = 0, overdue = 0, tasks = 0, dataQualityPct = 0 }) {
  const overduePenalty = tasks > 0 ? Math.min(30, Math.round((overdue / tasks) * 100)) : 0;
  return Math.max(0, Math.min(100, Math.round(
    completionPct * 0.35
    + Math.max(0, Math.min(100, marginPct)) * 0.35
    + dataQualityPct * 0.2
    + (100 - overduePenalty) * 0.1
  )));
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return asStringArray(parsed);
    } catch (parseErr) {
      void parseErr;
      // PostgreSQL text[] can arrive from mocks as a simple comma-separated string.
    }
    return trimmed
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((item) => item.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  return [];
}

function missingCompetencies(required, available) {
  const availableSet = new Set(asStringArray(available).map((item) => item.toLowerCase()));
  return asStringArray(required).filter((item) => !availableSet.has(item.toLowerCase()));
}

// ─── GET /api/bi/overview ────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const { clause: bc, params: bp } = scopeClause(branchId, 2);

  try {
    const [tasks, quotes, prev] = await Promise.all([
      // Current period tasks
      pool.query(
        `SELECT
           COUNT(*)                                                          AS tasks_total,
           COUNT(*) FILTER (WHERE status = 'Zakonczone')                    AS tasks_done,
           COUNT(*) FILTER (WHERE status NOT IN ('Zakonczone','Anulowane')
                             AND data_planowana < NOW())                     AS tasks_overdue,
           COUNT(*) FILTER (WHERE status NOT IN ('Zakonczone','Anulowane')
                             AND ekipa_id IS NULL)                           AS tasks_unassigned,
           COALESCE(SUM(wartosc_planowana) FILTER (WHERE status != 'Anulowane'), 0) AS revenue_planned,
           COALESCE(SUM(wartosc_rzeczywista) FILTER (WHERE status = 'Zakonczone'), 0) AS revenue_actual
         FROM tasks t
         WHERE data_planowana >= NOW() - INTERVAL '1 day' * $1 ${bc}`,
        [days, ...bp]
      ),
      // Quotation → task conversion (wyceny scoped via autor_id → users.oddzial_id)
      pool.query(
        `SELECT
           COUNT(w.id)                                                         AS quotes_total,
           COUNT(w.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM tasks t WHERE t.source_wycena_id = w.id
           ))                                                                  AS quotes_converted
         FROM wyceny w
         LEFT JOIN users u ON u.id = w.autor_id
         WHERE w.created_at >= NOW() - INTERVAL '1 day' * $1
         ${branchId ? 'AND u.oddzial_id = $2' : ''}`,
        branchId ? [days, branchId] : [days]
      ),
      // Previous period for delta
      pool.query(
        `SELECT
           COALESCE(SUM(wartosc_planowana) FILTER (WHERE status != 'Anulowane'), 0) AS revenue_planned,
           COUNT(*)                                                                  AS tasks_total
         FROM tasks t
         WHERE data_planowana >= NOW() - INTERVAL '1 day' * $1 * 2
           AND data_planowana <  NOW() - INTERVAL '1 day' * $1
           ${bc}`,
        [days, ...bp]
      ),
    ]);

    const cur = tasks.rows[0];
    const q = quotes.rows[0];
    const prv = prev.rows[0];

    const revDelta = prv.revenue_planned > 0
      ? Math.round(((cur.revenue_planned - prv.revenue_planned) / prv.revenue_planned) * 100)
      : null;
    const tasksDelta = prv.tasks_total > 0
      ? Math.round(((cur.tasks_total - prv.tasks_total) / prv.tasks_total) * 100)
      : null;

    res.json({
      period_days: days,
      tasks_total:      Number(cur.tasks_total),
      tasks_done:       Number(cur.tasks_done),
      tasks_overdue:    Number(cur.tasks_overdue),
      tasks_unassigned: Number(cur.tasks_unassigned),
      completion_pct:   cur.tasks_total > 0 ? Math.round((cur.tasks_done / cur.tasks_total) * 100) : 0,
      revenue_planned:  Math.round(Number(cur.revenue_planned)),
      revenue_actual:   Math.round(Number(cur.revenue_actual)),
      revenue_delta_pct: revDelta,
      tasks_delta_pct:   tasksDelta,
      quotes_total:     Number(q.quotes_total),
      quotes_converted: Number(q.quotes_converted),
      conversion_pct:   q.quotes_total > 0 ? Math.round((q.quotes_converted / q.quotes_total) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bi/revenue-trend ───────────────────────────────────────────────
router.get('/revenue-trend', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const { clause: bc, params: bp } = scopeClause(branchId, 2);

  try {
    const r = await pool.query(
      `SELECT
         to_char(date_trunc('month', data_planowana), 'YYYY-MM') AS month,
         COUNT(*) FILTER (WHERE status != 'Anulowane')           AS tasks_count,
         COUNT(*) FILTER (WHERE status = 'Zakonczone')           AS tasks_done,
         COALESCE(SUM(wartosc_planowana) FILTER (WHERE status != 'Anulowane'), 0) AS revenue_planned,
         COALESCE(SUM(wartosc_rzeczywista) FILTER (WHERE status = 'Zakonczone'), 0) AS revenue_actual
       FROM tasks t
       WHERE data_planowana >= date_trunc('month', NOW()) - INTERVAL '1 month' * ($1 - 1)
         AND data_planowana <  date_trunc('month', NOW()) + INTERVAL '1 month'
         ${bc}
       GROUP BY 1
       ORDER BY 1`,
      [months, ...bp]
    );

    res.json(r.rows.map(row => ({
      month:          row.month,
      tasks_count:    Number(row.tasks_count),
      tasks_done:     Number(row.tasks_done),
      revenue_planned: Math.round(Number(row.revenue_planned)),
      revenue_actual:  Math.round(Number(row.revenue_actual)),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bi/branch-comparison ───────────────────────────────────────────
router.get('/branch-comparison', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);

  const params = [days];
  const branchFilter = branchId ? ` AND t.oddzial_id = $${params.push(branchId)}` : '';

  try {
    const r = await pool.query(
      `WITH task_metrics AS (
         SELECT
           t.id,
           t.oddzial_id,
           t.ekipa_id,
           t.status,
           t.data_planowana,
           COALESCE(t.wartosc_planowana, 0)::numeric AS revenue_planned,
           COALESCE(t.wartosc_rzeczywista, tr.wartosc_brutto, t.wartosc_planowana, 0)::numeric AS revenue_actual,
           COALESCE(tr.koszt_pomocnikow, 0)::numeric
             + COALESCE(tr.wynagrodzenie_brygadzisty, 0)::numeric
             + COALESCE(op.known_cost, 0)::numeric
             + COALESCE(mu.material_cost, 0)::numeric AS known_cost,
           CASE WHEN tr.id IS NOT NULL THEN 1 ELSE 0 END AS has_settlement,
           CASE WHEN COALESCE(op.known_cost, 0) > 0 OR COALESCE(mu.material_cost, 0) > 0 THEN 1 ELSE 0 END AS has_costs
         FROM tasks t
         LEFT JOIN task_rozliczenie tr ON tr.task_id = t.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(amount), 0) AS known_cost
           FROM task_operational_costs c
           WHERE c.task_id = t.id
         ) op ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(koszt_laczny), 0) AS material_cost
           FROM task_finish_material_usage m
           WHERE m.task_id = t.id
         ) mu ON true
         WHERE t.data_planowana >= NOW() - INTERVAL '1 day' * $1
           AND t.status != 'Anulowane'
           ${branchFilter}
       )
       SELECT
         o.id AS oddzial_id,
         o.nazwa AS oddzial_nazwa,
         COALESCE(MAX(o.marza_prog_rentowosci_pct), 15)::numeric AS margin_threshold_pct,
         COUNT(tm.id) AS tasks_total,
         COUNT(tm.id) FILTER (WHERE tm.status = 'Zakonczone') AS tasks_done,
         COUNT(tm.id) FILTER (WHERE tm.status NOT IN ('Zakonczone','Anulowane')
                              AND tm.data_planowana < NOW()) AS tasks_overdue,
         COALESCE(SUM(tm.revenue_planned), 0) AS revenue_planned,
         COALESCE(SUM(tm.revenue_actual) FILTER (WHERE tm.status = 'Zakonczone'), 0) AS revenue_actual,
         COALESCE(SUM(tm.known_cost), 0) AS known_cost,
         COUNT(DISTINCT tm.ekipa_id) AS teams_active,
         COALESCE(SUM(tm.has_settlement), 0) AS settlement_count,
         COALESCE(SUM(tm.has_costs), 0) AS cost_count
       FROM branches o
       LEFT JOIN task_metrics tm ON tm.oddzial_id = o.id
       GROUP BY o.id, o.nazwa
       ORDER BY revenue_planned DESC`,
      params
    );

    res.json(r.rows.map(row => {
      const tasksTotal = Number(row.tasks_total);
      const tasksDone = Number(row.tasks_done);
      const revenueActual = Number(row.revenue_actual);
      const knownCost = Number(row.known_cost);
      const marginPct = revenueActual > 0 ? Math.round(((revenueActual - knownCost) / revenueActual) * 1000) / 10 : null;
      const thresholdPct = Number(row.margin_threshold_pct || 15);
      const completionPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
      const dataQualityPct = tasksTotal > 0
        ? Math.round(((Number(row.settlement_count || 0) + Number(row.cost_count || 0)) / (tasksTotal * 2)) * 100)
        : 0;
      return {
        oddzial_id: row.oddzial_id,
        oddzial_nazwa: row.oddzial_nazwa,
        tasks_total: tasksTotal,
        tasks_done: tasksDone,
        tasks_overdue: Number(row.tasks_overdue),
        completion_pct: completionPct,
        revenue_planned: Math.round(Number(row.revenue_planned)),
        revenue_actual: Math.round(revenueActual),
        known_cost: Math.round(knownCost),
        gross_margin: revenueActual > 0 ? Math.round(revenueActual - knownCost) : null,
        margin_pct: marginPct,
        margin_threshold_pct: thresholdPct,
        profitability_tone: profitabilityTone(marginPct, thresholdPct),
        data_quality_pct: dataQualityPct,
        score: scoreFromMetrics({
          completionPct,
          marginPct: marginPct ?? 0,
          overdue: Number(row.tasks_overdue),
          tasks: tasksTotal,
          dataQualityPct,
        }),
        teams_active: Number(row.teams_active),
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bi/service-mix ─────────────────────────────────────────────────
router.get('/service-mix', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const { clause: bc, params: bp } = scopeClause(branchId, 2);

  try {
    const r = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(typ_uslugi), ''), 'Inne') AS typ_uslugi,
         COUNT(*) FILTER (WHERE status != 'Anulowane')  AS tasks_count,
         COALESCE(SUM(wartosc_planowana) FILTER (WHERE status != 'Anulowane'), 0) AS revenue
       FROM tasks t
       WHERE data_planowana >= NOW() - INTERVAL '1 day' * $1
         ${bc}
       GROUP BY 1
       ORDER BY revenue DESC
       LIMIT 15`,
      [days, ...bp]
    );

    const totalRevenue = r.rows.reduce((s, row) => s + Number(row.revenue), 0);

    res.json(r.rows.map(row => ({
      typ_uslugi:   row.typ_uslugi,
      tasks_count:  Number(row.tasks_count),
      revenue:      Math.round(Number(row.revenue)),
      pct:          totalRevenue > 0 ? Math.round((Number(row.revenue) / totalRevenue) * 100) : 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bi/team-performance ────────────────────────────────────────────
router.get('/team-performance', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const { clause: bc, params: bp } = scopeClause(branchId, 2, 't');

  try {
    const r = await pool.query(
      `WITH task_metrics AS (
         SELECT
           t.id,
           t.ekipa_id,
           t.status,
           t.data_planowana,
           COALESCE(t.wartosc_planowana, 0)::numeric AS revenue_planned,
           COALESCE(t.wartosc_rzeczywista, tr.wartosc_brutto, t.wartosc_planowana, 0)::numeric AS revenue_actual,
           COALESCE(tr.koszt_pomocnikow, 0)::numeric
             + COALESCE(tr.wynagrodzenie_brygadzisty, 0)::numeric
             + COALESCE(op.known_cost, 0)::numeric
             + COALESCE(mu.material_cost, 0)::numeric AS known_cost,
           CASE WHEN tr.id IS NOT NULL THEN 1 ELSE 0 END AS has_settlement,
           CASE WHEN COALESCE(op.known_cost, 0) > 0 OR COALESCE(mu.material_cost, 0) > 0 THEN 1 ELSE 0 END AS has_costs
         FROM tasks t
         LEFT JOIN task_rozliczenie tr ON tr.task_id = t.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(amount), 0) AS known_cost
           FROM task_operational_costs c
           WHERE c.task_id = t.id
         ) op ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(koszt_laczny), 0) AS material_cost
           FROM task_finish_material_usage m
           WHERE m.task_id = t.id
         ) mu ON true
         WHERE t.data_planowana >= NOW() - INTERVAL '1 day' * $1
           AND t.status != 'Anulowane'
           ${bc}
       )
       SELECT
         e.id AS team_id,
         e.nazwa AS team_name,
         o.nazwa AS oddzial_nazwa,
         COUNT(tm.id) AS tasks_total,
         COUNT(tm.id) FILTER (WHERE tm.status = 'Zakonczone') AS tasks_done,
         COUNT(tm.id) FILTER (WHERE tm.status NOT IN ('Zakonczone','Anulowane')
                              AND tm.data_planowana < NOW()) AS tasks_overdue,
         COALESCE(SUM(tm.revenue_planned), 0) AS revenue,
         COALESCE(SUM(tm.revenue_actual) FILTER (WHERE tm.status = 'Zakonczone'), 0) AS revenue_actual,
         COALESCE(SUM(tm.known_cost), 0) AS known_cost,
         COALESCE(SUM(tm.has_settlement), 0) AS settlement_count,
         COALESCE(SUM(tm.has_costs), 0) AS cost_count
       FROM ekipy e
       LEFT JOIN branches o ON o.id = e.oddzial_id
       LEFT JOIN task_metrics tm ON tm.ekipa_id = e.id
       WHERE e.aktywna = true
       GROUP BY e.id, e.nazwa, o.nazwa
       ORDER BY revenue DESC
       LIMIT 30`,
      [days, ...bp]
    );

    const rows = r.rows.map((row) => {
      const tasksTotal = Number(row.tasks_total);
      const tasksDone = Number(row.tasks_done);
      const revenueActual = Number(row.revenue_actual);
      const knownCost = Number(row.known_cost);
      const marginPct = revenueActual > 0 ? Math.round(((revenueActual - knownCost) / revenueActual) * 1000) / 10 : null;
      const completionPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
      const dataQualityPct = tasksTotal > 0
        ? Math.round(((Number(row.settlement_count || 0) + Number(row.cost_count || 0)) / (tasksTotal * 2)) * 100)
        : 0;
      const score = scoreFromMetrics({
        completionPct,
        marginPct: marginPct ?? 0,
        overdue: Number(row.tasks_overdue),
        tasks: tasksTotal,
        dataQualityPct,
      });
      return {
        team_id: row.team_id,
        team_name: row.team_name,
        oddzial_nazwa: row.oddzial_nazwa,
        tasks_total: tasksTotal,
        tasks_done: tasksDone,
        tasks_overdue: Number(row.tasks_overdue),
        completion_pct: completionPct,
        revenue: Math.round(Number(row.revenue)),
        revenue_actual: Math.round(revenueActual),
        known_cost: Math.round(knownCost),
        gross_margin: revenueActual > 0 ? Math.round(revenueActual - knownCost) : null,
        margin_pct: marginPct,
        data_quality_pct: dataQualityPct,
        score,
      };
    }).sort((a, b) => b.score - a.score || b.revenue - a.revenue);

    res.json(rows.map((row, i) => ({ rank: i + 1, ...row })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bi/funnel ───────────────────────────────────────────────────────
router.get('/funnel', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);

  const params = [days];
  // wyceny has no oddzial_id — scope via autor_id → users.oddzial_id
  const branchFilter = branchId ? ` AND u.oddzial_id = $${params.push(branchId)}` : '';
  // conversion: a task exists with source_wycena_id = wyceny.id
  try {
    const r = await pool.query(
      `SELECT
         COUNT(w.id)                                                       AS quotes_total,
         COUNT(w.id) FILTER (WHERE w.status_akceptacji = 'Zaakceptowana') AS quotes_accepted,
         COUNT(w.id) FILTER (WHERE w.status_akceptacji = 'Odrzucona')     AS quotes_rejected,
         COUNT(w.id) FILTER (WHERE EXISTS (
           SELECT 1 FROM tasks t WHERE t.source_wycena_id = w.id
         ))                                                                AS converted_to_task,
         COALESCE(SUM(w.wartosc_szacowana) FILTER (WHERE EXISTS (
           SELECT 1 FROM tasks t WHERE t.source_wycena_id = w.id
         )), 0)                                                            AS pipeline_value
       FROM wyceny w
       LEFT JOIN users u ON u.id = w.autor_id
       WHERE w.created_at >= NOW() - INTERVAL '1 day' * $1
         ${branchFilter}`,
      params
    );

    const row = r.rows[0];
    const total = Number(row.quotes_total);

    res.json({
      period_days:       days,
      quotes_total:      total,
      quotes_accepted:   Number(row.quotes_accepted),
      quotes_rejected:   Number(row.quotes_rejected),
      converted_to_task: Number(row.converted_to_task),
      pipeline_value:    Math.round(Number(row.pipeline_value)),
      acceptance_rate:   total > 0 ? Math.round((row.quotes_accepted / total) * 100) : 0,
      conversion_rate:   total > 0 ? Math.round((row.converted_to_task / total) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bi/drill — szczegółowa lista zadań dla wybranego wymiaru ────────
// ?dim=oddzial|ekipa|usluga&id=N&val=STR&days=N
router.get('/plan-vs-real', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const { clause: bc, params: bp } = scopeClause(branchId, 2, 't');

  try {
    const [summaryResult, tasksResult] = await Promise.all([
      pool.query(
        `WITH base AS (
           SELECT
             t.id,
             t.status,
             COALESCE(t.czas_planowany_godziny, t.czas_realizacji_godz, 0)::numeric * 60 AS planned_minutes,
             COALESCE(wl.actual_minutes, 0)::numeric AS actual_minutes,
             COALESCE(t.wartosc_planowana, 0)::numeric AS value_planned,
             COALESCE(t.wartosc_rzeczywista, tr.wartosc_brutto, t.wartosc_planowana, 0)::numeric AS value_actual,
             COALESCE(op.known_cost, 0)::numeric AS known_cost
           FROM tasks t
           LEFT JOIN task_rozliczenie tr ON tr.task_id = t.id
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(
               COALESCE(
                 NULLIF(w.czas_pracy_minuty, 0),
                 NULLIF(w.duration_hours, 0) * 60,
                 CASE WHEN w.end_time IS NOT NULL THEN EXTRACT(EPOCH FROM (w.end_time - w.start_time)) / 60 END,
                 0
               )
             ), 0) AS actual_minutes
             FROM work_logs w
             WHERE w.task_id = t.id
           ) wl ON true
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(amount), 0) AS known_cost
             FROM task_operational_costs c
             WHERE c.task_id = t.id
           ) op ON true
           WHERE t.data_planowana >= NOW() - INTERVAL '1 day' * $1
             AND t.status != 'Anulowane'
             ${bc}
         )
         SELECT
           COUNT(*)::int AS tasks_total,
           COUNT(*) FILTER (WHERE status = 'Zakonczone')::int AS tasks_done,
           COALESCE(SUM(planned_minutes), 0)::numeric AS planned_minutes,
           COALESCE(SUM(actual_minutes), 0)::numeric AS actual_minutes,
           COALESCE(SUM(value_planned), 0)::numeric AS value_planned,
           COALESCE(SUM(value_actual), 0)::numeric AS value_actual,
           COALESCE(SUM(known_cost), 0)::numeric AS known_cost,
           COUNT(*) FILTER (
             WHERE planned_minutes > 0
               AND actual_minutes > planned_minutes * 1.2
           )::int AS overrun_tasks,
           COUNT(*) FILTER (
             WHERE status = 'Zakonczone'
               AND actual_minutes = 0
           )::int AS missing_worklog_tasks
         FROM base`,
        [days, ...bp]
      ),
      pool.query(
        `SELECT
           t.id,
           t.numer,
           t.status,
           t.typ_uslugi,
           t.data_planowana::text AS data_planowana,
           COALESCE(t.czas_planowany_godziny, t.czas_realizacji_godz, 0)::numeric * 60 AS planned_minutes,
           COALESCE(wl.actual_minutes, 0)::numeric AS actual_minutes,
           COALESCE(t.wartosc_planowana, 0)::numeric AS value_planned,
           COALESCE(t.wartosc_rzeczywista, tr.wartosc_brutto, t.wartosc_planowana, 0)::numeric AS value_actual,
           COALESCE(op.known_cost, 0)::numeric AS known_cost,
           e.nazwa AS ekipa_nazwa,
           o.nazwa AS oddzial_nazwa
         FROM tasks t
         LEFT JOIN teams e ON e.id = t.ekipa_id
         LEFT JOIN branches o ON o.id = t.oddzial_id
         LEFT JOIN task_rozliczenie tr ON tr.task_id = t.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(
             COALESCE(
               NULLIF(w.czas_pracy_minuty, 0),
               NULLIF(w.duration_hours, 0) * 60,
               CASE WHEN w.end_time IS NOT NULL THEN EXTRACT(EPOCH FROM (w.end_time - w.start_time)) / 60 END,
               0
             )
           ), 0) AS actual_minutes
           FROM work_logs w
           WHERE w.task_id = t.id
         ) wl ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(amount), 0) AS known_cost
           FROM task_operational_costs c
           WHERE c.task_id = t.id
         ) op ON true
         WHERE t.data_planowana >= NOW() - INTERVAL '1 day' * $1
           AND t.status != 'Anulowane'
           ${bc}
         ORDER BY
           CASE
             WHEN COALESCE(t.czas_planowany_godziny, t.czas_realizacji_godz, 0) > 0
             THEN COALESCE(wl.actual_minutes, 0) / NULLIF(COALESCE(t.czas_planowany_godziny, t.czas_realizacji_godz, 0) * 60, 0)
             ELSE 0
           END DESC,
           t.data_planowana DESC
         LIMIT 20`,
        [days, ...bp]
      ),
    ]);

    const row = summaryResult.rows[0] || {};
    const plannedMinutes = Math.round(Number(row.planned_minutes || 0));
    const actualMinutes = Math.round(Number(row.actual_minutes || 0));
    const varianceMinutes = actualMinutes - plannedMinutes;
    const valuePlanned = Math.round(Number(row.value_planned || 0));
    const valueActual = Math.round(Number(row.value_actual || 0));
    const valueVariance = valueActual - valuePlanned;

    res.json({
      period_days: days,
      tasks_total: Number(row.tasks_total || 0),
      tasks_done: Number(row.tasks_done || 0),
      planned_minutes: plannedMinutes,
      actual_minutes: actualMinutes,
      planned_hours: Math.round((plannedMinutes / 60) * 10) / 10,
      actual_hours: Math.round((actualMinutes / 60) * 10) / 10,
      time_variance_minutes: varianceMinutes,
      time_variance_pct: plannedMinutes > 0 ? Math.round((varianceMinutes / plannedMinutes) * 100) : null,
      value_planned: valuePlanned,
      value_actual: valueActual,
      value_variance: valueVariance,
      value_variance_pct: valuePlanned > 0 ? Math.round((valueVariance / valuePlanned) * 100) : null,
      known_cost: Math.round(Number(row.known_cost || 0)),
      overrun_tasks: Number(row.overrun_tasks || 0),
      missing_worklog_tasks: Number(row.missing_worklog_tasks || 0),
      tasks: tasksResult.rows.map((task) => {
        const planned = Math.round(Number(task.planned_minutes || 0));
        const actual = Math.round(Number(task.actual_minutes || 0));
        return {
          id: task.id,
          numer: task.numer,
          status: task.status,
          typ_uslugi: task.typ_uslugi,
          data_planowana: task.data_planowana,
          ekipa_nazwa: task.ekipa_nazwa,
          oddzial_nazwa: task.oddzial_nazwa,
          planned_minutes: planned,
          actual_minutes: actual,
          variance_minutes: actual - planned,
          variance_pct: planned > 0 ? Math.round(((actual - planned) / planned) * 100) : null,
          value_planned: Math.round(Number(task.value_planned || 0)),
          value_actual: Math.round(Number(task.value_actual || 0)),
          known_cost: Math.round(Number(task.known_cost || 0)),
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/drill', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days   = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const dim    = req.query.dim;   // oddzial | ekipa | usluga
  const id     = Number(req.query.id) || null;
  const val    = req.query.val || null;  // dla usluga (string)
  const branchId = scopedOddzialId(req.user, null);

  const params = [days];
  let dimClause = '';

  if (dim === 'oddzial' && id) {
    if (branchId && branchId !== id) return res.status(403).json({ error: 'Brak uprawnień' });
    dimClause = ` AND t.oddzial_id = $${params.push(id)}`;
  } else if (dim === 'ekipa' && id) {
    dimClause = ` AND t.ekipa_id = $${params.push(id)}`;
    if (branchId) dimClause += ` AND t.oddzial_id = $${params.push(branchId)}`;
  } else if (dim === 'usluga' && val) {
    dimClause = ` AND COALESCE(NULLIF(TRIM(t.typ_uslugi),''),'Inne') = $${params.push(val)}`;
    if (branchId) dimClause += ` AND t.oddzial_id = $${params.push(branchId)}`;
  } else {
    if (branchId) dimClause = ` AND t.oddzial_id = $${params.push(branchId)}`;
  }

  try {
    const r = await pool.query(
      `SELECT
         t.id, t.numer, t.status, t.typ_uslugi,
         t.data_planowana::text AS data_planowana,
         t.wartosc_planowana, t.wartosc_rzeczywista, t.wartosc_netto_do_rozliczenia,
         COALESCE(t.wartosc_netto_do_rozliczenia, tr.wartosc_netto, t.wartosc_rzeczywista, t.wartosc_planowana, 0)::numeric AS revenue_net,
         tr.id AS rozliczenie_id,
         tr.wartosc_brutto AS rozliczenie_wartosc_brutto,
         tr.wartosc_netto AS rozliczenie_wartosc_netto,
         tr.koszt_pomocnikow,
         tr.wynagrodzenie_brygadzisty,
         COALESCE(op.koszt_sprzetu, 0)::numeric AS koszt_sprzetu,
         COALESCE(op.koszt_paliwa, 0)::numeric AS koszt_paliwa,
         COALESCE(mu.koszt_materialow, 0)::numeric AS koszt_materialow,
         COALESCE(op.koszt_utylizacji, 0)::numeric AS koszt_utylizacji,
         COALESCE(op.koszt_inne, 0)::numeric AS koszt_inne,
         COALESCE(op.koszt_sprzetu_count, 0)::int AS koszt_sprzetu_count,
         COALESCE(op.koszt_paliwa_count, 0)::int AS koszt_paliwa_count,
         COALESCE(mu.koszt_materialow_count, 0)::int AS koszt_materialow_count,
         COALESCE(op.koszt_utylizacji_count, 0)::int AS koszt_utylizacji_count,
         COALESCE(op.koszt_inne_count, 0)::int AS koszt_inne_count,
         COALESCE(t.adres || ', ' || t.miasto, t.miasto, t.adres, '---') AS adres,
         e.nazwa AS ekipa_nazwa,
         o.nazwa AS oddzial_nazwa
       FROM tasks t
       LEFT JOIN teams e ON e.id = t.ekipa_id
       LEFT JOIN task_rozliczenie tr ON tr.task_id = t.id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(amount) FILTER (WHERE category = 'sprzet'), 0) AS koszt_sprzetu,
           COALESCE(SUM(amount) FILTER (WHERE category = 'paliwo'), 0) AS koszt_paliwa,
           COALESCE(SUM(amount) FILTER (WHERE category = 'utylizacja'), 0) AS koszt_utylizacji,
           COALESCE(SUM(amount) FILTER (WHERE category = 'inne'), 0) AS koszt_inne,
           COUNT(*) FILTER (WHERE category = 'sprzet') AS koszt_sprzetu_count,
           COUNT(*) FILTER (WHERE category = 'paliwo') AS koszt_paliwa_count,
           COUNT(*) FILTER (WHERE category = 'utylizacja') AS koszt_utylizacji_count,
           COUNT(*) FILTER (WHERE category = 'inne') AS koszt_inne_count
         FROM task_operational_costs c
         WHERE c.task_id = t.id
       ) op ON true
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(koszt_laczny), 0) AS koszt_materialow,
           COUNT(*) FILTER (WHERE koszt_laczny IS NOT NULL) AS koszt_materialow_count
         FROM task_finish_material_usage m
         WHERE m.task_id = t.id
       ) mu ON true
       LEFT JOIN branches o ON o.id = t.oddzial_id
       WHERE t.data_planowana >= NOW() - INTERVAL '1 day' * $1
         AND t.status != 'Anulowane'
         ${dimClause}
       ORDER BY t.data_planowana DESC
       LIMIT 100`,
      params
    );
    res.json(r.rows.map(row => buildTaskDrilldownRow(row, req.user)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/bi/alerts/check — sprawdź progi KPI i wyślij e-mail ─────────
// Body: { completion_threshold, overdue_threshold, recipients, days }
router.post('/alerts/check', async (req, res) => {
  if (!canViewBI(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const { sendSystemEmailOptional } = require('../services/systemEmail');
  const completionThreshold = Number(req.body.completion_threshold ?? 60);
  const overdueThreshold    = Number(req.body.overdue_threshold ?? 10);
  const recipients          = String(req.body.recipients || '').trim();
  const days                = Math.min(Math.max(Number(req.body.days) || 30, 7), 365);
  const branchId = scopedOddzialId(req.user, null);
  const { clause: bc, params: bp } = scopeClause(branchId, 2);

  try {
    const r = await pool.query(
      `SELECT
         COUNT(*)                                                            AS tasks_total,
         COUNT(*) FILTER (WHERE status = 'Zakonczone')                      AS tasks_done,
         COUNT(*) FILTER (WHERE status NOT IN ('Zakonczone','Anulowane')
                          AND data_planowana < NOW())                        AS tasks_overdue
       FROM tasks t
       WHERE data_planowana >= NOW() - INTERVAL '1 day' * $1 ${bc}`,
      [days, ...bp]
    );
    const row = r.rows[0];
    const total    = Number(row.tasks_total);
    const done     = Number(row.tasks_done);
    const overdue  = Number(row.tasks_overdue);
    const compPct  = total > 0 ? Math.round((done / total) * 100) : 0;

    const marginRiskResult = await pool.query(
      `SELECT t.id, t.klient_nazwa, t.oddzial_id,
              COALESCE(b.marza_prog_rentowosci_pct, 15)::numeric AS threshold_pct,
              COALESCE(t.wartosc_rzeczywista, t.wartosc_planowana, tr.wartosc_brutto, 0)::numeric AS revenue_net,
              COALESCE(tr.koszt_pomocnikow, 0)::numeric AS helper_cost,
              COALESCE(tr.wynagrodzenie_brygadzisty, 0)::numeric AS crew_lead_pay,
              COALESCE(op.koszt_sprzetu, 0)::numeric AS equipment_cost,
              COALESCE(op.koszt_paliwa, 0)::numeric AS fuel_cost,
              COALESCE(mu.koszt_materialow, 0)::numeric AS material_cost,
              COALESCE(op.koszt_utylizacji, 0)::numeric AS disposal_cost,
              COALESCE(op.koszt_inne, 0)::numeric AS other_cost
         FROM tasks t
         JOIN task_rozliczenie tr ON tr.task_id = t.id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(SUM(amount) FILTER (WHERE category = 'sprzet'), 0) AS koszt_sprzetu,
             COALESCE(SUM(amount) FILTER (WHERE category = 'paliwo'), 0) AS koszt_paliwa,
             COALESCE(SUM(amount) FILTER (WHERE category = 'utylizacja'), 0) AS koszt_utylizacji,
             COALESCE(SUM(amount) FILTER (WHERE category = 'inne'), 0) AS koszt_inne
           FROM task_operational_costs c
           WHERE c.task_id = t.id
         ) op ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(koszt_laczny), 0) AS koszt_materialow
           FROM task_finish_material_usage m
           WHERE m.task_id = t.id
         ) mu ON true
        WHERE t.status = 'Zakonczone'
          AND COALESCE(t.data_zakonczenia, t.data_planowana, t.updated_at) >= NOW() - INTERVAL '1 day' * $1
          ${bc}
        ORDER BY t.data_zakonczenia DESC NULLS LAST
        LIMIT 100`,
      [days, ...bp]
    );
    const marginRisks = marginRiskResult.rows
      .map((item) => {
        const margin = calculateTaskMargin(item);
        return {
          id: item.id,
          klient_nazwa: item.klient_nazwa,
          oddzial_id: item.oddzial_id,
          threshold_pct: Number(item.threshold_pct || 15),
          revenue_net: margin.revenue_net,
          total_known_cost: margin.total_known_cost,
          margin_pct: margin.margin_pct,
          gross_margin: margin.gross_margin,
        };
      })
      .filter((item) => item.margin_pct != null && item.margin_pct < item.threshold_pct)
      .sort((a, b) => (a.margin_pct ?? 999) - (b.margin_pct ?? 999))
      .slice(0, 10);

    const { clause: fleetScope, params: fleetParams } = scopeClause(branchId, 2, 'x');
    const fleetDueResult = await pool.query(
      `SELECT *
         FROM (
           SELECT 'vehicle' AS kind,
                  v.id,
                  COALESCE(v.nr_rejestracyjny, CONCAT_WS(' ', v.marka, v.model), 'Pojazd #' || v.id::text) AS label,
                  'przeglad' AS due_type,
                  v.data_przegladu AS due_date,
                  v.oddzial_id
             FROM vehicles v
            WHERE v.data_przegladu IS NOT NULL
           UNION ALL
           SELECT 'vehicle' AS kind,
                  v.id,
                  COALESCE(v.nr_rejestracyjny, CONCAT_WS(' ', v.marka, v.model), 'Pojazd #' || v.id::text) AS label,
                  'ubezpieczenie' AS due_type,
                  v.data_ubezpieczenia AS due_date,
                  v.oddzial_id
             FROM vehicles v
            WHERE v.data_ubezpieczenia IS NOT NULL
           UNION ALL
           SELECT 'equipment' AS kind,
                  e.id,
                  COALESCE(e.nazwa, e.typ, 'Sprzet #' || e.id::text) AS label,
                  'przeglad' AS due_type,
                  e.data_przegladu AS due_date,
                  e.oddzial_id
             FROM equipment_items e
            WHERE e.data_przegladu IS NOT NULL
         ) x
        WHERE x.due_date < CURRENT_DATE
          AND x.due_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
          ${fleetScope}
        ORDER BY x.due_date ASC
        LIMIT 20`,
      [days, ...fleetParams]
    );
    const fleetDue = fleetDueResult.rows.map((item) => ({
      kind: item.kind,
      id: item.id,
      label: item.label,
      due_type: item.due_type,
      due_date: item.due_date,
      oddzial_id: item.oddzial_id,
    }));

    const { clause: competencyScope, params: competencyParams } = scopeClause(branchId, 2, 't');
    const competencyResult = await pool.query(
      `SELECT t.id,
              t.numer,
              t.klient_nazwa,
              t.oddzial_id,
              t.ekipa_id,
              e.nazwa AS ekipa_nazwa,
              COALESCE(t.wymagane_kompetencje, '{}'::text[]) AS required_competencies,
              COALESCE(array_agg(DISTINCT uc.nazwa) FILTER (WHERE uc.nazwa IS NOT NULL), '{}'::text[]) AS team_competencies
         FROM tasks t
         JOIN teams e ON e.id = t.ekipa_id
         LEFT JOIN team_members tm ON tm.team_id = e.id
         LEFT JOIN user_competencies uc ON uc.user_id = tm.user_id
        WHERE t.status NOT IN ('Zakonczone','Anulowane')
          AND t.data_planowana >= NOW() - INTERVAL '1 day' * $1
          AND COALESCE(array_length(t.wymagane_kompetencje, 1), 0) > 0
          ${competencyScope}
        GROUP BY t.id, e.nazwa
        ORDER BY t.data_planowana ASC NULLS LAST
        LIMIT 100`,
      [days, ...competencyParams]
    );
    const competencyRisks = competencyResult.rows
      .map((item) => ({
        id: item.id,
        numer: item.numer,
        klient_nazwa: item.klient_nazwa,
        oddzial_id: item.oddzial_id,
        ekipa_id: item.ekipa_id,
        ekipa_nazwa: item.ekipa_nazwa,
        required_competencies: asStringArray(item.required_competencies),
        team_competencies: asStringArray(item.team_competencies),
        missing_competencies: missingCompetencies(item.required_competencies, item.team_competencies),
      }))
      .filter((item) => item.missing_competencies.length > 0)
      .slice(0, 10);

    const alerts = [];
    if (compPct < completionThreshold) {
      alerts.push(`⚠️ Wskaźnik ukończenia: ${compPct}% (próg: ${completionThreshold}%)`);
    }
    if (overdue > overdueThreshold) {
      alerts.push(`⚠️ Przeterminowane zlecenia: ${overdue} szt. (próg: ${overdueThreshold})`);
    }

    if (marginRisks.length > 0) {
      alerts.push(`Ryzyko marzy: ${marginRisks.length} zlec. ponizej progu oddzialu`);
    }
    if (fleetDue.length > 0) {
      alerts.push(`Przeterminowane przeglady/OC: ${fleetDue.length} zasobow floty i sprzetu`);
    }
    if (competencyRisks.length > 0) {
      alerts.push(`Brak kompetencji: ${competencyRisks.length} zlec. przypisanych do niepelnej ekipy`);
    }

    let emailResult = { sent: false, skipped: 'no_alerts' };
    if (alerts.length > 0 && recipients) {
      const text = [
        `ARBOR — Alert KPI (ostatnie ${days} dni)`,
        '',
        ...alerts,
        '',
        `Łączne zlecenia: ${total}`,
        `Ukończone: ${done}`,
        `Przeterminowane: ${overdue}`,
        '',
        ...marginRisks.map((m) => `Marza #${m.id} ${m.klient_nazwa || ''}: ${m.margin_pct}% / prog ${m.threshold_pct}%`),
        ...fleetDue.map((f) => `Flota ${f.kind} #${f.id} ${f.label || ''}: ${f.due_type} ${f.due_date}`),
        ...competencyRisks.map((c) => `Kompetencje #${c.id} ${c.klient_nazwa || ''}: brakuje ${c.missing_competencies.join(', ')}`),
      ].join('\n');
      emailResult = await sendSystemEmailOptional({
        to: recipients,
        subject: `ARBOR Alert KPI — ${alerts.length} problem${alerts.length > 1 ? 'y' : ''}`,
        text,
        html: `<pre style="font-family:sans-serif">${text}</pre>`,
      });
    }

    res.json({
      checked_at: new Date().toISOString(),
      period_days: days,
      completion_pct: compPct,
      tasks_total: total,
      tasks_overdue: overdue,
      margin_risks: marginRisks,
      fleet_due: fleetDue,
      competency_risks: competencyRisks,
      alerts,
      email: emailResult,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
