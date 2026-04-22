const logger = require('../config/logger');

let tableReady = false;

const ensureTable = async (pool) => {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      request_id TEXT,
      user_id INTEGER,
      user_login TEXT,
      rola TEXT,
      oddzial_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata JSONB
    )
  `);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC)'
  );
  tableReady = true;
};

/**
 * Lista wpisów audytu (filtry opcjonalne).
 */
const listAuditLogs = async (pool, q) => {
  await ensureTable(pool);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = Math.max(0, Number(q.offset) || 0);
  const params = [];
  const clauses = [];
  if (q.action) {
    params.push(String(q.action).slice(0, 120));
    clauses.push(`action = $${params.length}`);
  }
  if (q.entity_type) {
    params.push(String(q.entity_type).slice(0, 120));
    clauses.push(`entity_type = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    clauses.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (q.to) {
    params.push(q.to);
    clauses.push(`created_at <= $${params.length}::timestamptz`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM audit_log ${where}`, params);
  const total = countR.rows[0]?.c ?? 0;
  const limIdx = params.length + 1;
  const offIdx = params.length + 2;
  const dataR = await pool.query(
    `SELECT id, created_at, request_id, user_id, user_login, rola, oddzial_id,
            action, entity_type, entity_id, metadata
     FROM audit_log ${where}
     ORDER BY id DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    [...params, limit, offset]
  );
  return { items: dataR.rows, total, limit, offset };
};

/**
 * Zapis audytu (nie blokuje odpowiedzi przy błędzie — tylko log).
 */
const logAudit = async (pool, req, { action, entityType, entityId, metadata }) => {
  try {
    await ensureTable(pool);
    const u = req.user || {};
    await pool.query(
      `INSERT INTO audit_log (request_id, user_id, user_login, rola, oddzial_id, action, entity_type, entity_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        req.requestId || null,
        u.id ?? null,
        u.login ?? null,
        u.rola ?? null,
        u.oddzial_id ?? null,
        action,
        entityType,
        entityId != null ? String(entityId) : null,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (e) {
    logger.error('Blad zapisu audit_log', { message: e.message, requestId: req.requestId });
  }
};

const resetAuditTableFlagForTests = () => {
  tableReady = false;
};

module.exports = { logAudit, ensureTable, listAuditLogs, resetAuditTableFlagForTests };
