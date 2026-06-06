const crypto = require('crypto');
const { env } = require('../config/env');
const { decryptedSecret, getProviderSettings, maskSecret } = require('./provider-settings');

const API_BASE = 'https://api.zadarma.com';

function isZadarmaConfigured() {
  return Boolean(env.ZADARMA_API_KEY && env.ZADARMA_API_SECRET);
}

async function getZadarmaRuntimeConfig() {
  if (env.ZADARMA_API_KEY && env.ZADARMA_API_SECRET) {
    return {
      apiKey: env.ZADARMA_API_KEY,
      apiSecret: env.ZADARMA_API_SECRET,
      callerId: env.ZADARMA_CALLER_ID || '',
      source: 'env',
      updated_at: null,
      apiKeyMasked: maskSecret(env.ZADARMA_API_KEY),
      apiSecretMasked: maskSecret(env.ZADARMA_API_SECRET),
    };
  }
  const settings = await getProviderSettings('zadarma');
  const apiKey = decryptedSecret(settings, 'api_key');
  const apiSecret = decryptedSecret(settings, 'api_secret');
  return {
    apiKey,
    apiSecret,
    callerId: settings.config?.caller_id || '',
    source: apiKey && apiSecret ? 'database' : null,
    updated_at: settings.updated_at,
    apiKeyMasked: settings.secrets?.api_key ? maskSecret(apiKey) : null,
    apiSecretMasked: settings.secrets?.api_secret ? maskSecret(apiSecret) : null,
  };
}

async function isZadarmaConfiguredAsync() {
  const config = await getZadarmaRuntimeConfig();
  return Boolean(config.apiKey && config.apiSecret);
}

function buildQuery(params = {}) {
  const keys = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort();
  const usp = new URLSearchParams();
  for (const key of keys) usp.append(key, String(params[key]));
  return usp.toString();
}

function signZadarmaPath(path, params = {}, secret = env.ZADARMA_API_SECRET || '') {
  const paramsStr = buildQuery(params);
  const paramsMd5 = crypto.createHash('md5').update(paramsStr).digest('hex');
  const hmacHex = crypto
    .createHmac('sha1', secret)
    .update(`${path}${paramsStr}${paramsMd5}`)
    .digest('hex');
  return Buffer.from(hmacHex).toString('base64');
}

