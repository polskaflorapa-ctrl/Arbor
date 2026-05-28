const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const raportyRoutes = require('../src/routes/raporty');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('GET /raporty/mobile', () => {
  const app = createTestApp('/api/raporty', raportyRoutes);

  const token = (payload) =>
    jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 2, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/raporty/mobile');
    expect(res.status).toBe(401);
  });

  it('returns aggregates for Kierownik with branch filter', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          total_tasks: 10,
          completed_tasks: 3,
          total_hours: '4.5',
          total_revenue: '1200.50',
          total_cost: '100.00',
        },
      ],
    });
    const res = await request(app).get('/api/raporty/mobile').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.total_tasks).toBe(10);
    expect(res.body.completed_tasks).toBe(3);
    expect(res.body.total_hours).toBe(4.5);
    expect(res.body.total_revenue).toBe(1200.5);
    expect(res.body.total_cost).toBe(100);
    expect(res.body.avg_margin_percent).toBe(91.7);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AND t.oddzial_id = $1'), [2]);
  });

  it('omits branch filter for Dyrektor', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ total_tasks: 0, completed_tasks: 0, total_hours: '0', total_revenue: '0' }],
    });
    const res = await request(app).get('/api/raporty/mobile').set('Authorization', `Bearer ${token({ rola: 'Dyrektor' })}`);
    expect(res.status).toBe(200);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).not.toContain('AND t.oddzial_id = $1');
    expect(pool.query.mock.calls[0][1]).toEqual([]);
  });
});
