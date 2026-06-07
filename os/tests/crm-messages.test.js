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

  it('lists phone recordings attached to an accessible lead', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT id, oddzial_id, phone FROM crm_leads WHERE id = $1')) {
        return { rows: [{ id: 22, oddzial_id: 7, phone: '+48500100200' }] };
      }
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') || text.includes('ALTER TABLE')) {
        return { rows: [] };
      }
      if (text.includes('FROM phone_call_conversations p') && text.includes('LEFT JOIN users u')) {
        return {
          rows: [{
            id: 301,
            twilio_call_sid: 'zadarma:pbx-301',
            lead_id: 22,
            client_number: '+48500100200',
            recording_duration_sec: 88,
            recording_archive_backend: 'local',
            recording_archive_ref: '2026-06/zadarma.mp3',
            transcript: 'Klient chce przyspieszyc ogledziny.',
            raport: 'Ustalono kontakt jutro.',
            wskazowki_specjalisty: 'Dopytac o adres.',
            status: 'analyzed',
            created_at: '2026-06-06T10:00:00.000Z',
            imie: 'Anna',
            nazwisko: 'Kowalska',
            login: 'anna',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/crm/leads/22/calls')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 301,
        lead_id: 22,
        recording_available: true,
        recording_download_url: '/api/telefon/rozmowy/301/nagranie',
        agent_name: 'Anna Kowalska',
        raport: 'Ustalono kontakt jutro.',
      }),
    ]);
    const selectCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM phone_call_conversations p') && String(sql).includes('regexp_replace'));
    expect(selectCall[1]).toEqual([22, '48500100200']);
  });
});
