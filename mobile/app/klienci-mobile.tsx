import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';

type ClientListItem = {
  id: number;
  imie?: string | null;
  nazwisko?: string | null;
  firma?: string | null;
  telefon?: string | null;
  email?: string | null;
  miasto?: string | null;
  liczba_zlecen?: number;
  liczba_ogledzen?: number;
};

type ClientDetailTask = {
  id: number;
  status?: string | null;
  typ_uslugi?: string | null;
  data_planowana?: string | null;
  adres?: string | null;
  miasto?: string | null;
};

type ClientDetailInspection = {
  id: number;
  status?: string | null;
  data_planowana?: string | null;
};

type ClientDetail = ClientListItem & {
  adres?: string | null;
  kod_pocztowy?: string | null;
  notatki?: string | null;
  zrodlo?: string | null;
  zlecenia?: ClientDetailTask[];
  ogledziny?: ClientDetailInspection[];
};

const EMPTY_FORM = {
  imie: '',
  nazwisko: '',
  firma: '',
  telefon: '',
  email: '',
  adres: '',
  miasto: '',
  kod_pocztowy: '',
  notatki: '',
  zrodlo: 'telefon',
};

async function parseResponse(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default function KlienciMobileScreen() {
  const { theme } = useTheme();
  const guard = useOddzialFeatureGuard('/klienci-mobile');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [list, setList] = useState<ClientListItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const S = makeStyles(theme);

  const selectedTitle = useMemo(() => {
    if (!detail) return '';
    const fullName = `${detail.imie || ''} ${detail.nazwisko || ''}`.trim();
    return detail.firma?.trim() || fullName || `Klient #${detail.id}`;
  }, [detail]);

  const loadDetail = useCallback(async (id: number, authToken: string | null) => {
      if (!authToken) return;
      setDetailLoading(true);
      try {
        const res = await fetch(`${API_URL}/klienci/${id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = (await parseResponse(res)) as ClientDetail | { error?: string } | null;
        if (!res.ok) {
          throw new Error(
            typeof data === 'object' && data && 'error' in data && data.error ? data.error : 'Nie udalo sie pobrac szczegolow klienta.',
          );
        }
        setDetail((data || null) as ClientDetail | null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Blad odczytu klienta.';
        Alert.alert('Klienci', msg);
      } finally {
        setDetailLoading(false);
      }
    }, []);

  const loadList = useCallback(
    async (opts: {
      authToken: string | null;
      keepSelected?: boolean;
      searchTerm?: string;
      selectedSnapshot?: number | null;
    }) => {
      const tokenToUse = opts.authToken;
      if (!tokenToUse) return;
      try {
        const searchTerm = (opts.searchTerm || '').trim();
        const query = searchTerm ? `?szukaj=${encodeURIComponent(searchTerm)}` : '';
        const res = await fetch(`${API_URL}/klienci${query}`, {
          headers: { Authorization: `Bearer ${tokenToUse}` },
        });
        const data = await parseResponse(res);
        if (!res.ok) {
          const msg =
            typeof data === 'object' && data && 'error' in data && (data as { error?: string }).error
              ? (data as { error?: string }).error
              : 'Nie udalo sie pobrac listy klientow.';
          throw new Error(msg);
        }
        const rows = Array.isArray(data)
          ? (data as ClientListItem[])
          : Array.isArray((data as { items?: ClientListItem[] })?.items)
            ? ((data as { items?: ClientListItem[] }).items as ClientListItem[])
            : [];
        setList(rows);
        const prevSelectedId = opts.selectedSnapshot ?? null;
        if (rows.length > 0) {
          const nextSelectedId =
            opts.keepSelected && prevSelectedId && rows.some((r) => r.id === prevSelectedId)
              ? prevSelectedId
              : rows[0].id;
          setSelectedId(nextSelectedId);
          await loadDetail(nextSelectedId, tokenToUse);
        } else {
          setSelectedId(null);
          setDetail(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Blad pobierania listy klientow.';
        Alert.alert('Klienci', msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadDetail],
  );

  useEffect(() => {
    void (async () => {
      const session = await getStoredSession();
      if (!session.token) {
        router.replace('/login');
        return;
      }
      setToken(session.token);
      await loadList({ authToken: session.token, searchTerm: '', selectedSnapshot: null });
    })();
  }, [loadList]);

  useEffect(() => {
    if (!token) return;
    const id = setTimeout(() => {
      void loadList({
        authToken: token,
        keepSelected: true,
        searchTerm: search,
        selectedSnapshot: selectedId,
      });
    }, 260);
    return () => clearTimeout(id);
  }, [search, selectedId, token, loadList]);

  const onPressClient = async (id: number) => {
    if (!token) return;
    setSelectedId(id);
    await loadDetail(id, token);
  };

  const openAdd = () => {
    setEditMode(false);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = () => {
    if (!detail) return;
    setEditMode(true);
    setForm({
      imie: detail.imie || '',
      nazwisko: detail.nazwisko || '',
      firma: detail.firma || '',
      telefon: detail.telefon || '',
      email: detail.email || '',
      adres: detail.adres || '',
      miasto: detail.miasto || '',
      kod_pocztowy: detail.kod_pocztowy || '',
      notatki: detail.notatki || '',
      zrodlo: detail.zrodlo || 'telefon',
    });
    setShowForm(true);
  };

  const saveClient = async () => {
    if (!token) return;
    if (!form.telefon.trim() && !form.email.trim()) {
      Alert.alert('Klienci', 'Podaj telefon lub email klienta.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        imie: form.imie.trim() || null,
        nazwisko: form.nazwisko.trim() || null,
        firma: form.firma.trim() || null,
        telefon: form.telefon.trim() || null,
        email: form.email.trim() || null,
        adres: form.adres.trim() || null,
        miasto: form.miasto.trim() || null,
        kod_pocztowy: form.kod_pocztowy.trim() || null,
        notatki: form.notatki.trim() || null,
        zrodlo: form.zrodlo.trim() || 'telefon',
      };
      const url = editMode && selectedId ? `${API_URL}/klienci/${selectedId}` : `${API_URL}/klienci`;
      const method = editMode && selectedId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'error' in data && (data as { error?: string }).error
            ? (data as { error?: string }).error
            : 'Nie udalo sie zapisac klienta.';
        throw new Error(msg);
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadList({
        authToken: token,
        keepSelected: true,
        searchTerm: search,
        selectedSnapshot: selectedId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad zapisu klienta.';
      Alert.alert('Klienci', msg);
    } finally {
      setSaving(false);
    }
  };

  const callClient = async (phone: string | null | undefined) => {
    if (!phone) return;
    const tel = `tel:${phone}`;
    const can = await Linking.canOpenURL(tel);
    if (!can) {
      Alert.alert('Telefon', 'To urzadzenie nie obsluguje wykonywania polaczen.');
      return;
    }
    await Linking.openURL(tel);
  };

  if (guard.ready && !guard.allowed) return <View style={S.center} />;
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
      <ScreenHeader
        title="Klienci"
        right={(
          <TouchableOpacity onPress={openAdd} style={S.headerAction}>
            <Ionicons name="add" size={20} color={theme.accent} />
          </TouchableOpacity>
        )}
        edgeSlotWidth={48}
      />

      <View style={S.searchWrap}>
        <Ionicons name="search-outline" size={17} color={theme.textMuted} />
        <TextInput
          style={S.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Szukaj klienta, telefonu, firmy..."
          placeholderTextColor={theme.inputPlaceholder}
        />
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadList({
                authToken: token,
                keepSelected: true,
                searchTerm: search,
                selectedSnapshot: selectedId,
              });
            }}
            tintColor={theme.accent}
          />
        )}
      >
        <Text style={S.sectionTitle}>Lista klientow ({list.length})</Text>
        {list.length === 0 ? (
          <View style={S.empty}>
            <Ionicons name="people-outline" size={42} color={theme.textMuted} />
            <Text style={S.emptyTitle}>Brak klientow dla tego filtra.</Text>
          </View>
        ) : (
          list.map((row) => {
            const isActive = row.id === selectedId;
            const fullName = `${row.imie || ''} ${row.nazwisko || ''}`.trim();
            const name = row.firma?.trim() || fullName || `Klient #${row.id}`;
            return (
              <TouchableOpacity key={row.id} style={[S.rowCard, isActive && S.rowCardActive]} onPress={() => void onPressClient(row.id)}>
                <View style={S.rowTop}>
                  <Text style={S.rowName}>{name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </View>
                <Text style={S.rowMeta}>
                  {row.telefon || 'Brak telefonu'}
                  {row.miasto ? `  •  ${row.miasto}` : ''}
                </Text>
                <Text style={S.rowStats}>
                  zlecenia: {Number(row.liczba_zlecen || 0)}  •  ogledziny: {Number(row.liczba_ogledzen || 0)}
                </Text>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={[S.sectionTitle, { marginTop: 14 }]}>Szczegoly</Text>
        {detailLoading ? (
          <View style={S.detailLoading}>
            <ActivityIndicator size="small" color={theme.accent} />
          </View>
        ) : !detail ? (
          <View style={S.empty}>
            <Text style={S.emptyTitle}>Wybierz klienta z listy.</Text>
          </View>
        ) : (
          <View style={S.detailCard}>
            <Text style={S.detailTitle}>{selectedTitle}</Text>
            <Text style={S.detailLine}>Telefon: {detail.telefon || 'brak'}</Text>
            <Text style={S.detailLine}>Email: {detail.email || 'brak'}</Text>
            <Text style={S.detailLine}>
              Adres: {detail.adres || '-'}
              {detail.miasto ? `, ${detail.miasto}` : ''}
            </Text>
            <Text style={S.detailLine}>Zrodlo: {detail.zrodlo || 'inne'}</Text>
            {detail.notatki ? <Text style={S.note}>{detail.notatki}</Text> : null}

            <View style={S.actionsRow}>
              <TouchableOpacity style={S.actionBtn} onPress={() => void callClient(detail.telefon)}>
                <Ionicons name="call-outline" size={15} color={theme.accent} />
                <Text style={S.actionText}>Zadzwon</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.actionBtn} onPress={openEdit}>
                <Ionicons name="create-outline" size={15} color={theme.accent} />
                <Text style={S.actionText}>Edytuj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/ogledziny' as never)}>
                <Ionicons name="search-outline" size={15} color={theme.accent} />
                <Text style={S.actionText}>Ogledziny</Text>
              </TouchableOpacity>
            </View>

            {(detail.zlecenia || []).slice(0, 4).map((task) => (
              <TouchableOpacity key={task.id} style={S.taskRow} onPress={() => router.push(`/zlecenie/${task.id}` as never)}>
                <View style={{ flex: 1 }}>
                  <Text style={S.taskTitle}>#{task.id} • {task.typ_uslugi || 'Zlecenie'}</Text>
                  <Text style={S.taskMeta}>
                    {(task.status || '-').replace('_', ' ')}
                    {task.data_planowana ? ` • ${new Date(task.data_planowana).toLocaleDateString('pl-PL')}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 26 }} />
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={S.modalBackdrop}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>{editMode ? 'Edycja klienta' : 'Nowy klient'}</Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
              {(
                [
                  ['imie', 'Imie'],
                  ['nazwisko', 'Nazwisko'],
                  ['firma', 'Firma'],
                  ['telefon', 'Telefon'],
                  ['email', 'Email'],
                  ['adres', 'Adres'],
                  ['miasto', 'Miasto'],
                  ['kod_pocztowy', 'Kod pocztowy'],
                  ['zrodlo', 'Zrodlo'],
                ] as [keyof typeof EMPTY_FORM, string][]
              ).map(([key, label]) => (
                <View key={key}>
                  <Text style={S.fieldLabel}>{label}</Text>
                  <TextInput
                    style={S.input}
                    value={form[key]}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, [key]: value }))}
                    placeholderTextColor={theme.inputPlaceholder}
                  />
                </View>
              ))}
              <View>
                <Text style={S.fieldLabel}>Notatki</Text>
                <TextInput
                  style={[S.input, S.notesInput]}
                  multiline
                  value={form.notatki}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, notatki: value }))}
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </ScrollView>
            <View style={S.modalActions}>
              <TouchableOpacity style={[S.modalBtn, S.modalGhost]} onPress={() => setShowForm(false)} disabled={saving}>
                <Text style={[S.modalBtnText, { color: theme.text }]}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.modalBtn, S.modalPrimary]} onPress={() => void saveClient()} disabled={saving}>
                <Text style={[S.modalBtnText, { color: theme.accentText }]}>{saving ? 'Zapisywanie...' : 'Zapisz'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, backgroundColor: t.bg, justifyContent: 'center', alignItems: 'center' },
    headerAction: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: t.surface2,
      borderWidth: 1,
      borderColor: t.cardBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchWrap: {
      marginHorizontal: 12,
      marginTop: 10,
      marginBottom: 8,
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    searchInput: {
      flex: 1,
      color: t.inputText,
      paddingVertical: 10,
      fontSize: 14,
    },
    scroll: { flex: 1, paddingHorizontal: 12 },
    sectionTitle: {
      color: t.textSub,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    empty: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      backgroundColor: t.surface2,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
      gap: 6,
    },
    emptyTitle: { color: t.textMuted, fontSize: 13 },
    rowCard: {
      backgroundColor: t.cardBg,
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 12,
      paddingHorizontal: 11,
      paddingVertical: 10,
      marginBottom: 8,
    },
    rowCardActive: {
      borderColor: t.accent,
      backgroundColor: t.accentLight,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowName: { color: t.text, fontWeight: '700', fontSize: 14, flex: 1, paddingRight: 8 },
    rowMeta: { color: t.textSub, fontSize: 12, marginTop: 4 },
    rowStats: { color: t.textMuted, fontSize: 11, marginTop: 3 },
    detailLoading: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
      backgroundColor: t.surface2,
    },
    detailCard: {
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 14,
      backgroundColor: t.cardBg,
      padding: 12,
      marginBottom: 8,
      gap: 5,
    },
    detailTitle: { color: t.text, fontWeight: '800', fontSize: 16, marginBottom: 2 },
    detailLine: { color: t.textSub, fontSize: 12 },
    note: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 9,
      backgroundColor: t.surface2,
      color: t.text,
      fontSize: 12,
      padding: 8,
      marginTop: 4,
    },
    actionsRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' },
    actionBtn: {
      minHeight: 40,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    actionText: { color: t.text, fontWeight: '600', fontSize: 12 },
    taskRow: {
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 9,
      marginTop: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    taskTitle: { color: t.text, fontSize: 12, fontWeight: '700' },
    taskMeta: { color: t.textMuted, fontSize: 11, marginTop: 2 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: '#00000099',
      justifyContent: 'flex-end',
      padding: 10,
    },
    modalCard: {
      backgroundColor: t.cardBg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.cardBorder,
      padding: 12,
      gap: 10,
    },
    modalTitle: { color: t.text, fontSize: 15, fontWeight: '800' },
    fieldLabel: { color: t.textMuted, fontSize: 11, marginBottom: 4, fontWeight: '700' },
    input: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: t.inputText,
      backgroundColor: t.inputBg,
      fontSize: 13,
    },
    notesInput: { minHeight: 72, textAlignVertical: 'top' },
    modalActions: { flexDirection: 'row', gap: 8 },
    modalBtn: {
      flex: 1,
      minHeight: 42,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalGhost: { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface2 },
    modalPrimary: { backgroundColor: t.accent, borderWidth: 1, borderColor: t.accentDark },
    modalBtnText: { fontSize: 13, fontWeight: '700' },
  });
