import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'autoplan_history_v1';
const MAX_ITEMS = 30;

export type AutoplanHistoryAction = 'apply' | 'rollback';

export interface AutoplanHistoryItem {
  id: string;
  at: string;
  mode: 'cost' | 'balanced' | 'fast';
  action: AutoplanHistoryAction;
  ok: number;
  queued: number;
  changed: number;
  actor: string;
}

export const loadAutoplanHistory = async (): Promise<AutoplanHistoryItem[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const appendAutoplanHistory = async (
  item: Omit<AutoplanHistoryItem, 'id' | 'at'>,
): Promise<AutoplanHistoryItem[]> => {
  const existing = await loadAutoplanHistory();
  const next: AutoplanHistoryItem[] = [
    {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
    },
    ...existing,
  ].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
};
