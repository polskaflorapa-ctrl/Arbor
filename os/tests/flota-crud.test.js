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

  it('creates broken equipment with team assignment in one request', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const res = await request(app)
      .post('/api/flota/sprzet')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        nazwa: 'Rebak awaryjny',
        typ: 'Rebak',
        status: 'W naprawie',
        ekipa_id: 3,
        oddzial_id: 99,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 99 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO equipment_items'),
      [1, 'Rebak awaryjny', 'Rebak', 'W naprawie', undefined, undefined, 3, null, 0, undefined]
    );
  });

  it('updates an equipment card in manager branch scope', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });

    const res = await request(app)
      .put('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        nazwa: 'Rebak Forst ST8',
        typ: 'Rebak',
        status: 'W naprawie',
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
      expect.arrayContaining([1, 'Rebak Forst ST8', 'Rebak', 'W naprawie', 'RF-11', 2022, 3, '2026-07-01', 90, 'Po serwisie', 11])
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

  it('blocks assigning equipment to a team from another branch', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, oddzial_id: 2 }] });

    const res = await request(app)
      .put('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor' })}`)
      .send({
        nazwa: 'Rebak Forst',
        typ: 'Rebak',
        status: 'Dostepny',
        ekipa_id: 4,
        oddzial_id: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tego samego oddzialu/i);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('updates and deletes a vehicle card', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
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

  it('marks repaired equipment as available after completed repair entry', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 501 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/flota/naprawy')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        typ_zasobu: 'Sprzet',
        zasob_id: 11,
        data_naprawy: '2026-06-01',
        opis_usterki: 'Wymiana nozy',
        status: 'Zakonczona',
      });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE equipment_items SET status = $1, updated_at = NOW() WHERE id = $2',
      ['Dostepny', 11]
    );
  });

  it('keeps vehicle blocked when repair entry is still open', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 502 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/flota/naprawy')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        typ_zasobu: 'Pojazd',
        zasob_id: 5,
        data_naprawy: '2026-06-01',
        termin_odbioru: '2026-06-03',
        data_zakonczenia: '2026-06-04',
        strata_dzienna: 450,
        priorytet: 'Pilny',
        opis_usterki: 'Auto w serwisie',
        status: 'W toku',
      });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('termin_odbioru, data_zakonczenia, strata_dzienna, priorytet'),
      expect.arrayContaining(['2026-06-03', '2026-06-04', 450, 'Pilny', 'W toku'])
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE vehicles SET status = $1, updated_at = NOW() WHERE id = $2',
      ['W naprawie', 5]
    );
  });

  it('closes existing equipment repair and makes equipment available', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 91,
          typ_zasobu: 'Sprzet',
          zasob_id: 11,
          oddzial_id: 1,
          data_naprawy: '2026-06-01',
          opis_usterki: 'Noze do wymiany',
          status: 'W toku',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 91 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .put('/api/flota/naprawy/91')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        status: 'Zakonczona',
        opis_naprawy: 'Wymieniono noze',
      });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE repairs'),
      expect.arrayContaining(['Sprzet', 11, 1, undefined, '2026-06-01', undefined, 'Noze do wymiany', 'Wymieniono noze', undefined, null, null, null, 'Normalny', 'Zakonczona', 91])
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      'UPDATE equipment_items SET status = $1, updated_at = NOW() WHERE id = $2',
      ['Dostepny', 11]
    );
  });
});
