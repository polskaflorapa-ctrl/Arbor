const { sendSystemEmailOptional } = require('./systemEmail');

const DIGEST_TYPE = 'operational_daily_digest';
const CENTRAL_ROLES = ['Prezes', 'Dyrektor', 'Administrator'];
const MANAGER_ROLE = 'Kierownik';

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

function money(value) {
  const n = Number(value) || 0;
  return Math.round(n);
}

function topTaskLabel(row) {
  const name = String(row.klient_nazwa || 'bez klienta').trim();
  return `#${row.id} ${name}`;
}

function addAlert(alerts, condition, alert) {
  if (!condition) return;
  alerts.push(alert);
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
             (COALESCE(tr.koszt_pomocnikow, 0) + COALESCE(tr.wynagrodzenie_brygadzisty, 0))::numeric AS labor_cost
      FROM tasks t
      JOIN task_rozliczenie tr ON tr.task_id = t.id
      WHERE t.status = 'Zakonczone'
        AND COALESCE(t.data_zakonczenia, t.data_planowana, t.updated_at) >= $1::date - INTERVAL '7 days'
        ${marginBranch}
    )
    SELECT id, klient_nazwa, oddzial_id, revenue, labor_cost,
           ROUND(((revenue - labor_cost) / NULLIF(revenue, 0)) * 100, 1) AS margin_pct
    FROM settled
    WHERE revenue > 0 AND labor_cost / NULLIF(revenue, 0) >= 0.8
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

  const [
    taskSummaryResult,
    overdueResult,
    unassignedResult,
    reportResult,
    fleetDueResult,
    conflictResult,
    marginResult,
    kommoResult,
  ] = await Promise.all([
    safeQuery(pool, 'tasks.summary', taskSummarySql, taskParams, errors),
    safeQuery(pool, 'tasks.overdue', overdueSql, overdueParams, errors),
    safeQuery(pool, 'tasks.unassigned', unassignedSql, unassignedParams, errors),
    safeQuery(pool, 'reports.drafts', reportsSql, reportParams, errors),
    safeQuery(pool, 'fleet.due', fleetSql, fleetParams, errors),
    safeQuery(pool, 'fleet.reservation_conflicts', reservationConflictSql, conflictParams, errors),
    safeQuery(pool, 'finance.margin_risks', marginSql, marginParams, errors),
    safeQuery(pool, 'integrations.kommo_errors', kommoSql, kommoParams, errors),
  ]);

  const taskSummary = firstRow(taskSummaryResult);
  const reportSummary = firstRow(reportResult);
  const kommoSummary = firstRow(kommoResult);
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
      query_errors: errors.length,
    },
    alerts,
    details: {
      overdue_tasks: overdueResult.rows,
      unassigned_tasks: unassignedResult.rows,
      fleet_due: fleetDueResult.rows,
      reservation_conflicts: conflictResult.rows,
      margin_risks: marginResult.rows.map((row) => ({
        ...row,
        revenue: money(row.revenue),
        labor_cost: money(row.labor_cost),
        margin_pct: row.margin_pct == null ? null : Number(row.margin_pct),
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

  if (digest.summary.query_errors) {
    lines.push(`Uwaga techniczna: ${digest.summary.query_errors} sekcji digestu nie udalo sie odczytac.`);
  }

  return lines.join('\n').slice(0, 3500);
}

async function getDigestRecipients(pool, { branchId = null, centralOnly = false, managersOnly = false } = {}) {
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
    const inserted = await insertDigestNotification(pool, recipient.id, digest, message);
    if (inserted) notificationsCreated += 1;
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

async function runOperationalDigest(pool, options = {}) {
  const date = toDateKey(options.date);
  const globalDigest = await buildOperationalDigest(pool, { ...options, date, branchId: null });
  const centralRecipients = await getDigestRecipients(pool, { centralOnly: true });
  const centralDelivery = await deliverOperationalDigest(pool, globalDigest, centralRecipients, options);

  const branchIds = options.branchIds || (await getManagerBranchIds(pool));
  const branches = [];
  for (const branchId of branchIds) {
    const digest = await buildOperationalDigest(pool, { ...options, date, branchId });
    const recipients = await getDigestRecipients(pool, { branchId, managersOnly: true });
    const delivery = await deliverOperationalDigest(pool, digest, recipients, options);
    branches.push({ branch_id: branchId, summary: digest.summary, delivery });
  }

  return {
    date,
    global: { summary: globalDigest.summary, delivery: centralDelivery },
    branches,
  };
}

module.exports = {
  DIGEST_TYPE,
  buildOperationalDigest,
  buildDigestText,
  deliverOperationalDigest,
  getDigestRecipients,
  runOperationalDigest,
};
