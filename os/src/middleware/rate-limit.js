const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { RATE_LIMIT_EXCEEDED, LOGIN_TOO_MANY_ATTEMPTS } = require('../constants/error-codes');

const windowMs = env.RATE_LIMIT_WINDOW_MS || 60_000;
const max = env.RATE_LIMIT_MAX || 40;

function resolveRedisStoreConstructor(redisStorePackage) {
  let RedisStore =
    redisStorePackage.RedisStore ||
    redisStorePackage.default ||
    redisStorePackage;

  while (RedisStore && typeof RedisStore === 'object' && RedisStore.default) {
    RedisStore = RedisStore.default;
  }

  if (typeof RedisStore !== 'function') {
    throw new TypeError('RedisStore export is not a constructor');
  }

  return RedisStore;
}

function createRedisStore(prefix) {
  if (env.RATE_LIMIT_STORE !== 'redis') {
    return new rateLimit.MemoryStore();
  }

  if (!env.RATE_LIMIT_REDIS_URL) {
    console.warn(
      `[rate-limit] RATE_LIMIT_STORE=redis but RATE_LIMIT_REDIS_URL is missing. Falling back to in-memory store.`
    );
    return new rateLimit.MemoryStore();
  }

  try {
    const { createClient } = require('redis');
    const redisStorePackage = require('rate-limit-redis');
    const RedisStore = resolveRedisStoreConstructor(redisStorePackage);
    const client = createClient({ url: env.RATE_LIMIT_REDIS_URL });

    let ready = Promise.resolve();
    if (typeof client.connect === 'function' && !client.isOpen) {
      ready = client.connect().catch((error) => {
        const detail = error && error.message ? error.message : String(error);
        console.warn(`[rate-limit] Failed to connect Redis client: ${detail}`);
      });
    }

    return new RedisStore({
      prefix: `arbor:rl:${prefix}:`,
      sendCommand: async (...command) => {
        await ready;
        return client.sendCommand(command);
      },
    });
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    console.warn(`[rate-limit] Redis store unavailable: ${detail}. Falling back to in-memory store.`);
    return new rateLimit.MemoryStore();
  }
}

/**
 * Limit dla kosztownych tras (AI, SMS, PDF, telefon / Twilio Voice) - per IP.
 */
const costlyApiLimiterStore = createRedisStore('costly');
const costlyApiLimiter = rateLimit({
  windowMs,
  max,
  store: costlyApiLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: (req, res) => {
    res.status(429).json({
      error: 'Za duzo zadan. Sprobuj ponownie za chwile.',
      code: RATE_LIMIT_EXCEEDED,
      requestId: req.requestId,
    });
  },
});

const publicTokenLimiterStore = createRedisStore('public');
const publicTokenLimiter = rateLimit({
  windowMs,
  max: env.PUBLIC_TOKEN_RATE_LIMIT_MAX || Math.max(max, 120),
  store: publicTokenLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: (req, res) => {
    res.status(429).json({
      error: 'Za duzo zadan. Sprobuj ponownie za chwile.',
      code: RATE_LIMIT_EXCEEDED,
      requestId: req.requestId,
    });
  },
});

const webhookLimiterStore = createRedisStore('webhook');
const webhookLimiter = rateLimit({
  windowMs,
  max: env.WEBHOOK_RATE_LIMIT_MAX || Math.max(max, 240),
  store: webhookLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: (req, res) => {
    res.status(429).json({
      error: 'Za duzo zadan. Sprobuj ponownie za chwile.',
      code: RATE_LIMIT_EXCEEDED,
      requestId: req.requestId,
    });
  },
});

