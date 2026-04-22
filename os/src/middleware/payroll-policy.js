const { PAYROLL_SETTLEMENTS_BLOCKED } = require('../constants/error-codes');

const blockPayrollSettlements = (req, res) => {
  res.status(403).json({
    error: req.t('errors.payroll.blocked'),
    code: PAYROLL_SETTLEMENTS_BLOCKED,
    requestId: req.requestId,
  });
};

module.exports = {
  blockPayrollSettlements,
};
