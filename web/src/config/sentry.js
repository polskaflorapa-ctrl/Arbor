import * as Sentry from '@sentry/react';
import { browserTracingIntegration, replayIntegration } from '@sentry/react';

let initialized = false;

function getEnv(name) {
  const env = import.meta.env;
  return typeof env[name] === 'string' ? env[name].trim() : '';
}

function parseSampleRate(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function getSentryConfig() {
  const dsn = getEnv('VITE_SENTRY_DSN');
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: getEnv('VITE_SENTRY_ENVIRONMENT') || (import.meta.env.PROD ? 'production' : 'development'),
    tracesSampleRate: parseSampleRate(getEnv('VITE_SENTRY_TRACES_SAMPLE_RATE'), 0.1),
    replaysSessionSampleRate: parseSampleRate(getEnv('VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE'), 0.1),
    replaysOnErrorSampleRate: parseSampleRate(getEnv('VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE'), 1.0),
    release: getEnv('VITE_APP_VERSION') || 'unknown',
  };
}

export function isSentryEnabled() {
  return getSentryConfig().enabled && initialized;
}

export function initSentry() {
  if (initialized) return getSentryConfig();

  const config = getSentryConfig();
  if (!config.enabled) {
    console.info('[Sentry] Disabled (no DSN)');
    return config;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    integrations: [
      browserTracingIntegration(),
      replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
        maskAllInputs: true,
      }),
    ],
    tracesSampleRate: config.tracesSampleRate,
    replaysSessionSampleRate: config.replaysSessionSampleRate,
    replaysOnErrorSampleRate: config.replaysOnErrorSampleRate,
    sendDefaultPii: false,
    beforeSend(event) {
      if (import.meta.env.DEV) {
        console.debug('[Sentry] Event (dev)', event);
        return null;
      }
      return event;
    },
    ignoreErrors: [
      'Non-Error promise rejection captured',
      'Network request failed',
      'Failed to fetch',
    ],
  });

  initialized = true;
  console.info('[Sentry] Initialized', { environment: config.environment, release: config.release });
  return config;
}

export function setSentryUser(user) {
  if (!isSentryEnabled()) return;
  Sentry.setUser(user ? { id: user.id, email: user.email, role: user.role } : null);
}

export function captureException(error, context = {}) {
  if (!isSentryEnabled()) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(error);
  });
}

export function captureMessage(message, level = 'info', context = {}) {
  if (!isSentryEnabled()) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureMessage(message, level);
  });
}

export { Sentry };
