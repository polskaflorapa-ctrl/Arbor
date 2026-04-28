/**
 * Jednorazowe wykonanie os/migrate.sql (jak initDatabase w server.js, bez uruchamiania HTTP).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { getPgClientConfig } = require('./db-connection');

(async () => {
  const migratePath = path.join(__dirname, '..', 'migrate.sql');
  if (!fs.existsSync(migratePath)) {
    console.error('Brak pliku migrate.sql');
    process.exit(1);
  }
  const sql = fs.readFileSync(migratePath, 'utf8');
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  console.log('apply-migrate: migrate.sql wykonany.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
