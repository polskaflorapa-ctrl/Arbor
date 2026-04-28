import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_QUEUE_KEY = 'offline_queue_v1';

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Zdjęcie zlecenia (multipart) — replay przy `flushOfflineQueue`. */
export interface OfflineQueueMultipart {
  fileUri: string;
  fieldName: string;
  fileName?: string;
  mimeType?: string;
  fields: Record<string, string>;
}

export interface OfflineQueueItem {
  id: string;
  url: string;
  method: HttpMethod;
  body?: Record<string, unknown> | null;
  multipart?: OfflineQueueMultipart | null;
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
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      let body: BodyInit | undefined;
      if (item.multipart) {
        const form = new FormData();
        for (const [k, v] of Object.entries(item.multipart.fields)) {
          if (v != null && v !== '') form.append(k, v);
        }
        form.append(item.multipart.fieldName, {
          uri: item.multipart.fileUri,
          name: item.multipart.fileName || 'photo.jpg',
          type: item.multipart.mimeType || 'image/jpeg',
        } as any);
        body = form;
      } else {
        headers['Content-Type'] = 'application/json';
        body = item.body ? JSON.stringify(item.body) : undefined;
      }

      const res = await fetch(item.url, {
        method: item.method,
        headers,
        body,
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

/** Kolejka wysłania zdjęcia (POST multipart `/tasks/:id/zdjecia`) po powrocie online. */
export async function queueTaskPhotoOffline(args: {
  url: string;
  fileUri: string;
  typ: string;
  lat?: number;
  lng?: number;
  opis?: string;
  /** Lista po przecinku / średniku — jak w POST multipart `tagi`. */
  tagi?: string;
}): Promise<number> {
  const fields: Record<string, string> = { typ: args.typ };
  if (args.lat != null && Number.isFinite(args.lat)) fields.lat = String(args.lat);
  if (args.lng != null && Number.isFinite(args.lng)) fields.lon = String(args.lng);
  const o = args.opis?.trim();
  if (o) fields.opis = o.slice(0, 4000);
  const tg = args.tagi?.trim();
  if (tg) fields.tagi = tg.slice(0, 2000);
  await enqueueOfflineRequest({
    url: args.url,
    method: 'POST',
    multipart: {
      fileUri: args.fileUri,
      fieldName: 'zdjecie',
      fields,
    },
  });
  return getOfflineQueueSize();
}
