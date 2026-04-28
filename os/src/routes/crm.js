const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const CRM_STAGES = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane'];

function toInt(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normStage(s) {
  const x = String(s || '').trim();
  return CRM_STAGES.includes(x) ? x : 'Lead';
}

function taskStageFromStatus(status) {
  const s = String(status || '').trim();
  if (s === 'Nowe') return 'Lead';
  if (s === 'Zaplanowane') return 'Oferta';
  if (s === 'W_Realizacji' || s === 'W realizacji') return 'W realizacji';
  if (s === 'Zakonczone' || s === 'Zakończone') return 'Wygrane';
  if (s === 'Anulowane') return 'Przegrane';
  return 'Inne';
}

async function mapLeadRow(client, row) {
  const owner = row.owner_user_id
    ? (await client.query('SELECT imie, nazwisko, login FROM users WHERE id = $1', [row.owner_user_id])).rows[0]
    : null;
  let clientName = null;
  if (row.client_id) {
    const kr = (await client.query('SELECT imie, nazwisko, firma FROM klienci WHERE id = $1', [row.client_id])).rows[0];
    if (kr) {
      const full = [kr.imie, kr.nazwisko].filter(Boolean).join(' ').trim();
      clientName = (kr.firma && String(kr.firma).trim()) || full || null;
    }
  }
  return {
    ...row,
    stage: normStage(row.stage),
    owner_name: owner
      ? `${owner.imie || ''} ${owner.nazwisko || ''}`.trim() || owner.login
      : null,
    client_name: clientName,
    tags: Array.isArray(row.tags) ? row.tags : row.tags || [],
  };
}

/** Dashboard CRM — agregaty (pipeline z leadów CRM lub ze zleceń). */
router.get('/overview', async (req, res) => {
  try {
    const oddzialId = toInt(req.query.oddzial_id);
    const d30 = new Date();
    d30.setDate(d30.getDate() - 30);
    const oParam = oddzialId ? [oddzialId] : [];

    const [clientsRes, clientsNew, tasksRes, wonRes, callsRes, crmLeadsRes, tasksRowsRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM klienci'),
      pool.query('SELECT COUNT(*)::int AS c FROM klienci WHERE created_at >= $1', [d30]),
      pool.query(
        oddzialId ? 'SELECT COUNT(*)::int AS c FROM tasks t WHERE t.oddzial_id = $1' : 'SELECT COUNT(*)::int AS c FROM tasks t',
        oParam
      ),
      pool.query(
        oddzialId
          ? 'SELECT COUNT(*)::int AS c FROM tasks t WHERE t.oddzial_id = $1 AND t.status = ANY($2) AND t.updated_at >= $3'
          : 'SELECT COUNT(*)::int AS c FROM tasks t WHERE t.status = ANY($1) AND t.updated_at >= $2',
        oddzialId ? [oddzialId, ['Zakonczone', 'Zakończone'], d30] : [['Zakonczone', 'Zakończone'], d30]
      ),
      pool.query('SELECT COUNT(*)::int AS c FROM phone_call_conversations WHERE created_at >= $1', [d30]),
      pool.query(oddzialId ? 'SELECT * FROM crm_leads l WHERE l.oddzial_id = $1' : 'SELECT * FROM crm_leads l', oParam),
      pool.query(
        oddzialId
          ? 'SELECT id, status, wartosc_planowana FROM tasks t WHERE t.oddzial_id = $1'
          : 'SELECT id, status, wartosc_planowana FROM tasks t',
        oParam
      ),
    ]);

    const crmLeadsRows = crmLeadsRes.rows;
    const tasksRows = tasksRowsRes.rows;

    const pipelineMap = new Map();
    if (crmLeadsRows.length > 0) {
      for (const lead of crmLeadsRows) {
        const stageName = normStage(lead.stage);
        const prev = pipelineMap.get(stageName) || { stage: stageName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(lead.value || 0);
        pipelineMap.set(stageName, prev);
      }
    } else {
      for (const task of tasksRows) {
        const stageName = taskStageFromStatus(task.status);
        const prev = pipelineMap.get(stageName) || { stage: stageName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(task.wartosc_planowana || 0);
        pipelineMap.set(stageName, prev);
      }
    }

    const pipeline = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane', 'Inne']
      .map((stage) => pipelineMap.get(stage) || { stage, count: 0, value: 0 })
      .filter((x) => x.count > 0 || x.stage !== 'Inne');

    const srcRes = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(zrodlo), ''), 'inne') AS source, COUNT(*)::int AS count FROM klienci GROUP BY 1 ORDER BY 2 DESC`
    );

    res.json({
      kpis: {
        clients_total: clientsRes.rows[0]?.c ?? 0,
        clients_new_30d: clientsNew.rows[0]?.c ?? 0,
        tasks_total: tasksRes.rows[0]?.c ?? 0,
        tasks_won_30d: wonRes.rows[0]?.c ?? 0,
        calls_30d: callsRes.rows[0]?.c ?? 0,
        callbacks_open: 0,
        callbacks_overdue: 0,
      },
      pipeline,
      sources: srcRes.rows.map((r) => ({ source: r.source, count: r.count })),
      callbacks: [],
    });
  } catch (err) {
    logger.error('crm.overview', { message: err.message });
    res.status(500).json({ error: 'Błąd odczytu overview CRM' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const oddzialId = toInt(req.query.oddzial_id);
    const ownerId = toInt(req.query.owner_user_id);
    const q = String(req.query.q || '').trim().toLowerCase();
    const stage = String(req.query.stage || '').trim();

    const params = [];
    let w = 'WHERE 1=1';
    if (oddzialId) {
      params.push(oddzialId);
      w += ` AND l.oddzial_id = $${params.length}`;
    }
    if (ownerId) {
      params.push(ownerId);
      w += ` AND l.owner_user_id = $${params.length}`;
    }
    if (stage) {
      params.push(stage);
      w += ` AND l.stage = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT l.*, 
        o.imie as owner_imie, o.nazwisko as owner_nazwisko, o.login as owner_login,
        k.imie as k_imie, k.nazwisko as k_nazwisko, k.firma as k_firma, k.telefon as k_tel, k.email as k_email
      FROM crm_leads l
      LEFT JOIN users o ON o.id = l.owner_user_id
      LEFT JOIN klienci k ON k.id = l.client_id
      ${w}
      ORDER BY l.updated_at DESC NULLS LAST, l.id DESC
      LIMIT 500`,
      params
    );

    const mapped = rows.map((row) => {
      const full = [row.k_imie, row.k_nazwisko].filter(Boolean).join(' ').trim();
      const clientName = (row.k_firma && String(row.k_firma).trim()) || full || null;
      const ownerName = row.owner_user_id
        ? [row.owner_imie, row.owner_nazwisko].filter(Boolean).join(' ').trim() || row.owner_login
        : null;
      const m = { ...row };
      delete m.owner_imie;
      delete m.owner_nazwisko;
      delete m.owner_login;
      delete m.k_imie;
      delete m.k_nazwisko;
      delete m.k_firma;
      delete m.k_tel;
      delete m.k_email;
      m.stage = normStage(m.stage);
      m.owner_name = ownerName;
      m.client_name = clientName;
      if (m.tags == null) m.tags = [];
      return m;
    });

    if (!q) return res.json(mapped);
    const filtered = mapped.filter((x) =>
      [x.title, x.client_name, x.phone, x.email, x.source, x.notes].some((v) => String(v || '').toLowerCase().includes(q))
    );
    res.json(filtered);
  } catch (err) {
    logger.error('crm.leads.list', { message: err.message });
    res.status(500).json({ error: 'Błąd listy leadów' });
  }
});

router.post('/leads', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const oddzialId = toInt(b.oddzial_id);
  if (!title || !oddzialId) {
    return res.status(400).json({ error: 'title i oddzial_id są wymagane' });
  }
  try {
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 16) : []);
    const { rows } = await pool.query(
      `INSERT INTO crm_leads (
        title, oddzial_id, client_id, owner_user_id, stage, source, value, phone, email, notes, tags, next_action_at,
        created_by, created_at, updated_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        title,
        oddzialId,
        toInt(b.client_id) || null,
        toInt(b.owner_user_id) || null,
        normStage(b.stage),
        String(b.source || '').trim() || 'inne',
        toNum(b.value) ?? 0,
        String(b.phone || '').trim() || null,
        String(b.email || '').trim() || null,
        String(b.notes || '').trim() || null,
        tagsJson,
        b.next_action_at || null,
        req.user.id,
        now,
        req.user.id,
        now,
      ]
    );
    const client = await pool.connect();
    try {
      const out = await mapLeadRow(client, rows[0]);
      res.status(201).json(out);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('crm.leads.create', { message: err.message });
    res.status(500).json({ error: 'Nie udało się utworzyć leada' });
  }
});

