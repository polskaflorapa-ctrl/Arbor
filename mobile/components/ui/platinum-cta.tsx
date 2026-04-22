import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type TouchableOpacityProps } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

type PlatinumCTAProps = TouchableOpacityProps & {
  label: string;
  loading?: boolean;
};

export function PlatinumCTA({ label, loading = false, disabled, style, ...props }: PlatinumCTAProps) {
  const { theme } = useTheme();
  const blocked = disabled || loading;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={blocked}
      style={[
        styles.btn,
        {
          backgroundColor: theme.accent,
          shadowColor: theme.shadowColor,
          shadowOpacity: theme.shadowOpacity * 0.5,
          shadowRadius: theme.shadowRadius,
          shadowOffset: { width: 0, height: theme.shadowOffsetY },
          elevation: theme.cardElevation,
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
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.6,
  },
});

