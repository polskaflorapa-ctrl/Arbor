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

module.exports = router;
