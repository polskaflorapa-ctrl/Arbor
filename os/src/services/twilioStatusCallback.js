const { env } = require('../config/env');

/** URL dla Twilio Status Callback (SMS) — musi być zgodny z `PUBLIC_BASE_URL` w verify podpisu. */
function getTwilioSmsStatusCallbackUrl() {
  const base = env.PUBLIC_BASE_URL;
  if (!base || typeof base !== 'string' || !base.trim()) return undefined;
  return `${base.trim().replace(/\/$/, '')}/api/sms/webhooks/status`;
}

module.exports = { getTwilioSmsStatusCallbackUrl };
