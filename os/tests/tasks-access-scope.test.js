const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const tasksRoutes = require('../src/routes/tasks');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Task access scope policy', () => {
  const app = createTestApp('/api/tasks', tasksRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses assigned-team scope for brygadzista task list', async () => {
    const token = jwt.sign({ id: 55, rola: 'Brygadzista', oddzial_id: 3 }, env.JWT_SECRET);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/tasks/wszystkie')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1'),
      [55]
    );
  });

  it('allows sales director to read all task branches', async () => {
    const token = jwt.sign({ id: 12, rola: 'Dyrektor Sprzedazy', oddzial_id: 1 }, env.JWT_SECRET);
    pool.query.mockResolvedValue({ rows: [{ id: 1, oddzial_id: 2 }] });

    const res = await request(app)
      .get('/api/tasks/wszystkie')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.not.stringContaining('WHERE t.oddzial_id = $1'),
      []
    );
  });

  it('keeps specialist task list branch-scoped even when another branch is requested', async () => {
    const token = jwt.sign({ id: 91, rola: 'Specjalista', oddzial_id: 3 }, env.JWT_SECRET);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/tasks/wszystkie?oddzial_id=2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE t.oddzial_id = $1'),
      [3]
    );
  });

  it('blocks sales director from creating tasks', async () => {
    const token = jwt.sign({ id: 12, rola: 'Dyrektor Sprzedazy', oddzial_id: 1 }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/tasks/nowe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        klient_nazwa: 'Klient',
        adres: 'Testowa 1',
        miasto: 'Warszawa',
        data_planowana: '2026-05-12T08:00:00.000Z',
      });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('uses assigned-team scope for pomocnik stats', async () => {
    const token = jwt.sign({ id: 77, rola: 'Pomocnik', oddzial_id: 2 }, env.JWT_SECRET);
    pool.query.mockResolvedValue({ rows: [{ nowe: '0', w_realizacji: '1', zakonczone: '2' }] });

    const res = await request(app)
      .get('/api/tasks/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1'),
      [77]
    );
  });

  it('returns 403 when task is outside user scope', async () => {
    const token = jwt.sign({ id: 77, rola: 'Pomocnik', oddzial_id: 2 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [] }); // requireTaskAccess check

    const res = await request(app)
      .get('/api/tasks/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Brak uprawnien');
    expect(res.body.code).toBe('TASK_ACCESS_DENIED');
  });

  it('blocks assigned crew roles from pushing task data to Kommo', async () => {
    const token = jwt.sign({ id: 77, rola: 'Brygadzista', oddzial_id: 2 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 999 }] }); // requireTaskAccess passes

    const res = await request(app)
      .post('/api/tasks/999/kommo-push')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT id FROM tasks');
  });

  it('blocks assigned crew roles from retrying Kommo sync', async () => {
    const token = jwt.sign({ id: 77, rola: 'Pomocnik', oddzial_id: 2 }, env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 999 }] }); // requireTaskAccess passes

    const res = await request(app)
      .post('/api/tasks/999/kommo-retry')
      .set('Authorization', `Bearer ${token}`)
      .send({ force: true });

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT id FROM tasks');
  });
});
