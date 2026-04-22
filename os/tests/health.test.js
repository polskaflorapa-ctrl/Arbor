const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const { createApp } = require('../src/app');
const app = createApp();

describe('GET /api/health', () => {
  it('returns service status payload', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        wersja: '2.1.0',
      })
    );
    expect(typeof res.body.czas).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
    expect(typeof res.headers['x-request-id']).toBe('string');
  });
});
