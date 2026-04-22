const { ZodError } = require('zod');
const { translate } = require('../i18n');
const zodPlToKey = require('../i18n/zod-pl-to-key');
const { VALIDATION_FAILED } = require('../constants/error-codes');

const mapIssueMessage = (req, rawMessage) => {
  const key = zodPlToKey[rawMessage];
  if (!key) return rawMessage;
  return translate(req.locale, key);
};

const mapIssues = (req, issues) =>
  issues.map((issue) => ({
    path: issue.path.join('.'),
    message: mapIssueMessage(req, issue.message),
  }));

const handleValidation = (schema, source, target) => (req, res, next) => {
  try {
    req[target] = schema.parse(req[source]);
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: req.t('errors.validation.invalidInput'),
        code: VALIDATION_FAILED,
        requestId: req.requestId,
        details: mapIssues(req, error.issues),
      });
    }

    return next(error);
  }
};

const validateBody = (schema) => handleValidation(schema, 'body', 'body');
const validateParams = (schema) => handleValidation(schema, 'params', 'params');
const validateQuery = (schema) => handleValidation(schema, 'query', 'query');

module.exports = { validateBody, validateParams, validateQuery };
