const express = require('express');
const pool = require('../config/database');
const { authMiddleware, requireRole, scopedOddzialId } = require('../middleware/auth');
const logger = require('../config/logger');
const { logAudit } = require('../services/audit');
const { dispatchWebhook } = require('../services/webhook');
const {
  buildOperationalDigest,
  getDigestRunHistory,
  listDigestSettings,
  runOperationalDigest,
  saveDigestSettings,
} = require('../services/opsDigest');
const {
  buildWeeklyTeamLeague,
  publishWeeklyTeamLeague,
} = require('../services/teamLeagueTelegram');
const { sendSmsGateway } = require('../services/smsGateway');
const { appendCrmLeadMessage } = require('../services/crmInbox');

const router = express.Router();

const parsePositiveInt = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

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

function formatInspectionReminderDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildInspectionReminderSms(row) {
  const when = formatInspectionReminderDate(row.appointment_at);
  const address = [row.inspection_address, row.city].filter(Boolean).join(', ');
  const parts = ['Dzien dobry, przypominamy o jutrzejszych bezplatnych ogledzinach Polska Flora'];
  if (when) parts.push(`termin: ${when}`);
  if (address) parts.push(`adres: ${address}`);
  return `${parts.join(', ')}. Do zobaczenia.`;
}

async function listInspectionSmsReminderCandidates({ branchId = null } = {}) {
  const params = [];
  const branchSql = branchId ? `AND v.oddzial_id = $${params.push(branchId)}` : '';
  const due = await pool.query(
    `SELECT v.id,
            v.oddzial_id,
            v.crm_lead_id,
            v.ogledziny_id,
            v.caller_phone,
            v.customer_name,
            v.inspection_address,
            v.city,
            v.appointment_at,
            v.raw_payload
     FROM voice_agent_intakes v
     INNER JOIN voice_agent_integrations vai
       ON vai.agent_id = v.agent_id
      AND vai.oddzial_id = v.oddzial_id
      AND vai.status = 'active'
     WHERE v.agent_id = 'polska-flora-ania'
       AND v.appointment_at::date = (CURRENT_DATE + INTERVAL '1 day')::date
       AND COALESCE(v.caller_phone, '') <> ''
       AND COALESCE(v.raw_payload, '{}'::jsonb)->>'last_sms_reminder_for' IS DISTINCT FROM v.appointment_at::date::text
       ${branchSql}
     ORDER BY v.appointment_at ASC
     LIMIT 200`,
    params
  );
  return due.rows.map((row) => ({
    ...row,
    sms_body: buildInspectionReminderSms(row).slice(0, 480),
  }));
}

