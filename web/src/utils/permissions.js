/**
 * RBAC permissions helpers for the web frontend.
 *
 * Permissions are written to localStorage at login (key: 'permissions')
 * by Login.js from the /auth/login response.
 *
 * Use readPermissions() anywhere, or the usePermissions() React hook.
 */

/**
 * Roles that can manage the whole organisation (no branch filter).
 */
const DIRECTOR_ROLES = new Set(['Prezes', 'Dyrektor', 'Administrator']);

/**
 * Roles with management capabilities within a branch.
 */
const MANAGER_ROLES = new Set([...DIRECTOR_ROLES, 'Kierownik']);

/**
 * All sales-director role string variants (Polish chars + ASCII fallbacks).
 */
const SALES_DIRECTOR_ROLES = new Set([
  'Dyrektor Sprzedazy',
  'Dyrektor Sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor działu sprzedaż',
]);

/** Returns true if role has director-level access. */
export const isDyrektor = (rola) => DIRECTOR_ROLES.has(rola);

/** Returns true if role has manager-or-above access. */
export const isKierownik = (rola) => MANAGER_ROLES.has(rola);

/** Returns true for any sales-director variant. */
export const isSalesDirector = (rola) => SALES_DIRECTOR_ROLES.has(rola);

/** Returns true for Brygadzista or Pomocnik (field worker). */
export const isFieldWorker = (rola) => rola === 'Brygadzista' || rola === 'Pomocnik';

/**
 * Read the permissions object stored in localStorage.
 * Falls back to a safe "minimal access" object if missing.
 * @returns {import('./permissions').AppPermissions}
 */
export function readPermissions() {
  try {
    const raw = localStorage.getItem('permissions');
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore parse errors */
  }
  return buildFallbackPermissions();
}

/**
 * Derive minimal permissions from the stored user object (rola field).
 * Used when the permissions key is absent (older sessions).
 */
function buildFallbackPermissions() {
  try {
    const raw = localStorage.getItem('user');
    const user = raw ? JSON.parse(raw) : null;
    const rola = user?.rola ?? '';
    const dir = isDyrektor(rola);
    const mgr = isKierownik(rola);
    const sales = isSalesDirector(rola);
    return {
      policyVersion: 0,
      taskScope: dir || sales ? 'all' : isFieldWorker(rola) ? 'assigned_team_only' : 'branch',
      canTransferSpecialists: dir || sales,
      canViewPayrollSettlements: mgr,
      canManagePayrollSettlements: dir,
      canViewSettlementModule: mgr || rola === 'Wyceniający' || rola === 'Wyceniajacy',
      canCreateTasks: mgr,
      canAssignTeams: mgr,
      canManageTeams: mgr,
      canViewAllBranches: dir,
      canManageUsers: dir,
      canManageRoles: dir,
      canViewCrm: mgr || sales || rola === 'Wyceniający',
      canApproveQuotations: dir || sales,
      canViewFinance: dir,
      canExportPayroll: dir,
    };
  } catch {
    return { policyVersion: 0 };
  }
}

/**
 * React hook — returns permissions object, re-reads from localStorage
 * on every render (cheap JSON parse, no network call).
 */
export function usePermissions() {
  return readPermissions();
}
