/**
 * ARBOR-OS: Moduł Wycen v2
 * Dostęp: Wyceniający (własne), Dyrektor/Administrator (wszystkie), Kierownik (swój oddział)
 *
 * Funkcje:
 * - Gabinet wycen podzielony po oddziałach
 * - Szybki formularz z checklistą sprzętu, pozycjami cenowymi, wynikiem wizyty
 * - Zdjęcie → od razu edytor rysowania (jak Telegram)
 * - Inline drawing canvas (SVG + ViewShot)
 */

import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Linking,
  Modal, PanResponder, Platform, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, View, StatusBar,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { PLATINUM_MOTION } from '../constants/motion';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_BASE_URL, API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';
import { filterQuotesForEstimatorRole } from '../utils/estimator-compensation';
import { appendContactNote, clientHistoryKey, listContactNotes, type ContactNote } from '../utils/client-contact-history';
import { deleteWycenaTemplate, listWycenaTemplates, saveWycenaTemplate, type WycenaTemplate } from '../utils/wycena-templates';
import { openAddressInMaps } from '../utils/maps-link';
import { triggerHaptic } from '../utils/haptics';

// ─── Typy ─────────────────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Pozycja { id: string; opis: string; kwota: string; }
interface Stroke   { path: string; color: string; width: number; }
interface PhotoItem { localUri: string; annotated?: string; }

// ─── Stałe ────────────────────────────────────────────────────────────────────
const CZASY = ['0.5h','1h','1.5h','2h','3h','4h','6h','8h+'];

const WYNIKI_BASE: { value: string; icon: IoniconName }[] = [
  { value: 'oczekuje', icon: 'time-outline' },
  { value: 'oddzwoni', icon: 'call-outline' },
  { value: 'zaakceptowane', icon: 'checkmark-circle-outline' },
  { value: 'odrzucone', icon: 'close-circle-outline' },
];

const SPRZET_BASE: { key: string; icon: IoniconName }[] = [
  { key: 'rebak',           icon: 'settings-outline' },
  { key: 'pila_wysiegniku', icon: 'construct-outline' },
  { key: 'nozyce_dlugie',   icon: 'cut-outline' },
  { key: 'kosiarka',        icon: 'leaf-outline' },
  { key: 'podkaszarka',     icon: 'flower-outline' },
  { key: 'lopata',          icon: 'earth-outline' },
  { key: 'mulczer',         icon: 'layers-outline' },
  { key: 'arborysta',       icon: 'person-outline' },
];

function quoteStatusLabel(code: string | undefined, tr: (key: string) => string) {
  if (!code) return '';
  const k = `wyceny.status.${code}`;
  const r = tr(k);
  return r === k ? code.replace(/_/g, ' ') : r;
}

const KOLORY_RYSOWANIA = ['#EF4444','#F97316','#FBBF24','#34D399','#3B82F6','#14b8a6','#000000','#ffffff'];
const GRUBOSCI = [3, 6, 12];

// ─── Pusty formularz ──────────────────────────────────────────────────────────
const emptyForm = () => ({
  klient_nazwa: '', klient_telefon: '', adres: '', miasto: '',
  typ_uslugi: 'Wycinka', opis: '', notatki_wewnetrzne: '',
  oddzial_id: '',
  pozycje: [{ id: '1', opis: '', kwota: '' }] as Pozycja[],
  wywoz: false, usuwanie_pni: false,
  czas_realizacji: '1h', ilosc_osob: 2,
  wynik: 'oczekuje',
  budzet: '', rabat: '', kwota_minimalna: '',
  rebak: false, pila_wysiegniku: false, nozyce_dlugie: false,
  kosiarka: false, podkaszarka: false, lopata: false, mulczer: false, arborysta: false,
  zrebki: 0, drewno: false,
});

