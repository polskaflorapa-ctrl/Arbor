/**
 * Rozliczenie wyceniającego: stawka za dzień roboczy + procent od sumy zrealizowanych zleceń
 * (z wycen danego pracownika) + stałe dodatki miesięczne / inne.
 *
 * @param {object} p
 * @param {number} p.stawkaDziennaPln — np. 200 (za każdy przepracowany dzień roboczy)
 * @param {number} p.dniRobocze — np. 22
 * @param {number} p.procentOdRealizacji — np. 2 (= 2%)
 * @param {number} p.sumaZrealizowanychZlecenPln — suma wartości zleceń zrealizowanych wg wycen tej osoby
 * @param {number} [p.dodatkiStalePln] — stałe dopłaty (np. nadzór, sprzęt, auta)
 * @returns {{ czescDzienna: number, czescProcentowa: number, dodatki: number, razem: number }}
 */
export function computeEstimatorPayout(p) {
  const stawka = Number(p.stawkaDziennaPln) || 0;
  const dni = Number(p.dniRobocze) || 0;
  const proc = Number(p.procentOdRealizacji) || 0;
  const suma = Number(p.sumaZrealizowanychZlecenPln) || 0;
  const dod = Number(p.dodatkiStalePln) || 0;

  const czescDzienna = Math.round(stawka * dni * 100) / 100;
  const czescProcentowa = Math.round(suma * (proc / 100) * 100) / 100;
  const razem = Math.round((czescDzienna + czescProcentowa + dod) * 100) / 100;

  return {
    czescDzienna,
    czescProcentowa,
    dodatki: dod,
    razem,
  };
}
