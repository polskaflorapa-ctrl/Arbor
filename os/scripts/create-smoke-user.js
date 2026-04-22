const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const run = async () => {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'arbor_os',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  await client.connect();

  const login = 'smoke_admin';
  const password = 'Smoke123!';
  const hash = await bcrypt.hash(password, 12);

  const sql = `
    INSERT INTO users (login, haslo_hash, imie, nazwisko, rola, aktywny)
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (login)
    DO UPDATE SET
      haslo_hash = EXCLUDED.haslo_hash,
      rola = EXCLUDED.rola,
      aktywny = true
  `;

  await client.query(sql, [login, hash, 'Smoke', 'Admin', 'Administrator']);
  await client.end();

  console.log('smoke_admin user ready');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
