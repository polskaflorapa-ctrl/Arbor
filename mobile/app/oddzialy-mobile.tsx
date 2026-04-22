import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StatusBar,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';

export default function OddzialyScreen() {
  const { theme } = useTheme();
  const rolaKolorMap = useMemo(() => ({
    Dyrektor: theme.chartViolet,
    Administrator: theme.warning,
    Kierownik: theme.info,
    Brygadzista: theme.success,
  }), [theme]);
  const statusKolorMap = useMemo(() => ({
    Nowe: theme.info,
    Zaplanowane: theme.chartViolet,
    W_Realizacji: theme.warning,
    Zakonczone: theme.success,
    Anulowane: theme.danger,
  }), [theme]);
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/oddzialy-mobile');
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
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
  };

  const loadDetail = async (oddzial: any) => {
    setSelected(oddzial);
    setLoadingDetail(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${token}` };
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
        aktywneZlecenia: zlecenieOddzialu.filter((z: any) => z.status === 'W_Realizacji').length,
        przychodTotal: zlecenieOddzialu.reduce((s: number, z: any) => s + (parseFloat(z.wartosc_planowana) || 0), 0),
      });
    } catch {
      setDetailData(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadData(); };

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
          barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={theme.headerBg}
        />
        <View style={S.header}>
          <TouchableOpacity onPress={() => { setSelected(null); setDetailData(null); }} style={S.backBtn}>
            <Ionicons name="arrow-back" size={22} color={theme.headerText} />
          </TouchableOpacity>
          <Text style={S.headerTitle}>{selected.nazwa}</Text>
          <View style={{ width: 36 }} />
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
                  <View style={[S.kpi, { borderTopColor: theme.chartViolet }]}>
                    <Text style={[S.kpiNum, { color: theme.chartViolet }]}>{detailData.zlecenia.length}</Text>
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
                        <Text style={S.personRola}>{u.rola}</Text>
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
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('branches.title')}</Text>
        <Text style={S.headerCount}>{oddzialy.length}</Text>
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
              <View style={[S.cardIconBox, { backgroundColor: theme.accent + '22' }]}>
                <Ionicons name="business" size={24} color={theme.accent} />
              </View>
            </View>
            <View style={S.cardBody}>
              <Text style={S.cardNazwa}>{o.nazwa}</Text>
              {o.miasto && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Ionicons name="location-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardMiasto}>{o.miasto}</Text>
                </View>
              )}
              {o.kierownik_imie && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Ionicons name="person-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardKierownik}>{o.kierownik_imie} {o.kierownik_nazwisko}</Text>
                </View>
              )}
              {o.telefon && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="call-outline" size={12} color={theme.accent} />
                  <Text style={S.cardTel}>{o.telefon}</Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: t.headerText, fontSize: 18, fontWeight: '700', flex: 1, marginLeft: 8 },
  headerCount: { color: t.textMuted, fontSize: 14 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: t.text, marginTop: 12 },
  card: {
    backgroundColor: t.cardBg, margin: 12, marginBottom: 0,
    borderRadius: 14, padding: 16, elevation: 1,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  cardLeft: {},
  cardIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardNazwa: { fontSize: 16, fontWeight: 'bold', color: t.text, marginBottom: 4 },
  cardMiasto: { fontSize: 13, color: t.textMuted },
  cardKierownik: { fontSize: 13, color: t.textSub },
  cardTel: { fontSize: 13, color: t.accent },
  section: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 14, padding: 16,
    elevation: 1, borderWidth: 1, borderColor: t.cardBorder,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: t.text },
  kpiRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8 },
  kpi: {
    flex: 1, backgroundColor: t.cardBg, borderRadius: 12, padding: 12,
    alignItems: 'center', borderTopWidth: 3, elevation: 1,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  kpiNum: { fontSize: 22, fontWeight: 'bold', marginBottom: 2 },
  kpiLabel: { fontSize: 10, color: t.textMuted, textAlign: 'center' },
  bigNum: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', paddingVertical: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  rowLabel: { fontSize: 14, color: t.textMuted },
  rowValue: { fontSize: 14, fontWeight: '600', color: t.text, flex: 1, textAlign: 'right' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: 'bold' },
  personNazwa: { fontSize: 14, fontWeight: '600', color: t.text },
  personRola: { fontSize: 12, color: t.textMuted },
  personTel: { fontSize: 12, color: t.accent },
  zlecenieRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  zlecenieKlient: { fontSize: 14, fontWeight: '600', color: t.text },
  zlecenieAdres: { fontSize: 12, color: t.textMuted },
  zlecenieWartosc: { fontSize: 12, fontWeight: '600' },
  emptyText: { color: t.textMuted, textAlign: 'center', padding: 16 },
});
