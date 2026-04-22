import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Platform, RefreshControl, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';

export default function UzytkownicyScreen() {
  const { theme } = useTheme();
  const rolaKolorMap = useMemo(() => ({
    Dyrektor: theme.chartViolet,
    Administrator: theme.warning,
    Kierownik: theme.info,
    Brygadzista: theme.success,
  }), [theme]);
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/uzytkownicy-mobile');
  const [uzytkownicy, setUzytkownicy] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filtrRola, setFiltrRola] = useState('');

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    let wynik = uzytkownicy;
    if (search) {
      wynik = wynik.filter(u =>
        u.imie?.toLowerCase().includes(search.toLowerCase()) ||
        u.nazwisko?.toLowerCase().includes(search.toLowerCase()) ||
        u.login?.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (filtrRola) wynik = wynik.filter(u => u.rola === filtrRola);
    setFiltered(wynik);
  }, [search, filtrRola, uzytkownicy]);

  const loadData = async () => {
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${storedToken}` };
      const [uRes, oRes] = await Promise.all([
        fetch(`${API_URL}/uzytkownicy`, { headers: h }),
        fetch(`${API_URL}/oddzialy`, { headers: h }),
      ]);
      if (uRes.ok) setUzytkownicy(await uRes.json());
      if (oRes.ok) setOddzialy(await oRes.json());
    } catch {
      setUzytkownicy([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const role = ['', 'Brygadzista', 'Kierownik', 'Dyrektor', 'Administrator'];
  const getOddzial = (id: number) => oddzialy.find(o => o.id === id)?.nazwa || '-';

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

  return (
    <KeyboardSafeScreen style={S.container}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('users.title')}</Text>
        <Text style={S.headerCount}>{filtered.length}</Text>
      </View>

      {/* Search */}
      <View style={S.searchBox}>
        <View style={S.searchInner}>
          <Ionicons name="search-outline" size={16} color={theme.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={S.searchInput}
            placeholder="Szukaj pracownika..."
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={theme.inputPlaceholder}
          />
        </View>
      </View>

      {/* Role filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={S.filtryScroll} contentContainerStyle={S.filtryContent}>
        {role.map(r => (
          <TouchableOpacity key={r}
            style={[S.filtrBtn, filtrRola === r && S.filtrBtnActive,
              r && filtrRola === r && { backgroundColor: rolaKolorMap[r as keyof typeof rolaKolorMap] }]}
            onPress={() => setFiltrRola(r)}>
            <Text style={[S.filtrText, filtrRola === r && S.filtrTextActive]}>
              {r || 'Wszyscy'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* KPI row */}
      <View style={S.kpiRow}>
        {[
          { label: 'Brygadziści', count: uzytkownicy.filter(u => u.rola === 'Brygadzista').length, color: theme.success },
          { label: 'Kierownicy', count: uzytkownicy.filter(u => u.rola === 'Kierownik').length, color: theme.info },
          { label: 'Aktywni', count: uzytkownicy.filter(u => u.aktywny).length, color: theme.accent },
        ].map(k => (
          <View key={k.label} style={[S.kpi, { borderTopColor: k.color }]}>
            <Text style={[S.kpiNum, { color: k.color }]}>{k.count}</Text>
            <Text style={S.kpiLabel}>{k.label}</Text>
          </View>
        ))}
      </View>

      {/* List */}
      <ScrollView style={S.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}>
        {filtered.length === 0 ? (
          <View style={S.empty}>
            <Ionicons name="people-outline" size={48} color={theme.textMuted} />
            <Text style={S.emptyTitle}>Brak pracowników</Text>
          </View>
        ) : filtered.map(u => (
          <View key={u.id} style={[S.card, !u.aktywny && S.cardInactive]}>
            <View style={S.cardLeft}>
              <View style={[S.avatar, { backgroundColor: (rolaKolorMap[u.rola as keyof typeof rolaKolorMap] || theme.textMuted) + '22' }]}>
                <Text style={[S.avatarText, { color: rolaKolorMap[u.rola as keyof typeof rolaKolorMap] || theme.textMuted }]}>
                  {u.imie?.[0]}{u.nazwisko?.[0]}
                </Text>
              </View>
            </View>
            <View style={S.cardBody}>
              <View style={S.cardTop}>
                <Text style={S.cardNazwa}>{u.imie} {u.nazwisko}</Text>
                {!u.aktywny && <Text style={S.nieaktywny}>Nieaktywny</Text>}
              </View>
              <Text style={S.cardLogin}>@{u.login}</Text>
              <View style={S.cardRow}>
                <View style={[S.rolaBadge, { backgroundColor: rolaKolorMap[u.rola as keyof typeof rolaKolorMap] || theme.textMuted }]}>
                  <Text style={S.rolaText}>{u.rola}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="business-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardOddzial}>{getOddzial(u.oddzial_id)}</Text>
                </View>
              </View>
              {u.telefon && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <Ionicons name="call-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardTelefon}>{u.telefon}</Text>
                </View>
              )}
              {u.stawka_godzinowa && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <Ionicons name="cash-outline" size={12} color={theme.accent} />
                  <Text style={S.cardStawka}>{u.stawka_godzinowa} PLN/h</Text>
                </View>
              )}
            </View>
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: t.headerText, fontSize: 18, fontWeight: '700', flex: 1, marginLeft: 8 },
  headerCount: { color: t.textMuted, fontSize: 14 },
  searchBox: { backgroundColor: t.cardBg, padding: 12, borderBottomWidth: 1, borderBottomColor: t.border },
  searchInner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.inputBg, borderRadius: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: t.inputBorder,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: t.inputText },
  filtryScroll: { backgroundColor: t.cardBg, maxHeight: 48 },
  filtryContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  filtrBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.border,
  },
  filtrBtnActive: { borderColor: 'transparent' },
  filtrText: { fontSize: 12, color: t.textMuted, fontWeight: '500' },
  filtrTextActive: { color: t.accentText, fontWeight: 'bold' },
  kpiRow: {
    flexDirection: 'row', padding: 12, gap: 8,
    backgroundColor: t.cardBg, borderBottomWidth: 1, borderBottomColor: t.border,
  },
  kpi: {
    flex: 1, backgroundColor: t.surface2, borderRadius: 10,
    padding: 10, alignItems: 'center', borderTopWidth: 3,
  },
  kpiNum: { fontSize: 20, fontWeight: 'bold', marginBottom: 2 },
  kpiLabel: { fontSize: 10, color: t.textMuted, textAlign: 'center' },
  list: { flex: 1, padding: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: t.text },
  card: {
    backgroundColor: t.cardBg, borderRadius: 14, padding: 14, marginBottom: 10,
    elevation: 1, flexDirection: 'row', gap: 12,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  cardInactive: { opacity: 0.6 },
  cardLeft: { alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: 'bold' },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  cardNazwa: { fontSize: 15, fontWeight: 'bold', color: t.text },
  nieaktywny: { fontSize: 11, color: t.danger, fontWeight: '600' },
  cardLogin: { fontSize: 12, color: t.textMuted, marginBottom: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  rolaBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  rolaText: { color: t.accentText, fontSize: 11, fontWeight: 'bold' },
  cardOddzial: { fontSize: 12, color: t.textMuted },
  cardTelefon: { fontSize: 12, color: t.textSub },
  cardStawka: { fontSize: 12, color: t.accent, fontWeight: '600' },
});
