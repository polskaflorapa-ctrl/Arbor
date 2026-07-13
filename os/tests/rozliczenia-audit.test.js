const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const rozliczeniaRoutes = require('../src/routes/rozliczenia');
const { requestContext } = require('../src/middleware/request-context');
const { localeMiddleware } = require('../src/middleware/locale');
const { errorHandler, notFoundHandler } = require('../src/middleware/error-handler');
const { env } = require('../src/config/env');

describe('Rozliczenia audit', () => {
  let auditSpy;
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    auditSpy = jest.fn().mockResolvedValue();
    app = express();
    app.use(requestContext);
    app.use(localeMiddleware);
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auditLog = auditSpy;
      next();
    });
    app.use('/api/rozliczenia', rozliczeniaRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  it('audits financial settlement upsert with previous and next values', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 44, oddzial_id: 3, ekipa_id: 5 }] })
        .mockResolvedValueOnce({
          rows: [{
            wartosc_brutto: '2000',
            vat_stawka: '8',
            wartosc_netto: '1851.85',
            koszt_pomocnikow: '100',
            podstawa_brygadzisty: '1751.85',
            procent_brygadzisty: '15',
            wynagrodzenie_brygadzisty: '262.78',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ koszt: '200' }] })
        .mockResolvedValueOnce({
          rows: [{
            task_id: 44,
            wartosc_brutto: 2160,
            vat_stawka: 8,
            wartosc_netto: 2000,
            koszt_pomocnikow: 200,
            podstawa_brygadzisty: 1800,
            procent_brygadzisty: 15,
            wynagrodzenie_brygadzisty: 270,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    const token = jwt.sign({ id: 8, rola: 'Kierownik', oddzial_id: 3, login: 'k' }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/rozliczenia/zadanie/44')
      .set('Authorization', `Bearer ${token}`)
      .send({ wartosc_brutto: 2160, vat_stawka: 8, procent_brygadzisty: 15 });

    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledWith({
      action: 'task.financial_settlement_upsert',
      entityType: 'task',
      entityId: 44,
      metadata: expect.objectContaining({
        oddzial_id: 3,
        previous: expect.objectContaining({ wartosc_brutto: '2000' }),
        next: expect.objectContaining({ wartosc_brutto: 2160, wartosc_netto: 2000 }),
        changed_fields: expect.arrayContaining(['wartosc_brutto', 'wynagrodzenie_brygadzisty']),
      }),
    });
    expect(client.release).toHaveBeenCalled();
  });

  it('returns operational costs with settlement task details', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 44,
          klient_nazwa: 'Osiedle Lesne',
          adres: 'Lesna 12',
          miasto: 'Krakow',
          ekipa_id: 3,
          ekipa_nazwa: 'Brygada Alfa',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 900,
          task_id: 44,
          category: 'paliwo',
          label: 'Paliwo',
          amount: '120.50',
          source: 'field_settlement',
          note: 'Paragon',
          recorded_at: '2026-06-07T08:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 910,
          task_id: 44,
          nazwa: 'Kora sosnowa',
          ilosc: '2',
          jednostka: 'm3',
          koszt_jednostkowy: '80',
          koszt_laczny: '160',
          notatka: 'Rabata',
        }],
      });
    const token = jwt.sign({ id: 8, rola: 'Kierownik', oddzial_id: 3, login: 'k' }, env.JWT_SECRET);

    const res = await request(app)
      .get('/api/rozliczenia/zadanie/44')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.koszty_operacyjne).toEqual([
      expect.objectContaining({ category: 'paliwo', amount: '120.50', source: 'field_settlement' }),
    ]);
    expect(res.body.materialy).toEqual([
      expect.objectContaining({ nazwa: 'Kora sosnowa', koszt_laczny: '160' }),
    ]);
  });

  it('adds operational costs from field settlement and writes audit log', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 44, oddzial_id: 3 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 901,
          task_id: 44,
          recorded_by: 8,
          category: 'paliwo',
          label: 'Paliwo',
          amount: '120.50',
          source: 'field_settlement',
          note: 'Paragon',
          recorded_at: '2026-06-07T08:00:00.000Z',
        }],
      });
    const token = jwt.sign({ id: 8, rola: 'Kierownik', oddzial_id: 3, login: 'k' }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/rozliczenia/zadanie/44/koszty-operacyjne')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'paliwo', amount: 120.5, note: 'Paragon' });

    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO task_operational_costs');
    expect(pool.query.mock.calls[1][1]).toEqual([44, 8, 'paliwo', 'Paliwo', 120.5, 'Paragon']);
    expect(auditSpy).toHaveBeenCalledWith({
      action: 'task.operational_cost_add',
      entityType: 'task',
      entityId: 44,
      metadata: expect.objectContaining({
        oddzial_id: 3,
        cost: expect.objectContaining({ category: 'paliwo', amount: '120.50' }),
      }),
    });
  });

  it('blocks operational costs for tasks in another branch before insert or audit', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const token = jwt.sign({ id: 8, rola: 'Kierownik', oddzial_id: 3, login: 'k' }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/rozliczenia/zadanie/44/koszty-operacyjne')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'paliwo', amount: 120.5, note: 'Paragon' });

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT t.id, t.oddzial_id, t.ekipa_id');
    expect(pool.query.mock.calls[0][0]).toContain('t.oddzial_id = $2');
    expect(pool.query.mock.calls[0][1]).toEqual([44, 3]);
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('adds finish materials from field settlement and writes audit log', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 44, oddzial_id: 3 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 911,
          task_id: 44,
          recorded_by: 8,
          nazwa: 'Kora sosnowa',
          ilosc: '2',
          jednostka: 'm3',
          koszt_jednostkowy: '80',
          koszt_laczny: '160',
          notatka: 'Rabata',
          recorded_at: '2026-06-07T08:00:00.000Z',
        }],
      });
    const token = jwt.sign({ id: 8, rola: 'Kierownik', oddzial_id: 3, login: 'k' }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/rozliczenia/zadanie/44/materialy')
      .set('Authorization', `Bearer ${token}`)
      .send({ nazwa: 'Kora sosnowa', ilosc: 2, jednostka: 'm3', koszt_jednostkowy: 80, notatka: 'Rabata' });

    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO task_finish_material_usage');
    expect(pool.query.mock.calls[1][1]).toEqual([44, 8, 'Kora sosnowa', 2, 'm3', 80, 160, 'Rabata']);
    expect(auditSpy).toHaveBeenCalledWith({
      action: 'task.material_cost_add',
      entityType: 'task',
      entityId: 44,
      metadata: expect.objectContaining({
        oddzial_id: 3,
        material: expect.objectContaining({ nazwa: 'Kora sosnowa', koszt_laczny: '160' }),
      }),
    });
  });

  it('blocks finish materials for tasks in another branch before insert or audit', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const token = jwt.sign({ id: 8, rola: 'Kierownik', oddzial_id: 3, login: 'k' }, env.JWT_SECRET);

    const res = await request(app)
      .post('/api/rozliczenia/zadanie/44/materialy')
      .set('Authorization', `Bearer ${token}`)
      .send({ nazwa: 'Kora sosnowa', koszt_laczny: 160 });

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT t.id, t.oddzial_id, t.ekipa_id');
    expect(pool.query.mock.calls[0][0]).toContain('t.oddzial_id = $2');
    expect(pool.query.mock.calls[0][1]).toEqual([44, 3]);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
