const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { RATE_LIMIT_EXCEEDED, LOGIN_TOO_MANY_ATTEMPTS } = require('../constants/error-codes');

const windowMs = env.RATE_LIMIT_WINDOW_MS || 60_000;
const max = env.RATE_LIMIT_MAX || 40;

/**
 * Limit dla kosztownych tras (AI, SMS, PDF, telefon / Twilio Voice) — per IP.
 */
const costlyApiLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Za duzo zadan. Sprobuj ponownie za chwile.',
      code: RATE_LIMIT_EXCEEDED,
      requestId: req.requestId,
    });
  },
});

/**
 * Limit logowania — 10 prób / 15 min / IP. Standardowy mechanizm z express-rate-limit
 * (zamiast ręcznego Map() w pamięci) — działa z `app.set('trust proxy')`,
 * zwraca standardowe nagłówki RateLimit-* i Retry-After.
 *
 * Uwaga: store jest in-memory (jedna instancja). Dla skali poziomej podpiąć
 * `rate-limit-redis` przez ENV (TODO).
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginLimiterStore = new rateLimit.MemoryStore();
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX_ATTEMPTS,
  store: loginLimiterStore,
  standardHeaders: true,
  legacyHeaders: false,
  // Tryb testowy — testy mogą wyłączyć limit przez ENV.
  skip: () => String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true',
  handler: (req, res) => {
    res.status(429).json({
      error: req.t ? req.t('errors.login.tooManyAttempts') : 'Za duzo prob logowania.',
      code: LOGIN_TOO_MANY_ATTEMPTS,
      requestId: req.requestId,
    });
  },
});

/**
 * Reset limitera dla testów. express-rate-limit v8 udostępnia `resetKey(key)`,
 * ale `resetAll()` wymaga dostępu do store. Najprostsze API: kasuje cały
 * domyślny MemoryStore przez przeładowanie limitera nie da się bez restartu modułu,
 * więc testy powinny ustawiać `RATE_LIMIT_DISABLED=true` w setupie.
 * Funkcja pozostawiona dla kompatybilności wstecznej z istniejącym kodem.
 */
const resetLoginLimiterForTests = () => {
  if (env.NODE_ENV !== 'test') return undefined;
  return loginLimiterStore.resetAll();
};

module.exports = { costlyApiLimiter, loginLimiter, resetLoginLimiterForTests };
