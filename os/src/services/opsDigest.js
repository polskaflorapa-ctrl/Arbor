const { sendSystemEmailOptional } = require('./systemEmail');
const { calculateTaskMargin, isLowMarginRisk, money } = require('./taskMargin');

const DIGEST_TYPE = 'operational_daily_digest';
const CENTRAL_ROLES = ['Prezes', 'Dyrektor', 'Administrator'];
const MANAGER_ROLE = 'Kierownik';
const OPS_ACTION_LABELS = {
  set_duration: 'Ustawienie czasu',
  mark_reason: 'Powod odchylenia',
  remind_team: 'Przypomnienie ekipy',
  recommendation_feedback: 'Feedback rekomendacji',
  risk_resend_sms: 'Ponowienie SMS ryzyka',
  risk_queue_call: 'Telefon Zadarma z ryzyka',
  risk_acknowledge: 'Potwierdzenie ryzyka',
  risk_reassign_team: 'Przepiecie ekipy z ryzyka',
  risk_replace_equipment: 'Przepiecie sprzetu z ryzyka',
};
const OWNER_ACK_RISK_TYPES = ['kommo_sync', 'sms_delivery'];
const OWNER_ACK_LABELS = {
  kommo_sync: 'Kommo',
  sms_delivery: 'SMS',
};
let digestRunsReady = false;
let digestSettingsReady = false;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toDateKey(value = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function branchPredicate(alias, branchId, params) {
  if (!branchId) return '';
  params.push(Number(branchId));
  return ` AND ${alias}.oddzial_id = $${params.length}`;
}

async function safeQuery(pool, label, sql, params, errors) {
  try {
    return await pool.query(sql, params);
  } catch (error) {
    errors.push({ label, message: error.message, code: error.code || null });
    return { rows: [], rowCount: 0 };
  }
}

function firstRow(result) {
  return result.rows?.[0] || {};
}

function count(row, key) {
  return Number(row?.[key] || 0);
}

function topTaskLabel(row) {
  const name = String(row.klient_nazwa || 'bez klienta').trim();
  return `#${row.id} ${name}`;
}

function addAlert(alerts, condition, alert) {
  if (!condition) return;
  alerts.push(alert);
}

function normalizeEmailList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n;]/);
  return [...new Set(raw
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item))
  )].slice(0, 30);
}

function normalizeUserIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n;]/);
  return [...new Set(raw
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
  )].slice(0, 80);
}

function digestScopeKey(branchId) {
  return branchId ? `branch:${Number(branchId)}` : 'global';
}

function defaultDigestSettings(branchId = null) {
  return {
    scope_key: digestScopeKey(branchId),
    scope: branchId ? 'branch' : 'global',
    branch_id: branchId ? Number(branchId) : null,
    enabled: true,
    send_time: '06:00',
    email_enabled: process.env.OPERATIONAL_DIGEST_EMAIL === '1',
    horizon_days: 3,
    fleet_lookahead_days: 14,
    recipient_user_ids: [],
    extra_emails: [],
  };
}

function normalizeDigestSettings(row, branchId = null) {
  const defaults = defaultDigestSettings(branchId);
  if (!row) return defaults;
  return {
    ...defaults,
    ...row,
    enabled: row.enabled !== false,
    email_enabled: row.email_enabled === true,
    horizon_days: clampInt(row.horizon_days, defaults.horizon_days, 1, 14),
    fleet_lookahead_days: clampInt(row.fleet_lookahead_days, defaults.fleet_lookahead_days, 1, 90),
    recipient_user_ids: normalizeUserIds(row.recipient_user_ids || []),
    extra_emails: normalizeEmailList(row.extra_emails || []),
  };
}

