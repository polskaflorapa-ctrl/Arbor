import { AppPrivacyLock } from '../components/app-privacy-lock';
import { LiveGpsHeartbeat } from '../components/live-gps-heartbeat';
import { OfflineQueueSync } from '../components/offline-queue-sync';
import { LanguageProvider } from '../constants/LanguageContext';
import { ThemeProvider } from '../constants/ThemeContext';
import { Stack, router, usePathname } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, InteractionManager, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { hydrateAppRemoteFlags } from '../utils/app-remote-flags';
import { hydrateOddzialFeatureOverrides } from '../utils/oddzial-feature-overrides';
import { fetchAndApplyMobileRemoteConfig } from '../utils/mobile-remote-config';
import { getStoredSession } from '../utils/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setRuntimeApiUrl, CUSTOM_API_URL_STORAGE_KEY } from '../constants/api';
import { getNotificationDeepLink as resolveNotificationDeepLink } from '../utils/notification-deeplink';
import { saveAppErrorReport } from '../utils/app-error-report';
import { captureAppError, initErrorMonitoring } from '../utils/error-monitoring';
import { POLSKA_FLORA_COLORS, ROAD_UA, ROAD_UA_ASSETS } from '../constants/brand';
import {
  canUseTestMode,
  clearUnavailableTestModeState,
  installMobileTestModeFetchInterceptor,
} from '../utils/testMode';

/** Maks. wiek powiadomienia przy zimnym starcie — unikamy nawigacji „w tyle”. */
const NOTIFICATION_COLD_START_MAX_AGE_MS = 45 * 60 * 1000;

initErrorMonitoring();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Global error boundary ────────────────────────────────────────────────────
// Catches render-phase exceptions anywhere in the tree. Without this, any
// uncaught throw during render silently crashes the app on production.
interface EBState { hasError: boolean; message: string }
class AppErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err: unknown): EBState {
    const msg = err instanceof Error ? err.message : String(err ?? 'Nieznany błąd');
    return { hasError: true, message: msg };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const err = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
    void saveAppErrorReport({
      source: 'error-boundary',
      message: err.message,
      name: err.name,
      stack: err.stack,
      componentStack: info.componentStack ?? '',
    });
    captureAppError(err, {
      source: 'error-boundary',
      componentStack: info.componentStack ?? '',
    });
  }
  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={ebStyles.container}>
        <Text style={ebStyles.title}>Coś poszło nie tak</Text>
        <Text style={ebStyles.sub}>{this.state.message}</Text>
        <TouchableOpacity
          style={ebStyles.btn}
          onPress={() => this.setState({ hasError: false, message: '' })}
        >
          <Text style={ebStyles.btnText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
const ebStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: POLSKA_FLORA_COLORS.white },
  title: { fontFamily: ROAD_UA.extraBold, fontSize: 20, marginBottom: 12, color: POLSKA_FLORA_COLORS.darkBrown },
  sub: { fontFamily: ROAD_UA.regular, fontSize: 14, color: POLSKA_FLORA_COLORS.lightBrown, textAlign: 'center', marginBottom: 24 },
  btn: { backgroundColor: POLSKA_FLORA_COLORS.primaryGreen, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: POLSKA_FLORA_COLORS.darkBrown, fontFamily: ROAD_UA.bold, fontSize: 15 },
});

function isWebRuntime() {
  const runtime = globalThis as typeof globalThis & {
    document?: { createElement?: unknown };
    HTMLElement?: unknown;
    location?: unknown;
    navigator?: { product?: string };
    window?: unknown;
  };
  return (
    Platform.OS === 'web' ||
    process.env.EXPO_OS === 'web' ||
    typeof runtime.document !== 'undefined' ||
    (typeof runtime.HTMLElement !== 'undefined' && typeof runtime.location !== 'undefined') ||
    (typeof runtime.window !== 'undefined' && runtime.navigator?.product !== 'ReactNative') ||
    (runtime.navigator?.product !== 'ReactNative' && typeof runtime.location !== 'undefined')
  );
}

function isNativeNotificationRuntime() {
  return (Platform.OS === 'ios' || Platform.OS === 'android') && !isWebRuntime();
}

async function canUseNotifications() {
  if (!isNativeNotificationRuntime()) return false;
  try {
    const notificationsApi = Notifications as typeof Notifications & { isAvailableAsync?: () => Promise<boolean> };
    return typeof notificationsApi.isAvailableAsync === 'function' ? await notificationsApi.isAvailableAsync() : true;
  } catch {
    return false;
  }
}

/** Ścieżka Expo Router z `data` powiadomienia (tap / cold start). */
function navigateFromNotification(path: string) {
  router.push(path as never);
}

function notificationPath(data: Record<string, unknown> | undefined) {
  return resolveNotificationDeepLink(data);
}

