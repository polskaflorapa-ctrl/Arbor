const logger = require('../config/logger');
const { applyAutoFlags } = require('./quotationItemFlags');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchNorm(pool, gatunek, wysokoscPas, typPracy) {
  const g = String(gatunek || 'inne').toLowerCase();
  const w = String(wysokoscPas || '').trim();
  const t = String(typPracy || '').toLowerCase().trim();
  const r = await pool.query(
    `SELECT * FROM quotation_service_norms
     WHERE lower(gatunek_key) = lower($1) AND wysokosc_pas = $2 AND lower(typ_pracy_key) = lower($3)
       AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
     LIMIT 1`,
    [g, w, t]
  );
  if (r.rows[0]) return r.rows[0];
  const r2 = await pool.query(
    `SELECT * FROM quotation_service_norms
     WHERE lower(gatunek_key) = 'inne'
       AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
     ORDER BY czas_min_bazowy DESC LIMIT 1`
  );
  return r2.rows[0] || { czas_min_bazowy: 90, sprzet_hint: 'Standard', motogodziny: 0.25 };
}

/**
 * Przelicza koszt własny, sugerowaną cenę, marżę % i pola pozycji (czas, sprzęt).
 */
async function recalculateQuotation(pool, quotationId) {
  const qRes = await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId]);
  const q = qRes.rows[0];
  if (!q) return null;
  const bRes = await pool.query(`SELECT * FROM branches WHERE id = $1`, [q.oddzial_id]);
  const b = bRes.rows[0] || {};
  const stawkaRob = toNum(b.stawka_roboczogodzina_pln ?? 85);
  const stawkaMoto = toNum(b.stawka_motogodzina_pln ?? 120);
  const stawkaKm = toNum(b.stawka_dojazd_km_pln ?? 3.5);
  const utylM3 = toNum(b.utylizacja_m3_pln ?? 80);
  const marzaDom = toNum(b.marza_domyslna_pct ?? 35);

  const itemsRes = await pool.query(
    `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY kolejnosc, id`,
    [quotationId]
  );
  const items = itemsRes.rows;
  const crew = 2;
  let totalMin = 0;
  let totalMoto = 0;
  let utylUnits = items.length * 0.5;

  for (const it of items) {
    const flags = applyAutoFlags(it);
    const norm = await fetchNorm(pool, it.gatunek, it.wysokosc_pas, it.typ_pracy);
    const czas = Number(norm.czas_min_bazowy || 60);
    const moto = Number(norm.motogodziny ?? 0.25);
    totalMin += czas;
    totalMoto += moto;
    await pool.query(
      `UPDATE quotation_items SET
        czas_planowany_min = $1,
        wymagany_sprzet = COALESCE($2, wymagany_sprzet),
        przeszkody = $3::jsonb,
        wymagane_uprawnienia = $4::jsonb
       WHERE id = $5`,
      [czas, norm.sprzet_hint || null, JSON.stringify(flags.przeszkody), JSON.stringify(flags.wymagane_uprawnienia), it.id]
    );
  }

  const dojazdKm = 25;
  const laborCost = (totalMin / 60) * crew * stawkaRob;
  const motoCost = totalMoto * stawkaMoto;
  const dojazdCost = dojazdKm * stawkaKm;
  const utylCost = utylUnits * utylM3;
  const koszt = laborCost + motoCost + dojazdCost + utylCost;
  const sugerowana = koszt * (1 + marzaDom / 100);
  const marzaPct = sugerowana > 0 ? ((sugerowana - koszt) / sugerowana) * 100 : marzaDom;

  await pool.query(
    `UPDATE quotations SET
      koszt_wlasny_calkowity = $1,
      wartosc_sugerowana = $2,
      marza_pct = $3,
      updated_at = NOW()
     WHERE id = $4`,
    [koszt, sugerowana, marzaPct, quotationId]
  );

  const perItem = items.length ? koszt / items.length : koszt;
  const cenaPer = items.length ? sugerowana / items.length : sugerowana;
  for (const it of items) {
    await pool.query(`UPDATE quotation_items SET koszt_wlasny = $1, cena_pozycji = $2 WHERE id = $3`, [
      perItem,
      cenaPer,
      it.id,
    ]);
  }

  const out = await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId]);
  logger.info('quotationPricing.recalculate', { quotationId, koszt, sugerowana });
  return out.rows[0];
}

module.exports = { recalculateQuotation, fetchNorm };
