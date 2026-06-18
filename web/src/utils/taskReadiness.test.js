import { describe, expect, test } from 'vitest';
import {
  getTaskReadiness,
  summarizeTaskReadiness,
} from './taskReadiness';

describe('task readiness checklist', () => {
  test('marks a fully prepared task as ready for crew handoff', () => {
    const readiness = getTaskReadiness({
      klient_telefon: '+48 500 100 200',
      adres: 'Lipowa 8',
      miasto: 'Krakow',
      opis: 'Pielęgnacja drzew i wywóz gałęzi',
      data_planowana: '2026-06-18T09:00:00.000Z',
      wartosc_planowana: 2400,
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Alfa',
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.score).toBe(100);
    expect(readiness.blockers).toEqual([]);
  });

  test('reports missing operational fields with stable blocker keys', () => {
    const readiness = getTaskReadiness({
      klient_telefon: '',
      adres: '',
      miasto: '',
      opis: '',
      data_planowana: '',
      wartosc_planowana: 0,
      ekipa_id: null,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.score).toBe(0);
    expect(readiness.blockers.map((item) => item.key)).toEqual([
      'phone',
      'address',
      'scope',
      'planned_date',
      'quote',
      'team',
    ]);
  });

  test('summarizes ready, blocked, and blocker counts', () => {
    const summary = summarizeTaskReadiness([
      {
        id: 1,
        klient_telefon: '+48500100200',
        adres: 'Lipowa 8',
        opis: 'Wycinka',
        data_planowana: '2026-06-18',
        wartosc_planowana: 1200,
        ekipa_id: 1,
      },
      {
        id: 2,
        klient_telefon: '',
        adres: 'Wielicka 10',
        opis: '',
        data_planowana: '',
        wartosc_planowana: 0,
        ekipa_id: null,
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.ready).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.blockers.phone).toBe(1);
    expect(summary.blockers.scope).toBe(1);
    expect(summary.blockers.quote).toBe(1);
    expect(summary.blockedTasks[0].id).toBe(2);
  });
});
