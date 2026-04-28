/**
 * F11.8 — wysyłka przez Expo Push API (HTTPS, bez zależności expo-server-sdk).
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */
const https = require('https');
const logger = require('../config/logger');
const { env } = require('../config/env');

const EXPO_PUSH_URL = 'exp.host';
const EXPO_PUSH_PATH = '/--/api/v2/push/send';
const MAX_PER_REQUEST = 100;

/**
 * @param {Array<{ to: string, title?: string, body?: string, data?: object, sound?: string, channelId?: string }>} messages
 */
function sendExpoPushBatch(messages) {
  if (!messages.length) return Promise.resolve({ data: [] });
  const body = JSON.stringify(messages);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  };
  if (env.EXPO_ACCESS_TOKEN && String(env.EXPO_ACCESS_TOKEN).trim()) {
    headers.Authorization = `Bearer ${String(env.EXPO_ACCESS_TOKEN).trim()}`;
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: EXPO_PUSH_URL,
        path: EXPO_PUSH_PATH,
        method: 'POST',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error('Expo push timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * @param {Array<{ to: string, title?: string, body?: string, data?: object, sound?: string, channelId?: string }>} messages
 */
async function sendExpoPushMessages(messages) {
  const androidChannelId = 'default';
  const normalized = messages
    .map((m) => ({
      to: String(m.to || '').trim(),
      title: m.title,
      body: m.body,
      data: m.data && typeof m.data === 'object' ? m.data : {},
      sound: m.sound || 'default',
      channelId: m.channelId || androidChannelId,
    }))
    .filter((m) => m.to);
  if (!normalized.length) return;
  for (let i = 0; i < normalized.length; i += MAX_PER_REQUEST) {
    const slice = normalized.slice(i, i + MAX_PER_REQUEST);
    try {
      const out = await sendExpoPushBatch(slice);
      if (out.data && Array.isArray(out.data)) {
        for (const row of out.data) {
          if (row.status === 'error' && row.message) {
            logger.warn('expo.push.ticket', { message: row.message, details: row.details });
          }
        }
      }
      if (out.errors && out.errors.length) {
        logger.warn('expo.push.batch', { errors: out.errors });
      }
    } catch (e) {
      logger.warn('expo.push.http', { message: e.message });
    }
  }
}

/**
 * @param {string[]} expoTokens — unikalne, format Expo
 * @param {{ title: string, body: string, data?: object }} payload
 */
async function sendExpoPushToTokens(expoTokens, payload) {
  const uniq = [...new Set(expoTokens.map((t) => String(t || '').trim()).filter(Boolean))];
  if (!uniq.length) return;
  await sendExpoPushMessages(
    uniq.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data,
    }))
  );
}

module.exports = { sendExpoPushToTokens, sendExpoPushMessages, sendExpoPushBatch };
