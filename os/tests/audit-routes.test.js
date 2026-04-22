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

  it('returns 403 for Kierownik', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 1, login: 'k' }, env.JWT_SECRET);
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns paginated audit for Administrator', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 1, login: 'a' }, env.JWT_SECRET);
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
            user_login: 'a',
            rola: 'Administrator',
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
