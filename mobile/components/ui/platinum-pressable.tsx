import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { PLATINUM_MOTION } from '../../constants/motion';

type PlatinumPressableProps = PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function PlatinumPressable({ children, style, onPressIn, onPressOut, ...props }: PlatinumPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      ...PLATINUM_MOTION.spring.press,
      useNativeDriver: true,
    }).start();
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
      <Animated.View style={[styles.base, style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
  },
});

