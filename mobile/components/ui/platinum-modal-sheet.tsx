import React, { useEffect, useRef } from 'react';
import {
  Animated,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { PLATINUM_MOTION } from '../../constants/motion';

type PlatinumModalSheetProps = {
  visible: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function PlatinumModalSheet({ visible, style, children }: PlatinumModalSheetProps) {
  const translateY = useRef(new Animated.Value(42)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(42);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        ...PLATINUM_MOTION.spring.sheet,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: PLATINUM_MOTION.duration.medium,
        easing: PLATINUM_MOTION.easing.smoothOut,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, visible]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

