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
      oddzial_id INTEGER,
      sender_id VARCHAR(64),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Ensure provider column for older installs
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS provider VARCHAR(20)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS sid VARCHAR(100)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS provider_status VARCHAR(80)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS delivery_error_code VARCHAR(80)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS sms_cost NUMERIC(12,4)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS sms_currency VARCHAR(12)`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS oddzial_id INTEGER`);
  await pool.query(`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS sender_id VARCHAR(64)`);
}

async function ensureBranchSmsSenderColumn() {
  await pool.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(64)');
}

function normalizeSenderId(value) {
  const raw = String(value || '').trim();
  return raw ? raw.slice(0, 64) : null;
}

function resolveTwilioFrom(senderId, fallbackPhone) {
  const sender = String(senderId || '').trim();
  if (sender.startsWith('MG')) return sender;
  const normalizedSender = normalizePlPhone(sender);
  return normalizedSender || fallbackPhone;
}

async function resolveBranchSmsSender({ oddzialId, taskId } = {}) {
  try {
    await ensureBranchSmsSenderColumn();
    if (Number(oddzialId) > 0) {
      const { rows } = await pool.query('SELECT sms_sender_id, telefon FROM branches WHERE id = $1', [Number(oddzialId)]);
      return normalizeSenderId(rows[0]?.sms_sender_id || rows[0]?.telefon);
    }
    if (Number(taskId) > 0) {
      const { rows } = await pool.query(
        `SELECT b.sms_sender_id, b.telefon
           FROM tasks t
           LEFT JOIN branches b ON b.id = t.oddzial_id
          WHERE t.id = $1`,
        [Number(taskId)]
      );
      return normalizeSenderId(rows[0]?.sms_sender_id || rows[0]?.telefon);
    }
  } catch (e) {
    logger.warn('smsGateway.branchSender', { message: e.message, oddzialId, taskId });
  }
  return normalizeSenderId(env.ZADARMA_CALLER_ID);
}

async function logSmsHistory({ taskId, telefon, tresc, status, sid, error, provider, providerStatus, cost, currency, oddzialId, senderId }) {
  try {
    await ensureSmsHistoryTable();
    await pool.query(
      `INSERT INTO sms_history (
        task_id, telefon, tresc, status, sid, error, provider, provider_status, sms_cost, sms_currency, oddzial_id, sender_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        taskId || null,
        telefon,
        tresc,
        status,
        sid || null,
        error || null,
        provider || null,
        providerStatus || null,
        cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null,
        currency || null,
        oddzialId || null,
        senderId || null,
      ]
    );
  } catch (e) {
    logger.warn('smsGateway.history', { message: e.message });
  }
}

/**
 * Send SMS using the best available provider.
 * @param {{ to: string, body: string, taskId?: number, oddzialId?: number }} opts
 * @returns {Promise<{ ok: boolean, provider?: string, id?: string, sid?: string, error?: string }>}
 */
async function sendSmsGateway({ to, body, taskId, oddzialId }) {
  const text = String(body || '').slice(0, 1500);
  const senderId = await resolveBranchSmsSender({ oddzialId, taskId });

  // ── Zadarma (preferred) ──────────────────────────────────────────────────
  if (isZadarmaConfigured()) {
    const result = await zadarmaSendSms({ to, body: text, senderId });
    await logSmsHistory({
      taskId,
      oddzialId,
      telefon: to,
      tresc: text,
      status: result.ok ? 'Wyslany' : 'Błąd',
      sid: result.message_id,   // Zadarma zwraca message_id (wg docs /v1/sms/send/)
      error: result.error,
      provider: 'zadarma',
      providerStatus: result.ok ? 'accepted' : 'error',
      cost: result.cost,
      currency: result.currency,
      senderId,
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
    const twilioFrom = resolveTwilioFrom(senderId, TWILIO_PHONE);
    if (!tel) {
      const error = `Nieprawidłowy numer: ${to}`;
      await logSmsHistory({ taskId, oddzialId, telefon: to, tresc: text, status: 'Błąd', error, provider: 'twilio', senderId: twilioFrom });
      return { ok: false, provider: 'twilio', error };
    }
    try {
      const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      const statusCb = getTwilioSmsStatusCallbackUrl();
      const msg = await twilio.messages.create({
        body: text,
        from: twilioFrom,
        to: tel,
        ...(statusCb ? { statusCallback: statusCb } : {}),
      });
      await logSmsHistory({ taskId, oddzialId, telefon: tel, tresc: text, status: 'Wyslany', sid: msg.sid, provider: 'twilio', senderId: twilioFrom });
      logger.info('smsGateway.sent', { provider: 'twilio', to: tel });
      return { ok: true, provider: 'twilio', sid: msg.sid };
    } catch (e) {
      await logSmsHistory({ taskId, oddzialId, telefon: tel || to, tresc: text, status: 'Błąd', error: e.message, provider: 'twilio', senderId: twilioFrom });
      logger.error('smsGateway.error', { provider: 'twilio', to, error: e.message });
      return { ok: false, provider: 'twilio', error: e.message };
    }
  }

  // ── Brak konfiguracji ────────────────────────────────────────────────────
  const error = 'Brak konfiguracji SMS (ustaw ZADARMA_API_KEY lub TWILIO_ACCOUNT_SID)';
  logger.warn('smsGateway.notConfigured', { to });
  await logSmsHistory({ taskId, oddzialId, telefon: to, tresc: text, status: 'Błąd', error, provider: null, senderId });
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

module.exports = { sendSmsGateway, activeSmsProvider, resolveBranchSmsSender };
