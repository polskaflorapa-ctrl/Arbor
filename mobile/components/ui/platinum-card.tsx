import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

type PlatinumCardProps = ViewProps & {
  elevated?: boolean;
};

export function PlatinumCard({ style, elevated = true, ...props }: PlatinumCardProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          shadowColor: theme.shadowColor,
          shadowOpacity: elevated ? theme.shadowOpacity * 0.6 : 0,
          shadowRadius: theme.shadowRadius,
          shadowOffset: { width: 0, height: theme.shadowOffsetY },
          elevation: elevated ? theme.cardElevation : 0,
        },
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
});

