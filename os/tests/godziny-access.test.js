const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const godzinyRoutes = require('../src/routes/godziny');
const { env } = require('../src/config/env');
const { createTestApp } = require('./helpers/create-test-app');

describe('Godziny access policy', () => {
  const app = createTestApp('/api/godziny', godzinyRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function tokenFor(user) {
    return jwt.sign(user, env.JWT_SECRET);
  }

  test.each(['Pomocnik', 'Brygadzista', 'Specjalista']) (
    'blocks %s from reading every employee rate',
    async (rola) => {
      const res = await request(app)
        .get('/api/godziny/wszystkie')
        .set('Authorization', `Bearer ${tokenFor({ id: 10, rola, oddzial_id: 3 })}`);

      expect(res.status).toBe(403);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it('scopes a manager to their own branch', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/godziny/wszystkie')
      .set('Authorization', `Bearer ${tokenFor({ id: 11, rola: 'Kierownik', oddzial_id: 3 })}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE t.oddzial_id=$1'),
      [3],
    );
  });

  it('keeps global access for directors', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/godziny/wszystkie')
      .set('Authorization', `Bearer ${tokenFor({ id: 1, rola: 'Dyrektor' })}`);

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).not.toContain('WHERE t.oddzial_id=$1');
    expect(pool.query.mock.calls[0][1]).toEqual([]);
  });
});
