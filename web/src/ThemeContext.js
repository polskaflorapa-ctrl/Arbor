import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Nocny Las',
    bg: '#07100c',
    bgCard: '#101b13',
    bgDeep: '#050906',
    sidebar: '#06110b',
    accent: '#9bd957',
    accentDk: '#5fa832',
    text: '#f1f8ee',
    textSub: '#cbd8c4',
    textMuted: '#91a38d',
    border: 'rgba(255,255,255,0.09)',
    border2: 'rgba(155,217,87,0.28)',
    inputBg: '#0c1510',
    previewDot: '#9bd957',
    previewBg: '#07100c',
  },
  light: {
    id: 'light',
    label: 'Gleboki Gaj',
    bg: '#08120c',
    bgCard: '#102016',
    bgDeep: '#050907',
    sidebar: '#06110b',
    accent: '#8ed246',
    accentDk: '#5a9630',
    text: '#f4faef',
    textSub: '#d3dfca',
    textMuted: '#9aaa95',
    border: 'rgba(255,255,255,0.09)',
    border2: 'rgba(142,210,70,0.28)',
    inputBg: '#0c1510',
    previewDot: '#8ed246',
    previewBg: '#08120c',
  },
  green: {
    id: 'green',
    label: 'Arbor Green',
    bg: '#07100c',
    bgCard: '#101b13',
    bgDeep: '#050906',
    sidebar: '#06110b',
    accent: '#9bd957',
    accentDk: '#5fa832',
    text: '#f1f8ee',
    textSub: '#cbd8c4',
    textMuted: '#91a38d',
    border: 'rgba(255,255,255,0.09)',
    border2: 'rgba(155,217,87,0.28)',
    inputBg: '#0c1510',
    previewDot: '#9bd957',
    previewBg: '#07100c',
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
      if (!t || t === 'undefined' || t === 'null') return 'green';
      return THEMES[t] ? t : 'green';
    } catch {
      return 'green';
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
