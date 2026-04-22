import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app_remote_flags_v1';

let runtimeFlags: Record<string, boolean> = {};

export const hydrateAppRemoteFlags = async (): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      runtimeFlags = {};
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    runtimeFlags = {};
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        runtimeFlags[k] = Boolean(v);
      }
    }
  } catch {
    runtimeFlags = {};
  }
};

/** Scal flagi boolean z odpowiedzi GET mobile-config (np. `{ "autoplanStrictRoles": true }`). */
export const mergeAppRemoteFlags = async (flags: Record<string, unknown> | null | undefined): Promise<boolean> => {
  if (!flags || typeof flags !== 'object') return false;
  let changed = false;
  for (const [k, v] of Object.entries(flags)) {
    const next = Boolean(v);
    if (runtimeFlags[k] !== next) changed = true;
    runtimeFlags[k] = next;
  }
  if (changed || Object.keys(runtimeFlags).length) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(runtimeFlags));
  }
  return true;
};

export const getAppFlagSync = (key: string, defaultValue = false): boolean => {
  if (Object.prototype.hasOwnProperty.call(runtimeFlags, key)) return runtimeFlags[key];
  return defaultValue;
};

export const getAllAppFlagsSync = (): Record<string, boolean> => ({ ...runtimeFlags });
