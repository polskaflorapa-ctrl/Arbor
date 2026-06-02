/**
 * ARBOR-OS: Moduł Wycen v2
 * Dostęp: Wyceniający (własne), Dyrektor/Administrator (wszystkie), Kierownik (swój oddział)
 *
 * Funkcje:
 * - Gabinet wycen podzielony po oddziałach
 * - Szybki formularz z checklistą sprzętu, pozycjami cenowymi, wynikiem wizyty
 * - Podgląd, filtrowanie i konwersja zatwierdzonych wycen
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Linking,
  Modal, Platform, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { AppStatusBar } from '../components/ui/app-status-bar';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { PLATINUM_MOTION } from '../constants/motion';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_BASE_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession, type StoredUser } from '../utils/session';
import { getRoleDisplayName } from '../utils/role-display';
import { filterQuotesForEstimatorRole } from '../utils/estimator-compensation';
import { openAddressInMaps } from '../utils/maps-link';
import { triggerHaptic } from '../utils/haptics';
import { apiFetch, apiJsonFetch } from '../utils/api-client';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { safeBack } from '../utils/navigation';

// ─── Typy ─────────────────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// ─── Stałe ────────────────────────────────────────────────────────────────────
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

// ─── Pusty formularz ──────────────────────────────────────────────────────────
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
  const [user, setUser] = useState<StoredUser | null>(null);
  const [wyceny, setWyceny] = useState<any[]>([]);
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [selectedOddzial, setSelectedOddzial] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Detail
  const [selectedWycena, setSelectedWycena] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailPhotos, setDetailPhotos] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const convertPulse = useRef(new Animated.Value(1)).current;
  const listOpacity = useRef(new Animated.Value(1)).current;

  const getToken = useCallback(async () => {
    if (token) return token;
    const { token: storedToken } = await getStoredSession();
    return storedToken;
  }, [token]);

  const fetchWyceny = useCallback(
    async (tokenOverride?: string | null, sessionUser?: { id?: string | number; rola?: string } | null) => {
      try {
        const authTok = tokenOverride || await getToken();
        const u = sessionUser ?? user;
        const params = selectedOddzial ? `?oddzial_id=${selectedOddzial}` : '';
        const res = await apiFetch(`/wyceny${params}`, { token: authTok });
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
      const res = await apiFetch('/oddzialy', { token: authTok });
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
      if (!canAccess) {
        safeBack();
        return;
      }

      await Promise.all([fetchWyceny(storedToken, u), fetchOddzialy(storedToken)]);
    } catch { }
    finally { setLoading(false); }
  }, [fetchOddzialy, fetchWyceny]);

  useEffect(() => { void init(); }, [init]);

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

  const openUnifiedNewOrder = useCallback(() => {
    void triggerHaptic('light');
    router.push(buildNewOrderRoute({ source: 'wycena' }) as never);
  }, []);

  // Szczegóły
  const openDetail = async (w: any) => {
    setSelectedWycena(w); setShowDetail(true); setLoadingDetail(true);
    try {
      const token = await getToken();
      const res = await apiFetch(`/wyceny/${w.id}/zdjecia`, { token });
      if (res.ok) { const d = await res.json(); setDetailPhotos(Array.isArray(d) ? d : []); }
    } catch { }
    finally { setLoadingDetail(false); }
  };

  const changeStatus = async (id: number, status: string) => {
    try {
      const token = await getToken();
      await apiJsonFetch(`/wyceny/${id}/status`, {
        method: 'PATCH',
        token,
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
        const res = await apiFetch(`/wyceny/${w.id}/konwertuj`, { method: 'POST', token });
        if (res.ok) {
          const data = await res.json();
          setShowDetail(false); fetchWyceny();
          Alert.alert(t('wyceny.convertOkTitle'), t('wyceny.convertOkBody'));
          if (data.task_id) router.push(`/zlecenie/${data.task_id}`);
        } else Alert.alert(t('wyceny.alert.saveFail'), t('wyceny.convertFail'));
      }},
    ]);
  };

  const isManager = ['Dyrektor','Administrator','Kierownik'].includes(user?.rola ?? '');
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

  // ─── MAIN VIEW ────────────────────────────────────────────────────────────
  return (
    <KeyboardSafeScreen style={S.root}>
      <AppStatusBar />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => {
          safeBack();
        }} style={S.backBtn}>
          <PlatinumIconBadge icon="arrow-back" color={theme.headerText} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>{t('wyceny.title')}</Text>
          {user?.rola && <Text style={S.headerSub}>{getRoleDisplayName(user.rola)}</Text>}
        </View>
        <PlatinumCTA
          label={t('wyceny.header.newBtn')}
          style={S.newBtn}
          onPress={openUnifiedNewOrder}
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
              onPress={openUnifiedNewOrder}
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
  backBtn: { width: 48, height: 48, justifyContent: 'center', marginRight: 4 },
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
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.1,
      radius: t.shadowRadius * 0.34,
      offsetY: 1,
      elevation: 1,
    }),
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
  detailSectionTitle: { fontSize: 13, fontWeight: '700', color: t.textSub, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0 },
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
