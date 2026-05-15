/**
 * Lokalna konfiguracja umów wyceniających (per oddział).
 * Uzupełnij oddzial_id zgodnie z bazą oraz matchLoginIncludes per osoba,
 * gdy w jednym oddziale jest więcej niż jeden wyceniający (inne stawki / %).
 *
 * Docelowo: przenieś to na API (np. GET /oddzialy/:id/umowy-wyceniajacego).
 *
 * Port z mobile/constants/wyceniajacy-umowy.ts (bez typów TypeScript).
 */

/** @type {Array<import('./wyceniajacyUmowy').EstimatorContractRule>} */
export const WYCENIAJACY_UMOWY = [
  {
    oddzialId: '1',
    matchLoginIncludes: 'oleg',
    displayName: 'Kraków — Oleg (przykład)',
    dailyBasePln: 200,
    percentRealized: 0.02,
    quoteStatusesForCommission: ['Zlecenie'],
    addons: [],
    calendarMode: 'own',
  },
  {
    oddzialId: '1',
    matchLoginIncludes: 'tomek',
    displayName: 'Kraków — Tomek (przykład, inna stawka)',
    dailyBasePln: 220,
    percentRealized: 0.025,
    quoteStatusesForCommission: ['Zlecenie'],
    addons: [],
    calendarMode: 'own',
  },
  {
    oddzialId: '2',
    matchLoginIncludes: 'oleksandr',
    displayName: 'Wrocław — Oleksandr + nadzór (przykład)',
    dailyBasePln: 200,
    percentRealized: 0.02,
    quoteStatusesForCommission: ['Zlecenie'],
    addons: [
      { id: 'brygady', label: 'Nadzór brygad', monthlyFixedPln: 400 },
      { id: 'sprzet', label: 'Nadzór sprzętu', monthlyFixedPln: 250 },
      { id: 'auta', label: 'Nadzór samochodów', monthlyFixedPln: 250 },
    ],
    calendarMode: 'shared_brigades',
  },
];
