/**
 * Prosty test połączenia z Postgres (bez Jesta).
 * Użycie: DATABASE_URL=postgres://... node scripts/integration-db-check.js
 */
require('dotenv').config();
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Brak DATABASE_URL');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  const r = await c.query('SELECT 1 AS ok');
  await c.end();
  if (r.rows[0]?.ok !== 1) throw new Error('Unexpected SELECT result');
  console.log('integration-db-check: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
