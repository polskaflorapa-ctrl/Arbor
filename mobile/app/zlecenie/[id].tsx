import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  View, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OfflineQueueBanner } from '../../components/ui/app-state';
import { KeyboardSafeScreen } from '../../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../../components/ui/platinum-cta';
import { useLanguage } from '../../constants/LanguageContext';
import { useTheme } from '../../constants/ThemeContext';
import { API_URL } from '../../constants/api';
import type { Theme } from '../../constants/theme';
import { useOddzialFeatureGuard } from '../../hooks/use-oddzial-feature-guard';
import { isFeatureEnabledForOddzial } from '../../utils/oddzial-features';
import { flushOfflineQueue, getOfflineQueueSize, queueRequestWithOfflineFallback } from '../../utils/offline-queue';
import { openAddressInMaps } from '../../utils/maps-link';
import { getStoredSession } from '../../utils/session';
import { triggerHaptic } from '../../utils/haptics';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TYP_ZDJECIA_KEYS = ['checkin', 'przed', 'po', 'inne'] as const;

function orderStatusColors(theme: Theme) {
  return {
    Nowe: theme.info,
    Zaplanowane: theme.chartViolet,
    W_Realizacji: theme.warning,
    Zakonczone: theme.success,
    Anulowane: theme.danger,
  };
}

function orderPrioColors(theme: Theme) {
  return {
    Pilny: theme.danger,
    Wysoki: theme.warning,
    Normalny: theme.info,
    Niski: theme.textMuted,
  };
}

function orderPhotoTypeMeta(theme: Theme): Record<(typeof TYP_ZDJECIA_KEYS)[number], { icon: IoniconName; color: string }> {
  return {
    checkin: { icon: 'location', color: theme.info },
    przed: { icon: 'camera', color: theme.warning },
    po: { icon: 'checkmark-circle', color: theme.success },
    inne: { icon: 'images', color: theme.chartViolet },
  };
}

