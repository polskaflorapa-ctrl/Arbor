const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../config/database');
const { authMiddleware, buildAppPermissions, isDyrektorOrAdmin } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginLimiter, resetLoginLimiterForTests } = require('../middleware/rate-limit');
const { env } = require('../config/env');
const { sendSystemEmailOptional } = require('../services/systemEmail');
const {
  LOGIN_INVALID_CREDENTIALS,
  USER_NOT_FOUND,
  PASSWORD_OLD_WRONG,
} = require('../constants/error-codes');

const router = express.Router();

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Login jest wymagany'),
  haslo: z.string().min(1, 'Haslo jest wymagane'),
});

const changePasswordSchema = z.object({
  stare_haslo: z.string().min(1, 'Stare haslo jest wymagane'),
  nowe_haslo: z.string().min(8, 'Nowe haslo musi miec min. 8 znakow'),
});

const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Login albo e-mail jest wymagany'),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Token jest wymagany'),
  haslo: z.string().min(8, 'Nowe haslo musi miec min. 8 znakow'),
});

const PASSWORD_RESET_TTL_MINUTES = 30;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function publicAppBaseUrl(req) {
  const configured = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

async function ensurePasswordResetTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active
    ON password_reset_tokens (user_id, expires_at)
    WHERE used_at IS NULL
  `);
}

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { login, haslo } = req.body;
    const result = await pool.query(
      'SELECT * FROM users WHERE login = $1 AND aktywny = true',
      [login]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({
        error: req.t('errors.login.invalidCredentials'),
        code: LOGIN_INVALID_CREDENTIALS,
        requestId: req.requestId,
      });
    }
    const user = result.rows[0];
    if (typeof user.haslo_hash !== 'string' || !user.haslo_hash.trim()) {
      return res.status(401).json({
        error: req.t('errors.login.invalidCredentials'),
        code: LOGIN_INVALID_CREDENTIALS,
        requestId: req.requestId,
      });
    }
    let hasloPoprawne = false;
    try {
      hasloPoprawne = await bcrypt.compare(haslo, user.haslo_hash);
    } catch {
      return res.status(401).json({
        error: req.t('errors.login.invalidCredentials'),
        code: LOGIN_INVALID_CREDENTIALS,
        requestId: req.requestId,
      });
    }
    if (!hasloPoprawne) {
      return res.status(401).json({
        error: req.t('errors.login.invalidCredentials'),
        code: LOGIN_INVALID_CREDENTIALS,
        requestId: req.requestId,
      });
    }
    // Include ekipa_id in JWT for Brygadzista/Pomocnik team-scoped API guards
    const ekipa_id = user.ekipa_id ?? null;
    const token = jwt.sign(
      { id: user.id, login: user.login, rola: user.rola, oddzial_id: user.oddzial_id, ekipa_id },
      env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        imie: user.imie,
        nazwisko: user.nazwisko,
        rola: user.rola,
        oddzial_id: user.oddzial_id,
        ekipa_id,
        permissions: buildAppPermissions(user.rola),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', validateBody(forgotPasswordSchema), async (req, res, next) => {
  const generic = {
    ok: true,
    message: 'Jesli konto istnieje i ma adres e-mail, wyslalismy link resetujacy haslo.',
  };
  try {
    await ensurePasswordResetTable();
    const identifier = req.body.identifier.trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, login, imie, email
       FROM users
       WHERE aktywny = true
         AND (LOWER(login) = $1 OR LOWER(email) = $1)
       LIMIT 1`,
      [identifier]
    );
    const user = rows[0];
    if (!user || !String(user.email || '').trim()) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const resetUrl = `${publicAppBaseUrl(req)}/#/login?resetToken=${encodeURIComponent(token)}`;
    const email = await sendSystemEmailOptional({
      to: user.email,
      subject: 'Reset hasla ARBOR-OS',
      text: [
        `Czesc ${user.imie || user.login || ''},`,
        '',
        'Otrzymalismy prosbe o reset hasla w ARBOR-OS.',
        `Kliknij link, aby ustawic nowe haslo: ${resetUrl}`,
        '',
        `Link jest wazny przez ${PASSWORD_RESET_TTL_MINUTES} minut. Jesli to nie Ty, zignoruj te wiadomosc.`,
      ].join('\n'),
      html: `
        <p>Czesc ${String(user.imie || user.login || '').replace(/[<>&]/g, '')},</p>
        <p>Otrzymalismy prosbe o reset hasla w ARBOR-OS.</p>
        <p><a href="${resetUrl}">Ustaw nowe haslo</a></p>
        <p>Link jest wazny przez ${PASSWORD_RESET_TTL_MINUTES} minut. Jesli to nie Ty, zignoruj te wiadomosc.</p>
      `,
    });

    const response = { ...generic, email, expires_at: expiresAt.toISOString() };
    if (env.NODE_ENV !== 'production') response.dev_reset_url = resetUrl;
    return res.json(response);
  } catch (err) {
    return next(err);
  }
});

