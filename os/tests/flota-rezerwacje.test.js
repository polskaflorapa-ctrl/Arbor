const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const flotaRoutes = require('../src/routes/flota');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Flota rezerwacje sprzetu', () => {
  const app = createTestApp('/api/flota', flotaRoutes);

  const token = (payload) =>
    jwt.sign({ id: 10, rola: 'Kierownik', oddzial_id: 1, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without auth for GET', async () => {
    const res = await request(app).get('/api/flota/rezerwacje').query({ from: '2026-06-01', to: '2026-06-30' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when range query is invalid', async () => {
    const res = await request(app)
      .get('/api/flota/rezerwacje')
      .query({ from: 'bad', to: '2026-06-30' })
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('GET /sprzet returns inspection alert and next reservation context', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          nazwa: 'Rebak Forst',
          przeglad_alert: 'soon',
          next_reservation_from: '2026-06-10',
          next_task_id: 42,
          next_task_client: 'Jan Kowalski',
        },
      ],
    });

    const res = await request(app)
      .get('/api/flota/sprzet')
      .set('Authorization', `Bearer ${token({ oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      przeglad_alert: 'soon',
      next_reservation_from: '2026-06-10',
      next_task_id: 42,
      next_task_client: 'Jan Kowalski',
    }));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AS przeglad_alert'), [7]);
    expect(pool.query.mock.calls[0][0]).toContain('LEFT JOIN LATERAL');
  });

  it('PUT /sprzet updates equipment card assignment inside branch scope', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });

    const res = await request(app)
      .put('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token({ oddzial_id: 1 })}`)
      .send({
        nazwa: 'Rebak Forst ST8',
        typ: 'Rebak',
        nr_seryjny: 'RF-11',
        rok_produkcji: 2023,
        ekipa_id: 3,
        oddzial_id: 9,
        data_przegladu: '2026-07-01',
        koszt_motogodziny: 42,
        notatki: 'Po przegladzie',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id: 11, message: 'Sprzet zapisany' }));
    expect(pool.query).toHaveBeenNthCalledWith(1, 'SELECT id, oddzial_id FROM equipment_items WHERE id = $1', [11]);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE equipment_items'),
      [1, 'Rebak Forst ST8', 'Rebak', 'RF-11', 2023, 3, '2026-07-01', 42, 'Po przegladzie', 11]
    );
  });

  it('PUT /sprzet rejects equipment outside manager branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 2 }] });

    const res = await request(app)
      .put('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token({ oddzial_id: 1 })}`)
      .send({ nazwa: 'Rebak Forst', typ: 'Rebak' });

    expect(res.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('DELETE /sprzet removes equipment card inside branch scope', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 11, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .delete('/api/flota/sprzet/11')
      .set('Authorization', `Bearer ${token({ oddzial_id: 1 })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Sprzet usuniety' });
    expect(pool.query).toHaveBeenLastCalledWith('DELETE FROM equipment_items WHERE id = $1', [11]);
  });

  it('returns 404 rezerwacje_not_migrated when table is missing', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const res = await request(app)
      .get('/api/flota/rezerwacje')
      .query({ from: '2026-06-01', to: '2026-06-30' })
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('rezerwacje_not_migrated');
  });

  it('GET adds branch filter for non-Dyrektor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/flota/rezerwacje')
      .query({ from: '2026-06-01', to: '2026-06-15' })
      .set('Authorization', `Bearer ${token({ oddzial_id: 7 })}`);
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AND e.oddzial_id = $3'), [
      '2026-06-01',
      '2026-06-15',
      7,
    ]);
  });

  it('GET omits branch filter for Dyrektor', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/flota/rezerwacje')
      .query({ from: '2026-06-01', to: '2026-06-15' })
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: 1 })}`);
    expect(res.status).toBe(200);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).not.toContain('AND e.oddzial_id = $3');
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['2026-06-01', '2026-06-15']);
  });

  it('POST returns 404 when sprzet missing', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        sprzet_id: 99,
        ekipa_id: 1,
        data_od: '2026-06-10',
        data_do: '2026-06-10',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('sprzet_nieznaleziony');
  });

  it('POST returns 400 when data_do before data_od', async () => {
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 1,
        data_od: '2026-06-12',
        data_do: '2026-06-10',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('data_do_przed_data_od');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST returns 400 when sprzet and ekipa oddzial mismatch', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, oddzial_id: 2 }] });
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor' })}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 2,
        data_od: '2026-06-10',
        data_do: '2026-06-10',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sprzet_ekipa_oddzial');
  });

  it('POST returns 403 when user oddzial does not match zasoby', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, oddzial_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 2 }] });
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token({ oddzial_id: 1 })}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 3,
        data_od: '2026-06-10',
        data_do: '2026-06-10',
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('brak_dostepu_oddzial');
  });

  it('POST returns 409 on overlapping active reservation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 500 }] });
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 3,
        data_od: '2026-06-10',
        data_do: '2026-06-11',
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('rezerwacja_kolizja_sprzet');
  });

  it('POST inserts and returns id', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 3,
        data_od: '2026-06-10',
        data_do: '2026-06-10',
        caly_dzien: true,
        status: 'Zarezerwowane',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42 });
    const insertSql = pool.query.mock.calls[3][0];
    expect(insertSql).toContain('INSERT INTO equipment_reservations');
  });

  it('POST can link reservation with task context', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 55, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] });
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 3,
        data_od: '2026-06-10',
        data_do: '2026-06-10',
        status: 'Zarezerwowane',
        task_id: 55,
        notatki: 'Plan zlecenia #55',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 77 });
    expect(pool.query).toHaveBeenCalledWith('SELECT id, oddzial_id FROM tasks WHERE id = $1', [55]);
    const insertCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO equipment_reservations') && String(sql).includes('task_id, notatki')
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall[1].slice(-2)).toEqual([55, 'Plan zlecenia #55']);
  });

  it('POST returns 404 when table missing', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, oddzial_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const res = await request(app)
      .post('/api/flota/rezerwacje')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        sprzet_id: 1,
        ekipa_id: 3,
        data_od: '2026-06-10',
        data_do: '2026-06-10',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('rezerwacje_not_migrated');
  });

  it('PUT status returns 404 when reservation not in scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .put('/api/flota/rezerwacje/99/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'Wydane' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('nie_znaleziono');
  });

  it('PUT status applies branch filter for Kierownik', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    const res = await request(app)
      .put('/api/flota/rezerwacje/5/status')
      .set('Authorization', `Bearer ${token({ oddzial_id: 4 })}`)
      .send({ status: 'Zwrócone' });
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('AND e.oddzial_id = $3'), ['Zwrócone', 5, 4]);
  });

  it('PUT status omits branch filter for Administrator', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    const res = await request(app)
      .put('/api/flota/rezerwacje/5/status')
      .set('Authorization', `Bearer ${token({ rola: 'Administrator', oddzial_id: 1 })}`)
      .send({ status: 'Anulowane' });
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['Anulowane', 5]);
  });
});
