const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const ekipyRoutes = require('../src/routes/ekipy');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Ekipy attendance routes', () => {
  const app = createTestApp('/api/ekipy', ekipyRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists branch-scoped team attendance with default present state', async () => {
    const token = jwt.sign(
      { id: 7, rola: 'Kierownik', oddzial_id: 3, imie: 'Anna', nazwisko: 'Planer' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE UNIQUE INDEX') || s.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }
      if (s.includes('FROM teams t') && s.includes('team_attendance')) {
        expect(params).toEqual(['2026-05-25', 3]);
        return {
          rows: [
            { team_id: 11, team_name: 'Brygada Alfa', oddzial_id: 3, attendance_id: null, present: null, note: null },
            { team_id: 12, team_name: 'Brygada Beta', oddzial_id: 3, attendance_id: 8, present: false, note: 'Auto w serwisie', actor_name: 'Anna Planer' },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/ekipy/attendance?date=2026-05-25')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 2, confirmed: 1, absent: 1 });
    expect(res.body.items[0]).toMatchObject({
      teamId: '11',
      teamName: 'Brygada Alfa',
      present: true,
    });
    expect(res.body.items[1]).toMatchObject({
      teamId: '12',
      present: false,
      note: 'Auto w serwisie',
      actor: 'Anna Planer',
    });
  });

  it('upserts attendance for an allowed team', async () => {
    const token = jwt.sign(
      { id: 9, rola: 'Dyrektor', oddzial_id: 3, imie: 'Jan', nazwisko: 'Dyrektor' },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE UNIQUE INDEX') || s.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }
      if (s === 'SELECT id, nazwa, oddzial_id FROM teams WHERE id = $1') {
        expect(params).toEqual([11]);
        return { rows: [{ id: 11, nazwa: 'Brygada Alfa', oddzial_id: 3 }] };
      }
      if (s.includes('INSERT INTO team_attendance')) {
        expect(params).toEqual(['2026-05-25', 11, false, 'Brak brygadzisty', 9, 'Jan Dyrektor']);
        return {
          rows: [{
            attendance_id: 15,
            date_ymd: '2026-05-25',
            team_id: 11,
            present: false,
            note: 'Brak brygadzisty',
            actor_name: 'Jan Dyrektor',
            created_at: '2026-05-25T06:00:00.000Z',
            updated_at: '2026-05-25T06:05:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/ekipy/11/attendance')
      .set('Authorization', `Bearer ${token}`)
      .send({ dateYmd: '2026-05-25', present: false, note: 'Brak brygadzisty' });

    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({
      id: '15',
      dateYmd: '2026-05-25',
      teamId: '11',
      teamName: 'Brygada Alfa',
      present: false,
      note: 'Brak brygadzisty',
      actor: 'Jan Dyrektor',
    });
  });

  it('rejects attendance writes outside the user branch', async () => {
    const token = jwt.sign(
      { id: 10, rola: 'Kierownik', oddzial_id: 3 },
      env.JWT_SECRET
    );
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE UNIQUE INDEX') || s.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }
      if (s === 'SELECT id, nazwa, oddzial_id FROM teams WHERE id = $1') {
        return { rows: [{ id: 11, nazwa: 'Brygada Poznan', oddzial_id: 9 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put('/api/ekipy/11/attendance')
      .set('Authorization', `Bearer ${token}`)
      .send({ dateYmd: '2026-05-25', present: true });

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO team_attendance'))).toBe(false);
  });
});
