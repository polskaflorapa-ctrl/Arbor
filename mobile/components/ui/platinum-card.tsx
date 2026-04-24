import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

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
          borderColor: theme.cardBorder,
          shadowColor: theme.shadowColor,
          shadowOpacity: elevated ? theme.shadowOpacity * 0.72 : 0,
          shadowRadius: theme.shadowRadius * 1.05,
          shadowOffset: { width: 0, height: theme.shadowOffsetY + 1 },
          elevation: elevated ? theme.cardElevation + 1 : 0,
        },
        style,
      ]}
      {...props}
    >
      {glow ? (
        <View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              backgroundColor: theme.accent + '12',
              borderColor: theme.accent + '2A',
            },
          ]}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.edgeHighlight,
          {
            borderColor: theme.accent + '24',
            backgroundColor: theme.accent + '08',
          },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -30,
    right: -46,
    width: 170,
    height: 98,
    borderRadius: 54,
    borderWidth: 1,
  },
  edgeHighlight: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 8,
    height: 1,
    borderWidth: 1,
    borderRadius: 999,
  },
});

