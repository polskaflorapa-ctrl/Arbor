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

jest.mock('../src/services/crmInbox', () => ({
  appendCrmMessageForContact: jest.fn().mockResolvedValue({ lead_id: 301, message_id: 401 }),
}));

jest.mock('../src/services/quotationFinalize', () => ({
  afterQuotationFullyApproved: jest.fn().mockResolvedValue(null),
  resendQuotationClientOffer: jest.fn().mockResolvedValue({ id: 501, status: 'Wyslana_Klientowi' }),
}));

const pool = require('../src/config/database');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');
const { solve } = require('../src/services/vrp');
const { afterQuotationFullyApproved } = require('../src/services/quotationFinalize');
const { appendCrmMessageForContact } = require('../src/services/crmInbox');

const app = createApp();
const PREVIOUS_PUBLIC_BASE_URL = env.PUBLIC_BASE_URL;

function directorToken() {
  return jwt.sign({ id: 9001, rola: 'Dyrektor', oddzial_id: null }, env.JWT_SECRET);
}

describe('critical operational path smoke', () => {
  let task;
  let quotation;
  let workLogId;
  let settlement;
  let statusEvents;
  let statusToken;

  beforeEach(() => {
    jest.clearAllMocks();
    env.PUBLIC_BASE_URL = 'https://demo.arbor.test';
    workLogId = 701;
    settlement = null;
    statusEvents = [];
    statusToken = 'tok_smoke_public_123456789012345';
    quotation = {
      id: 501,
      status: 'W_Zatwierdzeniu',
      klient_nazwa: 'Smoke Klient',
      klient_telefon: '+48500111222',
      klient_email: 'smoke@example.invalid',
      adres: 'Smoke Testowa 1',
      miasto: 'Krakow',
      oddzial_id: 2,
      wyceniajacy_id: 9004,
      wartosc_zaproponowana: 2160,
      koszt_wlasny_calkowity: 900,
      marza_pct: 58.3,
    };
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
      source_quotation_id: quotation.id,
      marza_pct: null,
      oddzial_id: 2,
      ekipa_id: 5,
      wyceniajacy_id: 9004,
      pin_lat: 50.06143,
      pin_lng: 19.93658,
      link_statusowy_token: null,
    };

    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (
        s.startsWith('ALTER TABLE') ||
        s.startsWith('CREATE TABLE') ||
        s.startsWith('CREATE INDEX') ||
        s.startsWith('CREATE UNIQUE INDEX')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('INSERT INTO telephony_call_logs')) {
        return {
          rows: [{
            id: 301,
            oddzial_id: Number(params[0]),
            phone: params[1],
            call_type: params[2],
            status: params[3],
            duration_sec: Number(params[4] || 0),
            task_id: params[5],
            lead_name: params[6],
            notes: params[7],
            created_by: params[8],
            created_at: '2026-05-29T07:45:00.000Z',
          }],
          rowCount: 1,
        };
      }
      if (s.includes('SELECT id FROM tasks t WHERE')) {
        return { rows: [{ id: task.id }], rowCount: 1 };
      }
      if (s.includes('SELECT link_statusowy_token FROM tasks WHERE id = $1')) {
        return { rows: [{ link_statusowy_token: task.link_statusowy_token }], rowCount: 1 };
      }
      if (s.includes('SET link_statusowy_token = COALESCE')) {
        task.link_statusowy_token = task.link_statusowy_token || statusToken;
        return { rows: [{ link_statusowy_token: task.link_statusowy_token }], rowCount: 1 };
      }
      if (s.includes('WHERE t.link_statusowy_token = $1')) {
        if (params[0] !== statusToken) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            ...task,
            oddzial_telefon: '+48123123123',
            oddzial_nazwa: 'Oddzial Smoke',
            ekipa_nazwa: 'Ekipa Smoke',
          }],
          rowCount: 1,
        };
      }
      if (s.includes('FROM task_public_status_events')) {
        return { rows: statusEvents, rowCount: statusEvents.length };
      }
      if (s.includes('INSERT INTO task_public_status_events')) {
        const row = {
          id: statusEvents.length + 1,
          task_id: Number(params[0]),
          from_status: params[1],
          to_status: params[2],
          source: params[3],
          note: params[4],
          created_by: params[5],
          created_at: new Date(Date.UTC(2026, 4, 29, 8 + statusEvents.length, 0, 0)).toISOString(),
        };
        statusEvents.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/FROM\s+tasks\s+t[\s\S]*WHERE\s+t\.id\s*=\s*\$1/i.test(s)) {
        return {
          rows: [{
            ...task,
            id: Number(params[0] || task.id),
            rozliczenie_wartosc_brutto: settlement?.wartosc_brutto ?? null,
            rozliczenie_vat_stawka: settlement?.vat_stawka ?? null,
            rozliczenie_wartosc_netto: settlement?.wartosc_netto ?? null,
            rozliczenie_koszt_pomocnikow: settlement?.koszt_pomocnikow ?? null,
            rozliczenie_podstawa_brygadzisty: settlement?.podstawa_brygadzisty ?? null,
            rozliczenie_procent_brygadzisty: settlement?.procent_brygadzisty ?? null,
            rozliczenie_wynagrodzenie_brygadzisty: settlement?.wynagrodzenie_brygadzisty ?? null,
            materialy_zuzyte_count: settlement ? 1 : 0,
            materialy_zuzyte: settlement
              ? [{ nazwa: 'Paliwo', ilosc: 5, jednostka: 'l', notatka: 'Smoke koszt operacyjny' }]
              : [],
          }],
          rowCount: 1,
        };
      }
      if (s.includes('SELECT * FROM quotations WHERE id = $1')) {
        return { rows: [{ ...quotation, id: Number(params[0] || quotation.id) }], rowCount: 1 };
      }
      if (s.includes('SELECT * FROM quotation_approvals WHERE id = $1 AND quotation_id = $2')) {
        return {
          rows: [{
            id: Number(params[0]),
            quotation_id: Number(params[1]),
            wymagany_typ: 'Kierownik',
            decyzja: 'Pending',
          }],
          rowCount: 1,
        };
      }
      if (s.includes('UPDATE quotation_approvals SET decyzja')) {
        return { rows: [], rowCount: 1 };
      }
      if (s.includes("SELECT COUNT(*)::int AS c FROM quotation_approvals")) {
        return { rows: [{ c: 0 }], rowCount: 1 };
      }
      if (s.includes("UPDATE quotations SET status = 'Zatwierdzona'")) {
        quotation.status = 'Zatwierdzona';
        return { rows: [], rowCount: 1 };
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
            s.startsWith('CREATE UNIQUE INDEX') ||
            s.startsWith('ALTER TABLE')
          ) {
            return { rows: [], rowCount: 0 };
          }
          if (s.includes('INSERT INTO task_public_status_events')) {
            const row = {
              id: statusEvents.length + 1,
              task_id: Number(params[0]),
              from_status: params[1],
              to_status: params[2],
              source: params[3],
              note: params[4],
              created_by: params[5],
              created_at: new Date(Date.UTC(2026, 4, 29, 8 + statusEvents.length, 0, 0)).toISOString(),
            };
            statusEvents.push(row);
            return { rows: [row], rowCount: 1 };
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

  afterAll(() => {
    env.PUBLIC_BASE_URL = PREVIOUS_PUBLIC_BASE_URL;
  });

  it('keeps Kommo, dispatcher, field finish and settlement wired together', async () => {
    const auth = { Authorization: `Bearer ${directorToken()}` };

    const intakeCall = await request(app)
      .post('/api/telephony/calls')
      .set(auth)
      .send({
        oddzial_id: 2,
        phone: '+48500111222',
        call_type: 'inbound',
        status: 'answered',
        duration_sec: 184,
        task_id: 101,
        lead_name: 'Smoke Klient',
        notes: 'Klient pyta o termin i koszt wycinki',
      });
    expect(intakeCall.status).toBe(201);
    expect(appendCrmMessageForContact).toHaveBeenCalledWith(expect.objectContaining({
      oddzialId: 2,
      phone: '+48500111222',
      channel: 'phone',
      direction: 'inbound',
      status: 'received',
      externalMessageId: 'telephony_call_301',
    }));

    const beforeKommo = await request(app)
      .get('/api/tasks/101/kommo-payload')
      .set(auth);
    expect(beforeKommo.status).toBe(200);
    expect(beforeKommo.body.event).toBe('task.sync');
    expect(beforeKommo.body.task.id).toBe(101);

    const approval = await request(app)
      .post('/api/quotations/501/approvals/77/decision')
      .set(auth)
      .send({ decyzja: 'Approved', komentarz: 'Smoke approval' });
    expect(approval.status).toBe(200);
    expect(approval.body.status).toBe('Zatwierdzona');
    expect(afterQuotationFullyApproved).toHaveBeenCalledWith(pool, 501);

    const costSuggestions = await request(app)
      .get('/api/tasks/101/finish-cost-suggestions')
      .set(auth);
    expect(costSuggestions.status).toBe(200);
    expect(costSuggestions.body.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'paliwo', amount: expect.any(Number) }),
      expect.objectContaining({ category: 'utylizacja', amount: expect.any(Number) }),
    ]));
    expect(costSuggestions.body.validation_limits).toMatchObject({
      category_max: expect.any(Number),
      total_operational_max: expect.any(Number),
    });

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

    const publicLink = await request(app)
      .get('/api/tasks/101/status-link')
      .set(auth);
    expect(publicLink.status).toBe(200);
    expect(publicLink.body).toMatchObject({
      task_id: 101,
      token: statusToken,
    });
    expect(publicLink.body.url).toContain(`/track/${statusToken}`);

    const publicTrack = await request(app)
      .get(`/track/${statusToken}`)
      .set('Accept', 'application/json');
    expect(publicTrack.status).toBe(200);
    expect(publicTrack.body.task).toMatchObject({
      id: 101,
      status: 'W_Realizacji',
      branch: { name: 'Oddzial Smoke', phone: '+48123123123' },
      team_visible: 'Ekipa Smoke',
    });
    expect(publicTrack.body.task.map.url).toContain('google.com/maps');
    expect(publicTrack.body.task).not.toHaveProperty('klient_telefon');
    expect(publicTrack.body.task).not.toHaveProperty('wartosc_planowana');
    expect(publicTrack.body.timeline.map((row) => row.status)).toContain('W_Realizacji');

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
    expect(afterKommo.body.task.wartosc_netto_do_rozliczenia).toBe(2160);
    expect(afterKommo.body.task.financials).toMatchObject({
      revenue_net: 2160,
      direct_labor_cost: 470,
      helper_cost: 200,
      crew_lead_pay: 270,
      total_known_cost: 470,
      margin_pct: 78.2,
    });
    expect(afterKommo.body.task.settlement).toMatchObject({
      gross: 2160,
      vat_rate: 8,
      net: 2000,
      helper_cost: 200,
      crew_lead_pay: 270,
    });
    expect(afterKommo.body.task.material_usage).toMatchObject({
      count: 1,
      items: [{ nazwa: 'Paliwo', ilosc: 5, jednostka: 'l', notatka: 'Smoke koszt operacyjny' }],
    });
  });
});
