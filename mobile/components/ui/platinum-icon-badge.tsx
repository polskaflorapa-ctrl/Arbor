import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

type PlatinumIconBadgeProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color?: string;
  /** Rozmiar samej ikony (px). Ramka skaluje się automatycznie — min. czytelność na telefonie. */
  size?: number;
  style?: ViewStyle;
};

export function PlatinumIconBadge({ icon, color, size = 22, style }: PlatinumIconBadgeProps) {
  const { theme } = useTheme();
  const accent = color || theme.accent;
  const iconSize = Math.max(16, size);
  const outerDim = Math.max(44, Math.round(iconSize + 20));
  const innerDim = Math.max(34, Math.round(iconSize + 10));
  const rOut = Math.round(outerDim * 0.28);
  const rIn = Math.round(innerDim * 0.28);

  return (
    <View
      style={[
        {
          width: outerDim,
          height: outerDim,
          borderRadius: rOut,
          borderWidth: 1,
          justifyContent: 'center',
          alignItems: 'center',
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
      <View
        style={[
          styles.inner,
          {
            width: innerDim,
            height: innerDim,
            borderRadius: rIn,
            backgroundColor: accent + '1A',
          },
        ]}
      >
        <Ionicons name={icon} size={iconSize} color={accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
