const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');

function getSmsClient() {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  // eslint-disable-next-line global-require
  return require('twilio')(accountSid, authToken);
}

function publicBase() {
  return (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function writeQuotationPdfContent(doc, q, items) {
  doc.fontSize(18).fillColor('#111').text('Oferta ARBOR — wycena terenowa', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#333').text(`Nr wewnętrzny: ${q.id}`, { align: 'right' });
  doc.text(`Oddział: ${q.oddzial_nazwa || '—'}`);
  doc.moveDown();
  doc.fontSize(12).text('Klient', { underline: true });
  doc.fontSize(10).text(`${q.klient_nazwa || '—'}`);
  doc.text(`Tel: ${q.klient_telefon || '—'}  Email: ${q.klient_email || '—'}`);
  doc.text(`Adres: ${[q.adres, q.miasto].filter(Boolean).join(', ') || '—'}`);
  doc.moveDown();
  doc.fontSize(12).text('Zakres (obiekty)', { underline: true });
  items.forEach((it, idx) => {
    doc.fontSize(10).text(
      `${idx + 1}. ${it.gatunek || '—'} | ${it.wysokosc_pas || '—'} | ${it.typ_pracy || '—'} | ${it.cena_pozycji != null ? Number(it.cena_pozycji).toFixed(2) + ' PLN' : '—'}`
    );
  });
  doc.moveDown();
  doc.fontSize(12).text('Wartość', { underline: true });
  doc
    .fontSize(11)
    .text(
      `Sugerowana: ${q.wartosc_sugerowana != null ? Number(q.wartosc_sugerowana).toFixed(2) : '—'} PLN  |  Oferta: ${q.wartosc_zaproponowana != null ? Number(q.wartosc_zaproponowana).toFixed(2) : '—'} PLN`
    );
  if (q.waznosc_do) doc.text(`Ważność oferty do: ${String(q.waznosc_do).slice(0, 10)}`);
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#666').text('Dokument wygenerowany automatycznie z ARBOR-OS.', { align: 'center' });
}

async function loadQuotationPdfPayload(quotationId) {
  const qRes = await pool.query(
    `SELECT q.*, b.nazwa AS oddzial_nazwa FROM quotations q LEFT JOIN branches b ON b.id = q.oddzial_id WHERE q.id = $1`,
    [quotationId]
  );
  const q = qRes.rows[0];
  if (!q) throw new Error('Brak wyceny');
  const items = (
    await pool.query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY kolejnosc, id`, [quotationId])
  ).rows;
  return { q, items };
}

async function generateQuotationPdfToDisk(quotationId) {
  const { q, items } = await loadQuotationPdfPayload(quotationId);

  const dir = path.join(process.cwd(), 'uploads', 'quotations');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `wycena_${quotationId}.pdf`;
  const abs = path.join(dir, filename);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const stream = fs.createWriteStream(abs);
  doc.pipe(stream);
  writeQuotationPdfContent(doc, q, items);
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return `/uploads/quotations/${filename}`;
}

async function generateQuotationPdfBuffer(quotationId) {
  const { q, items } = await loadQuotationPdfPayload(quotationId);
  const chunks = [];
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.on('data', (c) => chunks.push(c));
  writeQuotationPdfContent(doc, q, items);
  doc.end();
  await new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  return Buffer.concat(chunks);
}

async function sendQuotationEmailOptional(toEmail, subject, text, pdfAbsPath) {
  if (!env.SMTP_USER || !env.SMTP_PASS) return;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    const mail = {
      from: env.SMTP_USER,
      to: toEmail,
      subject,
      text,
      attachments: fs.existsSync(pdfAbsPath) ? [{ filename: 'oferta-arbor.pdf', path: pdfAbsPath }] : [],
    };
    await transporter.sendMail(mail);
  } catch (e) {
    logger.error('quotationFinalize.email', { message: e.message });
  }
}

/**
 * Po pełnym zatwierdzeniu: PDF, token akceptacji, SMS/e-mail, status Wyslana_Klientowi.
 */
async function afterQuotationFullyApproved(pool, quotationId) {
  const q = (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  if (!q) return;
  const token = crypto.randomBytes(24).toString('hex');
  const pdfUrl = await generateQuotationPdfToDisk(quotationId);
  const pdfAbs = path.join(process.cwd(), pdfUrl.replace(/^\//, ''));

  await pool.query(
    `UPDATE quotations SET
      client_acceptance_token = $1,
      pdf_url = $2,
      status = 'Wyslana_Klientowi',
      wyslano_klientowi_at = NOW(),
      updated_at = NOW()
     WHERE id = $3`,
    [token, pdfUrl, quotationId]
  );

  const base = publicBase();
  const acceptUrl = base ? `${base}/api/public/quotations/${token}` : `/api/public/quotations/${token}`;
  const msg = `ARBOR: oferta ${quotationId}. Akceptacja jednym klikiem: ${acceptUrl}`;

  const client = getSmsClient();
  const tel = (q.klient_telefon || '').replace(/\s/g, '');
  if (client && tel && env.TWILIO_PHONE) {
    try {
      await client.messages.create({
        body: msg.slice(0, 1500),
        from: env.TWILIO_PHONE,
        to: tel.startsWith('+') ? tel : `+48${tel.replace(/^\+?48/, '')}`,
      });
      await pool.query(
        `INSERT INTO sms_history (task_id, telefon, tresc, status) VALUES (NULL, $1, $2, 'Wyslany')`,
        [tel, msg]
      );
    } catch (e) {
      logger.error('quotationFinalize.sms', { message: e.message });
    }
  }

  if (q.klient_email) {
    await sendQuotationEmailOptional(
      q.klient_email,
      `Oferta ARBOR #${quotationId}`,
      `${msg}\n\nPDF w załączniku.`,
      pdfAbs
    );
  }

  if (q.wyceniajacy_id) {
    await pool.query(
      `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
       VALUES (NULL, $1, NULL, $2, 'quotation_sent', $3, 'Nowe')`,
      [q.wyceniajacy_id, quotationId, `Wycena ${quotationId} wysłana do klienta (SMS/e-mail).`]
    );
  }
}

module.exports = {
  afterQuotationFullyApproved,
  generateQuotationPdfToDisk,
  generateQuotationPdfBuffer,
  publicBase,
};
