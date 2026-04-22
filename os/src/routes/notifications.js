const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

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
      WHERE n.to_user_id = $1`;
    const orderBy = 'ORDER BY n.data_utworzenia DESC';
    const selectList = `
      SELECT n.*,
        u.imie || ' ' || u.nazwisko as od_kogo,
        t.klient_nazwa, t.adres
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
    await pool.query(
      `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, to_user_id, task_id ?? null, typ, tresc]
    );
    res.json({ message: 'Powiadomienie wyslane' });
  } catch (err) {
    logger.error('Blad tworzenia powiadomienia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/odczytaj-wszystkie', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET status = 'Odczytane', data_odczytu = NOW()
       WHERE to_user_id = $1 AND status = 'Nowe'`,
      [req.user.id]
    );
    res.json({ message: 'Wszystkie odczytane' });
  } catch (err) {
    logger.error('Blad oznaczania wszystkich powiadomien', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/odczytaj', authMiddleware, validateParams(notificationIdParamsSchema), async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET status = 'Odczytane', data_odczytu = NOW()
       WHERE id = $1 AND to_user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Odczytano' });
  } catch (err) {
    logger.error('Blad oznaczania powiadomienia jako odczytane', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
