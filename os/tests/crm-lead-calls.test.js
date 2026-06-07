const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/services/phone-call-pipeline', () => ({
  ensurePhoneCallsTable: jest.fn(),
}));

const pool = require('../src/config/database');
const { ensurePhoneCallsTable } = require('../src/services/phone-call-pipeline');
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

describe('CRM lead call history', () => {
  beforeEach(() => {
    pool.query.mockReset();
    ensurePhoneCallsTable.mockReset();
    ensurePhoneCallsTable.mockResolvedValue();
  });

  it('lists archived calls for an accessible lead and matching phone number', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 7, phone: '+48 500 100 200' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 301,
          twilio_call_sid: 'CA-1',
          twilio_recording_sid: 'RE-1',
          user_id: 9,
          task_id: 44,
          lead_id: 22,
          staff_number: '+48111222333',
          client_number: '+48500100200',
          recording_duration_sec: 37,
          recording_archive_backend: 's3',
          recording_archive_ref: 'calls/301.mp3',
          recording_archive_url: null,
          transcript: 'Klient pyta o termin.',
          raport: 'Umowic ogledziny.',
          wskazowki_specjalisty: 'Oddzwonic jutro.',
          status: 'transcribed',
          error_message: null,
          created_at: '2026-06-06T10:00:00.000Z',
          updated_at: '2026-06-06T10:05:00.000Z',
          imie: 'Anna',
          nazwisko: 'Kowalska',
          login: 'anna',
        }],
      });

    const res = await request(app)
      .get('/api/crm/leads/22/calls')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(ensurePhoneCallsTable).toHaveBeenCalled();
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 301,
        lead_id: 22,
        agent_name: 'Anna Kowalska',
        recording_available: true,
        recording_download_url: '/api/telefon/rozmowy/301/nagranie',
      }),
    ]);
    expect(res.text).not.toContain('"imie"');
    expect(pool.query.mock.calls[1][0]).toContain('regexp_replace');
    expect(pool.query.mock.calls[1][1]).toEqual([22, '48500100200']);
  });

  it('blocks branch users from another branch lead call history', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 9, phone: '+48500100200' }] });

    const res = await request(app)
      .get('/api/crm/leads/22/calls')
      .set('Authorization', `Bearer ${token({ oddzial_id: 7 })}`);

    expect(res.status).toBe(403);
    expect(ensurePhoneCallsTable).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
