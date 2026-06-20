import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { colorWithAlpha } from '../../constants/elevation';

export type PlatinumIconName = React.ComponentProps<typeof Ionicons>['name'];

type PlatinumIconBadgeProps = {
  icon: PlatinumIconName;
  color?: string;
  /** Rozmiar samej ikony (px). Ramka skaluje sie automatycznie, z zachowaniem czytelnosci na telefonie. */
  size?: number;
  style?: ViewStyle;
};

export function PlatinumIconBadge({ icon, color, size = 22, style }: PlatinumIconBadgeProps) {
  const { theme } = useTheme();
  const accent = color || theme.accent;
  const iconSize = Math.max(14, size);
  const outerDim = Math.max(30, Math.round(iconSize + 12));
  const radius = Math.max(8, Math.round(outerDim * 0.25));

  return (
    <View
      style={[
        styles.badge,
        {
          width: outerDim,
          height: outerDim,
          borderRadius: radius,
          backgroundColor: colorWithAlpha(accent, 0.1),
          borderColor: colorWithAlpha(accent, 0.22),
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
