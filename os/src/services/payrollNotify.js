const logger = require('../config/logger');
const { env } = require('../config/env');
const { sendExpoPushMessages } = require('./expoPush');

/**
 * F11.8 — po zatwierdzeniu raportu dnia: powiadomienie in-app dla każdej linii (pracownik × kwota) + opcjonalnie push Expo.
 * @param {import('pg').Pool} pool
 * @param {number} fromUserId
 * @param {number} reportId
 */
async function notifyPayrollTeamDayApproved(pool, fromUserId, reportId) {
  try {
    const r = await pool.query(
      `SELECT r.team_id, r.report_date::text AS rd FROM payroll_team_day_reports r WHERE r.id = $1`,
      [reportId]
    );
    const rep = r.rows[0];
    if (!rep) return;
    const { rows: lines } = await pool.query(
      `SELECT user_id, pay_pln FROM payroll_team_day_report_lines WHERE report_id = $1`,
      [reportId]
    );
    const typ = 'raport_dnia_ekipy';
    /** @type {Map<number, string>} */
    const messageByUser = new Map();
    for (const ln of lines) {
      const uid = ln.user_id;
      if (!uid) continue;
      const pay = Math.round((Number(ln.pay_pln) || 0) * 100) / 100;
      const msg = `Zatwierdzono raport dnia (${rep.rd}). Twoja dniówka z tego dnia: ${pay} PLN.`;
      messageByUser.set(Number(uid), msg);
      await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc)
         VALUES ($1, $2, NULL, $3, $4)`,
        [fromUserId, uid, typ, msg]
      );
    }

    if (!env.PAYROLL_PUSH_ENABLED || messageByUser.size === 0) return;

    const uids = [...messageByUser.keys()];
    let tokenRows;
    try {
      tokenRows = await pool.query(
        `SELECT user_id, expo_token FROM user_expo_push_tokens WHERE user_id = ANY($1::int[])`,
        [uids]
      );
    } catch (e) {
      if (String(e.message || '').includes('user_expo_push_tokens')) {
        logger.warn('payroll.notify.push.skip', { reportId, reason: 'no_table' });
        return;
      }
      throw e;
    }
    const title = 'Raport dnia';
    const pushMessages = [];
    for (const row of tokenRows.rows) {
      const uid = Number(row.user_id);
      const body = messageByUser.get(uid);
      const to = row.expo_token && String(row.expo_token).trim();
      if (!body || !to) continue;
      pushMessages.push({
        to,
        title,
        body,
        data: {
          type: typ,
          screen: '/powiadomienia',
          reportId: String(reportId),
          reportDate: rep.rd,
        },
      });
    }
    await sendExpoPushMessages(pushMessages);
  } catch (e) {
    logger.warn('payroll.notify.approved', { message: e.message, reportId });
  }
}

module.exports = { notifyPayrollTeamDayApproved };
