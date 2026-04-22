const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const pool = require('../src/config/database');
const { createApp } = require('../src/app');
const app = createApp();

describe('GET /api/ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ready when database responds', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ready',
        database: 'up',
      })
    );
    expect(typeof res.body.requestId).toBe('string');
  });

  it('returns 503 when database is unavailable', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/api/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'not_ready',
        database: 'down',
        error: 'Database unavailable',
      })
    );
    expect(typeof res.body.requestId).toBe('string');
  });
});
