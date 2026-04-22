const express = require('express');
const { requestContext } = require('../../src/middleware/request-context');
const { localeMiddleware } = require('../../src/middleware/locale');
const { errorHandler, notFoundHandler } = require('../../src/middleware/error-handler');

const createTestApp = (basePath, router) => {
  const app = express();
  app.use(requestContext);
  app.use(localeMiddleware);
  app.use(express.json());
  app.use(basePath, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

module.exports = { createTestApp };