function createAuthLimiterStore(prefix = 'login') {
  if (env.LOGIN_RATE_LIMIT_STORE !== 'redis') {
    return new rateLimit.MemoryStore();
  }

  if (!env.LOGIN_RATE_LIMIT_REDIS_URL) {
    console.warn(
      '[rate-limit] LOGIN_RATE_LIMIT_STORE=redis but LOGIN_RATE_LIMIT_REDIS_URL is missing. Falling back to in-memory store.'
    );
    return new rateLimit.MemoryStore();
  }

  try {
    const { createClient } = require('redis');
    const redisStorePackage = require('rate-limit-redis');
    const RedisStore = resolveRedisStoreConstructor(redisStorePackage);
    const client = createClient({ url: env.LOGIN_RATE_LIMIT_REDIS_URL });

    let ready = Promise.resolve();
    if (typeof client.connect === 'function' && !client.isOpen) {
      ready = client.connect().catch((error) => {
        const detail = error && error.message ? error.message : String(error);
        console.warn(`[rate-limit] Failed to connect login limiter Redis client: ${detail}`);
      });
    }

    return new RedisStore({
      prefix: `arbor:rl:${prefix}:`,
      sendCommand: async (...command) => {
        await ready;
        return client.sendCommand(command);
      },
    });
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    console.warn(`[rate-limit] Redis login limiter store unavailable: ${detail}. Falling back to in-memory store.`);
    return new rateLimit.MemoryStore();
  }
}

const createLoginLimiterStore = () => createAuthLimiterStore('login');

/**
 * Limit logowania - 10 prob / 15 min / IP.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginLimiterStore = createLoginLimiterStore();
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX_ATTEMPTS,
  store: loginLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  // Tryb testowy - testy moga wylaczyc limit przez ENV.
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: (req, res) => {
    res.status(429).json({
      error: req.t ? req.t('errors.login.tooManyAttempts') : 'Za duzo prob logowania.',
      code: LOGIN_TOO_MANY_ATTEMPTS,
      requestId: req.requestId,
    });
  },
});

const PASSWORD_RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_REQUEST_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_CONFIRM_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_CONFIRM_MAX_ATTEMPTS = 10;

const passwordResetLimitHandler = (req, res) => {
  res.status(429).json({
    error: 'Za duzo prob resetu hasla. Sprobuj ponownie pozniej.',
    code: RATE_LIMIT_EXCEEDED,
    requestId: req.requestId,
  });
};

/**
 * Osobne buckety ograniczaja zarowno wysylke wiadomosci resetujacych, jak i
 * zgadywanie tokenow. Korzystaja z tej samej konfiguracji Redis co logowanie.
 */
const forgotPasswordLimiterStore = createAuthLimiterStore('forgot-password');
const forgotPasswordLimiter = rateLimit({
  windowMs: PASSWORD_RESET_REQUEST_WINDOW_MS,
  max: PASSWORD_RESET_REQUEST_MAX_ATTEMPTS,
  store: forgotPasswordLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: passwordResetLimitHandler,
});

const resetPasswordLimiterStore = createAuthLimiterStore('reset-password');
const resetPasswordLimiter = rateLimit({
  windowMs: PASSWORD_RESET_CONFIRM_WINDOW_MS,
  max: PASSWORD_RESET_CONFIRM_MAX_ATTEMPTS,
  store: resetPasswordLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: passwordResetLimitHandler,
});

/**
 * Reset limitera dla testow.
 * Przy RedisStore resetAll moze byc niedostepne, dlatego bezpieczny fallback.
 */
const resetLoginLimiterForTests = () => {
  if (env.NODE_ENV !== 'test') return undefined;
  if (typeof loginLimiterStore.resetAll !== 'function') return undefined;
  return loginLimiterStore.resetAll();
};

const resetPasswordResetLimitersForTests = () => {
  if (env.NODE_ENV !== 'test') return undefined;
  for (const store of [forgotPasswordLimiterStore, resetPasswordLimiterStore]) {
    if (typeof store.resetAll === 'function') store.resetAll();
  }
  return undefined;
};

module.exports = {
  costlyApiLimiter,
  forgotPasswordLimiter,
  loginLimiter,
  publicTokenLimiter,
  resetLoginLimiterForTests,
  resetPasswordLimiter,
  resetPasswordResetLimitersForTests,
  webhookLimiter,
  __createAuthLimiterStore: createAuthLimiterStore,
  __createLoginLimiterStore: createLoginLimiterStore,
};
