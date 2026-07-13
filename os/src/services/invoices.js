const { isDyrektor } = require('../middleware/auth');

// Two-int advisory-lock namespace: ASCII "ARBO". The second key is the invoice year.
const INVOICE_NUMBER_LOCK_NAMESPACE = 0x4152424f;

function invoiceYearFromDate(value) {
  const explicitYear = String(value || '').match(/^(\d{4})-/)?.[1];
  if (explicitYear) return Number(explicitYear);

  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.getFullYear() : new Date().getFullYear();
}

/**
 * Allocates the next globally unique FV/YYYY/NNN number.
 *
 * The caller must pass the PoolClient used by an already-open transaction. The
 * transaction-scoped advisory lock serializes allocations for a given year.
 */
async function allocateInvoiceNumber(client, issueDate) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Invoice number allocation requires a transaction client');
  }

  const year = invoiceYearFromDate(issueDate);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
    INVOICE_NUMBER_LOCK_NAMESPACE,
    year,
  ]);

  const result = await client.query(
    `SELECT COALESCE(MAX(
       CASE
         WHEN numer ~ ('^FV/' || $1::text || '/[0-9]+$')
           THEN split_part(numer, '/', 3)::integer
         ELSE NULL
       END
     ), 0)::integer AS last_number
     FROM invoices
     WHERE numer LIKE ('FV/' || $1::text || '/%')`,
    [year]
  );

  const lastNumber = Number(result.rows[0]?.last_number || 0);
  if (!Number.isSafeInteger(lastNumber) || lastNumber < 0) {
    throw new Error('Invalid invoice number sequence state');
  }

  return `FV/${year}/${String(lastNumber + 1).padStart(3, '0')}`;
}

function invoiceIdScope(user, alias = 'i', startParam = 1) {
  if (isDyrektor(user)) {
    return { clause: `${alias}.id=$${startParam}`, params: [] };
  }
  return {
    clause: `${alias}.id=$${startParam} AND ${alias}.oddzial_id=$${startParam + 1}`,
    params: [user?.oddzial_id ?? null],
  };
}

module.exports = {
  INVOICE_NUMBER_LOCK_NAMESPACE,
  allocateInvoiceNumber,
  invoiceIdScope,
  invoiceYearFromDate,
};
