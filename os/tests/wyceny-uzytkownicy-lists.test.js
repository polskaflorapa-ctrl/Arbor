const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const wycenyRoutes = require('../src/routes/wyceny');
const uzytkownicyRoutes = require('../src/routes/uzytkownicy');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Wyceny list pagination', () => {
  const app = createTestApp('/api/wyceny', wycenyRoutes);

  beforeEach(() => jest.clearAllMocks());

  it('returns paginated object when limit is set (autor — np. Brygadzista)', async () => {
    const token = jwt.sign({ id: 3, rola: 'Brygadzista', oddzial_id: 1 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ c: 2 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, klient_nazwa: 'X', autor_nazwa: 'A B', ekipa_nazwa: null }],
      });

    const res = await request(app)
      .get('/api/wyceny?limit=5&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [{ id: 1, klient_nazwa: 'X', autor_nazwa: 'A B', ekipa_nazwa: null }],
      total: 2,
      limit: 5,
      offset: 0,
    });
  });

  it('returns 400 when creating wycena without klient_nazwa', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .post('/api/wyceny')
      .set('Authorization', `Bearer ${token}`)
      .send({ klient_nazwa: '  ', adres: 'x', miasto: 'y' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects invalid wyceny query with 400', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .get('/api/wyceny?limit=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('Uzytkownicy list pagination and create validation', () => {
  const app = createTestApp('/api/uzytkownicy', uzytkownicyRoutes);

  beforeEach(() => jest.clearAllMocks());

  it('returns paginated users when limit is set', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 1 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ c: 10 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, login: 'a' }] });

    const res = await request(app)
      .get('/api/uzytkownicy?limit=1&offset=2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.limit).toBe(1);
    expect(res.body.offset).toBe(2);
    expect(res.body.items).toHaveLength(1);
  });

  it('limits sales director user list to specialists and self', async () => {
    const token = jwt.sign({ id: 12, rola: 'Dyrektor Sprzedazy', oddzial_id: 1 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ c: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, rola: 'Dyrektor Sprzedazy' }] });

    const res = await request(app)
      .get('/api/uzytkownicy?limit=20&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("(u.rola = 'Specjalista' OR u.id = $1)"),
      [12]
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("(u.rola = 'Specjalista' OR u.id = $1)"),
      [12, 20, 0]
    );
  });

  it('allows sales director to transfer a specialist to another branch', async () => {
    const token = jwt.sign({ id: 12, rola: 'Dyrektor Sprzedazy', oddzial_id: 1 }, env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 91, rola: 'Specjalista', oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 91, rola: 'Specjalista', oddzial_id: 3 }] });

    const res = await request(app)
      .patch('/api/uzytkownicy/91/oddzial')
      .set('Authorization', `Bearer ${token}`)
      .send({ oddzial_id: 3 });

    expect(res.status).toBe(200);
    expect(res.body.oddzial_id).toBe(3);
    expect(pool.query).toHaveBeenNthCalledWith(3, 'UPDATE users SET oddzial_id = $1 WHERE id = $2', [3, 91]);
  });

  it('blocks sales director from creating users', async () => {
    const token = jwt.sign({ id: 12, rola: 'Dyrektor Sprzedazy', oddzial_id: 1 }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/uzytkownicy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        login: 'nowy',
        haslo: 'sekret123',
        rola: 'Specjalista',
        oddzial_id: 2,
      });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 400 when creating user with short password', async () => {
    const token = jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: 1 }, env.JWT_SECRET);
    const res = await request(app)
      .post('/api/uzytkownicy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        login: 'x',
        haslo: 'short',
        rola: 'Brygadzista',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
