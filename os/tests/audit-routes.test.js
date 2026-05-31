const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const auditRoutes = require('../src/routes/audit');
const { resetAuditTableFlagForTests } = require('../src/services/audit');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Audit routes', () => {
  const app = createTestApp('/api/audit', auditRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    resetAuditTableFlagForTests();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('returns branch-scoped audit for Kierownik', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 1, login: 'k' }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[2][0]).toContain('metadata->>\'oddzial_id\' = $1::text');
    expect(pool.query.mock.calls[2][1]).toEqual([1]);
  });

  it('returns paginated audit for Dyrektor', async () => {
    const token = jwt.sign({ id: 1, rola: 'Dyrektor', oddzial_id: 1, login: 'd' }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            created_at: new Date().toISOString(),
            request_id: 'r1',
            user_id: 1,
            user_login: 'd',
            rola: 'Dyrektor',
            oddzial_id: 1,
            action: 'role_deleted',
            entity_type: 'role',
            entity_id: '5',
            metadata: {},
          },
        ],
      });

    const res = await request(app)
      .get('/api/audit?limit=20&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe('role_deleted');
  });
});
