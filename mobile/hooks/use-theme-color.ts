/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useColorScheme } from '@/hooks/use-color-scheme';
import { themes } from '@/constants/theme';
import type { Theme } from '@/constants/theme';

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
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];
  const key = (colorName === 'background' ? 'bg' : colorName) as keyof Theme;

  if (colorFromProps) {
    return colorFromProps;
  }
  const resolved = themes[theme][key];
  return typeof resolved === 'string' ? resolved : '#000000';
}
