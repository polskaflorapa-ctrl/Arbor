import { AppPrivacyLock } from '../components/app-privacy-lock';
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

/** Maks. wiek powiadomienia przy zimnym starcie — unikamy nawigacji „w tyle”. */
const NOTIFICATION_COLD_START_MAX_AGE_MS = 45 * 60 * 1000;

/** Ścieżka Expo Router z `data` powiadomienia (tap / cold start). */
function getNotificationDeepLink(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const type = typeof data.type === 'string' ? data.type : '';
  const screen = typeof data.screen === 'string' ? data.screen : '';
  if (type === 'autoplan_daily_brief' || screen === '/autoplan-dnia') return '/autoplan-dnia';
  if (type === 'reservation_day_end' || screen === '/rezerwacje-sprzetu') return '/rezerwacje-sprzetu';
  if (screen.startsWith('/')) return screen;
  return null;
}

function navigateFromNotification(path: string) {
  router.push(path as never);
}

export default function Layout() {
  useEffect(() => {
    void (async () => {
      await hydrateOddzialFeatureOverrides();
      await hydrateAppRemoteFlags();
      const { token } = await getStoredSession();
      if (token) await fetchAndApplyMobileRemoteConfig(token);
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
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
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const path = getNotificationDeepLink(data);
      if (path) navigateFromNotification(path);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void (async () => {
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
    })();
  }, []);

  return (
    <SafeAreaProvider>
    <LanguageProvider>
      <ThemeProvider>
        <AppPrivacyLock />
        <OfflineQueueSync />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="autoplan-dnia" />
          <Stack.Screen name="misja-dnia" />
          <Stack.Screen name="wyceniajacy-hub" />
          <Stack.Screen name="wyceniajacy-finanse" />
          <Stack.Screen name="oddzial-funkcje-admin" />
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
