import { StatusBar, type StatusBarStyle } from 'react-native';

import { useTheme } from '../../constants/ThemeContext';

type AppStatusBarProps = {
  backgroundColor?: string;
  barStyle?: StatusBarStyle;
};

export function AppStatusBar({ backgroundColor, barStyle }: AppStatusBarProps) {
  const { theme } = useTheme();

  return (
    <StatusBar
      barStyle={barStyle ?? (theme.name === 'light' ? 'dark-content' : 'light-content')}
      backgroundColor={backgroundColor ?? theme.headerBg}
    />
  );
}
