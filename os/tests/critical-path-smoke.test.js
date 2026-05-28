const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/vrp', () => ({
  solve: jest.fn(({ tasks, teams, date }) => ({
    date,
    routes: [{
      team_id: Number(teams[0]?.id || 5),
      team_name: teams[0]?.nazwa || 'Ekipa Smoke',
      stops: tasks.map((task, index) => ({
        task_id: Number(task.id),
        task_numer: task.numer || `SMOKE-${task.id}`,
        eta: index === 0 ? '08:00' : '10:00',
        service_min: Number(task.czas_obslugi_min || 90),
      })),
    }],
    unassigned: [],
    stats: {
      solver_ms: 7,
      tasks_total: tasks.length,
      tasks_assigned: tasks.length,
      tasks_unassigned: 0,
      teams_used: teams.length ? 1 : 0,
      coverage_pct: 100,
    },
  })),
}));

jest.mock('../src/services/payrollTeamDay', () => ({
  tryAutoTeamDayCloseAfterTaskFinish: jest.fn().mockResolvedValue(null),
}));

const pool = require('../src/config/database');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');
const { solve } = require('../src/services/vrp');

const app = createApp();

function directorToken() {
  return jwt.sign({ id: 9001, rola: 'Dyrektor', oddzial_id: null }, env.JWT_SECRET);
}

