function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => item.replace(/^"|"$/g, '').trim())
        .filter(Boolean);
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizedKey(value) {
  return String(value || '').trim().toLowerCase();
}

function competencyBlockPayload({ taskId, teamId, required, teamCompetencies, missing }) {
  return {
    error: `Ekipa nie ma wymaganych kompetencji: ${missing.join(', ')}.`,
    code: 'TEAM_COMPETENCY_MISSING',
    task_id: Number(taskId),
    team_id: Number(teamId),
    required_competencies: required,
    team_competencies: teamCompetencies,
    missing_competencies: missing,
  };
}

async function assertTeamCompetenciesForTask(db, { taskId, teamId, plannedDate }) {
  if (!taskId || !teamId) return { ok: true, required: [], teamCompetencies: [], missing: [] };
  const taskResult = await db.query(
    `SELECT COALESCE(wymagane_kompetencje, '{}'::text[]) AS wymagane_kompetencje
       FROM tasks
      WHERE id = $1
      LIMIT 1`,
    [taskId]
  );
  const required = normalizeList(taskResult.rows[0]?.wymagane_kompetencje);
  if (!required.length) return { ok: true, required, teamCompetencies: [], missing: [] };

  const day = String(plannedDate || new Date().toISOString()).slice(0, 10);
  const competencyResult = await db.query(
    `SELECT DISTINCT uc.nazwa
       FROM user_competencies uc
       JOIN team_members tm ON tm.user_id = uc.user_id
      WHERE tm.team_id = $1
        AND (uc.data_waznosci IS NULL OR uc.data_waznosci >= $2::date)`,
    [teamId, day]
  );
  const teamCompetencies = normalizeList(competencyResult.rows.map((row) => row.nazwa));
  const teamSet = new Set(teamCompetencies.map(normalizedKey));
  const missing = required.filter((item) => !teamSet.has(normalizedKey(item)));
  if (!missing.length) return { ok: true, required, teamCompetencies, missing: [] };
  return {
    ok: false,
    status: 409,
    required,
    teamCompetencies,
    missing,
    payload: competencyBlockPayload({ taskId, teamId, required, teamCompetencies, missing }),
  };
}

module.exports = {
  assertTeamCompetenciesForTask,
  competencyBlockPayload,
  normalizeList,
};
