import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

import type { Theme } from '../constants/theme';
import type { PhotoFilterKey, PhotoGalleryFilter } from '../utils/zlecenie-detail';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  filters: PhotoGalleryFilter[];
  activeFilter: PhotoFilterKey;
  theme: Theme;
  onSelect: (filter: PhotoFilterKey) => void;
};

export function TaskPhotoFilterStrip({ filters, activeFilter, theme, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {filters.map((filter) => {
        const active = activeFilter === filter.key;
        const disabled = filter.count === 0 && filter.key !== 'all';
        return (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.chip,
              {
                borderColor: active ? filter.color : theme.border,
                backgroundColor: active ? `${filter.color}18` : theme.surface2,
                opacity: disabled ? 0.45 : 1,
              },
            ]}
            onPress={() => onSelect(filter.key)}
            disabled={disabled}
          >
            <Ionicons name={filter.icon as IoniconName} size={14} color={active ? filter.color : theme.textMuted} />
            <Text style={[styles.text, { color: active ? filter.color : theme.textSub }]} numberOfLines={1}>
              {filter.label}
            </Text>
            <Text style={[styles.count, { color: active ? filter.color : theme.textMuted }]}>
              {filter.count}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingRight: 4 },
  chip: {
    minWidth: 84,
    height: 38,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: { fontSize: 11.5, fontWeight: '900', maxWidth: 82 },
  count: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
