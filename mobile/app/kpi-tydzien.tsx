import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { API_URL } from '../constants/api';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { loadAutoplanHistory, type AutoplanHistoryItem } from '../utils/autoplan-history';
import { getStoredSession } from '../utils/session';

import { AppStatusBar } from '../components/ui/app-status-bar';
type RankingRow = {
  rank: number;
  team_id: number;
  ekipa_nazwa: string;
  oddzial_nazwa?: string;
  brygadzista_nazwa?: string;
  score: number;
  total_tasks: number;
  completed_tasks: number;
  completion_rate: number;
  revenue: number;
  logged_hours: number;
  planned_hours: number;
  photos_count: number;
  issues_count: number;
};

type RankingPeriod = {
  key: 'week' | 'month' | 'half_year' | 'year';
  label: string;
  from: string;
  to: string;
  winner: RankingRow | null;
  items: RankingRow[];
};

type RankingResponse = {
  periods: Record<string, RankingPeriod>;
};

const PERIOD_ORDER: RankingPeriod['key'][] = ['week', 'month', 'half_year', 'year'];
const PERIOD_LABEL: Record<string, string> = {
  week: 'Tydzień',
  month: 'Miesiąc',
  half_year: 'Półrocze',
  year: 'Rok',
};

function startOfWeekUtc(d: Date): Date {
  const x = new Date(d);
  const day = x.getUTCDay();
  const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function formatMoney(value: number) {
  return `${Math.round(Number(value) || 0).toLocaleString('pl-PL')} zł`;
}

function formatHours(value: number) {
  return `${(Number(value) || 0).toFixed(1)} h`;
}

export default function KpiTydzienScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/kpi-tydzien');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<AutoplanHistoryItem[]>([]);
  const [ranking, setRanking] = useState<RankingResponse | null>(null);

  const refresh = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const [historyData, rankingRes] = await Promise.all([
        loadAutoplanHistory(),
        fetch(`${API_URL}/raporty/ranking-brygad`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setHistory(historyData);
      if (!rankingRes.ok) throw new Error(`HTTP ${rankingRes.status}`);
      setRanking(await rankingRes.json());
    } catch {
      setError('Nie udało się pobrać ligi brygad.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const historyStats = useMemo(() => {
    const wsIso = startOfWeekUtc(new Date()).toISOString();
    const filtered = history.filter((h) => h.at >= wsIso);
    return {
      filtered,
      applies: filtered.filter((h) => h.action === 'apply').length,
      rollbacks: filtered.filter((h) => h.action === 'rollback').length,
      okSum: filtered.reduce((a, h) => a + h.ok, 0),
      qSum: filtered.reduce((a, h) => a + h.queued, 0),
    };
  }, [history]);

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) return <View style={S.root} />;
  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <AppStatusBar />
      <ScreenHeader title={t('kpiWeek.title')} />
      <ScrollView
        style={S.scroll}
        contentContainerStyle={S.pad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} tintColor={theme.accent} />}
      >
        <Text style={S.hint}>{t('kpiWeek.hint')}</Text>
        {error ? <Text style={S.error}>{error}</Text> : null}

        {PERIOD_ORDER.map((key) => {
          const period = ranking?.periods?.[key];
          const winner = period?.winner;
          const items = Array.isArray(period?.items) ? period.items.slice(0, 4) : [];
          return (
            <View key={key} style={S.periodCard}>
              <View style={S.periodHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={S.periodOverline}>{PERIOD_LABEL[key]}</Text>
                  <Text style={S.periodTitle}>{period?.label || PERIOD_LABEL[key]}</Text>
                  {period ? <Text style={S.periodRange}>{period.from} - {period.to}</Text> : null}
                </View>
                <View style={S.scoreBadge}>
                  <Text style={S.scoreBadgeNum}>{winner?.score ?? '-'}</Text>
                  <Text style={S.scoreBadgeTxt}>pkt</Text>
                </View>
              </View>

              {winner ? (
                <View style={S.winnerBox}>
                  <View style={S.winnerTitleRow}>
                    <Ionicons name="trophy-outline" size={18} color={theme.warning} />
                    <Text style={S.winnerTitle}>{winner.ekipa_nazwa}</Text>
                  </View>
                  <Text style={S.winnerSub}>
                    {winner.oddzial_nazwa || 'Oddział'}{winner.brygadzista_nazwa ? ` · ${winner.brygadzista_nazwa}` : ''}
                  </Text>
                  <View style={S.metricsRow}>
                    <Metric label="Zlecenia" value={`${winner.completed_tasks}/${winner.total_tasks}`} theme={theme} />
                    <Metric label="Wartość" value={formatMoney(winner.revenue)} theme={theme} />
                    <Metric label="Godziny" value={formatHours(winner.logged_hours || winner.planned_hours)} theme={theme} />
                  </View>
                  <View style={S.metricsRow}>
                    <Metric label="Zdjęcia" value={String(winner.photos_count)} theme={theme} />
                    <Metric label="Realizacja" value={`${winner.completion_rate}%`} theme={theme} />
                    <Metric label="Problemy" value={String(winner.issues_count)} theme={theme} danger={winner.issues_count > 0} />
                  </View>
                </View>
              ) : (
                <Text style={S.empty}>Brak danych w tym okresie.</Text>
              )}

              {items.length > 1 ? (
                <View style={S.table}>
                  {items.slice(1).map((row) => (
                    <View key={`${key}-${row.team_id}`} style={S.row}>
                      <Text style={S.rank}>#{row.rank}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={S.rowName}>{row.ekipa_nazwa}</Text>
                        <Text style={S.rowSub}>{row.completed_tasks}/{row.total_tasks} zleceń · {formatMoney(row.revenue)}</Text>
                      </View>
                      <Text style={S.rowScore}>{row.score}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        <View style={S.techCard}>
          <Text style={S.subTitle}>Ślad autoplanu</Text>
          <Text style={S.techHint}>Techniczny licznik zmian planu w bieżącym tygodniu.</Text>
          <View style={S.metricsRow}>
            <Metric label="Wpisy" value={String(historyStats.filtered.length)} theme={theme} />
            <Metric label="Apply" value={String(historyStats.applies)} theme={theme} />
            <Metric label="Rollback" value={String(historyStats.rollbacks)} theme={theme} />
          </View>
          <View style={S.metricsRow}>
            <Metric label="Online OK" value={String(historyStats.okSum)} theme={theme} />
            <Metric label="Offline" value={String(historyStats.qSum)} theme={theme} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, theme, danger }: { label: string; value: string; theme: Theme; danger?: boolean }) {
  return (
    <View style={[metricStyles(theme).metric, danger && { borderColor: theme.warning }]}>
      <Text style={metricStyles(theme).metricLabel}>{label}</Text>
      <Text style={[metricStyles(theme).metricValue, danger && { color: theme.warning }]}>{value}</Text>
    </View>
  );
}

function metricStyles(theme: Theme) {
  return StyleSheet.create({
    metric: {
      flex: 1,
      minWidth: 86,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },
    metricLabel: { fontSize: 10, color: theme.textMuted, marginBottom: 2 },
    metricValue: { fontSize: 13, fontWeight: '800', color: theme.text },
  });
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    scroll: { flex: 1 },
    pad: { padding: 14, paddingBottom: 40 },
    hint: { fontSize: 13, color: theme.textMuted, marginBottom: 10, lineHeight: 18 },
    error: {
      color: theme.danger,
      backgroundColor: theme.danger + '12',
      borderColor: theme.danger + '44',
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
    },
    periodCard: {
      backgroundColor: theme.cardBg,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
    },
    periodHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
    periodOverline: { fontSize: 10, color: theme.textMuted, textTransform: 'uppercase', fontWeight: '800', letterSpacing: 0 },
    periodTitle: { fontSize: 16, fontWeight: '900', color: theme.text, marginTop: 2 },
    periodRange: { fontSize: 11, color: theme.textSub, marginTop: 2 },
    scoreBadge: {
      minWidth: 58,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.accent + '55',
      backgroundColor: theme.accent + '12',
      borderRadius: 10,
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
    scoreBadgeNum: { fontSize: 18, fontWeight: '900', color: theme.accent },
    scoreBadgeTxt: { fontSize: 10, color: theme.textMuted },
    winnerBox: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, backgroundColor: theme.surface },
    winnerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    winnerTitle: { fontSize: 16, fontWeight: '900', color: theme.text, flex: 1 },
    winnerSub: { fontSize: 12, color: theme.textSub, marginTop: 3, marginBottom: 8 },
    metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 },
    empty: { color: theme.textMuted, fontSize: 13, paddingVertical: 10 },
    table: { marginTop: 9, borderTopWidth: 1, borderTopColor: theme.border },
    row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
    rank: { width: 34, color: theme.textMuted, fontWeight: '800' },
    rowName: { color: theme.text, fontWeight: '800', fontSize: 13 },
    rowSub: { color: theme.textSub, fontSize: 11, marginTop: 2 },
    rowScore: { color: theme.accent, fontWeight: '900', fontSize: 16 },
    techCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      padding: 12,
      marginTop: 4,
    },
    subTitle: { fontSize: 14, fontWeight: '900', color: theme.text },
    techHint: { fontSize: 12, color: theme.textMuted, marginTop: 3 },
  });
}
