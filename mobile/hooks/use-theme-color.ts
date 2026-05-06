/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { themes } from '@/constants/theme';
import type { Theme } from '@/constants/theme';
import { useTheme } from '@/constants/ThemeContext';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Klucze motywu, które są kolorami (string), nie liczbami (radius, cień). */
export type ThemeColorName =
  | 'background'
  | {
      [K in keyof Theme]: Theme[K] extends string ? K : never;
    }[keyof Theme];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: ThemeColorName,
): string {
  const appearance: 'light' | 'dark' = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colorFromProps = props[appearance];
  const key = (colorName === 'background' ? 'bg' : colorName) as keyof Theme;
  const { themeName } = useTheme();

  if (colorFromProps) {
    return colorFromProps;
  }
  const resolved = themes[themeName][key];
  return typeof resolved === 'string' ? resolved : '#000000';
}
