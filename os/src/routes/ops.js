const express = require('express');
const pool = require('../config/database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

router.get('/smoke', authMiddleware, requireRole('Dyrektor', 'Administrator'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const [dbRes, usersRes, tasksRes] = await Promise.all([
      pool.query('SELECT 1 AS ok'),
      pool.query('SELECT COUNT(*)::int AS c FROM users'),
      pool.query('SELECT COUNT(*)::int AS c FROM tasks'),
    ]);
    res.json({
      status: 'ok',
      checks: {
        db: dbRes.rows[0]?.ok === 1 ? 'up' : 'unknown',
        users_table: usersRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
        tasks_table: tasksRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
      },
      counts: {
        users: usersRes.rows[0]?.c || 0,
        tasks: tasksRes.rows[0]?.c || 0,
      },
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('Blad smoke check', { message: e.message, requestId: req.requestId });
    res.status(503).json({
      status: 'failed',
      error: e.message,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  }
});

module.exports = router;
