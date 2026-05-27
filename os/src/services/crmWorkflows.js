const pool = require('../config/database');
const logger = require('../config/logger');

const TRIGGERS = new Set(['no_response_after_hours']);
const ACTIONS = new Set(['create_followup_task', 'move_stage', 'assign_round_robin']);

function normalizeTriggerType(value) {
  const triggerType = String(value || '').trim().toLowerCase();
  return TRIGGERS.has(triggerType) ? triggerType : 'no_response_after_hours';
}

function normalizeActionType(value) {
  const actionType = String(value || '').trim().toLowerCase();
  return ACTIONS.has(actionType) ? actionType : 'create_followup_task';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

async function ensureCrmWorkflowTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_workflow_rules (
      id              SERIAL PRIMARY KEY,
      oddzial_id      INTEGER REFERENCES branches(id) ON DELETE CASCADE,
      name            VARCHAR(160) NOT NULL,
      trigger_type    VARCHAR(64) NOT NULL,
      trigger_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
      action_type     VARCHAR(64) NOT NULL,
      action_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
      active          BOOLEAN NOT NULL DEFAULT true,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_workflow_rules_oddzial ON crm_workflow_rules(oddzial_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_workflow_rules_trigger ON crm_workflow_rules(trigger_type, active)');
}

function mapRule(row) {
  return {
    id: row.id,
    oddzial_id: row.oddzial_id,
    name: row.name,
    trigger_type: normalizeTriggerType(row.trigger_type),
    trigger_config: row.trigger_config || {},
    action_type: normalizeActionType(row.action_type),
    action_config: row.action_config || {},
    active: row.active !== false,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

async function listWorkflowRules({ oddzialId = null, includeInactive = false } = {}) {
  await ensureCrmWorkflowTables();
  const params = [];
  const where = [];
  if (oddzialId) {
    params.push(oddzialId);
    where.push(`oddzial_id = $${params.length}`);
  }
  if (!includeInactive) where.push('active = true');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM crm_workflow_rules ${whereSql} ORDER BY active DESC, updated_at DESC, id DESC`,
    params
  );
  return rows.map(mapRule);
}

async function createWorkflowRule({ oddzialId, name, triggerType, triggerConfig, actionType, actionConfig, active = true, userId }) {
  await ensureCrmWorkflowTables();
  const ruleName = String(name || '').trim() || 'CRM workflow';
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO crm_workflow_rules (
      oddzial_id, name, trigger_type, trigger_config, action_type, action_config, active,
      created_by, created_at, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      oddzialId || null,
      ruleName.slice(0, 160),
      normalizeTriggerType(triggerType),
      JSON.stringify(safeObject(triggerConfig)),
      normalizeActionType(actionType),
      JSON.stringify(safeObject(actionConfig)),
      active !== false,
      userId || null,
      now,
      userId || null,
      now,
    ]
  );
  return mapRule(rows[0]);
}

async function findNoResponseCandidates(rule) {
  const triggerConfig = safeObject(rule.trigger_config);
  const hours = toPositiveInt(triggerConfig.hours, 24);
  const params = [rule.oddzial_id, hours, rule.id];
  const stageFilter = Array.isArray(triggerConfig.stages) ? triggerConfig.stages.filter(Boolean) : [];
  let stageSql = '';
  if (stageFilter.length) {
    params.push(stageFilter);
    stageSql = `AND l.stage = ANY($${params.length})`;
  }

  const { rows } = await pool.query(
    `WITH last_outbound AS (
       SELECT DISTINCT ON (m.lead_id)
         m.lead_id,
         m.created_at,
         m.channel,
         m.recipient_handle
       FROM crm_lead_messages m
       WHERE m.direction = 'outbound'
       ORDER BY m.lead_id, m.created_at DESC
     )
     SELECT l.*, o.created_at AS last_outbound_at, o.channel AS last_outbound_channel, o.recipient_handle
     FROM crm_leads l
     JOIN last_outbound o ON o.lead_id = l.id
     WHERE l.oddzial_id = $1
       AND l.stage NOT IN ('Wygrane', 'Przegrane', 'Techniczny')
       ${stageSql}
       AND o.created_at <= NOW() - ($2::int * INTERVAL '1 hour')
       AND NOT EXISTS (
         SELECT 1 FROM crm_lead_messages mi
         WHERE mi.lead_id = l.id
           AND mi.direction = 'inbound'
           AND mi.created_at > o.created_at
       )
       AND NOT EXISTS (
         SELECT 1 FROM crm_lead_activities a
         WHERE a.lead_id = l.id
           AND a.type = 'task'
           AND a.completed_at IS NULL
           AND a.text LIKE $3
       )
     ORDER BY o.created_at ASC
     LIMIT 100`,
    [params[0], params[1], `%[workflow:${params[2]}]%`, ...params.slice(3)]
  );
  return rows;
}

async function applyRuleAction(rule, lead, userId) {
  const actionConfig = safeObject(rule.action_config);
  const now = new Date().toISOString();
  if (rule.action_type === 'move_stage') {
    const nextStage = String(actionConfig.stage || '').trim();
    if (!nextStage) return { lead_id: lead.id, action: 'move_stage', skipped: true };
    await pool.query('UPDATE crm_leads SET stage = $1, updated_at = $2, updated_by = $3 WHERE id = $4', [nextStage, now, userId || null, lead.id]);
    return { lead_id: lead.id, action: 'move_stage', stage: nextStage };
  }

  if (rule.action_type === 'assign_round_robin') {
    const assignees = Array.isArray(actionConfig.user_ids)
      ? actionConfig.user_ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
      : [];
    if (!assignees.length) return { lead_id: lead.id, action: 'assign_round_robin', skipped: true };
    const ownerId = assignees[Math.abs(Number(lead.id)) % assignees.length];
    await pool.query('UPDATE crm_leads SET owner_user_id = $1, updated_at = $2, updated_by = $3 WHERE id = $4', [ownerId, now, userId || null, lead.id]);
    return { lead_id: lead.id, action: 'assign_round_robin', owner_user_id: ownerId };
  }

  const dueHours = toPositiveInt(actionConfig.due_in_hours, 2);
  const due = new Date(Date.now() + dueHours * 60 * 60 * 1000).toISOString();
  const text = String(actionConfig.text || '').trim()
    || `Follow-up: brak odpowiedzi klienta od ${toPositiveInt(rule.trigger_config?.hours, 24)}h [workflow:${rule.id}]`;
  await pool.query(
    `INSERT INTO crm_lead_activities (lead_id, type, text, due_at, created_by, created_at)
     VALUES ($1,'task',$2,$3,$4,$5)`,
    [lead.id, text.includes(`[workflow:${rule.id}]`) ? text : `${text} [workflow:${rule.id}]`, due, userId || null, now]
  );
  await pool.query('UPDATE crm_leads SET next_action_at = $1, updated_at = $2, updated_by = $3 WHERE id = $4', [due, now, userId || null, lead.id]);
  return { lead_id: lead.id, action: 'create_followup_task', due_at: due };
}

async function runWorkflowRules({ oddzialId, ruleId = null, userId = null } = {}) {
  await ensureCrmWorkflowTables();
  const params = [];
  const where = ['active = true'];
  if (oddzialId) {
    params.push(oddzialId);
    where.push(`oddzial_id = $${params.length}`);
  }
  if (ruleId) {
    params.push(ruleId);
    where.push(`id = $${params.length}`);
  }
  const { rows } = await pool.query(`SELECT * FROM crm_workflow_rules WHERE ${where.join(' AND ')} ORDER BY id ASC`, params);
  const results = [];
  for (const row of rows.map(mapRule)) {
    try {
      if (row.trigger_type !== 'no_response_after_hours') {
        results.push({ rule_id: row.id, matched: 0, actions: [] });
        continue;
      }
      const candidates = await findNoResponseCandidates(row);
      const actions = [];
      for (const lead of candidates) {
        actions.push(await applyRuleAction(row, lead, userId));
      }
      results.push({ rule_id: row.id, matched: candidates.length, actions });
    } catch (err) {
      logger.warn('crm.workflows.run.rule', { rule_id: row.id, message: err.message });
      results.push({ rule_id: row.id, error: err.message, matched: 0, actions: [] });
    }
  }
  return { rules: results, actions_count: results.reduce((sum, item) => sum + (item.actions?.length || 0), 0) };
}

module.exports = {
  createWorkflowRule,
  ensureCrmWorkflowTables,
  listWorkflowRules,
  runWorkflowRules,
};
