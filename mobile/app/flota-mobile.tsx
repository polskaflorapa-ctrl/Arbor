import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, StatusBar,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';
import { isFeatureEnabledForOddzial } from '../utils/oddzial-features';

const FLEET_STATUS_ORDER = ['Dostępny', 'W_Użyciu', 'Naprawa', 'Wycofany'] as const;

function fleetStatusLabel(status: string, tr: (key: string) => string) {
  const keyMap: Record<string, string> = {
    Dostępny: 'fleet.status.available',
    W_Użyciu: 'fleet.status.inUse',
    Naprawa: 'fleet.status.repair',
    Wycofany: 'fleet.status.retired',
  };
  const k = keyMap[status];
  return k ? tr(k) : status;
}

function fleetRepairStatusLabel(status: string, tr: (key: string) => string) {
  const k = `fleet.repairStatus.${status}`;
  const resolved = tr(k);
  return resolved === k ? status : resolved;
}

export default function FlotaMobileScreen() {
  const { theme } = useTheme();
  const fleetStatusKolor = useMemo(() => ({
    Dostępny: theme.success,
    W_Użyciu: theme.warning,
    Naprawa: theme.danger,
    Wycofany: theme.textMuted,
  }), [theme]);
  const { t, language } = useLanguage();
  const numberLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const guard = useOddzialFeatureGuard('/flota-mobile');
  const [user, setUser] = useState<any>(null);
  const [aktywnaSekcja, setAktywnaSekcja] = useState<'pojazdy' | 'sprzet' | 'naprawy'>('pojazdy');
  const [pojazdy, setPojazdy] = useState<any[]>([]);
  const [sprzet, setSprzet] = useState<any[]>([]);
  const [naprawy, setNaprawy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [showReservationsBtn, setShowReservationsBtn] = useState(false);

  const [modalPojazd, setModalPojazd] = useState(false);
  const [modalSprzet, setModalSprzet] = useState(false);
  const [modalNaprawa, setModalNaprawa] = useState(false);

  const [formPojazd, setFormPojazd] = useState({
    marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '', typ: 'Samochód',
    data_przegladu: '', data_ubezpieczenia: '', przebieg: '', notatki: '',
  });
  const [formSprzet, setFormSprzet] = useState({
    nazwa: '', typ: 'Piła', nr_seryjny: '', rok_produkcji: '',
    data_przegladu: '', koszt_motogodziny: '', notatki: '',
  });
  const [formNaprawa, setFormNaprawa] = useState({
    typ_zasobu: 'vehicle', zasob_id: '', nr_faktury: '',
    data_naprawy: new Date().toISOString().split('T')[0],
    koszt: '', opis_usterki: '', opis_naprawy: '', wykonawca: '',
  });

  const loadAll = useCallback(async (tokenOverride?: string | null) => {
    try {
      const authToken = tokenOverride ?? token;
      if (!authToken) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${authToken}` };
      const [pRes, sRes, nRes] = await Promise.all([
        fetch(`${API_URL}/flota/pojazdy`, { headers: h }),
        fetch(`${API_URL}/flota/sprzet`, { headers: h }),
        fetch(`${API_URL}/flota/naprawy`, { headers: h }),
      ]);
      if (pRes.ok) setPojazdy(await pRes.json());
      if (sRes.ok) setSprzet(await sRes.json());
      if (nRes.ok) setNaprawy(await nRes.json());
    } catch {
      Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.loadFail'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, t]);

  const init = useCallback(async () => {
    const { user: storedUser, token: storedToken } = await getStoredSession();
    if (storedUser) setUser(storedUser);
    setToken(storedToken);
    const oddzialId = (storedUser as { oddzial_id?: string | number } | null | undefined)?.oddzial_id;
    setShowReservationsBtn(isFeatureEnabledForOddzial(oddzialId, '/rezerwacje-sprzetu'));
    await loadAll(storedToken);
  }, [loadAll]);

  useEffect(() => { void init(); }, [init]);

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const zmienStatusPojazdu = async (id: number, status: string) => {
    try {
      if (!token) { router.replace('/login'); return; }
      await fetch(`${API_URL}/flota/pojazdy/${id}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await loadAll();
    } catch { Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.statusFail')); }
  };

  const zmienStatusSprzetu = async (id: number, status: string) => {
    try {
      if (!token) { router.replace('/login'); return; }
      await fetch(`${API_URL}/flota/sprzet/${id}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await loadAll();
    } catch { Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.statusFail')); }
  };

  const dodajPojazd = async () => {
    if (!formPojazd.marka || !formPojazd.model || !formPojazd.nr_rejestracyjny) {
      Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.vehicleFields'));
      return;
    }
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/flota/pojazdy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formPojazd),
      });
      if (res.ok) {
        setModalPojazd(false);
        setFormPojazd({ marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '', typ: 'Samochód', data_przegladu: '', data_ubezpieczenia: '', przebieg: '', notatki: '' });
        await loadAll();
        Alert.alert(t('wyceny.alert.savedTitle'), t('fleet.alert.vehicleAdded'));
      } else {
        const e = await res.json();
        Alert.alert(t('wyceny.alert.saveFail'), e.error || t('fleet.alert.vehicleFail'));
      }
    } catch { Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.connection')); }
  };

  const dodajSprzet = async () => {
    if (!formSprzet.nazwa) { Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.equipmentName')); return; }
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/flota/sprzet`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formSprzet),
      });
      if (res.ok) {
        setModalSprzet(false);
        setFormSprzet({ nazwa: '', typ: 'Piła', nr_seryjny: '', rok_produkcji: '', data_przegladu: '', koszt_motogodziny: '', notatki: '' });
        await loadAll();
        Alert.alert(t('wyceny.alert.savedTitle'), t('fleet.alert.equipmentAdded'));
      } else {
        const e = await res.json();
        Alert.alert(t('wyceny.alert.saveFail'), e.error || t('fleet.alert.equipmentFail'));
      }
    } catch { Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.connection')); }
  };

  const dodajNaprawe = async () => {
    if (!formNaprawa.zasob_id || !formNaprawa.data_naprawy) {
      Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.repairFields'));
      return;
    }
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/flota/naprawy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formNaprawa),
      });
      if (res.ok) {
        setModalNaprawa(false);
        setFormNaprawa({ typ_zasobu: 'vehicle', zasob_id: '', nr_faktury: '', data_naprawy: new Date().toISOString().split('T')[0], koszt: '', opis_usterki: '', opis_naprawy: '', wykonawca: '' });
        await loadAll();
        Alert.alert(t('wyceny.alert.savedTitle'), t('fleet.alert.repairAdded'));
      } else {
        const e = await res.json();
        Alert.alert(t('wyceny.alert.saveFail'), e.error || t('fleet.alert.repairFail'));
      }
    } catch { Alert.alert(t('wyceny.alert.saveFail'), t('fleet.alert.connection')); }
  };

  const isDyrektor = user?.rola === 'Dyrektor' || user?.rola === 'Administrator';
  const isKierownik = user?.rola === 'Kierownik';
  const mozeEdytowac = isDyrektor || isKierownik;

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

  const SEKCJE: { key: 'pojazdy' | 'sprzet' | 'naprawy'; icon: any; label: string; count: number }[] = [
    { key: 'pojazdy', icon: 'car-outline', label: t('fleet.tab.vehicles', { count: pojazdy.length }), count: pojazdy.length },
    { key: 'sprzet', icon: 'construct-outline', label: t('fleet.tab.equipment', { count: sprzet.length }), count: sprzet.length },
    { key: 'naprawy', icon: 'hammer-outline', label: t('fleet.tab.repairs', { count: naprawy.length }), count: naprawy.length },
  ];

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Ionicons name="car-sport-outline" size={20} color={theme.headerText} />
          <Text style={S.headerTitle}>{t('fleet.screenTitle')}</Text>
        </View>
        {showReservationsBtn && (
          <TouchableOpacity onPress={() => router.push('/rezerwacje-sprzetu' as never)} style={{ padding: 6, marginRight: 4 }}>
            <Ionicons name="calendar-number-outline" size={22} color={theme.headerText} />
          </TouchableOpacity>
        )}
        {mozeEdytowac && (
          <TouchableOpacity
            onPress={() => aktywnaSekcja === 'pojazdy' ? setModalPojazd(true) : aktywnaSekcja === 'sprzet' ? setModalSprzet(true) : setModalNaprawa(true)}
            style={S.addHeaderBtn}>
            <Ionicons name="add" size={22} color={theme.headerText} />
          </TouchableOpacity>
        )}
      </View>

      {/* Section tabs */}
      <View style={S.sekcjeRow}>
        {SEKCJE.map(s => (
          <TouchableOpacity key={s.key} style={[S.sekcjaBtn, aktywnaSekcja === s.key && S.sekcjaBtnActive]}
            onPress={() => setAktywnaSekcja(s.key)}>
            <Ionicons name={s.icon} size={14} color={aktywnaSekcja === s.key ? theme.accent : theme.textMuted} />
            <Text style={[S.sekcjaTxt, aktywnaSekcja === s.key && { color: theme.accent, fontWeight: '700' }]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={S.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}>

        {/* POJAZDY */}
        {aktywnaSekcja === 'pojazdy' && (
          pojazdy.length === 0
            ? <View style={S.empty}><Text style={S.emptyTxt}>{t('fleet.empty.vehicles')}</Text></View>
            : pojazdy.map((p: any) => (
              <View key={p.id} style={[S.card, { borderLeftColor: fleetStatusKolor[p.status as keyof typeof fleetStatusKolor] || theme.textMuted }]}>
                <View style={S.cardTop}>
                  <Text style={S.cardMain}>{p.marka} {p.model}</Text>
                  <View style={[S.badge, { backgroundColor: fleetStatusKolor[p.status as keyof typeof fleetStatusKolor] || theme.textMuted }]}>
                    <Text style={S.badgeTxt}>{fleetStatusLabel(p.status, t)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Ionicons name="card-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardSub}>{p.nr_rejestracyjny} · {p.typ}</Text>
                </View>
                {p.oddzial_nazwa && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="business-outline" size={12} color={theme.textMuted} />
                    <Text style={S.cardSub}>{p.oddzial_nazwa}</Text>
                  </View>
                )}
                {p.ekipa_nazwa && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="people-outline" size={12} color={theme.textMuted} />
                    <Text style={S.cardSub}>{p.ekipa_nazwa}</Text>
                  </View>
                )}
                {p.data_przegladu && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="search-outline" size={12} color={new Date(p.data_przegladu) < new Date() ? theme.danger : theme.textMuted} />
                    <Text style={[S.cardSub, new Date(p.data_przegladu) < new Date() && { color: theme.danger }]}>
                      {t('fleet.inspectionLabel')} {p.data_przegladu.split('T')[0]}
                      {new Date(p.data_przegladu) < new Date() ? t('fleet.inspectionOverdue') : ''}
                    </Text>
                  </View>
                )}
                {mozeEdytowac && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}
                    contentContainerStyle={{ gap: 6 }}>
                    {FLEET_STATUS_ORDER.map((st) => (
                      <TouchableOpacity key={st}
                        style={[S.statusMiniBtn, p.status === st && { backgroundColor: fleetStatusKolor[st as keyof typeof fleetStatusKolor] }]}
                        onPress={() => st !== p.status && zmienStatusPojazdu(p.id, st)}>
                        <Text style={[S.statusMiniBtnTxt, p.status === st && { color: theme.accentText }]}>{fleetStatusLabel(st, t)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            ))
        )}

        {/* SPRZĘT */}
        {aktywnaSekcja === 'sprzet' && (
          sprzet.length === 0
            ? <View style={S.empty}><Text style={S.emptyTxt}>{t('fleet.empty.equipment')}</Text></View>
            : sprzet.map((s: any) => (
              <View key={s.id} style={[S.card, { borderLeftColor: fleetStatusKolor[s.status as keyof typeof fleetStatusKolor] || theme.textMuted }]}>
                <View style={S.cardTop}>
                  <Text style={S.cardMain}>{s.nazwa}</Text>
                  <View style={[S.badge, { backgroundColor: fleetStatusKolor[s.status as keyof typeof fleetStatusKolor] || theme.textMuted }]}>
                    <Text style={S.badgeTxt}>{fleetStatusLabel(s.status, t)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Ionicons name="construct-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardSub}>{s.typ}</Text>
                </View>
                {s.nr_seryjny && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="barcode-outline" size={12} color={theme.textMuted} />
                    <Text style={S.cardSub}>{t('fleet.serialPrefix')} {s.nr_seryjny}</Text>
                  </View>
                )}
                {s.oddzial_nazwa && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="business-outline" size={12} color={theme.textMuted} />
                    <Text style={S.cardSub}>{s.oddzial_nazwa}</Text>
                  </View>
                )}
                {s.data_przegladu && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="search-outline" size={12} color={new Date(s.data_przegladu) < new Date() ? theme.danger : theme.textMuted} />
                    <Text style={[S.cardSub, new Date(s.data_przegladu) < new Date() && { color: theme.danger }]}>
                      {t('fleet.inspectionLabel')} {s.data_przegladu.split('T')[0]}
                      {new Date(s.data_przegladu) < new Date() ? t('fleet.inspectionOverdue') : ''}
                    </Text>
                  </View>
                )}
                {mozeEdytowac && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}
                    contentContainerStyle={{ gap: 6 }}>
                    {FLEET_STATUS_ORDER.map((st) => (
                      <TouchableOpacity key={st}
                        style={[S.statusMiniBtn, s.status === st && { backgroundColor: fleetStatusKolor[st as keyof typeof fleetStatusKolor] }]}
                        onPress={() => st !== s.status && zmienStatusSprzetu(s.id, st)}>
                        <Text style={[S.statusMiniBtnTxt, s.status === st && { color: theme.accentText }]}>{fleetStatusLabel(st, t)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            ))
        )}

        {/* NAPRAWY */}
        {aktywnaSekcja === 'naprawy' && (
          naprawy.length === 0
            ? <View style={S.empty}><Text style={S.emptyTxt}>{t('fleet.empty.repairs')}</Text></View>
            : naprawy.map((n: any) => (
              <View key={n.id} style={[S.card, { borderLeftColor: n.status === 'Zakończona' ? theme.success : theme.warning }]}>
                <View style={S.cardTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Ionicons name={n.typ_zasobu === 'vehicle' ? 'car-outline' : 'construct-outline'} size={14} color={theme.textMuted} />
                    <Text style={S.cardMain}>{t('fleet.repairCardTitle', { id: n.id })}</Text>
                  </View>
                  <View style={[S.badge, { backgroundColor: n.status === 'Zakończona' ? theme.success : theme.warning }]}>
                    <Text style={S.badgeTxt}>{fleetRepairStatusLabel(n.status, t)}</Text>
                  </View>
                </View>
                {n.opis_usterki && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="warning-outline" size={12} color={theme.warning} />
                    <Text style={S.cardSub}>{n.opis_usterki}</Text>
                  </View>
                )}
                {n.wykonawca && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="construct-outline" size={12} color={theme.textMuted} />
                    <Text style={S.cardSub}>{n.wykonawca}</Text>
                  </View>
                )}
                {n.koszt && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Ionicons name="cash-outline" size={12} color={theme.accent} />
                    <Text style={[S.cardSub, { color: theme.accent }]}>{parseFloat(n.koszt).toLocaleString(numberLocale)} PLN</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
                  <Text style={S.cardSub}>{n.data_naprawy?.split('T')[0]}</Text>
                </View>
              </View>
            ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal: Dodaj pojazd */}
      <Modal visible={modalPojazd} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.overlay}>
          <View style={S.modalBox}>
            <View style={S.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="car-outline" size={20} color={theme.accent} />
                <Text style={S.modalTitle}>{t('fleet.modal.newVehicle')}</Text>
              </View>
              <TouchableOpacity onPress={() => setModalPojazd(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <FieldInput label={t('fleet.field.brand')} value={formPojazd.marka} onChangeText={(txt) => setFormPojazd(f => ({ ...f, marka: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.model')} value={formPojazd.model} onChangeText={(txt) => setFormPojazd(f => ({ ...f, model: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.regNr')} value={formPojazd.nr_rejestracyjny} onChangeText={(txt) => setFormPojazd(f => ({ ...f, nr_rejestracyjny: txt.toUpperCase() }))} theme={theme} />
              <FieldInput label={t('fleet.field.year')} value={formPojazd.rok_produkcji} onChangeText={(txt) => setFormPojazd(f => ({ ...f, rok_produkcji: txt }))} keyboardType="numeric" theme={theme} />
              <FieldInput label={t('fleet.field.inspectionDate')} value={formPojazd.data_przegladu} onChangeText={(txt) => setFormPojazd(f => ({ ...f, data_przegladu: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.insuranceDate')} value={formPojazd.data_ubezpieczenia} onChangeText={(txt) => setFormPojazd(f => ({ ...f, data_ubezpieczenia: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.mileage')} value={formPojazd.przebieg} onChangeText={(txt) => setFormPojazd(f => ({ ...f, przebieg: txt }))} keyboardType="numeric" theme={theme} />
              <FieldInput label={t('fleet.field.notes')} value={formPojazd.notatki} onChangeText={(txt) => setFormPojazd(f => ({ ...f, notatki: txt }))} multiline theme={theme} />
              <View style={S.modalBtns}>
                <TouchableOpacity style={S.cancelBtn} onPress={() => setModalPojazd(false)}><Text style={S.cancelTxt}>{t('common.cancel')}</Text></TouchableOpacity>
                <TouchableOpacity style={[S.submitBtn, { backgroundColor: theme.accent }]} onPress={dodajPojazd}><Text style={[S.submitTxt, { color: theme.accentText }]}>{t('fleet.btn.add')}</Text></TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: Dodaj sprzęt */}
      <Modal visible={modalSprzet} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.overlay}>
          <View style={S.modalBox}>
            <View style={S.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="construct-outline" size={20} color={theme.accent} />
                <Text style={S.modalTitle}>{t('fleet.modal.newEquipment')}</Text>
              </View>
              <TouchableOpacity onPress={() => setModalSprzet(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <FieldInput label={t('fleet.field.name')} value={formSprzet.nazwa} onChangeText={(txt) => setFormSprzet(f => ({ ...f, nazwa: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.type')} value={formSprzet.typ} onChangeText={(txt) => setFormSprzet(f => ({ ...f, typ: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.serialNr')} value={formSprzet.nr_seryjny} onChangeText={(txt) => setFormSprzet(f => ({ ...f, nr_seryjny: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.year')} value={formSprzet.rok_produkcji} onChangeText={(txt) => setFormSprzet(f => ({ ...f, rok_produkcji: txt }))} keyboardType="numeric" theme={theme} />
              <FieldInput label={t('fleet.field.inspectionDate')} value={formSprzet.data_przegladu} onChangeText={(txt) => setFormSprzet(f => ({ ...f, data_przegladu: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.motohourCost')} value={formSprzet.koszt_motogodziny} onChangeText={(txt) => setFormSprzet(f => ({ ...f, koszt_motogodziny: txt }))} keyboardType="numeric" theme={theme} />
              <FieldInput label={t('fleet.field.notes')} value={formSprzet.notatki} onChangeText={(txt) => setFormSprzet(f => ({ ...f, notatki: txt }))} multiline theme={theme} />
              <View style={S.modalBtns}>
                <TouchableOpacity style={S.cancelBtn} onPress={() => setModalSprzet(false)}><Text style={S.cancelTxt}>{t('common.cancel')}</Text></TouchableOpacity>
                <TouchableOpacity style={[S.submitBtn, { backgroundColor: theme.accent }]} onPress={dodajSprzet}><Text style={[S.submitTxt, { color: theme.accentText }]}>{t('fleet.btn.add')}</Text></TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: Dodaj naprawę */}
      <Modal visible={modalNaprawa} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.overlay}>
          <View style={S.modalBox}>
            <View style={S.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="hammer-outline" size={20} color={theme.accent} />
                <Text style={S.modalTitle}>{t('fleet.modal.newRepair')}</Text>
              </View>
              <TouchableOpacity onPress={() => setModalNaprawa(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <Text style={[S.modalLbl, { color: theme.textMuted }]}>{t('fleet.label.assetType')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {(['vehicle', 'equipment'] as const).map((assetKind) => (
                  <TouchableOpacity key={assetKind}
                    style={[S.typBtn, formNaprawa.typ_zasobu === assetKind && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]}
                    onPress={() => setFormNaprawa(f => ({ ...f, typ_zasobu: assetKind }))}>
                    <Ionicons name={assetKind === 'vehicle' ? 'car-outline' : 'construct-outline'} size={14} color={formNaprawa.typ_zasobu === assetKind ? theme.accent : theme.textMuted} />
                    <Text style={[S.typBtnTxt, formNaprawa.typ_zasobu === assetKind && { color: theme.accent }]}>
                      {assetKind === 'vehicle' ? t('fleet.asset.vehicle') : t('fleet.asset.equipment')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <FieldInput label={t('fleet.field.vehicleId')} value={formNaprawa.zasob_id} onChangeText={(txt) => setFormNaprawa(f => ({ ...f, zasob_id: txt }))} keyboardType="numeric" theme={theme} />
              <FieldInput label={t('fleet.field.repairDate')} value={formNaprawa.data_naprawy} onChangeText={(txt) => setFormNaprawa(f => ({ ...f, data_naprawy: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.invoiceNr')} value={formNaprawa.nr_faktury} onChangeText={(txt) => setFormNaprawa(f => ({ ...f, nr_faktury: txt }))} theme={theme} />
              <FieldInput label={t('fleet.field.cost')} value={formNaprawa.koszt} onChangeText={(txt) => setFormNaprawa(f => ({ ...f, koszt: txt }))} keyboardType="numeric" theme={theme} />
              <FieldInput label={t('fleet.field.faultDesc')} value={formNaprawa.opis_usterki} onChangeText={(txt) => setFormNaprawa(f => ({ ...f, opis_usterki: txt }))} multiline theme={theme} />
              <FieldInput label={t('fleet.field.contractor')} value={formNaprawa.wykonawca} onChangeText={(txt) => setFormNaprawa(f => ({ ...f, wykonawca: txt }))} theme={theme} />
              <View style={S.modalBtns}>
                <TouchableOpacity style={S.cancelBtn} onPress={() => setModalNaprawa(false)}><Text style={S.cancelTxt}>{t('common.cancel')}</Text></TouchableOpacity>
                <TouchableOpacity style={[S.submitBtn, { backgroundColor: theme.accent }]} onPress={dodajNaprawe}><Text style={[S.submitTxt, { color: theme.accentText }]}>{t('fleet.btn.add')}</Text></TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardSafeScreen>
  );
}

type FieldInputProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  theme: Theme;
};

function FieldInput({ label, value, onChangeText, keyboardType, multiline, theme }: FieldInputProps) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textMuted, marginBottom: 6 }}>{label}</Text>
      <TextInput
        style={{
          borderWidth: 1, borderColor: theme.inputBorder, borderRadius: 10,
          padding: 12, fontSize: 14, backgroundColor: theme.inputBg, color: theme.inputText,
          ...(multiline ? { height: 80, textAlignVertical: 'top' } : {}),
        }}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType || 'default'}
        multiline={multiline}
        placeholderTextColor={theme.inputPlaceholder}
      />
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: t.headerText, fontSize: 18, fontWeight: 'bold' },
  addHeaderBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: t.accent + '33', alignItems: 'center', justifyContent: 'center',
  },
  sekcjeRow: {
    flexDirection: 'row', backgroundColor: t.cardBg,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  sekcjaBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 4,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  sekcjaBtnActive: { borderBottomColor: t.accent },
  sekcjaTxt: { fontSize: 11, color: t.textMuted, fontWeight: '500' },
  list: { flex: 1, padding: 12 },
  card: {
    backgroundColor: t.cardBg, borderRadius: 14, padding: 14, marginBottom: 10,
    elevation: 1, borderLeftWidth: 4, borderWidth: 1, borderColor: t.cardBorder,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardMain: { fontSize: 16, fontWeight: 'bold', color: t.text, flex: 1 },
  cardSub: { fontSize: 12, color: t.textMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeTxt: { color: t.accentText, fontSize: 11, fontWeight: '600' },
  statusMiniBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.border,
  },
  statusMiniBtnTxt: { fontSize: 11, color: t.textSub },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { color: t.textMuted, fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: t.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, maxHeight: '85%',
  },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: t.text },
  modalLbl: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  typBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.border,
  },
  typBtnTxt: { fontSize: 13, color: t.textMuted, fontWeight: '500' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: t.bg, alignItems: 'center', borderWidth: 1, borderColor: t.border },
  cancelTxt: { color: t.textMuted, fontWeight: '600' },
  submitBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  submitTxt: { fontWeight: '700' },
});
