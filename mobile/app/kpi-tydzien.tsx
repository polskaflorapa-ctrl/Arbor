import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { loadAutoplanHistory, type AutoplanHistoryItem } from '../utils/autoplan-history';

function startOfWeekUtc(d: Date): Date {
  const x = new Date(d);
  const day = x.getUTCDay();
  const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export default function KpiTydzienScreen() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const guard = useOddzialFeatureGuard('/kpi-tydzien');
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<AutoplanHistoryItem[]>([]);

  const refresh = useCallback(async () => {
    setHistory(await loadAutoplanHistory());
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const { weekStart, filtered, totals } = useMemo(() => {
    const now = new Date();
    const ws = startOfWeekUtc(now);
    const wsIso = ws.toISOString();
    const fh = history.filter((h) => h.at >= wsIso);
    const applies = fh.filter((h) => h.action === 'apply').length;
    const rollbacks = fh.filter((h) => h.action === 'rollback').length;
    const okSum = fh.reduce((a, h) => a + h.ok, 0);
    const qSum = fh.reduce((a, h) => a + h.queued, 0);
    return {
      weekStart: ws,
      filtered: fh,
      totals: { n: fh.length, applies, rollbacks, okSum, qSum },
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
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title={t('kpiWeek.title')} />
      <ScrollView style={S.scroll} contentContainerStyle={S.pad}>
        <Text style={S.hint}>{t('kpiWeek.hint')}</Text>
        <Text style={S.range}>
          {t('kpiWeek.range')}: {weekStart.toLocaleDateString(dateLocale)}
        </Text>
        <View style={S.kpiRow}>
          <View style={S.kpiBox}>
            <Text style={S.kpiLbl}>{t('kpiWeek.entries')}</Text>
            <Text style={S.kpiVal}>{totals.n}</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLbl}>{t('autoplan.dailySummaryApply')}</Text>
            <Text style={S.kpiVal}>{totals.applies}</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLbl}>{t('autoplan.dailySummaryRollback')}</Text>
            <Text style={S.kpiVal}>{totals.rollbacks}</Text>
          </View>
        </View>
        <View style={S.kpiRow}>
          <View style={[S.kpiBox, { flex: 1 }]}>
            <Text style={S.kpiLbl}>{t('autoplan.dailySummaryOk')}</Text>
            <Text style={S.kpiVal}>{totals.okSum}</Text>
          </View>
          <View style={[S.kpiBox, { flex: 1 }]}>
            <Text style={S.kpiLbl}>{t('autoplan.dailySummaryQueued')}</Text>
            <Text style={S.kpiVal}>{totals.qSum}</Text>
          </View>
        </View>
        <Text style={S.subTitle}>{t('kpiWeek.list')}</Text>
        {filtered.length === 0 ? (
          <Text style={S.empty}>{t('kpiWeek.empty')}</Text>
        ) : (
          filtered.slice(0, 40).map((h) => (
            <Text key={h.id} style={S.line}>
              {h.at.slice(0, 16).replace('T', ' ')} · {h.action} · {h.mode} · {h.changed}/{h.ok}+{h.queued}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    scroll: { flex: 1 },
    pad: { padding: 16, paddingBottom: 40 },
    hint: { fontSize: 13, color: theme.textMuted, marginBottom: 8 },
    range: { fontSize: 12, color: theme.textSub, marginBottom: 12 },
    kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    kpiBox: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 10,
    },
    kpiLbl: { fontSize: 11, color: theme.textMuted },
    kpiVal: { fontSize: 18, fontWeight: '800', color: theme.text },
    subTitle: { fontSize: 13, fontWeight: '800', color: theme.text, marginTop: 8, marginBottom: 6 },
    empty: { color: theme.textMuted, fontSize: 14 },
    line: { fontSize: 12, color: theme.textSub, marginBottom: 4 },
  });
}