export default function Layout() {
  const [hasSession, setHasSession] = useState(false);
  const [fontWaitExpired, setFontWaitExpired] = useState(false);
  const pathname = usePathname();
  const [fontsLoaded, fontError] = useFonts(ROAD_UA_ASSETS);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timeoutId = setTimeout(() => setFontWaitExpired(true), 4000);
    return () => clearTimeout(timeoutId);
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    let disposed = false;
    let cleanupTestModeFetch: () => void = () => {};

    void (async () => {
      await clearUnavailableTestModeState();
      const cleanup = await installMobileTestModeFetchInterceptor();
      if (disposed) {
        cleanup();
        return;
      }
      cleanupTestModeFetch = cleanup;

      // Run all local AsyncStorage reads in parallel — none of these make
      // network calls so order between them doesn't matter.
      const [customUrl, { token }] = await Promise.all([
        AsyncStorage.getItem(CUSTOM_API_URL_STORAGE_KEY).catch(() => null),
        getStoredSession(),
        hydrateOddzialFeatureOverrides(),
        hydrateAppRemoteFlags(),
      ]);

      if (disposed) return;
      if (customUrl) setRuntimeApiUrl(customUrl);
      setHasSession(Boolean(token));
      // Fire remote config fetch in the background — non-blocking
      if (token) void fetchAndApplyMobileRemoteConfig(token);
    })();

    return () => {
      disposed = true;
      cleanupTestModeFetch();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const { token } = await getStoredSession();
      setHasSession(Boolean(token));
    })();
  }, [pathname]);

  useEffect(() => {
    if (!isNativeNotificationRuntime() || Platform.OS !== 'android') return;
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Polska Flora',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    void Notifications.setNotificationChannelAsync('autoplan', {
      name: 'Autoplan',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 220, 120, 220],
    });
  }, []);

  useEffect(() => {
    if (!isNativeNotificationRuntime()) return;
    let sub: Notifications.Subscription;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        const path = notificationPath(data);
        navigateFromNotification(path);
      });
    } catch {
      return;
    }
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isNativeNotificationRuntime()) return;
    void (async () => {
      try {
        if (!(await canUseNotifications())) return;
        const response = await Notifications.getLastNotificationResponseAsync();
        if (!response) return;
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        const path = notificationPath(data);
        const sent = response.notification.date;
        if (typeof sent === 'number' && Number.isFinite(sent) && Date.now() - sent > NOTIFICATION_COLD_START_MAX_AGE_MS) {
          return;
        }
        InteractionManager.runAfterInteractions(() => {
          navigateFromNotification(path);
        });
      } catch {
        return;
      }
    })();
  }, []);

  if (!fontsLoaded && !fontError && !fontWaitExpired) {
    return (
      <View style={ebStyles.container}>
        <ActivityIndicator size="large" color={POLSKA_FLORA_COLORS.primaryGreen} />
      </View>
    );
  }

  return (
    <AppErrorBoundary>
    <SafeAreaProvider>
    <LanguageProvider>
      <ThemeProvider>
        <AppPrivacyLock />
        {hasSession ? <LiveGpsHeartbeat /> : null}
        {hasSession ? <OfflineQueueSync /> : null}
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="task-command-center" />
          <Stack.Screen name="autoplan-dnia" />
          <Stack.Screen name="misja-dnia" />
          <Stack.Screen name="wyceniajacy-hub" />
          <Stack.Screen name="plan-ogledzin" />
          <Stack.Screen name="wyceniajacy-finanse" />
          <Stack.Screen name="wyceny-do-biura" />
          <Stack.Screen name="oddzial-funkcje-admin" />
          <Stack.Screen name="crm-mobile" />
          <Stack.Screen name="crm-pipeline-mobile" />
          <Stack.Screen name="klienci-mobile" />
          <Stack.Screen name="telefonia-mobile" />
          <Stack.Screen name="zlecenia" />
          <Stack.Screen name="zlecenie/[id]" />
          <Stack.Screen name="rozliczenia" />
          <Stack.Screen name="pomocnik" />
          <Stack.Screen name="raport-dzienny" />
          <Stack.Screen name="profil" />
          <Stack.Screen name="powiadomienia" />
          <Stack.Screen name="harmonogram" />
          <Stack.Screen name="raporty-mobilne" />
          <Stack.Screen name="wycena" />
          {canUseTestMode() ? <Stack.Screen name="test-mode" /> : null}
          <Stack.Screen name="wyceny-terenowe" />
          <Stack.Screen name="wycena-rysuj" />
          <Stack.Screen name="nowe-zlecenie" />
          <Stack.Screen name="uzytkownicy-mobile" />
          <Stack.Screen name="oddzialy-mobile" />
          <Stack.Screen name="flota-mobile" />
          <Stack.Screen name="rezerwacje-sprzetu" />
          <Stack.Screen name="blokady-kalendarza" />
          <Stack.Screen name="potwierdzenia-ekip" />
          <Stack.Screen name="kpi-tydzien" />
          <Stack.Screen name="ogledziny" />
          <Stack.Screen name="ogledziny-dokumentacja" />
          <Stack.Screen name="api-diagnostyka" />
          <Stack.Screen name="magazyn-mobile" />
        </Stack>
      </ThemeProvider>
    </LanguageProvider>
    </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
