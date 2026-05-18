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

const router = express.Router();
router.use(authMiddleware);

function canViewBI(user) {
  return isDyrektorOrAdmin(user) || isKierownik(user);
}

function scopeClause(branchId, paramIndex, alias = 't') {
  if (!branchId) return { clause: '', params: [] };
  return { clause: ` AND ${alias}.oddzial_id = $${paramIndex}`, params: [branchId] };
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

module.exports = router;
