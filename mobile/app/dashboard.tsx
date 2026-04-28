import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { DashboardSkeleton } from '../components/ui/skeleton-block';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { PlatinumCard } from '../components/ui/platinum-card';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { PlatinumPressable } from '../components/ui/platinum-pressable';
import { elevationCard } from '../constants/elevation';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { getRolaColor, type Theme } from '../constants/theme';
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

type QuickCategoryId =
  | 'operations'
  | 'quotes'
  | 'fleetMagazyn'
  | 'reports'
  | 'finance'
  | 'administration'
  | 'account';

const QUICK_CATEGORY_ORDER: QuickCategoryId[] = [
  'operations',
  'quotes',
  'fleetMagazyn',
  'reports',
  'finance',
  'administration',
  'account',
];

function quickCategoryForAction(path: string, label: string): QuickCategoryId {
  if (path === '/profil' || path === '/powiadomienia' || path === '/api-diagnostyka') return 'account';
  if (['/uzytkownicy-mobile', '/oddzialy-mobile', '/oddzial-funkcje-admin'].includes(path)) return 'administration';
  if (path === '/wyceniajacy-finanse' || (path === '/rozliczenia' && label.includes('godzin'))) return 'finance';
  if (path === '/rozliczenia') return 'finance';
  if (['/raporty-mobilne', '/kpi-tydzien', '/raport-dzienny'].includes(path)) return 'reports';
  if (['/flota-mobile', '/rezerwacje-sprzetu', '/magazyn-mobile'].includes(path)) return 'fleetMagazyn';
  if (['/wycena-kalendarz', '/wyceny-terenowe', '/zatwierdz-wyceny', '/ogledziny', '/wyceniajacy-hub'].includes(path)) return 'quotes';
  return 'operations';
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
    Dyrektor: getRolaColor('Dyrektor'),
    Administrator: getRolaColor('Administrator'),
    Kierownik: getRolaColor('Kierownik'),
    Brygadzista: getRolaColor('Brygadzista'),
    Specjalista: getRolaColor('Specjalista'),
    Wyceniający: getRolaColor('Wyceniający'),
    Pomocnik: getRolaColor('Pomocnik'),
    'Pomocnik bez doświadczenia': getRolaColor('Pomocnik bez doświadczenia'),
    Magazynier: getRolaColor('Magazynier'),
  }), []);

  const quickActions: QuickAction[] = [
    { label: 'Tryb Dzisiaj', icon: 'navigate-circle-outline' as IoniconName, path: '/misja-dnia', color: theme.accent },
    // ── Dyrektor / Administrator / Kierownik ──
    ...(isDyrektor || isKierownik ? [
      { label: 'Autoplan dnia',     icon: 'sparkles-outline' as IoniconName,      path: '/autoplan-dnia',     color: theme.chartCyan },
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
      { label: 'Kal. wycen',        icon: 'calculator-outline' as IoniconName,       path: '/wycena-kalendarz', color: theme.accent },
      { label: 'Wycena u klienta',  icon: 'document-text-outline' as IoniconName,    path: '/wyceny-terenowe', color: theme.success },
      { label: 'Zatwierdź wyceny',  icon: 'checkmark-circle-outline' as IoniconName, path: '/zatwierdz-wyceny', color: theme.warning },
      { label: 'Raporty',           icon: 'bar-chart-outline' as IoniconName,      path: '/raporty-mobilne',  color: theme.info },
      { label: 'Rozliczenia',       icon: 'wallet-outline' as IoniconName,         path: '/rozliczenia',      color: theme.success },
      { label: 'Funkcje oddziałów', icon: 'settings-outline' as IoniconName,       path: '/oddzial-funkcje-admin', color: theme.warning },
    ] : []),
    // ── Widok zleceń dla wszystkich (poza Wyceniającym i Magazynierem) ──
    ...(!isWyceniajacy && !isMagazynier ? [
      { label: 'Zlecenia', icon: 'clipboard-outline' as IoniconName, path: '/zlecenia', color: theme.info },
    ] : []),
    // ── Brygadzista ──
    ...(isBrygadzista ? [
      { label: 'Raport dzienny', icon: 'document-text-outline' as IoniconName, path: '/raport-dzienny', color: theme.success },
      { label: 'Oględziny',      icon: 'search-outline' as IoniconName,        path: '/ogledziny',      color: theme.info },
      { label: 'Kal. wycen',    icon: 'calculator-outline' as IoniconName,    path: '/wycena-kalendarz', color: theme.accent },
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
      { label: 'Wycena u klienta', icon: 'document-text-outline' as IoniconName, path: '/wyceny-terenowe', color: theme.success },
      { label: 'Wynagrodzenie', icon: 'cash-outline' as IoniconName, path: '/wyceniajacy-finanse', color: theme.success },
      { label: 'Oględziny',    icon: 'search-outline' as IoniconName,      path: '/ogledziny',       color: theme.info },
      { label: 'Kal. wycen',  icon: 'calendar-outline' as IoniconName,    path: '/wycena-kalendarz', color: theme.accent },
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

  const quickSections = useMemo(() => {
    const byCat = new Map<QuickCategoryId, QuickAction[]>();
    QUICK_CATEGORY_ORDER.forEach((c) => byCat.set(c, []));
    for (const a of quickActionsFiltered) {
      const cat = quickCategoryForAction(a.path, a.label);
      const bucket = byCat.get(cat) ?? byCat.get('operations')!;
      bucket.push(a);
    }
    return QUICK_CATEGORY_ORDER.map((key) => ({
      key,
      title: t(`dashboard.quickCat.${key}`),
      actions: byCat.get(key) ?? [],
    })).filter((s) => s.actions.length > 0);
  }, [quickActionsFiltered, t, language]);

  const dzisiaj = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const dzisiajLocalized = new Date().toLocaleDateString(dateLocale, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  /** Etykiety szybkiego dostępu — pełny tekst (lista jak iOS Settings). */
  const quickActionListLabel = (label: string): string => {
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
      <View pointerEvents="none" style={S.bgOrbTop} />
      <View pointerEvents="none" style={S.bgOrbMid} />
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
            <PlatinumAppear key={i} delayMs={40 * i} style={S.statWrap}>
              <View style={[S.statCard, { borderTopColor: s.color }]}>
                <PlatinumIconBadge icon={s.icon} color={s.color} size={26} />
                <Text style={[S.statNum, { color: s.color }]}>{s.value}</Text>
                <Text style={S.statLabel}>{s.label}</Text>
              </View>
            </PlatinumAppear>
          ))}
        </View>}
        {!isWyceniajacy && delayedCount > 0 ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 14 }}>
              {t('dashboard.delayed')}: {delayedCount}
            </Text>
          </View>
        ) : null}

        <PlatinumCard style={[S.section, elevationCard(theme)]} glow>
          <Text style={S.sectionTitle}>{t('dashboard.branchMode')}</Text>
          <Text style={S.oddzialMission}>{oddzialConfig.mission}</Text>
          <Text style={S.oddzialFocus}>{t('dashboard.priority', { focus: oddzialConfig.focus })}</Text>
        </PlatinumCard>

        {/* ─── SZYBKI DOSTĘP (iOS-style grouped list) ─────────────────────────── */}
        <PlatinumCard style={[S.section, elevationCard(theme)]}>
          <Text style={S.sectionTitle}>{t('dashboard.quickAccess')}</Text>
          {quickSections.map((section, si) => (
            <View key={section.key} style={si > 0 ? S.quickSectionSpacer : S.quickSectionFirst}>
              <Text style={S.quickSectionLabel}>{section.title}</Text>
              <View style={S.quickListGroup}>
                {section.actions.map((a, i) => (
                  <Fragment key={`${section.key}-${a.path}-${a.label}-${i}`}>
                    {i > 0 ? <View style={S.quickListHairline} /> : null}
                    <Pressable
                      onPress={() => {
                        void triggerHaptic('light');
                        router.push(a.path as any);
                      }}
                      style={({ pressed }) => [S.quickListRow, pressed && S.quickListRowPressed]}
                    >
                      <View style={S.quickListIconTile}>
                        <Ionicons name={a.icon} size={21} color={theme.textSub} />
                      </View>
                      <Text style={S.quickListTitle} numberOfLines={2}>
                        {quickActionListLabel(a.label)}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            </View>
          ))}
        </PlatinumCard>

        {/* ─── OSTATNIE ZLECENIA ──────────────────────────────────────────────── */}
        {!isWyceniajacy && <PlatinumCard style={[S.section, elevationCard(theme)]} glow>
          <View style={S.sectionHeader}>
            <Text style={S.sectionTitle}>
              {isPomocnik || isBrygadzista ? t('dashboard.myTasks') : t('dashboard.latestTasks')}
            </Text>
            <TouchableOpacity onPress={() => { void triggerHaptic('light'); router.push('/zlecenia'); }} style={S.seeAllBtn}>
              <Text style={S.seeAll}>{t('dashboard.seeAll')}</Text>
              <PlatinumIconBadge icon="chevron-forward" color={theme.accent} size={16} style={S.seeAllIcon} />
            </TouchableOpacity>
          </View>

          {zlecenia.length === 0 ? (
            <View style={S.empty}>
              <PlatinumIconBadge icon="clipboard-outline" color={theme.textMuted} size={28} style={S.emptyIconBadge} />
              <Text style={S.emptyTitle}>{t('dashboard.emptyOrders')}</Text>
              <Text style={S.emptySub}>
                {isPomocnik || isBrygadzista
                  ? t('dashboard.emptyOrdersSubBrygadzista')
                  : t('dashboard.emptyOrdersSubDefault')}
              </Text>
            </View>
          ) : (
            zlecenia.slice(0, 5).map((z, i) => (
              <PlatinumAppear key={z.id} delayMs={35 * i}>
                <PlatinumPressable
                  style={S.card}
                  onPress={() => { void triggerHaptic('light'); router.push(`/zlecenie/${z.id}`); }}
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
                      <PlatinumIconBadge icon="location-outline" color={theme.textSub} size={16} style={S.metaIconBadge} />
                      <Text style={S.cardAddr}> {z.adres}, {z.miasto}</Text>
                    </View>
                    {(z.adres || z.miasto) ? (
                      <TouchableOpacity
                        onPress={() => { void openAddressInMaps(z.adres || '', z.miasto || ''); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <PlatinumIconBadge icon="map-outline" color={theme.accent} size={18} style={S.metaMapBadge} />
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
                      <PlatinumIconBadge icon="people-outline" color={theme.textSub} size={16} style={S.metaIconBadge} />
                      <Text style={S.cardEkipa}> {z.ekipa_nazwa}</Text>
                    </View>
                  ) : null}
                </View>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={18} style={S.chevronBadge} />
                </PlatinumPressable>
              </PlatinumAppear>
            ))
          )}
        </PlatinumCard>}

        <View style={{ height: 128 }} />
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
            <TouchableOpacity key={i} style={S.navBtn} onPress={() => { void triggerHaptic('light'); router.push(n.path as any); }}>
              <Ionicons
                name={n.icon}
                size={32}
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
  bgOrbTop: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 140,
    backgroundColor: t.accent + '22',
  },
  bgOrbMid: {
    position: 'absolute',
    top: 220,
    left: -90,
    width: 210,
    height: 210,
    borderRadius: 110,
    backgroundColor: t.chartCyan + '14',
  },

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
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.55,
    shadowRadius: t.shadowRadius * 0.9,
    shadowOffset: { width: 0, height: 5 },
    elevation: t.cardElevation + 1,
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
    flexWrap: 'wrap',
    backgroundColor: t.surface,
    paddingHorizontal: 12, paddingVertical: 14,
    gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  statWrap: { width: '48%' },
  statCard: {
    backgroundColor: t.surface2,
    borderRadius: t.radiusLg, padding: 11,
    alignItems: 'center', gap: 4,
    borderTopWidth: 3,
    borderWidth: 1,
    borderColor: t.cardBorder,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.35,
    shadowRadius: t.shadowRadius * 0.65,
    shadowOffset: { width: 0, height: 3 },
    elevation: t.cardElevation,
  },
  statNum: { fontSize: t.fontSection, fontWeight: '800' },
  statLabel: { fontSize: t.fontMicro, color: t.textMuted, textAlign: 'center' },

  // Sekcje
  section: {
    backgroundColor: t.surface,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: t.radiusXl, padding: 18,
    borderWidth: 1, borderColor: t.border,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.38,
    shadowRadius: t.shadowRadius * 0.85,
    shadowOffset: { width: 0, height: 4 },
    elevation: t.cardElevation,
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
  seeAllIcon: { width: 36, height: 36, borderRadius: 10 },

  // Szybki dostęp — kategorie + lista iOS (grupa inset)
  quickSectionFirst: { marginTop: 10 },
  quickSectionSpacer: { marginTop: 20 },
  quickSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: t.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
  quickListGroup: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: t.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  quickListHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.border,
    marginLeft: 60,
  },
  quickListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 11,
    paddingHorizontal: 14,
    gap: 12,
    backgroundColor: t.surface2,
  },
  quickListRowPressed: {
    backgroundColor: t.surface3,
  },
  quickListIconTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  quickListTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: t.text,
    letterSpacing: -0.25,
    lineHeight: 22,
    paddingRight: 6,
  },

  // Puste
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyIconBadge: { width: 52, height: 52, borderRadius: 16 },
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
  metaIconBadge: { width: 36, height: 36, borderRadius: 10 },
  metaMapBadge: { width: 40, height: 40, borderRadius: 12 },
  cardAddr: { fontSize: 12, color: t.textSub, flex: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  typChip: {
    backgroundColor: t.surface2,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  typChipText: { fontSize: 11, color: t.textSub, fontWeight: '600' },
  cardWartosc: { fontSize: 12, color: t.accent, fontWeight: '700' },
  cardEkipa: { fontSize: 11, color: t.textMuted },
  chevronBadge: { width: 40, height: 40, borderRadius: 12, alignSelf: 'center', marginRight: 4 },

  // Dolna nawigacja
  nav: {
    flexDirection: 'row',
    backgroundColor: t.navBg,
    borderTopWidth: 1, borderTopColor: t.navBorder,
    paddingBottom: 30, paddingTop: 12,
    position: 'absolute', bottom: 0, left: 0, right: 0,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.55,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: -2 },
    elevation: t.cardElevation + 1,
  },
  navBtn: { flex: 1, alignItems: 'center', gap: 5 },
  navLabel: { fontSize: 12.5, color: t.navInactive, fontWeight: '800', letterSpacing: 0.35 },
});
