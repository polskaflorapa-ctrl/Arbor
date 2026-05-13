import AsyncStorage from '@react-native-async-storage/async-storage';

const COMMAND_CENTER_HISTORY_KEY = 'command_center_recent_contexts_v1';
const MAX_RECENT_CONTEXTS = 12;

export interface RecentContextItem {
  id: string;
  path: string;
  label: string;
  meta?: string;
  at: number;
}

type PushRecentContextInput = {
  path: string;
  label: string;
  meta?: string;
};

function contextId(path: string, label: string, meta?: string) {
  return `${path.trim()}::${label.trim()}::${String(meta || '').trim()}`;
}

async function readRaw(): Promise<RecentContextItem[]> {
  const raw = await AsyncStorage.getItem(COMMAND_CENTER_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && typeof row === 'object')
      .map((row) => row as RecentContextItem)
      .filter((row) => row.path && row.label && Number.isFinite(row.at))
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

async function writeRaw(items: RecentContextItem[]) {
  await AsyncStorage.setItem(COMMAND_CENTER_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_RECENT_CONTEXTS)));
}

export async function readRecentContexts(): Promise<RecentContextItem[]> {
  return readRaw();
}

export async function pushRecentContext(input: PushRecentContextInput): Promise<RecentContextItem[]> {
  const id = contextId(input.path, input.label, input.meta);
  const existing = await readRaw();
  const next: RecentContextItem[] = [
    {
      id,
      path: input.path,
      label: input.label,
      ...(input.meta ? { meta: input.meta } : {}),
      at: Date.now(),
    },
    ...existing.filter((row) => row.id !== id),
  ];
  await writeRaw(next);
  return next;
}

export async function clearRecentContexts(): Promise<void> {
  await AsyncStorage.removeItem(COMMAND_CENTER_HISTORY_KEY);
}

