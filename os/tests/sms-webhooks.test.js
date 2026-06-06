const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/zadarma', () => ({
  verifySmsStatusWebhookSignatureAsync: jest.fn(async () => true),
}));

jest.mock('../src/config/env', () => {
  const real = jest.requireActual('../src/config/env');
  const overlay = {
    PUBLIC_BASE_URL: 'https://sms-hooks-test.example.com',
    TWILIO_AUTH_TOKEN: 'auth_for_signature',
    TWILIO_SKIP_SIGNATURE_VALIDATION: true,
    ZADARMA_SKIP_SIGNATURE_VALIDATION: false,
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
const { verifySmsStatusWebhookSignatureAsync } = require('../src/services/zadarma');
const smsWebhooksRoutes = require('../src/routes/sms-webhooks');
const { createTestApp } = require('./helpers/create-test-app');

describe('SMS webhooks', () => {
  const app = createTestApp('/api/sms/webhooks', smsWebhooksRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    verifySmsStatusWebhookSignatureAsync.mockResolvedValue(true);
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.startsWith('UPDATE sms_history')) return { rowCount: 1, rows: [{ id: 10 }] };
      return { rowCount: 0, rows: [] };
    });
  });

  function updateCall() {
    return pool.query.mock.calls.find((call) => String(call[0]).startsWith('UPDATE sms_history'));
  }

  function eventInsertCall() {
    return pool.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO sms_delivery_events'));
  }

  it('POST /zadarma aktualizuje sms_history i zapisuje event przy delivered', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/zadarma')
      .type('application/x-www-form-urlencoded')
      .send('message_id=ZD_test_1&status=delivered');

    expect(res.status).toBe(204);
    expect(updateCall()[1]).toEqual(['zadarma', 'delivered', null, null, 'Dostarczony', 'ZD_test_1']);
    expect(eventInsertCall()[1]).toEqual([
      10,
      'ZD_test_1',
      'zadarma',
      'delivered',
      'Dostarczony',
      null,
      null,
      JSON.stringify({ message_id: 'ZD_test_1', status: 'delivered' }),
    ]);
  });

  it('POST /zadarma/status aktualizuje bledy dostarczenia', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/zadarma/status')
      .type('application/x-www-form-urlencoded')
      .send('message_id=ZD_test_2&status=failed&error_code=42&error_message=' + encodeURIComponent('Invalid number'));

    expect(res.status).toBe(204);
    expect(updateCall()[1]).toEqual(['zadarma', 'failed', '42', 'Invalid number', 'Niedostarczony', 'ZD_test_2']);
    expect(eventInsertCall()[1][6]).toBe('Invalid number');
  });

  it('POST /zadarma wymaga message_id', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/zadarma')
      .type('application/x-www-form-urlencoded')
      .send('status=delivered');

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST /zadarma odrzuca payload z niepoprawnym podpisem', async () => {
    verifySmsStatusWebhookSignatureAsync.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/sms/webhooks/zadarma')
      .type('application/x-www-form-urlencoded')
      .send('message_id=ZD_test_bad&status=delivered');

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST /status obsluguje Twilio compatibility webhook', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/status')
      .type('application/x-www-form-urlencoded')
      .send('MessageSid=SM_test_1&MessageStatus=delivered');

    expect(res.status).toBe(204);
    expect(updateCall()[1]).toEqual(['twilio', 'delivered', null, null, 'Dostarczony', 'SM_test_1']);
  });

  it('POST /status wymaga MessageSid', async () => {
    const res = await request(app)
      .post('/api/sms/webhooks/status')
      .type('application/x-www-form-urlencoded')
      .send('MessageStatus=delivered');

    expect(res.status).toBe(400);
  });
});
