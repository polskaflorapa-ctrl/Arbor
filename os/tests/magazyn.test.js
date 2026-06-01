const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const magazynRoutes = require('../src/routes/magazyn');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Magazyn materialow', () => {
  const app = createTestApp('/api/magazyn', magazynRoutes);
  const token = (payload = {}) =>
    jwt.sign({ id: 10, rola: 'Kierownik', oddzial_id: 1, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists branch materials with computed stock and low stock flag', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          oddzial_id: 1,
          nazwa: 'Olej do pilarki',
          jednostka: 'l',
          min_stan: '5',
          koszt_jednostkowy: '18.50',
          stan: '4',
          niski_stan: true,
        },
      ],
    });

    const res = await request(app)
      .get('/api/magazyn/materialy')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 7, nazwa: 'Olej do pilarki', stan: '4', niski_stan: true });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('warehouse_material_movements'),
      [1]
    );
  });

  it('creates a material in manager branch scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 12 }] });

    const res = await request(app)
      .post('/api/magazyn/materialy')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        nazwa: 'Paliwo mieszanka',
        jednostka: 'l',
        min_stan: 10,
        koszt_jednostkowy: 7.5,
        oddzial_id: 99,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 12 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO warehouse_materials'),
      [1, 'Paliwo mieszanka', 'l', 10, 7.5, null, null]
    );
  });

  it('records a material receipt', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 12, oddzial_id: 1, nazwa: 'Paliwo', jednostka: 'l', koszt_jednostkowy: '7.50' }] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] });

    const res = await request(app)
      .post('/api/magazyn/przyjecia')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 12, ilosc: 20, koszt_jednostkowy: 7.8, notatki: 'Faktura FV/1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 55 });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO warehouse_material_movements'),
      [1, 12, 'przyjecie', 20, 7.8, null, 'Faktura FV/1', 10]
    );
  });

  it('blocks task issue when stock would go negative', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 12, oddzial_id: 1, nazwa: 'Paliwo', jednostka: 'l', koszt_jednostkowy: '7.50' }] })
      .mockResolvedValueOnce({ rows: [{ id: 99, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ stan: '3' }] });

    const res = await request(app)
      .post('/api/magazyn/rozchody')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 12, ilosc: 4, task_id: 99 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('magazyn_brak_stanu');
    expect(res.body.code).toBe('WAREHOUSE_STOCK_UNDERFLOW');
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('records task issue when stock is available', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 12, oddzial_id: 1, nazwa: 'Paliwo', jednostka: 'l', koszt_jednostkowy: '7.50' }] })
      .mockResolvedValueOnce({ rows: [{ id: 99, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ stan: '8' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] });

    const res = await request(app)
      .post('/api/magazyn/rozchody')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 12, ilosc: 4, task_id: 99, notatki: 'Zlecenie #99' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 77 });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO warehouse_material_movements'),
      [1, 12, 'rozchod', 4, 7.5, 99, 'Zlecenie #99', 10]
    );
  });
});
