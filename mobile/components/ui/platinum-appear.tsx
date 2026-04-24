import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { PLATINUM_MOTION } from '../../constants/motion';

type PlatinumAppearProps = {
  children: React.ReactNode;
  delayMs?: number;
  style?: StyleProp<ViewStyle>;
};

export function PlatinumAppear({ children, delayMs = 0, style }: PlatinumAppearProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: PLATINUM_MOTION.duration.medium,
        delay: delayMs,
        easing: PLATINUM_MOTION.easing.smoothOut,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: PLATINUM_MOTION.duration.slow,
        delay: delayMs,
        easing: PLATINUM_MOTION.easing.smoothOutStrong,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delayMs, opacity, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

