const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/config/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const pool = require('../src/config/database');
const routes = require('../src/routes/rozliczenia');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Rozliczenia access policy', () => {
  const app = createTestApp('/api/rozliczenia', routes);
  const token = (payload = {}) => jwt.sign(
    { id: 11, rola: 'Kierownik', oddzial_id: 3, ...payload },
    env.JWT_SECRET,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not expose task financial data to a helper', async () => {
    const res = await request(app)
      .get('/api/rozliczenia/zadanie/44')
      .set('Authorization', `Bearer ${token({ rola: 'Pomocnik' })}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('scopes a manager task read to their branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/rozliczenia/zadanie/44')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('t.oddzial_id = $2'),
      [44, 3],
    );
  });

  it('scopes a foreman task read to an assigned team', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/rozliczenia/zadanie/44')
      .set('Authorization', `Bearer ${token({ id: 19, rola: 'Brygadzista' })}`);

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT tm.team_id FROM team_members'),
      [44, 19],
    );
  });

  it('rolls back before returning when an hours write targets an inaccessible task', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const res = await request(app)
      .post('/api/rozliczenia/zadanie/44/godziny')
      .set('Authorization', `Bearer ${token()}`)
      .send({ pomocnik_id: 22, godziny: 8, stawka_godzinowa: 40, data_pracy: '2026-07-11' });

    expect(res.status).toBe(404);
    expect(client.query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      'BEGIN',
      expect.stringContaining('FROM tasks t'),
      'ROLLBACK',
    ]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO task_pomocnik_godziny'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('limits a helper day view to their own hours and hides team finances', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 44, klient_nazwa: 'Test', wartosc_brutto: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, pomocnik_id: 22, godziny: '8' }] });

    const res = await request(app)
      .get('/api/rozliczenia/dzien/22?data=2026-07-11')
      .set('Authorization', `Bearer ${token({ id: 22, rola: 'Pomocnik' })}`);

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain('NULL::numeric AS wartosc_brutto');
    expect(pool.query.mock.calls[1][0]).toContain('AND g.pomocnik_id = $1');
    expect(pool.query.mock.calls[1][1]).toEqual([22, '2026-07-11']);
  });

  it('blocks a manager from viewing a worker in another branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 7 }] });

    const res = await request(app)
      .get('/api/rozliczenia/dzien/22?data=2026-07-11')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
