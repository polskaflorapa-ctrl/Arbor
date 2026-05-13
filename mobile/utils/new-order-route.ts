export type NewOrderRouteParams = {
  source?: string;
  inspectionId?: string | number;
  klientId?: string | number;
  klient?: string;
  telefon?: string;
  adres?: string;
  miasto?: string;
  data?: string;
  godzina?: string;
  notatki?: string;
};

export function cleanNewOrderParams(params: NewOrderRouteParams = {}) {
  return Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, value == null ? '' : String(value).trim()])
      .filter(([, value]) => Boolean(value)),
  );
}

export function buildNewOrderRoute(params: NewOrderRouteParams = {}) {
  return {
    pathname: '/nowe-zlecenie',
    params: cleanNewOrderParams(params),
  } as const;
}

export function currentNewOrderDateTime(now = new Date()) {
  return {
    data: now.toISOString().split('T')[0],
    godzina: now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }),
  };
}
