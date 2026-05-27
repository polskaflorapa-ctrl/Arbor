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
const { solve } = require('../src/services/vrp');

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

  it('excludes absent teams from solver input', async () => {
    solve.mockClear();
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM tasks t')) {
        return {
          rows: [{
            id: 101,
            numer: 'ARB-101',
            adres: 'Lesna 1',
            miasto: 'Krakow',
            czas_planowany_godziny: 2,
            ekipa_id: null,
          }],
          rowCount: 1,
        };
      }
      if (s.includes('FROM teams e')) {
        return {
          rows: [
            { id: 10, nazwa: 'Ekipa nieobecna', oddzial_id: 3, aktywny: true, attendance_present: false, attendance_note: 'Auto w serwisie' },
            { id: 11, nazwa: 'Ekipa gotowa', oddzial_id: 3, aktywny: true, attendance_present: true, attendance_note: '' },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .send({ date: '2025-06-15' })
      .set('Authorization', `Bearer ${kierownikToken()}`);

    expect(res.status).toBe(200);
    expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('FROM teams e'))).toBe(true);
    expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('tm.aktywny'))).toBe(false);
    expect(solve).toHaveBeenCalledWith(expect.objectContaining({
      teams: [expect.objectContaining({ id: 11, nazwa: 'Ekipa gotowa' })],
    }));
    expect(solve.mock.calls[0][0].teams.some((team) => Number(team.id) === 10)).toBe(false);
    expect(res.body.team_availability.absent).toEqual([
      expect.objectContaining({ team_id: 10, team_name: 'Ekipa nieobecna', note: 'Auto w serwisie' }),
    ]);
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
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM tasks t')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM teams e')) return { rows: [], rowCount: 0 };
      if (s.includes('INSERT INTO dispatch_plans')) {
        return { rows: [{ id: 42, created_at: '2025-06-15T03:00:00Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

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
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('SELECT * FROM dispatch_plans')) {
        return { rows: [{ id: 1, plan_json: planJson, oddzial_id: 3, data: '2025-06-15' }], rowCount: 1 };
      }
      if (s.includes('JOIN team_attendance')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/dispatch/apply/1')
      .set('Authorization', `Bearer ${kierownikToken(3)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE tasks SET ekipa_id = $1'), [10, 101]);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('409 when applying a saved plan with an absent team', async () => {
    const mockClient = setupMockClient();
    const planJson = {
      routes: [{ team_id: 10, stops: [{ task_id: 101 }] }],
      unassigned: [],
    };
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('SELECT * FROM dispatch_plans')) {
        return { rows: [{ id: 1, plan_json: planJson, oddzial_id: 3, data: '2025-06-15' }], rowCount: 1 };
      }
      if (s.includes('JOIN team_attendance')) {
        return {
          rows: [{ team_id: 10, team_name: 'Ekipa A', note: 'Urlop', actor_name: 'Anna' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/dispatch/apply/1')
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_ABSENT');
    expect(res.body.attendance.absent).toEqual([
      expect.objectContaining({ team_id: 10, team_name: 'Ekipa A', note: 'Urlop' }),
    ]);
    expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ─── GET /api/dispatch/plans ──────────────────────────────────────────────────

describe('POST /api/dispatch/route-brief/send', () => {
  const PATH = '/api/dispatch/route-brief/send';

  afterEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    pool.connect.mockReset();
  });

  it('401 when no token', async () => {
    expect((await request(app).post(PATH).send({ team_id: 10, brief: 'Odprawa' })).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    const res = await request(app)
      .post(PATH)
      .send({ team_id: 10, brief: 'Odprawa' })
      .set('Authorization', `Bearer ${brygadzistaToken()}`);
    expect(res.status).toBe(403);
  });

  it('400 for missing team_id or brief', async () => {
    const noTeam = await request(app)
      .post(PATH)
      .send({ brief: 'Odprawa' })
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(noTeam.status).toBe(400);

    const noBrief = await request(app)
      .post(PATH)
      .send({ team_id: 10 })
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(noBrief.status).toBe(400);
  });

  it('403 when Kierownik sends a brief outside their branch', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('SELECT id, nazwa, oddzial_id FROM teams')) {
        return { rows: [{ id: 10, nazwa: 'Ekipa Obca', oddzial_id: 99 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .send({ team_id: 10, date: '2025-06-15', brief: 'Odprawa ekipy' })
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(403);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT id, nazwa, oddzial_id FROM teams WHERE id = $1', [10]);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('200 creates notifications for team recipients', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql, params) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT') return { rows: [], rowCount: 0 };
      if (s.includes('SELECT id, nazwa, oddzial_id FROM teams')) {
        return { rows: [{ id: 10, nazwa: 'Brygada Alfa', oddzial_id: 3 }], rowCount: 1 };
      }
      if (s.includes('FROM team_members tm') && s.includes('JOIN users u')) {
        return { rows: [{ user_id: 21 }, { user_id: 22 }], rowCount: 2 };
      }
      if (s.includes('INSERT INTO notifications')) {
        expect(params).toEqual([1, expect.stringContaining('Odprawa ekipy'), [21, 22]]);
        return {
          rows: [
            { id: 1, to_user_id: 21, typ: 'Odprawa ekipy', tresc: params[1], status: 'Nowe', data_utworzenia: '2025-06-15T06:00:00Z' },
            { id: 2, to_user_id: 22, typ: 'Odprawa ekipy', tresc: params[1], status: 'Nowe', data_utworzenia: '2025-06-15T06:00:00Z' },
          ],
          rowCount: 2,
        };
      }
      if (s.includes('INSERT INTO dispatch_route_briefs')) {
        expect(params).toEqual([
          '2025-06-15',
          10,
          3,
          1,
          expect.stringContaining('Odprawa ekipy'),
          [101, 102],
        ]);
        return { rows: [{ id: 77, created_at: '2025-06-15T06:00:00Z' }], rowCount: 1 };
      }
      if (s.includes('INSERT INTO dispatch_route_brief_recipients')) {
        expect(params).toEqual([77, [21, 22], [1, 2]]);
        return { rows: [], rowCount: 2 };
      }
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX') || s.includes('INSERT INTO audit_log')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .send({
        team_id: 10,
        team_name: 'Brygada Alfa',
        date: '2025-06-15',
        task_ids: [101, 102, 102],
        brief: 'Odprawa ekipy - Brygada Alfa\n1. ZL/101',
      })
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      message: 'Odprawa wyslana do ekipy',
      brief_id: 77,
      team_id: 10,
      team_name: 'Brygada Alfa',
      notification_count: 2,
      recipients: [21, 22],
      status: expect.objectContaining({
        sent_to: 2,
        confirmed: 0,
        pending: 2,
      }),
    }));
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back notifications when route brief persistence fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql, params) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s === 'BEGIN' || s === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (s.includes('SELECT id, nazwa, oddzial_id FROM teams')) {
        return { rows: [{ id: 10, nazwa: 'Brygada Alfa', oddzial_id: 3 }], rowCount: 1 };
      }
      if (s.includes('FROM team_members tm') && s.includes('JOIN users u')) {
        return { rows: [{ user_id: 21, recipient_name: 'Jan Brygadzista' }], rowCount: 1 };
      }
      if (s.includes('INSERT INTO notifications')) {
        return {
          rows: [{ id: 1, to_user_id: 21, typ: 'Odprawa ekipy', tresc: params[1], status: 'Nowe' }],
          rowCount: 1,
        };
      }
      if (s.includes('INSERT INTO dispatch_route_briefs')) {
        throw new Error('brief insert failed');
      }
      return { rows: [], rowCount: 0 };
    });

    try {
      const res = await request(app)
        .post(PATH)
        .send({ team_id: 10, date: '2025-06-15', task_ids: [101], brief: 'Odprawa ekipy' })
        .set('Authorization', `Bearer ${kierownikToken(3)}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('brief insert failed');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('409 when a team has no active recipients', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('SELECT id, nazwa, oddzial_id FROM teams')) {
        return { rows: [{ id: 10, nazwa: 'Brygada Alfa', oddzial_id: 3 }], rowCount: 1 };
      }
      if (s.includes('FROM team_members tm') && s.includes('JOIN users u')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .send({ team_id: 10, date: '2025-06-15', brief: 'Odprawa ekipy' })
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/odbiorcow/);
    expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('POST /api/dispatch/route-brief/:briefId/remind', () => {
  const PATH = '/api/dispatch/route-brief/77/remind';

  afterEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    pool.connect.mockReset();
  });

  it('401 when no token', async () => {
    expect((await request(app).post(PATH)).status).toBe(401);
  });

  it('403 for Brygadzista', async () => {
    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${brygadzistaToken()}`);
    expect(res.status).toBe(403);
  });

  it('404 when route brief does not exist', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(404);
    expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('403 when Kierownik reminds outside their branch', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) {
        return {
          rows: [{
            id: 77,
            date: '2025-06-15',
            team_id: 10,
            oddzial_id: 99,
            team_oddzial_id: 99,
            team_name: 'Brygada Obca',
            brief: 'Odprawa',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(403);
    expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('200 sends reminders only to pending recipients', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql, params) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s === 'BEGIN' || s === 'COMMIT') return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) {
        expect(params).toEqual([77]);
        return {
          rows: [{
            id: 77,
            date: '2025-06-15',
            team_id: 10,
            oddzial_id: 3,
            team_oddzial_id: 3,
            team_name: 'Brygada Alfa',
            brief: 'Odprawa ekipy - Brygada Alfa',
          }],
          rowCount: 1,
        };
      }
      if (s.includes('FROM dispatch_route_brief_recipients drr')) {
        expect(params).toEqual([77]);
        return {
          rows: [
            { user_id: 21, name: 'Jan Brygadzista', notification_id: 1 },
            { user_id: 22, name: 'Anna Pomocnik', notification_id: 2 },
          ],
          rowCount: 2,
        };
      }
      if (s.includes('INSERT INTO notifications')) {
        expect(params).toEqual([1, expect.stringContaining('Przypomnienie'), [21, 22]]);
        return {
          rows: [
            { id: 11, to_user_id: 21, typ: 'Przypomnienie odprawy', tresc: params[1], status: 'Nowe' },
            { id: 12, to_user_id: 22, typ: 'Przypomnienie odprawy', tresc: params[1], status: 'Nowe' },
          ],
          rowCount: 2,
        };
      }
      if (s.includes('INSERT INTO audit_log')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      message: 'Przypomnienie wyslane',
      brief_id: 77,
      team_id: 10,
      team_name: 'Brygada Alfa',
      reminded: 2,
      recipients: [
        expect.objectContaining({ user_id: 21, name: 'Jan Brygadzista' }),
        expect.objectContaining({ user_id: 22, name: 'Anna Pomocnik' }),
      ],
    }));
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('200 returns zero when everyone already confirmed', async () => {
    const mockClient = setupMockClient();
    mockClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) {
        return {
          rows: [{
            id: 77,
            date: '2025-06-15',
            team_id: 10,
            oddzial_id: 3,
            team_oddzial_id: 3,
            team_name: 'Brygada Alfa',
            brief: 'Odprawa ekipy - Brygada Alfa',
          }],
          rowCount: 1,
        };
      }
      if (s.includes('FROM dispatch_route_brief_recipients drr')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      message: 'Wszyscy odbiorcy potwierdzili odprawe',
      reminded: 0,
      recipients: [],
    }));
    expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('GET /api/dispatch/route-brief/status', () => {
  const PATH = '/api/dispatch/route-brief/status';

  afterEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('400 for missing date', async () => {
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${kierownikToken()}`);
    expect(res.status).toBe(400);
  });

  it('200 returns confirmation counters for sent route briefs', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('WITH latest AS')) {
        return {
          rows: [{
            brief_id: 77,
            date: '2025-06-15',
            team_id: 10,
            team_name: 'Brygada Alfa',
            sent_at: '2025-06-15T06:00:00Z',
            task_ids: [101, 102],
            sent_to: 2,
            confirmed: 1,
            pending: 1,
            recipients: [
              { user_id: 21, name: 'Jan Brygadzista', notification_id: 1, status: 'Odczytane', confirmed_at: '2025-06-15T06:10:00Z' },
              { user_id: 22, name: 'Anna Pomocnik', notification_id: 2, status: 'Nowe', confirmed_at: null },
            ],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .get(`${PATH}?date=2025-06-15&team_ids=10`)
      .set('Authorization', `Bearer ${kierownikToken(3)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(expect.objectContaining({
      teams_sent: 1,
      sent_to: 2,
      confirmed: 1,
      pending: 1,
    }));
    expect(res.body.items[0]).toEqual(expect.objectContaining({
      team_id: 10,
      team_name: 'Brygada Alfa',
      pending: 1,
    }));
  });
});

describe('POST /api/dispatch/route-brief/:briefId/confirm', () => {
  const PATH = '/api/dispatch/route-brief/77/confirm';

  afterEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('401 when no token', async () => {
    expect((await request(app).post(PATH)).status).toBe(401);
  });

  it('404 when the current user is not a recipient', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${brygadzistaToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Odprawa/);
  });

  it('409 when route brief recipient has no notification to confirm', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) {
        expect(params).toEqual([77, 3]);
        return {
          rows: [{
            id: 77,
            date: '2025-06-15',
            team_id: 10,
            team_name: 'Brygada Alfa',
            user_id: 3,
            notification_id: null,
            status: null,
            data_odczytu: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${brygadzistaToken()}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/powiadomienia/i);
  });

  it('404 when referenced route brief notification no longer exists', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) {
        expect(params).toEqual([77, 3]);
        return {
          rows: [{
            id: 77,
            date: '2025-06-15',
            team_id: 10,
            team_name: 'Brygada Alfa',
            user_id: 3,
            notification_id: 99,
            status: 'Nowe',
            data_odczytu: null,
          }],
          rowCount: 1,
        };
      }
      if (s.includes('UPDATE notifications')) {
        expect(params).toEqual([99, 3]);
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${brygadzistaToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Powiadomienie/);
  });

  it('200 confirms the route brief for a crew recipient', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (s.includes('FROM dispatch_route_briefs rb')) {
        expect(params).toEqual([77, 3]);
        return {
          rows: [{
            id: 77,
            date: '2025-06-15',
            team_id: 10,
            team_name: 'Brygada Alfa',
            user_id: 3,
            notification_id: 99,
            status: 'Nowe',
            data_odczytu: null,
          }],
          rowCount: 1,
        };
      }
      if (s.includes('UPDATE notifications')) {
        expect(params).toEqual([99, 3]);
        return {
          rows: [{ id: 99, status: 'Odczytane', data_odczytu: '2025-06-15T06:10:00Z' }],
          rowCount: 1,
        };
      }
      if (s.includes('INSERT INTO audit_log')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${brygadzistaToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      message: 'Odprawa potwierdzona',
      brief_id: 77,
      team_id: 10,
      team_name: 'Brygada Alfa',
      notification_id: 99,
      status: 'Odczytane',
    }));
  });
});

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
