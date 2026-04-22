const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { RATE_LIMIT_EXCEEDED } = require('../constants/error-codes');

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

module.exports = { costlyApiLimiter };
