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
      { id: 1, rola: 'Administrator', oddzial_id: 5 },
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
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(insertCall?.[1]?.[8]).toBe('2026-05-10 09:30:00');
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
    expect(res.body).toEqual({
      items: [
        { id: 1, klient_nazwa: 'A' },
        { id: 2, klient_nazwa: 'B' },
      ],
      total: 2,
      limit: 10,
      offset: 0,
    });
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
      }],
    });

    const res = await request(app)
      .get('/api/tasks/moje?data=2026-05-13')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      id: 1,
      klient_nazwa: 'A',
      photo_total: 3,
      photo_wycena: 1,
      photo_szkic: 1,
      photo_dojazd: 1,
    }]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(ps.photo_total, 0)::int AS photo_total'),
      ['2026-05-13', 2]
    );
    const sql = String(pool.query.mock.calls[0][0]);
    expect(sql).toContain('photo_wycena');
    expect(sql).toContain('photo_szkic');
    expect(sql).toContain('photo_dojazd');
    expect(sql).toContain('FROM photos p');
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
    expect(res.body.message).toBe('Plan zaktualizowany');
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
