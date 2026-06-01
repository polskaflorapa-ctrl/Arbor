const express = require('express');
const { requestContext } = require('../../src/middleware/request-context');
const { localeMiddleware } = require('../../src/middleware/locale');
const { errorHandler, notFoundHandler } = require('../../src/middleware/error-handler');

const createTestApp = (basePath, router, options = {}) => {
  const app = express();
  app.use(requestContext);
  app.use(localeMiddleware);
  app.use((req, _res, next) => {
    req.auditLog = req.auditLog || options.auditLog || (async () => {});
    next();
  });
  app.use(express.json());
  app.use(basePath, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

module.exports = { createTestApp };
