import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const THEMES = {
  // Wariant A — Leśny premium (jasny)
  light: {
    id: 'light',
    label: 'Jasny · Leśny premium',
    bg: '#f6faf7',
    bgCard: '#ffffff',
    bgDeep: '#edf6f0',
    sidebar: '#0b3825',
    accent: '#0f6b3f',
    accentDk: '#0a4f31',
    text: '#12251a',
    textSub: '#3e5a48',
    textMuted: '#6e8175',
    border: 'rgba(15,95,58,0.14)',
    border2: 'rgba(15,95,58,0.22)',
    inputBg: '#ffffff',
    previewDot: '#2fbe72',
    previewBg: '#f6faf7',
  },
  // Wariant C — Emerald aurora (ciemny)
  dark: {
    id: 'dark',
    label: 'Ciemny · Emerald aurora',
    bg: '#04130c',
    bgCard: '#0c2016',
    bgDeep: '#061a10',
    sidebar: '#06140d',
    accent: '#34e89e',
    accentDk: '#0bd9b3',
    text: '#eafff3',
    textSub: '#a7d8bf',
    textMuted: '#6b9580',
    border: 'rgba(52,232,158,0.14)',
    border2: 'rgba(52,232,158,0.24)',
    inputBg: '#0a1b12',
    previewDot: '#34e89e',
    previewBg: '#04130c',
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
