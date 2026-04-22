const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { blockPayrollSettlements } = require('../middleware/payroll-policy');

const router = express.Router();

router.use(authMiddleware, blockPayrollSettlements);

module.exports = router;
