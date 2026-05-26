/**
 * Unified SMS gateway — wybiera dostawcę automatycznie:
 *   1. Zadarma (jeśli ZADARMA_API_KEY + ZADARMA_API_SECRET skonfigurowane)
 *   2. Twilio  (jeśli TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN skonfigurowane)
 *   3. Brak konfiguracji → cichy no-op (logi + historia z błędem)
 *
 * Interfejs: sendSmsGateway({ to, body, taskId }) → { ok, provider, id?, sid?, error? }
 */
const logger = require('../config/logger');
const { env } = require('../config/env');
const pool = require('../config/database');
const { isZadarmaConfigured, sendSms: zadarmaSendSms } = require('./zadarma');
const { getTwilioSmsStatusCallbackUrl } = require('./twilioStatusCallback');

function normalizePlPhone(raw) {
  const d = String(raw || '').replace(/[\s-]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  const n = d.replace(/^\+?48/, '');
  if (n.length < 9) return null;
  return `+48${n}`;
}

let _smsHistoryEnsured = false;
async function ensureSmsHistoryTable() {
  if (_smsHistoryEnsured) return;
  _smsHistoryEnsured = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_history (
      id        SERIAL PRIMARY KEY,
      task_id   INTEGER REFERENCES tasks(id),
      telefon   VARCHAR(20) NOT NULL,
      tresc     TEXT NOT NULL,
      status    VARCHAR(50) DEFAULT 'Wyslany',
      sid       VARCHAR(100),
      error     TEXT,
      provider  VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Ensure provider column for older installs
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS provider VARCHAR(20)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS sid VARCHAR(100)`);
}

async function logSmsHistory({ taskId, telefon, tresc, status, sid, error, provider }) {
  try {
    await ensureSmsHistoryTable();
    await pool.query(
      `INSERT INTO sms_history (task_id, telefon, tresc, status, sid, error, provider, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [taskId || null, telefon, tresc, status, sid || null, error || null, provider || null]
    );
  } catch (e) {
    logger.warn('smsGateway.history', { message: e.message });
  }
}

/**
 * Send SMS using the best available provider.
 * @param {{ to: string, body: string, taskId?: number }} opts
 * @returns {Promise<{ ok: boolean, provider?: string, id?: string, sid?: string, error?: string }>}
 */
async function sendSmsGateway({ to, body, taskId }) {
  const text = String(body || '').slice(0, 1500);

  // ── Zadarma (preferred) ──────────────────────────────────────────────────
  if (isZadarmaConfigured()) {
    const result = await zadarmaSendSms({ to, body: text });
    await logSmsHistory({
      taskId,
      telefon: to,
      tresc: text,
      status: result.ok ? 'Wyslany' : 'Błąd',
      sid: result.message_id,   // Zadarma zwraca message_id (wg docs /v1/sms/send/)
      error: result.error,
      provider: 'zadarma',
    });
    if (result.ok) {
      logger.info('smsGateway.sent', { provider: 'zadarma', to, message_id: result.message_id });
    } else {
      logger.warn('smsGateway.error', { provider: 'zadarma', to, error: result.error });
    }
    return { ...result, provider: 'zadarma' };
  }

  // ── Twilio (fallback) ────────────────────────────────────────────────────
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE } = env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE) {
    const tel = normalizePlPhone(to);
    if (!tel) {
      const error = `Nieprawidłowy numer: ${to}`;
      await logSmsHistory({ taskId, telefon: to, tresc: text, status: 'Błąd', error, provider: 'twilio' });
      return { ok: false, provider: 'twilio', error };
    }
    try {
      const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      const statusCb = getTwilioSmsStatusCallbackUrl();
      const msg = await twilio.messages.create({
        body: text,
        from: TWILIO_PHONE,
        to: tel,
        ...(statusCb ? { statusCallback: statusCb } : {}),
      });
      await logSmsHistory({ taskId, telefon: tel, tresc: text, status: 'Wyslany', sid: msg.sid, provider: 'twilio' });
      logger.info('smsGateway.sent', { provider: 'twilio', to: tel });
      return { ok: true, provider: 'twilio', sid: msg.sid };
    } catch (e) {
      await logSmsHistory({ taskId, telefon: tel || to, tresc: text, status: 'Błąd', error: e.message, provider: 'twilio' });
      logger.error('smsGateway.error', { provider: 'twilio', to, error: e.message });
      return { ok: false, provider: 'twilio', error: e.message };
    }
  }

  // ── Brak konfiguracji ────────────────────────────────────────────────────
  const error = 'Brak konfiguracji SMS (ustaw ZADARMA_API_KEY lub TWILIO_ACCOUNT_SID)';
  logger.warn('smsGateway.notConfigured', { to });
  await logSmsHistory({ taskId, telefon: to, tresc: text, status: 'Błąd', error, provider: null });
  return { ok: false, error };
}

/**
 * Zwraca aktywnego dostawcę lub null.
 */
function activeSmsProvider() {
  if (isZadarmaConfigured()) return 'zadarma';
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) return 'twilio';
  return null;
}

module.exports = { sendSmsGateway, activeSmsProvider };
