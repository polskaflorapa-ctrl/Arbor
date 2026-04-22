import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

type SkeletonBlockProps = {
  height?: number;
  width?: number | `${number}%`;
  borderRadius?: number;
};

export function SkeletonBlock({ height = 14, width = '100%', borderRadius = 8 }: SkeletonBlockProps) {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 550, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        {
          opacity,
          height,
          width,
          borderRadius,
          backgroundColor: theme.surface3,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});

export function DashboardSkeleton() {
  return (
    <View style={stylesDash.wrap}>
      <SkeletonBlock height={30} width="55%" />
      <SkeletonBlock height={12} width="35%" />
      <View style={stylesDash.row}>
        <SkeletonBlock height={72} width="31%" borderRadius={12} />
        <SkeletonBlock height={72} width="31%" borderRadius={12} />
        <SkeletonBlock height={72} width="31%" borderRadius={12} />
      </View>
      <SkeletonBlock height={120} borderRadius={14} />
      <SkeletonBlock height={120} borderRadius={14} />
    </View>
  );
}

const stylesDash = StyleSheet.create({
  wrap: {
    gap: 10,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
});

