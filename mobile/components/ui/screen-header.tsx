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
  paddingTop = 56,
  edgeSlotWidth = 44,
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
      paddingHorizontal: 14,
      paddingTop: opts.paddingTop,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.navBorder,
      ...shadowStyle(t, {
        opacity: t.shadowOpacity * 0.08,
        radius: Math.max(4, t.shadowRadius * 0.24),
        offsetY: 1,
        elevation: Math.max(1, t.cardElevation - 1),
      }),
    },
    edgeSlot: {
      minHeight: opts.edgeSlotWidth,
      borderRadius: 14,
      backgroundColor: t.surface2,
      borderWidth: 1,
      borderColor: t.navBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      fontSize: 18,
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
      width: 30,
      height: 30,
      borderRadius: 10,
    },
  });
}
