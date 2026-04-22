const request = require('supertest');
const { createApp } = require('../src/app');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

describe('OpenAPI docs', () => {
  const app = createApp();

  it('serves openapi.yaml', async () => {
    const res = await request(app).get('/api/docs/openapi.yaml');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
    expect(res.text).toContain('openapi:');
    expect(res.text).toContain('ARBOR-OS API');
    expect(res.text).toContain('components/schemas');
    expect(res.text).toContain('KlientWrite');
    expect(res.text).toContain('CompanySettingsWrite');
    expect(res.text).toContain('/ksiegowosc/ustawienia:');
    expect(res.text).toContain('/mobile/ustawienia:');
    expect(res.text).toContain('TaskCreate:');
    expect(res.text).toContain('/pdf/zlecenie/{id}:');
    expect(res.text).toContain('/sms/wyslij:');
    expect(res.text).toContain('/telefon/polacz-do-klienta:');
    expect(res.text).toContain('/telefon/rozmowy:');
  });
});
