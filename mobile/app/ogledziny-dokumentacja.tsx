import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_BASE_URL, API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { createOfflineRequestId, enqueueOfflineRequest } from '../utils/offline-queue';
import {
  DEFAULT_FIELD_PROTOCOL,
  FIELD_PROTOCOL_EQUIPMENT_OPTIONS,
  FIELD_PROTOCOL_PRESETS,
  FIELD_PROTOCOL_RESULT_OPTIONS,
  FIELD_PROTOCOL_RISK_OPTIONS,
  FIELD_PROTOCOL_WORK_OPTIONS,
  buildFieldProtocolSummary,
  mergeProtocolNotes,
  mergeUniqueProtocolValues,
  toggleProtocolValue,
  type FieldProtocolForm,
  type FieldProtocolPreset,
} from '../utils/field-protocol';
import {
  clearFieldProtocolDraft,
  loadFieldProtocolDraft,
  saveFieldProtocolDraft,
} from '../utils/field-protocol-draft';
import { triggerHaptic } from '../utils/haptics';
import { getStoredSession } from '../utils/session';

import { AppStatusBar } from '../components/ui/app-status-bar';
type UploadEntry = {
  kind: 'photo' | 'video' | 'draft';
  label: string;
  state: 'done' | 'queued';
};

type InspectionMedia = {
  id?: number | string;
  url?: string | null;
  sciezka?: string | null;
  kind?: string | null;
  mime?: string | null;
  created_at?: string | null;
};

type InspectionDetail = {
  id?: number | string;
  klient_nazwa?: string | null;
  klient_telefon?: string | null;
  adres?: string | null;
  miasto?: string | null;
  data_planowana?: string | null;
  notatki?: string | null;
  notatki_wyniki?: string | null;
  status?: string | null;
  wycena_id?: number | string | null;
  zdjecia?: InspectionMedia[];
  media?: InspectionMedia[];
};

type PhotoSource = 'camera' | 'gallery';
type VideoSource = 'camera' | 'gallery';
type EvidenceKind = 'before' | 'scope' | 'access' | 'risk';
type OfficeReadyStepKey = 'evidence' | 'protocol' | 'draft';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type ProtocolBooleanKey = 'haul' | 'stumpRemoval' | 'banner';

const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  before: 'Stan przed praca',
  scope: 'Zakres / ciecie',
  access: 'Dostep i dojazd',
  risk: 'Ryzyka',
};
const FIELD_DOC_EQUIPMENT_OPTIONS = Array.from(new Set([
  ...FIELD_PROTOCOL_EQUIPMENT_OPTIONS,
  'Rebak',
  'Wysiegnik / pila na wysiegniku',
  'Dlugie nozyce',
  'Kosiarka',
  'Kosa reczna',
  'Lopata',
  'Mulczer',
  'Arborysta',
]));
const FIELD_DOC_QUICK_TOGGLES: { key: ProtocolBooleanKey; label: string; icon: IoniconName }[] = [
  { key: 'haul', label: 'Wywoz', icon: 'car-outline' },
  { key: 'stumpRemoval', label: 'Usuwanie pni', icon: 'disc-outline' },
  { key: 'banner', label: 'Baner', icon: 'flag-outline' },
];

