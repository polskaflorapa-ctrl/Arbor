const request = require('supertest');
const { createApp } = require('../src/app');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

describe('API — tylko polski', () => {
  const app = createApp();

  it('zwraca polski komunikat 404 niezależnie od Accept-Language', async () => {
    const res = await request(app).get('/api/unknown-route').set('Accept-Language', 'uk-UA,en;q=0.9');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint nie znaleziony');
    expect(res.body.code).toBe('HTTP_NOT_FOUND');
    expect(res.headers['content-language']).toBe('pl');
  });

  it('zwraca polski komunikat walidacji przy pustym body logowania', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Accept-Language', 'ru-RU,en;q=0.8')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.headers['content-language']).toBe('pl');
  });

  it('ignoruje ?lang= — nadal polski 404', async () => {
    const res = await request(app).get('/api/missing').query({ lang: 'uk' }).set('Accept-Language', 'ru');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint nie znaleziony');
    expect(res.body.code).toBe('HTTP_NOT_FOUND');
    expect(res.headers['content-language']).toBe('pl');
  });

  it('szczegóły Zod po polsku (pole login)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Accept-Language', 'uk')
      .send({ login: '', haslo: 'validpass12' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.headers['content-language']).toBe('pl');
    const loginIssue = res.body.details.find((d) => d.path === 'login');
    expect(loginIssue.message).toBe('Login jest wymagany');
  });
});
