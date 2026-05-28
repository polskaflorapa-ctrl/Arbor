/**
 * Smoke tests — EPIC 4 BI analytics endpoints.
 *
 * Strategy: pool is mocked so no real DB is needed.
 * We verify:
 *   1. No token → 401
 *   2. Wrong role (Brygadzista) → 403
 *   3. Correct role (Dyrektor) → 200 with expected shape
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

// Generic empty-row mock — all BI handlers tolerate missing fields
const EMPTY_ROW = { rows: [{}], rowCount: 1 };

beforeEach(() => {
  jest.clearAllMocks();
});

function direktorToken(overrides = {}) {
  return jwt.sign({ id: 1, rola: 'Dyrektor', oddzial_id: null, ...overrides }, env.JWT_SECRET);
}
function brygadzistaToken() {
  return jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 1 }, env.JWT_SECRET);
}

// ─── /api/bi/overview ────────────────────────────────────────────────────────

describe('GET /api/bi/overview', () => {
  const PATH = '/api/bi/overview';

  it('401 when no token', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${brygadzistaToken()}`);
    expect(res.status).toBe(403);
  });

  it('200 for Dyrektor with mocked DB', async () => {
    pool.query.mockResolvedValue(EMPTY_ROW);
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks_total');
  });
});

// ─── /api/bi/revenue-trend ───────────────────────────────────────────────────

describe('GET /api/bi/revenue-trend', () => {
  const PATH = '/api/bi/revenue-trend';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Dyrektor', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── /api/bi/branch-comparison ───────────────────────────────────────────────

describe('GET /api/bi/branch-comparison', () => {
  const PATH = '/api/bi/branch-comparison';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Kierownik (branch-scoped)', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = jwt.sign({ id: 3, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ─── /api/bi/service-mix ─────────────────────────────────────────────────────

describe('GET /api/bi/service-mix', () => {
  const PATH = '/api/bi/service-mix';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Sprzedaz role', async () => {
    const token = jwt.sign({ id: 4, rola: 'Sprzedaz', oddzial_id: 1 }, env.JWT_SECRET);
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
  });

  it('200 for Dyrektor', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── /api/bi/team-performance ────────────────────────────────────────────────

describe('GET /api/bi/team-performance', () => {
  const PATH = '/api/bi/team-performance';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${brygadzistaToken()}`)).status
    ).toBe(403);
  });

  it('200 for Administrator', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = jwt.sign({ id: 5, rola: 'Administrator', oddzial_id: null }, env.JWT_SECRET);
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── /api/bi/funnel ──────────────────────────────────────────────────────────

describe('GET /api/bi/funnel', () => {
  const PATH = '/api/bi/funnel';

  it('401 when no token', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('403 for Pracownik', async () => {
    const token = jwt.sign({ id: 6, rola: 'Pracownik', oddzial_id: 1 }, env.JWT_SECRET);
    expect(
      (await request(app).get(PATH).set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
  });

  it('200 for Prezes', async () => {
    pool.query.mockResolvedValue(EMPTY_ROW);
    const token = jwt.sign({ id: 7, rola: 'Prezes', oddzial_id: null }, env.JWT_SECRET);
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('quotes_total');
  });
});

describe('GET /api/bi/drill', () => {
  const PATH = '/api/bi/drill?dim=oddzial&id=2&days=30';

  it('returns task-level financial drilldown from the shared margin engine', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 10,
          numer: 'ARB-10',
          status: 'Zakonczone',
          typ_uslugi: 'Wycinka',
          data_planowana: '2026-05-20T08:00:00.000Z',
          wartosc_planowana: '2160',
          wartosc_rzeczywista: null,
          wartosc_netto_do_rozliczenia: '2160',
          revenue_net: '2160',
          rozliczenie_id: 5,
          koszt_pomocnikow: '200',
          wynagrodzenie_brygadzisty: '270',
          adres: 'Lesna 1, Krakow',
          ekipa_nazwa: 'Ekipa A',
          oddzial_nazwa: 'Krakow',
        },
      ],
      rowCount: 1,
    });

    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].financials).toMatchObject({
      revenue_net: 2160,
      direct_labor_cost: 470,
      total_known_cost: 470,
      gross_margin: 1690,
      margin_pct: 78.2,
      missing_cost_fields: ['sprzet', 'paliwo', 'materialy', 'utylizacja', 'inne'],
    });
    expect(res.body[0].financials.cost_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'helper_cost', status: 'ok' }),
        expect.objectContaining({ key: 'equipment_cost', status: 'missing' }),
      ])
    );
  });

  it('includes operational and material costs when BI drilldown has cost rows', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 11,
          status: 'Zakonczone',
          typ_uslugi: 'Pielęgnacja',
          wartosc_netto_do_rozliczenia: '2160',
          revenue_net: '2160',
          rozliczenie_id: 6,
          koszt_pomocnikow: '200',
          wynagrodzenie_brygadzisty: '270',
          koszt_sprzetu: '100',
          koszt_paliwa: '50',
          koszt_materialow: '80',
          koszt_utylizacji: '40',
          koszt_inne: '10',
          koszt_sprzetu_count: '1',
          koszt_paliwa_count: '1',
          koszt_materialow_count: '1',
          koszt_utylizacji_count: '1',
          koszt_inne_count: '1',
        },
      ],
      rowCount: 1,
    });

    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].financials).toMatchObject({
      total_known_cost: 750,
      gross_margin: 1410,
      margin_pct: 65.3,
      complete: true,
      missing_cost_fields: [],
    });
  });
});
