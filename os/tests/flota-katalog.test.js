const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const flotaRoutes = require('../src/routes/flota');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Flota katalog pojazdow', () => {
  const app = createTestApp('/api/flota', flotaRoutes);

  const token = () =>
    jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 1 }, env.JWT_SECRET, { expiresIn: '1h' });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/flota/katalog-pojazdow');
    expect(res.status).toBe(401);
  });

  it('returns catalog with items from data file', async () => {
    const katalogPath = path.join(__dirname, '..', 'data', 'flota-pojazdy-katalog.json');
    expect(fs.existsSync(katalogPath)).toBe(true);
    const res = await request(app).get('/api/flota/katalog-pojazdow').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        liczba: expect.any(Number),
        arkusze: expect.any(Array),
        items: expect.any(Array),
      })
    );
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({
        marka: expect.any(String),
        model: expect.any(String),
        nr_rejestracyjny: expect.any(String),
      })
    );
  });

  it('filters by arkusz', async () => {
    const res = await request(app)
      .get('/api/flota/katalog-pojazdow')
      .query({ arkusz: 'Kraków' })
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((i) => i.arkusz === 'Kraków')).toBe(true);
  });
});
