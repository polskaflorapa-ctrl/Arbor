import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { shadowStyle } from '../../constants/elevation';
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
    outputRange: [theme.surface, tint + '18'],
  });
  const border = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.border, tint],
  });
  const textColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.textSub, tint],
  });

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          styles.chip,
          {
            backgroundColor: bg,
            borderColor: border,
            ...shadowStyle(theme, {
              opacity: active ? theme.shadowOpacity * 0.08 : 0,
              radius: theme.shadowRadius * 0.25,
              offsetY: 1,
              elevation: active ? 1 : 0,
            }),
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
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
});

