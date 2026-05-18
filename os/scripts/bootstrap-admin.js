const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { getPgClientConfig } = require('./db-connection');

const ALLOWED_ROLES = new Set(['Prezes', 'Dyrektor', 'Administrator']);

function readEnv(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function fail(message) {
  console.error(`[bootstrap-admin] ${message}`);
  process.exit(1);
}

function buildConfig() {
  const login = readEnv('BOOTSTRAP_ADMIN_LOGIN');
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const role = readEnv('BOOTSTRAP_ADMIN_ROLE', 'Administrator');

  if (!login) fail('Missing BOOTSTRAP_ADMIN_LOGIN.');
  if (!password) fail('Missing BOOTSTRAP_ADMIN_PASSWORD.');
  if (password.length < 12) fail('BOOTSTRAP_ADMIN_PASSWORD must have at least 12 characters.');
  if (!ALLOWED_ROLES.has(role)) {
    fail(`BOOTSTRAP_ADMIN_ROLE must be one of: ${Array.from(ALLOWED_ROLES).join(', ')}.`);
  }

  return {
    login,
    password,
    role,
    firstName: readEnv('BOOTSTRAP_ADMIN_FIRST_NAME', 'Admin'),
    lastName: readEnv('BOOTSTRAP_ADMIN_LAST_NAME', 'ARBOR'),
    email: readEnv('BOOTSTRAP_ADMIN_EMAIL') || null,
    phone: readEnv('BOOTSTRAP_ADMIN_PHONE') || null,
    branchName: readEnv('BOOTSTRAP_ADMIN_BRANCH_NAME', 'Centrala'),
    branchCity: readEnv('BOOTSTRAP_ADMIN_BRANCH_CITY') || null,
  };
}

async function assertSchemaReady(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.users') AS users_table,
      to_regclass('public.branches') AS branches_table
  `);
  const row = result.rows[0] || {};
  if (!row.users_table || !row.branches_table) {
    throw new Error('Database schema is missing. Run: npm run db:migrate -w arbor-os');
  }
}

async function ensureBranchId(client, config) {
  const existing = await client.query(
    `SELECT id FROM branches WHERE LOWER(nazwa) = LOWER($1) ORDER BY id ASC LIMIT 1`,
    [config.branchName]
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE branches SET aktywny = true, updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO branches (nazwa, miasto, aktywny) VALUES ($1, $2, true) RETURNING id`,
    [config.branchName, config.branchCity]
  );
  return inserted.rows[0].id;
}

async function upsertAdmin(client, config, branchId) {
  const hash = await bcrypt.hash(config.password, 12);
  const existing = await client.query(`SELECT id FROM users WHERE login = $1`, [config.login]);

  if (existing.rows[0]) {
    const updated = await client.query(
      `UPDATE users
       SET haslo_hash = $1,
           imie = $2,
           nazwisko = $3,
           email = COALESCE($4, email),
           telefon = COALESCE($5, telefon),
           rola = $6,
           oddzial_id = $7,
           aktywny = true,
           updated_at = NOW()
       WHERE login = $8
       RETURNING id`,
      [
        hash,
        config.firstName,
        config.lastName,
        config.email,
        config.phone,
        config.role,
        branchId,
        config.login,
      ]
    );
    return { id: updated.rows[0].id, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO users
      (login, haslo_hash, imie, nazwisko, email, telefon, rola, oddzial_id, aktywny)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id`,
    [
      config.login,
      hash,
      config.firstName,
      config.lastName,
      config.email,
      config.phone,
      config.role,
      branchId,
    ]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function run() {
  const config = buildConfig();
  const client = new Client(getPgClientConfig());
  let transactionOpen = false;

  try {
    await client.connect();
    await assertSchemaReady(client);

    await client.query('BEGIN');
    transactionOpen = true;

    const branchId = await ensureBranchId(client, config);
    const user = await upsertAdmin(client, config, branchId);

    await client.query('COMMIT');
    transactionOpen = false;

    const action = user.created ? 'created' : 'updated';
    console.log(
      `[bootstrap-admin] Admin ${action}: login=${config.login}, role=${config.role}, user_id=${user.id}, branch_id=${branchId}`
    );
    console.log('[bootstrap-admin] Password was not printed. Store it in your password manager.');
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error(`[bootstrap-admin] FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

run();
