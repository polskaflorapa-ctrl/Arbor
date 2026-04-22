const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const tasksRoutes = require('../src/routes/tasks');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

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
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 501 }] })
      .mockResolvedValueOnce({ rows: [] });
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
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ work_log_id: 501 });
  });

  it('POST /tasks/:id/start allows kierownik without checklist fields', async () => {
    const token = jwt.sign({ id: 3, rola: 'Kierownik', oddzial_id: 5 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 502 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/tasks/1/start').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.work_log_id).toBe(502);
  });
});
