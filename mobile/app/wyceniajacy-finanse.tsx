import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
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
import type { Theme } from '../constants/theme';
import { API_URL } from '../constants/api';
import {
  computeEstimatorMonth,
  filterQuotesForEstimatorRole,
  resolveEstimatorContract,
  type EstimatorQuoteRow,
} from '../utils/estimator-compensation';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';

function ymFromDate(d: Date) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${m < 10 ? `0${m}` : m}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymFromDate(d);
}

const PAY_ROLES = new Set(['Wyceniający', 'Dyrektor', 'Administrator', 'Kierownik']);

export default function WyceniajacyFinanseScreen() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const numberLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const guard = useOddzialFeatureGuard('/wyceniajacy-finanse');
  const [user, setUser] = useState<any>(null);
  const [quotes, setQuotes] = useState<EstimatorQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthYm, setMonthYm] = useState(ymFromDate(new Date()));
  const [workingDays, setWorkingDays] = useState('22');

  const load = useCallback(async () => {
    try {
      const { token, user: u } = await getStoredSession();
      if (!token || !u) {
        router.replace('/login');
        return;
      }
      setUser(u);
      const role = typeof u?.rola === 'string' ? u.rola : '';
      if (!PAY_ROLES.has(role)) {
        router.replace('/dashboard');
        return;
      }
      const oid = u?.oddzial_id != null ? String(u.oddzial_id) : '';
      const q = oid ? `?oddzial_id=${encodeURIComponent(oid)}` : '';
      const res = await fetch(`${API_URL}/wyceny${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        let list: EstimatorQuoteRow[] = Array.isArray(d) ? d : [];
        list = filterQuotesForEstimatorRole(list, u?.id, role);
        setQuotes(list);
      } else {
        setQuotes([]);
      }
    } catch {
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const contract = useMemo(
    () => resolveEstimatorContract(user?.oddzial_id, user?.login),
    [user?.oddzial_id, user?.login],
  );

  const wdNum = Math.max(0, parseInt(workingDays.replace(/\D/g, ''), 10) || 0);
  const uid = user?.id != null ? String(user.id) : '';

  const result = useMemo(
    () => computeEstimatorMonth(contract, quotes, uid, monthYm, wdNum),
    [contract, quotes, uid, monthYm, wdNum],
  );

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.center} />;
  }
  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title={t('estimatorFinance.title')} />

      <ScrollView
        style={S.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <Text style={S.sub}>{t('estimatorFinance.subtitle')}</Text>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('estimatorFinance.month')}</Text>
          <View style={S.monthRow}>
            <TouchableOpacity onPress={() => setMonthYm((m) => shiftMonth(m, -1))} style={S.monthBtn}>
              <Ionicons name="chevron-back" size={22} color={theme.accent} />
            </TouchableOpacity>
            <Text style={S.monthText}>{monthYm}</Text>
            <TouchableOpacity onPress={() => setMonthYm((m) => shiftMonth(m, 1))} style={S.monthBtn}>
              <Ionicons name="chevron-forward" size={22} color={theme.accent} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('estimatorFinance.workingDays')}</Text>
          <Text style={S.hint}>{t('estimatorFinance.workingDaysHint')}</Text>
          <TextInput
            style={S.input}
            keyboardType="number-pad"
            value={workingDays}
            onChangeText={setWorkingDays}
            placeholder="22"
            placeholderTextColor={theme.inputPlaceholder}
          />
        </View>

        {!contract ? (
          <View style={[S.card, { borderColor: theme.warning }]}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.warning} />
            <Text style={[S.warn, { color: theme.text }]}>{t('estimatorFinance.noContract')}</Text>
          </View>
        ) : (
          <>
            <View style={S.card}>
              <Text style={S.cardTitle}>{t('estimatorFinance.contractLabel')}</Text>
              <Text style={S.rowStrong}>{contract.displayName}</Text>
              <Text style={S.row}>
                {t('estimatorFinance.dailyBase')}: {contract.dailyBasePln.toLocaleString(numberLocale)} PLN
              </Text>
              <Text style={S.row}>
                {t('estimatorFinance.percent')}: {(contract.percentRealized * 100).toFixed(2)}%
              </Text>
              <Text style={S.row}>
                {contract.calendarMode === 'own'
                  ? t('estimatorFinance.calendarOwn')
                  : t('estimatorFinance.calendarShared')}
              </Text>
            </View>

            <View style={S.card}>
              <Text style={S.cardTitle}>{t('estimatorFinance.linesTitle')}</Text>
              {result.lines.length === 0 ? (
                <Text style={S.muted}>{t('estimatorFinance.emptyLines')}</Text>
              ) : (
                result.lines.map((line) => (
                  <View key={String(line.wycenaId)} style={S.lineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={S.lineClient} numberOfLines={1}>
                        #{line.wycenaId} · {line.client}
                      </Text>
                      <Text style={S.muted}>{line.status}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={S.num}>{line.basisPln.toLocaleString(numberLocale)} PLN</Text>
                      <Text style={[S.num, { color: theme.accent }]}>
                        +{line.commissionPln.toLocaleString(numberLocale)} PLN
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={S.card}>
              <Text style={S.cardTitle}>{t('settlements.resultTitle')}</Text>
              <Text style={S.row}>
                {t('estimatorFinance.totalBaseDays')}:{' '}
                <Text style={S.rowStrong}>{result.baseFromDaysPln.toLocaleString(numberLocale)} PLN</Text>
              </Text>
              <Text style={S.row}>
                {t('estimatorFinance.basisColumn')} (Σ):{' '}
                <Text style={S.rowStrong}>{result.totalRealizedBasisPln.toLocaleString(numberLocale)} PLN</Text>
              </Text>
              <Text style={S.row}>
                {t('estimatorFinance.totalVariable')}:{' '}
                <Text style={S.rowStrong}>{result.variableFromPercentPln.toLocaleString(numberLocale)} PLN</Text>
              </Text>
              {contract.addons.length > 0 ? (
                <>
                  <Text style={[S.cardTitle, { marginTop: 10 }]}>{t('estimatorFinance.addons')}</Text>
                  {contract.addons.map((a) => (
                    <Text key={a.id} style={S.row}>
                      {a.label}:{' '}
                      <Text style={S.rowStrong}>{(a.monthlyFixedPln ?? 0).toLocaleString(numberLocale)} PLN</Text>
                    </Text>
                  ))}
                  <Text style={S.row}>
                    {t('estimatorFinance.totalAddons')}:{' '}
                    <Text style={S.rowStrong}>{result.addonsPln.toLocaleString(numberLocale)} PLN</Text>
                  </Text>
                </>
              ) : null}
              <View style={[S.totalBar, { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}>
                <Text style={S.totalLabel}>{t('estimatorFinance.grandTotal')}</Text>
                <Text style={[S.totalVal, { color: theme.accent }]}>{result.totalPln.toLocaleString(numberLocale)} PLN</Text>
              </View>
            </View>
          </>
        )}

        <View style={[S.card, { backgroundColor: theme.infoBg }]}>
          <Text style={[S.muted, { color: theme.text }]}>{t('estimatorFinance.disclaimer')}</Text>
        </View>
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
    scroll: { flex: 1 },
    sub: { fontSize: 13, color: t.textMuted, paddingHorizontal: 16, paddingVertical: 10 },
    card: {
      marginHorizontal: 14,
      marginBottom: 12,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      gap: 6,
    },
    cardTitle: { fontSize: 14, fontWeight: '800', color: t.text, marginBottom: 4 },
    monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
    monthBtn: { padding: 8 },
    monthText: { fontSize: 17, fontWeight: '700', color: t.text, minWidth: 100, textAlign: 'center' },
    hint: { fontSize: 12, color: t.textMuted, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      padding: 12,
      fontSize: 16,
      color: t.inputText,
      backgroundColor: t.inputBg,
    },
    row: { fontSize: 13, color: t.textSub },
    rowStrong: { fontSize: 14, fontWeight: '700', color: t.text },
    muted: { fontSize: 12, color: t.textMuted },
    warn: { fontSize: 13, marginTop: 8, lineHeight: 18 },
    lineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    lineClient: { fontSize: 13, fontWeight: '600', color: t.text },
    num: { fontSize: 12, fontWeight: '700', color: t.textSub },
    totalBar: {
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    totalLabel: { fontSize: 14, fontWeight: '700', color: t.text },
    totalVal: { fontSize: 18, fontWeight: '800' },
  });
}
