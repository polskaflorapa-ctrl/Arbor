const { solve } = require('../src/services/vrp');

describe('VRP solver output', () => {
  it('keeps client contact fields on route stops', () => {
    const result = solve({
      date: '2026-05-25',
      teams: [{
        id: 7,
        nazwa: 'Brygada Alfa',
        depot_lat: 50.061,
        depot_lng: 19.938,
        max_godzin_dzien: 8,
      }],
      tasks: [{
        id: 101,
        numer: 'ZL/101',
        status: 'Nowe',
        klient_nazwa: 'Anna Nowak',
        klient_telefon: '+48500111222',
        adres: 'Rynek 1',
        miasto: 'Krakow',
        pin_lat: 50.062,
        pin_lng: 19.94,
        czas_obslugi_min: 45,
        okno_od: '08:00',
        okno_do: '12:00',
      }],
    });

    expect(result.routes).toHaveLength(1);
    expect(result.stats.solver_engine).toBe('arbor-clarke-wright');
    expect(result.routes[0].stops[0]).toEqual(expect.objectContaining({
      client: 'Anna Nowak',
      client_phone: '+48500111222',
    }));
  });
});
