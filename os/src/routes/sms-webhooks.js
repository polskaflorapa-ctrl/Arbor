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

/**
 * Mapowanie MessageStatus → pole `sms_history.status` / `error`.
 * Aktualizujemy tylko stany końcowe (dostawa / brak dostawy).
 */
function mapTerminalSmsStatus(MessageStatus, ErrorMessage) {
  const st = String(MessageStatus || '').toLowerCase();
  if (st === 'delivered') return { status: 'Dostarczony', error: null };
  if (st === 'failed' || st === 'undelivered') {
    const err = ErrorMessage ? String(ErrorMessage).slice(0, 2000) : MessageStatus || 'failed';
    return { status: 'Niedostarczony', error: err };
  }
  return null;
}

/** POST — Twilio Status Callback dla SMS (application/x-www-form-urlencoded). */
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

    const MessageSid = req.body.MessageSid;
    const MessageStatus = req.body.MessageStatus;
    const ErrorMessage = req.body.ErrorMessage;

    if (!MessageSid) {
      return res.status(400).type('text/plain').send('Missing MessageSid');
    }

    const mapped = mapTerminalSmsStatus(MessageStatus, ErrorMessage);
    if (mapped) {
      const r = await pool.query(
        `UPDATE sms_history SET status = $1, error = $2 WHERE sid = $3`,
        [mapped.status, mapped.error, MessageSid]
      );
      if (r.rowCount === 0) {
        logger.warn('sms status webhook: brak wiersza sms_history dla sid', {
          MessageSid,
          MessageStatus,
        });
      }
    }

    return res.status(204).send();
  } catch (e) {
    logger.error('sms-webhooks /status', { message: e.message });
    return res.status(500).type('text/plain').send('Error');
  }
});

module.exports = router;
