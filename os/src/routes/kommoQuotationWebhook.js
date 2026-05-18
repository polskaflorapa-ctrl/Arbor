/**
 * F1.1 — webhook z Kommo (status „Do wyceny”): utworzenie rekordu quotations do przypisania.
 * Zabezpieczenie: nagłówek X-Arbor-Webhook-Secret lub body.secret === KOMMO_QUOTATION_WEBHOOK_SECRET
 */
const crypto = require('crypto');
const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { geocodeAddressPoland } = require('../services/geocodeNominatim');
const { distanceMeters } = require('../utils/geo');

const router = express.Router();

// Porównanie w stałym czasie — odporne na timing attacks.
// Wymaga równej długości buforów; przy różnej długości zwracamy false po wcześniejszym sprawdzeniu.
function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function checkSecret(req) {
  const expected = (process.env.KOMMO_QUOTATION_WEBHOOK_SECRET || '').trim();
  // FAIL-CLOSED: brak skonfigurowanego sekretu = odrzucamy. Inaczej publiczny INSERT.
  if (!expected) {
    logger.warn('kommoQuotationWebhook: KOMMO_QUOTATION_WEBHOOK_SECRET is not set — rejecting request');
    return false;
  }
  const h = (req.get('x-arbor-webhook-secret') || '').trim();
  const b = String((req.body && req.body.secret) || '').trim();
  return timingSafeEq(h, expected) || timingSafeEq(b, expected);
}

async function pickOddzialId(pool, lat, lng, requestedId) {
  if (requestedId) {
    const r = await pool.query(`SELECT id FROM branches WHERE id = $1 AND COALESCE(aktywny, true)`, [requestedId]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const { rows } = await pool.query(
    `SELECT id, lat, lng FROM branches WHERE COALESCE(aktywny, true) AND lat IS NOT NULL AND lng IS NOT NULL`
  );
  if (!rows.length) {
    const fb = await pool.query(`SELECT id FROM branches ORDER BY id LIMIT 1`);
    return fb.rows[0]?.id || 1;
  }
  if (lat == null || lng == null) return rows[0].id;
  let best = rows[0].id;
  let bestD = Infinity;
  for (const b of rows) {
    const d = distanceMeters(lat, lng, b.lat, b.lng);
    if (d != null && d < bestD) {
      bestD = d;
      best = b.id;
    }
  }
  return best;
}

router.post('/kommo/quotation-lead', express.json({ limit: '2mb' }), async (req, res) => {
  if (!checkSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const b = req.body || {};
  const klient_nazwa = String(b.klient_nazwa || b.name || b.title || '').trim() || null;
  const adres = String(b.adres || b.address || '').trim() || null;
  const miasto = String(b.miasto || b.city || '').trim() || null;
  const klient_telefon = String(b.telefon || b.phone || '').trim() || null;
  const klient_email = String(b.email || '').trim() || null;
  const kommo_sales_notes = String(b.opis || b.notes || '').trim() || null;
  const kommo_lead_external_id = String(b.kommo_lead_id || b.external_id || '').trim() || null;
  const wartosc_szacunkowa_lead = b.wartosc_szacunkowa != null ? Number(b.wartosc_szacunkowa) : null;
  const priorytet = String(b.priorytet || 'Normalny').trim() || 'Normalny';
  const oddzialReq = b.oddzial_id != null ? Number(b.oddzial_id) : null;

  let lat = b.lat != null ? Number(b.lat) : null;
  let lng = b.lng != null ? Number(b.lng) : null;
  let geocode_status = lat != null && lng != null ? 'provided' : 'pending';
  if (lat == null && adres) {
    const geo = await geocodeAddressPoland({ adres, miasto });
    if (geo.status === 'ok') {
      lat = geo.lat;
      lng = geo.lng;
      geocode_status = 'ok';
    } else {
      geocode_status = 'failed';
    }
  }

  try {
    const oddzial_id = await pickOddzialId(pool, lat, lng, oddzialReq);
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO quotations (
        crm_lead_id, kommo_lead_external_id, wyceniajacy_id, oddzial_id,
        klient_nazwa, klient_telefon, klient_email, adres, miasto, lat, lng,
        kommo_sales_notes, status, geocode_status, wartosc_szacunkowa_lead, priorytet,
        created_by, created_at, updated_at
      ) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OczekujePrzypisania',$12,$13,$14,NULL,$15,$15)
      RETURNING *`,
      [
        b.crm_lead_id ? Number(b.crm_lead_id) : null,
        kommo_lead_external_id,
        oddzial_id,
        klient_nazwa,
        klient_telefon,
        klient_email,
        adres,
        miasto,
        lat,
        lng,
        kommo_sales_notes,
        geocode_status,
        wartosc_szacunkowa_lead,
        priorytet,
        now,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('kommoQuotationWebhook', { message: e.message });
    res.status(500).json({ error: 'Nie udało się utworzyć wyceny z leada' });
  }
});

// ─── POST /api/webhooks/kommo/task-update ─────────────────────────────────────
// Inbound: Kommo → arbor-os  (bidirectional EPIC 8)
// Payload: { secret?, task_id, status?, ekipa_id?, data_planowana?, notatki? }
// This is called by a Kommo automation / Make.com scenario when a lead changes.

router.post('/kommo/task-update', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { task_id, status, ekipa_id, data_planowana, notatki } = req.body;
  if (!task_id) return res.status(400).json({ error: 'Wymagane pole: task_id' });

  const ALLOWED_STATUSES = ['Nowe','Zaplanowane','W_Realizacji','Zakonczone','Anulowane'];
  if (status && !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Niedozwolony status: ${status}` });
  }

  const sets = ['kommo_last_sync_at = NOW()', 'kommo_last_sync_status = $1'];
  const params = ['ok', task_id];
  if (status)         { params.splice(-1, 0, status);        sets.push(`status = $${params.length - 1}`); }
  if (ekipa_id)       { params.splice(-1, 0, ekipa_id);      sets.push(`ekipa_id = $${params.length - 1}`); }
  if (data_planowana) { params.splice(-1, 0, data_planowana);sets.push(`data_planowana = $${params.length - 1}`); }
  if (notatki)        { params.splice(-1, 0, notatki);       sets.push(`notatki_wewnetrzne = $${params.length - 1}`); }

  try {
    const r = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, status, ekipa_id`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Zlecenie nie istnieje' });

    logger.info('kommo.task-update applied', { task_id, status, ekipa_id });
    res.json({ ok: true, task: r.rows[0] });
  } catch (e) {
    logger.error('kommo.task-update error', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
