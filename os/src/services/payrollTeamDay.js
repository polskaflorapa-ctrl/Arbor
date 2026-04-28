const logger = require('../config/logger');
const { isPlPublicHoliday } = require('../lib/plPublicHolidays');

/** F11.4 — kontekst dnia: zlecenia z pracą w danym dniu, kasa z płatności klienta, liczba incydentów. */
async function loadTeamDayEnrichment(pool, teamId, reportDate) {
  const tasksR = await pool.query(
    `SELECT DISTINCT t.id, t.klient_nazwa, t.status,
            t.wartosc_netto_do_rozliczenia::numeric AS wartosc_netto_do_rozliczenia,
            t.data_planowana::text AS data_planowana
     FROM tasks t
     JOIN work_logs wl ON wl.task_id = t.id AND wl.end_time IS NOT NULL
       AND (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date = $2::date
     WHERE t.ekipa_id = $1
     ORDER BY t.id`,
    [teamId, reportDate]
  );
  let cashByForma;
  try {
    const cashR = await pool.query(
      `SELECT p.forma_platnosc,
              COALESCE(SUM(p.kwota_odebrana),0)::numeric(14,2) AS sum_kwota,
              COUNT(*)::int AS cnt
       FROM task_client_payments p
       INNER JOIN tasks t ON t.id = p.task_id
       WHERE t.ekipa_id = $1
         AND EXISTS (
           SELECT 1 FROM work_logs wl
           WHERE wl.task_id = t.id AND wl.end_time IS NOT NULL
             AND (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date = $2::date
         )
       GROUP BY p.forma_platnosc`,
      [teamId, reportDate]
    );
    cashByForma = cashR.rows;
  } catch {
    cashByForma = [];
  }
  let issuesCount;
  try {
    const iss = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM issues i
       JOIN tasks t ON t.id = i.task_id
       WHERE t.ekipa_id = $1
         AND (i.created_at AT TIME ZONE 'Europe/Warsaw')::date = $2::date`,
      [teamId, reportDate]
    );
    issuesCount = iss.rows[0]?.c ?? 0;
  } catch {
    issuesCount = 0;
  }
  return {
    tasks_day: tasksR.rows,
    cash_by_forma: cashByForma,
    issues_count: issuesCount,
  };
}

const OVERTIME_MULT = () => {
  const n = parseFloat(process.env.PAYROLL_OVERTIME_MULT || '1.5', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1.5;
};

/** Godziny 0–23: początek „pory nocnej” wieczorem, koniec rano (np. 22 i 6 → 22:00–06:00). */
function nightBandHoursFromEnv() {
  let startH = parseInt(process.env.PAYROLL_NIGHT_START_HOUR ?? '22', 10);
  let endH = parseInt(process.env.PAYROLL_NIGHT_END_HOUR ?? '6', 10);
  if (!Number.isFinite(startH)) startH = 22;
  if (!Number.isFinite(endH)) endH = 6;
  startH = Math.max(0, Math.min(23, startH));
  endH = Math.max(0, Math.min(23, endH));
  if (startH === endH) startH = 22;
  return { startH, endH };
}

/**
 * F11.4 — blokada edycji / przeliczenia: zatwierdzony raport lub minął opcjonalny okres korekt.
 * @param {{ approved_at?: any, first_closed_at?: any } | null | undefined} row
 */
function assertTeamDayReportOpenForManualEdit(row) {
  if (!row) return;
  if (row.approved_at) {
    const err = new Error('PAYROLL_REPORT_APPROVED');
    err.code = 'PAYROLL_REPORT_APPROVED';
    throw err;
  }
  const correctionHours = parseFloat(process.env.PAYROLL_TEAM_DAY_CORRECTION_HOURS || '', 10);
  if (Number.isFinite(correctionHours) && correctionHours > 0 && row.first_closed_at) {
    const elapsedMs = Date.now() - new Date(row.first_closed_at).getTime();
    if (elapsedMs > correctionHours * 3600000) {
      const err = new Error('PAYROLL_CORRECTION_WINDOW_CLOSED');
      err.code = 'PAYROLL_CORRECTION_WINDOW_CLOSED';
      throw err;
    }
  }
}

/**
 * F11.2 / F11.4 — raport dnia ekipy: godziny × stawka, weekend × wm, święta PL × hm,
 * nadgodziny (>8 h/dzień) × PAYROLL_OVERTIME_MULT (domyślnie 1.5) na części proporcjonalnej,
 * praca nocna: okna [D−1 22:00, D 06:00) ∪ [D 22:00, D+1 06:00) w Europe/Warsaw × night_multiplier (weekend × wm).
 */
async function buildTeamDayReport(pool, teamId, reportDate) {
  const ymd = String(reportDate).slice(0, 10);

  const existingQ = await pool.query(
    `SELECT approved_at, first_closed_at FROM payroll_team_day_reports WHERE team_id = $1 AND report_date = $2::date`,
    [teamId, ymd]
  );
  const ex = existingQ.rows[0];
  assertTeamDayReportOpenForManualEdit(ex);

  const teamR = await pool.query(`SELECT oddzial_id FROM teams WHERE id = $1`, [teamId]);
  const oddzialId = teamR.rows[0]?.oddzial_id;
  if (!oddzialId) throw new Error('Brak ekipy');
  const holidayDay = isPlPublicHoliday(ymd);
  const otMult = OVERTIME_MULT();
  const { startH: nightStartH, endH: nightEndH } = nightBandHoursFromEnv();

  const hoursAgg = await pool.query(
    `WITH raw AS (
       SELECT wl.user_id,
              wl.start_time AS st,
              wl.end_time AS en,
              COALESCE(
                NULLIF(wl.duration_hours, 0),
                NULLIF(wl.czas_pracy_minuty, 0)::numeric / 60,
                CASE
                  WHEN wl.end_time IS NOT NULL AND wl.start_time IS NOT NULL THEN
                    (EXTRACT(EPOCH FROM (wl.end_time - wl.start_time)) / 3600.0)::numeric(14,6)
                END,
                0
              )::numeric(14,6) AS dur_h,
              EXTRACT(ISODOW FROM (wl.start_time AT TIME ZONE 'Europe/Warsaw'))::int AS dow,
              (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date AS d_waw
         FROM work_logs wl
         JOIN tasks t ON t.id = wl.task_id
        WHERE t.ekipa_id = $1
          AND wl.end_time IS NOT NULL
          AND (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date = $2::date
     ),
     seg AS (
       SELECT *,
              (((d_waw::timestamp - interval '1 day') + make_interval(hours => $3::int)) AT TIME ZONE 'Europe/Warsaw') AS w1s,
              ((d_waw::timestamp + make_interval(hours => $4::int)) AT TIME ZONE 'Europe/Warsaw') AS w1e,
              ((d_waw::timestamp + make_interval(hours => $3::int)) AT TIME ZONE 'Europe/Warsaw') AS w2s,
              (((d_waw::timestamp + interval '1 day') + make_interval(hours => $4::int)) AT TIME ZONE 'Europe/Warsaw') AS w2e
         FROM raw
     ),
     seg2 AS (
       SELECT *,
              GREATEST(
                0,
                LEAST(
                  EXTRACT(EPOCH FROM (LEAST(en, w1e) - GREATEST(st, w1s))) / 3600.0,
                  9999::numeric
                )
              )::numeric(14,6) AS o1,
              GREATEST(
                0,
                LEAST(
                  EXTRACT(EPOCH FROM (LEAST(en, w2e) - GREATEST(st, w2s))) / 3600.0,
                  9999::numeric
                )
              )::numeric(14,6) AS o2
         FROM seg
     ),
     seg3 AS (
       SELECT *,
              LEAST(dur_h, (o1 + o2))::numeric(14,6) AS night_h,
              GREATEST(0, (dur_h - LEAST(dur_h, (o1 + o2))))::numeric(14,6) AS day_h
         FROM seg2
     )
     SELECT user_id,
            SUM(CASE WHEN dow < 6 THEN day_h ELSE 0 END)::numeric(12,4) AS h_day_wd,
            SUM(CASE WHEN dow >= 6 THEN day_h ELSE 0 END)::numeric(12,4) AS h_day_we,
            SUM(CASE WHEN dow < 6 THEN night_h ELSE 0 END)::numeric(12,4) AS h_night_wd,
            SUM(CASE WHEN dow >= 6 THEN night_h ELSE 0 END)::numeric(12,4) AS h_night_we,
            SUM(dur_h)::numeric(12,4) AS hours_total
       FROM seg3
      GROUP BY user_id`,
    [teamId, ymd, nightStartH, nightEndH]
  );

  const lines = [];
  for (const row of hoursAgg.rows) {
    const rateR = await pool.query(
      `SELECT rate_pln_per_hour, weekend_multiplier, night_multiplier, holiday_multiplier, alpine_addon_pln
       FROM user_payroll_rates
       WHERE user_id = $1 AND effective_from <= $2::date
       ORDER BY effective_from DESC LIMIT 1`,
      [row.user_id, ymd]
    );
    const r = rateR.rows[0] || {};
    const rate = Number(r.rate_pln_per_hour) || 0;
    const wm = Number(r.weekend_multiplier) > 0 ? Number(r.weekend_multiplier) : 1.25;
    const hm = Number(r.holiday_multiplier) > 0 ? Number(r.holiday_multiplier) : 1.5;
    const nm = Number(r.night_multiplier) > 0 ? Number(r.night_multiplier) : 1.15;
    const dWd = Number(row.h_day_wd) || 0;
    const dWe = Number(row.h_day_we) || 0;
    const nWd = Number(row.h_night_wd) || 0;
    const nWe = Number(row.h_night_we) || 0;
    const T = Math.round((dWd + dWe + nWd + nWe) * 100) / 100;
    const hd = Math.round((dWd + nWd) * 100) / 100;
    const hw = Math.round((dWe + nWe) * 100) / 100;
    const normalT = Math.min(T, 8);
    const otT = Math.max(0, T - 8);
    const alpine = Number(r.alpine_addon_pln || 0) || 0;

    let pay;
    if (holidayDay) {
      pay = T * rate * hm + alpine;
    } else if (T <= 0) {
      pay = alpine;
    } else {
      const multWd = 1;
      const multWe = wm;
      const multNWd = nm;
      const multNWe = wm * nm;
      const parts = [
        { h: dWd, m: multWd },
        { h: dWe, m: multWe },
        { h: nWd, m: multNWd },
        { h: nWe, m: multNWe },
      ];
      let payAcc = 0;
      for (const p of parts) {
        if (p.h <= 0) continue;
        const nrm = normalT * (p.h / T);
        const ot = otT * (p.h / T);
        payAcc += nrm * rate * p.m + ot * rate * p.m * otMult;
      }
      pay = payAcc + alpine;
    }
    pay = Math.round(pay * 100) / 100;
    const hoursTotal = T;

    lines.push({
      user_id: row.user_id,
      hours_total: hoursTotal,
      hours_weekday: hd,
      hours_weekend: hw,
      hours_day_weekday: dWd,
      hours_day_weekend: dWe,
      hours_night_weekday: nWd,
      hours_night_weekend: nWe,
      hours_normal: normalT,
      hours_overtime: otT,
      rate_pln_per_hour: rate,
      weekend_multiplier: wm,
      night_multiplier: nm,
      holiday_multiplier: hm,
      holiday_calendar: holidayDay,
      overtime_multiplier: holidayDay ? null : otMult,
      night_band_hours: { start: nightStartH, end: nightEndH },
      pay_pln: pay,
    });
  }

  let enrichment = { tasks_day: [], cash_by_forma: [], issues_count: 0 };
  try {
    enrichment = await loadTeamDayEnrichment(pool, teamId, ymd);
  } catch (e) {
    logger.warn('payroll.teamDay.enrichment', { message: e.message, teamId, reportDate: ymd });
  }
  const payload = {
    team_id: teamId,
    report_date: ymd,
    holiday_calendar: holidayDay,
    overtime_mult: holidayDay ? null : otMult,
    lines,
    ...enrichment,
    generated_at: new Date().toISOString(),
  };
  const rep = await pool.query(
    `INSERT INTO payroll_team_day_reports (team_id, oddzial_id, report_date, payload_json, first_closed_at)
     VALUES ($1,$2,$3,$4::jsonb, NOW())
     ON CONFLICT (team_id, report_date) DO UPDATE SET
       payload_json = EXCLUDED.payload_json,
       created_at = NOW(),
       first_closed_at = COALESCE(payroll_team_day_reports.first_closed_at, EXCLUDED.first_closed_at)
     RETURNING *`,
    [teamId, oddzialId, ymd, JSON.stringify(payload)]
  );
  const reportId = rep.rows[0].id;
  await pool.query(`DELETE FROM payroll_team_day_report_lines WHERE report_id = $1`, [reportId]);
  for (const ln of lines) {
    await pool.query(
      `INSERT INTO payroll_team_day_report_lines (report_id, user_id, hours_total, pay_pln, detail_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        reportId,
        ln.user_id,
        ln.hours_total,
        ln.pay_pln,
        JSON.stringify({
          rate: ln.rate_pln_per_hour,
          hours_weekday: ln.hours_weekday,
          hours_weekend: ln.hours_weekend,
          hours_day_weekday: ln.hours_day_weekday,
          hours_day_weekend: ln.hours_day_weekend,
          hours_night_weekday: ln.hours_night_weekday,
          hours_night_weekend: ln.hours_night_weekend,
          hours_normal: ln.hours_normal,
          hours_overtime: ln.hours_overtime,
          weekend_multiplier: ln.weekend_multiplier,
          night_multiplier: ln.night_multiplier,
          night_band_hours: ln.night_band_hours,
          holiday_multiplier: ln.holiday_multiplier,
          holiday_calendar: ln.holiday_calendar,
          overtime_multiplier: ln.overtime_multiplier,
        }),
      ]
    );
  }
  return { report: rep.rows[0], lines };
}

/**
 * Po zakończeniu zlecenia: jeśli to było ostatnie niezakończone zlecenie ekipy na ten dzień planu — generuj raport dnia.
 */
async function tryAutoTeamDayCloseAfterTaskFinish(pool, taskId) {
  const { rows } = await pool.query(`SELECT ekipa_id, data_planowana::text AS dp FROM tasks WHERE id = $1`, [taskId]);
  const task = rows[0];
  if (!task?.ekipa_id || !task.dp) return null;
  const reportDate = String(task.dp).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;
  const c = await pool.query(
    `SELECT COUNT(*)::int AS c FROM tasks
     WHERE ekipa_id = $1 AND (data_planowana::date = $2::date) AND status NOT IN ('Zakonczone', 'Anulowane')`,
    [task.ekipa_id, reportDate]
  );
  if ((c.rows[0]?.c || 0) > 0) return null;
  try {
    const out = await buildTeamDayReport(pool, task.ekipa_id, reportDate);
    logger.info('payroll.autoTeamDayReport', { team_id: task.ekipa_id, report_date: reportDate, report_id: out.report?.id });
    return out;
  } catch (e) {
    if (e.code === 'PAYROLL_REPORT_APPROVED' || e.code === 'PAYROLL_CORRECTION_WINDOW_CLOSED') {
      logger.info('payroll.autoTeamDayReport.skip', { code: e.code, team_id: task.ekipa_id, report_date: reportDate });
      return null;
    }
    logger.warn('payroll.autoTeamDayReport.fail', { message: e.message, team_id: task.ekipa_id, report_date: reportDate });
    return null;
  }
}

module.exports = {
  buildTeamDayReport,
  tryAutoTeamDayCloseAfterTaskFinish,
  loadTeamDayEnrichment,
  assertTeamDayReportOpenForManualEdit,
};