// ─── Główny komponent ─────────────────────────────────────────────────────────
export default function WycenaScreen() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const numberLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const wynikiOptions = useMemo(() => {
    const visitColor: Record<string, string> = {
      oczekuje: theme.textMuted,
      oddzwoni: theme.info,
      zaakceptowane: theme.success,
      odrzucone: theme.danger,
    };
    return WYNIKI_BASE.map(w => ({
      ...w,
      color: visitColor[w.value],
      label: t(`wyceny.visit.${w.value}`),
    }));
  }, [t, theme]);
  const sprzetOptions = useMemo(() => SPRZET_BASE.map(s => ({
    ...s,
    label: t(`wyceny.equipment.${s.key}`),
  })), [t]);
  const statusKolor = useMemo(() => ({
    Nowa: theme.info,
    W_Opracowaniu: theme.warning,
    Wyslana: theme.accent,
    Zaakceptowana: theme.success,
    Odrzucona: theme.danger,
    Zlecenie: theme.accent,
  }), [theme]);
  const guard = useOddzialFeatureGuard('/wycena');
  const [user, setUser] = useState<any>(null);
  const [wyceny, setWyceny] = useState<any[]>([]);
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [selectedOddzial, setSelectedOddzial] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Nowa wycena
  const [showNew, setShowNew] = useState(false);
  const [tplName, setTplName] = useState('');
  const [templates, setTemplates] = useState<WycenaTemplate[]>([]);
  const [histDraft, setHistDraft] = useState('');
  const [histList, setHistList] = useState<ContactNote[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsName, setGpsName] = useState('');
  const gpsRef = useRef(false);

  // Detail
  const [selectedWycena, setSelectedWycena] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailPhotos, setDetailPhotos] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const convertPulse = useRef(new Animated.Value(1)).current;
  const listOpacity = useRef(new Animated.Value(1)).current;

  // Inline drawing (po zrobieniu zdjęcia)
  const [drawingUri, setDrawingUri] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [drawColor, setDrawColor] = useState('#EF4444');
  const [drawWidth, setDrawWidth] = useState(6);
  const [eraser, setEraser] = useState(false);
  const isDrawing = useRef(false);
  const viewShotRef = useRef<ViewShot>(null);

  const getToken = useCallback(async () => {
    if (token) return token;
    const { token: storedToken } = await getStoredSession();
    return storedToken;
  }, [token]);

  const fetchWyceny = useCallback(
    async (tokenOverride?: string | null, sessionUser?: { id?: unknown; rola?: string } | null) => {
      try {
        const authTok = tokenOverride || await getToken();
        const u = sessionUser ?? user;
        const params = selectedOddzial ? `?oddzial_id=${selectedOddzial}` : '';
        const res = await fetch(`${API_URL}/wyceny${params}`, { headers: { Authorization: `Bearer ${authTok}` } });
        if (res.ok) {
          const d = await res.json();
          let list = Array.isArray(d) ? d : [];
          list = filterQuotesForEstimatorRole(list, u?.id, u?.rola);
          setWyceny(list);
        }
      } catch { }
      finally {
        setRefreshing(false);
      }
    },
    [getToken, selectedOddzial, user],
  );

  const fetchOddzialy = useCallback(async (tokenOverride?: string | null) => {
    try {
      const authTok = tokenOverride || await getToken();
      const res = await fetch(`${API_URL}/oddzialy`, { headers: { Authorization: `Bearer ${authTok}` } });
      if (res.ok) { const d = await res.json(); setOddzialy(Array.isArray(d) ? d : []); }
    } catch { }
  }, [getToken]);

  const init = useCallback(async () => {
    try {
      const { token: storedToken, user: u } = await getStoredSession();
      if (!storedToken || !u) { router.replace('/login'); return; }
      setToken(storedToken);
      setUser(u);

      const role = typeof u?.rola === 'string' ? u.rola : '';
      const canAccess = ['Wyceniający','Dyrektor','Administrator','Kierownik'].includes(role);
      if (!canAccess) { router.back(); return; }

      await Promise.all([fetchWyceny(storedToken, u), fetchOddzialy(storedToken)]);
    } catch { }
    finally { setLoading(false); }
  }, [fetchOddzialy, fetchWyceny]);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    if (!showNew) return;
    void listWycenaTemplates().then(setTemplates);
  }, [showNew]);

  useEffect(() => {
    if (!showNew) return;
    const k = clientHistoryKey(form.klient_telefon, form.klient_nazwa);
    void listContactNotes(k).then(setHistList);
  }, [showNew, form.klient_telefon, form.klient_nazwa]);

  useEffect(() => {
    const shouldPulse = !!showDetail && selectedWycena?.status === 'Zaakceptowana';
    if (!shouldPulse) {
      convertPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(convertPulse, {
          toValue: 1.02,
          duration: PLATINUM_MOTION.duration.medium,
          easing: PLATINUM_MOTION.easing.smoothInOut,
          useNativeDriver: true,
        }),
        Animated.timing(convertPulse, {
          toValue: 1,
          duration: PLATINUM_MOTION.duration.medium,
          easing: PLATINUM_MOTION.easing.smoothInOut,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [convertPulse, selectedWycena?.status, showDetail]);

  useEffect(() => {
    listOpacity.setValue(0.55);
    Animated.timing(listOpacity, {
      toValue: 1,
      duration: PLATINUM_MOTION.duration.medium,
      easing: PLATINUM_MOTION.easing.smoothOut,
      useNativeDriver: true,
    }).start();
  }, [listOpacity, selectedOddzial, wyceny]);

  const applyOddzialFilter = useCallback((oddzialId: string) => {
    void triggerHaptic('light');
    setSelectedOddzial(oddzialId);
    void fetchWyceny();
  }, [fetchWyceny]);

  // ─── GPS ──────────────────────────────────────────────────────────────────
  const captureGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { lat: loc.coords.latitude, lon: loc.coords.longitude };
      setGps(coords);
      const geo = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon });
      if (geo.length > 0) {
        const g = geo[0];
        const adres = [g.street, g.streetNumber].filter(Boolean).join(' ');
        const miasto = g.city || g.region || '';
        setForm(f => ({ ...f, adres: f.adres || adres, miasto: f.miasto || miasto }));
        setGpsName(`${adres}, ${miasto}`);
      }
      return coords;
    } catch { return null; }
  };

  // ─── Zdjęcia ──────────────────────────────────────────────────────────────
  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { void triggerHaptic('warning'); Alert.alert(t('wyceny.alert.cameraDeniedTitle'), t('wyceny.alert.cameraDeniedBody')); return; }
    if (!gpsRef.current) { gpsRef.current = true; captureGPS(); }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false });
    if (!result.canceled && result.assets[0]) {
      // Otwórz od razu edytor rysowania (jak Telegram)
      openDrawing(result.assets[0].uri);
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true });
    if (!result.canceled) {
      void triggerHaptic('light');
      setPhotos(p => [...p, ...result.assets.map(a => ({ localUri: a.uri }))]);
    }
  };

  // ─── Drawing ──────────────────────────────────────────────────────────────
  const openDrawing = (uri: string) => {
    setDrawingUri(uri);
    setStrokes([]);
    setCurrentPath('');
    setEraser(false);
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      isDrawing.current = true;
      const { locationX, locationY } = evt.nativeEvent;
      setCurrentPath(`M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`);
    },
    onPanResponderMove: (evt) => {
      if (!isDrawing.current) return;
      const { locationX, locationY } = evt.nativeEvent;
      setCurrentPath(prev => `${prev} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`);
    },
    onPanResponderRelease: () => {
      if (!isDrawing.current || !currentPath) return;
      isDrawing.current = false;
      setStrokes(prev => [...prev, {
        path: currentPath,
        color: eraser ? 'transparent' : drawColor,
        width: eraser ? drawWidth * 3 : drawWidth,
      }]);
      setCurrentPath('');
    },
  });

  const confirmDrawing = async () => {
    if (!viewShotRef.current) return;
    try {
      const annotatedUri = await viewShotRef.current.capture!();
      setPhotos(p => [...p, { localUri: drawingUri!, annotated: annotatedUri }]);
    } catch {
      setPhotos(p => [...p, { localUri: drawingUri! }]);
    }
    setDrawingUri(null);
  };

  const skipDrawing = () => {
    setPhotos(p => [...p, { localUri: drawingUri! }]);
    setDrawingUri(null);
  };

  // ─── Pozycje cenowe ───────────────────────────────────────────────────────
  const addPozycja = () => {
    setForm(f => ({ ...f, pozycje: [...f.pozycje, { id: Date.now().toString(), opis: '', kwota: '' }] }));
  };
  const removePozycja = (id: string) => {
    setForm(f => ({ ...f, pozycje: f.pozycje.filter(p => p.id !== id) }));
  };
  const updatePozycja = (id: string, field: 'opis' | 'kwota', val: string) => {
    setForm(f => ({ ...f, pozycje: f.pozycje.map(p => p.id === id ? { ...p, [field]: val } : p) }));
  };

  const totalCena = form.pozycje.reduce((s, p) => s + (parseFloat(p.kwota) || 0), 0);

  // ─── Zapis wyceny ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.klient_nazwa.trim()) { Alert.alert(t('wyceny.alert.saveFail'), t('wyceny.alert.clientRequired')); return; }
    setSaving(true);
    try {
      const token = await getToken();
      const body = {
        ...form,
        pozycje: form.pozycje.filter(p => p.opis || p.kwota),
        wartosc_szacowana: totalCena || null,
        lat: gps?.lat ?? null, lon: gps?.lon ?? null,
        ilosc_osob: form.ilosc_osob,
      };

      const res = await fetch(`${API_URL}/wyceny`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json(); void triggerHaptic('error'); Alert.alert(t('wyceny.alert.saveFail'), err.error); return; }
      const saved = await res.json();
      const ck = clientHistoryKey(form.klient_telefon, form.klient_nazwa);
      if (ck !== '_') {
        await appendContactNote(ck, `Wycena #${saved.id} · ${totalCena.toFixed(0)} zł`);
      }

      // Upload zdjęć (annotated ma priorytet)
      for (const photo of photos) {
        const uri = photo.annotated || photo.localUri;
        const fd = new FormData();
        fd.append('zdjecie', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
        if (gps) { fd.append('lat', String(gps.lat)); fd.append('lon', String(gps.lon)); }
        await fetch(`${API_URL}/wyceny/${saved.id}/zdjecia`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
        });
      }

      setShowNew(false);
      setForm(emptyForm()); setPhotos([]); setGps(null); setGpsName('');
      gpsRef.current = false;
      fetchWyceny();
      void triggerHaptic('success');
      Alert.alert(t('wyceny.alert.savedTitle'), t('wyceny.alert.savedBody'));
    } catch { void triggerHaptic('error'); Alert.alert(t('wyceny.alert.saveFail'), t('wyceny.alert.network')); }
    finally { setSaving(false); }
  };

  // ─── Szczegóły ────────────────────────────────────────────────────────────
  const openDetail = async (w: any) => {
    setSelectedWycena(w); setShowDetail(true); setLoadingDetail(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/wyceny/${w.id}/zdjecia`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setDetailPhotos(Array.isArray(d) ? d : []); }
    } catch { }
    finally { setLoadingDetail(false); }
  };

  const changeStatus = async (id: number, status: string) => {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/wyceny/${id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setShowDetail(false); fetchWyceny();
    } catch { Alert.alert(t('wyceny.alert.saveFail'), t('wyceny.alert.statusFail')); }
  };

  const convertToZlecenie = async (w: any) => {
    Alert.alert(t('wyceny.convertTitle'), t('wyceny.convertBody', { name: w.klient_nazwa }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.yes'), onPress: async () => {
        const token = await getToken();
        const res = await fetch(`${API_URL}/wyceny/${w.id}/konwertuj`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setShowDetail(false); fetchWyceny();
          Alert.alert(t('wyceny.convertOkTitle'), t('wyceny.convertOkBody'));
          if (data.task_id) router.push(`/zlecenie/${data.task_id}`);
        } else Alert.alert(t('wyceny.alert.saveFail'), t('wyceny.convertFail'));
      }},
    ]);
  };

  const isManager = ['Dyrektor','Administrator','Kierownik'].includes(user?.rola);
  const S = makeStyles(theme);

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (guard.ready && !guard.allowed) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  // ─── INLINE DRAWING MODAL ─────────────────────────────────────────────────
  if (drawingUri) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />
        {/* Toolbar */}
        <View style={S.drawToolbar}>
          <TouchableOpacity onPress={skipDrawing} style={S.drawToolBtn}>
            <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
            <Text style={S.drawToolBtnText}>{t('draw.skip')}</Text>
          </TouchableOpacity>
          <Text style={S.drawToolbarTitle}>{t('draw.editPhotoTitle')}</Text>
          <TouchableOpacity onPress={confirmDrawing} style={S.drawSaveBtn}>
            <PlatinumIconBadge icon="checkmark" color={theme.accentText} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
            <Text style={S.drawSaveBtnText}>{t('draw.done')}</Text>
          </TouchableOpacity>
        </View>

        {/* Canvas */}
        <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 0.92 }} style={{ flex: 1 }}>
          <View style={{ flex: 1 }} {...panResponder.panHandlers}>
            <Image source={{ uri: drawingUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
              {strokes.map((s, i) => (
                <Path key={i} d={s.path} stroke={s.color} strokeWidth={s.width}
                  fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {currentPath ? (
                <Path d={currentPath}
                  stroke={eraser ? 'rgba(0,0,0,0.3)' : drawColor}
                  strokeWidth={eraser ? drawWidth * 3 : drawWidth}
                  fill="none" strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={eraser ? '6,4' : undefined} />
              ) : null}
            </Svg>
          </View>
        </ViewShot>

        {/* Narzędzia dolne */}
        <View style={S.drawBottom}>
          {/* Kolory */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.colorRow}>
            <TouchableOpacity style={[S.eraserBtn, eraser && S.eraserBtnActive]} onPress={() => setEraser(!eraser)}>
              <PlatinumIconBadge icon="remove-circle-outline" color={eraser ? theme.accentText : theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
            </TouchableOpacity>
            {KOLORY_RYSOWANIA.map(k => (
              <TouchableOpacity key={k} style={[S.colorDot,
                { backgroundColor: k, borderColor: k === '#ffffff' ? theme.border : k },
                drawColor === k && !eraser && S.colorDotActive]}
                onPress={() => { setDrawColor(k); setEraser(false); }} />
            ))}
          </ScrollView>

          {/* Grubość + undo */}
          <View style={S.drawActionsRow}>
            <View style={S.gruboscRow}>
              {GRUBOSCI.map(g => (
                <TouchableOpacity key={g} style={[S.gruboscBtn, drawWidth === g && S.gruboscBtnActive]}
                  onPress={() => setDrawWidth(g)}>
                  <View style={[S.gruboscLine, { height: g, backgroundColor: drawWidth === g ? theme.text : theme.textMuted }]} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={S.undoBtn} onPress={() => setStrokes(s => s.slice(0, -1))} disabled={strokes.length === 0}>
              <PlatinumIconBadge icon="arrow-undo" color={strokes.length === 0 ? theme.border : theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
              <Text style={[S.undoBtnText, strokes.length === 0 && { color: theme.textMuted }]}>{t('wyceny.draw.undo')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ─── MAIN VIEW ────────────────────────────────────────────────────────────
  return (
    <KeyboardSafeScreen style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <PlatinumIconBadge icon="arrow-back" color={theme.headerText} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('wyceny.title')}</Text>
          {user?.rola && <Text style={S.headerSub}>{user.rola}</Text>}
        </View>
        <PlatinumCTA
          label={t('wyceny.header.newBtn')}
          style={S.newBtn}
          onPress={() => {
            void triggerHaptic('light');
            setShowNew(true);
          }}
        />
      </View>

      {/* Filtry oddziałów */}
      {oddzialy.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={S.oddzialyScroll} contentContainerStyle={S.oddzialyContent}>
          <TouchableOpacity style={[S.oddzialChip, !selectedOddzial && { backgroundColor: theme.accent, borderColor: theme.accent }]}
            onPress={() => applyOddzialFilter('')}>
            <Text style={[S.oddzialChipText, !selectedOddzial && { color: theme.accentText }]}>{t('wyceny.list.filterAll')}</Text>
          </TouchableOpacity>
          {oddzialy.map(o => (
            <TouchableOpacity key={o.id}
              style={[S.oddzialChip, selectedOddzial === o.id.toString() && { backgroundColor: theme.accent, borderColor: theme.accent }]}
              onPress={() => applyOddzialFilter(o.id.toString())}>
              <Text style={[S.oddzialChipText, selectedOddzial === o.id.toString() && { color: theme.accentText }]}>{o.nazwa}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Lista */}
      <Animated.ScrollView style={[S.list, { opacity: listOpacity }]} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchWyceny(); }} tintColor={theme.accent} colors={[theme.accent]} />}>
        {wyceny.length === 0 ? (
          <View style={S.empty}>
            <PlatinumIconBadge icon="calculator-outline" color={theme.textMuted} size={24} style={{ width: 56, height: 56, borderRadius: 16 }} />
            <Text style={S.emptyTitle}>{t('wyceny.list.emptyTitle')}</Text>
            <Text style={S.emptySub}>{t('wyceny.list.emptySub')}</Text>
            <PlatinumCTA
              label={t('wyceny.list.newQuoteCta')}
              style={[S.newBtn, { marginTop: 16 }]}
              onPress={() => {
                void triggerHaptic('light');
                setShowNew(true);
              }}
            />
          </View>
        ) : wyceny.map((w, index) => {
          const wynikInfo = wynikiOptions.find(x => x.value === w.wynik);
          return (
            <PlatinumAppear key={w.id} delayMs={(index % 6) * 40}>
              <TouchableOpacity style={S.wycenaCard} onPress={() => openDetail(w)} activeOpacity={0.8}>
                <View style={[S.wycenaStripe, { backgroundColor: statusKolor[w.status as keyof typeof statusKolor] || theme.border }]} />
                <View style={S.wycenaContent}>
                  <View style={S.wycenaTop}>
                    <Text style={S.wycenaKlient}>{w.klient_nazwa}</Text>
                    <View style={[S.badge, { backgroundColor: (statusKolor[w.status as keyof typeof statusKolor] || theme.textMuted) + '28' }]}>
                      <Text style={[S.badgeText, { color: statusKolor[w.status as keyof typeof statusKolor] || theme.textMuted }]}>{quoteStatusLabel(w.status, t)}</Text>
                    </View>
                  </View>
                  <View style={S.metaRow}>
                    <PlatinumIconBadge icon="location-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={S.metaText}> {w.adres}, {w.miasto}</Text>
                  </View>
                  {w.oddzial_nazwa ? (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="business-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      <Text style={S.metaText}> {w.oddzial_nazwa}</Text>
                    </View>
                  ) : null}
                  <View style={S.wycenaBottom}>
                    {w.wartosc_szacowana ? (
                      <Text style={S.wycenaCena}>{parseFloat(w.wartosc_szacowana).toLocaleString(numberLocale)} {t('wyceny.currency')}</Text>
                    ) : null}
                    {wynikInfo ? (
                      <View style={[S.wynikBadge, { backgroundColor: wynikInfo.color + '22' }]}>
                        <PlatinumIconBadge icon={wynikInfo.icon} color={wynikInfo.color} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                        <Text style={[S.wynikText, { color: wynikInfo.color }]}> {wynikInfo.label}</Text>
                      </View>
                    ) : null}
                    <Text style={S.wycenaDate}>{new Date(w.created_at).toLocaleDateString(numberLocale)}</Text>
                  </View>
                </View>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7, alignSelf: 'center', marginRight: 8 }} />
              </TouchableOpacity>
            </PlatinumAppear>
          );
        })}
        <View style={{ height: 40 }} />
      </Animated.ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════
          NOWA WYCENA — MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal visible={showNew} animationType="slide" onRequestClose={() => setShowNew(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.modalRoot}>
          <View style={S.modalHeader}>
            <TouchableOpacity onPress={() => setShowNew(false)}>
              <PlatinumIconBadge icon="close" color={theme.headerText} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
            </TouchableOpacity>
            <Text style={S.modalTitle}>{t('wyceny.modal.newTitle')}</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color={theme.accent} size="small" />
                : <Text style={S.modalSaveText}>{t('wyceny.btn.saveModal')}</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={S.modalBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            showsVerticalScrollIndicator={false}
          >

            {/* ── Klient ─────────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={0}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="person-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.client')}</Text>
              <TextInput style={S.input} placeholder={t('wyceny.ph.clientName')} placeholderTextColor={theme.inputPlaceholder}
                value={form.klient_nazwa} onChangeText={v => setForm(f => ({ ...f, klient_nazwa: v }))} />
              <TextInput style={S.input} placeholder={t('wyceny.ph.phone')} placeholderTextColor={theme.inputPlaceholder}
                keyboardType="phone-pad" value={form.klient_telefon} onChangeText={v => setForm(f => ({ ...f, klient_telefon: v }))} />
              <Text style={[S.label, { marginTop: 10 }]}>{t('wyceny.templates.title')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
                {templates.map((tpl) => (
                  <View key={tpl.id} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                    <TouchableOpacity
                      style={[S.chip, S.chipActive]}
                      onPress={() => {
                        const s = tpl.snapshot as Record<string, unknown>;
                        const base = emptyForm();
                        const poz = Array.isArray(s.pozycje) && (s.pozycje as Pozycja[]).length ? (s.pozycje as Pozycja[]) : base.pozycje;
                        setForm({ ...base, ...s, pozycje: poz } as typeof base);
                      }}
                    >
                      <Text style={[S.chipText, S.chipTextActive]}>{tpl.name}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { void deleteWycenaTemplate(tpl.id).then(() => listWycenaTemplates().then(setTemplates)); }} hitSlop={8}>
                      <PlatinumIconBadge icon="close-circle" color={theme.danger} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TextInput
                style={S.input}
                placeholder={t('wyceny.templates.namePh')}
                placeholderTextColor={theme.inputPlaceholder}
                value={tplName}
                onChangeText={setTplName}
              />
              <TouchableOpacity
                style={{ marginTop: 6, alignSelf: 'flex-start' }}
                onPress={async () => {
                  await saveWycenaTemplate(tplName || 'Szablon', JSON.parse(JSON.stringify(form)) as Record<string, unknown>);
                  setTplName('');
                  setTemplates(await listWycenaTemplates());
                }}
              >
                <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('wyceny.templates.save')}</Text>
              </TouchableOpacity>
              <Text style={[S.label, { marginTop: 10 }]}>{t('wyceny.history.title')}</Text>
              {histList.map((h) => (
                <Text key={h.ts} style={{ color: theme.textSub, fontSize: 12, marginBottom: 4 }}>{h.ts.slice(0, 16)} — {h.text}</Text>
              ))}
              <TextInput
                style={S.input}
                placeholder={t('wyceny.history.ph')}
                placeholderTextColor={theme.inputPlaceholder}
                value={histDraft}
                onChangeText={setHistDraft}
              />
              <TouchableOpacity
                style={{ marginTop: 6 }}
                onPress={async () => {
                  const k = clientHistoryKey(form.klient_telefon, form.klient_nazwa);
                  if (k === '_') return;
                  await appendContactNote(k, histDraft);
                  setHistDraft('');
                  setHistList(await listContactNotes(k));
                }}
              >
                <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('wyceny.history.add')}</Text>
              </TouchableOpacity>
            </PlatinumAppear>

            {/* ── Lokalizacja ────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={40}>
              <View style={S.cardTitleRow}>
                <Text style={S.cardTitle}><PlatinumIconBadge icon="location-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.location')}</Text>
                <TouchableOpacity style={S.gpsBtn} onPress={captureGPS}>
                  <PlatinumIconBadge icon="navigate-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.gpsBtnText, { color: theme.accent }]}>{t('wyceny.gps')}</Text>
                </TouchableOpacity>
              </View>
              {gps && <Text style={[S.gpsInfo, { color: theme.success }]}>✓ {gpsName || `${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`}</Text>}
              <TextInput style={S.input} placeholder={t('wyceny.ph.address')} placeholderTextColor={theme.inputPlaceholder}
                value={form.adres} onChangeText={v => setForm(f => ({ ...f, adres: v }))} />
              <TextInput style={S.input} placeholder={t('wyceny.ph.city')} placeholderTextColor={theme.inputPlaceholder}
                value={form.miasto} onChangeText={v => setForm(f => ({ ...f, miasto: v }))} />
              {(form.adres.trim() || form.miasto.trim()) ? (
                <TouchableOpacity
                  style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  onPress={() => { void openAddressInMaps(form.adres, form.miasto); }}
                >
                  <PlatinumIconBadge icon="map-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('wyceny.openMaps')}</Text>
                </TouchableOpacity>
              ) : null}
              {oddzialy.length > 0 && (
                <>
                  <Text style={S.label}>{t('wyceny.label.branch')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <TouchableOpacity style={[S.chip, !form.oddzial_id && S.chipActive]}
                      onPress={() => setForm(f => ({ ...f, oddzial_id: '' }))}>
                      <Text style={[S.chipText, !form.oddzial_id && S.chipTextActive]}>{t('wyceny.branch.none')}</Text>
                    </TouchableOpacity>
                    {oddzialy.map(o => (
                      <TouchableOpacity key={o.id} style={[S.chip, form.oddzial_id === o.id.toString() && S.chipActive]}
                        onPress={() => setForm(f => ({ ...f, oddzial_id: o.id.toString() }))}>
                        <Text style={[S.chipText, form.oddzial_id === o.id.toString() && S.chipTextActive]}>{o.nazwa}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
            </PlatinumAppear>

            {/* ── Zdjęcia ────────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={80}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="camera-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.photos')}</Text>
              <Text style={S.cardHint}>{t('wyceny.card.photosHint')}</Text>
              <View style={S.photoBtns}>
                <TouchableOpacity style={S.photoBtn} onPress={takePhoto}>
                  <PlatinumIconBadge icon="camera" color={theme.accent} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={S.photoBtnText}>{t('wyceny.photo.camera')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.photoBtn} onPress={pickFromGallery}>
                  <PlatinumIconBadge icon="images-outline" color={theme.accent} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={S.photoBtnText}>{t('wyceny.photo.gallery')}</Text>
                </TouchableOpacity>
              </View>
              {photos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  {photos.map((p, i) => (
                    <View key={i} style={S.thumb}>
                      <Image source={{ uri: p.annotated || p.localUri }} style={S.thumbImg} />
                      {p.annotated && (
                        <View style={S.thumbAnnotated}>
                          <PlatinumIconBadge icon="pencil" color={theme.accentText} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                        </View>
                      )}
                      <TouchableOpacity style={S.thumbRemove} onPress={() => setPhotos(ph => ph.filter((_, j) => j !== i))}>
                        <PlatinumIconBadge icon="close" color={theme.accentText} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
            </PlatinumAppear>

            {/* ── Opis pracy / Pozycje ───────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={120}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="list-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.workDesc')}</Text>
              {form.pozycje.map((poz, i) => (
                <View key={poz.id} style={S.pozycjaRow}>
                  <TextInput style={[S.input, S.pozycjaOpis]} placeholder={t('wyceny.ph.lineItem', { n: i + 1 })}
                    placeholderTextColor={theme.inputPlaceholder}
                    value={poz.opis} onChangeText={v => updatePozycja(poz.id, 'opis', v)} />
                  <View style={S.pozycjaKwotaWrap}>
                    <TextInput style={[S.input, S.pozycjaKwota]} placeholder={t('wyceny.ph.currency')}
                      placeholderTextColor={theme.inputPlaceholder} keyboardType="decimal-pad"
                      value={poz.kwota} onChangeText={v => updatePozycja(poz.id, 'kwota', v)} />
                    {form.pozycje.length > 1 && (
                      <TouchableOpacity onPress={() => removePozycja(poz.id)} style={S.removePozycjaBtn}>
                        <PlatinumIconBadge icon="trash-outline" color={theme.danger} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
              <TouchableOpacity style={S.addPozycjaBtn} onPress={addPozycja}>
                <PlatinumIconBadge icon="add-circle-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                <Text style={[S.addPozycjaBtnText, { color: theme.accent }]}>{t('wyceny.btn.addLine')}</Text>
              </TouchableOpacity>
              {totalCena > 0 && (
                <View style={[S.totalRow, { backgroundColor: theme.accentLight }]}>
                  <Text style={[S.totalLabel, { color: theme.accent }]}>{t('wyceny.total')}</Text>
                  <Text style={[S.totalCena, { color: theme.accent }]}>{totalCena.toLocaleString(numberLocale)} {t('wyceny.currency')}</Text>
                </View>
              )}
            </PlatinumAppear>

            {/* ── Logistyka ──────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={160}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="car-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.logistics')}</Text>

              <View style={S.toggleGrid}>
                <TouchableOpacity style={[S.toggleBtn, form.wywoz && S.toggleBtnOn]}
                  onPress={() => setForm(f => ({ ...f, wywoz: !f.wywoz }))}>
                  <PlatinumIconBadge icon="trash-outline" color={form.wywoz ? theme.accentText : theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.toggleText, form.wywoz && { color: theme.accentText }]}>{t('wyceny.log.haul')}</Text>
                  <Text style={[S.toggleState, form.wywoz && { color: theme.accentText }]}>{form.wywoz ? t('wyceny.param.yes') : t('wyceny.param.no')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.toggleBtn, form.usuwanie_pni && S.toggleBtnOn]}
                  onPress={() => setForm(f => ({ ...f, usuwanie_pni: !f.usuwanie_pni }))}>
                  <PlatinumIconBadge icon="cut-outline" color={form.usuwanie_pni ? theme.accentText : theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.toggleText, form.usuwanie_pni && { color: theme.accentText }]}>{t('wyceny.log.stumpsShort')}</Text>
                  <Text style={[S.toggleState, form.usuwanie_pni && { color: theme.accentText }]}>{form.usuwanie_pni ? t('wyceny.param.yes') : t('wyceny.param.no')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.toggleBtn, form.drewno && S.toggleBtnOn]}
                  onPress={() => setForm(f => ({ ...f, drewno: !f.drewno }))}>
                  <PlatinumIconBadge icon="leaf-outline" color={form.drewno ? theme.accentText : theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.toggleText, form.drewno && { color: theme.accentText }]}>{t('wyceny.log.wood')}</Text>
                  <Text style={[S.toggleState, form.drewno && { color: theme.accentText }]}>{form.drewno ? t('wyceny.param.yes') : t('wyceny.param.no')}</Text>
                </TouchableOpacity>
              </View>

              <Text style={S.label}>{t('wyceny.label.chips')}</Text>
              <View style={S.stepperRow}>
                <TouchableOpacity style={S.stepBtn} onPress={() => setForm(f => ({ ...f, zrebki: Math.max(0, f.zrebki - 1) }))}>
                  <PlatinumIconBadge icon="remove" color={theme.text} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                </TouchableOpacity>
                <Text style={S.stepValue}>{form.zrebki}</Text>
                <TouchableOpacity style={S.stepBtn} onPress={() => setForm(f => ({ ...f, zrebki: f.zrebki + 1 }))}>
                  <PlatinumIconBadge icon="add" color={theme.text} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                </TouchableOpacity>
              </View>

              <Text style={S.label}>{t('wyceny.label.duration')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {CZASY.map(c => (
                  <TouchableOpacity key={c} style={[S.chip, form.czas_realizacji === c && S.chipActive]}
                    onPress={() => setForm(f => ({ ...f, czas_realizacji: c }))}>
                    <Text style={[S.chipText, form.czas_realizacji === c && S.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={S.label}>{t('wyceny.label.crew')}</Text>
              <View style={S.stepperRow}>
                <TouchableOpacity style={S.stepBtn} onPress={() => setForm(f => ({ ...f, ilosc_osob: Math.max(1, f.ilosc_osob - 1) }))}>
                  <PlatinumIconBadge icon="remove" color={theme.text} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                </TouchableOpacity>
                <Text style={S.stepValue}>{form.ilosc_osob}</Text>
                <TouchableOpacity style={S.stepBtn} onPress={() => setForm(f => ({ ...f, ilosc_osob: f.ilosc_osob + 1 }))}>
                  <PlatinumIconBadge icon="add" color={theme.text} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                </TouchableOpacity>
              </View>
            </PlatinumAppear>

            {/* ── Sprzęt ─────────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={200}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="build-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.equipment')}</Text>
              <View style={S.sprzetGrid}>
                {sprzetOptions.map(s => {
                  const val = (form as any)[s.key];
                  return (
                    <TouchableOpacity key={s.key}
                      style={[S.sprzetBtn, val && S.sprzetBtnOn]}
                      onPress={() => setForm(f => ({ ...f, [s.key]: !val }))}>
                      <PlatinumIconBadge icon={s.icon} color={val ? theme.accentText : theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      <Text style={[S.sprzetLabel, val && { color: theme.accentText }]}>{s.label}</Text>
                      <Text style={[S.sprzetState, val && { color: theme.accentText }]}>{val ? t('wyceny.param.yesCheck') : t('wyceny.param.no')}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </PlatinumAppear>

            {/* ── Wynik wizyty ───────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={240}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="flag-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.visitResult')}</Text>
              <View style={S.wynikRow}>
                {wynikiOptions.map(w => (
                  <TouchableOpacity key={w.value}
                    style={[S.wynikBtn, form.wynik === w.value && { backgroundColor: w.color, borderColor: w.color }]}
                    onPress={() => setForm(f => ({ ...f, wynik: w.value }))}>
                    <PlatinumIconBadge icon={w.icon} color={form.wynik === w.value ? theme.accentText : w.color} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.wynikBtnText, form.wynik === w.value && { color: theme.accentText }]}>{w.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </PlatinumAppear>

            {/* ── Finanse ────────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={280}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="wallet-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.finance')}</Text>
              <View style={S.finRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.label}>{t('wyceny.label.budget')}</Text>
                  <TextInput style={S.input} placeholder="0" placeholderTextColor={theme.inputPlaceholder}
                    keyboardType="decimal-pad" value={form.budzet} onChangeText={v => setForm(f => ({ ...f, budzet: v }))} />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={S.label}>{t('wyceny.label.discount')}</Text>
                  <TextInput style={S.input} placeholder="0" placeholderTextColor={theme.inputPlaceholder}
                    keyboardType="decimal-pad" value={form.rabat} onChangeText={v => setForm(f => ({ ...f, rabat: v }))} />
                </View>
              </View>
              <Text style={S.label}>{t('wyceny.label.minAmount')}</Text>
              <TextInput style={S.input} placeholder="0" placeholderTextColor={theme.inputPlaceholder}
                keyboardType="decimal-pad" value={form.kwota_minimalna} onChangeText={v => setForm(f => ({ ...f, kwota_minimalna: v }))} />
            </PlatinumAppear>

            {/* ── Notatki ────────────────────────────────────────────────── */}
            <PlatinumAppear style={S.card} delayMs={320}>
              <Text style={S.cardTitle}><PlatinumIconBadge icon="document-text-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} /> {t('wyceny.card.notesShort')}</Text>
              <TextInput style={[S.input, S.inputMulti]} placeholder={t('wyceny.ph.notes')} placeholderTextColor={theme.inputPlaceholder}
                multiline numberOfLines={3} textAlignVertical="top"
                value={form.notatki_wewnetrzne} onChangeText={v => setForm(f => ({ ...f, notatki_wewnetrzne: v }))} />
            </PlatinumAppear>

            <PlatinumCTA
              label={t('wyceny.btn.saveMain')}
              style={S.saveMainBtn}
              onPress={handleSave}
              disabled={saving}
              loading={saving}
            />
            <View style={{ height: 60 }} />
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════
          SZCZEGÓŁY WYCENY — MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal visible={showDetail} animationType="slide" transparent onRequestClose={() => setShowDetail(false)}>
        <TouchableOpacity style={S.overlayBg} activeOpacity={1} onPress={() => setShowDetail(false)}>
          <TouchableOpacity activeOpacity={1} style={S.detailBox}>
            {selectedWycena && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={S.detailHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.detailTitle}>{selectedWycena.klient_nazwa}</Text>
                    <View style={[S.badge, { backgroundColor: (statusKolor[selectedWycena.status as keyof typeof statusKolor] || theme.textMuted) + '28', alignSelf: 'flex-start', marginTop: 4 }]}>
                      <Text style={[S.badgeText, { color: statusKolor[selectedWycena.status as keyof typeof statusKolor] || theme.textMuted }]}>{quoteStatusLabel(selectedWycena.status, t)}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const sw = selectedWycena;
                        const lines = [
                          sw.klient_nazwa,
                          [sw.adres, sw.miasto].filter(Boolean).join(', '),
                          sw.status,
                          sw.wartosc_szacowana ? `${t('wyceny.detail.total')}: ${sw.wartosc_szacowana} ${t('wyceny.currency')}` : '',
                        ].filter(Boolean);
                        void Share.share({ message: lines.join('\n') });
                      }}
                      style={{ padding: 4 }}
                    >
                      <PlatinumIconBadge icon="share-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowDetail(false)} style={{ padding: 4 }}>
                      <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Info */}
                {selectedWycena.klient_telefon ? (
                  <TouchableOpacity style={S.detailRow} onPress={() => Linking.openURL(`tel:${selectedWycena.klient_telefon}`)}>
                    <PlatinumIconBadge icon="call-outline" color={theme.success} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.detailRowText, { color: theme.success }]}> {selectedWycena.klient_telefon}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={S.detailRow}
                  onPress={() => { void openAddressInMaps(selectedWycena.adres || '', selectedWycena.miasto || ''); }}
                >
                  <PlatinumIconBadge icon="map-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.detailRowText, { color: theme.accent }]}> {selectedWycena.adres}, {selectedWycena.miasto}</Text>
                </TouchableOpacity>
                {selectedWycena.oddzial_nazwa ? (
                  <View style={S.detailRow}>
                    <PlatinumIconBadge icon="business-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={S.detailRowText}> {selectedWycena.oddzial_nazwa}</Text>
                  </View>
                ) : null}
                {selectedWycena.autor_nazwa ? (
                  <View style={S.detailRow}>
                    <PlatinumIconBadge icon="person-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={S.detailRowText}> {selectedWycena.autor_nazwa}</Text>
                  </View>
                ) : null}

                {/* Pozycje */}
                {selectedWycena.pozycje && Array.isArray(selectedWycena.pozycje) && selectedWycena.pozycje.length > 0 ? (
                  <View style={S.detailSection}>
                    <Text style={S.detailSectionTitle}>{t('wyceny.detail.workDesc')}</Text>
                    {selectedWycena.pozycje.map((p: any, i: number) => (
                      <View key={i} style={S.detailPozycjaRow}>
                        <Text style={S.detailPozycjaOpis}>{p.opis}</Text>
                        <Text style={[S.detailPozycjaKwota, { color: theme.accent }]}>{parseFloat(p.kwota || 0).toLocaleString(numberLocale)} {t('wyceny.currency')}</Text>
                      </View>
                    ))}
                    {selectedWycena.wartosc_szacowana && (
                      <View style={[S.detailPozycjaRow, { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 6, paddingTop: 6 }]}>
                        <Text style={[S.detailPozycjaOpis, { fontWeight: '700', color: theme.text }]}>{t('wyceny.detail.total')}</Text>
                        <Text style={[S.detailPozycjaKwota, { color: theme.accent, fontWeight: '700', fontSize: 16 }]}>
                          {parseFloat(selectedWycena.wartosc_szacowana).toLocaleString(numberLocale)} {t('wyceny.currency')}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}

                {/* Parametry */}
                <View style={S.detailSection}>
                  <Text style={S.detailSectionTitle}>{t('wyceny.detail.params')}</Text>
                  <View style={S.paramGrid}>
                    {[
                      { label: t('wyceny.param.haul'), val: selectedWycena.wywoz },
                      { label: t('wyceny.param.stumps'), val: selectedWycena.usuwanie_pni },
                      { label: t('wyceny.param.wood'), val: selectedWycena.drewno },
                      { label: t('wyceny.param.time'), val: selectedWycena.czas_realizacji, text: true },
                      { label: t('wyceny.param.crew'), val: selectedWycena.ilosc_osob, text: true },
                      { label: t('wyceny.param.chips'), val: selectedWycena.zrebki, text: true },
                    ].map((p, i) => (
                      <View key={i} style={[S.paramCard, { backgroundColor: theme.surface2 }]}>
                        <Text style={S.paramLabel}>{p.label}</Text>
                        <Text style={[S.paramValue, { color: p.val ? theme.success : theme.textMuted }]}>
                          {p.text ? (p.val ?? t('wyceny.param.dash')) : (p.val ? t('wyceny.param.yes') : t('wyceny.param.no'))}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Sprzęt */}
                {sprzetOptions.filter(s => selectedWycena[s.key]).length > 0 ? (
                  <View style={S.detailSection}>
                    <Text style={S.detailSectionTitle}>{t('wyceny.detail.equipment')}</Text>
                    <View style={S.sprzetDetailRow}>
                      {sprzetOptions.filter(s => selectedWycena[s.key]).map(s => (
                        <View key={s.key} style={[S.sprzetDetailChip, { backgroundColor: theme.success + '22' }]}>
                          <PlatinumIconBadge icon={s.icon} color={theme.success} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                          <Text style={[S.sprzetDetailText, { color: theme.success }]}> {s.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* Finanse */}
                {(selectedWycena.budzet || selectedWycena.rabat || selectedWycena.kwota_minimalna) ? (
                  <View style={S.detailSection}>
                    <Text style={S.detailSectionTitle}>{t('wyceny.detail.finance')}</Text>
                    {selectedWycena.budzet ? <Text style={S.detailRowText}>{t('wyceny.detail.budgetLine')} {parseFloat(selectedWycena.budzet).toLocaleString(numberLocale)} {t('wyceny.currency')}</Text> : null}
                    {selectedWycena.rabat ? <Text style={S.detailRowText}>{t('wyceny.detail.discountLine')} {selectedWycena.rabat}%</Text> : null}
                    {selectedWycena.kwota_minimalna ? <Text style={S.detailRowText}>{t('wyceny.detail.minLine')} {parseFloat(selectedWycena.kwota_minimalna).toLocaleString(numberLocale)} {t('wyceny.currency')}</Text> : null}
                  </View>
                ) : null}

                {/* Mapa */}
                {selectedWycena.lat && selectedWycena.lon ? (
                  <TouchableOpacity style={[S.mapsBtn, { backgroundColor: theme.infoBg }]}
                    onPress={() => Linking.openURL(`https://maps.google.com/?q=${selectedWycena.lat},${selectedWycena.lon}`)}>
                    <PlatinumIconBadge icon="map-outline" color={theme.info} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.mapsBtnText, { color: theme.info }]}> {t('wyceny.openMaps')}</Text>
                  </TouchableOpacity>
                ) : null}

                {/* Zdjęcia */}
                {loadingDetail ? <ActivityIndicator color={theme.accent} style={{ margin: 16 }} />
                : detailPhotos.length > 0 ? (
                  <View style={S.detailSection}>
                    <Text style={S.detailSectionTitle}>{t('wyceny.photosTitle', { n: detailPhotos.length })}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {detailPhotos.map((p: any, i: number) => (
                        <View key={i} style={S.detailPhoto}>
                          <Image source={{ uri: `${API_BASE_URL}${p.url}` }} style={S.detailPhotoImg} />
                          <TouchableOpacity style={[S.drawPhotoBtn, { backgroundColor: theme.surface3 }]}
                            onPress={() => { setShowDetail(false); router.push(`/wycena-rysuj?uri=${encodeURIComponent(`${API_BASE_URL}${p.url}`)}&wycenaId=${selectedWycena.id}`); }}>
                            <PlatinumIconBadge icon="pencil" color={theme.text} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                            <Text style={[S.drawPhotoBtnText, { color: theme.text }]}> {t('wyceny.btn.draw')}</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {/* Zmiana statusu */}
                {isManager && (
                  <View style={S.detailSection}>
                    <Text style={S.detailSectionTitle}>{t('wyceny.detail.changeStatus')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {Object.entries(statusKolor).filter(([k]) => k !== 'Zlecenie').map(([key, color]) => (
                        <TouchableOpacity key={key} style={[S.statusChip, { backgroundColor: color }]}
                          onPress={() => changeStatus(selectedWycena.id, key)}>
                          <Text style={S.statusChipText}>{quoteStatusLabel(key, t)}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Konwertuj */}
                {isManager && selectedWycena.status === 'Zaakceptowana' && (
                  <Animated.View style={{ transform: [{ scale: convertPulse }] }}>
                    <TouchableOpacity style={[S.convertBtn, { backgroundColor: theme.success }]}
                      onPress={() => convertToZlecenie(selectedWycena)}>
                      <PlatinumIconBadge icon="arrow-forward-circle-outline" color={theme.accentText} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      <Text style={S.convertBtnText}> {t('wyceny.btn.convert')}</Text>
                    </TouchableOpacity>
                  </Animated.View>
                )}

                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardSafeScreen>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },

  // Header
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', marginRight: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: t.headerText },
  headerSub: { fontSize: 11, color: t.headerSub },
  newBtn: {
    minWidth: 120,
    borderRadius: 12,
  },

  // Oddziały
  oddzialyScroll: { backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border },
  oddzialyContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  oddzialChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surface2 },
  oddzialChipText: { fontSize: 12, color: t.textSub, fontWeight: '600' },

  // Lista
  list: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  empty: { alignItems: 'center', paddingTop: 70, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 13, color: t.textMuted, textAlign: 'center' },

  wycenaCard: {
    flexDirection: 'row', backgroundColor: t.cardBg,
    borderRadius: 14, marginBottom: 10,
    borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.65,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
  },
  wycenaStripe: { width: 4 },
  wycenaContent: { flex: 1, padding: 12 },
  wycenaTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  wycenaKlient: { fontSize: 15, fontWeight: '700', color: t.text, flex: 1, marginRight: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  metaText: { fontSize: 12, color: t.textSub },
  wycenaBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' },
  wycenaCena: { fontSize: 13, fontWeight: '700', color: t.accent },
  wynikBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  wynikText: { fontSize: 11, fontWeight: '600' },
  wycenaDate: { fontSize: 11, color: t.textMuted, marginLeft: 'auto' },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  // Drawing overlay
  drawToolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.headerBg, paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  drawToolBtn: { alignItems: 'center', gap: 2 },
  drawToolBtnText: { color: t.textMuted, fontSize: 10 },
  drawToolbarTitle: { color: t.headerText, fontSize: 16, fontWeight: '700' },
  drawSaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.success, borderRadius: t.radiusMd,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  drawSaveBtnText: { color: t.accentText, fontWeight: '700', fontSize: 13 },
  drawBottom: { backgroundColor: t.surface, paddingBottom: 28, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.border },
  colorRow: { paddingHorizontal: 12, marginBottom: 8 },
  colorDot: { width: 32, height: 32, borderRadius: 16, marginRight: 8, borderWidth: 2 },
  colorDotActive: { borderColor: t.text, borderWidth: 3, transform: [{ scale: 1.15 }] },
  eraserBtn: {
    width: 32, height: 32, borderRadius: 8, marginRight: 8,
    backgroundColor: t.surface2, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: t.border,
  },
  eraserBtnActive: { borderColor: t.text, backgroundColor: t.surface3 },
  drawActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  gruboscRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gruboscBtn: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: t.surface2, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: t.border,
  },
  gruboscBtnActive: { borderColor: t.text, backgroundColor: t.surface3 },
  gruboscLine: { width: 24, borderRadius: 4 },
  undoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  undoBtnText: { color: t.textSub, fontSize: 13, fontWeight: '600' },

  // Modal nowej wyceny
  modalRoot: { flex: 1, backgroundColor: t.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: t.headerBg, paddingTop: 54, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: t.headerText },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: t.accent },
  modalBody: { flex: 1 },

  // Karty formularza
  card: {
    backgroundColor: t.surface, marginHorizontal: 14, marginTop: 14,
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.border,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: t.text, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHint: { fontSize: 12, color: t.textMuted, marginBottom: 10 },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: t.accentLight },
  gpsBtnText: { fontSize: 12, fontWeight: '600' },
  gpsInfo: { fontSize: 12, marginBottom: 8, fontWeight: '500' },
  input: {
    backgroundColor: t.inputBg, borderWidth: 1, borderColor: t.inputBorder,
    borderRadius: 12, padding: 12, fontSize: 14, color: t.inputText, marginBottom: 10,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  label: { fontSize: 12, fontWeight: '600', color: t.textSub, marginBottom: 8, marginTop: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surface2, marginRight: 8, marginBottom: 4,
  },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontSize: 12, color: t.textSub, fontWeight: '600' },
  chipTextActive: { color: t.accentText },

  // Zdjęcia
  photoBtns: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1.5, borderColor: t.border, borderStyle: 'dashed',
    backgroundColor: t.surface2,
  },
  photoBtnText: { fontSize: 12, color: t.textSub, fontWeight: '600' },
  thumb: { position: 'relative', marginRight: 8 },
  thumbImg: { width: 72, height: 72, borderRadius: 10 },
  thumbAnnotated: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: t.info, borderRadius: 6, padding: 3,
  },
  thumbRemove: {
    position: 'absolute', top: -5, right: -5,
    backgroundColor: t.danger, borderRadius: 9, width: 18, height: 18,
    justifyContent: 'center', alignItems: 'center',
  },

  // Pozycje
  pozycjaRow: { marginBottom: 4 },
  pozycjaOpis: { marginBottom: 4 },
  pozycjaKwotaWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pozycjaKwota: { flex: 1, marginBottom: 0 },
  removePozycjaBtn: { padding: 8 },
  addPozycjaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addPozycjaBtnText: { fontSize: 13, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 10, padding: 12, marginTop: 8,
  },
  totalLabel: { fontSize: 14, fontWeight: '600' },
  totalCena: { fontSize: 18, fontWeight: '800' },

  // Toggles (logistyka)
  toggleGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  toggleBtn: {
    flex: 1, minWidth: '30%', alignItems: 'center', gap: 4, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surface2,
  },
  toggleBtnOn: { backgroundColor: t.accent, borderColor: t.accent },
  toggleText: { fontSize: 11, color: t.textSub, fontWeight: '600' },
  toggleState: { fontSize: 10, color: t.textMuted },

  // Stepper
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 6 },
  stepBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stepValue: { fontSize: 22, fontWeight: '800', color: t.text, minWidth: 40, textAlign: 'center' },

  // Sprzęt
  sprzetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sprzetBtn: {
    width: '47%', alignItems: 'center', gap: 4, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surface2,
  },
  sprzetBtnOn: { backgroundColor: t.accent, borderColor: t.accent },
  sprzetLabel: { fontSize: 12, color: t.textSub, fontWeight: '600', textAlign: 'center' },
  sprzetState: { fontSize: 10, color: t.textMuted },

  // Wynik
  wynikRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wynikBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.surface2,
  },
  wynikBtnText: { fontSize: 13, fontWeight: '600', color: t.textSub },

  // Finanse
  finRow: { flexDirection: 'row' },

  // Zapisz główny
  saveMainBtn: { marginHorizontal: 14, marginTop: 14 },

  // Szczegóły modal
  overlayBg: { flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' },
  detailBox: {
    backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 22, paddingBottom: 34, maxHeight: '92%',
  },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  detailTitle: { fontSize: 18, fontWeight: '800', color: t.text },
  detailRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  detailRowText: { fontSize: 14, color: t.textSub, flex: 1 },
  detailSection: { marginTop: 14 },
  detailSectionTitle: { fontSize: 13, fontWeight: '700', color: t.textSub, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailPozycjaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  detailPozycjaOpis: { fontSize: 13, color: t.text, flex: 1 },
  detailPozycjaKwota: { fontSize: 13, fontWeight: '600' },
  paramGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paramCard: { borderRadius: 10, padding: 10, minWidth: 80, alignItems: 'center' },
  paramLabel: { fontSize: 10, color: t.textMuted, marginBottom: 3 },
  paramValue: { fontSize: 14, fontWeight: '700' },
  sprzetDetailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sprzetDetailChip: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  sprzetDetailText: { fontSize: 12, fontWeight: '600' },
  mapsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: 12, marginTop: 12 },
  mapsBtnText: { fontSize: 14, fontWeight: '600' },
  detailPhoto: { marginRight: 8 },
  detailPhotoImg: { width: 120, height: 90, borderRadius: 10 },
  drawPhotoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: 5, marginTop: 4 },
  drawPhotoBtnText: { fontSize: 11, fontWeight: '600' },
  statusChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  statusChipText: { color: t.accentText, fontWeight: '700', fontSize: 12 },
  convertBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, padding: 14, marginTop: 12 },
  convertBtnText: { color: t.accentText, fontWeight: '700', fontSize: 15 },
});
