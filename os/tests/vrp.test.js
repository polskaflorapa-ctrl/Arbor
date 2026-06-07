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

  it('respects crew availability window when building route schedule', () => {
    const result = solve({
      date: '2026-05-25',
      teams: [{
        id: 8,
        nazwa: 'Brygada Poranna',
        depot_lat: 50.061,
        depot_lng: 19.938,
        start_time: '09:00',
        end_time: '11:00',
        max_godzin_dzien: 8,
      }],
      tasks: [{
        id: 102,
        numer: 'ZL/102',
        status: 'Nowe',
        klient_nazwa: 'Jan Kowalski',
        adres: 'Depot',
        pin_lat: 50.061,
        pin_lng: 19.938,
        czas_obslugi_min: 60,
        okno_od: '09:00',
        okno_do: '10:30',
      }],
    });

    expect(result.unassigned).toHaveLength(0);
    expect(result.routes[0]).toEqual(expect.objectContaining({
      start_time: '09:00',
      end_deadline: '11:00',
      end_time: '10:00',
    }));
    expect(result.routes[0].stops[0]).toEqual(expect.objectContaining({
      eta: '09:00',
      finish: '10:00',
    }));
  });

  it('reports route timing metrics and solver totals', () => {
    const result = solve({
      date: '2026-05-25',
      teams: [{
        id: 9,
        nazwa: 'Brygada Metryki',
        depot_lat: 50.061,
        depot_lng: 19.938,
        max_godzin_dzien: 8,
      }],
      tasks: [{
        id: 103,
        numer: 'ZL/103',
        status: 'Nowe',
        klient_nazwa: 'Maria Zielinska',
        adres: 'Depot',
        pin_lat: 50.061,
        pin_lng: 19.938,
        czas_obslugi_min: 30,
        okno_od: '09:00',
        okno_do: '12:00',
      }],
    });

    expect(result.unassigned).toHaveLength(0);
    expect(result.routes[0]).toEqual(expect.objectContaining({
      matrix_source: 'haversine',
      service_min: 30,
      waiting_min: 120,
      utilization_pct: 31,
    }));
    expect(result.routes[0].stops[0]).toEqual(expect.objectContaining({
      eta: '09:00',
      wait_min: 120,
      service_min: 30,
    }));
    expect(result.stats).toEqual(expect.objectContaining({
      matrix_source: 'haversine',
      service_min_total: 30,
      waiting_min_total: 120,
      utilization_avg_pct: 31,
    }));
  });

  it('does not assign a route that cannot return before crew end time', () => {
    const result = solve({
      date: '2026-05-25',
      teams: [{
        id: 10,
        nazwa: 'Brygada Krotki Dzien',
        depot_lat: 50.061,
        depot_lng: 19.938,
        start_time: '09:00',
        end_time: '10:00',
        max_godzin_dzien: 8,
      }],
      tasks: [{
        id: 104,
        numer: 'ZL/104',
        status: 'Nowe',
        klient_nazwa: 'Za dluga praca',
        adres: 'Depot',
        pin_lat: 50.061,
        pin_lng: 19.938,
        czas_obslugi_min: 90,
        okno_od: '09:00',
        okno_do: '12:00',
      }],
    });

    expect(result.routes).toHaveLength(0);
    expect(result.unassigned).toEqual([
      expect.objectContaining({
        task_id: 104,
        reason: 'capacity_exceeded',
      }),
    ]);
    expect(result.stats).toEqual(expect.objectContaining({
      tasks_assigned: 0,
      tasks_unassigned: 1,
      coverage_pct: 0,
    }));
  });
});
