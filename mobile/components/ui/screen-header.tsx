import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useLanguage } from '../../constants/LanguageContext';
import { useTheme } from '../../constants/ThemeContext';
import type { Theme } from '../../constants/theme';
import { PlatinumIconBadge } from './platinum-icon-badge';

export type ScreenHeaderProps = {
  title: string;
  onBackPress?: () => void;
  /** Prawa kolumna (np. przycisk „+”). Gdy brak — renderowany jest pusty slot o stałej szerokości dla wyśrodkowania tytułu. */
  right?: React.ReactNode;
  backIconSize?: number;
  paddingTop?: number;
  /** Szerokość lewego/prawego slotu (strzałka w lewym). */
  edgeSlotWidth?: number;
};

export function ScreenHeader({
  title,
  onBackPress,
  right,
  backIconSize = 24,
  paddingTop = 56,
  edgeSlotWidth = 40,
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
      paddingBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: t.border + 'CC',
      shadowColor: t.shadowColor,
      shadowOpacity: t.shadowOpacity * 0.62,
      shadowRadius: t.shadowRadius * 1.05,
      shadowOffset: { width: 0, height: t.shadowOffsetY + 1 },
      elevation: t.cardElevation + 1,
    },
    edgeSlot: {
      minHeight: opts.edgeSlotWidth,
      borderRadius: 999,
      backgroundColor: t.surface2,
      borderWidth: 1,
      borderColor: t.border,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: t.shadowColor,
      shadowOpacity: t.shadowOpacity * 0.52,
      shadowRadius: t.shadowRadius * 0.95,
      shadowOffset: { width: 0, height: Math.max(1, t.shadowOffsetY - 1) },
      elevation: t.cardElevation,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: 0.5,
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
      width: 26,
      height: 26,
      borderRadius: 8,
    },
  });
}
