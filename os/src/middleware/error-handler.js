const logger = require('../config/logger');
const {
  HTTP_NOT_FOUND,
  INTERNAL_ERROR,
  HTTP_CLIENT_ERROR,
} = require('../constants/error-codes');

const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: req.t('errors.http.notFound'),
    code: HTTP_NOT_FOUND,
    path: req.path,
    requestId: req.requestId,
  });
};

const errorHandler = (err, req, res, next) => {
  void next;
  const status = err.statusCode || err.status || 500;
  const payload = {
    error: status >= 500 ? req.t('errors.http.serverError') : err.message,
    code: status >= 500 ? INTERNAL_ERROR : (err.apiCode || HTTP_CLIENT_ERROR),
    requestId: req.requestId,
  };

  if (status >= 500) {
    payload.message = err.message;
  }

  logger.error('Blad HTTP', {
    requestId: req.requestId,
    userId: req.user?.id,
    userLogin: req.user?.login,
    oddzialId: req.user?.oddzial_id,
    rola: req.user?.rola,
    status,
    message: err.message,
    stack: err.stack,
  });
  res.status(status).json(payload);
};

module.exports = { notFoundHandler, errorHandler };
