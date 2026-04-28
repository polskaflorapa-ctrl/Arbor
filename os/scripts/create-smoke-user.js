const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { getPgClientConfig } = require('./db-connection');

/** Pierwszy aktywny oddział lub nowy wiersz testowy. */
async function ensureBranchId(client) {
  const r = await client.query(
    `SELECT id FROM branches WHERE COALESCE(aktywny, true) = true ORDER BY id ASC LIMIT 1`
  );
  if (r.rows[0]) return r.rows[0].id;
  const ins = await client.query(`INSERT INTO branches (nazwa) VALUES ($1) RETURNING id`, ['Smoke oddział']);
  return ins.rows[0].id;
}

/**
 * Konto ekipy do smoke F0.3 (`SMOKE_TEAM_LOGIN` / `SMOKE_TEAM_PASSWORD`).
 * Hasło domyślnie jak smoke_admin (`Smoke123!`) lub `SMOKE_TEAM_PASSWORD_SEED`.
 */
async function ensureSmokeBrygadzista(client) {
  const login = 'smoke_brygadzista';
  const password = process.env.SMOKE_TEAM_PASSWORD_SEED || 'Smoke123!';
  const hash = await bcrypt.hash(password, 12);
  const branchId = await ensureBranchId(client);

  let userId;
  const existing = await client.query(`SELECT id, ekipa_id FROM users WHERE login = $1`, [login]);
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE users SET haslo_hash = $1, rola = 'Brygadzista', oddzial_id = $2, aktywny = true WHERE id = $3`,
      [hash, branchId, userId]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO users (login, haslo_hash, imie, nazwisko, rola, aktywny, oddzial_id)
       VALUES ($1, $2, $3, $4, 'Brygadzista', true, $5) RETURNING id`,
      [login, hash, 'Smoke', 'Brygadzista', branchId]
    );
    userId = ins.rows[0].id;
  }

  let ekipaId = (await client.query(`SELECT ekipa_id FROM users WHERE id = $1`, [userId])).rows[0]?.ekipa_id;
  if (!ekipaId) {
    const teamIns = await client.query(
      `INSERT INTO teams (nazwa, brygadzista_id, oddzial_id) VALUES ($1, $2, $3) RETURNING id`,
      ['Smoke ekipa', userId, branchId]
    );
    ekipaId = teamIns.rows[0].id;
    await client.query(`UPDATE users SET ekipa_id = $1 WHERE id = $2`, [ekipaId, userId]);
  } else {
    await client.query(
      `UPDATE teams SET brygadzista_id = $1, oddzial_id = $2 WHERE id = $3`,
      [userId, branchId, ekipaId]
    );
  }

  await client.query(
    `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT (team_id, user_id) DO NOTHING`,
    [ekipaId, userId]
  );

  console.log(`smoke_brygadzista user ready (team_id=${ekipaId}, login=${login}, password=${password})`);
}

const run = async () => {
  const client = new Client(getPgClientConfig());

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
  console.log('smoke_admin user ready');

  await ensureSmokeBrygadzista(client);

  await client.end();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
