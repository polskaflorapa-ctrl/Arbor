import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StoredUser {
  id?: number;
  imie?: string;
  nazwisko?: string;
  rola?: string;
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

const normalizeStoredToken = (value: string | null): string | null => {
  if (value == null) return null;
  const token = String(value).replace(/[\uFEFF\u200B-\u200D]/g, '').trim();
  if (!token || token === 'undefined' || token === 'null') return null;
  return token;
};

export const getStoredSession = async (): Promise<StoredSession> => {
  const [tokenRaw, userStr] = await AsyncStorage.multiGet(['token', 'user']).then((pairs) => [
    pairs[0]?.[1] ?? null,
    pairs[1]?.[1] ?? null,
  ]);

  const token = normalizeStoredToken(tokenRaw);
  const user = safeParseUser(userStr);

  if (tokenRaw && !token) {
    await AsyncStorage.removeItem('token');
  }
  if (userStr && !user) {
    await AsyncStorage.removeItem('user');
  }

  return { token, user };
};

export const saveStoredSession = async (token: string, user: StoredUser): Promise<void> => {
  const normalizedToken = normalizeStoredToken(token);
  if (!normalizedToken) {
    throw new Error('Invalid session token');
  }
  await AsyncStorage.multiSet([
    ['token', normalizedToken],
    ['user', JSON.stringify(user)],
  ]);
};

export const clearStoredSession = async (): Promise<void> => {
  await AsyncStorage.multiRemove(['token', 'user']);
};
