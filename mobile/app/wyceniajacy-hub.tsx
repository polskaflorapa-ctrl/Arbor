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
import { getOddzialFeatureConfig, isFeatureEnabledForOddzial } from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';

type OgledzinyLite = {
  id: number;
  status?: string;
  data_planowana?: string;
  oddzial_id?: number | string;
  wyceniajacy_id?: number | string;
};

type SessionUser = {
  id?: number | string;
  rola?: string;
  oddzial_id?: number | string;
};

const isToday = (dateLike?: string) => {
  if (!dateLike) return false;
  return dateLike.split('T')[0] === new Date().toISOString().split('T')[0];
};

export default function WyceniajacyHubScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/wyceniajacy-hub');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<OgledzinyLite[]>([]);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  const load = useCallback(async () => {
    try {
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      setSessionUser(user);
      const res = await fetch(`${API_URL}/ogledziny`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const source = Array.isArray(data) ? data : [];
        const userId = user?.id != null ? String(user.id) : '';
        const userOddzialId = user?.oddzial_id != null ? String(user.oddzial_id) : '';
        const filtered = source.filter((item: OgledzinyLite) => {
          const sameOddzial = !userOddzialId || !item.oddzial_id || String(item.oddzial_id) === userOddzialId;
          const assignedToUser = !item.wyceniajacy_id || !userId || String(item.wyceniajacy_id) === userId;
          return sameOddzial && assignedToUser;
        });
        setItems(filtered);
      } else {
        setItems([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => items.filter((item) => isToday(item.data_planowana)), [items]);
  const todayDone = useMemo(() => today.filter((item) => item.status === 'Zakonczone'), [today]);
  const todayPlanned = today.length;
  const todayLeft = Math.max(0, todayPlanned - todayDone.length);
  const todayTargetHint = useMemo(() => {
    if (todayPlanned < 6) return t('hub.targetBelow');
    if (todayPlanned > 15) return t('hub.targetAbove');
    return t('hub.targetOk');
  }, [todayPlanned, t]);
  const oddzialConfig = getOddzialFeatureConfig(sessionUser?.oddzial_id);

  const S = makeStyles(theme);

  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (!guard.allowed) {
    return <View style={S.center} />;
  }

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title}>{t('hub.screenEstimator')}</Text>
          <Text style={S.subtitle}>{t('hub.subtitleEstimator')}</Text>
        </View>
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(); }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={S.kpiRow}>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayPlanned}</Text>
            <Text style={S.kpiLabel}>{t('hub.kpi.today')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayLeft}</Text>
            <Text style={S.kpiLabel}>{t('hub.kpi.left')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayDone.length}</Text>
            <Text style={S.kpiLabel}>{t('hub.kpi.done')}</Text>
          </View>
        </View>
        <View style={S.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color={theme.info} />
          <Text style={S.hintText}>
            {todayTargetHint}
            {` • ${oddzialConfig.name}`}
          </Text>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('hub.quickActions')}</Text>
          <View style={S.grid}>
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/ogledziny') ? (
              <ActionTile label={t('hub.action.inspectionList')} icon="search-outline" onPress={() => router.push('/ogledziny')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wycena-kalendarz') ? (
              <ActionTile label={t('hub.action.quoteCalendar')} icon="calendar-outline" onPress={() => router.push('/wycena-kalendarz')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wycena-kalendarz') ? (
              <ActionTile label={t('hub.action.newQuote')} icon="add-circle-outline" onPress={() => router.push('/wycena-kalendarz')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wycena') ? (
              <ActionTile label={t('hub.action.photoDocs')} icon="camera-outline" onPress={() => router.push('/wycena')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wyceniajacy-finanse') ? (
              <ActionTile
                label={t('hub.action.estimatorPay')}
                icon="cash-outline"
                onPress={() => router.push('/wyceniajacy-finanse' as never)}
                theme={theme}
              />
            ) : null}
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('hub.workflowTitle')}</Text>
          <Text style={S.flowText}>{t('hub.flow1')}</Text>
          <Text style={S.flowText}>{t('hub.flow2')}</Text>
          <Text style={S.flowText}>{t('hub.flow3')}</Text>
          <Text style={S.flowText}>{t('hub.flow4')}</Text>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function ActionTile({
  label,
  icon,
  onPress,
  theme,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <TouchableOpacity style={[stylesAction.tile, { backgroundColor: theme.surface2, borderColor: theme.border }]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <Text style={[stylesAction.label, { color: theme.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const stylesAction = StyleSheet.create({
  tile: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 8,
  },
  label: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
});

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },
  header: {
    backgroundColor: t.headerBg,
    paddingHorizontal: 14,
    paddingTop: 54,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: t.headerText },
  subtitle: { fontSize: 12, color: t.headerSub },
  kpiRow: { flexDirection: 'row', gap: 8, padding: 12 },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface,
    padding: 12,
    alignItems: 'center',
  },
  kpiNum: { fontSize: 20, fontWeight: '800', color: t.accent },
  kpiLabel: { fontSize: 11, color: t.textSub, marginTop: 2 },
  hintBox: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: t.infoBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hintText: { fontSize: 12, color: t.info, fontWeight: '700' },
  section: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface,
    padding: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flowText: { fontSize: 13, color: t.textSub, marginBottom: 6 },
});
