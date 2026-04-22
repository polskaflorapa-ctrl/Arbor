/**
 * Lokalna konfiguracja umów wyceniających (per oddział).
 * Uzupełnij oddzial_id zgodnie z bazą oraz matchLoginIncludes per osoba,
 * gdy w jednym oddziale jest więcej niż jeden wyceniający (inne stawki / %).
 *
 * Docelowo: przenieś to na API (np. GET /oddzialy/:id/umowy-wyceniajacego).
 */

export type EstimatorCalendarMode = 'own' | 'shared_brigades';

export type EstimatorAddon = {
  id: string;
  label: string;
  /** Stała dopłata miesięczna (np. nadzór brygad / sprzęt / auta). */
  monthlyFixedPln?: number;
};

export type EstimatorContractRule = {
  /** ID oddziału z sesji (string). */
  oddzialId: string;
  /**
   * Fragment loginu (małe litery). Przy kilku wyceniających w jednym oddziale
   * każdy wpis powinien mieć unikalny fragment, inaczej `resolveEstimatorContract` zwróci null.
   */
  matchLoginIncludes?: string;
  displayName: string;
  /** Kwota za każdy zadeklarowany dzień roboczy w miesiącu. */
  dailyBasePln: number;
  /** Ułamek od kwoty realizacji (np. 0.02 = 2%). */
  percentRealized: number;
  /**
   * Statusy wyceny, dla których naliczany jest procent.
   * Domyślnie „Zlecenie” = wycena skonwertowana na zlecenie (proxy realizacji).
   */
  quoteStatusesForCommission: string[];
  addons: EstimatorAddon[];
  calendarMode: EstimatorCalendarMode;
};

export const WYCENIAJACY_UMOWY: EstimatorContractRule[] = [
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
