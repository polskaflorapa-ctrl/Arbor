import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { EmptyState, ErrorBanner } from '../components/ui/app-state';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { PlatinumFilterChip } from '../components/ui/platinum-filter-chip';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumPressable } from '../components/ui/platinum-pressable';
import { ScreenHeader } from '../components/ui/screen-header';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';

const STATUSY = ['', 'Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane'];

export default function ZleceniaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/zlecenia');
  const [user, setUser] = useState<any>(null);
  const [zlecenia, setZlecenia] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filtrStatus, setFiltrStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const statusKolor = useMemo(() => ({
    Nowe: theme.success,
    Zaplanowane: theme.info,
    W_Realizacji: theme.warning,
    Zakonczone: theme.accent,
    Anulowane: theme.danger,
  }), [theme]);

  const statusLabel = useCallback(
    (code: string) => t(`zlecenia.status.${code || 'all'}`),
    [t],
  );

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const { token, user: parsedUser } = await getStoredSession();
      if (!token) { router.replace('/login'); return; }
      if (parsedUser) setUser(parsedUser);
      const rola = parsedUser?.rola;
      const endpoint = (rola === 'Pomocnik' || rola === 'Brygadzista')
        ? `${API_URL}/tasks/moje` : `${API_URL}/tasks/wszystkie`;
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = Array.isArray(d) ? d : [];
        setZlecenia(list);
        setFiltered(list);
      } else {
        setError(t('zlecenia.errorServer', { status: res.status, detail: d.error || '—' }));
      }
    } catch (e: any) {
      setError(t('zlecenia.errorConnection', { detail: e.message || '' }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    let wynik = zlecenia;
    if (search) {
      wynik = wynik.filter(z =>
        z.klient_nazwa?.toLowerCase().includes(search.toLowerCase()) ||
        z.adres?.toLowerCase().includes(search.toLowerCase()) ||
        z.miasto?.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (filtrStatus) wynik = wynik.filter(z => z.status === filtrStatus);
    setFiltered(wynik);
  }, [search, filtrStatus, zlecenia]);

  const isBrygadzista = user?.rola === 'Brygadzista';
  const isPomocnik = user?.rola === 'Pomocnik';
  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;
  }

  if (loading) return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;

  return (
    <KeyboardSafeScreen style={S.root}>
      <View pointerEvents="none" style={S.bgOrbTop} />
      <View pointerEvents="none" style={S.bgOrbBottom} />
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />

      <ScreenHeader
        title={t('zlecenia.title')}
        right={
          !isBrygadzista && !isPomocnik ? (
            <PlatinumCTA
              label="+"
              style={S.headerAddBtn}
              onPress={() => {
                void triggerHaptic('light');
                router.push('/nowe-zlecenie');
              }}
            />
          ) : null
        }
      />
      <View style={S.platinumBar}>
        <PlatinumIconBadge icon="diamond-outline" color={theme.accent} size={10} style={S.platinumBarIcon} />
        <Text style={S.platinumBarText}>Platinum Task Console</Text>
      </View>

      {/* Wyszukiwarka */}
      <View style={S.searchRow}>
        <PlatinumIconBadge icon="search-outline" color={theme.textMuted} size={11} style={S.searchIconBadge} />
        <TextInput
          style={S.searchInput}
          placeholder={t('zlecenia.searchPlaceholder')}
          placeholderTextColor={theme.inputPlaceholder}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
            <TouchableOpacity onPress={() => { void triggerHaptic('light'); setSearch(''); }}>
            <PlatinumIconBadge icon="close-circle" color={theme.textMuted} size={10} style={S.clearIconBadge} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filtry */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={S.filtryScroll} contentContainerStyle={S.filtryContent}>
        {STATUSY.map(s => (
          <PlatinumFilterChip
            key={s}
            style={S.filtrBtn}
            active={filtrStatus === s}
            color={theme.accent}
            label={statusLabel(s)}
            onPress={() => {
              void triggerHaptic('light');
              setFiltrStatus(s);
            }}
          />
        ))}
      </ScrollView>

      {/* Błąd */}
      {error ? <ErrorBanner message={error} /> : null}

      {/* Licznik */}
      <View style={S.counterRow}>
        <Text style={S.counterText}>{t('zlecenia.count', { count: filtered.length })}</Text>
      </View>

      {/* Lista */}
      <ScrollView style={S.list} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={theme.accent} colors={[theme.accent]} />}>
        {filtered.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            iconColor={theme.textMuted}
            title={t('zlecenia.emptyTitle')}
            subtitle={search ? t('zlecenia.emptySubtitleSearch') : t('zlecenia.emptySubtitleNone')}
          />
        ) : filtered.map((z, i) => {
          const kolor = statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted;
          return (
            <PlatinumAppear key={z.id} delayMs={20 * Math.min(i, 8)}>
              <PlatinumPressable style={S.card}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(`/zlecenie/${z.id}`);
                }}>
                <View style={[S.cardStripe, { backgroundColor: kolor }]} />
                <View style={S.cardContent}>
                  <View style={S.cardTop}>
                    <Text style={S.cardId}>#{z.id}</Text>
                    <View style={[S.badge, { backgroundColor: kolor + '28' }]}>
                      <Text style={[S.badgeText, { color: kolor }]}>{statusLabel(z.status) || z.status}</Text>
                    </View>
                  </View>
                  <Text style={S.cardKlient}>{z.klient_nazwa}</Text>
                  <View style={S.metaRow}>
                    <PlatinumIconBadge icon="location-outline" color={theme.textSub} size={11} style={S.metaIconBadge} />
                    <Text style={S.metaText}> {z.adres}, {z.miasto}</Text>
                  </View>
                  <View style={S.cardBottom}>
                    {z.typ_uslugi ? <View style={S.typChip}><Text style={S.typText}>{z.typ_uslugi}</Text></View> : null}
                    {z.data_planowana ? (
                      <View style={S.metaRow}>
                        <PlatinumIconBadge icon="calendar-outline" color={theme.textMuted} size={10} style={S.metaIconBadge} />
                        <Text style={S.dateText}> {z.data_planowana.split('T')[0]}</Text>
                      </View>
                    ) : null}
                    {!isBrygadzista && !isPomocnik && z.wartosc_planowana ? (
                      <Text style={S.wartosc}>{parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN</Text>
                    ) : null}
                  </View>
                  {z.ekipa_nazwa ? (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="people-outline" color={theme.textMuted} size={10} style={S.metaIconBadge} />
                      <Text style={S.metaSmall}> {z.ekipa_nazwa}</Text>
                    </View>
                  ) : null}
                </View>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={9} style={S.chevronBadge} />
              </PlatinumPressable>
            </PlatinumAppear>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  bgOrbTop: {
    position: 'absolute',
    top: -120,
    right: -90,
    width: 250,
    height: 250,
    borderRadius: 140,
    backgroundColor: t.accent + '22',
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: 120,
    left: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: t.chartCyan + '15',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  headerAddBtn: { minWidth: 46, minHeight: 40, paddingHorizontal: 0 },
  platinumBar: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: t.accent + '88',
    backgroundColor: t.accent + '1F',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.35,
    shadowRadius: t.shadowRadius * 0.6,
    shadowOffset: { width: 0, height: 3 },
    elevation: t.cardElevation,
  },
  platinumBarIcon: { width: 22, height: 22, borderRadius: 8 },
  platinumBarText: {
    color: t.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surface2,
    borderBottomWidth: 1, borderBottomColor: t.border,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 9,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.28,
    shadowRadius: t.shadowRadius * 0.55,
    shadowOffset: { width: 0, height: 3 },
    elevation: t.cardElevation,
  },
  searchIconBadge: { width: 22, height: 22, borderRadius: 8, marginRight: 8 },
  clearIconBadge: { width: 22, height: 22, borderRadius: 8 },
  searchInput: { flex: 1, fontSize: 15, color: t.inputText, height: 40 },
  filtryScroll: { backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border, marginTop: 8 },
  filtryContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  filtrBtn: {},
  counterRow: {
    backgroundColor: t.surface, paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  counterText: { fontSize: 12, color: t.textMuted, fontWeight: '600' },
  list: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 13, color: t.textMuted },
  card: {
    flexDirection: 'row', backgroundColor: t.cardBg,
    borderRadius: 18, marginBottom: 12,
    borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.72,
    shadowRadius: t.shadowRadius * 1.05,
    shadowOffset: { width: 0, height: t.shadowOffsetY + 1 },
    elevation: t.cardElevation + 1,
  },
  cardStripe: { width: 4 },
  cardContent: { flex: 1, padding: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardId: { fontSize: 12, color: t.textMuted, fontWeight: '600' },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  cardKlient: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  metaIconBadge: { width: 20, height: 20, borderRadius: 7 },
  metaText: { fontSize: 12, color: t.textSub, flex: 1 },
  metaSmall: { fontSize: 11, color: t.textMuted },
  cardBottom: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 },
  typChip: { backgroundColor: t.surface2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typText: { fontSize: 11, color: t.textSub, fontWeight: '600' },
  dateText: { fontSize: 11, color: t.textMuted },
  wartosc: { fontSize: 12, color: t.accent, fontWeight: '700' },
  chevronBadge: { width: 22, height: 22, borderRadius: 8, alignSelf: 'center', marginRight: 6 },
});
