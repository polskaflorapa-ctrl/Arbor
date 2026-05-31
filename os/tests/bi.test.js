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

  it('returns branch profitability, threshold and ranking score', async () => {
    pool.query.mockResolvedValue({
      rows: [{
        oddzial_id: 2,
        oddzial_nazwa: 'Krakow',
        margin_threshold_pct: '20',
        tasks_total: '4',
        tasks_done: '3',
        tasks_overdue: '1',
        revenue_planned: '5000',
        revenue_actual: '4000',
        known_cost: '2600',
        teams_active: '2',
        settlement_count: '3',
        cost_count: '2',
      }],
      rowCount: 1,
    });

    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      oddzial_id: 2,
      completion_pct: 75,
      revenue_planned: 5000,
      revenue_actual: 4000,
      known_cost: 2600,
      gross_margin: 1400,
      margin_pct: 35,
      margin_threshold_pct: 20,
      profitability_tone: 'success',
      data_quality_pct: 63,
      teams_active: 2,
    }));
    expect(res.body[0].score).toBeGreaterThan(0);
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

  it('ranks teams by combined score with margin and data quality', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          team_id: 1,
          team_name: 'Ekipa Marza',
          oddzial_nazwa: 'Krakow',
          tasks_total: '4',
          tasks_done: '4',
          tasks_overdue: '0',
          revenue: '3000',
          revenue_actual: '3000',
          known_cost: '900',
          settlement_count: '4',
          cost_count: '4',
        },
        {
          team_id: 2,
          team_name: 'Ekipa Obrot',
          oddzial_nazwa: 'Krakow',
          tasks_total: '4',
          tasks_done: '2',
          tasks_overdue: '1',
          revenue: '9000',
          revenue_actual: '9000',
          known_cost: '8000',
          settlement_count: '1',
          cost_count: '1',
        },
      ],
      rowCount: 2,
    });

    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${direktorToken()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      rank: 1,
      team_id: 1,
      margin_pct: 70,
      data_quality_pct: 100,
    }));
    expect(res.body[1]).toEqual(expect.objectContaining({
      rank: 2,
      team_id: 2,
      margin_pct: 11.1,
      data_quality_pct: 25,
    }));
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

  it('keeps branch drilldown operational for kierownik but redacts task financials', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 12,
          status: 'Zakonczone',
          typ_uslugi: 'Wycinka',
          wartosc_planowana: '3000',
          wartosc_rzeczywista: '3200',
          wartosc_netto_do_rozliczenia: '2601',
          revenue_net: '2601',
          rozliczenie_id: 7,
          koszt_pomocnikow: '200',
          wynagrodzenie_brygadzisty: '270',
          koszt_sprzetu: '100',
          koszt_sprzetu_count: '1',
          adres: 'Lesna 1, Krakow',
          ekipa_nazwa: 'Ekipa A',
          oddzial_nazwa: 'Krakow',
        },
      ],
      rowCount: 1,
    });
    const token = jwt.sign({ id: 3, rola: 'Kierownik', oddzial_id: 2 }, env.JWT_SECRET);

    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      id: 12,
      typ_uslugi: 'Wycinka',
      adres: 'Lesna 1, Krakow',
      financials: null,
    }));
    expect(res.body[0]).not.toHaveProperty('wartosc_planowana');
    expect(res.body[0]).not.toHaveProperty('revenue_net');
    expect(res.body[0]).not.toHaveProperty('koszt_pomocnikow');
    expect(res.body[0]).not.toHaveProperty('rozliczenie_id');
  });
});

describe('GET /api/bi/plan-vs-real', () => {
  it('returns planned vs actual time and value variance from work logs', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          tasks_total: 2,
          tasks_done: 1,
          planned_minutes: '300',
          actual_minutes: '390',
          value_planned: '3000',
          value_actual: '3300',
          known_cost: '450',
          overrun_tasks: 1,
          missing_worklog_tasks: 1,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 501,
          numer: 'ARB-501',
          status: 'Zakonczone',
          typ_uslugi: 'Wycinka',
          data_planowana: '2026-05-28T08:00:00.000Z',
          planned_minutes: '180',
          actual_minutes: '270',
          value_planned: '2000',
          value_actual: '2300',
          known_cost: '300',
          ekipa_nazwa: 'Ekipa A',
          oddzial_nazwa: 'Krakow',
        }],
        rowCount: 1,
      });

    const res = await request(app)
      .get('/api/bi/plan-vs-real?days=30')
      .set('Authorization', `Bearer ${direktorToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tasks_total: 2,
      tasks_done: 1,
      planned_minutes: 300,
      actual_minutes: 390,
      planned_hours: 5,
      actual_hours: 6.5,
      time_variance_minutes: 90,
      time_variance_pct: 30,
      value_planned: 3000,
      value_actual: 3300,
      value_variance: 300,
      value_variance_pct: 10,
      known_cost: 450,
      overrun_tasks: 1,
      missing_worklog_tasks: 1,
    });
    expect(res.body.tasks[0]).toEqual(expect.objectContaining({
      id: 501,
      planned_minutes: 180,
      actual_minutes: 270,
      variance_minutes: 90,
      variance_pct: 50,
    }));
    expect(pool.query.mock.calls[0][0]).toContain('FROM work_logs w');
    expect(pool.query.mock.calls[0][0]).toContain('task_operational_costs');
  });
});

describe('POST /api/bi/alerts/check', () => {
  it('includes margin risks below branch threshold', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ tasks_total: 5, tasks_done: 5, tasks_overdue: 0 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 909,
          klient_nazwa: 'Ryzykowna Marza',
          oddzial_id: 2,
          threshold_pct: '20',
          revenue_net: '1000',
          helper_cost: '300',
          crew_lead_pay: '250',
          equipment_cost: '150',
          fuel_cost: '80',
          material_cost: '40',
          disposal_cost: '30',
          other_cost: '20',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          kind: 'vehicle',
          id: 12,
          label: 'KR 12345',
          due_type: 'przeglad',
          due_date: '2026-05-01',
          oddzial_id: 2,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 910,
          numer: 'ARB-910',
          klient_nazwa: 'Brak uprawnien',
          oddzial_id: 2,
          ekipa_id: 7,
          ekipa_nazwa: 'Ekipa B',
          required_competencies: ['Arborysta', 'SEP'],
          team_competencies: ['Arborysta'],
        }],
        rowCount: 1,
      });

    const res = await request(app)
      .post('/api/bi/alerts/check')
      .set('Authorization', `Bearer ${direktorToken()}`)
      .send({ completion_threshold: 60, overdue_threshold: 10, days: 30 });

    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual(expect.arrayContaining([
      expect.stringContaining('Ryzyko marzy'),
      expect.stringContaining('Przeterminowane przeglady'),
      expect.stringContaining('Brak kompetencji'),
    ]));
    expect(res.body.margin_risks).toEqual([
      expect.objectContaining({
        id: 909,
        margin_pct: 13,
        threshold_pct: 20,
      }),
    ]);
    expect(res.body.fleet_due).toEqual([
      expect.objectContaining({ kind: 'vehicle', id: 12, due_type: 'przeglad' }),
    ]);
    expect(res.body.competency_risks).toEqual([
      expect.objectContaining({
        id: 910,
        missing_competencies: ['SEP'],
      }),
    ]);
  });
});