async function ensureDigestRunsTable(pool) {
  if (digestRunsReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operational_digest_runs (
      id SERIAL PRIMARY KEY,
      digest_date DATE NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      branch_id INTEGER NULL,
      trigger_type TEXT NULL,
      actor_id INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      high_alerts INTEGER NOT NULL DEFAULT 0,
      medium_alerts INTEGER NOT NULL DEFAULT 0,
      total_alerts INTEGER NOT NULL DEFAULT 0,
      recipients INTEGER NOT NULL DEFAULT 0,
      notifications_created INTEGER NOT NULL DEFAULT 0,
      emails_sent INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_operational_digest_runs_date ON operational_digest_runs(digest_date DESC, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_operational_digest_runs_branch ON operational_digest_runs(branch_id, digest_date DESC)');
  digestRunsReady = true;
}

async function ensureDigestSettingsTable(pool) {
  if (digestSettingsReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operational_digest_settings (
      id SERIAL PRIMARY KEY,
      scope_key TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL DEFAULT 'global',
      branch_id INTEGER NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      send_time TEXT NOT NULL DEFAULT '06:00',
      email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      horizon_days INTEGER NOT NULL DEFAULT 3,
      fleet_lookahead_days INTEGER NOT NULL DEFAULT 14,
      recipient_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      extra_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_by INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_operational_digest_settings_branch ON operational_digest_settings(branch_id)');
  digestSettingsReady = true;
}

async function buildOperationalDigest(pool, options = {}) {
  const date = toDateKey(options.date);
  const horizonDays = clampInt(options.horizonDays, 3, 1, 14);
  const fleetLookaheadDays = clampInt(options.fleetLookaheadDays, 14, 1, 90);
  const branchId = options.branchId ? Number(options.branchId) : null;
  const errors = [];

  const taskParams = [date, horizonDays];
  const taskBranch = branchPredicate('t', branchId, taskParams);
  const taskSummarySql = `
    SELECT
      COUNT(*) FILTER (
        WHERE t.data_planowana::date = $1::date AND t.status != 'Anulowane'
      )::int AS today_total,
      COUNT(*) FILTER (
        WHERE t.data_planowana::date >= $1::date
          AND t.data_planowana::date < ($1::date + $2::int)
          AND t.status != 'Anulowane'
      )::int AS horizon_total,
      COUNT(*) FILTER (
        WHERE t.status NOT IN ('Zakonczone','Anulowane') AND t.data_planowana < $1::date
      )::int AS overdue_total,
      COUNT(*) FILTER (
        WHERE t.status NOT IN ('Zakonczone','Anulowane','W_Realizacji')
          AND t.ekipa_id IS NULL
          AND t.data_planowana::date <= ($1::date + $2::int)
      )::int AS unassigned_total,
      COUNT(*) FILTER (
        WHERE t.status = 'W_Realizacji'
      )::int AS in_progress_total
    FROM tasks t
    WHERE t.data_planowana IS NOT NULL ${taskBranch}`;

  const overdueParams = [date];
  const overdueBranch = branchPredicate('t', branchId, overdueParams);
  const overdueSql = `
    SELECT t.id, t.klient_nazwa, t.status, t.data_planowana, t.oddzial_id
    FROM tasks t
    WHERE t.status NOT IN ('Zakonczone','Anulowane')
      AND t.data_planowana < $1::date
      ${overdueBranch}
    ORDER BY t.data_planowana ASC
    LIMIT 5`;

  const unassignedParams = [date, horizonDays];
  const unassignedBranch = branchPredicate('t', branchId, unassignedParams);
  const unassignedSql = `
    SELECT t.id, t.klient_nazwa, t.status, t.data_planowana, t.oddzial_id
    FROM tasks t
    WHERE t.status NOT IN ('Zakonczone','Anulowane','W_Realizacji')
      AND t.ekipa_id IS NULL
      AND t.data_planowana::date <= ($1::date + $2::int)
      ${unassignedBranch}
    ORDER BY t.data_planowana ASC NULLS LAST
    LIMIT 5`;

  const reportParams = [date];
  const reportBranch = branchPredicate('r', branchId, reportParams);
  const reportsSql = `
    SELECT
      COUNT(*)::int AS draft_total,
      COUNT(*) FILTER (WHERE r.data_raportu < $1::date)::int AS older_drafts
    FROM daily_reports r
    WHERE r.status = 'Roboczy'
      AND r.data_raportu >= $1::date - INTERVAL '7 days'
      ${reportBranch}`;

  const fleetParams = [date, fleetLookaheadDays];
  const fleetBranchVehicles = branchId ? ` AND oddzial_id = $3` : '';
  const fleetBranchEquipment = branchId ? ` AND oddzial_id = $3` : '';
  if (branchId) fleetParams.push(branchId);
  const fleetSql = `
    SELECT * FROM (
      SELECT 'vehicle' AS kind, id, nr_rejestracyjny AS label, 'przeglad' AS due_type,
             data_przegladu AS due_date, oddzial_id
      FROM vehicles
      WHERE data_przegladu IS NOT NULL
        AND data_przegladu >= $1::date
        AND data_przegladu <= $1::date + $2::int
        AND COALESCE(status, '') NOT IN ('Wycofany','Sprzedany','Anulowane')
        ${fleetBranchVehicles}
      UNION ALL
      SELECT 'vehicle' AS kind, id, nr_rejestracyjny AS label, 'ubezpieczenie' AS due_type,
             data_ubezpieczenia AS due_date, oddzial_id
      FROM vehicles
      WHERE data_ubezpieczenia IS NOT NULL
        AND data_ubezpieczenia >= $1::date
        AND data_ubezpieczenia <= $1::date + $2::int
        AND COALESCE(status, '') NOT IN ('Wycofany','Sprzedany','Anulowane')
        ${fleetBranchVehicles}
      UNION ALL
      SELECT 'equipment' AS kind, id, nazwa AS label, 'przeglad' AS due_type,
             data_przegladu AS due_date, oddzial_id
      FROM equipment_items
      WHERE data_przegladu IS NOT NULL
        AND data_przegladu >= $1::date
        AND data_przegladu <= $1::date + $2::int
        AND COALESCE(status, '') NOT IN ('Wycofany','Anulowane')
        ${fleetBranchEquipment}
    ) due
    ORDER BY due_date ASC, label ASC
    LIMIT 12`;

  const conflictParams = [date, fleetLookaheadDays];
  const conflictBranch = branchPredicate('r1', branchId, conflictParams);
  const reservationConflictSql = `
    SELECT r1.sprzet_id, COALESCE(e.nazwa, 'sprzet #' || r1.sprzet_id) AS sprzet_nazwa,
           COUNT(*)::int AS conflict_pairs, MIN(r1.data_od) AS first_date
    FROM equipment_reservations r1
    JOIN equipment_reservations r2
      ON r1.sprzet_id = r2.sprzet_id
     AND r1.id < r2.id
     AND r1.status != 'Anulowane'
     AND r1.status NOT ILIKE 'Zwr%'
     AND r2.status != 'Anulowane'
     AND r2.status NOT ILIKE 'Zwr%'
     AND NOT (r1.data_do < r2.data_od OR r1.data_od > r2.data_do)
    LEFT JOIN equipment_items e ON e.id = r1.sprzet_id
    WHERE r1.data_od <= $1::date + $2::int
      AND r1.data_do >= $1::date
      ${conflictBranch}
    GROUP BY r1.sprzet_id, e.nazwa
    ORDER BY conflict_pairs DESC, first_date ASC
    LIMIT 8`;

  const marginParams = [date];
  const marginBranch = branchPredicate('t', branchId, marginParams);
  const marginSql = `
    WITH settled AS (
      SELECT t.id, t.klient_nazwa, t.oddzial_id,
             COALESCE(t.wartosc_rzeczywista, t.wartosc_planowana, tr.wartosc_brutto, 0)::numeric AS revenue,
             COALESCE(b.marza_prog_rentowosci_pct, 15)::numeric AS threshold_pct,
             (
               COALESCE(tr.koszt_pomocnikow, 0) +
               COALESCE(tr.wynagrodzenie_brygadzisty, 0) +
               COALESCE(op.koszt_operacyjny, 0) +
               COALESCE(mu.koszt_materialow, 0)
             )::numeric AS labor_cost
      FROM tasks t
      JOIN task_rozliczenie tr ON tr.task_id = t.id
      LEFT JOIN branches b ON b.id = t.oddzial_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0)::numeric AS koszt_operacyjny
        FROM task_operational_costs c
        WHERE c.task_id = t.id
      ) op ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(koszt_laczny), 0)::numeric AS koszt_materialow
        FROM task_finish_material_usage m
        WHERE m.task_id = t.id
      ) mu ON true
      WHERE t.status = 'Zakonczone'
        AND COALESCE(t.data_zakonczenia, t.data_planowana, t.updated_at) >= $1::date - INTERVAL '7 days'
        ${marginBranch}
    )
    SELECT id, klient_nazwa, oddzial_id, revenue, labor_cost, threshold_pct,
           ((revenue - labor_cost) / NULLIF(revenue, 0) * 100)::numeric AS margin_pct
    FROM settled
    WHERE revenue > 0
      AND ((revenue - labor_cost) / NULLIF(revenue, 0) * 100) < threshold_pct
    ORDER BY margin_pct ASC NULLS FIRST, revenue DESC
    LIMIT 8`;

  const kommoParams = [];
  const kommoBranch = branchPredicate('t', branchId, kommoParams);
  const kommoSql = `
    SELECT COUNT(*)::int AS sync_errors
    FROM tasks t
    WHERE t.kommo_last_sync_status = 'error'
      AND t.updated_at >= NOW() - INTERVAL '14 days'
      ${kommoBranch}`;

  const actionParams = [date];
  const actionBranch = branchPredicate('e', branchId, actionParams);
  const actionSummarySql = `
    SELECT
      COUNT(*)::int AS total_actions,
      COUNT(*) FILTER (WHERE e.action_type IN ('risk_resend_sms','risk_queue_call'))::int AS zadarma_actions,
      COUNT(*) FILTER (
        WHERE e.action_type = 'risk_acknowledge'
          AND COALESCE(e.metadata->>'risk_type', e.issue_key, '') = 'kommo_sync'
      )::int AS kommo_owner_acknowledgements,
      COUNT(*) FILTER (
        WHERE e.action_type = 'risk_acknowledge'
          AND COALESCE(e.metadata->>'risk_type', e.issue_key, '') = 'sms_delivery'
      )::int AS sms_owner_acknowledgements,
      COUNT(*) FILTER (WHERE e.action_type IN ('risk_reassign_team','risk_replace_equipment'))::int AS risk_resolution_actions,
      COUNT(*) FILTER (WHERE e.action_type = 'mark_reason')::int AS reason_actions
    FROM ops_action_events e
    WHERE e.created_at >= $1::date
      AND e.created_at < ($1::date + INTERVAL '1 day')
      ${actionBranch}`;

  const actionTypeSql = `
    SELECT e.action_type, COUNT(*)::int AS count
    FROM ops_action_events e
    WHERE e.created_at >= $1::date
      AND e.created_at < ($1::date + INTERVAL '1 day')
      ${actionBranch}
    GROUP BY e.action_type
    ORDER BY count DESC
    LIMIT 8`;

  const recentActionSql = `
    SELECT e.id, e.task_id, e.action_type, e.issue_key, e.note, e.metadata, e.created_at,
           t.numer, t.klient_nazwa,
           NULLIF(TRIM(CONCAT(COALESCE(u.imie, ''), ' ', COALESCE(u.nazwisko, ''))), '') AS actor_name
    FROM ops_action_events e
    LEFT JOIN tasks t ON t.id = e.task_id
    LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.created_at >= $1::date
      AND e.created_at < ($1::date + INTERVAL '1 day')
      ${actionBranch}
    ORDER BY e.created_at DESC
    LIMIT 8`;

  const ownerAckSql = `
    SELECT COALESCE(e.metadata->>'risk_type', e.issue_key, 'risk_report') AS risk_type,
           COUNT(*)::int AS count,
           MAX(e.created_at) AS last_ack_at
    FROM ops_action_events e
    WHERE e.created_at >= $1::date
      AND e.created_at < ($1::date + INTERVAL '1 day')
      AND e.action_type = 'risk_acknowledge'
      AND COALESCE(e.metadata->>'risk_type', e.issue_key, '') = ANY($${actionParams.length + 1}::text[])
      ${actionBranch}
    GROUP BY COALESCE(e.metadata->>'risk_type', e.issue_key, 'risk_report')
    ORDER BY count DESC`;

  const [
    taskSummaryResult,
    overdueResult,
    unassignedResult,
    reportResult,
    fleetDueResult,
    conflictResult,
    marginResult,
    kommoResult,
    actionSummaryResult,
    actionTypeResult,
    recentActionResult,
    ownerAckResult,
  ] = await Promise.all([
    safeQuery(pool, 'tasks.summary', taskSummarySql, taskParams, errors),
    safeQuery(pool, 'tasks.overdue', overdueSql, overdueParams, errors),
    safeQuery(pool, 'tasks.unassigned', unassignedSql, unassignedParams, errors),
    safeQuery(pool, 'reports.drafts', reportsSql, reportParams, errors),
    safeQuery(pool, 'fleet.due', fleetSql, fleetParams, errors),
    safeQuery(pool, 'fleet.reservation_conflicts', reservationConflictSql, conflictParams, errors),
    safeQuery(pool, 'finance.margin_risks', marginSql, marginParams, errors),
    safeQuery(pool, 'integrations.kommo_errors', kommoSql, kommoParams, errors),
    safeQuery(pool, 'ops.actions.summary', actionSummarySql, actionParams, errors),
    safeQuery(pool, 'ops.actions.types', actionTypeSql, actionParams, errors),
    safeQuery(pool, 'ops.actions.recent', recentActionSql, actionParams, errors),
    safeQuery(pool, 'ops.owner_acknowledgements', ownerAckSql, [...actionParams, OWNER_ACK_RISK_TYPES], errors),
  ]);

  const taskSummary = firstRow(taskSummaryResult);
  const reportSummary = firstRow(reportResult);
  const kommoSummary = firstRow(kommoResult);
  const actionSummary = firstRow(actionSummaryResult);
  const alerts = [];

  addAlert(alerts, count(taskSummary, 'overdue_total') > 0, {
    level: 'high',
    type: 'tasks_overdue',
    title: 'Zalegle zlecenia',
    count: count(taskSummary, 'overdue_total'),
    action: 'Przypisz nowy termin i potwierdz klientowi najstarsze pozycje.',
  });
  addAlert(alerts, count(taskSummary, 'unassigned_total') > 0, {
    level: count(taskSummary, 'unassigned_total') >= 3 ? 'high' : 'medium',
    type: 'tasks_unassigned',
    title: 'Zlecenia bez ekipy',
    count: count(taskSummary, 'unassigned_total'),
    action: `Dopnij obsade w horyzoncie ${horizonDays} dni.`,
  });
  addAlert(alerts, count(reportSummary, 'draft_total') > 0, {
    level: count(reportSummary, 'older_drafts') > 0 ? 'high' : 'medium',
    type: 'draft_reports',
    title: 'Robocze raporty dzienne',
    count: count(reportSummary, 'draft_total'),
    action: 'Zamknij raporty i uzupelnij podpisy/braki.',
  });
  addAlert(alerts, fleetDueResult.rows.length > 0, {
    level: 'medium',
    type: 'fleet_due',
    title: 'Terminy floty i sprzetu',
    count: fleetDueResult.rows.length,
    action: `Sprawdz przeglady i OC w horyzoncie ${fleetLookaheadDays} dni.`,
  });
  addAlert(alerts, conflictResult.rows.length > 0, {
    level: 'high',
    type: 'equipment_reservation_conflicts',
    title: 'Kolizje rezerwacji sprzetu',
    count: conflictResult.rows.length,
    action: 'Rozwiaz konflikt zanim ekipa zacznie dzien.',
  });
  addAlert(alerts, marginResult.rows.length > 0, {
    level: 'high',
    type: 'margin_risks',
    title: 'Ryzyko marzy',
    count: marginResult.rows.length,
    action: 'Sprawdz koszt robocizny vs wartosc zlecenia.',
  });
  addAlert(alerts, count(kommoSummary, 'sync_errors') > 0, {
    level: 'medium',
    type: 'kommo_sync_errors',
    title: 'Bledy synchronizacji Kommo',
    count: count(kommoSummary, 'sync_errors'),
    action: 'Ponow synchronizacje lub sprawdz webhook.',
  });
  addAlert(alerts, count(actionSummary, 'zadarma_actions') > 0, {
    level: 'medium',
    type: 'zadarma_followups',
    title: 'Decyzje Zadarma/SMS',
    count: count(actionSummary, 'zadarma_actions'),
    action: 'Zweryfikuj, czy kontakty z klientami domknely ryzyka dnia.',
  });
  addAlert(alerts, count(actionSummary, 'kommo_owner_acknowledgements') + count(actionSummary, 'sms_owner_acknowledgements') > 0, {
    level: 'medium',
    type: 'owner_acknowledgements',
    title: 'Potwierdzenia ownerow Kommo/SMS',
    count: count(actionSummary, 'kommo_owner_acknowledgements') + count(actionSummary, 'sms_owner_acknowledgements'),
    action: 'Sprawdz, czy potwierdzone alerty sa domkniete w Integracjach i Telefonii.',
  });

  const highAlerts = alerts.filter((a) => a.level === 'high').length;
  const mediumAlerts = alerts.filter((a) => a.level === 'medium').length;

  return {
    date,
    branch_id: branchId,
    horizon_days: horizonDays,
    fleet_lookahead_days: fleetLookaheadDays,
    generated_at: new Date().toISOString(),
    summary: {
      high_alerts: highAlerts,
      medium_alerts: mediumAlerts,
      total_alerts: alerts.length,
      today_tasks: count(taskSummary, 'today_total'),
      horizon_tasks: count(taskSummary, 'horizon_total'),
      overdue_tasks: count(taskSummary, 'overdue_total'),
      unassigned_tasks: count(taskSummary, 'unassigned_total'),
      draft_reports: count(reportSummary, 'draft_total'),
      fleet_due: fleetDueResult.rows.length,
      reservation_conflicts: conflictResult.rows.length,
      margin_risks: marginResult.rows.length,
      kommo_sync_errors: count(kommoSummary, 'sync_errors'),
      operational_decisions: count(actionSummary, 'total_actions'),
      zadarma_actions: count(actionSummary, 'zadarma_actions'),
      owner_acknowledgements: count(actionSummary, 'kommo_owner_acknowledgements') + count(actionSummary, 'sms_owner_acknowledgements'),
      kommo_owner_acknowledgements: count(actionSummary, 'kommo_owner_acknowledgements'),
      sms_owner_acknowledgements: count(actionSummary, 'sms_owner_acknowledgements'),
      risk_resolution_actions: count(actionSummary, 'risk_resolution_actions'),
      reason_actions: count(actionSummary, 'reason_actions'),
      query_errors: errors.length,
    },
    alerts,
    details: {
      overdue_tasks: overdueResult.rows,
      unassigned_tasks: unassignedResult.rows,
      fleet_due: fleetDueResult.rows,
      reservation_conflicts: conflictResult.rows,
      margin_risks: marginResult.rows
        .map((row) => {
          const margin = calculateTaskMargin({
            revenue_net: row.revenue,
            labor_cost: row.labor_cost,
          });
          return {
            ...row,
            revenue: money(margin.revenue_net),
            labor_cost: money(margin.costs.direct_labor_cost),
            margin_pct: margin.margin_pct,
            total_known_cost: money(margin.total_known_cost),
          };
        })
        .filter((row) => isLowMarginRisk({
          revenue_net: row.revenue,
          total_known_cost: row.total_known_cost,
          marginThresholdPct: Number(row.threshold_pct || 15),
        })),
      operational_action_types: actionTypeResult.rows.map((row) => ({
        action_type: row.action_type,
        label: OPS_ACTION_LABELS[row.action_type] || row.action_type,
        count: Number(row.count || 0),
      })),
      operational_actions: recentActionResult.rows.map((row) => ({
        ...row,
        label: OPS_ACTION_LABELS[row.action_type] || row.action_type,
      })),
      owner_acknowledgements: ownerAckResult.rows.map((row) => ({
        risk_type: row.risk_type,
        label: OWNER_ACK_LABELS[row.risk_type] || row.risk_type,
        count: Number(row.count || 0),
        last_ack_at: row.last_ack_at,
        status: 'domkniete_w_kontroli',
      })),
    },
    errors,
  };
}

function buildDigestText(digest) {
  const lines = [
    `Poranny digest ARBOR - ${digest.date}`,
    `Pilne: ${digest.summary.high_alerts}, uwaga: ${digest.summary.medium_alerts}.`,
    `Dzis: ${digest.summary.today_tasks} zlecen; horyzont ${digest.horizon_days} dni: ${digest.summary.horizon_tasks}.`,
  ];

  if (!digest.alerts.length) {
    lines.push('Brak krytycznych alertow operacyjnych na start dnia.');
  } else {
    lines.push('');
    for (const alert of digest.alerts.slice(0, 8)) {
      lines.push(`- ${alert.title}: ${alert.count}. ${alert.action}`);
    }
  }

  const oldest = digest.details.overdue_tasks.slice(0, 3).map(topTaskLabel);
  if (oldest.length) {
    lines.push('', `Najstarsze zalegle: ${oldest.join('; ')}.`);
  }

  const unassigned = digest.details.unassigned_tasks.slice(0, 3).map(topTaskLabel);
  if (unassigned.length) {
    lines.push(`Bez ekipy: ${unassigned.join('; ')}.`);
  }

  const fleet = digest.details.fleet_due
    .slice(0, 3)
    .map((row) => `${row.label || row.kind} (${row.due_type}, ${toDateKey(row.due_date)})`);
  if (fleet.length) {
    lines.push(`Flota/sprzet: ${fleet.join('; ')}.`);
  }

  const margin = digest.details.margin_risks
    .slice(0, 3)
    .map((row) => `#${row.id} ${row.margin_pct}%`);
  if (margin.length) {
    lines.push(`Marza do sprawdzenia: ${margin.join('; ')}.`);
  }

  const actionTypes = (digest.details.operational_action_types || [])
    .slice(0, 4)
    .map((row) => `${row.label}: ${row.count}`);
  if (actionTypes.length) {
    lines.push(`Decyzje operacyjne: ${actionTypes.join('; ')}.`);
  }

  const zadarma = Number(digest.summary.zadarma_actions || 0);
  if (zadarma > 0) {
    lines.push(`Zadarma/SMS: ${zadarma} akcji do sprawdzenia w kontroli operacyjnej.`);
  }

  const ownerAcks = Number(digest.summary.owner_acknowledgements || 0);
  if (ownerAcks > 0) {
    const kommo = Number(digest.summary.kommo_owner_acknowledgements || 0);
    const sms = Number(digest.summary.sms_owner_acknowledgements || 0);
    lines.push(`Potwierdzenia ownerow: ${ownerAcks} domkniete (Kommo: ${kommo}, SMS: ${sms}).`);
  }

  if (digest.summary.query_errors) {
    lines.push(`Uwaga techniczna: ${digest.summary.query_errors} sekcji digestu nie udalo sie odczytac.`);
  }

  return lines.join('\n').slice(0, 3500);
}

async function getDigestRecipients(pool, { branchId = null, centralOnly = false, managersOnly = false, recipientUserIds = [], extraEmails = [] } = {}) {
  const explicitUserIds = normalizeUserIds(recipientUserIds);
  const normalizedExtraEmails = normalizeEmailList(extraEmails);
  if (explicitUserIds.length || normalizedExtraEmails.length) {
    const rows = [];
    if (explicitUserIds.length) {
      const result = await pool.query(
        `SELECT u.id, u.email, u.rola, u.oddzial_id
         FROM users u
         WHERE u.aktywny IS NOT FALSE AND u.id = ANY($1::int[])
         ORDER BY u.id`,
        [explicitUserIds]
      );
      rows.push(...result.rows);
    }
    rows.push(...normalizedExtraEmails.map((email, index) => ({
      id: `email:${index}:${email}`,
      email,
      rola: 'external',
      oddzial_id: branchId || null,
      external: true,
    })));
    return rows;
  }

  const params = [];
  let predicate;
  if (centralOnly) {
    predicate = `u.rola = ANY($1::text[])`;
    params.push(CENTRAL_ROLES);
  } else if (managersOnly) {
    predicate = 'u.rola = $1';
    params.push(MANAGER_ROLE);
  } else {
    predicate = `(u.rola = ANY($1::text[]) OR u.rola = $2)`;
    params.push(CENTRAL_ROLES, MANAGER_ROLE);
  }
  if (branchId && !centralOnly) {
    params.push(Number(branchId));
    predicate += ` AND u.oddzial_id = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT u.id, u.email, u.rola, u.oddzial_id
     FROM users u
     WHERE u.aktywny IS NOT FALSE AND ${predicate}
     ORDER BY u.rola, u.id`,
    params
  );
  return result.rows;
}

async function getDigestSettings(pool, options = {}) {
  const branchId = options.branchId ? Number(options.branchId) : null;
  await ensureDigestSettingsTable(pool);
  const result = await pool.query(
    `SELECT *
     FROM operational_digest_settings
     WHERE scope_key = $1
     LIMIT 1`,
    [digestScopeKey(branchId)]
  );
  return normalizeDigestSettings(result.rows[0], branchId);
}

async function listDigestSettings(pool) {
  await ensureDigestSettingsTable(pool);
  const result = await pool.query(
    `SELECT s.*, b.nazwa AS branch_name
     FROM operational_digest_settings s
     LEFT JOIN branches b ON b.id = s.branch_id
     ORDER BY CASE WHEN s.scope = 'global' THEN 0 ELSE 1 END, b.nazwa NULLS FIRST, s.branch_id NULLS FIRST`
  );
  const rows = result.rows.map((row) => ({
    ...normalizeDigestSettings(row, row.branch_id),
    branch_name: row.branch_name || null,
  }));
  if (!rows.some((row) => row.scope_key === 'global')) rows.unshift(defaultDigestSettings(null));
  return rows;
}

async function saveDigestSettings(pool, input = {}) {
  const branchId = input.branch_id ? Number(input.branch_id) : null;
  const defaults = defaultDigestSettings(branchId);
  const settings = {
    ...defaults,
    enabled: input.enabled !== false,
    send_time: String(input.send_time || defaults.send_time).trim().slice(0, 5) || defaults.send_time,
    email_enabled: input.email_enabled === true,
    horizon_days: clampInt(input.horizon_days, defaults.horizon_days, 1, 14),
    fleet_lookahead_days: clampInt(input.fleet_lookahead_days, defaults.fleet_lookahead_days, 1, 90),
    recipient_user_ids: normalizeUserIds(input.recipient_user_ids || []),
    extra_emails: normalizeEmailList(input.extra_emails || []),
    updated_by: input.updated_by || null,
  };
  await ensureDigestSettingsTable(pool);
  const result = await pool.query(
    `INSERT INTO operational_digest_settings (
       scope_key, scope, branch_id, enabled, send_time, email_enabled,
       horizon_days, fleet_lookahead_days, recipient_user_ids, extra_emails, updated_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
     ON CONFLICT (scope_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       send_time = EXCLUDED.send_time,
       email_enabled = EXCLUDED.email_enabled,
       horizon_days = EXCLUDED.horizon_days,
       fleet_lookahead_days = EXCLUDED.fleet_lookahead_days,
       recipient_user_ids = EXCLUDED.recipient_user_ids,
       extra_emails = EXCLUDED.extra_emails,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      settings.scope_key,
      settings.scope,
      settings.branch_id,
      settings.enabled,
      settings.send_time,
      settings.email_enabled,
      settings.horizon_days,
      settings.fleet_lookahead_days,
      JSON.stringify(settings.recipient_user_ids),
      JSON.stringify(settings.extra_emails),
      settings.updated_by,
    ]
  );
  return normalizeDigestSettings(result.rows[0], branchId);
}

async function insertDigestNotification(pool, recipientId, digest, message) {
  const result = await pool.query(
    `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status, data_utworzenia)
     SELECT NULL, $1, NULL, $2, $3, 'Nowe', NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications n
       WHERE n.to_user_id = $1
         AND n.typ = $2
         AND n.data_utworzenia::date = $4::date
     )
     RETURNING id`,
    [recipientId, DIGEST_TYPE, message, digest.date]
  );
  return result.rows.length > 0;
}

async function deliverOperationalDigest(pool, digest, recipients, options = {}) {
  const message = buildDigestText(digest);
  let notificationsCreated = 0;
  let emailsSent = 0;
  const emailEnabled = options.emailEnabled ?? process.env.OPERATIONAL_DIGEST_EMAIL === '1';

  for (const recipient of recipients) {
    if (!recipient.external) {
      const inserted = await insertDigestNotification(pool, recipient.id, digest, message);
      if (inserted) notificationsCreated += 1;
    }
    if (emailEnabled && recipient.email) {
      const mail = await sendSystemEmailOptional({
        to: recipient.email,
        subject: `[ARBOR] Poranny digest - ${digest.date}`,
        text: message,
      });
      if (mail.sent) emailsSent += 1;
    }
  }

  return {
    recipients: recipients.length,
    notifications_created: notificationsCreated,
    emails_sent: emailsSent,
    message,
  };
}

async function getManagerBranchIds(pool) {
  const result = await pool.query(
    `SELECT DISTINCT u.oddzial_id
     FROM users u
     WHERE u.aktywny IS NOT FALSE
       AND u.rola = $1
       AND u.oddzial_id IS NOT NULL
     ORDER BY u.oddzial_id`,
    [MANAGER_ROLE]
  );
  return result.rows.map((row) => Number(row.oddzial_id)).filter(Boolean);
}

async function recordDigestRun(pool, { digest, delivery, scope, branchId = null, options = {} }) {
  await ensureDigestRunsTable(pool);
  const summary = digest.summary || {};
  const errors = Array.isArray(digest.errors) ? digest.errors : [];
  const result = await pool.query(
    `INSERT INTO operational_digest_runs (
       digest_date, scope, branch_id, trigger_type, actor_id, status,
       summary, delivery, errors,
       high_alerts, medium_alerts, total_alerts,
       recipients, notifications_created, emails_sent
     )
     VALUES (
       $1::date, $2, $3, $4, $5, $6,
       $7::jsonb, $8::jsonb, $9::jsonb,
       $10, $11, $12,
       $13, $14, $15
     )
     RETURNING id, created_at`,
    [
      digest.date,
      scope,
      branchId,
      options.triggerType || 'manual',
      options.actorUserId || null,
      errors.length ? 'partial' : 'completed',
      JSON.stringify(summary),
      JSON.stringify(delivery || {}),
      JSON.stringify(errors),
      Number(summary.high_alerts || 0),
      Number(summary.medium_alerts || 0),
      Number(summary.total_alerts || 0),
      Number(delivery?.recipients || 0),
      Number(delivery?.notifications_created || 0),
      Number(delivery?.emails_sent || 0),
    ]
  );
  return result.rows[0] || null;
}

async function getDigestRunHistory(pool, options = {}) {
  await ensureDigestRunsTable(pool);
  const limit = clampInt(options.limit, 30, 1, 100);
  const offset = Math.max(0, Number(options.offset || 0));
  const params = [];
  const filters = [];
  if (options.date) {
    params.push(toDateKey(options.date));
    filters.push(`r.digest_date = $${params.length}::date`);
  }
  if (options.branchId != null && options.branchId !== '') {
    params.push(Number(options.branchId));
    filters.push(`r.branch_id = $${params.length}`);
  }
  if (options.scope) {
    params.push(String(options.scope));
    filters.push(`r.scope = $${params.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const [countResult, rowsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM operational_digest_runs r ${where}`, params),
    pool.query(
      `SELECT r.id, r.digest_date, r.scope, r.branch_id, b.nazwa AS branch_name,
              r.trigger_type, r.actor_id, r.status, r.summary, r.delivery, r.errors,
              r.high_alerts, r.medium_alerts, r.total_alerts,
              r.recipients, r.notifications_created, r.emails_sent, r.created_at
       FROM operational_digest_runs r
       LEFT JOIN branches b ON b.id = r.branch_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset]
    ),
  ]);
  return {
    total: Number(countResult.rows[0]?.total || 0),
    limit,
    offset,
    items: rowsResult.rows.map((row) => ({
      ...row,
      summary: row.summary || {},
      delivery: row.delivery || {},
      errors: Array.isArray(row.errors) ? row.errors : [],
    })),
  };
}

async function runOperationalDigest(pool, options = {}) {
  const date = toDateKey(options.date);
  const globalSettings = await getDigestSettings(pool, { branchId: null });
  const globalDigestOptions = {
    ...options,
    date,
    branchId: null,
    horizonDays: options.horizonDays || globalSettings.horizon_days,
    fleetLookaheadDays: options.fleetLookaheadDays || globalSettings.fleet_lookahead_days,
  };
  let global;
  if (!options.respectEnabled || globalSettings.enabled) {
    const globalDigest = await buildOperationalDigest(pool, globalDigestOptions);
    const centralRecipients = await getDigestRecipients(pool, {
      centralOnly: true,
      recipientUserIds: globalSettings.recipient_user_ids,
      extraEmails: globalSettings.extra_emails,
    });
    const centralDelivery = await deliverOperationalDigest(pool, globalDigest, centralRecipients, {
      ...options,
      emailEnabled: options.emailEnabled ?? globalSettings.email_enabled,
    });
    const globalRun = await recordDigestRun(pool, {
      digest: globalDigest,
      delivery: centralDelivery,
      scope: 'global',
      branchId: null,
      options,
    });
    global = { summary: globalDigest.summary, delivery: centralDelivery, run: globalRun, settings: globalSettings };
  } else {
    global = { skipped: 'disabled', settings: globalSettings };
  }

  const branchIds = options.branchIds || (await getManagerBranchIds(pool));
  const branches = [];
  for (const branchId of branchIds) {
    const settings = await getDigestSettings(pool, { branchId });
    if (options.respectEnabled && !settings.enabled) {
      branches.push({ branch_id: branchId, skipped: 'disabled', settings });
      continue;
    }
    const digest = await buildOperationalDigest(pool, {
      ...options,
      date,
      branchId,
      horizonDays: options.horizonDays || settings.horizon_days,
      fleetLookaheadDays: options.fleetLookaheadDays || settings.fleet_lookahead_days,
    });
    const recipients = await getDigestRecipients(pool, {
      branchId,
      managersOnly: true,
      recipientUserIds: settings.recipient_user_ids,
      extraEmails: settings.extra_emails,
    });
    const delivery = await deliverOperationalDigest(pool, digest, recipients, {
      ...options,
      emailEnabled: options.emailEnabled ?? settings.email_enabled,
    });
    const run = await recordDigestRun(pool, {
      digest,
      delivery,
      scope: 'branch',
      branchId,
      options,
    });
    branches.push({ branch_id: branchId, summary: digest.summary, delivery, run, settings });
  }

  return {
    date,
    global,
    branches,
  };
}

module.exports = {
  DIGEST_TYPE,
  buildOperationalDigest,
  buildDigestText,
  deliverOperationalDigest,
  getDigestRecipients,
  getDigestRunHistory,
  getDigestSettings,
  listDigestSettings,
  recordDigestRun,
  runOperationalDigest,
  saveDigestSettings,
};
