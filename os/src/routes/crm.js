const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin, isSalesDirector, scopedOddzialId } = require('../middleware/auth');
const { createWorkflowRule, listWorkflowRules, runWorkflowRules } = require('../services/crmWorkflows');
const { createIntegrationApp, listIntegrationApps, listIntegrationEvents } = require('../services/crmIntegrations');
const { generateLeadAssistant } = require('../services/crmAiAssistant');

const router = express.Router();
router.use(authMiddleware);

const CRM_STAGES = ['Lead', 'Oględziny', 'Do zatwierdzenia', 'Plan ekipy', 'W realizacji', 'Wygrane', 'Przegrane'];

CRM_STAGES.push('Techniczny');
const CRM_PIPELINE_ORDER = [...CRM_STAGES, 'Inne'];
const CRM_CLOSE_REASONS = [
  'Rezygnacja klienta',
  'Drogo',
  'Znaleźli szybszy termin oględzin',
  'Znaleźli szybszą realizację',
  'Znaleźli taniej',
  'Pomyłka',
  'Praca innego miasta',
  'Nie odbiera',
  'Dubl',
  'Nie pracujemy w tym rejonie',
  'Nie wykonujemy podobnych prac',
  'Informacja dla znajomych',
  'Kontakt w sprawie oferty pracy',
];
const CRM_TECHNICAL_CLOSE_REASONS = new Set([
  'Pomyłka',
  'Praca innego miasta',
  'Dubl',
  'Nie pracujemy w tym rejonie',
  'Nie wykonujemy podobnych prac',
  'Informacja dla znajomych',
  'Kontakt w sprawie oferty pracy',
]);

function canAccessOddzial(user, oddzialId) {
  if (isDyrektorOrAdmin(user) || isSalesDirector(user)) return true;
  if (oddzialId == null) return false;
  return String(user?.oddzial_id || '') === String(oddzialId);
}

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

