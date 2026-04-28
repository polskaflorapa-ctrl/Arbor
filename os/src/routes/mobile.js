const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireNieBrygadzista } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');
const {
  invoiceCreateBodySchema,
  invoiceIdParamsSchema,
  invoiceStatusBodySchema,
} = require('../schemas/invoice');
const { companySettingsWriteSchema } = require('../schemas/company-settings');
const { buildTeamDayReport, loadTeamDayEnrichment } = require('../services/payrollTeamDay');

const router = express.Router();

const mobileFakturyListQuerySchema = z.object({
  status: z.string().max(50).optional(),
  rok: z.coerce.number().int().min(1990).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const mobileRozliczeniaQuerySchema = z.object({
  rok: z.coerce.number().int().min(1990).max(2100).optional(),
  miesiac: z.coerce.number().int().min(1).max(12).optional(),
});

const teamDayReportQuerySchema = z.object({
  date: z.string().max(12),
});

const teamDayCloseBodySchema = z.object({
  report_date: z.string().max(32),
});

const pushTokenBodySchema = z.object({
  expo_token: z.string().min(32).max(512),
  platform: z.enum(['ios', 'android', 'unknown']).optional(),
});
const pushTokenDeleteSchema = z.object({
  expo_token: z.string().min(32).max(512),
});

function isLikelyExpoPushToken(token) {
  const s = String(token || '').trim();
  return s.startsWith('ExponentPushToken[') || s.startsWith('ExpoPushToken[');
}

const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';
const isKierownik = (user) => user.rola === 'Kierownik';

// GET /api/mobile/ustawienia
router.get('/ustawienia', authMiddleware, async (req, res) => {
  try {
    const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'company_settings')`);
    if (!tableCheck.rows[0].exists) {
      await pool.query(`CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY, nazwa VARCHAR(200), nip VARCHAR(20), adres TEXT,
        kod_pocztowy VARCHAR(10), miasto VARCHAR(100), konto_bankowe VARCHAR(50),
        bank_nazwa VARCHAR(100), email VARCHAR(100), telefon VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`);
      return res.json({});
    }
    const result = await pool.query('SELECT * FROM company_settings LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) { logger.error('Blad pobierania ustawien firmy', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

// PUT /api/mobile/ustawienia
router.put('/ustawienia', authMiddleware, requireNieBrygadzista, validateBody(companySettingsWriteSchema), async (req, res) => {
  try {
    const { nazwa, nip, adres, kod_pocztowy, miasto, konto_bankowe, bank_nazwa, email, telefon } = req.body;
    const exists = await pool.query('SELECT id FROM company_settings LIMIT 1');
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO company_settings (nazwa, nip, adres, kod_pocztowy, miasto, konto_bankowe, bank_nazwa, email, telefon, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
        [nazwa, nip, adres, kod_pocztowy, miasto, konto_bankowe, bank_nazwa, email, telefon]
      );
    } else {
      await pool.query(
        `UPDATE company_settings SET nazwa=$1,nip=$2,adres=$3,kod_pocztowy=$4,miasto=$5,konto_bankowe=$6,bank_nazwa=$7,email=$8,telefon=$9,updated_at=NOW()`,
        [nazwa, nip, adres, kod_pocztowy, miasto, konto_bankowe, bank_nazwa, email, telefon]
      );
    }
    res.json({ success: true, message: 'Ustawienia zapisane' });
  } catch (err) { logger.error('Blad zapisu ustawien firmy', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

const getNumerFaktury = async (oddzial_id) => {
  const rok = new Date().getFullYear();
  const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices')`);
  if (!tableCheck.rows[0].exists) return `FV/${rok}/001`;
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM invoices WHERE EXTRACT(YEAR FROM data_wystawienia) = $1 AND oddzial_id = $2`,
    [rok, oddzial_id]
  );
  const nr = parseInt(result.rows[0].cnt) + 1;
  return `FV/${rok}/${String(nr).padStart(3, '0')}`;
};

// GET /api/mobile/faktury
router.get('/faktury', authMiddleware, requireNieBrygadzista, validateQuery(mobileFakturyListQuerySchema), async (req, res) => {
  try {
    const { status, rok, limit, offset } = req.query;
    let where = 'WHERE 1=1'; let params = []; let idx = 1;
    if (isKierownik(req.user)) { where += ` AND i.oddzial_id = $${idx++}`; params.push(req.user.oddzial_id); }
    else if (!isDyrektor(req.user)) { where += ` AND i.oddzial_id = $${idx++}`; params.push(req.user.oddzial_id); }
    if (status) { where += ` AND i.status = $${idx++}`; params.push(status); }
    if (rok != null) { where += ` AND EXTRACT(YEAR FROM i.data_wystawienia) = $${idx++}`; params.push(rok); }
    const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices')`);
    if (!tableCheck.rows[0].exists) return res.json(limit != null ? { items: [], total: 0, limit: Number(limit), offset: Number(offset ?? 0) } : []);
    const fromSql = `FROM invoices i LEFT JOIN branches b ON i.oddzial_id = b.id LEFT JOIN users u ON i.wystawil_id = u.id
       LEFT JOIN tasks t ON i.task_id = t.id ${where}`;
    const selectList = `SELECT i.*, b.nazwa as oddzial_nazwa, u.imie || ' ' || u.nazwisko as wystawil_nazwa, t.klient_nazwa as task_klient ${fromSql}`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${fromSql}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `${selectList} ORDER BY i.created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(`${selectList} ORDER BY i.created_at DESC`, params);
    res.json(result.rows);
  } catch (err) { logger.error('Blad pobierania faktur', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

// GET /api/mobile/faktury/stats
router.get('/faktury/stats', authMiddleware, requireNieBrygadzista, async (req, res) => {
  try {
    let where = 'WHERE 1=1'; let params = []; let idx = 1;
    if (isKierownik(req.user)) { where += ` AND oddzial_id = $${idx++}`; params.push(req.user.oddzial_id); }
    else if (!isDyrektor(req.user)) { where += ` AND oddzial_id = $${idx++}`; params.push(req.user.oddzial_id); }
    const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices')`);
    if (!tableCheck.rows[0].exists) return res.json({ total: 0, przychod_total: 0, oplacone: 0, nieoplacone: 0, przeterminowane: 0, cnt_oplacone: 0, cnt_nieoplacone: 0 });
    const result = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(brutto),0) as przychod_total,
        COALESCE(SUM(CASE WHEN status='Oplacona' THEN brutto ELSE 0 END),0) as oplacone,
        COALESCE(SUM(CASE WHEN status='Nieoplacona' THEN brutto ELSE 0 END),0) as nieoplacone,
        COALESCE(SUM(CASE WHEN status='Przeterminowana' THEN brutto ELSE 0 END),0) as przeterminowane,
        COUNT(CASE WHEN status='Oplacona' THEN 1 END) as cnt_oplacone,
        COUNT(CASE WHEN status='Nieoplacona' THEN 1 END) as cnt_nieoplacone
       FROM invoices ${where}`, params
    );
    res.json(result.rows[0]);
  } catch (err) { logger.error('Blad pobierania statystyk faktur', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

// GET /api/mobile/faktury/:id
router.get('/faktury/:id', authMiddleware, requireNieBrygadzista, validateParams(invoiceIdParamsSchema), async (req, res) => {
  try {
    const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices')`);
    if (!tableCheck.rows[0].exists) return res.status(404).json({ error: req.t('errors.mobile.invoicesTableMissing') });
    const result = await pool.query(
      `SELECT i.*, b.nazwa as oddzial_nazwa, u.imie || ' ' || u.nazwisko as wystawil_nazwa
       FROM invoices i LEFT JOIN branches b ON i.oddzial_id = b.id LEFT JOIN users u ON i.wystawil_id = u.id
       WHERE i.id = $1`, [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: req.t('errors.mobile.invoiceNotFound') });
    const itemsCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoice_items')`);
    let pozycje = [];
    if (itemsCheck.rows[0].exists) {
      const ir = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [req.params.id]);
      pozycje = ir.rows;
    }
    res.json({ ...result.rows[0], pozycje });
  } catch (err) { logger.error('Blad pobierania faktury po id', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

// POST /api/mobile/faktury
router.post('/faktury', authMiddleware, requireNieBrygadzista, validateBody(invoiceCreateBodySchema), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { task_id, klient_nazwa, klient_nip, klient_adres, klient_email, klient_typ, data_wystawienia, data_sprzedazy, termin_platnosci, forma_platnosci, uwagi, pozycje, oddzial_id } = req.body;
    const finalOddzialId = isDyrektor(req.user) ? (oddzial_id || req.user.oddzial_id) : req.user.oddzial_id;
    const numer = await getNumerFaktury(finalOddzialId);
    let netto = 0, vat_kwota = 0, brutto = 0;
    for (const p of pozycje) {
      const wNetto = parseFloat(p.ilosc) * parseFloat(p.cena_netto);
      const wVat = wNetto * parseFloat(p.vat_stawka) / 100;
      netto += wNetto; vat_kwota += wVat; brutto += wNetto + wVat;
    }
    const vat_stawka = pozycje[0]?.vat_stawka || 23;
    const dataWyst = data_wystawienia || new Date().toISOString().split('T')[0];
    await client.query(`CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY, numer VARCHAR(50) UNIQUE NOT NULL, task_id INTEGER, oddzial_id INTEGER, wystawil_id INTEGER,
      klient_nazwa VARCHAR(200) NOT NULL, klient_nip VARCHAR(20), klient_adres TEXT, klient_email VARCHAR(100), klient_typ VARCHAR(20) DEFAULT 'firma',
      data_wystawienia DATE NOT NULL, data_sprzedazy DATE, termin_platnosci DATE, forma_platnosci VARCHAR(50) DEFAULT 'przelew',
      uwagi TEXT, netto DECIMAL(10,2) NOT NULL, vat_stawka DECIMAL(5,2) NOT NULL, vat_kwota DECIMAL(10,2) NOT NULL,
      brutto DECIMAL(10,2) NOT NULL, status VARCHAR(50) DEFAULT 'Nieoplacona', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`);
    const invResult = await client.query(
      `INSERT INTO invoices (numer,task_id,oddzial_id,wystawil_id,klient_nazwa,klient_nip,klient_adres,klient_email,klient_typ,data_wystawienia,data_sprzedazy,termin_platnosci,forma_platnosci,uwagi,netto,vat_stawka,vat_kwota,brutto,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Nieoplacona') RETURNING id`,
      [numer, task_id||null, finalOddzialId, req.user.id, klient_nazwa, klient_nip||null, klient_adres||null, klient_email||null, klient_typ||'firma', dataWyst, data_sprzedazy||dataWyst, termin_platnosci||null, forma_platnosci||'przelew', uwagi||null, netto.toFixed(2), vat_stawka, vat_kwota.toFixed(2), brutto.toFixed(2)]
    );
    const invoiceId = invResult.rows[0].id;
    await client.query(`CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY, invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      nazwa VARCHAR(200) NOT NULL, jednostka VARCHAR(20) DEFAULT 'szt', ilosc DECIMAL(10,2) NOT NULL,
      cena_netto DECIMAL(10,2) NOT NULL, vat_stawka DECIMAL(5,2) NOT NULL, wartosc_netto DECIMAL(10,2) NOT NULL,
      wartosc_brutto DECIMAL(10,2) NOT NULL, created_at TIMESTAMP DEFAULT NOW()
    )`);
    for (const p of pozycje) {
      const wNetto = parseFloat(p.ilosc) * parseFloat(p.cena_netto);
      const wBrutto = wNetto * (1 + parseFloat(p.vat_stawka) / 100);
      await client.query(
        `INSERT INTO invoice_items (invoice_id,nazwa,jednostka,ilosc,cena_netto,vat_stawka,wartosc_netto,wartosc_brutto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoiceId, p.nazwa, p.jednostka||'szt', p.ilosc, p.cena_netto, p.vat_stawka, wNetto.toFixed(2), wBrutto.toFixed(2)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, id: invoiceId, numer });
  } catch (err) { await client.query('ROLLBACK'); logger.error('Blad tworzenia faktury mobilnej', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// PUT /api/mobile/faktury/:id/status
router.put('/faktury/:id/status', authMiddleware, requireNieBrygadzista, validateParams(invoiceIdParamsSchema), validateBody(invoiceStatusBodySchema), async (req, res) => {
  try {
    const { status } = req.body;
    const check = await pool.query('SELECT id FROM invoices WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: req.t('errors.mobile.invoiceNotFound') });
    await pool.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    res.json({ success: true, message: 'Status zmieniony' });
  } catch (err) { logger.error('Blad aktualizacji statusu faktury', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

// DELETE /api/mobile/faktury/:id
router.delete('/faktury/:id', authMiddleware, validateParams(invoiceIdParamsSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.mobile.deleteInvoiceForbidden') });
    const check = await pool.query('SELECT id FROM invoices WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: req.t('errors.mobile.invoiceNotFound') });
    await pool.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Faktura usunięta' });
  } catch (err) { logger.error('Blad usuwania faktury', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

// GET /api/mobile/rozliczenia
router.get('/rozliczenia', authMiddleware, requireNieBrygadzista, validateQuery(mobileRozliczeniaQuerySchema), async (req, res) => {
  try {
    const { rok, miesiac } = req.query;
    const targetYear = rok || new Date().getFullYear();
    let where = 'WHERE EXTRACT(YEAR FROM data_wystawienia) = $1'; let params = [targetYear]; let idx = 2;
    if (miesiac) { where += ` AND EXTRACT(MONTH FROM data_wystawienia) = $${idx++}`; params.push(miesiac); }
    if (isKierownik(req.user)) { where += ` AND oddzial_id = $${idx++}`; params.push(req.user.oddzial_id); }
    else if (!isDyrektor(req.user)) { where += ` AND oddzial_id = $${idx++}`; params.push(req.user.oddzial_id); }
    const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices')`);
    if (!tableCheck.rows[0].exists) return res.json({ total_brutto: 0, total_netto: 0, total_vat: 0, oplacone: 0, nieoplacone: 0, miesiace: [] });
    const result = await pool.query(
      `SELECT COALESCE(SUM(brutto),0) as total_brutto, COALESCE(SUM(netto),0) as total_netto, COALESCE(SUM(vat_kwota),0) as total_vat,
        COALESCE(SUM(CASE WHEN status='Oplacona' THEN brutto ELSE 0 END),0) as oplacone,
        COALESCE(SUM(CASE WHEN status='Nieoplacona' THEN brutto ELSE 0 END),0) as nieoplacone
       FROM invoices ${where}`, params
    );
    const monthlyResult = await pool.query(
      `SELECT EXTRACT(MONTH FROM data_wystawienia) as miesiac, COALESCE(SUM(brutto),0) as suma
       FROM invoices ${where} GROUP BY EXTRACT(MONTH FROM data_wystawienia) ORDER BY miesiac`, params
    );
    res.json({ ...result.rows[0], miesiace: monthlyResult.rows });
  } catch (err) { logger.error('Blad pobierania rozliczen mobilnych', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

/** F11.4 — podgląd raportu dnia ekipy użytkownika (team = ekipa_id). */
router.get('/me/team-day-report', authMiddleware, validateQuery(teamDayReportQuerySchema), async (req, res) => {
  try {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Użyj date=YYYY-MM-DD' });
    }
    const u = await pool.query(`SELECT ekipa_id FROM users WHERE id = $1`, [req.user.id]);
    const ekipaId = u.rows[0]?.ekipa_id;
    if (!ekipaId) return res.json({ report: null, lines: [], day_preview: null });

    let day_preview = null;
    if (['Brygadzista', 'Pomocnik'].includes(req.user.rola)) {
      try {
        day_preview = await loadTeamDayEnrichment(pool, ekipaId, date);
      } catch (e) {
        logger.warn('mobile.team-day-report.enrichment', { message: e.message, requestId: req.requestId });
        day_preview = { tasks_day: [], cash_by_forma: [], issues_count: 0 };
      }
    }

    const r = await pool.query(
      `SELECT * FROM payroll_team_day_reports WHERE team_id = $1 AND report_date = $2::date`,
      [ekipaId, date]
    );
    const report = r.rows[0] || null;
    if (!report) return res.json({ report: null, lines: [], day_preview });
    const lr = await pool.query(
      `SELECT user_id, hours_total, pay_pln, detail_json FROM payroll_team_day_report_lines WHERE report_id = $1 ORDER BY user_id`,
      [report.id]
    );
    res.json({ report, lines: lr.rows, day_preview });
  } catch (err) {
    logger.error('mobile.team-day-report', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

/** F11.4 — ponowne złożenie / przeliczenie raportu dnia dla własnej ekipy (Brygadzista / Pomocnik). */
router.post('/me/team-day-close', authMiddleware, validateBody(teamDayCloseBodySchema), async (req, res) => {
  try {
    if (!['Brygadzista', 'Pomocnik'].includes(req.user.rola)) {
      return res.status(403).json({ error: 'Tylko ekipa w terenie' });
    }
    const u = await pool.query(`SELECT ekipa_id FROM users WHERE id = $1`, [req.user.id]);
    const ekipaId = u.rows[0]?.ekipa_id;
    if (!ekipaId) return res.status(400).json({ error: 'Brak przypisanej ekipy' });
    const out = await buildTeamDayReport(pool, ekipaId, req.body.report_date);
    res.json(out);
  } catch (err) {
    if (err.code === 'PAYROLL_REPORT_APPROVED') {
      return res.status(409).json({ error: 'Raport dnia jest zatwierdzony — nie można go przeliczyć.' });
    }
    if (err.code === 'PAYROLL_CORRECTION_WINDOW_CLOSED') {
      return res.status(409).json({ error: 'Minął dozwolony okres korekty raportu — skontaktuj się z kierownikiem.' });
    }
    if (String(err.message || '').includes('payroll_team_day_reports')) {
      return res.status(503).json({ error: 'Uruchom migrację M11.' });
    }
    logger.error('mobile.team-day-close', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message || req.t('errors.http.serverError') });
  }
});

/** F11.8 — rejestracja tokena Expo Push (UPSERT po expo_token — to samo urządzenie przy zmianie konta). */
router.post('/me/push-token', authMiddleware, validateBody(pushTokenBodySchema), async (req, res) => {
  try {
    const expoToken = String(req.body.expo_token).trim();
    if (!isLikelyExpoPushToken(expoToken)) {
      return res.status(400).json({ error: 'Nieprawidłowy format tokena push (Expo).' });
    }
    const platform = req.body.platform ? String(req.body.platform).slice(0, 16) : null;
    await pool.query(
      `INSERT INTO user_expo_push_tokens (user_id, expo_token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (expo_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = NOW()`,
      [req.user.id, expoToken, platform]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    if (String(e.message || '').includes('user_expo_push_tokens')) {
      return res.status(503).json({ error: 'Uruchom migrację (user_expo_push_tokens).' });
    }
    logger.error('mobile.push-token', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

/** F11.8 — wyrejestrowanie tokena (np. przy wylogowaniu). */
router.delete('/me/push-token', authMiddleware, validateBody(pushTokenDeleteSchema), async (req, res) => {
  try {
    const expoToken = String(req.body.expo_token).trim();
    const { rowCount } = await pool.query(
      `DELETE FROM user_expo_push_tokens WHERE expo_token = $1 AND user_id = $2`,
      [expoToken, req.user.id]
    );
    res.json({ ok: true, removed: rowCount > 0 });
  } catch (e) {
    if (String(e.message || '').includes('user_expo_push_tokens')) {
      return res.status(503).json({ error: 'Uruchom migrację (user_expo_push_tokens).' });
    }
    logger.error('mobile.push-token.del', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

/** F11.8 — podsumowanie dniówki / naliczeń dla zalogowanego użytkownika. */
router.get('/me/payroll-overview', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const ms = monthStart.toISOString().slice(0, 10);
    let hoursMonth = 0;
    try {
      const h = await pool.query(
        `SELECT COALESCE(SUM(COALESCE(wl.duration_hours, wl.czas_pracy_minuty::numeric / 60)), 0)::numeric(12,2) AS h
         FROM work_logs wl WHERE wl.user_id = $1 AND wl.end_time IS NOT NULL
           AND wl.start_time >= $2::date AND wl.start_time < ($2::date + INTERVAL '1 month')`,
        [uid, ms]
      );
      hoursMonth = Number(h.rows[0]?.h) || 0;
    } catch {
      hoursMonth = 0;
    }
    let rates = [];
    try {
      const r = await pool.query(
        `SELECT * FROM user_payroll_rates WHERE user_id = $1 ORDER BY effective_from DESC LIMIT 5`,
        [uid]
      );
      rates = r.rows;
    } catch {
      rates = [];
    }
    let estimator = null;
    if (req.user.rola === 'Wyceniający') {
      try {
        const e = await pool.query(`SELECT * FROM estimator_month_accrual WHERE wyceniajacy_id = $1 AND accrual_month = $2::date`, [
          uid,
          ms,
        ]);
        estimator = e.rows[0] || null;
      } catch {
        estimator = null;
      }
    }
    res.json({ user_id: uid, date: today, hours_month: hoursMonth, rates, estimator_month: estimator });
  } catch (err) {
    logger.error('mobile.payroll-overview', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
