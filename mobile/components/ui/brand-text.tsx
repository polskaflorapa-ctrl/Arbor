import React from 'react';
import {
  StyleSheet,
  Text as NativeText,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '../../constants/ThemeContext';

function fontForWeight(weight: TextStyle['fontWeight'], theme: ReturnType<typeof useTheme>['theme']) {
  const numeric = weight === 'bold' ? 700 : Number(weight || 400);
  if (numeric >= 800) return theme.fontExtraBold;
  if (numeric >= 600) return theme.fontBold;
  if (numeric >= 500) return theme.fontMedium;
  return theme.fontRegular;
}

/**
 * Native Text with the approved Road UA family applied to every weight.
 * Explicit `fontFamily` values remain untouched for specialist glyph fonts.
 */
export function BrandText({ style, ...props }: TextProps) {
  const { theme } = useTheme();
  const flatStyle = StyleSheet.flatten(style);
  const fontFamily = flatStyle?.fontFamily || fontForWeight(flatStyle?.fontWeight, theme);

  return (
    <NativeText
      {...props}
      style={[style, { fontFamily, fontWeight: 'normal' }]}
    />
  );
}
