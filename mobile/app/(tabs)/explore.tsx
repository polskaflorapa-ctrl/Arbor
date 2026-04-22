import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { elevationCard } from '../../constants/elevation';
import { useLanguage } from '../../constants/LanguageContext';
import { useTheme } from '../../constants/ThemeContext';
import { API_URL } from '../../constants/api';
import type { Theme } from '../../constants/theme';
import { triggerHaptic } from '../../utils/haptics';
import { getStoredSession } from '../../utils/session';

interface ReportStats {
  total_tasks: number;
  total_hours: number;
  avg_margin_percent: number;
  completed_tasks: number;
  total_revenue: number;
  total_cost: number;
}

export default function ExploreScreen() {
  const { theme } = useTheme();
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<ReportStats>({
    total_tasks: 0,
    total_hours: 0,
    avg_margin_percent: 0,
    completed_tasks: 0,
    total_revenue: 0,
    total_cost: 0,
  });
  const router = useRouter();
  const numberLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';

  const S = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const { token } = await getStoredSession();
      if (!token) {
        setStats({
          total_tasks: 0,
          total_hours: 0,
          avg_margin_percent: 0,
          completed_tasks: 0,
          total_revenue: 0,
          total_cost: 0,
        });
        return;
      }

      const response = await fetch(`${API_URL}/mobile/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Nie udało się pobrać raportów (${response.status})`);
      }

      const data = await response.json();
      setStats({
        total_tasks: Number(data?.total_tasks ?? 0),
        total_hours: Number(data?.total_hours ?? 0),
        avg_margin_percent: Number(data?.avg_margin_percent ?? 0),
        completed_tasks: Number(data?.completed_tasks ?? 0),
        total_revenue: Number(data?.total_revenue ?? 0),
        total_cost: Number(data?.total_cost ?? 0),
      });
    } catch {
      setStats({
        total_tasks: 0,
        total_hours: 0,
        avg_margin_percent: 0,
        completed_tasks: 0,
        total_revenue: 0,
        total_cost: 0,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  const formatCurrency = (value: number) =>
    `${value.toLocaleString(numberLocale, { minimumFractionDigits: 2 })} PLN`;

  const formatHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours % 1) * 60);
    return `${h}h ${m}min`;
  };

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={S.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
    >
      <View style={S.header}>
        <Text style={S.headerTitle}>Raporty</Text>
        <Text style={S.headerSub}>Analiza wydajności</Text>
      </View>

      <View style={S.kpiGrid}>
        <View style={[S.kpiCard, elevationCard(theme)]}>
          <Ionicons name="document-text-outline" size={28} color={theme.accent} />
          <Text style={S.kpiValue}>{stats.total_tasks}</Text>
          <Text style={S.kpiLabel}>Zleceń</Text>
        </View>
        <View style={[S.kpiCard, elevationCard(theme)]}>
          <Ionicons name="time-outline" size={28} color={theme.warning} />
          <Text style={S.kpiValue}>{formatHours(stats.total_hours)}</Text>
          <Text style={S.kpiLabel}>Przepracowane</Text>
        </View>
        <View style={[S.kpiCard, elevationCard(theme)]}>
          <Ionicons name="trending-up-outline" size={28} color={theme.accent} />
          <Text style={[S.kpiValue, { color: stats.avg_margin_percent >= 0 ? theme.success : theme.danger }]}>
            {stats.avg_margin_percent.toFixed(1)}%
          </Text>
          <Text style={S.kpiLabel}>Średnia marża</Text>
        </View>
        <View style={[S.kpiCard, elevationCard(theme)]}>
          <Ionicons name="checkmark-circle-outline" size={28} color={theme.info} />
          <Text style={S.kpiValue}>{stats.completed_tasks}</Text>
          <Text style={S.kpiLabel}>Zakończone</Text>
        </View>
      </View>

      <View style={[S.card, elevationCard(theme)]}>
        <Text style={S.cardTitle}>Podsumowanie finansowe</Text>
        <View style={S.financeRow}>
          <Text style={S.financeLabel}>Przychód:</Text>
          <Text style={S.financeValue}>{formatCurrency(stats.total_revenue)}</Text>
        </View>
        <View style={S.financeRow}>
          <Text style={S.financeLabel}>Koszty:</Text>
          <Text style={[S.financeValue, { color: theme.danger }]}>{formatCurrency(stats.total_cost)}</Text>
        </View>
        <View style={[S.financeRow, S.totalRow]}>
          <Text style={S.financeLabel}>Zysk:</Text>
          <Text style={[S.financeValue, { color: theme.success, fontWeight: '700' }]}>
            {formatCurrency(stats.total_revenue - stats.total_cost)}
          </Text>
        </View>
      </View>

      <View style={[S.card, elevationCard(theme)]}>
        <Text style={S.cardTitle}>Szybki dostęp</Text>
        <TouchableOpacity
          style={S.menuItem}
          onPress={() => {
            void triggerHaptic('light');
            router.push('/raport-dzienny');
          }}
        >
          <Ionicons name="document-text-outline" size={24} color={theme.accent} />
          <Text style={S.menuText}>Raport dzienny</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={S.menuItem}
          onPress={() => {
            void triggerHaptic('light');
            router.push('/harmonogram');
          }}
        >
          <Ionicons name="calendar-outline" size={24} color={theme.accent} />
          <Text style={S.menuText}>Harmonogram</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={S.menuItem}
          onPress={() => {
            void triggerHaptic('light');
            router.push('/rozliczenia');
          }}
        >
          <Ionicons name="calculator-outline" size={24} color={theme.accent} />
          <Text style={S.menuText}>Moje rozliczenia</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.bg,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.bg,
    },
    header: {
      backgroundColor: t.headerBg,
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 24,
      borderBottomLeftRadius: t.radiusXl,
      borderBottomRightRadius: t.radiusXl,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerTitle: {
      fontSize: t.fontScreenTitle,
      fontWeight: '700',
      color: t.headerText,
    },
    headerSub: {
      fontSize: t.fontBody,
      color: t.headerSub,
      marginTop: 6,
    },
    kpiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 16,
      marginTop: -12,
      gap: 12,
    },
    kpiCard: {
      flex: 1,
      minWidth: '45%',
      backgroundColor: t.cardBg,
      borderRadius: t.radiusLg,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.cardBorder,
    },
    kpiValue: {
      fontSize: t.fontScreenTitle,
      fontWeight: '700',
      color: t.text,
      marginTop: 8,
    },
    kpiLabel: {
      fontSize: t.fontCaption,
      color: t.textMuted,
      marginTop: 4,
    },
    card: {
      backgroundColor: t.cardBg,
      borderRadius: t.radiusLg,
      padding: 20,
      margin: 16,
      marginTop: 8,
      borderWidth: 1,
      borderColor: t.cardBorder,
    },
    cardTitle: {
      fontSize: t.fontSection,
      fontWeight: '700',
      color: t.accent,
      marginBottom: 16,
    },
    financeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    financeLabel: {
      fontSize: t.fontBody,
      color: t.textSub,
    },
    financeValue: {
      fontSize: t.fontBody,
      fontWeight: '600',
      color: t.text,
    },
    totalRow: {
      borderBottomWidth: 0,
      paddingTop: 12,
      marginTop: 4,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    menuText: {
      flex: 1,
      fontSize: t.fontBody,
      fontWeight: '600',
      color: t.text,
      marginLeft: 12,
    },
  });
}
