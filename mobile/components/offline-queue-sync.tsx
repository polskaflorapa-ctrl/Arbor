import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
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

    const intervalId = setInterval(() => {
      if (appStateRef.current === 'active') {
        void tryFlush({ silent: true });
      }
    }, FLUSH_INTERVAL_MS);

    return () => {
      appStateSub.remove();
      clearInterval(intervalId);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [tryFlush]);

  if (!banner) return null;

  const isSyncing = banner.kind === 'syncing';
  const iconName = banner.kind === 'success' ? 'cloud-done-outline' : banner.kind === 'warning' ? 'cloud-offline-outline' : 'sync-outline';
  const iconColor = banner.kind === 'success' ? theme.success : banner.kind === 'warning' ? theme.warning : theme.info;
  const backgroundColor = banner.kind === 'success' ? theme.successBg : banner.kind === 'warning' ? theme.warningBg : theme.infoBg;

  return (
    <View style={styles.overlay}>
      <View
        style={[
          styles.banner,
          {
            backgroundColor,
            borderColor: theme.border,
            shadowColor: theme.shadowColor,
            shadowOpacity: theme.shadowOpacity * 0.45,
            shadowRadius: theme.shadowRadius,
            shadowOffset: { width: 0, height: theme.shadowOffsetY },
            elevation: theme.cardElevation,
          },
        ]}
      >
        <Ionicons name={iconName} size={14} color={iconColor} />
        <Text style={[styles.text, { color: iconColor }]}>{banner.message}</Text>
        {isSyncing ? <ActivityIndicator size="small" color={iconColor} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    zIndex: 9999,
    pointerEvents: 'none',
  },
  banner: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
});
