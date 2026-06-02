import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL, CUSTOM_API_URL_STORAGE_KEY, EXPECTED_API_VERSION, WEB_APP_URL, getApiUrl, setRuntimeApiUrl } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { apiFetch, apiUrl } from '../utils/api-client';
import { triggerHaptic } from '../utils/haptics';
import { flushOfflineQueue, getOfflineQueueSize } from '../utils/offline-queue';
import { fetchAndApplyMobileRemoteConfig, getLastReportedApiVersion } from '../utils/mobile-remote-config';
import { getStoredSession } from '../utils/session';
import {
  clearLastAppErrorReport,
  formatAppErrorReport,
  getLastAppErrorReport,
  saveAppErrorReport,
  type AppErrorReport,
} from '../utils/app-error-report';
import { captureAppMessage, getErrorMonitoringConfig } from '../utils/error-monitoring';
import {
  buildReleaseQaItems,
  formatReleaseQaReport,
  releaseQaSummary,
  type ReleaseQaItem,
  type ReleaseQaState,
} from '../utils/release-qa-status';
import {
  getLiveGpsStatusSnapshot,
  isLiveGpsEnabled,
  type LiveGpsStatusSnapshot,
} from '../components/live-gps-heartbeat';

type DiagnosticResult = {
  name: string;
  status: 'idle' | 'ok' | 'error';
  httpCode: number | null;
  latencyMs: number | null;
  details: string;
};

type HealthLevel = 'healthy' | 'partial' | 'down';
type LatencyLevel = 'fast' | 'medium' | 'slow' | 'unknown';
type DiagnosticHistoryItem = {
  checkedAt: string;
  healthLabel: string;
  avgLatency: number | null;
  deltaVsPrevious: number | null;
};

const DIAGNOSTIC_HISTORY_KEY = 'api_diagnostic_history_v1';
const AUTO_REFRESH_MS = 30000;
const AUTO_REFRESH_ENABLED_KEY = 'api_diagnostic_auto_refresh_v1';
const AUTO_SYNC_QUEUE_KEY = 'api_diagnostic_auto_sync_queue_v1';

function makeInitialProbe(nameKey: string): DiagnosticResult {
  return {
    name: nameKey,
    status: 'idle',
    httpCode: null,
    latencyMs: null,
    details: 'apiDiag.detail.idle',
  };
}

type RunSingleOptions = {
  okStatusCodes?: number[];
  authRequiredStatusCodes?: number[];
};

function evaluateHealth(
  items: DiagnosticResult[],
  tr: (key: string, vars?: Record<string, string | number>) => string,
): { level: HealthLevel; label: string } {
  const checked = items.filter((r) => r.status !== 'idle');
  if (!checked.length) return { level: 'partial', label: tr('apiDiag.health.partial') };

  const okCount = checked.filter((r) => r.status === 'ok').length;
  if (okCount === checked.length) return { level: 'healthy', label: tr('apiDiag.health.healthy') };
  if (okCount === 0) return { level: 'down', label: tr('apiDiag.health.down') };
  return { level: 'partial', label: tr('apiDiag.health.partial') };
}

function evaluateLatency(
  latencyMs: number | null,
  tr: (key: string, vars?: Record<string, string | number>) => string,
): { level: LatencyLevel; label: string } {
  if (latencyMs === null || Number.isNaN(latencyMs)) return { level: 'unknown', label: tr('apiDiag.latency.unknown') };
  if (latencyMs < 400) return { level: 'fast', label: tr('apiDiag.latency.fast') };
  if (latencyMs < 1200) return { level: 'medium', label: tr('apiDiag.latency.medium') };
  return { level: 'slow', label: tr('apiDiag.latency.slow') };
}

