const express = require('express');
const twilioLib = require('twilio');
const logger = require('../config/logger');
const { env } = require('../config/env');
const {
  markCallCompleted,
  markRecordingReady,
  processRecordingPipeline,
  upsertCallLegFromTwiml,
} = require('../services/phone-call-pipeline');
const {
  extractPbxRecordUrl,
  requestPbxRecord,
  verifyWebhookSignatureAsync: verifyZadarmaWebhookSignature,
} = require('../services/zadarma');

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

router.get('/zadarma', (req, res) => {
  if (req.query?.zd_echo != null) return res.type('text/plain').send(String(req.query.zd_echo));
  return res.type('text/plain').send('OK');
});

router.post('/zadarma', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const event = String(req.body?.event || '').trim();
    if (!(await verifyZadarmaWebhookSignature(req.body || {}, req.get('signature') || req.get('x-zadarma-signature')))) {
      logger.warn('Zadarma phone webhook: niepoprawny podpis', { event });
      return res.status(403).type('text/plain').send('Forbidden');
    }

    if (event === 'NOTIFY_OUT_END' || event === 'NOTIFY_END') {
      const pbxCallId = String(req.body?.pbx_call_id || '').trim();
      if (!pbxCallId) return res.status(204).send();
      const conversationId = `zadarma:${pbxCallId}`;
      const isOutbound = event === 'NOTIFY_OUT_END';
      const clientNumber = String(isOutbound ? req.body?.destination || '' : req.body?.caller_id || '').trim();
      const staffNumber = String(req.body?.internal || req.body?.caller_id || req.body?.called_did || '').trim();
      await upsertCallLegFromTwiml({
        callSid: conversationId,
        userId: null,
        taskId: null,
        staffNumber,
        clientNumber,
      });
      await markCallCompleted({
        callSid: conversationId,
        durationSec: req.body?.duration,
        status: req.body?.disposition || 'completed',
      });
      return res.status(204).send();
    }

    if (event !== 'NOTIFY_RECORD') return res.status(204).send();

    const callId = String(req.body?.call_id_with_rec || '').trim();
    const pbxCallId = String(req.body?.pbx_call_id || '').trim();
    if (!callId && !pbxCallId) {
      return res.status(400).type('text/plain').send('Missing call_id_with_rec or pbx_call_id');
    }

    const data = await requestPbxRecord({ callId, pbxCallId });
    const recordingUrl = extractPbxRecordUrl(data);
    if (!recordingUrl) {
      logger.warn('Zadarma phone webhook: brak URL nagrania', { callId, pbxCallId, data });
      return res.status(202).type('text/plain').send('Recording URL not ready');
    }

    const conversationId = `zadarma:${pbxCallId || callId}`;
    await markRecordingReady({
      callSid: conversationId,
      recordingSid: callId || pbxCallId,
      recordingUrl,
      durationSec: null,
    });
    setImmediate(() => {
      processRecordingPipeline(conversationId).catch((e) =>
        logger.error('processRecordingPipeline Zadarma', { callSid: conversationId, message: e.message })
      );
    });

    return res.status(204).send();
  } catch (e) {
    logger.error('telefon-webhooks /zadarma', { message: e.message });
    return res.status(500).type('text/plain').send('Error');
  }
});

module.exports = router;
