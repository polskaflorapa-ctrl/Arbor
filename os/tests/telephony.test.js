const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const telephonyRoutes = require('../src/routes/telephony');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Telephony routes', () => {
  const app = createTestApp('/api/telephony', telephonyRoutes);

  const token = (overrides = {}) =>
    jwt.sign(
      { id: 7, login: 'tester', rola: 'Dyrektor', oddzial_id: 1, ...overrides },
      env.JWT_SECRET,
      { expiresIn: '1h' },
    );

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT * FROM telephony_callbacks WHERE id = $1')) {
        return {
          rows: [{
            id: params[0],
            oddzial_id: 1,
            phone: '+48123456789',
            status: 'open',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('UPDATE telephony_callbacks')) {
        return {
          rows: [{
            id: params[3],
            status: params[0],
            updated_by: params[1],
            closed_at: params[2],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('marks callback as done and closes it', async () => {
    const res = await request(app)
      .patch('/api/telephony/callbacks/44/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 44, status: 'done', updated_by: 7 });
    expect(res.body.closed_at).toEqual(expect.any(String));

    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE telephony_callbacks'));
    expect(updateCall[1][0]).toBe('done');
    expect(updateCall[1][1]).toBe(7);
    expect(updateCall[1][2]).toEqual(expect.any(String));
    expect(updateCall[1][3]).toBe(44);
  });

  it('keeps callback open without closed_at when status returns to open', async () => {
    const res = await request(app)
      .patch('/api/telephony/callbacks/44/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'open' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 44, status: 'open', updated_by: 7, closed_at: null });
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE telephony_callbacks'));
    expect(updateCall[1]).toEqual(['open', 7, null, 44]);
  });

  it('blocks branch users from updating callbacks outside their branch', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT * FROM telephony_callbacks WHERE id = $1')) {
        return { rows: [{ id: params[0], oddzial_id: 9, status: 'open' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .patch('/api/telephony/callbacks/44/status')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 1 })}`)
      .send({ status: 'done' });

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE telephony_callbacks'))).toBe(false);
  });
});
