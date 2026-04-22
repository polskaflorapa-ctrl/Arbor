const request = require('supertest');
const jwt = require('jsonwebtoken');
const klienciRoutes = require('../src/routes/klienci');
const ogledzinyRoutes = require('../src/routes/ogledziny');
const raportyDzienneRoutes = require('../src/routes/raporty-dzienne');
const mobileRoutes = require('../src/routes/mobile');
const wycenyRoutes = require('../src/routes/wyceny');
const uzytkownicyRoutes = require('../src/routes/uzytkownicy');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Walidacja Zod — klienci', () => {
  const app = createTestApp('/api/klienci', klienciRoutes);

  it('POST bez telefonu i emaila → 400 VALIDATION_FAILED', async () => {
    const token = jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .post('/api/klienci')
      .set('Authorization', `Bearer ${token}`)
      .send({ imie: 'Jan' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const telIssue = res.body.details.find((d) => d.path === 'telefon');
    expect(telIssue.message).toBe('Podaj telefon lub email');
  });
});

describe('Walidacja Zod — oględziny', () => {
  const app = createTestApp('/api/ogledziny', ogledzinyRoutes);

  it('POST bez klient_id → 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .post('/api/ogledziny')
      .set('Authorization', `Bearer ${token}`)
      .send({ notatki: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('GET limit=0 → 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Brygadzista', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .get('/api/ogledziny?limit=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('Walidacja query — raporty dzienne', () => {
  const app = createTestApp('/api/raporty-dzienne', raportyDzienneRoutes);

  it('GET limit=0 → 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Brygadzista', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .get('/api/raporty-dzienne?limit=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('Walidacja — mobile faktury', () => {
  const app = createTestApp('/api/mobile', mobileRoutes);

  it('GET faktury limit>100 → 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .get('/api/mobile/faktury?limit=200')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('Walidacja — wyceny patch status', () => {
  const app = createTestApp('/api/wyceny', wycenyRoutes);

  it('PATCH status bez pola status → 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Brygadzista', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .patch('/api/wyceny/1/status')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('Walidacja — użytkownik aktywny', () => {
  const app = createTestApp('/api/uzytkownicy', uzytkownicyRoutes);

  it('PUT aktywny z niepoprawnym typem → 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .put('/api/uzytkownicy/5/aktywny')
      .set('Authorization', `Bearer ${token}`)
      .send({ aktywny: 'tak' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
