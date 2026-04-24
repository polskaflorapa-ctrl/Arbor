import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

type PlatinumIconBadgeProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color?: string;
  size?: number;
  style?: ViewStyle;
};

export function PlatinumIconBadge({ icon, color, size = 18, style }: PlatinumIconBadgeProps) {
  const { theme } = useTheme();
  const accent = color || theme.accent;
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: accent + '24',
          borderColor: accent + '66',
          shadowColor: theme.shadowColor,
          shadowOpacity: theme.shadowOpacity * 0.56,
          shadowRadius: theme.shadowRadius * 0.72,
          shadowOffset: { width: 0, height: Math.max(2, theme.shadowOffsetY - 2) },
          elevation: Math.max(3, theme.cardElevation - 1),
        },
        style,
      ]}
    >
      <View style={[styles.inner, { backgroundColor: accent + '1A' }]}>
        <Ionicons name={icon} size={size} color={accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: 28,
    height: 28,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

