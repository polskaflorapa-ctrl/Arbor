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

describe('CRM lead messages', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('lists unified inbox messages for an accessible lead', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 7 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            lead_id: 22,
            channel: 'whatsapp',
            direction: 'inbound',
            sender_name: 'Jan Klient',
            sender_handle: '+48500100200',
            recipient_handle: 'ARBOR',
            subject: null,
            body: 'Poprosze wycene',
            status: 'received',
            external_message_id: 'wamid.1',
            external_thread_id: 'thread-1',
            template_key: null,
            dynamic_fields: { city: 'Krakow' },
            metadata: { source: 'webhook' },
            delivered_at: null,
            read_at: null,
            created_by: 9,
            created_at: '2026-05-28T08:00:00.000Z',
            imie: 'Anna',
            nazwisko: 'Kowalska',
            login: 'anna',
          },
        ],
      });

    const res = await request(app)
      .get('/api/crm/leads/22/messages?channel=whatsapp')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 101,
        lead_id: 22,
        channel: 'whatsapp',
        direction: 'inbound',
        body: 'Poprosze wycene',
        author_name: 'Anna Kowalska',
      }),
    ]);
    expect(pool.query.mock.calls[1][0]).toContain('FROM crm_lead_messages m');
    expect(pool.query.mock.calls[1][0]).toContain('m.channel = $2');
    expect(pool.query.mock.calls[1][1]).toEqual([22, 'whatsapp']);
  });

  it('stores outbound channel messages and updates the lead timestamp', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 7 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 102,
            lead_id: 22,
            channel: 'email',
            direction: 'outbound',
            sender_name: 'Anna Kowalska',
            sender_handle: 'anna@arbor.test',
            recipient_handle: 'jan@example.test',
            subject: 'Oferta',
            body: 'Dzien dobry, wysylam oferte.',
            status: 'sent',
            external_message_id: 'mail-1',
            external_thread_id: 'thread-2',
            template_key: 'offer_followup',
            dynamic_fields: { lead: 'Jan' },
            metadata: { provider: 'smtp' },
            delivered_at: null,
            read_at: null,
            created_by: 9,
            created_at: '2026-05-28T08:05:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ imie: 'Anna', nazwisko: 'Kowalska', login: 'anna' }] });

    const res = await request(app)
      .post('/api/crm/leads/22/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        channel: 'email',
        direction: 'outbound',
        sender_name: 'Anna Kowalska',
        sender_handle: 'anna@arbor.test',
        recipient_handle: 'jan@example.test',
        subject: 'Oferta',
        body: 'Dzien dobry, wysylam oferte.',
        external_message_id: 'mail-1',
        external_thread_id: 'thread-2',
        template_key: 'offer_followup',
        dynamic_fields: { lead: 'Jan' },
        metadata: { provider: 'smtp' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      id: 102,
      channel: 'email',
      direction: 'outbound',
      status: 'sent',
      template_key: 'offer_followup',
      author_name: 'Anna Kowalska',
    }));
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_lead_messages'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      22,
      'email',
      'outbound',
      'Dzien dobry, wysylam oferte.',
      'sent',
    ]));
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE crm_leads SET updated_at'))).toBe(true);
  });

  it('blocks branch users from reading another branch lead inbox', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 9 }] });

    const res = await request(app)
      .get('/api/crm/leads/22/messages')
      .set('Authorization', `Bearer ${token({ oddzial_id: 7 })}`);

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
