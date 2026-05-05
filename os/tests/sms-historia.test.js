const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const smsRoutes = require('../src/routes/sms');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

function tokenForUser(payload) {
  return jwt.sign(payload, env.JWT_SECRET);
}

describe('GET /api/sms/historia', () => {
  const app = createTestApp('/api/sms', smsRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockHistoriaPipeline({ total = 0, rows = [] } = {}) {
    pool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ c: total }] })
      .mockResolvedValueOnce({ rows });
  }

  it('wymaga autoryzacji', async () => {
    const res = await request(app).get('/api/sms/historia?limit=10');
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('zwraca { items, total, limit, offset } i COUNT/SELECT z filtrami q, status, daty (Dyrektor)', async () => {
    mockHistoriaPipeline({ total: 3, rows: [{ id: 1 }] });

    const res = await request(app)
      .get(
        '/api/sms/historia?limit=15&offset=0&q=50%25&status=Dostarczony&date_from=2025-01-01&date_to=2025-01-31'
      )
      .set('Authorization', `Bearer ${tokenForUser({ id: 1, rola: 'Dyrektor' })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [{ id: 1 }],
      total: 3,
      limit: 15,
      offset: 0,
    });

    expect(pool.query).toHaveBeenCalledTimes(4);
    const countCall = pool.query.mock.calls[2];
    const selectCall = pool.query.mock.calls[3];

    expect(countCall[0]).toContain('SELECT COUNT(*)::int AS c');
    expect(countCall[0]).toContain("h.status = $1");
    expect(countCall[0]).toContain('h.created_at::date >= $2::date');
    expect(countCall[0]).toContain('h.created_at::date <= $3::date');
    expect(countCall[0]).toContain("ESCAPE E'\\\\'");
    expect(countCall[1]).toEqual([
      'Dostarczony',
      '2025-01-01',
      '2025-01-31',
      '%50\\%%',
    ]);

    expect(selectCall[0]).toMatch(/LIMIT \$5 OFFSET \$6$/);
    expect(selectCall[1]).toEqual(['Dostarczony', '2025-01-01', '2025-01-31', '%50\\%%', 15, 0]);
  });

  it('pomija filtr statusu dla wartości all', async () => {
    mockHistoriaPipeline({ total: 1, rows: [] });

    const res = await request(app)
      .get('/api/sms/historia?limit=10&offset=0&status=all')
      .set('Authorization', `Bearer ${tokenForUser({ id: 1, rola: 'Dyrektor' })}`);

    expect(res.status).toBe(200);
    const countSql = pool.query.mock.calls[2][0];
    expect(countSql).not.toContain('h.status =');
  });

  it('nie dodaje zakresu dat przy niepoprawnym formacie', async () => {
    mockHistoriaPipeline({ total: 0, rows: [] });

    const res = await request(app)
      .get('/api/sms/historia?limit=10&date_from=31-01-2025')
      .set('Authorization', `Bearer ${tokenForUser({ id: 1, rola: 'Dyrektor' })}`);

    expect(res.status).toBe(200);
    const countSql = pool.query.mock.calls[2][0];
    expect(countSql).not.toContain('h.created_at::date');
  });

  it('Kierownik — ograniczenie do oddziału', async () => {
    mockHistoriaPipeline({ total: 0, rows: [] });

    const res = await request(app)
      .get('/api/sms/historia?limit=5&offset=0')
      .set('Authorization', `Bearer ${tokenForUser({ id: 2, rola: 'Kierownik', oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    const countSql = pool.query.mock.calls[2][0];
    const countParams = pool.query.mock.calls[2][1];
    expect(countSql).toContain('t.oddzial_id = $1');
    expect(countParams[0]).toBe(7);
  });

  it('Brygadzista — ograniczenie do własnych zleceń', async () => {
    mockHistoriaPipeline({ total: 0, rows: [] });

    const res = await request(app)
      .get('/api/sms/historia?limit=5&offset=0')
      .set('Authorization', `Bearer ${tokenForUser({ id: 99, rola: 'Brygadzista' })}`);

    expect(res.status).toBe(200);
    const countSql = pool.query.mock.calls[2][0];
    const countParams = pool.query.mock.calls[2][1];
    expect(countSql).toContain('t.brygadzista_id = $1');
    expect(countParams[0]).toBe(99);
  });
});
