const express = require('express');
const pool = require('../config/database');
const { authMiddleware, requireRole, scopedOddzialId } = require('../middleware/auth');
const logger = require('../config/logger');
const { logAudit } = require('../services/audit');
const { dispatchWebhook } = require('../services/webhook');
const { buildOperationalDigest, runOperationalDigest } = require('../services/opsDigest');

const router = express.Router();

const sendOverdueReminders = async () => {
  const overdue = await pool.query(
    `SELECT t.id, t.klient_nazwa, t.data_planowana, t.status, t.oddzial_id
     FROM tasks t
     WHERE t.status NOT IN ('Zakonczone') AND t.data_planowana < NOW() - INTERVAL '1 day'
     ORDER BY t.data_planowana ASC
     LIMIT 200`
  );
  let inserted = 0;
  for (const row of overdue.rows) {
    const insertResult = await pool.query(
      `INSERT INTO notifications (typ, tresc, status, task_id, data_utworzenia)
       SELECT 'TaskOverdue',
              $1,
              'Nowe',
              $2,
              NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.task_id = $2 AND n.typ = 'TaskOverdue' AND n.data_utworzenia::date = CURRENT_DATE
       )`,
      [`Zlecenie #${row.id} (${row.klient_nazwa || 'bez klienta'}) jest po terminie.`, row.id]
    );
    inserted += insertResult.rowCount || 0;
  }
  return { scanned: overdue.rows.length, remindersCreated: inserted };
};

router.get(
  '/daily-digest/preview',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik'),
  async (req, res) => {
    try {
      const requestedBranch = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
      const branchId = scopedOddzialId(req.user, requestedBranch);
      const digest = await buildOperationalDigest(pool, {
        branchId,
        date: req.query.date,
        horizonDays: req.query.horizon_days,
        fleetLookaheadDays: req.query.fleet_lookahead_days,
      });
      res.json(digest);
    } catch (e) {
      logger.error('Blad podgladu digestu operacyjnego', {
        message: e.message,
        requestId: req.requestId,
      });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/run-daily',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  async (req, res) => {
    try {
      const reminders = await sendOverdueReminders();
      const digestOptions = {
        date: req.body?.date,
        horizonDays: req.body?.horizon_days,
        fleetLookaheadDays: req.body?.fleet_lookahead_days,
      };
      if (req.body?.email !== undefined) {
        digestOptions.emailEnabled = req.body.email === true;
      }
      const operationalDigest = await runOperationalDigest(pool, digestOptions);
      await dispatchWebhook(
        'automation.daily.executed',
        {
          reminders,
          operationalDigest: {
            global: operationalDigest.global?.summary || null,
            branches: (operationalDigest.branches || []).map((branch) => ({
              branch_id: branch.branch_id,
              summary: branch.summary,
            })),
          },
          actorUserId: req.user?.id || null,
          oddzialId: req.user?.oddzial_id || null,
        },
        { retries: 3 }
      );
      await logAudit(pool, req, {
        action: 'automation_daily_run',
        entityType: 'automation',
        entityId: 'daily',
        metadata: {
          reminders,
          operationalDigest: {
            global: operationalDigest.global?.summary || null,
            branches: (operationalDigest.branches || []).map((branch) => ({
              branch_id: branch.branch_id,
              summary: branch.summary,
            })),
          },
        },
      });
      res.json({
        success: true,
        reminders,
        operationalDigest,
        executedAt: new Date().toISOString(),
      });
    } catch (e) {
      logger.error('Blad uruchamiania automatyzacji dziennej', {
        message: e.message,
        requestId: req.requestId,
      });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

module.exports = router;
