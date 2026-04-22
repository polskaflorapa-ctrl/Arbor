import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { enqueueOfflineRequest } from '../utils/offline-queue';
import { getStoredSession } from '../utils/session';

type UploadEntry = {
  kind: 'photo' | 'video';
  label: string;
  state: 'done' | 'queued';
};

export default function OgledzinyDokumentacjaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/ogledziny');
  const { ogledzinyId, wycenaId, klient } = useLocalSearchParams<{
    ogledzinyId: string;
    wycenaId?: string;
    klient?: string;
  }>();
  const subtitleFallback = t('inspectionDoc.subtitle', { id: ogledzinyId ?? '' });

  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<UploadEntry[]>([]);

  const addHistory = (entry: UploadEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 8));
  };

  const pickPhotoAndAnnotate = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;

    if (!wycenaId) {
      void triggerHaptic('warning');
      Alert.alert(t('inspectionDoc.noQuoteTitle'), t('inspectionDoc.noQuoteBody'));
      return;
    }
    void triggerHaptic('light');
    router.push(`/wycena-rysuj?uri=${encodeURIComponent(res.assets[0].uri)}&wycenaId=${wycenaId}`);
  };

  const uploadVideo = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;

    setBusy(true);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const asset = picked.assets[0];
      const formData = new FormData();
      formData.append(
        'wideo',
        { uri: asset.uri, name: `ogledziny_${Date.now()}.mp4`, type: asset.mimeType || 'video/mp4' } as any,
      );

      const res = await fetch(`${API_URL}/ogledziny/${ogledzinyId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        void triggerHaptic('success');
        addHistory({ kind: 'video', label: t('inspectionDoc.videoSent'), state: 'done' });
        return;
      }

      await enqueueOfflineRequest({
        url: `${API_URL}/ogledziny/${ogledzinyId}/media`,
        method: 'POST',
        body: {
          typ: 'video',
          local_uri: asset.uri,
          mime: asset.mimeType || 'video/mp4',
        },
      });
      addHistory({ kind: 'video', label: t('inspectionDoc.videoQueued'), state: 'queued' });
      void triggerHaptic('warning');
    } catch {
      const uri = picked.assets[0]?.uri;
      if (uri) {
        await enqueueOfflineRequest({
          url: `${API_URL}/ogledziny/${ogledzinyId}/media`,
          method: 'POST',
          body: { typ: 'video', local_uri: uri, mime: 'video/mp4' },
        });
      }
      addHistory({ kind: 'video', label: t('inspectionDoc.videoQueued'), state: 'queued' });
      void triggerHaptic('warning');
    } finally {
      setBusy(false);
    }
  };

  const S = makeStyles(theme);

  if (!guard.ready) {
    return (
      <View style={S.root}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      </View>
    );
  }

  if (!guard.allowed) {
    return <View style={S.root} />;
  }

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <View style={S.header}>
        <TouchableOpacity
          style={S.backBtn}
          onPress={() => {
            void triggerHaptic('light');
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title}>{t('inspectionDoc.screenTitle')}</Text>
          <Text style={S.subtitle}>{(typeof klient === 'string' && klient.trim()) ? klient : subtitleFallback}</Text>
        </View>
      </View>

      <ScrollView style={S.scroll} contentContainerStyle={{ padding: 12, gap: 10 }}>
        <View style={S.card}>
          <Text style={S.cardTitle}>{t('inspectionDoc.photoCardTitle')}</Text>
          <Text style={S.cardText}>{t('inspectionDoc.photoCardBody')}</Text>
          <PlatinumCTA
            label={t('inspectionDoc.photoBtn')}
            style={S.primaryBtn}
            onPress={pickPhotoAndAnnotate}
          />
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('inspectionDoc.videoCardTitle')}</Text>
          <Text style={S.cardText}>{t('inspectionDoc.videoCardBody')}</Text>
          <PlatinumCTA
            label={t('inspectionDoc.videoBtn')}
            style={S.secondaryBtn}
            onPress={uploadVideo}
            disabled={busy}
            loading={busy}
          />
        </View>

        {!wycenaId ? (
          <View style={S.warningCard}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
            <Text style={[S.cardText, { color: theme.warning }]}>
              {t('inspectionDoc.noQuoteInline')}
            </Text>
          </View>
        ) : null}

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('inspectionDoc.historyTitle')}</Text>
          {history.length === 0 ? (
            <Text style={S.cardText}>{t('inspectionDoc.historyEmpty')}</Text>
          ) : history.map((item, idx) => (
            <View key={`${item.kind}-${idx}`} style={S.historyRow}>
              <Ionicons
                name={item.kind === 'photo' ? 'image-outline' : 'videocam-outline'}
                size={14}
                color={item.state === 'done' ? theme.success : theme.warning}
              />
              <Text style={S.historyText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    backgroundColor: t.headerBg,
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: t.headerText },
  subtitle: { fontSize: 12, color: t.headerSub },
  scroll: { flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface,
    padding: 12,
    gap: 8,
  },
  warningCard: {
    borderWidth: 1,
    borderColor: t.warning,
    borderRadius: 12,
    backgroundColor: t.warningBg,
    padding: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: t.text },
  cardText: { fontSize: 12, color: t.textSub, lineHeight: 18 },
  primaryBtn: {
    marginTop: 2,
  },
  secondaryBtn: {
    marginTop: 2,
    backgroundColor: t.surface2,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  historyText: { fontSize: 12, color: t.textSub },
});