const sendInspectionSmsReminders = async () => {
  const rows = await listInspectionSmsReminderCandidates();
  let sent = 0;
  const failed = [];
  for (const row of rows) {
    const body = row.sms_body || buildInspectionReminderSms(row).slice(0, 480);
    const result = await sendSmsGateway({
      to: row.caller_phone,
      body,
      oddzialId: row.oddzial_id,
    });
    if (!result.ok) {
      failed.push({ intake_id: row.id, phone: row.caller_phone, error: result.error });
      await pool.query(
        `UPDATE voice_agent_intakes
         SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          row.id,
          JSON.stringify({
            last_sms_reminder_attempt_at: new Date().toISOString(),
            last_sms_reminder_error: result.error || 'sms_failed',
          }),
        ]
      );
      continue;
    }

    sent += 1;
    const messageId = result.sid || result.id || null;
    if (row.crm_lead_id) {
      await appendCrmLeadMessage({
        leadId: row.crm_lead_id,
        channel: 'sms',
        direction: 'outbound',
        recipientHandle: row.caller_phone,
        subject: 'Przypomnienie o ogledzinach SMS',
        body,
        status: messageId ? 'sent' : 'queued',
        externalMessageId: messageId,
        templateKey: 'polska_flora_ogledziny_reminder',
        metadata: {
          source: 'automation.inspection_sms_reminder',
          intake_id: row.id,
          ogledziny_id: row.ogledziny_id || null,
          provider: result.provider || null,
        },
      });
    }
    await pool.query(
      `UPDATE voice_agent_intakes
       SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [
        row.id,
        JSON.stringify({
          last_sms_reminder_at: new Date().toISOString(),
          last_sms_reminder_for: String(row.appointment_at || '').slice(0, 10),
          last_sms_reminder_id: messageId,
        }),
      ]
    );
  }

  return { scanned: rows.length, sent, failed };
};

router.get(
  '/inspection-sms-reminders/preview',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik'),
  async (req, res) => {
    try {
      const requestedBranch = parsePositiveInt(req.query.oddzial_id);
      const branchId = scopedOddzialId(req.user, requestedBranch);
      const items = await listInspectionSmsReminderCandidates({ branchId });
      res.json({
        total: items.length,
        branch_id: branchId,
        items,
      });
    } catch (e) {
      logger.error('Blad podgladu SMS przypomnien ogledzin', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

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

router.get(
  '/daily-digest/history',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik'),
  async (req, res) => {
    try {
      const requestedBranch = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
      const branchId = scopedOddzialId(req.user, requestedBranch);
      const history = await getDigestRunHistory(pool, {
        date: req.query.date,
        branchId,
        scope: req.query.scope,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json(history);
    } catch (e) {
      logger.error('Blad historii digestu operacyjnego', {
        message: e.message,
        requestId: req.requestId,
      });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.get(
  '/daily-digest/settings',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  async (req, res) => {
    try {
      res.json({ settings: await listDigestSettings(pool) });
    } catch (e) {
      logger.error('Blad ustawien digestu operacyjnego', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.put(
  '/daily-digest/settings',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  async (req, res) => {
    try {
      const settings = await saveDigestSettings(pool, {
        ...(req.body || {}),
        updated_by: req.user?.id || null,
      });
      await logAudit(pool, req, {
        action: 'operational_digest_settings_update',
        entityType: 'automation',
        entityId: settings.scope_key,
        metadata: settings,
      });
      res.json({ settings });
    } catch (e) {
      logger.error('Blad zapisu ustawien digestu operacyjnego', { message: e.message, requestId: req.requestId });
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
      const inspectionSmsReminders = await sendInspectionSmsReminders();
      const digestOptions = {
        date: req.body?.date,
        horizonDays: req.body?.horizon_days,
        fleetLookaheadDays: req.body?.fleet_lookahead_days,
        actorUserId: req.user?.id || null,
        triggerType: req.body?.trigger_type || 'manual',
      };
      if (req.body?.email !== undefined) {
        digestOptions.emailEnabled = req.body.email === true;
      }
      const operationalDigest = await runOperationalDigest(pool, digestOptions);
      await dispatchWebhook(
        'automation.daily.executed',
        {
          reminders,
          inspectionSmsReminders,
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
          inspectionSmsReminders,
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
        inspectionSmsReminders,
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

router.get(
  '/team-league/preview',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik'),
  async (req, res) => {
    try {
      const requestedBranch = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
      const branchId = scopedOddzialId(req.user, requestedBranch);
      const payload = await buildWeeklyTeamLeague(pool, req.user, {
        as_of: req.query.as_of,
        oddzial_id: branchId,
        limit: req.query.limit,
        branchLimit: req.query.branch_limit,
      });
      res.json(payload);
    } catch (e) {
      logger.error('Blad podgladu ligi brygad Telegram', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/team-league/send',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  async (req, res) => {
    try {
      const requestedBranch = req.body?.oddzial_id ? Number(req.body.oddzial_id) : null;
      const branchId = scopedOddzialId(req.user, requestedBranch);
      const payload = await publishWeeklyTeamLeague(pool, req.user, {
        as_of: req.body?.as_of,
        oddzial_id: branchId,
        limit: req.body?.limit,
        branchLimit: req.body?.branch_limit,
        dryRun: req.body?.dry_run === true,
      });
      await logAudit(pool, req, {
        action: payload.dryRun ? 'team_league_preview' : 'team_league_telegram_sent',
        entityType: 'automation',
        entityId: 'team-league-weekly',
        metadata: {
          as_of: req.body?.as_of || null,
          oddzial_id: branchId || null,
          dry_run: payload.dryRun,
        },
      });
      res.json({
        success: true,
        dryRun: payload.dryRun,
        text: payload.text,
        telegram: payload.telegram,
        generated_at: payload.ranking?.generated_at,
      });
    } catch (e) {
      logger.error('Blad wysylki ligi brygad Telegram', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: e.message });
    }
  }
);

router.get('/daily-digest/tick', async (req, res) => {
  const secret = String(process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const inspectionSmsReminders = await sendInspectionSmsReminders();
    const operationalDigest = await runOperationalDigest(pool, {
      date: req.query.date,
      triggerType: 'cron',
      respectEnabled: true,
    });
    await dispatchWebhook('automation.daily_digest.cron', {
      inspectionSmsReminders,
      operationalDigest: {
        global: operationalDigest.global?.summary || null,
        branches: (operationalDigest.branches || []).map((branch) => ({
          branch_id: branch.branch_id,
          summary: branch.summary || null,
          skipped: branch.skipped || null,
        })),
      },
    }, { retries: 3 });
    res.json({ success: true, inspectionSmsReminders, operationalDigest, executedAt: new Date().toISOString() });
  } catch (e) {
    logger.error('Blad cron digestu operacyjnego', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

router.get('/team-league/tick', async (req, res) => {
  const secret = String(process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const payload = await publishWeeklyTeamLeague(
      pool,
      { id: null, rola: 'Administrator', oddzial_id: null },
      {
        as_of: req.query.as_of,
        oddzial_id: req.query.oddzial_id ? Number(req.query.oddzial_id) : null,
        limit: req.query.limit,
        branchLimit: req.query.branch_limit,
        dryRun: req.query.dry_run === '1' || req.query.dry_run === 'true',
      }
    );
    await dispatchWebhook('automation.team_league.weekly', {
      dryRun: payload.dryRun,
      generatedAt: payload.ranking?.generated_at,
      asOf: payload.ranking?.as_of,
      week: payload.ranking?.periods?.week
        ? {
            from: payload.ranking.periods.week.from,
            to: payload.ranking.periods.week.to,
            winner: payload.ranking.periods.week.winner || null,
          }
        : null,
    }, { retries: 3 });
    res.json({
      success: true,
      dryRun: payload.dryRun,
      generated_at: payload.ranking?.generated_at,
      telegram: payload.telegram,
    });
  } catch (e) {
    logger.error('Blad cron ligi brygad Telegram', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
