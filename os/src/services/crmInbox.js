const pool = require('../config/database');
const logger = require('../config/logger');

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeChannel(channel) {
  const allowed = new Set(['whatsapp', 'instagram', 'facebook', 'messenger', 'telegram', 'email', 'sms', 'phone', 'webchat', 'other']);
  const value = String(channel || '').trim().toLowerCase();
  return allowed.has(value) ? value : 'other';
}

function normalizeDirection(direction) {
  return String(direction || '').trim().toLowerCase() === 'outbound' ? 'outbound' : 'inbound';
}

function normalizeStatus(status, direction) {
  const allowed = new Set(['received', 'queued', 'processing', 'sent', 'delivered', 'read', 'failed']);
  const value = String(status || '').trim().toLowerCase();
  if (allowed.has(value)) return value;
  return normalizeDirection(direction) === 'outbound' ? 'sent' : 'received';
}

async function ensureCrmLeadMessagesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_lead_messages (
      id                  SERIAL PRIMARY KEY,
      lead_id             INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
      channel             VARCHAR(32) NOT NULL,
      direction           VARCHAR(16) NOT NULL DEFAULT 'inbound',
      sender_name         VARCHAR(200),
      sender_handle       VARCHAR(255),
      recipient_handle    VARCHAR(255),
      subject             VARCHAR(255),
      body                TEXT NOT NULL,
      status              VARCHAR(32) NOT NULL DEFAULT 'received',
      external_message_id VARCHAR(255),
      external_thread_id  VARCHAR(255),
      template_key        VARCHAR(100),
      dynamic_fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
      delivered_at        TIMESTAMPTZ,
      read_at             TIMESTAMPTZ,
      created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_lead_messages_lead ON crm_lead_messages(lead_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_lead_messages_channel ON crm_lead_messages(channel, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_lead_messages_external ON crm_lead_messages(external_message_id)');
  await pool.query('ALTER TABLE crm_lead_messages ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE crm_lead_messages ADD COLUMN IF NOT EXISTS last_error TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_lead_messages_queue ON crm_lead_messages(status, created_at DESC)');
}

async function findLeadForContact({ oddzialId, phone, email }) {
  const normalizedPhone = digitsOnly(phone);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedPhone && !normalizedEmail) return null;

  const params = [];
  const clauses = [];
  if (oddzialId) {
    params.push(oddzialId);
    clauses.push(`l.oddzial_id = $${params.length}`);
  }
  const contactClauses = [];
  if (normalizedPhone) {
    params.push(normalizedPhone);
    contactClauses.push(`regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') = $${params.length}`);
  }
  if (normalizedEmail) {
    params.push(normalizedEmail);
    contactClauses.push(`LOWER(COALESCE(l.email, '')) = $${params.length}`);
  }
  clauses.push(`(${contactClauses.join(' OR ')})`);

  const { rows } = await pool.query(
    `SELECT l.id
     FROM crm_leads l
     WHERE ${clauses.join(' AND ')}
     ORDER BY l.updated_at DESC NULLS LAST, l.id DESC
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

function fallbackLeadTitle({ phone, email, channel }) {
  const normalizedPhone = String(phone || '').trim();
  const normalizedEmail = String(email || '').trim();
  if (normalizedPhone) return `Telefon: ${normalizedPhone}`;
  if (normalizedEmail) return `Kontakt: ${normalizedEmail}`;
  const source = normalizeChannel(channel);
  return source === 'phone' ? 'Nowy lead telefoniczny' : 'Nowy lead z wiadomosci';
}

async function createLeadForContact({
  oddzialId,
  phone,
  email,
  channel,
  leadTitle,
  source = null,
  notes = null,
  createdBy = null,
}) {
  const branchId = Number(oddzialId || 0);
  if (!branchId) return null;
  const title = String(leadTitle || '').trim() || fallbackLeadTitle({ phone, email, channel });
  const normalizedSource = String(source || channel || '').trim().toLowerCase() || 'phone';
  const { rows } = await pool.query(
    `INSERT INTO crm_leads (
      title, oddzial_id, client_id, owner_user_id, stage, source, value, phone, email, notes, tags,
      next_action_at, created_by, created_at, updated_by, updated_at
    ) VALUES ($1,$2,NULL,NULL,'Lead',$3,0,$4,$5,$6,$7::jsonb,NULL,$8,NOW(),$8,NOW())
    RETURNING id`,
    [
      title,
      branchId,
      normalizedSource,
      String(phone || '').trim() || null,
      String(email || '').trim() || null,
      String(notes || '').trim() || null,
      JSON.stringify(['auto', normalizeChannel(channel)]),
      createdBy || null,
    ]
  );
  return rows[0] || null;
}

async function appendCrmLeadMessage({
  leadId,
  channel,
  direction,
  senderName = null,
  senderHandle = null,
  recipientHandle = null,
  subject = null,
  body,
  status,
  externalMessageId = null,
  externalThreadId = null,
  templateKey = null,
  dynamicFields = {},
  metadata = {},
  createdBy = null,
}) {
  if (!leadId || !String(body || '').trim()) return null;
  await ensureCrmLeadMessagesTable();
  const normalizedDirection = normalizeDirection(direction);
  const { rows } = await pool.query(
    `INSERT INTO crm_lead_messages (
      lead_id, channel, direction, sender_name, sender_handle, recipient_handle, subject, body, status,
      external_message_id, external_thread_id, template_key, dynamic_fields, metadata, created_by, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,NOW())
    RETURNING *`,
    [
      leadId,
      normalizeChannel(channel),
      normalizedDirection,
      senderName,
      senderHandle,
      recipientHandle,
      subject,
      String(body).trim(),
      normalizeStatus(status, normalizedDirection),
      externalMessageId,
      externalThreadId,
      templateKey,
      JSON.stringify(dynamicFields && typeof dynamicFields === 'object' && !Array.isArray(dynamicFields) ? dynamicFields : {}),
      JSON.stringify(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
      createdBy,
    ]
  );
  await pool.query('UPDATE crm_leads SET updated_at = NOW(), updated_by = COALESCE($1, updated_by) WHERE id = $2', [createdBy, leadId]);
  return rows[0];
}

async function appendCrmMessageForContact(options) {
  try {
    let lead = await findLeadForContact(options);
    if (!lead?.id && options?.createLeadIfMissing) {
      lead = await createLeadForContact(options);
    }
    if (!lead?.id) return null;
    return await appendCrmLeadMessage({ ...options, leadId: lead.id });
  } catch (err) {
    logger.warn('crm.inbox.append', { message: err.message });
    return null;
  }
}

module.exports = {
  appendCrmLeadMessage,
  appendCrmMessageForContact,
  createLeadForContact,
  ensureCrmLeadMessagesTable,
  findLeadForContact,
};