router.post('/reset-password', validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    await ensurePasswordResetTable();
    const tokenHash = sha256(req.body.token);
    const { rows } = await pool.query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > NOW()
         AND u.aktywny = true
       LIMIT 1`,
      [tokenHash]
    );
    const reset = rows[0];
    if (!reset) {
      return res.status(400).json({
        error: 'Link resetujacy jest nieprawidlowy albo wygasl',
        requestId: req.requestId,
      });
    }

    const newHash = await bcrypt.hash(req.body.haslo, 12);
    await pool.query('UPDATE users SET haslo_hash = $1 WHERE id = $2', [newHash, reset.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [reset.id]);
    return res.json({ ok: true, message: 'Haslo zostalo zmienione. Mozesz sie zalogowac.' });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, login, imie, nazwisko, email, telefon, rola, oddzial_id FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: req.t('errors.user.notFound'),
        code: USER_NOT_FOUND,
        requestId: req.requestId,
      });
    }
    res.json({
      ...result.rows[0],
      permissions: buildAppPermissions(result.rows[0].rola),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/permissions', authMiddleware, (req, res) => {
  res.json({
    userId: req.user.id,
    rola: req.user.rola,
    permissions: buildAppPermissions(req.user.rola),
  });
});

router.put('/zmien-haslo', authMiddleware, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    const { stare_haslo, nowe_haslo } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: req.t('errors.user.notFound'),
        code: USER_NOT_FOUND,
        requestId: req.requestId,
      });
    }
    const user = result.rows[0];
    const hasloPoprawne = await bcrypt.compare(stare_haslo, user.haslo_hash);
    if (!hasloPoprawne) {
      return res.status(401).json({
        error: req.t('errors.password.oldWrong'),
        code: PASSWORD_OLD_WRONG,
        requestId: req.requestId,
      });
    }
    const nowyHash = await bcrypt.hash(nowe_haslo, 12);
    await pool.query('UPDATE users SET haslo_hash = $1 WHERE id = $2', [nowyHash, req.user.id]);
    res.json({ message: req.t('messages.passwordChanged') });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/pomocnicy
 * Returns active workers (Pomocnik / Pomocnik bez doświadczenia / Brygadzista / Specjalista)
 * scoped to the requesting user's branch. Dyrektor/Admin see all branches.
 */
router.get('/pomocnicy', authMiddleware, async (req, res, next) => {
  try {
    const isGlobal = isDyrektorOrAdmin(req.user);
    const WORKER_ROLES = [
      'Pomocnik', 'Pomocnik bez doświadczenia', 'Brygadzista', 'Specjalista'
    ];
    const placeholders = WORKER_ROLES.map((_, i) => `$${i + 1}`).join(', ');
    let query, params;
    if (isGlobal) {
      query = `SELECT id, imie, nazwisko, rola, stawka_godzinowa
               FROM users
               WHERE rola IN (${placeholders}) AND aktywny = true
               ORDER BY rola, nazwisko, imie`;
      params = WORKER_ROLES;
    } else {
      query = `SELECT id, imie, nazwisko, rola, stawka_godzinowa
               FROM users
               WHERE rola IN (${placeholders}) AND aktywny = true
               AND oddzial_id = $${WORKER_ROLES.length + 1}
               ORDER BY rola, nazwisko, imie`;
      params = [...WORKER_ROLES, req.user.oddzial_id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

if (env.NODE_ENV === 'test') {
  router.__resetLoginLimiterForTests = resetLoginLimiterForTests;
}

module.exports = router;
