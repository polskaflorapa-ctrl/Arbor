/**
 * M11 — rozliczenia i wynagrodzenia (API szkielet: stawki, dniówka/dzień, raport, eksport CSV, kasa).
 */
const express = require('express');
const crypto = require('crypto');
const archiver = require('archiver');
const archiverZipEncrypted = require('archiver-zip-encrypted');
const pool = require('../config/database');
const { env } = require('../config/env');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const { buildTeamDayReport, assertTeamDayReportOpenForManualEdit } = require('../services/payrollTeamDay');
const { notifyPayrollTeamDayApproved } = require('../services/payrollNotify');

const router = express.Router();
router.use(authMiddleware);

/** F11.7 — rejestracja formatu (wielokrotne wywołanie rzuca). */
let payrollZipEncryptedFormatRegistered = false;
function ensurePayrollZipEncryptedFormat() {
  if (payrollZipEncryptedFormatRegistered) return;
  archiver.registerFormat('zip-encrypted', archiverZipEncrypted);
  payrollZipEncryptedFormatRegistered = true;
}

function payrollZipPasswordFromEnv() {
  const p = process.env.PAYROLL_ZIP_PASSWORD;
  if (p == null) return null;
  const s = String(p).trim();
  return s.length ? s : null;
}

function payrollZipEncryptionMethodFromEnv() {
  const m = String(process.env.PAYROLL_ZIP_ENCRYPTION_METHOD || 'aes256').toLowerCase();
  return m === 'zip20' || m === 'legacy' ? 'zip20' : 'aes256';
}

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';

function canFieldTeamCloseDay(u, teamId) {
  const tid = Number(teamId);
  if (!Number.isFinite(tid)) return false;
  if (u.rola === 'Brygadzista' && Number(u.ekipa_id) === tid) return true;
  if (u.rola === 'Pomocnik' && Number(u.ekipa_id) === tid) return true;
  return false;
}

