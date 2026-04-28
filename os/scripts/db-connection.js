/**
 * Wspólna konfiguracja pg dla skryptów CLI (jak src/config/database.js, bez Pool).
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getPgClientConfig() {
  let connectionString = process.env.DATABASE_URL;
  const dbName = process.env.DB_NAME;
  if (connectionString && dbName) {
    try {
      const u = new URL(connectionString);
      u.pathname = `/${dbName}`;
      connectionString = u.toString();
    } catch {
      /* ignore */
    }
  }
  if (connectionString) {
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'arbor_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

module.exports = { getPgClientConfig };
