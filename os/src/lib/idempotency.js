/**
 * Idempotencja HTTP (nagłówek Idempotency-Key) — offline flush / retry bez podwójnego skutku.
 * Klucz zwykle = stabilne ID wpisu kolejki mobilnej (AsyncStorage).
 */

function getIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'] ?? req.headers['x-idempotency-key'];
  if (raw == null || String(raw).trim() === '') return '';
  return String(raw).trim().slice(0, 200);
}

/**
 * W ramach już rozpoczętej transakcji (BEGIN): rezerwuje klucz.
 * @returns {Promise<boolean>} true = powtórzone żądanie (klucz już zarejestrowany), false = pierwsze lub brak nagłówka — kontynuuj
 */
async function tryConsumeIdempotencyKey(client, req, scope) {
  const key = getIdempotencyKey(req);
  if (!key) return false;
  const r = await client.query(
    `INSERT INTO api_idempotency_log (idempotency_key, scope) VALUES ($1, $2)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [key, String(scope || 'unknown').slice(0, 160)]
  );
  return r.rows.length === 0;
}

module.exports = { getIdempotencyKey, tryConsumeIdempotencyKey };
