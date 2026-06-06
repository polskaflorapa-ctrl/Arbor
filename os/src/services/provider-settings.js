const crypto = require('crypto');
const pool = require('../config/database');
const { env } = require('../config/env');

function encryptionKey() {
  return crypto.createHash('sha256').update(String(env.JWT_SECRET || 'dev-insecure-secret')).digest();
}

function encryptSecret(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const [version, ivB64, tagB64, encryptedB64] = raw.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !encryptedB64) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

async function ensureProviderSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_settings (
      provider VARCHAR(40) PRIMARY KEY,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      secrets_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}

async function getProviderSettings(provider) {
  await ensureProviderSettingsTable();
  const result = await pool.query('SELECT * FROM provider_settings WHERE provider = $1', [provider]);
  const row = result.rows[0] || null;
  return {
    provider,
    config: row?.config_json || {},
    secrets: row?.secrets_json || {},
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
  };
}

async function saveProviderSettings(provider, { config = {}, secrets = {}, updatedBy = null } = {}) {
  await ensureProviderSettingsTable();
  const current = await getProviderSettings(provider);
  const nextConfig = { ...(current.config || {}), ...(config || {}) };
  const nextSecrets = { ...(current.secrets || {}) };
  for (const [key, value] of Object.entries(secrets || {})) {
    const text = String(value || '').trim();
    if (text) nextSecrets[key] = encryptSecret(text);
  }
  const result = await pool.query(
    `INSERT INTO provider_settings (provider, config_json, secrets_json, updated_by, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, NOW(), NOW())
     ON CONFLICT (provider)
     DO UPDATE SET
       config_json = EXCLUDED.config_json,
       secrets_json = EXCLUDED.secrets_json,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [provider, JSON.stringify(nextConfig), JSON.stringify(nextSecrets), updatedBy],
  );
  return result.rows[0];
}

function decryptedSecret(settings, key) {
  return decryptSecret(settings?.secrets?.[key]);
}

module.exports = {
  decryptedSecret,
  ensureProviderSettingsTable,
  getProviderSettings,
  maskSecret,
  saveProviderSettings,
};
