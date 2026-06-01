import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StatusBar,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import { getRolaColor, type Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getRoleDisplayName } from '../utils/role-display';
import { getStoredSession } from '../utils/session';
import { isTaskInProgress, makeTaskStatusColorMap } from '../constants/task-workflow';


interface Oddzial {
  id?: number;
  nazwa?: string;
  miasto?: string;
  adres?: string;
  telefon?: string;
  email?: string;
  kierownik_imie?: string;
  kierownik_nazwisko?: string;
  [key: string]: unknown;
}

interface OddzialDetail {
  pracownicy: any[];
  zlecenia: any[];
  brygadzisci: number;
  kierownicy: number;
  aktywneZlecenia: number;
  przychodTotal: number;
}

export default function OddzialyScreen() {
  const { theme } = useTheme();
  const rolaKolorMap = useMemo(() => ({
    Dyrektor: getRolaColor('Dyrektor'),
    Administrator: theme.warning,
    Kierownik: theme.info,
    Brygadzista: theme.success,
  }), [theme]);
  const statusKolorMap = useMemo(() => makeTaskStatusColorMap(theme), [theme]);
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/oddzialy-mobile');
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Oddzial | null>(null);
  const [detailData, setDetailData] = useState<OddzialDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/oddzialy`, {
        headers: { Authorization: `Bearer ${storedToken}` }
      });
      if (res.ok) setOddzialy(await res.json());
    } catch {
      setOddzialy([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadDetail = useCallback(async (oddzial: any, opts?: { soft?: boolean }) => {
    setSelected(oddzial);
    const showSpinner = !opts?.soft;
    if (showSpinner) setLoadingDetail(true);
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${storedToken}` };
      const [uRes, zRes] = await Promise.all([
        fetch(`${API_URL}/uzytkownicy`, { headers: h }),
        fetch(`${API_URL}/tasks/wszystkie`, { headers: h }),
      ]);
      const uzytkownicy = uRes.ok ? await uRes.json() : [];
      const zlecenia = zRes.ok ? await zRes.json() : [];

      const pracownicy = uzytkownicy.filter((u: any) => u.oddzial_id === oddzial.id);
      const zlecenieOddzialu = zlecenia.filter((z: any) => z.oddzial_id === oddzial.id);

      setDetailData({
        pracownicy,
        zlecenia: zlecenieOddzialu,
        brygadzisci: pracownicy.filter((u: any) => u.rola === 'Brygadzista').length,
        kierownicy: pracownicy.filter((u: any) => u.rola === 'Kierownik').length,
        aktywneZlecenia: zlecenieOddzialu.filter((z: any) => isTaskInProgress(z.status)).length,
        przychodTotal: zlecenieOddzialu.reduce((s: number, z: any) => s + (parseFloat(z.wartosc_planowana) || 0), 0),
      });
    } catch {
      setDetailData(null);
    } finally {
      if (showSpinner) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed <= 0) return;
      void loadData();
      if (selected) void loadDetail(selected, { soft: true });
    });
    return unsubscribe;
  }, [loadData, loadDetail, selected]);

  const onRefresh = () => { setRefreshing(true); void loadData(); };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.container} />;
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

  if (selected) {
    return (
      <View style={S.container}>
        <StatusBar
          barStyle={'light-content'}
          backgroundColor={theme.headerBg}
        />
        <View style={S.header}>
          <TouchableOpacity onPress={() => { setSelected(null); setDetailData(null); }} style={S.backBtn}>
            <Ionicons name="arrow-back" size={21} color={theme.accent} />
          </TouchableOpacity>
          <View style={S.headerIcon}>
            <Ionicons name="business-outline" size={22} color={theme.accent} />
          </View>
          <View style={S.headerTextBox}>
            <Text style={S.headerEyebrow}>Oddzial operacyjny</Text>
            <Text style={S.headerTitle} numberOfLines={1}>{selected.nazwa}</Text>
            <Text style={S.headerSub} numberOfLines={1}>{selected.miasto || 'Miasto nieustawione'}</Text>
          </View>
          <View style={S.headerCount}>
            <Text style={S.headerCountValue}>{detailData?.pracownicy?.length ?? '-'}</Text>
            <Text style={S.headerCountLabel}>ludzi</Text>
          </View>
        </View>

        {loadingDetail ? (
          <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>
        ) : (
          <ScrollView style={S.scroll}>
            {/* Info */}
            <View style={S.section}>
              <View style={S.sectionTitleRow}>
                <Ionicons name="information-circle-outline" size={16} color={theme.accent} />
                <Text style={S.sectionTitle}>Informacje</Text>
              </View>
              <Row label="Miasto" value={selected.miasto || '-'} theme={theme} />
              <Row label="Adres" value={selected.adres || '-'} theme={theme} />
              <Row label="Telefon" value={selected.telefon || '-'} theme={theme} />
              <Row label="Email" value={selected.email || '-'} theme={theme} />
              <Row label="Kierownik" value={selected.kierownik_imie
                ? `${selected.kierownik_imie} ${selected.kierownik_nazwisko}` : '-'} theme={theme} />
            </View>

            {detailData && (
              <>
                <View style={S.kpiRow}>
                  <View style={[S.kpi, { borderTopColor: theme.info }]}>
                    <Text style={[S.kpiNum, { color: theme.info }]}>{detailData.pracownicy.length}</Text>
                    <Text style={S.kpiLabel}>Pracownicy</Text>
                  </View>
                  <View style={[S.kpi, { borderTopColor: theme.success }]}>
                    <Text style={[S.kpiNum, { color: theme.success }]}>{detailData.brygadzisci}</Text>
                    <Text style={S.kpiLabel}>Brygadziści</Text>
                  </View>
                  <View style={[S.kpi, { borderTopColor: theme.warning }]}>
                    <Text style={[S.kpiNum, { color: theme.warning }]}>{detailData.aktywneZlecenia}</Text>
                    <Text style={S.kpiLabel}>W realizacji</Text>
                  </View>
                  <View style={[S.kpi, { borderTopColor: theme.accent }]}>
                    <Text style={[S.kpiNum, { color: theme.accent }]}>{detailData.zlecenia.length}</Text>
                    <Text style={S.kpiLabel}>Zleceń</Text>
                  </View>
                </View>

                <View style={S.section}>
                  <View style={S.sectionTitleRow}>
                    <Ionicons name="cash-outline" size={16} color={theme.accent} />
                    <Text style={S.sectionTitle}>Przychód z zleceń</Text>
                  </View>
                  <Text style={[S.bigNum, { color: theme.accent }]}>
                    {detailData.przychodTotal.toLocaleString('pl-PL')} PLN
                  </Text>
                </View>

                <View style={S.section}>
                  <View style={S.sectionTitleRow}>
                    <Ionicons name="people-outline" size={16} color={theme.accent} />
                    <Text style={S.sectionTitle}>Pracownicy ({detailData.pracownicy.length})</Text>
                  </View>
                  {detailData.pracownicy.length === 0 ? (
                    <Text style={S.emptyText}>Brak pracowników</Text>
                  ) : detailData.pracownicy.map((u: any) => (
                    <View key={u.id} style={S.personRow}>
                      <View style={[S.avatar, { backgroundColor: (rolaKolorMap[u.rola as keyof typeof rolaKolorMap] || theme.textMuted) + '22' }]}>
                        <Text style={[S.avatarText, { color: rolaKolorMap[u.rola as keyof typeof rolaKolorMap] || theme.textMuted }]}>
                          {u.imie?.[0]}{u.nazwisko?.[0]}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.personNazwa}>{u.imie} {u.nazwisko}</Text>
                        <Text style={S.personRola}>{getRoleDisplayName(u.rola)}</Text>
                      </View>
                      {u.telefon && <Text style={S.personTel}>{u.telefon}</Text>}
                    </View>
                  ))}
                </View>

                <View style={S.section}>
                  <View style={S.sectionTitleRow}>
                    <Ionicons name="clipboard-outline" size={16} color={theme.accent} />
                    <Text style={S.sectionTitle}>Ostatnie zlecenia</Text>
                  </View>
                  {detailData.zlecenia.length === 0 ? (
                    <Text style={S.emptyText}>Brak zleceń</Text>
                  ) : detailData.zlecenia.slice(0, 5).map((z: any) => (
                    <TouchableOpacity key={z.id} style={S.zlecenieRow}
                      onPress={() => router.push(`/zlecenie/${z.id}`)}>
                      <View style={[S.statusDot, { backgroundColor: statusKolorMap[z.status as keyof typeof statusKolorMap] || theme.textMuted }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={S.zlecenieKlient}>{z.klient_nazwa}</Text>
                        <Text style={S.zlecenieAdres}>{z.adres}</Text>
                      </View>
                      <Text style={[S.zlecenieWartosc, { color: theme.accent }]}>
                        {parseFloat(z.wartosc_planowana || 0).toLocaleString('pl-PL')} PLN
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={S.container}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor={theme.headerBg}
      />
      <View style={S.header}>
        <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="business-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Mapa firmy</Text>
          <Text style={S.headerTitle}>{t('branches.title')}</Text>
          <Text style={S.headerSub}>Oddzialy, kierownicy i lokalne zespoly bez mieszania regionow.</Text>
        </View>
        <View style={S.headerCount}>
          <Text style={S.headerCountValue}>{oddzialy.length}</Text>
          <Text style={S.headerCountLabel}>oddz.</Text>
        </View>
      </View>

      <ScrollView style={S.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}>
        {oddzialy.length === 0 ? (
          <View style={[S.center, { paddingTop: 60 }]}>
            <Ionicons name="business-outline" size={48} color={theme.textMuted} />
            <Text style={S.emptyTitle}>Brak oddziałów</Text>
          </View>
        ) : oddzialy.map(o => (
          <TouchableOpacity key={o.id} style={S.card} onPress={() => loadDetail(o)}>
            <View style={S.cardLeft}>
              <View style={S.cardIconBox}>
                <Ionicons name="business" size={24} color={theme.accent} />
              </View>
            </View>
            <View style={S.cardBody}>
              <Text style={S.cardNazwa} numberOfLines={1}>{o.nazwa}</Text>
              {o.miasto && (
                <View style={S.cardMetaRow}>
                  <Ionicons name="location-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardMiasto} numberOfLines={1}>{o.miasto}</Text>
                </View>
              )}
              {o.kierownik_imie && (
                <View style={S.cardMetaRow}>
                  <Ionicons name="person-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardKierownik} numberOfLines={1}>{o.kierownik_imie} {o.kierownik_nazwisko}</Text>
                </View>
              )}
              {o.telefon && (
                <View style={S.cardMetaRow}>
                  <Ionicons name="call-outline" size={12} color={theme.accent} />
                  <Text style={S.cardTel} numberOfLines={1}>{o.telefon}</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
          </TouchableOpacity>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function Row({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  const S = makeStyles(theme);
  return (
    <View style={S.row}>
      <Text style={S.rowLabel}>{label}</Text>
      <Text style={S.rowValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },
  header: {
    backgroundColor: t.cardBg,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.14,
      radius: t.shadowRadius * 0.45,
      offsetY: 3,
      elevation: t.cardElevation + 1,
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
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBox: { flex: 1, minWidth: 0 },
  headerEyebrow: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  headerTitle: { color: t.text, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 2 },
  headerSub: { color: t.textSub, fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 2 },
  headerCount: {
    minWidth: 58,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerCountValue: { color: t.accent, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  headerCountLabel: { color: t.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: t.text, marginTop: 12 },
  card: {
    backgroundColor: t.cardBg, marginHorizontal: 14, marginTop: 10,
    borderRadius: 18, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.09,
      radius: t.shadowRadius * 0.3,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  cardLeft: {},
  cardIconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardNazwa: { fontSize: 16, fontWeight: '900', color: t.text, marginBottom: 6 },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  cardMiasto: { fontSize: 12, color: t.textMuted, fontWeight: '800' },
  cardKierownik: { fontSize: 12, color: t.textSub, fontWeight: '700' },
  cardTel: { fontSize: 12, color: t.accent, fontWeight: '900' },
  section: {
    backgroundColor: t.cardBg, marginHorizontal: 14, marginTop: 10, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.08,
      radius: t.shadowRadius * 0.28,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: t.border },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: t.text },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, gap: 8 },
  kpi: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 74,
    backgroundColor: t.cardBg,
    borderRadius: 15,
    padding: 10,
    alignItems: 'center',
    borderTopWidth: 3,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  kpiNum: { fontSize: 20, fontWeight: '900', marginBottom: 2, fontVariant: ['tabular-nums'] },
  kpiLabel: { fontSize: 10, color: t.textMuted, textAlign: 'center', fontWeight: '800' },
  bigNum: { fontSize: 28, fontWeight: '900', textAlign: 'center', paddingVertical: 8, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  rowLabel: { fontSize: 14, color: t.textMuted, fontWeight: '700' },
  rowValue: { fontSize: 14, fontWeight: '800', color: t.text, flex: 1, textAlign: 'right' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.border },
  avatar: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '900' },
  personNazwa: { fontSize: 14, fontWeight: '900', color: t.text },
  personRola: { fontSize: 12, color: t.textMuted, fontWeight: '700' },
  personTel: { fontSize: 12, color: t.accent, fontWeight: '800' },
  zlecenieRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  zlecenieKlient: { fontSize: 14, fontWeight: '900', color: t.text },
  zlecenieAdres: { fontSize: 12, color: t.textMuted, fontWeight: '700' },
  zlecenieWartosc: { fontSize: 12, fontWeight: '900' },
  emptyText: { color: t.textMuted, textAlign: 'center', padding: 16 },
});
