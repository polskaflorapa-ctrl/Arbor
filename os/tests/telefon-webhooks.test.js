const request = require('supertest');

jest.mock('../src/services/phone-call-pipeline', () => ({
  markRecordingReady: jest.fn().mockResolvedValue(undefined),
  processRecordingPipeline: jest.fn().mockResolvedValue(undefined),
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
});
