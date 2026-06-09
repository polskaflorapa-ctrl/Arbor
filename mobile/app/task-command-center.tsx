import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import {
  actionMatchesQuery,
  getCommandCenterActionsForRole,
  type CommandAction,
  type CommandCategory,
} from '../utils/command-center-actions';
import {
  clearRecentContexts,
  pushRecentContext,
  readRecentContexts,
  type RecentContextItem,
} from '../utils/command-center-history';
import { isFeatureEnabledForOddzial } from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';
import { buildNewOrderRoute } from '../utils/new-order-route';

const CATEGORY_ORDER: { id: 'all' | CommandCategory; icon: React.ComponentProps<typeof Ionicons>['name']; labelKey: string }[] = [
  { id: 'all', icon: 'apps-outline', labelKey: 'command.category.all' },
  { id: 'operations', icon: 'construct-outline', labelKey: 'dashboard.quickCat.operations' },
  { id: 'quotes', icon: 'document-text-outline', labelKey: 'dashboard.quickCat.quotes' },
  { id: 'fleetMagazyn', icon: 'car-outline', labelKey: 'dashboard.quickCat.fleetMagazyn' },
  { id: 'reports', icon: 'bar-chart-outline', labelKey: 'dashboard.quickCat.reports' },
  { id: 'finance', icon: 'wallet-outline', labelKey: 'dashboard.quickCat.finance' },
  { id: 'administration', icon: 'settings-outline', labelKey: 'dashboard.quickCat.administration' },
  { id: 'account', icon: 'person-outline', labelKey: 'dashboard.quickCat.account' },
];

function commandCenterRoute(path: string) {
  return path === '/nowe-zlecenie' ? buildNewOrderRoute({ source: 'command-center' }) : path;
}

type Metrics = {
  active: number;
  delayed: number;
  fresh: number;
  pendingInspections: number;
};

