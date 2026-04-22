const express = require('express');
const pool = require('../config/database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validate');
const { z } = require('zod');
const logger = require('../config/logger');

const router = express.Router();

const summaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).optional().default(14),
  oddzial_id: z.coerce.number().int().positive().optional(),
});

let cache = { key: null, expiresAt: 0, payload: null };

const withBranchFilter = (whereParts, params, oddzialId) => {
  if (!oddzialId) return;
  params.push(oddzialId);
  whereParts.push(`oddzial_id = $${params.length}`);
};

router.get(
  '/summary',
  authMiddleware,
  requireRole('Kierownik', 'Dyrektor', 'Administrator'),
  validateQuery(summaryQuerySchema),
  async (req, res) => {
    try {
      const days = Number(req.query.days || 14);
      const oddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;

      const cacheKey = `${days}:${oddzialId || 'all'}:${req.user.rola}:${req.user.oddzial_id || 'na'}`;
      if (cache.key === cacheKey && Date.now() < cache.expiresAt && cache.payload) {
        return res.json({ ...cache.payload, cached: true });
      }

      const scopeOddzialId =
        req.user.rola === 'Kierownik' ? Number(req.user.oddzial_id || 0) || oddzialId : oddzialId;

      const taskWhere = [`data_planowana >= NOW() - INTERVAL '${days} days'`];
      const taskParams = [];
      withBranchFilter(taskWhere, taskParams, scopeOddzialId);
      const taskScope = taskWhere.length ? `WHERE ${taskWhere.join(' AND ')}` : '';

      const reportWhere = [`data_raportu >= CURRENT_DATE - INTERVAL '${days} days'`];
      const reportParams = [];
      withBranchFilter(reportWhere, reportParams, scopeOddzialId);
      const reportScope = reportWhere.length ? `WHERE ${reportWhere.join(' AND ')}` : '';

      const [taskStatusRes, overdueRes, teamLoadRes, reportsRes, revenueRes] = await Promise.all([
        pool.query(
          `SELECT status, COUNT(*)::int AS total
           FROM tasks
           ${taskScope}
           GROUP BY status
           ORDER BY total DESC`,
          taskParams
        ),
        pool.query(
          `SELECT COUNT(*)::int AS overdue
           FROM tasks
           ${taskScope ? `${taskScope} AND` : 'WHERE'} status NOT IN ('Zakonczone') AND data_planowana < NOW()`,
          taskParams
        ),
        pool.query(
          `SELECT COALESCE(e.nazwa, 'Bez ekipy') AS ekipa,
                  COUNT(*)::int AS total,
                  SUM(CASE WHEN t.status = 'W_Realizacji' THEN 1 ELSE 0 END)::int AS in_progress
           FROM tasks t
           LEFT JOIN teams e ON e.id = t.ekipa_id
           ${taskScope}
           GROUP BY e.nazwa
           ORDER BY total DESC
           LIMIT 8`,
          taskParams
        ),
        pool.query(
          `SELECT status, COUNT(*)::int AS total
           FROM daily_reports
           ${reportScope}
           GROUP BY status`,
          reportParams
        ),
        pool.query(
          `SELECT
             COALESCE(SUM(COALESCE(wartosc_rzeczywista, wartosc_planowana)), 0)::numeric(12,2) AS total_value,
             COUNT(*)::int AS total_tasks
           FROM tasks
           ${taskScope}`,
          taskParams
        ),
      ]);

      const taskByStatus = taskStatusRes.rows.reduce((acc, row) => {
        acc[row.status] = row.total;
        return acc;
      }, {});
      const reportByStatus = reportsRes.rows.reduce((acc, row) => {
        acc[row.status] = row.total;
        return acc;
      }, {});

      const payload = {
        range_days: days,
        oddzial_id: scopeOddzialId || null,
        kpi: {
          tasks_total: revenueRes.rows[0]?.total_tasks || 0,
          tasks_overdue: overdueRes.rows[0]?.overdue || 0,
          reports_sent: reportByStatus.Wyslany || 0,
          reports_draft: reportByStatus.Roboczy || 0,
          estimated_revenue_pln: Number(revenueRes.rows[0]?.total_value || 0),
        },
        tasks_by_status: taskByStatus,
        reports_by_status: reportByStatus,
        team_load: teamLoadRes.rows,
        generated_at: new Date().toISOString(),
      };

      cache = {
        key: cacheKey,
        expiresAt: Date.now() + 30_000,
        payload,
      };

      res.json(payload);
    } catch (e) {
      logger.error('Blad dashboard summary', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

module.exports = router;
