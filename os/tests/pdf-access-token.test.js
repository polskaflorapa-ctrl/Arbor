const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const pdfRoutes = require('../src/routes/pdf');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('PDF access_token auth', () => {
  const app = createTestApp('/api/pdf', pdfRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when bearer and access_token are both missing', async () => {
    const res = await request(app).get('/api/pdf/zlecenie/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 when access_token task_id does not match route id', async () => {
    const token = jwt.sign(
      { typ: 'task_pdf_link', task_id: 2, user_id: 9, rola: 'Kierownik', oddzial_id: 5 },
      env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    const res = await request(app).get(`/api/pdf/zlecenie/1?access_token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('allows valid access_token and returns task PDF', async () => {
    const token = jwt.sign(
      { typ: 'task_pdf_link', task_id: 1, user_id: 9, rola: 'Kierownik', oddzial_id: 5 },
      env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('SELECT t.id, t.oddzial_id, t.status FROM tasks t WHERE t.id = $1')) {
        return { rows: [{ id: 1, oddzial_id: 5, status: 'Nowe' }] };
      }
      if (s.includes('FROM tasks t LEFT JOIN teams te ON t.ekipa_id = te.id')) {
        return {
          rows: [
            {
              id: 1,
              oddzial_id: 5,
              status: 'Nowe',
              klient_nazwa: 'Jan Test',
              klient_telefon: '500600700',
              adres: 'Lesna 1',
              miasto: 'Poznan',
              typ_uslugi: 'Wycinka',
              priorytet: 'Normalny',
              data_planowana: '2026-05-10T09:00:00.000Z',
              ekipa_nazwa: 'Alfa',
              kierownik_nazwa: 'Kierownik Test',
              oddzial_nazwa: 'Poznan',
              wartosc_planowana: 100,
            },
          ],
        };
      }
      if (s.includes('FROM work_logs wl')) return { rows: [] };
      if (s.includes('FROM issues i')) return { rows: [] };
      if (s.includes('FROM task_pomocnicy tp')) return { rows: [] };
      if (s.includes('FROM photos ph')) return { rows: [] };
      if (s.includes('SELECT * FROM rozliczenia WHERE task_id = $1')) return { rows: [] };
      if (s.includes('FROM task_client_signatures')) return { rows: [] };
      throw new Error(`Unexpected SQL in test: ${s}`);
    });

    const res = await request(app).get(`/api/pdf/zlecenie/1?access_token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('zlecenie_1_');
  });
});
