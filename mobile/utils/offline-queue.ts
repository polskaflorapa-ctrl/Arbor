import AsyncStorage from '@react-native-async-storage/async-storage';

import { emitOfflineFlushDone } from './offline-queue-sync-events';

const OFFLINE_QUEUE_KEY = 'offline_queue_v1';
const MAX_QUEUE_ITEMS = 250;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

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
  /**
   * Opcjonalny klucz deduplikacji.
   * Gdy podany, nowy wpis usuwa starsze wpisy z tym samym kluczem.
   */
  dedupeKey?: string;
  url: string;
  method: HttpMethod;
  body?: Record<string, unknown> | null;
  multipart?: OfflineQueueMultipart | null;
  createdAt: string;
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface OfflineQueueStatus {
  count: number;
  retryBlocked: number;
  lastError: string;
  oldestCreatedAt: string;
}

type OfflineQueueInput = Omit<OfflineQueueItem, 'id' | 'createdAt'> & {
  id?: string;
};

export const createOfflineRequestId = (prefix = 'offline'): string => {
  const safePrefix = String(prefix || 'offline')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .slice(0, 80);
  return `${safePrefix || 'offline'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

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
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE_ITEMS)));
};

const retryDelayMs = (attempts: number) => {
  if (attempts <= 0) return 0;
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * Math.pow(2, Math.min(attempts, 8)));
};

const canRetryNow = (item: OfflineQueueItem, now: number) => {
  const attempts = Math.max(0, item.attempts || 0);
  if (!item.lastAttemptAt || attempts <= 0) return true;
  const last = Date.parse(item.lastAttemptAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= retryDelayMs(attempts);
};

const markAttemptFailed = (item: OfflineQueueItem, error: string, now: number): OfflineQueueItem => ({
  ...item,
  attempts: Math.max(0, item.attempts || 0) + 1,
  lastAttemptAt: new Date(now).toISOString(),
  lastError: error.slice(0, 240),
});

const responseReason = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { reason?: string; code?: string };
    return String(parsed?.reason || parsed?.code || '');
  } catch {
    return '';
  }
};

export const enqueueOfflineRequest = async (
  item: OfflineQueueInput,
): Promise<void> => {
  const queue = await readQueue();
  const dedupeKey = item.dedupeKey?.trim();
  const dedupedQueue =
    dedupeKey && dedupeKey.length > 0
      ? queue.filter((row) => row.dedupeKey !== dedupeKey)
      : queue;
  dedupedQueue.push({
    ...item,
    ...(dedupeKey ? { dedupeKey } : {}),
    id: item.id || createOfflineRequestId(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await writeQueue(dedupedQueue);
};

export const getOfflineQueueSize = async (): Promise<number> => {
  const queue = await readQueue();
  return queue.length;
};

export const getOfflineQueueStatus = async (): Promise<OfflineQueueStatus> => {
  const queue = await readQueue();
  const now = Date.now();
  const retryBlocked = queue.filter((item) => !canRetryNow(item, now)).length;
  const withErrors = queue.filter((item) => item.lastError);
  const oldest = [...queue].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  return {
    count: queue.length,
    retryBlocked,
    lastError: withErrors[withErrors.length - 1]?.lastError || '',
    oldestCreatedAt: oldest?.createdAt || '',
  };
};

export const queueRequestWithOfflineFallback = async (
  item: OfflineQueueInput,
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
    const now = Date.now();
    if (!canRetryNow(item, now)) {
      remaining.push(item);
      continue;
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        // Stabilne ID wpisu kolejki — retry / flush bez podwójnego skutku po stronie API.
        'Idempotency-Key': item.id,
      };
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
      } else if (res.status === 400 || res.status === 409) {
        const text = await res.text().catch(() => '');
        const reason = responseReason(text);
        if (reason === 'TASK_ALREADY_FINISHED') flushed += 1;
        else remaining.push(markAttemptFailed(item, text || `HTTP ${res.status}`, now));
      } else {
        const text = await res.text().catch(() => '');
        remaining.push(markAttemptFailed(item, text || `HTTP ${res.status}`, now));
      }
    } catch (error) {
      remaining.push(markAttemptFailed(item, error instanceof Error ? error.message : 'Network error', now));
    }
  }

  await writeQueue(remaining);
  const left = remaining.length;
  if (flushed > 0) emitOfflineFlushDone({ flushed, left });
  return { flushed, left };
};

/** Kolejka wysłania zdjęcia (POST multipart `/tasks/:id/zdjecia`) po powrocie online. */
export async function queueTaskPhotoOffline(args: {
  id?: string;
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
    id: args.id,
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

/** Kolejka zgloszenia problemu z terenu (POST `/tasks/:id/problemy`) po powrocie online. */
export async function queueTaskProblemOffline(args: {
  id?: string;
  url: string;
  typ: string;
  opis: string;
}): Promise<number> {
  await enqueueOfflineRequest({
    id: args.id,
    dedupeKey: args.id ? `problem:${args.id}` : undefined,
    url: args.url,
    method: 'POST',
    body: {
      typ: String(args.typ || 'usterka').slice(0, 80),
      opis: String(args.opis || '').trim().slice(0, 4000),
    },
  });
  return getOfflineQueueSize();
}
