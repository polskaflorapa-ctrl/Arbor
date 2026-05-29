const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const { createTestApp } = require('./helpers/create-test-app');
const trackRoutes = require('../src/routes/track');

const app = createTestApp('/track', trackRoutes);

describe('public task tracking', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('WHERE t.link_statusowy_token = $1')) {
        if (params[0] === 'valid_token_123456789012345') {
          return {
            rows: [{
              id: 17,
              status: 'W_Realizacji',
              typ_uslugi: 'Pielęgnacja drzewa',
              adres: 'Leśna 7',
              miasto: 'Kraków',
              data_planowana: '2026-05-28T08:00:00.000Z',
              created_at: '2026-05-20T09:00:00.000Z',
              updated_at: '2026-05-28T08:15:00.000Z',
              pin_lat: '50.0614',
              pin_lng: '19.9366',
              oddzial_telefon: '+48123123123',
              oddzial_nazwa: 'Oddział Kraków',
              ekipa_nazwa: 'Ekipa A',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM task_public_status_events')) {
        return {
          rows: [
            { to_status: 'Nowe', note: 'Zlecenie przyjete', created_at: '2026-05-20T09:00:00.000Z' },
            { to_status: 'Zaplanowane', note: null, created_at: '2026-05-27T10:00:00.000Z' },
            { to_status: 'W_Realizacji', note: null, created_at: '2026-05-28T08:15:00.000Z' },
          ],
          rowCount: 3,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  test('rejects numeric ids and requires token format', async () => {
    const res = await request(app)
      .get('/track/17')
      .set('Accept', 'application/json');

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('FROM tasks'), expect.anything());
  });

  test('returns safe public JSON payload with timeline and map', async () => {
    const res = await request(app)
      .get('/track/valid_token_123456789012345')
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({
      id: 17,
      status: 'W_Realizacji',
      status_label: 'Realizacja w toku',
      service: 'Pielęgnacja drzewa',
      address: 'Leśna 7, Kraków',
      branch: { name: 'Oddział Kraków', phone: '+48123123123' },
      team_visible: 'Ekipa A',
    });
    expect(res.body.task).not.toHaveProperty('klient_telefon');
    expect(res.body.task).not.toHaveProperty('wartosc_planowana');
    expect(res.body.task.map.url).toContain('google.com/maps');
    expect(res.body.timeline.map((row) => row.status)).toEqual(['Nowe', 'Zaplanowane', 'W_Realizacji']);
  });

  test('renders public HTML page for browser requests', async () => {
    const res = await request(app).get('/track/valid_token_123456789012345');

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('ARBOR - status zlecenia #17');
    expect(res.text).toContain('Historia statusow');
    expect(res.text).not.toContain('wartosc_planowana');
  });
});
