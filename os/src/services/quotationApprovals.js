const logger = require('../config/logger');
const { itemNeedsHeightSpecialist, itemNearEnergyLine } = require('./quotationItemFlags');

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dueAtForQuotation(q, branch) {
  const now = Date.now();
  const pilne = String(q.priorytet || '') === 'Wysoki' || q.klient_czeka_na_miejscu === true;
  const ms = pilne ? 30 * 60 * 1000 : 4 * 60 * 60 * 1000;
  return new Date(now + ms).toISOString();
}

/** Kto może rozstrzygnąć dany wiersz quotation_approvals (F1.9). */
function canUserDecideApproval(u, appr, quotationRow) {
  if (!u || !appr || !quotationRow) return false;
  if (isDyrektor(u)) return true;
  const typ = String(appr.wymagany_typ || '');
  if (typ === 'Kierownik') {
    return isKierownik(u) && Number(u.oddzial_id) === Number(quotationRow.oddzial_id);
  }
  if (typ === 'Dyrektor') {
    return isDyrektor(u);
  }
  if (typ === 'Arborysta' || typ === 'BHP' || typ === 'Prawne') {
    return u.rola === 'Specjalista' && Number(u.oddzial_id) === Number(quotationRow.oddzial_id);
  }
  return false;
}

/**
 * Matryca F1.8 — zbiór typów zatwierdzających (bez duplikatów).
 */
async function rebuildApprovals(client, quotationId) {
  await client.query('DELETE FROM quotation_approvals WHERE quotation_id = $1', [quotationId]);
  const q = (await client.query('SELECT * FROM quotations WHERE id = $1', [quotationId])).rows[0];
  if (!q) return;

  const sumRes = await client.query(
    `SELECT COALESCE(SUM(cena_pozycji),0)::numeric AS s FROM quotation_items WHERE quotation_id = $1`,
    [quotationId]
  );
  const sumValue = toNum(sumRes.rows[0]?.s || q.wartosc_zaproponowana);
  const koszt = toNum(q.koszt_wlasny_calkowity);
  const marza = Number.isFinite(Number(q.marza_pct)) ? toNum(q.marza_pct) : 35;

  const bRes = await client.query(`SELECT * FROM branches WHERE id = $1`, [q.oddzial_id]);
  const b = bRes.rows[0] || {};
  const progRent = toNum(b.marza_prog_rentowosci_pct ?? 15);
  const due = dueAtForQuotation(q, b);

  const items = (await client.query(`SELECT * FROM quotation_items WHERE quotation_id = $1`, [quotationId])).rows;
  let hasAlpLift = false;
  let hasNN = false;
  for (const it of items) {
    if (itemNeedsHeightSpecialist(it)) hasAlpLift = true;
    if (itemNearEnergyLine(it)) hasNN = true;
  }

  const std5000 =
    sumValue <= 5000 &&
    !hasAlpLift &&
    !hasNN &&
    !q.flag_pomnikowe &&
    !q.flag_reklamacja_vip &&
    marza >= progRent;

  const types = new Set();
  types.add('Kierownik');

  if (!std5000 || hasAlpLift) {
    if (hasAlpLift) types.add('Arborysta');
  }
  if (hasNN) types.add('BHP');
  if (sumValue > 15000 || q.flag_reklamacja_vip) types.add('Dyrektor');
  if (q.flag_pomnikowe) types.add('Prawne');
  if (marza < progRent) types.add('Dyrektor');

  for (const t of types) {
    await client.query(
      `INSERT INTO quotation_approvals (quotation_id, wymagany_typ, zatwierdzajacy_user_id, decyzja, due_at)
       VALUES ($1, $2, NULL, 'Pending', $3::timestamptz)`,
      [quotationId, t, due]
    );
  }
  logger.info('quotationApprovals.rebuild', { quotationId, types: [...types], sumValue });
}

async function notifyApproversForQuotation(pool, quotationId) {
  const q = (await pool.query(`SELECT * FROM quotations WHERE id = $1`, [quotationId])).rows[0];
  if (!q) return;
  const pending = (
    await pool.query(
      `SELECT DISTINCT wymagany_typ FROM quotation_approvals WHERE quotation_id = $1 AND decyzja = 'Pending'`,
      [quotationId]
    )
  ).rows.map((r) => r.wymagany_typ);

  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const link = baseUrl ? `${baseUrl}/wyceny-terenowe?id=${quotationId}` : `/wyceny-terenowe?id=${quotationId}`;
  const label = [q.klient_nazwa, q.adres].filter(Boolean).join(' — ');

  for (const typ of pending) {
    let users = { rows: [] };
    if (typ === 'Kierownik') {
      users = await pool.query(
        `SELECT id FROM users WHERE rola = 'Kierownik' AND oddzial_id = $1 AND aktywny IS NOT FALSE`,
        [q.oddzial_id]
      );
    } else if (typ === 'Dyrektor') {
      users = await pool.query(`SELECT id FROM users WHERE rola IN ('Dyrektor','Administrator') AND aktywny IS NOT FALSE`);
    } else if (typ === 'Arborysta' || typ === 'BHP' || typ === 'Prawne') {
      users = await pool.query(
        `SELECT id FROM users WHERE rola = 'Specjalista' AND oddzial_id = $1 AND aktywny IS NOT FALSE`,
        [q.oddzial_id]
      );
    }
    for (const row of users.rows) {
      const tresc = `Wycena #${quotationId} (${typ}): ${label}. ${link}`;
      await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
         VALUES (NULL, $1, NULL, $2, 'quotation_approval', $3, 'Nowe')`,
        [row.id, quotationId, tresc]
      );
    }
  }
}

module.exports = {
  rebuildApprovals,
  notifyApproversForQuotation,
  canUserDecideApproval,
  dueAtForQuotation,
};
