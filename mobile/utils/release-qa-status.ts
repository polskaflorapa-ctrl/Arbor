export type ReleaseQaState = 'ok' | 'warn' | 'fail';

export type ReleaseQaInput = {
  tokenPresent: boolean;
  apiHealthLevel: 'healthy' | 'partial' | 'down';
  apiVersionMismatch: boolean;
  offlineQueueSize: number;
  sentryEnabled: boolean;
  liveGpsEnabled: boolean;
  liveGpsKind?: 'hidden' | 'starting' | 'active' | 'warning' | 'blocked';
  liveGpsReason?: string;
  lastAppErrorPresent: boolean;
};

export type ReleaseQaItem = {
  key: string;
  label: string;
  value: string;
  state: ReleaseQaState;
  note: string;
};

export function releaseQaSummary(items: ReleaseQaItem[]): ReleaseQaState {
  if (items.some((item) => item.state === 'fail')) return 'fail';
  if (items.some((item) => item.state === 'warn')) return 'warn';
  return 'ok';
}

export function buildReleaseQaItems(input: ReleaseQaInput): ReleaseQaItem[] {
  const gpsState: ReleaseQaState =
    !input.liveGpsEnabled || input.liveGpsKind === 'active' || input.liveGpsKind === 'starting' || input.liveGpsKind === 'hidden'
      ? 'ok'
      : input.liveGpsKind === 'blocked'
        ? 'fail'
        : 'warn';

  return [
    {
      key: 'session',
      label: 'Sesja',
      value: input.tokenPresent ? 'token OK' : 'brak tokenu',
      state: input.tokenPresent ? 'ok' : 'fail',
      note: input.tokenPresent ? 'Tester jest zalogowany.' : 'Zaloguj konto testowe przed QA.',
    },
    {
      key: 'api',
      label: 'API',
      value: input.apiHealthLevel,
      state: input.apiHealthLevel === 'healthy' ? 'ok' : input.apiHealthLevel === 'partial' ? 'warn' : 'fail',
      note: input.apiHealthLevel === 'healthy' ? 'Endpointy odpowiadaja.' : 'Sprawdz bledne probe w diagnostyce.',
    },
    {
      key: 'api-version',
      label: 'Wersja API',
      value: input.apiVersionMismatch ? 'niezgodna' : 'OK',
      state: input.apiVersionMismatch ? 'fail' : 'ok',
      note: input.apiVersionMismatch ? 'Build i backend maja rozne oczekiwane wersje.' : 'Build pasuje do raportowanej wersji backendu.',
    },
    {
      key: 'offline-queue',
      label: 'Offline',
      value: `${input.offlineQueueSize} w kolejce`,
      state: input.offlineQueueSize > 0 ? 'warn' : 'ok',
      note: input.offlineQueueSize > 0 ? 'Wykonaj sync przed decyzja go/no-go.' : 'Brak oczekujacych akcji offline.',
    },
    {
      key: 'sentry',
      label: 'Sentry',
      value: input.sentryEnabled ? 'wlaczone' : 'brak DSN',
      state: input.sentryEnabled ? 'ok' : 'warn',
      note: input.sentryEnabled ? 'Bledy moga trafic do zewnetrznego monitoringu.' : 'OK dla preview, blokuje produkcje bez akceptacji.',
    },
    {
      key: 'gps',
      label: 'GPS live',
      value: input.liveGpsEnabled ? input.liveGpsKind ?? 'brak statusu' : 'wylaczony',
      state: gpsState,
      note: input.liveGpsReason ? `Powod: ${input.liveGpsReason}` : 'Status z ostatniego heartbeat.',
    },
    {
      key: 'last-error',
      label: 'Bledy appki',
      value: input.lastAppErrorPresent ? 'jest raport' : 'brak raportu',
      state: input.lastAppErrorPresent ? 'warn' : 'ok',
      note: input.lastAppErrorPresent ? 'Skopiuj raport i wyczysc przed finalnym pass.' : 'Brak lokalnego crash/error reportu.',
    },
  ];
}

export function formatReleaseQaReport(items: ReleaseQaItem[]): string {
  const summary = releaseQaSummary(items).toUpperCase();
  return [
    `ARBOR mobile release QA status: ${summary}`,
    ...items.map((item) => `${item.state.toUpperCase()} | ${item.label}: ${item.value} | ${item.note}`),
  ].join('\n');
}
