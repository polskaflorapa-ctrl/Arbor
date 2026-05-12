/**
 * Mapuje wiersz z GET /api/sms/historia (ARBOR-OS: telefon, tresc, klient_nazwa)
 * na pola używane przez Telefonia.js (recipient_*, typ).
 */
export function normalizeSmsHistoryRow(row) {
  if (!row || typeof row !== 'object') return row;
  const fromOsApi =
    Object.prototype.hasOwnProperty.call(row, 'tresc') &&
    Object.prototype.hasOwnProperty.call(row, 'telefon');
  return {
    ...row,
    recipient_name: row.recipient_name ?? row.klient_nazwa ?? null,
    recipient_phone: row.recipient_phone ?? row.telefon ?? null,
    typ: row.typ ?? row.typ_uslugi ?? null,
    _fromOsApi: Boolean(fromOsApi),
  };
}
