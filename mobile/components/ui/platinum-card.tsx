import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { shadowStyle } from '../../constants/elevation';

type PlatinumCardProps = ViewProps & {
  elevated?: boolean;
  glow?: boolean;
};

export function PlatinumCard({ style, elevated = true, glow = false, children, ...props }: PlatinumCardProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: theme.cardBg,
          borderColor: glow ? theme.accentLight : theme.cardBorder,
          borderRadius: theme.radiusXl,
          ...shadowStyle(theme, {
            opacity: elevated ? theme.shadowOpacity : 0,
            radius: theme.shadowRadius,
            offsetY: Math.max(1, theme.shadowOffsetY),
            elevation: elevated ? theme.cardElevation : 0,
          }),
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
});

