/**
 * Audit middleware — exposes req.auditLog() convenience wrapper around services/audit.logAudit.
 *
 * Usage in a route handler:
 *   await req.auditLog({ action: 'task.status_change', entityType: 'task', entityId: id,
 *                        metadata: { from: 'Nowe', to: 'W_Realizacji' } });
 */

const pool = require('../config/database');
const { logAudit } = require('../services/audit');

/**
 * Express middleware that attaches req.auditLog() to every request.
 */
function auditMiddleware(req, _res, next) {
  req.auditLog = (opts) => logAudit(pool, req, opts);
  next();
}

module.exports = { auditMiddleware };
