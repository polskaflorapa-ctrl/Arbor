const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isTeamScoped = (u) =>
  ['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(u.rola);

const optionalId = z
  .any()
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) ? null : n;
  });

const towarLineSchema = z.object({
  znak: z.string().max(120).optional().nullable(),
  ilosc: z.string().max(40).optional().nullable(),
  opakowanie: z.string().max(120).optional().nullable(),
  nazwa: z.string().max(500).optional().nullable(),
  masa_kg: z.string().max(40).optional().nullable(),
  objetosc_m3: z.string().max(40).optional().nullable(),
});

const cmrBodyBase = {
  task_id: optionalId,
  vehicle_id: optionalId,
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.string().max(30).optional().nullable(),
  nadawca_nazwa: z.string().max(255).optional().nullable(),
  nadawca_adres: z.string().optional().nullable(),
  nadawca_kraj: z.string().max(3).optional().nullable(),
  odbiorca_nazwa: z.string().max(255).optional().nullable(),
  odbiorca_adres: z.string().optional().nullable(),
  odbiorca_kraj: z.string().max(3).optional().nullable(),
  miejsce_zaladunku: z.string().max(255).optional().nullable(),
  miejsce_rozladunku: z.string().max(255).optional().nullable(),
  data_zaladunku: z.string().max(20).optional().nullable(),
  data_rozladunku: z.string().max(20).optional().nullable(),
  przewoznik_nazwa: z.string().max(255).optional().nullable(),
  przewoznik_adres: z.string().optional().nullable(),
  przewoznik_kraj: z.string().max(3).optional().nullable(),
  kolejni_przewoznicy: z.string().optional().nullable(),
  nr_rejestracyjny: z.string().max(50).optional().nullable(),
  nr_naczepy: z.string().max(50).optional().nullable(),
  kierowca: z.string().max(220).optional().nullable(),
  instrukcje_nadawcy: z.string().optional().nullable(),
  uwagi_do_celnych: z.string().optional().nullable(),
  umowy_szczegolne: z.string().optional().nullable(),
  zalaczniki: z.string().optional().nullable(),
  towary: z.array(towarLineSchema).optional(),
  platnosci: z.any().optional(),
};

const cmrCreateSchema = z.object(cmrBodyBase);
const cmrUpdateSchema = z.object(cmrBodyBase).partial();

const cmrIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const cmrListQuerySchema = z.object({
  task_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function listWhereClause(user) {
  if (isDyrektor(user)) {
    return { sql: 'TRUE', params: [] };
  }
  if (user.rola === 'Kierownik') {
    return {
      sql: '((t.id IS NOT NULL AND t.oddzial_id = $1) OR (c.task_id IS NULL AND c.created_by = $2))',
      params: [user.oddzial_id, user.id],
    };
  }
  if (isTeamScoped(user)) {
    return {
      sql: `(
        (c.task_id IS NULL AND c.created_by = $1)
        OR (
          c.task_id IS NOT NULL AND (
            (t.ekipa_id IS NOT NULL AND t.ekipa_id = $2)
            OR (t.brygadzista_id IS NOT NULL AND t.brygadzista_id = $1)
            OR EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = t.ekipa_id AND tm.user_id = $1
            )
          )
        )
      )`,
      params: [user.id, user.ekipa_id],
    };
  }
  if (['Magazynier', 'Specjalista', 'Wyceniający'].includes(user.rola)) {
    return {
      sql: '((t.id IS NOT NULL AND t.oddzial_id = $1) OR (c.task_id IS NULL AND c.created_by = $2))',
      params: [user.oddzial_id, user.id],
    };
  }
  return { sql: 'FALSE', params: [] };
}

async function canAccessCmr(user, row, taskRow) {
  if (isDyrektor(user)) return true;
  if (user.rola === 'Kierownik') {
    const br = user.oddzial_id;
    if (taskRow && String(taskRow.oddzial_id) === String(br)) return true;
    if (!taskRow && row.created_by != null && String(row.created_by) === String(user.id)) return true;
    return false;
  }
  if (isTeamScoped(user)) {
    if (!taskRow) {
      return row.created_by != null && String(row.created_by) === String(user.id);
    }
    if (user.ekipa_id != null && String(taskRow.ekipa_id) === String(user.ekipa_id)) return true;
    if (taskRow.brygadzista_id != null && String(taskRow.brygadzista_id) === String(user.id)) return true;
    if (!taskRow.ekipa_id) return false;
    const m = await pool.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1',
      [taskRow.ekipa_id, user.id]
    );
    return m.rowCount > 0;
  }
  if (['Magazynier', 'Specjalista', 'Wyceniający'].includes(user.rola)) {
    return row.oddzial_id != null && String(row.oddzial_id) === String(user.oddzial_id);
  }
  return false;
}

async function loadCmrRow(id) {
  const r = await pool.query(
    `SELECT c.*, t.oddzial_id AS _t_oddzial, t.ekipa_id AS _t_ekipa, t.brygadzista_id AS _t_brygadzista,
            t.klient_nazwa AS task_klient_nazwa, t.status AS task_status,
            v.nr_rejestracyjny AS pojazd_nr_rejestracyjny, v.marka AS pojazd_marka, v.model AS pojazd_model
     FROM cmr_lists c
     LEFT JOIN tasks t ON c.task_id = t.id
     LEFT JOIN vehicles v ON c.vehicle_id = v.id
     WHERE c.id = $1`,
    [id]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const taskRow =
    row.task_id != null
      ? {
          oddzial_id: row._t_oddzial,
          ekipa_id: row._t_ekipa,
          brygadzista_id: row._t_brygadzista,
        }
      : null;
  delete row._t_oddzial;
  delete row._t_ekipa;
  delete row._t_brygadzista;
  return { row, taskRow };
}

async function nextNumer(client) {
  const year = new Date().getFullYear();
  const r = await client.query('SELECT nextval(\'cmr_numer_seq\') AS n');
  const seq = r.rows[0].n;
  return `CMR/PL/${year}/${String(seq).padStart(6, '0')}`;
}

function normalizeTowary(t) {
  if (!Array.isArray(t)) return [];
  return t.map((x) => ({
    znak: x.znak ?? null,
    ilosc: x.ilosc ?? null,
    opakowanie: x.opakowanie ?? null,
    nazwa: x.nazwa ?? null,
    masa_kg: x.masa_kg ?? null,
    objetosc_m3: x.objetosc_m3 ?? null,
  }));
}

// GET /api/cmr
router.get('/', authMiddleware, validateQuery(cmrListQuerySchema), async (req, res) => {
  try {
    const { task_id, limit = 200, offset = 0 } = req.query;
    const { sql, params } = listWhereClause(req.user);
    const conds = [sql];
    const p = [...params];
    let n = p.length + 1;
    if (task_id) {
      conds.push(`c.task_id = $${n}`);
      p.push(task_id);
      n += 1;
    }
    const where = conds.join(' AND ');
    const q = `
      SELECT c.*, t.klient_nazwa AS task_klient_nazwa, t.status AS task_status,
             v.nr_rejestracyjny AS pojazd_nr_rejestracyjny
      FROM cmr_lists c
      LEFT JOIN tasks t ON c.task_id = t.id
      LEFT JOIN vehicles v ON c.vehicle_id = v.id
      WHERE ${where}
      ORDER BY c.created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `;
    const r = await pool.query(q, p);
    res.json(r.rows);
  } catch (err) {
    logger.error('cmr list', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// GET /api/cmr/:id
router.get('/:id', authMiddleware, validateParams(cmrIdParamsSchema), async (req, res) => {
  try {
    const loaded = await loadCmrRow(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Nie znaleziono CMR' });
    const ok = await canAccessCmr(req.user, loaded.row, loaded.taskRow);
    if (!ok) return res.status(403).json({ error: 'Brak dostępu' });
    res.json(loaded.row);
  } catch (err) {
    logger.error('cmr get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// POST /api/cmr
router.post('/', authMiddleware, validateBody(cmrCreateSchema), async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body;
    const oddzial_id = null;
    let taskRow = null;
    if (b.task_id) {
      const tr = await client.query(
        'SELECT id, oddzial_id, ekipa_id, brygadzista_id FROM tasks WHERE id = $1',
        [b.task_id]
      );
      if (!tr.rows.length) {
        await client.release();
        return res.status(400).json({ error: 'Nieprawidłowe zlecenie' });
      }
      taskRow = tr.rows[0];
      const ok = await canAccessCmr(req.user, { oddzial_id: null, task_id: b.task_id }, taskRow);
      if (!ok) {
        await client.release();
        return res.status(403).json({ error: 'Brak dostępu do zlecenia' });
      }
    }
    if (b.vehicle_id) {
      const vr = await client.query('SELECT id, oddzial_id FROM vehicles WHERE id = $1', [b.vehicle_id]);
      if (!vr.rows.length) {
        await client.release();
        return res.status(400).json({ error: 'Nieprawidłowy pojazd' });
      }
    }
    await client.query('BEGIN');
    const numer = await nextNumer(client);
    const towary = JSON.stringify(normalizeTowary(b.towary));
    const platnosci = JSON.stringify(b.platnosci && typeof b.platnosci === 'object' ? b.platnosci : {});
    const ins = await client.query(
      `INSERT INTO cmr_lists (
        numer, oddzial_id, task_id, vehicle_id, status,
        nadawca_nazwa, nadawca_adres, nadawca_kraj, odbiorca_nazwa, odbiorca_adres, odbiorca_kraj,
        miejsce_zaladunku, miejsce_rozladunku, data_zaladunku, data_rozladunku,
        przewoznik_nazwa, przewoznik_adres, przewoznik_kraj, kolejni_przewoznicy,
        nr_rejestracyjny, nr_naczepy, kierowca,
        instrukcje_nadawcy, uwagi_do_celnych, umowy_szczegolne, zalaczniki,
        towary, platnosci, created_by
      ) VALUES (
        $1,$2,$3,$4,COALESCE($5,'Roboczy'),
        $6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,
        $23,$24,$25,$26,
        $27::jsonb,$28::jsonb,$29
      ) RETURNING *`,
      [
        numer,
        oddzial_id,
        b.task_id,
        b.vehicle_id,
        b.status,
        b.nadawca_nazwa,
        b.nadawca_adres,
        b.nadawca_kraj || 'PL',
        b.odbiorca_nazwa,
        b.odbiorca_adres,
        b.odbiorca_kraj || 'PL',
        b.miejsce_zaladunku,
        b.miejsce_rozladunku,
        b.data_zaladunku || null,
        b.data_rozladunku || null,
        b.przewoznik_nazwa,
        b.przewoznik_adres,
        b.przewoznik_kraj,
        b.kolejni_przewoznicy,
        b.nr_rejestracyjny,
        b.nr_naczepy,
        b.kierowca,
        b.instrukcje_nadawcy,
        b.uwagi_do_celnych,
        b.umowy_szczegolne,
        b.zalaczniki,
        towary,
        platnosci,
        req.user.id,
      ]
    );
    await client.query('COMMIT');
    await client.release();
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_e) {
      /* ignore */
    }
    client.release();
    logger.error('cmr create', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message || req.t('errors.http.serverError') });
  }
});

// PUT /api/cmr/:id
router.put('/:id', authMiddleware, validateParams(cmrIdParamsSchema), validateBody(cmrUpdateSchema), async (req, res) => {
  try {
    const loaded = await loadCmrRow(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Nie znaleziono CMR' });
    const ok = await canAccessCmr(req.user, loaded.row, loaded.taskRow);
    if (!ok) return res.status(403).json({ error: 'Brak dostępu' });

    const b = req.body;
    const fields = [];
    const vals = [];
    let i = 1;
    const set = (col, val) => {
      fields.push(`${col} = $${i}`);
      vals.push(val);
      i += 1;
    };

    if (b.task_id !== undefined) set('task_id', b.task_id);
    if (b.vehicle_id !== undefined) set('vehicle_id', b.vehicle_id);
    if (b.status != null) set('status', b.status);
    if (b.nadawca_nazwa !== undefined) set('nadawca_nazwa', b.nadawca_nazwa);
    if (b.nadawca_adres !== undefined) set('nadawca_adres', b.nadawca_adres);
    if (b.nadawca_kraj !== undefined) set('nadawca_kraj', b.nadawca_kraj);
    if (b.odbiorca_nazwa !== undefined) set('odbiorca_nazwa', b.odbiorca_nazwa);
    if (b.odbiorca_adres !== undefined) set('odbiorca_adres', b.odbiorca_adres);
    if (b.odbiorca_kraj !== undefined) set('odbiorca_kraj', b.odbiorca_kraj);
    if (b.miejsce_zaladunku !== undefined) set('miejsce_zaladunku', b.miejsce_zaladunku);
    if (b.miejsce_rozladunku !== undefined) set('miejsce_rozladunku', b.miejsce_rozladunku);
    if (b.data_zaladunku !== undefined) set('data_zaladunku', b.data_zaladunku || null);
    if (b.data_rozladunku !== undefined) set('data_rozladunku', b.data_rozladunku || null);
    if (b.przewoznik_nazwa !== undefined) set('przewoznik_nazwa', b.przewoznik_nazwa);
    if (b.przewoznik_adres !== undefined) set('przewoznik_adres', b.przewoznik_adres);
    if (b.przewoznik_kraj !== undefined) set('przewoznik_kraj', b.przewoznik_kraj);
    if (b.kolejni_przewoznicy !== undefined) set('kolejni_przewoznicy', b.kolejni_przewoznicy);
    if (b.nr_rejestracyjny !== undefined) set('nr_rejestracyjny', b.nr_rejestracyjny);
    if (b.nr_naczepy !== undefined) set('nr_naczepy', b.nr_naczepy);
    if (b.kierowca !== undefined) set('kierowca', b.kierowca);
    if (b.instrukcje_nadawcy !== undefined) set('instrukcje_nadawcy', b.instrukcje_nadawcy);
    if (b.uwagi_do_celnych !== undefined) set('uwagi_do_celnych', b.uwagi_do_celnych);
    if (b.umowy_szczegolne !== undefined) set('umowy_szczegolne', b.umowy_szczegolne);
    if (b.zalaczniki !== undefined) set('zalaczniki', b.zalaczniki);
    if (b.towary !== undefined) {
      fields.push(`towary = $${i}::jsonb`);
      vals.push(JSON.stringify(normalizeTowary(b.towary)));
      i += 1;
    }
    if (b.platnosci !== undefined) {
      fields.push(`platnosci = $${i}::jsonb`);
      vals.push(JSON.stringify(typeof b.platnosci === 'object' && b.platnosci ? b.platnosci : {}));
      i += 1;
    }
    fields.push('oddzial_id = NULL');
    fields.push('updated_at = NOW()');
    vals.push(req.params.id);
    const q = `UPDATE cmr_lists SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
    const r = await pool.query(q, vals);
    res.json(r.rows[0]);
  } catch (err) {
    logger.error('cmr put', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = { router, loadCmrRow, canAccessCmr };
