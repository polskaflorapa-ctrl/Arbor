import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Apple Dark',
    bg: '#060908',
    bgCard: '#0f1512',
    bgDeep: '#080b09',
    sidebar: '#070b09',
    accent: '#0a84ff',
    accentDk: '#0066cc',
    text: '#eef7f1',
    textSub: '#c0cdc6',
    textMuted: '#8a9b90',
    border: 'rgba(255,255,255,0.09)',
    border2: 'rgba(10,132,255,0.26)',
    inputBg: '#0d1210',
    previewDot: '#0a84ff',
    previewBg: '#060908',
  },
  light: {
    id: 'light',
    label: 'Apple Light',
    bg: '#eef2f6',
    bgCard: '#ffffff',
    bgDeep: '#e8edf3',
    sidebar: '#0f172a',
    accent: '#007aff',
    accentDk: '#0063cc',
    text: '#0f172a',
    textSub: '#475569',
    textMuted: '#64748b',
    border: 'rgba(15,23,42,0.09)',
    border2: 'rgba(15,23,42,0.12)',
    inputBg: '#f8fafc',
    previewDot: '#007aff',
    previewBg: '#eef2f6',
  },
  green: {
    id: 'green',
    label: 'Arbor Green',
    bg: '#060908',
    bgCard: '#0f1512',
    bgDeep: '#080b09',
    sidebar: '#070b09',
    accent: '#5eea9f',
    accentDk: '#34d399',
    text: '#eef7f1',
    textSub: '#c0cdc6',
    textMuted: '#8a9b90',
    border: 'rgba(255,255,255,0.09)',
    border2: 'rgba(94,234,159,0.22)',
    inputBg: '#0d1210',
    previewDot: '#5eea9f',
    previewBg: '#060908',
  },
};

const ThemeContext = createContext({
  theme: THEMES.dark,
  themeId: 'dark',
  setTheme: () => {},
  T: THEMES.dark,
});

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    try {
      const raw = localStorage.getItem('arbor-theme');
      const t = raw == null ? '' : String(raw).trim();
      if (!t || t === 'undefined' || t === 'null') return 'dark';
      return THEMES[t] ? t : 'dark';
    } catch {
      return 'dark';
    }
  });

  const theme = THEMES[themeId] || THEMES.dark;

  const applyTheme = useCallback((id) => {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-green');
    document.body.classList.add(`theme-${id}`);
    localStorage.setItem('arbor-theme', id);
    setThemeId(id);
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
