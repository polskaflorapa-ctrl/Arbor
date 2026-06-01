const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const flotaRoutes = require('../src/routes/flota');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Flota CRUD kart zasobow', () => {
  const app = createTestApp('/api/flota', flotaRoutes);
  const token = (payload = {}) =>
    jwt.sign({ id: 10, rola: 'Kierownik', oddzial_id: 1, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates an equipment card in manager branch scope', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });

    const res = await request(app)
      .put('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        nazwa: 'Rebak Forst ST8',
        typ: 'Rebak',
        nr_seryjny: 'RF-11',
        rok_produkcji: 2022,
        ekipa_id: 3,
        data_przegladu: '2026-07-01',
        koszt_motogodziny: 90,
        notatki: 'Po serwisie',
        oddzial_id: 99,
      });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE equipment_items'),
      expect.arrayContaining([1, 'Rebak Forst ST8', 'Rebak', 'RF-11', 2022, 3, '2026-07-01', 90, 'Po serwisie', 11])
    );
  });

  it('blocks manager update outside own branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 2 }] });

    const res = await request(app)
      .put('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        nazwa: 'Rebak',
      });

    expect(res.status).toBe(403);
  });

  it('updates and deletes a vehicle card', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const update = await request(app)
      .put('/api/flota/pojazdy/5')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        marka: 'Mercedes',
        model: 'Sprinter',
        nr_rejestracyjny: 'KR12345',
        rok_produkcji: 2021,
        typ: 'Bus',
        ekipa_id: 3,
        data_przegladu: '2026-07-01',
        data_ubezpieczenia: '2026-08-01',
        przebieg: 151000,
        notatki: 'Karta kompletna',
      });
    expect(update.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE vehicles'), expect.any(Array));

    const del = await request(app)
      .delete('/api/flota/pojazdy/5')
      .set('Authorization', `Bearer ${token()}`);

    expect(del.status).toBe(200);
    expect(pool.query).toHaveBeenLastCalledWith('DELETE FROM vehicles WHERE id = $1', [5]);
  });
});
