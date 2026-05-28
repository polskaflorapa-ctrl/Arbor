const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const crmRoutes = require('../src/routes/crm');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

const app = createTestApp('/api/crm', crmRoutes);

const token = (payload = {}) => jwt.sign({
  id: 9,
  rola: 'Kierownik',
  oddzial_id: 7,
  ...payload,
}, env.JWT_SECRET);

function messageRow(overrides = {}) {
  return {
    id: 501,
    lead_id: 22,
    lead_title: 'Oferta ogrodu',
    lead_phone: '+48500100200',
    lead_email: 'jan@example.test',
    oddzial_id: 7,
    client_name: 'Jan Klient',
    channel: 'whatsapp',
    direction: 'outbound',
    sender_name: 'Anna',
    sender_handle: 'ARBOR',
    recipient_handle: '+48500100200',
    subject: null,
    body: 'Dzien dobry, wracam z oferta.',
    status: 'queued',
    external_message_id: null,
    external_thread_id: null,
    template_key: 'followup',
    dynamic_fields: {},
    metadata: {},
    retry_count: 0,
    last_error: null,
    delivered_at: null,
    read_at: null,
    created_by: 9,
    created_at: '2026-05-28T08:00:00.000Z',
    imie: 'Anna',
    nazwisko: 'Kowalska',
    login: 'anna',
    ...overrides,
  };
}

describe('CRM message send queue', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params = []) => {
      const text = String(sql);
      if (text.includes('ALTER TABLE crm_lead_messages') || text.includes('CREATE INDEX IF NOT EXISTS idx_crm_lead_messages_queue')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('FROM crm_lead_messages m') && text.includes('ORDER BY m.created_at ASC')) {
        return Promise.resolve({ rows: [messageRow()] });
      }
      if (text.includes('FROM crm_lead_messages m') && text.includes('WHERE m.id = $1')) {
        return Promise.resolve({ rows: [messageRow({ id: params[0] })] });
      }
      if (text.includes('UPDATE crm_lead_messages')) {
        return Promise.resolve({ rows: [messageRow({ id: params[0], status: params[1], last_error: params[2] })] });
      }
      if (text.includes('UPDATE crm_leads SET updated_at')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('lists queued outbound messages for the scoped branch', async () => {
    const res = await request(app)
      .get('/api/crm/messages/queue?status=queued&oddzial_id=7&limit=5')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 501,
        lead_id: 22,
        lead_title: 'Oferta ogrodu',
        channel: 'whatsapp',
        direction: 'outbound',
        status: 'queued',
        retry_count: 0,
      }),
    ]);
    const queueCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('ORDER BY m.created_at ASC'));
    expect(queueCall[0]).toContain('JOIN crm_leads l ON l.id = m.lead_id');
    expect(queueCall[0]).toContain('m.status = ANY($1)');
    expect(queueCall[0]).toContain('l.oddzial_id = $2');
    expect(queueCall[1]).toEqual([['queued'], 7, 5]);
  });

  it('marks queued messages as sent', async () => {
    const res = await request(app)
      .patch('/api/crm/messages/501/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'sent' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id: 501, status: 'sent' }));
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE crm_lead_messages'));
    expect(updateCall[1][1]).toBe('sent');
  });

  it('stores failed delivery errors and increments retry count in SQL', async () => {
    const res = await request(app)
      .patch('/api/crm/messages/501/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'failed', error: 'Provider timeout' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id: 501, status: 'failed', last_error: 'Provider timeout' }));
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE crm_lead_messages'));
    expect(updateCall[0]).toContain('retry_count = CASE WHEN $2 = \'failed\' THEN retry_count + 1 ELSE retry_count END');
    expect(updateCall[1][2]).toBe('Provider timeout');
  });
});