export default function ZlecenieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/zlecenia');
  const statusPalette = useMemo(() => orderStatusColors(theme), [theme]);
  const prioPalette = useMemo(() => orderPrioColors(theme), [theme]);
  const photoTypeMeta = useMemo(() => orderPhotoTypeMeta(theme), [theme]);
  const [user, setUser] = useState<any>(null);
  const [zlecenie, setZlecenie] = useState<any>(null);
  const [logi, setLogi] = useState<any[]>([]);
  const [problemy, setProblemy] = useState<any[]>([]);
  const [zdjecia, setZdjecia] = useState<any[]>([]);
  const [pomocnicy, setPomocnicy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'logi' | 'problemy' | 'zdjecia'>('info');
  const [changingStatus, setChangingStatus] = useState(false);
  const [problemModal, setProblemModal] = useState(false);
  const [zdjecieModal, setZdjecieModal] = useState(false);
  const [problemForm, setProblemForm] = useState({ typ: 'usterka', opis: '' });
  const [lokalizacja, setLokalizacja] = useState<any>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  const loadAll = useCallback(async (tokenOverride?: string | null) => {
    try {
      const authToken = tokenOverride ?? token;
      if (!authToken) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${authToken}` };
      const [zRes, lRes, pRes, zdRes] = await Promise.all([
        fetch(`${API_URL}/tasks/${id}`, { headers: h }),
        fetch(`${API_URL}/tasks/${id}/logi`, { headers: h }),
        fetch(`${API_URL}/tasks/${id}/problemy`, { headers: h }),
        fetch(`${API_URL}/tasks/${id}/zdjecia`, { headers: h }),
      ]);
      if (zRes.ok) { const d = await zRes.json(); setZlecenie(d); setPomocnicy(d.pomocnicy || []); }
      if (lRes.ok) setLogi(await lRes.json());
      if (pRes.ok) setProblemy(await pRes.json());
      if (zdRes.ok) setZdjecia(await zdRes.json());
    } catch {
      Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      setOfflineQueueCount(await getOfflineQueueSize());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, token, t]);

  const init = useCallback(async () => {
    const { user: storedUser, token: storedToken } = await getStoredSession();
    if (storedUser) setUser(storedUser);
    setToken(storedToken);
    if (storedToken) {
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
    }
    await loadAll(storedToken);
  }, [loadAll]);

  useEffect(() => { void init(); }, [init]);

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const statusUi = (s: string) => {
    const keys = ['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane'];
    return keys.includes(s) ? t(`zlecenia.status.${s}`) : (s || '').replace(/_/g, ' ');
  };

  const zmienStatus = async (nowyStatus: string) => {
    Alert.alert(t('order.changeStatusTitle'), t('order.changeStatusBody', { status: statusUi(nowyStatus) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'), onPress: async () => {
          setChangingStatus(true);
          try {
            if (!token) { router.replace('/login'); return; }
            const res = await fetch(`${API_URL}/tasks/${id}/status`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: nowyStatus }),
            });
            if (res.ok) { void triggerHaptic('success'); await loadAll(); Alert.alert(t('common.ok'), t('order.statusChanged')); }
            else {
              void triggerHaptic('warning');
              const queued = await queueRequestWithOfflineFallback({
                url: `${API_URL}/tasks/${id}/status`,
                method: 'PUT',
                body: { status: nowyStatus },
              });
              setOfflineQueueCount(queued);
              Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStatusQueued'));
            }
          } catch {
            void triggerHaptic('warning');
            const queued = await queueRequestWithOfflineFallback({
              url: `${API_URL}/tasks/${id}/status`,
              method: 'PUT',
              body: { status: nowyStatus },
            });
            setOfflineQueueCount(queued);
            Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStatusQueued'));
          }
          finally { setChangingStatus(false); }
        }
      }
    ]);
  };

  const rozpocznij = async () => {
    setChangingStatus(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/tasks/${id}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) { void triggerHaptic('success'); await loadAll(); Alert.alert(t('common.ok'), t('order.startedTitle')); }
      else {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/start`,
          method: 'POST',
          body: {},
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStartQueued'));
      }
    } catch {
      void triggerHaptic('warning');
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/tasks/${id}/start`,
        method: 'POST',
        body: {},
      });
      setOfflineQueueCount(queued);
      Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStartQueued'));
    }
    finally { setChangingStatus(false); }
  };

  const zakoncz = async () => {
    Alert.alert(t('order.finishTitle'), t('order.finishConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.finish'), style: 'destructive', onPress: async () => {
          setChangingStatus(true);
          try {
            if (!token) { router.replace('/login'); return; }
            const res = await fetch(`${API_URL}/tasks/${id}/finish`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ notatki: '' }),
            });
            if (res.ok) { void triggerHaptic('success'); await loadAll(); Alert.alert(t('common.ok'), t('order.finishedTitle')); }
            else {
              void triggerHaptic('warning');
              const queued = await queueRequestWithOfflineFallback({
                url: `${API_URL}/tasks/${id}/finish`,
                method: 'POST',
                body: { notatki: '' },
              });
              setOfflineQueueCount(queued);
              Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineFinishQueued'));
            }
          } catch {
            void triggerHaptic('warning');
            const queued = await queueRequestWithOfflineFallback({
              url: `${API_URL}/tasks/${id}/finish`,
              method: 'POST',
              body: { notatki: '' },
            });
            setOfflineQueueCount(queued);
            Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineFinishQueued'));
          }
          finally { setChangingStatus(false); }
        }
      }
    ]);
  };

  const pobierzLokalizacje = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setLokalizacja(coords);
        return coords;
      }
    } catch { /* GPS opcjonalne */ }
    return null;
  };

  const zrobZdjecie = async (typ: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      void triggerHaptic('warning');
      Alert.alert(t('order.cameraDeniedTitle'), t('order.cameraDeniedBody'));
      return;
    }

    const coords = await pobierzLokalizacje();
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });

    if (!result.canceled && result.assets[0]) {
      setUploadingPhoto(true);
      try {
        if (!token) { router.replace('/login'); return; }
        const res = await fetch(`${API_URL}/tasks/${id}/zdjecia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: result.assets[0].uri,
            typ,
            lokalizacja: coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null,
          }),
        });
        if (res.ok) {
          await loadAll();
          setZdjecieModal(false);
          const typLabel = t(`order.photoType.${typ}`);
          const coordsStr = coords
            ? t('order.photoSavedCoords', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) })
            : '';
          void triggerHaptic('success');
          Alert.alert(t('order.photoSavedTitle'), t('order.photoSavedBody', { label: typLabel, coords: coordsStr }));
        } else {
          void triggerHaptic('warning');
          const queued = await queueRequestWithOfflineFallback({
            url: `${API_URL}/tasks/${id}/zdjecia`,
            method: 'POST',
            body: {
              url: result.assets[0].uri,
              typ,
              lokalizacja: coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null,
            },
          });
          setOfflineQueueCount(queued);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlinePhotoQueued'));
        }
      } catch {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/zdjecia`,
          method: 'POST',
          body: {
            url: result.assets[0].uri,
            typ,
            lokalizacja: coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null,
          },
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlinePhotoQueued'));
      }
      finally { setUploadingPhoto(false); }
    }
  };

  const checkin = async () => {
    Alert.alert(
      'Check-in u klienta',
      'Zrób zdjęcie potwierdzające przybycie na miejsce.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Zrób zdjęcie', onPress: () => zrobZdjecie('checkin') },
      ]
    );
  };

  const zglosProblem = async () => {
    if (!problemForm.opis.trim()) { void triggerHaptic('warning'); Alert.alert(t('notif.alert.errorTitle'), t('order.problemDescRequired')); return; }
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/tasks/${id}/problemy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(problemForm),
      });
      if (res.ok) {
        setProblemModal(false);
        setProblemForm({ typ: 'usterka', opis: '' });
        await loadAll();
        void triggerHaptic('success');
        Alert.alert('OK', 'Problem zgłoszony');
      } else {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/problemy`,
          method: 'POST',
          body: problemForm as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        setProblemModal(false);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineProblemQueued'));
      }
    } catch {
      void triggerHaptic('warning');
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/tasks/${id}/problemy`,
        method: 'POST',
        body: problemForm as Record<string, unknown>,
      });
      setOfflineQueueCount(queued);
      setProblemModal(false);
      Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineProblemQueued'));
    }
  };

  const isBrygadzista = user?.rola === 'Brygadzista';
  const mozeZmieniacStatus = ['Kierownik', 'Dyrektor', 'Administrator'].includes(user?.rola);
  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.center} />;
  }
  if (!guard.ready) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (loading) return (
    <View style={S.center}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );

  if (!zlecenie) return (
    <View style={S.center}>
      <Ionicons name="alert-circle-outline" size={48} color={theme.textMuted} />
      <Text style={S.notFoundTxt}>{t('order.notFound')}</Text>
      <TouchableOpacity onPress={() => router.back()} style={S.backLink}>
        <Text style={[S.backLinkTxt, { color: theme.accent }]}>{t('order.back')}</Text>
      </TouchableOpacity>
    </View>
  );

  const statusKolor = statusPalette[zlecenie.status as keyof typeof statusPalette] || theme.textMuted;
  const hasCheckin = zdjecia.some((z: any) => z.typ === 'checkin');

  // Suma godzin z logów
  const totalGodziny = logi.reduce((sum: number, l: any) => sum + (parseFloat(l.duration_hours) || 0), 0);

  return (
    <KeyboardSafeScreen style={{ flex: 1, backgroundColor: theme.bg }}>
    <View style={S.container}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* ── HEADER ── */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={S.headerCenter}>
          <Text style={S.headerTitle}>{t('order.headerTitle', { id })}</Text>
        </View>
        <View style={[S.statusBadgeH, { backgroundColor: statusKolor + '28', borderColor: statusKolor }]}>
          <Text style={[S.statusTextH, { color: statusKolor }]}>{statusUi(zlecenie.status)}</Text>
        </View>
      </View>
      <OfflineQueueBanner
        count={offlineQueueCount}
        warningColor={theme.warning}
        warningBackgroundColor={theme.warningBg}
        borderColor={theme.border}
      />

      {user && isFeatureEnabledForOddzial(user.oddzial_id, '/rezerwacje-sprzetu') ? (
        <TouchableOpacity
          style={S.linkRow}
          onPress={() => {
            const raw = zlecenie?.data_planowana;
            const d = typeof raw === 'string' ? raw.split('T')[0] : '';
            router.push({
              pathname: '/rezerwacje-sprzetu',
              params: { prefData: d || '', prefZlecenie: String(id) },
            } as never);
          }}
        >
          <Ionicons name="calendar-number-outline" size={18} color={theme.accent} />
          <Text style={[S.linkRowTxt, { color: theme.accent }]}>{t('order.linkReservations')}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      ) : null}

      {/* ── AKCJE BRYGADZISTY ── */}
      {isBrygadzista && (
        <View style={S.actionRow}>
          {/* Check-in */}
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: hasCheckin ? theme.successBg : theme.info }]}
            onPress={checkin}
          >
            <Ionicons name="location" size={16} color={hasCheckin ? theme.success : theme.accentText} />
            <Text style={[S.actionBtnTxt, { color: hasCheckin ? theme.success : theme.accentText }]}>
              {hasCheckin ? t('order.checkinDone') : t('order.checkin')}
            </Text>
          </TouchableOpacity>

          {/* Rozpocznij / Zakończ */}
          {(zlecenie.status === 'Nowe' || zlecenie.status === 'Zaplanowane') && (
            <TouchableOpacity
              style={[S.actionBtn, { backgroundColor: theme.success }]}
              onPress={rozpocznij}
              disabled={changingStatus}
            >
              {changingStatus
                ? <ActivityIndicator size="small" color={theme.accentText} />
                : <>
                  <Ionicons name="play" size={16} color={theme.accentText} />
                  <Text style={S.actionBtnTxt}>{t('order.btn.start')}</Text>
                </>
              }
            </TouchableOpacity>
          )}
          {zlecenie.status === 'W_Realizacji' && (
            <TouchableOpacity
              style={[S.actionBtn, { backgroundColor: theme.danger }]}
              onPress={zakoncz}
              disabled={changingStatus}
            >
              {changingStatus
                ? <ActivityIndicator size="small" color={theme.accentText} />
                : <>
                  <Ionicons name="checkmark" size={16} color={theme.accentText} />
                  <Text style={S.actionBtnTxt}>Zakończ</Text>
                </>
              }
            </TouchableOpacity>
          )}

          {/* Zdjęcie */}
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: theme.warning }]}
            onPress={() => setZdjecieModal(true)}
          >
            <Ionicons name="camera" size={16} color={theme.accentText} />
            <Text style={S.actionBtnTxt}>Zdjęcie</Text>
          </TouchableOpacity>

          {/* Problem */}
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: theme.chartViolet }]}
            onPress={() => setProblemModal(true)}
          >
            <Ionicons name="warning" size={16} color={theme.accentText} />
            <Text style={S.actionBtnTxt}>Problem</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── PASEK CZASU (jeśli są logi) ── */}
      {logi.length > 0 && (
        <View style={[S.timerBar, { backgroundColor: theme.surface }]}>
          <Ionicons name="time-outline" size={14} color={theme.accent} />
          <Text style={[S.timerTxt, { color: theme.textSub }]}>
            Czas pracy: <Text style={{ color: theme.accent, fontWeight: '700' }}>{totalGodziny.toFixed(1)} godz.</Text>
            {'  '}|{'  '}
            <Text style={{ color: theme.textMuted }}>{logi.length} {logi.length === 1 ? 'wpis' : 'wpisów'}</Text>
          </Text>
        </View>
      )}

      {/* ── ZMIANA STATUSU (kierownik/dyrektor) ── */}
      {mozeZmieniacStatus && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={[S.statusScroll, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}
          contentContainerStyle={S.statusScrollContent}>
          {['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane'].map(s => (
            <TouchableOpacity key={s}
              style={[
                S.statusBtn,
                { backgroundColor: theme.surface2, borderColor: theme.border },
                zlecenie.status === s && {
                  backgroundColor: statusPalette[s as keyof typeof statusPalette],
                  borderColor: statusPalette[s as keyof typeof statusPalette],
                }
              ]}
              onPress={() => s !== zlecenie.status && zmienStatus(s)}
              disabled={changingStatus || zlecenie.status === s}>
              <Text style={[S.statusBtnTxt, { color: theme.textSub }, zlecenie.status === s && { color: theme.accentText }]}>
                {s.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── TABY ── */}
      <View style={[S.tabs, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        {([
          { key: 'info',     icon: 'information-circle-outline' as IoniconName, label: 'Info' },
          { key: 'logi',     icon: 'time-outline' as IoniconName,               label: `Czas (${logi.length})` },
          { key: 'problemy', icon: 'warning-outline' as IoniconName,            label: `Problem (${problemy.length})` },
          { key: 'zdjecia',  icon: 'camera-outline' as IoniconName,             label: `Zdjęcia (${zdjecia.length})` },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[S.tab, activeTab === tab.key && { borderBottomColor: theme.accent }]}
            onPress={() => setActiveTab(tab.key as any)}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? theme.accent : theme.textMuted}
            />
            <Text style={[S.tabTxt, { color: theme.textMuted }, activeTab === tab.key && { color: theme.accent, fontWeight: '700' }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── TREŚĆ ── */}
      <ScrollView
        style={[S.content, { backgroundColor: theme.bg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {/* TAB: INFO */}
        {activeTab === 'info' && (
          <View>
            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <Ionicons name="person-circle-outline" size={18} color={theme.accent} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Klient</Text>
              </View>
              <Text style={[S.bigVal, { color: theme.text }]}>{zlecenie.klient_nazwa}</Text>
              {zlecenie.klient_telefon && (
                <View style={S.metaRow}>
                  <Ionicons name="call-outline" size={13} color={theme.textMuted} />
                  <Text style={[S.metaTxt, { color: theme.textSub }]}> {zlecenie.klient_telefon}</Text>
                </View>
              )}
              <View style={S.metaRow}>
                <Ionicons name="location-outline" size={13} color={theme.textMuted} />
                <Text style={[S.metaTxt, { color: theme.textSub }]}>
                  {' '}{zlecenie.adres}{zlecenie.miasto ? `, ${zlecenie.miasto}` : ''}
                </Text>
              </View>
              {(zlecenie.adres || zlecenie.miasto) ? (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}
                  onPress={() => { void openAddressInMaps(zlecenie.adres || '', zlecenie.miasto || ''); }}
                >
                  <Ionicons name="map-outline" size={18} color={theme.accent} />
                  <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('order.openMaps')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <Ionicons name="construct-outline" size={18} color={theme.accent} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Zlecenie</Text>
              </View>
              <InfoRow theme={theme} label="Typ usługi" val={zlecenie.typ_uslugi} />
              <View style={S.row}>
                <Text style={[S.lbl, { color: theme.textMuted }]}>Priorytet:</Text>
                <View style={[S.prioBadge, { backgroundColor: (prioPalette[zlecenie.priorytet as keyof typeof prioPalette] || theme.textMuted) + '28' }]}>
                  <Text style={[S.prioBadgeTxt, { color: prioPalette[zlecenie.priorytet as keyof typeof prioPalette] || theme.textMuted }]}>
                    {zlecenie.priorytet}
                  </Text>
                </View>
              </View>
              {zlecenie.data_planowana && <InfoRow theme={theme} label="Data" val={zlecenie.data_planowana.split('T')[0]} />}
              {!isBrygadzista && zlecenie.wartosc_planowana && (
                <View style={S.row}>
                  <Text style={[S.lbl, { color: theme.textMuted }]}>Wartość:</Text>
                  <Text style={[S.val, { color: theme.accent, fontWeight: '700' }]}>
                    {parseFloat(zlecenie.wartosc_planowana).toLocaleString('pl-PL')} PLN
                  </Text>
                </View>
              )}
              {zlecenie.opis && (
                <Text style={[S.opisTxt, { color: theme.textSub, borderTopColor: theme.border }]}>{zlecenie.opis}</Text>
              )}
            </View>

            {(zlecenie.ekipa_nazwa || zlecenie.brygadzista_nazwa) && (
              <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <View style={S.cardTitleRow}>
                  <Ionicons name="people-outline" size={18} color={theme.accent} />
                  <Text style={[S.cardTitle, { color: theme.text }]}>Ekipa</Text>
                </View>
                {zlecenie.oddzial_nazwa && <InfoRow theme={theme} label="Oddział" val={zlecenie.oddzial_nazwa} />}
                {zlecenie.ekipa_nazwa && <InfoRow theme={theme} label="Ekipa" val={zlecenie.ekipa_nazwa} />}
                {zlecenie.brygadzista_nazwa && <InfoRow theme={theme} label="Brygadzista" val={zlecenie.brygadzista_nazwa} />}
                {pomocnicy.map((p: any) => (
                  <View key={p.id} style={S.metaRow}>
                    <Ionicons name="person-outline" size={12} color={theme.textMuted} />
                    <Text style={[S.metaTxt, { color: theme.textMuted }]}> {p.imie} {p.nazwisko}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* TAB: LOGI CZASU */}
        {activeTab === 'logi' && (
          <View>
            {/* Podsumowanie */}
            {logi.length > 0 && (
              <View style={[S.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={S.summaryItem}>
                  <Ionicons name="time" size={22} color={theme.accent} />
                  <Text style={[S.summaryNum, { color: theme.accent }]}>{totalGodziny.toFixed(1)}</Text>
                  <Text style={[S.summaryLbl, { color: theme.textMuted }]}>godzin łącznie</Text>
                </View>
                <View style={[S.summaryDiv, { backgroundColor: theme.border }]} />
                <View style={S.summaryItem}>
                  <Ionicons name="list-outline" size={22} color={theme.info} />
                  <Text style={[S.summaryNum, { color: theme.info }]}>{logi.length}</Text>
                  <Text style={[S.summaryLbl, { color: theme.textMuted }]}>wpisów</Text>
                </View>
              </View>
            )}
            {logi.length === 0
              ? (
                <View style={S.empty}>
                  <Ionicons name="time-outline" size={44} color={theme.textMuted} />
                  <Text style={[S.emptyTxt, { color: theme.textMuted }]}>Brak logów pracy</Text>
                </View>
              )
              : logi.map((log: any) => (
                <View key={log.id} style={[S.logCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                  <View style={S.logTop}>
                    <View style={S.metaRow}>
                      <Ionicons name="person-outline" size={14} color={theme.accent} />
                      <Text style={[S.logPrac, { color: theme.text }]}> {log.pracownik || 'Nieznany'}</Text>
                    </View>
                    {log.duration_hours && (
                      <View style={[S.durBadge, { backgroundColor: theme.successBg }]}>
                        <Text style={[S.durTxt, { color: theme.success }]}>
                          {parseFloat(log.duration_hours).toFixed(2)} godz.
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={S.metaRow}>
                    <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
                    <Text style={[S.logTime, { color: theme.textSub }]}>
                      {' '}{new Date(log.start_time).toLocaleString('pl-PL')}
                    </Text>
                  </View>
                  {log.end_time && (
                    <View style={S.metaRow}>
                      <Ionicons name="flag-outline" size={12} color={theme.textMuted} />
                      <Text style={[S.logTime, { color: theme.textSub }]}>
                        {' '}{new Date(log.end_time).toLocaleString('pl-PL')}
                      </Text>
                    </View>
                  )}
                  {!log.end_time && (
                    <View style={S.metaRow}>
                      <Ionicons name="ellipse" size={8} color={theme.warning} />
                      <Text style={[S.logTime, { color: theme.warning }]}> W trakcie...</Text>
                    </View>
                  )}
                </View>
              ))
            }
          </View>
        )}

        {/* TAB: PROBLEMY */}
        {activeTab === 'problemy' && (
          <View>
            <TouchableOpacity
              style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => setProblemModal(true)}
            >
              <Ionicons name="add-circle-outline" size={18} color={theme.accent} />
              <Text style={[S.addBtnTxt, { color: theme.accent }]}>Zgłoś problem</Text>
            </TouchableOpacity>
            {problemy.length === 0
              ? (
                <View style={S.empty}>
                  <Ionicons name="checkmark-circle-outline" size={44} color={theme.success} />
                  <Text style={[S.emptyTxt, { color: theme.textMuted }]}>Brak problemów</Text>
                </View>
              )
              : problemy.map((p: any) => (
                <View key={p.id} style={[S.problemCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder, borderLeftColor: p.status === 'Rozwiązany' ? theme.success : theme.danger }]}>
                  <View style={S.problemTop}>
                    <Text style={[S.problemTyp, { color: theme.textSub }]}>{p.typ}</Text>
                    <View style={[S.problemBadge, { backgroundColor: (p.status === 'Rozwiązany' ? theme.success : theme.danger) + '28' }]}>
                      <Text style={[S.problemBadgeTxt, { color: p.status === 'Rozwiązany' ? theme.success : theme.danger }]}>
                        {p.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={[S.problemOpis, { color: theme.textSub }]}>{p.opis}</Text>
                  <Text style={[S.problemMeta, { color: theme.textMuted }]}>
                    {p.zglaszajacy} • {new Date(p.created_at).toLocaleDateString('pl-PL')}
                  </Text>
                </View>
              ))
            }
          </View>
        )}

        {/* TAB: ZDJĘCIA */}
        {activeTab === 'zdjecia' && (
          <View>
            <TouchableOpacity
              style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => setZdjecieModal(true)}
            >
              <Ionicons name="camera-outline" size={18} color={theme.accent} />
              <Text style={[S.addBtnTxt, { color: theme.accent }]}>{t('order.takePhotoGps')}</Text>
            </TouchableOpacity>

            {lokalizacja && (
              <View style={[S.gpsInfo, { backgroundColor: theme.successBg }]}>
                <Ionicons name="location" size={13} color={theme.success} />
                <Text style={[S.gpsTxt, { color: theme.success }]}>
                  {' '}GPS: {lokalizacja.lat.toFixed(5)}, {lokalizacja.lng.toFixed(5)}
                </Text>
              </View>
            )}

            {/* Grupuj zdjęcia wg typu */}
            {TYP_ZDJECIA_KEYS.map((key) => {
              const typ = { key, ...photoTypeMeta[key], label: t(`order.photoType.${key}`) };
              const grupa = zdjecia.filter((z: any) => z.typ === typ.key || (!z.typ && typ.key === 'inne'));
              if (grupa.length === 0) return null;
              return (
                <View key={typ.key}>
                  <View style={S.grupaTitleRow}>
                    <Ionicons name={typ.icon} size={14} color={typ.color} />
                    <Text style={[S.grupaTitle, { color: typ.color }]}>{typ.label} ({grupa.length})</Text>
                  </View>
                  <View style={S.grid}>
                    {grupa.map((z: any) => (
                      <View key={z.id} style={[S.zdjecieCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                        <Image source={{ uri: z.url }} style={S.zdjecieImg} />
                        {z.opis && <Text style={[S.zdjecieOpis, { color: theme.textSub }]}>{z.opis}</Text>}
                        <Text style={[S.zdjecieMeta, { color: theme.textMuted }]}>
                          {new Date(z.created_at).toLocaleDateString('pl-PL')}
                        </Text>
                        {z.lokalizacja && (
                          <View style={S.metaRow}>
                            <Ionicons name="location-outline" size={10} color={theme.textMuted} />
                            <Text style={[S.zdjecieGps, { color: theme.textMuted }]}> {z.lokalizacja}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}

            {zdjecia.length === 0 && (
              <View style={S.empty}>
                <Ionicons name="camera-outline" size={44} color={theme.textMuted} />
                <Text style={[S.emptyTxt, { color: theme.textMuted }]}>{t('order.noPhotos')}</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── MODAL: WYBÓR TYPU ZDJĘCIA ── */}
      <Modal visible={zdjecieModal} animationType="slide" transparent>
        <View style={S.overlay}>
          <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
            <View style={S.modalHeader}>
              <Text style={[S.modalTitle, { color: theme.text }]}>{t('order.choosePhotoType')}</Text>
              <TouchableOpacity onPress={() => setZdjecieModal(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            {TYP_ZDJECIA_KEYS.map((key) => {
              const typ = { key, ...photoTypeMeta[key], label: t(`order.photoType.${key}`) };
              return (
              <TouchableOpacity
                key={typ.key}
                style={[S.zdjecieTypBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                onPress={() => zrobZdjecie(typ.key)}
                disabled={uploadingPhoto}
              >
                <View style={[S.zdjecieTypIcon, { backgroundColor: typ.color + '22' }]}>
                  <Ionicons name={typ.icon} size={24} color={typ.color} />
                </View>
                <Text style={[S.zdjecieTypLabel, { color: theme.text }]}>{typ.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            );})}
            {uploadingPhoto && (
              <View style={S.uploadingRow}>
                <ActivityIndicator color={theme.accent} />
                <Text style={[S.uploadingTxt, { color: theme.textMuted }]}>{t('order.savingPhoto')}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── MODAL: ZGŁOŚ PROBLEM ── */}
      <Modal visible={problemModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.overlay}>
          <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
            <View style={S.modalHeader}>
              <View style={S.metaRow}>
                <Ionicons name="warning" size={20} color={theme.warning} />
                <Text style={[S.modalTitle, { color: theme.text, marginLeft: 8 }]}>Zgłoś problem</Text>
              </View>
              <TouchableOpacity onPress={() => setProblemModal(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[S.modalLbl, { color: theme.textSub }]}>Typ:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}
              contentContainerStyle={{ gap: 8 }}>
              {['usterka', 'bezpieczeństwo', 'sprzęt', 'klient', 'inne'].map(t => (
                <TouchableOpacity key={t}
                  style={[
                    S.typBtn,
                    { backgroundColor: theme.surface2, borderColor: theme.border },
                    problemForm.typ === t && { backgroundColor: theme.accent, borderColor: theme.accent }
                  ]}
                  onPress={() => setProblemForm(f => ({ ...f, typ: t }))}>
                  <Text style={[S.typBtnTxt, { color: theme.textSub }, problemForm.typ === t && { color: theme.accentText }]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[S.modalLbl, { color: theme.textSub }]}>Opis:</Text>
            <TextInput
              style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              placeholder="Opisz problem..."
              placeholderTextColor={theme.inputPlaceholder}
              value={problemForm.opis}
              onChangeText={t => setProblemForm(f => ({ ...f, opis: t }))}
              multiline
              numberOfLines={4}
            />
            <View style={S.modalBtns}>
              <TouchableOpacity
                style={[S.cancelBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                onPress={() => setProblemModal(false)}
              >
                <Text style={[S.cancelTxt, { color: theme.textSub }]}>Anuluj</Text>
              </TouchableOpacity>
                <PlatinumCTA
                  style={S.submitBtn}
                  label="Zgłoś"
                  onPress={zglosProblem}
                />
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </KeyboardSafeScreen>
  );
}

function InfoRow({ label, val, theme }: { label: string; val: string; theme: Theme }) {
  if (!val) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ fontSize: 13, color: theme.textMuted, width: 100 }}>{label}:</Text>
      <Text style={{ fontSize: 13, color: theme.text, flex: 1 }}>{val}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg, gap: 12 },
  notFoundTxt: { fontSize: 15, color: t.textMuted },
  backLink: { marginTop: 4 },
  backLinkTxt: { fontSize: 15, fontWeight: '600' },

  // Header
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 14,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1 },
  headerTitle: { color: t.headerText, fontSize: 18, fontWeight: '700' },
  statusBadgeH: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  statusTextH: { fontSize: 11, fontWeight: '700' },
  // Akcje brygadzisty
  actionRow: {
    backgroundColor: t.surface, padding: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
    flexDirection: 'row', flexWrap: 'wrap',
  },
  actionBtn: {
    flex: 1, minWidth: 80, paddingVertical: 9, paddingHorizontal: 8,
    borderRadius: 10, alignItems: 'center', flexDirection: 'row',
    justifyContent: 'center', gap: 5,
  },
  actionBtnTxt: { color: t.accentText, fontWeight: '700', fontSize: 12 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 1,
  },
  linkRowTxt: { flex: 1, fontSize: 14, fontWeight: '700' },

  // Timer bar
  timerBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  timerTxt: { fontSize: 12 },

  // Status scroll
  statusScroll: { borderBottomWidth: 1, maxHeight: 48 },
  statusScrollContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  statusBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  statusBtnTxt: { fontSize: 12, fontWeight: '500' },

  // Taby
  tabs: {
    flexDirection: 'row', borderBottomWidth: 1,
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent', gap: 2,
  },
  tabTxt: { fontSize: 9, fontWeight: '500' },

  // Treść
  content: { flex: 1, padding: 12 },

  // Karty info
  card: {
    borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.45,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  bigVal: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  metaTxt: { fontSize: 13, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  lbl: { fontSize: 13, width: 100 },
  val: { fontSize: 13, flex: 1 },
  prioBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  prioBadgeTxt: { fontSize: 11, fontWeight: '700' },
  opisTxt: { fontSize: 13, lineHeight: 20, marginTop: 10, paddingTop: 10, borderTopWidth: 1 },

  // Summary card (logi)
  summaryCard: {
    flexDirection: 'row', borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, alignItems: 'center',
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDiv: { width: 1, height: 40 },
  summaryNum: { fontSize: 24, fontWeight: '800' },
  summaryLbl: { fontSize: 11 },

  // Log cards
  logCard: {
    borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1,
  },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  logPrac: { fontSize: 14, fontWeight: '600' },
  logTime: { fontSize: 12 },
  durBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  durTxt: { fontSize: 12, fontWeight: '700' },

  // Problem cards
  problemCard: { borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderLeftWidth: 4 },
  problemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  problemTyp: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  problemBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  problemBadgeTxt: { fontSize: 11, fontWeight: '600' },
  problemOpis: { fontSize: 13, lineHeight: 18, marginBottom: 6 },
  problemMeta: { fontSize: 11 },

  // Zdjęcia
  grupaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: 4 },
  grupaTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  zdjecieCard: { width: '48%', borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  zdjecieImg: { width: '100%', height: 130 },
  zdjecieOpis: { fontSize: 12, padding: 8 },
  zdjecieMeta: { fontSize: 11, paddingHorizontal: 8, paddingBottom: 4 },
  zdjecieGps: { fontSize: 10, paddingHorizontal: 8, paddingBottom: 8 },

  // Przyciski dodaj
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1,
  },
  addBtnTxt: { fontWeight: '700', fontSize: 14 },
  gpsInfo: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, padding: 10, marginBottom: 10 },
  gpsTxt: { fontSize: 12 },

  // Empty
  empty: { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyTxt: { fontSize: 14 },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' },
  modalBox: {
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 44,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 18,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalLbl: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  modalInput: {
    borderWidth: 1, borderRadius: 10, padding: 12,
    fontSize: 14, minHeight: 90, textAlignVertical: 'top', marginBottom: 16,
  },
  typBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  typBtnTxt: { fontSize: 12 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  cancelTxt: { fontWeight: '600' },
  submitBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  // Modal zdjęcia
  zdjecieTypBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1,
  },
  zdjecieTypIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  zdjecieTypLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 8 },
  uploadingTxt: { fontSize: 13 },
});
