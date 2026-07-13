import {
  ROLE_GROUPS,
  canRoleAccessRoute,
  filterNavigationItemsByRole,
  getRouteRoles,
} from './routeAccess';

test('exposes the same restricted role groups used by the router', () => {
  expect(getRouteRoles('/crm')).toBe(ROLE_GROUPS.SALES);
  expect(getRouteRoles('/telefonia')).toBe(ROLE_GROUPS.MANAGEMENT);
  expect(getRouteRoles('/ksiegowosc')).toBe(ROLE_GROUPS.FINANCE);
  expect(getRouteRoles('/uzytkownicy/42')).toBe(ROLE_GROUPS.ADMIN);
});

test('does not grant sidebar-only roles access to restricted routes', () => {
  expect(canRoleAccessRoute('Handlowiec', '/crm')).toBe(false);
  expect(canRoleAccessRoute('Dyspozytor', '/telefonia')).toBe(false);
  expect(canRoleAccessRoute('Kierownik', '/ksiegowosc')).toBe(false);
  expect(canRoleAccessRoute('Kierownik', '/telefonia')).toBe(true);
});

test('intersects legacy navigation roles with router access without expanding links', () => {
  const links = [
    { path: '/crm', roles: ['Handlowiec', 'Dyrektor'] },
    { path: '/zlecenia', roles: ['Handlowiec', 'Dyrektor'] },
    { path: '/telefonia', roles: ['Dyspozytor', 'Kierownik'] },
  ];

  expect(filterNavigationItemsByRole(links, 'Handlowiec').map((item) => item.path)).toEqual(['/zlecenia']);
  expect(filterNavigationItemsByRole(links, 'Dyspozytor')).toEqual([]);
  expect(filterNavigationItemsByRole(links, 'Kierownik').map((item) => item.path)).toEqual(['/telefonia']);
});
