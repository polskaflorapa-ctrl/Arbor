import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../constants/ThemeContext';

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
    <View style={styles.center}>
      <Ionicons name={icon} size={44} color={ic} />
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.errorBox, { backgroundColor: theme.dangerBg }]}>
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
    <View style={[styles.offlineInfo, { backgroundColor: warningBackgroundColor, borderBottomColor: borderColor }]}>
      <Ionicons name="cloud-offline-outline" size={14} color={warningColor} />
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
  loadingText: { fontSize: 13 },
  title: { fontWeight: '700', fontSize: 15, textAlign: 'center' },
  subtitle: { fontSize: 13, textAlign: 'center' },
  errorBox: {
    borderRadius: 10,
    padding: 12,
    margin: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  errorText: { fontSize: 13, flex: 1 },
  offlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  offlineInfoText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
