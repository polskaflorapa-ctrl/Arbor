/**
 * Wspólna konfiguracja pg dla skryptów CLI (jak src/config/database.js, bez Pool).
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

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
    database: process.env.DB_NAME || 'arbor_os',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

function resolvePostgresBinary(binaryName, overrideEnvVar) {
  const override = process.env[overrideEnvVar];
  if (override) return override;

  if (process.platform !== 'win32') return binaryName;

  const fileName = `${binaryName}.exe`;
  const roots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env['ProgramFiles(x86)'],
  ].filter(Boolean);

  for (const root of roots) {
    const pgRoot = path.join(root, 'PostgreSQL');
    if (!fs.existsSync(pgRoot)) continue;

    let entries;
    try {
      entries = fs.readdirSync(pgRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    const versions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    for (const version of versions) {
      const candidate = path.join(pgRoot, version, 'bin', fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return binaryName;
}

module.exports = { getPgClientConfig, resolvePostgresBinary };
