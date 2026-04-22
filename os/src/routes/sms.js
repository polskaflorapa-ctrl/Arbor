const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { env } = require('../config/env');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

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

const smsHistoriaQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const getSmsClient = () => {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    logger.error('Brak konfiguracji Twilio w zmiennych srodowiskowych');
    return null;
  }
  const twilio = require('twilio');
  return twilio(accountSid, authToken);
};

const logSmsHistory = async (task_id, telefon, tresc, status, sid = null, error = null) => {
  try {
    await pool.query(
      `INSERT INTO sms_history (task_id, telefon, tresc, status, sid, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [task_id, telefon, tresc, status, sid, error]
    );
  } catch (err) {
    logger.error('Blad zapisu historii SMS', { message: err.message });
  }
};

const ensureTableExists = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_history (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id),
      telefon VARCHAR(20) NOT NULL,
      tresc TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'Wyslany',
      sid VARCHAR(100),
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
};

const SZABLONY = {
  zaplanowane: (z, data) => `Dzień dobry ${z.klient_nazwa || ''}! Twoje zlecenie (${z.typ_uslugi}) zostało zaplanowane na ${data} w godz. 8:00-16:00. Firma ARBOR. Pytania: ${z.oddzial_telefon || 'brak'}`,
  w_drodze: (z) => `Ekipa ARBOR jest w drodze do Państwa. Szacowany czas przyjazdu: ok. 30 min. Zlecenie: ${z.typ_uslugi}, ${z.adres}. Śledzenie: arbor-os.pl/track/${z.link_statusowy_token || z.id}`,
  na_miejscu: (z) => `Ekipa ARBOR rozpoczęła prace przy ${z.adres}, ${z.miasto}. W razie pytań: kontakt z brygadzistą. Zespół ARBOR`,
  zakonczone: (z) => `Prace zakończone! Dziękujemy za skorzystanie z usług ARBOR. Podsumowanie i zdjęcia zostaną wysłane na email. Zespół ARBOR`,
  problem: (z, powod) => `Informujemy, że realizacja zlecenia przy ${z.adres} jest opóźniona z powodu: ${powod}. Nowy szacowany czas zakończenia: +2h. Przepraszamy za niedogodności. Zespół ARBOR`,
  anulowane: (z) => `Informujemy o konieczności przełożenia wizyty przy ${z.adres}, ${z.miasto}. Skontaktujemy się w ciągu 24h, aby ustalić nowy termin. Przepraszamy. Zespół ARBOR`,
  przypomnienie: (z, data) => `Przypomnienie: jutro (${data}) realizujemy zlecenie ${z.typ_uslugi} pod adresem ${z.adres}, ${z.miasto}. Zespół ARBOR`,
  potwierdzenie: (z, data) => `Dzień dobry! Potwierdzamy przyjęcie zlecenia: ${z.typ_uslugi} pod adresem ${z.adres}, ${z.miasto}. Data realizacji: ${data}. Zespół ARBOR`,
};

// POST /api/sms/wyslij
router.post('/wyslij', authMiddleware, validateBody(smsWyslijSchema), async (req, res) => {
  try {
    await ensureTableExists();
    const { telefon, tresc, task_id } = req.body;
    const client = getSmsClient();
    if (!client) return res.status(500).json({ error: req.t('errors.sms.twilioNotConfigured') });
    const fromNumber = env.TWILIO_PHONE;
    if (!fromNumber) return res.status(500).json({ error: req.t('errors.sms.twilioFromMissing') });
    const message = await client.messages.create({ body: tresc, from: fromNumber, to: telefon });
    await logSmsHistory(task_id || null, telefon, tresc, 'Wyslany', message.sid);
    res.json({ success: true, message: 'SMS wysłany', sid: message.sid });
  } catch (err) {
    logger.error('Blad SMS /wyslij', { message: err.message, requestId: req.requestId });
    await logSmsHistory(req.body.task_id || null, req.body.telefon, req.body.tresc, 'Błąd', null, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/zlecenie/:id
router.post('/zlecenie/:id', authMiddleware, validateParams(smsTaskIdParamsSchema), validateBody(smsZlecenieBodySchema), async (req, res) => {
  try {
    await ensureTableExists();
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
    if (!SZABLONY[typ]) return res.status(400).json({ error: req.tv('errors.sms.unknownType', { typ }) });
    const data = z.data_planowana ? new Date(z.data_planowana).toLocaleDateString('pl-PL') : '-';
    let tresc = '';
    if (typ === 'problem' && powod) tresc = SZABLONY[typ](z, powod);
    else if (['przypomnienie', 'potwierdzenie', 'zaplanowane'].includes(typ)) tresc = SZABLONY[typ](z, data);
    else tresc = SZABLONY[typ](z);
    const client = getSmsClient();
    if (!client) return res.status(500).json({ error: req.t('errors.sms.twilioNotConfigured') });
    const fromNumber = env.TWILIO_PHONE;
    if (!fromNumber) return res.status(500).json({ error: req.t('errors.sms.twilioFromMissing') });
    const message = await client.messages.create({ body: tresc, from: fromNumber, to: z.klient_telefon });
    await logSmsHistory(id, z.klient_telefon, tresc, 'Wyslany', message.sid);
    const statusMap = { w_drodze: 'W_drodze', na_miejscu: 'W_Realizacji', zakonczone: 'Zakonczone', anulowane: 'Anulowane' };
    if (statusMap[typ]) await pool.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2', [statusMap[typ], id]);
    res.json({ success: true, message: 'SMS wysłany', sid: message.sid, typ, telefon: z.klient_telefon });
  } catch (err) {
    logger.error('Blad SMS /zlecenie/:id', { message: err.message, requestId: req.requestId });
    await logSmsHistory(req.params.id, null, null, 'Błąd', null, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/historia
router.get('/historia/zlecenie/:taskId', authMiddleware, validateParams(smsHistoriaTaskParamsSchema), async (req, res) => {
  try {
    await ensureTableExists();
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
    await ensureTableExists();
    const { limit, offset } = req.query;
    const userRole = req.user.rola;
    let base = `FROM sms_history h LEFT JOIN tasks t ON h.task_id = t.id LEFT JOIN branches b ON t.oddzial_id = b.id`;
    let params = [];
    if (userRole === 'Kierownik') { base += ` WHERE t.oddzial_id = $1`; params.push(req.user.oddzial_id); }
    else if (userRole !== 'Dyrektor' && userRole !== 'Administrator') { base += ` WHERE t.brygadzista_id = $1`; params.push(req.user.id); }
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
    await ensureTableExists();
    if (!['Dyrektor', 'Administrator', 'Kierownik'].includes(req.user.rola)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const { typ, data } = req.body;
    const targetDate = data || new Date().toISOString().split('T')[0];
    let query = `SELECT t.*, b.telefon as oddzial_telefon FROM tasks t LEFT JOIN branches b ON t.oddzial_id = b.id
      WHERE t.data_planowana::date = $1 AND t.klient_telefon IS NOT NULL AND t.klient_telefon != ''`;
    let params = [targetDate];
    if (req.user.rola === 'Kierownik') { query += ` AND t.oddzial_id = $2`; params.push(req.user.oddzial_id); }
    const result = await pool.query(query, params);
    const zlecenia = result.rows;
    if (zlecenia.length === 0) return res.json({ success: true, message: 'Brak zleceń do wysłania SMS', wyslane: 0 });
    const client = getSmsClient();
    if (!client) return res.status(500).json({ error: req.t('errors.sms.twilioNotConfigured') });
    const fromNumber = env.TWILIO_PHONE;
    let wyslane = 0;
    const bledy = [];
    for (const z of zlecenia) {
      try {
        const dataFormat = new Date(z.data_planowana).toLocaleDateString('pl-PL');
        let tresc = ['przypomnienie', 'potwierdzenie', 'zaplanowane'].includes(typ)
          ? SZABLONY[typ](z, dataFormat)
          : (SZABLONY[typ] ? SZABLONY[typ](z) : `Informacja od ARBOR: zlecenie ${z.typ_uslugi} pod adresem ${z.adres}.`);
        const message = await client.messages.create({ body: tresc, from: fromNumber, to: z.klient_telefon });
        await logSmsHistory(z.id, z.klient_telefon, tresc, 'Wyslany', message.sid);
        wyslane++;
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        bledy.push({ telefon: z.klient_telefon, error: err.message });
        await logSmsHistory(z.id, z.klient_telefon, null, 'Błąd', null, err.message);
      }
    }
    res.json({ success: true, message: `Wysłano ${wyslane} SMS z ${zlecenia.length}`, wyslane, bledy });
  } catch (err) {
    logger.error('Blad zbiorczego wysylania SMS', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/test
router.get('/test', authMiddleware, async (req, res) => {
  try {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;
    const fromNumber = env.TWILIO_PHONE;
    const configOk = !!(accountSid && authToken && fromNumber);
    if (!configOk) return res.json({ success: false, message: 'Brak konfiguracji Twilio', accountSid: !!accountSid, authToken: !!authToken, fromNumber: !!fromNumber });
    const client = getSmsClient();
    if (!client) return res.json({ success: false, message: 'Nie można utworzyć klienta Twilio' });
    const account = await client.api.accounts(accountSid).fetch();
    res.json({ success: true, message: 'Konfiguracja Twilio poprawna', account_friendly_name: account.friendlyName, account_status: account.status, from_number: fromNumber });
  } catch (err) {
    res.json({ success: false, message: err.message, code: err.code });
  }
});

module.exports = router;
