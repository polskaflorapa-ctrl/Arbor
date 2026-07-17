/** Approved Polska Flora identity tokens from the official brand book. */
export const POLSKA_FLORA_COLORS = {
  darkBrown: '#3B2A18',
  lightBrown: '#766440',
  primaryGreen: '#A0AF14',
  lightGreen: '#B4C232',
  orangeBrown: '#BD701E',
  white: '#FFFFFF',
  black: '#000000',
} as const;

/** Runtime aliases registered by `expo-font` in the root layout. */
export const ROAD_UA = {
  thin: 'RoadUA-Thin',
  extraLight: 'RoadUA-ExtraLight',
  light: 'RoadUA-Light',
  regular: 'RoadUA-Regular',
  medium: 'RoadUA-Medium',
  bold: 'RoadUA-Bold',
  extraBold: 'RoadUA-ExtraBold',
  black: 'RoadUA-Black',
} as const;

export const ROAD_UA_ASSETS = {
  [ROAD_UA.thin]: require('../assets/brand/fonts/RoadUA-Thin.otf'),
  [ROAD_UA.extraLight]: require('../assets/brand/fonts/RoadUA-ExtraLight.otf'),
  [ROAD_UA.light]: require('../assets/brand/fonts/RoadUA-Light.otf'),
  [ROAD_UA.regular]: require('../assets/brand/fonts/RoadUA-Regular.otf'),
  [ROAD_UA.medium]: require('../assets/brand/fonts/RoadUA-Medium.otf'),
  [ROAD_UA.bold]: require('../assets/brand/fonts/RoadUA-Bold.otf'),
  [ROAD_UA.extraBold]: require('../assets/brand/fonts/RoadUA-ExtraBold.otf'),
  [ROAD_UA.black]: require('../assets/brand/fonts/RoadUA-Black.otf'),
} as const;

export const POLSKA_FLORA_TYPE = {
  body: ROAD_UA.regular,
  bodyStrong: ROAD_UA.bold,
  heading: ROAD_UA.extraBold,
  display: ROAD_UA.black,
} as const;
