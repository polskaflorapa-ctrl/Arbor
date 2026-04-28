const { distanceMeters } = require('../utils/geo');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function countItemPhotos(pool, itemId) {
  const r = await pool.query(
    `SELECT photo_kind, COUNT(*)::int AS c FROM annotated_photos
     WHERE parent_object_type = 'quotation_item' AND parent_object_id = $1
     GROUP BY photo_kind`,
    [itemId]
  );
  const by = {};
  for (const row of r.rows) by[row.photo_kind] = row.c;
  return { total: Object.values(by).reduce((a, b) => a + b, 0), by };
}

/**
 * Walidacja przed zakończeniem wizyty (F1.7).
 */
async function validateQuotationCompleteForVisitEnd(pool, quotationId) {
  const errors = [];
  const q = (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  if (!q) return { ok: false, errors: ['Brak wyceny'] };

  if (!q.lat || !q.lng) errors.push('Brak zgeokodowanego adresu wyceny');

  const items = (await pool.query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY id`, [quotationId])).rows;
  if (!items.length) errors.push('Dodaj co najmniej jeden obiekt wyceny');

  for (const it of items) {
    if (!it.gatunek || !it.wysokosc_pas || !it.typ_pracy) {
      errors.push(`Obiekt #${it.id}: uzupełnij gatunek, wysokość i typ pracy`);
    }
    const { total, by } = await countItemPhotos(pool, it.id);
    const gen = by.general || 0;
    const ann = (by.annotated || 0);
    if (total < 2 || gen < 1 || ann < 1) {
      errors.push(`Obiekt #${it.id}: wymagane min. 2 zdjęcia (1 ogólne + 1 z adnotacjami)`);
    }
  }

  const koszt = toNum(q.koszt_wlasny_calkowity);
  const prop = toNum(q.wartosc_zaproponowana);
  if (prop == null) errors.push('Uzupełnij cenę oferowaną');
  if (koszt != null && prop != null && prop < koszt) errors.push('Cena oferowana nie może być niższa niż koszt własny');

  if (!q.waznosc_do) errors.push('Ustaw ważność oferty (waznosc_do)');

  const bRes = await pool.query(`SELECT * FROM branches WHERE id = $1`, [q.oddzial_id]);
  const b = bRes.rows[0] || {};
  const progKor = Number(b.marza_prog_korekty_pct ?? 30);
  const marza = toNum(q.marza_pct);
  if (marza != null && marza < progKor) {
    if (!String(q.korekta_uzasadnienie || '').trim() || !String(q.korekta_dropdown || '').trim()) {
      errors.push(`Przy marży < ${progKor}% wymagane są uzasadnienie korekty i powód (dropdown)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * F1.2 — odległość GPS od pinu wyceny (metry); zwraca ostrzeżenie jeśli > 100 m.
 */
function gpsCheckForVisitStart(row, lat, lng) {
  if (row.lat == null || row.lng == null) {
    return { ok: false, distanceM: null, needsOverride: false, message: 'Brak współrzędnych adresu wyceny' };
  }
  const d = distanceMeters(lat, lng, row.lat, row.lng);
  if (d == null) return { ok: false, distanceM: null, needsOverride: false, message: 'Błąd GPS' };
  if (d <= 100) return { ok: true, distanceM: d, needsOverride: false, message: null };
  return { ok: false, distanceM: d, needsOverride: true, message: `Jesteś ok. ${Math.round(d)} m od adresu klienta (> 100 m).` };
}

module.exports = { validateQuotationCompleteForVisitEnd, gpsCheckForVisitStart, countItemPhotos };
