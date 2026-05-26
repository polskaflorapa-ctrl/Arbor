const express = require('express');
const pool = require('../config/database');
const { env } = require('../config/env');
const {
  authMiddleware,
  requireRole,
  isDyrektorOrAdmin,
  scopedOddzialId,
} = require('../middleware/auth');
const logger = require('../config/logger');
const { sendSmsOptional } = require('../services/twilioSms');
const { sendSystemEmailOptional } = require('../services/systemEmail');
const { runUploadStorageSelfTest, uploadStorageMode } = require('../services/upload-storage');

const router = express.Router();

const MANAGER_ROLES = ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik'];
const CLOSED_TASK_STATUSES = new Set(['Zakonczone', 'Anulowane']);
const IN_PROGRESS_TASK_STATUS = 'W_Realizacji';

const BLOCKER_META = {
  team: {
    label: 'Brak ekipy',
    action: 'Przypisz ekipe',
    tone: 'danger',
    path: '/kierownik',
  },
  phone: {
    label: 'Brak telefonu',
    action: 'Uzupelnij kontakt',
    tone: 'warning',
    path: '/zlecenia',
  },
  address: {
    label: 'Brak adresu',
    action: 'Uzupelnij adres',
    tone: 'warning',
    path: '/zlecenia',
  },
  gps: {
    label: 'Brak pinezki GPS',
    action: 'Ustaw lokalizacje',
    tone: 'danger',
    path: '/zlecenia',
  },
  duration: {
    label: 'Brak czasu pracy',
    action: 'Wpisz czas uslugi',
    tone: 'warning',
    path: '/zlecenia',
  },
  issue: {
    label: 'Otwarte problemy',
    action: 'Sprawdz zgloszenia',
    tone: 'danger',
    path: '/zlecenia',
  },
  gps_stale: {
    label: 'GPS ekip opozniony',
    action: 'Otworz mape live',
    tone: 'warning',
    path: '/mapa-live',
  },
  notification: {
    label: 'Nowe powiadomienia',
    action: 'Otworz powiadomienia',
    tone: 'info',
    path: '/powiadomienia',
  },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateParam(value) {
  const date = String(value || todayIso()).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function truthyText(value) {
  return String(value || '').trim().length > 0;
}

function numericPositive(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0;
}

function isTaskClosed(status) {
  return CLOSED_TASK_STATUSES.has(String(status || ''));
}

function taskBlockers(task) {
  const blockers = [];
  if (!task.ekipa_id) blockers.push('team');
  if (!truthyText(task.klient_telefon)) blockers.push('phone');
  if (!truthyText(task.adres)) blockers.push('address');
  if (task.pin_lat == null || task.pin_lng == null) blockers.push('gps');
  if (!numericPositive(task.czas_obslugi_min) && !numericPositive(task.czas_planowany_godziny)) blockers.push('duration');
  if (Number(task.open_issues || 0) > 0) blockers.push('issue');
  return blockers;
}

function gpsStatus(recordedAt) {
  if (!recordedAt) return { status: 'missing', ageMin: null };
  const ts = new Date(recordedAt).getTime();
  if (!Number.isFinite(ts)) return { status: 'missing', ageMin: null };
  const ageMin = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (ageMin <= 20) return { status: 'online', ageMin };
  if (ageMin <= 90) return { status: 'stale', ageMin };
  return { status: 'offline', ageMin };
}

function buildTaskPath(task, date) {
  const params = new URLSearchParams();
  const blockers = task.blockers || [];
  if (blockers.includes('team')) {
    params.set('mode', 'edit');
    params.set('step', 'planning');
    params.set('field', 'ekipa_id');
  } else if (blockers.includes('phone')) {
    params.set('mode', 'edit');
    params.set('step', 'client');
    params.set('field', 'klient_telefon');
  } else if (blockers.includes('address')) {
    params.set('mode', 'edit');
    params.set('step', 'client');
    params.set('field', 'adres');
  } else if (blockers.includes('duration')) {
    params.set('mode', 'edit');
    params.set('step', 'finance');
    params.set('field', 'czas_planowany_godziny');
  } else if (blockers.includes('gps')) {
    params.set('focus', 'officePlan');
  } else if (blockers.includes('issue')) {
    params.set('tab', 'problemy');
  }
  params.set('returnTo', `/kierownik?date=${encodeURIComponent(date)}`);
  params.set('returnLabel', 'Cockpit kierownika');
  const query = params.toString();
  return `/zlecenia/${task.id}${query ? `?${query}` : ''}`;
}

function bumpBlocker(counts, key, amount = 1) {
  counts.set(key, (counts.get(key) || 0) + amount);
}

function blockerRows(counts) {
  return Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      count,
      ...(BLOCKER_META[key] || { label: key, action: 'Otworz', tone: 'info', path: '/kierownik' }),
    }))
    .sort((a, b) => {
      const toneRank = { danger: 0, warning: 1, info: 2 };
      return (toneRank[a.tone] ?? 9) - (toneRank[b.tone] ?? 9) || b.count - a.count;
    });
}

