import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'calendar_blocks_v1';

export type CalendarBlock = {
  id: string;
  from: string;
  to: string;
  label: string;
};

function parseYmd(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export const loadCalendarBlocks = async (): Promise<CalendarBlock[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CalendarBlock[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

export const saveCalendarBlocks = async (items: CalendarBlock[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
};

export const isYmdBlocked = (ymd: string, blocks: CalendarBlock[]): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const t = parseYmd(ymd);
  for (const b of blocks) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.from) || !/^\d{4}-\d{2}-\d{2}$/.test(b.to)) continue;
    const a = parseYmd(b.from);
    const z = parseYmd(b.to);
    if (t >= a && t <= z) return true;
  }
  return false;
};
