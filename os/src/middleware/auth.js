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
  const isDyrektor = req.user.rola === 'Dyrektor' || req.user.rola === 'Administrator';
  if (!isDyrektor && req.query.oddzial_id && req.query.oddzial_id !== req.user.oddzial_id?.toString()) {
    return forbidden(res, req, 'errors.auth.branchAccessDenied', AUTH_BRANCH_ACCESS_DENIED);
  }
  next();
};

const buildAppPermissions = (rola) => {
  const isDyrektor = rola === 'Dyrektor' || rola === 'Administrator';
  const isKierownik = rola === 'Kierownik';
  const isBrygadzista = rola === 'Brygadzista';
  const isPomocnik = rola === 'Pomocnik';
  const isTeamScoped = isBrygadzista || isPomocnik;

  return {
    policyVersion: 1,
    taskScope: isDyrektor ? 'all' : isTeamScoped ? 'assigned_team_only' : 'branch',
    canViewPayrollSettlements: false,
    canManagePayrollSettlements: false,
    canViewSettlementModule: false,
    canCreateTasks: isDyrektor || isKierownik,
    canAssignTeams: isDyrektor || isKierownik,
    canManageTeams: isDyrektor || isKierownik,
  };
};

module.exports = { authMiddleware, requireRole, requireNieBrygadzista, requireNiePomocnik, requireOddzial, buildAppPermissions };
