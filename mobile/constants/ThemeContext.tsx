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
const CURRENT_DESIGN_VERSION = 'deep_space_tech_2026_05b';

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
}

const DEFAULT_THEME: ThemeName = 'tech';

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes[DEFAULT_THEME],
  themeName: DEFAULT_THEME,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, DESIGN_VERSION_KEY]).then((pairs) => {
      const saved = pairs[0]?.[1];
      const designVersion = pairs[1]?.[1];
      if (designVersion !== CURRENT_DESIGN_VERSION) {
        setThemeName(DEFAULT_THEME);
        void AsyncStorage.multiSet([
          [STORAGE_KEY, DEFAULT_THEME],
          [DESIGN_VERSION_KEY, CURRENT_DESIGN_VERSION],
        ]);
        return;
      }
      if (saved === 'tech' || saved === 'emerald' || saved === 'pulsar') {
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
