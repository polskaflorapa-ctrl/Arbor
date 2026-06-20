import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { Theme } from '../constants/theme';
import {
  PHOTO_TYPE_LABELS,
  TYP_ZDJECIA_KEYS,
  type PhotoTypeKey,
} from '../utils/zlecenie-detail';
import { PlatinumIconBadge, type PlatinumIconName } from './ui/platinum-icon-badge';

type PhotoTypeMeta = Record<PhotoTypeKey, { icon: PlatinumIconName; color: string }>;

type EvidenceCard = {
  type: PhotoTypeKey;
  count: number;
  hint?: string;
};

type Props = {
  visible: boolean;
  theme: Theme;
  title: string;
  opisLabel: string;
  opisPlaceholder: string;
  tagiLabel: string;
  tagiPlaceholder: string;
  savingLabel: string;
  photoOpisDraft: string;
  photoTagiDraft: string;
  uploadingPhoto: boolean;
  photoTypeMeta: PhotoTypeMeta;
  evidenceQuickCards: EvidenceCard[];
  photos: Array<{ typ?: unknown }>;
  resolvePhotoTypeLabel: (key: PhotoTypeKey) => string;
  onChangeOpis: (value: string) => void;
  onChangeTagi: (value: string) => void;
  onClose: () => void;
  onSelectType: (key: PhotoTypeKey, opis: string, tagi: string) => void;
};

export function TaskPhotoAddModal({
  visible,
  theme,
  title,
  opisLabel,
  opisPlaceholder,
  tagiLabel,
  tagiPlaceholder,
  savingLabel,
  photoOpisDraft,
  photoTagiDraft,
  uploadingPhoto,
  photoTypeMeta,
  evidenceQuickCards,
  photos,
  resolvePhotoTypeLabel,
  onChangeOpis,
  onChangeTagi,
  onClose,
  onSelectType,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.modalBox, { backgroundColor: theme.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.modalLbl, { color: theme.textSub }]}>{opisLabel}</Text>
          <TextInput
            style={[
              styles.modalInput,
              { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface2, minHeight: 72 },
            ]}
            placeholder={opisPlaceholder}
            placeholderTextColor={theme.textMuted}
            value={photoOpisDraft}
            onChangeText={onChangeOpis}
            maxLength={2000}
            multiline
            editable={!uploadingPhoto}
          />

          <Text style={[styles.modalLbl, { color: theme.textSub }]}>{tagiLabel}</Text>
          <TextInput
            style={[
              styles.modalInput,
              { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface2, minHeight: 44 },
            ]}
            placeholder={tagiPlaceholder}
            placeholderTextColor={theme.textMuted}
            value={photoTagiDraft}
            onChangeText={onChangeTagi}
            maxLength={2000}
            editable={!uploadingPhoto}
          />

          {TYP_ZDJECIA_KEYS.map((key) => {
            const meta = photoTypeMeta[key];
            const evidence = evidenceQuickCards.find((card) => card.type === key);
            const count = evidence?.count ?? photos.filter((photo) => photo.typ === key || (!photo.typ && key === 'inne')).length;
            const label = PHOTO_TYPE_LABELS[key] || resolvePhotoTypeLabel(key);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.photoTypeBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                onPress={() => onSelectType(key, photoOpisDraft, photoTagiDraft)}
                disabled={uploadingPhoto}
              >
                <View style={[styles.photoTypeIcon, { backgroundColor: `${meta.color}22` }]}>
                  <PlatinumIconBadge icon={meta.icon} color={meta.color} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.photoTypeLabel, { color: theme.text }]}>{label}</Text>
                  {evidence?.hint ? (
                    <Text style={[styles.photoTypeHint, { color: theme.textMuted }]} numberOfLines={1}>{evidence.hint}</Text>
                  ) : null}
                </View>
                <Text style={[styles.photoTypeCount, { color: count > 0 ? theme.success : theme.textMuted }]}>{count}</Text>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
              </TouchableOpacity>
            );
          })}

          {uploadingPhoto ? (
            <View style={styles.uploadingRow}>
              <ActivityIndicator color={theme.accent} />
              <Text style={[styles.uploadingText, { color: theme.textMuted }]}>{savingLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' },
  modalBox: {
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 20,
    paddingBottom: 44,
    maxHeight: '94%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalLbl: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  photoTypeBtn: {
    minHeight: 68,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoTypeIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTypeLabel: { fontSize: 15, fontWeight: '700' },
  photoTypeHint: { fontSize: 11, marginTop: 2 },
  photoTypeCount: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 8 },
  uploadingText: { fontSize: 13 },
});
