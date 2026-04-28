/**
 * Auto-flagi uprawnień (F1.3) + heurystyka routingu (wysokość / linia / podnośnik).
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function mergeUnique(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const k = String(x || '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Uzupełnia wymagane_uprawnienia i przeszkody na podstawie pól obiektu. */
function applyAutoFlags(item) {
  const przeszkody = mergeUnique(item.przeszkody);
  const up = mergeUnique(item.wymagane_uprawnienia);
  const h = norm(item.wysokosc_pas);
  const typ = norm(item.typ_pracy);
  const war = norm(item.warunki_dojazdu);

  const highBand = h.includes('15') || h.includes('20') || norm(item.wysokosc_pas).includes('20+');
  if (highBand && (typ.includes('wycinka') || typ.includes('redukcja'))) {
    up.push('Praca wysokościowa alpinistyczna');
  }
  if (war.includes('podnosnik') || war.includes('podnośnik')) {
    const m = item.wymagany_sprzet && String(item.wymagany_sprzet).match(/(\d+)\s*m/i);
    const mNum = m ? Number(m[1]) : 20;
    if (mNum >= 20) up.push('Operator podnośnika 20 m');
  }
  for (const p of przeszkody) {
    const pn = norm(p);
    if (pn.includes('linia') || pn.includes(' nn') || pn.includes('energet')) {
      up.push('Blisko linii NN — uprawnienia E');
    }
  }
  if (typ.includes('frez')) {
    up.push('Obsługa frezarki do pni');
  }
  return { przeszkody, wymagane_uprawnienia: mergeUnique(up) };
}

function itemNeedsHeightSpecialist(it) {
  const p = norm(it.wysokosc_pas);
  const hi = p.includes('15-20') || p.includes('15–20') || p.includes('20+') || p.startsWith('20');
  const txt = JSON.stringify([it.wymagane_uprawnienia, it.typ_pracy, it.wymagany_sprzet]).toLowerCase();
  const lift20 =
    txt.includes('podnosnik') ||
    txt.includes('podnośnik') ||
    txt.includes('20 m') ||
    txt.includes('20m');
  const alpin = txt.includes('alpin');
  return hi || lift20 || alpin;
}

function itemNearEnergyLine(it) {
  const pr = Array.isArray(it.przeszkody) ? it.przeszkody : [];
  const up = Array.isArray(it.wymagane_uprawnienia) ? it.wymagane_uprawnienia : [];
  const blob = norm([...pr, ...up].join(' '));
  return blob.includes('linia') || blob.includes(' nn') || blob.includes('energet') || blob.includes('uprawnienia e');
}

module.exports = { applyAutoFlags, itemNeedsHeightSpecialist, itemNearEnergyLine, norm };
