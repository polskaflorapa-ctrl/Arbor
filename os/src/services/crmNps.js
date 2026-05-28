const pool = require('../config/database');

let ensured = false;

async function ensureCrmNpsTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_nps_surveys (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES klienci(id) ON DELETE SET NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      channel VARCHAR(32) NOT NULL DEFAULT 'manual',
      score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
      comment TEXT,
      respondent_name VARCHAR(160),
      respondent_contact VARCHAR(160),
      sent_at TIMESTAMPTZ,
      responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_nps_surveys_oddzial ON crm_nps_surveys(oddzial_id, responded_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_crm_nps_surveys_lead ON crm_nps_surveys(lead_id)');
  ensured = true;
}

function normalizeChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return ['manual', 'sms', 'email', 'whatsapp', 'phone', 'webchat', 'other'].includes(channel) ? channel : 'manual';
}

function mapSurvey(row) {
  return {
    ...row,
    score: Number(row.score),
    nps_group: Number(row.score) >= 9 ? 'promoter' : Number(row.score) >= 7 ? 'passive' : 'detractor',
  };
}

async function createNpsSurvey({ oddzialId, leadId, clientId, taskId, channel, score, comment, respondentName, respondentContact, sentAt, userId }) {
  await ensureCrmNpsTable();
  const { rows } = await pool.query(
    `INSERT INTO crm_nps_surveys (
      oddzial_id, lead_id, client_id, task_id, channel, score, comment,
      respondent_name, respondent_contact, sent_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      oddzialId || null,
      leadId || null,
      clientId || null,
      taskId || null,
      normalizeChannel(channel),
      score,
      String(comment || '').trim() || null,
      String(respondentName || '').trim() || null,
      String(respondentContact || '').trim() || null,
      sentAt || null,
      userId || null,
    ]
  );
  return mapSurvey(rows[0]);
}

async function listNpsSurveys({ oddzialId, leadId, clientId, taskId, limit = 50 }) {
  await ensureCrmNpsTable();
  const params = [];
  let where = 'WHERE 1=1';
  if (oddzialId) {
    params.push(oddzialId);
    where += ` AND s.oddzial_id = $${params.length}`;
  }
  if (leadId) {
    params.push(leadId);
    where += ` AND s.lead_id = $${params.length}`;
  }
  if (clientId) {
    params.push(clientId);
    where += ` AND s.client_id = $${params.length}`;
  }
  if (taskId) {
    params.push(taskId);
    where += ` AND s.task_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const { rows } = await pool.query(
    `SELECT s.*, l.title AS lead_title,
      COALESCE(NULLIF(TRIM(k.firma), ''), NULLIF(TRIM(CONCAT(k.imie, ' ', k.nazwisko)), '')) AS client_name
     FROM crm_nps_surveys s
     LEFT JOIN crm_leads l ON l.id = s.lead_id
     LEFT JOIN klienci k ON k.id = s.client_id
     ${where}
     ORDER BY s.responded_at DESC, s.id DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapSurvey);
}

async function getNpsSummary({ oddzialId, since }) {
  await ensureCrmNpsTable();
  const params = [];
  let where = 'WHERE 1=1';
  if (oddzialId) {
    params.push(oddzialId);
    where += ` AND oddzial_id = $${params.length}`;
  }
  if (since) {
    params.push(since);
    where += ` AND responded_at >= $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS responses,
       COALESCE(ROUND(AVG(score)::numeric, 1), 0)::float AS avg_score,
       COUNT(*) FILTER (WHERE score >= 9)::int AS promoters,
       COUNT(*) FILTER (WHERE score BETWEEN 7 AND 8)::int AS passives,
       COUNT(*) FILTER (WHERE score <= 6)::int AS detractors
     FROM crm_nps_surveys
     ${where}`,
    params
  );
  const row = rows[0] || {};
  const responses = Number(row.responses || 0);
  const promoters = Number(row.promoters || 0);
  const detractors = Number(row.detractors || 0);
  return {
    responses,
    avg_score: Number(row.avg_score || 0),
    promoters,
    passives: Number(row.passives || 0),
    detractors,
    score: responses > 0 ? Math.round(((promoters - detractors) / responses) * 100) : 0,
  };
}

module.exports = {
  createNpsSurvey,
  ensureCrmNpsTable,
  getNpsSummary,
  listNpsSurveys,
};
