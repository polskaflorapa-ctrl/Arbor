const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { env } = require('../config/env');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const {
  formatSmsPlanParts,
  knownSmsTemplateKey,
  listSmsStatusTemplates,
  renderSmsStatusTemplate,
  upsertSmsStatusTemplate,
} = require('../services/smsTemplates');
const { sendSmsGateway, activeSmsProvider } = require('../services/smsGateway');
const { appendCrmMessageForContact } = require('../services/crmInbox');

const router = express.Router();

const smsWyslijSchema = z.object({
  telefon: z.string().trim().min(1, 'Podaj telefon i tresc SMS'),
  tresc: z.string().trim().min(1, 'Podaj telefon i tresc SMS'),
  task_id: z.coerce.number().int().positive().optional().nullable(),
});

const smsZlecenieBodySchema = z.object({
  typ: z.string().trim().min(1),
  powod: z.string().optional().nullable(),
});

const smsTaskIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const smsHistoriaTaskParamsSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

const smsBulkSchema = z.object({
  typ: z.string().trim().min(1),
  data: z.string().max(20).optional(),
});

const smsTemplatesQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
});

const smsTemplateParamsSchema = z.object({
  key: z.string().trim().min(1).max(80),
});

const smsTemplateBodySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
  body: z.string().trim().min(1).max(1000),
  active: z.boolean().optional(),
});

const smsHistoriaQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().max(200).optional(),
  status: z.string().max(80).optional(),
  date_from: z.string().max(10).optional(),
  date_to: z.string().max(10).optional(),
});

const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseHistoriaDate(s) {
  if (s == null || String(s).trim() === '') return null;
  const t = String(s).trim().slice(0, 10);
  if (!isoDateOnly.test(t)) return null;
  return t;
}

