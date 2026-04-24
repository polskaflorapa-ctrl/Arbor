const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateParams } = require('../middleware/validate');
const { z } = require('zod');
const PDFDocument = require('pdfkit');

const router = express.Router();

const pdfIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const pdfDailyDateParamsSchema = z.object({
  data: z.string().max(20),
});

const formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const formatDateTime = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const formatCurrency = (amount) => {
  if (!amount) return '0,00 PLN';
  return parseFloat(amount).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';
};

/** Nagłówki PDF — neutralna czerń (spójnie z Platinum Chrome, bez niebieskiego brandu). */
const PDF_BRAND = '#111111';

const getStatusColor = (status) => {
  const colors = { Nowe: '#3B82F6', W_Realizacji: '#F59E0B', Zakonczone: '#10B981', Anulowane: '#EF4444' };
  return colors[status] || '#6B7280';
};

const getStatusText = (status) => {
  const texts = { Nowe: 'Nowe', W_Realizacji: 'W realizacji', Zakonczone: 'Zakończone', Anulowane: 'Anulowane' };
  return texts[status] || status;
};

// GET /api/pdf/zlecenie/:id
router.get('/zlecenie/:id', authMiddleware, validateParams(pdfIdParamsSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const accessCheck = await pool.query('SELECT t.id, t.oddzial_id, t.status FROM tasks t WHERE t.id = $1', [id]);
    if (accessCheck.rows.length === 0) return res.status(404).json({ error: req.t('errors.pdf.taskNotFound') });
    const task = accessCheck.rows[0];
    const userRole = req.user.rola;
    if (userRole !== 'Dyrektor' && userRole !== 'Administrator' && userRole !== 'Kierownik') {
      if (task.oddzial_id !== req.user.oddzial_id && userRole !== 'Brygadzista') {
        return res.status(403).json({ error: req.t('errors.pdf.taskAccessDenied') });
      }
    }

    const zRes = await pool.query(
      `SELECT t.*, te.nazwa as ekipa_nazwa, u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        u.telefon as kierownik_telefon, b.nazwa as oddzial_nazwa, b.adres as oddzial_adres, b.telefon as oddzial_telefon
       FROM tasks t LEFT JOIN teams te ON t.ekipa_id = te.id LEFT JOIN users u ON t.kierownik_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id WHERE t.id = $1`, [id]
    );
    if (zRes.rows.length === 0) return res.status(404).json({ error: req.t('errors.pdf.taskNotFound') });
    const z = zRes.rows[0];

    const wRes = await pool.query(
      `SELECT wl.*, u.imie || ' ' || u.nazwisko as pracownik, u.rola FROM work_logs wl
       LEFT JOIN users u ON wl.user_id = u.id WHERE wl.task_id = $1 ORDER BY wl.start_time`, [id]
    );
    const iRes = await pool.query(
      `SELECT i.*, u.imie || ' ' || u.nazwisko as zglaszajacy FROM issues i
       LEFT JOIN users u ON i.user_id = u.id WHERE i.task_id = $1 ORDER BY i.created_at DESC`, [id]
    );
    const pRes = await pool.query(
      `SELECT u.id, u.imie, u.nazwisko, tp.godziny, tp.stawka_godzinowa FROM task_pomocnicy tp
       JOIN users u ON tp.pomocnik_id = u.id WHERE tp.task_id = $1`, [id]
    );
    const rRes = await pool.query('SELECT * FROM rozliczenia WHERE task_id = $1', [id]);

    const logs = wRes.rows;
    const issues = iRes.rows;
    const helpers = pRes.rows;
    const rozliczenie = rRes.rows[0];

    const lacznieMinut = logs.reduce((s, w) => s + (parseFloat(w.duration_hours) * 60 || parseFloat(w.czas_pracy_minuty) || 0), 0);
    const lacznieGodzin = lacznieMinut / 60;
    const kosztRobocizny = lacznieGodzin * 45 * (logs.length > 0 ? logs.length : 3);
    const wartosc = parseFloat(z.wartosc_planowana || 0);
    const marza = wartosc - kosztRobocizny;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=zlecenie_${id}_${formatDate(new Date())}.pdf`);
    doc.pipe(res);

    doc.fontSize(22).fillColor(PDF_BRAND).font('Helvetica-Bold').text('ARBOR-OS', { align: 'center' });
    doc.fontSize(12).fillColor('#6B7280').font('Helvetica').text('System Zarządzania Usługami Terenowymi', { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
    doc.moveDown();
    doc.fontSize(18).fillColor('#1F2937').font('Helvetica-Bold').text(`Protokół zlecenia #${z.id}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor(getStatusColor(z.status)).text(`Status: ${getStatusText(z.status)}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).fillColor(PDF_BRAND).font('Helvetica-Bold').text('Dane podstawowe');
    doc.moveDown(0.5);
    let startY = doc.y;
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text('Klient:', 50, startY); doc.text(`${z.klient_nazwa || '-'}`, 150, startY);
    doc.text('Telefon:', 300, startY); doc.text(`${z.klient_telefon || '-'}`, 400, startY);
    doc.text('Adres:', 50, startY + 20); doc.text(`${z.adres || '-'}, ${z.miasto || '-'}`, 150, startY + 20);
    doc.text('Typ usługi:', 50, startY + 40); doc.text(`${z.typ_uslugi || '-'}`, 150, startY + 40);
    doc.text('Priorytet:', 300, startY + 40); doc.text(`${z.priorytet || 'Normalny'}`, 400, startY + 40);
    doc.text('Data realizacji:', 50, startY + 60); doc.text(`${formatDate(z.data_planowana)}`, 150, startY + 60);
    doc.text('Oddział:', 300, startY + 60); doc.text(`${z.oddzial_nazwa || '-'}`, 400, startY + 60);
    doc.text('Ekipa:', 50, startY + 80); doc.text(`${z.ekipa_nazwa || 'Nieprzypisana'}`, 150, startY + 80);
    doc.text('Kierownik:', 300, startY + 80); doc.text(`${z.kierownik_nazwa || '-'}`, 400, startY + 80);
    doc.moveDown(6);

    if (z.notatki_wewnetrzne) {
      doc.fontSize(10).fillColor('#92400E').text(`Notatki wewnętrzne: ${z.notatki_wewnetrzne}`, { width: 450 });
      doc.moveDown();
    }

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
    doc.moveDown();
    doc.fontSize(14).fillColor(PDF_BRAND).font('Helvetica-Bold').text('Podsumowanie finansowe');
    doc.moveDown(0.5);
    startY = doc.y;
    doc.fontSize(11).fillColor('#374151').font('Helvetica');
    doc.text('Wartość zlecenia brutto:', 50, startY); doc.text(`${formatCurrency(wartosc)}`, 250, startY);
    doc.text('Łączny czas pracy:', 50, startY + 20); doc.text(`${Math.floor(lacznieGodzin)}h ${Math.round((lacznieGodzin % 1) * 60)}min`, 250, startY + 20);
    doc.text('Koszt robocizny (szac.):', 50, startY + 40); doc.text(`${formatCurrency(kosztRobocizny)}`, 250, startY + 40);
    if (rozliczenie) {
      doc.text('Koszt pomocników:', 50, startY + 60); doc.text(`${formatCurrency(rozliczenie.koszt_pomocnikow)}`, 250, startY + 60);
      doc.text('Podstawa brygadzisty:', 50, startY + 80); doc.text(`${formatCurrency(rozliczenie.podstawa_brygadzisty)}`, 250, startY + 80);
      doc.fontSize(12).fillColor(rozliczenie.wynagrodzenie_brygadzisty >= 0 ? '#10B981' : '#EF4444');
      doc.text('Wynagrodzenie brygadzisty:', 50, startY + 100); doc.text(`${formatCurrency(rozliczenie.wynagrodzenie_brygadzisty)}`, 250, startY + 100);
    } else {
      doc.fontSize(12).fillColor(marza >= 0 ? '#10B981' : '#EF4444');
      doc.text('Szacowana marża:', 50, startY + 60); doc.text(`${formatCurrency(marza)} (${((marza / wartosc) * 100).toFixed(1)}%)`, 250, startY + 60);
    }
    doc.moveDown(6);

    if (helpers.length > 0) {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
      doc.moveDown();
      doc.fontSize(13).fillColor(PDF_BRAND).font('Helvetica-Bold').text('Pomocnicy');
      doc.moveDown(0.5);
      helpers.forEach((h, i) => {
        doc.fontSize(10).fillColor('#374151').text(`${i+1}. ${h.imie} ${h.nazwisko} - ${h.godziny || 0}h × ${formatCurrency(h.stawka_godzinowa)}/h`);
      });
      doc.moveDown();
    }

    if (logs.length > 0) {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
      doc.moveDown();
      doc.fontSize(13).fillColor(PDF_BRAND).font('Helvetica-Bold').text('Rejestr czasu pracy');
      doc.moveDown(0.5);
      logs.forEach((log, i) => {
        const czas = log.duration_hours ? `${parseFloat(log.duration_hours).toFixed(1)}h` : (log.czas_pracy_minuty ? `${Math.floor(log.czas_pracy_minuty/60)}h ${Math.round(log.czas_pracy_minuty%60)}min` : '-');
        doc.fontSize(9).fillColor('#374151').text(`${i+1}. ${log.pracownik || '-'} | ${formatDateTime(log.start_time)} → ${formatDateTime(log.end_time)} | ${czas}`);
      });
      doc.moveDown();
    }

    if (issues.length > 0) {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
      doc.moveDown();
      doc.fontSize(13).fillColor(PDF_BRAND).font('Helvetica-Bold').text('Zgłoszenia problemów');
      doc.moveDown(0.5);
      issues.forEach((issue, i) => {
        doc.fontSize(9).fillColor('#EF4444').text(`${i+1}. ${issue.typ?.replace(/_/g, ' ') || 'Problem'}`, { continued: true })
          .fillColor('#374151').text(` - ${issue.status || 'Nowy'} (${issue.zglaszajacy || '-'})`);
        if (issue.opis) doc.fontSize(8).fillColor('#6B7280').text(`   Opis: ${issue.opis}`, { width: 450 });
      });
      doc.moveDown();
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#9CA3AF');
    doc.text(`Wygenerowano: ${formatDateTime(new Date())} przez: ${req.user.imie} ${req.user.nazwisko} (${req.user.rola})`, { align: 'center' });
    doc.text('ARBOR-OS v2.0 | System Zarządzania Usługami Terenowymi', { align: 'center' });
    doc.end();
  } catch (err) {
    logger.error('Blad generowania PDF zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: 'Błąd generowania PDF: ' + err.message });
  }
});

// GET /api/pdf/faktura/:id
router.get('/faktura/:id', authMiddleware, validateParams(pdfIdParamsSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const fRes = await pool.query(
      `SELECT i.*, b.nazwa as oddzial_nazwa, b.adres as oddzial_adres, b.nip as oddzial_nip,
        u.imie || ' ' || u.nazwisko as wystawil_nazwa
       FROM invoices i LEFT JOIN branches b ON i.oddzial_id = b.id LEFT JOIN users u ON i.wystawil_id = u.id
       WHERE i.id = $1`, [id]
    );
    if (fRes.rows.length === 0) return res.status(404).json({ error: req.t('errors.pdf.invoiceNotFound') });
    const faktura = fRes.rows[0];
    const pRes = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [id]);
    const pozycje = pRes.rows;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=faktura_${faktura.numer}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).fillColor(PDF_BRAND).font('Helvetica-Bold').text('ARBOR-OS', { align: 'center' });
    doc.fontSize(10).fillColor('#6B7280').text('Firma Usług Ogrodniczych', { align: 'center' });
    doc.moveDown();
    doc.fontSize(24).fillColor('#1F2937').text('FAKTURA', { align: 'center' });
    doc.fontSize(12).fillColor('#6B7280').text(`Nr ${faktura.numer}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold').text('Sprzedawca:');
    doc.fontSize(9).fillColor('#374151').font('Helvetica');
    doc.text('ARBOR-OS'); doc.text('ul. Leśna 15'); doc.text('60-001 Poznań'); doc.text('NIP: 1234567890');
    doc.moveDown();
    doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold').text('Nabywca:');
    doc.fontSize(9).fillColor('#374151').font('Helvetica');
    doc.text(`${faktura.klient_nazwa}`);
    if (faktura.klient_adres) doc.text(`${faktura.klient_adres}`);
    if (faktura.klient_nip) doc.text(`NIP: ${faktura.klient_nip}`);
    doc.moveDown();

    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F2937');
    doc.text('Lp.', 50, tableTop); doc.text('Nazwa usługi', 80, tableTop);
    doc.text('Ilość', 300, tableTop); doc.text('Cena netto', 350, tableTop);
    doc.text('VAT', 420, tableTop); doc.text('Wartość netto', 460, tableTop);
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

    let y = tableTop + 25;
    doc.font('Helvetica').fillColor('#374151');
    pozycje.forEach((p, i) => {
      doc.text(`${i+1}`, 50, y); doc.text(p.nazwa.substring(0, 40), 80, y);
      doc.text(`${p.ilosc} ${p.jednostka || 'szt'}`, 300, y);
      doc.text(`${formatCurrency(p.cena_netto)}`, 350, y);
      doc.text(`${p.vat_stawka}%`, 420, y);
      doc.text(`${formatCurrency(p.wartosc_netto)}`, 460, y);
      y += 20;
    });
    y += 10;
    doc.moveTo(50, y).lineTo(545, y).stroke(); y += 10;
    doc.font('Helvetica-Bold');
    doc.text('Razem netto:', 350, y); doc.text(`${formatCurrency(faktura.netto)}`, 460, y); y += 20;
    doc.text(`VAT (${faktura.vat_stawka}%):`, 350, y); doc.text(`${formatCurrency(faktura.vat_kwota)}`, 460, y); y += 20;
    doc.fontSize(12).fillColor(PDF_BRAND);
    doc.text('Razem brutto:', 350, y); doc.text(`${formatCurrency(faktura.brutto)}`, 460, y);
    doc.moveDown(3);
    if (faktura.uwagi) { doc.fontSize(9).fillColor('#6B7280').font('Helvetica').text(`Uwagi: ${faktura.uwagi}`); }
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#9CA3AF');
    doc.text(`Wygenerowano: ${formatDateTime(new Date())}`, { align: 'center' });
    doc.text(`Status: ${faktura.status}`, { align: 'center' });
    doc.end();
  } catch (err) {
    logger.error('Blad generowania PDF faktury', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: 'Błąd generowania PDF: ' + err.message });
  }
});

// GET /api/pdf/raport/dzienny/:data
router.get('/raport/dzienny/:data', authMiddleware, validateParams(pdfDailyDateParamsSchema), async (req, res) => {
  try {
    const { data } = req.params;
    const userId = req.user.id;
    const userRole = req.user.rola;
    let query = `SELECT t.*, b.nazwa as oddzial_nazwa, u.imie || ' ' || u.nazwisko as brygadzista_nazwa
      FROM tasks t LEFT JOIN branches b ON t.oddzial_id = b.id LEFT JOIN users u ON t.brygadzista_id = u.id
      WHERE DATE(t.data_planowana) = $1`;
    let params = [data];
    if (userRole === 'Brygadzista') { query += ' AND t.brygadzista_id = $2'; params.push(userId); }
    else if (userRole === 'Kierownik') { query += ' AND t.oddzial_id = $2'; params.push(req.user.oddzial_id); }
    query += ' ORDER BY t.data_planowana';
    const result = await pool.query(query, params);
    const zlecenia = result.rows;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=raport_dzienny_${data}.pdf`);
    doc.pipe(res);
    doc.fontSize(18).fillColor(PDF_BRAND).text('ARBOR-OS', { align: 'center' });
    doc.fontSize(14).text('Raport dzienny', { align: 'center' });
    doc.fontSize(12).text(`Data: ${formatDate(data)}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Liczba zleceń: ${zlecenia.length}`, { align: 'center' });
    doc.moveDown();
    zlecenia.forEach((z, i) => {
      doc.fontSize(11).fillColor('#1F2937').text(`${i+1}. Zlecenie #${z.id} - ${z.klient_nazwa}`);
      doc.fontSize(9).fillColor('#374151').text(`   Adres: ${z.adres}, ${z.miasto}`);
      doc.text(`   Typ: ${z.typ_uslugi} | Status: ${getStatusText(z.status)}`);
      if (z.wartosc_planowana) doc.text(`   Wartość: ${formatCurrency(z.wartosc_planowana)}`);
      doc.moveDown(0.5);
    });
    doc.end();
  } catch (err) {
    logger.error('Blad generowania PDF raportu dziennego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.pdf.generationFailed') });
  }
});

module.exports = router;
