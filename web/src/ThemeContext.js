import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BRAND_COLORS } from './theme';

export const THEMES = {
  // Polska Flora — approved light-background identity.
  light: {
    id: 'light',
    label: 'Jasny · Polska Flora',
    bg: '#f0ebdd',
    bgCard: '#ffffff',
    bgDeep: '#f0ebdd',
    sidebar: BRAND_COLORS.darkBrown,
    accent: BRAND_COLORS.primaryGreen,
    accentDk: '#5d6a0b',
    text: BRAND_COLORS.darkBrown,
    textSub: '#995510',
    textMuted: BRAND_COLORS.lightBrown,
    border: 'rgba(59,42,24,0.14)',
    border2: 'rgba(160,175,20,0.28)',
    inputBg: '#ffffff',
    previewDot: BRAND_COLORS.primaryGreen,
    previewBg: '#f0ebdd',
  },
  // Polska Flora — approved dark-background identity.
  dark: {
    id: 'dark',
    label: 'Ciemny · Polska Flora',
    bg: BRAND_COLORS.darkBrown,
    bgCard: '#2c2011',
    bgDeep: '#2c2011',
    sidebar: '#2c2011',
    accent: BRAND_COLORS.lightGreen,
    accentDk: BRAND_COLORS.primaryGreen,
    text: '#f0ebdd',
    textSub: '#fae7d2',
    textMuted: '#fae7d2',
    border: 'rgba(255,250,240,0.14)',
    border2: 'rgba(180,194,50,0.3)',
    inputBg: '#2c2011',
    previewDot: BRAND_COLORS.lightGreen,
    previewBg: BRAND_COLORS.darkBrown,
  },
};

const ThemeContext = createContext({
  theme: THEMES.light,
  themeId: 'light',
  setTheme: () => {},
  T: THEMES.light,
});

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    try {
      const raw = localStorage.getItem('arbor-theme');
      const stored = raw == null ? '' : String(raw).trim();
      if (!stored || stored === 'undefined' || stored === 'null') return 'light';
      // Stary motyw "green" (terenowy) został scalony z motywem ciemnym.
      if (stored === 'green') return 'dark';
      return THEMES[stored] ? stored : 'light';
    } catch {
      return 'light';
    }
  });

  const theme = THEMES[themeId] || THEMES.light;

  const applyTheme = useCallback((id) => {
    const safeId = THEMES[id] ? id : 'light';
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-green');
    document.body.classList.add(`theme-${safeId}`);
    localStorage.setItem('arbor-theme', safeId);
    setThemeId(safeId);
  }, []);

  useEffect(() => {
    applyTheme(themeId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = useCallback((id) => {
    applyTheme(id);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, themeId, setTheme, T: theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export default ThemeContext;