async function zadarmaRequest(method, path, params = {}) {
  const config = await getZadarmaRuntimeConfig();
  if (!config.apiKey || !config.apiSecret) {
    const error = new Error('Zadarma nie jest skonfigurowana: ustaw ZADARMA_API_KEY i ZADARMA_API_SECRET.');
    error.code = 'ZADARMA_NOT_CONFIGURED';
    throw error;
  }

  const upper = String(method || 'GET').toUpperCase();
  const query = buildQuery(params);
  const signature = signZadarmaPath(path, params, config.apiSecret);
  const headers = {
    Authorization: `${config.apiKey}:${signature}`,
    Accept: 'application/json',
  };

  const url = new URL(`${API_BASE}${path}`);
  const init = { method: upper, headers };
  if (upper === 'GET' || upper === 'DELETE') {
    if (query) url.search = query;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = query;
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data.status === 'error') {
    const error = new Error(data.message || `Zadarma API HTTP ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function requestCallback({ from, to }) {
  return zadarmaRequest('GET', '/v1/request/callback/', { from, to });
}

function getWebrtcKey({ sip }) {
  return zadarmaRequest('GET', '/v1/webrtc/get_key/', { sip });
}

function requestPbxRecord({ callId, pbxCallId }) {
  const params = {};
  if (callId) params.call_id = callId;
  else if (pbxCallId) params.pbx_call_id = pbxCallId;
  return zadarmaRequest('GET', '/v1/pbx/record/request/', params);
}

function extractPbxRecordUrl(data = {}) {
  const direct = data.record_url || data.recordUrl || data.url || data.link || data.download_url || data.downloadUrl;
  if (direct) return String(direct);
  const urls = data.record_urls || data.recordUrls || data.records || data.files;
  if (Array.isArray(urls)) {
    const first = urls.find(Boolean);
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      return String(first.url || first.link || first.download_url || first.downloadUrl || '');
    }
  }
  const result = data.result;
  if (result && typeof result === 'object') return extractPbxRecordUrl(result);
  return '';
}

function verifyWebhookSignature(body = {}, signatureHeader) {
  if (env.ZADARMA_SKIP_SIGNATURE_VALIDATION) return true;
  if (!env.ZADARMA_API_SECRET) return false;
  const signature = String(signatureHeader || body.signature || '').trim();
  if (!signature) return false;
  const event = String(body.event || '').trim();
  let source;
  if (event === 'NOTIFY_RECORD') {
    source = `${body.pbx_call_id || ''}${body.call_id_with_rec || ''}`;
  } else if (event === 'NOTIFY_OUT_START' || event === 'NOTIFY_OUT_END') {
    source = `${body.internal || ''}${body.destination || ''}${body.call_start || ''}`;
  } else if (event === 'NOTIFY_ANSWER') {
    source = `${body.caller_id || ''}${body.destination || ''}${body.call_start || ''}`;
  } else {
    source = `${body.caller_id || ''}${body.called_did || ''}${body.call_start || ''}`;
  }
  const expected = crypto.createHmac('sha1', env.ZADARMA_API_SECRET).update(source).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function verifyWebhookSignatureAsync(body = {}, signatureHeader) {
  if (env.ZADARMA_SKIP_SIGNATURE_VALIDATION) return true;
  const config = await getZadarmaRuntimeConfig();
  if (!config.apiSecret) return false;
  const signature = String(signatureHeader || body.signature || '').trim();
  if (!signature) return false;
  const event = String(body.event || '').trim();
  let source;
  if (event === 'NOTIFY_RECORD') {
    source = `${body.pbx_call_id || ''}${body.call_id_with_rec || ''}`;
  } else if (event === 'NOTIFY_OUT_START' || event === 'NOTIFY_OUT_END') {
    source = `${body.internal || ''}${body.destination || ''}${body.call_start || ''}`;
  } else if (event === 'NOTIFY_ANSWER') {
    source = `${body.caller_id || ''}${body.destination || ''}${body.call_start || ''}`;
  } else {
    source = `${body.caller_id || ''}${body.called_did || ''}${body.call_start || ''}`;
  }
  const expected = crypto.createHmac('sha1', config.apiSecret).update(source).digest('base64');
  return timingSafeSignatureEqual(signature, expected);
}

function timingSafeSignatureEqual(signature, expected) {
  try {
    const actualBuffer = Buffer.from(String(signature || '').trim());
    const expectedBuffer = Buffer.from(String(expected || '').trim());
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function zadarmaHmacSha1(source) {
  return crypto.createHmac('sha1', env.ZADARMA_API_SECRET).update(source).digest('base64');
}

async function zadarmaHmacSha1Async(source) {
  const config = await getZadarmaRuntimeConfig();
  if (!config.apiSecret) return null;
  return crypto.createHmac('sha1', config.apiSecret).update(source).digest('base64');
}

function zadarmaSmsStatusSignatureSources(body = {}) {
  const sources = [];
  const result = body.result != null ? String(body.result) : '';
  if (result) sources.push(result);

  const messageId = String(body.message_id || body.messageId || body.sms_id || body.smsId || body.id || body.sid || '').trim();
  const status = String(body.status || body.sms_status || body.message_status || body.delivery_status || body.event || '').trim();
  const errorCode = String(body.error_code || body.code || '').trim();
  const errorMessage = String(body.error_message || body.error || body.reason || body.message || '').trim();
  if (messageId && status) {
    sources.push(`${messageId}${status}${errorCode}${errorMessage}`);
  }

  return [...new Set(sources.filter(Boolean))];
}

function verifySmsStatusWebhookSignature(body = {}, signatureHeader) {
  if (env.ZADARMA_SKIP_SIGNATURE_VALIDATION) return true;
  if (!env.ZADARMA_API_SECRET) return false;
  const signature = String(signatureHeader || body.signature || '').trim();
  if (!signature) return false;

  const sources = zadarmaSmsStatusSignatureSources(body);
  if (!sources.length) return false;

  return sources.some((source) => timingSafeSignatureEqual(signature, zadarmaHmacSha1(source)));
}

async function verifySmsStatusWebhookSignatureAsync(body = {}, signatureHeader) {
  if (env.ZADARMA_SKIP_SIGNATURE_VALIDATION) return true;
  const signature = String(signatureHeader || body.signature || '').trim();
  if (!signature) return false;
  const sources = zadarmaSmsStatusSignatureSources(body);
  if (!sources.length) return false;
  const expected = await Promise.all(sources.map((source) => zadarmaHmacSha1Async(source)));
  return expected.filter(Boolean).some((value) => timingSafeSignatureEqual(signature, value));
}

/**
 * Wysyła SMS przez Zadarma.
 * POST /v1/sms/send/
 * Docs: https://zadarma.com/pl/support/api/#API_sms_send
 *
 * Parametry API:
 *   number    – numer docelowy (format międzynarodowy)
 *   message   – treść SMS
 *   sender_id – (opcjonalny) identyfikator nadawcy
 *
 * Odpowiedź: { status, message_id, cost, currency }
 *
 * @param {object} opts
 * @param {string} opts.to   - numer docelowy (E.164, np. +48600123456)
 * @param {string} opts.body - treść SMS (max 640 znaków)
 * @returns {Promise<{ ok: boolean, message_id?: string, error?: string }>}
 */
async function sendSms({ to, body, senderId }) {
  const number = normalizePhone(to);
  if (!number) return { ok: false, error: `Nieprawidłowy numer telefonu: ${to}` };

  const params = {
    message: String(body || '').slice(0, 640),
    number,
  };
  // sender_id — identyfikator nadawcy widoczny u odbiorcy (max 11 znaków alfanum.)
  const config = await getZadarmaRuntimeConfig();
  const sender = String(senderId || config.callerId || env.ZADARMA_CALLER_ID || '').trim();
  if (sender) params.sender_id = sender;

  try {
    const data = await zadarmaRequest('POST', '/v1/sms/send/', params);
    const detail = Array.isArray(data.sms_detalization) ? data.sms_detalization[0] : null;
    const denied = Array.isArray(data.denied_numbers) ? data.denied_numbers[0] : null;
    if (denied) {
      return {
        ok: false,
        error: denied.message || data.message || 'Zadarma odrzucila numer SMS',
        cost: data.cost,
        currency: data.currency,
      };
    }
    return {
      ok: true,
      message_id: String(data.message_id || data.sms_id || detail?.message_id || detail?.sms_id || ''),
      cost: data.cost ?? detail?.cost,
      currency: data.currency,
    };
  } catch (e) {
    if (e.code === 'ZADARMA_NOT_CONFIGURED') return { ok: false, error: e.message };
    return { ok: false, error: e.message || 'Błąd Zadarma SMS' };
  }
}

function normalizePhone(raw) {
  const d = String(raw || '').replace(/[\s\-()]/g, '');
  if (!d) return null;
  if (/^\+\d{7,15}$/.test(d)) return d;           // już E.164
  const stripped = d.replace(/^00/, '');
  if (/^48\d{9}$/.test(stripped)) return `+${stripped}`;  // 48...
  if (/^\d{9}$/.test(stripped)) return `+48${stripped}`;  // PL local
  return null;
}

module.exports = {
  getWebrtcKey,
  getZadarmaRuntimeConfig,
  extractPbxRecordUrl,
  isZadarmaConfigured,
  isZadarmaConfiguredAsync,
  normalizePhone,
  requestPbxRecord,
  requestCallback,
  sendSms,
  signZadarmaPath,
  verifySmsStatusWebhookSignatureAsync,
  verifySmsStatusWebhookSignature,
  verifyWebhookSignatureAsync,
  verifyWebhookSignature,
  zadarmaRequest,
};
