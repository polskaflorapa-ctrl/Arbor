import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';

interface ReportStats {
  total_tasks: number;
  total_hours: number;
  avg_margin_percent: number;
  completed_tasks: number;
  total_revenue: number;
  total_cost: number;
}

export default function RaportyMobilneScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/raporty-mobilne');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<ReportStats>({
    total_tasks: 0, total_hours: 0, avg_margin_percent: 0,
    completed_tasks: 0, total_revenue: 0, total_cost: 0,
  });

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    try {
      const { token } = await getStoredSession();
      if (!token) { router.replace('/login'); return; }
      const response = await fetch(`${API_URL}/raporty/mobile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setStats({
          total_tasks: Number(data?.total_tasks ?? 0),
          total_hours: Number(data?.total_hours ?? 0),
          avg_margin_percent: Number(data?.avg_margin_percent ?? 0),
          completed_tasks: Number(data?.completed_tasks ?? 0),
          total_revenue: Number(data?.total_revenue ?? 0),
          total_cost: Number(data?.total_cost ?? 0),
        });
      }
    } catch {
      setStats({
        total_tasks: 0, total_hours: 0, avg_margin_percent: 0,
        completed_tasks: 0, total_revenue: 0, total_cost: 0,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); fetchStats(); };

  const S = makeStyles(theme);
  const zysk = stats.total_revenue - stats.total_cost;
  const marza = stats.avg_margin_percent;
  const progress = stats.total_tasks > 0 ? Math.round((stats.completed_tasks / stats.total_tasks) * 100) : 0;
  const money = (value: number) => `${Math.round(value).toLocaleString('pl-PL')} PLN`;
  const quickReports = [
    { label: 'Raport dzienny', hint: 'Czas, materialy i podpis brygady', icon: 'today-outline' as const, route: '/raport-dzienny' as const, color: theme.accent },
    { label: 'KPI brygad', hint: 'Ranking tygodnia i wynik ekip', icon: 'podium-outline' as const, route: '/kpi-tydzien' as const, color: theme.success },
    { label: 'Potwierdzenia ekip', hint: 'Obecnosc, gotowosc i odbior prac', icon: 'people-outline' as const, route: '/potwierdzenia-ekip' as const, color: theme.info },
  ];

  if (guard.ready && !guard.allowed) return <View style={S.root} />;
  if (!guard.ready) return (
    <View style={S.center}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );

  if (loading) return (
    <View style={S.center}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );

  return (
    <View style={S.root}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor={theme.headerBg}
      />

      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="analytics-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Centrum wynikow</Text>
          <Text style={S.headerTitle}>{t('reports.title')}</Text>
          <Text style={S.headerSub}>Raporty operacyjne dla oddzialu</Text>
        </View>
      </View>

      <ScrollView
        style={S.scroll}
        contentContainerStyle={S.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        <View style={S.heroCard}>
          <View style={S.heroTop}>
            <View>
              <Text style={S.heroEyebrow}>Wykonanie planu</Text>
              <Text style={S.heroTitle}>{progress}%</Text>
            </View>
            <View style={S.heroBadge}>
              <Ionicons name={progress >= 80 ? 'trending-up-outline' : 'leaf-outline'} size={16} color={theme.accent} />
              <Text style={S.heroBadgeText}>{stats.completed_tasks}/{stats.total_tasks}</Text>
            </View>
          </View>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${Math.min(progress, 100)}%` }]} />
          </View>
          <View style={S.heroBottom}>
            <View>
              <Text style={S.heroMetaLabel}>Przychod</Text>
              <Text style={S.heroMetaValue}>{money(stats.total_revenue)}</Text>
            </View>
            <View>
              <Text style={S.heroMetaLabel}>Zysk</Text>
              <Text style={[S.heroMetaValue, { color: zysk >= 0 ? theme.success : theme.danger }]}>{money(zysk)}</Text>
            </View>
          </View>
        </View>

        <View style={S.grid}>
          {[
            { label: t('reports.kpi.tasks'), value: stats.total_tasks.toString(), icon: 'clipboard-outline' as const, color: theme.accent },
            { label: t('reports.kpi.completed'), value: stats.completed_tasks.toString(), icon: 'checkmark-circle-outline' as const, color: theme.success },
            { label: t('reports.kpi.hours'), value: `${stats.total_hours.toFixed(1)}h`, icon: 'time-outline' as const, color: theme.info },
            { label: t('reports.kpi.margin'), value: `${marza.toFixed(1)}%`, icon: 'trending-up-outline' as const, color: marza >= 0 ? theme.success : theme.danger },
          ].map((item, i) => (
            <View key={i} style={[S.kpiCard, { borderTopColor: item.color }]}>
              <Ionicons name={item.icon} size={20} color={item.color} />
              <Text style={[S.kpiNum, { color: item.color }]}>{item.value}</Text>
              <Text style={S.kpiLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={S.quickCard}>
          <View style={S.summaryTitleRow}>
            <Ionicons name="navigate-circle-outline" size={18} color={theme.accent} />
            <Text style={S.summaryTitle}>Najwazniejsze raporty</Text>
          </View>
          {quickReports.map((action) => (
            <TouchableOpacity key={action.route} style={S.quickRow} onPress={() => router.push(action.route)}>
              <View style={[S.quickIcon, { backgroundColor: `${action.color}1F` }]}>
                <Ionicons name={action.icon} size={18} color={action.color} />
              </View>
              <View style={S.quickText}>
                <Text style={S.quickLabel}>{action.label}</Text>
                <Text style={S.quickHint}>{action.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={[S.summaryCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
          <View style={S.summaryTitleRow}>
            <Ionicons name="wallet-outline" size={18} color={theme.accent} />
            <Text style={S.summaryTitle}>{t('reports.summary')}</Text>
          </View>

          <View style={[S.row, { borderBottomColor: theme.border }]}>
            <Text style={[S.rowLabel, { color: theme.textMuted }]}>{t('reports.revenue')}</Text>
            <Text style={[S.rowValue, { color: theme.text }]}>{money(stats.total_revenue)}</Text>
          </View>
          <View style={[S.row, { borderBottomColor: theme.border }]}>
            <Text style={[S.rowLabel, { color: theme.textMuted }]}>{t('reports.costs')}</Text>
            <Text style={[S.rowValue, { color: theme.danger }]}>- {money(stats.total_cost)}</Text>
          </View>
          <View style={S.totalRow}>
            <Text style={[S.totalLabel, { color: theme.text }]}>{t('reports.profit')}</Text>
            <Text style={[S.totalValue, { color: zysk >= 0 ? theme.success : theme.danger }]}>
              {money(zysk)}
            </Text>
          </View>
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
  scrollContent: { paddingBottom: 28 },
  header: {
    backgroundColor: t.cardBg,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 16,
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
  headerTextBox: { flex: 1, minWidth: 0 },
  headerEyebrow: { color: t.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  headerTitle: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: t.text },
  headerSub: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  heroCard: {
    marginHorizontal: 14,
    marginTop: 2,
    borderRadius: 20,
    padding: 16,
    backgroundColor: t.cardBg,
    borderWidth: 1,
    borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.45,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  heroEyebrow: { color: t.textMuted, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  heroTitle: { color: t.text, fontSize: 38, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.accentLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  heroBadgeText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  progressTrack: { height: 10, borderRadius: 999, backgroundColor: t.surface2, overflow: 'hidden', marginTop: 14 },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: t.accent },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  heroMetaLabel: { color: t.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  heroMetaValue: { color: t.text, fontSize: 15, fontWeight: '900', marginTop: 3 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 14, paddingTop: 12, gap: 10,
  },
  kpiCard: {
    width: '47.5%', backgroundColor: t.cardBg, borderRadius: 16,
    padding: 14, alignItems: 'center', gap: 6,
    borderTopWidth: 4, borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.45,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  kpiNum: { fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  kpiLabel: { fontSize: 12, color: t.textMuted, fontWeight: '800', textAlign: 'center' },
  quickCard: {
    marginHorizontal: 14,
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: t.cardBg,
    borderWidth: 1,
    borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.42,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  quickIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  quickText: { flex: 1, minWidth: 0 },
  quickLabel: { color: t.text, fontSize: 14, fontWeight: '900' },
  quickHint: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  summaryCard: {
    marginHorizontal: 14, borderRadius: 18, padding: 16,
    borderWidth: 1, marginTop: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.45,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  summaryTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700' },
  rowValue: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 4 },
  totalLabel: { fontSize: 15, fontWeight: '900' },
  totalValue: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
