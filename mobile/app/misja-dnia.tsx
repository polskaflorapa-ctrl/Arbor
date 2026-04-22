import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';

type TaskItem = {
  id: number;
  klient_nazwa?: string;
  adres?: string;
  miasto?: string;
  status?: string;
  priorytet?: string;
  data_planowana?: string;
  godzina_rozpoczecia?: string;
};

const STATUS_ACTIVE = new Set(['W_Realizacji']);

const isToday = (isoLike?: string) => {
  if (!isoLike) return false;
  const normalized = isoLike.split('T')[0];
  return normalized === new Date().toISOString().split('T')[0];
};

const formatHour = (hour?: string) => (hour ? hour.slice(0, 5) : '--:--');

const formatDuration = (
  minutes: number,
  tf: (key: string, vars?: Record<string, string | number>) => string,
) => {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h <= 0) return tf('misja.time.min', { m });
  if (m === 0) return tf('misja.time.h', { h });
  return tf('misja.time.hm', { h, m });
};

export default function MisjaDniaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/misja-dnia');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [userRole, setUserRole] = useState('');

  const loadData = useCallback(async () => {
    try {
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      setUserRole(user.rola ?? '');
      const endpoint = user.rola === 'Brygadzista' || user.rola === 'Pomocnik'
        ? `${API_URL}/tasks/moje`
        : `${API_URL}/tasks/wszystkie`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const todayTasks = useMemo(
    () => tasks.filter((task) => isToday(task.data_planowana)),
    [tasks],
  );

  const activeNow = useMemo(
    () => todayTasks.filter((task) => STATUS_ACTIVE.has(task.status ?? '')),
    [todayTasks],
  );

  const urgentToday = useMemo(
    () => todayTasks.filter((task) => task.priorytet === 'Pilny'),
    [todayTasks],
  );

  const completion = useMemo(() => {
    if (!todayTasks.length) return 0;
    const done = todayTasks.filter((task) => task.status === 'Zakonczone').length;
    return Math.round((done / todayTasks.length) * 100);
  }, [todayTasks]);

  const remainingToday = useMemo(
    () => todayTasks.filter((task) => task.status !== 'Zakonczone'),
    [todayTasks],
  );

  const etaMinutes = useMemo(() => {
    // Lekki heurystyczny model ETA: 75 min na aktywne, 95 min na pozostałe.
    return remainingToday.reduce((acc, task) => (
      acc + (STATUS_ACTIVE.has(task.status ?? '') ? 75 : 95)
    ), 0);
  }, [remainingToday]);

  const etaLabel = useMemo(() => {
    if (!remainingToday.length) return t('misja.eta.dayClosed');
    if (etaMinutes <= 120) return t('misja.eta.inReach');
    if (etaMinutes <= 240) return t('misja.eta.midDay');
    return t('misja.eta.heavyLoad');
  }, [etaMinutes, remainingToday.length, t]);

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title}>{t('misja.title')}</Text>
          <Text style={S.subtitle}>{t('misja.subtitle')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            setRefreshing(true);
            void loadData();
          }}
          style={S.refreshBtn}
        >
          <Ionicons name="refresh" size={18} color={theme.headerText} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={S.kpiRow}>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayTasks.length}</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.tasksToday')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{activeNow.length}</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.inProgress')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{urgentToday.length}</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.urgent')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{completion}%</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.dayProgress')}</Text>
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.dayProgress')}</Text>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${completion}%` }]} />
          </View>
          <View style={S.progressMetaRow}>
            <Text style={S.progressMetaText}>
              {t('misja.progress.completed', {
                done: todayTasks.length - remainingToday.length,
                total: todayTasks.length || 0,
              })}
            </Text>
            <Text style={S.progressMetaText}>{completion}%</Text>
          </View>

          <View style={S.etaCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="time-outline" size={16} color={theme.info} />
              <Text style={S.etaTitle}>{t('misja.eta.title')}</Text>
            </View>
            <Text style={S.etaValue}>
              {remainingToday.length ? formatDuration(etaMinutes, t) : t('misja.eta.zero')}
            </Text>
            <Text style={S.etaSub}>
              {etaLabel} • {t('misja.eta.remainingTasks', { count: remainingToday.length })}
            </Text>
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.now')}</Text>
          {activeNow.length === 0 ? (
            <Text style={S.emptyText}>{t('misja.emptyActive')}</Text>
          ) : (
            activeNow.slice(0, 3).map((task) => (
              <TouchableOpacity
                key={task.id}
                style={S.taskCard}
                onPress={() => router.push(`/zlecenie/${task.id}`)}
              >
                <Text style={S.taskTitle}>
                  {task.klient_nazwa || t('misja.taskFallback', { id: task.id })}
                </Text>
                <Text style={S.taskMeta}>
                  {formatHour(task.godzina_rozpoczecia)} • {task.adres || t('misja.noAddress')}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.todayPlan')}</Text>
          {todayTasks.length === 0 ? (
            <Text style={S.emptyText}>{t('misja.emptyToday')}</Text>
          ) : (
            todayTasks.slice(0, 8).map((task) => (
              <TouchableOpacity
                key={task.id}
                style={S.planRow}
                onPress={() => router.push(`/zlecenie/${task.id}`)}
              >
                <View style={S.planLeft}>
                  <Text style={S.planHour}>{formatHour(task.godzina_rozpoczecia)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.planClient}>
                    {task.klient_nazwa || t('misja.taskFallback', { id: task.id })}
                  </Text>
                  <Text style={S.planAddr}>{task.miasto || ''} {task.adres || ''}</Text>
                </View>
                <Text style={[S.planStatus, task.priorytet === 'Pilny' && { color: theme.danger }]}>
                  {task.priorytet || task.status || '-'}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.quickActions')}</Text>
          <View style={S.actionRow}>
            <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/zlecenia')}>
              <Ionicons name="clipboard-outline" size={16} color={theme.accent} />
              <Text style={S.actionText}>{t('misja.action.orders')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/raport-dzienny')}>
              <Ionicons name="document-text-outline" size={16} color={theme.accent} />
              <Text style={S.actionText}>{t('misja.action.dailyReport')}</Text>
            </TouchableOpacity>
          </View>
          {userRole === 'Kierownik' || userRole === 'Dyrektor' || userRole === 'Administrator' ? (
            <View style={S.actionRow}>
              <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/harmonogram')}>
                <Ionicons name="calendar-outline" size={16} color={theme.accent} />
                <Text style={S.actionText}>{t('misja.action.schedule')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/nowe-zlecenie')}>
                <Ionicons name="add-circle-outline" size={16} color={theme.accent} />
                <Text style={S.actionText}>{t('misja.action.newOrder')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },
  header: {
    paddingTop: 54,
    paddingBottom: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: t.headerText },
  subtitle: { fontSize: 12, color: t.headerSub },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  kpiCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface,
    padding: 12,
  },
  kpiNum: { fontSize: 22, fontWeight: '800', color: t.accent },
  kpiLabel: { fontSize: 12, color: t.textSub, marginTop: 2 },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: t.surface2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: t.success,
    borderRadius: 999,
  },
  progressMetaRow: {
    marginTop: 8,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressMetaText: { fontSize: 12, color: t.textSub, fontWeight: '600' },
  etaCard: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    backgroundColor: t.surface2,
    padding: 10,
    gap: 4,
  },
  etaTitle: { fontSize: 13, fontWeight: '700', color: t.text },
  etaValue: { fontSize: 22, fontWeight: '800', color: t.info },
  etaSub: { fontSize: 12, color: t.textSub },
  section: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface,
    padding: 12,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.65,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 10 },
  emptyText: { fontSize: 13, color: t.textMuted },
  taskCard: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: t.surface2,
  },
  taskTitle: { fontSize: 14, fontWeight: '700', color: t.text },
  taskMeta: { fontSize: 12, color: t.textSub, marginTop: 2 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  planLeft: { width: 46, alignItems: 'center' },
  planHour: { fontSize: 12, fontWeight: '700', color: t.info },
  planClient: { fontSize: 13, fontWeight: '700', color: t.text },
  planAddr: { fontSize: 12, color: t.textSub, marginTop: 2 },
  planStatus: { fontSize: 11, color: t.warning, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: t.surface2,
  },
  actionText: { fontSize: 12, fontWeight: '700', color: t.text },
});
