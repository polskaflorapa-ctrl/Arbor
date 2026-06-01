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
  const token = (payload) =>
    jwt.sign({ id: 10, rola: 'Kierownik', oddzial_id: 1, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /materialy scopes manager to own branch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 7, nazwa: 'Paliwo mieszanka', stan: '12.5', stan_alert: 'ok' }],
    });

    const res = await request(app)
      .get('/api/magazyn/materialy')
      .set('Authorization', `Bearer ${token({ oddzial_id: 4 })}`);

    expect(res.status).toBe(200);
    expect(res.body[0].nazwa).toBe('Paliwo mieszanka');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('m.oddzial_id = $1'), [4]);
  });

  it('POST /materialy creates material in manager branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 11 }] });

    const res = await request(app)
      .post('/api/magazyn/materialy')
      .set('Authorization', `Bearer ${token({ oddzial_id: 2 })}`)
      .send({
        nazwa: 'Olej do pilarek',
        jednostka: 'l',
        sku: 'OLEJ-1L',
        min_stan: 5,
        koszt_jednostkowy: 18,
        oddzial_id: 99,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(11);
    expect(pool.query.mock.calls[0][1]).toEqual([2, 'Olej do pilarek', 'l', 'OLEJ-1L', 5, 18]);
  });

  it('POST /ruchy records receipt and increases stock', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1, koszt_jednostkowy: '20.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1, stan: '10.0000' }] })
      .mockResolvedValueOnce({ rows: [{ id: 90 }] });

    const res = await request(app)
      .post('/api/magazyn/ruchy')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 5, typ: 'przyjecie', ilosc: 10, notatka: 'Dostawa' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 90, stan: '10.0000' });
    expect(pool.query.mock.calls[1][1]).toEqual([10, 5]);
    expect(pool.query.mock.calls[2][0]).toContain('INSERT INTO inventory_movements');
  });

  it('POST /ruchy records task issue and decreases stock', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1, koszt_jednostkowy: '20.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1, stan: '7.0000' }] })
      .mockResolvedValueOnce({ rows: [{ id: 91 }] });

    const res = await request(app)
      .post('/api/magazyn/ruchy')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 5, typ: 'rozchod', ilosc: 3, task_id: 77 });

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][1]).toEqual([-3, 5]);
    expect(pool.query.mock.calls[2][1]).toEqual([5, 1, 'rozchod', 3, 77, '20.00', null, 10]);
  });

  it('POST /ruchy blocks issue without enough stock', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1, koszt_jednostkowy: '20.00' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/magazyn/ruchy')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 5, typ: 'rozchod', ilosc: 30, task_id: 77 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stan_magazynu_za_maly');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('POST /ruchy requires task for issue', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1, koszt_jednostkowy: '20.00' }] });

    const res = await request(app)
      .post('/api/magazyn/ruchy')
      .set('Authorization', `Bearer ${token()}`)
      .send({ material_id: 5, typ: 'rozchod', ilosc: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('task_wymagany_dla_rozchodu');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