/** F11.7 — raporty dnia w miesiącu bez zatwierdzenia (blokada eksportu). */
async function listPendingTeamDayReportsForMonth(pool, monthYmdStart, user) {
  const raw = monthYmdStart ? String(monthYmdStart) : '';
  const from = raw.length >= 7 ? `${raw.slice(0, 7)}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  let sql = `SELECT r.id, r.team_id, r.report_date, r.oddzial_id
     FROM payroll_team_day_reports r
     WHERE r.report_date >= $1::date AND r.report_date < ($1::date + INTERVAL '1 month')
       AND r.approved_at IS NULL`;
  const params = [from];
  if (isKierownik(user)) {
    sql += ` AND r.oddzial_id = $2`;
    params.push(user.oddzial_id);
  }
  sql += ` ORDER BY r.report_date, r.team_id`;
  const { rows } = await pool.query(sql, params);
  return { from, rows };
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

const reportLineParams = z.object({
  reportId: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive(),
});

const linePatchSchema = z
  .object({
    pay_pln: z.coerce.number().min(0).optional(),
    hours_total: z.coerce.number().min(0).optional(),
    correction_note: z.string().max(500).optional(),
  })
  .refine((b) => b.pay_pln !== undefined || b.hours_total !== undefined, {
    message: 'Podaj pay_pln lub hours_total',
  });

/** Dostęp do raportu dnia — jak przy zatwierdzaniu (F11.4 / approve). */
function ensureUserCanAccessTeamDayReport(req, report) {
  if (!isDyrektor(req.user) && !isKierownik(req.user) && req.user.rola !== 'Brygadzista') {
    return { status: 403, body: { error: 'Brak uprawnień' } };
  }
  if (isKierownik(req.user) && Number(req.user.oddzial_id) !== Number(report.oddzial_id)) {
    return { status: 403, body: { error: 'Inny oddział' } };
  }
  if (req.user.rola === 'Brygadzista' && req.user.ekipa_id) {
    if (Number(report.team_id) !== Number(req.user.ekipa_id)) {
      return { status: 403, body: { error: 'Brak dostępu do tej ekipy' } };
    }
  }
  return null;
}

const rateBodySchema = z.object({
  user_id: z.coerce.number().int().positive(),
  effective_from: z.string().max(32).optional(),
  rate_pln_per_hour: z.coerce.number().positive(),
  role_scope: z.enum(['pomocnik', 'brygadzista', 'specjalista']).optional(),
  weekend_multiplier: z.coerce.number().min(1).max(5).optional(),
  night_multiplier: z.coerce.number().min(1).max(5).optional(),
  holiday_multiplier: z.coerce.number().min(1).max(5).optional(),
  alpine_addon_pln: z.coerce.number().min(0).optional(),
});

const dayCloseSchema = z.object({
  team_id: z.coerce.number().int().positive(),
  report_date: z.string().max(32),
});

const cashPickupSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
  team_id: z.coerce.number().int().positive(),
  pickup_date: z.string().max(32),
  declared_cash: z.coerce.number().min(0),
});

const monthQuerySchema = z.object({
  month: z.string().max(12).optional(),
});

const exportQuerySchema = z.object({
  month: z.string().max(12).optional(),
  format: z.enum(['csv', 'symfonia', 'optima', 'comarch']).optional(),
});

function escCsv(s) {
  const t = s == null ? '' : String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** F11.7 — manifest integralności paczki ZIP (SHA-256 plików; opcj. HMAC z `PAYROLL_ZIP_MANIFEST_HMAC_SECRET`). */
function buildPayrollZipManifest(ym, namedBuffers) {
  const files = namedBuffers.map(({ name, buf }) => ({
    name,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size_bytes: buf.length,
  }));
  const core = {
    format_version: 1,
    payroll_month: ym,
    generated_at: new Date().toISOString(),
    files,
  };
  const canonical = JSON.stringify(core);
  const out = { ...core };
  const secret = env.PAYROLL_ZIP_MANIFEST_HMAC_SECRET;
  if (secret) {
    out.hmac_sha256 = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

function empCols(x) {
  const dz = x.prac_data_zatrudnienia ? String(x.prac_data_zatrudnienia).slice(0, 10) : '';
  return {
    im: x.prac_imie || '',
    nz: x.prac_nazwisko || '',
    st: x.prac_stanowisko || '',
    dz,
    lg: x.prac_login || '',
  };
}

function symSemi(s) {
  return String(s || '').replace(/;/g, ',');
}

function comPipe(s) {
  return String(s || '').replace(/\|/g, '/');
}

function payrollExportText(rows, format) {
  const f = format || 'csv';
  if (f === 'symfonia') {
    const head =
      'Data;Ekipa;Pracownik_ID;Godziny;Kwota_PLN;Imie;Nazwisko;Stanowisko;Data_zatrudnienia;Login\n';
    const body = rows
      .map((x) => {
        const e = empCols(x);
        return `${x.report_date};${x.team_id};${x.user_id};${String(x.hours_total).replace('.', ',')};${String(x.pay_pln).replace('.', ',')};${symSemi(e.im)};${symSemi(e.nz)};${symSemi(e.st)};${e.dz};${symSemi(e.lg)}`;
      })
      .join('\n');
    return head + body;
  }
  if (f === 'optima') {
    const head =
      'LP,DataRaportu,IdEkipy,IdPracownika,Godziny,Kwota,Imie,Nazwisko,Stanowisko,Data_zatrudnienia,Login\n';
    const body = rows
      .map((x, i) => {
        const e = empCols(x);
        return `${i + 1},${x.report_date},${x.team_id},${x.user_id},${x.hours_total},${x.pay_pln},${escCsv(e.im)},${escCsv(e.nz)},${escCsv(e.st)},${e.dz},${escCsv(e.lg)}`;
      })
      .join('\n');
    return head + body;
  }
  if (f === 'comarch') {
    const head = 'Nagłowek|Wersja=1|Typ=Etap\n';
    const body = rows
      .map((x) => {
        const e = empCols(x);
        return `LINIA|${x.report_date}|${x.team_id}|${x.user_id}|${x.hours_total}|${x.pay_pln}|${comPipe(e.im)}|${comPipe(e.nz)}|${comPipe(e.st)}|${e.dz}|${comPipe(e.lg)}`;
      })
      .join('\n');
    return head + body;
  }
  const head =
    'report_date,team_id,user_id,hours_total,pay_pln,prac_imie,prac_nazwisko,prac_stanowisko,prac_data_zatrudnienia,prac_login\n';
  const body = rows
    .map((x) => {
      const e = empCols(x);
      return `${x.report_date},${x.team_id},${x.user_id},${x.hours_total},${x.pay_pln},${escCsv(e.im)},${escCsv(e.nz)},${escCsv(e.st)},${e.dz},${escCsv(e.lg)}`;
    })
    .join('\n');
  return head + body;
}

function exportBlockedError(pending) {
  const e = new Error('PAYROLL_EXPORT_PENDING');
  e.code = 'PAYROLL_EXPORT_PENDING_APPROVALS';
  e.pending_reports = pending;
  return e;
}

async function assertPayrollMonthExportAllowed(pool, monthRaw, user) {
  if (process.env.PAYROLL_EXPORT_SKIP_APPROVAL_CHECK === '1') return;
  const { rows: pending } = await listPendingTeamDayReportsForMonth(pool, monthRaw, user);
  if (pending.length > 0) throw exportBlockedError(pending);
}

const CORRECTION_LOG_JSON_LIMIT = 500;
const CORRECTION_LOG_CSV_LIMIT = 10000;

const CORRECTION_LOG_CSV_COLUMNS = [
  'id',
  'created_at',
  'report_date',
  'team_id',
  'oddzial_id',
  'line_id',
  'report_id',
  'target_user_id',
  'target_imie',
  'target_nazwisko',
  'edited_by',
  'editor_imie',
  'editor_nazwisko',
  'prev_hours_total',
  'prev_pay_pln',
  'new_hours_total',
  'new_pay_pln',
  'correction_note',
];

function correctionLogCellForCsv(val, key) {
  if (val == null) return '';
  if (key === 'created_at' && val instanceof Date) return val.toISOString();
  return val;
}

function correctionLogRowsToCsv(rows) {
  const header = CORRECTION_LOG_CSV_COLUMNS.map(escCsv).join(',');
  const body = rows
    .map((r) =>
      CORRECTION_LOG_CSV_COLUMNS.map((key) => escCsv(correctionLogCellForCsv(r[key], key))).join(',')
    )
    .join('\n');
  return `\uFEFF${header}\n${body}\n`;
}

/** @param {import('pg').Pool} pool */
async function queryLineCorrectionLogRows(pool, monthRaw, user, limit) {
  const lim = Math.min(Math.max(Number(limit) || CORRECTION_LOG_JSON_LIMIT, 1), 20000);
  const raw = monthRaw != null && monthRaw !== undefined ? String(monthRaw) : '';
  const from =
    raw.length >= 7 ? `${raw.slice(0, 7)}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  let sql = `SELECT c.id, c.created_at, c.line_id, c.report_id, c.target_user_id, c.edited_by,
         c.prev_pay_pln, c.prev_hours_total, c.new_pay_pln, c.new_hours_total, c.correction_note,
         r.report_date::text AS report_date, r.team_id, r.oddzial_id,
         e.imie AS editor_imie, e.nazwisko AS editor_nazwisko,
         t.imie AS target_imie, t.nazwisko AS target_nazwisko
       FROM payroll_line_correction_log c
       JOIN payroll_team_day_reports r ON r.id = c.report_id
       LEFT JOIN users e ON e.id = c.edited_by
       LEFT JOIN users t ON t.id = c.target_user_id
       WHERE r.report_date >= $1::date AND r.report_date < ($1::date + INTERVAL '1 month')`;
  const params = [from];
  if (isKierownik(user)) {
    sql += ` AND r.oddzial_id = $2`;
    params.push(user.oddzial_id);
  }
  sql += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1}`;
  params.push(lim);
  const { rows } = await pool.query(sql, params);
  const ym = from.slice(0, 7);
  return { ym, from, rows };
}

async function queryPayrollMonthExportRows(pool, monthRaw, user) {
  const raw = monthRaw ? String(monthRaw) : '';
  const ym = raw.length >= 7 ? raw.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const from = `${ym}-01`;
  let where = `r.report_date >= $1::date AND r.report_date < ($1::date + INTERVAL '1 month')`;
  const params = [from];
  if (isKierownik(user)) {
    where += ` AND r.oddzial_id = $2`;
    params.push(user.oddzial_id);
  }
  const { rows } = await pool.query(
    `SELECT r.report_date, r.team_id, l.user_id, l.hours_total, l.pay_pln,
            u.imie AS prac_imie, u.nazwisko AS prac_nazwisko, u.stanowisko AS prac_stanowisko,
            u.data_zatrudnienia::text AS prac_data_zatrudnienia, u.login AS prac_login
     FROM payroll_team_day_reports r
     JOIN payroll_team_day_report_lines l ON l.report_id = r.id
     LEFT JOIN users u ON u.id = l.user_id
     WHERE ${where}
     ORDER BY r.report_date, r.team_id`,
    params
  );
  return { ym, rows };
}

/** F11.2 — zapis kopii linii wysłanych w eksporcie (wyłączenie: `PAYROLL_EXPORT_SNAPSHOT=0`). */
async function recordDailyPayrollSnapshot(pool, { ym, rows, exportedBy, kind }) {
  if (process.env.PAYROLL_EXPORT_SNAPSHOT === '0') return;
  if (!rows || rows.length === 0) return;
  const batch = crypto.randomUUID();
  const monthDate = `${ym}-01`;
  const chunkSize = 250;
  for (let off = 0; off < rows.length; off += chunkSize) {
    const slice = rows.slice(off, off + chunkSize);
    const values = [];
    const params = [];
    let n = 1;
    for (const r of slice) {
      values.push(
        `($${n++}::date,$${n++}::uuid,$${n++},$${n++},$${n++}::date,$${n++},$${n++},$${n++},$${n++})`
      );
      params.push(
        monthDate,
        batch,
        kind,
        exportedBy,
        r.report_date,
        r.team_id,
        r.user_id,
        r.hours_total,
        r.pay_pln
      );
    }
    await pool.query(
      `INSERT INTO daily_payroll (payroll_month, export_batch_id, export_kind, exported_by, report_date, team_id, user_id, hours_total, pay_pln) VALUES ${values.join(',')}`,
      params
    );
  }
}

/** F11.1 — lista stawek użytkownika (historia). */
router.get('/rates/user/:id', validateParams(idParam), async (req, res) => {
  try {
    const uid = req.params.id;
    if (!isDyrektor(req.user) && !isKierownik(req.user) && Number(req.user.id) !== Number(uid)) {
      return res.status(403).json({ error: 'Brak dostępu' });
    }
    if (isKierownik(req.user) && Number(req.user.oddzial_id)) {
      const ok = await pool.query(
        `SELECT 1 FROM users WHERE id = $1 AND oddzial_id = $2`,
        [uid, req.user.oddzial_id]
      );
      if (!ok.rows[0]) return res.status(403).json({ error: 'Inny oddział' });
    }
    const { rows } = await pool.query(
      `SELECT * FROM user_payroll_rates WHERE user_id = $1 ORDER BY effective_from DESC, id DESC`,
      [uid]
    );
    res.json(rows);
  } catch (e) {
    if (String(e.message || '').includes('user_payroll_rates')) {
      return res.status(503).json({ error: 'Uruchom migrację (user_payroll_rates).' });
    }
    logger.error('payroll.rates', { message: e.message });
    res.status(500).json({ error: 'Błąd' });
  }
});

/** F11.1 — dodanie nowej stawki (wersjonowanie po effective_from). */
router.post('/rates', validateBody(rateBodySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const b = req.body;
    if (isKierownik(req.user)) {
      const ok = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND oddzial_id = $2`, [
        b.user_id,
        req.user.oddzial_id,
      ]);
      if (!ok.rows[0]) return res.status(403).json({ error: 'Inny oddział' });
    }
    const from = b.effective_from || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `INSERT INTO user_payroll_rates (
        user_id, effective_from, rate_pln_per_hour, role_scope,
        weekend_multiplier, night_multiplier, holiday_multiplier, alpine_addon_pln, created_by
      ) VALUES ($1,$2::date,$3,$4,COALESCE($5,1.25),COALESCE($6,1.15),COALESCE($7,1.5),COALESCE($8,0),$9) RETURNING *`,
      [
        b.user_id,
        from,
        b.rate_pln_per_hour,
        b.role_scope || 'pomocnik',
        b.weekend_multiplier ?? null,
        b.night_multiplier ?? null,
        b.holiday_multiplier ?? null,
        b.alpine_addon_pln ?? null,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('payroll.rates.post', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.2 + F11.4 — zbuduj raport dnia ekipy (jedna ścieżka kodu: `buildTeamDayReport`). */
router.post('/team-day-close', validateBody(dayCloseSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user) && !canFieldTeamCloseDay(req.user, req.body.team_id)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const { team_id, report_date } = req.body;
    const teamR = await pool.query(`SELECT oddzial_id FROM teams WHERE id = $1`, [team_id]);
    const oddzialId = teamR.rows[0]?.oddzial_id;
    if (!oddzialId) return res.status(404).json({ error: 'Brak ekipy' });
    if (isKierownik(req.user) && Number(req.user.oddzial_id) !== Number(oddzialId)) {
      return res.status(403).json({ error: 'Inny oddział' });
    }
    const out = await buildTeamDayReport(pool, team_id, report_date);
    res.json(out);
  } catch (e) {
    if (e.code === 'PAYROLL_REPORT_APPROVED') {
      return res.status(409).json({ error: 'Raport dnia jest zatwierdzony — nie można go przeliczyć.', code: e.code });
    }
    if (e.code === 'PAYROLL_CORRECTION_WINDOW_CLOSED') {
      return res.status(409).json({
        error: 'Minął dozwolony okres korekty raportu. Skontaktuj się z kierownikiem lub administratorem.',
        code: e.code,
      });
    }
    if (String(e.message || '').includes('payroll_team_day_reports')) {
      return res.status(503).json({ error: 'Uruchom migrację M11.' });
    }
    logger.error('payroll.team-day-close', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

router.post('/team-day-report/:id/approve', validateParams(idParam), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user) && req.user.rola !== 'Brygadzista') {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const repQ = await pool.query(
      `SELECT id, oddzial_id, team_id, approved_at FROM payroll_team_day_reports WHERE id = $1`,
      [req.params.id]
    );
    const existing = repQ.rows[0];
    if (!existing) return res.status(404).json({ error: 'Brak raportu' });
    if (existing.approved_at) return res.status(400).json({ error: 'Raport był już zatwierdzony' });

    if (isKierownik(req.user) && Number(req.user.oddzial_id) !== Number(existing.oddzial_id)) {
      return res.status(403).json({ error: 'Inny oddział' });
    }
    if (req.user.rola === 'Brygadzista' && req.user.ekipa_id) {
      if (Number(existing.team_id) !== Number(req.user.ekipa_id)) {
        return res.status(403).json({ error: 'Brak dostępu do tej ekipy' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE payroll_team_day_reports SET approved_at = NOW(), approved_by = $1
       WHERE id = $2 AND approved_at IS NULL RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'Stan raportu zmienił się — odśwież i spróbuj ponownie.' });
    }
    await notifyPayrollTeamDayApproved(pool, req.user.id, Number(req.params.id));
    res.json(rows[0]);
  } catch (e) {
    logger.error('payroll.approve', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.4 — lista raportów dnia w miesiącu (z liniami) — kierownik / dyrektor. */
router.get('/team-day-reports', validateQuery(monthQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const raw = req.query.month ? String(req.query.month) : '';
    const from =
      raw.length >= 7 ? `${raw.slice(0, 7)}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    let sql = `SELECT r.id, r.team_id, r.oddzial_id, r.report_date::text AS report_date, r.approved_at, r.first_closed_at, r.created_at,
         t.nazwa AS team_nazwa
       FROM payroll_team_day_reports r
       LEFT JOIN teams t ON t.id = r.team_id
       WHERE r.report_date >= $1::date AND r.report_date < ($1::date + INTERVAL '1 month')`;
    const params = [from];
    if (isKierownik(req.user)) {
      sql += ` AND r.oddzial_id = $2`;
      params.push(req.user.oddzial_id);
    }
    sql += ` ORDER BY r.report_date, r.team_id`;
    const { rows: reports } = await pool.query(sql, params);
    if (reports.length === 0) return res.json([]);
    const ids = reports.map((r) => r.id);
    const { rows: lines } = await pool.query(
      `SELECT l.id, l.report_id, l.user_id, l.hours_total, l.pay_pln, l.detail_json,
              u.imie AS user_imie, u.nazwisko AS user_nazwisko
       FROM payroll_team_day_report_lines l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.report_id = ANY($1::int[])
       ORDER BY l.report_id, l.user_id`,
      [ids]
    );
    const byRid = {};
    for (const ln of lines) {
      if (!byRid[ln.report_id]) byRid[ln.report_id] = [];
      byRid[ln.report_id].push(ln);
    }
    res.json(reports.map((r) => ({ ...r, lines: byRid[r.id] || [] })));
  } catch (e) {
    if (String(e.message || '').includes('payroll_team_day_reports')) {
      return res.status(503).json({ error: 'Uruchom migrację M11.' });
    }
    logger.error('payroll.team-day-reports', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.4 — historia ręcznych korekt linii (audyt) w miesiącu (JSON, max. 500). */
router.get('/line-correction-log', validateQuery(monthQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const { rows } = await queryLineCorrectionLogRows(pool, req.query.month, req.user, CORRECTION_LOG_JSON_LIMIT);
    res.json(rows);
  } catch (e) {
    if (String(e.message || '').includes('payroll_line_correction_log')) {
      return res.status(503).json({ error: 'Uruchom migrację (payroll_line_correction_log).' });
    }
    logger.error('payroll.line-correction-log', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.4 — ten sam zakres co JSON; plik CSV (UTF-8 BOM), do 10 000 wierszy — księgowość / archiwum. */
router.get('/line-correction-log.csv', validateQuery(monthQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const { ym, rows } = await queryLineCorrectionLogRows(pool, req.query.month, req.user, CORRECTION_LOG_CSV_LIMIT);
    const text = correctionLogRowsToCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=payroll_line_correction_log_${ym}.csv`);
    res.send(text);
  } catch (e) {
    if (String(e.message || '').includes('payroll_line_correction_log')) {
      return res.status(503).json({ error: 'Uruchom migrację (payroll_line_correction_log).' });
    }
    logger.error('payroll.line-correction-log.csv', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.4 — ręczna korekta linii raportu (godziny / kwota), dopóki raport niezatwierdzony i w oknie korekt. */
router.patch(
  '/team-day-report/:reportId/lines/:lineId',
  validateParams(reportLineParams),
  validateBody(linePatchSchema),
  async (req, res) => {
    try {
      const reportId = Number(req.params.reportId);
      const lineId = Number(req.params.lineId);
      const repQ = await pool.query(
        `SELECT id, oddzial_id, team_id, approved_at, first_closed_at FROM payroll_team_day_reports WHERE id = $1`,
        [reportId]
      );
      const report = repQ.rows[0];
      if (!report) return res.status(404).json({ error: 'Brak raportu' });

      const denied = ensureUserCanAccessTeamDayReport(req, report);
      if (denied) return res.status(denied.status).json(denied.body);

      try {
        assertTeamDayReportOpenForManualEdit(report);
      } catch (err) {
        if (err.code === 'PAYROLL_REPORT_APPROVED') {
          return res.status(409).json({ error: 'Raport jest zatwierdzony — korekta niedozwolona.', code: err.code });
        }
        if (err.code === 'PAYROLL_CORRECTION_WINDOW_CLOSED') {
          return res.status(409).json({
            error: 'Minął okres korekty raportu (PAYROLL_TEAM_DAY_CORRECTION_HOURS).',
            code: err.code,
          });
        }
        throw err;
      }

      const lineQ = await pool.query(
        `SELECT id, report_id, user_id, hours_total, pay_pln, detail_json FROM payroll_team_day_report_lines WHERE id = $1 AND report_id = $2`,
        [lineId, reportId]
      );
      const line = lineQ.rows[0];
      if (!line) return res.status(404).json({ error: 'Brak linii raportu' });

      const b = req.body;
      const prevPay = Number(line.pay_pln) || 0;
      const prevHours = Number(line.hours_total) || 0;
      const newPay = b.pay_pln !== undefined ? Math.round(Number(b.pay_pln) * 100) / 100 : prevPay;
      const newHours = b.hours_total !== undefined ? Math.round(Number(b.hours_total) * 100) / 100 : prevHours;

      const curDetail =
        line.detail_json && typeof line.detail_json === 'object' && !Array.isArray(line.detail_json) ? { ...line.detail_json } : {};
      curDetail.manual_correction = {
        at: new Date().toISOString(),
        by_user_id: req.user.id,
        previous_pay_pln: prevPay,
        previous_hours_total: prevHours,
        note: b.correction_note || null,
      };

      const { rows } = await pool.query(
        `UPDATE payroll_team_day_report_lines
         SET pay_pln = $1, hours_total = $2, detail_json = $3::jsonb
         WHERE id = $4 AND report_id = $5
         RETURNING *`,
        [newPay, newHours, JSON.stringify(curDetail), lineId, reportId]
      );
      const updated = rows[0];
      try {
        await pool.query(
          `INSERT INTO payroll_line_correction_log (
             line_id, report_id, target_user_id, edited_by, prev_pay_pln, prev_hours_total, new_pay_pln, new_hours_total, correction_note
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            lineId,
            reportId,
            line.user_id,
            req.user.id,
            prevPay,
            prevHours,
            newPay,
            newHours,
            b.correction_note || null,
          ]
        );
      } catch (logErr) {
        logger.warn('payroll.line-corr-audit', { message: logErr.message, lineId, reportId });
      }
      res.json(updated);
    } catch (e) {
      logger.error('payroll.team-day-line-patch', { message: e.message });
      res.status(500).json({ error: e.message });
    }
  }
);

/** F11.5 — wpis kasowy (kwota do oddziału). */
router.post('/cash-pickup', validateBody(cashPickupSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const b = req.body;
    if (isKierownik(req.user) && Number(req.user.oddzial_id) !== Number(b.oddzial_id)) {
      return res.status(403).json({ error: 'Inny oddział' });
    }
    const { rows } = await pool.query(
      `INSERT INTO branch_cash_pickups (oddzial_id, team_id, pickup_date, declared_cash)
       VALUES ($1,$2,$3::date,$4)
       ON CONFLICT (team_id, pickup_date) DO UPDATE SET declared_cash = EXCLUDED.declared_cash
       RETURNING *`,
      [b.oddzial_id, b.team_id, b.pickup_date, b.declared_cash]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('payroll.cash', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/cash-pickup/:id/receive', validateParams(idParam), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const allowAllOddzialy = isDyrektor(req.user);
    const { rows } = await pool.query(
      `UPDATE branch_cash_pickups SET received_at = NOW(), received_by = $1
       WHERE id = $2
         AND received_at IS NULL
         AND ($3 = true OR oddzial_id = $4)
       RETURNING *`,
      [req.user.id, req.params.id, allowAllOddzialy, req.user.oddzial_id]
    );
    if (!rows[0]) {
      const chk = await pool.query(`SELECT id, oddzial_id, received_at FROM branch_cash_pickups WHERE id = $1`, [
        req.params.id,
      ]);
      if (!chk.rows[0]) return res.status(404).json({ error: 'Brak wpisu' });
      if (chk.rows[0].received_at) return res.status(400).json({ error: 'Kasa już oznaczona jako odebrana' });
      if (!allowAllOddzialy && Number(chk.rows[0].oddzial_id) !== Number(req.user.oddzial_id)) {
        return res.status(403).json({ error: 'Inny oddział' });
      }
      return res.status(409).json({ error: 'Stan wpisu zmienił się — odśwież i spróbuj ponownie.' });
    }
    res.json(rows[0]);
  } catch (e) {
    logger.error('payroll.cash.receive', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.6 — naliczenia miesięczne wyceniającego (podgląd). */
router.get('/estimator-accrual', validateQuery(monthQuerySchema), async (req, res) => {
  try {
    const raw = req.query.month ? String(req.query.month) : '';
    const month = raw.length >= 7 ? `${raw.slice(0, 7)}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    if (!isDyrektor(req.user) && !isKierownik(req.user) && req.user.rola !== 'Wyceniający') {
      return res.status(403).json({ error: 'Brak dostępu' });
    }
    let sql = `SELECT e.*, u.imie, u.nazwisko FROM estimator_month_accrual e JOIN users u ON u.id = e.wyceniajacy_id
      WHERE e.accrual_month = $1::date`;
    const p = [month];
    if (req.user.rola === 'Wyceniający') {
      sql += ` AND e.wyceniajacy_id = $2`;
      p.push(req.user.id);
    } else if (isKierownik(req.user)) {
      sql += ` AND u.oddzial_id = $2`;
      p.push(req.user.oddzial_id);
    }
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) {
    logger.error('payroll.estimator', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.7 — status miesiąca: czy eksport dozwolony (brak niezatwierdzonych raportów dnia). */
router.get('/month-close-status', validateQuery(monthQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const raw = req.query.month ? String(req.query.month) : '';
    const { rows } = await listPendingTeamDayReportsForMonth(pool, raw, req.user);
    res.json({
      export_allowed: rows.length === 0,
      pending_count: rows.length,
      pending_reports: rows,
      skip_check_active: process.env.PAYROLL_EXPORT_SKIP_APPROVAL_CHECK === '1',
    });
  } catch (e) {
    logger.error('payroll.month-close-status', { message: e.message });
    res.status(500).json({ error: e.message });
  }
});

/** F11.7 — eksport: csv (domyślnie) | symfonia | optima | comarch (pliki tekstowe / CSV). */
router.get('/export.csv', validateQuery(exportQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    await assertPayrollMonthExportAllowed(pool, req.query.month, req.user);
    const { ym, rows } = await queryPayrollMonthExportRows(pool, req.query.month, req.user);
    try {
      await recordDailyPayrollSnapshot(pool, { ym, rows, exportedBy: req.user.id, kind: 'csv' });
    } catch (e) {
      logger.warn('payroll.export.snapshot', { message: e.message, ym, kind: 'csv' });
    }
    const fmt = (req.query.format && String(req.query.format)) || 'csv';
    const text = payrollExportText(rows, fmt);
    const ext = fmt === 'symfonia' ? 'txt' : fmt === 'optima' ? 'csv' : fmt === 'comarch' ? 'txt' : 'csv';
    const mime = fmt === 'csv' || fmt === 'optima' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename=payroll_${ym}_${fmt}.${ext}`);
    res.send(text);
  } catch (e) {
    if (e.code === 'PAYROLL_EXPORT_PENDING_APPROVALS') {
      return res.status(409).json({
        error: `Eksport zablokowany: ${e.pending_reports.length} raport(ów) dnia bez zatwierdzenia (F11.7).`,
        code: e.code,
        pending_reports: e.pending_reports,
      });
    }
    logger.error('payroll.export', { message: e.message });
    res.status(500).send('');
  }
});

/** F11.7 — jeden ZIP: csv + symfonia + optima + comarch (ta sama logika blokady co export.csv). */
router.get('/export.zip', validateQuery(monthQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    await assertPayrollMonthExportAllowed(pool, req.query.month, req.user);
    const { ym, rows } = await queryPayrollMonthExportRows(pool, req.query.month, req.user);
    try {
      await recordDailyPayrollSnapshot(pool, { ym, rows, exportedBy: req.user.id, kind: 'zip' });
    } catch (e) {
      logger.warn('payroll.export.snapshot', { message: e.message, ym, kind: 'zip' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=payroll_${ym}_all.zip`);

    const zipPassword = payrollZipPasswordFromEnv();
    const encMethod = payrollZipEncryptionMethodFromEnv();
    let archive;
    if (zipPassword) {
      ensurePayrollZipEncryptedFormat();
      archive = archiver.create('zip-encrypted', {
        zlib: { level: 9 },
        encryptionMethod: encMethod,
        password: zipPassword,
      });
      res.setHeader('X-Payroll-Zip-Encryption', encMethod);
    } else {
      archive = archiver('zip', { zlib: { level: 9 } });
    }
    archive.on('error', (err) => {
      logger.error('payroll.export.zip', { message: err.message });
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    const pack = [
      { fmt: 'csv', ext: 'csv' },
      { fmt: 'symfonia', ext: 'txt' },
      { fmt: 'optima', ext: 'csv' },
      { fmt: 'comarch', ext: 'txt' },
    ];
    const namedBuffers = [];
    for (const { fmt, ext } of pack) {
      const body = payrollExportText(rows, fmt);
      const name = `payroll_${ym}_${fmt}.${ext}`;
      const buf = Buffer.from(body, 'utf8');
      namedBuffers.push({ name, buf });
      archive.append(buf, { name });
    }
    const manifestUtf8 = buildPayrollZipManifest(ym, namedBuffers);
    archive.append(Buffer.from(manifestUtf8, 'utf8'), { name: `payroll_${ym}_manifest.json` });
    await archive.finalize();
  } catch (e) {
    if (e.code === 'PAYROLL_EXPORT_PENDING_APPROVALS') {
      return res.status(409).json({
        error: `Eksport zablokowany: ${e.pending_reports.length} raport(ów) dnia bez zatwierdzenia (F11.7).`,
        code: e.code,
        pending_reports: e.pending_reports,
      });
    }
    logger.error('payroll.export.zip', { message: e.message });
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
