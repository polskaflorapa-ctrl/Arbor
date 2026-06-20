import { Ionicons } from '@expo/vector-icons';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Theme } from '../constants/theme';
import { absolutePhotoUrl, photoTypeLabel } from '../utils/zlecenie-detail';
import { PlatinumIconBadge } from './ui/platinum-icon-badge';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type TaskPreviewPhoto = {
  typ?: unknown;
  download_url?: string | null;
  url?: string | null;
  sciezka?: string | null;
  opis?: string | null;
  tagi?: unknown;
  data_dodania?: string | null;
  created_at?: string | null;
  lokalizacja?: string | null;
};

type Props = {
  visible: boolean;
  photo: TaskPreviewPhoto | null;
  previewCounter: string;
  previewPhotoCount: number;
  theme: Theme;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
};

export function TaskPhotoPreviewModal({
  visible,
  photo,
  previewCounter,
  previewPhotoCount,
  theme,
  onClose,
  onNavigate,
}: Props) {
  const hasManyPhotos = previewPhotoCount > 1;
  const imageUri = photo ? absolutePhotoUrl(photo.download_url || photo.url || photo.sciezka) : '';
  const tags = Array.isArray(photo?.tagi) ? photo.tagi.filter((tag) => typeof tag === 'string') : [];
  const takenAt = new Date(photo?.data_dodania || photo?.created_at || Date.now()).toLocaleString('pl-PL');

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.closeLayer} activeOpacity={1} onPress={onClose} />
        {photo ? (
          <View style={[styles.box, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: theme.text }]}>Podgląd zdjęcia</Text>
                <Text style={[styles.sub, { color: theme.textMuted }]}>
                  {photoTypeLabel(photo.typ)}
                </Text>
              </View>
              <View style={[styles.counter, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
                <Text style={[styles.counterText, { color: theme.accent }]}>{previewCounter}</Text>
              </View>
              <TouchableOpacity onPress={onClose}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 28, height: 28, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>

            <View style={styles.stage}>
              <Image source={{ uri: imageUri }} style={styles.image} />
              {hasManyPhotos ? (
                <>
                  <PreviewNavButton
                    icon="chevron-back"
                    positionStyle={styles.navPrev}
                    onPress={() => onNavigate(-1)}
                  />
                  <PreviewNavButton
                    icon="chevron-forward"
                    positionStyle={styles.navNext}
                    onPress={() => onNavigate(1)}
                  />
                </>
              ) : null}
            </View>

            <View style={styles.info}>
              {photo.opis ? (
                <Text style={[styles.description, { color: theme.text }]} selectable>
                  {photo.opis}
                </Text>
              ) : null}
              {tags.length > 0 ? (
                <Text style={[styles.meta, { color: theme.textMuted }]} selectable>
                  {tags.join(' · ')}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: theme.textMuted }]} selectable>
                {takenAt}
                {photo.lokalizacja ? ` · GPS: ${photo.lokalizacja}` : ''}
              </Text>
              {hasManyPhotos ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
                    onPress={() => onNavigate(-1)}
                  >
                    <Ionicons name="chevron-back" size={15} color={theme.textSub} />
                    <Text style={[styles.actionText, { color: theme.textSub }]}>Poprzednie</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accentLight }]}
                    onPress={() => onNavigate(1)}
                  >
                    <Text style={[styles.actionText, { color: theme.accent }]}>Następne</Text>
                    <Ionicons name="chevron-forward" size={15} color={theme.accent} />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function PreviewNavButton({
  icon,
  positionStyle,
  onPress,
}: {
  icon: IoniconName;
  positionStyle: object;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.navBtn, positionStyle]} onPress={onPress}>
      <Ionicons name={icon} size={24} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    padding: 16,
  },
  closeLayer: {
    ...StyleSheet.absoluteFill,
  },
  box: {
    borderWidth: 1,
    borderRadius: 7,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  title: { fontSize: 15, fontWeight: '900' },
  sub: { fontSize: 11, marginTop: 2 },
  counter: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  counterText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stage: {
    position: 'relative',
    backgroundColor: '#000000',
  },
  image: { width: '100%', height: 430 },
  navBtn: {
    position: 'absolute',
    top: '45%',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.44)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navPrev: { left: 10 },
  navNext: { right: 10 },
  info: { padding: 14, gap: 6 },
  description: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  meta: { fontSize: 11.5, lineHeight: 16 },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionText: { fontSize: 12, fontWeight: '900' },
});
