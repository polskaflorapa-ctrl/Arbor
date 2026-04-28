/**
 * Święta ustawowo wolne od pracy (PL) — do naliczeń M11 / F11.2.
 * Wliczone: niedziele i święta ruchome (Wielkanoc, Poniedziałek wielkanocny, Zesłanie, Boże Ciało).
 * Uwaga: reguły rządowe mogą się zmieniać — w produkcji rozważ tabelę w DB lub import ICS.
 */

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toYmdLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Niedziela Wielkanocna (Meeus). */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const _cache = new Map();

/**
 * @param {string} ymd — `YYYY-MM-DD` (data raportu w kalendarzu PL)
 */
function isPlPublicHoliday(ymd) {
  if (!ymd || ymd.length < 10) return false;
  const y = Number(ymd.slice(0, 4));
  if (!Number.isFinite(y)) return false;
  let set = _cache.get(y);
  if (!set) {
    set = buildYearSet(y);
    _cache.set(y, set);
  }
  return set.has(ymd.slice(0, 10));
}

function buildYearSet(year) {
  const set = new Set();
  const add = (dt) => set.add(toYmdLocal(dt));

  add(new Date(year, 0, 1));
  add(new Date(year, 0, 6));
  add(new Date(year, 4, 1));
  add(new Date(year, 4, 3));
  add(new Date(year, 7, 15));
  add(new Date(year, 10, 1));
  add(new Date(year, 10, 11));
  add(new Date(year, 11, 25));
  add(new Date(year, 11, 26));

  const e = easterSunday(year);
  add(e);
  add(addDays(e, 1));
  const pentecost = addDays(e, 49);
  add(pentecost);
  const trinity = addDays(pentecost, 7);
  add(addDays(trinity, 4));

  return set;
}

module.exports = { isPlPublicHoliday, easterSunday, toYmdLocal };
