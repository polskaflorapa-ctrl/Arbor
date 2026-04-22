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

export const getStoredSession = async (): Promise<StoredSession> => {
  const [token, userStr] = await AsyncStorage.multiGet(['token', 'user']).then((pairs) => [
    pairs[0]?.[1] ?? null,
    pairs[1]?.[1] ?? null,
  ]);

  const user = safeParseUser(userStr);
  return { token, user };
};

export const saveStoredSession = async (token: string, user: StoredUser): Promise<void> => {
  await AsyncStorage.multiSet([
    ['token', token],
    ['user', JSON.stringify(user)],
  ]);
};

export const clearStoredSession = async (): Promise<void> => {
  await AsyncStorage.multiRemove(['token', 'user']);
};