function normCompare(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normCloseReason(reason) {
  const value = normCompare(reason);
  if (!value) return '';
  return CRM_CLOSE_REASONS.find((item) => normCompare(item) === value) || '';
}

function isClosedStage(stage) {
  return ['Przegrane', 'Techniczny'].includes(normStage(stage));
}

function isTechnicalCloseReason(reason) {
  return CRM_TECHNICAL_CLOSE_REASONS.has(normCloseReason(reason));
}

function closeStageForReason(reason) {
  return isTechnicalCloseReason(reason) ? 'Techniczny' : 'Przegrane';
}

function taskStageFromStatus(status) {
  const s = String(status || '').trim();
  if (s === 'Nowe') return 'Lead';
  if (s === 'Wycena_Terenowa') return 'Oględziny';
  if (s === 'Do_Zatwierdzenia') return 'Do zatwierdzenia';
  if (s === 'Zaplanowane') return 'Plan ekipy';
  if (s === 'W_Realizacji' || s === 'W realizacji') return 'W realizacji';
  if (s === 'Zakonczone' || s === 'Zakończone') return 'Wygrane';
  if (s === 'Anulowane') return 'Przegrane';
  return 'Inne';
}

function pct(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  return t > 0 ? Math.round((p / t) * 100) : 0;
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
    const oddzialId = scopedOddzialId(req.user, toInt(req.query.oddzial_id));
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
      pool.query(
        `${oddzialId ? 'SELECT l.*' : 'SELECT l.*'},
          o.imie as owner_imie, o.nazwisko as owner_nazwisko, o.login as owner_login
         FROM crm_leads l
         LEFT JOIN users o ON o.id = l.owner_user_id
         ${oddzialId ? 'WHERE l.oddzial_id = $1' : ''}`,
        oParam
      ),
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

    const pipeline = CRM_PIPELINE_ORDER
      .map((stage) => pipelineMap.get(stage) || { stage, count: 0, value: 0 })
      .filter((x) => x.count > 0 || x.stage !== 'Inne');

    const sourceMap = new Map();
    const ownerMap = new Map();
    const conversion = { total: 0, open: 0, won: 0, lost: 0, technical: 0, value_total: 0, won_value: 0 };
    for (const lead of crmLeadsRows) {
      const stage = normStage(lead.stage);
      const value = Number(lead.value || 0);
      const technical = stage === 'Techniczny' || lead.close_bucket === 'technical';
      const won = stage === 'Wygrane';
      const lost = stage === 'Przegrane' || lead.close_bucket === 'lost';
      const source = String(lead.source || '').trim() || 'inne';
      const ownerKey = lead.owner_user_id ? String(lead.owner_user_id) : 'none';
      const ownerName = lead.owner_user_id
        ? [lead.owner_imie, lead.owner_nazwisko].filter(Boolean).join(' ').trim() || lead.owner_login || `#${lead.owner_user_id}`
        : 'Bez ownera';

      conversion.total += 1;
      conversion.value_total += value;
      if (technical) conversion.technical += 1;
      else if (won) {
        conversion.won += 1;
        conversion.won_value += value;
      } else if (lost) conversion.lost += 1;
      else conversion.open += 1;

      const src = sourceMap.get(source) || { source, count: 0, value: 0, won: 0, lost: 0, technical: 0 };
      src.count += 1;
      src.value += value;
      if (technical) src.technical += 1;
      else if (won) src.won += 1;
      else if (lost) src.lost += 1;
      sourceMap.set(source, src);

      const owner = ownerMap.get(ownerKey) || { owner_user_id: lead.owner_user_id || null, owner_name: ownerName, count: 0, open: 0, won: 0, lost: 0, value: 0, won_value: 0 };
      owner.count += 1;
      owner.value += value;
      if (won) {
        owner.won += 1;
        owner.won_value += value;
      } else if (lost) owner.lost += 1;
      else if (!technical) owner.open += 1;
      ownerMap.set(ownerKey, owner);
    }

    let sources = Array.from(sourceMap.values()).map((row) => ({
      ...row,
      conversion_rate: pct(row.won, row.count - row.technical),
    })).sort((a, b) => b.count - a.count);

    if (sources.length === 0) {
      const srcRes = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(zrodlo), ''), 'inne') AS source, COUNT(*)::int AS count FROM klienci GROUP BY 1 ORDER BY 2 DESC`
      );
      sources = srcRes.rows.map((r) => ({ source: r.source, count: r.count, value: 0, won: 0, lost: 0, technical: 0, conversion_rate: 0 }));
    }

    const owners = Array.from(ownerMap.values())
      .map((row) => ({ ...row, conversion_rate: pct(row.won, row.count) }))
      .sort((a, b) => b.won_value - a.won_value || b.count - a.count)
      .slice(0, 12);

    let callbacksOpen = 0;
    let callbacksOverdue = 0;
    let callbacks = [];
    try {
      const tableCheck = await pool.query(`SELECT to_regclass('public.telephony_callbacks') IS NOT NULL AS exists`);
      if (tableCheck.rows[0]?.exists) {
        const callbackParams = [];
        let callbackWhere = 'WHERE status IN ($1,$2)';
        callbackParams.push('open', 'in_progress');
        if (oddzialId) {
          callbackParams.push(oddzialId);
          callbackWhere += ` AND oddzial_id = $${callbackParams.length}`;
        }
        const callbackRows = await pool.query(
          `
          SELECT id, oddzial_id, phone, task_id, lead_name, priority, due_at, status, notes, assigned_user_id, created_at
          FROM telephony_callbacks
          ${callbackWhere}
          ORDER BY COALESCE(due_at, created_at) ASC
          LIMIT 12
          `,
          callbackParams
        );
        const now = new Date();
        callbacks = callbackRows.rows || [];
        callbacksOpen = callbacks.length;
        callbacksOverdue = callbacks.filter((row) => row.due_at && new Date(row.due_at) < now).length;
      }
    } catch (e) {
      logger.warn('crm.overview.callbacks', { message: e.message });
    }

    res.json({
      kpis: {
        clients_total: clientsRes.rows[0]?.c ?? 0,
        clients_new_30d: clientsNew.rows[0]?.c ?? 0,
        tasks_total: tasksRes.rows[0]?.c ?? 0,
        tasks_won_30d: wonRes.rows[0]?.c ?? 0,
        technical_leads: crmLeadsRows.filter((lead) => normStage(lead.stage) === 'Techniczny' || lead.close_bucket === 'technical').length,
        qualified_leads_total: crmLeadsRows.filter((lead) => normStage(lead.stage) !== 'Techniczny' && lead.close_bucket !== 'technical').length,
        calls_30d: callsRes.rows[0]?.c ?? 0,
        callbacks_open: callbacksOpen,
        callbacks_overdue: callbacksOverdue,
        lead_win_rate: pct(conversion.won, conversion.total - conversion.technical),
      },
      pipeline,
      sources,
      analytics: {
        conversion: {
          ...conversion,
          win_rate: pct(conversion.won, conversion.total - conversion.technical),
          loss_rate: pct(conversion.lost, conversion.total - conversion.technical),
          open_rate: pct(conversion.open, conversion.total - conversion.technical),
        },
        owners,
      },
      callbacks,
    });
  } catch (err) {
    logger.error('crm.overview', { message: err.message });
    res.status(500).json({ error: 'Błąd odczytu overview CRM' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const oddzialId = scopedOddzialId(req.user, toInt(req.query.oddzial_id));
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
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }
  const requestedStage = normStage(b.stage);
  const closeReason = normCloseReason(b.close_reason || b.closure_reason || b.closeReason);
  if (isClosedStage(requestedStage) && !closeReason) {
    return res.status(400).json({ error: 'Powod zamkniecia leada jest wymagany' });
  }
  try {
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(Array.isArray(b.tags) ? b.tags.slice(0, 16) : []);
    const { rows } = await pool.query(
      `INSERT INTO crm_leads (
        title, oddzial_id, client_id, owner_user_id, stage, source, value, phone, email, notes, tags, next_action_at,
        close_reason, close_bucket, closed_at, closed_by, created_by, created_at, updated_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [
        title,
        oddzialId,
        toInt(b.client_id) || null,
        toInt(b.owner_user_id) || null,
        isClosedStage(requestedStage) ? closeStageForReason(closeReason) : requestedStage,
        String(b.source || '').trim() || 'inne',
        toNum(b.value) ?? 0,
        String(b.phone || '').trim() || null,
        String(b.email || '').trim() || null,
        String(b.notes || '').trim() || null,
        tagsJson,
        b.next_action_at || null,
        closeReason || null,
        closeReason ? (isTechnicalCloseReason(closeReason) ? 'technical' : 'lost') : null,
        closeReason ? now : null,
        closeReason ? req.user.id : null,
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
    if (!canAccessOddzial(req.user, cur.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }
    if (b.oddzial_id !== undefined && !canAccessOddzial(req.user, toInt(b.oddzial_id) || cur.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }

    if (b.title !== undefined) {
      const title = String(b.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title nie może być pusty' });
    }

    const sets = [];
    const p = [id];
    let i = 2;
    const now = new Date().toISOString();
    if (b.title !== undefined) {
      sets.push(`title = $${i++}`);
      p.push(String(b.title || '').trim());
    }
    const hasStagePatch = b.stage !== undefined;
    const hasCloseReasonPatch = b.close_reason !== undefined || b.closure_reason !== undefined || b.closeReason !== undefined;
    const nextStage = hasStagePatch ? normStage(b.stage) : normStage(cur.stage);
    const nextCloseReason = hasCloseReasonPatch
      ? normCloseReason(b.close_reason || b.closure_reason || b.closeReason)
      : normCloseReason(cur.close_reason);
    if (hasStagePatch && isClosedStage(nextStage)) {
      if (!nextCloseReason) return res.status(400).json({ error: 'Powod zamkniecia leada jest wymagany' });
      sets.push(`stage = $${i++}`);
      p.push(closeStageForReason(nextCloseReason));
      sets.push(`close_reason = $${i++}`);
      p.push(nextCloseReason);
      sets.push(`close_bucket = $${i++}`);
      p.push(isTechnicalCloseReason(nextCloseReason) ? 'technical' : 'lost');
      sets.push(`closed_at = $${i++}`);
      p.push(cur.closed_at || now);
      sets.push(`closed_by = $${i++}`);
      p.push(req.user.id);
    } else if (hasStagePatch) {
      sets.push(`stage = $${i++}`);
      p.push(nextStage);
      sets.push(`close_reason = $${i++}`);
      p.push(null);
      sets.push(`close_bucket = $${i++}`);
      p.push(null);
      sets.push(`closed_at = $${i++}`);
      p.push(null);
      sets.push(`closed_by = $${i++}`);
      p.push(null);
    } else if (hasCloseReasonPatch && isClosedStage(cur.stage)) {
      if (!nextCloseReason) return res.status(400).json({ error: 'Powod zamkniecia leada jest wymagany' });
      sets.push(`stage = $${i++}`);
      p.push(closeStageForReason(nextCloseReason));
      sets.push(`close_reason = $${i++}`);
      p.push(nextCloseReason);
      sets.push(`close_bucket = $${i++}`);
      p.push(isTechnicalCloseReason(nextCloseReason) ? 'technical' : 'lost');
      sets.push(`closed_at = $${i++}`);
      p.push(cur.closed_at || now);
      sets.push(`closed_by = $${i++}`);
      p.push(req.user.id);
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
    const cur = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, cur.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }
    const r = await pool.query('DELETE FROM crm_leads WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Lead nie znaleziony' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('crm.leads.delete', { message: err.message });
    res.status(500).json({ error: 'Usunięcie nie powiodło się' });
  }
});

router.get('/workflows', async (req, res) => {
  try {
    const oddzialId = scopedOddzialId(req.user, toInt(req.query.oddzial_id));
    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';
    const rules = await listWorkflowRules({ oddzialId, includeInactive });
    res.json(rules);
  } catch (err) {
    logger.error('crm.workflows.list', { message: err.message });
    res.status(500).json({ error: 'Blad odczytu automatyzacji CRM' });
  }
});

router.post('/workflows', async (req, res) => {
  const b = req.body || {};
  const oddzialId = scopedOddzialId(req.user, toInt(b.oddzial_id || req.query.oddzial_id));
  if (!oddzialId) return res.status(400).json({ error: 'oddzial_id jest wymagany' });
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }
  try {
    const rule = await createWorkflowRule({
      oddzialId,
      name: b.name,
      triggerType: b.trigger_type,
      triggerConfig: b.trigger_config,
      actionType: b.action_type,
      actionConfig: b.action_config,
      active: b.active !== false,
      userId: req.user.id,
    });
    res.status(201).json(rule);
  } catch (err) {
    logger.error('crm.workflows.create', { message: err.message });
    res.status(500).json({ error: 'Nie udalo sie zapisac automatyzacji CRM' });
  }
});

router.post('/workflows/run', async (req, res) => {
  const b = req.body || {};
  const oddzialId = scopedOddzialId(req.user, toInt(b.oddzial_id || req.query.oddzial_id));
  if (!oddzialId) return res.status(400).json({ error: 'oddzial_id jest wymagany' });
  if (!canAccessOddzial(req.user, oddzialId)) {
    return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  }
  try {
    const out = await runWorkflowRules({ oddzialId, ruleId: toInt(b.rule_id || req.query.rule_id), userId: req.user.id });
    res.json(out);
  } catch (err) {
    logger.error('crm.workflows.run', { message: err.message });
    res.status(500).json({ error: 'Uruchomienie automatyzacji CRM nie powiodlo sie' });
  }
});

router.get('/integrations/apps', async (req, res) => {
  try {
    const oddzialId = scopedOddzialId(req.user, toInt(req.query.oddzial_id));
    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';
    const apps = await listIntegrationApps({ oddzialId, includeInactive });
    res.json(apps);
  } catch (err) {
    logger.error('crm.integrations.apps.list', { message: err.message });
    res.status(500).json({ error: 'Blad odczytu aplikacji integracyjnych CRM' });
  }
});

router.post('/integrations/apps', async (req, res) => {
  const b = req.body || {};
  const oddzialId = scopedOddzialId(req.user, toInt(b.oddzial_id || req.query.oddzial_id));
  if (!oddzialId) return res.status(400).json({ error: 'oddzial_id jest wymagany' });
  if (!canAccessOddzial(req.user, oddzialId)) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
  try {
    const app = await createIntegrationApp({
      oddzialId,
      name: b.name,
      type: b.type,
      config: b.config,
      userId: req.user.id,
    });
    res.status(201).json(app);
  } catch (err) {
    logger.error('crm.integrations.apps.create', { message: err.message });
    res.status(500).json({ error: 'Nie udalo sie utworzyc aplikacji integracyjnej CRM' });
  }
});

router.get('/integrations/events', async (req, res) => {
  try {
    const oddzialId = scopedOddzialId(req.user, toInt(req.query.oddzial_id));
    const events = await listIntegrationEvents({ oddzialId, limit: toInt(req.query.limit) || 100 });
    res.json(events);
  } catch (err) {
    logger.error('crm.integrations.events.list', { message: err.message });
    res.status(500).json({ error: 'Blad odczytu zdarzen integracji CRM' });
  }
});

router.post('/leads/:id/ai-assistant', async (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidlowe id leada' });
  try {
    const lead = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, lead.oddzial_id)) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    const assistant = await generateLeadAssistant({ leadId });
    res.json({ lead_id: leadId, generated_at: new Date().toISOString(), ...assistant });
  } catch (err) {
    logger.error('crm.aiAssistant', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: 'AI CRM nie powiodlo sie' });
  }
});

