const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';
const { calculateTaskMargin } = require('./taskMargin');

/**
 * Agregaty jak w aplikacji mobilnej (`/raporty/mobile`): zlecenia z ostatnich 365 dni,
 * zakres wg oddziału (poza Dyrektor/Administrator).
 */
async function getRaportyMobileAggregates(pool, user) {
  const branchClause = isDyrektor(user) ? '' : 'AND t.oddzial_id = $1';
  const params = isDyrektor(user) ? [] : [user.oddzial_id];
  const sql = `
    WITH scoped AS (
      SELECT t.*
        FROM tasks t
       WHERE t.data_planowana >= NOW() - INTERVAL '365 days'
         AND t.data_planowana IS NOT NULL
         ${branchClause}
    )
    SELECT
      (SELECT COUNT(*)::int FROM scoped) AS total_tasks,
      (SELECT COUNT(*)::int FROM scoped WHERE status = 'Zakonczone') AS completed_tasks,
      (SELECT COALESCE(SUM(wl.czas_pracy_minuty), 0)::numeric / 60.0
         FROM work_logs wl
        INNER JOIN scoped s ON s.id = wl.task_id) AS total_hours,
      (SELECT COALESCE(SUM(COALESCE(s.wartosc_rzeczywista, s.wartosc_planowana, 0)::numeric), 0)
         FROM scoped s) AS total_revenue,
      (SELECT COALESCE(SUM(
           COALESCE(tr.koszt_pomocnikow, 0)::numeric + COALESCE(tr.wynagrodzenie_brygadzisty, 0)::numeric
         ), 0)
         FROM task_rozliczenie tr
        INNER JOIN scoped s ON s.id = tr.task_id) AS total_cost
  `;
  const r = await pool.query(sql, params);
  const row = r.rows[0] || {};
  const revenue = Number(row.total_revenue) || 0;
  const cost = Number(row.total_cost) || 0;
  const margin = calculateTaskMargin({ revenue_net: revenue, total_known_cost: cost });
  return {
    total_tasks: Number(row.total_tasks) || 0,
    completed_tasks: Number(row.completed_tasks) || 0,
    total_hours: Number(row.total_hours) || 0,
    total_revenue: revenue,
    total_cost: cost,
    avg_margin_percent: margin.margin_pct ?? 0,
  };
}

module.exports = { getRaportyMobileAggregates };
