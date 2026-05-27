const express = require('express');
const { z } = require('zod');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');

const router = express.Router();

const callsListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  status: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const callCreateSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  phone: z.string().trim().min(3).max(64),
  call_type: z.enum(['inbound', 'outbound']).optional(),
  status: z.string().trim().min(2).max(40).optional(),
  duration_sec: z.coerce.number().int().min(0).optional(),
  task_id: z.coerce.number().int().positive().optional().nullable(),
  lead_name: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const callbacksListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  status: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const callbackCreateSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  phone: z.string().trim().min(3).max(64),
  task_id: z.coerce.number().int().positive().optional().nullable(),
  lead_name: z.string().max(255).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  due_at: z.string().max(64).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  assigned_user_id: z.coerce.number().int().positive().optional().nullable(),
});

const callbackStatusParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const callbackStatusBodySchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']),
});

const isManagementRole = (user) =>
  user?.rola === 'Dyrektor' || user?.rola === 'Administrator' || user?.rola === 'Kierownik';

const telephonyScope = (user, oddzialId) => {
  if (isManagementRole(user)) {
    if (oddzialId) {
      return { where: 'WHERE x.oddzial_id = $1', params: [oddzialId] };
    }
    return { where: '', params: [] };
  }
  return { where: 'WHERE x.oddzial_id = $1', params: [user?.oddzial_id || -1] };
};

const telephonyScopeSimple = (user, oddzialId, alias = 'c') => {
  if (isManagementRole(user)) {
    if (oddzialId) {
      return { where: `WHERE ${alias}.oddzial_id = $1`, params: [oddzialId] };
    }
    return { where: '', params: [] };
  }
  return { where: `WHERE ${alias}.oddzial_id = $1`, params: [user?.oddzial_id || -1] };
};

