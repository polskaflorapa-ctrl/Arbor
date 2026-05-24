import { AppPrivacyLock } from '../components/app-privacy-lock';
import { LiveGpsHeartbeat } from '../components/live-gps-heartbeat';
import { OfflineQueueSync } from '../components/offline-queue-sync';
import { LanguageProvider } from '../constants/LanguageContext';
import { ThemeProvider } from '../constants/ThemeContext';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { hydrateAppRemoteFlags } from '../utils/app-remote-flags';
import { hydrateOddzialFeatureOverrides } from '../utils/oddzial-feature-overrides';
import { fetchAndApplyMobileRemoteConfig } from '../utils/mobile-remote-config';
import { getStoredSession } from '../utils/session';
import {
  installMobileTestModeFetchInterceptor,
  installMobileTestModeAxiosAdapter,
} from '../utils/testMode';

/** Maks. wiek powiadomienia przy zimnym starcie — unikamy nawigacji „w tyle”. */
const NOTIFICATION_COLD_START_MAX_AGE_MS = 45 * 60 * 1000;

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
function getNotificationDeepLink(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const type = typeof data.type === 'string' ? data.type : '';
  const screen = typeof data.screen === 'string' ? data.screen : '';
  if (type === 'autoplan_daily_brief' || screen === '/autoplan-dnia') return '/autoplan-dnia';
  if (type === 'quotation_approval' || screen === '/wyceny-terenowe') return '/wyceny-terenowe';
  if (type === 'reservation_day_end' || screen === '/rezerwacje-sprzetu') return '/rezerwacje-sprzetu';
  if (type === 'raport_dnia_ekipy' || type === 'payroll_team_day_approved') return '/powiadomienia';
  if (screen.startsWith('/')) return screen;
  return null;
}

function navigateFromNotification(path: string) {
  router.push(path as never);
}

export default function Layout() {
  useEffect(() => {
    void (async () => {
      await installMobileTestModeFetchInterceptor();
      await installMobileTestModeAxiosAdapter();
      await hydrateOddzialFeatureOverrides();
      await hydrateAppRemoteFlags();
      const { token } = await getStoredSession();
      if (token) await fetchAndApplyMobileRemoteConfig(token);
    })();
  }, []);

  useEffect(() => {
    if (!isNativeNotificationRuntime() || Platform.OS !== 'android') return;
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Arbor',
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
        const path = getNotificationDeepLink(data);
        if (path) navigateFromNotification(path);
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
        const path = getNotificationDeepLink(data);
        if (!path) return;
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

  return (
    <SafeAreaProvider>
    <LanguageProvider>
      <ThemeProvider>
        <AppPrivacyLock />
        <LiveGpsHeartbeat />
        <OfflineQueueSync />
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
          <Stack.Screen name="test-mode" />
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
  );
}
