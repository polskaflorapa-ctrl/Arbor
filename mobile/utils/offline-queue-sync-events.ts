/** Shared sync signals for task screens after field actions and offline queue flushes. */

export type OfflineFlushDetail = { flushed: number; left: number };
export type TaskSyncReason =
  | 'checkin'
  | 'field-package'
  | 'finish'
  | 'photo'
  | 'start'
  | 'status';
export type TaskSyncDetail = {
  taskId?: string | number;
  reason: TaskSyncReason;
  at: string;
};

const offlineListeners = new Set<(d: OfflineFlushDetail) => void>();
const taskListeners = new Set<(d: TaskSyncDetail) => void>();

export function subscribeOfflineFlushDone(fn: (d: OfflineFlushDetail) => void): () => void {
  offlineListeners.add(fn);
  return () => offlineListeners.delete(fn);
}

export function subscribeTaskSync(fn: (d: TaskSyncDetail) => void): () => void {
  taskListeners.add(fn);
  return () => taskListeners.delete(fn);
}

export function emitOfflineFlushDone(detail: OfflineFlushDetail): void {
  for (const fn of [...offlineListeners]) {
    try {
      fn(detail);
    } catch {
      /* ignore */
    }
  }
}

export function emitTaskSync(detail: Omit<TaskSyncDetail, 'at'> & { at?: string }): void {
  const payload: TaskSyncDetail = {
    ...detail,
    at: detail.at || new Date().toISOString(),
  };

  for (const fn of [...taskListeners]) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}
