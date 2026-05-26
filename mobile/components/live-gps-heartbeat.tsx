import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { API_URL } from '../constants/api';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import { getStoredSession, type StoredUser } from '../utils/session';

const SEND_INTERVAL_MS = 55000;
const SESSION_CHECK_INTERVAL_MS = 60000;
const WATCH_TIME_INTERVAL_MS = 60000;
const WATCH_DISTANCE_METERS = 50;

type GpsStatus =
  | { kind: 'hidden'; message: '' }
  | { kind: 'starting'; message: string }
  | { kind: 'active'; message: string; sentAt: number }
  | { kind: 'warning'; message: string }
  | { kind: 'blocked'; message: string };

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

async function sendLocationHeartbeat(token: string, location: Location.LocationObject) {
  const response = await fetch(`${API_URL}/mobile/me/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(locationPayload(location)),
  });

  return response.ok;
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
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const tokenRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const permissionDeniedRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const [status, setStatus] = useState<GpsStatus>({ kind: 'hidden', message: '' });

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
        const ok = await sendLocationHeartbeat(token, location);
        if (!ok) {
          tokenRef.current = null;
          setStatus({ kind: 'warning', message: 'GPS LIVE: serwer nie przyjal pozycji' });
          return;
        }
        setStatus({ kind: 'active', message: `GPS LIVE - sync ${formatSyncTime(now)}`, sentAt: now });
      } catch {
        setStatus({ kind: 'warning', message: 'GPS LIVE: brak polaczenia' });
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
        if (!token || !isLiveGpsUser(user)) {
          tokenRef.current = null;
          stopTracking();
          setStatus({ kind: 'hidden', message: '' });
          return;
        }
        tokenRef.current = token;
        setStatus((current) => (current.kind === 'active' ? current : { kind: 'starting', message: 'GPS LIVE: przygotowanie' }));
        if (locationSubRef.current || permissionDeniedRef.current) return;

        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) {
          permissionDeniedRef.current = true;
          setStatus({ kind: 'blocked', message: 'GPS LIVE: wlacz zgode lokalizacji' });
          return;
        }

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
        void ensureTracking();
      } else {
        stopTracking();
      }
    });

    const intervalId = setInterval(() => {
      void ensureTracking();
    }, SESSION_CHECK_INTERVAL_MS);

    return () => {
      mounted = false;
      appStateSub.remove();
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
    <View style={styles.overlay} pointerEvents="none">
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
    top: 106,
    left: 12,
    right: 12,
    zIndex: 9998,
    alignItems: 'flex-end',
  },
  pill: {
    maxWidth: '92%',
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 999,
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
