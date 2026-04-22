import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type KeyboardSafeScreenProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Ekrany z polami tekstowymi: iOS dostaje padding + offset statusu;
 * na Androidzie przy `softwareKeyboardLayoutMode: resize` (app.json) zostaje sam resize okna.
 */
export function KeyboardSafeScreen({ children, style }: KeyboardSafeScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
