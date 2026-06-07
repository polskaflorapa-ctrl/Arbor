import { Ionicons } from '@expo/vector-icons';
import { addNetworkStateListener } from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import { flushOfflineQueue, getOfflineQueueSize } from '../utils/offline-queue';
import { getStoredSession } from '../utils/session';

const FLUSH_INTERVAL_MS = 30000;
const BANNER_HIDE_MS = 2500;

type SyncBannerState =
  | { kind: 'syncing'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'warning'; message: string }
  | null;

export function OfflineQueueSync() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const flushingRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [banner, setBanner] = useState<SyncBannerState>(null);

  const showBanner = useCallback((next: Exclude<SyncBannerState, null>) => {
    setBanner(next);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setBanner(null), BANNER_HIDE_MS);
  }, []);

  const tryFlush = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (flushingRef.current) return;
    const pendingBefore = await getOfflineQueueSize();
    if (pendingBefore <= 0) return;

    if (!silent) {
      setBanner({ kind: 'syncing', message: `Synchronizuję kolejkę offline (${pendingBefore})...` });
    }

    flushingRef.current = true;
    try {
      const { token } = await getStoredSession();
      if (!token) return;
      const { flushed, left } = await flushOfflineQueue(token);
      if (flushed > 0) {
        showBanner({ kind: 'success', message: `Wysłano ${flushed} zapisanych akcji.` });
      } else if (!silent && left > 0) {
        showBanner({ kind: 'warning', message: `Offline: nadal czeka ${left} akcji.` });
      }
    } finally {
      flushingRef.current = false;
    }
  }, [showBanner]);

  useEffect(() => {
    void tryFlush();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      const becameActive = appStateRef.current !== 'active' && nextState === 'active';
      appStateRef.current = nextState;
      if (becameActive) void tryFlush();
    });

    /** F3.8 — flush zaraz po odzyskaniu sieci (nie tylko co 30 s / przy active). */
    const netSub = addNetworkStateListener((evt) => {
      if (appStateRef.current !== 'active') return;
      if (!evt.isConnected) return;
      if (evt.isInternetReachable === false) return;
      void tryFlush({ silent: true });
    });

    const intervalId = setInterval(() => {
      if (appStateRef.current === 'active') {
        void tryFlush({ silent: true });
      }
    }, FLUSH_INTERVAL_MS);

    return () => {
      appStateSub.remove();
      netSub.remove();
      clearInterval(intervalId);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [tryFlush]);

  if (!banner) return null;

  const isSyncing = banner.kind === 'syncing';
  const iconName = banner.kind === 'success' ? 'cloud-done-outline' : banner.kind === 'warning' ? 'cloud-offline-outline' : 'sync-outline';
  const iconColor = banner.kind === 'success' ? theme.success : banner.kind === 'warning' ? theme.warning : theme.info;
  const backgroundColor = banner.kind === 'success' ? theme.successBg : banner.kind === 'warning' ? theme.warningBg : theme.infoBg;
  const borderColor = banner.kind === 'success'
    ? theme.success + '66'
    : banner.kind === 'warning'
      ? theme.warning + '66'
      : theme.info + '66';

  return (
    <View style={[styles.overlay, { top: Math.max(insets.top + 8, 18) }]}>
      <View
        style={[
          styles.banner,
          {
            backgroundColor,
            borderColor,
            ...shadowStyle(theme, {
              opacity: theme.shadowOpacity * 0.24,
              radius: theme.shadowRadius * 0.55,
              offsetY: 2,
              elevation: Math.max(1, theme.cardElevation),
            }),
          },
        ]}
      >
        <View style={[styles.iconBox, { borderColor, backgroundColor: theme.cardBg }]}>
          <Ionicons name={iconName} size={14} color={iconColor} />
        </View>
        <Text style={[styles.text, { color: iconColor }]} numberOfLines={2}>{banner.message}</Text>
        {isSyncing ? <ActivityIndicator size="small" color={iconColor} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    pointerEvents: 'none',
  },
  banner: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
});
