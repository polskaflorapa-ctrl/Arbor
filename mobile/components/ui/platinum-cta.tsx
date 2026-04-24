import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TouchableOpacityProps,
} from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { PLATINUM_MOTION } from '../../constants/motion';

type PlatinumCTAProps = TouchableOpacityProps & {
  label: string;
  loading?: boolean;
};

export function PlatinumCTA({ label, loading = false, disabled, style, ...props }: PlatinumCTAProps) {
  const { theme } = useTheme();
  const blocked = disabled || loading;
  const shimmerX = useRef(new Animated.Value(-140)).current;

  useEffect(() => {
    if (blocked) return;
    const loop = Animated.loop(
      Animated.timing(shimmerX, {
        toValue: 320,
        duration: PLATINUM_MOTION.duration.shimmerLoop,
        easing: PLATINUM_MOTION.easing.smoothInOut,
        useNativeDriver: true,
      }),
    );
    shimmerX.setValue(-140);
    loop.start();
    return () => loop.stop();
  }, [blocked, shimmerX]);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={blocked}
      style={[
        styles.btn,
        {
          backgroundColor: theme.accent,
          borderWidth: 1,
          borderColor: theme.accent + '88',
          shadowColor: theme.shadowColor,
          shadowOpacity: theme.shadowOpacity * 0.72,
          shadowRadius: theme.shadowRadius + 4,
          shadowOffset: { width: 0, height: theme.shadowOffsetY + 2 },
          elevation: theme.cardElevation + 2,
        },
        blocked && styles.disabled,
        style,
      ]}
      {...props}
    >
      <View pointerEvents="none" style={styles.shimmerWrap}>
        <Animated.View
          style={[
            styles.shimmerBar,
            {
              transform: [{ translateX: shimmerX }, { skewX: '-18deg' }],
              backgroundColor: theme.accentText + '1F',
            },
          ]}
        />
      </View>
      {loading ? <ActivityIndicator size="small" color={theme.accentText} /> : <Text style={[styles.label, { color: theme.accentText }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  shimmerWrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  shimmerBar: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    width: 80,
  },
  label: {
    fontWeight: '800',
    fontSize: 15.5,
    letterSpacing: 0.45,
  },
  disabled: {
    opacity: 0.6,
  },
});

