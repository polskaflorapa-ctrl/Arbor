const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';

const raportCzasPracyQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get('/czas-pracy', authMiddleware, validateQuery(raportCzasPracyQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset } = req.query;
    let where = '';
    let params = [];
    if (oddzial_id != null) {
      where = 'WHERE t.oddzial_id = $1';
      params = [oddzial_id];
    } else if (!isDyrektor(req.user)) {
      where = 'WHERE t.oddzial_id = $1';
      params = [req.user.oddzial_id];
    }
    const joinGrouped = `
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       LEFT JOIN users u ON te.brygadzista_id = u.id
       LEFT JOIN work_logs wl ON wl.task_id = t.id
       ${where}
       GROUP BY t.id, te.nazwa, te.id, b.nazwa, u.imie, u.nazwisko`;
    const selectList = `
      SELECT t.id as task_id, t.klient_nazwa, t.adres,
        t.data_planowana, t.wartosc_planowana, t.status,
        t.ekipa_id, te.nazwa as ekipa_nazwa,
        b.nazwa as oddzial_nazwa,
        u.imie || ' ' || u.nazwisko as brygadzista,
        SUM(wl.czas_pracy_minuty) as czas_minuty
      ${joinGrouped}
      ORDER BY t.data_planowana DESC`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM (SELECT t.id ${joinGrouped}) sub`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(`${selectList} LIMIT $${limIdx} OFFSET $${offIdx}`, [...params, lim, off]);
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania raportu czasu pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;