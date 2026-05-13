import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type TouchableOpacityProps,
} from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { shadowStyle } from '../../constants/elevation';

type PlatinumCTAProps = TouchableOpacityProps & {
  label: string;
  loading?: boolean;
};

export function PlatinumCTA({ label, loading = false, disabled, style, ...props }: PlatinumCTAProps) {
  const { theme } = useTheme();
  const blocked = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      disabled={blocked}
      style={[
        styles.btn,
        {
          backgroundColor: theme.accent,
          borderWidth: 1,
          borderColor: theme.accentDark,
          ...shadowStyle(theme, {
            opacity: blocked ? 0 : theme.shadowOpacity,
            radius: theme.shadowRadius,
            offsetY: Math.max(1, theme.shadowOffsetY),
            elevation: blocked ? 0 : theme.cardElevation,
          }),
        },
        blocked && styles.disabled,
        style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator size="small" color={theme.accentText} /> : <Text style={[styles.label, { color: theme.accentText }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  label: {
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0,
  },
  disabled: {
    opacity: 0.6,
  },
});

