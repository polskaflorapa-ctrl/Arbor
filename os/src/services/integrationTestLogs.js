async function ensureIntegrationTestLogsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_test_logs (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      integration_type VARCHAR(40) NOT NULL,
      action VARCHAR(80) NOT NULL,
      status VARCHAR(20) NOT NULL,
      provider VARCHAR(40),
      target VARCHAR(160),
      message TEXT,
      error TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_integration_test_logs_branch_created
    ON integration_test_logs (oddzial_id, created_at DESC)
  `);
}

async function recordIntegrationTestLog(pool, {
  oddzialId,
  integrationType,
  action,
  status,
  provider = null,
  target = null,
  message = null,
  error = null,
  metadata = {},
  createdBy = null,
}) {
  await ensureIntegrationTestLogsTable(pool);
  const { rows } = await pool.query(
    `INSERT INTO integration_test_logs (
       oddzial_id, integration_type, action, status, provider, target, message, error, metadata, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     RETURNING *`,
    [
      oddzialId || null,
      integrationType,
      action,
      status,
      provider,
      target,
      message,
      error,
      JSON.stringify(metadata || {}),
      createdBy || null,
    ],
  );
  return rows[0] || null;
}

async function listIntegrationTestLogs(pool, { oddzialId = null, limit = 20 } = {}) {
  await ensureIntegrationTestLogsTable(pool);
  const params = [];
  const where = oddzialId ? `WHERE l.oddzial_id = $${params.push(oddzialId)}` : '';
  params.push(Math.max(1, Math.min(Number(limit) || 20, 100)));
  const { rows } = await pool.query(
    `SELECT l.*, b.nazwa AS oddzial_nazwa, u.imie AS user_imie, u.nazwisko AS user_nazwisko
     FROM integration_test_logs l
     LEFT JOIN branches b ON b.id = l.oddzial_id
     LEFT JOIN users u ON u.id = l.created_by
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

module.exports = {
  ensureIntegrationTestLogsTable,
  recordIntegrationTestLog,
  listIntegrationTestLogs,
};
