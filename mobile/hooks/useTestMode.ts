/**
 * Hook do obsługi testowego mode'u w mobilnej aplikacji.
 * Automatycznie mockuje API gdy tryb jest włączony.
 */
import { useEffect, useState } from 'react';
import { isTestModeEnabledMobile, getMockDataMobile } from '../utils/testMode';

/**
 * Hook do użytku w komponentach.
 * Zwraca czy tryb testowy jest włączony.
 */
export function useTestMode() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const enabled = await isTestModeEnabledMobile();
      setIsEnabled(enabled);
    } catch (e) {
      console.warn('Failed to check test mode status:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return { isEnabled, isLoading };
}

/**
 * Wrapper dla API requestów - zwraca mockowe dane gdy test mode jest włączony.
 */
export async function apiCallWithTestMode(endpoint: '/zlecenia' | '/dashboard/summary', options: Record<string, unknown> = {}) {
  const isTestMode = await isTestModeEnabledMobile();

  if (isTestMode) {
    // Zwróć mockowe dane
    const mockData = getMockDataMobile(endpoint);
    if (mockData) {
      console.log('[TEST MODE]', 'Returning mock data for:', endpoint);
      return mockData;
    }
  }

  // W produkcji (lub gdy nie ma mockowych danych), wykonaj rzeczywisty request
  // Tutaj powinien być rzeczywisty API call
  return null;
}
