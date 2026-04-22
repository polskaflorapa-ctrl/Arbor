const request = require('supertest');
const { createApp } = require('../src/app');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

describe('Error response contract', () => {
  const app = createApp();

  it('returns requestId on 404 responses', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint nie znaleziony');
    expect(res.body.code).toBe('HTTP_NOT_FOUND');
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
