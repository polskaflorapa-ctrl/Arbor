/**
 * F11.3 — wartość netto do rozliczeń z matrycy form płatności (M3 F3.9 + M11).
 */
const FORMY = ['Gotowka', 'Przelew', 'Faktura_VAT', 'Brak'];

/** F3.5/F3.6 — przy włączonym wymogu env minimum zdjęć na typ (finish). */
const FINISH_PHOTO_MIN = Object.freeze({ po: 2, przed: 2 });

/** F3.9 — jeśli gotówka różni się od wartości zlecenia o więcej niż ten %, wymagana notatka. */
const CASH_COLLECTION_NOTE_PCT = 5;

/**
 * @param {{ query: Function }} db Pool lub PoolClient
 * @param {number} taskId
 * @returns {Promise<{ po: number, przed: number }>}
 */
async function countTaskFinishPhotos(db, taskId) {
  const [poR, prR] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS c FROM photos
       WHERE task_id = $1 AND LOWER(TRIM(COALESCE(typ, ''))) IN ('po', 'after')`,
      [taskId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS c FROM photos
       WHERE task_id = $1 AND LOWER(TRIM(COALESCE(typ, ''))) IN ('przed', 'before', 'checkin')`,
      [taskId]
    ),
  ]);
  return {
    po: Number(poR.rows[0]?.c) || 0,
    przed: Number(prR.rows[0]?.c) || 0,
  };
}

/**
 * F3.9 — brak notatki przy dużej różnicy kwoty gotówki vs wartość rozliczenia zlecenia.
 * @param {object|null} payment
 * @param {number} grossVal wartość z `grossForTask`
 * @param {string|null|undefined} notatkiZBody pole `notatki` z body finish (alternatywa dla payment.notatki)
 * @returns {boolean} true gdy finish ma zostać odrzucony (brak notatki przy różnicy > CASH_COLLECTION_NOTE_PCT)
 */
function isCashCollectionNoteMissing(payment, grossVal, notatkiZBody) {
  if (!payment || payment.forma_platnosc !== 'Gotowka') return false;
  const collected = Number(payment.kwota_odebrana);
  const gross = Number(grossVal);
  if (!Number.isFinite(collected) || collected <= 0 || !Number.isFinite(gross) || gross <= 0) return false;
  const diffPct = (Math.abs(collected - gross) / gross) * 100;
  if (diffPct <= CASH_COLLECTION_NOTE_PCT) return false;
  const note = String(payment.notatki || notatkiZBody || '').trim();
  return !note;
}

function grossForTask(task, payment) {
  const wr = Number(task.wartosc_rzeczywista);
  const wp = Number(task.wartosc_planowana);
  const cash = payment && payment.kwota_odebrana != null ? Number(payment.kwota_odebrana) : null;
  if (Number.isFinite(wr) && wr > 0) return wr;
  if (Number.isFinite(wp) && wp > 0) return wp;
  if (payment?.forma_platnosc === 'Gotowka' && Number.isFinite(cash) && cash > 0) return cash;
  return 0;
}

/**
 * @param {string} forma Gotowka | Przelew | Faktura_VAT | Brak
 * @param {number} gross
 * @param {{ cardCommissionPct?: number }} [opts]
 */
function netSettlementValue(forma, gross, opts = {}) {
  const g = Number(gross) || 0;
  const cardPct = Number(opts.cardCommissionPct);
  const cardMul = Number.isFinite(cardPct) && cardPct >= 0 ? 1 - cardPct / 100 : 1;
  switch (forma) {
    case 'Faktura_VAT':
      return Math.round(g * (1 - 0.08) * 100) / 100;
    case 'Gotowka':
      return Math.round(g * 100) / 100;
    case 'Przelew':
      return Math.round(g * cardMul * 100) / 100;
    case 'Brak':
      return 0;
    default:
      return Math.round(g * 100) / 100;
  }
}

/**
 * Snapshot dla audytu F11.3 / `task_calc_log` (matryca odliczeń).
 * @param {{ task: object, payment?: object|null, gross: number, net: number, cardCommissionPct: number, teamScoped: boolean }} p
 */
function settlementCalcDetail({ task, payment, gross, net, cardCommissionPct, teamScoped }) {
  const pct = Number(cardCommissionPct);
  const cardMul =
    teamScoped && payment?.forma_platnosc === 'Przelew' && Number.isFinite(pct) && pct >= 0
      ? Math.round((1 - pct / 100) * 10000) / 10000
      : null;
  return {
    v: 1,
    team_scoped: teamScoped,
    task_snapshot: {
      wartosc_planowana: task.wartosc_planowana,
      wartosc_rzeczywista: task.wartosc_rzeczywista,
    },
    payment_snapshot: payment
      ? {
          forma_platnosc: payment.forma_platnosc,
          kwota_odebrana: payment.kwota_odebrana ?? null,
          faktura_vat: !!payment.faktura_vat,
        }
      : null,
    gross,
    net,
    rules_applied: {
      faktura_vat_deduction_pct: 8,
      przelew_card_multiplier: cardMul,
      card_commission_pct_config: Number.isFinite(pct) ? pct : null,
    },
  };
}

function validateClientPayment(payment, { requireAll }) {
  const err = [];
  if (!payment || typeof payment !== 'object') {
    if (requireAll) err.push('Brak danych płatności (F3.9)');
    return err;
  }
  const forma = payment.forma_platnosc;
  if (!FORMY.includes(forma)) {
    err.push(`Nieprawidłowa forma płatności (dozwolone: ${FORMY.join(', ')})`);
  }
  const faktura = !!payment.faktura_vat;
  const nip = String(payment.nip || '').replace(/\s/g, '');
  if (faktura || forma === 'Faktura_VAT') {
    if (nip.length < 10) err.push('Przy fakturze VAT wymagany jest poprawny NIP');
  }
  if (forma === 'Gotowka') {
    const k = Number(payment.kwota_odebrana);
    if (!Number.isFinite(k) || k < 0) err.push('Dla gotówki podaj kwotę odebraną');
  }
  return err;
}

module.exports = {
  FORMY,
  FINISH_PHOTO_MIN,
  CASH_COLLECTION_NOTE_PCT,
  grossForTask,
  netSettlementValue,
  validateClientPayment,
  settlementCalcDetail,
  countTaskFinishPhotos,
  isCashCollectionNoteMissing,
};
