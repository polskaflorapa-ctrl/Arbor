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
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('reports.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {/* KPI siatka */}
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

        {/* Podsumowanie finansowe */}
        <View style={[S.summaryCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
          <View style={S.summaryTitleRow}>
            <Ionicons name="wallet-outline" size={18} color={theme.accent} />
            <Text style={[S.summaryTitle, { color: theme.text }]}>{t('reports.summary')}</Text>
          </View>

          <View style={[S.row, { borderBottomColor: theme.border }]}>
            <Text style={[S.rowLabel, { color: theme.textMuted }]}>{t('reports.revenue')}</Text>
            <Text style={[S.rowValue, { color: theme.text }]}>{stats.total_revenue.toFixed(2)} PLN</Text>
          </View>
          <View style={[S.row, { borderBottomColor: theme.border }]}>
            <Text style={[S.rowLabel, { color: theme.textMuted }]}>{t('reports.costs')}</Text>
            <Text style={[S.rowValue, { color: theme.danger }]}>- {stats.total_cost.toFixed(2)} PLN</Text>
          </View>
          <View style={S.totalRow}>
            <Text style={[S.totalLabel, { color: theme.text }]}>{t('reports.profit')}</Text>
            <Text style={[S.totalValue, { color: zysk >= 0 ? theme.success : theme.danger }]}>
              {zysk.toFixed(2)} PLN
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 14,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: t.headerText },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, paddingTop: 16, gap: 10,
  },
  kpiCard: {
    width: '47%', backgroundColor: t.cardBg, borderRadius: 14,
    padding: 14, alignItems: 'center', gap: 6,
    borderTopWidth: 3, borderWidth: 1, borderColor: t.cardBorder,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.45,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
  },
  kpiNum: { fontSize: 26, fontWeight: '800' },
  kpiLabel: { fontSize: 12, color: t.textMuted, fontWeight: '600' },
  summaryCard: {
    margin: 12, borderRadius: 14, padding: 16,
    borderWidth: 1, marginTop: 4,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.45,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
  },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  summaryTitle: { fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1 },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 4 },
  totalLabel: { fontSize: 15, fontWeight: '700' },
  totalValue: { fontSize: 18, fontWeight: '800' },
});
