import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { ErrorBanner } from '../components/ui/app-state';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { enqueueOfflineRequest, flushOfflineQueue } from '../utils/offline-queue';
import { getStoredSession } from '../utils/session';
import { isPositiveNumber, isValidIsoDate, isValidPolishPhone, isValidTimeHHMM } from '../utils/validators';

export default function NoweZlecenieScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/nowe-zlecenie');
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [ekipy, setEkipy] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    klient_nazwa: '',
    klient_telefon: '',
    adres: '',
    miasto: '',
    typ_uslugi: 'Wycinka',
    priorytet: 'Normalny',
    wartosc_planowana: '',
    czas_planowany_godziny: '',
    data_planowana: new Date().toISOString().split('T')[0],
    godzina_rozpoczecia: '',
    notatki_wewnetrzne: '',
    oddzial_id: '',
    ekipa_id: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setError(null);
    try {
      const { token: storedToken, user: u } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      await flushOfflineQueue(storedToken);
      setUser(u);
      const h = { Authorization: `Bearer ${storedToken}` };
      const [oRes, eRes] = await Promise.all([
        fetch(`${API_URL}/oddzialy`, { headers: h }),
        fetch(`${API_URL}/ekipy`, { headers: h }),
      ]);
      if (oRes.ok) setOddzialy(await oRes.json());
      if (eRes.ok) setEkipy(await eRes.json());
      const userOddzialId = typeof u?.oddzial_id === 'number' || typeof u?.oddzial_id === 'string'
        ? String(u.oddzial_id)
        : '';
      if (userOddzialId) setForm(f => ({ ...f, oddzial_id: userOddzialId }));
    } catch {
      setError('Nie udało się pobrać danych pomocniczych.');
    }
  };

  const isDyrektor = user?.rola === 'Dyrektor' || user?.rola === 'Administrator';
  const ekipyFiltered = form.oddzial_id
    ? ekipy.filter(e => e.oddzial_id === parseInt(form.oddzial_id))
    : ekipy;

  const handleSubmit = async () => {
    setError(null);
    if (!form.klient_nazwa || !form.adres || !form.miasto || !form.data_planowana) {
      Alert.alert(t('notif.alert.errorTitle'), t('newOrder.alert.required'));
      return;
    }
    if (!isValidPolishPhone(form.klient_telefon)) {
      Alert.alert(t('notif.alert.errorTitle'), t('newOrder.alert.badPhone'));
      return;
    }
    if (!isValidIsoDate(form.data_planowana)) {
      Alert.alert(t('notif.alert.errorTitle'), t('newOrder.alert.badDate'));
      return;
    }
    if (!isValidTimeHHMM(form.godzina_rozpoczecia)) {
      Alert.alert(t('notif.alert.errorTitle'), t('newOrder.alert.badTime'));
      return;
    }
    if (!isPositiveNumber(form.wartosc_planowana) || !isPositiveNumber(form.czas_planowany_godziny)) {
      Alert.alert(t('notif.alert.errorTitle'), t('newOrder.alert.badNumbers'));
      return;
    }
    const payload = {
      ...form,
      ekipa_id: form.ekipa_id ? parseInt(form.ekipa_id) : null,
      oddzial_id: form.oddzial_id || user?.oddzial_id,
      wartosc_planowana: form.wartosc_planowana || null,
      czas_planowany_godziny: form.czas_planowany_godziny || null,
      godzina_rozpoczecia: form.godzina_rozpoczecia || null,
    };
    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/tasks/nowe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        Alert.alert(t('newOrder.alert.createdTitle'), t('newOrder.alert.createdBody', { id: data.id }), [
          { text: t('common.ok'), onPress: () => router.back() }
        ]);
      } else {
        Alert.alert(t('notif.alert.errorTitle'), data.error || t('newOrder.alert.saveError'));
      }
    } catch {
      await enqueueOfflineRequest({
        url: `${API_URL}/tasks/nowe`,
        method: 'POST',
        body: payload as Record<string, unknown>,
      });
      Alert.alert(t('notif.alert.offlineTitle'), t('newOrder.alert.offlineBody'));
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const TYPY = ['Wycinka', 'Pielegnacja', 'Ogrodnictwo', 'Frezowanie pniaków', 'Inne'];
  const PRIORYTETY = ['Niski', 'Normalny', 'Wysoki', 'Pilny'];

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  if (!guard.ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />
      <ScrollView
        style={S.container}
        contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <View style={S.header}>
          <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
            <Ionicons name="arrow-back" size={22} color={theme.headerText} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Ionicons name="add-circle-outline" size={20} color={theme.headerText} />
            <Text style={S.headerTitle}>{t('newOrder.title')}</Text>
          </View>
        </View>

        {/* Dane klienta */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="person-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Dane klienta</Text>
          </View>
          <Field label="Klient *" theme={theme}>
            <TextInput value={form.klient_nazwa}
              onChangeText={v => setForm({ ...form, klient_nazwa: v })}
              placeholder="Imię i nazwisko lub firma"
              placeholderTextColor={theme.inputPlaceholder}
              style={S.input} />
          </Field>
          <Field label="Telefon klienta" theme={theme}>
            <TextInput style={S.input} value={form.klient_telefon}
              onChangeText={v => setForm({ ...form, klient_telefon: v })}
              placeholder="np. 500-100-200"
              placeholderTextColor={theme.inputPlaceholder}
              keyboardType="phone-pad" />
          </Field>
          <Field label="Adres *" theme={theme}>
            <TextInput style={S.input} value={form.adres}
              onChangeText={v => setForm({ ...form, adres: v })}
              placeholder="ul. Przykładowa 1"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
          <Field label="Miasto *" theme={theme}>
            <TextInput style={S.input} value={form.miasto}
              onChangeText={v => setForm({ ...form, miasto: v })}
              placeholder="np. Kraków"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
        </View>

        {/* Szczegóły */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="clipboard-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Szczegóły zlecenia</Text>
          </View>
          <Field label="Typ usługi" theme={theme}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={S.chipRow}>
                {TYPY.map(t => (
                  <TouchableOpacity key={t}
                    style={[S.chip, form.typ_uslugi === t && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                    onPress={() => setForm({ ...form, typ_uslugi: t })}>
                    <Text style={[S.chipText, form.typ_uslugi === t && { color: theme.accent, fontWeight: '700' }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </Field>
          <Field label="Priorytet" theme={theme}>
            <View style={S.chipRow}>
              {PRIORYTETY.map(p => (
                <TouchableOpacity key={p}
                  style={[S.chip, form.priorytet === p && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                  onPress={() => setForm({ ...form, priorytet: p })}>
                  <Text style={[S.chipText, form.priorytet === p && { color: theme.accent, fontWeight: '700' }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
          <Field label="Wartość (PLN)" theme={theme}>
            <TextInput style={S.input} value={form.wartosc_planowana}
              onChangeText={v => setForm({ ...form, wartosc_planowana: v })}
              placeholder="np. 3500"
              placeholderTextColor={theme.inputPlaceholder}
              keyboardType="numeric" />
          </Field>
          <Field label="Czas planowany (godz)" theme={theme}>
            <TextInput style={S.input} value={form.czas_planowany_godziny}
              onChangeText={v => setForm({ ...form, czas_planowany_godziny: v })}
              placeholder="np. 4"
              placeholderTextColor={theme.inputPlaceholder}
              keyboardType="numeric" />
          </Field>
          <Field label="Data realizacji *" theme={theme}>
            <TextInput style={S.input} value={form.data_planowana}
              onChangeText={v => setForm({ ...form, data_planowana: v })}
              placeholder="RRRR-MM-DD"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
          <Field label="Godzina rozpoczęcia" theme={theme}>
            <TextInput style={S.input} value={form.godzina_rozpoczecia}
              onChangeText={v => setForm({ ...form, godzina_rozpoczecia: v })}
              placeholder="np. 08:00"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
        </View>

        {/* Przypisanie */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="people-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Przypisanie</Text>
          </View>
          {isDyrektor && (
            <Field label="Oddział" theme={theme}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={S.chipRow}>
                  {oddzialy.map(o => (
                    <TouchableOpacity key={o.id}
                      style={[S.chip, form.oddzial_id === o.id.toString() && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                      onPress={() => setForm({ ...form, oddzial_id: o.id.toString(), ekipa_id: '' })}>
                      <Text style={[S.chipText, form.oddzial_id === o.id.toString() && { color: theme.accent, fontWeight: '700' }]}>
                        {o.nazwa}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Field>
          )}
          <Field label="Ekipa (opcjonalne)" theme={theme}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={S.chipRow}>
                <TouchableOpacity
                  style={[S.chip, form.ekipa_id === '' && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                  onPress={() => setForm({ ...form, ekipa_id: '' })}>
                  <Text style={[S.chipText, form.ekipa_id === '' && { color: theme.accent, fontWeight: '700' }]}>Brak</Text>
                </TouchableOpacity>
                {ekipyFiltered.map(e => (
                  <TouchableOpacity key={e.id}
                    style={[S.chip, form.ekipa_id === e.id.toString() && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                    onPress={() => setForm({ ...form, ekipa_id: e.id.toString() })}>
                    <Text style={[S.chipText, form.ekipa_id === e.id.toString() && { color: theme.accent, fontWeight: '700' }]}>
                      {e.nazwa}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </Field>
        </View>

        {/* Notatki */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="document-text-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Notatki</Text>
          </View>
          <TextInput
            style={[S.input, { height: 100, textAlignVertical: 'top' }]}
            value={form.notatki_wewnetrzne}
            onChangeText={v => setForm({ ...form, notatki_wewnetrzne: v })}
            placeholder="Instrukcje dla ekipy, dostęp do posesji..."
            placeholderTextColor={theme.inputPlaceholder}
            multiline />
        </View>

        {/* Buttons */}
        <View style={S.btnRow}>
          <TouchableOpacity style={S.cancelBtn} onPress={() => router.back()}>
            <Text style={S.cancelText}>Anuluj</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.submitBtn, { backgroundColor: theme.accent }]} onPress={handleSubmit} disabled={saving}>
            {saving
              ? <ActivityIndicator color={theme.accentText} />
              : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="checkmark" size={18} color={theme.accentText} />
                  <Text style={[S.submitText, { color: theme.accentText }]}>Utwórz zlecenie</Text>
                </View>
              )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function Field({ label, children, theme }: { label: string; children: React.ReactNode; theme: Theme }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textMuted, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1 },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: t.headerText, fontSize: 18, fontWeight: 'bold' },
  section: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 14, padding: 16,
    elevation: 1, borderWidth: 1, borderColor: t.cardBorder,
  },
  sectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: t.text },
  input: {
    borderWidth: 1, borderColor: t.inputBorder, borderRadius: 10,
    padding: 12, fontSize: 14, backgroundColor: t.inputBg, color: t.inputText,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.border,
  },
  chipText: { fontSize: 13, color: t.textMuted, fontWeight: '500' },
  btnRow: { flexDirection: 'row', gap: 12, margin: 12 },
  cancelBtn: {
    flex: 1, backgroundColor: t.cardBg, padding: 16, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: t.border,
  },
  cancelText: { color: t.textMuted, fontWeight: '600', fontSize: 15 },
  submitBtn: { flex: 2, padding: 16, borderRadius: 12, alignItems: 'center' },
  submitText: { fontWeight: 'bold', fontSize: 15 },
});