const ACT_TYPES = ['note', 'call', 'task'];
function normActType(t) {
  const v = String(t || '').trim();
  return ACT_TYPES.includes(v) ? v : 'note';
}

const MESSAGE_CHANNELS = ['whatsapp', 'instagram', 'facebook', 'messenger', 'telegram', 'email', 'sms', 'phone', 'webchat', 'other'];
const MESSAGE_DIRECTIONS = ['inbound', 'outbound'];
const MESSAGE_STATUSES = ['received', 'queued', 'sent', 'delivered', 'read', 'failed'];

function normMessageChannel(channel) {
  const value = String(channel || '').trim().toLowerCase();
  return MESSAGE_CHANNELS.includes(value) ? value : 'other';
}

function normMessageDirection(direction) {
  const value = String(direction || '').trim().toLowerCase();
  return MESSAGE_DIRECTIONS.includes(value) ? value : 'inbound';
}

function normMessageStatus(status, direction) {
  const value = String(status || '').trim().toLowerCase();
  if (MESSAGE_STATUSES.includes(value)) return value;
  return normMessageDirection(direction) === 'outbound' ? 'sent' : 'received';
}

function safeJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function mapMessageRow(row) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    channel: normMessageChannel(row.channel),
    direction: normMessageDirection(row.direction),
    sender_name: row.sender_name,
    sender_handle: row.sender_handle,
    recipient_handle: row.recipient_handle,
    subject: row.subject,
    body: row.body,
    status: normMessageStatus(row.status, row.direction),
    external_message_id: row.external_message_id,
    external_thread_id: row.external_thread_id,
    template_key: row.template_key,
    dynamic_fields: row.dynamic_fields || {},
    metadata: row.metadata || {},
    delivered_at: row.delivered_at,
    read_at: row.read_at,
    created_by: row.created_by,
    created_at: row.created_at,
    author_name: row.imie
      ? `${row.imie || ''} ${row.nazwisko || ''}`.trim() || row.login
      : null,
  };
}

