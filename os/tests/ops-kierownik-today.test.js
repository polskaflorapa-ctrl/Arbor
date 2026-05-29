const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/smsGateway', () => ({
  sendSmsGateway: jest.fn(),
  resolveBranchSmsSender: jest.fn(),
}));

jest.mock('../src/services/zadarma', () => ({
  requestCallback: jest.fn(),
}));

const pool = require('../src/config/database');
const { env } = require('../src/config/env');
const { sendSmsGateway, resolveBranchSmsSender } = require('../src/services/smsGateway');
const { requestCallback } = require('../src/services/zadarma');
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
        expect(text).toContain("g.provider = 'mobile'");
        expect(text).toContain('LEFT JOIN latest_team_gps lvg');
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

  it('adds margin risks below branch threshold to manager cockpit', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM tasks t') && text.includes('LEFT JOIN teams e')) {
        return { rows: [] };
      }
      if (text.includes('FROM teams tm')) {
        return { rows: [] };
      }
      if (text.includes('FROM notifications')) {
        return { rows: [{ unread: 0 }] };
      }
      if (text.includes('JOIN task_rozliczenie tr')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('t.oddzial_id = $2');
        expect(text).toContain('task_operational_costs');
        return {
          rows: [{
            id: 77,
            numer: 'ARB-77',
            klient_nazwa: 'Slaba Marza',
            status: 'Zakonczone',
            oddzial_id: 7,
            data_planowana: '2026-05-26T08:00:00.000Z',
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
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/kierownik-today?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.margin_risks).toBe(1);
    expect(res.body.blockers.map((b) => b.key)).toContain('margin');
    expect(res.body.margin_risks).toEqual([
      expect.objectContaining({
        id: 77,
        margin_pct: 13,
        threshold_pct: 20,
        action_path: expect.stringContaining('/zlecenia/77'),
      }),
    ]);
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
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[0]).toBe(55);
        expect(params[1]).toBe(7);
        expect(params[2]).toBe(1);
        expect(params[3]).toBe('set_duration');
        expect(params[4]).toBe('missing_duration');
        expect(params[7]).toBe(90);
        expect(params[9]).toBe('Dwa drzewa i dojazd');
        return { rows: [{ id: 501, task_id: 55, action_type: 'set_duration', issue_key: 'missing_duration' }] };
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
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[0]).toBe(77);
        expect(params[1]).toBe(7);
        expect(params[3]).toBe('remind_team');
        expect(params[4]).toBe('not_started');
        expect(JSON.parse(params[10]).notification_count).toBe(2);
        return { rows: [{ id: 777, task_id: 77, action_type: 'remind_team', issue_key: 'not_started' }] };
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
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM tasks t') && text.includes('WHERE t.id = $1')) {
        return {
          rows: [{
            id: 88,
            numer: 'ARB-88',
            status: 'Zaplanowane',
            oddzial_id: 4,
            ekipa_id: 5,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/plan-vs-real/tasks/88/action')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'set_duration', planned_minutes: 60 });

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('SET czas_planowany_godziny'))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ops_action_events'))).toBe(false);
  });
});

