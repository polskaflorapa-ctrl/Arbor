import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

let initialized = false;

function envValue(name: string) {
  const env = process.env as Record<string, string | undefined>;
  return typeof env[name] === 'string' ? env[name]?.trim() ?? '' : '';
}

function parseSampleRate(value: string, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function getErrorMonitoringConfig() {
  const dsn = envValue('EXPO_PUBLIC_SENTRY_DSN');
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: envValue('EXPO_PUBLIC_SENTRY_ENVIRONMENT') || envValue('EXPO_PUBLIC_EXPECTED_API_VERSION') || 'mobile',
    tracesSampleRate: parseSampleRate(envValue('EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'), 0),
  };
}

export function isErrorMonitoringEnabled() {
  return getErrorMonitoringConfig().enabled && initialized;
}

export function initErrorMonitoring() {
  if (initialized) return getErrorMonitoringConfig();

  const config = getErrorMonitoringConfig();
  if (!config.enabled) {
    return config;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    tracesSampleRate: config.tracesSampleRate,
    release: Constants.expoConfig?.version ? `arbor-mobile@${Constants.expoConfig.version}` : undefined,
    dist: Constants.nativeBuildVersion ?? undefined,
    enableNative: true,
    attachStacktrace: true,
  });

  Sentry.setTag('app.slug', Constants.expoConfig?.slug ?? 'arbor-mobile');
  Sentry.setTag('app.ownership', 'field-mobile');
  initialized = true;
  return config;
}

export function captureAppError(error: unknown, extra?: Record<string, unknown>) {
  if (!isErrorMonitoringEnabled()) return;
  Sentry.captureException(error, {
    extra,
  });
}

export function captureAppMessage(message: string, extra?: Record<string, unknown>) {
  if (!isErrorMonitoringEnabled()) return;
  Sentry.captureMessage(message, {
    level: 'info',
    extra,
  });
}
