const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { getTwilioSmsStatusCallbackUrl } = require('./twilioStatusCallback');

function getSmsClient() {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
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

/** @returns {{ status: string, error: string | null, at: Date | null }} */
async function sendQuotationEmailWithResult(toEmail, subject, text, pdfAbsPath) {
  const em = String(toEmail || '').trim();
  if (!em) return { status: 'skipped_no_email', error: null, at: null };
  if (!env.SMTP_USER || !env.SMTP_PASS) return { status: 'skipped_no_smtp', error: null, at: null };
  const at = new Date();
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
      to: em,
      subject,
      text,
      attachments: fs.existsSync(pdfAbsPath) ? [{ filename: 'oferta-arbor.pdf', path: pdfAbsPath }] : [],
    };
    await transporter.sendMail(mail);
    return { status: 'sent', error: null, at };
  } catch (e) {
    logger.error('quotationFinalize.email', { message: e.message });
    const err = (e.message || String(e)).slice(0, 500);
    return { status: 'failed', error: err, at };
  }
}

async function persistOfferDelivery(pool, quotationId, sms, email) {
  await pool.query(
    `UPDATE quotations SET
      offer_sms_status = $1,
      offer_sms_error = $2,
      offer_sms_at = $3,
      offer_email_status = $4,
      offer_email_error = $5,
      offer_email_at = $6,
      updated_at = NOW()
     WHERE id = $7`,
    [
      sms.status,
      sms.error,
      sms.at,
      email.status,
      email.error,
      email.at,
      quotationId,
    ]
  );
}

/**
 * Wysyła SMS + e-mail z linkiem akceptacji i aktualizuje pola offer_* (bez zmiany tokenu).
 * @param q — wiersz quotations z ustawionym client_acceptance_token
 */
async function deliverOfferSmsEmail(pool, quotationId, q, pdfAbs) {
  const token = q.client_acceptance_token;
  if (!token) throw new Error('Brak tokenu akceptacji');

  const base = publicBase();
  const acceptUrl = base ? `${base}/api/public/quotations/${token}` : `/api/public/quotations/${token}`;
  const msg = `ARBOR: oferta ${quotationId}. Akceptacja jednym klikiem: ${acceptUrl}`;

  const client = getSmsClient();
  const tel = (q.klient_telefon || '').replace(/\s/g, '');
  /** @type {{ status: string, error: string | null, at: Date | null }} */
  let sms;
  if (!tel) {
    sms = { status: 'skipped_no_phone', error: null, at: null };
  } else if (!client || !env.TWILIO_PHONE) {
    sms = { status: 'skipped_no_twilio', error: null, at: null };
  } else {
    const smsAt = new Date();
    try {
      const statusCb = getTwilioSmsStatusCallbackUrl();
      const twMsg = await client.messages.create({
        body: msg.slice(0, 1500),
        from: env.TWILIO_PHONE,
        to: tel.startsWith('+') ? tel : `+48${tel.replace(/^\+?48/, '')}`,
        ...(statusCb ? { statusCallback: statusCb } : {}),
      });
      await pool.query(
        `INSERT INTO sms_history (task_id, telefon, tresc, status, sid) VALUES (NULL, $1, $2, 'Wyslany', $3)`,
        [tel, msg, twMsg.sid]
      );
      sms = { status: 'sent', error: null, at: smsAt };
    } catch (e) {
      logger.error('quotationFinalize.sms', { message: e.message });
      sms = {
        status: 'failed',
        error: (e.message || String(e)).slice(0, 500),
        at: smsAt,
      };
    }
  }

  const emailRes = await sendQuotationEmailWithResult(
    q.klient_email,
    `Oferta ARBOR #${quotationId}`,
    `${msg}\n\nPDF w załączniku.`,
    pdfAbs
  );
  const email = {
    status: emailRes.status,
    error: emailRes.error,
    at: emailRes.at,
  };

  await persistOfferDelivery(pool, quotationId, sms, email);
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

  const q2 = (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  await deliverOfferSmsEmail(pool, quotationId, q2, pdfAbs);

  if (q.wyceniajacy_id) {
    await pool.query(
      `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
       VALUES (NULL, $1, NULL, $2, 'quotation_sent', $3, 'Nowe')`,
      [q.wyceniajacy_id, quotationId, `Wycena ${quotationId} wysłana do klienta (SMS/e-mail).`]
    );
  }
}

/**
 * Ponowna wysyłka SMS/e-mail z tym samym linkiem akceptacji (F1.11 retry).
 * Regeneruje PDF na dysku, jeśli brakuje pliku.
 */
async function resendQuotationClientOffer(pool, quotationId) {
  const q = (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  if (!q) {
    const err = new Error('Nie znaleziono wyceny.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (q.status !== 'Wyslana_Klientowi') {
    const err = new Error(
      'Ponowna wysyłka jest dostępna tylko dla ofert już wysłanych do klienta (status Wyslana_Klientowi).'
    );
    err.code = 'BAD_STATUS';
    throw err;
  }
  if (!q.client_acceptance_token) {
    const err = new Error('Brak tokenu akceptacji — nie można zbudować linku dla klienta.');
    err.code = 'NO_TOKEN';
    throw err;
  }

  let pdfUrl = q.pdf_url;
  const absPath = (rel) => path.join(process.cwd(), String(rel || '').replace(/^\//, ''));
  if (!pdfUrl || !fs.existsSync(absPath(pdfUrl))) {
    pdfUrl = await generateQuotationPdfToDisk(quotationId);
    await pool.query(`UPDATE quotations SET pdf_url = $1, updated_at = NOW() WHERE id = $2`, [pdfUrl, quotationId]);
  }

  const pdfAbs = absPath(pdfUrl);
  const qFresh = (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  await deliverOfferSmsEmail(pool, quotationId, qFresh, pdfAbs);
  return (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
}

module.exports = {
  afterQuotationFullyApproved,
  resendQuotationClientOffer,
  generateQuotationPdfToDisk,
  generateQuotationPdfBuffer,
  publicBase,
};
