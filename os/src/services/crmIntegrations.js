const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../config/logger');

const APP_TYPES = new Set(['webhook', 'widget', 'api']);

function normalizeAppType(value) {
  const type = String(value || '').trim().toLowerCase();
  return APP_TYPES.has(type) ? type : 'webhook';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function publicToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function ensureCrmIntegrationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_integration_apps (
      id            SERIAL PRIMARY KEY,
      oddzial_id    INTEGER REFERENCES branches(id) ON DELETE CASCADE,
      name          VARCHAR(160) NOT NULL,
      type          VARCHAR(32) NOT NULL DEFAULT 'webhook',
      token         VARCHAR(96) NOT NULL UNIQUE,
      active        BOOLEAN NOT NULL DEFAULT true,
      config        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_apps_oddzial ON crm_integration_apps(oddzial_id, active)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_integration_events (
      id              SERIAL PRIMARY KEY,
      app_id          INTEGER REFERENCES crm_integration_apps(id) ON DELETE SET NULL,
      event_type      VARCHAR(80) NOT NULL,
      status          VARCHAR(32) NOT NULL,
      lead_id         INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
      external_id     VARCHAR(255),
      payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_events_app_created ON crm_integration_events(app_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_integration_events_external ON crm_integration_events(external_id)');
}

function mapApp(row, { includeToken = false } = {}) {
  return {
    id: row.id,
    oddzial_id: row.oddzial_id,
    name: row.name,
    type: normalizeAppType(row.type),
    active: row.active !== false,
    token: includeToken ? row.token : undefined,
    webhook_path: `/api/webhooks/crm/${row.token}`,
    config: row.config || {},
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

async function listIntegrationApps({ oddzialId = null, includeInactive = false } = {}) {
  await ensureCrmIntegrationTables();
  const params = [];
  const where = [];
  if (oddzialId) {
    params.push(oddzialId);
    where.push(`oddzial_id = $${params.length}`);
  }
  if (!includeInactive) where.push('active = true');
  const { rows } = await pool.query(
    `SELECT * FROM crm_integration_apps ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY active DESC, updated_at DESC, id DESC`,
    params
  );
  return rows.map((row) => mapApp(row));
}

async function createIntegrationApp({ oddzialId, name, type, config, userId }) {
  await ensureCrmIntegrationTables();
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO crm_integration_apps (
      oddzial_id, name, type, token, active, config, created_by, created_at, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4,true,$5::jsonb,$6,$7,$8,$9)
    RETURNING *`,
    [
      oddzialId || null,
      String(name || '').trim().slice(0, 160) || 'CRM integration',
      normalizeAppType(type),
      publicToken(),
      JSON.stringify(safeObject(config)),
      userId || null,
      now,
      userId || null,
      now,
    ]
  );
  return mapApp(rows[0], { includeToken: true });
}

async function listIntegrationEvents({ oddzialId = null, limit = 100 } = {}) {
  await ensureCrmIntegrationTables();
  const params = [];
  let where = '';
  if (oddzialId) {
    params.push(oddzialId);
    where = `WHERE a.oddzial_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const { rows } = await pool.query(
    `SELECT e.*, a.name AS app_name, a.oddzial_id
     FROM crm_integration_events e
     LEFT JOIN crm_integration_apps a ON a.id = e.app_id
     ${where}
     ORDER BY e.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function logIntegrationEvent({ appId, eventType, status, leadId = null, externalId = null, payload = {}, error = null }) {
  await ensureCrmIntegrationTables();
  const { rows } = await pool.query(
    `INSERT INTO crm_integration_events (app_id, event_type, status, lead_id, external_id, payload, error, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())
     RETURNING *`,
    [appId || null, String(eventType || 'webhook.received').slice(0, 80), status, leadId, externalId, JSON.stringify(safeObject(payload)), error]
  );
  return rows[0];
}

async function ingestWebhook({ token, payload }) {
  await ensureCrmIntegrationTables();
  const app = (await pool.query('SELECT * FROM crm_integration_apps WHERE token = $1 AND active = true', [token])).rows[0];
  if (!app) return { status: 404, body: { error: 'integration not found' } };
  const body = safeObject(payload);
  const externalId = String(body.external_id || body.id || '').trim() || null;
  const eventType = String(body.event_type || body.type || 'lead.created').trim().slice(0, 80);
  try {
    const leadTitle = String(body.title || body.name || body.client_name || '').trim();
    const messageText = String(body.message || body.body || '').trim();
    let leadId = Number(body.lead_id || 0) || null;

    if (!leadId && leadTitle) {
      const { rows } = await pool.query(
        `INSERT INTO crm_leads (
          title, oddzial_id, owner_user_id, stage, source, value, phone, email, notes, tags,
          created_at, updated_at
        ) VALUES ($1,$2,$3,'Lead',$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
        RETURNING id`,
        [
          leadTitle,
          app.oddzial_id,
          null,
          String(body.source || app.name || 'webhook').trim().slice(0, 50) || 'webhook',
          Number(body.value || 0) || 0,
          String(body.phone || '').trim() || null,
          String(body.email || '').trim() || null,
          String(body.notes || '').trim() || null,
          JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 16) : []),
        ]
      );
      leadId = rows[0]?.id || null;
    }

    if (leadId && messageText) {
      await pool.query(
        `INSERT INTO crm_lead_messages (
          lead_id, channel, direction, sender_name, sender_handle, body, status, external_message_id, metadata, created_at
        ) VALUES ($1,$2,'inbound',$3,$4,$5,'received',$6,$7::jsonb,NOW())`,
        [
          leadId,
          String(body.channel || 'webchat').trim().toLowerCase().slice(0, 32),
          String(body.sender_name || body.client_name || '').trim() || null,
          String(body.sender_handle || body.phone || body.email || '').trim() || null,
          messageText,
          externalId,
          JSON.stringify({ source: 'crm.integration.webhook', app_id: app.id }),
        ]
      );
      await pool.query('UPDATE crm_leads SET updated_at = NOW() WHERE id = $1', [leadId]);
    }

    await logIntegrationEvent({ appId: app.id, eventType, status: 'ok', leadId, externalId, payload: body });
    return { status: 202, body: { ok: true, lead_id: leadId, event_type: eventType } };
  } catch (err) {
    logger.warn('crm.integrations.ingest', { message: err.message, app_id: app.id });
    await logIntegrationEvent({ appId: app.id, eventType, status: 'error', externalId, payload: body, error: err.message });
    return { status: 500, body: { error: 'webhook processing failed' } };
  }
}

module.exports = {
  createIntegrationApp,
  ensureCrmIntegrationTables,
  ingestWebhook,
  listIntegrationApps,
  listIntegrationEvents,
};
