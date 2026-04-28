/** Po udanym flushu kolejki offline — ekrany z listą zleceń mogą odświeżyć dane. */

export type OfflineFlushDetail = { flushed: number; left: number };

const listeners = new Set<(d: OfflineFlushDetail) => void>();

export function subscribeOfflineFlushDone(fn: (d: OfflineFlushDetail) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitOfflineFlushDone(detail: OfflineFlushDetail): void {
  for (const fn of [...listeners]) {
    try {
      fn(detail);
    } catch {
      /* ignore */
    }
  }
}
