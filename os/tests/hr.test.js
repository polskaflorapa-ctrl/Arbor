/**
 * Smoke tests — EPIC 7 HR routes.
 *
 * Strategy: pool mocked — no real DB needed.
 * We verify:
 *   1. No token → 401
 *   2. Wrong role (Brygadzista / Pracownik) → 403
 *   3. Correct role (Dyrektor / Kierownik) → 200
 *   4. CRUD: POST absences, PUT absences/:id
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const pool = require('../src/config/database');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

const app = createApp();

function dyrektorToken() {
  return jwt.sign({ id: 1, rola: 'Dyrektor', oddzial_id: null }, env.JWT_SECRET);
}
function kierownikToken() {
  return jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 3 }, env.JWT_SECRET);
}
function brygadzistaToken() {
  return jwt.sign({ id: 3, rola: 'Brygadzista', oddzial_id: 3 }, env.JWT_SECRET);
}

// ─── /api/hr/position-cards ──────────────────────────────────────────────────

describe('GET /api/hr/position-cards', () => {
  const PATH = '/api/hr/position-cards';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Dyrektor — returns cards array', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ cards: expect.any(Array) }));
  });

  it('200 for Kierownik — branch-scoped', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── /api/position-cards (alias) ─────────────────────────────────────────────

describe('GET /api/position-cards (alias)', () => {
  it('401 when no token', async () => {
    expect((await request(app).get('/api/position-cards')).status).toBe(401);
  });

  it('200 for Kierownik via alias mount', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/position-cards')
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cards');
  });
});

// ─── /api/hr/timesheet ───────────────────────────────────────────────────────

describe('GET /api/hr/timesheet', () => {
  const PATH = '/api/hr/timesheet';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Pracownik', async () => {
    const token = jwt.sign({ id: 4, rola: 'Pracownik', oddzial_id: 1 }, env.JWT_SECRET);
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
  });

  it('200 for Dyrektor — returns rows array', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(`${PATH}?month=2025-05`)
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ rows: expect.any(Array) }));
  });
});

// ─── /api/hr/absences (GET) ──────────────────────────────────────────────────

describe('GET /api/hr/absences', () => {
  const PATH = '/api/hr/absences';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Kierownik — returns array', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(`${PATH}?month=2025-05`)
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── /api/hr/absences (POST) ─────────────────────────────────────────────────

describe('POST /api/hr/absences', () => {
  const PATH = '/api/hr/absences';

  const VALID_BODY = {
    user_id: 5,
    typ: 'Urlop',
    data_od: '2025-06-01',
    data_do: '2025-06-07',
    powod: 'Wakacje',
  };

  it('401 when no token', async () => {
    expect((await request(app).post(PATH).send(VALID_BODY)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).post(PATH).send(VALID_BODY).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('201 for Dyrektor with valid payload', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 42, ...VALID_BODY, status: 'Oczekuje' }],
      rowCount: 1,
    });
    const res = await request(app)
      .post(PATH)
      .send(VALID_BODY)
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ id: 42, status: 'Oczekuje' }));
  });

  it('400 for invalid typ', async () => {
    const res = await request(app)
      .post(PATH)
      .send({ ...VALID_BODY, typ: 'NieznanyTyp' })
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(400);
  });
});

// ─── /api/hr/absences/:id (PUT) ──────────────────────────────────────────────

describe('PUT /api/hr/absences/:id', () => {
  it('401 when no token', async () => {
    expect((await request(app).put('/api/hr/absences/1').send({ status: 'Zatwierdzona' })).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app)
        .put('/api/hr/absences/1')
        .send({ status: 'Zatwierdzona' })
        .set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Kierownik — approve', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 1, status: 'Zatwierdzona' }],
      rowCount: 1,
    });
    const res = await request(app)
      .put('/api/hr/absences/1')
      .send({ status: 'Zatwierdzona' })
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'Zatwierdzona' }));
  });

  it('400 for invalid status value', async () => {
    const res = await request(app)
      .put('/api/hr/absences/1')
      .send({ status: 'Zatwierdzono_blednie' })
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(400);
  });
});

// ─── /api/hr/competency-expiry ───────────────────────────────────────────────

describe('GET /api/hr/competency-expiry', () => {
  const PATH = '/api/hr/competency-expiry';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Dyrektor — returns array', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${dyrektorToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── /api/hr/headcount ───────────────────────────────────────────────────────

describe('GET /api/hr/headcount', () => {
  const PATH = '/api/hr/headcount';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Pracownik', async () => {
    const token = jwt.sign({ id: 8, rola: 'Pracownik', oddzial_id: 2 }, env.JWT_SECRET);
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
  });

  it('200 for Administrator — returns array', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = jwt.sign({ id: 9, rola: 'Administrator', oddzial_id: null }, env.JWT_SECRET);
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
