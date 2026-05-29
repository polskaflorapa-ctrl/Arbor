const express = require('express');
const twilioLib = require('twilio');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');

const router = express.Router();

const publicBase = () => {
  const u = env.PUBLIC_BASE_URL;
  if (!u || typeof u !== 'string') return '';
  return u.trim().replace(/\/$/, '');
};

function mapTerminalSmsStatus(providerStatus, errorMessage) {
  const st = String(providerStatus || '').trim().toLowerCase();
  if (['delivered', 'dostarczony', 'delivered_to_phone', 'success', 'ok'].includes(st)) {
    return { status: 'Dostarczony', error: null };
  }
  if (['failed', 'undelivered', 'not_delivered', 'niedostarczony', 'rejected', 'expired', 'error', 'canceled', 'cancelled', 'denied'].includes(st)) {
    const err = errorMessage ? String(errorMessage).slice(0, 2000) : providerStatus || 'failed';
    return { status: 'Niedostarczony', error: err };
  }
  return null;
}

async function ensureSmsDeliveryTrackingTables() {
  await pool.query('ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS provider VARCHAR(20)');
  await pool.query('ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS provider_status VARCHAR(80)');
  await pool.query('ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS delivery_error_code VARCHAR(80)');
  await pool.query('ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_delivery_events (
      id SERIAL PRIMARY KEY,
      sms_history_id INTEGER REFERENCES sms_history(id) ON DELETE SET NULL,
      sid VARCHAR(100) NOT NULL,
      provider VARCHAR(20) NOT NULL,
      provider_status VARCHAR(80),
      mapped_status VARCHAR(80),
      error_code VARCHAR(80),
      error_message TEXT,
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sms_delivery_events_sid ON sms_delivery_events(sid, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sms_delivery_events_history ON sms_delivery_events(sms_history_id, created_at DESC)');
}

function pickFirst(body, keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

function extractZadarmaPayload(body = {}) {
  const sid = pickFirst(body, ['message_id', 'messageId', 'sms_id', 'smsId', 'id', 'sid']);
  const providerStatus = pickFirst(body, ['status', 'sms_status', 'message_status', 'delivery_status', 'event']);
  const errorMessage = pickFirst(body, ['error_message', 'error', 'reason', 'message']);
  const errorCode = pickFirst(body, ['error_code', 'code']);
  return { sid, providerStatus, errorMessage, errorCode };
}

async function recordSmsDeliveryEvent({ provider, sid, providerStatus, mapped, errorCode, errorMessage, rawPayload }) {
  await ensureSmsDeliveryTrackingTables();
  const updated = await pool.query(
    `UPDATE sms_history
        SET provider = COALESCE(provider, $1),
            provider_status = $2,
            delivery_error_code = $3,
            delivery_updated_at = NOW(),
            delivered_at = CASE WHEN $5 = 'Dostarczony' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
            status = COALESCE($5, status),
            error = CASE
              WHEN $5 = 'Dostarczony' THEN NULL
              WHEN $5 = 'Niedostarczony' THEN $4
              ELSE error
            END
      WHERE sid = $6
      RETURNING id`,
    [provider, providerStatus || null, errorCode || null, mapped?.error || errorMessage || null, mapped?.status || null, sid]
  );
  if (updated.rowCount === 0) {
    logger.warn('sms status webhook: brak wiersza sms_history dla sid', { provider, sid, providerStatus });
  }
  await pool.query(
    `INSERT INTO sms_delivery_events (
      sms_history_id, sid, provider, provider_status, mapped_status, error_code, error_message, raw_payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      updated.rows[0]?.id || null,
      sid,
      provider,
      providerStatus || null,
      mapped?.status || null,
      errorCode || null,
      mapped?.error || errorMessage || null,
      JSON.stringify(rawPayload || {}),
    ]
  );
  return { matched: updated.rowCount > 0, sms_history_id: updated.rows[0]?.id || null };
}

async function handleZadarmaStatus(req, res) {
  try {
    const body = req.body || {};
    const payload = extractZadarmaPayload(body);
    if (!payload.sid) return res.status(400).type('text/plain').send('Missing message_id');
    const mapped = mapTerminalSmsStatus(payload.providerStatus, payload.errorMessage);
    await recordSmsDeliveryEvent({
      provider: 'zadarma',
      sid: payload.sid,
      providerStatus: payload.providerStatus,
      mapped,
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
      rawPayload: body,
    });
    return res.status(204).send();
  } catch (e) {
    logger.error('sms-webhooks /zadarma', { message: e.message });
    return res.status(500).type('text/plain').send('Error');
  }
}

router.post('/zadarma', express.urlencoded({ extended: false }), handleZadarmaStatus);

router.post('/zadarma/status', express.urlencoded({ extended: false }), handleZadarmaStatus);

router.post('/status', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const base = publicBase();
    if (base && env.TWILIO_AUTH_TOKEN && !env.TWILIO_SKIP_SIGNATURE_VALIDATION) {
      const fullUrl = `${base}${req.originalUrl || ''}`;
      const signature = req.headers['x-twilio-signature'] || '';
      const ok = twilioLib.validateRequest(env.TWILIO_AUTH_TOKEN, signature, fullUrl, req.body);
      if (!ok) {
        logger.warn('Twilio SMS status webhook: niepoprawny podpis', { url: fullUrl });
        return res.status(403).type('text/plain').send('Forbidden');
      }
    }

    const sid = req.body.MessageSid;
    const providerStatus = req.body.MessageStatus;
    const errorMessage = req.body.ErrorMessage;
    const errorCode = req.body.ErrorCode;
    if (!sid) return res.status(400).type('text/plain').send('Missing MessageSid');

    const mapped = mapTerminalSmsStatus(providerStatus, errorMessage);
    await recordSmsDeliveryEvent({
      provider: 'twilio',
      sid,
      providerStatus,
      mapped,
      errorCode,
      errorMessage,
      rawPayload: req.body,
    });

    return res.status(204).send();
  } catch (e) {
    logger.error('sms-webhooks /status', { message: e.message });
    return res.status(500).type('text/plain').send('Error');
  }
});

module.exports = router;
