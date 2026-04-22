const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const authRoutes = require('../src/routes/auth');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Auth routes', () => {
  const app = createTestApp('/api/auth', authRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    if (typeof authRoutes.__resetLoginLimiterForTests === 'function') {
      authRoutes.__resetLoginLimiterForTests();
    }
  });

  describe('POST /api/auth/login', () => {
  it('returns 400 when credentials are missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(typeof res.body.requestId).toBe('string');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid credentials', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).post('/api/auth/login').send({
      login: 'ghost',
      haslo: 'wrong-pass',
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Nieprawidlowy login lub haslo',
        code: 'LOGIN_INVALID_CREDENTIALS',
      })
    );
    expect(typeof res.body.requestId).toBe('string');
  });

  it('returns token and user data for valid credentials', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 7,
          login: 'jan',
          haslo_hash: hash,
          imie: 'Jan',
          nazwisko: 'Kowalski',
          rola: 'Administrator',
          oddzial_id: 2,
          aktywny: true,
        },
      ],
    });

    const res = await request(app).post('/api/auth/login').send({
      login: 'jan',
      haslo: 'secret123',
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual(
      expect.objectContaining({
        id: 7,
        imie: 'Jan',
        nazwisko: 'Kowalski',
        rola: 'Administrator',
        oddzial_id: 2,
      })
    );
    expect(res.body.user.permissions).toEqual(
      expect.objectContaining({
        policyVersion: 1,
        taskScope: 'all',
        canViewPayrollSettlements: false,
        canManagePayrollSettlements: false,
        canViewSettlementModule: false,
      })
    );
  });

  it('returns 429 after too many login attempts from same IP', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/api/auth/login').send({
        login: 'ghost',
        haslo: 'wrong-pass',
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('LOGIN_INVALID_CREDENTIALS');
    }

    const blocked = await request(app).post('/api/auth/login').send({
      login: 'ghost',
      haslo: 'wrong-pass',
    });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Za duzo prob logowania. Sprobuj ponownie za chwile.');
    expect(blocked.body.code).toBe('LOGIN_TOO_MANY_ATTEMPTS');
    expect(typeof blocked.body.requestId).toBe('string');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 with requestId when token is missing', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Brak tokenu autoryzacji');
      expect(res.body.code).toBe('AUTH_MISSING_TOKEN');
      expect(typeof res.body.requestId).toBe('string');
    });

    it('returns user profile for valid token', async () => {
      const token = jwt.sign({ id: 9, rola: 'Administrator' }, env.JWT_SECRET);
      pool.query.mockResolvedValue({
        rows: [{ id: 9, login: 'jan', imie: 'Jan', nazwisko: 'Kowalski', rola: 'Administrator' }],
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ id: 9, login: 'jan' }));
      expect(res.body.permissions).toEqual(
        expect.objectContaining({
          policyVersion: 1,
          taskScope: 'all',
          canViewPayrollSettlements: false,
          canManagePayrollSettlements: false,
          canViewSettlementModule: false,
        })
      );
    });

    it('returns permissions via dedicated endpoint', async () => {
      const token = jwt.sign({ id: 9, rola: 'Brygadzista' }, env.JWT_SECRET);
      const res = await request(app)
        .get('/api/auth/permissions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          userId: 9,
          rola: 'Brygadzista',
          permissions: expect.objectContaining({
            policyVersion: 1,
            taskScope: 'assigned_team_only',
            canViewSettlementModule: false,
          }),
        })
      );
    });

    it('keeps permissions contract consistent across login, me and permissions endpoints', async () => {
      const hash = await bcrypt.hash('sekret123', 10);
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 31,
              login: 'marek',
              haslo_hash: hash,
              imie: 'Marek',
              nazwisko: 'Nowak',
              rola: 'Kierownik',
              oddzial_id: 4,
              aktywny: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 31,
              login: 'marek',
              imie: 'Marek',
              nazwisko: 'Nowak',
              email: null,
              telefon: null,
              rola: 'Kierownik',
              oddzial_id: 4,
            },
          ],
        });

      const loginRes = await request(app).post('/api/auth/login').send({
        login: 'marek',
        haslo: 'sekret123',
      });

      expect(loginRes.status).toBe(200);
      const token = loginRes.body.token;
      const permissionsFromLogin = loginRes.body.user.permissions;

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      const permissionsFromMe = meRes.body.permissions;

      const permissionsRes = await request(app)
        .get('/api/auth/permissions')
        .set('Authorization', `Bearer ${token}`);
      expect(permissionsRes.status).toBe(200);
      const permissionsFromEndpoint = permissionsRes.body.permissions;

      expect(permissionsFromLogin).toEqual(permissionsFromMe);
      expect(permissionsFromMe).toEqual(permissionsFromEndpoint);
      expect(permissionsFromEndpoint).toEqual(
        expect.objectContaining({
          policyVersion: 1,
          taskScope: 'branch',
          canViewPayrollSettlements: false,
          canManagePayrollSettlements: false,
          canViewSettlementModule: false,
        })
      );
    });

    it('returns 401 for malformed authorization header', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', 'Token abc');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Nieprawidlowy format tokenu');
      expect(res.body.code).toBe('AUTH_BAD_TOKEN_FORMAT');
      expect(typeof res.body.requestId).toBe('string');
    });
  });

  describe('PUT /api/auth/zmien-haslo', () => {
    it('returns 400 for too short password', async () => {
      const token = jwt.sign({ id: 9, rola: 'Administrator' }, env.JWT_SECRET);
      const res = await request(app)
        .put('/api/auth/zmien-haslo')
        .set('Authorization', `Bearer ${token}`)
        .send({ stare_haslo: 'abc', nowe_haslo: '123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Nieprawidlowe dane wejsciowe');
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(typeof res.body.requestId).toBe('string');
    });

    it('changes password when old password is valid', async () => {
      const token = jwt.sign({ id: 9, rola: 'Administrator' }, env.JWT_SECRET);
      const currentHash = await bcrypt.hash('stare-haslo', 10);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 9, haslo_hash: currentHash }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .put('/api/auth/zmien-haslo')
        .set('Authorization', `Bearer ${token}`)
        .send({ stare_haslo: 'stare-haslo', nowe_haslo: 'nowe-haslo123' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Haslo zostalo zmienione' });
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });
});
