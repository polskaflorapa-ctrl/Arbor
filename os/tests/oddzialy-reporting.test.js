const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const oddzialyRoutes = require('../src/routes/oddzialy');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Oddzialy reporting routes', () => {
  const app = createTestApp('/api/oddzialy', oddzialyRoutes);
  const directorToken = jwt.sign({ id: 1, rola: 'Dyrektor', oddzial_id: 1 }, env.JWT_SECRET);
  const adminToken = jwt.sign({ id: 3, rola: 'Administrator', oddzial_id: null }, env.JWT_SECRET);
  const managerToken = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 2 }, env.JWT_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns branch goals for the selected month before the dynamic :id route', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          oddzial_id: 1,
          rok: 2026,
          miesiac: 5,
          plan_zlecen: 12,
          plan_obrotu: '25000.00',
          plan_marzy: '28.00',
        }],
      });

    const res = await request(app)
      .get('/api/oddzialy/cele?rok=2026&miesiac=5')
      .set('Authorization', `Bearer ${directorToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ oddzial_id: 1, rok: 2026, miesiac: 5 });
    const selectCall = pool.query.mock.calls[2];
    expect(selectCall[0]).toContain('FROM branch_goals');
    expect(selectCall[1]).toEqual([2026, 5]);
  });

  it('lets administrators list all branches without branch scope', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, nazwa: 'Centrala' }],
      rowCount: 1,
    });

    const res = await request(app)
      .get('/api/oddzialy')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(pool.query).toHaveBeenCalledWith(expect.not.stringContaining('WHERE b.id = $1'), []);
  });

  it('scopes branch sales reads to the manager branch', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/oddzialy/sprzedaz?rok=2026&miesiac=5')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    const selectCall = pool.query.mock.calls[2];
    expect(selectCall[0]).toContain('AND oddzial_id = $3');
    expect(selectCall[1]).toEqual([2026, 5, 2]);
  });

  it('upserts branch goal rows for directors', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 11,
          oddzial_id: 1,
          rok: 2026,
          miesiac: 5,
          plan_zlecen: 14,
          plan_obrotu: '32000.00',
          plan_marzy: '30.00',
        }],
      });

    const res = await request(app)
      .post('/api/oddzialy/cele')
      .set('Authorization', `Bearer ${directorToken}`)
      .send({
        oddzial_id: 1,
        rok: 2026,
        miesiac: 5,
        plan_zlecen: 14,
        plan_obrotu: 32000,
        plan_marzy: 30,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ oddzial_id: 1, plan_zlecen: 14 });
    const upsertCall = pool.query.mock.calls[2];
    expect(upsertCall[0]).toContain('ON CONFLICT (oddzial_id, rok, miesiac)');
    expect(upsertCall[1]).toEqual([1, 2026, 5, 14, 32000, 30, 1]);
  });

  it('rejects branch sales writes from branch managers', async () => {
    const res = await request(app)
      .post('/api/oddzialy/sprzedaz')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        oddzial_id: 2,
        rok: 2026,
        miesiac: 5,
        calls_total: 40,
        calls_answered: 33,
        calls_missed: 7,
        leads_new: 12,
        meetings_booked: 6,
      });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
