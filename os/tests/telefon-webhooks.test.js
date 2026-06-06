const request = require('supertest');

jest.mock('../src/services/phone-call-pipeline', () => ({
  markRecordingReady: jest.fn().mockResolvedValue(undefined),
  processRecordingPipeline: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/zadarma', () => ({
  extractPbxRecordUrl: jest.fn((data) => data.record_url || ''),
  requestPbxRecord: jest.fn().mockResolvedValue({ record_url: 'https://zadarma.test/record.mp3' }),
  verifyWebhookSignatureAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/config/env', () => {
  const real = jest.requireActual('../src/config/env');
  const overlay = {
    PUBLIC_BASE_URL: 'https://hooks-test.example.com',
    TWILIO_AUTH_TOKEN: 'auth_for_signature',
    TWILIO_SKIP_SIGNATURE_VALIDATION: true,
  };
  return {
    env: new Proxy(real.env, {
      get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(overlay, prop)) return overlay[prop];
        return target[prop];
      },
    }),
  };
});

const { markRecordingReady, processRecordingPipeline } = require('../src/services/phone-call-pipeline');
const {
  requestPbxRecord,
  verifyWebhookSignatureAsync,
} = require('../src/services/zadarma');
const telefonWebhooksRoutes = require('../src/routes/telefon-webhooks');
const { createTestApp } = require('./helpers/create-test-app');

describe('Telefon webhooks (Twilio)', () => {
  const app = createTestApp('/api/telefon/webhooks', telefonWebhooksRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /recording returns 204 and schedules pipeline when completed', async () => {
    const res = await request(app)
      .post('/api/telefon/webhooks/recording')
      .type('application/x-www-form-urlencoded')
      .send(
        'CallSid=CA_webhook_1&RecordingSid=RE1&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2Frec.mp3&RecordingStatus=completed&RecordingDuration=42'
      );

    expect(res.status).toBe(204);
    expect(markRecordingReady).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: 'CA_webhook_1',
        recordingSid: 'RE1',
        recordingUrl: 'https://api.twilio.com/rec.mp3',
        durationSec: '42',
      })
    );
    await new Promise((r) => setImmediate(r));
    expect(processRecordingPipeline).toHaveBeenCalledWith('CA_webhook_1');
  });

  it('POST /recording returns 204 without pipeline when not completed', async () => {
    const res = await request(app)
      .post('/api/telefon/webhooks/recording')
      .type('application/x-www-form-urlencoded')
      .send('CallSid=CA_x&RecordingStatus=in-progress');

    expect(res.status).toBe(204);
    expect(markRecordingReady).not.toHaveBeenCalled();
  });

  it('GET /zadarma echoes zd_echo for Zadarma webhook activation', async () => {
    const res = await request(app).get('/api/telefon/webhooks/zadarma?zd_echo=abc123');

    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  it('POST /zadarma stores recording URL on NOTIFY_RECORD and schedules pipeline', async () => {
    const res = await request(app)
      .post('/api/telefon/webhooks/zadarma')
      .type('application/x-www-form-urlencoded')
      .send('event=NOTIFY_RECORD&pbx_call_id=pbx-1&call_id_with_rec=rec-1&signature=sig');

    expect(res.status).toBe(204);
    expect(verifyWebhookSignatureAsync).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'NOTIFY_RECORD', pbx_call_id: 'pbx-1', call_id_with_rec: 'rec-1', signature: 'sig' }),
      undefined
    );
    expect(requestPbxRecord).toHaveBeenCalledWith({ callId: 'rec-1', pbxCallId: 'pbx-1' });
    expect(markRecordingReady).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: 'zadarma:pbx-1',
        recordingSid: 'rec-1',
        recordingUrl: 'https://zadarma.test/record.mp3',
      })
    );
    await new Promise((r) => setImmediate(r));
    expect(processRecordingPipeline).toHaveBeenCalledWith('zadarma:pbx-1');
  });
});
