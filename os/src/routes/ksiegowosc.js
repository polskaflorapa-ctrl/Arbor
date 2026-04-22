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
const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';

const fakturyListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  status: z.string().max(50).optional(),
  rok: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get('/ustawienia', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM company_settings LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) { logger.error('Blad ksiegowosc /ustawienia GET', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.put('/ustawienia', authMiddleware, requireNieBrygadzista, validateBody(companySettingsWriteSchema), async (req, res) => {
  try {
    const { nazwa, nip, adres, kod_pocztowy, miasto, konto_bankowe, bank_nazwa, email, telefon } = req.body;
    await pool.query(
      `UPDATE company_settings SET nazwa=$1,nip=$2,adres=$3,kod_pocztowy=$4,miasto=$5,konto_bankowe=$6,bank_nazwa=$7,email=$8,telefon=$9,updated_at=NOW()`,
      [nazwa, nip, adres, kod_pocztowy, miasto, konto_bankowe, bank_nazwa, email, telefon]
    );
    res.json({ message: 'Zapisano' });
  } catch (err) { logger.error('Blad ksiegowosc /ustawienia PUT', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

const getNumerFaktury = async (oddzial_id) => {
  const rok = new Date().getFullYear();
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM invoices WHERE EXTRACT(YEAR FROM data_wystawienia)=$1 AND oddzial_id=$2`,
    [rok, oddzial_id]
  );
  const nr = parseInt(result.rows[0].cnt) + 1;
  return `FV/${rok}/${String(nr).padStart(3,'0')}`;
};

router.get('/faktury', authMiddleware, requireNieBrygadzista, validateQuery(fakturyListQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, status, rok, limit, offset } = req.query;
    let where = 'WHERE 1=1'; let params = []; let idx = 1;
    if (!isDyrektor(req.user)) { where += ` AND i.oddzial_id=$${idx++}`; params.push(req.user.oddzial_id); }
    else if (oddzial_id) { where += ` AND i.oddzial_id=$${idx++}`; params.push(oddzial_id); }
    if (status) { where += ` AND i.status=$${idx++}`; params.push(status); }
    if (rok) { where += ` AND EXTRACT(YEAR FROM i.data_wystawienia)=$${idx++}`; params.push(rok); }

    const baseFrom = `FROM invoices i LEFT JOIN branches b ON i.oddzial_id=b.id LEFT JOIN users u ON i.wystawil_id=u.id ${where}`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${baseFrom}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `SELECT i.*, b.nazwa as oddzial_nazwa, u.imie||' '||u.nazwisko as wystawil_nazwa
         ${baseFrom} ORDER BY i.created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }

    const result = await pool.query(
      `SELECT i.*, b.nazwa as oddzial_nazwa, u.imie||' '||u.nazwisko as wystawil_nazwa
       ${baseFrom} ORDER BY i.created_at DESC`, params);
    res.json(result.rows);
  } catch (err) { logger.error('Blad ksiegowosc /faktury GET', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.get('/faktury/stats', authMiddleware, requireNieBrygadzista, async (req, res) => {
  try {
    let where = 'WHERE 1=1'; let params = []; let idx = 1;
    if (!isDyrektor(req.user)) { where += ` AND oddzial_id=$${idx++}`; params.push(req.user.oddzial_id); }
    const result = await pool.query(
      `SELECT COUNT(*) as total, SUM(brutto) as przychod_total,
        SUM(CASE WHEN status='Oplacona' THEN brutto ELSE 0 END) as oplacone,
        SUM(CASE WHEN status='Nieoplacona' THEN brutto ELSE 0 END) as nieoplacone
       FROM invoices ${where}`, params);
    res.json(result.rows[0]);
  } catch (err) { logger.error('Blad ksiegowosc /faktury/stats GET', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.get('/faktury/:id', authMiddleware, requireNieBrygadzista, validateParams(invoiceIdParamsSchema), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, b.nazwa as oddzial_nazwa, u.imie||' '||u.nazwisko as wystawil_nazwa
       FROM invoices i LEFT JOIN branches b ON i.oddzial_id=b.id LEFT JOIN users u ON i.wystawil_id=u.id
       WHERE i.id=$1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const pozycje = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id', [req.params.id]);
    res.json({ ...result.rows[0], pozycje: pozycje.rows });
  } catch (err) { logger.error('Blad ksiegowosc /faktury/:id GET', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.post('/faktury', authMiddleware, requireNieBrygadzista, validateBody(invoiceCreateBodySchema), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { task_id, klient_nazwa, klient_nip, klient_adres, klient_email, klient_typ,
      data_wystawienia, data_sprzedazy, termin_platnosci, forma_platnosci, uwagi, pozycje, oddzial_id: bodyOddzial } = req.body;
    const oddzial_id = isDyrektor(req.user) ? (bodyOddzial || req.user.oddzial_id) : req.user.oddzial_id;
    const numer = await getNumerFaktury(oddzial_id);
    let netto=0, vat_kwota=0, brutto=0;
    for (const p of pozycje) {
      const wNetto = parseFloat(p.ilosc)*parseFloat(p.cena_netto);
      const wVat = wNetto*parseFloat(p.vat_stawka)/100;
      netto+=wNetto; vat_kwota+=wVat; brutto+=wNetto+wVat;
    }
    const vat_stawka = pozycje[0]?.vat_stawka||23;
    const invResult = await client.query(
      `INSERT INTO invoices (numer,task_id,oddzial_id,wystawil_id,klient_nazwa,klient_nip,klient_adres,klient_email,klient_typ,data_wystawienia,data_sprzedazy,termin_platnosci,forma_platnosci,uwagi,netto,vat_stawka,vat_kwota,brutto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [numer,task_id||null,oddzial_id,req.user.id,klient_nazwa,klient_nip||null,klient_adres,klient_email||null,klient_typ||'firma',
       data_wystawienia,data_sprzedazy,termin_platnosci||null,forma_platnosci||'przelew',uwagi||null,
       netto.toFixed(2),vat_stawka,vat_kwota.toFixed(2),brutto.toFixed(2)]
    );
    const invoiceId = invResult.rows[0].id;
    for (const p of pozycje) {
      const wNetto = parseFloat(p.ilosc)*parseFloat(p.cena_netto);
      const wBrutto = wNetto*(1+parseFloat(p.vat_stawka)/100);
      await client.query(
        `INSERT INTO invoice_items (invoice_id,nazwa,jednostka,ilosc,cena_netto,vat_stawka,wartosc_netto,wartosc_brutto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoiceId,p.nazwa,p.jednostka||'szt',p.ilosc,p.cena_netto,p.vat_stawka,wNetto.toFixed(2),wBrutto.toFixed(2)]
      );
    }
    await client.query('COMMIT');
    res.json({ id: invoiceId, numer });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Blad ksiegowosc /faktury POST', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/faktury/:id/status', authMiddleware, requireNieBrygadzista, validateParams(invoiceIdParamsSchema), validateBody(invoiceStatusBodySchema), async (req, res) => {
  try {
    await pool.query('UPDATE invoices SET status=$1 WHERE id=$2', [req.body.status, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) { logger.error('Blad ksiegowosc /faktury/:id/status PUT', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.delete('/faktury/:id', authMiddleware, validateParams(invoiceIdParamsSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
    res.json({ message: 'Usunieto' });
  } catch (err) { logger.error('Blad ksiegowosc /faktury/:id DELETE', { message: err.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

module.exports = router;
