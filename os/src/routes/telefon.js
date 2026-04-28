const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateQuery, validateParams } = require('../middleware/validate');
const { z } = require('zod');
const {
  VALIDATION_FAILED,
  TELEFON_PUBLIC_URL_MISSING,
  TELEFON_STAFF_PHONE_MISSING,
  TELEFON_TWILIO_NOT_CONFIGURED,
  TELEFON_TWILIO_FROM_MISSING,
  TELEFON_TEAM_ROLE_FORBIDDEN,
} = require('../constants/error-codes');
const {
  ensurePhoneCallsTable,
  upsertCallLegFromTwiml,
} = require('../services/phone-call-pipeline');
const { sendRecordingToHttpResponse } = require('../services/phone-recording-storage');

const router = express.Router();

const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';
const isKierownik = (user) => user.rola === 'Kierownik';

/** Zakres listy / licznika rozmów: dyrektor / administrator / kierownik — wszystkie; inni — tylko własne. */
function phoneRozmowyScopeFromWhere(user) {
  if (isDyrektor(user) || isKierownik(user)) {
    return { from: 'FROM phone_call_conversations p', whereSql: '', params: [] };
  }
  return {
    from: 'FROM phone_call_conversations p',
    whereSql: 'WHERE p.user_id = $1',
    params: [user.id],
  };
}

/** Dopisek do WHERE dla pojedynczej rozmowy (id już w $1). */
function phoneRozmowaAccessSql(user, paramIndex) {
  if (isDyrektor(user) || isKierownik(user)) return { sql: '', params: [] };
  return {
    sql: ` AND p.user_id = $${paramIndex}`,
    params: [user.id],
  };
}

const polaczDoKlientaSchema = z.object({
  do: z.string().trim().min(9, 'Podaj numer klienta'),
  task_id: z.coerce.number().int().positive().optional().nullable(),
});

const rozmowyListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const rozmowaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Połączenia z klientem i archiwum rozmów — tylko poza rolą ekipy polowej. */
const forbidTelefonForTeamRoles = (req, res, next) => {
  const r = req.user?.rola;
  if (r === 'Brygadzista' || r === 'Pomocnik') {
    return res.status(403).json({
      error: req.t('errors.telefon.teamRoleForbidden'),
      code: TELEFON_TEAM_ROLE_FORBIDDEN,
      requestId: req.requestId,
    });
  }
  next();
};

/** Uproszczone E.164 dla PL (+48…) — na produkcji rozważ libphonenumber. */
const normalizeToE164 = (raw) => {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s-]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) return s.replace(/[^\d+]/g, '').length >= 10 ? s : null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  else if (s.startsWith('48')) s = `+${s}`;
  else if (/^\d{9}$/.test(s)) s = `+48${s}`;
  else if (/^0\d{9}$/.test(s)) s = `+48${s.slice(1)}`;
  else if (/^\d{10,15}$/.test(s)) s = `+${s}`;
  else return null;
  if (!/^\+[1-9]\d{8,14}$/.test(s)) return null;
  return s;
};

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const getTwilioClient = () => {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  const twilio = require('twilio');
  return twilio(accountSid, authToken);
};

const publicBaseUrl = () => {
  const u = env.PUBLIC_BASE_URL;
  if (!u || typeof u !== 'string') return null;
  const t = u.trim().replace(/\/$/, '');
  return t.length > 0 ? t : null;
};

/**
 * POST /api/telefon/polacz-do-klienta
 * Dzwoni na telefon pracownika z profilu; po odebraniu TwiML łączy z numerem klienta (`do`).
 * Nagrywanie obu stron + webhook → transkrypcja (OpenAI) + raport (Anthropic).
 */
router.post(
  '/polacz-do-klienta',
  authMiddleware,
  forbidTelefonForTeamRoles,
  validateBody(polaczDoKlientaSchema),
  async (req, res) => {
  try {
    const base = publicBaseUrl();
    if (!base) {
      return res.status(503).json({
        error: req.t('errors.telefon.publicUrlMissing'),
        code: TELEFON_PUBLIC_URL_MISSING,
        requestId: req.requestId,
      });
    }
    const client = getTwilioClient();
    if (!client) {
      return res.status(503).json({
        error: req.t('errors.telefon.twilioNotConfigured'),
        code: TELEFON_TWILIO_NOT_CONFIGURED,
        requestId: req.requestId,
      });
    }
    const fromNumber = env.TWILIO_PHONE;
    if (!fromNumber) {
      return res.status(503).json({
        error: req.t('errors.telefon.twilioFromMissing'),
        code: TELEFON_TWILIO_FROM_MISSING,
        requestId: req.requestId,
      });
    }

    const { rows } = await pool.query('SELECT telefon FROM users WHERE id = $1', [req.user.id]);
    const staffRaw = rows[0]?.telefon;
    const staffE164 = normalizeToE164(staffRaw);
    if (!staffE164) {
      return res.status(400).json({
        error: req.t('errors.telefon.staffPhoneMissing'),
        code: TELEFON_STAFF_PHONE_MISSING,
        requestId: req.requestId,
      });
    }

    const doE164 = normalizeToE164(req.body.do);
    if (!doE164) {
      return res.status(400).json({
        error: req.t('errors.telefon.invalidDestination'),
        code: VALIDATION_FAILED,
        requestId: req.requestId,
      });
    }
    if (doE164 === staffE164) {
      return res.status(400).json({
        error: req.t('errors.telefon.sameNumber'),
        code: VALIDATION_FAILED,
        requestId: req.requestId,
      });
    }

    const twimlToken = jwt.sign(
      {
        typ: 'twilio-dial',
        do: doE164,
        task_id: req.body.task_id ?? null,
        user_id: req.user.id,
      },
      env.JWT_SECRET,
      { expiresIn: '10m', audience: 'twilio-twiml' }
    );
    const twimlUrl = `${base}/api/telefon/twiml/dial?t=${encodeURIComponent(twimlToken)}`;

    const call = await client.calls.create({
      to: staffE164,
      from: fromNumber,
      url: twimlUrl,
      method: 'GET',
    });

    res.json({
      success: true,
      sid: call.sid,
      message: req.t('messages.telefon.callStarted'),
      requestId: req.requestId,
    });
  } catch (err) {
    logger.error('Blad telefon /polacz-do-klienta', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message, requestId: req.requestId });
  }
});