router.get('/kierownik-today', authMiddleware, requireRole(...MANAGER_ROLES), async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) {
    return res.status(400).json({ error: 'Nieprawidlowa data. Uzyj YYYY-MM-DD.' });
  }

  const requestedOddzial = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
  const oddzialId = scopedOddzialId(req.user, Number.isFinite(requestedOddzial) ? requestedOddzial : null);
  if (!isDyrektorOrAdmin(req.user) && oddzialId == null) {
    return res.status(403).json({ error: 'Kierownik nie ma przypisanego oddzialu.' });
  }

  const branchSql = oddzialId != null ? 'AND t.oddzial_id = $2' : '';
  const taskParams = oddzialId != null ? [date, oddzialId] : [date];

  const teamBranchSql = oddzialId != null ? 'AND tm.oddzial_id = $2' : '';

  try {
    const [tasksResult, teamsResult, notificationsResult] = await Promise.all([
      pool.query(
        `WITH open_issues AS (
           SELECT task_id, COUNT(*)::int AS open_issues
           FROM issues
           WHERE LOWER(COALESCE(status, '')) NOT LIKE 'rozwi%'
             AND LOWER(COALESCE(status, '')) NOT LIKE 'zamk%'
           GROUP BY task_id
         ),
         work_state AS (
           SELECT task_id,
                  BOOL_OR(start_time IS NOT NULL) AS has_started,
                  BOOL_OR(end_time IS NOT NULL) AS has_finished
           FROM work_logs
           GROUP BY task_id
         )
         SELECT t.id, t.numer, t.klient_nazwa, t.klient_telefon, t.adres, t.miasto,
                t.status, t.priorytet, t.data_planowana, t.ekipa_id, t.oddzial_id,
                t.pin_lat, t.pin_lng, t.czas_planowany_godziny, t.czas_obslugi_min,
                e.nazwa AS ekipa_nazwa, b.nazwa AS oddzial_nazwa,
                COALESCE(oi.open_issues, 0)::int AS open_issues,
                COALESCE(ws.has_started, false) AS has_started,
                COALESCE(ws.has_finished, false) AS has_finished
         FROM tasks t
         LEFT JOIN teams e ON e.id = t.ekipa_id
         LEFT JOIN branches b ON b.id = t.oddzial_id
         LEFT JOIN open_issues oi ON oi.task_id = t.id
         LEFT JOIN work_state ws ON ws.task_id = t.id
         WHERE t.data_planowana::date = $1::date
           ${branchSql}
         ORDER BY
           CASE t.priorytet WHEN 'Pilny' THEN 0 WHEN 'Wysoki' THEN 1 WHEN 'Normalny' THEN 2 ELSE 3 END,
           t.data_planowana ASC NULLS LAST,
           t.id ASC`,
        taskParams
      ),
      pool.query(
        `WITH today_tasks AS (
           SELECT id, ekipa_id, status
           FROM tasks t
           WHERE t.data_planowana::date = $1::date
             AND t.ekipa_id IS NOT NULL
             ${branchSql}
         ),
         latest_vehicle_gps AS (
           SELECT DISTINCT ON (v.ekipa_id)
                  v.ekipa_id, g.recorded_at
           FROM vehicles v
           JOIN gps_vehicle_positions g
             ON REPLACE(REPLACE(UPPER(v.nr_rejestracyjny), ' ', ''), '-', '') =
                REPLACE(REPLACE(UPPER(g.plate_number), ' ', ''), '-', '')
           WHERE v.ekipa_id IS NOT NULL
           ORDER BY v.ekipa_id, g.recorded_at DESC
         )
         SELECT tm.id, tm.nazwa, tm.oddzial_id,
                COUNT(tt.id)::int AS tasks_total,
                COUNT(tt.id) FILTER (WHERE tt.status = 'W_Realizacji')::int AS in_progress,
                COUNT(tt.id) FILTER (WHERE tt.status = 'Zaplanowane')::int AS planned,
                lvg.recorded_at AS last_gps_at
         FROM teams tm
         LEFT JOIN today_tasks tt ON tt.ekipa_id = tm.id
         LEFT JOIN latest_vehicle_gps lvg ON lvg.ekipa_id = tm.id
         WHERE tm.aktywny IS NOT FALSE
           ${teamBranchSql}
         GROUP BY tm.id, tm.nazwa, tm.oddzial_id, lvg.recorded_at
         ORDER BY tm.nazwa ASC`,
        taskParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS unread
         FROM notifications
         WHERE to_user_id = $1 AND status = 'Nowe'`,
        [req.user.id]
      ),
    ]);

    const blockerCounts = new Map();
    const openTasks = [];
    let done = 0;
    let inProgress = 0;
    let ready = 0;
    let blocked = 0;
    let unassigned = 0;
    let openIssues = 0;

    for (const row of tasksResult.rows) {
      if (isTaskClosed(row.status)) {
        done += 1;
        continue;
      }

      if (row.status === IN_PROGRESS_TASK_STATUS) {
        inProgress += 1;
      }

      const blockers = row.status === IN_PROGRESS_TASK_STATUS ? [] : taskBlockers(row);
      if (!row.ekipa_id && row.status !== IN_PROGRESS_TASK_STATUS) unassigned += 1;
      openIssues += Number(row.open_issues || 0);
      blockers.forEach((key) => bumpBlocker(blockerCounts, key));
      if (blockers.length > 0) blocked += 1;
      if (blockers.length === 0 && row.status !== IN_PROGRESS_TASK_STATUS) ready += 1;

      openTasks.push({
        id: row.id,
        numer: row.numer || `ZLE-${String(row.id).padStart(4, '0')}`,
        klient_nazwa: row.klient_nazwa,
        adres: row.adres,
        miasto: row.miasto,
        status: row.status,
        priorytet: row.priorytet,
        data_planowana: row.data_planowana,
        ekipa_id: row.ekipa_id,
        ekipa_nazwa: row.ekipa_nazwa,
        oddzial_nazwa: row.oddzial_nazwa,
        open_issues: Number(row.open_issues || 0),
        blockers,
      });
    }

    const teams = teamsResult.rows.map((row) => {
      const gps = gpsStatus(row.last_gps_at);
      return {
        id: row.id,
        nazwa: row.nazwa,
        oddzial_id: row.oddzial_id,
        tasks_total: Number(row.tasks_total || 0),
        in_progress: Number(row.in_progress || 0),
        planned: Number(row.planned || 0),
        last_gps_at: row.last_gps_at,
        gps_status: gps.status,
        gps_age_min: gps.ageMin,
      };
    });

    const gpsStaleTeams = teams.filter((team) => team.tasks_total > 0 && ['missing', 'stale', 'offline'].includes(team.gps_status));
    if (gpsStaleTeams.length > 0) bumpBlocker(blockerCounts, 'gps_stale', gpsStaleTeams.length);

    const unreadNotifications = Number(notificationsResult.rows[0]?.unread || 0);
    if (unreadNotifications > 0) bumpBlocker(blockerCounts, 'notification', unreadNotifications);

    const riskyTasks = openTasks
      .filter((task) => task.blockers.length > 0 || task.open_issues > 0)
      .sort((a, b) => b.blockers.length - a.blockers.length || b.open_issues - a.open_issues)
      .slice(0, 8)
      .map((task) => ({
        ...task,
        blocker_labels: task.blockers.map((key) => BLOCKER_META[key]?.label || key),
        action_path: buildTaskPath(task, date),
      }));

    res.json({
      date,
      oddzial_id: oddzialId,
      summary: {
        tasks_total: tasksResult.rows.length,
        open: openTasks.length,
        done,
        in_progress: inProgress,
        ready_for_dispatch: ready,
        blocked,
        unassigned,
        open_issues: openIssues,
        unread_notifications: unreadNotifications,
        active_teams: teams.length,
        assigned_teams: teams.filter((team) => team.tasks_total > 0).length,
        gps_online: teams.filter((team) => team.tasks_total > 0 && team.gps_status === 'online').length,
        gps_attention: gpsStaleTeams.length,
      },
      blockers: blockerRows(blockerCounts),
      tasks: riskyTasks,
      teams: teams.filter((team) => team.tasks_total > 0 || team.gps_status !== 'missing').slice(0, 12),
      generated_at: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('ops kierownik-today', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: e.message, requestId: req.requestId });
  }
});

router.get('/smoke', authMiddleware, requireRole('Prezes', 'Dyrektor', 'Administrator'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const [dbRes, usersRes, tasksRes] = await Promise.all([
      pool.query('SELECT 1 AS ok'),
      pool.query('SELECT COUNT(*)::int AS c FROM users'),
      pool.query('SELECT COUNT(*)::int AS c FROM tasks'),
    ]);
    res.json({
      status: 'ok',
      checks: {
        db: dbRes.rows[0]?.ok === 1 ? 'up' : 'unknown',
        users_table: usersRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
        tasks_table: tasksRes.rows[0]?.c >= 0 ? 'ok' : 'unknown',
      },
      counts: {
        users: usersRes.rows[0]?.c || 0,
        tasks: tasksRes.rows[0]?.c || 0,
      },
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('Blad smoke check', { message: e.message, requestId: req.requestId });
    res.status(503).json({
      status: 'failed',
      error: e.message,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  }
});

router.get('/storage-smoke', authMiddleware, requireRole('Prezes', 'Dyrektor', 'Administrator'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await runUploadStorageSelfTest();
    res.json({
      status: 'ok',
      ...result,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  } catch (e) {
    logger.error('Blad storage smoke check', { message: e.message, mode: uploadStorageMode(), requestId: req.requestId });
    res.status(503).json({
      status: 'failed',
      mode: uploadStorageMode(),
      error: e.message,
      duration_ms: Date.now() - startedAt,
      requestId: req.requestId,
    });
  }
});

/** F1.10 — prosty tick SLA: przypomnienie dla przeterminowanych zatwierdzeń (bez eskalacji hierarchicznej). */
router.get('/quotation-sla-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const emailOn = process.env.QUOTATION_SLA_EMAIL === '1';
    const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const { rows } = await pool.query(
      `SELECT a.id, a.quotation_id, a.wymagany_typ, a.due_at
       FROM quotation_approvals a
       JOIN quotations q ON q.id = a.quotation_id
       WHERE a.decyzja = 'Pending' AND q.status = 'W_Zatwierdzeniu'
         AND a.due_at IS NOT NULL AND a.due_at < NOW()
         AND a.sla_reminder_sent_at IS NULL
       LIMIT 100`
    );
    let emailsSent = 0;
    for (const r of rows) {
      const tresc = `SLA: zatwierdzenie wyceny #${r.quotation_id} (${r.wymagany_typ}) po terminie.`;
      const linkLine = base ? `\n\nPanel: ${base}/wycena-kalendarz` : '';
      const users = await pool.query(
        `SELECT DISTINCT u.id, NULLIF(TRIM(u.email), '') AS email FROM users u
         WHERE u.aktywny IS NOT FALSE AND (
           (u.rola = 'Kierownik' AND u.oddzial_id = (SELECT oddzial_id FROM quotations WHERE id = $1))
           OR u.rola IN ('Prezes','Dyrektor')
         )`,
        [r.quotation_id]
      );
      for (const u of users.rows) {
        await pool.query(
          `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
           VALUES (NULL, $1, NULL, $2, 'quotation_sla', $3, 'Nowe')`,
          [u.id, r.quotation_id, tresc]
        );
        if (emailOn && u.email) {
          const mail = await sendSystemEmailOptional({
            to: u.email,
            subject: `[ARBOR] SLA wyceny #${r.quotation_id}`,
            text: `${tresc}${linkLine}`,
          });
          if (mail.sent) emailsSent += 1;
        }
      }
      await pool.query(`UPDATE quotation_approvals SET sla_reminder_sent_at = NOW() WHERE id = $1`, [r.id]);
    }
    res.json({ processed: rows.length, emails_sent: emailsSent });
  } catch (e) {
    logger.error('ops quotation-sla-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** Wyceny w statusie Wyslana_Klientowi po terminie ważności → Wygasla (cron z ?secret=OPS_CRON_SECRET). */
router.get('/quotation-expiry-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE quotations SET status = 'Wygasla', updated_at = NOW()
       WHERE status = 'Wyslana_Klientowi' AND waznosc_do IS NOT NULL AND waznosc_do < NOW()
       RETURNING id`
    );
    res.json({ expired: rows.length, ids: rows.map((r) => r.id) });
  } catch (e) {
    logger.error('ops quotation-expiry-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.5 — kasa zadeklarowana, brak odbioru: przypomnienia po 48 h i 7 dniach (in-app). */
router.get('/payroll-cash-reminder-tick', async (req, res) => {
  const secret = (env.OPS_CRON_SECRET || process.env.OPS_CRON_SECRET || '').trim();
  if (!secret || String(req.query.secret || '') !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const typ = 'kasa_oddzial_nieodebrana';
  const smsOn = process.env.PAYROLL_CASH_REMINDER_SMS === '1';
  const emailOn = process.env.PAYROLL_CASH_REMINDER_EMAIL === '1';
  let emailSent48 = 0;
  let emailSent7 = 0;

  const notifyForPickup = async (row, label) => {
    const meta = await pool.query(
      `SELECT t.nazwa AS team_nazwa, b.nazwa AS oddzial_nazwa
       FROM teams t JOIN branches b ON b.id = $1 WHERE t.id = $2`,
      [row.oddzial_id, row.team_id]
    );
    const m = meta.rows[0] || {};
    const teamN = m.team_nazwa || `ekipa #${row.team_id}`;
    const oddN = m.oddzial_nazwa || `oddział #${row.oddzial_id}`;
    const cash = Math.round((Number(row.declared_cash) || 0) * 100) / 100;
    const msg =
      label === '48h'
        ? `${oddN}: wpis kasy (${teamN}, ${row.pickup_date}) ${cash} PLN — brak potwierdzenia odbioru od 48 h.`
        : `${oddN}: PILNE — kasa (${teamN}, ${row.pickup_date}) ${cash} PLN nieodebrana od 7 dni.`;
    const { rows: recipients } = await pool.query(
      `SELECT id, telefon, email FROM users WHERE aktywny IS NOT FALSE AND (
         rola IN ('Prezes','Dyrektor')
         OR (rola = 'Kierownik' AND oddzial_id = $1)
       )`,
      [row.oddzial_id]
    );
    const smsBody = msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
    const subject =
      label === '48h'
        ? `[ARBOR] Kasa oddziału — przypomnienie 48 h (${oddN})`
        : `[ARBOR] PILNE: kasa oddziału 7 dni (${oddN})`;
    const esc = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
    const html = `<p style="font-family:system-ui,sans-serif">${esc(msg)}</p>`;
    for (const u of recipients) {
      await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
         VALUES (NULL, $1, NULL, $2, $3, 'Nowe')`,
        [u.id, typ, msg]
      );
      if (smsOn && u.telefon) {
        await sendSmsOptional({ to: u.telefon, body: smsBody, taskId: null });
      }
      if (emailOn && u.email && String(u.email).trim()) {
        const r = await sendSystemEmailOptional({
          to: String(u.email).trim(),
          subject,
          text: msg,
          html,
        });
        if (r.sent) {
          if (label === '48h') emailSent48 += 1;
          else emailSent7 += 1;
        }
      }
    }
  };

  try {
    const r48 = await pool.query(
      `UPDATE branch_cash_pickups p
       SET cash_reminder_48h_sent_at = NOW()
       FROM (
         SELECT id FROM branch_cash_pickups
         WHERE received_at IS NULL
           AND created_at <= NOW() - INTERVAL '48 hours'
           AND cash_reminder_48h_sent_at IS NULL
         ORDER BY id
         LIMIT 80
       ) sub
       WHERE p.id = sub.id
       RETURNING p.id, p.oddzial_id, p.team_id, p.pickup_date, p.declared_cash`
    );
    for (const row of r48.rows) {
      await notifyForPickup(row, '48h');
    }

    const r7 = await pool.query(
      `UPDATE branch_cash_pickups p
       SET cash_reminder_7d_sent_at = NOW()
       FROM (
         SELECT id FROM branch_cash_pickups
         WHERE received_at IS NULL
           AND created_at <= NOW() - INTERVAL '7 days'
           AND cash_reminder_7d_sent_at IS NULL
         ORDER BY id
         LIMIT 80
       ) sub
       WHERE p.id = sub.id
       RETURNING p.id, p.oddzial_id, p.team_id, p.pickup_date, p.declared_cash`
    );
    for (const row of r7.rows) {
      await notifyForPickup(row, '7d');
    }

    res.json({
      reminded_48h: r48.rows.length,
      reminded_7d: r7.rows.length,
      email_reminders_48h: emailSent48,
      email_reminders_7d: emailSent7,
    });
  } catch (e) {
    if (String(e.message || '').includes('cash_reminder')) {
      return res.status(503).json({ error: 'Uruchom migrację (kolumny cash_reminder_* na branch_cash_pickups).' });
    }
    logger.error('ops payroll-cash-reminder-tick', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
