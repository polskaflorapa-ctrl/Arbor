/**
 * Teksty SMS z harmonogramem — przedział czasu z pola zlecenia (nie sztywne 8–16).
 */

function formatSmsPlanParts(z, fallbackDateStr = '-') {
  const fallback =
    fallbackDateStr != null && String(fallbackDateStr).trim() !== '' ? String(fallbackDateStr).trim() : '-';
  if (!z || z.data_planowana == null) {
    return { dateStr: fallback, windowStr: '8:00-16:00' };
  }
  const start = new Date(z.data_planowana);
  if (Number.isNaN(start.getTime())) {
    return { dateStr: fallback, windowStr: '8:00-16:00' };
  }
  const durMin = Math.max(15, Math.round(Number(z.czas_planowany_godziny || 2) * 60));
  const end = new Date(start.getTime() + durMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const windowStr = `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return {
    dateStr: start.toLocaleDateString('pl-PL'),
    windowStr,
  };
}

module.exports = { formatSmsPlanParts };
