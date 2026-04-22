import type { EstimatorContractRule } from '../constants/wyceniajacy-umowy';
import { WYCENIAJACY_UMOWY } from '../constants/wyceniajacy-umowy';

export type EstimatorQuoteRow = {
  id: number | string;
  status?: string;
  klient_nazwa?: string;
  wyceniajacy_id?: number | string | null;
  autor_id?: number | string | null;
  user_id?: number | string | null;
  data_wykonania?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  kwota_realizacji?: number | string | null;
  wartosc_planowana?: number | string | null;
  wartosc_szacowana?: number | string | null;
};

export type CommissionLine = {
  wycenaId: number | string;
  client: string;
  status: string;
  basisPln: number;
  commissionPln: number;
};

export type EstimatorMonthResult = {
  contract: EstimatorContractRule | null;
  workingDays: number;
  baseFromDaysPln: number;
  lines: CommissionLine[];
  totalRealizedBasisPln: number;
  variableFromPercentPln: number;
  addonsPln: number;
  totalPln: number;
};

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function quoteDateKey(w: EstimatorQuoteRow): string {
  const raw = w.data_wykonania || w.updated_at || w.created_at || '';
  return raw ? raw.slice(0, 7) : '';
}

function isEstimatorRow(w: EstimatorQuoteRow, userId: string): boolean {
  const uid = String(userId);
  if (w.wyceniajacy_id != null && String(w.wyceniajacy_id) === uid) return true;
  if (w.autor_id != null && String(w.autor_id) === uid) return true;
  if (w.user_id != null && String(w.user_id) === uid) return true;
  return false;
}

/** Czy wiersz wyceny jest przypisany do danego wyceniającego (wyceniajacy_id / autor_id / user_id). */
export function quoteBelongsToEstimator(
  w: EstimatorQuoteRow,
  userId: string | number | null | undefined,
): boolean {
  if (userId == null || userId === '') return false;
  return isEstimatorRow(w, String(userId));
}

/**
 * Dla roli Wyceniający zwraca tylko własne wyceny (nie trzymaj w stanie cudzych rekordów).
 * Dla pozostałych ról zwraca listę bez zmian.
 */
export function filterQuotesForEstimatorRole<T extends EstimatorQuoteRow>(
  quotes: T[],
  userId: string | number | null | undefined,
  role: string | null | undefined,
): T[] {
  if (role !== 'Wyceniający') return quotes;
  if (userId == null || userId === '') return [];
  const uid = String(userId);
  return quotes.filter((row) => isEstimatorRow(row, uid));
}

function realizationAmountPln(w: EstimatorQuoteRow): number {
  const k = num(w.kwota_realizacji);
  if (k > 0) return k;
  const p = num(w.wartosc_planowana);
  if (p > 0) return p;
  return num(w.wartosc_szacowana);
}

export function resolveEstimatorContract(
  oddzialId: string | number | null | undefined,
  userLogin: string | null | undefined,
): EstimatorContractRule | null {
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

  // Są umowy „na login”, ale żadna nie pasuje — nie wracaj do „pierwszej z listy”.
  if (withLogin.length > 0) return null;

  if (withoutLogin.length === 1) return withoutLogin[0];
  return withoutLogin[0] ?? null;
}

/**
 * Suma prowizji od wycen w danym miesiącu (YYYY-MM) + stawka dzienna + addony.
 * Wyceny filtrujemy po wyceniajacy_id / autor_id / user_id === userId.
 */
export function computeEstimatorMonth(
  contract: EstimatorContractRule | null,
  quotes: EstimatorQuoteRow[],
  userId: string,
  monthYyyyMm: string,
  workingDays: number,
): EstimatorMonthResult {
  const empty: EstimatorMonthResult = {
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

  const lines: CommissionLine[] = [];
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
