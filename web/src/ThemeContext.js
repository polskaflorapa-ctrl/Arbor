import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Arbor nocny',
    bg: '#07110c',
    bgCard: '#0d1a13',
    bgDeep: '#040907',
    sidebar: '#06130d',
    accent: '#6ee7a8',
    accentDk: '#22c55e',
    text: '#f0f7f2',
    textSub: '#c8d7ce',
    textMuted: '#91a79a',
    border: 'rgba(207,230,215,0.11)',
    border2: 'rgba(110,231,168,0.28)',
    inputBg: '#08120d',
    previewDot: '#6ee7a8',
    previewBg: '#07110c',
  },
  light: {
    id: 'light',
    label: 'Arbor jasny',
    bg: '#f4faf5',
    bgCard: '#ffffff',
    bgDeep: '#eef8f1',
    sidebar: '#06331f',
    accent: '#14834f',
    accentDk: '#0f6b3f',
    text: '#102218',
    textSub: '#3f5f4b',
    textMuted: '#6a7c70',
    border: 'rgba(15,95,58,0.12)',
    border2: 'rgba(40,182,108,0.24)',
    inputBg: '#ffffff',
    previewDot: '#28b66c',
    previewBg: '#f4faf5',
  },
  green: {
    id: 'green',
    label: 'Arbor terenowy',
    bg: '#06110d',
    bgCard: '#0c1d14',
    bgDeep: '#030806',
    sidebar: '#04110b',
    accent: '#78f2ad',
    accentDk: '#2fd06f',
    text: '#f2faf5',
    textSub: '#c9d9cf',
    textMuted: '#92a99c',
    border: 'rgba(213,236,220,0.1)',
    border2: 'rgba(120,242,173,0.28)',
    inputBg: '#08130d',
    previewDot: '#78f2ad',
    previewBg: '#06110d',
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
      if ((stored === 'dark' || stored === 'green') && localStorage.getItem('arbor-premium-theme-migrated') !== '1') {
        localStorage.setItem('arbor-premium-theme-migrated', '1');
        return 'light';
      }
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
