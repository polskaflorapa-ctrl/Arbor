import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

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

export const getStoredSession = async (): Promise<StoredSession> => {
  let secureTokenRaw: string | null = null;
  try {
    secureTokenRaw = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
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
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, legacyToken);
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
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY).catch(() => undefined);
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
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, normalizedToken);
  await AsyncStorage.multiSet([[USER_KEY, JSON.stringify(user)]]);
  await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
};

export const clearStoredSession = async (): Promise<void> => {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_TOKEN_KEY).catch(() => undefined),
    AsyncStorage.multiRemove([LEGACY_TOKEN_KEY, USER_KEY]),
  ]);
};
