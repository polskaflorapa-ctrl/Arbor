const express = require('express');
const twilioLib = require('twilio');
const logger = require('../config/logger');
const { env } = require('../config/env');
const {
  markRecordingReady,
  processRecordingPipeline,
} = require('../services/phone-call-pipeline');

const router = express.Router();

const publicBase = () => {
  const u = env.PUBLIC_BASE_URL;
  if (!u || typeof u !== 'string') return '';
  return u.trim().replace(/\/$/, '');
};

router.post('/recording', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const base = publicBase();
    if (base && env.TWILIO_AUTH_TOKEN && !env.TWILIO_SKIP_SIGNATURE_VALIDATION) {
      const fullUrl = `${base}${req.originalUrl || ''}`;
      const signature = req.headers['x-twilio-signature'] || '';
      const ok = twilioLib.validateRequest(env.TWILIO_AUTH_TOKEN, signature, fullUrl, req.body);
      if (!ok) {
        logger.warn('Twilio recording webhook: niepoprawny podpis', { url: fullUrl });
        return res.status(403).type('text/plain').send('Forbidden');
      }
    }

    const {
      CallSid,
      RecordingSid,
      RecordingUrl,
      RecordingStatus,
      RecordingDuration,
    } = req.body;

    if (!CallSid) {
      return res.status(400).type('text/plain').send('Missing CallSid');
    }

    const st = String(RecordingStatus || '').toLowerCase();
    if (st === 'completed' && RecordingUrl) {
      try {
        await markRecordingReady({
          callSid: CallSid,
          recordingSid: RecordingSid,
          recordingUrl: RecordingUrl,
          durationSec: RecordingDuration,
        });
      } catch (e) {
        logger.error('markRecordingReady', { CallSid, message: e.message });
      }
      setImmediate(() => {
        processRecordingPipeline(CallSid).catch((e) =>
          logger.error('processRecordingPipeline', { CallSid, message: e.message })
        );
      });
    }

    return res.status(204).send();
  } catch (e) {
    logger.error('telefon-webhooks /recording', { message: e.message });
    return res.status(500).type('text/plain').send('Error');
  }
});

module.exports = router;
