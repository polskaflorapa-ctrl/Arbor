import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SupportedLanguage, translate } from './i18n';

const STORAGE_KEY = 'arbor_language';

type LanguageContextValue = {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: 'pl',
  setLanguage: () => {},
  t: (key: string) => key,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>('pl');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'pl' || saved === 'uk' || saved === 'ru') {
        setLanguageState(saved);
      }
    });
  }, []);

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    setLanguageState(nextLanguage);
    void AsyncStorage.setItem(STORAGE_KEY, nextLanguage);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key, vars) => translate(language, key, vars),
  }), [language, setLanguage]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