router.get('/leads/:id/activities', async (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  try {
    const lead = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, lead.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }
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
    const lead = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, lead.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }
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
    const lead = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, lead.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }
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

router.get('/leads/:id/messages', async (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidlowe id leada' });
  try {
    const lead = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, lead.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }

    const params = [leadId];
    let where = 'WHERE m.lead_id = $1';
    const channel = String(req.query.channel || '').trim().toLowerCase();
    if (channel && MESSAGE_CHANNELS.includes(channel)) {
      params.push(channel);
      where += ` AND m.channel = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT m.*, u.imie, u.nazwisko, u.login
       FROM crm_lead_messages m
       LEFT JOIN users u ON u.id = m.created_by
       ${where}
       ORDER BY m.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows.map(mapMessageRow));
  } catch (err) {
    logger.error('crm.messages.get', { message: err.message });
    res.status(500).json({ error: 'Blad odczytu wiadomosci CRM' });
  }
});

router.post('/leads/:id/messages', async (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidlowe id leada' });
  const b = req.body || {};
  const body = String(b.body || b.text || b.tresc || '').trim();
  if (!body) return res.status(400).json({ error: 'Pole body jest wymagane' });

  try {
    const lead = (await pool.query('SELECT id, oddzial_id FROM crm_leads WHERE id = $1', [leadId])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead nie znaleziony' });
    if (!canAccessOddzial(req.user, lead.oddzial_id)) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    }

    const direction = normMessageDirection(b.direction);
    const channel = normMessageChannel(b.channel);
    const status = normMessageStatus(b.status, direction);
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO crm_lead_messages (
        lead_id, channel, direction, sender_name, sender_handle, recipient_handle, subject, body, status,
        external_message_id, external_thread_id, template_key, dynamic_fields, metadata,
        delivered_at, read_at, created_by, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18)
      RETURNING *`,
      [
        leadId,
        channel,
        direction,
        String(b.sender_name || '').trim() || null,
        String(b.sender_handle || '').trim() || null,
        String(b.recipient_handle || '').trim() || null,
        String(b.subject || '').trim() || null,
        body,
        status,
        String(b.external_message_id || '').trim() || null,
        String(b.external_thread_id || '').trim() || null,
        String(b.template_key || '').trim() || null,
        JSON.stringify(safeJsonObject(b.dynamic_fields)),
        JSON.stringify(safeJsonObject(b.metadata)),
        b.delivered_at || null,
        b.read_at || null,
        req.user.id,
        now,
      ]
    );
    await pool.query('UPDATE crm_leads SET updated_at = $1, updated_by = $2 WHERE id = $3', [now, req.user.id, leadId]);
    const user = (await pool.query('SELECT imie, nazwisko, login FROM users WHERE id = $1', [req.user.id])).rows[0];
    res.status(201).json(mapMessageRow({ ...rows[0], ...(user || {}) }));
  } catch (err) {
    logger.error('crm.messages.post', { message: err.message });
    res.status(500).json({ error: 'Zapis wiadomosci CRM nie powiodl sie' });
  }
});

module.exports = router;
