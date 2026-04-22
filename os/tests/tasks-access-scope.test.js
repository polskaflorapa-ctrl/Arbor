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
});
