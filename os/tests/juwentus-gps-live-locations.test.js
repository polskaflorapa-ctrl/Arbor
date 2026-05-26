jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');

function loadService() {
  jest.resetModules();
  jest.doMock('../src/config/database', () => pool);
  return require('../src/services/juwentus-gps');
}

describe('getLiveTeamLocations', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('merges vehicle GPS and fresh mobile heartbeat rows with branch scope', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes("WHERE provider = 'juwentus'")) {
        expect(params).toEqual([7]);
        expect(text).toContain('recorded_at, source_payload');
        expect(text).toContain('NULLIF(TRIM(CONCAT_WS');
        expect(text).toContain("'auto' AS gps_source_kind");
        expect(text).toContain("l.source_payload->>'accuracy_m' AS accuracy_m");
        expect(text).toContain('AND (t.oddzial_id = $1 OR u.oddzial_id = $1)');
        return {
          rows: [{
            ekipa_id: 12,
            ekipa_nazwa: 'Brygada Alfa',
            oddzial_id: 7,
            vehicle_id: 44,
            nr_rejestracyjny: 'KR12345',
            lat: 50.0614,
            lng: 19.9366,
            speed_kmh: 8,
            heading: 90,
            recorded_at: '2026-05-26T19:10:00.000Z',
            provider: 'juwentus',
            gps_source_kind: 'auto',
            user_name: null,
            accuracy_m: null,
            battery_pct: null,
            platform: null,
            activity: null,
            user_id: null,
            user_rola: null,
          }],
        };
      }
      if (text.includes("WHERE provider = 'mobile'")) {
        expect(params).toEqual([7]);
        expect(text).toContain("recorded_at >= NOW() - INTERVAL '12 hours'");
        expect(text).toContain('NULLIF(TRIM(CONCAT_WS');
        expect(text).toContain("'telefon' AS gps_source_kind");
        expect(text).toContain("l.source_payload->>'battery_pct' AS battery_pct");
        expect(text).toContain("l.source_payload->>'platform' AS platform");
        expect(text).toContain('LEFT JOIN teams t ON t.id = u.ekipa_id OR t.brygadzista_id = u.id');
        expect(text).toContain("AND (u.rola IN ('Brygadzista', 'Pomocnik') OR LOWER(u.rola) LIKE 'wyceniaj%')");
        expect(text).toContain('AND (t.oddzial_id = $1 OR u.oddzial_id = $1)');
        return {
          rows: [{
            ekipa_id: 14,
            ekipa_nazwa: 'Brygada Beta',
            oddzial_id: 7,
            wyceniajacy_id: null,
            wyceniajacy_nazwa: null,
            vehicle_id: null,
            nr_rejestracyjny: 'MOBILE_EKIPA',
            lat: 50.07,
            lng: 19.95,
            speed_kmh: 12.5,
            heading: 91,
            recorded_at: '2026-05-26T19:12:00.000Z',
            provider: 'mobile',
            gps_source_kind: 'telefon',
            user_name: 'Jan Brygadzista',
            accuracy_m: '18',
            battery_pct: '74',
            platform: 'android',
            activity: 'foreground',
            user_id: 22,
            user_rola: 'Brygadzista',
          }],
        };
      }
      return { rows: [] };
    });

    const { getLiveTeamLocations } = loadService();
    const rows = await getLiveTeamLocations({ oddzialId: 7 });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'juwentus', gps_source_kind: 'auto', ekipa_id: 12, nr_rejestracyjny: 'KR12345' }),
      expect.objectContaining({
        provider: 'mobile',
        gps_source_kind: 'telefon',
        ekipa_id: 14,
        user_id: 22,
        user_name: 'Jan Brygadzista',
        accuracy_m: '18',
        battery_pct: '74',
        platform: 'android',
        nr_rejestracyjny: 'MOBILE_EKIPA',
      }),
    ]));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS gps_vehicle_positions'));
  });
});
