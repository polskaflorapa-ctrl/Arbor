/**
 * ThemeContext — globalny kontekst motywu aplikacji.
 *
 * Użycie:
 *   import { useTheme } from '../constants/ThemeContext';
 *   const { theme, themeName, setTheme } = useTheme();
 *
 *   // Przykład w StyleSheet:
 *   backgroundColor: theme.bg
 *
 * Owijamy cały app/_layout.tsx w <ThemeProvider>
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Theme, ThemeName, themes } from './theme';

const STORAGE_KEY = 'arbor_theme';

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes.green,
  themeName: 'green',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>('green');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'dark' || saved === 'light' || saved === 'green') {
        setThemeName(saved);
      }
    });
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    AsyncStorage.setItem(STORAGE_KEY, name);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: themes[themeName], themeName, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
