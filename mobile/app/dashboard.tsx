import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { DashboardSkeleton } from '../components/ui/skeleton-block';
import { PlatinumCard } from '../components/ui/platinum-card';
import { elevationCard } from '../constants/elevation';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import {
  getOddzialFeatureConfig,
  isFeatureEnabledForOddzial,
  sortPathsByOddzialPriority,
} from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';
import { openAddressInMaps } from '../utils/maps-link';
import { triggerHaptic } from '../utils/haptics';

// ─── Typy ikon Ionicons ────────────────────────────────────────────────────────
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface QuickAction {
  label: string;
  icon: IoniconName;
  path: string;
  color: string;
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const { language, t } = useLanguage();
  const [user, setUser] = useState<any>(null);
  const [zlecenia, setZlecenia] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ nowe: 0, w_realizacji: 0, zakonczone: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { user: u, token } = await getStoredSession();
      if (!u || !token) { router.replace('/login'); return; }
      setUser(u);
      const h = { Authorization: `Bearer ${token}` };

      // Wyceniający nie ma dostępu do zleceń — skip fetching
      if (u.rola === 'Wyceniający') return;

      const endpoint = (u.rola === 'Brygadzista' || u.rola === 'Pomocnik')
        ? `${API_URL}/tasks/moje` : `${API_URL}/tasks/wszystkie`;

      const [zRes, sRes] = await Promise.all([
        fetch(endpoint, { headers: h }),
        fetch(`${API_URL}/tasks/stats`, { headers: h }),
      ]);
      if (zRes.ok) { const d = await zRes.json(); setZlecenia(Array.isArray(d) ? d : []); }
      if (sRes.ok) setStats(await sRes.json());
    } catch { /* ignoruj błędy sieciowe */ }
    finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const rola = user?.rola || '';
  const isDyrektor   = rola === 'Dyrektor' || rola === 'Administrator';
  const isKierownik  = rola === 'Kierownik';
  const isBrygadzista= rola === 'Brygadzista';
  const isSpecjalista= rola === 'Specjalista';
  const isWyceniajacy= rola === 'Wyceniający';
  const isPomocnik   = rola === 'Pomocnik';
  const isPomBez     = rola === 'Pomocnik bez doświadczenia';
  const isMagazynier = rola === 'Magazynier';

  const delayedCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return zlecenia.filter((z) => {
      if (!z.data_planowana) return false;
      const raw = typeof z.data_planowana === 'string' ? z.data_planowana.split('T')[0] : '';
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      if (d >= today) return false;
      const st = z.status || '';
      return st !== 'Zakonczone' && st !== 'Anulowane';
    }).length;
  }, [zlecenia]);

  const statusKolor = useMemo(() => ({
    Nowe: theme.success,
    Zaplanowane: theme.info,
    W_Realizacji: theme.warning,
    Zakonczone: theme.accent,
    Anulowane: theme.danger,
  }), [theme]);

  const rolaKolor = useMemo(() => ({
    Dyrektor: theme.chartViolet,
    Administrator: theme.warning,
    Kierownik: theme.info,
    Brygadzista: theme.success,
    Specjalista: theme.chartCyan,
    Wyceniający: theme.chartViolet,
    Pomocnik: theme.textMuted,
    'Pomocnik bez doświadczenia': theme.textSub,
    Magazynier: theme.warning,
  }), [theme]);

  const quickActions: QuickAction[] = [
    { label: 'Tryb Dzisiaj', icon: 'navigate-circle-outline' as IoniconName, path: '/misja-dnia', color: theme.accent },
    // ── Dyrektor / Administrator / Kierownik ──
    ...(isDyrektor || isKierownik ? [
      { label: 'Autoplan dnia',     icon: 'sparkles-outline' as IoniconName,      path: '/autoplan-dnia',     color: theme.chartViolet },
      { label: 'Nowe zlecenie',     icon: 'add-circle-outline' as IoniconName,    path: '/nowe-zlecenie',    color: theme.success },
      { label: 'Harmonogram',       icon: 'calendar-outline' as IoniconName,       path: '/harmonogram',      color: theme.warning },
      { label: 'Użytkownicy',       icon: 'people-outline' as IoniconName,         path: '/uzytkownicy-mobile', color: theme.info },
      { label: 'Oddziały',          icon: 'business-outline' as IoniconName,       path: '/oddzialy-mobile',  color: theme.accent },
      { label: 'Flota',             icon: 'car-outline' as IoniconName,            path: '/flota-mobile',     color: theme.danger },
      { label: 'Rezerwacje sprzętu', icon: 'calendar-number-outline' as IoniconName, path: '/rezerwacje-sprzetu', color: theme.chartCyan },
      { label: 'Blokady kalendarza', icon: 'ban-outline' as IoniconName, path: '/blokady-kalendarza', color: theme.warning },
      { label: 'Potwierdzenia ekip', icon: 'people-circle-outline' as IoniconName, path: '/potwierdzenia-ekip', color: theme.success },
      { label: 'KPI autoplan (tydzień)', icon: 'stats-chart-outline' as IoniconName, path: '/kpi-tydzien', color: theme.chartCyan },
      { label: 'Magazyn',           icon: 'cube-outline' as IoniconName,           path: '/magazyn-mobile',   color: theme.chartCyan },
      { label: 'Oględziny',         icon: 'search-outline' as IoniconName,           path: '/ogledziny',        color: theme.info },
      { label: 'Kal. wycen',        icon: 'calculator-outline' as IoniconName,       path: '/wycena-kalendarz', color: theme.chartViolet },
      { label: 'Zatwierdź wyceny',  icon: 'checkmark-circle-outline' as IoniconName, path: '/zatwierdz-wyceny', color: theme.warning },
      { label: 'Raporty',           icon: 'bar-chart-outline' as IoniconName,      path: '/raporty-mobilne',  color: theme.info },
      { label: 'Rozliczenia',       icon: 'wallet-outline' as IoniconName,         path: '/rozliczenia',      color: theme.success },
      { label: 'Funkcje oddziałów', icon: 'settings-outline' as IoniconName,       path: '/oddzial-funkcje-admin', color: theme.warning },
    ] : []),
    // ── Widok zleceń dla wszystkich (poza Wyceniającym i Magazynierem) ──
    ...(!isWyceniajacy && !isMagazynier ? [
      { label: 'Zlecenia', icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', color: theme.chartViolet },
    ] : []),
    // ── Brygadzista ──
    ...(isBrygadzista ? [
      { label: 'Raport dzienny', icon: 'document-text-outline' as IoniconName, path: '/raport-dzienny', color: theme.success },
      { label: 'Oględziny',      icon: 'search-outline' as IoniconName,        path: '/ogledziny',      color: theme.info },
      { label: 'Kal. wycen',    icon: 'calculator-outline' as IoniconName,    path: '/wycena-kalendarz', color: theme.chartViolet },
      { label: 'Rozliczenia',   icon: 'wallet-outline' as IoniconName,        path: '/rozliczenia',    color: theme.warning },
    ] : []),
    // ── Specjalista ──
    ...(isSpecjalista ? [
      { label: 'Kal. wycen',  icon: 'calculator-outline' as IoniconName, path: '/wycena-kalendarz', color: theme.chartCyan },
      { label: 'Raporty',     icon: 'bar-chart-outline' as IoniconName,  path: '/raporty-mobilne',  color: theme.info },
      { label: 'Rozliczenia', icon: 'wallet-outline' as IoniconName,     path: '/rozliczenia',      color: theme.warning },
    ] : []),
    // ── Wyceniający ──
    ...(isWyceniajacy ? [
      { label: 'Centrum wycen', icon: 'speedometer-outline' as IoniconName, path: '/wyceniajacy-hub', color: theme.accent },
      { label: 'Wynagrodzenie', icon: 'cash-outline' as IoniconName, path: '/wyceniajacy-finanse', color: theme.success },
      { label: 'Oględziny',    icon: 'search-outline' as IoniconName,      path: '/ogledziny',       color: theme.info },
      { label: 'Kal. wycen',  icon: 'calendar-outline' as IoniconName,    path: '/wycena-kalendarz', color: theme.chartViolet },
      { label: 'Nowa wycena', icon: 'add-circle-outline' as IoniconName,  path: '/wycena-kalendarz', color: theme.success },
    ] : []),
    // ── Magazynier ──
    ...(isMagazynier ? [
      { label: 'Flota',        icon: 'car-outline' as IoniconName,       path: '/flota-mobile',  color: theme.warning },
      { label: 'Rezerwacje sprzętu', icon: 'calendar-number-outline' as IoniconName, path: '/rezerwacje-sprzetu', color: theme.chartCyan },
      { label: 'Blokady kalendarza', icon: 'ban-outline' as IoniconName, path: '/blokady-kalendarza', color: theme.warning },
      { label: 'Potwierdzenia ekip', icon: 'people-circle-outline' as IoniconName, path: '/potwierdzenia-ekip', color: theme.success },
      { label: 'KPI autoplan (tydzień)', icon: 'stats-chart-outline' as IoniconName, path: '/kpi-tydzien', color: theme.chartCyan },
      { label: 'Magazyn',     icon: 'cube-outline' as IoniconName,      path: '/magazyn-mobile', color: theme.chartCyan },
      { label: 'Harmonogram',  icon: 'calendar-outline' as IoniconName,  path: '/harmonogram',   color: theme.warning },
    ] : []),
    // ── Pomocnik ──
    ...(isPomocnik ? [
      { label: 'Moje godziny', icon: 'time-outline' as IoniconName, path: '/rozliczenia', color: theme.warning },
    ] : []),
    // ── Pomocnik bez doświadczenia ──
    ...(isPomBez ? [
      { label: 'Moje zlecenia', icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', color: theme.textMuted },
    ] : []),
    // ── Zawsze ──
    { label: 'Diagnostyka API', icon: 'pulse-outline' as IoniconName, path: '/api-diagnostyka', color: theme.info },
    { label: 'Powiadomienia', icon: 'notifications-outline' as IoniconName, path: '/powiadomienia', color: theme.textSub },
    { label: 'Profil',        icon: 'person-outline' as IoniconName,        path: '/profil',        color: theme.textSub },
  ];
  const oddzialConfig = getOddzialFeatureConfig(user?.oddzial_id);
  const quickActionsFiltered = (() => {
    const filtered = quickActions.filter((action) =>
      isFeatureEnabledForOddzial(user?.oddzial_id, action.path),
    );
    const orderedPaths = sortPathsByOddzialPriority(user?.oddzial_id, filtered.map((a) => a.path));
    const rank = new Map(orderedPaths.map((path, idx) => [path, idx]));
    return filtered.sort((a, b) => (rank.get(a.path) ?? 999) - (rank.get(b.path) ?? 999));
  })();

  const dzisiaj = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const dzisiajLocalized = new Date().toLocaleDateString(dateLocale, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const localizeQuickActionLabel = (label: string): string => {
    const keyMap: Record<string, string> = {
      'Tryb Dzisiaj': 'dashboard.todayMode',
      'Autoplan dnia': 'dashboard.autoplan',
      'Nowe zlecenie': 'dashboard.newTask',
      'Harmonogram': 'dashboard.schedule',
      'Użytkownicy': 'dashboard.users',
      'Oddziały': 'dashboard.branches',
      'Flota': 'dashboard.fleet',
      'Rezerwacje sprzętu': 'dashboard.equipmentReservations',
      'Blokady kalendarza': 'dashboard.calendarBlocks',
      'Potwierdzenia ekip': 'dashboard.crewConfirm',
      'KPI autoplan (tydzień)': 'dashboard.kpiWeek',
      'Magazyn': 'dashboard.warehouse',
      'Oględziny': 'dashboard.inspections',
      'Kal. wycen': 'dashboard.quoteCalendar',
      'Zatwierdź wyceny': 'dashboard.approveQuotes',
      'Raporty': 'dashboard.reports',
      'Rozliczenia': 'dashboard.settlements',
      'Funkcje oddziałów': 'dashboard.branchFeatures',
      'Zlecenia': 'dashboard.orders',
      'Raport dzienny': 'dashboard.dailyReport',
      'Centrum wycen': 'dashboard.estimateCenter',
      'Wynagrodzenie': 'dashboard.estimatorPay',
      'Nowa wycena': 'dashboard.newQuote',
      'Diagnostyka API': 'dashboard.apiDiagnostics',
      'Powiadomienia': 'dashboard.notifications',
      'Profil': 'dashboard.profile',
      'Moje godziny': 'dashboard.settlements',
      'Moje zlecenia': 'dashboard.orders',
    };
    const key = keyMap[label];
    return key ? t(key) : label;
  };

  const S = makeStyles(theme);

  if (loading) {
    return (
      <View style={S.root}>
        <StatusBar
          barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={theme.headerBg}
        />
        <DashboardSkeleton />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* ─── HEADER ─────────────────────────────────────────────────────────── */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <Text style={S.greeting}>{t('dashboard.greeting', { name: user?.imie || '' })}</Text>
          <Text style={S.date}>{dzisiajLocalized || dzisiaj}</Text>
          <View style={[S.rolaBadge, { backgroundColor: (rolaKolor[user?.rola as keyof typeof rolaKolor] || theme.accent) + '33' }]}>
            <Text style={[S.rolaText, { color: rolaKolor[user?.rola as keyof typeof rolaKolor] || theme.accent }]}>
              {user?.rola}
            </Text>
          </View>
          <Text style={S.oddzialText}>{oddzialConfig.name}</Text>
          <Text style={S.oddzialSub}>{oddzialConfig.mission}</Text>
        </View>
        <TouchableOpacity style={S.avatar} onPress={() => router.push('/profil')}>
          <Text style={S.avatarText}>{user?.imie?.[0]}{user?.nazwisko?.[0]}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={S.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {/* ─── KPI KARTY ─────────────────────────────────────────────────────── */}
        {!isWyceniajacy && <View style={S.statsRow}>
          {[
            { label: t('dashboard.stats.new'), value: stats.nowe || 0, color: theme.success, icon: 'flash-outline' as IoniconName },
            { label: t('dashboard.stats.progress'), value: stats.w_realizacji || 0, color: theme.warning, icon: 'sync-outline' as IoniconName },
            { label: t('dashboard.stats.done'), value: stats.zakonczone || 0, color: theme.info, icon: 'checkmark-circle-outline' as IoniconName },
            { label: t('dashboard.stats.total'), value: zlecenia.length, color: theme.accent, icon: 'list-outline' as IoniconName },
          ].map((s, i) => (
            <View key={i} style={[S.statCard, { borderTopColor: s.color }]}>
              <Ionicons name={s.icon} size={18} color={s.color} />
              <Text style={[S.statNum, { color: s.color }]}>{s.value}</Text>
              <Text style={S.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>}
        {!isWyceniajacy && delayedCount > 0 ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 14 }}>
              {t('dashboard.delayed')}: {delayedCount}
            </Text>
          </View>
        ) : null}

        <PlatinumCard style={[S.section, elevationCard(theme)]}>
          <Text style={S.sectionTitle}>{t('dashboard.branchMode')}</Text>
          <Text style={S.oddzialMission}>{oddzialConfig.mission}</Text>
          <Text style={S.oddzialFocus}>{t('dashboard.priority', { focus: oddzialConfig.focus })}</Text>
        </PlatinumCard>

        {/* ─── SZYBKI DOSTĘP ─────────────────────────────────────────────────── */}
        <PlatinumCard style={[S.section, elevationCard(theme)]}>
          <Text style={S.sectionTitle}>{t('dashboard.quickAccess')}</Text>
          <View style={S.quickGrid}>
            {quickActionsFiltered.map((a, i) => (
              <TouchableOpacity
                key={i}
                style={S.quickCard}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(a.path as any);
                }}
                activeOpacity={0.75}
              >
                <View style={[S.quickIconBg, { backgroundColor: a.color + '22' }]}>
                  <Ionicons name={a.icon} size={22} color={a.color} />
                </View>
                <Text style={S.quickLabel} numberOfLines={1}>{localizeQuickActionLabel(a.label)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </PlatinumCard>

        {/* ─── OSTATNIE ZLECENIA ──────────────────────────────────────────────── */}
        {!isWyceniajacy && <PlatinumCard style={[S.section, elevationCard(theme)]}>
          <View style={S.sectionHeader}>
            <Text style={S.sectionTitle}>
              {isPomocnik || isBrygadzista ? t('dashboard.myTasks') : t('dashboard.latestTasks')}
            </Text>
            <TouchableOpacity onPress={() => { void triggerHaptic('light'); router.push('/zlecenia'); }} style={S.seeAllBtn}>
              <Text style={S.seeAll}>{t('dashboard.seeAll')}</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.accent} />
            </TouchableOpacity>
          </View>

          {zlecenia.length === 0 ? (
            <View style={S.empty}>
              <Ionicons name="clipboard-outline" size={44} color={theme.textMuted} />
              <Text style={S.emptyTitle}>{t('dashboard.emptyOrders')}</Text>
              <Text style={S.emptySub}>
                {isPomocnik || isBrygadzista
                  ? t('dashboard.emptyOrdersSubBrygadzista')
                  : t('dashboard.emptyOrdersSubDefault')}
              </Text>
            </View>
          ) : (
            zlecenia.slice(0, 5).map(z => (
              <TouchableOpacity
                key={z.id}
                style={S.card}
                onPress={() => { void triggerHaptic('light'); router.push(`/zlecenie/${z.id}`); }}
                activeOpacity={0.8}
              >
                <View style={[S.cardAccent, { backgroundColor: statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted }]} />
                <View style={S.cardBody}>
                  <View style={S.cardTop}>
                    <Text style={S.cardId}>#{z.id}</Text>
                    <View style={[S.statusBadge, { backgroundColor: (statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted) + '28' }]}>
                      <Text style={[S.statusText, { color: statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted }]}>
                        {z.status?.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                  <Text style={S.cardKlient}>{z.klient_nazwa}</Text>
                  <View style={[S.cardMetaRow, { justifyContent: 'space-between' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Ionicons name="location-outline" size={12} color={theme.textSub} />
                      <Text style={S.cardAddr}> {z.adres}, {z.miasto}</Text>
                    </View>
                    {(z.adres || z.miasto) ? (
                      <TouchableOpacity
                        onPress={() => { void openAddressInMaps(z.adres || '', z.miasto || ''); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="map-outline" size={18} color={theme.accent} accessibilityLabel={t('dashboard.mapsHint')} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={S.cardBottom}>
                    {z.typ_uslugi ? (
                      <View style={S.typChip}>
                        <Text style={S.typChipText}>{z.typ_uslugi}</Text>
                      </View>
                    ) : null}
                    {!isPomocnik && !isBrygadzista && z.wartosc_planowana ? (
                      <Text style={S.cardWartosc}>
                        {parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN
                      </Text>
                    ) : null}
                  </View>
                  {z.ekipa_nazwa ? (
                    <View style={S.cardMetaRow}>
                      <Ionicons name="people-outline" size={12} color={theme.textSub} />
                      <Text style={S.cardEkipa}> {z.ekipa_nazwa}</Text>
                    </View>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} style={{ alignSelf: 'center' }} />
              </TouchableOpacity>
            ))
          )}
        </PlatinumCard>}

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* ─── DOLNA NAWIGACJA ────────────────────────────────────────────────── */}
      <View style={S.nav}>
        {([
          { icon: 'home', path: '/dashboard', labelKey: 'dashboard.nav.start' },
          ...(isWyceniajacy
            ? [{ icon: 'calculator-outline' as IoniconName, path: '/wycena', labelKey: 'dashboard.nav.quotes' }]
            : [{ icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', labelKey: 'dashboard.nav.orders' }]),
          ...(isBrygadzista || isDyrektor || isKierownik
            ? [{ icon: 'wallet-outline' as IoniconName, path: '/rozliczenia', labelKey: 'dashboard.nav.finance' }]
            : []),
          { icon: 'notifications-outline', path: '/powiadomienia', labelKey: 'dashboard.nav.alerts' },
          { icon: 'person-outline', path: '/profil', labelKey: 'dashboard.profile' },
        ] as { icon: IoniconName; path: string; labelKey: string }[])
          .filter((item) => item.path === '/dashboard' || isFeatureEnabledForOddzial(user?.oddzial_id, item.path))
          .map((n, i) => {
          const active = n.path === '/dashboard';
          return (
            <TouchableOpacity key={i} style={S.navBtn} onPress={() => router.push(n.path as any)}>
              <Ionicons
                name={n.icon}
                size={22}
                color={active ? theme.navActive : theme.navInactive}
              />
              <Text style={[S.navLabel, active && { color: theme.navActive }]}>
                {t(n.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },

  // Header
  header: {
    backgroundColor: t.headerBg,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  headerLeft: { flex: 1 },
  greeting: { fontSize: t.fontScreenTitle, fontWeight: '800', color: t.headerText, marginBottom: 2 },
  date: { fontSize: t.fontCaption, color: t.headerSub, marginBottom: 10, textTransform: 'capitalize' },
  rolaBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20,
  },
  rolaText: { fontSize: 12, fontWeight: '700' },
  oddzialText: { fontSize: 11, color: t.headerSub, marginTop: 6, fontWeight: '600' },
  oddzialSub: { fontSize: 11, color: t.headerSub, marginTop: 3 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: t.accent + '33',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: t.accent,
  },
  avatarText: { fontSize: 15, fontWeight: '800', color: t.accent },

  // Statystyki
  statsRow: {
    flexDirection: 'row',
    backgroundColor: t.surface,
    paddingHorizontal: 12, paddingVertical: 14,
    gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  statCard: {
    flex: 1, backgroundColor: t.surface2,
    borderRadius: t.radiusMd, padding: 10,
    alignItems: 'center', gap: 4,
    borderTopWidth: 3,
  },
  statNum: { fontSize: t.fontSection, fontWeight: '800' },
  statLabel: { fontSize: t.fontMicro, color: t.textMuted, textAlign: 'center' },

  // Sekcje
  section: {
    backgroundColor: t.surface,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: t.radiusXl, padding: 18,
    borderWidth: 1, borderColor: t.border,
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  sectionTitle: {
    fontSize: t.fontSection, fontWeight: '700',
    color: t.text,
  },
  oddzialMission: { fontSize: 14, fontWeight: '700', color: t.text, marginBottom: 4 },
  oddzialFocus: { fontSize: 12, color: t.textSub },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAll: { fontSize: 13, color: t.accent, fontWeight: '600' },

  // Quick grid
  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  quickCard: {
    width: '22%',
    alignItems: 'center',
    gap: 8,
  },
  quickIconBg: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: {
    fontSize: 11, fontWeight: '600',
    color: t.textSub, textAlign: 'center',
  },

  // Puste
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 13, color: t.textMuted, textAlign: 'center' },

  // Karty zleceń
  card: {
    flexDirection: 'row',
    backgroundColor: t.cardBg,
    borderRadius: t.radiusLg,
    borderWidth: 1, borderColor: t.cardBorder,
    marginBottom: 10, overflow: 'hidden',
    ...elevationCard(t),
  },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: 12 },
  cardTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 6,
  },
  cardId: { fontSize: 12, color: t.textMuted, fontWeight: '600' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardKlient: {
    fontSize: 15, fontWeight: '700',
    color: t.text, marginBottom: 4,
  },
  cardMetaRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 4,
  },
  cardAddr: { fontSize: 12, color: t.textSub, flex: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  typChip: {
    backgroundColor: t.surface2,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  typChipText: { fontSize: 11, color: t.textSub, fontWeight: '600' },
  cardWartosc: { fontSize: 12, color: t.accent, fontWeight: '700' },
  cardEkipa: { fontSize: 11, color: t.textMuted },

  // Dolna nawigacja
  nav: {
    flexDirection: 'row',
    backgroundColor: t.navBg,
    borderTopWidth: 1, borderTopColor: t.navBorder,
    paddingBottom: 28, paddingTop: 10,
    position: 'absolute', bottom: 0, left: 0, right: 0,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.55,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: -2 },
    elevation: t.cardElevation + 1,
  },
  navBtn: { flex: 1, alignItems: 'center', gap: 3 },
  navLabel: { fontSize: 10, color: t.navInactive, fontWeight: '700', letterSpacing: 0.2 },
});
