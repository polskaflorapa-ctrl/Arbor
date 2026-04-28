/**
 * Prosty e-mail transakcyjny (SMTP z env) — używany m.in. przez cron F11.5.
 */
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const { env } = require('../config/env');

let cachedTransport = null;

function getTransport() {
  if (!env.SMTP_USER || !env.SMTP_PASS) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: env.SMTP_PORT,
      secure: false,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return cachedTransport;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 * @returns {Promise<{ sent: boolean, skipped?: string, error?: string }>}
 */
async function sendSystemEmailOptional(opts) {
  const to = String(opts.to || '').trim();
  if (!to) return { sent: false, skipped: 'no_to' };
  const t = getTransport();
  if (!t) return { sent: false, skipped: 'no_smtp' };
  try {
    await t.sendMail({
      from: `"ARBOR-OS" <${env.SMTP_USER}>`,
      to,
      subject: String(opts.subject || '').slice(0, 200),
      text: opts.text || '',
      html: opts.html,
    });
    return { sent: true };
  } catch (e) {
    logger.warn('systemEmail.send', { message: e.message, to: to.slice(0, 48) });
    return { sent: false, error: e.message };
  }
}

module.exports = { sendSystemEmailOptional, getTransport };
