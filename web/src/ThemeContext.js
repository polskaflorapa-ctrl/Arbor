import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Ciemny',
    bg: '#030303',
    bgCard: '#0f0f0f',
    bgDeep: '#080808',
    sidebar: '#050505',
    accent: '#e8e8ed',
    accentDk: '#a1a1aa',
    text: '#f4f4f5',
    textSub: '#c4c4cc',
    textMuted: '#8b8b96',
    border: 'rgba(255,255,255,0.08)',
    border2: 'rgba(255,255,255,0.14)',
    inputBg: '#121212',
    previewDot: '#e8e8ed',
    previewBg: '#030303',
  },
  light: {
    id: 'light',
    label: 'Jasny',
    bg: '#eef2f6',
    bgCard: '#ffffff',
    bgDeep: '#e2e8f0',
    sidebar: '#0f172a',
    accent: '#059669',
    accentDk: '#047857',
    text: '#0f172a',
    textSub: '#475569',
    textMuted: '#64748b',
    border: 'rgba(15,23,42,0.1)',
    border2: 'rgba(15,23,42,0.14)',
    inputBg: '#f8fafc',
    previewDot: '#059669',
    previewBg: '#eef2f6',
  },
  green: {
    id: 'green',
    label: 'Platinum Chrome',
    bg: '#030303',
    bgCard: '#0f0f0f',
    bgDeep: '#080808',
    sidebar: '#050505',
    accent: '#e8e8ed',
    accentDk: '#a1a1aa',
    text: '#f4f4f5',
    textSub: '#c4c4cc',
    textMuted: '#8b8b96',
    border: 'rgba(255,255,255,0.08)',
    border2: 'rgba(255,255,255,0.14)',
    inputBg: '#121212',
    previewDot: '#e8e8ed',
    previewBg: '#030303',
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
