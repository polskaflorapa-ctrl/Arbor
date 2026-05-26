jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');

describe('getLiveTeamLocations', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('returns source metadata for vehicle and mobile GPS rows', async () => {
    const vehicleRow = {
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Zielona',
      oddzial_id: 7,
      user_name: null,
      vehicle_id: 9,
      nr_rejestracyjny: 'KR12345',
      lat: 50.061,
      lng: 19.936,
      speed_kmh: 22,
      heading: 90,
      recorded_at: '2026-05-26T20:00:00.000Z',
      provider: 'juwentus',
      gps_source_kind: 'auto',
      accuracy_m: null,
      platform: null,
      activity: null,
      user_id: null,
      user_rola: null,
    };
    const mobileRow = {
      ekipa_id: 4,
      ekipa_nazwa: 'Brygada Debowa',
      oddzial_id: 7,
      user_name: 'Jan Kowalski',
      vehicle_id: null,
      nr_rejestracyjny: 'MOBILE_EKIPA',
      lat: 50.07,
      lng: 19.94,
      speed_kmh: 3,
      heading: 12,
      recorded_at: '2026-05-26T20:05:00.000Z',
      provider: 'mobile',
      gps_source_kind: 'telefon',
      accuracy_m: '18',
      platform: 'android',
      activity: 'foreground',
      user_id: 22,
      user_rola: 'Brygadzista',
    };

    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE UNIQUE INDEX') || text.includes('CREATE INDEX')) {
        return { rows: [] };
      }
      if (text.includes("WHERE provider = 'juwentus'")) {
        expect(text).toContain('source_payload');
        expect(text).toContain("l.source_payload->>'accuracy_m' AS accuracy_m");
        expect(text).toContain("'auto' AS gps_source_kind");
        return { rows: [vehicleRow] };
      }
      if (text.includes("WHERE provider = 'mobile'")) {
        expect(text).toContain("NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), '') AS user_name");
        expect(text).toContain("'telefon' AS gps_source_kind");
        expect(text).toContain("l.source_payload->>'platform' AS platform");
        return { rows: [mobileRow] };
      }
      return { rows: [] };
    });

    const { getLiveTeamLocations } = require('../src/services/juwentus-gps');
    const rows = await getLiveTeamLocations({ oddzialId: 7 });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'juwentus', gps_source_kind: 'auto', nr_rejestracyjny: 'KR12345' }),
      expect.objectContaining({ provider: 'mobile', gps_source_kind: 'telefon', user_name: 'Jan Kowalski', accuracy_m: '18' }),
    ]));
  });
});