describe('POST /api/ops/risk-report/actions', () => {
  beforeEach(() => {
    pool.query.mockReset();
    sendSmsGateway.mockReset();
    resolveBranchSmsSender.mockReset();
    requestCallback.mockReset();
  });

  it('resends failed risk SMS through the Zadarma-first SMS gateway and records action memory', async () => {
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'zadarma', message_id: 'sms-2' });
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('FROM tasks t') && text.includes('b.telefon AS oddzial_telefon')) {
        expect(params).toEqual([77]);
        return {
          rows: [{
            id: 77,
            numer: 'ARB-77',
            klient_nazwa: 'Klient SMS',
            klient_telefon: '+48123123123',
            oddzial_id: 7,
            oddzial_telefon: '+48221234567',
          }],
        };
      }
      if (text.includes('FROM sms_history h')) {
        expect(params).toEqual([55, 77, 7]);
        return { rows: [{ id: 55, task_id: 77, tresc: 'Poprzednia tresc SMS' }] };
      }
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[0]).toBe(77);
        expect(params[1]).toBe(7);
        expect(params[3]).toBe('risk_resend_sms');
        expect(params[4]).toBe('sms_delivery');
        expect(JSON.parse(params[10])).toMatchObject({
          risk_id: 'sms_delivery:55',
          provider: 'zadarma',
          ok: true,
        });
        return { rows: [{ id: 900, task_id: 77, action_type: 'risk_resend_sms' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/risk-report/actions')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        action: 'resend_zadarma_sms',
        risk_id: 'sms_delivery:55',
        risk_type: 'sms_delivery',
        task_id: 77,
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('SMS wyslany');
    expect(sendSmsGateway).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48123123123',
      body: 'Poprzednia tresc SMS',
      taskId: 77,
      oddzialId: 7,
    }));
  });

  it('queues a Zadarma call from a risk and keeps audit trace even when callback API is used', async () => {
    resolveBranchSmsSender.mockResolvedValue('+48221234567');
    requestCallback.mockResolvedValue({ status: 'success', call_id: 'call-1' });
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('CREATE TABLE IF NOT EXISTS telephony_callbacks') || text.includes('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks')) {
        return { rows: [] };
      }
      if (text.includes('FROM tasks t') && text.includes('b.telefon AS oddzial_telefon')) {
        return {
          rows: [{
            id: 88,
            numer: 'ARB-88',
            klient_nazwa: 'Klient Telefon',
            klient_telefon: '+48999111222',
            oddzial_id: 7,
            oddzial_telefon: '+48220000000',
          }],
        };
      }
      if (text.includes('INSERT INTO telephony_callbacks')) {
        expect(params).toEqual([
          7,
          '+48999111222',
          88,
          'Klient Telefon',
          'Pilny kontakt',
          1,
        ]);
        return { rows: [{ id: 44, task_id: 88, phone: '+48999111222', status: 'open' }] };
      }
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[3]).toBe('risk_queue_call');
        expect(JSON.parse(params[10])).toMatchObject({
          risk_id: 'client_window:88',
          callback_id: 44,
          zadarma_call: { requested: true, ok: true, from: '+48221234567' },
        });
        return { rows: [{ id: 901, task_id: 88, action_type: 'risk_queue_call' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/risk-report/actions')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        action: 'queue_zadarma_call',
        risk_id: 'client_window:88',
        risk_type: 'client_window',
        task_id: 88,
        note: 'Pilny kontakt',
      });

    expect(res.status).toBe(200);
    expect(res.body.callback).toMatchObject({ id: 44, status: 'open' });
    expect(requestCallback).toHaveBeenCalledWith({ from: '+48221234567', to: '+48999111222' });
  });

  it('suggests a free team and applies reassign action with audit', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('FROM tasks t') && text.includes('LEFT JOIN teams e')) {
        return {
          rows: [{
            id: 101,
            numer: 'ARB-101',
            klient_nazwa: 'Konflikt Ekipy',
            oddzial_id: 7,
            ekipa_id: 5,
            ekipa_nazwa: 'Ekipa A',
            data_planowana: '2026-05-26T08:00:00.000Z',
            czas_planowany_godziny: 2,
          }],
        };
      }
      if (text.includes('FROM teams tm')) {
        expect(params).toEqual([7, 5]);
        return { rows: [{ id: 6, nazwa: 'Ekipa B', oddzial_id: 7 }] };
      }
      if (text.includes('UNION ALL') && text.includes('equipment_reservations r')) {
        expect(params).toEqual([6, 101, '2026-05-26']);
        return { rows: [] };
      }
      if (text.includes('UPDATE tasks') && text.includes('SET ekipa_id = $1')) {
        expect(params[0]).toBe(6);
        expect(params[1]).toContain('RAPORT RYZYK / PRZEPIECIE EKIPY');
        return { rows: [{ id: 101, numer: 'ARB-101', ekipa_id: 6 }] };
      }
      if (text.includes('UPDATE equipment_reservations') && text.includes('SET ekipa_id = $1')) {
        expect(params).toEqual([6, 101]);
        return { rows: [] };
      }
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[3]).toBe('risk_reassign_team');
        expect(JSON.parse(params[10])).toMatchObject({
          risk_id: 'team_conflict:100:101',
          old_team_id: 5,
          new_team_id: 6,
        });
        return { rows: [{ id: 902, task_id: 101, action_type: 'risk_reassign_team' }] };
      }
      return { rows: [] };
    });

    const options = await request(app)
      .get('/api/ops/risk-report/actions/options?risk_type=team_conflict&risk_id=team_conflict:100:101&task_id=101')
      .set('Authorization', `Bearer ${token()}`);

    expect(options.status).toBe(200);
    expect(options.body.options[0]).toMatchObject({ team_id: 6, team_name: 'Ekipa B' });

    const res = await request(app)
      .post('/api/ops/risk-report/actions')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        action: 'reassign_team',
        risk_id: 'team_conflict:100:101',
        risk_type: 'team_conflict',
        task_id: 101,
        team_id: 6,
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Ekipa B');
  });

  it('replaces conflicted equipment with a free alternative and records action memory', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('FROM tasks t') && text.includes('LEFT JOIN teams e')) {
        return {
          rows: [{
            id: 202,
            numer: 'ARB-202',
            klient_nazwa: 'Konflikt Sprzetu',
            oddzial_id: 7,
            ekipa_id: 5,
            ekipa_nazwa: 'Ekipa A',
            data_planowana: '2026-05-26T08:00:00.000Z',
            czas_planowany_godziny: 2,
          }],
        };
      }
      if (text.includes('SELECT id, nazwa, typ, oddzial_id FROM equipment_items WHERE id = $1')) {
        expect(params).toEqual([30]);
        return { rows: [{ id: 30, nazwa: 'Rebak A', typ: 'rebak', oddzial_id: 7 }] };
      }
      if (text.includes('FROM equipment_items e')) {
        expect(params).toEqual([30, 7, 'rebak']);
        return { rows: [{ id: 31, nazwa: 'Rebak B', typ: 'rebak', oddzial_id: 7 }] };
      }
      if (text.includes('FROM equipment_reservations') && text.includes('sprzet_id = $1')) {
        expect(params).toEqual([31, '2026-05-26', 202]);
        return { rows: [] };
      }
      if (text.includes('UPDATE equipment_reservations') && text.includes("status = 'Anulowane'")) {
        expect(params).toEqual([202, 30]);
        return { rows: [] };
      }
      if (text.includes('INSERT INTO equipment_reservations')) {
        expect(params).toEqual([7, 31, 5, '2026-05-26', 1, 202, expect.stringContaining('PRZEPIECIE SPRZETU')]);
        return { rows: [{ id: 700, sprzet_id: 31, task_id: 202, ekipa_id: 5, status: 'Zarezerwowane' }] };
      }
      if (text.includes('UPDATE tasks') && text.includes('notatki_wewnetrzne')) {
        return { rows: [{ id: 202, numer: 'ARB-202' }] };
      }
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[3]).toBe('risk_replace_equipment');
        expect(JSON.parse(params[10])).toMatchObject({
          risk_id: 'equipment_conflict:30',
          old_sprzet_id: 30,
          new_sprzet_id: 31,
          reservation_id: 700,
        });
        return { rows: [{ id: 903, task_id: 202, action_type: 'risk_replace_equipment' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/risk-report/actions')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        action: 'replace_equipment',
        risk_id: 'equipment_conflict:30',
        risk_type: 'equipment_conflict',
        task_id: 202,
        sprzet_id: 31,
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Rebak B');
    expect(res.body.reservation).toMatchObject({ id: 700, sprzet_id: 31 });
  });
});

