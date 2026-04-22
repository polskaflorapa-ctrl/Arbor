const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validate');
const { z } = require('zod');
const { listAuditLogs } = require('../services/audit');

const router = express.Router();

const auditListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action: z.string().max(120).optional(),
  entity_type: z.string().max(120).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

router.get(
  '/',
  authMiddleware,
  requireRole('Dyrektor', 'Administrator'),
  validateQuery(auditListQuerySchema),
  async (req, res) => {
    try {
      const data = await listAuditLogs(pool, req.query);
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

module.exports = router;
