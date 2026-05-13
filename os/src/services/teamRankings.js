const PERIOD_LABELS = {
  week: 'Najlepsza ekipa tygodnia',
  month: 'Najlepsza ekipa miesiaca',
  half_year: 'Najlepsza ekipa polrocza',
  year: 'Najlepsza ekipa roku',
};

const isDyrektor = (user) => user?.rola === 'Dyrektor' || user?.rola === 'Administrator';

const tableExistsCache = new Map();
const columnExistsCache = new Map();

async function tableExists(pool, tableName) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [tableName]
  );
  const ok = Boolean(rows[0]?.ok);
  tableExistsCache.set(tableName, ok);
  return ok;
}

async function columnExists(pool, tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (columnExistsCache.has(key)) return columnExistsCache.get(key);
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS ok`,
    [tableName, columnName]
  );
  const ok = Boolean(rows[0]?.ok);
  columnExistsCache.set(key, ok);
  return ok;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function ymd(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeAnchor(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function periodRanges(asOfValue) {
  const asOf = normalizeAnchor(asOfValue);
  const today = startOfDay(asOf);
  const day = today.getDay();
  const mondayOffset = (day + 6) % 7;
  const weekStart = addDays(today, -mondayOffset);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const halfStart = new Date(today.getFullYear(), today.getMonth() < 6 ? 0 : 6, 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  return [
    { key: 'week', from: weekStart, to: addDays(weekStart, 7) },
    { key: 'month', from: monthStart, to: addMonths(monthStart, 1) },
    { key: 'half_year', from: halfStart, to: addMonths(halfStart, 6) },
    { key: 'year', from: yearStart, to: new Date(today.getFullYear() + 1, 0, 1) },
  ];
}

function scoreTeam(row) {
  const totalTasks = Number(row.total_tasks) || 0;
  const completedTasks = Number(row.completed_tasks) || 0;
  const revenue = Number(row.revenue) || 0;
  const plannedHours = Number(row.planned_hours) || 0;
  const loggedHours = Number(row.logged_hours) || 0;
  const hours = loggedHours > 0 ? loggedHours : plannedHours;
  const photos = Number(row.photos_count) || 0;
  const issues = Number(row.issues_count) || 0;
  const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const photoPerCompletedTask = completedTasks > 0 ? photos / completedTasks : 0;

  const score =
    completedTasks * 35 +
    completionRate * 30 +
    Math.min(revenue / 500, 100) +
    Math.min(hours * 2, 80) +
    Math.min(photoPerCompletedTask * 8, 30) -
    issues * 10;

  return Math.max(0, Math.round(score));
}

async function fetchPeriodRanking(pool, period, branchId) {
  const hasWorkLogs = await tableExists(pool, 'work_logs');
  const hasWorkLogMinutes = hasWorkLogs ? await columnExists(pool, 'work_logs', 'czas_pracy_minuty') : false;
  const hasWorkLogDuration = hasWorkLogs ? await columnExists(pool, 'work_logs', 'duration_hours') : false;
  const hasPhotos = await tableExists(pool, 'photos');
  const hasTaskPhotos = await tableExists(pool, 'task_photos');
  const hasIssues = await tableExists(pool, 'issues');
  const params = [period.from.toISOString(), period.to.toISOString()];
  let branchWhere = '';
  if (branchId) {
    params.push(branchId);
    branchWhere = `AND t.oddzial_id = $${params.length}`;
  }

  const workHoursExpression = [
    hasWorkLogMinutes ? 'COALESCE(wl.czas_pracy_minuty::numeric / 60.0, 0)' : null,
    hasWorkLogDuration ? 'COALESCE(wl.duration_hours::numeric, 0)' : null,
  ]
    .filter(Boolean)
    .join(' + ') || '0';

  const workCte = hasWorkLogs
    ? `work_by_team AS (
        SELECT s.ekipa_id,
          COALESCE(SUM(${workHoursExpression}), 0) AS logged_hours
        FROM scoped s
        LEFT JOIN work_logs wl ON wl.task_id = s.id
        GROUP BY s.ekipa_id
      )`
    : `work_by_team AS (
        SELECT NULL::integer AS ekipa_id, 0::numeric AS logged_hours WHERE false
      )`;

  const photoSources = [];
  if (hasPhotos) photoSources.push('SELECT task_id FROM photos WHERE task_id IS NOT NULL');
  if (hasTaskPhotos) photoSources.push('SELECT task_id FROM task_photos WHERE task_id IS NOT NULL');
  const photosCte = photoSources.length
    ? `photos_by_team AS (
        SELECT s.ekipa_id, COUNT(*)::int AS photos_count
        FROM (${photoSources.join(' UNION ALL ')}) p
        INNER JOIN scoped s ON s.id = p.task_id
        GROUP BY s.ekipa_id
      )`
    : `photos_by_team AS (
        SELECT NULL::integer AS ekipa_id, 0::int AS photos_count WHERE false
      )`;

  const issuesCte = hasIssues
    ? `issues_by_team AS (
        SELECT s.ekipa_id, COUNT(*)::int AS issues_count
        FROM issues i
        INNER JOIN scoped s ON s.id = i.task_id
        GROUP BY s.ekipa_id
      )`
    : `issues_by_team AS (
        SELECT NULL::integer AS ekipa_id, 0::int AS issues_count WHERE false
      )`;

  const sql = `
    WITH scoped AS (
      SELECT
        t.id,
        t.ekipa_id,
        t.oddzial_id,
        t.status,
        COALESCE(t.data_zakonczenia, t.data_planowana, t.created_at) AS activity_at,
        COALESCE(t.wartosc_rzeczywista, t.wartosc_planowana, 0)::numeric AS value_pln,
        COALESCE(t.czas_planowany_godziny, 0)::numeric AS planned_hours
      FROM tasks t
      WHERE t.ekipa_id IS NOT NULL
        AND COALESCE(t.data_zakonczenia, t.data_planowana, t.created_at) >= $1::timestamptz
        AND COALESCE(t.data_zakonczenia, t.data_planowana, t.created_at) < $2::timestamptz
        ${branchWhere}
    ),
    task_by_team AS (
      SELECT
        s.ekipa_id,
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(s.status, '')) IN ('zakonczone', 'zakończone', 'zakonczony', 'zakończony')
        )::int AS completed_tasks,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(s.status, '')) IN ('zakonczone', 'zakończone', 'zakonczony', 'zakończony')
            THEN s.value_pln
            ELSE 0
          END
        ), 0) AS revenue,
        COALESCE(SUM(s.planned_hours), 0) AS planned_hours
      FROM scoped s
      GROUP BY s.ekipa_id
    ),
    ${workCte},
    ${photosCte},
    ${issuesCte}
    SELECT
      te.id AS team_id,
      te.nazwa AS ekipa_nazwa,
      te.oddzial_id,
      b.nazwa AS oddzial_nazwa,
      u.imie || ' ' || u.nazwisko AS brygadzista_nazwa,
      COALESCE(tt.total_tasks, 0)::int AS total_tasks,
      COALESCE(tt.completed_tasks, 0)::int AS completed_tasks,
      COALESCE(tt.revenue, 0)::numeric AS revenue,
      COALESCE(tt.planned_hours, 0)::numeric AS planned_hours,
      COALESCE(w.logged_hours, 0)::numeric AS logged_hours,
      COALESCE(p.photos_count, 0)::int AS photos_count,
      COALESCE(i.issues_count, 0)::int AS issues_count
    FROM task_by_team tt
    INNER JOIN teams te ON te.id = tt.ekipa_id
    LEFT JOIN branches b ON b.id = te.oddzial_id
    LEFT JOIN users u ON u.id = te.brygadzista_id
    LEFT JOIN work_by_team w ON w.ekipa_id = te.id
    LEFT JOIN photos_by_team p ON p.ekipa_id = te.id
    LEFT JOIN issues_by_team i ON i.ekipa_id = te.id`;

  const { rows } = await pool.query(sql, params);
  const items = rows
    .map((row) => {
      const score = scoreTeam(row);
      const totalTasks = Number(row.total_tasks) || 0;
      const completedTasks = Number(row.completed_tasks) || 0;
      return {
        team_id: Number(row.team_id),
        ekipa_id: Number(row.team_id),
        ekipa_nazwa: row.ekipa_nazwa,
        oddzial_id: row.oddzial_id == null ? null : Number(row.oddzial_id),
        oddzial_nazwa: row.oddzial_nazwa || '',
        brygadzista_nazwa: row.brygadzista_nazwa || '',
        score,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        completion_rate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        revenue: Number(row.revenue) || 0,
        planned_hours: Number(row.planned_hours) || 0,
        logged_hours: Number(row.logged_hours) || 0,
        photos_count: Number(row.photos_count) || 0,
        issues_count: Number(row.issues_count) || 0,
      };
    })
    .sort((a, b) => b.score - a.score || b.completed_tasks - a.completed_tasks || b.revenue - a.revenue)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    key: period.key,
    label: PERIOD_LABELS[period.key],
    from: ymd(period.from),
    to: ymd(addDays(period.to, -1)),
    winner: items[0] || null,
    items,
  };
}

async function getTeamRankings(pool, user, options = {}) {
  const requestedBranchId = options.oddzial_id ? Number(options.oddzial_id) : null;
  const branchId = isDyrektor(user) ? requestedBranchId : Number(user?.oddzial_id || 0) || null;
  const ranges = periodRanges(options.as_of);
  const periodEntries = await Promise.all(ranges.map((period) => fetchPeriodRanking(pool, period, branchId)));
  const periods = Object.fromEntries(periodEntries.map((period) => [period.key, period]));
  return {
    generated_at: new Date().toISOString(),
    as_of: ymd(normalizeAnchor(options.as_of)),
    oddzial_id: branchId,
    periods,
  };
}

module.exports = {
  getTeamRankings,
  periodRanges,
  scoreTeam,
};