const calcAverageLatency = (items: DiagnosticResult[]): number | null => {
  const values = items
    .map((item) => item.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return Math.round(sum / values.length);
};

const SPARKLINE_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function buildLatencySparkline(
  history: DiagnosticHistoryItem[],
  tr: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const values = history
    .map((item) => item.avgLatency)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reverse();

  if (!values.length) return tr('apiDiag.sparkline.noData');
  if (values.length === 1) return `${SPARKLINE_BARS[3]} (${values[0]} ms)`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const bars = values.map((value) => {
    const ratio = (value - min) / range;
    const idx = Math.min(SPARKLINE_BARS.length - 1, Math.max(0, Math.round(ratio * (SPARKLINE_BARS.length - 1))));
    return SPARKLINE_BARS[idx];
  });
  return `${bars.join('')} (${values[values.length - 1]}→${values[0]} ms)`;
}

function diagText(
  value: string,
  tr: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (value.startsWith('apiDiag.')) return tr(value);
  return value;
}

export default function ApiDiagnostykaScreen() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const guard = useOddzialFeatureGuard('/api-diagnostyka');
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [tokenPresent, setTokenPresent] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<DiagnosticHistoryItem[]>([]);
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoSyncQueueEnabled, setAutoSyncQueueEnabled] = useState(false);
  const [lastQueueSyncInfo, setLastQueueSyncInfo] = useState<{ flushed: number; left: number } | null>(null);
  const [lastAppError, setLastAppError] = useState<AppErrorReport | null>(null);
  const [liveGpsEnabled, setLiveGpsEnabledState] = useState(true);
  const [liveGpsStatus, setLiveGpsStatus] = useState<LiveGpsStatusSnapshot | null>(null);
  const [results, setResults] = useState<DiagnosticResult[]>([
    makeInitialProbe('apiDiag.probe.backend'),
    makeInitialProbe('apiDiag.probe.auth'),
    makeInitialProbe('apiDiag.probe.tasks'),
    makeInitialProbe('apiDiag.probe.quotationPanel'),
    makeInitialProbe('apiDiag.probe.quotationApprovals'),
    makeInitialProbe('apiDiag.probe.mobileConfig'),
    makeInitialProbe('apiDiag.probe.fleetReservations'),
  ]);
  const [serverApiVer, setServerApiVer] = useState<string | null>(null);
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const nativeApp = Constants.nativeApplicationVersion ?? '—';
  const nativeBuild = Constants.nativeBuildVersion ?? '—';
  const checkedAt = lastCheckedAt ?? 'n/a';
  const okCount = results.filter((r) => r.status === 'ok').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const health = useMemo(() => evaluateHealth(results, t), [results, t]);
  const averageLatency = useMemo(() => calcAverageLatency(results), [results]);
  const globalLatency = useMemo(() => evaluateLatency(averageLatency, t), [averageLatency, t]);
  const latencySparkline = useMemo(() => buildLatencySparkline(history, t), [history, t]);
  const errorMonitoringConfig = useMemo(() => getErrorMonitoringConfig(), []);

  const runSingle = useCallback(async (
    nameKey: string,
    request: () => Promise<Response>,
    options: RunSingleOptions = {},
  ): Promise<DiagnosticResult> => {
    const start = Date.now();
    try {
      const response = await request();
      const latencyMs = Date.now() - start;
      const okCodes = options.okStatusCodes ?? [];
      const authCodes = options.authRequiredStatusCodes ?? [];
      const isAuthRequired = authCodes.includes(response.status);
      const isOk = response.ok || okCodes.includes(response.status) || isAuthRequired;

      let details = t('apiDiag.detail.ok');
      if (isAuthRequired) {
        details = t('apiDiag.detail.authRequired');
      } else if (!isOk) {
        details = t('apiDiag.detail.httpError', { status: response.status });
      }

      return {
        name: nameKey,
        status: isOk ? 'ok' : 'error',
        httpCode: response.status,
        latencyMs,
        details,
      };
    } catch {
      return {
        name: nameKey,
        status: 'error',
        httpCode: null,
        latencyMs: Date.now() - start,
        details: t('apiDiag.detail.networkError'),
      };
    }
  }, [t]);

  const runDiagnostics = useCallback(async () => {
    setRunning(true);
    try {
      const { token } = await getStoredSession();
      setTokenPresent(Boolean(token));
      setOfflineQueueSize(await getOfflineQueueSize());

      const nextResults: DiagnosticResult[] = [];
      nextResults.push(await runSingle('apiDiag.probe.backend', () => apiFetch('/health')));
      nextResults.push(await runSingle('apiDiag.probe.auth', () => apiFetch('/auth/me', { token }), {
        authRequiredStatusCodes: [401, 403],
      }));
      nextResults.push(await runSingle('apiDiag.probe.tasks', () => apiFetch('/tasks/wszystkie', { token }), {
        authRequiredStatusCodes: [401, 403],
      }));
      nextResults.push(await runSingle('apiDiag.probe.quotationPanel', () => apiFetch('/quotations/panel/do-przypisania', { token }), {
        authRequiredStatusCodes: [401, 403],
      }));
      nextResults.push(await runSingle('apiDiag.probe.quotationApprovals', () => apiFetch('/quotations/panel/moje-zatwierdzenia', { token }), {
        authRequiredStatusCodes: [401, 403],
      }));
      nextResults.push(await runSingle('apiDiag.probe.mobileConfig', () => apiFetch('/mobile-config', { token }), {
        okStatusCodes: [404],
        authRequiredStatusCodes: [401, 403],
      }));
      const now = new Date();
      const y = now.getFullYear();
      const m0 = now.getMonth();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fromYmd = `${y}-${pad(m0 + 1)}-01`;
      const lastDay = new Date(y, m0 + 1, 0).getDate();
      const toYmd = `${y}-${pad(m0 + 1)}-${pad(lastDay)}`;
      const rezerwacjeUrl = apiUrl(`/flota/rezerwacje?from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}`);
      nextResults.push(await runSingle('apiDiag.probe.fleetReservations', () => apiFetch(rezerwacjeUrl, { token }), {
        okStatusCodes: [404],
        authRequiredStatusCodes: [401, 403],
      }));

      if (autoSyncQueueEnabled && token) {
        const queueSyncResult = await flushOfflineQueue(token);
        setOfflineQueueSize(queueSyncResult.left);
        setLastQueueSyncInfo(queueSyncResult);
      } else {
        setOfflineQueueSize(await getOfflineQueueSize());
      }

      const checkedAt = new Date().toISOString();
      const health = evaluateHealth(nextResults, t);
      const avgLatency = calcAverageLatency(nextResults);
      let nextHistory: DiagnosticHistoryItem[] = [];
      setHistory((prev) => {
        nextHistory = [
          {
            checkedAt,
            healthLabel: health.label,
            avgLatency,
            deltaVsPrevious:
              typeof avgLatency === 'number' && typeof prev[0]?.avgLatency === 'number'
                ? avgLatency - prev[0].avgLatency
                : null,
          },
          ...prev,
        ].slice(0, 5);
        return nextHistory;
      });

      if (token) {
        await fetchAndApplyMobileRemoteConfig(token);
      }
      setServerApiVer(await getLastReportedApiVersion());

      setResults(nextResults);
      setLastCheckedAt(checkedAt);
      await AsyncStorage.setItem(DIAGNOSTIC_HISTORY_KEY, JSON.stringify(nextHistory));
    } finally {
      setRunning(false);
      setRefreshing(false);
    }
  }, [autoSyncQueueEnabled, runSingle, t]);

  const refreshLastAppError = useCallback(async () => {
    setLastAppError(await getLastAppErrorReport());
  }, []);

  const refreshReleaseQaInputs = useCallback(async () => {
    const [enabled, status, queueSize] = await Promise.all([
      isLiveGpsEnabled(),
      getLiveGpsStatusSnapshot(),
      getOfflineQueueSize(),
    ]);
    setLiveGpsEnabledState(enabled);
    setLiveGpsStatus(status);
    setOfflineQueueSize(queueSize);
  }, []);

  const copyLastAppError = async () => {
    if (!lastAppError) return;
    await Clipboard.setStringAsync(formatAppErrorReport(lastAppError));
    void triggerHaptic('success');
    Alert.alert('Skopiowano raport', 'Raport bledu aplikacji jest w schowku.');
  };

  const copyReleaseQaReport = async (items: ReleaseQaItem[]) => {
    await Clipboard.setStringAsync(formatReleaseQaReport(items));
    void triggerHaptic('success');
    Alert.alert('Skopiowano QA status', 'Status release QA jest w schowku.');
  };

  const clearLastAppError = async () => {
    await clearLastAppErrorReport();
    setLastAppError(null);
    void triggerHaptic('warning');
    Alert.alert('Wyczyszczono raport', 'Lokalny raport bledu zostal usuniety.');
  };

  const createTestAppErrorReport = async () => {
    const report = await saveAppErrorReport({
      source: 'manual-test',
      name: 'ManualDiagnosticsError',
      message: 'Testowy raport bledu zapisany z ekranu diagnostyki API.',
      stack: 'ManualDiagnosticsError: Testowy raport\n    at ApiDiagnostykaScreen',
      appRoute: '/api-diagnostyka',
    });
    captureAppMessage('Manual mobile diagnostics error report test', {
      source: 'api-diagnostyka',
      reportId: report.id,
    });
    setLastAppError(report);
    void triggerHaptic('success');
    Alert.alert('Zapisano test', 'Testowy raport bledu jest widoczny w diagnostyce.');
  };

  useEffect(() => {
    void getLastReportedApiVersion().then(setServerApiVer);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(DIAGNOSTIC_HISTORY_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setHistory(
            parsed
              .filter((item) => item && typeof item.checkedAt === 'string')
              .map((item) => ({
                checkedAt: item.checkedAt,
                healthLabel: item.healthLabel ?? 'apiDiag.latency.unknown',
                avgLatency: typeof item.avgLatency === 'number' ? item.avgLatency : null,
                deltaVsPrevious: typeof item.deltaVsPrevious === 'number' ? item.deltaVsPrevious : null,
              }))
              .slice(0, 5),
          );
        }
      } catch {
        // ignore corrupted local history
      }
    });
    AsyncStorage.getItem(AUTO_REFRESH_ENABLED_KEY).then((raw) => {
      setAutoRefreshEnabled(raw === 'true');
    });
    AsyncStorage.getItem(AUTO_SYNC_QUEUE_KEY).then((raw) => {
      setAutoSyncQueueEnabled(raw === 'true');
    });
    void refreshLastAppError();
    void refreshReleaseQaInputs();
    void runDiagnostics();
  }, [refreshLastAppError, refreshReleaseQaInputs, runDiagnostics]);

  useEffect(() => {
    AsyncStorage.setItem(AUTO_REFRESH_ENABLED_KEY, autoRefreshEnabled ? 'true' : 'false');
  }, [autoRefreshEnabled]);

  useEffect(() => {
    AsyncStorage.setItem(AUTO_SYNC_QUEUE_KEY, autoSyncQueueEnabled ? 'true' : 'false');
  }, [autoSyncQueueEnabled]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const intervalId = setInterval(() => {
      if (!running) {
        void runDiagnostics();
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [autoRefreshEnabled, runDiagnostics, running]);

  const buildReport = () => {
    const trend =
      typeof history[0]?.deltaVsPrevious === 'number'
        ? `${history[0].deltaVsPrevious > 0 ? '+' : ''}${history[0].deltaVsPrevious} ms`
        : t('apiDiag.delta.none');
    const lines = [
      t('apiDiag.rptTitle'),
      t('apiDiag.rptChecked', { at: checkedAt }),
      t('apiDiag.rptVersion', { v: appVersion }),
      t('apiDiag.info.nativeBuild', { native: nativeApp, build: nativeBuild }),
      t('apiDiag.rptApiUrl', { url: API_URL }),
      t('apiDiag.rptToken', { val: tokenPresent ? t('apiDiag.token.yes') : t('apiDiag.token.no') }),
      t('apiDiag.rptSummary', { ok: okCount, err: errorCount }),
      t('apiDiag.rptHealth', { label: health.label }),
      t('apiDiag.rptAvg', { ms: averageLatency ?? '-', perf: globalLatency.label }),
      t('apiDiag.rptTrend', { trend }),
      t('apiDiag.rptSpark', { line: latencySparkline }),
      ...results.map((item) => {
        const status = item.status.toUpperCase();
        const latency = evaluateLatency(item.latencyMs, t);
        return t('apiDiag.rptRow', {
          name: diagText(item.name, t),
          status,
          http: item.httpCode ?? '-',
          lat: item.latencyMs ?? '-',
          perf: latency.label,
          details: diagText(item.details, t),
        });
      }),
    ];
    return lines.join('\n');
  };

  const copyReport = async () => {
    await Clipboard.setStringAsync(buildReport());
    void triggerHaptic('success');
    Alert.alert(t('apiDiag.alert.copiedTitle'), t('apiDiag.alert.copiedBody'));
  };

  const shareReport = async () => {
    const report = buildReport();
    await Share.share({
      title: t('apiDiag.shareReport'),
      message: report,
    });
  };

  const clearHistory = async () => {
    await AsyncStorage.removeItem(DIAGNOSTIC_HISTORY_KEY);
    setHistory([]);
    void triggerHaptic('warning');
    Alert.alert(t('apiDiag.alert.clearedTitle'), t('apiDiag.alert.clearedBody'));
  };

  const syncOfflineQueueNow = async () => {
    setSyncingQueue(true);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        Alert.alert(t('apiDiag.alert.noTokenTitle'), t('apiDiag.alert.noTokenBody'));
        setOfflineQueueSize(await getOfflineQueueSize());
        return;
      }
      const result = await flushOfflineQueue(token);
      setOfflineQueueSize(result.left);
      setLastQueueSyncInfo(result);
      void triggerHaptic('success');
      Alert.alert(t('apiDiag.alert.syncTitle'), t('apiDiag.alert.syncBody', { flushed: result.flushed, left: result.left }));
    } finally {
      setSyncingQueue(false);
    }
  };

  const [customUrlInput, setCustomUrlInput] = useState('');
  const [customUrlSaved, setCustomUrlSaved] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_API_URL_STORAGE_KEY).then((v) => {
      if (v) setCustomUrlInput(v);
    });
  }, []);

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return (
      <View style={[S.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const healthColor = health.level === 'healthy' ? theme.success : health.level === 'down' ? theme.danger : theme.warning;
  const healthBg = health.level === 'healthy' ? theme.successBg : health.level === 'down' ? theme.dangerBg : theme.warningBg;
  const healthIcon = health.level === 'healthy' ? 'heart' : health.level === 'down' ? 'alert-circle' : 'pulse';
  const globalLatencyColor =
    globalLatency.level === 'fast'
      ? theme.success
      : globalLatency.level === 'medium'
        ? theme.warning
        : globalLatency.level === 'slow'
          ? theme.danger
          : theme.textMuted;
  const globalLatencyBg =
    globalLatency.level === 'fast'
      ? theme.successBg
      : globalLatency.level === 'medium'
        ? theme.warningBg
        : globalLatency.level === 'slow'
          ? theme.dangerBg
          : theme.surface2;

  const expectedApi = EXPECTED_API_VERSION;
  const apiVersionMismatch = Boolean(
    expectedApi && serverApiVer && serverApiVer !== expectedApi,
  );
  const failingResults = results.filter((item) => item.status === 'error');
  const primaryIssue = failingResults[0] ?? null;
  const actionState = (() => {
    if (!primaryIssue) {
      return {
        icon: 'shield-checkmark' as const,
        color: theme.success,
        bg: theme.successBg,
        title: t('apiDiag.action.readyTitle'),
        sub: t('apiDiag.action.readySub'),
      };
    }
    if (primaryIssue.httpCode === 404) {
      return {
        icon: 'git-branch-outline' as const,
        color: theme.warning,
        bg: theme.warningBg,
        title: t('apiDiag.action.missingEndpointTitle'),
        sub: t('apiDiag.action.missingEndpointSub', { name: diagText(primaryIssue.name, t) }),
      };
    }
    if (primaryIssue.httpCode === null) {
      return {
        icon: 'cloud-offline-outline' as const,
        color: theme.danger,
        bg: theme.dangerBg,
        title: t('apiDiag.action.networkTitle'),
        sub: t('apiDiag.action.networkSub'),
      };
    }
    if (primaryIssue.httpCode >= 500) {
      return {
        icon: 'server-outline' as const,
        color: theme.danger,
        bg: theme.dangerBg,
        title: t('apiDiag.action.serverTitle'),
        sub: t('apiDiag.action.serverSub', { status: primaryIssue.httpCode }),
      };
    }
    return {
      icon: 'key-outline' as const,
      color: theme.warning,
      bg: theme.warningBg,
      title: t('apiDiag.action.authTitle'),
      sub: t('apiDiag.action.authSub', { status: primaryIssue.httpCode }),
    };
  })();
  const saveCustomUrl = async () => {
    const trimmed = customUrlInput.trim();
    if (trimmed) {
      await AsyncStorage.setItem(CUSTOM_API_URL_STORAGE_KEY, trimmed);
      setRuntimeApiUrl(trimmed);
    } else {
      await AsyncStorage.removeItem(CUSTOM_API_URL_STORAGE_KEY);
      setRuntimeApiUrl(null);
    }
    setCustomUrlSaved(true);
    setTimeout(() => setCustomUrlSaved(false), 2500);
  };

  const configRows = [
    { label: 'Czas', value: checkedAt },
    { label: 'Aplikacja', value: `${appVersion} / native ${nativeApp} / build ${nativeBuild}` },
    { label: 'API (build)', value: API_URL },
    { label: 'API (aktywny)', value: getApiUrl() },
    { label: 'Panel web', value: WEB_APP_URL },
    { label: 'Token', value: tokenPresent ? t('apiDiag.token.yes') : t('apiDiag.token.no') },
    { label: 'Kolejka offline', value: String(offlineQueueSize) },
    { label: 'Sentry', value: errorMonitoringConfig.enabled ? `wlaczone (${errorMonitoringConfig.environment})` : 'brak DSN - lokalny fallback' },
  ];
  const heroStats = [
    { label: 'OK', value: String(okCount), icon: 'checkmark-circle' as const, color: theme.success, bg: theme.successBg },
    { label: 'Błędy', value: String(errorCount), icon: 'alert-circle' as const, color: theme.danger, bg: theme.dangerBg },
    { label: 'Opóźnienie', value: averageLatency === null ? '-' : `${averageLatency} ms`, icon: 'speedometer-outline' as const, color: globalLatencyColor, bg: globalLatencyBg },
  ];
  const lastAppErrorDate = lastAppError ? new Date(lastAppError.createdAt).toLocaleString(dateLocale) : null;
  const lastAppErrorStackPreview = lastAppError?.stack || lastAppError?.componentStack || '';
  const releaseQaItems = buildReleaseQaItems({
    tokenPresent,
    apiHealthLevel: health.level,
    apiVersionMismatch,
    offlineQueueSize,
    sentryEnabled: errorMonitoringConfig.enabled,
    liveGpsEnabled,
    liveGpsKind: liveGpsStatus?.kind,
    liveGpsReason: liveGpsStatus?.reason,
    lastAppErrorPresent: Boolean(lastAppError),
  });
  const releaseQaState = releaseQaSummary(releaseQaItems);
  const releaseQaColor = releaseQaState === 'ok' ? theme.success : releaseQaState === 'warn' ? theme.warning : theme.danger;
  const releaseQaBg = releaseQaState === 'ok' ? theme.successBg : releaseQaState === 'warn' ? theme.warningBg : theme.dangerBg;
  const releaseQaLabel = releaseQaState === 'ok' ? 'Gotowe do QA' : releaseQaState === 'warn' ? 'Wymaga uwagi' : 'Blokuje release';
  const releaseQaIcon = releaseQaState === 'ok' ? 'checkmark-done-circle-outline' : releaseQaState === 'warn' ? 'warning-outline' : 'close-circle-outline';
  const releaseQaItemColor = (state: ReleaseQaState) => state === 'ok' ? theme.success : state === 'warn' ? theme.warning : theme.danger;
  const releaseQaItemBg = (state: ReleaseQaState) => state === 'ok' ? theme.successBg : state === 'warn' ? theme.warningBg : theme.dangerBg;

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'light' ? 'dark-content' : 'light-content'} backgroundColor={theme.headerBg} />
      <View style={S.header}>
        <TouchableOpacity
          onPress={() => {
            void triggerHaptic('light');
            safeBack();
          }}
          style={S.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('apiDiag.title')}</Text>
        <TouchableOpacity
          onPress={() => {
            void triggerHaptic('light');
            void refreshReleaseQaInputs();
            void runDiagnostics();
          }}
          style={S.refreshBtn}
          disabled={running}
        >
          {running ? <ActivityIndicator size="small" color={theme.accent} /> : <Ionicons name="refresh" size={20} color={theme.accent} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void refreshReleaseQaInputs();
              void runDiagnostics();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={S.heroCard}>
          <View style={S.heroTop}>
            <View style={[S.heroIcon, { backgroundColor: healthBg, borderColor: healthColor + '44' }]}>
              <Ionicons name={healthIcon} size={22} color={healthColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.heroEyebrow}>ARBOR-OS API</Text>
              <Text style={S.heroTitle}>{health.label}</Text>
              <Text style={S.heroSub} numberOfLines={2}>
                {t('apiDiag.info.summary', { ok: okCount, err: errorCount })} · {t('apiDiag.info.avgLatency', { ms: averageLatency ?? '-' })}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                void triggerHaptic('light');
                void refreshReleaseQaInputs();
                void runDiagnostics();
              }}
              style={S.heroRefresh}
              disabled={running}
            >
              {running ? <ActivityIndicator size="small" color={theme.accentText} /> : <Ionicons name="refresh" size={18} color={theme.accentText} />}
            </TouchableOpacity>
          </View>
          <View style={S.heroStats}>
            {heroStats.map((stat) => (
              <View key={stat.label} style={[S.heroStat, { backgroundColor: stat.bg, borderColor: stat.color + '44' }]}>
                <Ionicons name={stat.icon} size={15} color={stat.color} />
                <Text style={[S.heroStatValue, { color: stat.color }]} numberOfLines={1}>{stat.value}</Text>
                <Text style={S.heroStatLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[S.actionCard, { backgroundColor: actionState.bg, borderColor: actionState.color + '44' }]}>
          <View style={[S.actionIcon, { backgroundColor: actionState.color + '18', borderColor: actionState.color + '55' }]}>
            <Ionicons name={actionState.icon} size={20} color={actionState.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.actionEyebrow}>{t('apiDiag.action.eyebrow')}</Text>
            <Text style={[S.actionTitle, { color: actionState.color }]}>{actionState.title}</Text>
            <Text style={S.actionSub}>{actionState.sub}</Text>
          </View>
        </View>

        <View style={S.releaseQaBox}>
          <View style={S.releaseQaHeader}>
            <View style={[S.releaseQaIcon, { backgroundColor: releaseQaBg, borderColor: releaseQaColor + '44' }]}>
              <Ionicons name={releaseQaIcon} size={20} color={releaseQaColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.releaseQaEyebrow}>RELEASE QA</Text>
              <Text style={[S.releaseQaTitle, { color: releaseQaColor }]}>{releaseQaLabel}</Text>
              <Text style={S.releaseQaSub}>Build, API, offline, GPS i monitoring w jednym miejscu.</Text>
            </View>
            <TouchableOpacity style={S.releaseQaCopyBtn} onPress={() => void copyReleaseQaReport(releaseQaItems)}>
              <Ionicons name="copy-outline" size={15} color={theme.accentText} />
            </TouchableOpacity>
          </View>
          <View style={S.releaseQaGrid}>
            {releaseQaItems.map((item) => {
              const color = releaseQaItemColor(item.state);
              return (
                <View key={item.key} style={[S.releaseQaItem, { backgroundColor: releaseQaItemBg(item.state), borderColor: color + '44' }]}>
                  <View style={S.releaseQaItemTop}>
                    <Text style={[S.releaseQaItemLabel, { color }]}>{item.label}</Text>
                    <View style={[S.releaseQaPill, { backgroundColor: color + '18' }]}>
                      <Text style={[S.releaseQaPillText, { color }]}>{item.state.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={S.releaseQaValue} numberOfLines={1}>{item.value}</Text>
                  <Text style={S.releaseQaNote} numberOfLines={2}>{item.note}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={S.infoBox}>
          <View style={S.infoHeader}>
            <View style={{ flex: 1 }}>
              <Text style={S.infoTitle}>{t('apiDiag.infoTitle')}</Text>
              <Text style={S.infoSubtitle}>Konfiguracja i połączenie produkcyjne</Text>
            </View>
            <View style={[S.healthDot, { backgroundColor: healthColor }]} />
          </View>
          {configRows.map((row) => (
            <View key={row.label} style={S.configRow}>
              <Text style={S.configLabel}>{row.label}</Text>
              <Text style={S.configValue} selectable numberOfLines={2}>{row.value}</Text>
            </View>
          ))}
          <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
            <Text style={[S.configLabel, { marginBottom: 6, fontWeight: '700' }]}>Nadpisz URL backendu (po zapisie restart apki)</Text>
            <TextInput
              style={[S.configValue, { borderWidth: 1, borderColor: theme.inputBorder, borderRadius: 8, padding: 8, color: theme.text, backgroundColor: theme.inputBg, minHeight: 40 }]}
              value={customUrlInput}
              onChangeText={setCustomUrlInput}
              placeholder={`Domyślny: ${API_URL}`}
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => void saveCustomUrl()}
              style={{ marginTop: 8, backgroundColor: customUrlSaved ? theme.success : theme.accent, borderRadius: 8, padding: 10, alignItems: 'center' }}
            >
              <Text style={{ color: theme.accentText, fontWeight: '700', fontSize: 13 }}>
                {customUrlSaved ? '✓ Zapisano — zrestartuj aplikację' : 'Zapisz URL'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={S.configRow}>
            <Text style={S.configLabel}>{t('apiDiag.serverVersion')}</Text>
            <Text style={S.configValue} selectable>{serverApiVer ?? '-'}</Text>
          </View>
          {expectedApi ? (
            <View style={S.configRow}>
              <Text style={S.configLabel}>{t('apiDiag.expectedApi')}</Text>
              <Text style={[S.configValue, apiVersionMismatch && { color: theme.danger, fontWeight: '900' }]}>
                {expectedApi}{apiVersionMismatch ? ' !' : ' OK'}
              </Text>
            </View>
          ) : null}
          <Text style={S.infoLine}>
            {t('apiDiag.serverVersion')}: {serverApiVer ?? '—'}
          </Text>
          {expectedApi ? (
            <Text style={[S.infoLine, apiVersionMismatch && { color: theme.danger, fontWeight: '700' }]}>
              {t('apiDiag.expectedApi')}: {expectedApi}
              {apiVersionMismatch ? ' ⚠' : ' ✓'}
            </Text>
          ) : null}
          <Text style={S.infoLine}>{t('apiDiag.info.apiUrl', { url: API_URL })}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.webAppUrl', { url: WEB_APP_URL })}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.token', { val: tokenPresent ? t('apiDiag.token.yes') : t('apiDiag.token.no') })}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.queue', { n: offlineQueueSize })}</Text>
          {lastQueueSyncInfo ? (
            <View style={S.queueStatusChip}>
              <Ionicons name="cloud-done-outline" size={13} color={theme.success} />
              <Text style={[S.queueStatusText, { color: theme.success }]}>
                {t('apiDiag.queueSyncLine', { flushed: lastQueueSyncInfo.flushed, left: lastQueueSyncInfo.left })}
              </Text>
            </View>
          ) : null}
          <Text style={S.infoLine}>{t('apiDiag.info.summary', { ok: okCount, err: errorCount })}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.avgLatency', { ms: averageLatency ?? '-' })}</Text>
          <TouchableOpacity style={S.queueSyncBtn} onPress={() => void syncOfflineQueueNow()} disabled={syncingQueue}>
            {syncingQueue ? <ActivityIndicator size="small" color={theme.accentText} /> : <Ionicons name="cloud-upload-outline" size={14} color={theme.accentText} />}
            <Text style={S.copyBtnText}>{t('apiDiag.forceSync')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.toggleBtn, autoSyncQueueEnabled && { backgroundColor: theme.successBg }]}
            onPress={() => setAutoSyncQueueEnabled((prev) => !prev)}
          >
            <Ionicons
              name={autoSyncQueueEnabled ? 'sync-circle-outline' : 'sync-outline'}
              size={14}
              color={autoSyncQueueEnabled ? theme.success : theme.textSub}
            />
            <Text style={[S.toggleBtnText, { color: autoSyncQueueEnabled ? theme.success : theme.textSub }]}>
              {t('apiDiag.autoSync', { state: t(autoSyncQueueEnabled ? 'apiDiag.autoSync.on' : 'apiDiag.autoSync.off') })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.toggleBtn, autoRefreshEnabled && { backgroundColor: theme.successBg }]}
            onPress={() => setAutoRefreshEnabled((prev) => !prev)}
          >
            <Ionicons
              name={autoRefreshEnabled ? 'pause-circle-outline' : 'play-circle-outline'}
              size={14}
              color={autoRefreshEnabled ? theme.success : theme.textSub}
            />
            <Text style={[S.toggleBtnText, { color: autoRefreshEnabled ? theme.success : theme.textSub }]}>
              {t('apiDiag.autoRefresh', { state: t(autoRefreshEnabled ? 'apiDiag.autoRefresh.on' : 'apiDiag.autoRefresh.off') })}
            </Text>
          </TouchableOpacity>
          <View style={[S.healthBadge, { backgroundColor: healthBg }]}>
            <Ionicons name={healthIcon} size={14} color={healthColor} />
            <Text style={[S.healthBadgeText, { color: healthColor }]}>{t('apiDiag.health.api', { label: health.label })}</Text>
          </View>
          <View style={[S.healthBadge, { backgroundColor: globalLatencyBg }]}>
            <Ionicons name="speedometer-outline" size={14} color={globalLatencyColor} />
            <Text style={[S.healthBadgeText, { color: globalLatencyColor }]}>{t('apiDiag.perfGlobal', { label: globalLatency.label })}</Text>
          </View>
          <View style={S.actionsRow}>
            <TouchableOpacity style={S.copyBtn} onPress={() => void copyReport()}>
              <Ionicons name="copy-outline" size={14} color={theme.accentText} />
              <Text style={S.copyBtnText}>{t('apiDiag.copyReport')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.shareBtn} onPress={() => void shareReport()}>
              <Ionicons name="share-social-outline" size={14} color={theme.accentText} />
              <Text style={S.copyBtnText}>{t('apiDiag.shareReport')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.errorReportBox}>
          <View style={S.errorReportHeader}>
            <View style={{ flex: 1 }}>
              <Text style={S.errorReportTitle}>Monitoring bledow</Text>
              <Text style={S.errorReportSub}>
                {lastAppError
                  ? `Ostatni lokalny raport aplikacji. Sentry: ${errorMonitoringConfig.enabled ? 'wlaczone' : 'brak DSN'}`
                  : `Brak lokalnego raportu. Sentry: ${errorMonitoringConfig.enabled ? 'wlaczone' : 'brak DSN - lokalny fallback'}.`}
              </Text>
            </View>
            <Ionicons
              name={lastAppError ? 'bug-outline' : 'shield-checkmark-outline'}
              size={20}
              color={lastAppError ? theme.warning : theme.success}
            />
          </View>
          {lastAppError ? (
            <>
              <View style={S.configRow}>
                <Text style={S.configLabel}>Czas</Text>
                <Text style={S.configValue} selectable>{lastAppErrorDate}</Text>
              </View>
              <View style={S.configRow}>
                <Text style={S.configLabel}>Zrodlo</Text>
                <Text style={S.configValue}>{lastAppError.source}</Text>
              </View>
              <View style={S.configRow}>
                <Text style={S.configLabel}>Blad</Text>
                <Text style={S.configValue} selectable>{lastAppError.name ? `${lastAppError.name}: ` : ''}{lastAppError.message}</Text>
              </View>
              {lastAppErrorStackPreview ? (
                <Text style={S.errorReportStack} selectable numberOfLines={6}>
                  {lastAppErrorStackPreview}
                </Text>
              ) : null}
              <View style={S.actionsRow}>
                <TouchableOpacity style={S.copyBtn} onPress={() => void copyLastAppError()}>
                  <Ionicons name="copy-outline" size={14} color={theme.accentText} />
                  <Text style={S.copyBtnText}>Kopiuj raport bledu</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.clearBtn} onPress={() => void clearLastAppError()}>
                  <Ionicons name="trash-outline" size={13} color={theme.danger} />
                  <Text style={[S.clearBtnText, { color: theme.danger }]}>Wyczysc</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity style={S.testErrorBtn} onPress={() => void createTestAppErrorReport()}>
              <Ionicons name="flask-outline" size={14} color={theme.accentText} />
              <Text style={S.copyBtnText}>Zapisz testowy raport</Text>
            </TouchableOpacity>
          )}
        </View>

        {results.map((item) => {
          const color = item.status === 'ok' ? theme.success : item.status === 'error' ? theme.danger : theme.textMuted;
          const icon = item.status === 'ok' ? 'checkmark-circle' : item.status === 'error' ? 'close-circle' : 'ellipse-outline';
          const latency = evaluateLatency(item.latencyMs, t);
          const latencyColor =
            latency.level === 'fast'
              ? theme.success
              : latency.level === 'medium'
                ? theme.warning
                : latency.level === 'slow'
                  ? theme.danger
                  : theme.textMuted;
          return (
            <View key={item.name} style={S.card}>
              <View style={S.cardTop}>
                <View style={S.row}>
                  <Ionicons name={icon} size={16} color={color} />
                  <Text style={S.cardTitle}>{diagText(item.name, t)}</Text>
                </View>
                <Text style={[S.badge, { color }]}>{item.httpCode ?? '-'}</Text>
              </View>
              <Text style={S.detail}>{diagText(item.details, t)}</Text>
              <Text style={S.detail}>{t('apiDiag.latencyMs', { ms: item.latencyMs ?? '-' })}</Text>
              <View style={S.latencyRow}>
                <Ionicons name="speedometer-outline" size={13} color={latencyColor} />
                <Text style={[S.latencyText, { color: latencyColor }]}>{t('apiDiag.perfRow', { label: latency.label })}</Text>
              </View>
            </View>
          );
        })}

        <View style={S.tipBox}>
          <Text style={S.tipTitle}>{t('apiDiag.tipTitle')}</Text>
          <Text style={S.tipText}>{t('apiDiag.tip404')}</Text>
          <Text style={S.tipText}>{t('apiDiag.tip401')}</Text>
          <Text style={S.tipText}>{t('apiDiag.tipNoHttp')}</Text>
          <Text style={S.tipText}>{t('apiDiag.tipLatency')}</Text>
        </View>

        <View style={S.historyBox}>
          <View style={S.historyHeader}>
            <Text style={S.historyTitle}>{t('apiDiag.historyTitle')}</Text>
            <TouchableOpacity style={S.clearBtn} onPress={() => void clearHistory()}>
              <Ionicons name="trash-outline" size={13} color={theme.danger} />
              <Text style={[S.clearBtnText, { color: theme.danger }]}>{t('common.clear')}</Text>
            </TouchableOpacity>
          </View>
          <View style={S.sparklineRow}>
            <Ionicons name="analytics-outline" size={13} color={theme.info} />
            <Text style={[S.sparklineText, { color: theme.info }]}>{t('apiDiag.sparklineLabel', { line: latencySparkline })}</Text>
          </View>
          {history.length === 0 ? (
            <Text style={S.historyLine}>{t('apiDiag.historyEmpty')}</Text>
          ) : (
            history.map((item) => {
              const isFaster = typeof item.deltaVsPrevious === 'number' && item.deltaVsPrevious < 0;
              const isSlower = typeof item.deltaVsPrevious === 'number' && item.deltaVsPrevious > 0;
              const deltaColor = isFaster ? theme.success : isSlower ? theme.danger : theme.textMuted;
              const deltaLabel =
                typeof item.deltaVsPrevious === 'number'
                  ? `${item.deltaVsPrevious > 0 ? '+' : ''}${item.deltaVsPrevious} ms`
                  : t('apiDiag.history.na');
              return (
                <View key={item.checkedAt} style={S.historyRow}>
                  <Text style={S.historyLine}>
                    {new Date(item.checkedAt).toLocaleString(dateLocale)} | {diagText(item.healthLabel, t)} | avg {item.avgLatency ?? '-'} ms
                  </Text>
                  <Text style={[S.historyDelta, { color: deltaColor }]}>{t('apiDiag.historyTrend', { delta: deltaLabel })}</Text>
                </View>
              );
            })
          )}
        </View>
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    backgroundColor: t.headerBg,
    borderBottomColor: t.navBorder,
    borderBottomWidth: 1,
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: t.surface2,
    borderWidth: 1,
    borderColor: t.navBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { flex: 1, color: t.headerText, fontSize: 20, fontWeight: '900', letterSpacing: 0 },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  heroCard: {
    backgroundColor: t.cardBg,
    borderColor: t.cardBorder,
    borderWidth: 1,
    borderRadius: t.radiusXl,
    padding: 16,
    marginBottom: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: t.cardElevation,
    }),
    gap: 14,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEyebrow: { color: t.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 0 },
  heroTitle: { color: t.text, fontSize: 22, fontWeight: '900', marginTop: 2, letterSpacing: 0 },
  heroSub: { color: t.textSub, fontSize: 12, fontWeight: '700', marginTop: 3, lineHeight: 17 },
  heroRefresh: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStats: { flexDirection: 'row', gap: 8 },
  heroStat: {
    flex: 1,
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 9,
    justifyContent: 'center',
    gap: 2,
  },
  heroStatValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  actionCard: {
    borderWidth: 1,
    borderRadius: t.radiusXl,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionEyebrow: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  actionTitle: { fontSize: 15, fontWeight: '900', marginTop: 2 },
  actionSub: { color: t.textSub, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 2 },
  releaseQaBox: {
    backgroundColor: t.surface,
    borderColor: t.cardBorder,
    borderWidth: 1,
    borderRadius: t.radiusXl,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  releaseQaHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  releaseQaIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  releaseQaEyebrow: { color: t.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0 },
  releaseQaTitle: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  releaseQaSub: { color: t.textSub, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 2 },
  releaseQaCopyBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  releaseQaGrid: { gap: 8 },
  releaseQaItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    gap: 4,
  },
  releaseQaItemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  releaseQaItemLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  releaseQaPill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  releaseQaPillText: { fontSize: 9, fontWeight: '900' },
  releaseQaValue: { color: t.text, fontSize: 13, fontWeight: '900' },
  releaseQaNote: { color: t.textSub, fontSize: 11, fontWeight: '700', lineHeight: 15 },
  infoBox: {
    backgroundColor: t.surface,
    borderColor: t.cardBorder,
    borderWidth: 1,
    borderRadius: t.radiusXl,
    padding: 15,
    marginBottom: 12,
    gap: 8,
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  infoTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  infoSubtitle: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  healthDot: { width: 10, height: 10, borderRadius: 99 },
  configRow: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 3,
  },
  configLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  configValue: { color: t.text, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  infoLine: { display: 'none', color: t.textSub, fontSize: 12 },
  actionsRow: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  copyBtn: {
    flexGrow: 1,
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  queueSyncBtn: {
    marginTop: 4,
    alignSelf: 'stretch',
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  queueStatusChip: {
    alignSelf: 'stretch',
    backgroundColor: t.successBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueStatusText: { fontSize: 12, fontWeight: '800' },
  shareBtn: {
    flexGrow: 1,
    backgroundColor: t.accentDark,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  copyBtnText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  toggleBtn: {
    alignSelf: 'stretch',
    backgroundColor: t.surface2,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  toggleBtnText: { fontSize: 12, fontWeight: '900' },
  healthBadge: {
    alignSelf: 'stretch',
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  healthBadgeText: { fontSize: 12, fontWeight: '900' },
  errorReportBox: {
    backgroundColor: t.surface,
    borderColor: t.cardBorder,
    borderWidth: 1,
    borderRadius: t.radiusXl,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  errorReportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorReportTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  errorReportSub: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2, lineHeight: 17 },
  errorReportStack: {
    color: t.textSub,
    backgroundColor: t.surface2,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontSize: 11,
    lineHeight: 16,
  },
  testErrorBtn: {
    alignSelf: 'stretch',
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  card: {
    backgroundColor: t.cardBg,
    borderColor: t.cardBorder,
    borderWidth: 1,
    borderRadius: t.radiusXl,
    padding: 15,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  cardTitle: { color: t.text, fontSize: 14, fontWeight: '900', flexShrink: 1 },
  badge: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  detail: { color: t.textSub, fontSize: 13, marginBottom: 3, lineHeight: 18 },
  latencyRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
  latencyText: { fontSize: 12, fontWeight: '900' },
  tipBox: { backgroundColor: t.infoBg, borderRadius: t.radiusXl, padding: 14, marginTop: 4 },
  tipTitle: { color: t.info, fontSize: 14, fontWeight: '900', marginBottom: 6 },
  tipText: { color: t.info, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  historyBox: { backgroundColor: t.surface, borderColor: t.cardBorder, borderWidth: 1, borderRadius: t.radiusXl, padding: 14, marginTop: 10 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  historyTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  sparklineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sparklineText: { fontSize: 12, fontWeight: '800' },
  historyLine: { color: t.textSub, fontSize: 12, marginBottom: 2, lineHeight: 17 },
  historyRow: { marginBottom: 8 },
  historyDelta: { fontSize: 11, fontWeight: '900' },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: t.dangerBg,
  },
  clearBtnText: { fontSize: 11, fontWeight: '900' },
});
