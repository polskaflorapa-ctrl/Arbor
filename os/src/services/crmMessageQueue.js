const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { sendSmsGateway } = require('./smsGateway');
const { sendSystemEmailOptional } = require('./systemEmail');
const { ensureCrmLeadMessagesTable } = require('./crmInbox');

let workerTimer = null;
let workerRunning = false;

function pickRecipient(message) {
  const channel = String(message.channel || '').toLowerCase();
  if (channel === 'email') {
    return String(message.recipient_handle || message.lead_email || '').trim();
  }
  return String(message.recipient_handle || message.lead_phone || '').trim();
}

async function fetchQueuedMessages({ limit = 10 } = {}) {
  await ensureCrmLeadMessagesTable();
  const batchLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const { rows } = await pool.query(
    `SELECT m.*,
            l.title AS lead_title,
            l.phone AS lead_phone,
            l.email AS lead_email,
            l.oddzial_id
     FROM crm_lead_messages m
     JOIN crm_leads l ON l.id = m.lead_id
     WHERE m.direction = 'outbound'
       AND m.status = 'queued'
     ORDER BY m.created_at ASC
     LIMIT $1`,
    [batchLimit]
  );
  return rows;
}

async function markMessageSent(message, result = {}) {
  const providerId = result.sid || result.id || result.message_id || null;
  const provider = result.provider || null;
  const metadata = {
    ...(message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata) ? message.metadata : {}),
    queue: {
      provider,
      provider_message_id: providerId,
      processed_at: new Date().toISOString(),
    },
  };
  const { rows } = await pool.query(
    `UPDATE crm_lead_messages
     SET status = 'sent',
         external_message_id = COALESCE($2, external_message_id),
         metadata = $3::jsonb,
         last_error = NULL,
         delivered_at = COALESCE(delivered_at, NOW())
     WHERE id = $1
     RETURNING *`,
    [message.id, providerId, JSON.stringify(metadata)]
  );
  return rows[0];
}

async function markMessageFailed(message, error) {
  const messageText = String(error || 'Wysylka nie powiodla sie').slice(0, 1000);
  const { rows } = await pool.query(
    `UPDATE crm_lead_messages
     SET status = 'failed',
         retry_count = retry_count + 1,
         last_error = $2
     WHERE id = $1
     RETURNING *`,
    [message.id, messageText]
  );
  return rows[0];
}

async function deliverMessage(message) {
  const channel = String(message.channel || '').toLowerCase();
  const recipient = pickRecipient(message);
  if (!recipient) {
    return { ok: false, error: `Brak odbiorcy dla kanalu ${channel || 'other'}` };
  }

  if (channel === 'sms') {
    return sendSmsGateway({ to: recipient, body: message.body, taskId: message.metadata?.task_id || null });
  }

  if (channel === 'email') {
    const result = await sendSystemEmailOptional({
      to: recipient,
      subject: message.subject || `ARBOR CRM: ${message.lead_title || 'wiadomosc'}`,
      text: message.body,
    });
    if (result.sent) return { ok: true, provider: 'smtp' };
    return { ok: false, provider: 'smtp', error: result.error || result.skipped || 'Brak konfiguracji SMTP' };
  }

  return {
    ok: false,
    provider: channel || 'other',
    error: `Brak skonfigurowanego providera wysylki dla kanalu ${channel || 'other'}`,
  };
}

async function processQueuedMessage(message) {
  try {
    const result = await deliverMessage(message);
    if (result.ok || result.sent) {
      const updated = await markMessageSent(message, result);
      return { id: message.id, status: 'sent', provider: result.provider || null, message: updated };
    }
    const updated = await markMessageFailed(message, result.error || 'Wysylka nie powiodla sie');
    return { id: message.id, status: 'failed', error: updated.last_error };
  } catch (err) {
    logger.error('crm.messageQueue.deliver', { message: err.message, message_id: message.id });
    const updated = await markMessageFailed(message, err.message);
    return { id: message.id, status: 'failed', error: updated.last_error };
  }
}

async function processMessageQueue({ limit = 10 } = {}) {
  const messages = await fetchQueuedMessages({ limit });
  const results = [];
  for (const message of messages) {
    results.push(await processQueuedMessage(message));
  }
  return {
    processed: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

function startMessageQueueWorker({ intervalMs = env.CRM_MESSAGE_QUEUE_INTERVAL_MS, limit = 10 } = {}) {
  if (workerTimer) return workerTimer;
  const tick = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      const out = await processMessageQueue({ limit });
      if (out.processed > 0) logger.info('crm.messageQueue.tick', out);
    } catch (err) {
      logger.error('crm.messageQueue.tick', { message: err.message });
    } finally {
      workerRunning = false;
    }
  };
  workerTimer = setInterval(tick, intervalMs);
  workerTimer.unref?.();
  tick();
  return workerTimer;
}

function stopMessageQueueWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerRunning = false;
}

module.exports = {
  deliverMessage,
  fetchQueuedMessages,
  processMessageQueue,
  processQueuedMessage,
  startMessageQueueWorker,
  stopMessageQueueWorker,
};
