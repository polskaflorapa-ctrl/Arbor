const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const {
  AUTH_MISSING_TOKEN,
  AUTH_BAD_TOKEN_FORMAT,
  AUTH_INVALID_TOKEN,
  AUTH_FORBIDDEN,
  AUTH_FORBIDDEN_EDIT,
  AUTH_BRANCH_ACCESS_DENIED,
} = require('../constants/error-codes');

const unauthorized = (res, req, key, code) =>
  res.status(401).json({ error: req.t(key), code, requestId: req.requestId });
const forbidden = (res, req, key, code) =>
  res.status(403).json({ error: req.t(key), code, requestId: req.requestId });

const SALES_DIRECTOR_ROLES = new Set([
  'Dyrektor Sprzedazy',
  'Dyrektor Sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor działu sprzedaż',
]);

// ── Role helpers ─────────────────────────────────────────────────────────────
// Canonical source of truth — import from here, never redeclare locally.

const isDyrektor = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return rola === 'Prezes' || rola === 'Dyrektor';
};

const isAdministrator = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return rola === 'Administrator';
};

const isDyrektorOrAdmin = (userOrRole) => isDyrektor(userOrRole) || isAdministrator(userOrRole);

const isKierownik = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return rola === 'Kierownik';
};

const isBrygadzista = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return rola === 'Brygadzista';
};

const isPomocnik = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return rola === 'Pomocnik';
};

const isWyceniajacy = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return rola === 'Wyceniający' || rola === 'Wyceniajacy';
};

const isSalesDirector = (userOrRole) => {
  const rola = typeof userOrRole === 'string' ? userOrRole : userOrRole?.rola;
  return SALES_DIRECTOR_ROLES.has(rola);
};

const canTransferSpecialist = (actor, target) => {
  if (isDyrektor(actor)) return true;
  return isSalesDirector(actor) && target?.rola === 'Specjalista';
};

/**
 * Scopes oddzial_id: Dyrektor/Admin see all (returns null = no filter),
 * everyone else is locked to their own branch.
 * @param {object} user - req.user from JWT
 * @param {number|null} requested - oddzial_id from query/body
 * @returns {number|null}
 */
const scopedOddzialId = (user, requested) => {
  if (isDyrektorOrAdmin(user)) return requested ?? null;
  return user.oddzial_id ?? null;
};

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return unauthorized(res, req, 'errors.auth.missingToken', AUTH_MISSING_TOKEN);
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return unauthorized(res, req, 'errors.auth.badTokenFormat', AUTH_BAD_TOKEN_FORMAT);
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return unauthorized(res, req, 'errors.auth.invalidToken', AUTH_INVALID_TOKEN);
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rola)) {
      return forbidden(res, req, 'errors.auth.forbidden', AUTH_FORBIDDEN);
    }
    next();
  };
};

const requireNieBrygadzista = (req, res, next) => {
  if (!req.user) {
    return forbidden(res, req, 'errors.auth.forbiddenEdit', AUTH_FORBIDDEN_EDIT);
  }
  if (req.user.rola === 'Brygadzista' || req.user.rola === 'Pomocnik') {
    return forbidden(res, req, 'errors.auth.forbiddenEdit', AUTH_FORBIDDEN_EDIT);
  }
  next();
};

const requireNiePomocnik = (req, res, next) => {
  if (!req.user) {
    return forbidden(res, req, 'errors.auth.helperForbidden', AUTH_FORBIDDEN);
  }
  if (req.user.rola === 'Pomocnik') {
    return forbidden(res, req, 'errors.auth.helperForbidden', AUTH_FORBIDDEN);
  }
  next();
};

const requireOddzial = (req, res, next) => {
  if (!req.user) {
    return forbidden(res, req, 'errors.auth.branchAccessDenied', AUTH_BRANCH_ACCESS_DENIED);
  }
  if (!isDyrektorOrAdmin(req.user) && req.query.oddzial_id && req.query.oddzial_id !== req.user.oddzial_id?.toString()) {
    return forbidden(res, req, 'errors.auth.branchAccessDenied', AUTH_BRANCH_ACCESS_DENIED);
  }
  next();
};

const requireOddzialBody = (req, res, next) => {
  if (!req.user) {
    return forbidden(res, req, 'errors.auth.branchAccessDenied', AUTH_BRANCH_ACCESS_DENIED);
  }
  const bodyOddzial = req.body?.oddzial_id;
  if (!isDyrektorOrAdmin(req.user) && bodyOddzial != null && String(bodyOddzial) !== String(req.user.oddzial_id)) {
    return forbidden(res, req, 'errors.auth.branchAccessDenied', AUTH_BRANCH_ACCESS_DENIED);
  }
  next();
};

const buildAppPermissions = (rola) => {
  const director = isDyrektor(rola);
  const admin = isAdministrator(rola);
  const salesDirector = isSalesDirector(rola);
  const kierownik = isKierownik(rola);
  const brygadzista = isBrygadzista(rola);
  const pomocnik = isPomocnik(rola);
  const wyceniajacy = isWyceniajacy(rola);
  const isTeamScoped = brygadzista || pomocnik;
  const canManage = director || admin || kierownik;

  return {
    policyVersion: 2,
    taskScope: director || admin || salesDirector ? 'all' : isTeamScoped ? 'assigned_team_only' : 'branch',
    canTransferSpecialists: director || salesDirector,
    canViewPayrollSettlements: canManage,
    canManagePayrollSettlements: director || admin,
    canViewSettlementModule: canManage || wyceniajacy,
    canCreateTasks: director || admin || kierownik,
    canAssignTeams: director || admin || kierownik,
    canManageTeams: director || admin || kierownik,
    canViewAllBranches: director || admin,
    canManageUsers: director || admin,
    canManageRoles: director || admin,
    canViewCrm: director || admin || salesDirector || kierownik,
    canApproveQuotations: director || admin || salesDirector,
    canViewFinance: director || admin,
    canExportPayroll: director || admin,
  };
};

module.exports = {
  // middleware
  authMiddleware,
  requireRole,
  requireNieBrygadzista,
  requireNiePomocnik,
  requireOddzial,
  requireOddzialBody,
  // role helpers — import from here, never redeclare locally
  isDyrektor,
  isAdministrator,
  isDyrektorOrAdmin,
  isKierownik,
  isBrygadzista,
  isPomocnik,
  isWyceniajacy,
  isSalesDirector,
  canTransferSpecialist,
  scopedOddzialId,
  // permissions
  buildAppPermissions,
};
