/**
 * M1 — szczegóły wyceny terenowej: wizyta GPS, obiekty, zdjęcia (ogólne + adnotacje), ważność, zakończenie wizyty.
 */
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardSafeScreen } from '../../components/ui/keyboard-safe-screen';
import { useTheme } from '../../constants/ThemeContext';
import { API_URL } from '../../constants/api';
import type { Theme } from '../../constants/theme';
import { getStoredSession } from '../../utils/session';

type QuotationRow = Record<string, unknown> & {
  id: number;
  status?: string;
  klient_nazwa?: string;
  adres?: string;
  miasto?: string;
  lat?: number | null;
  lng?: number | null;
  visit_started_at?: string | null;
  visit_ended_at?: string | null;
  waznosc_do?: string | null;
  wartosc_zaproponowana?: number | string | null;
  locked_at?: string | null;
};

type ItemRow = {
  id: number;
  gatunek?: string;
  wysokosc_pas?: string;
  typ_pracy?: string;
};

type NormRow = { gatunek_key: string; wysokosc_pas: string; typ_pracy_key: string };

function isoDatePlusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

export default function WycenaTerenowaDetailScreen() {
  const { theme } = useTheme();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState<QuotationRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [norms, setNorms] = useState<NormRow[]>([]);
  const [waznoscIso, setWaznoscIso] = useState(isoDatePlusDays(14));
  const [korektaTxt, setKorektaTxt] = useState('');
  const [korektaDrop, setKorektaDrop] = useState('');
  const [gpsOverrideNote, setGpsOverrideNote] = useState('');

  const [newGat, setNewGat] = useState('dąb');
  const [newWys, setNewWys] = useState('15-20');
  const [newTyp, setNewTyp] = useState('wycinka pełna');

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setErr('Nieprawidłowe ID');
      setLoading(false);
      return;
    }
    try {
      setErr('');
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const [rq, ri, rn] = await Promise.all([
        fetch(`${API_URL}/quotations/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/quotations/${id}/items`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/quotations/norms/service-times`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!rq.ok) {
        setErr(`Wycena: HTTP ${rq.status}`);
        setQ(null);
        return;
      }
      const qJson = (await rq.json()) as QuotationRow;
      setQ(qJson);
      if (qJson.waznosc_do) setWaznoscIso(String(qJson.waznosc_do));
      if (ri.ok) {
        const j = await ri.json();
        setItems(Array.isArray(j) ? j : []);
      } else setItems([]);
      if (rn.ok) {
        const j = await rn.json();
        setNorms(Array.isArray(j) ? j : []);
      } else setNorms([]);
    } catch {
      setErr('Błąd pobierania');
      setQ(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const gatunki = useMemo(() => [...new Set(norms.map((n) => n.gatunek_key))], [norms]);

  const authHeaders = useCallback(async () => {
    const { token } = await getStoredSession();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const postJson = async (path: string, body: object) => {
    const h = await authHeaders();
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const visitStart = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lokalizacja', 'Włącz uprawnienia GPS, aby rozpocząć wizytę.');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    let res = await postJson(`/quotations/${id}/visit/start`, { lat, lng });
    if (res.status === 400) {
      const j = await res.json().catch(() => ({}));
      if (j?.code === 'GPS_FAR_FROM_SITE') {
        if (!gpsOverrideNote.trim()) {
          Alert.alert('GPS', `${j.error || 'Jesteś daleko od adresu.'}\nUzupełnij notatkę poniżej i spróbuj ponownie.`);
          return;
        }
        res = await postJson(`/quotations/${id}/visit/start`, {
          lat,
          lng,
          gps_override_ack: true,
          gps_override_note: gpsOverrideNote.trim(),
        });
      }
    }
    if (!res.ok) {
      const t = await res.text();
      Alert.alert('Błąd', t.slice(0, 400));
      return;
    }
    const row = await res.json();
    setQ(row);
    Alert.alert('OK', 'Wizyta rozpoczęta.');
  };

  const visitEnd = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lokalizacja', 'Włącz GPS przed zakończeniem wizyty.');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const patchH = await authHeaders();
    await fetch(`${API_URL}/quotations/${id}`, {
      method: 'PATCH',
      headers: { ...patchH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waznosc_do: waznoscIso,
        korekta_uzasadnienie: korektaTxt || null,
        korekta_dropdown: korektaDrop || null,
      }),
    });
    const res = await postJson(`/quotations/${id}/visit/end`, {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      waznosc_do: waznoscIso,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const details = Array.isArray(j.details) ? j.details.join('\n') : j.error || (await res.text());
      Alert.alert('Nie można zakończyć', String(details).slice(0, 900));
      return;
    }
    const row = await res.json();
    setQ(row);
    void load();
    Alert.alert('OK', 'Wizyta zakończona — wycena w zatwierdzeniu.');
  };

  const addItem = async () => {
    const res = await postJson(`/quotations/${id}/items`, {
      gatunek: newGat,
      wysokosc_pas: newWys,
      typ_pracy: newTyp,
    });
    if (!res.ok) {
      Alert.alert('Błąd', await res.text());
      return;
    }
    void load();
  };

  const uploadGeneral = async (itemId: number) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Zdjęcie', 'Potrzebny dostęp do galerii.');
      return;
    }
    const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (pick.canceled || !pick.assets[0]) return;
    const asset = pick.assets[0];
    const h = await authHeaders();
    const formData = new FormData();
    formData.append('zdjecie', { uri: asset.uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    formData.append('photo_kind', 'general');
    const res = await fetch(`${API_URL}/quotations/${id}/items/${itemId}/zdjecia`, {
      method: 'POST',
      headers: h as Record<string, string>,
      body: formData,
    });
    if (!res.ok) Alert.alert('Upload', await res.text());
    else Alert.alert('OK', 'Zdjęcie ogólne dodane.');
  };

  const openAnnotate = (itemId: number, localUri: string) => {
    router.push(
      `/wycena-rysuj?uri=${encodeURIComponent(localUri)}&quotationId=${id}&itemId=${itemId}&photoKind=annotated` as never
    );
  };

  const pickThenAnnotate = async (itemId: number) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (pick.canceled || !pick.assets[0]) return;
    openAnnotate(itemId, pick.assets[0].uri);
  };

  if (loading) {
    return (
      <KeyboardSafeScreen style={s.center}>
        <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
        <ActivityIndicator color={theme.accent} />
      </KeyboardSafeScreen>
    );
  }

  if (!q) {
    return (
      <KeyboardSafeScreen style={s.screen}>
        <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={s.title}>Wycena</Text>
          <View style={{ width: 40 }} />
        </View>
        <Text style={s.err}>{err || 'Brak danych'}</Text>
      </KeyboardSafeScreen>
    );
  }

  const draftish = ['Draft', 'Zwrocona', 'Umowiana'].includes(String(q.status));
  const canVisit = draftish && !q.visit_ended_at;
  const visitActive = !!q.visit_started_at && !q.visit_ended_at;

  return (
    <KeyboardSafeScreen style={s.screen}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.title}>#{q.id}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.status}>{q.status}</Text>
        <Text style={s.klient}>{q.klient_nazwa || '—'}</Text>
        <Text style={s.muted}>{[q.adres, q.miasto].filter(Boolean).join(', ')}</Text>

        {canVisit ? (
          <View style={s.block}>
            <Text style={s.h2}>Wizyta</Text>
            {!q.visit_started_at ? (
              <>
                <Text style={s.muted}>Jeśli GPS &gt; 100 m od adresu, wpisz uzasadnienie:</Text>
                <TextInput
                  style={s.input}
                  placeholder="Notatka override GPS"
                  placeholderTextColor={theme.textMuted}
                  value={gpsOverrideNote}
                  onChangeText={setGpsOverrideNote}
                />
                <TouchableOpacity style={s.btn} onPress={() => void visitStart()}>
                  <Text style={s.btnTxt}>Rozpocznij wizytę</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {visitActive ? (
              <>
                <Text style={s.muted}>Ważność oferty (ISO, np. z datą końca dnia):</Text>
                <TextInput style={s.input} value={waznoscIso} onChangeText={setWaznoscIso} autoCapitalize="none" />
                <Text style={s.muted}>Jeśli marża poniżej progu oddziału — uzasadnienie i powód:</Text>
                <TextInput
                  style={s.input}
                  placeholder="Uzasadnienie korekty"
                  placeholderTextColor={theme.textMuted}
                  value={korektaTxt}
                  onChangeText={setKorektaTxt}
                />
                <TextInput
                  style={s.input}
                  placeholder="Powód (dropdown / krótki kod)"
                  placeholderTextColor={theme.textMuted}
                  value={korektaDrop}
                  onChangeText={setKorektaDrop}
                />
                <TouchableOpacity style={[s.btn, s.btnDanger]} onPress={() => void visitEnd()}>
                  <Text style={s.btnTxt}>Zakończ wizytę (zatwierdzenie)</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}

        {draftish && !q.visit_ended_at ? (
          <View style={s.block}>
            <Text style={s.h2}>Obiekty</Text>
            <Text style={s.muted}>Każdy obiekt: min. 1 zdjęcie ogólne + 1 z adnotacjami (rysunek).</Text>
            <View style={s.row}>
              <TextInput style={[s.input, s.flex]} value={newGat} onChangeText={setNewGat} />
            </View>
            <View style={s.row}>
              <TextInput style={[s.input, s.flex]} value={newWys} onChangeText={setNewWys} />
              <TextInput style={[s.input, s.flex]} value={newTyp} onChangeText={setNewTyp} />
            </View>
            {gatunki.length ? (
              <Text style={s.hint}>Normy: {gatunki.slice(0, 6).join(', ')}…</Text>
            ) : null}
            <TouchableOpacity style={s.btnSecondary} onPress={() => void addItem()}>
              <Text style={s.btnSecondaryTxt}>Dodaj obiekt</Text>
            </TouchableOpacity>
            {items.map((it) => (
              <View key={it.id} style={s.itemCard}>
                <Text style={s.itemTitle}>
                  #{it.id} {it.gatunek} · {it.wysokosc_pas} · {it.typ_pracy}
                </Text>
                <TouchableOpacity style={s.smallBtn} onPress={() => void uploadGeneral(it.id)}>
                  <Text style={s.smallBtnTxt}>Zdjęcie ogólne</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.smallBtn} onPress={() => void pickThenAnnotate(it.id)}>
                  <Text style={s.smallBtnTxt}>Adnotacje (rysuj)</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {q.wartosc_zaproponowana != null ? (
          <Text style={s.price}>Oferta: {Number(q.wartosc_zaproponowana).toFixed(2)} PLN</Text>
        ) : null}
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    backBtn: { padding: 8 },
    title: { fontSize: 18, fontWeight: '700', color: theme.text },
    err: { color: theme.danger, padding: 16 },
    body: { padding: 16, paddingBottom: 48 },
    status: { fontSize: 14, color: theme.accent, fontWeight: '600' },
    klient: { fontSize: 17, fontWeight: '700', color: theme.text, marginTop: 6 },
    muted: { color: theme.textMuted, marginTop: 6, fontSize: 13 },
    block: { marginTop: 20, padding: 12, borderRadius: 12, backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
    h2: { fontSize: 16, fontWeight: '700', color: theme.text, marginBottom: 8 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: theme.text,
      marginTop: 8,
    },
    row: { flexDirection: 'row', gap: 8, marginTop: 8 },
    flex: { flex: 1 },
    hint: { fontSize: 11, color: theme.textMuted, marginTop: 6 },
    btn: { marginTop: 12, backgroundColor: theme.accent, padding: 14, borderRadius: 10, alignItems: 'center' },
    btnDanger: { backgroundColor: theme.danger },
    btnTxt: { color: '#fff', fontWeight: '700' },
    btnSecondary: { marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.accent, alignItems: 'center' },
    btnSecondaryTxt: { color: theme.accent, fontWeight: '600' },
    itemCard: { marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: theme.surface2 },
    itemTitle: { fontWeight: '600', color: theme.text },
    smallBtn: { marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.accentSoft, borderRadius: 8 },
    smallBtnTxt: { color: theme.accent, fontWeight: '600' },
    price: { marginTop: 16, fontSize: 16, fontWeight: '700', color: theme.text },
  });
}
