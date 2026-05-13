/**
 * Lokalne blokady kalendarza — ten sam klucz i logika co `mobile/utils/calendar-blocks.ts`
 * (wspólne z mobile przy tej samej przeglądarce / tym samym localStorage).
 */
const KEY = 'calendar_blocks_v1';

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function loadCalendarBlocks() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveCalendarBlocks(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
  } catch {
    // ignore quota
  }
}

/**
 * @param {string} ymd RRRR-MM-DD
 * @param {Array<{ from: string, to: string }>} blocks
 */
export function isYmdBlocked(ymd, blocks) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const t = parseYmd(ymd);
  for (const b of blocks) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.from) || !/^\d{4}-\d{2}-\d{2}$/.test(b.to)) continue;
    const a = parseYmd(b.from);
    const z = parseYmd(b.to);
    if (t >= a && t <= z) return true;
  }
  return false;
}
