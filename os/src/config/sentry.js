const { env } = require('./env');
const logger = require('./logger');

let Sentry = null;

function initSentry() {
  if (Sentry) return Sentry;

  if (env.NODE_ENV !== 'production' && env.NODE_ENV !== 'staging') {
    logger.info('Sentry disabled (not production/staging)');
    return null;
  }

  if (!env.SENTRY_DSN) {
    logger.warn('SENTRY_DSN not configured, Sentry disabled');
    return null;
  }

  try {
    Sentry = require('@sentry/node');
    const { nodeProfilingIntegration } = require('@sentry/profiling-node');

    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      release: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || 'unknown',
      integrations: [
        Sentry.httpIntegration(),
        Sentry.expressIntegration(),
        Sentry.consoleIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        nodeProfilingIntegration(),
      ],
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
      profilesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
      sendDefaultPii: false,
      beforeSend(event) {
        if (env.NODE_ENV === 'development') {
          logger.debug('Sentry event (dev)', { event: JSON.stringify(event, null, 2) });
          return null;
        }
        return event;
      },
      beforeSendTransaction(event) {
        if (event.transaction?.includes('/health') || event.transaction?.includes('/ready')) {
          return null;
        }
        return event;
      },
    });

    logger.info('Sentry initialized', { environment: env.NODE_ENV });
    return Sentry;
  } catch (error) {
    logger.error('Failed to initialize Sentry', { message: error.message });
    return null;
  }
}

function getSentry() {
  return Sentry;
}

function shouldCaptureExpressError(error) {
  const status = Number(error?.statusCode || error?.status);
  return !Number.isFinite(status) || status >= 500;
}

function setupSentryErrorHandler(app, sentry = Sentry) {
  if (!sentry) return false;
  if (typeof sentry.setupExpressErrorHandler !== 'function') {
    logger.warn('Sentry Express error handler unavailable');
    return false;
  }

  sentry.setupExpressErrorHandler(app, {
    shouldHandleError: shouldCaptureExpressError,
  });
  return true;
}

function captureException(error, context = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(error);
  });
}

function captureMessage(message, level = 'info', context = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureMessage(message, level);
  });
}

function setUserContext(user) {
  if (!Sentry) return;
  Sentry.setUser(user ? { id: user.id, email: user.email, role: user.role } : null);
}

function startTransaction(name, op = 'http.server') {
  if (!Sentry) return { finish: () => {} };
  const span = Sentry.startInactiveSpan({ name, op });
  return {
    span,
    finish: () => span.end(),
  };
}

module.exports = {
  initSentry,
  getSentry,
  setupSentryErrorHandler,
  shouldCaptureExpressError,
  captureException,
  captureMessage,
  setUserContext,
  startTransaction,
};
