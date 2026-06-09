import React, { useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { PLATINUM_MOTION } from '../../constants/motion';
import { useTheme } from '../../constants/ThemeContext';

type PlatinumPressableProps = PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function PlatinumPressable({ children, style, onPressIn, onPressOut, ...props }: PlatinumPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const { theme } = useTheme();
  const pressedBg = useMemo(
    () => (theme.name === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(255,255,255,0.045)'),
    [theme.name],
  );

  const animateTo = (toValue: number) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue,
        ...PLATINUM_MOTION.spring.press,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: toValue < 1 ? 0.94 : 1,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Pressable
      {...props}
      onPressIn={(evt) => {
        animateTo(PLATINUM_MOTION.scale.pressIn);
        onPressIn?.(evt);
      }}
      onPressOut={(evt) => {
        animateTo(1);
        onPressOut?.(evt);
      }}
    >
      <Animated.View style={[styles.base, style, { opacity, transform: [{ scale }] }]}>
        {children}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.pressedLayer, { backgroundColor: pressedBg, opacity: Animated.subtract(1, opacity) }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
  },
  pressedLayer: {
    borderRadius: 7,
    pointerEvents: 'none',
  },
});

