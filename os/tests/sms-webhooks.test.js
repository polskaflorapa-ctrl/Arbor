const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/config/env', () => {
  const real = jest.requireActual('../src/config/env');
  const overlay = {
    PUBLIC_BASE_URL: 'https://sms-hooks-test.example.com',
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

const pool = require('../src/config/database');
const smsWebhooksRoutes = require('../src/routes/sms-webhooks');
const { createTestApp } = require('./helpers/create-test-app');

describe('SMS webhooks (Twilio status)', () => {
  const app = createTestApp('/api/sms/webhooks', smsWebhooksRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /status aktualizuje sms_history przy delivered', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .post('/api/sms/webhooks/status')
      .type('application/x-www-form-urlencoded')
      .send('MessageSid=SM_test_1&MessageStatus=delivered');

    expect(res.status).toBe(204);
    expect(pool.query).toHaveBeenCalledWith(
      `UPDATE sms_history SET status = $1, error = $2 WHERE sid = $3`,
      ['Dostarczony', null, 'SM_test_1']
    );
  });

  it('POST /status aktualizuje przy failed', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .post('/api/sms/webhooks/status')
      .type('application/x-www-form-urlencoded')
      .send(
        'MessageSid=SM_test_2&MessageStatus=failed&ErrorMessage=' + encodeURIComponent('Invalid number')
      );

    expect(res.status).toBe(204);
    expect(pool.query).toHaveBeenCalledWith(
      `UPDATE sms_history SET status = $1, error = $2 WHERE sid = $3`,
      ['Niedostarczony', 'Invalid number', 'SM_test_2']
    );
  });

  it('POST /status nie wywołuje UPDATE dla sent', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/status')
      .type('application/x-www-form-urlencoded')
      .send('MessageSid=SM_x&MessageStatus=sent');

    expect(res.status).toBe(204);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST /status wymaga MessageSid', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/status')
      .type('application/x-www-form-urlencoded')
      .send('MessageStatus=delivered');

    expect(res.status).toBe(400);
  });
});
