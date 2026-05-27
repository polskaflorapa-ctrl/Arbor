const express = require('express');
const { ingestWebhook } = require('../services/crmIntegrations');

const router = express.Router();

router.post('/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });
  const result = await ingestWebhook({ token, payload: req.body || {} });
  return res.status(result.status).json(result.body);
});

module.exports = router;
