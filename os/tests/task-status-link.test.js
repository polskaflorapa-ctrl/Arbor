const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const tasksRoutes = require('../src/routes/tasks');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('task public status link endpoint', () => {
  const app = createTestApp('/api/tasks', tasksRoutes);
  const PREVIOUS_PUBLIC_BASE_URL = env.PUBLIC_BASE_URL;

  function token() {
    return jwt.sign({ id: 7, rola: 'Kierownik', oddzial_id: 3 }, env.JWT_SECRET);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    env.PUBLIC_BASE_URL = 'https://demo.arbor.test/';
  });

  afterAll(() => {
    env.PUBLIC_BASE_URL = PREVIOUS_PUBLIC_BASE_URL;
  });

  it('returns existing token and public URL', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT id FROM tasks t WHERE')) {
        return { rows: [{ id: Number(params[0]) }], rowCount: 1 };
      }
      if (text.includes('SELECT link_statusowy_token FROM tasks WHERE id = $1')) {
        return { rows: [{ link_statusowy_token: 'tok_existing_12345678901234567890' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .get('/api/tasks/12/status-link')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      task_id: 12,
      token: 'tok_existing_12345678901234567890',
      url: 'https://demo.arbor.test/track/tok_existing_12345678901234567890',
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('SET link_statusowy_token = COALESCE'))).toBe(false);
  });

  it('generates and stores token when missing', async () => {
    let persistedToken = null;
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT id FROM tasks t WHERE')) {
        return { rows: [{ id: Number(params[0]) }], rowCount: 1 };
      }
      if (text.includes('SELECT link_statusowy_token FROM tasks WHERE id = $1')) {
        return { rows: [{ link_statusowy_token: null }], rowCount: 1 };
      }
      if (text.includes('RETURNING link_statusowy_token')) {
        persistedToken = params[0];
        return { rows: [{ link_statusowy_token: persistedToken }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .get('/api/tasks/29/status-link')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.task_id).toBe(29);
    expect(res.body.token).toBe(persistedToken);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThanOrEqual(20);
    expect(res.body.url).toBe(`https://demo.arbor.test/track/${persistedToken}`);
  });
});
