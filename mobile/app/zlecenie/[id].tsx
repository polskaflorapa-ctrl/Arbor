import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity,
  View, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OfflineQueueBanner } from '../../components/ui/app-state';
import { KeyboardSafeScreen } from '../../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../../components/ui/platinum-cta';
import { PlatinumIconBadge } from '../../components/ui/platinum-icon-badge';
import { useLanguage } from '../../constants/LanguageContext';
import { useTheme } from '../../constants/ThemeContext';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { API_URL, WEB_APP_URL } from '../../constants/api';
import type { Theme } from '../../constants/theme';
import { useOddzialFeatureGuard } from '../../hooks/use-oddzial-feature-guard';
import { isFeatureEnabledForOddzial } from '../../utils/oddzial-features';
import {
  flushOfflineQueue,
  getOfflineQueueSize,
  queueRequestWithOfflineFallback,
  queueTaskPhotoOffline,
} from '../../utils/offline-queue';
import { openAddressInMaps } from '../../utils/maps-link';
import { getStoredSession } from '../../utils/session';
import { triggerHaptic } from '../../utils/haptics';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TYP_ZDJECIA_KEYS = ['checkin', 'przed', 'po', 'inne'] as const;

function orderStatusColors(theme: Theme) {
  return {
    Nowe: theme.info,
    Zaplanowane: theme.info,
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
    inne: { icon: 'images', color: theme.textSub },
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
  const [photoOpisDraft, setPhotoOpisDraft] = useState('');
  const [photoTagiDraft, setPhotoTagiDraft] = useState('');
  const [problemForm, setProblemForm] = useState({ typ: 'usterka', opis: '' });
  const [lokalizacja, setLokalizacja] = useState<any>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [cmrLista, setCmrLista] = useState<any[]>([]);
  const [finishModal, setFinishModal] = useState(false);
  const [finishUsageNazwa, setFinishUsageNazwa] = useState('');
  const [finishUsageIlosc, setFinishUsageIlosc] = useState('');
  const [payForm, setPayForm] = useState({
    forma_platnosc: 'Gotowka' as 'Gotowka' | 'Przelew' | 'Faktura_VAT' | 'Brak',
    kwota_odebrana: '',
    faktura_vat: false,
    nip: '',
  });
  const [extraOpis, setExtraOpis] = useState('');
  const [quoteAmount, setQuoteAmount] = useState<Record<number, string>>({});

  const openCmrInBrowser = useCallback(async (path: string) => {
    const base = WEB_APP_URL.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${p}`;
    try {
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch {
      Alert.alert(t('notif.alert.errorTitle'), url);
    }
  }, [t]);

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
      let cmrRows: any[] = [];
      try {
        const cmrRes = await fetch(`${API_URL}/cmr?task_id=${id}`, { headers: h });
        if (cmrRes.ok) {
          const data = await cmrRes.json();
          cmrRows = Array.isArray(data) ? data : [];
        }
      } catch { /* brak CMR / sieć */ }
      setCmrLista(cmrRows);
    } catch {
      setCmrLista([]);
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
            else if (res.status >= 500) {
              void triggerHaptic('warning');
              const queued = await queueRequestWithOfflineFallback({
                url: `${API_URL}/tasks/${id}/status`,
                method: 'PUT',
                body: { status: nowyStatus },
              });
              setOfflineQueueCount(queued);
              Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStatusQueued'));
            } else {
              void triggerHaptic('warning');
              const msg = await res.text().catch(() => '');
              Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
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
      const isTeam = user?.rola === 'Brygadzista' || user?.rola === 'Pomocnik';
      let startBody: Record<string, unknown> = {};
      if (isTeam) {
        const coords = await pobierzLokalizacje();
        if (!coords) {
          void triggerHaptic('warning');
          Alert.alert(t('notif.alert.errorTitle'), t('order.startGpsRequired'));
          return;
        }
        startBody = {
          lat: coords.lat,
          lng: coords.lng,
          dmuchawa_filtr_ok: true,
          rebak_zatankowany: true,
          kaski_zespol: true,
          bhp_potwierdzone: true,
        };
      }
      const res = await fetch(`${API_URL}/tasks/${id}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(startBody),
      });
      if (res.ok) { void triggerHaptic('success'); await loadAll(); Alert.alert(t('common.ok'), t('order.startedTitle')); }
      else if (res.status >= 500) {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/start`,
          method: 'POST',
          body: startBody,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStartQueued'));
      } else {
        void triggerHaptic('warning');
        const msg = await res.text().catch(() => '');
        Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
      }
    } catch {
      void triggerHaptic('warning');
      const isTeam = user?.rola === 'Brygadzista' || user?.rola === 'Pomocnik';
      const coords = isTeam ? await pobierzLokalizacje().catch(() => null) : null;
      const startBody = isTeam && coords
        ? {
            lat: coords.lat,
            lng: coords.lng,
            dmuchawa_filtr_ok: true,
            rebak_zatankowany: true,
            kaski_zespol: true,
            bhp_potwierdzone: true,
          }
        : {};
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/tasks/${id}/start`,
        method: 'POST',
        body: startBody,
      });
      setOfflineQueueCount(queued);
      Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStartQueued'));
    }
    finally { setChangingStatus(false); }
  };

  /** M3 F3.9 — ekran płatności przed zakończeniem (ekipa). */
  const zakoncz = () => {
    void triggerHaptic('light');
    setFinishModal(true);
  };

  const submitFinish = async () => {
    const { forma_platnosc, kwota_odebrana, faktura_vat, nip } = payForm;
    if (forma_platnosc === 'Gotowka') {
      const k = parseFloat(String(kwota_odebrana).replace(',', '.'));
      if (!Number.isFinite(k) || k < 0) {
        Alert.alert('Uwaga', 'Podaj kwotę odebraną (gotówka).');
        return;
      }
    }
    if (faktura_vat || forma_platnosc === 'Faktura_VAT') {
      const n = String(nip || '').replace(/\s/g, '');
      if (n.length < 10) {
        Alert.alert('Uwaga', 'Podaj NIP przy fakturze VAT.');
        return;
      }
    }
    if (!token) { router.replace('/login'); return; }
    setChangingStatus(true);
    let finishBody: Record<string, unknown> | null = null;
    try {
      const coords = await pobierzLokalizacje();
      const usageNazwa = finishUsageNazwa.trim();
      const usageIloscRaw = finishUsageIlosc.trim().replace(',', '.');
      const usageIlosc = usageNazwa && usageIloscRaw ? parseFloat(usageIloscRaw) : NaN;
      const zuzyte_materialy =
        usageNazwa.length > 0
          ? [
              {
                nazwa: usageNazwa.slice(0, 200),
                ...(Number.isFinite(usageIlosc) ? { ilosc: usageIlosc, jednostka: 'szt' } : {}),
              },
            ]
          : undefined;
      finishBody = {
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        notatki: '',
        ...(zuzyte_materialy ? { zuzyte_materialy } : {}),
        payment: {
          forma_platnosc,
          kwota_odebrana: forma_platnosc === 'Gotowka' ? parseFloat(String(kwota_odebrana).replace(',', '.')) : null,
          faktura_vat: !!faktura_vat,
          nip: nip || null,
        },
      };
      const res = await fetch(`${API_URL}/tasks/${id}/finish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(finishBody),
      });
      if (res.ok) {
        void triggerHaptic('success');
        setFinishModal(false);
        await loadAll();
        Alert.alert(t('common.ok'), t('order.finishedTitle'));
      } else if (res.status >= 500) {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/finish`,
          method: 'POST',
          body: finishBody,
        });
        setOfflineQueueCount(queued);
        setFinishModal(false);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineFinishQueued'));
      } else {
        const j = await res.json().catch(() => ({}));
        void triggerHaptic('warning');
        Alert.alert(t('notif.alert.errorTitle'), (j as { error?: string }).error || `HTTP ${res.status}`);
      }
    } catch {
      void triggerHaptic('warning');
      if (finishBody) {
        try {
          const queued = await queueRequestWithOfflineFallback({
            url: `${API_URL}/tasks/${id}/finish`,
            method: 'POST',
            body: finishBody,
          });
          setOfflineQueueCount(queued);
          setFinishModal(false);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineFinishQueued'));
        } catch {
          Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
        }
      } else {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    } finally {
      setChangingStatus(false);
    }
  };

  const submitExtraWork = async () => {
    if (!extraOpis.trim() || !token) return;
    const body = { opis: extraOpis.trim() };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setExtraOpis('');
        await loadAll();
        Alert.alert('OK', 'Praca dodatkowa zgłoszona do wyceny.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraWorkQueued'));
      } else {
        const txt = await res.text();
        Alert.alert(t('notif.alert.errorTitle'), txt.slice(0, 200));
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraWorkQueued'));
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
  };

  const quoteExtraWork = async (ewId: number) => {
    if (!token) return;
    const raw = quoteAmount[ewId];
    const amt = parseFloat(String(raw || '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Uwaga', 'Podaj kwotę w PLN.');
      return;
    }
    const body = { amount_pln: amt };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work/${ewId}/quote`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadAll();
        Alert.alert('OK', 'Wycena przesłana do ekipy.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/quote`,
          method: 'PATCH',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraQuoteQueued'));
      } else {
        Alert.alert(t('notif.alert.errorTitle'), await res.text());
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/quote`,
          method: 'PATCH',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraQuoteQueued'));
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
  };

  const acceptExtraWork = async (ewId: number) => {
    if (!token) return;
    const body = { channel: 'na_miejscu' };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work/${ewId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadAll();
        Alert.alert('OK', 'Zaakceptowano — kwota dopisana do zlecenia.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/accept`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraAcceptQueued'));
      } else {
        Alert.alert(t('notif.alert.errorTitle'), await res.text());
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/accept`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraAcceptQueued'));
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
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

  const zrobZdjecie = async (typ: string, opisNote?: string, tagiNote?: string) => {
    const opisTrimmed = (opisNote ?? '').trim().slice(0, 4000);
    const tagiTrimmed = (tagiNote ?? '').trim().slice(0, 2000);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      void triggerHaptic('warning');
      Alert.alert(t('order.cameraDeniedTitle'), t('order.cameraDeniedBody'));
      return;
    }

    const coords = await pobierzLokalizacje();
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setUploadingPhoto(true);
      try {
        if (!token) { router.replace('/login'); return; }
        const form = new FormData();
        form.append('typ', typ);
        form.append('zdjecie', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
        if (coords) {
          form.append('lat', String(coords.lat));
          form.append('lon', String(coords.lng));
        }
        if (opisTrimmed) form.append('opis', opisTrimmed);
        if (tagiTrimmed) form.append('tagi', tagiTrimmed);
        const res = await fetch(`${API_URL}/tasks/${id}/zdjecia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (res.ok) {
          await loadAll();
          setPhotoOpisDraft('');
          setPhotoTagiDraft('');
          setZdjecieModal(false);
          const typLabel = t(`order.photoType.${typ}`);
          const coordsStr = coords
            ? t('order.photoSavedCoords', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) })
            : '';
          void triggerHaptic('success');
          Alert.alert(t('order.photoSavedTitle'), t('order.photoSavedBody', { label: typLabel, coords: coordsStr }));
        } else if (res.status >= 500) {
          void triggerHaptic('warning');
          const n = await queueTaskPhotoOffline({
            url: `${API_URL}/tasks/${id}/zdjecia`,
            fileUri: uri,
            typ,
            lat: coords?.lat,
            lng: coords?.lng,
            opis: opisTrimmed || undefined,
            tagi: tagiTrimmed || undefined,
          });
          setOfflineQueueCount(n);
          setPhotoOpisDraft('');
          setPhotoTagiDraft('');
          setZdjecieModal(false);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlinePhotoQueued'));
        } else {
          void triggerHaptic('warning');
          const msg = await res.text().catch(() => '');
          Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
        }
      } catch {
        void triggerHaptic('warning');
        try {
          const n = await queueTaskPhotoOffline({
            url: `${API_URL}/tasks/${id}/zdjecia`,
            fileUri: uri,
            typ,
            lat: coords?.lat,
            lng: coords?.lng,
            opis: opisTrimmed || undefined,
            tagi: tagiTrimmed || undefined,
          });
          setOfflineQueueCount(n);
          setPhotoOpisDraft('');
          setPhotoTagiDraft('');
          setZdjecieModal(false);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlinePhotoQueued'));
        } catch {
          Alert.alert(t('notif.alert.errorTitle'), t('order.photoUploadFail'));
        }
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
      } else if (res.status >= 500) {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/problemy`,
          method: 'POST',
          body: problemForm as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        setProblemModal(false);
        setProblemForm({ typ: 'usterka', opis: '' });
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineProblemQueued'));
      } else {
        void triggerHaptic('warning');
        const msg = await res.text().catch(() => '');
        Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
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
      setProblemForm({ typ: 'usterka', opis: '' });
      Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineProblemQueued'));
    }
  };

  const isBrygadzista = user?.rola === 'Brygadzista';
  const isEkipa = user?.rola === 'Brygadzista' || user?.rola === 'Pomocnik';
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
      <PlatinumIconBadge icon="alert-circle-outline" color={theme.textMuted} size={20} style={{ width: 48, height: 48, borderRadius: 14 }} />
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
          <PlatinumIconBadge icon="arrow-back" color={theme.headerText} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
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
          <PlatinumIconBadge icon="calendar-number-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
          <Text style={[S.linkRowTxt, { color: theme.accent }]}>{t('order.linkReservations')}</Text>
          <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
        </TouchableOpacity>
      ) : null}

      {/* ── AKCJE EKIPY (brygadzista / pomocnik) ── */}
      {isEkipa && (
        <View style={S.actionRow}>
          {/* Check-in */}
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: hasCheckin ? theme.successBg : theme.info }]}
            onPress={checkin}
          >
            <PlatinumIconBadge
              icon="location"
              color={hasCheckin ? theme.success : theme.accentText}
              size={10}
              style={{ width: 22, height: 22, borderRadius: 7 }}
            />
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
                  <PlatinumIconBadge icon="play" color={theme.accentText} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
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
                  <PlatinumIconBadge icon="checkmark" color={theme.accentText} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={S.actionBtnTxt}>Zakończ</Text>
                </>
              }
            </TouchableOpacity>
          )}

          {/* Zdjęcie */}
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: theme.warning }]}
            onPress={() => {
              void triggerHaptic('light');
              setZdjecieModal(true);
            }}
          >
            <PlatinumIconBadge icon="camera" color={theme.accentText} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
            <Text style={S.actionBtnTxt}>Zdjęcie</Text>
          </TouchableOpacity>

          {/* Problem (cyan — odróżnienie od „Zakończ” = danger) */}
          <TouchableOpacity
            style={[S.actionBtn, { backgroundColor: theme.chartCyan }]}
            onPress={() => {
              void triggerHaptic('light');
              setProblemModal(true);
            }}
          >
            <PlatinumIconBadge icon="warning" color={theme.accentText} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
            <Text style={S.actionBtnTxt}>Problem</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* M3 F3.10 — praca dodatkowa (zgłoszenie + akceptacja na miejscu) */}
      {isEkipa && zlecenie.status === 'W_Realizacji' ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 6 }}>Praca dodatkowa</Text>
          <TextInput
            style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText, marginBottom: 8 }]}
            placeholder="Opis pracy do wyceny przez wyceniającego..."
            placeholderTextColor={theme.inputPlaceholder}
            value={extraOpis}
            onChangeText={setExtraOpis}
            multiline
          />
          <TouchableOpacity
            style={{ alignSelf: 'flex-start', backgroundColor: theme.accentSoft, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }}
            onPress={() => void submitExtraWork()}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>Zgłoś do wyceny</Text>
          </TouchableOpacity>
          {Array.isArray(zlecenie.extra_work) && zlecenie.extra_work.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              {zlecenie.extra_work.map((ew: any) => (
                <View key={ew.id} style={{ padding: 10, marginTop: 8, borderRadius: 10, backgroundColor: theme.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>#{ew.id} · {ew.status}</Text>
                  <Text style={{ color: theme.text, marginTop: 4 }}>{ew.opis}</Text>
                  {ew.amount_pln != null ? <Text style={{ color: theme.accent, marginTop: 4 }}>{Number(ew.amount_pln).toFixed(2)} PLN</Text> : null}
                  {ew.status === 'Wycenione' ? (
                    <TouchableOpacity style={{ marginTop: 8, alignSelf: 'flex-start' }} onPress={() => void acceptExtraWork(ew.id)}>
                      <Text style={{ color: theme.success, fontWeight: '700' }}>Akceptuj u klienta</Text>
                    </TouchableOpacity>
                  ) : null}
                  {user?.rola === 'Wyceniający' && Number(zlecenie.wyceniajacy_id) === Number(user?.id) && ew.status === 'OczekujeWyceny' ? (
                    <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        style={[S.modalInput, { flex: 1, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                        placeholder="Kwota PLN"
                        placeholderTextColor={theme.inputPlaceholder}
                        keyboardType="decimal-pad"
                        value={quoteAmount[ew.id] || ''}
                        onChangeText={(v) => setQuoteAmount((m) => ({ ...m, [ew.id]: v }))}
                      />
                      <TouchableOpacity onPress={() => void quoteExtraWork(ew.id)}>
                        <Text style={{ color: theme.accent, fontWeight: '700' }}>Wyceniaj</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {user?.rola === 'Wyceniający' && Number(zlecenie?.wyceniajacy_id) === Number(user?.id) && zlecenie.status === 'W_Realizacji' && Array.isArray(zlecenie.extra_work) && zlecenie.extra_work.some((x: any) => x.status === 'OczekujeWyceny') ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
          <Text style={{ color: theme.warning, fontSize: 13 }}>Masz prace dodatkowe do wyceny na tym zleceniu.</Text>
        </View>
      ) : null}

      {/* ── PASEK CZASU (jeśli są logi) ── */}
      {logi.length > 0 && (
        <View style={[S.timerBar, { backgroundColor: theme.surface }]}>
          <PlatinumIconBadge icon="time-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
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
            onPress={() => {
              void triggerHaptic('light');
              setActiveTab(tab.key as any);
            }}
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
                <PlatinumIconBadge icon="person-circle-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Klient</Text>
              </View>
              <Text style={[S.bigVal, { color: theme.text }]}>{zlecenie.klient_nazwa}</Text>
              {zlecenie.klient_telefon && (
                <View style={S.metaRow}>
                  <PlatinumIconBadge icon="call-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.metaTxt, { color: theme.textSub }]}> {zlecenie.klient_telefon}</Text>
                </View>
              )}
              <View style={S.metaRow}>
                <PlatinumIconBadge icon="location-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                <Text style={[S.metaTxt, { color: theme.textSub }]}>
                  {' '}{zlecenie.adres}{zlecenie.miasto ? `, ${zlecenie.miasto}` : ''}
                </Text>
              </View>
              {(zlecenie.adres || zlecenie.miasto) ? (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}
                  onPress={() => { void openAddressInMaps(zlecenie.adres || '', zlecenie.miasto || ''); }}
                >
                  <PlatinumIconBadge icon="map-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('order.openMaps')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="construct-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
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

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="document-text-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>{t('order.cmrTitle')}</Text>
              </View>
              <Text style={[S.metaTxt, { color: theme.textMuted, marginBottom: 10 }]}>{t('order.cmrHint')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <TouchableOpacity
                  style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 0, flex: 0 }]}
                  onPress={() => { void triggerHaptic('light'); void openCmrInBrowser(`/cmr/nowy?zlecenie=${id}`); }}
                >
                  <PlatinumIconBadge icon="add-circle-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.addBtnTxt, { color: theme.accent }]}>{t('order.cmrNewWeb')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 0, flex: 0 }]}
                  onPress={() => { void triggerHaptic('light'); void openCmrInBrowser(`/cmr?task_id=${id}`); }}
                >
                  <PlatinumIconBadge icon="list-outline" color={theme.info} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.addBtnTxt, { color: theme.info }]}>{t('order.cmrListForTaskWeb')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 0, flex: 0 }]}
                  onPress={() => { void triggerHaptic('light'); void openCmrInBrowser('/cmr'); }}
                >
                  <PlatinumIconBadge icon="albums-outline" color={theme.textSub} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.addBtnTxt, { color: theme.textSub }]}>{t('order.cmrFullRegistryWeb')}</Text>
                </TouchableOpacity>
              </View>
              {cmrLista.length === 0 ? (
                <Text style={[S.metaTxt, { color: theme.textMuted }]}>{t('order.cmrEmpty')}</Text>
              ) : (
                cmrLista.map((c: any) => (
                  <TouchableOpacity
                    key={c.id}
                    style={{ paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}
                    onPress={() => { void triggerHaptic('light'); void openCmrInBrowser(`/cmr/${c.id}?task_id=${id}`); }}
                  >
                    <Text style={{ color: theme.accent, fontWeight: '600' }}>{c.numer || `CMR #${c.id}`}</Text>
                    {c.status ? <Text style={[S.metaTxt, { color: theme.textMuted }]}>{c.status}</Text> : null}
                  </TouchableOpacity>
                ))
              )}
            </View>

            {(zlecenie.ekipa_nazwa || zlecenie.brygadzista_nazwa) && (
              <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <View style={S.cardTitleRow}>
                  <PlatinumIconBadge icon="people-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.cardTitle, { color: theme.text }]}>Ekipa</Text>
                </View>
                {zlecenie.oddzial_nazwa && <InfoRow theme={theme} label="Oddział" val={zlecenie.oddzial_nazwa} />}
                {zlecenie.ekipa_nazwa && <InfoRow theme={theme} label="Ekipa" val={zlecenie.ekipa_nazwa} />}
                {zlecenie.brygadzista_nazwa && <InfoRow theme={theme} label="Brygadzista" val={zlecenie.brygadzista_nazwa} />}
                {pomocnicy.map((p: any) => (
                  <View key={p.id} style={S.metaRow}>
                    <PlatinumIconBadge icon="person-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
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
                  <PlatinumIconBadge icon="time" color={theme.accent} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.summaryNum, { color: theme.accent }]}>{totalGodziny.toFixed(1)}</Text>
                  <Text style={[S.summaryLbl, { color: theme.textMuted }]}>godzin łącznie</Text>
                </View>
                <View style={[S.summaryDiv, { backgroundColor: theme.border }]} />
                <View style={S.summaryItem}>
                  <PlatinumIconBadge icon="list-outline" color={theme.info} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.summaryNum, { color: theme.info }]}>{logi.length}</Text>
                  <Text style={[S.summaryLbl, { color: theme.textMuted }]}>wpisów</Text>
                </View>
              </View>
            )}
            {logi.length === 0
              ? (
                <View style={S.empty}>
                  <PlatinumIconBadge icon="time-outline" color={theme.textMuted} size={18} style={{ width: 44, height: 44, borderRadius: 12 }} />
                  <Text style={[S.emptyTxt, { color: theme.textMuted }]}>Brak logów pracy</Text>
                </View>
              )
              : logi.map((log: any) => (
                <View key={log.id} style={[S.logCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                  <View style={S.logTop}>
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="person-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
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
                    <PlatinumIconBadge icon="calendar-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.logTime, { color: theme.textSub }]}>
                      {' '}{new Date(log.start_time).toLocaleString('pl-PL')}
                    </Text>
                  </View>
                  {log.end_time && (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="flag-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      <Text style={[S.logTime, { color: theme.textSub }]}>
                        {' '}{new Date(log.end_time).toLocaleString('pl-PL')}
                      </Text>
                    </View>
                  )}
                  {!log.end_time && (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="ellipse" color={theme.warning} size={6} style={{ width: 16, height: 16, borderRadius: 5 }} />
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
              onPress={() => {
                void triggerHaptic('light');
                setProblemModal(true);
              }}
            >
              <PlatinumIconBadge icon="add-circle-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
              <Text style={[S.addBtnTxt, { color: theme.accent }]}>Zgłoś problem</Text>
            </TouchableOpacity>
            {problemy.length === 0
              ? (
                <View style={S.empty}>
                  <PlatinumIconBadge icon="checkmark-circle-outline" color={theme.success} size={18} style={{ width: 44, height: 44, borderRadius: 12 }} />
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
              onPress={() => {
                void triggerHaptic('light');
                setZdjecieModal(true);
              }}
            >
              <PlatinumIconBadge icon="camera-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
              <Text style={[S.addBtnTxt, { color: theme.accent }]}>{t('order.takePhotoGps')}</Text>
            </TouchableOpacity>

            {lokalizacja && (
              <View style={[S.gpsInfo, { backgroundColor: theme.successBg }]}>
                <PlatinumIconBadge icon="location" color={theme.success} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
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
                    <PlatinumIconBadge icon={typ.icon} color={typ.color} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.grupaTitle, { color: typ.color }]}>{typ.label} ({grupa.length})</Text>
                  </View>
                  <View style={S.grid}>
                    {grupa.map((z: any) => (
                      <View key={z.id} style={[S.zdjecieCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                        <Image source={{ uri: z.url }} style={S.zdjecieImg} />
                        {z.opis && <Text style={[S.zdjecieOpis, { color: theme.textSub }]}>{z.opis}</Text>}
                        {Array.isArray(z.tagi) && z.tagi.length > 0 ? (
                          <Text style={[S.zdjecieOpis, { color: theme.textMuted, fontSize: 11 }]} numberOfLines={2}>
                            {z.tagi.join(' · ')}
                          </Text>
                        ) : null}
                        <Text style={[S.zdjecieMeta, { color: theme.textMuted }]}>
                          {new Date(z.data_dodania || z.created_at || Date.now()).toLocaleDateString('pl-PL')}
                        </Text>
                        {z.lokalizacja && (
                          <View style={S.metaRow}>
                            <PlatinumIconBadge icon="location-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
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
                <PlatinumIconBadge icon="camera-outline" color={theme.textMuted} size={18} style={{ width: 44, height: 44, borderRadius: 12 }} />
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
              <TouchableOpacity
                onPress={() => {
                  setPhotoOpisDraft('');
                  setPhotoTagiDraft('');
                  setZdjecieModal(false);
                }}
              >
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>
            <Text style={[S.modalLbl, { color: theme.textSub }]}>{t('order.photoOpisLabel')}</Text>
            <TextInput
              style={[S.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface2, minHeight: 72, marginBottom: 12 }]}
              placeholder={t('order.photoOpisPlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={photoOpisDraft}
              onChangeText={setPhotoOpisDraft}
              maxLength={2000}
              multiline
              editable={!uploadingPhoto}
            />
            <Text style={[S.modalLbl, { color: theme.textSub }]}>{t('order.photoTagiLabel')}</Text>
            <TextInput
              style={[S.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface2, minHeight: 44, marginBottom: 12 }]}
              placeholder={t('order.photoTagiPlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={photoTagiDraft}
              onChangeText={setPhotoTagiDraft}
              maxLength={2000}
              editable={!uploadingPhoto}
            />
            {TYP_ZDJECIA_KEYS.map((key) => {
              const typ = { key, ...photoTypeMeta[key], label: t(`order.photoType.${key}`) };
              return (
              <TouchableOpacity
                key={typ.key}
                style={[S.zdjecieTypBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                onPress={() => void zrobZdjecie(typ.key, photoOpisDraft, photoTagiDraft)}
                disabled={uploadingPhoto}
              >
                <View style={[S.zdjecieTypIcon, { backgroundColor: typ.color + '22' }]}>
                  <PlatinumIconBadge icon={typ.icon} color={typ.color} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                </View>
                <Text style={[S.zdjecieTypLabel, { color: theme.text }]}>{typ.label}</Text>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
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

      {/* M3 F3.9 — forma płatności przed STOP */}
      <Modal visible={finishModal} animationType="slide" transparent onRequestClose={() => setFinishModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={S.overlay}>
            <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
              <View style={S.modalHeader}>
                <Text style={[S.modalTitle, { color: theme.text }]}>Płatność klienta</Text>
                <TouchableOpacity onPress={() => setFinishModal(false)}>
                  <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
                </TouchableOpacity>
              </View>
              <Text style={[S.modalLbl, { color: theme.textSub }]}>Forma płatności</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8 }}>
                {(['Gotowka', 'Przelew', 'Faktura_VAT', 'Brak'] as const).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[
                      S.typBtn,
                      { backgroundColor: theme.surface2, borderColor: theme.border },
                      payForm.forma_platnosc === f && { backgroundColor: theme.accent, borderColor: theme.accent },
                    ]}
                    onPress={() => setPayForm((p) => ({ ...p, forma_platnosc: f }))}
                  >
                    <Text style={[S.typBtnTxt, { color: theme.textSub }, payForm.forma_platnosc === f && { color: theme.accentText }]}>
                      {f.replace('_', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {payForm.forma_platnosc === 'Gotowka' ? (
                <>
                  <Text style={[S.modalLbl, { color: theme.textSub }]}>Kwota odebrana (PLN)</Text>
                  <TextInput
                    style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                    keyboardType="decimal-pad"
                    value={payForm.kwota_odebrana}
                    onChangeText={(v) => setPayForm((p) => ({ ...p, kwota_odebrana: v }))}
                  />
                </>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10, gap: 10 }}>
                <Text style={{ color: theme.text }}>Faktura VAT</Text>
                <Switch value={payForm.faktura_vat} onValueChange={(v) => setPayForm((p) => ({ ...p, faktura_vat: v }))} />
              </View>
              <Text style={[S.modalLbl, { color: theme.textSub }]}>NIP (jeśli faktura)</Text>
              <TextInput
                style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                value={payForm.nip}
                onChangeText={(v) => setPayForm((p) => ({ ...p, nip: v }))}
                autoCapitalize="characters"
              />
              <Text style={[S.modalLbl, { color: theme.textSub, marginTop: 12 }]}>{t('order.finishUsageHint')}</Text>
              <TextInput
                style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                placeholder={t('order.finishUsageNazwa')}
                placeholderTextColor={theme.inputPlaceholder}
                value={finishUsageNazwa}
                onChangeText={setFinishUsageNazwa}
              />
              <Text style={[S.modalLbl, { color: theme.textSub }]}>{t('order.finishUsageIlosc')}</Text>
              <TextInput
                style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                placeholder="0"
                placeholderTextColor={theme.inputPlaceholder}
                keyboardType="decimal-pad"
                value={finishUsageIlosc}
                onChangeText={setFinishUsageIlosc}
              />
              <View style={S.modalBtns}>
                <TouchableOpacity
                  style={[S.cancelBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                  onPress={() => setFinishModal(false)}
                >
                  <Text style={[S.cancelTxt, { color: theme.textSub }]}>Anuluj</Text>
                </TouchableOpacity>
                <PlatinumCTA style={S.submitBtn} label={changingStatus ? '…' : 'Zakończ zlecenie'} onPress={() => void submitFinish()} disabled={changingStatus} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── MODAL: ZGŁOŚ PROBLEM ── */}
      <Modal visible={problemModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.overlay}>
          <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
            <View style={S.modalHeader}>
              <View style={S.metaRow}>
                <PlatinumIconBadge icon="warning" color={theme.warning} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.modalTitle, { color: theme.text, marginLeft: 8 }]}>Zgłoś problem</Text>
              </View>
              <TouchableOpacity onPress={() => setProblemModal(false)}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
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
  summaryItem: { flex: 1, alignItems: 'center', gap: 6 },
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
