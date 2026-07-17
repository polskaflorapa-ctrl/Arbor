const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../src/services/systemEmail', () => ({
  sendSystemEmailOptional: jest.fn(),
}));

const pool = require('../src/config/database');
const { sendSystemEmailOptional } = require('../src/services/systemEmail');
const authRoutes = require('../src/routes/auth');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Auth routes', () => {
  const app = createTestApp('/api/auth', authRoutes);

  const mockPasswordResetTransactions = ({ availableUses = 1, userId = 7, userUpdateError } = {}) => {
    let remainingUses = availableUses;
    let passwordUpdates = 0;
    const clients = [];

    pool.connect.mockImplementation(async () => {
      let claimedToken = false;
      let committed = false;
      const client = {
        query: jest.fn(async (sql) => {
          const statement = String(sql);
          if (statement === 'BEGIN') return { rows: [], rowCount: null };
          if (statement.includes('UPDATE password_reset_tokens AS prt')) {
            if (remainingUses <= 0) return { rows: [], rowCount: 0 };
            remainingUses -= 1;
            claimedToken = true;
            return { rows: [{ user_id: userId }], rowCount: 1 };
          }
          if (statement.startsWith('UPDATE users SET haslo_hash')) {
            if (userUpdateError) throw userUpdateError;
            passwordUpdates += 1;
            return { rows: [], rowCount: 1 };
          }
          if (statement === 'COMMIT') {
            committed = true;
            return { rows: [], rowCount: null };
          }
          if (statement === 'ROLLBACK') {
            if (claimedToken && !committed) {
              remainingUses += 1;
              claimedToken = false;
            }
            return { rows: [], rowCount: null };
          }
          throw new Error(`Unexpected query in password reset test: ${statement}`);
        }),
        release: jest.fn(),
      };
      clients.push(client);
      return client;
    });

    return {
      clients,
      get passwordUpdates() {
        return passwordUpdates;
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    pool.connect.mockReset();
    sendSystemEmailOptional.mockReset();
    if (typeof authRoutes.__resetLoginLimiterForTests === 'function') {
      authRoutes.__resetLoginLimiterForTests();
    }
    if (typeof authRoutes.__resetPasswordResetLimitersForTests === 'function') {
      authRoutes.__resetPasswordResetLimitersForTests();
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

  it('returns 401 instead of 500 when stored password hash is missing', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 7,
          login: 'jan',
          haslo_hash: null,
          rola: 'Administrator',
          aktywny: true,
        },
      ],
    });

    const res = await request(app).post('/api/auth/login').send({
      login: 'jan',
      haslo: 'secret123',
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
        policyVersion: 2,
        taskScope: 'all',
        canTransferSpecialists: false,
        canViewPayrollSettlements: true,
        canManagePayrollSettlements: true,
        canViewSettlementModule: true,
        canCreateTasks: true,
        canAssignTeams: true,
        canManageTeams: true,
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

  it('accepts legacy password field for web clients', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          login: 'legacy-web',
          haslo_hash: hash,
          imie: 'Legacy',
          nazwisko: 'Web',
          rola: 'Administrator',
          oddzial_id: null,
          ekipa_id: null,
        },
      ],
    });

    const res = await request(app).post('/api/auth/login').send({
      login: 'legacy-web',
      password: 'secret123',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.login).toBeUndefined();
    expect(res.body.user.rola).toBe('Administrator');
  });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('creates a reset token and sends an email for an active user', async () => {
      sendSystemEmailOptional.mockResolvedValue({ sent: true });
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 7, login: 'jan', imie: 'Jan', email: 'jan@example.com' }],
        })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'jan@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.email).toEqual({ sent: true });
      expect(res.body.dev_reset_url).toContain('/#/login?resetToken=');
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS password_reset_tokens'));
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active'));
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM users'), ['jan@example.com']);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO password_reset_tokens'),
        expect.arrayContaining([7, expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Date)])
      );
      expect(sendSystemEmailOptional).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jan@example.com',
          subject: 'Reset hasla ARBOR-OS',
          text: expect.stringContaining('Kliknij link'),
        })
      );
    });

    it('returns a generic response when account is missing', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'ghost@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.email).toEqual({ sent: true });
      expect(res.body.expires_at).toEqual(expect.any(String));
      expect(res.body.dev_reset_url).toContain('/#/login?resetToken=');
      expect(sendSystemEmailOptional).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('returns the same neutral response shape when an account exists or is missing', async () => {
      sendSystemEmailOptional.mockResolvedValue({ sent: false, skipped: 'no_smtp' });
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 7, login: 'jan', imie: 'Jan', email: 'jan@example.com' }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const existing = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'jan@example.com' });
      const missing = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'ghost@example.com' });

      expect(existing.status).toBe(200);
      expect(missing.status).toBe(200);
      expect(Object.keys(existing.body).sort()).toEqual(Object.keys(missing.body).sort());
      expect(existing.body).toEqual(expect.objectContaining({
        ok: true,
        message: missing.body.message,
        email: missing.body.email,
      }));
      expect(existing.body.email).toEqual({ sent: true });
    });

    it('limits password reset requests independently from login attempts', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      for (let i = 0; i < 5; i += 1) {
        const accepted = await request(app)
          .post('/api/auth/forgot-password')
          .send({ identifier: `ghost-${i}@example.com` });
        expect(accepted.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'another@example.com' });

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blocked.body.error).toBe('Za duzo prob resetu hasla. Sprobuj ponownie pozniej.');
      expect(blocked.headers['retry-after']).toBeDefined();
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('updates password hash and marks the reset token as used', async () => {
      const transaction = mockPasswordResetTransactions();

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'reset-token', haslo: 'nowe-haslo123' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, message: 'Haslo zostalo zmienione. Mozesz sie zalogowac.' });
      expect(transaction.clients).toHaveLength(1);
      expect(transaction.clients[0].query).toHaveBeenCalledWith('BEGIN');
      expect(transaction.clients[0].query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE password_reset_tokens AS prt'),
        [expect.stringMatching(/^[a-f0-9]{64}$/)]
      );
      expect(transaction.clients[0].query).toHaveBeenCalledWith(
        'UPDATE users SET haslo_hash = $1 WHERE id = $2 AND aktywny = true',
        [expect.any(String), 7]
      );
      expect(transaction.clients[0].query).toHaveBeenCalledWith('COMMIT');
      expect(transaction.clients[0].release).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired or invalid reset token', async () => {
      const transaction = mockPasswordResetTransactions({ availableUses: 0 });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'bad-token', haslo: 'nowe-haslo123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Link resetujacy jest nieprawidlowy albo wygasl');
      expect(transaction.clients[0].query).toHaveBeenCalledWith('ROLLBACK');
      expect(transaction.clients[0].release).toHaveBeenCalledTimes(1);
    });

    it('rejects reuse of a token after the first successful password change', async () => {
      const transaction = mockPasswordResetTransactions();
      const payload = { token: 'single-use-token', haslo: 'nowe-haslo123' };

      const first = await request(app).post('/api/auth/reset-password').send(payload);
      const second = await request(app).post('/api/auth/reset-password').send(payload);

      expect(first.status).toBe(200);
      expect(second.status).toBe(400);
      expect(transaction.passwordUpdates).toBe(1);
      expect(transaction.clients).toHaveLength(2);
    });

    it('allows only one of two concurrent requests to consume the same token', async () => {
      const transaction = mockPasswordResetTransactions();
      const payload = { token: 'concurrent-token', haslo: 'nowe-haslo123' };

      const responses = await Promise.all([
        request(app).post('/api/auth/reset-password').send(payload),
        request(app).post('/api/auth/reset-password').send(payload),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
      expect(transaction.passwordUpdates).toBe(1);
      expect(transaction.clients).toHaveLength(2);
      expect(transaction.clients.every((client) => client.release.mock.calls.length === 1)).toBe(true);
    });

    it('rolls back internal failures without exposing database details', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const transaction = mockPasswordResetTransactions({
        userUpdateError: new Error('postgres-password-secret'),
      });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'reset-token', haslo: 'nowe-haslo123' });

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('postgres-password-secret');
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(transaction.clients[0].query).toHaveBeenCalledWith('ROLLBACK');
      expect(transaction.clients[0].release).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it('limits invalid reset confirmations without hashing unaccepted requests', async () => {
      const transaction = mockPasswordResetTransactions({ availableUses: 0 });

      for (let i = 0; i < 10; i += 1) {
        const rejected = await request(app)
          .post('/api/auth/reset-password')
          .send({ token: `invalid-${i}`, haslo: 'nowe-haslo123' });
        expect(rejected.status).toBe(400);
      }

      const blocked = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-last', haslo: 'nowe-haslo123' });

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(transaction.clients).toHaveLength(10);
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
          policyVersion: 2,
          taskScope: 'all',
          canTransferSpecialists: false,
          canViewPayrollSettlements: true,
          canManagePayrollSettlements: true,
          canViewSettlementModule: true,
          canCreateTasks: true,
          canAssignTeams: true,
          canManageTeams: true,
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
            policyVersion: 2,
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
          policyVersion: 2,
          taskScope: 'branch',
          canViewPayrollSettlements: true,
          canManagePayrollSettlements: false,
          canViewSettlementModule: true,
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