function paramString(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function ymd(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function hm(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function mediaUrl(item: InspectionMedia) {
  const raw = item.url || item.sciezka || '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function draftTimeLabel(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export default function OgledzinyDokumentacjaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/ogledziny');
  const { ogledzinyId, wycenaId, klient } = useLocalSearchParams<{
    ogledzinyId: string;
    wycenaId?: string;
    klient?: string;
  }>();
  const inspectionId = paramString(ogledzinyId);
  const routeQuoteId = paramString(wycenaId);
  const routeClient = paramString(klient);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadEntry[]>([]);
  const [protocol, setProtocol] = useState<FieldProtocolForm>(DEFAULT_FIELD_PROTOCOL);
  const [protocolSaving, setProtocolSaving] = useState<'draft' | 'ready' | null>(null);
  const [protocolDraftLoaded, setProtocolDraftLoaded] = useState(false);
  const [protocolDraftTouched, setProtocolDraftTouched] = useState(false);
  const [protocolDraftSavedAt, setProtocolDraftSavedAt] = useState<string | null>(null);
  const [protocolDraftRestored, setProtocolDraftRestored] = useState(false);

  const quoteId = routeQuoteId || String(detail?.wycena_id || '');
  const clientName = detail?.klient_nazwa || routeClient || t('inspectionDoc.subtitle', { id: inspectionId });
  const inspectionMedia = detail?.media || [];
  const quotePhotos = detail?.zdjecia || [];
  const inspectionPhotoCount = inspectionMedia.filter((item) => {
    const marker = String(item.kind || item.mime || '').toLowerCase();
    return marker.includes('photo') || marker.includes('image');
  }).length;
  const photoCount = quotePhotos.length + inspectionPhotoCount;
  const videoCount = inspectionMedia.filter((item) => String(item.kind || item.mime || '').toLowerCase().includes('video')).length;
  const localPhotoActions = history.filter((item) => item.kind === 'photo').length;
  const localVideoActions = history.filter((item) => item.kind === 'video').length;
  const evidencePhotoTotal = photoCount + localPhotoActions;
  const evidenceVideoTotal = videoCount + localVideoActions;
  const materialScore = [
    evidencePhotoTotal > 0,
    evidenceVideoTotal > 0,
    !!quoteId,
  ].filter(Boolean).length;
  const materials = useMemo(
    () => [
      ...(detail?.zdjecia || []).map((item) => ({ ...item, kind: item.kind || 'photo' })),
      ...(detail?.media || []),
    ].slice(0, 8),
    [detail?.media, detail?.zdjecia],
  );
  const protocolReadyChecks = [
    protocol.work.length > 0,
    protocol.equipment.length > 0,
    protocol.people.trim().length > 0,
    protocol.time.trim().length > 0,
    protocol.budget.trim().length > 0,
    protocol.result.trim().length > 0,
  ];
  const protocolReadyCount = protocolReadyChecks.filter(Boolean).length;
  const protocolSummary = useMemo(() => buildFieldProtocolSummary(protocol), [protocol]);
  const evidenceChecklist = [
    {
      key: 'before' as EvidenceKind,
      label: EVIDENCE_LABEL.before,
      hint: 'Szeroki kadr drzewa, ogrodu i otoczenia.',
      done: evidencePhotoTotal >= 1,
      icon: 'image-outline' as IoniconName,
      color: theme.accent,
    },
    {
      key: 'scope' as EvidenceKind,
      label: EVIDENCE_LABEL.scope,
      hint: 'Zaznacz galezie albo miejsce usuniecia.',
      done: evidencePhotoTotal >= 2 || protocol.work.length > 0,
      icon: 'create-outline' as IoniconName,
      color: theme.success,
    },
    {
      key: 'access' as EvidenceKind,
      label: EVIDENCE_LABEL.access,
      hint: 'Brama, parking, dojazd, miejsce na zrebke.',
      done: protocol.access.trim().length > 0,
      icon: 'map-outline' as IoniconName,
      color: theme.info,
    },
    {
      key: 'risk' as EvidenceKind,
      label: EVIDENCE_LABEL.risk,
      hint: 'Linie, dach, ogrodzenie, sasiedzi, ryzyko.',
      done: protocol.risks.length > 0 || evidenceVideoTotal > 0,
      icon: 'warning-outline' as IoniconName,
      color: theme.warning,
    },
  ];
  const evidenceReadyCount = evidenceChecklist.filter((item) => item.done).length;
  const draftAlreadyOpened = !!quoteId || history.some((item) => item.kind === 'draft');
  const officeReadySteps: {
    key: OfficeReadyStepKey;
    label: string;
    done: boolean;
    hint: string;
    icon: IoniconName;
    color: string;
  }[] = [
    {
      key: 'evidence',
      label: 'Dowody',
      done: evidenceReadyCount >= evidenceChecklist.length,
      hint: `${evidenceReadyCount}/${evidenceChecklist.length}`,
      icon: 'shield-checkmark-outline',
      color: evidenceReadyCount >= evidenceChecklist.length ? theme.success : theme.warning,
    },
    {
      key: 'protocol',
      label: 'Protokol',
      done: protocolReadyCount >= protocolReadyChecks.length,
      hint: `${protocolReadyCount}/${protocolReadyChecks.length}`,
      icon: 'document-text-outline',
      color: protocolReadyCount >= protocolReadyChecks.length ? theme.success : theme.info,
    },
    {
      key: 'draft',
      label: 'Draft',
      done: draftAlreadyOpened,
      hint: quoteId ? `#${quoteId}` : draftAlreadyOpened ? 'otwarty' : 'do biura',
      icon: 'flash-outline',
      color: draftAlreadyOpened ? theme.success : theme.accent,
    },
  ];
  const officeReadyCount = officeReadySteps.filter((item) => item.done).length;
  const officeReadyPercent = Math.round((officeReadyCount / officeReadySteps.length) * 100);
  const nextOfficeStep = officeReadySteps.find((item) => !item.done) || null;

  const addHistory = (entry: UploadEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 10));
  };

  const patchProtocol = (patch: Partial<FieldProtocolForm>) => {
    setProtocolDraftTouched(true);
    setProtocol((prev) => ({ ...prev, ...patch }));
  };

  const applyProtocolPreset = (preset: FieldProtocolPreset) => {
    setProtocolDraftTouched(true);
    setProtocol((prev) => ({
      ...prev,
      work: mergeUniqueProtocolValues(prev.work, preset.work),
      equipment: mergeUniqueProtocolValues(prev.equipment, preset.equipment),
      risks: mergeUniqueProtocolValues(prev.risks, preset.risks),
      people: preset.people || prev.people,
      time: preset.time || prev.time,
      notes: [prev.notes, preset.notes].filter(Boolean).join('\n'),
    }));
    void triggerHaptic('light');
  };

  const loadDetail = useCallback(async (soft = false) => {
    if (!inspectionId) {
      setLoading(false);
      return;
    }
    if (soft) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/ogledziny/${inspectionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDetail(data);
    } catch {
      setLoadError('Nie udało się odświeżyć materiałów oględzin.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [inspectionId]);

  useEffect(() => {
    void loadDetail(false);
  }, [loadDetail]);

  useEffect(() => {
    let active = true;
    setProtocol(DEFAULT_FIELD_PROTOCOL);
    setProtocolDraftLoaded(false);
    setProtocolDraftTouched(false);
    setProtocolDraftSavedAt(null);
    setProtocolDraftRestored(false);

    if (!inspectionId) {
      setProtocolDraftLoaded(true);
      return () => {
        active = false;
      };
    }

    loadFieldProtocolDraft(inspectionId)
      .then((draft) => {
        if (!active) return;
        if (draft) {
          setProtocol((prev) => ({ ...prev, ...draft.protocol }));
          setProtocolDraftSavedAt(draft.updatedAt);
          setProtocolDraftRestored(true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setProtocolDraftLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [inspectionId]);

  useEffect(() => {
    if (!inspectionId || !protocolDraftLoaded || !protocolDraftTouched) return;
    const handle = setTimeout(() => {
      void saveFieldProtocolDraft(inspectionId, protocol)
        .then((draft) => {
          setProtocolDraftSavedAt(draft.updatedAt);
          setProtocolDraftRestored(false);
        })
        .catch(() => undefined);
    }, 450);
    return () => clearTimeout(handle);
  }, [inspectionId, protocol, protocolDraftLoaded, protocolDraftTouched]);

  const openDraftForOffice = () => {
    void triggerHaptic('light');
    addHistory({ kind: 'draft', label: 'Otwarto szybki draft dla biura', state: 'done' });
    router.push({
      pathname: '/nowe-zlecenie' as never,
      params: {
        source: 'ogledziny-dokumentacja',
        inspectionId,
        klient: detail?.klient_nazwa || routeClient || '',
        telefon: detail?.klient_telefon || '',
        adres: detail?.adres || '',
        miasto: detail?.miasto || '',
        data: ymd(detail?.data_planowana),
        godzina: hm(detail?.data_planowana),
        notatki: [
          detail?.notatki || '',
          `Materiały z oględzin: zdjęcia ${photoCount + localPhotoActions}, wideo ${videoCount + localVideoActions}.`,
        ].filter(Boolean).join('\n'),
      },
    });
  };

  const saveProtocolForOffice = async (readyForOffice: boolean) => {
    if (!inspectionId) return;
    const savingKey = readyForOffice ? 'ready' : 'draft';
    setProtocolSaving(savingKey);
    const nextStatus = readyForOffice
      ? 'Zakonczone'
      : detail?.status === 'Zakonczone'
        ? 'Zakonczone'
        : 'W_Trakcie';
    const note = mergeProtocolNotes(detail?.notatki_wyniki, protocolSummary);
    const body = { status: nextStatus, notatki_wyniki: note };
    const requestId = createOfflineRequestId(`ogledziny-${inspectionId}-protocol-${savingKey}`);

    const queueProtocol = async () => {
      const savedDraft = await saveFieldProtocolDraft(inspectionId, protocol).catch(() => null);
      if (savedDraft) {
        setProtocolDraftSavedAt(savedDraft.updatedAt);
        setProtocolDraftTouched(false);
        setProtocolDraftRestored(false);
      }
      await enqueueOfflineRequest({
        id: requestId,
        dedupeKey: `ogledziny:${inspectionId}:protocol`,
        url: `${API_URL}/ogledziny/${inspectionId}/status`,
        method: 'PUT',
        body,
      });
      setDetail((prev) => (prev ? { ...prev, status: nextStatus, notatki_wyniki: note } : prev));
      addHistory({
        kind: 'draft',
        label: readyForOffice ? 'Protokół dla biura dodany do kolejki offline' : 'Protokół zapisany offline',
        state: 'queued',
      });
      void triggerHaptic('warning');
      Alert.alert('Zapisane offline', 'Protokół trafił do kolejki i wyśle się po powrocie internetu.');
    };

    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/ogledziny/${inspectionId}/status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': requestId,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const updated = await res.json().catch(() => null);
        setDetail((prev) => ({ ...(prev || {}), ...(updated || {}), status: nextStatus, notatki_wyniki: note }));
        addHistory({
          kind: 'draft',
          label: readyForOffice ? 'Protokół gotowy dla biura' : 'Protokół zapisany',
          state: 'done',
        });
        void triggerHaptic('success');
        setProtocolDraftTouched(false);
        if (readyForOffice) {
          await clearFieldProtocolDraft(inspectionId).catch(() => undefined);
          setProtocolDraftSavedAt(null);
          setProtocolDraftRestored(false);
        }
        Alert.alert(
          readyForOffice ? 'Gotowe dla biura' : 'Protokół zapisany',
          readyForOffice
            ? 'Biuro widzi zakres, sprzęt, ryzyka, czas i budżet z oględzin.'
            : 'Możesz dopisać szczegóły albo dodać kolejne zdjęcia.',
        );
        return;
      }

      if (res.status >= 500) {
        await queueProtocol();
        return;
      }

      void triggerHaptic('error');
      Alert.alert('Protokół', 'Nie udało się zapisać protokołu. Sprawdź dane i spróbuj ponownie.');
    } catch {
      await queueProtocol();
    } finally {
      setProtocolSaving(null);
    }
  };

  const queueInspectionMediaOffline = async (
    asset: ImagePicker.ImagePickerAsset,
    kind: 'photo' | 'video',
    evidenceKind?: EvidenceKind,
  ) => {
    const ext = kind === 'photo' ? 'jpg' : 'mp4';
    const id = createOfflineRequestId(`ogledziny-${inspectionId}-${kind}`);
    await enqueueOfflineRequest({
      id,
      url: `${API_URL}/ogledziny/${inspectionId}/media`,
      method: 'POST',
      multipart: {
        fileUri: asset.uri,
        fieldName: 'media',
        fileName: `ogledziny_${kind}_${Date.now()}.${ext}`,
        mimeType: asset.mimeType || (kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
        fields: { kind, typ: kind, evidence_kind: evidenceKind || kind },
      },
    });
  };

  const uploadPhotoEvidence = async (asset: ImagePicker.ImagePickerAsset, source: PhotoSource, evidenceKind: EvidenceKind) => {
    const { token } = await getStoredSession();
    if (!token) {
      router.replace('/login');
      return 'login' as const;
    }

    const formData = new FormData();
    formData.append('kind', 'photo');
    formData.append('typ', 'photo');
    formData.append('evidence_kind', evidenceKind);
    formData.append(
      'media',
      { uri: asset.uri, name: `ogledziny_photo_${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' } as any,
    );

    try {
      const res = await fetch(`${API_URL}/ogledziny/${inspectionId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        addHistory({ kind: 'photo', label: source === 'camera' ? 'Zdjęcie zapisane do oględzin' : 'Zdjęcie z galerii zapisane do oględzin', state: 'done' });
        await loadDetail(true);
        return 'done' as const;
      }
    } catch {
      // offline fallback below
    }

    await queueInspectionMediaOffline(asset, 'photo', evidenceKind);
    addHistory({ kind: 'photo', label: 'Zdjęcie dodane do kolejki offline', state: 'queued' });
    return 'queued' as const;
  };

  const openPhotoInSketch = async (source: PhotoSource, evidenceKind: EvidenceKind = 'before') => {
    setBusyAction(source === 'camera' ? 'photo-camera' : 'photo-gallery');
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Aparat', 'Włącz dostęp do aparatu, żeby dodać zdjęcie z oględzin.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Galeria', 'Włącz dostęp do galerii, żeby dodać zdjęcie z oględzin.');
          return;
        }
      }

      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.86 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      const asset = picked.assets[0];
      const uploadStatus = await uploadPhotoEvidence(asset, source, evidenceKind);
      if (uploadStatus === 'login') return;

      void triggerHaptic('light');
      const params = [
        `uri=${encodeURIComponent(asset.uri)}`,
        `inspectionId=${encodeURIComponent(inspectionId)}`,
        `photoKind=${encodeURIComponent(evidenceKind)}`,
        quoteId ? `wycenaId=${encodeURIComponent(quoteId)}` : '',
      ].filter(Boolean).join('&');
      router.push(`/wycena-rysuj?${params}` as never);
    } finally {
      setBusyAction(null);
    }
  };

  const addVideo = async (source: VideoSource) => {
    let selectedVideoAsset: ImagePicker.ImagePickerAsset | null = null;
    setBusyAction(source === 'camera' ? 'video-camera' : 'video-gallery');
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Kamera', 'Włącz dostęp do aparatu, żeby nagrać wideo z terenu.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Galeria', 'Włącz dostęp do galerii, żeby dodać wideo.');
          return;
        }
      }

      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.7, videoMaxDuration: 45 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.8 });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;

      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const asset = picked.assets[0];
      selectedVideoAsset = asset;
      const formData = new FormData();
      formData.append('kind', 'video');
      formData.append('typ', 'video');
      formData.append(
        'media',
        { uri: asset.uri, name: `ogledziny_${Date.now()}.mp4`, type: asset.mimeType || 'video/mp4' } as any,
      );

      const res = await fetch(`${API_URL}/ogledziny/${inspectionId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        void triggerHaptic('success');
        addHistory({ kind: 'video', label: source === 'camera' ? 'Wideo nagrane i wysłane' : 'Wideo wysłane do oględzin', state: 'done' });
        await loadDetail(true);
        return;
      }

      await queueInspectionMediaOffline(asset, 'video');
      addHistory({ kind: 'video', label: 'Wideo dodane do kolejki offline', state: 'queued' });
      void triggerHaptic('warning');
    } catch {
      if (selectedVideoAsset) {
        await queueInspectionMediaOffline(selectedVideoAsset, 'video');
        addHistory({ kind: 'video', label: 'Wideo dodane do kolejki offline', state: 'queued' });
        void triggerHaptic('warning');
        return;
      }
      void triggerHaptic('warning');
      Alert.alert('Wideo', 'Nie udało się wysłać wideo teraz. Spróbuj ponownie albo dodaj je po złapaniu internetu.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOfficeReadyAction = () => {
    void triggerHaptic('light');
    if (!nextOfficeStep) {
      void saveProtocolForOffice(true);
      return;
    }
    if (nextOfficeStep.key === 'evidence') {
      void openPhotoInSketch('camera', 'before');
      return;
    }
    if (nextOfficeStep.key === 'protocol') {
      void saveProtocolForOffice(false);
      return;
    }
    openDraftForOffice();
  };

  const S = makeStyles(theme);

  if (!guard.ready || loading) {
    return (
      <View style={S.root}>
        <View style={S.center}>
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
      <AppStatusBar />
      <View style={S.header}>
        <TouchableOpacity
          style={S.backBtn}
          onPress={() => {
            void triggerHaptic('light');
            safeBack();
          }}
        >
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="camera-outline" size={22} color={theme.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={S.headerEyebrow}>Pakiet terenowy</Text>
          <Text style={S.title}>{t('inspectionDoc.screenTitle')}</Text>
          <Text style={S.subtitle} numberOfLines={1}>{clientName}</Text>
        </View>
        <TouchableOpacity style={S.refreshBtn} onPress={() => void loadDetail(true)}>
          <Ionicons name="refresh-outline" size={18} color={theme.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={S.scroll}
        contentContainerStyle={S.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadDetail(true)} tintColor={theme.accent} />}
      >
        {loadError ? (
          <View style={S.warningCard}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
            <Text style={[S.cardText, { color: theme.warning }]}>{loadError}</Text>
          </View>
        ) : null}

        <View style={S.hero}>
          <View style={S.heroTop}>
            <View style={S.heroIcon}>
              <Ionicons name="leaf-outline" size={20} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.heroTitle}>Materiały z terenu</Text>
              <Text style={S.heroSub} numberOfLines={2}>
                {[detail?.adres, detail?.miasto].filter(Boolean).join(', ') || `Oględziny #${inspectionId}`}
              </Text>
            </View>
            <View style={S.heroScore}>
              <Text style={S.heroScoreValue}>{materialScore}/3</Text>
              <Text style={S.heroScoreLabel}>pakiet</Text>
            </View>
          </View>
          <View style={S.heroStats}>
            <StatPill icon="image-outline" label="Zdjęcia" value={photoCount + localPhotoActions} theme={theme} />
            <StatPill icon="videocam-outline" label="Wideo" value={videoCount + localVideoActions} theme={theme} />
            <StatPill icon="layers-outline" label="Wycena" value={quoteId ? 1 : 0} theme={theme} />
          </View>
        </View>

        <View style={S.officeReadyCard}>
          <View style={S.officeReadyHead}>
            <View style={S.officeReadyIcon}>
              <Ionicons name="checkmark-done-outline" size={22} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.officeReadyTitle}>Przepustka do biura</Text>
              <Text style={S.officeReadySub} numberOfLines={2}>
                Pakiet ma byc jasny dla specjalisty: dowody, protokol i draft bez przepisywania z Telegrama.
              </Text>
            </View>
            <View style={[S.officeReadyBadge, officeReadyCount === officeReadySteps.length && { backgroundColor: theme.successBg, borderColor: theme.success + '66' }]}>
              <Text style={[S.officeReadyBadgeText, officeReadyCount === officeReadySteps.length && { color: theme.success }]}>{officeReadyPercent}%</Text>
            </View>
          </View>

          <View style={S.officeReadyTrack}>
            <View style={[S.officeReadyFill, { width: `${officeReadyPercent}%` }]} />
          </View>

          <View style={S.officeReadySteps}>
            {officeReadySteps.map((item) => (
              <View
                key={item.key}
                style={[
                  S.officeReadyStep,
                  item.done && { borderColor: theme.success + '55', backgroundColor: theme.successBg },
                ]}
              >
                <View style={[S.officeReadyStepIcon, { backgroundColor: item.color + '1F' }]}>
                  <Ionicons name={item.done ? 'checkmark-circle' : item.icon} size={17} color={item.done ? theme.success : item.color} />
                </View>
                <Text style={S.officeReadyStepLabel} numberOfLines={1}>{item.label}</Text>
                <Text style={S.officeReadyStepHint} numberOfLines={1}>{item.hint}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[
              S.officeReadyCta,
              officeReadyCount === officeReadySteps.length && { backgroundColor: theme.success, borderColor: theme.success },
            ]}
            onPress={handleOfficeReadyAction}
            disabled={!!protocolSaving}
          >
            {protocolSaving ? (
              <ActivityIndicator size="small" color={theme.accentText} />
            ) : (
              <Ionicons name={nextOfficeStep ? 'arrow-forward-circle-outline' : 'send-outline'} size={18} color={theme.accentText} />
            )}
            <Text style={S.officeReadyCtaText}>
              {nextOfficeStep ? `Nastepny krok: ${nextOfficeStep.label}` : 'Wyslij pakiet do biura'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={S.evidenceCard}>
          <View style={S.evidenceHead}>
            <View style={{ flex: 1 }}>
              <Text style={S.evidenceTitle}>Pakiet dowodowy</Text>
              <Text style={S.evidenceSub}>Minimum przed praca, zakres, dostep i ryzyka dla biura oraz ekipy.</Text>
            </View>
            <View style={S.evidenceScore}>
              <Text style={S.evidenceScoreValue}>{evidenceReadyCount}/{evidenceChecklist.length}</Text>
              <Text style={S.evidenceScoreLabel}>gotowe</Text>
            </View>
          </View>
          <View style={S.evidenceList}>
            {evidenceChecklist.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[S.evidenceRow, item.done && { borderColor: theme.success + '55', backgroundColor: theme.successBg }]}
                onPress={() => void openPhotoInSketch('camera', item.key)}
              >
                <View style={[S.evidenceIcon, { backgroundColor: item.done ? theme.cardBg : item.color + '1F' }]}>
                  <Ionicons name={item.done ? 'checkmark-circle' : item.icon} size={18} color={item.done ? theme.success : item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.evidenceItemTitle}>{item.label}</Text>
                  <Text style={S.evidenceItemHint} numberOfLines={2}>{item.hint}</Text>
                </View>
                <Ionicons name="camera-outline" size={17} color={theme.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={S.quickGrid}>
          <ActionTile
            icon="camera-outline"
            label="Zdjecie przed"
            sub="zrób zdjęcie i rysuj"
            color={theme.accent}
            loading={busyAction === 'photo-camera'}
            onPress={() => void openPhotoInSketch('camera', 'before')}
            theme={theme}
          />
          <ActionTile
            icon="images-outline"
            label="Zakres ciecia"
            sub="wybierz i zaznacz"
            color={theme.info}
            loading={busyAction === 'photo-gallery'}
            onPress={() => void openPhotoInSketch('gallery', 'scope')}
            theme={theme}
          />
          <ActionTile
            icon="videocam-outline"
            label="Nagraj wideo"
            sub="do 45 sekund"
            color={theme.success}
            loading={busyAction === 'video-camera'}
            onPress={() => void addVideo('camera')}
            theme={theme}
          />
          <ActionTile
            icon="cloud-upload-outline"
            label="Wideo z galerii"
            sub="wyślij lub kolejka"
            color={theme.warning}
            loading={busyAction === 'video-gallery'}
            onPress={() => void addVideo('gallery')}
            theme={theme}
          />
        </View>

        <View style={S.protocolCard}>
          <View style={S.protocolHead}>
            <View style={{ flex: 1 }}>
              <Text style={S.protocolTitle}>Protokół u klienta</Text>
              <Text style={S.protocolSub}>Zakres, sprzęt, ryzyka i warunki dla biura.</Text>
            </View>
            {protocolDraftSavedAt ? (
              <View style={S.protocolDraftBadge}>
                <Ionicons name="phone-portrait-outline" size={12} color={theme.success} />
                <Text style={S.protocolDraftHint} numberOfLines={1}>
                  {protocolDraftRestored ? 'Kopia przywrocona' : 'Kopia zapisana'}
                  {draftTimeLabel(protocolDraftSavedAt) ? ` ${draftTimeLabel(protocolDraftSavedAt)}` : ''}
                </Text>
              </View>
            ) : null}
            <View style={S.protocolScore}>
              <Text style={S.protocolScoreValue}>{protocolReadyCount}/6</Text>
              <Text style={S.protocolScoreLabel}>gotowe</Text>
            </View>
          </View>

          <Text style={S.fieldLabel}>Szybkie presety</Text>
          <View style={S.chipWrap}>
            {FIELD_PROTOCOL_PRESETS.map((preset) => (
              <ProtocolChip
                key={preset.key}
                label={preset.label}
                active={preset.work.every((item) => protocol.work.includes(item))}
                onPress={() => applyProtocolPreset(preset)}
                theme={theme}
              />
            ))}
          </View>

          <Text style={S.fieldLabel}>Zakres prac</Text>
          <View style={S.chipWrap}>
            {FIELD_PROTOCOL_WORK_OPTIONS.map((option) => (
              <ProtocolChip
                key={option}
                label={option}
                active={protocol.work.includes(option)}
                onPress={() => patchProtocol({ work: toggleProtocolValue(protocol.work, option) })}
                theme={theme}
              />
            ))}
          </View>

          <Text style={S.fieldLabel}>Decyzje terenowe</Text>
          <View style={S.chipWrap}>
            {FIELD_DOC_QUICK_TOGGLES.map((option) => (
              <ProtocolChip
                key={option.key}
                label={option.label}
                active={Boolean(protocol[option.key])}
                onPress={() => patchProtocol({ [option.key]: !protocol[option.key] })}
                theme={theme}
              />
            ))}
          </View>

          <Text style={S.fieldLabel}>Szczegoly pracy / instrukcja dla ekipy</Text>
          <TextInput
            value={protocol.workDetails}
            onChangeText={(workDetails) => patchProtocol({ workDetails })}
            multiline
            placeholder="Np. z obu stron, sciagnac bluszcz, przyciac do linii ze zdjecia..."
            placeholderTextColor={theme.textMuted}
            style={S.textArea}
          />

          <Text style={S.fieldLabel}>Sprzęt i zasoby</Text>
          <View style={S.chipWrap}>
            {FIELD_DOC_EQUIPMENT_OPTIONS.map((option) => (
              <ProtocolChip
                key={option}
                label={option}
                active={protocol.equipment.includes(option)}
                onPress={() => patchProtocol({ equipment: toggleProtocolValue(protocol.equipment, option) })}
                theme={theme}
              />
            ))}
          </View>

          <Text style={S.fieldLabel}>Ryzyka / sprawdzić</Text>
          <View style={S.chipWrap}>
            {FIELD_PROTOCOL_RISK_OPTIONS.map((option) => (
              <ProtocolChip
                key={option}
                label={option}
                active={protocol.risks.includes(option)}
                onPress={() => patchProtocol({ risks: toggleProtocolValue(protocol.risks, option) })}
                theme={theme}
              />
            ))}
          </View>

          <View style={S.inputGrid}>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Ludzie</Text>
              <TextInput
                value={protocol.people}
                onChangeText={(people) => patchProtocol({ people })}
                keyboardType="numeric"
                placeholder="3"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Czas (h)</Text>
              <TextInput
                value={protocol.time}
                onChangeText={(time) => patchProtocol({ time })}
                keyboardType="decimal-pad"
                placeholder="2"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Budżet / cena</Text>
              <TextInput
                value={protocol.budget}
                onChangeText={(budget) => patchProtocol({ budget })}
                keyboardType="decimal-pad"
                placeholder="1000"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Rabat %</Text>
              <TextInput
                value={protocol.discount}
                onChangeText={(discount) => patchProtocol({ discount })}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
          </View>

          <View style={S.inputGrid}>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Minimalna cena</Text>
              <TextInput
                value={protocol.minPrice}
                onChangeText={(minPrice) => patchProtocol({ minPrice })}
                keyboardType="decimal-pad"
                placeholder="2200"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Cena klienta</Text>
              <TextInput
                value={protocol.acceptedPrice}
                onChangeText={(acceptedPrice) => patchProtocol({ acceptedPrice })}
                keyboardType="decimal-pad"
                placeholder="2600"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Zrebki</Text>
              <TextInput
                value={protocol.chips}
                onChangeText={(chips) => patchProtocol({ chips })}
                keyboardType="decimal-pad"
                placeholder="3"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
            <View style={S.inputCell}>
              <Text style={S.inputLabel}>Drewno</Text>
              <TextInput
                value={protocol.wood}
                onChangeText={(wood) => patchProtocol({ wood })}
                placeholder="zostaje / wywoz"
                placeholderTextColor={theme.textMuted}
                style={S.input}
              />
            </View>
          </View>

          <Text style={S.fieldLabel}>Arborysta / kto potrzebny</Text>
          <TextInput
            value={protocol.arborist}
            onChangeText={(arborist) => patchProtocol({ arborist })}
            placeholder="Np. Nazar, Wszyscy, nie"
            placeholderTextColor={theme.textMuted}
            style={S.input}
          />

          <Text style={S.fieldLabel}>Wynik rozmowy</Text>
          <View style={S.chipWrap}>
            {FIELD_PROTOCOL_RESULT_OPTIONS.map((option) => (
              <ProtocolChip
                key={option}
                label={option}
                active={protocol.result === option}
                onPress={() => patchProtocol({ result: option })}
                theme={theme}
              />
            ))}
          </View>

          <Text style={S.fieldLabel}>Dostęp / parking / uwagi posesji</Text>
          <TextInput
            value={protocol.access}
            onChangeText={(access) => patchProtocol({ access })}
            multiline
            placeholder="Np. wąska brama, auto tylko na chodniku, gałęzie odkładać przy ogrodzeniu..."
            placeholderTextColor={theme.textMuted}
            style={S.textArea}
          />

          <Text style={S.fieldLabel}>Notatki specjalisty ds. wyceny</Text>
          <TextInput
            value={protocol.notes}
            onChangeText={(notes) => patchProtocol({ notes })}
            multiline
            placeholder="Dopisz wszystko, co biuro ma wiedzieć przed dograniem terminu i zlecenia."
            placeholderTextColor={theme.textMuted}
            style={S.textArea}
          />

          <View style={S.summaryBox}>
            <Text style={S.summaryTitle}>Podgląd dla biura</Text>
            <Text style={S.summaryText} selectable>{protocolSummary}</Text>
          </View>

          <View style={S.protocolActions}>
            <TouchableOpacity
              style={[S.protocolBtn, S.protocolSecondary]}
              onPress={() => void saveProtocolForOffice(false)}
              disabled={!!protocolSaving}
            >
              {protocolSaving === 'draft' ? <ActivityIndicator size="small" color={theme.accent} /> : <Ionicons name="save-outline" size={16} color={theme.accent} />}
              <Text style={S.protocolSecondaryText}>Zapisz</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.protocolBtn, S.protocolPrimary]}
              onPress={() => void saveProtocolForOffice(true)}
              disabled={!!protocolSaving}
            >
              {protocolSaving === 'ready' ? <ActivityIndicator size="small" color={theme.accentText} /> : <Ionicons name="checkmark-done-outline" size={16} color={theme.accentText} />}
              <Text style={S.protocolPrimaryText}>Gotowe dla biura</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={S.draftCta} onPress={openDraftForOffice}>
          <View style={S.draftIcon}>
            <Ionicons name="flash-outline" size={20} color={theme.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.draftTitle}>Utwórz draft zlecenia dla biura</Text>
            <Text style={S.draftSub}>Dane klienta, adres i notatki przejdą do szybkiego formularza terenowego.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.accent} />
        </TouchableOpacity>

        {!quoteId ? (
          <View style={S.warningCard}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
            <Text style={[S.cardText, { color: theme.warning }]}>
              Te oględziny nie mają jeszcze podpiętej wyceny. Zdjęcia i szkice możesz już zapisać tutaj, a biuro później dopnie szczegóły zlecenia.
            </Text>
          </View>
        ) : null}

        <View style={S.card}>
          <View style={S.cardHead}>
            <Text style={S.cardTitle}>Materiały zapisane</Text>
            <Text style={S.cardCounter}>{materials.length}</Text>
          </View>
          {materials.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.mediaRow}>
              {materials.map((item, idx) => {
                const url = mediaUrl(item);
                const isVideo = String(item.kind || item.mime || '').includes('video');
                return (
                  <View key={`${item.id || idx}-${url}`} style={S.mediaCard}>
                    {url && !isVideo ? (
                      <Image source={{ uri: url }} style={S.mediaImage} />
                    ) : (
                      <View style={S.mediaVideo}>
                        <Ionicons name={isVideo ? 'videocam-outline' : 'image-outline'} size={22} color={theme.textMuted} />
                      </View>
                    )}
                    <Text style={S.mediaLabel}>{isVideo ? 'Wideo' : 'Zdjęcie'}</Text>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={S.emptyBox}>
              <Ionicons name="folder-open-outline" size={18} color={theme.textMuted} />
              <Text style={S.cardText}>Brak zapisanych materiałów z serwera. Dodaj zdjęcie, szkic albo wideo.</Text>
            </View>
          )}
        </View>

        <View style={S.card}>
          <View style={S.cardHead}>
            <Text style={S.cardTitle}>{t('inspectionDoc.historyTitle')}</Text>
            <Text style={S.cardCounter}>{history.length}</Text>
          </View>
          {history.length === 0 ? (
            <Text style={S.cardText}>{t('inspectionDoc.historyEmpty')}</Text>
          ) : history.map((item, idx) => (
            <View key={`${item.kind}-${idx}`} style={S.historyRow}>
              <Ionicons
                name={item.kind === 'photo' ? 'image-outline' : item.kind === 'draft' ? 'flash-outline' : 'videocam-outline'}
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

function StatPill({ icon, label, value, theme }: { icon: IoniconName; label: string; value: number; theme: Theme }) {
  return (
    <View style={[stylesShared.statPill, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
      <Ionicons name={icon} size={13} color={theme.textMuted} />
      <Text style={[stylesShared.statText, { color: theme.textSub }]}>{label}</Text>
      <Text style={[stylesShared.statValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function ActionTile({
  icon,
  label,
  sub,
  color,
  loading,
  onPress,
  theme,
}: {
  icon: IoniconName;
  label: string;
  sub: string;
  color: string;
  loading: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <TouchableOpacity style={[stylesShared.actionTile, { backgroundColor: theme.cardBg, borderColor: color + '66' }]} onPress={onPress} disabled={loading}>
      <View style={[stylesShared.actionIcon, { backgroundColor: color + '22' }]}>
        {loading ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={20} color={color} />}
      </View>
      <Text style={[stylesShared.actionLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[stylesShared.actionSub, { color: theme.textMuted }]}>{sub}</Text>
    </TouchableOpacity>
  );
}

function ProtocolChip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <TouchableOpacity
      style={[
        stylesShared.protocolChip,
        {
          backgroundColor: active ? theme.accentLight : theme.surface2,
          borderColor: active ? theme.accent : theme.border,
        },
      ]}
      onPress={onPress}
    >
      <Text style={[stylesShared.protocolChipText, { color: active ? theme.accent : theme.textSub }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const stylesShared = StyleSheet.create({
  statPill: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 3,
  },
  statText: { fontSize: 10, fontWeight: '800' },
  statValue: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  actionTile: {
    width: '48%',
    minHeight: 126,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 7,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 13, fontWeight: '900' },
  actionSub: { fontSize: 11, fontWeight: '700', lineHeight: 15 },
  protocolChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: 'center',
  },
  protocolChipText: { fontSize: 11, fontWeight: '900' },
});

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: t.cardBg,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.5,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: t.surface2,
    borderWidth: 1,
    borderColor: t.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerEyebrow: { color: t.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  title: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: t.text },
  subtitle: { fontSize: 12, color: t.textMuted, marginTop: 1, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 12, paddingBottom: 42 },
  hero: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 16,
    backgroundColor: t.surface,
    padding: 12,
    gap: 12,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  heroSub: { color: t.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  heroScore: {
    minWidth: 56,
    borderRadius: 13,
    backgroundColor: t.surface2,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  heroScoreValue: { color: t.accent, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroScoreLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  heroStats: { flexDirection: 'row', gap: 8 },
  officeReadyCard: {
    borderWidth: 1,
    borderColor: t.accent + '55',
    borderRadius: 18,
    backgroundColor: t.cardBg,
    padding: 14,
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.45,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  officeReadyHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  officeReadyIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    justifyContent: 'center',
    alignItems: 'center',
  },
  officeReadyTitle: { color: t.text, fontSize: 17, fontWeight: '900' },
  officeReadySub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2, fontWeight: '700' },
  officeReadyBadge: {
    minWidth: 58,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  officeReadyBadgeText: { color: t.accent, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeReadyTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: t.surface2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  officeReadyFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: t.accent,
  },
  officeReadySteps: { flexDirection: 'row', gap: 8 },
  officeReadyStep: {
    flex: 1,
    minHeight: 92,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    backgroundColor: t.surface2,
    padding: 9,
    gap: 5,
    alignItems: 'center',
  },
  officeReadyStepIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeReadyStepLabel: { color: t.text, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  officeReadyStepHint: { color: t.textMuted, fontSize: 10, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  officeReadyCta: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.accentDark,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  officeReadyCtaText: { color: t.accentText, fontSize: 13, fontWeight: '900' },
  evidenceCard: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 18,
    backgroundColor: t.cardBg,
    padding: 14,
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.42,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  evidenceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  evidenceTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  evidenceSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2, fontWeight: '700' },
  evidenceScore: {
    minWidth: 58,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  evidenceScoreValue: { color: t.accent, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  evidenceScoreLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  evidenceList: { gap: 8 },
  evidenceRow: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 14,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  evidenceIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  evidenceItemTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  evidenceItemHint: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  protocolCard: {
    borderWidth: 1,
    borderColor: t.accent + '55',
    borderRadius: 16,
    backgroundColor: t.surface,
    padding: 12,
    gap: 10,
  },
  protocolHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  protocolTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  protocolSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  protocolDraftBadge: {
    maxWidth: 122,
    borderWidth: 1,
    borderColor: t.success + '44',
    backgroundColor: t.successBg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  protocolDraftHint: { color: t.success, fontSize: 10, fontWeight: '900' },
  protocolScore: {
    minWidth: 58,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  protocolScoreValue: { color: t.accent, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  protocolScoreLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  fieldLabel: { color: t.text, fontSize: 12, fontWeight: '900', marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  inputCell: { width: '48%', gap: 6 },
  inputLabel: { color: t.textMuted, fontSize: 11, fontWeight: '900' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface2,
    color: t.text,
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '800',
  },
  textArea: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface2,
    color: t.text,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    textAlignVertical: 'top',
  },
  summaryBox: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    padding: 10,
    gap: 6,
  },
  summaryTitle: { color: t.text, fontSize: 12, fontWeight: '900' },
  summaryText: { color: t.textSub, fontSize: 11, lineHeight: 16 },
  protocolActions: { flexDirection: 'row', gap: 10 },
  protocolBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
  },
  protocolSecondary: { borderColor: t.accent + '55', backgroundColor: t.surface2 },
  protocolPrimary: { borderColor: t.accentDark, backgroundColor: t.accent },
  protocolSecondaryText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  protocolPrimaryText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  draftCta: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.accent + '66',
    backgroundColor: t.accentLight,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  draftIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  draftSub: { color: t.textSub, fontSize: 11, lineHeight: 16, marginTop: 2 },
  card: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    backgroundColor: t.surface,
    padding: 12,
    gap: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 14, fontWeight: '900', color: t.text },
  cardCounter: { color: t.textMuted, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cardText: { fontSize: 12, color: t.textSub, lineHeight: 18 },
  warningCard: {
    borderWidth: 1,
    borderColor: t.warning,
    borderRadius: 14,
    backgroundColor: t.warningBg,
    padding: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mediaRow: { gap: 10, paddingVertical: 2 },
  mediaCard: {
    width: 112,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    overflow: 'hidden',
  },
  mediaImage: { width: '100%', height: 82, backgroundColor: t.surface2 },
  mediaVideo: { width: '100%', height: 82, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' },
  mediaLabel: { color: t.textSub, fontSize: 11, fontWeight: '800', padding: 8 },
  emptyBox: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface2,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  historyText: { fontSize: 12, color: t.textSub, fontWeight: '700' },
});
