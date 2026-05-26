const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const tasksRoutes = require('../src/routes/tasks');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');
const { translateVars } = require('../src/i18n');
const { CASH_COLLECTION_NOTE_PCT } = require('../src/services/taskSettlement');

describe('Tasks routes', () => {
  const app = createTestApp('/api/tasks', tasksRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
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
      if (s.includes('SELECT id, oddzial_id, data_planowana, czas_planowany_godziny, status FROM tasks')) {
        return {
          rows: [{
            id: 12,
            oddzial_id: 5,
            data_planowana: '2026-06-01T08:00:00.000Z',
            czas_planowany_godziny: 3,
            status: 'Do_Zatwierdzenia',
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
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: null, oddzial_id: null, czas_planowany_godziny: 2 }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z', ekipa_id: 9 });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/^Plan zaktualizowany/);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tasks SET data_planowana = $1::timestamptz, ekipa_id = $2'),
      ['2026-05-10T09:00:00.000Z', 9, 1]
    );
  });

  it('promotes task to Zaplanowane when PATCH /tasks/:id/plan completes office package', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
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
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'Do_Zatwierdzenia', ekipa_id: null, oddzial_id: null, czas_planowany_godziny: 2 }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plannedRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...plannedRow, status: 'Zaplanowane' }] });

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
  });

  it('blocks PATCH /tasks/:id/plan when task is finished', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'Zakonczone' }] });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zakończonego|anulowanego/i);
  });

  it('returns 409 when PATCH /tasks/:id/plan conflicts with another task on the same team', async () => {
    const token = jwt.sign({ id: 2, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'Zaplanowane', ekipa_id: 5, czas_planowany_godziny: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ data_planowana: '2026-05-10T09:00:00.000Z', czas_h: 2 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/tasks/1/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ data_planowana: '2026-05-10T09:00:00.000Z' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TASK_PLAN_CONFLICT');
    expect(res.body.error).toMatch(/Konflikt terminu/i);
    expect(pool.query).toHaveBeenCalledTimes(4);
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