describe('GET /api/ops/action-insights', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('aggregates action memory for the manager branch', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (
        text.includes('FROM ops_action_events e')
        && text.includes('LEFT JOIN tasks t ON t.id = e.task_id')
        && text.includes('LIMIT 500')
      ) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('e.oddzial_id = $2');
        return {
          rows: [
            {
              id: 1,
              task_id: 10,
              oddzial_id: 7,
              action_type: 'mark_reason',
              issue_key: 'overrun',
              reason_code: 'dojazd',
              delta_minutes: 45,
              planned_minutes: 120,
              real_minutes: 165,
              numer: 'ARB-10',
              klient_nazwa: 'Klient A',
              actor_name: 'Test Kierownik',
              created_at: '2026-05-26T09:00:00.000Z',
            },
            {
              id: 2,
              task_id: 11,
              oddzial_id: 7,
              action_type: 'remind_team',
              issue_key: 'not_started',
              reason_code: null,
              delta_minutes: -60,
              planned_minutes: 60,
              real_minutes: 0,
              numer: 'ARB-11',
              klient_nazwa: 'Klient B',
              actor_name: 'Test Kierownik',
              created_at: '2026-05-26T10:00:00.000Z',
            },
            {
              id: 3,
              task_id: 12,
              oddzial_id: 7,
              action_type: 'mark_reason',
              issue_key: 'overrun',
              reason_code: 'dojazd',
              delta_minutes: 30,
              planned_minutes: 90,
              real_minutes: 120,
              numer: 'ARB-12',
              klient_nazwa: 'Klient C',
              actor_name: 'Test Kierownik',
              created_at: '2026-05-26T11:00:00.000Z',
            },
          ],
        };
      }
      if (text.includes("e.action_type = 'recommendation_feedback'")) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('e.oddzial_id = $2');
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-insights?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(7);
    expect(res.body.summary).toMatchObject({
      total_events: 3,
      affected_tasks: 3,
      reasons_total: 2,
      reminders: 1,
      avg_delta_minutes: 5,
    });
    expect(res.body.reasons[0]).toMatchObject({ reason_code: 'dojazd', label: 'Dojazd', count: 2 });
    expect(res.body.issues.map((item) => item.issue_key)).toEqual(expect.arrayContaining(['overrun', 'not_started']));
  });
});

