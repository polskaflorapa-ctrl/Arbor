import React from 'react';
import {
  Image,
  StyleSheet,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
} from 'react-native';

import { useTheme } from '../../constants/ThemeContext';

type BrandLogoOrientation = 'horizontal' | 'vertical';
type BrandLogoSurface = 'auto' | 'light' | 'dark';

type BrandLogoProps = {
  orientation?: BrandLogoOrientation;
  descriptor?: boolean;
  surface?: BrandLogoSurface;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
};

type BrandPatternProps = {
  style?: StyleProp<ImageStyle>;
  opacity?: number;
};

const APPROVED_LOGOS = {
  withDescriptor: {
    horizontal: {
      light: require('../../assets/brand/logos/with-descriptor/png/horizontal-light.png'),
      dark: require('../../assets/brand/logos/with-descriptor/png/horizontal-dark.png'),
    },
    vertical: {
      light: require('../../assets/brand/logos/with-descriptor/png/vertical-light.png'),
      dark: require('../../assets/brand/logos/with-descriptor/png/vertical-dark.png'),
    },
  },
  withoutDescriptor: {
    horizontal: {
      light: require('../../assets/brand/logos/without-descriptor/png/horizontal-light.png'),
      dark: require('../../assets/brand/logos/without-descriptor/png/horizontal-dark.png'),
    },
    vertical: {
      light: require('../../assets/brand/logos/without-descriptor/png/vertical-light.png'),
      dark: require('../../assets/brand/logos/without-descriptor/png/vertical-dark.png'),
    },
  },
} as const;

const ASPECT_RATIO = {
  withDescriptor: {
    horizontal: 3853 / 929,
    vertical: 876 / 1187,
  },
  withoutDescriptor: {
    horizontal: 1587 / 669,
    vertical: 981 / 1209,
  },
} as const;

const APPROVED_PATTERNS = {
  light: require('../../assets/brand/patterns/light-green.png'),
  dark: require('../../assets/brand/patterns/light-brown.png'),
} as const;

export function BrandLogo({
  orientation = 'horizontal',
  descriptor = true,
  surface = 'auto',
  style,
  accessibilityLabel = 'Polska Flora — Nature Integrator',
}: BrandLogoProps) {
  const { theme } = useTheme();
  const descriptorKey = descriptor ? 'withDescriptor' : 'withoutDescriptor';
  const resolvedSurface = surface === 'auto'
    ? (theme.name === 'dark' ? 'dark' : 'light')
    : surface;
  const source: ImageSourcePropType = APPROVED_LOGOS[descriptorKey][orientation][resolvedSurface];
  const aspectRatio = ASPECT_RATIO[descriptorKey][orientation];
  const flattenedStyle = StyleSheet.flatten(style) || {};
  const requestedWidth = typeof flattenedStyle.width === 'number' ? flattenedStyle.width : undefined;
  const requestedHeight = typeof flattenedStyle.height === 'number' ? flattenedStyle.height : undefined;
  const defaultWidth = orientation === 'horizontal' ? 240 : 112;
  const resolvedDimensions: ImageStyle = requestedWidth !== undefined && requestedHeight === undefined
    ? { height: requestedWidth / aspectRatio }
    : requestedHeight !== undefined && requestedWidth === undefined
      ? { width: requestedHeight * aspectRatio }
      : flattenedStyle.width == null && flattenedStyle.height == null
        ? { width: defaultWidth, height: defaultWidth / aspectRatio }
        : {};

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={source}
      resizeMode="contain"
      style={[
        {
          aspectRatio,
        },
        style,
        resolvedDimensions,
      ]}
    />
  );
}

/** Decorative identity pattern supplied with the brand book. */
export function BrandPattern({ style, opacity = 0.055 }: BrandPatternProps) {
  const { theme } = useTheme();

  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      source={APPROVED_PATTERNS[theme.name]}
      resizeMode="cover"
      style={[
        {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity,
        },
        style,
      ]}
    />
  );
}
