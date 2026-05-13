const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../config/database');
const { authMiddleware, buildAppPermissions } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginLimiter, resetLoginLimiterForTests } = require('../middleware/rate-limit');
const { env } = require('../config/env');
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
    const hasloPoprawne = await bcrypt.compare(haslo, user.haslo_hash);
    if (!hasloPoprawne) {
      return res.status(401).json({
        error: req.t('errors.login.invalidCredentials'),
        code: LOGIN_INVALID_CREDENTIALS,
        requestId: req.requestId,
      });
    }
    const token = jwt.sign(
      { id: user.id, login: user.login, rola: user.rola, oddzial_id: user.oddzial_id },
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
        permissions: buildAppPermissions(user.rola),
      },
    });
  } catch (err) {
    next(err);
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

if (env.NODE_ENV === 'test') {
  router.__resetLoginLimiterForTests = resetLoginLimiterForTests;
}

module.exports = router;