/**
 * HR routes — human resources management
 *
 * GET  /api/hr/position-cards        — employee HR cards (fixes missing route for KadryDokumenty)
 * GET  /api/hr/timesheet             — unified timesheet (godziny_potwierdzenia + payroll lines)
 * GET  /api/hr/competency-expiry     — certifications expiring within 90 days
 * GET  /api/hr/absences              — list absences
 * POST /api/hr/absences              — log absence
 * PUT  /api/hr/absences/:id          — update absence (approve/reject)
 * GET  /api/hr/headcount             — headcount summary by branch + role
 */

const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin, isKierownik, scopedOddzialId } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function canHR(user) {
  return isDyrektorOrAdmin(user) || isKierownik(user);
}

// ─── GET /api/hr/position-cards ──────────────────────────────────────────────
// KadryDokumenty.js calls /api/position-cards (root).
// We register this handler on BOTH /position-cards (for /api/hr/position-cards)
// AND on '/' (for the alias app.use('/api/position-cards', hrRoutes) → root match).

function mapPositionCardRow(row) {
  return {
    id: row.id,
    employee_name: row.employee_name,
    rola: row.rola,
    stanowisko: row.stanowisko,
    oddzial_id: row.oddzial_id,
    oddzial_nazwa: row.oddzial_nazwa,
    data_zatrudnienia: row.data_zatrudnienia,
    stawka_godzinowa: row.stawka_godzinowa ? Number(row.stawka_godzinowa) : null,
    procent_wynagrodzenia: row.procent_wynagrodzenia ? Number(row.procent_wynagrodzenia) : null,
    hourly_rate_pln: row.hourly_rate_pln ? Number(row.hourly_rate_pln) : null,
    acknowledged_at: row.acknowledged_at || null,
    acknowledgement_status: row.acknowledgement_status || 'Brak',
    expired_competencies_count: Number(row.expired_competencies_count || 0),
    expiring_competencies_count: Number(row.expiring_competencies_count || 0),
    nearest_competency_expiry: row.nearest_competency_expiry || null,
    competency_status: row.competency_status || 'ok',
  };
}

function isMissingOddzialyRelation(err) {
  return err && err.code === '42P01' && /oddzialy/i.test(err.message || '');
}