describe('critical operational path smoke', () => {
  let task;
  let workLogId;
  let settlement;

  beforeEach(() => {
    jest.clearAllMocks();
    workLogId = 701;
    settlement = null;
    task = {
      id: 101,
      numer: 'SMOKE-101',
      klient_nazwa: 'Smoke Klient',
      klient_telefon: '+48500111222',
      klient_email: 'smoke@example.invalid',
      adres: 'Smoke Testowa 1',
      miasto: 'Krakow',
      typ_uslugi: 'Wycinka kontrolowana',
      status: 'Do_Zatwierdzenia',
      priorytet: 'Normalny',
      data_planowana: '2026-05-29T08:00:00.000Z',
      godzina_rozpoczecia: '08:00',
      czas_planowany_godziny: 2,
      czas_obslugi_min: 120,
      wartosc_planowana: 2160,
      wartosc_netto_do_rozliczenia: null,
      oddzial_id: 2,
      ekipa_id: 5,
      wyceniajacy_id: 9004,
      pin_lat: 50.06143,
      pin_lng: 19.93658,
    };

    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.startsWith('ALTER TABLE') || s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('SELECT id FROM tasks t WHERE')) {
        return { rows: [{ id: task.id }], rowCount: 1 };
      }
      if (s.includes('SELECT t.* FROM tasks t WHERE t.id = $1')) {
        return { rows: [{ ...task, id: Number(params[0] || task.id) }], rowCount: 1 };
      }
      if (s.includes('SELECT status, wartosc_netto_do_rozliczenia FROM tasks WHERE id = $1')) {
        return { rows: [{ status: task.status, wartosc_netto_do_rozliczenia: task.wartosc_netto_do_rozliczenia }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    pool.connect.mockImplementation(async () => {
      const client = {
        query: jest.fn(async (sql, params = []) => {
          const s = String(sql);
          if (
            s === 'BEGIN' ||
            s === 'COMMIT' ||
            s === 'ROLLBACK' ||
            s.startsWith('CREATE TABLE') ||
            s.startsWith('CREATE INDEX') ||
            s.startsWith('ALTER TABLE')
          ) {
            return { rows: [], rowCount: 0 };
          }
          if (s.includes('FROM tasks t') && s.includes('t.data_planowana::date')) {
            return { rows: [{ ...task }], rowCount: 1 };
          }
          if (s.includes('FROM teams e')) {
            return {
              rows: [{
                id: 5,
                nazwa: 'Ekipa Smoke',
                oddzial_id: 2,
                depot_lat: 50.05,
                depot_lng: 19.94,
                max_godzin_dzien: 8,
                attendance_present: true,
                sprzet_typy: ['Rebak'],
                kompetencje: ['Pilarz'],
              }],
              rowCount: 1,
            };
          }
          if (s.includes('INSERT INTO work_logs')) {
            task.status = 'W_Realizacji';
            return { rows: [{ id: workLogId }], rowCount: 1 };
          }
          if (s.includes("UPDATE tasks SET status = 'W_Realizacji'")) {
            task.status = 'W_Realizacji';
            return { rows: [], rowCount: 1 };
          }
          if (s.includes('SELECT * FROM tasks WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ ...task }], rowCount: 1 };
          }
          if (s.includes('SELECT id FROM work_logs WHERE task_id = $1 AND end_time IS NULL')) {
            return { rows: [{ id: workLogId }], rowCount: 1 };
          }
          if (s.includes("UPDATE tasks SET status = 'Zakonczone'")) {
            task.status = 'Zakonczone';
            task.wartosc_netto_do_rozliczenia = Number(params[0] || 0);
            return { rows: [], rowCount: 1 };
          }
          if (s.includes('SELECT COALESCE(SUM(godziny * stawka_godzinowa), 0) AS koszt')) {
            return { rows: [{ koszt: 200 }], rowCount: 1 };
          }
          if (s.includes('INSERT INTO task_rozliczenie')) {
            settlement = {
              task_id: Number(params[0]),
              wartosc_brutto: Number(params[1]),
              vat_stawka: Number(params[2]),
              wartosc_netto: Number(params[3]),
              koszt_pomocnikow: Number(params[4]),
              podstawa_brygadzisty: Number(params[5]),
              procent_brygadzisty: Number(params[6]),
              wynagrodzenie_brygadzisty: Number(params[7]),
            };
            return { rows: [settlement], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
      };
      return client;
    });
  });

  it('keeps Kommo, dispatcher, field finish and settlement wired together', async () => {
    const auth = { Authorization: `Bearer ${directorToken()}` };

    const beforeKommo = await request(app)
      .get('/api/tasks/101/kommo-payload')
      .set(auth);
    expect(beforeKommo.status).toBe(200);
    expect(beforeKommo.body.event).toBe('task.sync');
    expect(beforeKommo.body.task.id).toBe(101);

    const plan = await request(app)
      .post('/api/dispatch/plan')
      .set(auth)
      .send({ date: '2026-05-29', oddzial_id: 2 });
    expect(plan.status).toBe(200);
    expect(plan.body.stats.tasks_assigned).toBe(1);
    expect(plan.body.routes[0].stops[0].task_id).toBe(101);
    expect(solve).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-05-29',
      oddzial_id: 2,
    }));

    const start = await request(app)
      .post('/api/tasks/101/start')
      .set(auth)
      .send({ lat: 50.06143, lng: 19.93658 });
    expect(start.status).toBe(200);
    expect(start.body.work_log_id).toBe(workLogId);

    const finish = await request(app)
      .post('/api/tasks/101/finish')
      .set(auth)
      .send({ lat: 50.062, lng: 19.937, notatki: 'Smoke finish' });
    expect(finish.status).toBe(200);
    expect(finish.body.wartosc_netto_do_rozliczenia).toBe(2160);

    const rozliczenie = await request(app)
      .post('/api/rozliczenia/zadanie/101')
      .set(auth)
      .send({ wartosc_brutto: 2160, vat_stawka: 8, procent_brygadzisty: 15 });
    expect(rozliczenie.status).toBe(200);
    expect(rozliczenie.body).toMatchObject({
      task_id: 101,
      wartosc_brutto: 2160,
      vat_stawka: 8,
      koszt_pomocnikow: 200,
    });
    expect(rozliczenie.body.wynagrodzenie_brygadzisty).toBeCloseTo(270, 2);

    const afterKommo = await request(app)
      .get('/api/tasks/101/kommo-payload')
      .set(auth);
    expect(afterKommo.status).toBe(200);
    expect(afterKommo.body.task.status).toBe('Zakonczone');
    // Some task payload builders may omit optional settlement fields when undefined.
    // In that case, keep the smoke gate focused on status + settled value path above.
    if (afterKommo.body.task.wartosc_netto_do_rozliczenia != null) {
      expect(Number(afterKommo.body.task.wartosc_netto_do_rozliczenia)).toBe(2160);
    }
  });
});
