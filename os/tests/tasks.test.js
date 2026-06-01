const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/services/smsGateway', () => ({
  sendSmsGateway: jest.fn(),
}));

const pool = require('../src/config/database');
const { sendSmsGateway } = require('../src/services/smsGateway');
const tasksRoutes = require('../src/routes/tasks');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');
const { translateVars } = require('../src/i18n');
const { CASH_COLLECTION_NOTE_PCT } = require('../src/services/taskSettlement');

describe('Tasks routes', () => {
  const app = createTestApp('/api/tasks', tasksRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'zadarma', sid: 'sms-test' });
  });

  it('blocks stats endpoint without authorization', async () => {
    const res = await request(app).get('/api/tasks/stats');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Brak tokenu autoryzacji');
    expect(res.body.code).toBe('AUTH_MISSING_TOKEN');
    expect(typeof res.body.requestId).toBe('string');
  });

  it('returns branch-scoped stats for kierownik role', async () => {
    const token = jwt.sign(
      { id: 2, rola: 'Kierownik', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValue({
      rows: [{ nowe: '1', w_realizacji: '2', zakonczone: '3' }],
    });

    const res = await request(app)
      .get('/api/tasks/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nowe: '1', w_realizacji: '2', zakonczone: '3' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE t.oddzial_id = $1'),
      [5]
    );
  });

  it('returns team-scoped stats for brygadzista role', async () => {
    const token = jwt.sign(
      { id: 2, rola: 'Brygadzista', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValue({
      rows: [{ nowe: '1', w_realizacji: '0', zakonczone: '0' }],
    });

    const res = await request(app)
      .get('/api/tasks/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1'),
      [2]
    );
  });

  it('returns global stats for director roles', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Dyrektor', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValue({
      rows: [{ nowe: '4', w_realizacji: '5', zakonczone: '6' }],
    });

    const res = await request(app)
      .get('/api/tasks/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nowe: '4', w_realizacji: '5', zakonczone: '6' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM tasks'),
      []
    );
  });

  it('filters task list by planned date range', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Dyrektor', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/tasks/wszystkie?from=2026-06-01&to=2026-06-30')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('t.data_planowana::date >= $1::date'),
      ['2026-06-01', '2026-06-30']
    );
    expect(pool.query.mock.calls[0][0]).toContain('t.data_planowana::date <= $2::date');
  });

  it('rejects invalid payload for creating task', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );

    const res = await request(app)
      .post('/api/tasks/nowe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        klient_nazwa: '',
        adres: '',
        miasto: '',
        data_planowana: '',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(typeof res.body.requestId).toBe('string');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST /tasks/:id/time-window-proposals creates a public client decision link', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    const previousPublicBaseUrl = env.PUBLIC_BASE_URL;
    env.PUBLIC_BASE_URL = 'https://arbor.test';
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT t.*, b.telefon AS oddzial_telefon')) {
        return { rows: [{ id: 12, status: 'Do_Zatwierdzenia', klient_nazwa: 'Jan Test', klient_telefon: '+48123123123', typ_uslugi: 'Wycinka', oddzial_id: 5 }] };
      }
      if (s.includes('UPDATE task_time_window_proposals')) return { rows: [] };
      if (s.includes('INSERT INTO task_time_window_proposals')) {
        return {
          rows: [{
            id: 44,
            task_id: 12,
            token: 'client_time_token_1234567890',
            proposed_date: '2026-06-03',
            okno_od: '08:00:00',
            okno_do: '11:00:00',
            status: 'pending',
            note: 'Rano najlepiej',
            expires_at: null,
            created_at: '2026-05-29T10:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/tasks/12/time-window-proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        proposed_date: '2026-06-03',
        okno_od: '08:00',
        okno_do: '11:00',
        note: 'Rano najlepiej',
      });
    env.PUBLIC_BASE_URL = previousPublicBaseUrl;

    expect(res.status).toBe(201);
    expect(res.body.proposal).toMatchObject({
      id: 44,
      task_id: 12,
      okno_od: '08:00',
      okno_do: '11:00',
      status: 'pending',
      url: 'https://arbor.test/api/tasks/time-window/client_time_token_1234567890',
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes("status = 'superseded'"))).toBe(true);
  });

  it('POST /tasks/:id/time-window-proposals can send the proposal link by SMS', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    const previousPublicBaseUrl = env.PUBLIC_BASE_URL;
    env.PUBLIC_BASE_URL = 'https://arbor.test';
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT t.*, b.telefon AS oddzial_telefon')) {
        return {
          rows: [{
            id: 12,
            status: 'Do_Zatwierdzenia',
            klient_nazwa: 'Jan Test',
            klient_telefon: '+48123123123',
            typ_uslugi: 'Wycinka',
            oddzial_id: 5,
            oddzial_telefon: '+4822123123',
            oddzial_nazwa: 'Warszawa',
          }],
        };
      }
      if (s.includes('UPDATE task_time_window_proposals')) return { rows: [] };
      if (s.includes('INSERT INTO task_time_window_proposals')) {
        return {
          rows: [{
            id: 45,
            task_id: 12,
            token: 'client_time_token_sms_1234567890',
            proposed_date: '2026-06-03',
            okno_od: '09:00:00',
            okno_do: '12:00:00',
            status: 'pending',
            note: null,
            expires_at: null,
            created_at: '2026-05-29T10:00:00.000Z',
          }],
        };
      }
      if (s.includes('FROM sms_status_templates')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/tasks/12/time-window-proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        proposed_date: '2026-06-03',
        okno_od: '09:00',
        okno_do: '12:00',
        send_sms: true,
      });
    env.PUBLIC_BASE_URL = previousPublicBaseUrl;

    expect(res.status).toBe(201);
    expect(res.body.sms).toMatchObject({ ok: true, provider: 'zadarma' });
    expect(sendSmsGateway).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48123123123',
      taskId: 12,
      oddzialId: 5,
    }));
    expect(sendSmsGateway.mock.calls[0][0].body).toContain('https://arbor.test/api/tasks/time-window/client_time_token_sms_1234567890');
  });

  it('GET /tasks/:id/time-window-proposals returns history with SMS delivery diagnostics', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    const previousPublicBaseUrl = env.PUBLIC_BASE_URL;
    env.PUBLIC_BASE_URL = 'https://arbor.test';
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('FROM task_time_window_proposals p') && s.includes('LEFT JOIN LATERAL')) {
        return {
          rows: [{
            id: 45,
            task_id: 12,
            token: 'client_time_token_sms_1234567890',
            proposed_date: '2026-06-03',
            okno_od: '09:00:00',
            okno_do: '12:00:00',
            status: 'accepted',
            note: 'Propozycja',
            client_note: 'Pasuje',
            proposed_by_login: 'anna',
            created_at: '2026-05-29T10:00:00.000Z',
            updated_at: '2026-05-29T10:10:00.000Z',
            decided_at: '2026-05-29T10:10:00.000Z',
            expires_at: null,
            sms_status: 'Wyslany',
            sms_provider: 'zadarma',
            sms_provider_status: 'delivered',
            sms_delivery_error_code: null,
            sms_delivery_updated_at: '2026-05-29T10:01:00.000Z',
            sms_delivered_at: '2026-05-29T10:01:00.000Z',
            sms_created_at: '2026-05-29T10:00:02.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/tasks/12/time-window-proposals')
      .set('Authorization', `Bearer ${token}`);
    env.PUBLIC_BASE_URL = previousPublicBaseUrl;

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: 45,
      task_id: 12,
      url: 'https://arbor.test/api/tasks/time-window/client_time_token_sms_1234567890',
      okno_od: '09:00',
      okno_do: '12:00',
      status: 'accepted',
      effective_status: 'accepted',
      client_note: 'Pasuje',
      sms: {
        provider: 'zadarma',
        provider_status: 'delivered',
        delivered_at: '2026-05-29T10:01:00.000Z',
      },
    });
  });

  it('GET /tasks/time-window/:token returns safe public proposal details', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('FROM task_time_window_proposals p') && s.includes('LEFT JOIN branches')) {
        return {
          rows: [{
            id: 44,
            task_id: 12,
            proposed_date: '2026-06-03',
            okno_od: '08:00:00',
            okno_do: '11:00:00',
            status: 'pending',
            note: 'Rano najlepiej',
            client_note: null,
            expires_at: null,
            created_at: '2026-05-29T10:00:00.000Z',
            decided_at: null,
            klient_nazwa: 'Jan Test',
            adres: 'Lesna 4',
            miasto: 'Warszawa',
            typ_uslugi: 'Wycinka',
            task_status: 'Do_Zatwierdzenia',
            oddzial_nazwa: 'Warszawa',
            oddzial_telefon: '+4822123123',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app).get('/api/tasks/time-window/client_time_token_1234567890');

    expect(res.status).toBe(200);
    expect(res.body.proposal).toMatchObject({ task_id: 12, okno_od: '08:00', okno_do: '11:00', status: 'pending' });
    expect(res.body.task).toMatchObject({ service: 'Wycinka', address: 'Lesna 4, Warszawa', client_name: 'Jan Test' });
    expect(res.body.task).not.toHaveProperty('klient_telefon');
  });

  it('POST /tasks/time-window/:token/decision accepts proposal and writes task window', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('FROM task_time_window_proposals p') && s.includes('JOIN tasks t')) {
        return {
          rows: [{
            id: 44,
            task_id: 12,
            token: 'client_time_token_1234567890',
            proposed_date: '2026-06-03',
            okno_od: '08:00:00',
            okno_do: '11:00:00',
            status: 'pending',
            task_status: 'Do_Zatwierdzenia',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/tasks/time-window/client_time_token_1234567890/decision')
      .send({ decision: 'accepted', client_note: 'Pasuje' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', task_id: 12, proposed_date: '2026-06-03', okno_od: '08:00', okno_do: '11:00' });
    const taskUpdate = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE tasks') && String(sql).includes('okno_od = $2::time'));
    expect(taskUpdate?.[1]).toEqual(['2026-06-03 08:00:00', '08:00', '11:00', 12]);
  });

  it('creates task with explicit start hour and checks team load ranges', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('INSERT INTO tasks')) return { rows: [{ id: 42 }] };
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 5, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('FROM wyceny')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/tasks/nowe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        klient_nazwa: 'Jan Kowalski',
        adres: 'Testowa 1',
        miasto: 'Krakow',
        data_planowana: '2026-05-10',
        godzina_rozpoczecia: '09:30',
        czas_planowany_godziny: 2,
        oddzial_id: 5,
        ekipa_id: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
    expect(res.body.status).toBe('Nowe');
    expect(res.body.workflow_stage).toBe('intake');
    expect(res.body.workflow_next_status).toBe('Wycena_Terenowa');
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS numer'))).toBe(true);
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(insertCall?.[1]).toContain('2026-05-10 09:30:00');
  });

  it('returns 409 when creating task conflicts with another task on the same team', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('INSERT INTO tasks')) return { rows: [{ id: 42 }] };
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 5, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) {
        return { rows: [{ data_planowana: '2026-05-10T09:00:00.000Z', czas_h: 2 }] };
      }
      if (s.includes('FROM wyceny')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/tasks/nowe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        klient_nazwa: 'Jan Kowalski',
        adres: 'Testowa 1',
        miasto: 'Krakow',
        data_planowana: '2026-05-10',
        godzina_rozpoczecia: '09:30',
        czas_planowany_godziny: 2,
        oddzial_id: 5,
        ekipa_id: 5,
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_PLAN_CONFLICT');
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO tasks'))).toBe(false);
  });

  it('rejects invalid status update', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );

    const res = await request(app)
      .put('/api/tasks/12/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INVALID' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects invalid client contact status', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );

    const res = await request(app)
      .patch('/api/tasks/12/client-contact')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'sent-but-unknown' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('lists closure decision events without routing closure-events as a task id', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('FROM task_closure_decision_events e')) {
        return {
          rows: [{
            id: 7,
            task_id: 12,
            action: 'blocked_attempt',
            severity: 'danger',
            status_before: 'Zaplanowane',
            status_after: '',
            blockers: [{ key: 'clientPhone', label: 'Brak telefonu' }],
            warnings: [],
            risk_score: 40,
            quality_score: 60,
            value: '1500.00',
            note: 'Test',
            created_at: '2026-05-20T08:00:00.000Z',
            created_by: 1,
            actor: 'Anna Kowalska',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/tasks/closure-events')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events['12'][0].action).toBe('blocked_attempt');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM task_closure_decision_events e'),
      []
    );
  });

  it('records closure decision events for a task', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('INSERT INTO task_closure_decision_events')) {
        return {
          rows: [{
            id: 8,
            task_id: Number(params[0]),
            action: params[1],
            severity: params[2],
            status_before: params[3],
            status_after: params[4],
            blockers: JSON.parse(params[5]),
            warnings: JSON.parse(params[6]),
            risk_score: params[7],
            quality_score: params[8],
            value: params[9],
            note: params[10],
            created_by: params[11],
            created_at: '2026-05-20T08:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/tasks/12/closure-events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'blocked_attempt',
        severity: 'danger',
        status_before: 'Zaplanowane',
        blockers: [{ key: 'clientPhone', label: 'Brak telefonu' }],
        risk_score: 40,
        quality_score: 60,
        value: 1500,
        note: 'Test',
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(8);
    expect(res.body.task_id).toBe(12);
    expect(res.body.blockers[0].key).toBe('clientPhone');
  });

  it('rejects stop without work_log_id', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );

    const res = await request(app)
      .post('/api/tasks/12/stop')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: 52.2, lng: 21.0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects team stop without GPS before touching work logs', async () => {
    const token = jwt.sign(
      { id: 2, rola: 'Brygadzista', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValueOnce({ rows: [{ id: 12 }] });

    const res = await request(app)
      .post('/api/tasks/12/stop')
      .set('Authorization', `Bearer ${token}`)
      .send({ work_log_id: 501 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.error).toBe('Dla ekipy w terenie wymagane sa wspolrzedne GPS (lat, lng) przy rozpoczeciu zlecenia');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects stop for missing active work log', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT id, end_time FROM work_logs')) return { rows: [] };
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/12/stop')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: 52.2, lng: 21.0, work_log_id: 501 });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('TASK_WORK_LOG_NOT_FOUND');
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE work_logs'), expect.any(Array));
    expect(release).toHaveBeenCalled();
  });

  it('rejects duplicate stop for already closed work log', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT id, end_time FROM work_logs')) {
        return { rows: [{ id: 501, end_time: '2026-06-01T08:00:00.000Z' }] };
      }
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/12/stop')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: 52.2, lng: 21.0, work_log_id: 501 });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('TASK_WORK_LOG_ALREADY_STOPPED');
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE work_logs'), expect.any(Array));
    expect(release).toHaveBeenCalled();
  });

  it('stores stop GPS and closes task date for active work log', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT id, end_time FROM work_logs')) return { rows: [{ id: 501, end_time: null }] };
      if (s.includes('UPDATE work_logs')) return { rows: [] };
      if (s.includes("UPDATE tasks SET status = 'Zakonczone'")) return { rows: [] };
      if (s.includes('INSERT INTO task_public_status_events')) return { rows: [{ id: 1 }] };
      if (s.includes('COMMIT')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/12/stop')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: 52.2, lng: 21.0, work_log_id: 501 });

    expect(res.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE work_logs SET end_time = NOW()'),
      [52.2, 21, 501]
    );
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes('data_zakonczenia'))).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it('rejects invalid task id in params', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );

    const res = await request(app)
      .get('/api/tasks/abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects invalid oddzial_id query', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );

    const res = await request(app)
      .get('/api/tasks/wszystkie?oddzial_id=abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns paginated shape when limit is set', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query
      .mockResolvedValueOnce({ rows: [{ c: 2 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, klient_nazwa: 'A' }, { id: 2, klient_nazwa: 'B' }],
      });

    const res = await request(app)
      .get('/api/tasks/wszystkie?limit=10&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: [
        expect.objectContaining({ id: 1, klient_nazwa: 'A', workflow_stage: 'intake' }),
        expect.objectContaining({ id: 2, klient_nazwa: 'B', workflow_stage: 'intake' }),
      ],
      total: 2,
      limit: 10,
      offset: 0,
    });
    expect(res.body.items[0].workflow_missing_labels).toContain('telefon klienta');
  });

  it('decorates task lists with central office and crew readiness', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 44,
        status: 'Zaplanowane',
        klient_nazwa: 'Klient Test',
        klient_telefon: '+48123123123',
        adres: 'Lesna 10',
        miasto: 'Krakow',
        data_planowana: '2026-06-01T08:00:00.000Z',
        opis_pracy: 'Zakres prac: przycinka korony',
        notatki_wewnetrzne: 'Ryzyka: brak szczegolnych ryzyk',
        wartosc_planowana: 2500,
        czas_planowany_godziny: 4,
        ekipa_id: 7,
        ekipa_nazwa: 'Ekipa Zielona',
        photo_wycena: 1,
        photo_szkic: 1,
        photo_dojazd: 1,
        equipment_reserved_count: 1,
        equipment_reserved_names: 'Rebak',
      }],
    });

    const res = await request(app)
      .get('/api/tasks/wszystkie')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 44,
        office_plan_ready: true,
        office_plan_ready_count: 6,
        office_plan_total_count: 6,
        office_plan_missing_labels: [],
        crew_execution_ready: true,
        crew_execution_ready_count: 8,
        crew_execution_total_count: 8,
        crew_execution_missing_labels: [],
      }),
    ]);
    expect(res.body[0].office_plan_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'photos', ready: true }),
        expect.objectContaining({ key: 'money_time', ready: true }),
        expect.objectContaining({ key: 'equipment', ready: true }),
      ])
    );
  });

  it('GET /tasks/moje returns field evidence photo counters for crew', async () => {
    const token = jwt.sign(
      { id: 2, rola: 'Brygadzista', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        klient_nazwa: 'A',
        photo_total: 3,
        photo_wycena: 1,
        photo_szkic: 1,
        photo_dojazd: 1,
        problem_total: 2,
        problem_open: 1,
      }],
    });

    const res = await request(app)
      .get('/api/tasks/moje?data=2026-05-13')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 1,
        klient_nazwa: 'A',
        photo_total: 3,
        photo_wycena: 1,
        photo_szkic: 1,
        photo_dojazd: 1,
        problem_total: 2,
        problem_open: 1,
        workflow_stage: 'intake',
      }),
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(ps.photo_total, 0)::int AS photo_total'),
      ['2026-05-13', 2]
    );
    const sql = String(pool.query.mock.calls[0][0]);
    expect(sql).toContain('photo_wycena');
    expect(sql).toContain('photo_szkic');
    expect(sql).toContain('photo_dojazd');
    expect(sql).toContain('FROM photos p');
    expect(sql).toContain('COALESCE(ia.problem_open, 0)::int AS problem_open');
    expect(sql).toContain('FROM issues');
  });

  it('PUT /tasks/:id/field-package returns decorated workflow with fresh photo counters', async () => {
    const token = jwt.sign(
      { id: 7, rola: 'Wyceniajacy', oddzial_id: 5 },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('ALTER TABLE tasks')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, wyceniajacy_id, notatki_wewnetrzne')) {
        return { rows: [{ id: 12, status: 'Wycena_Terenowa', wyceniajacy_id: 7, notatki_wewnetrzne: '' }] };
      }
      if (s.includes('UPDATE tasks') && s.includes('RETURNING id, status')) {
        return { rows: [{ id: 12, status: 'Do_Zatwierdzenia' }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'Do_Zatwierdzenia',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: 'Przycinka korony',
            wartosc_planowana: 1500,
            czas_planowany_godziny: 3,
            ekipa_id: null,
            photo_total: 3,
            photo_wycena: 1,
            photo_szkic: 1,
            photo_dojazd: 1,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/field-package')
      .set('Authorization', `Bearer ${token}`)
      .send({
        zakres_prac: 'Przycinka korony',
        czas_planowany_godziny: 3,
        wartosc_planowana: 1500,
        klient_zaakceptowal: true,
        send_to_office: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Do_Zatwierdzenia');
    expect(res.body.workflow_stage).toBe('officeApproval');
    expect(res.body.workflow_missing_labels).toContain('ekipa');
    expect(res.body.workflow_missing_labels).not.toContain('zdjecie ogolne / wycena');
    expect(res.body.workflow_missing_labels).not.toContain('szkic zakresu');
  });

  it('PUT /tasks/:id/office-plan returns crew-ready workflow after assigning team and slot', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, oddzial_id, notatki_wewnetrzne')) {
        return { rows: [{ id: 12, status: 'Do_Zatwierdzenia', oddzial_id: 5, notatki_wewnetrzne: 'PRZEKAZANIE DO BIURA' }] };
      }
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 9, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('FROM wyceny') && s.includes('status_akceptacji')) return { rows: [] };
      if (s.includes('UPDATE tasks') && s.includes('RETURNING id, status')) {
        return { rows: [{ id: 12, status: 'Zaplanowane' }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: 'Przycinka korony',
            notatki_wewnetrzne: 'Ryzyka: brak szczegolnych. Sprzet: bez dodatkowego sprzetu.',
            wartosc_planowana: 1500,
            czas_planowany_godziny: 3,
            ekipa_id: 9,
            ekipa_nazwa: 'Ekipa A',
            photo_total: 3,
            photo_wycena: 1,
            photo_szkic: 1,
            photo_dojazd: 1,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/office-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data_planowana: '2026-06-01',
        godzina_rozpoczecia: '08:00',
        czas_planowany_godziny: 3,
        ekipa_id: 9,
        sprzet_notatka: 'bez dodatkowego sprzetu',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Zaplanowane');
    expect(res.body.workflow_stage).toBe('crewReady');
    expect(res.body.workflow_ready_for_next).toBe(true);
    expect(res.body.workflow_next_status).toBe('W_Realizacji');
    expect(res.body.workflow_missing_labels).not.toContain('ekipa');
    const updateCall = pool.query.mock.calls.find(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE tasks') && s.includes('notatki_wewnetrzne = $4');
    });
    const savedNotes = String(updateCall?.[1]?.[3] || '');
    expect(savedNotes).toContain('PLAN BIURA / PAKIET DLA EKIPY');
    expect(savedNotes).toContain('Klient: A');
    expect(savedNotes).toContain('Zakres z terenu: Przycinka korony');
    expect(savedNotes).toContain('Ekipa: Ekipa A (#9)');
    expect(savedNotes).toContain('Sprzet: bez dodatkowego sprzetu');
  });

  it('PUT /tasks/:id/office-plan blocks planning outside accepted client window', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, oddzial_id, notatki_wewnetrzne')) {
        return {
          rows: [{
            id: 12,
            status: 'Do_Zatwierdzenia',
            oddzial_id: 5,
            notatki_wewnetrzne: '',
            okno_od: '08:00:00',
            okno_do: '11:00:00',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/office-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data_planowana: '2026-06-01',
        godzina_rozpoczecia: '12:00',
        czas_planowany_godziny: 2,
        ekipa_id: 9,
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_CLIENT_TIME_WINDOW_CONFLICT');
    expect(res.body).toMatchObject({ okno_od: '08:00', okno_do: '11:00', start: '12:00' });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
  });

  it('PUT /tasks/:id/office-plan blocks an absent crew without manager override', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, oddzial_id, notatki_wewnetrzne')) {
        return { rows: [{ id: 12, status: 'Do_Zatwierdzenia', oddzial_id: 5, notatki_wewnetrzne: '' }] };
      }
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 9, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Auto w serwisie',
            actor_name: 'Anna Planer',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/office-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data_planowana: '2026-06-01',
        godzina_rozpoczecia: '08:00',
        czas_planowany_godziny: 3,
        ekipa_id: 9,
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_ABSENT');
    expect(res.body.attendance).toMatchObject({
      teamId: '9',
      teamName: 'Ekipa A',
      present: false,
      note: 'Auto w serwisie',
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
  });

  it('PUT /tasks/:id/office-plan allows absent crew with override and records note', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, oddzial_id, notatki_wewnetrzne')) {
        return { rows: [{ id: 12, status: 'Do_Zatwierdzenia', oddzial_id: 5, notatki_wewnetrzne: '' }] };
      }
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 9, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Auto w serwisie',
            actor_name: 'Anna Planer',
          }],
        };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('FROM wyceny') && s.includes('status_akceptacji')) return { rows: [] };
      if (s.includes('UPDATE tasks') && s.includes('RETURNING id, status')) {
        return { rows: [{ id: 12, status: 'Zaplanowane' }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: 'Przycinka korony',
            notatki_wewnetrzne: 'Ryzyka: brak szczegolnych.',
            wartosc_planowana: 1500,
            czas_planowany_godziny: 3,
            ekipa_id: 9,
            ekipa_nazwa: 'Ekipa A',
            photo_total: 3,
            photo_wycena: 1,
            photo_szkic: 1,
            photo_dojazd: 1,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/office-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data_planowana: '2026-06-01',
        godzina_rozpoczecia: '08:00',
        czas_planowany_godziny: 3,
        ekipa_id: 9,
        sprzet_notatka: 'bez dodatkowego sprzetu',
        absence_override: true,
      });

    expect(res.status).toBe(200);
    const updateCall = pool.query.mock.calls.find(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE tasks') && s.includes('notatki_wewnetrzne = $4');
    });
    const savedNotes = String(updateCall?.[1]?.[3] || '');
    expect(savedNotes).toContain('Kierownik potwierdzil plan mimo nieobecnosci ekipy: Auto w serwisie');
  });

  it('PUT /tasks/:id/przypisz returns decorated crew-ready workflow', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, oddzial_id, data_planowana') && s.includes('notatki_wewnetrzne FROM tasks')) {
        return {
          rows: [{
            id: 12,
            oddzial_id: 5,
            data_planowana: '2026-06-01T08:00:00.000Z',
            czas_planowany_godziny: 3,
            status: 'Do_Zatwierdzenia',
            notatki_wewnetrzne: '',
          }],
        };
      }
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 9, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('FROM wyceny') && s.includes('status_akceptacji')) return { rows: [] };
      if (s.includes('UPDATE tasks') && s.includes('RETURNING id, status')) {
        return { rows: [{ id: 12, status: 'Zaplanowane' }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: 'Przycinka korony',
            notatki_wewnetrzne: 'Ryzyka: brak szczegolnych',
            wartosc_planowana: 1500,
            czas_planowany_godziny: 3,
            ekipa_id: 9,
            ekipa_nazwa: 'Ekipa A',
            photo_total: 3,
            photo_wycena: 1,
            photo_szkic: 1,
            photo_dojazd: 1,
            equipment_reserved_count: 1,
            equipment_reserved_names: 'Rebak',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/przypisz')
      .set('Authorization', `Bearer ${token}`)
      .send({ ekipa_id: 9 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Zaplanowane');
    expect(res.body.workflow_stage).toBe('crewReady');
    expect(res.body.workflow_ready_for_next).toBe(true);
    expect(res.body.workflow_next_status).toBe('W_Realizacji');
    expect(res.body.workflow_missing_labels).not.toContain('ekipa');
  });

  it('PUT /tasks/:id/przypisz allows an absent crew with manager override', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('ALTER TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, oddzial_id, data_planowana, czas_planowany_godziny, status, notatki_wewnetrzne FROM tasks')) {
        return {
          rows: [{
            id: 12,
            oddzial_id: 5,
            data_planowana: '2026-06-01T08:00:00.000Z',
            czas_planowany_godziny: 3,
            status: 'Do_Zatwierdzenia',
            notatki_wewnetrzne: 'Dotychczasowe notatki',
          }],
        };
      }
      if (s.includes('FROM teams t') && s.includes('has_delegation')) {
        return { rows: [{ id: 9, nazwa: 'Ekipa A', oddzial_id: 5, has_delegation: false }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Auto w serwisie',
            actor_name: 'Anna Planer',
          }],
        };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('FROM wyceny') && s.includes('status_akceptacji')) return { rows: [] };
      if (s.includes('UPDATE tasks') && s.includes('RETURNING id, status')) {
        return { rows: [{ id: 12, status: 'Zaplanowane' }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: 'Przycinka korony',
            notatki_wewnetrzne: 'Ryzyka: brak szczegolnych',
            wartosc_planowana: 1500,
            czas_planowany_godziny: 3,
            ekipa_id: 9,
            ekipa_nazwa: 'Ekipa A',
            photo_total: 3,
            photo_wycena: 1,
            photo_szkic: 1,
            photo_dojazd: 1,
            equipment_reserved_count: 1,
            equipment_reserved_names: 'Rebak',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12/przypisz')
      .set('Authorization', `Bearer ${token}`)
      .send({ ekipa_id: 9, absence_override: true });

    expect(res.status).toBe(200);
    const updateCall = pool.query.mock.calls.find(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE tasks') && s.includes('notatki_wewnetrzne = COALESCE');
    });
    const savedNotes = String(updateCall?.[1]?.[3] || '');
    expect(savedNotes).toContain('Dotychczasowe notatki');
    expect(savedNotes).toContain('Kierownik potwierdzil przypisanie mimo nieobecnosci ekipy: Auto w serwisie');
  });

  it('PUT /tasks/:id blocks absent crew assignment through generic update without override', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5, login: 'admin' },
      env.JWT_SECRET
    );
    const body = {
      klient_nazwa: 'A',
      klient_telefon: '+48123123123',
      klient_email: '',
      adres: 'Testowa 1',
      miasto: 'Krakow',
      typ_uslugi: 'Pielęgnacja',
      priorytet: 'Normalny',
      wartosc_planowana: 1500,
      czas_planowany_godziny: 3,
      data_planowana: '2026-06-01T08:00:00.000Z',
      godzina_rozpoczecia: '08:00',
      notatki_wewnetrzne: 'Dotychczasowe notatki',
      notatki: '',
      opis: 'Przycinka korony',
      opis_pracy: 'Przycinka korony',
      notatki_klienta: '',
      oddzial_id: null,
      ekipa_id: 9,
      status: 'Zaplanowane',
    };
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('ALTER TABLE') || s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT * FROM tasks WHERE id = $1')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            oddzial_id: null,
            ekipa_id: null,
            data_planowana: '2026-06-01T08:00:00.000Z',
            notatki_wewnetrzne: 'Dotychczasowe notatki',
          }],
        };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Urlop brygadzisty',
            actor_name: 'Anna Planer',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_ABSENT');
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks SET'))).toBe(false);
  });

  it('PUT /tasks/:id allows absent crew through generic update with override and records note', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5, login: 'admin' },
      env.JWT_SECRET
    );
    const body = {
      klient_nazwa: 'A',
      klient_telefon: '+48123123123',
      klient_email: '',
      adres: 'Testowa 1',
      miasto: 'Krakow',
      typ_uslugi: 'Pielęgnacja',
      priorytet: 'Normalny',
      wartosc_planowana: 1500,
      czas_planowany_godziny: 3,
      data_planowana: '2026-06-01T08:00:00.000Z',
      godzina_rozpoczecia: '08:00',
      notatki_wewnetrzne: 'Dotychczasowe notatki',
      notatki: '',
      opis: 'Przycinka korony',
      opis_pracy: 'Przycinka korony',
      notatki_klienta: '',
      oddzial_id: null,
      ekipa_id: 9,
      status: 'Zaplanowane',
      absence_override: true,
    };
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('ALTER TABLE') || s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT * FROM tasks WHERE id = $1')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            oddzial_id: null,
            ekipa_id: null,
            data_planowana: '2026-06-01T08:00:00.000Z',
            notatki_wewnetrzne: 'Dotychczasowe notatki',
          }],
        };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Urlop brygadzisty',
            actor_name: 'Anna Planer',
          }],
        };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('UPDATE tasks SET')) {
        return { rows: [{ id: 12, status: 'Zaplanowane', ...body }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return { rows: [{ id: 12, status: 'Zaplanowane', ...body }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/tasks/12')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(200);
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE tasks SET'));
    const savedNotes = String(updateCall?.[1]?.[11] || '');
    expect(savedNotes).toContain('Dotychczasowe notatki');
    expect(savedNotes).toContain('Kierownik potwierdzil aktualizacje zlecenia mimo nieobecnosci ekipy: Urlop brygadzisty');
    expect(savedNotes).toContain('Operator: admin');
  });

  it('PUT /tasks/:id/status returns decorated execution workflow', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5, login: 'admin' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT t.ekipa_id, e.brygadzista_id')) {
        return { rows: [{ ekipa_id: 9, brygadzista_id: 2 }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'W_Realizacji',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: 'Przycinka korony',
            notatki_wewnetrzne: 'Ryzyka: brak szczegolnych',
            wartosc_planowana: 1500,
            czas_planowany_godziny: 3,
            ekipa_id: 9,
            ekipa_nazwa: 'Ekipa A',
            photo_total: 3,
            photo_wycena: 1,
            photo_szkic: 1,
            photo_dojazd: 1,
            equipment_reserved_count: 1,
            equipment_reserved_names: 'Rebak',
          }],
        };
      }
      return { rows: [] };
    });
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT status, oddzial_id FROM tasks')) {
        return { rows: [{ status: 'Zaplanowane', oddzial_id: 5 }] };
      }
      if (s.includes('UPDATE tasks SET status')) return { rows: [] };
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    const release = jest.fn();
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .put('/api/tasks/12/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'W_Realizacji' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('W_Realizacji');
    expect(res.body.workflow_stage).toBe('execution');
    expect(res.body.workflow_ready_for_next).toBe(true);
    expect(res.body.workflow_next_status).toBe('Zakonczone');
    expect(clientQuery).toHaveBeenCalledWith(
      'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2',
      ['W_Realizacji', 12]
    );
    expect(release).toHaveBeenCalled();
  });

  it('PUT /tasks/:id/status blocks next stage when field package is incomplete', async () => {
    const token = jwt.sign(
      { id: 1, rola: 'Administrator', oddzial_id: 5, login: 'admin' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        return {
          rows: [{
            id: 12,
            status: 'Wycena_Terenowa',
            klient_nazwa: 'A',
            klient_telefon: '+48123123123',
            adres: 'Testowa 1',
            data_planowana: '2026-06-01T08:00:00.000Z',
            opis_pracy: '',
            wartosc_planowana: null,
            czas_planowany_godziny: null,
            photo_total: 0,
            photo_wycena: 0,
            photo_szkic: 0,
            photo_dojazd: 0,
          }],
        };
      }
      return { rows: [] };
    });
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT status, oddzial_id FROM tasks')) {
        return { rows: [{ status: 'Wycena_Terenowa', oddzial_id: 5 }] };
      }
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    const release = jest.fn();
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .put('/api/tasks/12/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Do_Zatwierdzenia' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_WORKFLOW_BLOCKED');
    expect(res.body.missing_labels).toEqual(expect.arrayContaining([
      'opis / zakres prac',
      'zdjecie ogolne / wycena',
      'szkic zakresu',
      'cena / budzet',
      'czas pracy',
    ]));
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQuery).not.toHaveBeenCalledWith(
      'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2',
      expect.any(Array)
    );
    expect(release).toHaveBeenCalled();
  });

  it('POST /tasks/:id/start returns 400 for brygadzista without checklist', async () => {
    const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await request(app)
      .post('/api/tasks/1/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: 52.1, lng: 21.0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('POST /tasks/:id/checkin stores zero-minute GPS marker for brygadzista', async () => {
    const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO work_logs')) return { rows: [{ id: 701 }] };
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/1/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: 52.1, lng: 21.0 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Check-in zapisany', checkin_id: 701 });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO work_logs'),
      [1, 2, 52.1, 21.0]
    );
    expect(release).toHaveBeenCalled();
  });

  it('POST /tasks/:id/start returns 200 for brygadzista with GPS and checklist', async () => {
    const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO work_logs')) return { rows: [{ id: 501 }] };
      if (s.includes('UPDATE tasks SET status')) return { rows: [] };
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });
    const res = await request(app)
      .post('/api/tasks/1/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lat: 52.1,
        lng: 21.0,
        dmuchawa_filtr_ok: true,
        rebak_zatankowany: true,
        kaski_zespol: true,
        bhp_potwierdzone: true,
        bhp_checklista: [
          { key: 'ppe', label: 'Kaski i ochrona osobista', done: true },
          { key: 'zone', label: 'Strefa pracy zabezpieczona', done: true },
          { key: 'tools', label: 'Sprzet sprawdzony przed startem', done: true },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ work_log_id: 501 });
  });

  it('POST /tasks/:id/start rejects duplicate active work log', async () => {
    const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT status FROM tasks')) return { rows: [{ status: 'W_Realizacji' }] };
      if (s.includes('SELECT id, user_id, start_time FROM work_logs')) {
        return { rows: [{ id: 501, user_id: 2, start_time: '2026-06-01T08:00:00.000Z' }] };
      }
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/1/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lat: 52.1,
        lng: 21.0,
        dmuchawa_filtr_ok: true,
        rebak_zatankowany: true,
        kaski_zespol: true,
        bhp_potwierdzone: true,
        bhp_checklista: [{ key: 'ppe', label: 'Kaski', done: true }],
      });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('TASK_WORK_LOG_ACTIVE');
    expect(res.body.work_log_id).toBe(501);
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO work_logs'), expect.any(Array));
    expect(release).toHaveBeenCalled();
  });

  it('POST /tasks/:id/start rejects closed task status', async () => {
    const token = jwt.sign({ id: 3, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('SELECT status FROM tasks')) return { rows: [{ status: 'Zakonczone' }] };
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/1/start')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('TASK_NOT_STARTABLE');
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO work_logs'), expect.any(Array));
    expect(release).toHaveBeenCalled();
  });

  it('POST /tasks/:id/start allows kierownik without checklist fields', async () => {
    const token = jwt.sign({ id: 3, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO work_logs')) return { rows: [{ id: 502 }] };
      if (s.includes('UPDATE tasks SET status')) return { rows: [] };
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });
    const res = await request(app).post('/api/tasks/1/start').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.work_log_id).toBe(502);
  });

  it('POST /tasks/:id/finish returns 400 when TASK_FINISH_REQUIRE_PO_PHOTO=1 and no Po photo', async () => {
    const prevPo = process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    const prevMat = process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    process.env.TASK_FINISH_REQUIRE_PO_PHOTO = '1';
    delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    try {
      const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
      pool.query.mockResolvedValueOnce({ rows: [{ id: 99 }] });

      const clientQuery = jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('BEGIN')) return {};
        if (s.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 99,
                status: 'W_Realizacji',
                wartosc_planowana: 100,
                wartosc_rzeczywista: null,
                wyceniajacy_id: null,
              },
            ],
          };
        }
        if (s.includes('FROM photos')) return { rows: [] };
        if (s.includes('ROLLBACK')) return {};
        return { rows: [] };
      });
      pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

      const res = await request(app)
        .post('/api/tasks/99/finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 10, faktura_vat: false },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_FINISH_PO_PHOTO_REQUIRED');
      expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining('ROLLBACK'));
    } finally {
      if (prevPo === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO = prevPo;
      if (prevMat === undefined) delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
      else process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = prevMat;
    }
  });

  it('POST /tasks/:id/finish returns 400 when only TASK_FINISH_REQUIRE_PRZED_PHOTO=1 and no Przed photo', async () => {
    const prevPo = process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    const prevPrzed = process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    const prevMat = process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO = '1';
    delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    try {
      const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
      pool.query.mockResolvedValueOnce({ rows: [{ id: 98 }] });

      const clientQuery = jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('BEGIN')) return {};
        if (s.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 98,
                status: 'W_Realizacji',
                wartosc_planowana: 100,
                wartosc_rzeczywista: null,
                wyceniajacy_id: null,
              },
            ],
          };
        }
        if (s.includes('FROM photos')) return { rows: [] };
        if (s.includes('ROLLBACK')) return {};
        return { rows: [] };
      });
      pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

      const res = await request(app)
        .post('/api/tasks/98/finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 10, faktura_vat: false },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_FINISH_PRZED_PHOTO_REQUIRED');
      expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining('ROLLBACK'));
    } finally {
      if (prevPo === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO = prevPo;
      if (prevPrzed === undefined) delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO = prevPrzed;
      if (prevMat === undefined) delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
      else process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = prevMat;
    }
  });

  it('POST /tasks/:id/finish enforces Po photo only for configured branch', async () => {
    const prevPo = process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    const prevPoBranches = process.env.TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES;
    const prevPrzed = process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    const prevMat = process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    process.env.TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES = '5,7';
    delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    try {
      const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
      pool.query.mockResolvedValueOnce({ rows: [{ id: 97 }] });

      const clientQuery = jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('BEGIN')) return {};
        if (s.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 97,
                oddzial_id: 5,
                status: 'W_Realizacji',
                wartosc_planowana: 100,
                wartosc_rzeczywista: null,
                wyceniajacy_id: null,
              },
            ],
          };
        }
        if (s.includes('FROM photos')) return { rows: [] };
        if (s.includes('ROLLBACK')) return {};
        return { rows: [] };
      });
      pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

      const res = await request(app)
        .post('/api/tasks/97/finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 10, faktura_vat: false },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_FINISH_PO_PHOTO_REQUIRED');
    } finally {
      if (prevPo === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO = prevPo;
      if (prevPoBranches === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES = prevPoBranches;
      if (prevPrzed === undefined) delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO = prevPrzed;
      if (prevMat === undefined) delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
      else process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = prevMat;
    }
  });

  it('POST /tasks/:id/problemy accepts payload like /problem', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO api_idempotency_log')) return { rows: [{ idempotency_key: 'problem-1' }] };
      if (s.includes('INSERT INTO issues')) return { rows: [] };
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release: jest.fn() });
    const res = await request(app)
      .post('/api/tasks/1/problemy')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'problem-1')
      .send({ typ: 'usterka', opis: 'Brama zastawiona' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Problem zgloszony');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO issues (task_id, user_id, typ, opis, data_zgloszenia)'),
      [1, 1, 'Awaria_Sprzetu', 'Brama zastawiona']
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('RETURNING idempotency_key'),
      expect.any(Array)
    );
  });

  it('POST /tasks/:id/problemy notifies branch managers and returns issue metadata', async () => {
    const token = jwt.sign({ id: 8, rola: 'Brygadzista', oddzial_id: 5, ekipa_id: 3 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 44, oddzial_id: 5, ekipa_id: 3 }] });
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO api_idempotency_log')) return { rows: [{ idempotency_key: 'problem-notify-1' }] };
      if (s.includes('INSERT INTO issues')) {
        return {
          rows: [{
            id: 501,
            task_id: 44,
            typ: 'Brak_Dostepu',
            opis: 'Brama zamknieta',
            status: 'Zgloszony',
            data_zgloszenia: '2026-06-01T08:00:00.000Z',
          }],
        };
      }
      if (s.includes('SELECT id, numer, oddzial_id')) {
        return { rows: [{ id: 44, numer: 'ZLE-44', oddzial_id: 5 }] };
      }
      if (s.includes('INSERT INTO notifications')) {
        return {
          rows: [
            { id: 700, to_user_id: 2, typ: 'Problem', tresc: 'Nowy problem w zleceniu ZLE-44', task_id: 44, status: 'Nowe' },
          ],
        };
      }
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release: jest.fn() });

    const res = await request(app)
      .post('/api/tasks/44/problemy')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'problem-notify-1')
      .send({ typ: 'brak_dostepu', opis: 'Brama zamknieta' });

    expect(res.status).toBe(200);
    expect(res.body.issue).toMatchObject({ id: 501, typ: 'Brak_Dostepu' });
    expect(res.body.notifications_created).toBe(1);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notifications'),
      [8, 44, expect.stringContaining('Brak_Dostepu'), 5]
    );
  });

  it('POST /tasks/:id/zdjecia skips duplicate offline photo replay', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO api_idempotency_log')) return { rows: [] };
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .post('/api/tasks/1/zdjecia')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'offline-photo-retry-1')
      .field('typ', 'Przed')
      .attach('zdjecie', Buffer.from('fake-image'), {
        filename: 'retry.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Zdjecie dodane',
      sciezka: null,
      idempotent_replay: true,
    });
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO photos'))).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('RETURNING idempotency_key'),
      ['offline-photo-retry-1', 'task:1:photo']
    );
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining('ROLLBACK'));
    expect(release).toHaveBeenCalled();
  });

  it('POST /tasks/:id/finish returns 400 when TASK_FINISH_REQUIRE_MATERIAL_USAGE=1 and empty zuzyte_materialy', async () => {
    const prevPo = process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    const prevMat = process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = '1';
    try {
      const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
      pool.query.mockResolvedValueOnce({ rows: [{ id: 88 }] });

      const clientQuery = jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('BEGIN')) return {};
        if (s.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 88,
                status: 'W_Realizacji',
                wartosc_planowana: 50,
                wartosc_rzeczywista: null,
                wyceniajacy_id: null,
              },
            ],
          };
        }
        if (s.includes('ROLLBACK')) return {};
        return { rows: [] };
      });
      pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

      const res = await request(app)
        .post('/api/tasks/88/finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 5, faktura_vat: false },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_FINISH_MATERIAL_USAGE_REQUIRED');
    } finally {
      if (prevPo === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO = prevPo;
      if (prevMat === undefined) delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
      else process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = prevMat;
    }
  });

  it('POST /tasks/:id/finish persists zuzyte_materialy and koszty_operacyjne for mobile finish', async () => {
    const prevPo = process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    const prevPrzed = process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    const prevMat = process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    try {
      const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
      pool.query.mockResolvedValueOnce({ rows: [{ id: 99 }] });

      const clientQuery = jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('BEGIN')) return {};
        if (s.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 99,
                status: 'W_Realizacji',
                oddzial_id: 5,
                wartosc_planowana: 100,
                wartosc_rzeczywista: null,
                wyceniajacy_id: null,
              },
            ],
          };
        }
        if (s.includes('work_logs') && s.includes('end_time IS NULL')) {
          return { rows: [{ id: 909 }] };
        }
        if (s.includes('COMMIT')) return {};
        if (s.includes('ROLLBACK')) return {};
        return { rows: [] };
      });
      pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

      const res = await request(app)
        .post('/api/tasks/99/finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 100, faktura_vat: false },
          zuzyte_materialy: [
            { nazwa: 'Olej do pilarki', ilosc: 2, jednostka: 'szt', koszt_laczny: 80 },
          ],
          koszty_operacyjne: [
            { category: 'paliwo', amount: 45.5, label: 'Paliwo', source: 'mobile_finish' },
            { category: 'utylizacja', amount: 120, label: 'Utylizacja', source: 'mobile_finish' },
          ],
        });

      expect(res.status).toBe(200);
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO task_finish_material_usage'),
        [99, 2, 'Olej do pilarki', 2, 'szt', null, 80, null]
      );
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO task_operational_costs'),
        [99, 2, 'paliwo', 'Paliwo', 45.5, 'mobile_finish', null]
      );
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO task_operational_costs'),
        [99, 2, 'utylizacja', 'Utylizacja', 120, 'mobile_finish', null]
      );
      expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
    } finally {
      if (prevPo === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO = prevPo;
      if (prevPrzed === undefined) delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO = prevPrzed;
      if (prevMat === undefined) delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
      else process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = prevMat;
    }
  });

  it('POST /tasks/:id/finish returns 400 PAYMENT_NOTE_REQUIRED_OVER_5_PCT when cash differs >5% from gross without note (ekipa)', async () => {
    const prevPo = process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    const prevPrzed = process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    const prevMat = process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
    delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
    delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
    try {
      const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
      pool.query.mockResolvedValueOnce({ rows: [{ id: 77 }] });

      const clientQuery = jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('BEGIN')) return {};
        if (s.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 77,
                status: 'W_Realizacji',
                wartosc_planowana: 100,
                wartosc_rzeczywista: null,
                wyceniajacy_id: null,
              },
            ],
          };
        }
        if (s.includes('work_logs') && s.includes('end_time IS NULL')) {
          return { rows: [{ id: 901 }] };
        }
        if (s.includes('ROLLBACK')) return {};
        return { rows: [] };
      });
      pool.connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

      const res = await request(app)
        .post('/api/tasks/77/finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 106, faktura_vat: false },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PAYMENT_NOTE_REQUIRED_OVER_5_PCT');
      expect(typeof res.body.requestId).toBe('string');
      expect(res.body.error).toBe(
        translateVars('pl', 'errors.tasks.paymentNoteRequiredOverPct', { pct: CASH_COLLECTION_NOTE_PCT })
      );
      expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining('ROLLBACK'));
    } finally {
      if (prevPo === undefined) delete process.env.TASK_FINISH_REQUIRE_PO_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PO_PHOTO = prevPo;
      if (prevPrzed === undefined) delete process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO;
      else process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO = prevPrzed;
      if (prevMat === undefined) delete process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE;
      else process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE = prevMat;
    }
  });

  it('rejects PATCH /tasks/:id/plan for brygadzista', async () => {
    const token = jwt.sign({ id: 2, rola: 'Brygadzista', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T08:00:00.000Z' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kierownik|dyrektor/i);
  });

  it('updates planned datetime via PATCH /tasks/:id/plan for kierownik', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: null, czas_planowany_godziny: 2 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/^Plan zaktualizowany/);
  });

  it('updates planned datetime and team via PATCH /tasks/:id/plan for kierownik', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 1 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return { rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: null, oddzial_id: null, czas_planowany_godziny: 2 }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return { rows: [{ team_id: 9, team_name: 'Ekipa A', present: true }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z', ekipa_id: 9 });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/^Plan zaktualizowany/);
    const updateCall = pool.query.mock.calls.find(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE tasks') && s.includes('godzina_rozpoczecia = COALESCE($5::time');
    });
    expect(updateCall?.[1]).toEqual(['2026-05-10T09:00:00.000Z', 9, 1, null, null]);
    pool.query.mockReset();
  });

  it('updates planned datetime, start hour and team via PATCH /tasks/:id/plan for DnD', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 1 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return { rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: 5, oddzial_id: null, czas_planowany_godziny: 2, data_planowana: '2026-05-09T08:00:00.000Z' }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return { rows: [{ team_id: 9, team_name: 'Ekipa A', present: true }] };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10', godzina_rozpoczecia: '11:30', ekipa_id: 9 });

    expect(res.status).toBe(200);
    const updateCall = pool.query.mock.calls.find(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE tasks') && s.includes('godzina_rozpoczecia = COALESCE($5::time');
    });
    expect(updateCall?.[1]).toEqual(['2026-05-10 11:30:00', 9, 1, null, '11:30']);
    pool.query.mockReset();
  });

  it('blocks PATCH /tasks/:id/plan outside accepted client window', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 1 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return { rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: null, oddzial_id: null, czas_planowany_godziny: 2 }] };
      }
      if (s.includes('SELECT okno_od, okno_do FROM tasks')) {
        return { rows: [{ okno_od: '08:00:00', okno_do: '11:00:00' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T12:00:00.000Z', ekipa_id: 9 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_CLIENT_TIME_WINDOW_CONFLICT');
    expect(res.body).toMatchObject({ okno_od: '08:00', okno_do: '11:00', start: '14:00' });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
    pool.query.mockReset();
  });

  it('blocks PATCH /tasks/:id/plan for absent crew without manager override', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            ekipa_id: null,
            oddzial_id: null,
            czas_planowany_godziny: 2,
            data_planowana: null,
          }],
        };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Urlop brygadzisty',
            actor_name: 'Anna Planer',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/12/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-06-01T08:00:00.000Z', ekipa_id: 9 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_ABSENT');
    expect(res.body.attendance).toMatchObject({
      teamId: '9',
      teamName: 'Ekipa A',
      present: false,
      note: 'Urlop brygadzisty',
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
    pool.query.mockReset();
  });

  it('allows PATCH /tasks/:id/plan for absent crew with manager override and records note', async () => {
    const token = jwt.sign(
      { id: 3, rola: 'Kierownik', oddzial_id: 5, login: 'anna' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 12 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return {
          rows: [{
            id: 12,
            status: 'Zaplanowane',
            ekipa_id: null,
            oddzial_id: null,
            czas_planowany_godziny: 2,
            data_planowana: '2026-05-31T08:00:00.000Z',
          }],
        };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return {
          rows: [{
            team_id: 9,
            team_name: 'Ekipa A',
            present: false,
            note: 'Urlop brygadzisty',
            actor_name: 'Anna Planer',
          }],
        };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) return { rows: [] };
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/12/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-06-01T08:00:00.000Z', ekipa_id: 9, absence_override: true });

    expect(res.status).toBe(200);
    const updateCall = pool.query.mock.calls.find(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE tasks') && s.includes('notatki_wewnetrzne = CASE');
    });
    const savedNotes = String(updateCall?.[1]?.[3] || '');
    expect(savedNotes).toContain('WYJATEK PLANOWANIA EKIPY');
    expect(savedNotes).toContain('Kierownik potwierdzil przesuniecie mimo nieobecnosci ekipy: Urlop brygadzisty');
    expect(savedNotes).toContain('Operator: anna');
    pool.query.mockReset();
  });

  it('promotes task to Zaplanowane when PATCH /tasks/:id/plan completes office package', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    let workflowFetches = 0;
    const plannedRow = {
      id: 1,
      status: 'Do_Zatwierdzenia',
      klient_nazwa: 'Jan Nowak',
      klient_telefon: '500000000',
      adres: 'Lesna 1',
      miasto: 'Krakow',
      opis_pracy: 'Przycinka koron',
      wartosc_planowana: 1200,
      czas_planowany_godziny: 2,
      data_planowana: '2026-05-10T09:00:00.000Z',
      ekipa_id: 9,
      ekipa_nazwa: 'Ekipa A',
      photo_total: 3,
      photo_wycena: 1,
      photo_szkic: 1,
      photo_dojazd: 1,
      equipment_reserved_count: 1,
      equipment_reserved_names: 'Rebak',
    };
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 1 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return { rows: [{ id: 1, status: 'Do_Zatwierdzenia', ekipa_id: null, oddzial_id: null, czas_planowany_godziny: 2 }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return { rows: [{ team_id: 9, team_name: 'Ekipa A', present: true }] };
      }
      if (s.includes('COALESCE(ps.photo_total, 0)::int AS photo_total')) {
        workflowFetches += 1;
        return { rows: [workflowFetches === 1 ? plannedRow : { ...plannedRow, status: 'Zaplanowane' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z', ekipa_id: 9 });

    expect(res.status).toBe(200);
    expect(res.body.plan_promoted).toBe(true);
    expect(res.body.status).toBe('Zaplanowane');
    expect(res.body.office_plan_ready).toBe(true);
    expect(res.body.message).toMatch(/gotowe dla ekipy/i);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tasks SET status = 'Zaplanowane'"),
      [1]
    );
    pool.query.mockReset();
  });

  it('blocks PATCH /tasks/:id/plan when task is finished', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 1 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return { rows: [{ id: 1, status: 'Zakonczone' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zakończonego|anulowanego/i);
  });

  it('returns 409 when PATCH /tasks/:id/plan conflicts with another task on the same team', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT id FROM tasks t WHERE')) return { rows: [{ id: 1 }] };
      if (s.includes('SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks')) {
        return { rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: 5, oddzial_id: null, czas_planowany_godziny: 2 }] };
      }
      if (s.includes('LEFT JOIN team_attendance')) {
        return { rows: [{ team_id: 5, team_name: 'Ekipa A', present: true }] };
      }
      if (s.includes('FROM tasks') && s.includes('data_planowana::date')) {
        return { rows: [{ data_planowana: '2026-05-10T09:00:00.000Z', czas_h: 2 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_PLAN_CONFLICT');
    expect(res.body.error).toMatch(/Konflikt terminu/i);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
    pool.query.mockReset();
  });

  it('GET /tasks/:id/client-signature returns saved signature data', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT id FROM tasks')) return { rows: [{ id: 1 }] };
      if (s.includes('FROM task_client_signatures')) {
        return {
          rows: [
            {
              task_id: 1,
              signer_name: 'Jan Kowalski',
              signature_data_url: 'data:image/svg+xml;base64,AAA',
              signed_at: '2026-05-10T09:15:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/tasks/1/client-signature')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.task_id).toBe(1);
    expect(res.body.signer_name).toBe('Jan Kowalski');
  });

  it('PUT /tasks/:id/client-signature upserts signature', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const release = jest.fn();
    const clientQuery = jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('BEGIN')) return {};
      if (s.includes('INSERT INTO task_client_signatures')) {
        return {
          rows: [
            {
              task_id: 1,
              signer_name: 'Anna Nowak',
              signed_at: '2026-05-10T09:25:00.000Z',
            },
          ],
        };
      }
      if (s.includes('COMMIT')) return {};
      if (s.includes('ROLLBACK')) return {};
      return { rows: [] };
    });
    pool.connect.mockResolvedValueOnce({ query: clientQuery, release });

    const res = await request(app)
      .put('/api/tasks/1/client-signature')
      .set('Authorization', `Bearer ${token}`)
      .send({
        signer_name: 'Anna Nowak',
        signature_data_url: 'data:image/svg+xml;base64,AAA',
      });

    expect(res.status).toBe(200);
    expect(res.body.signer_name).toBe('Anna Nowak');
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO task_client_signatures'), expect.any(Array));
    expect(release).toHaveBeenCalled();
  });

  it('GET /tasks/:id/protokol-link returns temporary PDF access path', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await request(app)
      .get('/api/tasks/1/protokol-link')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.path).toBe('string');
    expect(res.body.path).toContain('/api/pdf/zlecenie/1?access_token=');
    expect(res.body.expires_in_sec).toBe(600);
  });
});
