import { useCallback, useEffect, useRef, useState } from 'react';

export default function useAsyncLoad(loadFn, options = {}) {
  const { immediate = true, onError } = options;
  const [loading, setLoading] = useState(Boolean(immediate));
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const currentPromiseRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (inFlightRef.current && currentPromiseRef.current) {
      return currentPromiseRef.current;
    }

    inFlightRef.current = true;
    if (mountedRef.current) setLoading(true);

    const task = (async () => {
      try {
      await loadFn();
      } catch (error) {
        if (onError) onError(error);
      } finally {
        inFlightRef.current = false;
        currentPromiseRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    })();

    currentPromiseRef.current = task;
    return task;
  }, [loadFn, onError]);

  useEffect(() => {
    if (!immediate) {
      setLoading(false);
      return;
    }
    reload();
  }, [immediate, reload]);

  return { loading, reload };
}
