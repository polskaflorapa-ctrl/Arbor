import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';
import { colorWithAlpha, shadowStyle } from '../../constants/elevation';

type LoadingStateProps = {
  message?: string;
  color?: string;
  backgroundColor?: string;
};

type EmptyStateProps = {
  title: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
};

type ErrorBannerProps = {
  message: string;
};

type OfflineQueueBannerProps = {
  count: number;
  warningColor: string;
  warningBackgroundColor: string;
  borderColor: string;
};

export function LoadingState({
  message = 'Ładowanie...',
  color,
  backgroundColor,
}: LoadingStateProps) {
  const { theme } = useTheme();
  const bg = backgroundColor ?? theme.bg;
  const c = color ?? theme.accent;
  return (
    <View style={[styles.center, { backgroundColor: bg }]}>
      <ActivityIndicator size="large" color={c} />
      <Text style={[styles.loadingText, { color: theme.textSub }]}>{message}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  icon = 'folder-open-outline',
  iconColor,
}: EmptyStateProps) {
  const { theme } = useTheme();
  const ic = iconColor ?? theme.textMuted;
  return (
    <View
      style={[
        styles.emptyCard,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
        shadowStyle(theme, {
          opacity: theme.shadowOpacity * 0.18,
          radius: theme.shadowRadius * 0.45,
          offsetY: 2,
          elevation: 2,
        }),
      ]}
    >
      <View style={[styles.iconRing, { backgroundColor: colorWithAlpha(ic, 0.1), borderColor: colorWithAlpha(ic, 0.22) }]}>
        <Ionicons name={icon} size={30} color={ic} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.errorBox, { backgroundColor: theme.dangerBg, borderColor: colorWithAlpha(theme.danger, 0.38) }]}>
      <Ionicons name="warning-outline" size={16} color={theme.danger} />
      <Text style={[styles.errorText, { color: theme.danger }]}>{message}</Text>
    </View>
  );
}

export function OfflineQueueBanner({
  count,
  warningColor,
  warningBackgroundColor,
  borderColor,
}: OfflineQueueBannerProps) {
  if (count <= 0) return null;

  return (
    <View style={[styles.offlineInfo, { backgroundColor: warningBackgroundColor, borderColor }]}>
      <View style={[styles.offlineIconBox, { borderColor: warningColor + '66' }]}>
        <Ionicons name="cloud-offline-outline" size={14} color={warningColor} />
      </View>
      <Text style={[styles.offlineInfoText, { color: warningColor }]}>W kolejce offline: {count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginHorizontal: 12,
    marginVertical: 10,
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderRadius: 7,
    borderWidth: 1,
  },
  iconRing: {
    width: 52,
    height: 52,
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { fontSize: 13, fontWeight: '700' },
  title: { fontWeight: '900', fontSize: 15, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 18, textAlign: 'center', fontWeight: '700' },
  errorBox: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 10,
    margin: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  errorText: { fontSize: 13, flex: 1, fontWeight: '800', lineHeight: 18 },
  offlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  offlineIconBox: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineInfoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
});
