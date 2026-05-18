/**
 * Smoke tests — EPIC 4 Auto-Dispatch / VRP routes.
 *
 * pool.connect() and services/vrp are mocked — no real DB or solver needed.
 *
 * Coverage:
 *   401  — no token
 *   403  — wrong role (Brygadzista)
 *   400  — missing/bad date for POST endpoints
 *   200  — correct role (Kierownik / Dyrektor)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock pool — dispatch uses pool.connect() (transaction client), not pool.query directly
jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

// Mock VRP solver — pure function, no IO
jest.mock('../src/services/vrp', () => ({
  solve: jest.fn().mockReturnValue({
    routes: [],
    unassigned: [],
    stats: {
      solver_ms: 3,
      tasks_total: 0,
      tasks_assigned: 0,
      tasks_unassigned: 0,
      teams_used: 0,
      coverage_pct: 100,
    },
  }),
}));

const pool = require('../src/config/database');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

const app = createApp();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function kierownikToken(oddzialId = 3) {
  return jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: oddzialId }, env.JWT_SECRET);
}
function dyrektorToken() {
  return jwt.sign({ id: 2, rola: 'Dyrektor', oddzial_id: null }, env.JWT_SECRET);
}
function brygadzistaToken() {
  return jwt.sign({ id: 3, rola: 'Brygadzista', oddzial_id: 3 }, env.JWT_SECRET);
}

// Returns a mock client (pool.connect resolves to this)
function setupMockClient(overrides = {}) {
  const mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
    ...overrides,
  };
  pool.connect.mockResolvedValue(mockClient);
  return mockClient;
}

// ─── POST /api/dispatch/plan ──────────────────────────────────────────────────

describe('POST /api/dispatch/plan', () => {
  const PATH = '/api/dispatch/plan';

  it('401 when no token', async () => {
    expect((await request(app).post(PATH).send({ date: '2025-06-15' })).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).post(PATH).send({ date: '2025-06-15' })
        .set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('400 for missing date', async () => {
    const res = await request(app)
      .post(PATH)
      .send({})
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(400);
  });

  it('400 for bad date format', async () => {
    const res = await request(app)
      .post(PATH)
      .send({ date: '15-06-2025' })
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(400);
  });

  it('200 for Kierownik — runs solver and returns plan', async () => {
    setupMockClient();
    const res = await request(app)
      .post(PATH)
      .send({ date: '2025-06-15' })
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('routes');
    expect(res.body).toHaveProperty('stats');
    expect(res.body).toHaveProperty('date', '2025-06-15');
  });

  it('200 for Dyrektor — no branch scoping', async () => {
    setupMockClient();
    const res = await request(app)
      .post(PATH)
      .send({ date: '2025-06-20', oddzial_id: 5 })
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('routes');
  });
});

// ─── POST /api/dispatch/plan/save ────────────────────────────────────────────

describe('POST /api/dispatch/plan/save', () => {
  const PATH = '/api/dispatch/plan/save';

  it('401 when no token', async () => {
    expect((await request(app).post(PATH).send({ date: '2025-06-15' })).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).post(PATH).send({ date: '2025-06-15' })
        .set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('400 for missing date', async () => {
    const res = await request(app)
      .post(PATH)
      .send({})
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(400);
  });

  it('200 for Kierownik — saves plan to DB', async () => {
    const mockClient = setupMockClient();
    // INSERT dispatch_plans returns an id
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                   // fetchTasksForDate
      .mockResolvedValueOnce({ rows: [] })                                   // fetchTeamsForDispatch
      .mockResolvedValueOnce({ rows: [{ id: 42, created_at: '2025-06-15T03:00:00Z' }] }); // INSERT

    const res = await request(app)
      .post(PATH)
      .send({ date: '2025-06-15' })
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 42);
    expect(res.body).toHaveProperty('routes');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ─── POST /api/dispatch/apply/:id ────────────────────────────────────────────

describe('POST /api/dispatch/apply/:id', () => {
  it('401 when no token', async () => {
    expect((await request(app).post('/api/dispatch/apply/1')).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).post('/api/dispatch/apply/1')
        .set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('404 when plan does not exist', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT plan — not found
    const res = await request(app)
      .post('/api/dispatch/apply/999')
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(404);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('200 for Kierownik — applies plan', async () => {
    const mockClient = setupMockClient();
    const planJson = {
      routes: [{ team_id: 10, stops: [{ task_id: 101 }] }],
      unassigned: [],
    };
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 1, plan_json: planJson, oddzial_id: 3, data: '2025-06-15' }] }) // SELECT plan
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rows: [] })  // UPDATE task
      .mockResolvedValueOnce({ rows: [] })  // UPDATE dispatch_plans
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await request(app)
      .post('/api/dispatch/apply/1')
      .set('Authorization', `Bearer ${kierownikToken(3)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ─── GET /api/dispatch/plans ──────────────────────────────────────────────────

describe('GET /api/dispatch/plans', () => {
  const PATH = '/api/dispatch/plans';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Kierownik — returns array', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 for Dyrektor — returns array', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── GET /api/dispatch/plans/:id ─────────────────────────────────────────────

describe('GET /api/dispatch/plans/:id', () => {
  it('401 when no token', async () => {
    expect((await request(app).get('/api/dispatch/plans/1')).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get('/api/dispatch/plans/1')
        .set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('404 when plan does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/dispatch/plans/999')
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(404);
  });

  it('200 for Dyrektor — returns plan', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, plan_json: { routes: [], unassigned: [], stats: {} }, oddzial_id: null }],
      rowCount: 1,
    });
    const res = await request(app)
      .get('/api/dispatch/plans/1')
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 1);
  });
});

// ─── DELETE /api/dispatch/plans/:id ──────────────────────────────────────────

describe('DELETE /api/dispatch/plans/:id', () => {
  it('401 when no token', async () => {
    expect((await request(app).delete('/api/dispatch/plans/1')).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).delete('/api/dispatch/plans/1')
        .set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Kierownik — archives plan', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/dispatch/plans/1')
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });

  it('200 for Dyrektor — archives plan', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/dispatch/plans/1')
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
  });
});
