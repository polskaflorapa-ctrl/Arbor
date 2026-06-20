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
        wersja: '2.2.0-quotations',
        features: expect.objectContaining({
          quotations: true,
          quotationPanels: true,
          quotationApprovals: true,
        }),
      })
    );
    expect(typeof res.body.czas).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
    expect(typeof res.headers['x-request-id']).toBe('string');
  });
});

describe('GET /api/mobile-config', () => {
  it('returns API version and mobile feature flags on both aliases', async () => {
    for (const path of ['/api/mobile-config', '/api/config/mobile']) {
      const res = await request(app).get(path);

      expect(res.status).toBe(200);
      expect(res.headers['x-api-version']).toBe('2.2.0-quotations');
      expect(res.body).toEqual(
        expect.objectContaining({
          version: '2.2.0-quotations',
          apiVersion: '2.2.0-quotations',
          appFlags: expect.objectContaining({
            quotations: true,
            quotationPanels: true,
            quotationApprovals: true,
            quotationPublicAcceptance: true,
          }),
          oddzialFeatureOverrides: {},
        })
      );
      expect(typeof res.body.generatedAt).toBe('string');
    }
  });
});
