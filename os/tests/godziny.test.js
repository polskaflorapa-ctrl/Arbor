const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const godzinyRoutes = require('../src/routes/godziny');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Godziny ECP z work logow', () => {
  const app = createTestApp('/api/godziny', godzinyRoutes);
  const token = (payload) =>
    jwt.sign({ id: 10, rola: 'Kierownik', oddzial_id: 1, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /ecp returns automatic work log ledger with overtime summary', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          user_id: 2,
          data_pracy: '2026-06-01',
          pracownik: 'Jan Brygadzista',
          oddzial_id: 1,
          oddzial_nazwa: 'Krakow',
          godziny: '9.50',
          nadgodziny: '1.50',
          zlecenia_count: 2,
          work_logs_count: 3,
          godziny_normatywne: '8.00',
        },
      ],
    });

    const res = await request(app)
      .get('/api/godziny/ecp')
      .query({ from: '2026-06-01', to: '2026-06-07' })
      .set('Authorization', `Bearer ${token({ oddzial_id: 1 })}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ godziny: 9.5, nadgodziny: 1.5, dni: 1, work_logs_count: 3 });
    expect(res.body.overtime_rule).toBe('daily_minutes_over_480');
    expect(res.body.legal_note).toContain('weryfikacji prawnej');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM work_logs wl'), ['2026-06-01', '2026-06-07', 1]);
    expect(pool.query.mock.calls[0][0]).toContain('COALESCE(t.oddzial_id, u.oddzial_id) = $3');
  });

  it('GET /ecp lets director request a specific branch and user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/godziny/ecp')
      .query({ from: '2026-06-01', to: '2026-06-07', oddzial_id: 4, user_id: 8 })
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: null })}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(4);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['2026-06-01', '2026-06-07', 4, 8]);
    expect(pool.query.mock.calls[0][0]).toContain('wl.user_id = $4');
  });

  it('GET /ecp rejects reversed date range', async () => {
    const res = await request(app)
      .get('/api/godziny/ecp')
      .query({ from: '2026-06-07', to: '2026-06-01' })
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('data_do_przed_data_od');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
