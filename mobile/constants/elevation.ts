import type { ViewStyle } from 'react-native';
import type { Theme } from './theme';

/** Delikatny cień karty — wartości z tokenów motywu. */
export function elevationCard(theme: Theme): ViewStyle {
  return {
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: theme.shadowOffsetY },
    shadowOpacity: theme.shadowOpacity,
    shadowRadius: theme.shadowRadius,
    elevation: theme.cardElevation,
  };
}
