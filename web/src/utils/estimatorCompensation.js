/**
 * Kalkulacja wynagrodzenia wyceniającego na podstawie umowy i wycen miesiąca.
 * Port z mobile/utils/estimator-compensation.ts (bez typów TypeScript).
 */

import { WYCENIAJACY_UMOWY } from '../constants/wyceniajacyUmowy';

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function quoteDateKey(w) {
  const raw = w.data_wykonania || w.updated_at || w.created_at || '';
  return raw ? raw.slice(0, 7) : '';
}

function isEstimatorRow(w, userId) {
  const uid = String(userId);
  if (w.wyceniajacy_id != null && String(w.wyceniajacy_id) === uid) return true;
  if (w.autor_id != null && String(w.autor_id) === uid) return true;
  if (w.user_id != null && String(w.user_id) === uid) return true;
  return false;
}

/** Czy wiersz wyceny jest przypisany do danego wyceniającego. */
export function quoteBelongsToEstimator(w, userId) {
  if (userId == null || userId === '') return false;
  return isEstimatorRow(w, String(userId));
}

/**
 * Dla roli Wyceniający zwraca tylko własne wyceny.
 * Dla pozostałych ról zwraca listę bez zmian.
 */
export function filterQuotesForEstimatorRole(quotes, userId, role) {
  if (role !== 'Wyceniający') return quotes;
  if (userId == null || userId === '') return [];
  const uid = String(userId);
  return quotes.filter((row) => isEstimatorRow(row, uid));
}

function realizationAmountPln(w) {
  const k = num(w.kwota_realizacji);
  if (k > 0) return k;
  const p = num(w.wartosc_planowana);
  if (p > 0) return p;
  return num(w.wartosc_szacowana);
}

/**
 * Rozwiązuje umowę wyceniającego na podstawie oddziału i loginu.
 * @param {string|number|null|undefined} oddzialId
 * @param {string|null|undefined} userLogin
 * @returns {object|null}
 */
export function resolveEstimatorContract(oddzialId, userLogin) {
  const oid = oddzialId != null && oddzialId !== '' ? String(oddzialId) : '';
  const login = (userLogin || '').toLowerCase();
  const candidates = WYCENIAJACY_UMOWY.filter((r) => r.oddzialId === oid);
  if (candidates.length === 0) return null;

  const withLogin = candidates.filter((r) => r.matchLoginIncludes);
  const withoutLogin = candidates.filter((r) => !r.matchLoginIncludes);

  const matched = withLogin.filter((r) =>
    login.includes((r.matchLoginIncludes || '').toLowerCase()),
  );

  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    matched.sort((a, b) => {
      const la = a.matchLoginIncludes?.length ?? 0;
      const lb = b.matchLoginIncludes?.length ?? 0;
      if (lb !== la) return lb - la;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });
    return matched[0];
  }

  if (withLogin.length > 0) return null;
  if (withoutLogin.length === 1) return withoutLogin[0];
  return withoutLogin[0] ?? null;
}

/**
 * Suma prowizji od wycen w danym miesiącu (YYYY-MM) + stawka dzienna + addony.
 * @param {object|null} contract
 * @param {Array} quotes
 * @param {string} userId
 * @param {string} monthYyyyMm — np. "2025-05"
 * @param {number} workingDays
 * @returns {object}
 */
export function computeEstimatorMonth(contract, quotes, userId, monthYyyyMm, workingDays) {
  const empty = {
    contract,
    workingDays: Math.max(0, workingDays),
    baseFromDaysPln: 0,
    lines: [],
    totalRealizedBasisPln: 0,
    variableFromPercentPln: 0,
    addonsPln: 0,
    totalPln: 0,
  };
  if (!contract) return empty;

  const statuses = new Set(
    contract.quoteStatusesForCommission.map((s) => s.trim()).filter(Boolean),
  );
  const wd = Math.max(0, Math.floor(workingDays));
  const baseFromDays = wd * contract.dailyBasePln;

  const lines = [];
  let totalBasis = 0;
  let variable = 0;

  for (const w of quotes) {
    if (!quoteBelongsToEstimator(w, userId)) continue;
    if (quoteDateKey(w) !== monthYyyyMm) continue;
    const st = (w.status || '').trim();
    if (!statuses.has(st)) continue;
    const basis = realizationAmountPln(w);
    if (basis <= 0) continue;
    const comm = basis * contract.percentRealized;
    lines.push({
      wycenaId: w.id,
      client: (w.klient_nazwa || '').trim() || '—',
      status: st,
      basisPln: basis,
      commissionPln: comm,
    });
    totalBasis += basis;
    variable += comm;
  }

  const addonsPln = contract.addons.reduce((s, a) => s + (a.monthlyFixedPln ?? 0), 0);
  const totalPln = baseFromDays + variable + addonsPln;

  return {
    contract,
    workingDays: wd,
    baseFromDaysPln: baseFromDays,
    lines,
    totalRealizedBasisPln: totalBasis,
    variableFromPercentPln: variable,
    addonsPln,
    totalPln,
  };
}
