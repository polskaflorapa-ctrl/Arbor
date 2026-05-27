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
      if (text.includes('INSERT INTO telephony_call_logs')) {
        return {
          rows: [{
            id: 11,
            oddzial_id: params[0],
            phone: params[1],
            call_type: params[2],
            status: params[3],
            duration_sec: params[4],
            task_id: params[5],
            lead_name: params[6],
            notes: params[7],
            created_by: params[8],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO telephony_callbacks')) {
        return {
          rows: [{
            id: 22,
            oddzial_id: params[0],
            phone: params[1],
            task_id: params[2],
            lead_name: params[3],
            priority: params[4],
            due_at: params[5],
            status: 'open',
            notes: params[6],
            assigned_user_id: params[7],
            created_by: params[8],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM telephony_call_logs c') && text.includes('UNION ALL')) {
        return {
          rows: [
            { id: 1, oddzial_id: 2, phone: '+48111111111', status: 'answered', created_at: '2026-05-27T10:00:00.000Z' },
            { id: 2, oddzial_id: 2, phone: '+48222222222', status: 'missed', created_at: '2026-05-27T09:00:00.000Z' },
            { id: 3, oddzial_id: 2, phone: '+48333333333', status: 'answered', created_at: '2026-05-27T08:00:00.000Z' },
          ],
          rowCount: 3,
        };
      }
      if (text.includes('SELECT COUNT(*)::int AS c FROM telephony_callbacks')) {
        return { rows: [{ c: 2 }], rowCount: 1 };
      }
      if (text.includes('FROM telephony_callbacks c') && text.includes('ORDER BY COALESCE')) {
        return {
          rows: [
            { id: 44, oddzial_id: 2, phone: '+48123456789', status: 'open' },
            { id: 45, oddzial_id: 2, phone: '+48987654321', status: 'open' },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('lists calls with manager branch and status filters before in-memory pagination', async () => {
    const res = await request(app)
      .get('/api/telephony/calls?oddzial_id=2&status=answered&limit=2&offset=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(res.body.items).toHaveLength(2);

    const selectCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM telephony_call_logs c'));
    expect(selectCall[0]).toContain('WHERE x.oddzial_id = $1 AND x.status = $2');
    expect(selectCall[1]).toEqual([2, 'answered']);
  });

  it('scopes call listing to branch users own branch', async () => {
    const res = await request(app)
      .get('/api/telephony/calls?status=missed')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 5 })}`);

    expect(res.status).toBe(200);
    const selectCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM telephony_call_logs c'));
    expect(selectCall[0]).toContain('WHERE x.oddzial_id = $1 AND x.status = $2');
    expect(selectCall[1]).toEqual([5, 'missed']);
  });

  it('lists callbacks with paginated branch and status filters', async () => {
    const res = await request(app)
      .get('/api/telephony/callbacks?oddzial_id=2&status=open&limit=10&offset=0')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 10, offset: 0 });
    expect(res.body.items).toHaveLength(2);

    const countCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('COUNT(*)::int AS c FROM telephony_callbacks'));
    const listCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('LIMIT $3 OFFSET $4'));
    expect(countCall[0]).toContain('WHERE c.oddzial_id = $1 AND c.status = $2');
    expect(countCall[1]).toEqual([2, 'open']);
    expect(listCall[1]).toEqual([2, 'open', 10, 0]);
  });

  it('creates call logs with coerced numeric payload', async () => {
    const res = await request(app)
      .post('/api/telephony/calls')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: '3',
        phone: '+48111222333',
        call_type: 'inbound',
        status: 'answered',
        duration_sec: '125',
        task_id: '55',
        lead_name: 'Jan Testowy',
        notes: 'notatka',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 11,
      oddzial_id: 3,
      duration_sec: 125,
      task_id: 55,
      created_by: 7,
    });
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO telephony_call_logs'));
    expect(insertCall[1]).toEqual([
      3,
      '+48111222333',
      'inbound',
      'answered',
      125,
      55,
      'Jan Testowy',
      'notatka',
      7,
    ]);
  });

  it('blocks branch users from creating calls for another branch', async () => {
    const res = await request(app)
      .post('/api/telephony/calls')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 1 })}`)
      .send({
        oddzial_id: 9,
        phone: '+48111222333',
      });

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO telephony_call_logs'))).toBe(false);
  });

  it('creates callback queue entries with open default status', async () => {
    const res = await request(app)
      .post('/api/telephony/callbacks')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: '2',
        phone: '+48999111222',
        task_id: '77',
        lead_name: 'Maria Callback',
        priority: 'high',
        due_at: '2026-05-28T09:30',
        notes: 'oddzwonic',
        assigned_user_id: '8',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 22,
      oddzial_id: 2,
      task_id: 77,
      priority: 'high',
      status: 'open',
      assigned_user_id: 8,
      created_by: 7,
    });
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO telephony_callbacks'));
    expect(insertCall[1]).toEqual([
      2,
      '+48999111222',
      77,
      'Maria Callback',
      'high',
      '2026-05-28T09:30',
      'oddzwonic',
      8,
      7,
    ]);
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
