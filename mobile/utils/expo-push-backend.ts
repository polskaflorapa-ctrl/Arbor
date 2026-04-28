import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { API_URL } from '../constants/api';

const STORAGE_KEY = 'arbor_expo_push_token_last_registered_v1';

function platformLabel(): 'ios' | 'android' | 'unknown' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'unknown';
}

/** Zapisuje token w OS (UPSERT). Zwraca true przy HTTP 201. */
export async function registerExpoPushTokenWithBackend(jwt: string, expoToken: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/mobile/me/push-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expo_token: expoToken, platform: platformLabel() }),
  });
  if (res.ok) {
    await AsyncStorage.setItem(STORAGE_KEY, expoToken);
    return true;
  }
  return false;
}

/** Usuwa ostatnio zarejestrowany token z OS (wylogowanie). */
export async function unregisterExpoPushTokenWithBackend(jwt: string): Promise<void> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return;
  try {
    await fetch(`${API_URL}/mobile/me/push-token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expo_token: stored }),
    });
  } catch {
    /* offline — i tak czyścimy lokalny marker */
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * Po udanym logowaniu: jeśli są już przyznane uprawnienia do powiadomień, wyślij token na backend.
 * Nie pyta o zgodę — tylko cicha rejestracja gdy już granted.
 */
export async function tryRegisterPushTokenAfterAuth(jwt: string): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return;
    const projectId =
      (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } })?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const res = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId: String(projectId) })
      : await Notifications.getExpoPushTokenAsync();
    const token = res.data;
    if (token) await registerExpoPushTokenWithBackend(jwt, token);
  } catch {
    /* brak projectId / emulator — ignoruj */
  }
}
