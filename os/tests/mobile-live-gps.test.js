const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const { env } = require('../src/config/env');
const mobileRoutes = require('../src/routes/mobile');
const { createTestApp } = require('./helpers/create-test-app');

const app = createTestApp('/api/mobile', mobileRoutes);

const token = (payload) => jwt.sign({
  id: 22,
  rola: 'Brygadzista',
  oddzial_id: 7,
  ekipa_id: 12,
  ...payload,
}, env.JWT_SECRET);

describe('POST /api/mobile/me/location', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('stores foreground GPS heartbeat for field workers', async () => {
    const res = await request(app)
      .post('/api/mobile/me/location')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        lat: 50.06143,
        lng: 19.93658,
        accuracy_m: 18,
        speed_kmh: 12.5,
        heading: 91,
        battery_pct: 74,
        activity: 'foreground',
        platform: 'android',
        recorded_at: '2026-05-26T20:45:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      provider: 'mobile',
      user_id: 22,
    });

    const insertCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO gps_vehicle_positions')
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall[1]).toEqual([
      '22',
      50.06143,
      19.93658,
      12.5,
      91,
      expect.any(String),
      expect.stringContaining('"ekipa_id":12'),
    ]);
  });

  it('rejects office users so GPS live stays limited to field roles', async () => {
    const res = await request(app)
      .post('/api/mobile/me/location')
      .set('Authorization', `Bearer ${token({ rola: 'Specjalista', ekipa_id: null })}`)
      .send({ lat: 50.06143, lng: 19.93658 });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
