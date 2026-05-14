const crypto = require('crypto');
const { env } = require('../config/env');

const API_BASE = 'https://api.zadarma.com';

function isZadarmaConfigured() {
  return Boolean(env.ZADARMA_API_KEY && env.ZADARMA_API_SECRET);
}

function buildQuery(params = {}) {
  const keys = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort();
  const usp = new URLSearchParams();
  for (const key of keys) usp.append(key, String(params[key]));
  return usp.toString();
}

function signZadarmaPath(path, params = {}) {
  const paramsStr = buildQuery(params);
  const paramsMd5 = crypto.createHash('md5').update(paramsStr).digest('hex');
  return crypto
    .createHmac('sha1', env.ZADARMA_API_SECRET || '')
    .update(`${path}${paramsStr}${paramsMd5}`)
    .digest('base64');
}

async function zadarmaRequest(method, path, params = {}) {
  if (!isZadarmaConfigured()) {
    const error = new Error('Zadarma nie jest skonfigurowana: ustaw ZADARMA_API_KEY i ZADARMA_API_SECRET.');
    error.code = 'ZADARMA_NOT_CONFIGURED';
    throw error;
  }

  const upper = String(method || 'GET').toUpperCase();
  const query = buildQuery(params);
  const signature = signZadarmaPath(path, params);
  const headers = {
    Authorization: `${env.ZADARMA_API_KEY}:${signature}`,
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
  let data = {};
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

function verifyWebhookSignature(body = {}, signatureHeader) {
  if (env.ZADARMA_SKIP_SIGNATURE_VALIDATION) return true;
  if (!env.ZADARMA_API_SECRET) return false;
  const signature = String(signatureHeader || body.signature || '').trim();
  if (!signature) return false;
  const event = String(body.event || '').trim();
  let source = '';
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

module.exports = {
  getWebrtcKey,
  isZadarmaConfigured,
  requestCallback,
  verifyWebhookSignature,
};
