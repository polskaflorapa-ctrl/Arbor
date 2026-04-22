import { useCallback, useEffect, useRef, useState } from 'react';

export default function useTimedMessage(timeoutMs = 3000) {
  const [message, setMessage] = useState('');
  const timeoutRef = useRef(null);

  const clearMessage = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setMessage('');
  }, []);

  const showMessage = useCallback((text) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setMessage(text);
    timeoutRef.current = setTimeout(() => {
      setMessage('');
      timeoutRef.current = null;
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  return { message, setMessage, showMessage, clearMessage };
}