router.patch('/leads/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const b = req.body || {};
  try {
    const cur = (await pool.query('SELECT * FROM crm_leads WHERE id = $1', [id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Lead nie znaleziony' });

    if (b.title !== undefined) {
      const title = String(b.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title nie może być pusty' });
    }

    const sets = [];
    const p = [id];
    let i = 2;
    if (b.title !== undefined) {
      sets.push(`title = $${i++}`);
      p.push(String(b.title || '').trim());
    }
    if (b.stage !== undefined) {
      sets.push(`stage = $${i++}`);
      p.push(normStage(b.stage));
    }
    if (b.oddzial_id !== undefined) {
      sets.push(`oddzial_id = $${i++}`);
      p.push(toInt(b.oddzial_id) || cur.oddzial_id);
    }
    if (b.client_id !== undefined) {
      sets.push(`client_id = $${i++}`);
      p.push(toInt(b.client_id) || null);
    }
    if (b.owner_user_id !== undefined) {
      sets.push(`owner_user_id = $${i++}`);
      p.push(toInt(b.owner_user_id) || null);
    }
    if (b.source !== undefined) {
      sets.push(`source = $${i++}`);
      p.push(String(b.source || '').trim() || 'inne');
    }
    if (b.value !== undefined) {
      sets.push(`value = $${i++}`);
      p.push(toNum(b.value) ?? 0);
    }
    if (b.phone !== undefined) {
      sets.push(`phone = $${i++}`);
      p.push(String(b.phone || '').trim() || null);
    }
    if (b.email !== undefined) {
      sets.push(`email = $${i++}`);
      p.push(String(b.email || '').trim() || null);
    }
    if (b.notes !== undefined) {
      sets.push(`notes = $${i++}`);
      p.push(String(b.notes || '').trim() || null);
    }
    if (b.next_action_at !== undefined) {
      sets.push(`next_action_at = $${i++}`);
      p.push(b.next_action_at || null);
    }
    if (b.tags !== undefined) {
      sets.push(`tags = $${i++}::jsonb`);
      p.push(JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 16) : []));
    }
    const now = new Date().toISOString();
    sets.push(`updated_at = $${i++}`);
    p.push(now);
    sets.push(`updated_by = $${i++}`);
    p.push(req.user.id);

    if (sets.length === 0) {
      const c = await pool.connect();
      try {
        return res.json(await mapLeadRow(c, cur));
      } finally {
        c.release();
      }
    }

    const { rows } = await pool.query(`UPDATE crm_leads SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, p);
    const c2 = await pool.connect();
    try {
      res.json(await mapLeadRow(c2, rows[0]));
    } finally {
      c2.release();
    }
  } catch (err) {
    logger.error('crm.leads.patch', { message: err.message });
    res.status(500).json({ error: 'Aktualizacja leada nie powiodła się' });
  }
});

router.delete('/leads/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  try {
    const r = await pool.query('DELETE FROM crm_leads WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Lead nie znaleziony' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('crm.leads.delete', { message: err.message });
    res.status(500).json({ error: 'Usunięcie nie powiodło się' });
  }
});

const ACT_TYPES = ['note', 'call', 'task'];
function normActType(t) {
  const v = String(t || '').trim();
  return ACT_TYPES.includes(v) ? v : 'note';
}

router.get('/leads/:id/activities', async (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  try {
    const lead = (await pool.query('SELECT id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    const { rows } = await pool.query(
      `SELECT a.*, u.imie, u.nazwisko, u.login
       FROM crm_lead_activities a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.lead_id = $1
       ORDER BY a.created_at DESC`,
      [leadId]
    );
    const out = rows.map((a) => ({
      id: a.id,
      lead_id: a.lead_id,
      type: a.type,
      text: a.text,
      due_at: a.due_at,
      call_duration_sec: a.call_duration_sec,
      completed_at: a.completed_at,
      created_by: a.created_by,
      created_at: a.created_at,
      author_name: a.imie
        ? `${a.imie || ''} ${a.nazwisko || ''}`.trim() || a.login
        : null,
    }));
    res.json(out);
  } catch (err) {
    logger.error('crm.activities.get', { message: err.message });
    res.status(500).json({ error: 'Błąd odczytu aktywności' });
  }
});

router.post('/leads/:id/activities', async (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const b = req.body || {};
  const type = normActType(b.type);
  const text = String(b.text || b.tresc || '').trim();
  if (!text) return res.status(400).json({ error: 'Pole text (tresc) jest wymagane' });

  if (type === 'call' && b.call_duration_sec != null) {
    const d = toNum(b.call_duration_sec);
    if (d != null && d < 0) return res.status(400).json({ error: 'Nieprawidłowy call_duration_sec' });
  }

  try {
    const lead = (await pool.query('SELECT id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    const now = new Date().toISOString();
    const due = type === 'task' && b.due_at ? b.due_at : null;
    const dur = type === 'call' && b.call_duration_sec != null ? toNum(b.call_duration_sec) : null;
    const { rows } = await pool.query(
      `INSERT INTO crm_lead_activities (lead_id, type, text, due_at, call_duration_sec, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [leadId, type, text, due, dur, req.user.id, now]
    );
    await pool.query('UPDATE crm_leads SET updated_at = $1, updated_by = $2 WHERE id = $3', [now, req.user.id, leadId]);
    const a = rows[0];
    const u = (await pool.query('SELECT imie, nazwisko, login FROM users WHERE id = $1', [req.user.id])).rows[0];
    res.status(201).json({
      ...a,
      author_name: u ? `${u.imie || ''} ${u.nazwisko || ''}`.trim() || u.login : null,
    });
  } catch (err) {
    logger.error('crm.activities.post', { message: err.message });
    res.status(500).json({ error: 'Zapis aktywności nie powiódł się' });
  }
});

router.patch('/leads/:leadId/activities/:activityId', async (req, res) => {
  const leadId = toInt(req.params.leadId);
  const activityId = toInt(req.params.activityId);
  if (!leadId || !activityId) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const completed = req.body && (req.body.completed === true || req.body.done === true);
  if (!completed) return res.json({ ok: true });

  try {
    const act = (
      await pool.query('SELECT * FROM crm_lead_activities WHERE id = $1 AND lead_id = $2', [activityId, leadId])
    ).rows[0];
    if (!act) return res.status(404).json({ error: 'Aktywność nie znaleziona' });
    if (act.type === 'task' && !act.completed_at) {
      const now = new Date().toISOString();
      await pool.query('UPDATE crm_lead_activities SET completed_at = $1 WHERE id = $2', [now, activityId]);
      await pool.query('UPDATE crm_leads SET updated_at = $1, updated_by = $2 WHERE id = $3', [now, req.user.id, leadId]);
      const { rows } = await pool.query('SELECT * FROM crm_lead_activities WHERE id = $1', [activityId]);
      const a = rows[0];
      const u = (await pool.query('SELECT imie, nazwisko, login FROM users WHERE id = $1', [req.user.id])).rows[0];
      return res.json({
        ...a,
        author_name: u ? `${u.imie || ''} ${u.nazwisko || ''}`.trim() || u.login : null,
      });
    }
    res.json(act);
  } catch (err) {
    logger.error('crm.activities.patch', { message: err.message });
    res.status(500).json({ error: 'Aktualizacja aktywności nie powiodła się' });
  }
});

module.exports = router;
