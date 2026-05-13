import { Platform, type ViewStyle } from 'react-native';
import type { Theme } from './theme';

type ShadowStyleOptions = {
  color?: string;
  opacity?: number;
  radius?: number;
  offsetY?: number;
  elevation?: number;
};

function toRgba(color: string, opacity: number) {
  const clean = color.trim();
  if (!clean.startsWith('#')) return clean;
  const hex = clean.slice(1);
  const full = hex.length === 3
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex;
  if (full.length !== 6) return clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return clean;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

export function colorWithAlpha(color: string, opacity: number) {
  return toRgba(color, opacity);
}

export function shadowStyle(theme: Theme, options: ShadowStyleOptions = {}): ViewStyle {
  const color = options.color || theme.shadowColor;
  const opacity = options.opacity ?? theme.shadowOpacity;
  const radius = options.radius ?? theme.shadowRadius;
  const offsetY = options.offsetY ?? theme.shadowOffsetY;
  const elevation = options.elevation ?? theme.cardElevation;

  if (Platform.OS === 'web') {
    return {
      boxShadow: `0px ${Math.round(offsetY)}px ${Math.round(radius)}px ${toRgba(color, opacity)}`,
    } as ViewStyle;
  }

  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
}

export function elevationCard(theme: Theme): ViewStyle {
  return shadowStyle(theme, {
    offsetY: Math.max(1, Math.round(theme.shadowOffsetY * 0.7)),
    opacity: theme.shadowOpacity * 0.36,
    radius: theme.shadowRadius * 0.7,
    elevation: Math.max(1, Math.round(theme.cardElevation * 0.75)),
  });
}