let migrationReady = false;
async function ensureTelephonyTables() {
  if (migrationReady) return;
  migrationReady = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telephony_call_logs (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      phone VARCHAR(64) NOT NULL,
      call_type VARCHAR(20) NOT NULL DEFAULT 'outbound',
      status VARCHAR(40) NOT NULL DEFAULT 'missed',
      duration_sec INTEGER NOT NULL DEFAULT 0,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      lead_name VARCHAR(255),
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_call_logs_oddzial_created ON telephony_call_logs(oddzial_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_call_logs_status ON telephony_call_logs(status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_call_logs_task ON telephony_call_logs(task_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telephony_callbacks (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      phone VARCHAR(64) NOT NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      lead_name VARCHAR(255),
      priority VARCHAR(16) NOT NULL DEFAULT 'normal',
      due_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      notes TEXT,
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks_oddzial_status ON telephony_callbacks(oddzial_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_telephony_callbacks_due ON telephony_callbacks(due_at)');
}

router.get('/calls', authMiddleware, validateQuery(callsListQuerySchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const oddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
    const statusFilter = String(req.query.status || '').trim();
    const { where, params } = telephonyScope(req.user, oddzialId);
    const statusSql = statusFilter ? `${where ? `${where} AND` : 'WHERE'} x.status = $${params.length + 1}` : where;
    const statusParams = statusFilter ? [...params, statusFilter] : params;

    const rowsResult = await pool.query(
      `
      SELECT * FROM (
        SELECT
          c.id,
          c.oddzial_id,
          c.phone,
          c.call_type,
          c.status,
          c.duration_sec,
          c.task_id,
          c.lead_name,
          c.notes,
          c.created_by,
          c.created_at,
          'manual'::text AS source
        FROM telephony_call_logs c
        UNION ALL
        SELECT
          -p.id AS id,
          COALESCE(t.oddzial_id, u.oddzial_id) AS oddzial_id,
          p.client_number AS phone,
          'outbound'::text AS call_type,
          COALESCE(p.status, 'unknown') AS status,
          COALESCE(p.recording_duration_sec, 0) AS duration_sec,
          p.task_id,
          NULL::text AS lead_name,
          p.error_message AS notes,
          p.user_id AS created_by,
          p.created_at,
          'system'::text AS source
        FROM phone_call_conversations p
        LEFT JOIN tasks t ON t.id = p.task_id
        LEFT JOIN users u ON u.id = p.user_id
      ) x
      ${statusSql}
      ORDER BY x.created_at DESC
      `,
      statusParams,
    );
    const rows = rowsResult.rows;
    if (req.query.limit != null) {
      const lim = Number(req.query.limit);
      const off = Number(req.query.offset || 0);
      return res.json({ items: rows.slice(off, off + lim), total: rows.length, limit: lim, offset: off });
    }
    return res.json(rows);
  } catch (err) {
    logger.error('telephony.calls.list', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/calls', authMiddleware, validateBody(callCreateSchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const b = req.body;
    if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(b.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    const { rows } = await pool.query(
      `
      INSERT INTO telephony_call_logs (
        oddzial_id, phone, call_type, status, duration_sec, task_id, lead_name, notes, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        b.oddzial_id,
        b.phone,
        b.call_type || 'outbound',
        b.status || 'answered',
        b.duration_sec || 0,
        b.task_id || null,
        b.lead_name || null,
        b.notes || null,
        req.user.id,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('telephony.calls.create', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/callbacks', authMiddleware, validateQuery(callbacksListQuerySchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const oddzialId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
    const statusFilter = String(req.query.status || '').trim();
    const { where, params } = telephonyScopeSimple(req.user, oddzialId, 'c');
    const statusSql = statusFilter ? `${where ? `${where} AND` : 'WHERE'} c.status = $${params.length + 1}` : where;
    const statusParams = statusFilter ? [...params, statusFilter] : params;
    if (req.query.limit != null) {
      const lim = Number(req.query.limit);
      const off = Number(req.query.offset || 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM telephony_callbacks c ${statusSql}`, statusParams);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(
        `
        SELECT c.*
        FROM telephony_callbacks c
        ${statusSql}
        ORDER BY COALESCE(c.due_at, c.created_at) ASC
        LIMIT $${statusParams.length + 1} OFFSET $${statusParams.length + 2}
        `,
        [...statusParams, lim, off],
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const { rows } = await pool.query(
      `
      SELECT c.*
      FROM telephony_callbacks c
      ${statusSql}
      ORDER BY COALESCE(c.due_at, c.created_at) ASC
      `,
      statusParams,
    );
    return res.json(rows);
  } catch (err) {
    logger.error('telephony.callbacks.list', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/callbacks', authMiddleware, validateBody(callbackCreateSchema), async (req, res) => {
  try {
    await ensureTelephonyTables();
    const b = req.body;
    if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(b.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    const { rows } = await pool.query(
      `
      INSERT INTO telephony_callbacks (
        oddzial_id, phone, task_id, lead_name, priority, due_at, status, notes, assigned_user_id, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9)
      RETURNING *
      `,
      [
        b.oddzial_id,
        b.phone,
        b.task_id || null,
        b.lead_name || null,
        b.priority || 'normal',
        b.due_at || null,
        b.notes || null,
        b.assigned_user_id || null,
        req.user.id,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('telephony.callbacks.create', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.patch(
  '/callbacks/:id/status',
  authMiddleware,
  validateParams(callbackStatusParamsSchema),
  validateBody(callbackStatusBodySchema),
  async (req, res) => {
    try {
      await ensureTelephonyTables();
      const id = Number(req.params.id);
      const nextStatus = req.body.status;
      const currentR = await pool.query('SELECT * FROM telephony_callbacks WHERE id = $1', [id]);
      if (!currentR.rows.length) {
        return res.status(404).json({ error: 'Callback nie znaleziony' });
      }
      const current = currentR.rows[0];
      if (!isManagementRole(req.user) && Number(req.user?.oddzial_id) !== Number(current.oddzial_id)) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      const closedAt = nextStatus === 'done' || nextStatus === 'cancelled' ? new Date().toISOString() : null;
      const { rows } = await pool.query(
        `
        UPDATE telephony_callbacks
        SET status = $1, updated_by = $2, updated_at = NOW(), closed_at = $3
        WHERE id = $4
        RETURNING *
        `,
        [nextStatus, req.user.id, closedAt, id],
      );
      return res.json(rows[0]);
    } catch (err) {
      logger.error('telephony.callbacks.patch', { message: err.message, requestId: req.requestId });
      return res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

module.exports = router;
