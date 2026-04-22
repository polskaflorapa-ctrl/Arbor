const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const { createApp } = require('../src/app');

describe('Panel WWW /app/', () => {
  const app = createApp();

  it('GET /api/health dziala', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /app (bez slasha) zwraca index.html', async () => {
    const res = await request(app).get('/app');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ARBOR-OS');
    expect(res.text).toContain('jeden panel');
    expect(res.text).toContain('nav-group');
    expect(res.text).toContain('Szczegóły zlecenia');
    expect(res.text).toContain('wartość rzeczywistą');
  });

  it('GET /app/ zwraca index.html', async () => {
    const res = await request(app).get('/app/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('ARBOR-OS');
    expect(res.text).toMatch(/\/app\/styles\.css/);
    expect(res.text).toMatch(/\/app\/app\.js/);
  });

  it('GET /app/styles.css zwraca CSS', async () => {
    const res = await request(app).get('/app/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/css/);
    expect(res.text).toContain('--bg');
  });

  it('GET /app/app.js zwraca skrypt', async () => {
    const res = await request(app).get('/app/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('localStorage');
  });
});
