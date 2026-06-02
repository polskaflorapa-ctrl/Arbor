import { StatusBar } from 'react-native';

import { useTheme } from '../../constants/ThemeContext';

type AppStatusBarProps = {
  backgroundColor?: string;
};

export function AppStatusBar({ backgroundColor }: AppStatusBarProps) {
  const { theme } = useTheme();

  return (
    <StatusBar
      barStyle={theme.name === 'light' ? 'dark-content' : 'light-content'}
      backgroundColor={backgroundColor ?? theme.headerBg}
    />
  );
}
