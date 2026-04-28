const express = require('express');
const pool = require('../config/database');
const { env } = require('../config/env');
const { authMiddleware, requireRole } = require('../middleware/auth');
const logger = require('../config/logger');
const { sendSmsOptional } = require('../services/twilioSms');
const { sendSystemEmailOptional } = require('../services/systemEmail');

const router = express.Router();

router.get('/smoke', authMiddleware, requireRole('Dyrektor', 'Administrator'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const [dbRes, usersRes, tasksRes] = await Promise.all([
      pool.query('SELECT 1 AS ok'),
      pool.query('SELECT COUNT(*)::int AS c FROM users'),
      pool.query('SELECT COUNT(*)::int AS c FROM tasks'),
    ]);
    res.json({
      status: 'ok',
      checks: {
        db: dbRes.rows[0]?.ok === 1 ? 'up' : 'unknown',
        users_table: usersRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
        tasks_table: tasksRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
      },
      counts: {
        users: usersRes.rows[0]?.c || 0,
        tasks: tasksRes.rows[0]?.c || 0,
      },
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('Blad smoke check', { message: e.message, requestId: req.requestId });
    res.status(503).json({
      status: 'failed',
      error: e.message,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  }
});

/** F1.10 — prosty tick SLA: przypomnienie dla przeterminowanych zatwierdzeń (bez eskalacji hierarchicznej). */
router.get('/quotation-sla-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const emailOn = process.env.QUOTATION_SLA_EMAIL === '1';
    const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const { rows } = await pool.query(
      `SELECT a.id, a.quotation_id, a.wymagany_typ, a.due_at
       FROM quotation_approvals a
       JOIN quotations q ON q.id = a.quotation_id
       WHERE a.decyzja = 'Pending' AND q.status = 'W_Zatwierdzeniu'
         AND a.due_at IS NOT NULL AND a.due_at < NOW()
         AND a.sla_reminder_sent_at IS NULL
       LIMIT 100`
    );
    let emailsSent = 0;
    for (const r of rows) {
      const tresc = `SLA: zatwierdzenie wyceny #${r.quotation_id} (${r.wymagany_typ}) po terminie.`;
      const linkLine = base ? `\n\nPanel: ${base}/wycena-kalendarz` : '';
      const users = await pool.query(
        `SELECT DISTINCT u.id, NULLIF(TRIM(u.email), '') AS email FROM users u
         WHERE u.aktywny IS NOT FALSE AND (
           (u.rola = 'Kierownik' AND u.oddzial_id = (SELECT oddzial_id FROM quotations WHERE id = $1))
           OR u.rola IN ('Dyrektor','Administrator')
         )`,
        [r.quotation_id]
      );
      for (const u of users.rows) {
        await pool.query(
          `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
           VALUES (NULL, $1, NULL, $2, 'quotation_sla', $3, 'Nowe')`,
          [u.id, r.quotation_id, tresc]
        );
        if (emailOn && u.email) {
          const mail = await sendSystemEmailOptional({
            to: u.email,
            subject: `[ARBOR] SLA wyceny #${r.quotation_id}`,
            text: `${tresc}${linkLine}`,
          });
          if (mail.sent) emailsSent += 1;
        }
      }
      await pool.query(`UPDATE quotation_approvals SET sla_reminder_sent_at = NOW() WHERE id = $1`, [r.id]);
    }
    res.json({ processed: rows.length, emails_sent: emailsSent });
  } catch (e) {
    logger.error('ops quotation-sla-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** Wyceny w statusie Wyslana_Klientowi po terminie ważności → Wygasla (cron z ?secret=OPS_CRON_SECRET). */
router.get('/quotation-expiry-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE quotations SET status = 'Wygasla', updated_at = NOW()
       WHERE status = 'Wyslana_Klientowi' AND waznosc_do IS NOT NULL AND waznosc_do < NOW()
       RETURNING id`
    );
    res.json({ expired: rows.length, ids: rows.map((r) => r.id) });
  } catch (e) {
    logger.error('ops quotation-expiry-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.5 — kasa zadeklarowana, brak odbioru: przypomnienia po 48 h i 7 dniach (in-app). */
router.get('/payroll-cash-reminder-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const typ = 'kasa_oddzial_nieodebrana';
  const smsOn = process.env.PAYROLL_CASH_REMINDER_SMS === '1';
  const emailOn = process.env.PAYROLL_CASH_REMINDER_EMAIL === '1';
  let emailSent48 = 0;
  let emailSent7 = 0;

  const notifyForPickup = async (row, label) => {
    const meta = await pool.query(
      `SELECT t.nazwa AS team_nazwa, b.nazwa AS oddzial_nazwa
       FROM teams t JOIN branches b ON b.id = $1 WHERE t.id = $2`,
      [row.oddzial_id, row.team_id]
    );
    const m = meta.rows[0] || {};
    const teamN = m.team_nazwa || `ekipa #${row.team_id}`;
    const oddN = m.oddzial_nazwa || `oddział #${row.oddzial_id}`;
    const cash = Math.round((Number(row.declared_cash) || 0) * 100) / 100;
    const msg =
      label === '48h'
        ? `${oddN}: wpis kasy (${teamN}, ${row.pickup_date}) ${cash} PLN — brak potwierdzenia odbioru od 48 h.`
        : `${oddN}: PILNE — kasa (${teamN}, ${row.pickup_date}) ${cash} PLN nieodebrana od 7 dni.`;
    const { rows: recipients } = await pool.query(
      `SELECT id, telefon, email FROM users WHERE aktywny IS NOT FALSE AND (
         rola IN ('Dyrektor','Administrator')
         OR (rola = 'Kierownik' AND oddzial_id = $1)
       )`,
      [row.oddzial_id]
    );
    const smsBody = msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
    const subject =
      label === '48h'
        ? `[ARBOR] Kasa oddziału — przypomnienie 48 h (${oddN})`
        : `[ARBOR] PILNE: kasa oddziału 7 dni (${oddN})`;
    const esc = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
    const html = `<p style="font-family:system-ui,sans-serif">${esc(msg)}</p>`;
    for (const u of recipients) {
      await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
         VALUES (NULL, $1, NULL, $2, $3, 'Nowe')`,
        [u.id, typ, msg]
      );
      if (smsOn && u.telefon) {
        await sendSmsOptional({ to: u.telefon, body: smsBody, taskId: null });
      }
      if (emailOn && u.email && String(u.email).trim()) {
        const r = await sendSystemEmailOptional({
          to: String(u.email).trim(),
          subject,
          text: msg,
          html,
        });
        if (r.sent) {
          if (label === '48h') emailSent48 += 1;
          else emailSent7 += 1;
        }
      }
    }
  };

  try {
    const r48 = await pool.query(
      `UPDATE branch_cash_pickups p
       SET cash_reminder_48h_sent_at = NOW()
       FROM (
         SELECT id FROM branch_cash_pickups
         WHERE received_at IS NULL
           AND created_at <= NOW() - INTERVAL '48 hours'
           AND cash_reminder_48h_sent_at IS NULL
         ORDER BY id
         LIMIT 80
       ) sub
       WHERE p.id = sub.id
       RETURNING p.id, p.oddzial_id, p.team_id, p.pickup_date, p.declared_cash`
    );
    for (const row of r48.rows) {
      await notifyForPickup(row, '48h');
    }

    const r7 = await pool.query(
      `UPDATE branch_cash_pickups p
       SET cash_reminder_7d_sent_at = NOW()
       FROM (
         SELECT id FROM branch_cash_pickups
         WHERE received_at IS NULL
           AND created_at <= NOW() - INTERVAL '7 days'
           AND cash_reminder_7d_sent_at IS NULL
         ORDER BY id
         LIMIT 80
       ) sub
       WHERE p.id = sub.id
       RETURNING p.id, p.oddzial_id, p.team_id, p.pickup_date, p.declared_cash`
    );
    for (const row of r7.rows) {
      await notifyForPickup(row, '7d');
    }

    res.json({
      reminded_48h: r48.rows.length,
      reminded_7d: r7.rows.length,
      email_reminders_48h: emailSent48,
      email_reminders_7d: emailSent7,
    });
  } catch (e) {
    if (String(e.message || '').includes('cash_reminder')) {
      return res.status(503).json({ error: 'Uruchom migrację (kolumny cash_reminder_* na branch_cash_pickups).' });
    }
    logger.error('ops payroll-cash-reminder-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
