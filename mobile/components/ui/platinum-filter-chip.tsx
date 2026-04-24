import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { PLATINUM_MOTION } from '../../constants/motion';

type PlatinumFilterChipProps = {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function PlatinumFilterChip({ label, active, color, onPress, style }: PlatinumFilterChipProps) {
  const { theme } = useTheme();
  const tint = color || theme.accent;
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0,
      duration: PLATINUM_MOTION.duration.fast,
      useNativeDriver: false,
    }).start();
  }, [active, anim]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.surface2, tint + '2E'],
  });
  const border = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.border, tint],
  });
  const textColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.textSub, tint],
  });
  const glow = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, theme.shadowOpacity * 0.55],
  });

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          styles.chip,
          {
            backgroundColor: bg,
            borderColor: border,
            shadowColor: theme.shadowColor,
            shadowOpacity: glow,
            shadowRadius: theme.shadowRadius * 0.62,
            shadowOffset: { width: 0, height: Math.max(2, theme.shadowOffsetY - 3) },
            elevation: active ? 3 : 0,
          },
          style,
        ]}
      >
        <Animated.Text style={[styles.label, { color: textColor }]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
});

