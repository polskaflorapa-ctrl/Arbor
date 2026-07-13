import { hasAnyRole } from './roleDisplay';

function freezeRoles(roles) {
  return Object.freeze([...roles]);
}

const ADMIN = freezeRoles(['Prezes', 'Dyrektor', 'Administrator']);
const MANAGEMENT = freezeRoles([...ADMIN, 'Kierownik']);
const SALES = freezeRoles([
  ...MANAGEMENT,
  'Dyrektor Sprzedazy',
  'Dyrektor Sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor działu sprzedaż',
]);
const ESTIMATOR = freezeRoles([...MANAGEMENT, 'Wyceniający', 'Wyceniajacy', 'Specjalista']);
const FINANCE = freezeRoles(['Prezes', 'Dyrektor', 'Administrator']);
const FIELD_SETTLEMENT = freezeRoles([...MANAGEMENT, 'Brygadzista']);
const ESTIMATOR_PAYROLL = freezeRoles([...FINANCE, 'Kierownik', 'Wyceniający', 'Wyceniajacy']);

export const ROLE_GROUPS = Object.freeze({
  ADMIN,
  MANAGEMENT,
  SALES,
  ESTIMATOR,
  FINANCE,
  FIELD_SETTLEMENT,
  ESTIMATOR_PAYROLL,
});

export const ROUTE_ROLE_POLICY = Object.freeze({
  '/mapa-live': MANAGEMENT,
  '/wycena-kalendarz': ESTIMATOR,
  '/blokady-kalendarza': ESTIMATOR,
  '/zatwierdz-wyceny': ESTIMATOR,
  '/wyceny-terenowe': ESTIMATOR,
  '/wyceny-terenowe/:id': ESTIMATOR,
  '/wyceniajacy-hub': ESTIMATOR,
  '/klienci': SALES,
  '/crm': SALES,
  '/crm/today': SALES,
  '/crm/dashboard': SALES,
  '/crm/inbox': SALES,
  '/crm/pipeline': SALES,
  '/nowe-zlecenie': MANAGEMENT,
  '/kierownik': MANAGEMENT,
  '/kontrola-operacyjna': ADMIN,
  '/ekipy': MANAGEMENT,
  '/ranking-brygad': MANAGEMENT,
  '/auto-dispatch': MANAGEMENT,
  '/bi': MANAGEMENT,
  '/hr': MANAGEMENT,
  '/telefonia': MANAGEMENT,
  '/integracje': MANAGEMENT,
  '/zgloszenia-demo': ADMIN,
  '/kadry-dokumenty': MANAGEMENT,
  '/kadry-dokumenty/druk/:userId': MANAGEMENT,
  '/rozliczenia-polowe': FIELD_SETTLEMENT,
  '/ksiegowosc': FINANCE,
  '/wynagrodzenie-wyceniajacych': ESTIMATOR_PAYROLL,
  '/rozliczenia-ekip': MANAGEMENT,
  '/uzytkownicy': ADMIN,
  '/uzytkownicy/:id': ADMIN,
  '/nowy-pracownik': MANAGEMENT,
  '/oddzialy': ADMIN,
  '/oddzialy/:id': ADMIN,
  '/zarzadzaj-rolami': ADMIN,
});

const DYNAMIC_ROUTE_KEYS = Object.freeze([
  [/^\/wyceny-terenowe\/[^/]+$/, '/wyceny-terenowe/:id'],
  [/^\/kadry-dokumenty\/druk\/[^/]+$/, '/kadry-dokumenty/druk/:userId'],
  [/^\/uzytkownicy\/[^/]+$/, '/uzytkownicy/:id'],
  [/^\/oddzialy\/[^/]+$/, '/oddzialy/:id'],
]);

function normalizePath(path) {
  const clean = String(path || '/').split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return clean || '/';
}

function getPolicyKey(path) {
  const normalized = normalizePath(path);
  if (Object.prototype.hasOwnProperty.call(ROUTE_ROLE_POLICY, normalized)) return normalized;
  return DYNAMIC_ROUTE_KEYS.find(([pattern]) => pattern.test(normalized))?.[1] || null;
}

export function getRouteRoles(path) {
  const key = getPolicyKey(path);
  return key ? ROUTE_ROLE_POLICY[key] : null;
}

export function canRoleAccessRoute(role, path) {
  const roles = getRouteRoles(path);
  return roles === null || hasAnyRole(role, roles);
}

/**
 * Keeps an existing navigation allowlist but also applies the router policy.
 * This can only narrow navigation; it never grants a role a new link.
 */
export function filterNavigationItemsByRole(items, role) {
  if (!role) return [];
  return items.filter((item) => (
    hasAnyRole(role, item.roles || []) && canRoleAccessRoute(role, item.path)
  ));
}
