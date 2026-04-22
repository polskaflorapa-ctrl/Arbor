const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const rozliczeniaRoutes = require('../src/routes/rozliczenia');
const ekipyRoutes = require('../src/routes/ekipy');
const { createApp } = require('../src/app');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Access policy routes', () => {
  const rozliczeniaApp = createTestApp('/api/rozliczenia', rozliczeniaRoutes);
  const ekipyApp = createTestApp('/api/ekipy', ekipyRoutes);
  const app = createApp();

  it('blocks payouts module for administrator role', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator' }, env.JWT_SECRET);

    const res = await request(rozliczeniaApp)
      .get('/api/rozliczenia/zadanie/1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Podglad rozliczen wyplat jest zablokowany');
    expect(res.body.code).toBe('PAYROLL_SETTLEMENTS_BLOCKED');
  });

  it('blocks team settlement read endpoint for all roles', async () => {
    const token = jwt.sign({ id: 9, rola: 'Brygadzista' }, env.JWT_SECRET);

    const res = await request(ekipyApp)
      .get('/api/ekipy/rozliczenie/10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Podglad rozliczen wyplat jest zablokowany');
    expect(res.body.code).toBe('PAYROLL_SETTLEMENTS_BLOCKED');
  });

  it('blocks team settlement write endpoint for manager role', async () => {
    const token = jwt.sign({ id: 8, rola: 'Kierownik' }, env.JWT_SECRET);

    const res = await request(ekipyApp)
      .post('/api/ekipy/rozliczenie/10')
      .set('Authorization', `Bearer ${token}`)
      .send({ wartosc_brutto: 1234 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Podglad rozliczen wyplat jest zablokowany');
    expect(res.body.code).toBe('PAYROLL_SETTLEMENTS_BLOCKED');
  });

  it('blocks payroll paths at app mount level', async () => {
    const token = jwt.sign({ id: 3, rola: 'Administrator' }, env.JWT_SECRET);
    const res = await request(app)
      .get('/api/ekipy/rozliczenie/123')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Podglad rozliczen wyplat jest zablokowany');
    expect(res.body.code).toBe('PAYROLL_SETTLEMENTS_BLOCKED');
    expect(typeof res.body.requestId).toBe('string');
  });
});