describe('GET /api/ops/action-history', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('returns filtered operational decision history with risk outcome and branch scope', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('COUNT(*)::int AS total')) {
        expect(text).toContain('e.oddzial_id = $2');
        expect(text).toContain('e.action_type = $3');
        expect(text).toContain('COALESCE(t.numer');
        expect(params).toEqual(['2026-05-26', 7, 'risk_reassign_team', '%ARB%']);
        return { rows: [{ total: 1 }] };
      }
      if (text.includes('SELECT e.id, e.task_id') && text.includes('LIMIT $5 OFFSET $6')) {
        expect(params).toEqual(['2026-05-26', 7, 'risk_reassign_team', '%ARB%', 10, 0]);
        return {
          rows: [{
            id: 501,
            task_id: 101,
            oddzial_id: 7,
            actor_id: 1,
            action_type: 'risk_reassign_team',
            issue_key: 'team_conflict',
            reason_code: null,
            delta_minutes: null,
            planned_minutes: null,
            real_minutes: null,
            note: 'Przepieto ekipe',
            metadata: { risk_id: 'team_conflict:100:101', old_team_id: 5, new_team_id: 6 },
            created_at: '2026-05-26T09:00:00.000Z',
            numer: 'ARB-101',
            klient_nazwa: 'Klient',
            oddzial_nazwa: 'Krakow',
            actor_name: 'Test Kierownik',
          }],
        };
      }
      if (text.includes('GROUP BY e.action_type')) {
        return { rows: [{ action_type: 'risk_reassign_team', count: 1 }] };
      }
      if (text.includes('GROUP BY e.issue_key')) {
        return { rows: [{ issue_key: 'team_conflict', count: 1 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-history?date=2026-05-26&action_type=risk_reassign_team&q=ARB&limit=10')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      id: 501,
      task_id: 101,
      action_label: 'Przepiecie ekipy z ryzyka',
      risk_id: 'team_conflict:100:101',
      risk_type: 'team_conflict',
      outcome: 'Ekipa 5 -> 6',
      actor_name: 'Test Kierownik',
    });
    expect(res.body.summary.actions[0]).toMatchObject({ action_type: 'risk_reassign_team', count: 1 });
  });

  it('exports operational decision history as CSV for director control', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('COUNT(*)::int AS total')) {
        expect(params).toEqual(['2026-05-26', 7]);
        return { rows: [{ total: 1 }] };
      }
      if (text.includes('SELECT e.id, e.task_id') && text.includes('LIMIT $3 OFFSET $4')) {
        expect(params).toEqual(['2026-05-26', 7, 1000, 0]);
        return {
          rows: [{
            id: 777,
            task_id: 88,
            oddzial_id: 7,
            actor_id: 1,
            action_type: 'risk_queue_call',
            issue_key: 'sms_not_confirmed',
            note: 'Telefon do klienta',
            metadata: { risk_id: 'sms:88', zadarma_call: { ok: true } },
            created_at: '2026-05-26T10:15:00.000Z',
            numer: 'ARB-88',
            klient_nazwa: 'Klient CSV',
            oddzial_nazwa: 'Krakow',
            actor_name: 'Dyspozytor',
          }],
        };
      }
      if (text.includes('GROUP BY e.action_type')) {
        return { rows: [{ action_type: 'risk_queue_call', count: 1 }] };
      }
      if (text.includes('GROUP BY e.issue_key')) {
        return { rows: [{ issue_key: 'sms_not_confirmed', count: 1 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-history?date=2026-05-26&format=csv')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('arbor-decyzje-operacyjne');
    expect(res.text).toContain('Data decyzji;Oddzial;Operator;Decyzja');
    expect(res.text).toContain('Telefon Zadarma z ryzyka');
    expect(res.text).toContain('Klient CSV');
  });
});

describe('GET /api/ops/action-recommendations', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('builds actionable manager recommendations from plan and action memory', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS') && text.includes('open_issues')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('t.oddzial_id = $2');
        return {
          rows: [
            {
              id: 31,
              numer: 'ARB-31',
              klient_nazwa: 'Bez czasu A',
              klient_telefon: '+48111111111',
              adres: 'Krakow 1',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Pilny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: 5,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
            {
              id: 32,
              numer: 'ARB-32',
              klient_nazwa: 'Bez czasu B',
              klient_telefon: '+48222222222',
              adres: 'Krakow 2',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T09:00:00.000Z',
              ekipa_id: 6,
              oddzial_id: 7,
              pin_lat: 50.2,
              pin_lng: 19.8,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: 'Ekipa B',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
            {
              id: 33,
              numer: 'ARB-33',
              klient_nazwa: 'Bez czasu C',
              klient_telefon: '+48333333333',
              adres: 'Krakow 3',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T10:00:00.000Z',
              ekipa_id: 7,
              oddzial_id: 7,
              pin_lat: 50.3,
              pin_lng: 19.7,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: 'Ekipa C',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
            {
              id: 34,
              numer: 'ARB-34',
              klient_nazwa: 'Plan bez startu',
              klient_telefon: '+48444444444',
              adres: 'Krakow 4',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T11:00:00.000Z',
              ekipa_id: 8,
              oddzial_id: 7,
              pin_lat: 50.4,
              pin_lng: 19.6,
              czas_planowany_godziny: 1,
              czas_obslugi_min: 60,
              ekipa_nazwa: 'Ekipa D',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 60,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
            {
              id: 35,
              numer: 'ARB-35',
              klient_nazwa: 'Przekroczony',
              klient_telefon: '+48555555555',
              adres: 'Krakow 5',
              miasto: 'Krakow',
              status: 'W_Realizacji',
              priorytet: 'Pilny',
              data_planowana: '2026-05-26T12:00:00.000Z',
              ekipa_id: 9,
              oddzial_id: 7,
              pin_lat: 50.5,
              pin_lng: 19.5,
              czas_planowany_godziny: 2,
              czas_obslugi_min: 120,
              ekipa_nazwa: 'Ekipa E',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 120,
              real_minutes: 190,
              logs_total: 1,
              has_started: true,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM ops_action_events e')) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('e.oddzial_id = $2');
        return {
          rows: [
            {
              action_type: 'mark_reason',
              issue_key: 'overrun',
              reason_code: 'dojazd',
              count: 2,
              avg_delta_minutes: 45,
            },
            {
              action_type: 'mark_reason',
              issue_key: 'missing_finish',
              reason_code: 'dojazd',
              count: 2,
              avg_delta_minutes: 15,
            },
            {
              action_type: 'mark_reason',
              issue_key: 'overrun',
              reason_code: 'klient',
              count: 3,
              avg_delta_minutes: 20,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-recommendations?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(7);
    expect(res.body.summary.actionable).toBeGreaterThan(0);
    const byId = Object.fromEntries(res.body.recommendations.map((item) => [item.id, item]));
    expect(byId.set_missing_duration).toMatchObject({
      priority: 'high',
      action_kind: 'set_duration_batch',
      primary_label: 'Zastosuj',
      suggested_minutes: 120,
      task_count: 3,
    });
    expect(byId.set_missing_duration.task_preview).toHaveLength(3);
    expect(byId.set_missing_duration.task_preview[0]).toMatchObject({
      id: 31,
      numer: 'ARB-31',
      klient_nazwa: 'Bez czasu A',
      ekipa_nazwa: 'Ekipa A',
      issue_key: 'missing_duration',
      issue_label: 'Brak czasu planu',
      planned_minutes: 0,
    });
    expect(byId.set_missing_duration.task_preview[0].target_path).toContain('/zlecenia/31?');
    expect(byId.remind_not_started).toMatchObject({
      action_kind: 'remind_team_batch',
      primary_label: 'Przypomnij',
      task_ids: [34],
    });
    expect(byId.reason_dojazd).toMatchObject({
      title: 'Najczestszy powod strat: Dojazd',
      rationale: '4 wpisow w ostatnich dniach, srednia odchylka 30 min.',
      target_path: '/mapa-live',
    });
  });

  it('recommends fixing contact data and open issue blockers', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS') && text.includes('open_issues')) {
        expect(params).toEqual(['2026-05-26', 7]);
        return {
          rows: [
            {
              id: 51,
              numer: 'ARB-51',
              klient_nazwa: 'Brak kontaktu',
              klient_telefon: '',
              adres: '',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: null,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: 1,
              czas_obslugi_min: 60,
              ekipa_nazwa: null,
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 60,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
            {
              id: 52,
              numer: 'ARB-52',
              klient_nazwa: 'Problem przed startem',
              klient_telefon: '+48123456789',
              adres: 'Krakow 52',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Wysoki',
              data_planowana: '2026-05-26T09:00:00.000Z',
              ekipa_id: null,
              oddzial_id: 7,
              pin_lat: 50.2,
              pin_lng: 19.8,
              czas_planowany_godziny: 1,
              czas_obslugi_min: 60,
              ekipa_nazwa: null,
              oddzial_nazwa: 'Krakow',
              open_issues: 2,
              planned_minutes: 60,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM ops_action_events e') && text.includes('GROUP BY e.action_type')) {
        return { rows: [] };
      }
      if (text.includes("e.action_type = 'recommendation_feedback'")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-recommendations?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.recommendations.map((item) => [item.id, item]));
    expect(byId.fix_contact_blockers).toMatchObject({
      priority: 'medium',
      action_kind: 'open_tasks',
      primary_label: 'Napraw dane',
      task_ids: [51],
      title: '1 zlecen z brakami kontaktowymi',
    });
    expect(byId.fix_contact_blockers.target_path).toContain('field=klient_telefon');
    expect(byId.fix_contact_blockers.task_preview[0]).toMatchObject({
      id: 51,
      numer: 'ARB-51',
      blockers: ['phone', 'address'],
    });
    expect(byId.fix_contact_blockers.task_preview[0].target_path).toContain('field=klient_telefon');
    expect(byId.resolve_open_issues).toMatchObject({
      priority: 'medium',
      action_kind: 'open_tasks',
      primary_label: 'Zamknij problemy',
      task_ids: [52],
      title: '2 otwartych problemow blokuje dzien',
    });
    expect(byId.resolve_open_issues.target_path).toContain('tab=problemy');
    expect(byId.resolve_open_issues.task_preview[0]).toMatchObject({
      id: 52,
      numer: 'ARB-52',
      blockers: ['issue'],
    });
  });

  it('limits dispatch blocker recommendations to team and gps blockers only', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS') && text.includes('open_issues')) {
        expect(params).toEqual(['2026-05-26', 7]);
        return {
          rows: [
            {
              id: 61,
              numer: 'ARB-61',
              klient_nazwa: 'Dispatch blocker mieszany',
              klient_telefon: '+48123456789',
              adres: 'Krakow 61',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Pilny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: null,
              oddzial_id: 7,
              pin_lat: null,
              pin_lng: null,
              czas_planowany_godziny: 1,
              czas_obslugi_min: 60,
              ekipa_nazwa: null,
              oddzial_nazwa: 'Krakow',
              open_issues: 2,
              planned_minutes: 60,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM ops_action_events e') && text.includes('GROUP BY e.action_type')) {
        return { rows: [] };
      }
      if (text.includes("e.action_type = 'recommendation_feedback'")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-recommendations?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.recommendations.map((item) => [item.id, item]));
    expect(byId.fix_dispatch_blockers).toMatchObject({
      priority: 'medium',
      action_kind: 'fix_dispatch_blockers',
      task_ids: [61],
      title: '1 blokad wysylki ekip',
    });
    expect(byId.fix_dispatch_blockers.target_path).toContain('field=ekipa_id');
    expect(byId.fix_dispatch_blockers.target_path).not.toContain('tab=problemy');
    expect(byId.fix_dispatch_blockers.task_preview[0]).toMatchObject({
      id: 61,
      numer: 'ARB-61',
      blockers: ['team', 'gps'],
      issue_key: null,
      issue_label: null,
    });
    expect(byId.fix_dispatch_blockers.task_preview[0].target_path).toContain('field=ekipa_id');
    expect(byId.fix_dispatch_blockers.task_preview[0].target_path).not.toContain('tab=problemy');
  });

  it('hides recommendations dismissed for the selected day', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS') && text.includes('open_issues')) {
        expect(params).toEqual(['2026-05-26', 7]);
        return {
          rows: [
            {
              id: 41,
              numer: 'ARB-41',
              klient_nazwa: 'Bez czasu',
              klient_telefon: '+48111111111',
              adres: 'Krakow 1',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: 5,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM ops_action_events e') && text.includes('GROUP BY e.action_type')) {
        return { rows: [] };
      }
      if (text.includes("e.action_type = 'recommendation_feedback'")) {
        expect(params).toEqual(['2026-05-26', 7]);
        expect(text).toContain('DISTINCT ON');
        return {
          rows: [
            {
              recommendation_id: 'set_missing_duration',
              decision: 'dismissed',
              created_at: '2026-05-26T09:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-recommendations?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.hidden_today).toBe(1);
    expect(res.body.recommendations.map((item) => item.id)).not.toContain('set_missing_duration');
    expect(res.body.hidden_recommendations).toHaveLength(1);
    expect(res.body.hidden_recommendations[0]).toMatchObject({
      id: 'set_missing_duration',
      title: '1 zlecen bez czasu planu',
    });
    expect(res.body.hidden_recommendations[0].task_preview[0]).toMatchObject({
      id: 41,
      numer: 'ARB-41',
      issue_label: 'Brak czasu planu',
    });
  });

  it('keeps a recommendation visible when the latest feedback accepts it', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS') && text.includes('open_issues')) {
        expect(params).toEqual(['2026-05-26', 7]);
        return {
          rows: [
            {
              id: 42,
              numer: 'ARB-42',
              klient_nazwa: 'Bez czasu po akceptacji',
              klient_telefon: '+48111111111',
              adres: 'Krakow 2',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: 5,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM ops_action_events e') && text.includes('GROUP BY e.action_type')) {
        return { rows: [] };
      }
      if (text.includes("e.action_type = 'recommendation_feedback'")) {
        return {
          rows: [
            {
              recommendation_id: 'set_missing_duration',
              decision: 'dismissed',
              created_at: '2026-05-26T09:00:00.000Z',
            },
            {
              recommendation_id: 'set_missing_duration',
              decision: 'accepted',
              created_at: '2026-05-26T10:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-recommendations?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.hidden_today).toBe(0);
    expect(res.body.summary.accepted_today).toBe(0);
    expect(res.body.recommendations.map((item) => item.id)).toContain('set_missing_duration');
    expect(res.body.hidden_recommendations).toEqual([]);
  });

  it('marks a recommendation accepted today only when feedback source is action', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH planned AS') && text.includes('open_issues')) {
        expect(params).toEqual(['2026-05-26', 7]);
        return {
          rows: [
            {
              id: 43,
              numer: 'ARB-43',
              klient_nazwa: 'Bez czasu zaakceptowane',
              klient_telefon: '+48111111111',
              adres: 'Krakow 3',
              miasto: 'Krakow',
              status: 'Zaplanowane',
              priorytet: 'Normalny',
              data_planowana: '2026-05-26T08:00:00.000Z',
              ekipa_id: 5,
              oddzial_id: 7,
              pin_lat: 50.1,
              pin_lng: 19.9,
              czas_planowany_godziny: null,
              czas_obslugi_min: null,
              ekipa_nazwa: 'Ekipa A',
              oddzial_nazwa: 'Krakow',
              open_issues: 0,
              planned_minutes: 0,
              real_minutes: 0,
              logs_total: 0,
              has_started: false,
              has_finished: false,
            },
          ],
        };
      }
      if (text.includes('FROM ops_action_events e') && text.includes('GROUP BY e.action_type')) {
        return { rows: [] };
      }
      if (text.includes("e.action_type = 'recommendation_feedback'")) {
        expect(text).toContain("metadata->>'source'");
        return {
          rows: [
            {
              recommendation_id: 'set_missing_duration',
              decision: 'accepted',
              source: 'action',
              created_at: '2026-05-26T10:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ops/action-recommendations?date=2026-05-26')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.accepted_today).toBe(1);
    const accepted = res.body.recommendations.find((item) => item.id === 'set_missing_duration');
    expect(accepted).toMatchObject({
      accepted_today: true,
      feedback_decision: 'accepted',
      feedback_source: 'action',
    });
  });

  it('records recommendation feedback in the action memory', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('INSERT INTO ops_action_events')) {
        expect(params[0]).toBeNull();
        expect(params[1]).toBe(7);
        expect(params[2]).toBe(1);
        expect(params[3]).toBe('recommendation_feedback');
        expect(params[9]).toBe('Nie dzis');
        expect(JSON.parse(params[10])).toMatchObject({
          recommendation_id: 'set_missing_duration',
          decision: 'dismissed',
          source: 'hide',
          date: '2026-05-26',
        });
        return {
          rows: [{ id: 901, task_id: null, action_type: 'recommendation_feedback', created_at: '2026-05-26T12:00:00.000Z' }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/action-recommendations/set_missing_duration/feedback')
      .set('Authorization', `Bearer ${token()}`)
      .send({ date: '2026-05-26', decision: 'dismissed', note: 'Nie dzis' });

    expect(res.status).toBe(200);
    expect(res.body.feedback).toMatchObject({
      recommendation_id: 'set_missing_duration',
      decision: 'dismissed',
      source: 'hide',
      oddzial_id: 7,
    });
    expect(res.body.message).toBe('Rekomendacja ukryta na dzis');
  });

  it('applies a duration recommendation through one backend contract', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('WHERE t.id = ANY($1::int[])')) {
        expect(params).toEqual([[41, 42], 7]);
        expect(text).toContain('AND t.oddzial_id = $2');
        return {
          rows: [
            { id: 41, numer: 'ARB-41', klient_nazwa: 'Bez czasu A', oddzial_id: 7, ekipa_id: 5 },
            { id: 42, numer: 'ARB-42', klient_nazwa: 'Bez czasu B', oddzial_id: 7, ekipa_id: 5 },
          ],
        };
      }
      if (text.includes('SET czas_planowany_godziny = $1')) {
        expect(params[0]).toBe(1.5);
        expect(params[1]).toBe(90);
        expect(params[2]).toContain('Rekomendacja kierownika');
        return {
          rows: [{
            id: params[3],
            numer: `ARB-${params[3]}`,
            czas_planowany_godziny: '1.5',
            czas_obslugi_min: 90,
          }],
        };
      }
      if (text.includes('INSERT INTO ops_action_events')) {
        const metadata = JSON.parse(params[10]);
        if (params[3] === 'set_duration') {
          expect([41, 42]).toContain(params[0]);
          expect(params[1]).toBe(7);
          expect(params[4]).toBe('missing_duration');
          expect(params[7]).toBe(90);
          expect(metadata).toMatchObject({
            recommendation_id: 'set_missing_duration',
            source: 'recommendation_apply',
          });
          return { rows: [{ id: 950 + params[0], task_id: params[0], action_type: 'set_duration' }] };
        }
        expect(params[0]).toBeNull();
        expect(params[1]).toBe(7);
        expect(params[3]).toBe('recommendation_feedback');
        expect(metadata).toMatchObject({
          recommendation_id: 'set_missing_duration',
          decision: 'accepted',
          source: 'action',
          updated_count: 2,
        });
        return { rows: [{ id: 999, task_id: null, action_type: 'recommendation_feedback' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/action-recommendations/set_missing_duration/apply')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        date: '2026-05-26',
        action_kind: 'set_duration_batch',
        task_ids: [41, 42],
        suggested_minutes: 90,
        title: '2 zlecen bez czasu planu',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'Rekomendacja wykonana',
      recommendation_id: 'set_missing_duration',
      action_kind: 'set_duration_batch',
      oddzial_id: 7,
      notification_count: 0,
    });
    expect(res.body.updated_tasks).toHaveLength(2);
    expect(res.body.feedback_event).toMatchObject({ action_type: 'recommendation_feedback' });
  });

  it('applies dispatch blocker preflight by assigning a free team and creating a GPS checklist', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS ops_action_events') || text.includes('CREATE INDEX IF NOT EXISTS idx_ops_action_events')) {
        return { rows: [] };
      }
      if (text.includes('WHERE t.id = ANY($1::int[])')) {
        return {
          rows: [
            {
              id: 51,
              numer: 'ARB-51',
              klient_nazwa: 'Bez ekipy',
              klient_telefon: '500100200',
              adres: 'Krakow, Dobra 1',
              oddzial_id: 7,
              ekipa_id: null,
              data_planowana: '2026-05-26T08:00:00.000Z',
              pin_lat: 50.061,
              pin_lng: 19.938,
              czas_planowany_godziny: 2,
              czas_obslugi_min: 120,
            },
            {
              id: 52,
              numer: 'ARB-52',
              klient_nazwa: 'Bez GPS',
              klient_telefon: '500100201',
              adres: 'Krakow, Lesna 2',
              oddzial_id: 7,
              ekipa_id: 5,
              data_planowana: '2026-05-26T10:00:00.000Z',
              pin_lat: null,
              pin_lng: null,
              czas_planowany_godziny: 1,
              czas_obslugi_min: 60,
            },
          ],
        };
      }
      if (text.includes('FROM teams tm')) {
        return { rows: [{ id: 8, nazwa: 'Ekipa Wolna', oddzial_id: 7 }] };
      }
      if (text.includes('FROM tasks t') && text.includes('UNION ALL')) {
        return { rows: [] };
      }
      if (text.includes('SET ekipa_id = $1')) {
        return { rows: [{ id: 51, numer: 'ARB-51', ekipa_id: 8 }] };
      }
      if (text.includes('UPDATE equipment_reservations')) {
        return { rows: [] };
      }
      if (text.includes('SET notatki_wewnetrzne') && text.includes('RETURNING id, numer, pin_lat, pin_lng')) {
        return { rows: [{ id: 52, numer: 'ARB-52', pin_lat: null, pin_lng: null }] };
      }
      if (text.includes('INSERT INTO ops_action_events')) {
        const metadata = JSON.parse(params[10]);
        if (params[3] === 'dispatch_auto_assign_team') {
          expect(params[0]).toBe(51);
          expect(params[4]).toBe('team');
          expect(metadata).toMatchObject({
            recommendation_id: 'fix_dispatch_blockers',
            new_team_id: 8,
            source: 'recommendation_apply',
          });
          return { rows: [{ id: 1051, task_id: 51, action_type: 'dispatch_auto_assign_team' }] };
        }
        if (params[3] === 'dispatch_gps_checklist') {
          expect(params[0]).toBe(52);
          expect(params[4]).toBe('gps');
          expect(metadata).toMatchObject({
            recommendation_id: 'fix_dispatch_blockers',
            needs_manual_gps: true,
            zadarma_first: true,
          });
          return { rows: [{ id: 1052, task_id: 52, action_type: 'dispatch_gps_checklist' }] };
        }
        expect(params[3]).toBe('recommendation_feedback');
        expect(metadata).toMatchObject({
          recommendation_id: 'fix_dispatch_blockers',
          decision: 'accepted',
          action_kind: 'fix_dispatch_blockers',
          dispatch_preflight: {
            checked: 2,
            fixed_team_count: 1,
            gps_checklist_count: 1,
          },
        });
        return { rows: [{ id: 1099, task_id: null, action_type: 'recommendation_feedback' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/ops/action-recommendations/fix_dispatch_blockers/apply')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        date: '2026-05-26',
        action_kind: 'fix_dispatch_blockers',
        task_ids: [51, 52],
        title: '2 blokady wysylki ekip',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'Rekomendacja wykonana',
      recommendation_id: 'fix_dispatch_blockers',
      action_kind: 'fix_dispatch_blockers',
      dispatch_preflight: {
        checked: 2,
        ready: [51],
        fixed_team_count: 1,
        gps_checklist_count: 1,
      },
    });
    expect(res.body.dispatch_preflight.still_blocked).toEqual([
      expect.objectContaining({ task_id: 52, blockers: ['gps'] }),
    ]);
    expect(res.body.updated_tasks.map((task) => task.action)).toEqual(['assign_team', 'gps_checklist']);
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
