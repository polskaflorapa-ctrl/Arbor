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
  return isDyrektorOrAdmin(user) || isKierownik(user);
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
      `SELECT
         o.id                                                                      AS oddzial_id,
         o.nazwa                                                                   AS oddzial_nazwa,
         COUNT(t.id) FILTER (WHERE t.status != 'Anulowane')                       AS tasks_total,
         COUNT(t.id) FILTER (WHERE t.status = 'Zakonczone')                       AS tasks_done,
         COUNT(t.id) FILTER (WHERE t.status NOT IN ('Zakonczone','Anulowane')
                              AND t.data_planowana < NOW())                        AS tasks_overdue,
         COALESCE(SUM(t.wartosc_planowana) FILTER (WHERE t.status != 'Anulowane'), 0) AS revenue_planned,
         COALESCE(SUM(t.wartosc_rzeczywista) FILTER (WHERE t.status = 'Zakonczone'), 0) AS revenue_actual,
         COUNT(DISTINCT t.ekipa_id) FILTER (WHERE t.status != 'Anulowane')         AS teams_active
       FROM oddzialy o
       LEFT JOIN tasks t ON t.oddzial_id = o.id
         AND t.data_planowana >= NOW() - INTERVAL '1 day' * $1 ${branchFilter}
       GROUP BY o.id, o.nazwa
       ORDER BY revenue_planned DESC`,
      params
    );

    res.json(r.rows.map(row => ({
      oddzial_id:      row.oddzial_id,
      oddzial_nazwa:   row.oddzial_nazwa,
      tasks_total:     Number(row.tasks_total),
      tasks_done:      Number(row.tasks_done),
      tasks_overdue:   Number(row.tasks_overdue),
      completion_pct:  row.tasks_total > 0 ? Math.round((row.tasks_done / row.tasks_total) * 100) : 0,
      revenue_planned: Math.round(Number(row.revenue_planned)),
      revenue_actual:  Math.round(Number(row.revenue_actual)),
      teams_active:    Number(row.teams_active),
    })));
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
      `SELECT
         e.id                                                                   AS team_id,
         e.nazwa                                                                AS team_name,
         o.nazwa                                                                AS oddzial_nazwa,
         COUNT(t.id) FILTER (WHERE t.status != 'Anulowane')                    AS tasks_total,
         COUNT(t.id) FILTER (WHERE t.status = 'Zakonczone')                    AS tasks_done,
         COUNT(t.id) FILTER (WHERE t.status NOT IN ('Zakonczone','Anulowane')
                              AND t.data_planowana < NOW())                     AS tasks_overdue,
         COALESCE(SUM(t.wartosc_planowana) FILTER (WHERE t.status != 'Anulowane'), 0) AS revenue
       FROM ekipy e
       LEFT JOIN oddzialy o ON o.id = e.oddzial_id
       LEFT JOIN tasks t ON t.ekipa_id = e.id
         AND t.data_planowana >= NOW() - INTERVAL '1 day' * $1
         ${bc}
       WHERE e.aktywna = true
       GROUP BY e.id, e.nazwa, o.nazwa
       ORDER BY revenue DESC
       LIMIT 30`,
      [days, ...bp]
    );

    res.json(r.rows.map((row, i) => ({
      rank:          i + 1,
      team_id:       row.team_id,
      team_name:     row.team_name,
      oddzial_nazwa: row.oddzial_nazwa,
      tasks_total:   Number(row.tasks_total),
      tasks_done:    Number(row.tasks_done),
      tasks_overdue: Number(row.tasks_overdue),
      completion_pct: row.tasks_total > 0 ? Math.round((row.tasks_done / row.tasks_total) * 100) : 0,
      revenue:       Math.round(Number(row.revenue)),
    })));
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
       LEFT JOIN oddzialy o ON o.id = t.oddzial_id
       WHERE t.data_planowana >= NOW() - INTERVAL '1 day' * $1
         AND t.status != 'Anulowane'
         ${dimClause}
       ORDER BY t.data_planowana DESC
       LIMIT 100`,
      params
    );
    res.json(r.rows.map(row => ({
      ...row,
      wartosc_planowana: row.wartosc_planowana == null ? null : Number(row.wartosc_planowana),
      wartosc_rzeczywista: row.wartosc_rzeczywista == null ? null : Number(row.wartosc_rzeczywista),
      wartosc_netto_do_rozliczenia: row.wartosc_netto_do_rozliczenia == null ? null : Number(row.wartosc_netto_do_rozliczenia),
      financials: buildTaskFinancialDrilldown(row),
    })));
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

    const alerts = [];
    if (compPct < completionThreshold) {
      alerts.push(`⚠️ Wskaźnik ukończenia: ${compPct}% (próg: ${completionThreshold}%)`);
    }
    if (overdue > overdueThreshold) {
      alerts.push(`⚠️ Przeterminowane zlecenia: ${overdue} szt. (próg: ${overdueThreshold})`);
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
      alerts,
      email: emailResult,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
