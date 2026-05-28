const { explainUnassignedTask, solve } = require('../src/services/vrp');

describe('VRP unassigned diagnostics', () => {
  test('explains missing equipment and competencies when no team can handle task', () => {
    const task = {
      id: 10,
      wymagany_sprzet_typ: 'Podnosnik',
      wymagane_kompetencje: ['Arborysta'],
    };
    const teams = [{ id: 1, sprzet_typy: ['Rebak'], kompetencje: ['Pilarz'] }];

    const reason = explainUnassignedTask(task, teams);

    expect(reason.reason).toBe('no_capable_team');
    expect(reason.missing_equipment).toContain('Podnosnik');
    expect(reason.missing_competencies).toContain('Arborysta');
  });

  test('marks task as time_window_missed when every capable team misses customer window', () => {
    const result = solve({
      date: '2026-05-28',
      teams: [{
        id: 7,
        nazwa: 'Ekipa okna',
        depot_lat: 50.06,
        depot_lng: 19.94,
        max_godzin_dzien: 8,
        sprzet_typy: [],
        kompetencje: [],
      }],
      tasks: [{
        id: 99,
        numer: 'WIN-99',
        status: 'Zaplanowane',
        adres: 'Daleko',
        pin_lat: 50.07,
        pin_lng: 19.95,
        czas_obslugi_min: 60,
        okno_od: '06:00',
        okno_do: '06:50',
      }],
    });

    expect(result.routes).toHaveLength(0);
    expect(result.unassigned[0]).toEqual(expect.objectContaining({
      task_id: 99,
      reason: 'time_window_missed',
      reason_label: expect.stringContaining('okna'),
    }));
  });
});
