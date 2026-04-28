/**
 * Publiczne endpointy wyceny (akceptacja klienta — F1.12) bez JWT.
 */
const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { postKommoWebhook, kommoWebhookConfigured } = require('../services/kommo');

const router = express.Router();

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

router.get('/quotations/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, status, klient_nazwa, wartosc_zaproponowana, waznosc_do, pdf_url FROM quotations WHERE client_acceptance_token = $1`,
      [req.params.token]
    );
    const q = rows[0];
    if (!q) return res.status(404).type('html').send('<p>Nie znaleziono oferty.</p>');
    if (['Zaakceptowana', 'Odrzucona', 'Wygasla'].includes(q.status)) {
      return res.type('html').send(`<p>Oferta jest już w statusie: ${escapeHtml(q.status)}</p>`);
    }
    const kw = q.wartosc_zaproponowana != null ? Number(q.wartosc_zaproponowana).toFixed(2) : '—';
    const base = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const pdfHref =
      q.pdf_url && String(q.pdf_url).startsWith('http') ? q.pdf_url : q.pdf_url && base ? `${base}${q.pdf_url}` : '';
    const pdf = pdfHref ? `<p><a href="${escapeHtml(pdfHref)}">Pobierz PDF</a></p>` : '';
    res.type('html').send(`<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Oferta ARBOR</title></head><body style="font-family:system-ui;padding:24px;max-width:520px;margin:auto">
<h1>Oferta dla ${escapeHtml(q.klient_nazwa)}</h1>
<p>Kwota: <strong>${kw} PLN</strong></p>
${pdf}
<form method="post" action="/api/public/quotations/${encodeURIComponent(req.params.token)}/choice" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
  <input type="hidden" name="action" id="act" value="accept"/>
  <button type="submit" onclick="document.getElementById('act').value='accept'" style="padding:12px 20px;background:#166534;color:#fff;border:none;border-radius:8px;cursor:pointer">Akceptuję</button>
  <button type="submit" onclick="document.getElementById('act').value='reject'" style="padding:12px 20px;background:#991b1b;color:#fff;border:none;border-radius:8px;cursor:pointer">Odrzucam</button>
</form>
<p style="color:#666;font-size:14px;margin-top:32px">ARBOR — oferta z wyceny terenowej #${q.id}</p>
</body></html>`);
  } catch (e) {
    logger.error('quotation-public get', { message: e.message });
    res.status(500).send('Błąd');
  }
});

router.post('/quotations/:token/choice', express.urlencoded({ extended: true }), async (req, res) => {
  const action = String(req.body?.action || '').toLowerCase();
  const token = req.params.token;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM quotations WHERE client_acceptance_token = $1 FOR UPDATE`, [token]);
    const q = rows[0];
    if (!q) {
      await client.query('ROLLBACK');
      return res.status(404).send('Nie znaleziono');
    }
    if (q.status !== 'Wyslana_Klientowi') {
      await client.query('ROLLBACK');
      return res.status(400).send(`Nieprawidłowy status: ${q.status}`);
    }
    if (action === 'reject') {
      await client.query(`UPDATE quotations SET status = 'Odrzucona', updated_at = NOW() WHERE id = $1`, [q.id]);
      await client.query('COMMIT');
      return res.type('html').send('<p>Dziękujemy — oferta oznaczona jako odrzucona.</p>');
    }
    if (action !== 'accept') {
      await client.query('ROLLBACK');
      return res.status(400).send('Brak akcji');
    }

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().slice(0, 64);
    await client.query(
      `UPDATE quotations SET status = 'Zaakceptowana', klient_akceptacja_at = NOW(), klient_akceptacja_ip = $1, updated_at = NOW() WHERE id = $2`,
      [ip, q.id]
    );

    const plan = new Date();
    plan.setDate(plan.getDate() + 7);
    const opisLines = (
      await client.query(`SELECT gatunek, typ_pracy, wysokosc_pas FROM quotation_items WHERE quotation_id = $1 ORDER BY id`, [q.id])
    ).rows.map((it, i) => `${i + 1}. ${it.gatunek || ''} — ${it.typ_pracy || ''} (${it.wysokosc_pas || ''})`);
    const opis = [`Z wyceny terenowej #${q.id}`, ...opisLines].join('\n');

    const taskIns = await client.query(
      `INSERT INTO tasks (
        klient_nazwa, klient_telefon, adres, miasto,
        typ_uslugi, priorytet, wartosc_planowana,
        data_planowana,
        notatki_wewnetrzne, status,
        oddzial_id, wyceniajacy_id, pin_lat, pin_lng, opis, source_quotation_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Nowe',$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        q.klient_nazwa || 'Klient',
        q.klient_telefon || null,
        q.adres || '',
        q.miasto || '',
        'Wycinka z wyceny',
        q.priorytet || 'Normalny',
        q.wartosc_zaproponowana,
        plan.toISOString(),
        `E-akceptacja klienta. Wycena #${q.id}`,
        q.oddzial_id,
        q.wyceniajacy_id,
        q.lat,
        q.lng,
        opis,
        q.id,
      ]
    );
    const taskId = taskIns.rows[0].id;
    await client.query('COMMIT');

    if (kommoWebhookConfigured('crm')) {
      const taskRow = (await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId])).rows[0];
      try {
        const payload = {
          source: 'arbor-os',
          event: 'quotation.accepted',
          sent_at: new Date().toISOString(),
          quotation: { id: q.id },
          task: { id: taskId, status: taskRow.status },
        };
        await postKommoWebhook(payload, 'crm');
      } catch (e) {
        logger.warn('kommo quotation.accepted', { message: e.message });
      }
    }

    return res.type('html').send(
      `<p>Dziękujemy! Zlecenie <strong>#${taskId}</strong> zostało utworzone. Skontaktujemy się w sprawie terminu realizacji.</p>`
    );
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('quotation-public choice', { message: e.message });
    res.status(500).send('Błąd serwera');
  } finally {
    client.release();
  }
});

module.exports = router;