/**
 * GET /api/telefon/twiml/dial?t=…
 * Wywoływane przez Twilio (bez nagłówka Authorization). Token JWT zawiera numer docelowy.
 */
router.get('/twiml/dial', async (req, res) => {
  const token = typeof req.query.t === 'string' ? req.query.t : '';
  if (!token) {
    return res.status(200).type('text/xml; charset=utf-8').send(twimlReject());
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { audience: 'twilio-twiml' });
    if (decoded.typ !== 'twilio-dial' || typeof decoded.do !== 'string') {
      return res.status(200).type('text/xml; charset=utf-8').send(twimlReject());
    }
    const num = normalizeToE164(decoded.do);
    if (!num) {
      return res.status(200).type('text/xml; charset=utf-8').send(twimlReject());
    }

    const callSid = typeof req.query.CallSid === 'string' ? req.query.CallSid : null;
    const fromNum = typeof req.query.From === 'string' ? req.query.From : null;
    const userId = typeof decoded.user_id === 'number' ? decoded.user_id : null;
    const rawTask = decoded.task_id;
    const taskNum = rawTask != null && rawTask !== '' ? Number(rawTask) : NaN;
    const taskId = Number.isFinite(taskNum) && taskNum > 0 ? taskNum : null;

    if (callSid && userId) {
      try {
        await upsertCallLegFromTwiml({
          callSid,
          userId,
          taskId,
          staffNumber: fromNum,
          clientNumber: num,
        });
      } catch (e) {
        logger.error('telefon upsertCallLegFromTwiml', { message: e.message, callSid });
      }
    }

    const base = publicBaseUrl();
    const recordCb =
      base != null
        ? ` recordingStatusCallback="${escapeXml(`${base}/api/telefon/webhooks/recording`)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`
        : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pl-PL">Laczenie z numerem klienta. Rozmowa moze byc nagrywana.</Say>
  <Dial callerId="${escapeXml(env.TWILIO_PHONE || '')}" record="record-from-answer-dual"${recordCb}>
    <Number>${escapeXml(num)}</Number>
  </Dial>
</Response>`;
    return res.status(200).type('text/xml; charset=utf-8').send(xml);
  } catch {
    return res.status(200).type('text/xml; charset=utf-8').send(twimlReject());
  }
});

router.get('/rozmowy', authMiddleware, forbidTelefonForTeamRoles, validateQuery(rozmowyListQuerySchema), async (req, res) => {
  try {
    await ensurePhoneCallsTable();
    const { limit, offset } = req.query;
    const scope = phoneRozmowyScopeFromWhere(req.user);
    const base = `${scope.from} ${scope.whereSql}`.trim();
    const orderBy = 'ORDER BY p.created_at DESC';
    const selectList = `SELECT p.* ${base} ${orderBy}`;
    const params = scope.params;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const next = params.length + 1;
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${base}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(`${selectList} LIMIT $${next} OFFSET $${next + 1}`, [...params, lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const { rows } = await pool.query(`${selectList} LIMIT 50`, params);
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    logger.error('telefon /rozmowy', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get(
  '/rozmowy/:id/nagranie',
  authMiddleware,
  forbidTelefonForTeamRoles,
  validateParams(rozmowaIdParamsSchema),
  async (req, res) => {
  try {
    await ensurePhoneCallsTable();
    const access = phoneRozmowaAccessSql(req.user, 2);
    const { rows } = await pool.query(
      `SELECT p.* FROM phone_call_conversations p WHERE p.id = $1${access.sql}`,
      [req.params.id, ...access.params]
    );
    if (!rows.length) {
      return res.status(404).json({ error: req.t('errors.telefon.rozmowaNotFound'), requestId: req.requestId });
    }
    const ok = await sendRecordingToHttpResponse(rows[0], res);
    if (!ok) {
      return res.status(404).json({ error: req.t('errors.telefon.recordingNotAvailable'), requestId: req.requestId });
    }
  } catch (e) {
    logger.error('telefon /rozmowy/:id/nagranie', { message: e.message, requestId: req.requestId });
    if (!res.headersSent) {
      res.status(500).json({ error: req.t('errors.http.serverError'), requestId: req.requestId });
    }
  }
});

router.get('/rozmowy/:id', authMiddleware, forbidTelefonForTeamRoles, validateParams(rozmowaIdParamsSchema), async (req, res) => {
  try {
    await ensurePhoneCallsTable();
    const access = phoneRozmowaAccessSql(req.user, 2);
    const { rows } = await pool.query(
      `SELECT p.* FROM phone_call_conversations p WHERE p.id = $1${access.sql}`,
      [req.params.id, ...access.params]
    );
    if (!rows.length) {
      return res.status(404).json({ error: req.t('errors.telefon.rozmowaNotFound'), requestId: req.requestId });
    }
    res.json(rows[0]);
  } catch (e) {
    logger.error('telefon /rozmowy/:id', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

function twimlReject() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pl-PL">Polaczenie odrzucone.</Say><Hangup/></Response>`;
}

module.exports = router;
