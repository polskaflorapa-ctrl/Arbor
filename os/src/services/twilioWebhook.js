const twilio = require('twilio');
const { env } = require('../config/env');

function configuredPublicBaseUrl() {
  const value = String(env.PUBLIC_BASE_URL || '').trim();
  return value ? value.replace(/\/+$/, '') : '';
}

/**
 * Twilio signs the exact public callback URL together with the form payload.
 * A missing token/base URL must never turn signature verification off: an
 * unconfigured provider is a closed endpoint, not an unauthenticated one.
 */
function verifyTwilioWebhookRequest(req) {
  if (env.NODE_ENV !== 'production' && env.TWILIO_SKIP_SIGNATURE_VALIDATION) {
    return { ok: true, skipped: true, reason: 'non_production_override' };
  }

  const authToken = String(env.TWILIO_AUTH_TOKEN || '').trim();
  const publicBaseUrl = configuredPublicBaseUrl();
  const signature = String(req.get('x-twilio-signature') || '').trim();

  if (!authToken || !publicBaseUrl) {
    return { ok: false, skipped: false, reason: 'provider_not_configured' };
  }
  if (!signature) {
    return { ok: false, skipped: false, reason: 'signature_missing' };
  }

  const callbackUrl = `${publicBaseUrl}${req.originalUrl || ''}`;
  try {
    return {
      ok: twilio.validateRequest(authToken, signature, callbackUrl, req.body || {}),
      skipped: false,
      reason: 'signature_checked',
    };
  } catch {
    return { ok: false, skipped: false, reason: 'signature_invalid' };
  }
}

module.exports = { configuredPublicBaseUrl, verifyTwilioWebhookRequest };
