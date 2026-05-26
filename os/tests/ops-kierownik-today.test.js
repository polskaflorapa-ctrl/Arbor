const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const { env } = require('../src/config/env');
const opsRoutes = require('../src/routes/ops');
const { createTestApp } = require('./helpers/create-test-app');

const app = createTestApp('/api/ops', opsRoutes);

const token = (payload) => jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 7, ...payload }, env.JWT_SECRET);

describe('GET /api/ops/kierownik-today', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('rejects non-management users', async () => {
    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista' })}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns branch-scoped cockpit for kierownik', async () => {
    const gpsTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM tasks t') && text.includes('LEFT JOIN teams e')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('t.oddzial_id = $2');
        return {
          rows: [
            {
              id: 10,
              numer: 'ARB-10',
              klient_nazwa: 'Test Klient',
              klient_telefon: '',
              adres: 'Krakow 1',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Pilny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: null,
              oddzial_id: 7,
              pin_lat: null,
              pin_lng: null,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: null,
              oddzial_nazwa: 'Krakow',
              open_issues: 1,
              has_started: false,
              has_finished: false,
            },
            {
              id: 11,
              numer: 'ARB-11',
              klient_nazwa: 'Gotowy Klient',
              klient_telefon: '+48123123123',
              adres: 'Krakow 2',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T09:00:00.000Z',
              ekipa_id: 3,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: 2,
              czas_obslugi_min: 120,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM teams tm')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('tm.oddzial_id = $2');
        return {
          rows: [
            {
              id: 3,
              nazwa: 'Ekipa A',
              oddzial_id: 7,
              tasks_total: 1,
              in_progress: 0,
              planned: 1,
              last_gps_at: gpsTime,
            },
          ],
        };
      }
      if (text.includes('FROM notifications')) {
        expect(params).toEqual([1]);
        return { rows: [{ unread: 2 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(7);
    expect(res.body.summary.tasks_total).toBe(2);
    expect(res.body.summary.ready_for_dispatch).toBe(1);
    expect(res.body.summary.blocked).toBe(1);
    expect(res.body.summary.unread_notifications).toBe(2);
    expect(res.body.blockers.map((b) => b.key)).toEqual(expect.arrayContaining(['team', 'phone', 'gps', 'duration', 'issue', 'notification']));
    expect(res.body.tasks[0]).toMatchObject({
      id: 10,
      action_path: expect.stringContaining('/zlecenia/10'),
    });
  });

  it('lets directors request a selected branch', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26&oddzial_id=4')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: null })}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(4);
    const taskCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('LEFT JOIN teams e'));
    expect(taskCall[1]).toEqual(['2026-05-26', 4]);
  });
});

describe('GET /api/ops/plan-vs-real', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('returns branch-scoped plan vs real deviations for managers', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('t.oddzial_id = $2');
        return {
          rows: [
            {
              id: 20,
              numer: 'ARB-20',
              klient_nazwa: 'Przekroczony Klient',
              status: 'W_Realizacji',
              priorytet: 'Pilny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: 3,
              oddzial_id: 7,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              planned_minutes: 120,
              real_minutes: 190,
              logs_total: 1,
              has_started: true,
              has_finished: false,
              first_start: '2026-05-26T06:00:00.000Z',
              last_finish: null,
              wartosc_planowana: 1500,
              wartosc_rzeczywista: null,
            },
            {
              id: 21,
              numer: 'ARB-21',
              klient_nazwa: 'Bez czasu',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T10:00:00.000Z',
              ekipa_id: 4,
              oddzial_id: 7,
              ekipa_nazwa: 'Ekipa B',
              oddzial_nazwa: 'Krakow',
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
              wartosc_planowana: 900,
              wartosc_rzeczywista: null,
            },
            {
              id: 22,
              numer: 'ARB-22',
              klient_nazwa: 'Gotowe',
              status: 'Zakonczone',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T11:00:00.000Z',
              ekipa_id: 4,
              oddzial_id: 7,
              ekipa_nazwa: 'Ekipa B',
              oddzial_nazwa: 'Krakow',
              planned_minutes: 60,
              real_minutes: 55,
              logs_total: 1,
              has_started: true,
              has_finished: true,
              wartosc_planowana: 700,
              wartosc_rzeczywista: 750,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/plan-vs-real?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(7);
    expect(res.body.summary).toEqual(expect.objectContaining({
      planned_tasks: 3,
      started_tasks: 2,
      finished_tasks: 1,
      overrun_tasks: 1,
      missing_duration_tasks: 1,
      planned_minutes: 180,
      real_minutes: 245,
      delta_minutes: 65,
      value_done: 750,
    }));
    expect(res.body.tasks.map((task) => task.issue_key)).toEqual(expect.arrayContaining(['overrun', 'missing_duration']));
    expect(res.body.tasks.find((task) => task.id === 21).action_path).toContain('field=czas_planowany_godziny');
  });
});

describe('POST /api/ops/plan-vs-real/tasks/:taskId/action', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('sets planned duration and appends a manager note inside branch scope', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM tasks t') && text.includes('WHERE t.id = $1')) {
        expect(params).toEqual([55]);
        return {
          rows: [{
            id: 55,
            numer: 'ARB-55',
            klient_nazwa: 'Klient',
            status: 'Zaplanowane',
            oddzial_id: 7,
            ekipa_id: 3,
            ekipa_nazwa: 'Ekipa A',
            brygadzista_id: 9,
          }],
        };
      }
      if (text.includes('SET czas_planowany_godziny = $1')) {
        expect(params[0]).toBe(1.5);
        expect(params[1]).toBe(90);
        expect(params[2]).toContain('PLAN VS REAL');
        expect(params[2]).toContain('Ustawiono czas planu');
        expect(params[3]).toBe(55);
        return {
          rows: [{
            id: 55,
            numer: 'ARB-55',
            czas_planowany_godziny: '1.5',
            czas_obslugi_min: 90,
            notatki_wewnetrzne: params[2],
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/plan-vs-real/tasks/55/action')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'set_duration', planned_minutes: 90, note: 'Dwa drzewa i dojazd' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Czas planu zapisany');
    expect(res.body.task.czas_obslugi_min).toBe(90);
  });

  it('sends a team reminder notification and keeps an action trace on the task', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM tasks t') && text.includes('WHERE t.id = $1')) {
        return {
          rows: [{
            id: 77,
            numer: 'ARB-77',
            klient_nazwa: 'Klient terenowy',
            status: 'Zaplanowane',
            oddzial_id: 7,
            ekipa_id: 5,
            ekipa_nazwa: 'Ekipa B',
            brygadzista_id: 9003,
          }],
        };
      }
      if (text.includes('SELECT DISTINCT user_id')) {
        expect(params).toEqual([5]);
        return { rows: [{ user_id: 9003 }, { user_id: 9008 }] };
      }
      if (text.includes('UPDATE tasks') && text.includes('notatki_wewnetrzne')) {
        expect(params[0]).toContain('Wyslano przypomnienie do ekipy');
        expect(params[1]).toBe(77);
        return { rows: [{ id: 77, numer: 'ARB-77', notatki_wewnetrzne: params[0] }] };
      }
      if (text.includes('INSERT INTO notifications')) {
        expect(params[0]).toBe(1);
        expect(params[1]).toBe(77);
        expect(params[2]).toContain('Plan vs real');
        expect(params[3]).toEqual([9003, 9008]);
        return {
          rows: [
            { id: 1, to_user_id: 9003, typ: 'Plan vs real', tresc: params[2], task_id: 77, status: 'Nowe' },
            { id: 2, to_user_id: 9008, typ: 'Plan vs real', tresc: params[2], task_id: 77, status: 'Nowe' },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/plan-vs-real/tasks/77/action')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'remind_team', note: 'Brak startu po 9:00' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Przypomnienie wyslane');
    expect(res.body.notification_count).toBe(2);
  });

  it('blocks manager action on a task from another branch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 88,
        numer: 'ARB-88',
        status: 'Zaplanowane',
        oddzial_id: 4,
        ekipa_id: 5,
      }],
    });

    const res = await request(app)
      .post('/api/ops/plan-vs-real/tasks/88/action')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'set_duration', planned_minutes: 60 });

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/ops/plan-vs-real', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('rejects non-management users', async () => {
    const res = await request(app)
      .get('/api/ops/plan-vs-real?date=2026-05-26')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista' })}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns branch-scoped daily plan versus actuals', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      expect(text).toContain('WITH planned AS');
      expect(text).toContain('t.oddzial_id = $2');
      expect(params).toEqual(['2026-05-26', 7]);
      return {
        rows: [
          {
            id: 21,
            numer: 'ARB-21',
            klient_nazwa: 'Duzy klient',
            status: 'W_Realizacji',
            priorytet: 'Pilny',
            data_planowana: '2026-05-26T08:00:00.000Z',
            ekipa_id: 5,
            oddzial_id: 7,
            ekipa_nazwa: 'Ekipa B',
            oddzial_nazwa: 'Krakow',
            planned_minutes: '120',
            real_minutes: '170',
            logs_total: 1,
            has_started: true,
            has_finished: false,
            first_start: '2026-05-26T08:00:00.000Z',
            last_finish: null,
            wartosc_planowana: '1000',
            wartosc_rzeczywista: null,
          },
          {
            id: 22,
            numer: 'ARB-22',
            klient_nazwa: 'Plan bez startu',
            status: 'Zaplanowane',
            priorytet: 'Normalny',
            data_planowana: '2026-05-26T10:00:00.000Z',
            ekipa_id: 6,
            oddzial_id: 7,
            ekipa_nazwa: 'Ekipa C',
            oddzial_nazwa: 'Krakow',
            planned_minutes: '60',
            real_minutes: '0',
            logs_total: 0,
            has_started: false,
            has_finished: false,
            first_start: null,
            last_finish: null,
            wartosc_planowana: '300',
            wartosc_rzeczywista: null,
          },
          {
            id: 23,
            numer: 'ARB-23',
            klient_nazwa: 'Zamkniete',
            status: 'Zakonczone',
            priorytet: 'Normalny',
            data_planowana: '2026-05-26T12:00:00.000Z',
            ekipa_id: 5,
            oddzial_id: 7,
            ekipa_nazwa: 'Ekipa B',
            oddzial_nazwa: 'Krakow',
            planned_minutes: '90',
            real_minutes: '80',
            logs_total: 1,
            has_started: true,
            has_finished: true,
            first_start: '2026-05-26T12:00:00.000Z',
            last_finish: '2026-05-26T13:20:00.000Z',
            wartosc_planowana: '500',
            wartosc_rzeczywista: '450',
          },
        ],
      };
    });

    const res = await request(app)
      .get('/api/ops/plan-vs-real?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(7);
    expect(res.body.summary).toMatchObject({
      planned_tasks: 3,
      started_tasks: 2,
      finished_tasks: 1,
      overrun_tasks: 1,
      not_started_tasks: 1,
      planned_minutes: 270,
      real_minutes: 250,
      delta_minutes: -20,
      value_planned: 1800,
      value_done: 450,
    });
    expect(res.body.tasks[0]).toMatchObject({
      id: 21,
      issue_key: 'overrun',
      delta_minutes: 50,
      action_path: expect.stringContaining('/zlecenia/21'),
    });
    expect(res.body.tasks.map((task) => task.issue_key)).toEqual(expect.arrayContaining(['overrun', 'not_started']));
  });

  it('lets directors request a selected branch', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/ops/plan-vs-real?date=2026-05-26&oddzial_id=4')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: null })}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(4);
    expect(pool.query.mock.calls[0][1]).toEqual(['2026-05-26', 4]);
  });
});
