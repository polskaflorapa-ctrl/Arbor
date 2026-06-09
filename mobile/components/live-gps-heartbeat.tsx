import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import { apiJsonFetch, readApiError } from '../utils/api-client';
import { getStoredSession, type StoredUser } from '../utils/session';

const SEND_INTERVAL_MS = 55000;
const SESSION_CHECK_INTERVAL_MS = 60000;
const WATCH_TIME_INTERVAL_MS = 60000;
const WATCH_DISTANCE_METERS = 50;
export const LIVE_GPS_ENABLED_KEY = 'live_gps_enabled_v1';
const LIVE_GPS_STATUS_KEY = 'live_gps_status_v1';

const liveGpsListeners = new Set<(enabled: boolean) => void>();
const liveGpsStatusListeners = new Set<(status: LiveGpsStatusSnapshot) => void>();

export type LiveGpsStatusSnapshot = {
  kind: 'hidden' | 'starting' | 'active' | 'warning' | 'blocked';
  message: string;
  updatedAt: string;
  sentAt?: string;
  reason?: 'disabled' | 'foreground_only' | 'permission_denied' | 'permission_revoked' | 'no_fix' | 'offline' | 'server' | 'role_or_session';
};

export async function isLiveGpsEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LIVE_GPS_ENABLED_KEY)) !== '0';
  } catch {
    return true;
  }
}

export async function setLiveGpsEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(LIVE_GPS_ENABLED_KEY, on ? '1' : '0');
  liveGpsListeners.forEach((listener) => listener(on));
}

export function subscribeLiveGpsEnabled(listener: (enabled: boolean) => void) {
  liveGpsListeners.add(listener);
  return () => {
    liveGpsListeners.delete(listener);
  };
}

export async function getLiveGpsStatusSnapshot(): Promise<LiveGpsStatusSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(LIVE_GPS_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as LiveGpsStatusSnapshot : null;
  } catch {
    return null;
  }
}

async function saveLiveGpsStatusSnapshot(status: LiveGpsStatusSnapshot): Promise<void> {
  await AsyncStorage.setItem(LIVE_GPS_STATUS_KEY, JSON.stringify(status));
  liveGpsStatusListeners.forEach((listener) => listener(status));
}

export function subscribeLiveGpsStatusSnapshot(listener: (status: LiveGpsStatusSnapshot) => void) {
  liveGpsStatusListeners.add(listener);
  return () => {
    liveGpsStatusListeners.delete(listener);
  };
}

type GpsStatus =
  | { kind: 'hidden'; message: '' }
  | { kind: 'starting'; message: string; reason?: LiveGpsStatusSnapshot['reason'] }
  | { kind: 'active'; message: string; sentAt: number }
  | { kind: 'warning'; message: string; reason?: LiveGpsStatusSnapshot['reason'] }
  | { kind: 'blocked'; message: string; reason?: LiveGpsStatusSnapshot['reason'] };

function normalizeRoleName(role: unknown) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isLiveGpsUser(user: StoredUser | null) {
  const role = normalizeRoleName(user?.rola);
  return role === 'brygadzista' || role === 'pomocnik' || role.startsWith('wyceniaj');
}

function nullableFiniteNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function speedMpsToKmh(speed: number | null | undefined) {
  const value = nullableFiniteNumber(speed);
  return value != null && value >= 0 ? Number((value * 3.6).toFixed(2)) : null;
}

function headingDegrees(heading: number | null | undefined) {
  const value = nullableFiniteNumber(heading);
  return value != null && value >= 0 ? Number(value.toFixed(2)) : null;
}

function locationPayload(location: Location.LocationObject) {
  const { coords } = location;
  return {
    lat: Number(coords.latitude.toFixed(7)),
    lng: Number(coords.longitude.toFixed(7)),
    accuracy_m: nullableFiniteNumber(coords.accuracy),
    speed_kmh: speedMpsToKmh(coords.speed),
    heading: headingDegrees(coords.heading),
    platform: Platform.OS,
    activity: 'foreground',
    recorded_at: new Date(location.timestamp).toISOString(),
  };
}

type HeartbeatResult =
  | { ok: true }
  | { ok: false; authExpired: boolean; message: string; status: number };

