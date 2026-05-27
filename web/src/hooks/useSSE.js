/**
 * useSSE — Server-Sent Events hook for real-time notifications.
 *
 * Opens a persistent EventSource connection to /api/notifications/stream.
 * Auth is passed as ?token= query param (EventSource doesn't support headers).
 *
 * Auto-reconnects with exponential backoff on network failure.
 * Falls back gracefully if SSE is not supported (very old browsers).
 *
 * Usage:
 *   useSSE((event) => {
 *     if (event.event === 'notification') setCount(c => c + 1);
 *     if (event.event === 'task_update') refetchTasks();
 *   });
 */

import { useEffect, useRef, useCallback } from 'react';
import { getReactApiBase } from '../utils/apiBase';
import { resetAuthSession } from '../utils/authSession';
import { getStoredToken } from '../utils/storedToken';

const BASE_URL = getReactApiBase();
const STREAM_URL = `${BASE_URL}/notifications/stream`;

// Backoff: 1s, 2s, 4s, 8s, 16s, max 30s
function backoff(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 30_000);
}

export function useSSE(onEvent) {
  const esRef      = useRef(null);
  const attemptsRef = useRef(0);
  const timerRef   = useRef(null);
  const onEventRef = useRef(onEvent);
  const authCheckRef = useRef(null);
  const mountedRef = useRef(false);

  // Keep ref current without re-triggering effect
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const validateSession = useCallback(async (token) => {
    const response = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return response.status;
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const token = getStoredToken();
    if (!token) return; // not logged in
    if (typeof EventSource === 'undefined') return; // SSE not supported

    const url = `${STREAM_URL}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      attemptsRef.current = 0; // reset backoff on successful connection
    };

    es.onmessage = (e) => {
      if (!e.data || e.data.startsWith(':')) return; // heartbeat comment
      try {
        const parsed = JSON.parse(e.data);
        onEventRef.current?.(parsed);
      } catch { /* malformed JSON — ignore */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      const latestToken = getStoredToken();
      if (!latestToken || latestToken !== token) return;
      if (authCheckRef.current) return;

      authCheckRef.current = (async () => {
        try {
          const status = await validateSession(latestToken);
          if (status === 401) {
            resetAuthSession();
            return;
          }
        } catch {
          // Network or proxy failures should not force a logout.
        } finally {
          authCheckRef.current = null;
        }
        if (!mountedRef.current) return;
        clearTimeout(timerRef.current);
        const delay = backoff(attemptsRef.current);
        attemptsRef.current++;
        timerRef.current = setTimeout(connect, delay);
      })();
    };
  }, [validateSession]); // stable — no deps that change

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      clearTimeout(timerRef.current);
      authCheckRef.current = null;
    };
  }, [connect]);
}
