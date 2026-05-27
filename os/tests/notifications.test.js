const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const pool = require('../src/config/database');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

const app = createApp();

function token() {
  return jwt.sign({ id: 7, rola: 'Brygadzista', oddzial_id: 3 }, env.JWT_SECRET);
}

describe('notifications route brief handling', () => {
  afterEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('GET /api/notifications exposes route brief metadata for crew acknowledgements', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM notifications n')) {
        expect(params).toEqual([7]);
        expect(text).toContain('dispatch_route_brief_recipients');
        return {
          rows: [{
            id: 99,
            typ: 'Odprawa ekipy',
            tresc: 'Odprawa ekipy - Brygada Alfa',
            status: 'Nowe',
            dispatch_route_brief_id: 77,
            dispatch_route_team_id: 10,
            dispatch_route_team_name: 'Brygada Alfa',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 99,
      typ: 'Odprawa ekipy',
      dispatch_route_brief_id: 77,
      dispatch_route_team_name: 'Brygada Alfa',
    });
  });

  it('PUT /api/notifications/odczytaj-wszystkie does not confirm route brief notifications', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH updated AS')) {
        expect(params).toEqual([7]);
        expect(text).toContain("COALESCE(typ, '') <> 'Odprawa ekipy'");
        expect(text).toContain("COALESCE(typ, '') = 'Odprawa ekipy'");
        return {
          rows: [{ updated: 2, skipped_route_briefs: 1 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .put('/api/notifications/odczytaj-wszystkie')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'Wszystkie odczytane',
      updated: 2,
      skipped_route_briefs: 1,
    });
  });

  it('PUT /api/notifications/:id/odczytaj rejects route brief confirmation by generic read endpoint', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('WITH target AS')) {
        expect(params).toEqual([99, 7]);
        expect(text).toContain("COALESCE(typ, '') <> 'Odprawa ekipy'");
        return { rows: [{ updated_id: null, typ: 'Odprawa ekipy' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .put('/api/notifications/99/odczytaj')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      requires_route_brief_confirmation: true,
    });
  });

  it('DELETE /api/notifications/:id removes only the current user notification', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('DELETE FROM notifications')) {
        expect(params).toEqual([99, 7]);
        expect(text).toContain('to_user_id = $2');
        return { rows: [{ id: 99 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .delete('/api/notifications/99')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'Powiadomienie usuniete',
      id: 99,
    });
  });
});
