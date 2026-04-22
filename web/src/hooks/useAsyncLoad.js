import { useCallback, useEffect, useRef, useState } from 'react';

export default function useAsyncLoad(loadFn, options = {}) {
  const { immediate = true, onError } = options;
  const [loading, setLoading] = useState(Boolean(immediate));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (mountedRef.current) setLoading(true);
    try {
      await loadFn();
    } catch (error) {
      if (onError) onError(error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
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
