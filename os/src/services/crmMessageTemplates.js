const pool = require('../config/database');

const TEMPLATE_CHANNELS = new Set(['whatsapp', 'instagram', 'facebook', 'messenger', 'telegram', 'email', 'sms', 'phone', 'webchat', 'other']);

function normalizeChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return TEMPLATE_CHANNELS.has(channel) ? channel : 'other';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractVariables(text) {
  const vars = new Set();
  String(text || '').replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key) => {
    vars.add(key);
    return '';
  });
  return [...vars];
}

function renderTemplate(text, fields) {
  const data = safeObject(fields);
  return String(text || '').replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key) => {
    const value = data[key];
    return value == null ? '' : String(value);
  });
}

async function ensureCrmMessageTemplateTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_message_templates (
      id            SERIAL PRIMARY KEY,
      oddzial_id    INTEGER REFERENCES branches(id) ON DELETE CASCADE,
      key           VARCHAR(100) NOT NULL,
      name          VARCHAR(160) NOT NULL,
      channel       VARCHAR(32) NOT NULL DEFAULT 'other',
      subject       VARCHAR(255),
      body          TEXT NOT NULL,
      variables     JSONB NOT NULL DEFAULT '[]'::jsonb,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (oddzial_id, key)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_message_templates_oddzial ON crm_message_templates(oddzial_id, active)');
}

function mapTemplate(row) {
  return {
    id: row.id,
    oddzial_id: row.oddzial_id,
    key: row.key,
    name: row.name,
    channel: normalizeChannel(row.channel),
    subject: row.subject,
    body: row.body,
    variables: Array.isArray(row.variables) ? row.variables : row.variables || [],
    active: row.active !== false,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

async function listTemplates({ oddzialId = null, channel = null, includeGlobal = true } = {}) {
  await ensureCrmMessageTemplateTable();
  const params = [];
  const where = ['active = true'];
  if (oddzialId && includeGlobal) {
    params.push(oddzialId);
    where.push(`(oddzial_id = $${params.length} OR oddzial_id IS NULL)`);
  } else if (oddzialId) {
    params.push(oddzialId);
    where.push(`oddzial_id = $${params.length}`);
  }
  if (channel) {
    params.push(normalizeChannel(channel));
    where.push(`channel = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT * FROM crm_message_templates WHERE ${where.join(' AND ')} ORDER BY oddzial_id NULLS FIRST, channel, name`,
    params
  );
  return rows.map(mapTemplate);
}

async function createTemplate({ oddzialId, key, name, channel, subject = null, body, userId }) {
  await ensureCrmMessageTemplateTable();
  const cleanBody = String(body || '').trim();
  const cleanKey = String(key || name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  const now = new Date().toISOString();
  const variables = extractVariables(`${subject || ''}\n${cleanBody}`);
  const { rows } = await pool.query(
    `INSERT INTO crm_message_templates (
      oddzial_id, key, name, channel, subject, body, variables, active, created_by, created_at, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,true,$8,$9,$10,$11)
    RETURNING *`,
    [
      oddzialId || null,
      cleanKey || `template_${Date.now()}`,
      String(name || '').trim().slice(0, 160) || 'Szablon CRM',
      normalizeChannel(channel),
      String(subject || '').trim() || null,
      cleanBody,
      JSON.stringify(variables),
      userId || null,
      now,
      userId || null,
      now,
    ]
  );
  return mapTemplate(rows[0]);
}

async function renderTemplateById({ templateId, fields }) {
  await ensureCrmMessageTemplateTable();
  const row = (await pool.query('SELECT * FROM crm_message_templates WHERE id = $1 AND active = true', [templateId])).rows[0];
  if (!row) return null;
  const template = mapTemplate(row);
  return {
    ...template,
    rendered_subject: renderTemplate(template.subject, fields),
    rendered_body: renderTemplate(template.body, fields),
    dynamic_fields: safeObject(fields),
  };
}

module.exports = {
  createTemplate,
  ensureCrmMessageTemplateTable,
  extractVariables,
  listTemplates,
  renderTemplate,
  renderTemplateById,
};
