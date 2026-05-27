const pool = require('../config/database');
const _logger = require('../config/logger');
const { env } = require('../config/env');

const normalizePlate = (value) => String(value || '').toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
const optionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};
let gpsSchemaEnsured = false;

const ensureGpsTables = async () => {
  if (gpsSchemaEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gps_vehicle_positions (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(40) NOT NULL,
      external_id VARCHAR(120) NOT NULL,
      plate_number VARCHAR(40),
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      speed_kmh DOUBLE PRECISION,
      heading DOUBLE PRECISION,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_positions_provider_external_recorded
    ON gps_vehicle_positions (provider, external_id, recorded_at)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_gps_positions_provider_recorded
    ON gps_vehicle_positions (provider, recorded_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_gps_positions_plate_recorded
    ON gps_vehicle_positions (plate_number, recorded_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gps_user_vehicle_assignments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plate_number VARCHAR(40) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_user_vehicle_unique
    ON gps_user_vehicle_assignments (user_id, plate_number)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_gps_user_vehicle_active
    ON gps_user_vehicle_assignments (active, plate_number)
  `);

  gpsSchemaEnsured = true;
};

const parseGpsPayload = (payload) => {
  if (!payload) return [];
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.vehicles)
        ? payload.vehicles
        : Array.isArray(payload.data)
          ? payload.data
          : [];

  return list
    .map((item) => {
      const lat = Number(item.lat ?? item.latitude);
      const lng = Number(item.lng ?? item.lon ?? item.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        external_id: String(item.id ?? item.deviceId ?? item.device_id ?? item.imei ?? '').trim() || null,
        plate: normalizePlate(item.registration ?? item.registrationNumber ?? item.plate ?? item.nr_rejestracyjny),
        lat,
        lng,
        speed_kmh: Number.isFinite(Number(item.speed ?? item.speedKmh)) ? Number(item.speed ?? item.speedKmh) : null,
        heading: Number.isFinite(Number(item.heading ?? item.course)) ? Number(item.heading ?? item.course) : null,
        recorded_at: item.timestamp ?? item.recordedAt ?? item.lastSeen ?? new Date().toISOString(),
        source_payload: item,
      };
    })
    .filter(Boolean);
};

const fetchJuwentusGps = async () => {
  if (!env.JUWENTUS_GPS_API_URL || !env.JUWENTUS_GPS_API_TOKEN) return [];
  const response = await fetch(env.JUWENTUS_GPS_API_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.JUWENTUS_GPS_API_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Juwentus GPS HTTP ${response.status}`);
  }
  const payload = await response.json();
  return parseGpsPayload(payload);
};

const upsertGpsRows = async (rows) => {
  if (!rows.length) return 0;
  await ensureGpsTables();
  let saved = 0;
  for (const row of rows) {
    if (!row.plate) continue;
    await pool.query(
      `INSERT INTO gps_vehicle_positions (
        provider, external_id, plate_number, lat, lng, speed_kmh, heading, recorded_at, source_payload
      ) VALUES (
        'juwentus', $1, $2, $3, $4, $5, $6, $7, $8::jsonb
      )
      ON CONFLICT (provider, external_id, recorded_at) DO UPDATE SET
        plate_number = EXCLUDED.plate_number,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        speed_kmh = EXCLUDED.speed_kmh,
        heading = EXCLUDED.heading,
        source_payload = EXCLUDED.source_payload`,
      [
        row.external_id || row.plate,
        row.plate,
        row.lat,
        row.lng,
        row.speed_kmh,
        row.heading,
        row.recorded_at,
        JSON.stringify(row.source_payload || {}),
      ]
    );
    saved += 1;
  }
  return saved;
};

const syncJuwentusGps = async () => {
  const rows = await fetchJuwentusGps();
  return upsertGpsRows(rows);
};

const getLiveTeamLocations = async ({ oddzialId = null, includeWithoutTeam = true } = {}) => {
  await ensureGpsTables();

  const params = [];
  let whereOddzial = '';
  if (oddzialId != null) {
    params.push(oddzialId);
    whereOddzial = `AND (t.oddzial_id = $${params.length} OR u.oddzial_id = $${params.length})`;
  }

  const vehicleResult = await pool.query(
    `WITH latest AS (
      SELECT DISTINCT ON (plate_number)
        plate_number, lat, lng, speed_kmh, heading, recorded_at, source_payload
      FROM gps_vehicle_positions
      WHERE provider = 'juwentus'
      ORDER BY plate_number, recorded_at DESC
    )
    SELECT
      t.id AS ekipa_id,
      t.nazwa AS ekipa_nazwa,
      t.oddzial_id,
      u.id AS wyceniajacy_id,
      (u.imie || ' ' || u.nazwisko) AS wyceniajacy_nazwa,
      NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), '') AS user_name,
      v.id AS vehicle_id,
      v.nr_rejestracyjny,
      l.lat,
      l.lng,
      l.speed_kmh,
      l.heading,
      l.recorded_at,
      'juwentus' AS provider,
      'auto' AS gps_source_kind,
      l.source_payload->>'accuracy_m' AS accuracy_m,
      l.source_payload->>'battery_pct' AS battery_pct,
      l.source_payload->>'platform' AS platform,
      l.source_payload->>'activity' AS activity,
      NULL::integer AS user_id,
      NULL::varchar AS user_rola
    FROM latest l
    LEFT JOIN vehicles v
      ON REPLACE(REPLACE(UPPER(v.nr_rejestracyjny), ' ', ''), '-', '') = l.plate_number
    LEFT JOIN teams t ON t.id = v.ekipa_id
    LEFT JOIN gps_user_vehicle_assignments guva
      ON guva.active = true
      AND REPLACE(REPLACE(UPPER(guva.plate_number), ' ', ''), '-', '') = l.plate_number
    LEFT JOIN users u ON u.id = guva.user_id
    WHERE 1=1
      ${includeWithoutTeam ? '' : 'AND t.id IS NOT NULL'}
      ${whereOddzial}
    ORDER BY t.nazwa NULLS LAST, wyceniajacy_nazwa NULLS LAST, v.nr_rejestracyjny`,
    params
  );

  const mobileParams = [];
  let mobileWhereOddzial = '';
  if (oddzialId != null) {
    mobileParams.push(oddzialId);
    mobileWhereOddzial = `AND (t.oddzial_id = $${mobileParams.length} OR u.oddzial_id = $${mobileParams.length})`;
  }

  const mobileResult = await pool.query(
    `WITH latest AS (
      SELECT DISTINCT ON (external_id)
        external_id, lat, lng, speed_kmh, heading, recorded_at, source_payload
      FROM gps_vehicle_positions
      WHERE provider = 'mobile'
        AND recorded_at >= NOW() - INTERVAL '12 hours'
      ORDER BY external_id, recorded_at DESC
    )
    SELECT
      t.id AS ekipa_id,
      t.nazwa AS ekipa_nazwa,
      COALESCE(t.oddzial_id, u.oddzial_id) AS oddzial_id,
      CASE WHEN LOWER(u.rola) LIKE 'wyceniaj%' THEN u.id ELSE NULL END AS wyceniajacy_id,
      CASE WHEN LOWER(u.rola) LIKE 'wyceniaj%' THEN (u.imie || ' ' || u.nazwisko) ELSE NULL END AS wyceniajacy_nazwa,
      NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), '') AS user_name,
      NULL::integer AS vehicle_id,
      CASE WHEN LOWER(u.rola) LIKE 'wyceniaj%' THEN 'MOBILE_WYCENA' ELSE 'MOBILE_EKIPA' END AS nr_rejestracyjny,
      l.lat,
      l.lng,
      l.speed_kmh,
      l.heading,
      l.recorded_at,
      'mobile' AS provider,
      'telefon' AS gps_source_kind,
      l.source_payload->>'accuracy_m' AS accuracy_m,
      l.source_payload->>'battery_pct' AS battery_pct,
      l.source_payload->>'platform' AS platform,
      l.source_payload->>'activity' AS activity,
      u.id AS user_id,
      u.rola AS user_rola
    FROM latest l
    JOIN users u ON u.id::text = l.external_id
    LEFT JOIN teams t ON t.id = u.ekipa_id OR t.brygadzista_id = u.id
    WHERE COALESCE(u.aktywny, true) = true
      AND (u.rola IN ('Brygadzista', 'Pomocnik') OR LOWER(u.rola) LIKE 'wyceniaj%')
      ${includeWithoutTeam ? '' : 'AND t.id IS NOT NULL'}
      ${mobileWhereOddzial}
    ORDER BY t.nazwa NULLS LAST, wyceniajacy_nazwa NULLS LAST, u.id`,
    mobileParams
  );

  return [...vehicleResult.rows, ...mobileResult.rows].sort((a, b) => {
    const teamA = a.ekipa_nazwa || '';
    const teamB = b.ekipa_nazwa || '';
    if (teamA !== teamB) return teamA.localeCompare(teamB);
    const estA = a.wyceniajacy_nazwa || '';
    const estB = b.wyceniajacy_nazwa || '';
    if (estA !== estB) return estA.localeCompare(estB);
    return String(a.nr_rejestracyjny || '').localeCompare(String(b.nr_rejestracyjny || ''));
  });
};

const getGpsHistory = async ({
  date,
  oddzialId = null,
  teamId = null,
  userId = null,
  vehicleId = null,
  plateNumber = null,
  provider = null,
  limit = 240,
} = {}) => {
  await ensureGpsTables();

  const params = [date || new Date().toISOString().slice(0, 10)];
  const where = [];
  const scopedOddzialId = optionalNumber(oddzialId);
  const scopedTeamId = optionalNumber(teamId);
  const scopedUserId = optionalNumber(userId);
  const scopedVehicleId = optionalNumber(vehicleId);
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (scopedOddzialId != null) where.push(`oddzial_id = ${addParam(scopedOddzialId)}`);
  if (scopedTeamId != null) where.push(`ekipa_id = ${addParam(scopedTeamId)}`);
  if (scopedUserId != null) where.push(`user_id = ${addParam(scopedUserId)}`);
  if (scopedVehicleId != null) where.push(`vehicle_id = ${addParam(scopedVehicleId)}`);
  if (plateNumber) where.push(`plate_number_normalized = ${addParam(normalizePlate(plateNumber))}`);
  if (provider) where.push(`provider = ${addParam(provider)}`);

  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 240));
  const limitParam = addParam(safeLimit);
  const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await pool.query(
    `WITH vehicle_points AS (
      SELECT
        t.id AS ekipa_id,
        t.nazwa AS ekipa_nazwa,
        COALESCE(t.oddzial_id, u.oddzial_id) AS oddzial_id,
        u.id AS wyceniajacy_id,
        (u.imie || ' ' || u.nazwisko) AS wyceniajacy_nazwa,
        NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), '') AS user_name,
        v.id AS vehicle_id,
        v.nr_rejestracyjny,
        gp.plate_number AS plate_number_normalized,
        gp.lat,
        gp.lng,
        gp.speed_kmh,
        gp.heading,
        gp.recorded_at,
        'juwentus' AS provider,
        'auto' AS gps_source_kind,
        gp.source_payload->>'accuracy_m' AS accuracy_m,
        gp.source_payload->>'battery_pct' AS battery_pct,
        gp.source_payload->>'platform' AS platform,
        gp.source_payload->>'activity' AS activity,
        u.id AS user_id,
        u.rola AS user_rola
      FROM gps_vehicle_positions gp
      LEFT JOIN vehicles v
        ON REPLACE(REPLACE(UPPER(v.nr_rejestracyjny), ' ', ''), '-', '') = gp.plate_number
      LEFT JOIN teams t ON t.id = v.ekipa_id
      LEFT JOIN gps_user_vehicle_assignments guva
        ON guva.active = true
        AND REPLACE(REPLACE(UPPER(guva.plate_number), ' ', ''), '-', '') = gp.plate_number
      LEFT JOIN users u ON u.id = guva.user_id
      WHERE gp.provider = 'juwentus'
        AND gp.recorded_at >= $1::date
        AND gp.recorded_at < $1::date + INTERVAL '1 day'
    ),
    mobile_points AS (
      SELECT
        t.id AS ekipa_id,
        t.nazwa AS ekipa_nazwa,
        COALESCE(t.oddzial_id, u.oddzial_id) AS oddzial_id,
        CASE WHEN LOWER(u.rola) LIKE 'wyceniaj%' THEN u.id ELSE NULL END AS wyceniajacy_id,
        CASE WHEN LOWER(u.rola) LIKE 'wyceniaj%' THEN (u.imie || ' ' || u.nazwisko) ELSE NULL END AS wyceniajacy_nazwa,
        NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), '') AS user_name,
        NULL::integer AS vehicle_id,
        CASE WHEN LOWER(u.rola) LIKE 'wyceniaj%' THEN 'MOBILE_WYCENA' ELSE 'MOBILE_EKIPA' END AS nr_rejestracyjny,
        NULL::varchar AS plate_number_normalized,
        gp.lat,
        gp.lng,
        gp.speed_kmh,
        gp.heading,
        gp.recorded_at,
        'mobile' AS provider,
        'telefon' AS gps_source_kind,
        gp.source_payload->>'accuracy_m' AS accuracy_m,
        gp.source_payload->>'battery_pct' AS battery_pct,
        gp.source_payload->>'platform' AS platform,
        gp.source_payload->>'activity' AS activity,
        u.id AS user_id,
        u.rola AS user_rola
      FROM gps_vehicle_positions gp
      JOIN users u ON u.id::text = gp.external_id
      LEFT JOIN teams t ON t.id = u.ekipa_id OR t.brygadzista_id = u.id
      WHERE gp.provider = 'mobile'
        AND gp.recorded_at >= $1::date
        AND gp.recorded_at < $1::date + INTERVAL '1 day'
        AND COALESCE(u.aktywny, true) = true
        AND (u.rola IN ('Brygadzista', 'Pomocnik') OR LOWER(u.rola) LIKE 'wyceniaj%')
    ),
    combined AS (
      SELECT * FROM vehicle_points
      UNION ALL
      SELECT * FROM mobile_points
    )
    SELECT *
    FROM (
      SELECT *
      FROM combined
      ${filterSql}
      ORDER BY recorded_at DESC
      LIMIT ${limitParam}
    ) latest_points
    ORDER BY recorded_at ASC`,
    params
  );

  return result.rows;
};

module.exports = {
  ensureGpsTables,
  syncJuwentusGps,
  getLiveTeamLocations,
  getGpsHistory,
};

