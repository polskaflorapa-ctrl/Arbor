const logger = require('../config/logger');
const { env } = require('../config/env');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opcjonalny webhook (WEBHOOK_URL) — fire-and-forget z retry i idempotency key.
 */
const dispatchWebhook = async (event, payload, options = {}) => {
  if (!env.WEBHOOK_URL) return;
  const retries = Math.max(1, Number(options.retries || 1));
  const idempotencyKey =
    options.idempotencyKey || `${event}:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 10)}`;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
    const res = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ event, ...payload, ts: new Date().toISOString(), idempotencyKey }),
    });
    if (!res.ok) {
        logger.warn('Webhook odpowiedz nie-2xx', { status: res.status, event, attempt });
        if (attempt < retries) {
          await sleep(attempt * 500);
          continue;
        }
    }
      return;
    } catch (e) {
      logger.error('Blad webhook', { message: e.message, event, attempt });
      if (attempt < retries) {
        await sleep(attempt * 500);
      }
    }
  }
};

module.exports = { dispatchWebhook };
