import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useLanguage } from '../../constants/LanguageContext';
import { useTheme } from '../../constants/ThemeContext';
import { shadowStyle } from '../../constants/elevation';
import type { Theme } from '../../constants/theme';
import { PlatinumIconBadge } from './platinum-icon-badge';

export type ScreenHeaderProps = {
  title: string;
  onBackPress?: () => void;
  /** Prawa kolumna, np. przycisk plus. Pusty slot utrzymuje tytul w osi ekranu. */
  right?: React.ReactNode;
  backIconSize?: number;
  paddingTop?: number;
  /** Szerokosc lewego i prawego slotu. */
  edgeSlotWidth?: number;
};

export function ScreenHeader({
  title,
  onBackPress,
  right,
  backIconSize = 24,
  paddingTop = 52,
  edgeSlotWidth = 42,
}: ScreenHeaderProps) {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const styles = useMemo(
    () => makeStyles(theme, { paddingTop, edgeSlotWidth }),
    [theme, paddingTop, edgeSlotWidth],
  );

  const goBack = onBackPress ?? (() => router.back());

  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={goBack}
        style={[styles.edgeSlot, { width: edgeSlotWidth }]}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <PlatinumIconBadge
          icon="arrow-back"
          color={theme.accent}
          size={Math.max(14, Math.round(backIconSize * 0.62))}
          style={styles.backIconBadge}
        />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.rightWrap, { width: edgeSlotWidth }]}>
        {right ?? null}
      </View>
    </View>
  );
}

function makeStyles(
  t: Theme,
  opts: { paddingTop: number; edgeSlotWidth: number },
) {
  return StyleSheet.create({
    header: {
      backgroundColor: t.headerBg,
      paddingHorizontal: 16,
      paddingTop: opts.paddingTop,
      paddingBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.navBorder,
      ...shadowStyle(t, {
        opacity: t.name === 'light' ? 0.04 : t.shadowOpacity * 0.08,
        radius: Math.max(3, t.shadowRadius * 0.18),
        offsetY: 1,
        elevation: t.name === 'light' ? 0 : Math.max(1, t.cardElevation - 1),
      }),
    },
    edgeSlot: {
      minHeight: opts.edgeSlotWidth,
      borderRadius: 999,
      backgroundColor: t.name === 'light' ? t.surface2 : t.surface,
      borderWidth: 1,
      borderColor: t.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      fontSize: 17,
      fontWeight: '900',
      letterSpacing: 0,
      color: t.headerText,
      flex: 1,
      textAlign: 'center',
    },
    rightWrap: {
      minHeight: opts.edgeSlotWidth,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    backIconBadge: {
      width: 28,
      height: 28,
      borderRadius: 999,
    },
  });
}