// Thin wrapper — historia jest zapisywana przez smsGateway
function publicTrackUrl(task) {
  const token = task?.link_statusowy_token;
  if (!token) return null;
  const base = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/track/${token}` : `/track/${token}`;
}

const _logSmsHistory = async (task_id, telefon, tresc, status, sid = null, error = null) => {
  try {
    await pool.query(
      `INSERT INTO sms_history (task_id, telefon, tresc, status, sid, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT DO NOTHING`,
      [task_id, telefon, tresc, status, sid, error]
    );
  } catch (err) {
    logger.warn('sms.logHistory', { message: err.message });
  }
};

const SZABLONY = {
  zaplanowane: (z, data) => {
    const { dateStr, windowStr } = formatSmsPlanParts(z, data);
    return `Dzień dobry ${z.klient_nazwa || ''}! Twoje zlecenie (${z.typ_uslugi}) zostało zaplanowane na ${dateStr} w godz. ${windowStr}. Firma ARBOR. Pytania: ${z.oddzial_telefon || 'brak'}`;
  },
  w_drodze: (z) => `Ekipa ARBOR jest w drodze do Państwa. Szacowany czas przyjazdu: ok. 30 min. Zlecenie: ${z.typ_uslugi}, ${z.adres}. Śledzenie: arbor-os.pl/track/${z.link_statusowy_token || z.id}`,
  na_miejscu: (z) => `Ekipa ARBOR rozpoczęła prace przy ${z.adres}, ${z.miasto}. W razie pytań: kontakt z brygadzistą. Zespół ARBOR`,
  zakonczone: (_z) => `Prace zakończone! Dziękujemy za skorzystanie z usług ARBOR. Podsumowanie i zdjęcia zostaną wysłane na email. Zespół ARBOR`,
  problem: (z, powod) => `Informujemy, że realizacja zlecenia przy ${z.adres} jest opóźniona z powodu: ${powod}. Nowy szacowany czas zakończenia: +2h. Przepraszamy za niedogodności. Zespół ARBOR`,
  anulowane: (z) => `Informujemy o konieczności przełożenia wizyty przy ${z.adres}, ${z.miasto}. Skontaktujemy się w ciągu 24h, aby ustalić nowy termin. Przepraszamy. Zespół ARBOR`,
  przypomnienie: (z, data) => {
    const { dateStr, windowStr } = formatSmsPlanParts(z, data);
    return `Przypomnienie: ${dateStr}, ok. ${windowStr} — realizujemy zlecenie ${z.typ_uslugi} pod adresem ${z.adres}, ${z.miasto}. Zespół ARBOR`;
  },
  potwierdzenie: (z, data) => {
    const { dateStr, windowStr } = formatSmsPlanParts(z, data);
    return `Dzień dobry! Potwierdzamy przyjęcie zlecenia: ${z.typ_uslugi} pod adresem ${z.adres}, ${z.miasto}. Planowany termin: ${dateStr}, ok. ${windowStr}. Zespół ARBOR`;
  },
};

SZABLONY.w_drodze = (z) => (
  `Ekipa ARBOR jest w drodze do Panstwa. Szacowany czas przyjazdu: ok. 30 min. Zlecenie: ${z.typ_uslugi}, ${z.adres}.${publicTrackUrl(z) ? ` Sledzenie: ${publicTrackUrl(z)}` : ''}`
);

function canManageSmsTemplates(user) {
  return ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik'].includes(user?.rola);
}

function templateScopeForUser(user, requestedOddzialId) {
  if (user?.rola === 'Kierownik') return user.oddzial_id || null;
  return requestedOddzialId || null;
}

async function renderTaskSms(typ, task, context = {}) {
  const rendered = await renderSmsStatusTemplate(pool, { templateKey: typ, task, context });
  return rendered?.body || null;
}

router.get('/templates', authMiddleware, validateQuery(smsTemplatesQuerySchema), async (req, res) => {
  if (!canManageSmsTemplates(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    const oddzialId = templateScopeForUser(req.user, req.query.oddzial_id);
    const result = await listSmsStatusTemplates(pool, { oddzialId });
    res.json(result);
  } catch (err) {
    logger.error('sms.templates.list', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put(
  '/templates/:key',
  authMiddleware,
  validateParams(smsTemplateParamsSchema),
  validateBody(smsTemplateBodySchema),
  async (req, res) => {
    if (!canManageSmsTemplates(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const templateKey = req.params.key;
    if (!knownSmsTemplateKey(templateKey)) {
      return res.status(400).json({ error: req.tv('errors.sms.unknownType', { typ: templateKey }) });
    }
    try {
      const oddzialId = templateScopeForUser(req.user, req.body.oddzial_id);
      const row = await upsertSmsStatusTemplate(pool, {
        templateKey,
        oddzialId,
        body: req.body.body,
        active: req.body.active !== false,
        userId: req.user.id,
      });
      res.json(row);
    } catch (err) {
      logger.error('sms.templates.upsert', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

// POST /api/sms/wyslij
router.post('/wyslij', authMiddleware, validateBody(smsWyslijSchema), async (req, res) => {
  const { telefon, tresc, task_id } = req.body;
  let smsOddzialId = req.user?.oddzial_id || null;
  let smsTask = null;
  if (task_id) {
    try {
      const taskResult = await pool.query('SELECT oddzial_id, klient_telefon, klient_email FROM tasks WHERE id = $1', [task_id]);
      smsTask = taskResult.rows[0] || null;
      smsOddzialId = smsTask?.oddzial_id || smsOddzialId;
    } catch (taskErr) {
      logger.warn('sms.taskLookup.manual', { message: taskErr.message, task_id });
    }
  }
  const result = await sendSmsGateway({ to: telefon, body: tresc, taskId: task_id, oddzialId: smsOddzialId });
  if (!result.ok) {
    logger.error('Blad SMS /wyslij', { error: result.error, requestId: req.requestId });
    return res.status(500).json({ error: result.error });
  }
  if (task_id) {
    try {
      const task = smsTask;
      if (task) {
        await appendCrmMessageForContact({
          oddzialId: task.oddzial_id,
          phone: task.klient_telefon || telefon,
          email: task.klient_email,
          channel: 'sms',
          direction: 'outbound',
          recipientHandle: telefon,
          body: tresc,
          status: result.sid || result.id ? 'sent' : 'queued',
          externalMessageId: result.sid || result.id || null,
          metadata: { task_id, provider: result.provider, source: 'sms.manual' },
          createdBy: req.user.id,
        });
      }
    } catch (crmErr) {
      logger.warn('sms.crmInbox.manual', { message: crmErr.message, task_id });
    }
  }
  res.json({ success: true, message: 'SMS wysłany', provider: result.provider, sid: result.sid || result.id });
});

// POST /api/sms/zlecenie/:id
router.post('/zlecenie/:id', authMiddleware, validateParams(smsTaskIdParamsSchema), validateBody(smsZlecenieBodySchema), async (req, res) => {
  try {
    // ensureTableExists removed — handled by smsGateway on first send
    const { typ, powod } = req.body;
    const { id } = req.params;
    const zRes = await pool.query(
      `SELECT t.*, b.telefon as oddzial_telefon, b.nazwa as oddzial_nazwa
       FROM tasks t LEFT JOIN branches b ON t.oddzial_id = b.id WHERE t.id = $1`,
      [id]
    );
    if (zRes.rows.length === 0) return res.status(404).json({ error: req.t('errors.sms.taskNotFound') });
    const z = zRes.rows[0];
    if (!z.klient_telefon) return res.status(400).json({ error: req.t('errors.sms.clientPhoneMissing') });
    if (!knownSmsTemplateKey(typ)) return res.status(400).json({ error: req.tv('errors.sms.unknownType', { typ }) });
    const data = z.data_planowana ? new Date(z.data_planowana).toLocaleDateString('pl-PL') : '-';
    const tresc = await renderTaskSms(typ, z, { powod, data });
    const result = await sendSmsGateway({ to: z.klient_telefon, body: tresc, taskId: id, oddzialId: z.oddzial_id });
    if (!result.ok) {
      logger.error('Blad SMS /zlecenie/:id', { error: result.error, requestId: req.requestId });
      return res.status(500).json({ error: result.error });
    }
    try {
      await appendCrmMessageForContact({
        oddzialId: z.oddzial_id,
        phone: z.klient_telefon,
        email: z.klient_email,
        channel: 'sms',
        direction: 'outbound',
        recipientHandle: z.klient_telefon,
        body: tresc,
        status: result.sid || result.id ? 'sent' : 'queued',
        externalMessageId: result.sid || result.id || null,
        templateKey: typ,
        dynamicFields: { typ, powod: powod || null },
        metadata: { task_id: id, provider: result.provider, source: 'sms.task' },
        createdBy: req.user.id,
      });
    } catch (crmErr) {
      logger.warn('sms.crmInbox.task', { message: crmErr.message, task_id: id });
    }
    const statusMap = { w_drodze: 'W_drodze', na_miejscu: 'W_Realizacji', zakonczone: 'Zakonczone', anulowane: 'Anulowane' };
    if (statusMap[typ]) await pool.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2', [statusMap[typ], id]);
    res.json({ success: true, message: 'SMS wysłany', provider: result.provider, sid: result.sid || result.id, typ, telefon: z.klient_telefon });
  } catch (err) {
    logger.error('Blad SMS /zlecenie/:id', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/historia
router.get('/historia/zlecenie/:taskId', authMiddleware, validateParams(smsHistoriaTaskParamsSchema), async (req, res) => {
  try {
    // ensureTableExists removed — handled by smsGateway on first send
    const result = await pool.query(
      `SELECT * FROM sms_history WHERE task_id = $1 ORDER BY created_at DESC`,
      [req.params.taskId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania historii SMS dla zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/historia', authMiddleware, validateQuery(smsHistoriaQuerySchema), async (req, res) => {
  try {
    // ensureTableExists removed — handled by smsGateway on first send
    const { limit, offset } = req.query;
    const qRaw = req.query.q != null ? String(req.query.q).trim().slice(0, 200) : '';
    const statusF = req.query.status != null ? String(req.query.status).trim().slice(0, 80) : '';
    const dateFrom = parseHistoriaDate(req.query.date_from);
    const dateTo = parseHistoriaDate(req.query.date_to);

    const userRole = req.user.rola;
    const whereParts = [];
    const params = [];
    if (userRole === 'Kierownik') {
      whereParts.push(`t.oddzial_id = $${params.length + 1}`);
      params.push(req.user.oddzial_id);
    } else if (userRole !== 'Dyrektor' && userRole !== 'Administrator') {
      whereParts.push(`t.brygadzista_id = $${params.length + 1}`);
      params.push(req.user.id);
    }
    if (statusF && statusF.toLowerCase() !== 'all') {
      whereParts.push(`h.status = $${params.length + 1}`);
      params.push(statusF);
    }
    if (dateFrom) {
      whereParts.push(`h.created_at::date >= $${params.length + 1}::date`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereParts.push(`h.created_at::date <= $${params.length + 1}::date`);
      params.push(dateTo);
    }
    if (qRaw) {
      const escaped = qRaw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      const idx = params.length + 1;
      whereParts.push(`(
        COALESCE(h.telefon, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(h.tresc, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(h.status::text, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(h.sid::text, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(h.task_id::text, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(t.klient_nazwa, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(t.typ_uslugi, '') ILIKE $${idx} ESCAPE E'\\\\'
        OR COALESCE(b.nazwa, '') ILIKE $${idx} ESCAPE E'\\\\'
      )`);
      params.push(pattern);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const base = `FROM sms_history h LEFT JOIN tasks t ON h.task_id = t.id LEFT JOIN branches b ON t.oddzial_id = b.id ${whereSql}`;
    const orderBy = 'ORDER BY h.created_at DESC';
    const selectList = `SELECT h.*, t.klient_nazwa, t.adres, t.typ_uslugi, b.nazwa as oddzial_nazwa ${base} ${orderBy}`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${base}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(`${selectList} LIMIT $${limIdx} OFFSET $${offIdx}`, [...params, lim, off]);
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(`${selectList} LIMIT 100`, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania historii SMS', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// POST /api/sms/wyslij-do-wszystkich
router.post('/wyslij-do-wszystkich', authMiddleware, validateBody(smsBulkSchema), async (req, res) => {
  try {
    // ensureTableExists removed — handled by smsGateway on first send
    if (!['Prezes', 'Dyrektor', 'Kierownik'].includes(req.user.rola)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const { typ, data } = req.body;
    if (!knownSmsTemplateKey(typ)) return res.status(400).json({ error: req.tv('errors.sms.unknownType', { typ }) });
    const targetDate = data || new Date().toISOString().split('T')[0];
    let query = `SELECT t.*, b.telefon as oddzial_telefon, b.nazwa as oddzial_nazwa FROM tasks t LEFT JOIN branches b ON t.oddzial_id = b.id
      WHERE t.data_planowana::date = $1 AND t.klient_telefon IS NOT NULL AND t.klient_telefon != ''`;
    let params = [targetDate];
    if (req.user.rola === 'Kierownik') { query += ` AND t.oddzial_id = $2`; params.push(req.user.oddzial_id); }
    const result = await pool.query(query, params);
    const zlecenia = result.rows;
    if (zlecenia.length === 0) return res.json({ success: true, message: 'Brak zleceń do wysłania SMS', wyslane: 0 });
    if (!activeSmsProvider()) return res.status(500).json({ error: req.t('errors.sms.twilioNotConfigured') });
    let wyslane = 0;
    const bledy = [];
    for (const z of zlecenia) {
      const dataFormat = new Date(z.data_planowana).toLocaleDateString('pl-PL');
      const tresc = await renderTaskSms(typ, z, { data: dataFormat });
      const r = await sendSmsGateway({ to: z.klient_telefon, body: tresc, taskId: z.id, oddzialId: z.oddzial_id });
      if (r.ok) { wyslane++; } else { bledy.push({ telefon: z.klient_telefon, error: r.error }); }
      // throttle — Zadarma ma limit ~10 SMS/s, Twilio podobnie
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    res.json({ success: true, message: `Wysłano ${wyslane} SMS z ${zlecenia.length}`, wyslane, bledy });
  } catch (err) {
    logger.error('Blad zbiorczego wysylania SMS', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/test
router.get('/test', authMiddleware, async (req, res) => {
  const provider = activeSmsProvider();
  if (!provider) {
    return res.json({
      success: false,
      message: 'Brak konfiguracji SMS. Ustaw ZADARMA_API_KEY + ZADARMA_API_SECRET lub TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.',
      zadarma: { key: !!env.ZADARMA_API_KEY, secret: !!env.ZADARMA_API_SECRET },
      twilio: { sid: !!env.TWILIO_ACCOUNT_SID, token: !!env.TWILIO_AUTH_TOKEN, phone: !!env.TWILIO_PHONE },
    });
  }
  if (provider === 'zadarma') {
    try {
      const { zadarmaRequest } = require('../services/zadarma');
      const info = await zadarmaRequest('GET', '/v1/info/', {});
      return res.json({ success: true, provider: 'zadarma', message: 'Zadarma skonfigurowana poprawnie', info });
    } catch (e) {
      return res.json({ success: false, provider: 'zadarma', message: e.message });
    }
  }
  // Twilio
  try {
    const client = require('twilio')(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const account = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
    res.json({ success: true, provider: 'twilio', message: 'Konfiguracja Twilio poprawna', account_friendly_name: account.friendlyName, account_status: account.status, from_number: env.TWILIO_PHONE });
  } catch (err) {
    res.json({ success: false, provider: 'twilio', message: err.message, code: err.code });
  }
});

module.exports = router;
