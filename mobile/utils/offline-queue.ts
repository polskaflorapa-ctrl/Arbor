import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_QUEUE_KEY = 'offline_queue_v1';

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OfflineQueueItem {
  id: string;
  url: string;
  method: HttpMethod;
  body?: Record<string, unknown> | null;
  createdAt: string;
}

const readQueue = async (): Promise<OfflineQueueItem[]> => {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeQueue = async (items: OfflineQueueItem[]): Promise<void> => {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
};

export const enqueueOfflineRequest = async (
  item: Omit<OfflineQueueItem, 'id' | 'createdAt'>,
): Promise<void> => {
  const queue = await readQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...item,
  });
  await writeQueue(queue);
};

export const getOfflineQueueSize = async (): Promise<number> => {
  const queue = await readQueue();
  return queue.length;
};

export const queueRequestWithOfflineFallback = async (
  item: Omit<OfflineQueueItem, 'id' | 'createdAt'>,
): Promise<number> => {
  await enqueueOfflineRequest(item);
  return getOfflineQueueSize();
};

export const flushOfflineQueue = async (token: string): Promise<{ flushed: number; left: number }> => {
  const queue = await readQueue();
  if (!queue.length) return { flushed: 0, left: 0 };

  const remaining: OfflineQueueItem[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (res.ok) {
        flushed += 1;
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  await writeQueue(remaining);
  return { flushed, left: remaining.length };
};
