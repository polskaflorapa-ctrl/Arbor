const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');

const normalizePlate = (value) => String(value || '').toUpperCase().replace(/\s+/g, '').replace(/-/g, '');

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
  const params = [];
  let whereOddzial = '';
  if (oddzialId != null) {
    params.push(oddzialId);
    whereOddzial = `AND (t.oddzial_id = $${params.length} OR u.oddzial_id = $${params.length})`;
  }

  const result = await pool.query(
    `WITH latest AS (
      SELECT DISTINCT ON (plate_number)
        plate_number, lat, lng, speed_kmh, heading, recorded_at
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
      v.id AS vehicle_id,
      v.nr_rejestracyjny,
      l.lat,
      l.lng,
      l.speed_kmh,
      l.heading,
      l.recorded_at
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

  return result.rows;
};

module.exports = {
  syncJuwentusGps,
  getLiveTeamLocations,
};