function shortApiMessage(message: string) {
  const normalized = String(message || '').trim();
  if (!normalized) return 'serwer nie przyjal pozycji';
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

async function sendLocationHeartbeat(token: string, location: Location.LocationObject): Promise<HeartbeatResult> {
  const response = await apiJsonFetch('/mobile/me/location', {
    method: 'POST',
    token,
    body: JSON.stringify(locationPayload(location)),
  });

  if (response.ok) return { ok: true };

  const message = await readApiError(response, 'serwer nie przyjal pozycji');
  return {
    ok: false,
    authExpired: response.status === 401 || response.status === 403,
    message: shortApiMessage(message),
    status: response.status,
  };
}

function formatSyncTime(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

export function LiveGpsHeartbeat() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const tokenRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const permissionDeniedRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const [status, setStatus] = useState<GpsStatus>({ kind: 'hidden', message: '' });

  const setGpsStatus = (next: GpsStatus) => {
    setStatus(next);
    void saveLiveGpsStatusSnapshot({
      kind: next.kind,
      message: next.message,
      updatedAt: new Date().toISOString(),
      ...('reason' in next && next.reason ? { reason: next.reason } : {}),
      ...(next.kind === 'active' ? { sentAt: new Date(next.sentAt).toISOString() } : {}),
    });
  };

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let mounted = true;

    const stopTracking = () => {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    };

    const sendIfAllowed = async (location: Location.LocationObject, force = false) => {
      const token = tokenRef.current;
      if (!token) return;
      const now = Date.now();
      if (!force && now - lastSentAtRef.current < SEND_INTERVAL_MS) return;
      lastSentAtRef.current = now;
      try {
        const result = await sendLocationHeartbeat(token, location);
        if (!result.ok) {
          if (result.authExpired) {
            tokenRef.current = null;
            setGpsStatus({ kind: 'blocked', message: `GPS LIVE: zaloguj ponownie (${result.status})`, reason: 'role_or_session' });
            return;
          }
          setGpsStatus({ kind: 'warning', message: `GPS LIVE: API ${result.status} - ${result.message}`, reason: 'server' });
          return;
        }
        setGpsStatus({ kind: 'active', message: `GPS LIVE - sync ${formatSyncTime(now)}`, sentAt: now });
      } catch {
        setGpsStatus({ kind: 'warning', message: 'GPS LIVE: brak polaczenia', reason: 'offline' });
        return;
      }
    };

    const ensureTracking = async () => {
      if (!mounted || startingRef.current) return;
      if (appStateRef.current !== 'active') {
        stopTracking();
        return;
      }

      startingRef.current = true;
      try {
        const { token, user } = await getStoredSession();
        const liveGpsEnabled = await isLiveGpsEnabled();
        if (!token || !isLiveGpsUser(user) || !liveGpsEnabled) {
          tokenRef.current = null;
          stopTracking();
          setGpsStatus({ kind: 'hidden', message: '' });
          return;
        }
        tokenRef.current = token;
        setGpsStatus({ kind: 'starting', message: 'GPS LIVE: foreground', reason: 'foreground_only' });

        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) {
          permissionDeniedRef.current = true;
          const reason = permission.canAskAgain ? 'permission_denied' : 'permission_revoked';
          setGpsStatus({ kind: 'blocked', message: permission.canAskAgain ? 'GPS LIVE: zgoda lokalizacji wymagana' : 'GPS LIVE: zgoda cofnieta w systemie', reason });
          return;
        }
        permissionDeniedRef.current = false;
        if (locationSubRef.current) return;

        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 120000,
          requiredAccuracy: 250,
        }).catch(() => null);
        if (lastKnown) {
          void sendIfAllowed(lastKnown, true);
        } else {
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }).catch(() => null);
          if (current) void sendIfAllowed(current, true);
          else setGpsStatus({ kind: 'warning', message: 'GPS LIVE: czekam na sygnal GPS', reason: 'no_fix' });
        }

        locationSubRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: WATCH_TIME_INTERVAL_MS,
            distanceInterval: WATCH_DISTANCE_METERS,
            mayShowUserSettingsDialog: false,
          },
          (location) => {
            void sendIfAllowed(location);
          }
        );
      } finally {
        startingRef.current = false;
      }
    };

    void ensureTracking();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        permissionDeniedRef.current = false;
        void ensureTracking();
      } else {
        stopTracking();
        if (tokenRef.current) {
          setGpsStatus({ kind: 'starting', message: 'GPS LIVE: tylko gdy appka aktywna', reason: 'foreground_only' });
        }
      }
    });

    const liveGpsSub = subscribeLiveGpsEnabled((enabled) => {
      permissionDeniedRef.current = false;
      if (enabled) {
        void ensureTracking();
      } else {
        tokenRef.current = null;
        stopTracking();
        setGpsStatus({ kind: 'hidden', message: '' });
      }
    });

    const intervalId = setInterval(() => {
      void ensureTracking();
    }, SESSION_CHECK_INTERVAL_MS);

    return () => {
      mounted = false;
      appStateSub.remove();
      liveGpsSub();
      clearInterval(intervalId);
      stopTracking();
    };
  }, []);

  if (Platform.OS === 'web' || status.kind === 'hidden') return null;

  const color = status.kind === 'active'
    ? theme.success
    : status.kind === 'blocked'
      ? theme.danger
      : status.kind === 'warning'
        ? theme.warning
        : theme.info;
  const backgroundColor = status.kind === 'active'
    ? theme.successBg
    : status.kind === 'blocked'
      ? theme.dangerBg
      : status.kind === 'warning'
        ? theme.warningBg
        : theme.infoBg;
  const iconName = status.kind === 'blocked'
    ? 'location-outline'
    : status.kind === 'warning'
      ? 'warning-outline'
      : 'navigate-circle-outline';

  return (
    <View style={[styles.overlay, { top: Math.max(insets.top + 54, 72) }]}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor,
            borderColor: color,
            ...shadowStyle(theme, {
              color,
              opacity: 0.18,
              radius: 16,
              offsetY: 6,
              elevation: 5,
            }),
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Ionicons name={iconName} size={14} color={color} />
        <Text style={[styles.text, { color }]} numberOfLines={1}>
          {status.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9998,
    alignItems: 'flex-end',
    pointerEvents: 'none',
  },
  pill: {
    maxWidth: '92%',
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