async function positionCardsHandler(req, res) {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const params = [];
  let where = 'u.aktywny = true';
  if (branchId) { params.push(branchId); where += ` AND u.oddzial_id = $${params.length}`; }

  const runPositionCardsQuery = (withOddzialJoin) => pool.query(
    `SELECT
       u.id,
       u.imie || ' ' || u.nazwisko          AS employee_name,
       u.rola,
       u.stanowisko,
       u.oddzial_id,
       ${withOddzialJoin ? 'o.nazwa' : 'NULL::text'} AS oddzial_nazwa,
       u.data_zatrudnienia,
       u.stawka_godzinowa,
       u.procent_wynagrodzenia,
       -- Latest payroll rate
       (SELECT upr.rate_pln_per_hour
        FROM user_payroll_rates upr
        WHERE upr.user_id = u.id
        ORDER BY upr.effective_from DESC
        LIMIT 1)                             AS hourly_rate_pln,
       -- Card acknowledgement
       (SELECT pck.acknowledged_at
        FROM position_card_acknowledgements pck
        WHERE pck.user_id = u.id
        ORDER BY pck.acknowledged_at DESC
        LIMIT 1)                             AS acknowledged_at,
       (SELECT pck.status
        FROM position_card_acknowledgements pck
        WHERE pck.user_id = u.id
        ORDER BY pck.acknowledged_at DESC
        LIMIT 1)                             AS acknowledgement_status,
       -- Competency validity monitoring for employee cards
       (SELECT COUNT(*)
        FROM user_competencies uc
        WHERE uc.user_id = u.id
          AND uc.data_waznosci IS NOT NULL
          AND uc.data_waznosci < CURRENT_DATE) AS expired_competencies_count,
       (SELECT COUNT(*)
        FROM user_competencies uc
        WHERE uc.user_id = u.id
          AND uc.data_waznosci IS NOT NULL
          AND uc.data_waznosci >= CURRENT_DATE
          AND uc.data_waznosci <= CURRENT_DATE + INTERVAL '30 days') AS expiring_competencies_count,
       (SELECT MIN(uc.data_waznosci)
        FROM user_competencies uc
        WHERE uc.user_id = u.id
          AND uc.data_waznosci IS NOT NULL) AS nearest_competency_expiry,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM user_competencies uc
           WHERE uc.user_id = u.id
             AND uc.data_waznosci IS NOT NULL
             AND uc.data_waznosci < CURRENT_DATE
         ) THEN 'expired'
         WHEN EXISTS (
           SELECT 1 FROM user_competencies uc
           WHERE uc.user_id = u.id
             AND uc.data_waznosci IS NOT NULL
             AND uc.data_waznosci <= CURRENT_DATE + INTERVAL '30 days'
         ) THEN 'expiring'
         ELSE 'ok'
       END AS competency_status
     FROM users u
     ${withOddzialJoin ? 'LEFT JOIN branches o ON o.id = u.oddzial_id' : ''}
     WHERE ${where}
     ORDER BY u.nazwisko, u.imie`,
    params
  );

  try {
    const r = await runPositionCardsQuery(true);
    return res.json({ cards: r.rows.map(mapPositionCardRow) });
  } catch (err) {
    if (isMissingOddzialyRelation(err)) {
      logger.warn('hr.position-cards fallback-no-oddzialy', { message: err.message, code: err.code });
      try {
        const fallback = await runPositionCardsQuery(false);
        return res.json({ cards: fallback.rows.map(mapPositionCardRow) });
      } catch (fallbackErr) {
        logger.error('hr.position-cards fallback error', { message: fallbackErr.message, code: fallbackErr.code });
        return res.status(500).json({ error: fallbackErr.message });
      }
    }
    logger.error('hr.position-cards error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
}

// Register on both paths:
// - /api/hr/position-cards  (via app.use('/api/hr', hrRoutes))
// - /api/position-cards     (via app.use('/api/position-cards', hrRoutes) → router root '/')
router.get('/position-cards', positionCardsHandler);
router.get('/', positionCardsHandler);

// ─── GET /api/hr/timesheet ────────────────────────────────────────────────────

router.get('/timesheet', async (req, res) => {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Wymagany format month: YYYY-MM' });

  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const params = [month + '-01', month + '-31'];
  const branchFilter = branchId ? ` AND u.oddzial_id = $${params.push(branchId)}` : '';

  try {
    const r = await pool.query(
      `SELECT
         u.id                                  AS user_id,
         u.imie || ' ' || u.nazwisko          AS employee_name,
         u.rola,
         o.nazwa                               AS oddzial_nazwa,
         COALESCE(SUM(gp.godziny) FILTER (WHERE gp.status = 'Potwierdzone'), 0) AS hours_confirmed,
         COALESCE(SUM(gp.godziny) FILTER (WHERE gp.status = 'Oczekuje'),     0) AS hours_pending,
         COALESCE(SUM(gp.godziny) FILTER (WHERE gp.status = 'Odrzucone'),    0) AS hours_rejected,
         COUNT(DISTINCT gp.data_pracy) FILTER (WHERE gp.status = 'Potwierdzone') AS days_worked,
         COUNT(DISTINCT gp.task_id) FILTER (WHERE gp.status = 'Potwierdzone')    AS tasks_covered
       FROM users u
       LEFT JOIN branches o ON o.id = u.oddzial_id
       LEFT JOIN godziny_potwierdzenia gp ON gp.pomocnik_id = u.id
         AND gp.data_pracy BETWEEN $1 AND $2
       WHERE u.aktywny = true
         AND u.rola IN ('Brygadzista','Pomocnik','Pomocnik bez doświadczenia','Specjalista')
         ${branchFilter}
       GROUP BY u.id, u.imie, u.nazwisko, u.rola, o.nazwa
       ORDER BY o.nazwa, u.nazwisko`,
      params
    );

    res.json({
      month,
      rows: r.rows.map(row => ({
        user_id:        row.user_id,
        employee_name:  row.employee_name,
        rola:           row.rola,
        oddzial_nazwa:  row.oddzial_nazwa,
        hours_confirmed: Number(row.hours_confirmed),
        hours_pending:   Number(row.hours_pending),
        hours_rejected:  Number(row.hours_rejected),
        days_worked:     Number(row.days_worked),
        tasks_covered:   Number(row.tasks_covered),
      })),
    });
  } catch (err) {
    logger.error('hr.timesheet error', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/hr/competency-expiry ───────────────────────────────────────────

router.get('/competency-expiry', async (req, res) => {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const params = [days];
  const branchFilter = branchId ? ` AND u.oddzial_id = $${params.push(branchId)}` : '';

  try {
    const r = await pool.query(
      `SELECT
         uc.id,
         u.id                            AS user_id,
         u.imie || ' ' || u.nazwisko    AS employee_name,
         u.rola,
         o.nazwa                         AS oddzial_nazwa,
         uc.nazwa                        AS competency_name,
         uc.typ,
         uc.nr_dokumentu,
         uc.data_uzyskania,
         uc.data_waznosci,
         (uc.data_waznosci - CURRENT_DATE) AS days_left
       FROM user_competencies uc
       JOIN users u ON u.id = uc.user_id
       LEFT JOIN branches o ON o.id = u.oddzial_id
       WHERE uc.data_waznosci IS NOT NULL
         AND uc.data_waznosci <= CURRENT_DATE + INTERVAL '1 day' * $1
         AND u.aktywny = true
         ${branchFilter}
       ORDER BY uc.data_waznosci ASC`,
      params
    );

    res.json(r.rows.map(row => ({
      id:               row.id,
      user_id:          row.user_id,
      employee_name:    row.employee_name,
      rola:             row.rola,
      oddzial_nazwa:    row.oddzial_nazwa,
      competency_name:  row.competency_name,
      typ:              row.typ,
      nr_dokumentu:     row.nr_dokumentu,
      data_uzyskania:   row.data_uzyskania,
      data_waznosci:    row.data_waznosci,
      days_left:        Number(row.days_left),
      expired:          Number(row.days_left) < 0,
      status:           Number(row.days_left) < 0 ? 'expired' : 'expiring',
      severity:         Number(row.days_left) < 0 ? 'danger' : Number(row.days_left) <= 30 ? 'warning' : 'notice',
      renewal_required: Number(row.days_left) <= 30,
      source:           'user_competencies',
    })));
  } catch (err) {
    logger.error('hr.competency-expiry error', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/hr/absences ─────────────────────────────────────────────────────

router.get('/absences', async (req, res) => {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const month    = req.query.month; // optional YYYY-MM filter
  const params   = [];
  const conds    = [];

  if (branchId) { params.push(branchId); conds.push(`u.oddzial_id = $${params.length}`); }
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    params.push(month + '-01'); conds.push(`a.data_od >= $${params.length}`);
    params.push(month + '-31'); conds.push(`a.data_do <= $${params.length}`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  try {
    const r = await pool.query(
      `SELECT a.*, u.imie || ' ' || u.nazwisko AS employee_name, u.rola, o.nazwa AS oddzial_nazwa
       FROM absencje a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN branches o ON o.id = u.oddzial_id
       ${where}
       ORDER BY a.data_od DESC
       LIMIT 200`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    logger.error('hr.absences GET error', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/hr/absences ────────────────────────────────────────────────────

router.post('/absences', async (req, res) => {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const { user_id, typ, data_od, data_do, powod } = req.body;
  if (!user_id || !typ || !data_od || !data_do) {
    return res.status(400).json({ error: 'Wymagane: user_id, typ, data_od, data_do' });
  }
  const VALID_TYPS = ['Urlop','Choroba','L4','Opieka','Nieobecność nieusprawiedliwiona','Inne'];
  if (!VALID_TYPS.includes(typ)) {
    return res.status(400).json({ error: `typ musi być jednym z: ${VALID_TYPS.join(', ')}` });
  }

  try {
    const r = await pool.query(
      `INSERT INTO absencje (user_id, typ, data_od, data_do, powod, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, typ, data_od, data_do, powod || null, req.user.id]
    );

    await req.auditLog({
      action: 'hr.absence_logged',
      entityType: 'absence',
      entityId: String(r.rows[0].id),
      metadata: { user_id, typ, data_od, data_do },
    });

    res.status(201).json(r.rows[0]);
  } catch (err) {
    logger.error('hr.absences POST error', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/hr/absences/:id ─────────────────────────────────────────────────

router.put('/absences/:id', async (req, res) => {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const { status, powod } = req.body;
  const VALID = ['Zatwierdzona','Odrzucona','Oczekuje'];
  if (status && !VALID.includes(status)) {
    return res.status(400).json({ error: `status musi być: ${VALID.join(', ')}` });
  }

  try {
    const updates = [];
    const params  = [];
    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    if (powod  !== undefined) { params.push(powod); updates.push(`powod = $${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Brak pól do aktualizacji' });

    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE absencje SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nieobecność nie istnieje' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/hr/headcount ────────────────────────────────────────────────────

router.get('/headcount', async (req, res) => {
  if (!canHR(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });

  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const params   = [];
  const branchFilter = branchId ? ` AND u.oddzial_id = $${params.push(branchId)}` : '';

  try {
    const r = await pool.query(
      `SELECT
         o.id        AS oddzial_id,
         o.nazwa     AS oddzial_nazwa,
         u.rola,
         COUNT(*)    AS count
       FROM users u
       LEFT JOIN branches o ON o.id = u.oddzial_id
       WHERE u.aktywny = true ${branchFilter}
       GROUP BY o.id, o.nazwa, u.rola
       ORDER BY o.nazwa, count DESC`,
      params
    );

    res.json(r.rows.map(row => ({
      oddzial_id:    row.oddzial_id,
      oddzial_nazwa: row.oddzial_nazwa,
      rola:          row.rola,
      count:         Number(row.count),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
