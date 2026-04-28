import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_BASE_URL, API_URL, WEB_APP_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { flushOfflineQueue, getOfflineQueueSize } from '../utils/offline-queue';
import { fetchAndApplyMobileRemoteConfig, getLastReportedApiVersion } from '../utils/mobile-remote-config';
import { getStoredSession } from '../utils/session';

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
  const [results, setResults] = useState<DiagnosticResult[]>([
    makeInitialProbe('apiDiag.probe.backend'),
    makeInitialProbe('apiDiag.probe.auth'),
    makeInitialProbe('apiDiag.probe.tasks'),
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
      nextResults.push(await runSingle('apiDiag.probe.backend', () => fetch(API_BASE_URL), {
        okStatusCodes: [301, 302, 307, 308],
      }));
      nextResults.push(await runSingle('apiDiag.probe.auth', () => fetch(`${API_URL}/auth/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }), {
        authRequiredStatusCodes: [401, 403],
      }));
      nextResults.push(await runSingle('apiDiag.probe.tasks', () => fetch(`${API_URL}/tasks/wszystkie`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }), {
        authRequiredStatusCodes: [401, 403],
      }));
      nextResults.push(await runSingle('apiDiag.probe.mobileConfig', () => fetch(`${API_URL}/mobile-config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }), {
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
      const rezerwacjeUrl = `${API_URL}/flota/rezerwacje?from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}`;
      nextResults.push(await runSingle('apiDiag.probe.fleetReservations', () => fetch(rezerwacjeUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }), {
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
    void runDiagnostics();
  }, [runDiagnostics]);

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

  const expectedApi =
    typeof process !== 'undefined' && process.env.EXPO_PUBLIC_EXPECTED_API_VERSION
      ? String(process.env.EXPO_PUBLIC_EXPECTED_API_VERSION).trim()
      : '';
  const apiVersionMismatch = Boolean(
    expectedApi && serverApiVer && serverApiVer !== expectedApi,
  );

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <View style={S.header}>
        <TouchableOpacity
          onPress={() => {
            void triggerHaptic('light');
            router.back();
          }}
          style={S.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('apiDiag.title')}</Text>
        <TouchableOpacity
          onPress={() => {
            void triggerHaptic('light');
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
              void runDiagnostics();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={S.infoBox}>
          <Text style={S.infoTitle}>{t('apiDiag.infoTitle')}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.checkedAt', { at: checkedAt })}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.appVersion', { v: appVersion })}</Text>
          <Text style={S.infoLine}>{t('apiDiag.info.nativeBuild', { native: nativeApp, build: nativeBuild })}</Text>
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
    borderBottomColor: t.border,
    borderBottomWidth: 1,
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  refreshBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: t.headerText, fontSize: 19, fontWeight: '700' },
  scroll: { flex: 1, padding: 14 },
  infoBox: { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  infoTitle: { color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  infoLine: { color: t.textSub, fontSize: 12 },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  copyBtn: {
    backgroundColor: t.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueSyncBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: t.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueStatusChip: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: t.successBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueStatusText: { fontSize: 12, fontWeight: '700' },
  shareBtn: {
    backgroundColor: t.accentDark,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  copyBtnText: { color: t.accentText, fontSize: 12, fontWeight: '700' },
  toggleBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: t.surface2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toggleBtnText: { fontSize: 12, fontWeight: '700' },
  healthBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  healthBadgeText: { fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: t.cardBg, borderColor: t.cardBorder, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: t.text, fontSize: 13, fontWeight: '700' },
  badge: { fontSize: 13, fontWeight: '800' },
  detail: { color: t.textSub, fontSize: 12, marginBottom: 2 },
  latencyRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  latencyText: { fontSize: 12, fontWeight: '700' },
  tipBox: { backgroundColor: t.infoBg, borderRadius: 12, padding: 12, marginTop: 4 },
  tipTitle: { color: t.info, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  tipText: { color: t.info, fontSize: 12 },
  historyBox: { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  historyTitle: { color: t.text, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  sparklineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sparklineText: { fontSize: 12, fontWeight: '700' },
  historyLine: { color: t.textSub, fontSize: 12, marginBottom: 2 },
  historyRow: { marginBottom: 6 },
  historyDelta: { fontSize: 11, fontWeight: '700' },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: t.dangerBg,
  },
  clearBtnText: { fontSize: 11, fontWeight: '700' },
});
