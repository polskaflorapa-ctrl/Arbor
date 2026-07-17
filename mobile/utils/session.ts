import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { clearOfflineQueue } from './offline-queue';
import { clearTaskCaches } from './task-list-cache';

// expo-secure-store nie istnieje na web (rzuca przy każdym wywołaniu) — w przeglądarce
// token trzymamy w AsyncStorage (localStorage). Natywne platformy bez zmian: Keychain/Keystore.
const secureStoreAvailable = Platform.OS !== 'web';
const secureGetItem = (key: string): Promise<string | null> =>
  secureStoreAvailable ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
const secureSetItem = (key: string, value: string): Promise<void> =>
  secureStoreAvailable ? SecureStore.setItemAsync(key, value) : AsyncStorage.setItem(key, value);
const secureDeleteItem = (key: string): Promise<void> =>
  secureStoreAvailable ? SecureStore.deleteItemAsync(key) : AsyncStorage.removeItem(key);

export interface StoredUser {
  id?: number;
  imie?: string;
  nazwisko?: string;
  rola?: string;
  oddzial_id?: number | string;
  oddzial_nazwa?: string;
  email?: string;
  telefon?: string;
  login?: string;
  [key: string]: unknown;
}

export interface StoredSession {
  token: string | null;
  user: StoredUser | null;
}

const safeParseUser = (value: string | null): StoredUser | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as StoredUser) : null;
  } catch {
    return null;
  }
};

const SESSION_TOKEN_KEY = 'session_token_v1';
const LEGACY_TOKEN_KEY = 'token';
const USER_KEY = 'user';

const normalizeStoredToken = (value: string | null): string | null => {
  if (value == null) return null;
  const token = String(value).replace(/[\uFEFF\u200B-\u200D]/g, '').trim();
  if (!token || token === 'undefined' || token === 'null') return null;
  return token;
};

const userIdentity = (user: StoredUser | null): string => {
  if (user?.id === undefined || user?.id === null) return '';
  return String(user.id).trim();
};

const clearSessionBoundData = async (): Promise<void> => {
  await Promise.all([clearOfflineQueue(), clearTaskCaches()]);
};

export const getStoredSession = async (): Promise<StoredSession> => {
  let secureTokenRaw: string | null = null;
  try {
    secureTokenRaw = await secureGetItem(SESSION_TOKEN_KEY);
  } catch {
    secureTokenRaw = null;
  }

  const [legacyTokenRaw, userStr] = await AsyncStorage.multiGet([LEGACY_TOKEN_KEY, USER_KEY]).then((pairs) => [
    pairs[0]?.[1] ?? null,
    pairs[1]?.[1] ?? null,
  ]);

  let token = normalizeStoredToken(secureTokenRaw);
  const legacyToken = normalizeStoredToken(legacyTokenRaw);

  if (!token && legacyToken) {
    try {
      await secureSetItem(SESSION_TOKEN_KEY, legacyToken);
      token = legacyToken;
      await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      token = legacyToken;
    }
  } else if (legacyTokenRaw) {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  }

  const user = safeParseUser(userStr);

  if (secureTokenRaw && !normalizeStoredToken(secureTokenRaw)) {
    await secureDeleteItem(SESSION_TOKEN_KEY).catch(() => undefined);
  }
  if (legacyTokenRaw && !legacyToken) {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  if (userStr && !user) {
    await AsyncStorage.removeItem(USER_KEY);
  }

  return { token, user };
};

export const saveStoredSession = async (token: string, user: StoredUser): Promise<void> => {
  const normalizedToken = normalizeStoredToken(token);
  if (!normalizedToken) {
    throw new Error('Invalid session token');
  }
  const previousUserRaw = await AsyncStorage.getItem(USER_KEY).catch(() => null);
  const previousUser = safeParseUser(previousUserRaw);
  const previousIdentity = userIdentity(previousUser);
  const nextIdentity = userIdentity(user);
  if (!previousIdentity || !nextIdentity || previousIdentity !== nextIdentity) {
    await clearSessionBoundData();
  }
  await secureSetItem(SESSION_TOKEN_KEY, normalizedToken);
  await AsyncStorage.multiSet([[USER_KEY, JSON.stringify(user)]]);
  await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
};

export const clearStoredSession = async (): Promise<void> => {
  await Promise.all([
    secureDeleteItem(SESSION_TOKEN_KEY).catch(() => undefined),
    AsyncStorage.multiRemove([LEGACY_TOKEN_KEY, USER_KEY]),
    clearSessionBoundData(),
  ]);
};
