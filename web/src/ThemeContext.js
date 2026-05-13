import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Noc leśna',
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
    label: 'Biały ogród',
    bg: '#f6fbf7',
    bgCard: '#ffffff',
    bgDeep: '#eef8f1',
    sidebar: '#ffffff',
    accent: '#14834f',
    accentDk: '#0f6b3f',
    text: '#10261b',
    textSub: '#3f5f4b',
    textMuted: '#6e8475',
    border: 'rgba(20, 91, 54, 0.11)',
    border2: 'rgba(20, 131, 79, 0.22)',
    inputBg: '#fbfefc',
    previewDot: '#14834f',
    previewBg: '#f6fbf7',
  },
  green: {
    id: 'green',
    label: 'Arbor Green',
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
      const t = raw == null ? '' : String(raw).trim();
      if (!t || t === 'undefined' || t === 'null') return 'light';
      if (t === 'green') return 'light';
      return THEMES[t] ? t : 'light';
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
