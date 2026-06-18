const { env } = require('./env');
const logger = require('./logger');

let Sentry = null;

function initSentry() {
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
  return Sentry.startTransaction({ name, op });
}

module.exports = {
  initSentry,
  getSentry,
  captureException,
  captureMessage,
  setUserContext,
  startTransaction,
};
