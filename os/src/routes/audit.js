const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validate');
const { z } = require('zod');
const { listAuditLogs } = require('../services/audit');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

const auditListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action: z.string().max(120).optional(),
  entity_type: z.string().max(120).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

const clientEventSchema = z.object({
  action: z.string().trim().min(1).max(120).regex(/^crm\.integration\./),
  entity_type: z.enum(['crm_integration_app', 'crm_branch_setup']),
  entity_id: z.string().max(120).optional().nullable(),
  metadata: z.any().optional().nullable(),
});

router.get(
  '/',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik'),
  validateQuery(auditListQuerySchema),
  async (req, res) => {
    try {
      const data = await listAuditLogs(pool, req.query, req.user);
      res.json({
        items: data.items,
        total: data.total,
        limit: Number(data.limit),
        offset: Number(data.offset),
      });
    } catch (e) {
      logger.error('Blad listy audytu', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/client-event',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik'),
  validateBody(clientEventSchema),
  async (req, res) => {
    const metadata = req.body.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
      ? req.body.metadata
      : {};
    await req.auditLog?.({
      action: req.body.action,
      entityType: req.body.entity_type,
      entityId: req.body.entity_id || null,
      metadata,
    });
    res.status(202).json({ ok: true });
  }
);

module.exports = router;
