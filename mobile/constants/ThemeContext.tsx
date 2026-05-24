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
const DESIGN_VERSION_KEY = 'arbor_theme_design_version';
const CURRENT_DESIGN_VERSION = 'deep_space_tech_2026_05';

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes.dark,
  themeName: 'dark',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>('dark');

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, DESIGN_VERSION_KEY]).then((pairs) => {
      const saved = pairs[0]?.[1];
      const designVersion = pairs[1]?.[1];
      if (designVersion !== CURRENT_DESIGN_VERSION) {
        setThemeName('dark');
        void AsyncStorage.multiSet([
          [STORAGE_KEY, 'dark'],
          [DESIGN_VERSION_KEY, CURRENT_DESIGN_VERSION],
        ]);
        return;
      }
      if (saved === 'dark' || saved === 'light' || saved === 'green') {
        setThemeName(saved);
      }
    });
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    void AsyncStorage.multiSet([
      [STORAGE_KEY, name],
      [DESIGN_VERSION_KEY, CURRENT_DESIGN_VERSION],
    ]);
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
