/**
 * SKOPIUJ DO: arbor-os/src/routes/wyceny.js
 *
 * Zarejestruj w server.js:
 *   const wycenyRouter = require('./routes/wyceny');
 *   app.use('/api/wyceny', wycenyRouter);
 *
 * Uruchom SQL z create_tables_wyceny.sql w pgAdmin przed pierwszym użyciem.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const HOLD_TTL_HOURS = 8;

const uploadDir = path.join(__dirname, '../../uploads/wyceny');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `wycena_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';
const isSpecjalista = (u) => u.rola === 'Specjalista';
const canManage = (u) => isDyrektor(u) || isKierownik(u) || isSpecjalista(u);

const wycenyListQuerySchema = z.object({
  status_akceptacji: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const wycenaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const wycenaPatchStatusSchema = z.object({
  status: z.string().trim().min(1).max(80),
});

const wycenaZatwierdzSchema = z.object({
  ekipa_id: z.union([z.number(), z.string()]).optional().nullable(),
  data_wykonania: z.string().optional().nullable(),
  godzina_rozpoczecia: z.string().optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
});

const wycenaOdrzucSchema = z.object({
  powod: z.string().optional().nullable(),
});

const wycenaKlientAcceptSchema = z.object({
  uwagi: z.string().optional().nullable(),
});

const wycenaReserveSchema = z.object({
  ekipa_id: z.union([z.number(), z.string()]),
  data_wykonania: z.string().min(10),
  godzina_rozpoczecia: z.string().min(4),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  uwagi: z.string().optional().nullable(),
});

const wycenaSlotsQuerySchema = z.object({
  ekipa_id: z.coerce.number().int().positive(),
  data: z.string().min(10),
  slot_minutes: z.coerce.number().int().min(15).max(120).optional(),
  duration_minutes: z.coerce.number().int().min(15).max(600).optional(),
  exclude_wycena_id: z.coerce.number().int().positive().optional(),
  wycena_id: z.coerce.number().int().positive().optional(),
});

function buildTaskPlannedDateTime(dataWykonania, godzinaRozpoczecia) {
  if (!dataWykonania) return null;
  const hhmm = (godzinaRozpoczecia || '08:00').slice(0, 5);
  return `${dataWykonania} ${hhmm}:00`;
}

function parseClockToMinutes(value) {
  const [h, m] = String(value || '00:00').split(':');
  const hh = Number(h);
  const mm = Number(m);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function gpsAgeMinutes(isoTs) {
  if (!isoTs) return null;
  const diff = (Date.now() - new Date(isoTs).getTime()) / 60000;
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.round(diff));
}

async function getTeamCurrentLocation(teamId) {
  const r = await pool.query(
    `WITH latest AS (
      SELECT DISTINCT ON (plate_number)
        plate_number, lat, lng, speed_kmh, recorded_at
      FROM gps_vehicle_positions
      WHERE provider = 'juwentus'
      ORDER BY plate_number, recorded_at DESC
    )
    SELECT l.lat, l.lng, l.speed_kmh, l.recorded_at
    FROM latest l
    JOIN vehicles v
      ON REPLACE(REPLACE(UPPER(v.nr_rejestracyjny), ' ', ''), '-', '') = l.plate_number
    WHERE v.ekipa_id = $1
    ORDER BY l.recorded_at DESC
    LIMIT 1`,
    [teamId]
  );
  return r.rows[0] || null;
}

async function resolveWycenaTargetPoint(wycenaId) {
  const q = await pool.query(
    `SELECT
       w.lat AS wycena_lat,
       w.lon AS wycena_lon,
       t.pin_lat AS task_pin_lat,
       t.pin_lng AS task_pin_lng
     FROM wyceny w
     LEFT JOIN tasks t ON t.source_wycena_id = w.id
     WHERE w.id = $1
     ORDER BY t.id DESC NULLS LAST
     LIMIT 1`,
    [wycenaId]
  );
  const row = q.rows[0];
  if (!row) return null;
  const directLat = Number(row.wycena_lat);
  const directLon = Number(row.wycena_lon);
  if (Number.isFinite(directLat) && Number.isFinite(directLon)) {
    return { lat: directLat, lon: directLon, source: 'wycena' };
  }
  const pinLat = Number(row.task_pin_lat);
  const pinLon = Number(row.task_pin_lng);
  if (Number.isFinite(pinLat) && Number.isFinite(pinLon)) {
    return { lat: pinLat, lon: pinLon, source: 'task_pin' };
  }
  return null;
}

async function backfillWycenaGeoFromTaskPin(wycenaId) {
  const rowQ = await pool.query(
    `SELECT
       w.lat AS wycena_lat,
       w.lon AS wycena_lon,
       t.pin_lat AS task_pin_lat,
       t.pin_lng AS task_pin_lng
     FROM wyceny w
     LEFT JOIN tasks t ON t.source_wycena_id = w.id
     WHERE w.id = $1
     ORDER BY t.id DESC NULLS LAST
     LIMIT 1`,
    [wycenaId]
  );
  const row = rowQ.rows[0];
  if (!row) return false;
  const hasWycenaLat = Number.isFinite(Number(row.wycena_lat));
  const hasWycenaLon = Number.isFinite(Number(row.wycena_lon));
  if (hasWycenaLat && hasWycenaLon) return false;
  const pinLat = Number(row.task_pin_lat);
  const pinLon = Number(row.task_pin_lng);
  if (!Number.isFinite(pinLat) || !Number.isFinite(pinLon)) return false;
  await pool.query(
    `UPDATE wyceny
     SET lat = COALESCE(lat, $1),
         lon = COALESCE(lon, $2),
         updated_at = NOW()
     WHERE id = $3`,
    [pinLat, pinLon, wycenaId]
  );
  return true;
}

async function getTeamBusyRanges(client, teamId, day, excludeWycenaId = null) {
  const taskRows = await client.query(
    `SELECT data_planowana, COALESCE(czas_planowany_godziny, 2) AS czas_h
     FROM tasks
     WHERE ekipa_id = $1
       AND data_planowana::date = $2::date`,
    [teamId, day]
  );
  const wycenaRows = await client.query(
    `SELECT COALESCE(proponowana_data, data_wykonania) AS day,
            COALESCE(proponowana_godzina, godzina_rozpoczecia) AS hour,
            COALESCE(czas_planowany_godziny, 2) AS czas_h
     FROM wyceny
     WHERE COALESCE(proponowana_ekipa_id, ekipa_id) = $1
       AND COALESCE(proponowana_data, data_wykonania) = $2::date
       AND (
         status_akceptacji IN ('do_specjalisty', 'zatwierdzono')
         OR (status_akceptacji = 'rezerwacja_wstepna' AND COALESCE(rezerwacja_wygasa_at, proponowana_at + INTERVAL '${HOLD_TTL_HOURS} hours') >= NOW())
       )
       AND ($3::int IS NULL OR id <> $3::int)`,
    [teamId, day, excludeWycenaId]
  );
  const ranges = [];
  for (const row of taskRows.rows) {
    const date = new Date(row.data_planowana);
    const start = date.getHours() * 60 + date.getMinutes();
    const end = start + Math.max(15, Math.round(Number(row.czas_h || 2) * 60));
    ranges.push({ start, end });
  }
  for (const row of wycenaRows.rows) {
    const start = parseClockToMinutes(row.hour ? String(row.hour).slice(0, 5) : '08:00');
    if (start == null) continue;
    const end = start + Math.max(15, Math.round(Number(row.czas_h || 2) * 60));
    ranges.push({ start, end });
  }
  return ranges;
}

function checkTeamConflict({ busyRanges, hour, durationMinutes }) {
  const start = parseClockToMinutes(hour);
  if (start == null) return { invalidTime: true, conflict: false };
  const end = start + durationMinutes;
  const conflict = busyRanges.some((r) => rangesOverlap(start, end, r.start, r.end));
  return { invalidTime: false, conflict };
}

const wycenyCreateSchema = z.object({
  klient_nazwa: z.string().trim().min(1, 'klient_nazwa jest wymagane'),
  klient_telefon: z.string().optional().nullable(),
  adres: z.string().optional().nullable(),
  miasto: z.string().optional().nullable(),
  typ_uslugi: z.string().optional().nullable(),
  wartosc_szacowana: z.union([z.number(), z.string()]).optional().nullable(),
  opis: z.string().optional().nullable(),
  notatki_wewnetrzne: z.string().optional().nullable(),
  lat: z.union([z.number(), z.string()]).optional().nullable(),
  lon: z.union([z.number(), z.string()]).optional().nullable(),
  ekipa_id: z.union([z.number(), z.string()]).optional().nullable(),
  data_wykonania: z.string().optional().nullable(),
  godzina_rozpoczecia: z.string().optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
});

router.get('/', authMiddleware, validateQuery(wycenyListQuerySchema), async (req, res) => {
  try {
    const { status_akceptacji, limit, offset } = req.query;
    const dopuszczalne = ['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty', 'zatwierdzono', 'odrzucono'];
    const filterStatus = dopuszczalne.includes(status_akceptacji) ? status_akceptacji : null;

    let whereClause = '';
    let params = [];
    if (canManage(req.user)) {
      if (filterStatus) {
        whereClause = 'WHERE w.status_akceptacji = $1';
        params = [filterStatus];
      }
    } else if (filterStatus) {
      whereClause = 'WHERE w.autor_id = $1 AND w.status_akceptacji = $2';
      params = [req.user.id, filterStatus];
    } else {
      whereClause = 'WHERE w.autor_id = $1';
      params = [req.user.id];
    }

    const joins = `FROM wyceny w
      LEFT JOIN users u ON u.id = w.autor_id
      LEFT JOIN teams e ON e.id = w.ekipa_id
      LEFT JOIN teams pe ON pe.id = w.proponowana_ekipa_id
      LEFT JOIN tasks t ON t.source_wycena_id = w.id`;
    const selectList = `SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa, e.nazwa AS ekipa_nazwa, pe.nazwa AS proponowana_ekipa_nazwa, t.id AS task_id,
      CASE
        WHEN w.status_akceptacji = 'rezerwacja_wstepna' AND COALESCE(w.rezerwacja_wygasa_at, w.proponowana_at + INTERVAL '${HOLD_TTL_HOURS} hours') < NOW()
          THEN true
        ELSE false
      END AS rezerwacja_przeterminowana`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${joins} ${whereClause}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const { rows } = await pool.query(
        `${selectList} ${joins} ${whereClause} ORDER BY w.created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }

    const { rows } = await pool.query(
      `${selectList} ${joins} ${whereClause} ORDER BY w.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    logger.error('Blad pobierania wycen', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, validateBody(wycenyCreateSchema), async (req, res) => {
  try {
    const { klient_nazwa, klient_telefon, adres, miasto, typ_uslugi, wartosc_szacowana, opis, notatki_wewnetrzne, lat, lon, ekipa_id, data_wykonania, godzina_rozpoczecia, czas_planowany_godziny } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO wyceny (klient_nazwa,klient_telefon,adres,miasto,typ_uslugi,wartosc_szacowana,wartosc_planowana,opis,notatki_wewnetrzne,lat,lon,autor_id,status,ekipa_id,data_wykonania,godzina_rozpoczecia,czas_planowany_godziny,status_akceptacji) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,'Nowa',$12,$13,$14,$15,'oczekuje') RETURNING *`,
      [klient_nazwa, klient_telefon||null, adres||null, miasto||null, typ_uslugi||null, wartosc_szacowana?parseFloat(wartosc_szacowana):null, opis||null, notatki_wewnetrzne||null, lat?parseFloat(lat):null, lon?parseFloat(lon):null, req.user.id, ekipa_id?parseInt(ekipa_id):null, data_wykonania||null, godzina_rozpoczecia||null, czas_planowany_godziny?parseFloat(czas_planowany_godziny):null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('Blad tworzenia wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id', authMiddleware, validateParams(wycenaIdParamsSchema), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa, pe.nazwa AS proponowana_ekipa_nazwa, t.id AS task_id,
       CASE
         WHEN w.status_akceptacji = 'rezerwacja_wstepna' AND COALESCE(w.rezerwacja_wygasa_at, w.proponowana_at + INTERVAL '${HOLD_TTL_HOURS} hours') < NOW()
           THEN true
         ELSE false
       END AS rezerwacja_przeterminowana
       FROM wyceny w
       LEFT JOIN users u ON u.id = w.autor_id
       LEFT JOIN teams pe ON pe.id = w.proponowana_ekipa_id
       LEFT JOIN tasks t ON t.source_wycena_id = w.id
       WHERE w.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad pobierania wyceny po id', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.patch('/:id/status', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaPatchStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(`UPDATE wyceny SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad aktualizacji statusu wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/zatwierdz', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaZatwierdzSchema), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    const planEkipa = ekipa_id || null;
    const planData = data_wykonania || null;
    const planGodzina = godzina_rozpoczecia || null;
    const { wartosc_planowana } = req.body;
    if (!planEkipa || !planData || !planGodzina) {
      return res.status(400).json({
        error: 'Do zatwierdzenia wymagane są: ekipa, data realizacji i godzina rozpoczęcia.',
      });
    }
    const busyRanges = await getTeamBusyRanges(pool, parseInt(planEkipa, 10), planData, Number(req.params.id));
    const conflictCheck = checkTeamConflict({
      busyRanges,
      hour: planGodzina,
      durationMinutes: Math.max(15, Math.round(Number(req.body.czas_planowany_godziny || 2) * 60)),
    });
    if (conflictCheck.invalidTime) {
      return res.status(400).json({ error: 'Nieprawidlowa godzina planowania.' });
    }
    if (conflictCheck.conflict) {
      return res.status(409).json({ error: 'Konflikt terminu: ekipa ma juz zarezerwowany lub zaplanowany ten przedzial.' });
    }
    const { rows } = await pool.query(
      `UPDATE wyceny SET
         status_akceptacji='zatwierdzono',
         ekipa_id=$1,
         data_wykonania=COALESCE($2,data_wykonania),
         godzina_rozpoczecia=COALESCE($3,godzina_rozpoczecia),
         wartosc_planowana=COALESCE($4,wartosc_planowana),
         zatwierdzone_przez=$5,
         zatwierdzone_at=NOW(),
         status='Zaakceptowana',
         updated_at=NOW()
       WHERE id=$6
       RETURNING *`,
      [
        parseInt(planEkipa, 10),
        planData,
        planGodzina,
        wartosc_planowana ? parseFloat(wartosc_planowana) : null,
        req.user.id,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const wycena = rows[0];
    const existingTask = await pool.query('SELECT id FROM tasks WHERE source_wycena_id = $1 LIMIT 1', [wycena.id]);
    let taskId = existingTask.rows[0]?.id || null;
    if (!taskId) {
      const taskInsert = await pool.query(
        `INSERT INTO tasks (
          klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
          priorytet, wartosc_planowana, data_planowana, notatki_wewnetrzne,
          status, oddzial_id, ekipa_id, wyceniajacy_id, pin_lat, pin_lng, source_wycena_id
        )
        VALUES (
          $1,$2,$3,$4,$5,'Normalny',$6,$7,$8,'Zaplanowane',$9,$10,$11,$12,$13,$14
        ) RETURNING id`,
        [
          wycena.klient_nazwa,
          wycena.klient_telefon,
          wycena.adres,
          wycena.miasto,
          wycena.typ_uslugi || 'Wycena',
          wycena.wartosc_planowana,
          buildTaskPlannedDateTime(wycena.data_wykonania, wycena.godzina_rozpoczecia),
          wycena.notatki_wewnetrzne,
          req.user.oddzial_id || null,
          wycena.ekipa_id || null,
          wycena.autor_id || null,
          wycena.lat || null,
          wycena.lon || null,
          wycena.id,
        ]
      );
      taskId = taskInsert.rows[0]?.id || null;
    } else {
      await pool.query(
        `UPDATE tasks SET
          ekipa_id = COALESCE($1, ekipa_id),
          wartosc_planowana = COALESCE($2, wartosc_planowana),
          data_planowana = COALESCE($3, data_planowana),
          status = 'Zaplanowane'
        WHERE id = $4`,
        [
          wycena.ekipa_id || null,
          wycena.wartosc_planowana || null,
          buildTaskPlannedDateTime(wycena.data_wykonania, wycena.godzina_rozpoczecia),
          taskId,
        ]
      );
    }
    res.json({ ...wycena, task_id: taskId });
  } catch (e) {
    logger.error('Blad zatwierdzania wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/klient-akceptuje', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaKlientAcceptSchema), async (req, res) => {
  try {
    const { uwagi } = req.body;
    const { rows } = await pool.query(
      `UPDATE wyceny
       SET status_akceptacji='do_specjalisty',
           status='Klient zaakceptował - do specjalisty',
           wycena_uwagi = COALESCE(NULLIF($1,''), wycena_uwagi),
           updated_at = NOW()
       WHERE id=$2
       RETURNING *`,
      [uwagi || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad oznaczania akceptacji klienta', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/availability/slots', authMiddleware, validateQuery(wycenaSlotsQuerySchema), async (req, res) => {
  try {
    const teamId = Number(req.query.ekipa_id);
    const day = String(req.query.data).slice(0, 10);
    const slotMinutes = Number(req.query.slot_minutes || 60);
    const durationMinutes = Number(req.query.duration_minutes || 120);
    const excludeWycenaId = req.query.exclude_wycena_id ? Number(req.query.exclude_wycena_id) : null;
    const wycenaId = req.query.wycena_id ? Number(req.query.wycena_id) : null;
    let targetLat = null;
    let targetLon = null;
    let targetSource = null;
    if (wycenaId) {
      await backfillWycenaGeoFromTaskPin(wycenaId);
      const point = await resolveWycenaTargetPoint(wycenaId);
      if (point) {
        targetLat = point.lat;
        targetLon = point.lon;
        targetSource = point.source;
      }
    }
    const teamLocation = (targetLat != null && targetLon != null) ? await getTeamCurrentLocation(teamId) : null;
    let etaMinutes = null;
    let etaUnavailableReason = null;
    const gpsAgeMin = teamLocation?.recorded_at ? gpsAgeMinutes(teamLocation.recorded_at) : null;
    if (teamLocation && targetLat != null && targetLon != null) {
      const distKm = haversineKm(Number(teamLocation.lat), Number(teamLocation.lng), targetLat, targetLon);
      const speed = Number(teamLocation.speed_kmh) > 5 ? Number(teamLocation.speed_kmh) : 35;
      etaMinutes = Math.max(1, Math.round((distKm / speed) * 60));
    } else if (targetLat == null || targetLon == null) {
      etaUnavailableReason = 'no_target_point';
    } else if (!teamLocation) {
      etaUnavailableReason = 'no_team_gps';
    }
    const busyRanges = await getTeamBusyRanges(pool, teamId, day, excludeWycenaId);
    const startWindow = 7 * 60;
    const endWindow = 19 * 60;
    const slots = [];
    for (let start = startWindow; start + durationMinutes <= endWindow; start += slotMinutes) {
      const end = start + durationMinutes;
      const conflict = busyRanges.some((r) => rangesOverlap(start, end, r.start, r.end));
      if (!conflict) {
        const hh = String(Math.floor(start / 60)).padStart(2, '0');
        const mm = String(start % 60).padStart(2, '0');
        const morningPref = Math.max(0, 30 - Math.abs(start - 9 * 60) / 6);
        const etaPref = etaMinutes == null ? 0 : Math.max(0, 40 - etaMinutes);
        const noEtaPenalty = etaMinutes == null ? -15 : 0;
        slots.push({
          time: `${hh}:${mm}`,
          score: Math.round(morningPref + etaPref + noEtaPenalty),
          eta_minutes: etaMinutes,
          eta_source: targetSource,
          eta_unavailable_reason: etaUnavailableReason,
        });
      }
    }
    res.json({
      items: slots,
      diagnostics: {
        eta_available: etaMinutes != null,
        eta_unavailable_reason: etaUnavailableReason,
        target_source: targetSource,
        team_gps_age_min: gpsAgeMin,
      },
    });
  } catch (e) {
    logger.error('Blad liczenia slotow dostepnosci', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/rezerwuj-termin', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaReserveSchema), async (req, res) => {
  try {
    const wycenaId = Number(req.params.id);
    await backfillWycenaGeoFromTaskPin(wycenaId);
    const teamId = Number(req.body.ekipa_id);
    const day = String(req.body.data_wykonania).slice(0, 10);
    const hour = String(req.body.godzina_rozpoczecia).slice(0, 5);
    const durationMinutes = Math.max(15, Math.round(Number(req.body.czas_planowany_godziny || 2) * 60));
    const busyRanges = await getTeamBusyRanges(pool, teamId, day, wycenaId);
    const conflictCheck = checkTeamConflict({ busyRanges, hour, durationMinutes });
    if (conflictCheck.invalidTime) return res.status(400).json({ error: 'Nieprawidlowa godzina rezerwacji.' });
    if (conflictCheck.conflict) {
      return res.status(409).json({ error: 'Wybrany termin jest zajety dla tej ekipy.' });
    }
    const { rows } = await pool.query(
      `UPDATE wyceny
       SET status_akceptacji='rezerwacja_wstepna',
           status='Rezerwacja wstepna - do zatwierdzenia',
           proponowana_ekipa_id=$1,
           proponowana_data=$2,
           proponowana_godzina=$3,
           proponowana_przez=$4,
           proponowana_at=NOW(),
           rezerwacja_wygasa_at=NOW() + INTERVAL '${HOLD_TTL_HOURS} hours',
           czas_planowany_godziny=COALESCE($5, czas_planowany_godziny),
           wycena_uwagi = CASE
             WHEN NULLIF($6,'') IS NULL THEN wycena_uwagi
             ELSE TRIM(COALESCE(wycena_uwagi || E'\n','') || $6)
           END,
           updated_at=NOW()
       WHERE id=$7
       RETURNING *`,
      [teamId, day, hour, req.user.id, req.body.czas_planowany_godziny ? parseFloat(req.body.czas_planowany_godziny) : null, req.body.uwagi || null, wycenaId]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad rezerwacji terminu wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/odrzuc', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaOdrzucSchema), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    const { powod } = req.body;
    const { rows } = await pool.query(
      `UPDATE wyceny SET status_akceptacji='odrzucono', uwagi_kierownika=$1, zatwierdzone_przez=$2, zatwierdzone_at=NOW(), status='Odrzucona', updated_at=NOW() WHERE id=$3 RETURNING *`,
      [powod||'', req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad odrzucania wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id', authMiddleware, validateParams(wycenaIdParamsSchema), async (req, res) => {
  if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    await pool.query('DELETE FROM wyceny WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('Blad usuwania wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
