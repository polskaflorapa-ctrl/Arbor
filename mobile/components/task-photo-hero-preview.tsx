import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Theme } from '../constants/theme';
import { absolutePhotoUrl } from '../utils/zlecenie-detail';
import { TaskPhotoTypeBadge } from './task-photo-type-badge';

type TaskPhoto = {
  typ?: unknown;
  url?: string | null;
  sciezka?: string | null;
  opis?: string | null;
  data_dodania?: string | null;
  created_at?: string | null;
  lokalizacja?: string | null;
};

type Props = {
  photo: TaskPhoto | null;
  theme: Theme;
  onPress: (photo: TaskPhoto) => void;
};

export function TaskPhotoHeroPreview({ photo, theme, onPress }: Props) {
  if (!photo) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
        <Ionicons name="images-outline" size={22} color={theme.textMuted} />
        <Text style={[styles.emptyText, { color: theme.textMuted }]}>Brak zdjęć w tym filtrze.</Text>
      </View>
    );
  }

  const takenAt = new Date(photo.data_dodania || photo.created_at || Date.now()).toLocaleString('pl-PL');

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.surface2, borderColor: theme.border }]}
      onPress={() => onPress(photo)}
    >
      <Image source={{ uri: absolutePhotoUrl(photo.url || photo.sciezka) }} style={styles.image} />
      <View style={styles.overlay}>
        <TaskPhotoTypeBadge type={photo.typ} theme={theme} />
        <Text style={styles.open}>Podgląd</Text>
      </View>
      <View style={styles.caption}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {photo.opis || 'Bez opisu - kliknij, żeby pokazać większy podgląd.'}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
          {takenAt}
          {photo.lokalizacja ? ` · GPS: ${photo.lokalizacja}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 15,
    overflow: 'hidden',
  },
  image: { width: '100%', height: 230 },
  overlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  open: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  caption: { padding: 11, gap: 3 },
  title: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  meta: { fontSize: 10.5, lineHeight: 15 },
  empty: {
    minHeight: 132,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: { fontSize: 12, fontWeight: '800' },
});
