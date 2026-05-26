/**
 * twilioSms.js — zachowany dla wstecznej zgodności.
 * Wywołania są przekierowywane do smsGateway, który obsługuje
 * zarówno Zadarma (priorytet) jak i Twilio (fallback).
 */
const { sendSmsGateway } = require('./smsGateway');

// Re-exported for backward compatibility — internal implementation lives in smsGateway
function normalizePlPhone(raw) {
  const d = String(raw || '').replace(/[\s-]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  const n = d.replace(/^\+?48/, '');
  if (n.length < 9) return null;
  return `+48${n}`;
}

/**
 * Wysyłka SMS; brak konfiguracji = cichy no-op.
 * @returns {Promise<{ ok: boolean, sid?: string, error?: string }>}
 */
async function sendSmsOptional({ to, body, taskId }) {
  return sendSmsGateway({ to, body, taskId });
}

module.exports = { sendSmsOptional, normalizePlPhone };
