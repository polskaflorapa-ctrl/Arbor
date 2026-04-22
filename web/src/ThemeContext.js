import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Ciemny',
    bg: '#0a0e14',
    bgCard: '#121a24',
    bgDeep: '#0e1218',
    sidebar: '#070a0f',
    accent: '#10b981',
    accentDk: '#059669',
    text: '#e8edf4',
    textSub: '#94a3b8',
    textMuted: '#64748b',
    border: 'rgba(148,163,184,0.14)',
    border2: 'rgba(148,163,184,0.22)',
    inputBg: '#0e1218',
    previewDot: '#10b981',
    previewBg: '#0a0e14',
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
    label: 'Zielony',
    bg: '#071209',
    bgCard: '#0f1f12',
    bgDeep: '#0a160c',
    sidebar: '#040806',
    accent: '#5eead4',
    accentDk: '#2dd4bf',
    text: '#ecfdf5',
    textSub: '#a7f3d0',
    textMuted: '#5dae8f',
    border: 'rgba(94,234,212,0.12)',
    border2: 'rgba(94,234,212,0.2)',
    inputBg: '#0a160c',
    previewDot: '#5eead4',
    previewBg: '#071209',
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
