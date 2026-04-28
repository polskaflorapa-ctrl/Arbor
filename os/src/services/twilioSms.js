const logger = require('../config/logger');
const { env } = require('../config/env');
const pool = require('../config/database');

function getClient() {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  // eslint-disable-next-line global-require
  return require('twilio')(accountSid, authToken);
}

function normalizePlPhone(raw) {
  const d = String(raw || '').replace(/\s/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  const n = d.replace(/^\+?48/, '');
  if (n.length < 9) return null;
  return `+48${n}`;
}

/**
 * Wysyłka SMS (Twilio); brak konfiguracji = cichy no-op.
 * @returns {Promise<{ ok: boolean, sid?: string, error?: string }>}
 */
async function sendSmsOptional({ to, body, taskId }) {
  const client = getClient();
  const fromNumber = env.TWILIO_PHONE;
  const tel = normalizePlPhone(to);
  if (!client || !fromNumber || !tel || !body) {
    return { ok: false, error: 'SMS nieskonfigurowany lub brak numeru' };
  }
  try {
    const message = await client.messages.create({
      body: String(body).slice(0, 1500),
      from: fromNumber,
      to: tel,
    });
    try {
      await pool.query(
        `INSERT INTO sms_history (task_id, telefon, tresc, status, sid, created_at)
         VALUES ($1, $2, $3, 'Wyslany', $4, NOW())`,
        [taskId || null, tel, body, message.sid]
      );
    } catch (e) {
      logger.warn('twilioSms.history', { message: e.message });
    }
    return { ok: true, sid: message.sid };
  } catch (e) {
    logger.error('twilioSms.send', { message: e.message });
    try {
      await pool.query(
        `INSERT INTO sms_history (task_id, telefon, tresc, status, error, created_at)
         VALUES ($1, $2, $3, 'Błąd', $4, NOW())`,
        [taskId || null, tel, body, e.message]
      );
    } catch {
      /* ignore */
    }
    return { ok: false, error: e.message };
  }
}

module.exports = { sendSmsOptional, normalizePlPhone };
