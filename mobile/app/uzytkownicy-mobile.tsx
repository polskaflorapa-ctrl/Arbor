import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import { getRolaColor, type Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getRoleDisplayName } from '../utils/role-display';
import { getStoredSession } from '../utils/session';

import { AppStatusBar } from '../components/ui/app-status-bar';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function UzytkownicyScreen() {
  const { theme } = useTheme();
  const rolaKolorMap = useMemo(() => ({
    Dyrektor: getRolaColor('Dyrektor'),
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

  const role = ['', 'Prezes', 'Dyrektor', 'Administrator', 'Kierownik', 'Dyspozytor', 'Handlowiec', 'Pracownik biurowy', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Wyceniający', 'Magazynier'];
  const getOddzial = (id: number) => oddzialy.find(o => o.id === id)?.nazwa || '-';
  const aktywniCount = uzytkownicy.filter(u => u.aktywny).length;
  const brygadzisciCount = uzytkownicy.filter(u => u.rola === 'Brygadzista').length;
  const kierownicyCount = uzytkownicy.filter(u => u.rola === 'Kierownik').length;
  const oddzialyCount = new Set(uzytkownicy.map(u => u.oddzial_id).filter(Boolean)).size || oddzialy.length;
  const kpiCards = [
    { label: 'Aktywni', count: aktywniCount, icon: 'checkmark-circle-outline' as IoniconName, color: theme.accent },
    { label: 'Brygady', count: brygadzisciCount, icon: 'leaf-outline' as IoniconName, color: theme.success },
    { label: 'Kierownicy', count: kierownicyCount, icon: 'shield-checkmark-outline' as IoniconName, color: theme.info },
    { label: 'Oddzialy', count: oddzialyCount, icon: 'business-outline' as IoniconName, color: theme.warning },
  ];

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
      <AppStatusBar />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="people-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Kadry i dostepy</Text>
          <Text style={S.headerTitle}>{t('users.title')}</Text>
          <Text style={S.headerSub}>Role, oddzialy i aktywnosc zespolu w jednym miejscu.</Text>
        </View>
        <View style={S.headerCount}>
          <Text style={S.headerCountValue}>{filtered.length}</Text>
          <Text style={S.headerCountLabel}>widoczni</Text>
        </View>
      </View>

      {/* Search */}
      <View style={S.searchBox}>
        <View style={S.searchInner}>
          <Ionicons name="search-outline" size={17} color={theme.accent} />
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
            style={[
              S.filtrBtn,
              filtrRola === r && S.filtrBtnActive,
              filtrRola === r && { backgroundColor: r ? rolaKolorMap[r as keyof typeof rolaKolorMap] : theme.accent },
            ]}
            onPress={() => setFiltrRola(r)}>
            <Text style={[S.filtrText, filtrRola === r && S.filtrTextActive]}>
              {r ? getRoleDisplayName(r) : 'Wszyscy'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* KPI row */}
      <View style={S.kpiRow}>
        {kpiCards.map(k => (
          <View key={k.label} style={[S.kpi, { borderColor: k.color + '44' }]}>
            <View style={[S.kpiIcon, { backgroundColor: k.color + '1F' }]}>
              <Ionicons name={k.icon} size={16} color={k.color} />
            </View>
            <Text style={[S.kpiNum, { color: theme.text }]}>{k.count}</Text>
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
        ) : filtered.map(u => {
          const rolaColor = rolaKolorMap[u.rola as keyof typeof rolaKolorMap] || theme.textMuted;
          const rolaLabel = getRoleDisplayName(u.rola);
          const initials = `${u.imie?.[0] || ''}${u.nazwisko?.[0] || ''}` || 'AR';
          return (
          <View key={u.id} style={[S.card, !u.aktywny && S.cardInactive, { borderLeftColor: rolaColor }]}>
            <View style={S.cardLeft}>
              <View style={[S.avatar, { backgroundColor: rolaColor + '1F', borderColor: rolaColor }]}>
                <Text style={[S.avatarText, { color: rolaColor }]}>{initials}</Text>
              </View>
            </View>
            <View style={S.cardBody}>
              <View style={S.cardTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={S.cardNazwa} numberOfLines={1}>{u.imie} {u.nazwisko}</Text>
                  <Text style={S.cardLogin} numberOfLines={1}>@{u.login}</Text>
                </View>
                <View style={[S.statusPill, { backgroundColor: u.aktywny ? theme.successBg : theme.dangerBg, borderColor: u.aktywny ? theme.success : theme.danger }]}>
                  <Text style={[S.statusPillText, { color: u.aktywny ? theme.success : theme.danger }]}>
                    {u.aktywny ? 'Aktywny' : 'Nieaktywny'}
                  </Text>
                </View>
              </View>
              <View style={S.cardRow}>
                <View style={[S.rolaBadge, { backgroundColor: rolaColor }]}>
                  <Text style={S.rolaText}>{rolaLabel}</Text>
                </View>
                <View style={S.metaPill}>
                  <Ionicons name="business-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardOddzial} numberOfLines={1}>{getOddzial(u.oddzial_id)}</Text>
                </View>
              </View>
              <View style={S.cardMetaGrid}>
                {u.telefon ? (
                  <View style={S.cardMetaItem}>
                    <Ionicons name="call-outline" size={12} color={theme.textMuted} />
                    <Text style={S.cardTelefon} numberOfLines={1}>{u.telefon}</Text>
                  </View>
                ) : null}
                {u.stawka_godzinowa ? (
                  <View style={S.cardMetaItem}>
                    <Ionicons name="cash-outline" size={12} color={theme.accent} />
                    <Text style={S.cardStawka}>{u.stawka_godzinowa} PLN/h</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
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
  searchBox: {
    backgroundColor: t.cardBg,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  searchInner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.inputBg, borderRadius: 13, paddingHorizontal: 12,
    borderWidth: 1, borderColor: t.inputBorder,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: t.inputText, fontWeight: '700' },
  filtryScroll: { maxHeight: 52 },
  filtryContent: { paddingHorizontal: 14, paddingVertical: 7, gap: 8, flexDirection: 'row' },
  filtrBtn: {
    minHeight: 34,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: t.cardBg, borderWidth: 1, borderColor: t.border,
  },
  filtrBtnActive: { borderColor: 'transparent' },
  filtrText: { fontSize: 12, color: t.textMuted, fontWeight: '900' },
  filtrTextActive: { color: t.accentText, fontWeight: '900' },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 8,
    gap: 8,
  },
  kpi: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 74,
    backgroundColor: t.cardBg,
    borderRadius: 15,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    gap: 3,
  },
  kpiIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiNum: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  kpiLabel: { fontSize: 10, color: t.textMuted, textAlign: 'center', fontWeight: '800' },
  list: { flex: 1, padding: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: t.text },
  card: {
    backgroundColor: t.cardBg,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.09,
      radius: t.shadowRadius * 0.3,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  cardInactive: { opacity: 0.6 },
  cardLeft: { alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '900' },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  cardNazwa: { fontSize: 15, fontWeight: '900', color: t.text },
  nieaktywny: { fontSize: 11, color: t.danger, fontWeight: '600' },
  cardLogin: { fontSize: 12, color: t.textMuted, marginTop: 2, fontWeight: '700' },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillText: { fontSize: 10, fontWeight: '900' },
  cardRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  rolaBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  rolaText: { color: t.accentText, fontSize: 11, fontWeight: '900' },
  metaPill: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  cardOddzial: { fontSize: 11, color: t.textMuted, fontWeight: '800', maxWidth: 128 },
  cardMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 22 },
  cardTelefon: { fontSize: 12, color: t.textSub, fontWeight: '700' },
  cardStawka: { fontSize: 12, color: t.accent, fontWeight: '900' },
});
