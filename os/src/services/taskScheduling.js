/**
 * Wspólna logika harmonogramu: zajętość ekipy (zlecenia + rezerwacje wycen).
 * Używane przez wyceny (sloty / rezerwacja) oraz PATCH /tasks/:id/plan.
 */

const HOLD_TTL_HOURS = 8;

function parseClockToMinutes(value) {
  const [h, m] = String(value || '00:00').split(':');
  const hh = Number(h);
  const mm = Number(m);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function checkTeamConflict({ busyRanges, hour, durationMinutes }) {
  const start = parseClockToMinutes(hour);
  if (start == null) return { invalidTime: true, conflict: false };
  const end = start + durationMinutes;
  const conflict = busyRanges.some((r) => rangesOverlap(start, end, r.start, r.end));
  return { invalidTime: false, conflict };
}

/**
 * Przedziały czasu (minuty od północy) zajęte przez zlecenia i aktywne rezerwacje wycen.
 * @param {import('pg').Pool} pool
 * @param {number} teamId
 * @param {string} day — YYYY-MM-DD
 * @param {number|null} excludeWycenaId — wyklucz wycenę przy edycji
 * @param {number|null} excludeTaskId — wyklucz zlecenie przy przesuwaniu (PATCH plan)
 */
async function getTeamBusyRanges(pool, teamId, day, excludeWycenaId = null, excludeTaskId = null) {
  const taskRows = await pool.query(
    `SELECT data_planowana, godzina_rozpoczecia, COALESCE(czas_planowany_godziny, 2) AS czas_h
     FROM tasks
     WHERE ekipa_id = $1
       AND data_planowana::date = $2::date
       AND COALESCE(status::text, '') NOT IN ('Zakonczone', 'Anulowane')
       AND (COALESCE($3::int, -1) < 0 OR id <> $3::int)`,
    [teamId, day, excludeTaskId]
  );
  const wycenaRows = await pool.query(
    `SELECT COALESCE(proponowana_data, data_wykonania) AS day,
            COALESCE(proponowana_godzina, godzina_rozpoczecia) AS hour,
            COALESCE(czas_planowany_godziny, 2) AS czas_h
     FROM wyceny
     WHERE COALESCE(proponowana_ekipa_id, ekipa_id) = $1
       AND COALESCE(proponowana_data, data_wykonania) = $2::date
       AND (
         status_akceptacji IN ('do_specjalisty', 'zatwierdzono')
         OR (status_akceptacji = 'rezerwacja_wstepna' AND COALESCE(rezerwacja_wygasa_at, proponowana_at + INTERVAL '${HOLD_TTL_HOURS} hours') >= NOW())
       )
       AND ($3::int IS NULL OR id <> $3::int)`,
    [teamId, day, excludeWycenaId]
  );
  const ranges = [];
  for (const row of taskRows.rows) {
    const date = new Date(row.data_planowana);
    const explicitStart = row.godzina_rozpoczecia
      ? parseClockToMinutes(String(row.godzina_rozpoczecia).slice(0, 5))
      : null;
    const start = explicitStart != null ? explicitStart : date.getHours() * 60 + date.getMinutes();
    const end = start + Math.max(15, Math.round(Number(row.czas_h || 2) * 60));
    ranges.push({ start, end });
  }
  for (const row of wycenaRows.rows) {
    const start = parseClockToMinutes(row.hour ? String(row.hour).slice(0, 5) : '08:00');
    if (start == null) continue;
    const end = start + Math.max(15, Math.round(Number(row.czas_h || 2) * 60));
    ranges.push({ start, end });
  }
  return ranges;
}

/** Nakładanie się nowego slotu (minuty od północy) z listą zajętości. */
function planRangeConflicts(busyRanges, startMin, durationMinutes) {
  const endMin = startMin + durationMinutes;
  return busyRanges.some((r) => rangesOverlap(startMin, endMin, r.start, r.end));
}

module.exports = {
  HOLD_TTL_HOURS,
  parseClockToMinutes,
  rangesOverlap,
  checkTeamConflict,
  getTeamBusyRanges,
  planRangeConflicts,
};
