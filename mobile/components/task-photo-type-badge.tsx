import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../constants/theme';
import { orderPhotoTypeMeta, photoTypeKey, photoTypeLabel } from '../utils/zlecenie-detail';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  type: unknown;
  theme: Theme;
};

export function TaskPhotoTypeBadge({ type, theme }: Props) {
  const meta = orderPhotoTypeMeta(theme)[photoTypeKey(type)];
  return (
    <View style={[styles.badge, { backgroundColor: `${theme.cardBg}EE` }]}>
      <Ionicons name={(meta?.icon || 'image-outline') as IoniconName} size={14} color={theme.accent} />
      <Text style={[styles.text, { color: theme.text }]} numberOfLines={1}>
        {photoTypeLabel(type)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    maxWidth: '70%',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  text: { fontSize: 11, fontWeight: '900' },
});