type SuggestionCard = {
  id: string;
  title: string;
  detail: string;
  action?: CommandAction;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

type CommandStat = {
  id: string;
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
};

function normalizeStatus(status: unknown) {
  return String(status || '').toLowerCase();
}

function isCrewRole(role: string) {
  const value = role.toLowerCase();
  return value === 'brygadzista' || value === 'pomocnik' || value.includes('pomocnik bez');
}

function buildTaskMetrics(tasks: any[]): Metrics {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let active = 0;
  let delayed = 0;
  let fresh = 0;
  for (const task of tasks) {
    const status = normalizeStatus(task?.status);
    if (status === 'nowe') fresh += 1;
    if (status === 'w_realizacji' || status === 'w realizacji') active += 1;
    const rawDay = typeof task?.data_planowana === 'string' ? task.data_planowana.split('T')[0] : '';
    if (!rawDay) continue;
    const planned = new Date(rawDay);
    planned.setHours(0, 0, 0, 0);
    if (!Number.isNaN(planned.getTime()) && planned < today && status !== 'zakonczone' && status !== 'anulowane') delayed += 1;
  }
  return { active, delayed, fresh, pendingInspections: 0 };
}

export default function TaskCommandCenterScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | CommandCategory>('all');
  const [actions, setActions] = useState<CommandAction[]>([]);
  const [recents, setRecents] = useState<RecentContextItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({ active: 0, delayed: 0, fresh: 0, pendingInspections: 0 });
  const [role, setRole] = useState('');

  const loadData = useCallback(async () => {
    try {
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }

      const userRole = String(user.rola || '');
      setRole(userRole);
      const allowedActions = getCommandCenterActionsForRole(userRole).filter((action) =>
        isFeatureEnabledForOddzial((user as { oddzial_id?: string | number | null }).oddzial_id, action.path),
      );
      setActions(allowedActions);
      setRecents(await readRecentContexts());

      const headers = { Authorization: `Bearer ${token}` };
      if (userRole === 'Wyceniający') {
        const res = await fetch(`${API_URL}/ogledziny`, { headers });
        if (res.ok) {
          const rows = await res.json().catch(() => []);
          const pendingInspections = Array.isArray(rows)
            ? rows.filter((row) => !['zakonczone', 'zamknięte', 'closed'].includes(normalizeStatus(row?.status))).length
            : 0;
          setMetrics({ active: 0, delayed: 0, fresh: 0, pendingInspections });
        } else {
          setMetrics({ active: 0, delayed: 0, fresh: 0, pendingInspections: 0 });
        }
      } else {
        const endpoint =
          isCrewRole(userRole)
            ? `${API_URL}/tasks/moje`
            : `${API_URL}/tasks/wszystkie`;
        const res = await fetch(endpoint, { headers });
        const rows = res.ok ? await res.json().catch(() => []) : [];
        setMetrics(buildTaskMetrics(Array.isArray(rows) ? rows : []));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visibleActions = useMemo(() => {
    return actions.filter((action) => {
      if (category !== 'all' && action.category !== category) return false;
      return actionMatchesQuery(action, query);
    });
  }, [actions, category, query]);

  const suggestions = useMemo<SuggestionCard[]>(() => {
    const byPath = new Map(actions.map((action) => [action.path, action]));
    const suggestionList: SuggestionCard[] = [];
    const pushSuggestion = (id: string, path: string, title: string, detail: string, icon: React.ComponentProps<typeof Ionicons>['name']) => {
      const action = byPath.get(path);
      if (!action) return;
      suggestionList.push({ id, title, detail, action, icon });
    };

    if (role === 'Wyceniający') {
      if (metrics.pendingInspections > 0) {
        pushSuggestion(
          'estimator-pending',
          '/wyceniajacy-hub',
          t('command.suggest.estimatorHub'),
          t('command.suggest.estimatorHubDetail', { count: metrics.pendingInspections }),
          'speedometer-outline',
        );
      }
      pushSuggestion(
        'estimator-field',
        '/wyceny-terenowe',
        t('command.suggest.fieldQuotes'),
        t('command.suggest.fieldQuotesDetail'),
        'document-text-outline',
      );
    } else if (['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(role)) {
      if (metrics.active > 0) {
        pushSuggestion(
          'crew-active',
          '/zlecenia',
          t('command.suggest.activeTasks'),
          t('command.suggest.activeTasksDetail', { count: metrics.active }),
          'play-circle-outline',
        );
      }
      if (metrics.delayed > 0) {
        pushSuggestion(
          'crew-delayed',
          '/harmonogram',
          t('command.suggest.delayedPlan'),
          t('command.suggest.delayedPlanDetail', { count: metrics.delayed }),
          'alert-circle-outline',
        );
      }
      pushSuggestion(
        'crew-today',
        '/misja-dnia',
        t('command.suggest.todayMode'),
        t('command.suggest.todayModeDetail'),
        'navigate-circle-outline',
      );
    } else {
      if (metrics.delayed > 0) {
        pushSuggestion(
          'manager-delayed',
          '/harmonogram',
          t('command.suggest.delayedPlan'),
          t('command.suggest.delayedPlanDetail', { count: metrics.delayed }),
          'warning-outline',
        );
      }
      if (metrics.fresh > 0) {
        pushSuggestion(
          'manager-fresh',
          '/zlecenia',
          t('command.suggest.newTasks'),
          t('command.suggest.newTasksDetail', { count: metrics.fresh }),
          'sparkles-outline',
        );
      }
      pushSuggestion(
        'manager-autoplan',
        '/autoplan-dnia',
        t('command.suggest.autoplan'),
        t('command.suggest.autoplanDetail'),
        'sync-outline',
      );
    }

    if (suggestionList.length === 0) {
      const fallback = actions.slice(0, 3).map<SuggestionCard>((action) => ({
        id: `fallback-${action.id}`,
        title: action.label,
        detail: action.path,
        action,
        icon: action.icon,
      }));
      return fallback;
    }
    return suggestionList.slice(0, 3);
  }, [actions, metrics, role, t]);

  const commandFocus = useMemo(() => {
    if (role === 'Wyceniający') {
      return metrics.pendingInspections > 0
        ? `Do domknięcia oględzin: ${metrics.pendingInspections}`
        : 'Brak pilnych oględzin w kolejce.';
    }
    if (metrics.delayed > 0) return `Najpierw opóźnienia: ${metrics.delayed}`;
    if (metrics.fresh > 0) return `Nowe zlecenia do rozdania: ${metrics.fresh}`;
    if (metrics.active > 0) return `W pracy: ${metrics.active}`;
    return 'System bez pilnych blokad.';
  }, [metrics, role]);

  const commandStats = useMemo<CommandStat[]>(() => ([
    {
      id: 'fresh',
      label: 'Nowe',
      value: metrics.fresh,
      detail: 'do przydziału',
      icon: 'sparkles-outline',
      color: theme.info,
      bg: theme.infoBg,
    },
    {
      id: 'active',
      label: 'W toku',
      value: metrics.active,
      detail: 'aktywnych prac',
      icon: 'play-circle-outline',
      color: theme.accent,
      bg: theme.accentLight,
    },
    {
      id: 'delayed',
      label: 'Po terminie',
      value: metrics.delayed,
      detail: 'wymaga reakcji',
      icon: 'warning-outline',
      color: metrics.delayed > 0 ? theme.danger : theme.success,
      bg: metrics.delayed > 0 ? theme.dangerBg : theme.successBg,
    },
    {
      id: 'inspections',
      label: 'Oględziny',
      value: metrics.pendingInspections,
      detail: 'terenowe',
      icon: 'leaf-outline',
      color: theme.success,
      bg: theme.successBg,
    },
  ]), [metrics, theme]);

  const openAction = useCallback(
    async (action: CommandAction, meta?: string) => {
      void triggerHaptic('light');
      const next = await pushRecentContext({
        path: action.path,
        label: action.label,
        ...(meta ? { meta } : {}),
      });
      setRecents(next);
      router.push(commandCenterRoute(action.path) as never);
    },
    [],
  );

  const openRecent = useCallback(async (item: RecentContextItem) => {
    void triggerHaptic('light');
    const next = await pushRecentContext({
      path: item.path,
      label: item.label,
      ...(item.meta ? { meta: item.meta } : {}),
    });
    setRecents(next);
    router.push(commandCenterRoute(item.path) as never);
  }, []);

  const clearRecents = useCallback(async () => {
    await clearRecentContexts();
    setRecents([]);
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const S = makeStyles(theme);

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={S.root}>
      <ScreenHeader title={t('command.title')} />

      <ScrollView
        style={S.scroll}
        contentContainerStyle={S.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        <View style={S.heroCard}>
          <View style={S.heroTop}>
            <View style={S.heroIcon}>
              <Ionicons name="git-branch-outline" size={24} color={theme.accent} />
            </View>
            <View style={S.heroTextBlock}>
              <Text style={S.heroEyebrow}>ARBORETYCZNE CENTRUM PRACY</Text>
              <Text style={S.heroTitle}>Dzień pod kontrolą</Text>
              <Text style={S.heroCopy}>{commandFocus}</Text>
            </View>
          </View>

          <View style={S.heroMetaRow}>
            <View style={S.roleBadge}>
              <Ionicons name="person-circle-outline" size={15} color={theme.accent} />
              <Text style={S.roleBadgeText}>{role || 'Tryb operacyjny'}</Text>
            </View>
            <TouchableOpacity style={S.refreshBadge} onPress={onRefresh}>
              <Ionicons name="refresh-outline" size={15} color={theme.accent} />
              <Text style={S.refreshBadgeText}>Odśwież</Text>
            </TouchableOpacity>
          </View>

          <View style={S.statsGrid}>
            {commandStats.map((item) => (
              <View key={item.id} style={S.statCard}>
                <View style={[S.statIcon, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={18} color={item.color} />
                </View>
                <View style={S.statBody}>
                  <Text style={S.statValue}>{item.value}</Text>
                  <Text style={S.statLabel}>{item.label}</Text>
                  <Text style={S.statDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <Text style={S.subtitle}>{t('command.subtitle')}</Text>
        <View style={S.searchBox}>
          <Ionicons name="search-outline" size={18} color={theme.textMuted} />
          <TextInput
            style={S.searchInput}
            placeholder={t('command.searchPlaceholder')}
            placeholderTextColor={theme.inputPlaceholder}
            value={query}
            onChangeText={setQuery}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle-outline" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.categoryChips}>
          {CATEGORY_ORDER.map((cat) => {
            const active = category === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[S.categoryChip, active && S.categoryChipActive]}
                onPress={() => setCategory(cat.id)}
              >
                <Ionicons name={cat.icon} size={14} color={active ? theme.accentText : theme.accent} />
                <Text style={[S.categoryText, active && S.categoryTextActive]}>
                  {t(cat.labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('command.sectionSuggestions')}</Text>
          {suggestions.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={S.suggestionCard}
              onPress={() => item.action && openAction(item.action, item.detail)}
              disabled={!item.action}
            >
              <View style={S.suggestionIconWrap}>
                <Ionicons name={item.icon} size={18} color={theme.accent} />
              </View>
              <View style={S.suggestionBody}>
                <Text style={S.suggestionTitle}>{item.title}</Text>
                <Text style={S.suggestionDetail}>{item.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={S.section}>
          <View style={S.sectionHeadRow}>
            <Text style={S.sectionTitle}>{t('command.sectionRecent')}</Text>
            <TouchableOpacity onPress={() => void clearRecents()} disabled={recents.length === 0}>
              <Text style={[S.clearRecent, recents.length === 0 && { opacity: 0.45 }]}>{t('command.clearRecent')}</Text>
            </TouchableOpacity>
          </View>
          {recents.length === 0 ? (
            <Text style={S.emptyNote}>{t('command.emptyRecent')}</Text>
          ) : (
            recents.slice(0, 5).map((item) => (
              <TouchableOpacity key={item.id} style={S.recentRow} onPress={() => void openRecent(item)}>
                <Ionicons name="time-outline" size={16} color={theme.textMuted} />
                <View style={S.recentBody}>
                  <Text style={S.recentLabel}>{item.label}</Text>
                  <Text style={S.recentMeta}>{item.meta || item.path}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('command.sectionResults', { count: visibleActions.length })}</Text>
          {visibleActions.length === 0 ? (
            <Text style={S.emptyNote}>{t('command.emptyResults')}</Text>
          ) : (
            visibleActions.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={S.actionRow}
                onPress={() => void openAction(action)}
              >
                <View style={S.actionIconWrap}>
                  <Ionicons name={action.icon} size={17} color={theme.info} />
                </View>
                <View style={S.actionBody}>
                  <Text style={S.actionLabel}>{action.label}</Text>
                  <Text style={S.actionPath}>{action.path}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={{ height: 36 }} />
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 36 },
    heroCard: {
      marginHorizontal: 14,
      marginTop: 12,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: t.cardBorder,
      backgroundColor: t.cardBg,
      padding: 14,
      gap: 12,
      ...shadowStyle(t, {
        opacity: t.shadowOpacity * 0.34,
        radius: t.shadowRadius * 0.76,
        offsetY: 4,
        elevation: t.cardElevation + 1,
      }),
    },
    heroTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    heroIcon: {
      width: 48,
      height: 48,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.accentLight,
    },
    heroTextBlock: { flex: 1, gap: 2 },
    heroEyebrow: {
      color: t.accent,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0,
    },
    heroTitle: {
      color: t.text,
      fontSize: 21,
      fontWeight: '900',
    },
    heroCopy: {
      color: t.textSub,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    roleBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    roleBadgeText: { color: t.textSub, fontSize: 12, fontWeight: '800' },
    refreshBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: t.accent,
      backgroundColor: t.accentLight,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    refreshBadgeText: { color: t.accent, fontSize: 12, fontWeight: '900' },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    statCard: {
      flexGrow: 1,
      flexBasis: '47%',
      minWidth: 138,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      padding: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    statIcon: {
      width: 34,
      height: 34,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statBody: { flex: 1 },
    statValue: {
      color: t.text,
      fontSize: 19,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    statLabel: { color: t.textSub, fontSize: 12, fontWeight: '800' },
    statDetail: { color: t.textMuted, fontSize: 10, fontWeight: '600', marginTop: 1 },
    subtitle: {
      color: t.textSub,
      fontSize: 13,
      marginHorizontal: 14,
      marginTop: 2,
      marginBottom: 2,
      fontWeight: '600',
    },
    searchBox: {
      marginHorizontal: 14,
      marginTop: 8,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: t.inputBorder,
      backgroundColor: t.inputBg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: t.text,
      minHeight: 24,
    },
    categoryChips: {
      paddingHorizontal: 14,
      paddingTop: 10,
      gap: 8,
      flexDirection: 'row',
    },
    categoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: t.cardBorder,
      backgroundColor: t.cardBg,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    categoryChipActive: {
      backgroundColor: t.accentLight,
      borderColor: t.accent,
    },
    categoryText: {
      color: t.accent,
      fontSize: 12,
      fontWeight: '700',
    },
    categoryTextActive: {
      color: t.accent,
    },
    section: {
      marginTop: 14,
      marginHorizontal: 14,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: t.cardBorder,
      backgroundColor: t.cardBg,
      padding: 12,
      gap: 8,
      ...shadowStyle(t, {
        opacity: t.shadowOpacity * 0.18,
        radius: t.shadowRadius * 0.46,
        offsetY: 2,
        elevation: Math.max(1, t.cardElevation),
      }),
    },
    sectionTitle: { color: t.text, fontSize: 15, fontWeight: '800' },
    sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    clearRecent: { color: t.accent, fontSize: 12, fontWeight: '700' },
    suggestionCard: {
      borderRadius: 7,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    suggestionIconWrap: {
      width: 30,
      height: 30,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.infoBg,
    },
    suggestionBody: { flex: 1 },
    suggestionTitle: { color: t.text, fontSize: 14, fontWeight: '700' },
    suggestionDetail: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    recentRow: {
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    recentBody: { flex: 1 },
    recentLabel: { color: t.text, fontSize: 13, fontWeight: '600' },
    recentMeta: { color: t.textMuted, fontSize: 11, marginTop: 1 },
    actionRow: {
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    actionIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.infoBg,
    },
    actionBody: { flex: 1 },
    actionLabel: { color: t.text, fontSize: 13, fontWeight: '700' },
    actionPath: { color: t.textMuted, fontSize: 11, marginTop: 1 },
    emptyNote: { color: t.textMuted, fontSize: 12, paddingVertical: 4 },
  });
