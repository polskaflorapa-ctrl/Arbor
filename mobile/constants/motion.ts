import { Easing, Platform } from 'react-native';

export const PLATINUM_MOTION = {
  duration: {
    fast: 180,
    medium: 280,
    slow: 340,
    shimmerLoop: 1900,
  },
  easing: {
    smoothOut: Easing.out(Easing.quad),
    smoothOutStrong: Easing.out(Easing.cubic),
    smoothInOut: Easing.inOut(Easing.quad),
  },
  spring: {
    press: { speed: 22, bounciness: 3 },
    sheet: { speed: 16, bounciness: 4 },
    tabs: { speed: 18, bounciness: 5 },
  },
  scale: {
    // iOS gets subtler press depth for a more premium feel.
    pressIn: Platform.OS === 'ios' ? 0.985 : 0.98,
  },
} as const;

