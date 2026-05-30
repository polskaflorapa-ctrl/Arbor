import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert, Platform, ScrollView, StyleSheet,
    StatusBar, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { OfflineQueueBanner } from '../components/ui/app-state';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { flushOfflineQueue, getOfflineQueueSize, queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession, type StoredUser } from '../utils/session';

function hourStatusLabel(status: string, tr: (key: string) => string) {
  const k = `settlements.hourStatus.${status}`;
  const r = tr(k);
  return r === k ? status : r;
}

const toDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function RozliczeniaScreen() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const numberLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const guard = useOddzialFeatureGuard('/rozliczenia');
  const { task_id } = useLocalSearchParams();
  const hasTaskContext = Array.isArray(task_id) ? task_id.length > 0 : Boolean(task_id);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [task, setTask] = useState<any>(null);
  const [pomocnicy, setPomocnicy] = useState<any[]>([]);
  const [rozliczenie, setRozliczenie] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'godziny' | 'kalkulator' | 'dzien'>(hasTaskContext ? 'godziny' : 'dzien');
  const [podsumowanieDnia, setPodsumowanieDnia] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const [formGodziny, setFormGodziny] = useState<any[]>([]);
  const [formKalkulator, setFormKalkulator] = useState({
    wartosc_brutto: '',
    vat_stawka: '8',
  });
  const [wynik, setWynik] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [mySettlementOverview, setMySettlementOverview] = useState<any>(null);
  const msgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const { token: storedToken, user: u } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
      setUser(u);
      const h = { Authorization: `Bearer ${storedToken}` };

      if (task_id) {
        const res = await fetch(`${API_URL}/rozliczenia/zadanie/${task_id}`, { headers: h });
        if (res.ok) {
          const data = await res.json();
          setTask(data.task);
          setPomocnicy(data.pomocnicy);
          setRozliczenie(data.rozliczenie);
          // Zainicjuj formGodziny na podstawie ekipy
          const ekipaRes = await fetch(`${API_URL}/ekipy/${data.task?.ekipa_id}`, { headers: h });
          if (ekipaRes.ok) {
            const ekipa = await ekipaRes.json();
            const czlonkowie = ekipa.czlonkowie || [];
            setFormGodziny(czlonkowie.map((c: any) => {
              const existing = data.pomocnicy.find((p: any) => p.pomocnik_id === c.user_id);
              return {
                pomocnik_id: c.user_id,
                imie: c.imie,
                nazwisko: c.nazwisko,
                stawka_godzinowa: existing?.stawka_godzinowa?.toString() || c.stawka_godzinowa?.toString() || '0',
                godziny: existing?.godziny?.toString() || '',
                status: existing?.status || 'Oczekuje',
                id: existing?.id,
              };
            }));
          }
          if (data.rozliczenie) {
            setFormKalkulator({
              wartosc_brutto: data.rozliczenie.wartosc_brutto?.toString() || '',
              vat_stawka: data.rozliczenie.vat_stawka?.toString() || '8',
            });
          }
        }
      }

      // Podsumowanie dnia
      if (u?.id) {
        const dzisiaj = toDateKey();
        const dRes = await fetch(`${API_URL}/rozliczenia/dzien/${u.id}?data=${dzisiaj}`, { headers: h });
        if (dRes.ok) setPodsumowanieDnia(await dRes.json());
      }
      try {
        const ov = await fetch(`${API_URL}/mobile/me/settlements-overview`, { headers: h });
        if (ov.ok) setMySettlementOverview(await ov.json());
      } catch {
        setMySettlementOverview(null);
      }
    } catch {
      showMsg(t('settlements.msg.loadError'));
      setOfflineQueueCount(await getOfflineQueueSize());
    } finally {
      setLoading(false);
    }
  }, [task_id, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!hasTaskContext && activeTab !== 'dzien') setActiveTab('dzien');
  }, [activeTab, hasTaskContext]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void loadAll();
    });
    return unsubscribe;
  }, [loadAll]);

  useEffect(() => {
    return () => {
      if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    };
  }, []);

  const showMsg = (m: string) => {
    setMsg(m);
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    msgTimeoutRef.current = setTimeout(() => setMsg(''), 3000);
  };

  const zapiszGodziny = async () => {
    if (!task_id) return;
    setSaving(true);
  const dzisiaj = toDateKey();
    try {
      if (!token) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

      for (const p of formGodziny) {
        if (!p.godziny || parseFloat(p.godziny) <= 0) continue;
        const body = {
          pomocnik_id: p.pomocnik_id,
          godziny: parseFloat(p.godziny),
          stawka_godzinowa: parseFloat(p.stawka_godzinowa),
          data_pracy: dzisiaj,
        };
        const res = await fetch(`${API_URL}/rozliczenia/zadanie/${task_id}/godziny`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const queued = await queueRequestWithOfflineFallback({
            url: `${API_URL}/rozliczenia/zadanie/${task_id}/godziny`,
            method: 'POST',
            body: body as Record<string, unknown>,
          });
          setOfflineQueueCount(queued);
        }
      }

      showMsg(t('settlements.msg.hoursSaved'));
      loadAll();
    } catch {
      for (const p of formGodziny) {
        if (!p.godziny || parseFloat(p.godziny) <= 0) continue;
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/rozliczenia/zadanie/${task_id}/godziny`,
          method: 'POST',
          body: {
            pomocnik_id: p.pomocnik_id,
            godziny: parseFloat(p.godziny),
            stawka_godzinowa: parseFloat(p.stawka_godzinowa),
            data_pracy: dzisiaj,
          },
        });
        setOfflineQueueCount(queued);
      }
      showMsg(t('settlements.msg.offlineHoursQueued'));
    } finally {
      setSaving(false);
    }
  };

  const zatwierdz = async (godzinyId: number, status: string) => {
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/rozliczenia/godziny/${godzinyId}/zatwierdz`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showMsg(status === 'Potwierdzone' ? t('settlements.msg.hoursApproved') : t('settlements.msg.hoursRejected'));
        loadAll();
      } else {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/rozliczenia/godziny/${godzinyId}/zatwierdz`,
          method: 'PUT',
          body: { status },
        });
        setOfflineQueueCount(queued);
        showMsg(t('settlements.msg.offlineDecisionQueued'));
      }
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/rozliczenia/godziny/${godzinyId}/zatwierdz`,
        method: 'PUT',
        body: { status },
      });
      setOfflineQueueCount(queued);
      showMsg(t('settlements.msg.offlineDecisionQueued'));
    }
  };

  const obliczRozliczenie = async () => {
    if (!task_id || !formKalkulator.wartosc_brutto) {
      Alert.alert(t('wyceny.alert.saveFail'), t('settlements.alert.grossRequired'));
      return;
    }
    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/rozliczenia/zadanie/${task_id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formKalkulator)
      });
      const data = await res.json();
      if (res.ok) {
        setWynik(data);
        showMsg(t('settlements.msg.calcSaved'));
        loadAll();
      } else {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/rozliczenia/zadanie/${task_id}`,
          method: 'POST',
          body: formKalkulator as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        showMsg(t('settlements.msg.offlineCalcQueued'));
      }
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/rozliczenia/zadanie/${task_id}`,
        method: 'POST',
        body: formKalkulator as Record<string, unknown>,
      });
      setOfflineQueueCount(queued);
      showMsg(t('settlements.msg.offlineCalcQueued'));
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: any) => parseFloat(n || 0).toLocaleString(numberLocale, { minimumFractionDigits: 2 });

  const S = makeStyles(theme);
  const tabs = hasTaskContext
    ? [
        { key: 'godziny' as const, icon: 'time-outline' as const, label: t('settlements.tab.hours') },
        { key: 'kalkulator' as const, icon: 'calculator-outline' as const, label: t('settlements.tab.calc') },
        { key: 'dzien' as const, icon: 'bar-chart-outline' as const, label: t('settlements.tab.day') },
      ]
    : [
        { key: 'dzien' as const, icon: 'bar-chart-outline' as const, label: t('settlements.tab.day') },
      ];
  const daySummary = podsumowanieDnia ?? {
    data: toDateKey(),
    podsumowanie: { liczba_zlecen: 0, koszt_pomocnikow: 0, wynagrodzenie_brygadzisty: 0 },
    zlecenia: [],
    pomocnicy_godziny: [],
  };

  if (guard.ready && !guard.allowed) {
    return <View style={[S.container, { backgroundColor: theme.bg }]} />;
  }
  if (!guard.ready) {
    return <View style={[S.center, { backgroundColor: theme.bg }]}><ActivityIndicator size="large" color={theme.accent} /></View>;
  }

  if (loading) {
    return <View style={[S.center, { backgroundColor: theme.bg }]}><ActivityIndicator size="large" color={theme.accent} /></View>;
  }

  return (
    <KeyboardSafeScreen style={[S.container, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={'light-content'} backgroundColor={theme.headerBg} />
      <View style={[S.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: theme.headerText }]}>{t('settlements.title')}</Text>
      </View>

      {msg ? <View style={[S.msgBox, { backgroundColor: theme.successBg }]}><Text style={[S.msgText, { color: theme.success }]}>{msg}</Text></View> : null}
      <OfflineQueueBanner
        count={offlineQueueCount}
        warningColor={theme.warning}
        warningBackgroundColor={theme.warningBg}
        borderColor={theme.border}
      />

      {/* Tabs */}
      <View style={[S.tabs, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        {tabs.map((tab) => (
          <TouchableOpacity key={tab.key}
            style={[S.tab, activeTab === tab.key && { borderBottomColor: theme.accent }]}
            onPress={() => setActiveTab(tab.key as any)}>
            <Ionicons name={tab.icon} size={16} color={activeTab === tab.key ? theme.accent : theme.textMuted} />
            <Text style={[S.tabText, { color: theme.textMuted }, activeTab === tab.key && { color: theme.accent, fontWeight: '700' }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={S.scroll}
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >

        {/* ===== GODZINY POMOCNIKÓW ===== */}
        {activeTab === 'godziny' && (
          <>
            {task && (
              <View style={S.taskInfo}>
                <Text style={S.taskNazwa}>{task.klient_nazwa}</Text>
                <Text style={S.taskAdres}>📍 {task.adres}, {task.miasto}</Text>
              </View>
            )}

            <View style={S.section}>
              <Text style={S.sectionTitle}>{t('settlements.sectionHours')}</Text>
              <Text style={S.sectionSub}>{t('settlements.sectionHoursSub')}</Text>

              {formGodziny.length === 0 ? (
                <View style={S.empty}>
                  <Text style={S.emptyText}>{t('settlements.noHelpers')}</Text>
                </View>
              ) : formGodziny.map((p, idx) => (
                <View key={p.pomocnik_id} style={S.pomocnikCard}>
                  <View style={S.pomocnikHeader}>
                    <View style={S.avatar}>
                      <Text style={S.avatarText}>{p.imie?.[0]}{p.nazwisko?.[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.pomocnikNazwa}>{p.imie} {p.nazwisko}</Text>
                      {p.status === 'Potwierdzone' && <Text style={S.statusOk}>✅ Potwierdzone</Text>}
                      {p.status === 'Odrzucone' && <Text style={S.statusOdrzucone}>❌ Odrzucone</Text>}
                      {p.status === 'Oczekuje' && p.id && <Text style={S.statusOczekuje}>⏳ Oczekuje</Text>}
                    </View>
                  </View>

                  <View style={S.inputRow}>
                    <View style={S.inputGroup}>
                      <Text style={S.inputLabel}>{t('settlements.inputHours')}</Text>
                      <TextInput
                        style={S.input}
                        value={p.godziny}
                        onChangeText={v => {
                          const n = [...formGodziny];
                          n[idx] = { ...n[idx], godziny: v };
                          setFormGodziny(n);
                        }}
                        keyboardType="numeric"
                        placeholder="np. 6.5"
                      />
                    </View>
                    <View style={S.inputGroup}>
                      <Text style={S.inputLabel}>Stawka (PLN/h)</Text>
                      <TextInput
                        style={S.input}
                        value={p.stawka_godzinowa}
                        onChangeText={v => {
                          const n = [...formGodziny];
                          n[idx] = { ...n[idx], stawka_godzinowa: v };
                          setFormGodziny(n);
                        }}
                        keyboardType="numeric"
                        placeholder="np. 25"
                      />
                    </View>
                  </View>

                  {p.godziny && p.stawka_godzinowa && (
                    <View style={S.kosztRow}>
                      <Text style={S.kosztLabel}>Koszt pomocnika:</Text>
                      <Text style={S.kosztValue}>
                        {fmt(parseFloat(p.godziny) * parseFloat(p.stawka_godzinowa))} PLN
                      </Text>
                    </View>
                  )}

                  {/* Zatwierdź/Odrzuć dla brygadzisty */}
                  {p.id && user?.rola === 'Brygadzista' && p.status === 'Oczekuje' && (
                    <View style={S.zatwierdzRow}>
                      <TouchableOpacity style={S.btnOdrzuc} onPress={() => zatwierdz(p.id, 'Odrzucone')}>
                        <Text style={S.btnOdrzucText}>{t('settlements.reject')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={S.btnZatwierdz} onPress={() => zatwierdz(p.id, 'Potwierdzone')}>
                        <Text style={S.btnZatwierdzText}>{t('settlements.approve')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}

              {formGodziny.length > 0 && (
                <TouchableOpacity style={S.saveBtn} onPress={zapiszGodziny} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color={theme.accentText} />
                    : <Text style={S.saveBtnText}>{t('settlements.saveHours')}</Text>}
                </TouchableOpacity>
              )}
            </View>

            {/* Godziny z bazy */}
            {pomocnicy.length > 0 && (
              <View style={S.section}>
                <Text style={S.sectionTitle}>📋 Zapisane godziny</Text>
                {pomocnicy.map(p => (
                  <View key={p.id} style={S.savedRow}>
                    <Text style={S.savedNazwa}>{p.imie} {p.nazwisko}</Text>
                    <Text style={S.savedGodziny}>{p.godziny}h × {p.stawka_godzinowa} PLN</Text>
                    <Text style={S.savedKoszt}>{fmt(p.koszt)} PLN</Text>
                    <View style={[S.statusBadge,
                      { backgroundColor: p.status === 'Potwierdzone' ? theme.success : p.status === 'Odrzucone' ? theme.danger : theme.warning }]}>
                      <Text style={S.statusBadgeText}>{hourStatusLabel(p.status, t)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ===== KALKULATOR ===== */}
        {activeTab === 'kalkulator' && (
          <View style={S.section}>
            <Text style={S.sectionTitle}>{t('settlements.calcTitle')}</Text>

            {task && (
              <View style={S.taskInfo}>
                <Text style={S.taskNazwa}>{task.klient_nazwa}</Text>
                <Text style={S.taskAdres}>{t('settlements.teamLabel', { name: task.ekipa_nazwa || '—' })}</Text>
              </View>
            )}

            <View style={S.inputGroup}>
              <Text style={S.inputLabel}>{t('settlements.labelGross')}</Text>
              <TextInput style={S.input} value={formKalkulator.wartosc_brutto}
                onChangeText={v => setFormKalkulator({ ...formKalkulator, wartosc_brutto: v })}
                keyboardType="numeric" placeholder={t('settlements.placeholderGross')} />
            </View>

            <View style={S.inputGroup}>
              <Text style={S.inputLabel}>{t('settlements.vatLabel')}</Text>
              <View style={S.vatRow}>
                {['0', '5', '8', '23'].map(v => (
                  <TouchableOpacity key={v}
                    style={[S.vatBtn, formKalkulator.vat_stawka === v && S.vatBtnActive]}
                    onPress={() => setFormKalkulator({ ...formKalkulator, vat_stawka: v })}>
                    <Text style={[S.vatBtnText, formKalkulator.vat_stawka === v && S.vatBtnTextActive]}>
                      {v}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Podgląd pomocników */}
            {pomocnicy.length > 0 && (
              <View style={S.pomocnicyPreview}>
                <Text style={S.sectionTitle}>{t('settlements.helpersPreview')}</Text>
                {pomocnicy.map(p => (
                  <View key={p.id} style={S.savedRow}>
                    <Text style={S.savedNazwa}>{p.imie} {p.nazwisko}</Text>
                    <Text style={S.savedGodziny}>{p.godziny}h × {p.stawka_godzinowa} PLN/h</Text>
                    <Text style={S.savedKoszt}>{fmt(p.koszt)} PLN</Text>
                  </View>
                ))}
                <View style={S.sumaRow}>
                  <Text style={S.sumaLabel}>{t('settlements.totalHelperCost')}</Text>
                  <Text style={S.sumaValue}>
                    {fmt(pomocnicy.reduce((s, p) => s + parseFloat(p.koszt || 0), 0))} PLN
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity style={S.saveBtn} onPress={obliczRozliczenie} disabled={saving}>
              {saving
                ? <ActivityIndicator color={theme.accentText} />
                : <Text style={S.saveBtnText}>{t('settlements.calcSubmit')}</Text>}
            </TouchableOpacity>

            {/* Wynik */}
            {(wynik || rozliczenie) && (
              <View style={S.wynikiBox}>
                <Text style={S.wynikiTitle}>{t('settlements.resultTitle')}</Text>
                {[
                  { label: t('settlements.row.brutto'), value: `${fmt((wynik || rozliczenie).wartosc_brutto)} PLN` },
                  { label: t('settlements.row.vat', { pct: (wynik || rozliczenie).vat_stawka }), value: `${fmt(parseFloat((wynik || rozliczenie).wartosc_brutto) - parseFloat((wynik || rozliczenie).wartosc_netto || (wynik || rozliczenie).netto))} PLN` },
                  { label: t('settlements.row.netto'), value: `${fmt((wynik || rozliczenie).wartosc_netto || (wynik || rozliczenie).netto)} PLN` },
                  { label: t('settlements.row.helperCost'), value: `- ${fmt((wynik || rozliczenie).koszt_pomocnikow)} PLN`, color: theme.danger },
                  { label: t('settlements.row.foremanBase'), value: `${fmt((wynik || rozliczenie).podstawa_brygadzisty || (wynik || rozliczenie).podstawa)} PLN` },
                ].map(r => (
                  <View key={r.label} style={S.wynikRow}>
                    <Text style={S.wynikLabel}>{r.label}</Text>
                    <Text style={[S.wynikValue, r.color ? { color: r.color } : {}]}>{r.value}</Text>
                  </View>
                ))}
                <View style={S.wynikFinal}>
                  <Text style={S.wynikFinalLabel}>
                    {t('settlements.foremanPct', { pct: (wynik || rozliczenie).procent_brygadzisty })}
                  </Text>
                  <Text style={S.wynikFinalValue}>
                    {fmt((wynik || rozliczenie).wynagrodzenie_brygadzisty || (wynik || rozliczenie).wynagrodzenie_brygadzisty)} PLN
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ===== PODSUMOWANIE DNIA ===== */}
        {activeTab === 'dzien' && (
          <>
            {mySettlementOverview ? (
              <View style={S.section}>
                <Text style={S.sectionTitle}>Moje rozliczenia (self-service)</Text>
                <View style={S.kpiRow}>
                  <View style={[S.kpi, { borderTopColor: theme.accent }]}>
                    <Text style={[S.kpiNum, { color: theme.accent }]}>
                      {fmt(mySettlementOverview.pay_today)} PLN
                    </Text>
                    <Text style={S.kpiLabel}>Dziś</Text>
                  </View>
                  <View style={[S.kpi, { borderTopColor: theme.info }]}>
                    <Text style={[S.kpiNum, { color: theme.info }]}>
                      {fmt(mySettlementOverview.pay_week)} PLN
                    </Text>
                    <Text style={S.kpiLabel}>Tydzień</Text>
                  </View>
                </View>
                <View style={S.kpiRow}>
                  <View style={[S.kpi, { borderTopColor: theme.success }]}>
                    <Text style={[S.kpiNum, { color: theme.success }]}>
                      {fmt(mySettlementOverview.pay_month)} PLN
                    </Text>
                    <Text style={S.kpiLabel}>Miesiąc</Text>
                  </View>
                  <View style={[S.kpi, { borderTopColor: theme.warning }]}>
                    <Text style={[S.kpiNum, { color: theme.warning }]}>
                      {Number(mySettlementOverview.hours_month || 0).toFixed(1)} h
                    </Text>
                    <Text style={S.kpiLabel}>Godziny / miesiąc</Text>
                  </View>
                </View>
                {Array.isArray(mySettlementOverview.daily) && mySettlementOverview.daily.length > 0 ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={[S.sectionTitle, { fontSize: 13, marginBottom: 6 }]}>Ostatnie dni</Text>
                    {mySettlementOverview.daily.slice(0, 7).map((d: any) => (
                      <View key={d.date} style={S.savedRow}>
                        <Text style={S.savedNazwa}>{d.date}</Text>
                        <Text style={S.savedGodziny}>{Number(d.hours_total || 0).toFixed(1)} h</Text>
                        <Text style={S.savedKoszt}>{fmt(d.pay_pln)} PLN</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {mySettlementOverview.estimator_month || mySettlementOverview.estimator_stats ? (
                  <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: theme.surface2 }}>
                    <Text style={[S.sectionTitle, { fontSize: 13, marginBottom: 6 }]}>Mój miesiąc (specjalista ds. wyceny)</Text>
                    <Text style={{ color: theme.textSub, fontSize: 12 }}>
                      Podstawa: {fmt(mySettlementOverview.estimator_month?.commission_base || 0)} PLN
                      {' · '}
                      Prace dodatkowe: {fmt(mySettlementOverview.estimator_month?.extra_work_pln || 0)} PLN
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
                      Wystawione: {mySettlementOverview.estimator_stats?.issued || 0}
                      {' · '}
                      Zatwierdzone: {mySettlementOverview.estimator_stats?.approved || 0}
                      {' · '}
                      Zrealizowane: {mySettlementOverview.estimator_stats?.completed || 0}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={S.section}>
              <Text style={S.sectionTitle}>{t('settlements.daySummaryTitle', { date: daySummary.data })}</Text>

              <View style={S.kpiRow}>
                <View style={[S.kpi, { borderTopColor: theme.success }]}>
                  <Text style={[S.kpiNum, { color: theme.success }]}>
                    {daySummary.podsumowanie.liczba_zlecen}
                  </Text>
                  <Text style={S.kpiLabel}>{t('settlements.kpiOrders')}</Text>
                </View>
                <View style={[S.kpi, { borderTopColor: theme.danger }]}>
                  <Text style={[S.kpiNum, { color: theme.danger }]}>
                    {fmt(daySummary.podsumowanie.koszt_pomocnikow)} PLN
                  </Text>
                  <Text style={S.kpiLabel}>Koszt pomocników</Text>
                </View>
              </View>

              <View style={S.zarobek}>
                <Text style={S.zarobeklabel}>{t('settlements.earnedToday')}</Text>
                <Text style={S.zarobekValue}>
                  {fmt(daySummary.podsumowanie.wynagrodzenie_brygadzisty)} PLN
                </Text>
              </View>
            </View>

            {/* Zlecenia dnia */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>{t('settlements.dayOrdersTitle')}</Text>
              {daySummary.zlecenia.length === 0 ? (
                <Text style={S.emptyText}>{t('settlements.emptyToday')}</Text>
              ) : daySummary.zlecenia.map((z: any) => (
                <View key={z.id} style={S.zlecenieCard}>
                  <View style={S.zlecenieTop}>
                    <Text style={S.zlecenieKlient}>{z.klient_nazwa}</Text>
                    <Text style={S.zlecenieWynagrodzenie}>
                      {z.wynagrodzenie_brygadzisty ? `${fmt(z.wynagrodzenie_brygadzisty)} PLN` : t('settlements.noSettlement')}
                    </Text>
                  </View>
                  <Text style={S.zlecenieAdres}>📍 {z.adres}</Text>
                  {z.wartosc_brutto && (
                    <View style={S.zlecenieDetails}>
                      <Text style={S.zlecenieDetail}>{t('settlements.detailGross')} {fmt(z.wartosc_brutto)} PLN</Text>
                      <Text style={S.zlecenieDetail}>{t('settlements.detailNet')} {fmt(z.wartosc_netto)} PLN</Text>
                      <Text style={S.zlecenieDetail}>{t('settlements.detailHelpers')} -{fmt(z.koszt_pomocnikow)} PLN</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>

            {/* Godziny pomocników dnia */}
            {daySummary.pomocnicy_godziny.length > 0 && (
              <View style={S.section}>
                <Text style={S.sectionTitle}>{t('settlements.sectionToday')}</Text>
                {daySummary.pomocnicy_godziny.map((p: any) => (
                  <View key={p.id} style={S.savedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={S.savedNazwa}>{p.imie} {p.nazwisko}</Text>
                      <Text style={{ fontSize: 11, color: theme.textMuted }}>{p.klient_nazwa}</Text>
                    </View>
                    <Text style={S.savedGodziny}>{p.godziny}h × {p.stawka_godzinowa} PLN/h</Text>
                    <View style={[S.statusBadge,
                      { backgroundColor: p.status === 'Potwierdzone' ? theme.success : p.status === 'Odrzucone' ? theme.danger : theme.warning }]}>
                      <Text style={S.statusBadgeText}>{hourStatusLabel(p.status, t)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 14, paddingTop: 56, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1 },
  backBtn: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  msgBox: { padding: 12, margin: 12, borderRadius: 10 },
  msgText: { fontWeight: '600', textAlign: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', gap: 3, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 11, fontWeight: '500' },
  scroll: { flex: 1 },
  section: { backgroundColor: t.cardBg, margin: 12, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.cardBorder, elevation: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 8 },
  sectionSub: { fontSize: 12, color: t.textMuted, marginBottom: 12 },
  taskInfo: { backgroundColor: t.surface2, borderRadius: 10, padding: 12, marginBottom: 14 },
  taskNazwa: { fontSize: 15, fontWeight: '700', color: t.text },
  taskAdres: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  empty: { alignItems: 'center', padding: 24 },
  emptyText: { color: t.textMuted, fontSize: 14 },
  pomocnikCard: { backgroundColor: t.surface2, borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: t.accent },
  pomocnikHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: t.accent, fontWeight: '700', fontSize: 14 },
  pomocnikNazwa: { fontSize: 14, fontWeight: '600', color: t.text },
  statusOk: { fontSize: 12, color: t.success, fontWeight: '600' },
  statusOdrzucone: { fontSize: 12, color: t.danger, fontWeight: '600' },
  statusOczekuje: { fontSize: 12, color: t.warning, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputGroup: { flex: 1, marginBottom: 10 },
  inputLabel: { fontSize: 12, color: t.textMuted, fontWeight: '600', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: t.inputBorder, borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: t.inputBg, color: t.inputText },
  kosztRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.successBg, padding: 8, borderRadius: 8 },
  kosztLabel: { fontSize: 13, color: t.textSub },
  kosztValue: { fontSize: 13, fontWeight: '700', color: t.success },
  zatwierdzRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btnOdrzuc: { flex: 1, backgroundColor: t.dangerBg, padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: t.danger + '44' },
  btnOdrzucText: { color: t.danger, fontWeight: '600', fontSize: 13 },
  btnZatwierdz: { flex: 1, backgroundColor: t.successBg, padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: t.success + '44' },
  btnZatwierdzText: { color: t.success, fontWeight: '600', fontSize: 13 },
  saveBtn: { backgroundColor: t.accent, padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  saveBtnText: { color: t.accentText, fontWeight: '700', fontSize: 15 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border },
  savedNazwa: { flex: 1, fontSize: 13, fontWeight: '600', color: t.text },
  savedGodziny: { fontSize: 12, color: t.textMuted },
  savedKoszt: { fontSize: 13, fontWeight: '600', color: t.accent },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusBadgeText: { color: t.accentText, fontSize: 11, fontWeight: '600' },
  vatRow: { flexDirection: 'row', gap: 8 },
  vatBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border },
  vatBtnActive: { backgroundColor: t.accentLight, borderColor: t.accent },
  vatBtnText: { fontSize: 14, color: t.textMuted, fontWeight: '600' },
  vatBtnTextActive: { color: t.accent },
  pomocnicyPreview: { backgroundColor: t.surface2, borderRadius: 10, padding: 12, marginBottom: 12 },
  sumaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: t.border },
  sumaLabel: { fontSize: 13, fontWeight: '600', color: t.textSub },
  sumaValue: { fontSize: 13, fontWeight: '700', color: t.danger },
  wynikiBox: { backgroundColor: t.surface2, borderRadius: 12, padding: 16, marginTop: 16 },
  wynikiTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 12 },
  wynikRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border },
  wynikLabel: { fontSize: 13, color: t.textMuted },
  wynikValue: { fontSize: 13, fontWeight: '600', color: t.textSub },
  wynikFinal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4 },
  wynikFinalLabel: { fontSize: 14, fontWeight: '700', color: t.text },
  wynikFinalValue: { fontSize: 22, fontWeight: '800', color: t.success },
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  kpi: { flex: 1, backgroundColor: t.surface2, borderRadius: 10, padding: 12, alignItems: 'center', borderTopWidth: 3 },
  kpiNum: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  kpiLabel: { fontSize: 11, color: t.textMuted, textAlign: 'center' },
  zarobek: { backgroundColor: t.successBg, borderRadius: 12, padding: 20, alignItems: 'center' },
  zarobeklabel: { fontSize: 14, color: t.success, marginBottom: 6, opacity: 0.8 },
  zarobekValue: { fontSize: 32, fontWeight: '800', color: t.success },
  zlecenieCard: { backgroundColor: t.surface2, borderRadius: 10, padding: 12, marginBottom: 10 },
  zlecenieTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  zlecenieKlient: { fontSize: 14, fontWeight: '600', color: t.text, flex: 1 },
  zlecenieWynagrodzenie: { fontSize: 14, fontWeight: '700', color: t.success },
  zlecenieAdres: { fontSize: 12, color: t.textMuted, marginBottom: 6 },
  zlecenieDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  zlecenieDetail: { fontSize: 11, color: t.textMuted, backgroundColor: t.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
});
