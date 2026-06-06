const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const ORIGINAL_ENV = { ...process.env };

describe('CORS configuration', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('allows wildcard origin by default', async () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = '*';
    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://random-origin.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://random-origin.example');
  });

  it('rejects wildcard origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-test-secret';
    process.env.CORS_ORIGINS = '*';

    expect(() => {
      const { createApp } = require('../src/app');
      createApp();
    }).toThrow(/CORS_ORIGINS must be set to explicit origins/);
  });

  it('allows explicit production CORS origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-test-secret';
    process.env.CORS_ORIGINS = 'https://panel.example.com';

    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://panel.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://panel.example.com');
  });
});
