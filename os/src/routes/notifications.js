const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');
const { env } = require('../config/env');

// ─── SSE client registry ──────────────────────────────────────────────────────
// Map<userId (number), Set<express.Response>>
// Single-process in-memory bus. For multi-instance deployments, use sticky sessions or swap with Redis pub/sub.

const _sseClients = new Map();

/**
 * Push a JSON event to all SSE connections for a given user.
 * Called from other routes (notifications POST, tasks status-change, etc.)
 */
function pushToUser(userId, event) {
  const clients = _sseClients.get(Number(userId));
  if (!clients || clients.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

const router = express.Router();

const notificationsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const notificationCreateSchema = z.object({
  to_user_id: z.coerce.number().int().positive(),
  task_id: z.coerce.number().int().optional().nullable(),
  typ: z.string().trim().min(1).max(50),
  tresc: z.string().trim().min(1, 'Tresc jest wymagana'),
});

const notificationIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

router.get('/', authMiddleware, validateQuery(notificationsListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const base = `
      FROM notifications n
      LEFT JOIN users u ON n.from_user_id = u.id
      LEFT JOIN tasks t ON n.task_id = t.id
      LEFT JOIN dispatch_route_brief_recipients drr ON drr.notification_id = n.id
      LEFT JOIN dispatch_route_briefs rb ON rb.id = drr.brief_id
      LEFT JOIN teams route_team ON route_team.id = rb.team_id
      WHERE n.to_user_id = $1`;
    const orderBy = 'ORDER BY n.data_utworzenia DESC';
    const selectList = `
      SELECT n.*,
        u.imie || ' ' || u.nazwisko as od_kogo,
        t.klient_nazwa,
        t.adres,
        drr.brief_id AS dispatch_route_brief_id,
        rb.team_id AS dispatch_route_team_id,
        route_team.nazwa AS dispatch_route_team_name
      ${base}
      ${orderBy}`;
    const params = [req.user.id];
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${base}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(`${selectList} LIMIT $2 OFFSET $3`, [req.user.id, lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(`${selectList} LIMIT 50`, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania powiadomien', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, validateBody(notificationCreateSchema), async (req, res) => {
  try {
    const { to_user_id, task_id, typ, tresc } = req.body;
    const r = await pool.query(
      `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, typ, tresc, task_id, data_utworzenia, status`,
      [req.user.id, to_user_id, task_id ?? null, typ, tresc]
    );
    // Real-time push via SSE
    pushToUser(to_user_id, { event: 'notification', notification: r.rows[0] });
    res.json({ message: 'Powiadomienie wyslane' });
  } catch (err) {
    logger.error('Blad tworzenia powiadomienia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/odczytaj-wszystkie', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `WITH updated AS (
         UPDATE notifications
         SET status = 'Odczytane', data_odczytu = NOW()
         WHERE to_user_id = $1
           AND status = 'Nowe'
           AND COALESCE(typ, '') <> 'Odprawa ekipy'
         RETURNING id
       ),
       skipped AS (
         SELECT COUNT(*)::int AS c
         FROM notifications
         WHERE to_user_id = $1
           AND status = 'Nowe'
           AND COALESCE(typ, '') = 'Odprawa ekipy'
       )
       SELECT (SELECT COUNT(*)::int FROM updated) AS updated,
              skipped.c AS skipped_route_briefs
       FROM skipped`,
      [req.user.id]
    );
    res.json({
      message: 'Wszystkie odczytane',
      updated: Number(result.rows[0]?.updated || 0),
      skipped_route_briefs: Number(result.rows[0]?.skipped_route_briefs || 0),
    });
  } catch (err) {
    logger.error('Blad oznaczania wszystkich powiadomien', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/odczytaj', authMiddleware, validateParams(notificationIdParamsSchema), async (req, res) => {
  try {
    const result = await pool.query(
      `WITH target AS (
         SELECT id, typ
         FROM notifications
         WHERE id = $1 AND to_user_id = $2
       ),
       updated AS (
         UPDATE notifications
         SET status = 'Odczytane', data_odczytu = NOW()
         WHERE id = $1
           AND to_user_id = $2
           AND COALESCE(typ, '') <> 'Odprawa ekipy'
         RETURNING id
       )
       SELECT
         (SELECT id FROM updated) AS updated_id,
         (SELECT typ FROM target) AS typ`,
      [req.params.id, req.user.id]
    );
    const row = result.rows[0] || {};
    if (!row.updated_id && row.typ === 'Odprawa ekipy') {
      return res.status(409).json({
        error: 'Odprawa wymaga osobnego potwierdzenia',
        requires_route_brief_confirmation: true,
      });
    }
    res.json({ message: 'Odczytano' });
  } catch (err) {
    logger.error('Blad oznaczania powiadomienia jako odczytane', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// DELETE /api/notifications/:id

router.delete('/:id', authMiddleware, validateParams(notificationIdParamsSchema), async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1 AND to_user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: req.t('errors.http.notFound') });
    }

    return res.json({ message: 'Powiadomienie usuniete', id: Number(req.params.id) });
  } catch (err) {
    logger.error('Blad usuwania powiadomienia', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// GET /api/notifications/stream - SSE.
// EventSource can't send Authorization headers, so we accept ?token= query param.
// We validate the JWT manually here (same secret as authMiddleware).

router.get('/stream', (req, res) => {
  const rawToken = String(req.query.token || '').trim();
  if (!rawToken) return res.status(401).end('Unauthorized');

  let payload;
  try {
    payload = jwt.verify(rawToken, env.JWT_SECRET);
  } catch {
    return res.status(401).end('Invalid token');
  }
  const userId = Number(payload.id);
  if (!userId) return res.status(401).end('Bad token payload');

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Register client
  if (!_sseClients.has(userId)) _sseClients.set(userId, new Set());
  _sseClients.get(userId).add(res);
  logger.info('sse.connect', { userId, clients: _sseClients.get(userId).size });

  // Send initial ping so browser knows connection is open
  res.write(':ok\n\n');

  // Heartbeat every 25 s — prevents proxy timeout, keeps connection alive
  const heartbeat = setInterval(() => {
    try { res.write(':ping\n\n'); } catch { clearInterval(heartbeat); }
  }, 25_000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    _sseClients.get(userId)?.delete(res);
    if (_sseClients.get(userId)?.size === 0) _sseClients.delete(userId);
    logger.info('sse.disconnect', { userId });
  });
});

module.exports = router;
module.exports.pushToUser = pushToUser;
