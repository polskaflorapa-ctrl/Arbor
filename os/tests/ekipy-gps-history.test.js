const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const ekipyRoutes = require('../src/routes/ekipy');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Ekipy GPS history route', () => {
  const app = createTestApp('/api/ekipy', ekipyRoutes);
  const token = (payload = {}) => jwt.sign({
    id: 7,
    rola: 'Kierownik',
    oddzial_id: 7,
    imie: 'Anna',
    nazwisko: 'Planer',
    ...payload,
  }, env.JWT_SECRET);

  beforeEach(() => {
    pool.query.mockReset();
  });

  it('returns branch-scoped daily GPS history for a team', async () => {
    let historyCall = null;
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE UNIQUE INDEX') || text.includes('CREATE INDEX')) {
        return { rows: [] };
      }
      if (text.includes('WITH vehicle_points') && text.includes('mobile_points')) {
        historyCall = { text, params };
        return {
          rows: [
            {
              provider: 'mobile',
              gps_source_kind: 'telefon',
              ekipa_id: 3,
              user_id: 22,
              user_name: 'Jan Brygadzista',
              lat: 50.061,
              lng: 19.936,
              recorded_at: '2026-05-26T06:50:00.000Z',
              accuracy_m: '12',
              battery_pct: '80',
            },
            {
              provider: 'mobile',
              gps_source_kind: 'telefon',
              ekipa_id: 3,
              user_id: 22,
              user_name: 'Jan Brygadzista',
              lat: 50.071,
              lng: 19.946,
              recorded_at: '2026-05-26T08:10:00.000Z',
              accuracy_m: '15',
              battery_pct: '78',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ekipy/gps-history?date=2026-05-26&team_id=3&provider=mobile&limit=50')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: '2026-05-26', count: 2 });
    expect(res.body.items[0]).toMatchObject({
      provider: 'mobile',
      gps_source_kind: 'telefon',
      user_name: 'Jan Brygadzista',
    });
    expect(historyCall).toBeTruthy();
    expect(historyCall.params).toEqual(['2026-05-26', 7, 3, 'mobile', 50]);
    expect(historyCall.text).toContain("gp.recorded_at >= $1::date");
    expect(historyCall.text).toContain("gp.recorded_at < $1::date + INTERVAL '1 day'");
    expect(historyCall.text).toContain('oddzial_id = $2');
    expect(historyCall.text).toContain('ekipa_id = $3');
    expect(historyCall.text).toContain('provider = $4');
    expect(historyCall.text).toContain('ORDER BY recorded_at ASC');
    expect(historyCall.text).toContain('LIMIT $5');
  });
});
