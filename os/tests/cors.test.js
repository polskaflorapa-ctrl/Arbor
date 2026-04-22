const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

describe('CORS configuration', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('allows wildcard origin by default', async () => {
    process.env.CORS_ORIGINS = '*';
    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://random-origin.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://random-origin.example');
  });
});
