const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const { env } = require('../src/config/env');
const opsRoutes = require('../src/routes/ops');
const { createTestApp } = require('./helpers/create-test-app');

const app = createTestApp('/api/ops', opsRoutes);

const token = (payload) => jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 7, ...payload }, env.JWT_SECRET);

describe('GET /api/ops/kierownik-today', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('rejects non-management users', async () => {
    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista' })}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns branch-scoped cockpit for kierownik', async () => {
    const gpsTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM tasks t') && text.includes('LEFT JOIN teams e')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('t.oddzial_id = $2');
        return {
          rows: [
            {
              id: 10,
              numer: 'ARB-10',
              klient_nazwa: 'Test Klient',
              klient_telefon: '',
              adres: 'Krakow 1',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Pilny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: null,
              oddzial_id: 7,
              pin_lat: null,
              pin_lng: null,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: null,
              oddzial_nazwa: 'Krakow',
              open_issues: 1,
              has_started: false,
              has_finished: false,
            },
            {
              id: 11,
              numer: 'ARB-11',
              klient_nazwa: 'Gotowy Klient',
              klient_telefon: '+48123123123',
              adres: 'Krakow 2',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T09:00:00.000Z',
              ekipa_id: 3,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: 2,
              czas_obslugi_min: 120,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM teams tm')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('tm.oddzial_id = $2');
        return {
          rows: [
            {
              id: 3,
              nazwa: 'Ekipa A',
              oddzial_id: 7,
              tasks_total: 1,
              in_progress: 0,
              planned: 1,
              last_gps_at: gpsTime,
            },
          ],
        };
      }
      if (text.includes('FROM notifications')) {
        expect(params).toEqual([1]);
        return { rows: [{ unread: 2 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(7);
    expect(res.body.summary.tasks_total).toBe(2);
    expect(res.body.summary.ready_for_dispatch).toBe(1);
    expect(res.body.summary.blocked).toBe(1);
    expect(res.body.summary.unread_notifications).toBe(2);
    expect(res.body.blockers.map((b) => b.key)).toEqual(expect.arrayContaining(['team', 'phone', 'gps', 'duration', 'issue', 'notification']));
    expect(res.body.tasks[0]).toMatchObject({
      id: 10,
      action_path: expect.stringContaining('/zlecenia/10'),
    });
  });

  it('lets directors request a selected branch', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26&oddzial_id=4')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: null })}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(4);
    const taskCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('LEFT JOIN teams e'));
    expect(taskCall[1]).toEqual(['2026-05-26', 4]);
  });
});
