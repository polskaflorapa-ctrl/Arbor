import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    StatusBar,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { OfflineQueueBanner } from '../components/ui/app-state';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { flushOfflineQueue, getOfflineQueueSize, queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';

type ZadanieFormItem = {
  task_id: number;
  czas_minuty: string;
  uwagi: string;
};

type MaterialFormItem = {
  nazwa: string;
  ilosc: string;
  jednostka: string;
  koszt_jednostkowy: string;
};

type RaportForm = {
  data_raportu: string;
  opis_pracy: string;
  zadania: ZadanieFormItem[];
  materialy: MaterialFormItem[];
};

type ExistingReport = {
  id: number;
  status: string;
};

type TaskLite = {
  id: number;
  klient_nazwa?: string;
  adres?: string;
  typ_uslugi?: string;
  data_planowana?: string;
};

export default function RaportDzienny() {
  const router = useRouter();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/raport-dzienny');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [zlecenia, setZlecenia] = useState<TaskLite[]>([]);
  const [existingReport, setExistingReport] = useState<ExistingReport | null>(null);
  const [showPodpis, setShowPodpis] = useState(false);
  const [podpisData, setPodpisData] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  const dzisiaj = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState<RaportForm>({
    data_raportu: dzisiaj,
    opis_pracy: '',
    zadania: [],
    materialy: [],
  });

  const loadData = useCallback(async () => {
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
      const h = { Authorization: `Bearer ${storedToken}` };

      const [zRes, rRes] = await Promise.all([
        axios.get(`${API_URL}/tasks/wszystkie`, { headers: h }),
        axios.get(`${API_URL}/raporty-dzienne?data=${dzisiaj}`, { headers: h }),
      ]);

      const dzisiejsze: TaskLite[] = zRes.data.filter((z: TaskLite) =>
        z.data_planowana?.split('T')[0] === dzisiaj
      );
      setZlecenia(dzisiejsze);

      if (rRes.data.length > 0) {
        const r = rRes.data[0];
        setExistingReport(r);
        const detailRes = await axios.get(`${API_URL}/raporty-dzienne/${r.id}`, { headers: h });
        const detail = detailRes.data;
        setForm({
          data_raportu: dzisiaj,
          opis_pracy: detail.opis_pracy || '',
          zadania: detail.zadania?.map((z: any) => ({
            task_id: z.task_id,
            czas_minuty: z.czas_minuty?.toString() || '0',
            uwagi: z.uwagi || '',
          })) || [],
          materialy: detail.materialy?.map((m: any) => ({
            nazwa: m.nazwa,
            ilosc: m.ilosc?.toString() || '1',
            jednostka: m.jednostka || 'szt',
            koszt_jednostkowy: m.koszt_jednostkowy?.toString() || '0',
          })) || [],
        });
        if (detail.podpis_url) setPodpisData(detail.podpis_url);
      } else {
        setForm(f => ({
          ...f,
          zadania: dzisiejsze.map((z: TaskLite) => ({
            task_id: z.id,
            czas_minuty: '',
            uwagi: '',
          }))
        }));
      }
    } catch {
      Alert.alert(t('wyceny.alert.saveFail'), t('dailyReport.alert.loadFail'));
      setOfflineQueueCount(await getOfflineQueueSize());
    } finally {
      setLoading(false);
    }
  }, [dzisiaj, router, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void loadData();
    });
    return unsubscribe;
  }, [loadData]);

  const dodajMaterial = () => {
    setForm(f => ({
      ...f,
      materialy: [...f.materialy, { nazwa: '', ilosc: '1', jednostka: 'szt', koszt_jednostkowy: '0' }]
    }));
  };

  const usunMaterial = (idx: number) => {
    setForm(f => ({ ...f, materialy: f.materialy.filter((_, i) => i !== idx) }));
  };

  const updateMaterial = (idx: number, field: keyof MaterialFormItem, value: string) => {
    setForm(f => {
      const m = [...f.materialy];
      m[idx] = { ...m[idx], [field]: value };
      return { ...f, materialy: m };
    });
  };

  const updateZadanie = (idx: number, field: keyof ZadanieFormItem, value: string) => {
    setForm(f => {
      const z = [...f.zadania];
      z[idx] = { ...z[idx], [field]: value };
      return { ...f, zadania: z };
    });
  };

  const saveRaport = async () => {
    const payload = {
      ...form,
      podpis_url: podpisData,
      zadania: form.zadania.map(z => ({
        ...z,
        czas_minuty: parseInt(z.czas_minuty) || 0,
      })),
      materialy: form.materialy.filter(m => m.nazwa.trim() !== '').map(m => ({
        ...m,
        ilosc: parseFloat(m.ilosc) || 1,
        koszt_jednostkowy: parseFloat(m.koszt_jednostkowy) || 0,
      })),
    };

    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await axios.post(`${API_URL}/raporty-dzienne`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setExistingReport({ id: res.data.id, status: 'Roboczy' });
      void triggerHaptic('success');
      Alert.alert(t('dailyReport.alert.savedTitle'), t('dailyReport.alert.savedBody'));
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/raporty-dzienne`,
        method: 'POST',
        body: payload as Record<string, unknown>,
      });
      void triggerHaptic('warning');
      setOfflineQueueCount(queued);
      Alert.alert(t('dailyReport.offlineTitle'), t('dailyReport.alert.offlineSave'));
    } finally {
      setSaving(false);
    }
  };

  const wyslijRaport = async () => {
    if (!existingReport?.id) {
      Alert.alert(t('dailyReport.alert.saveFirstTitle'), t('dailyReport.alert.saveFirstBody'));
      return;
    }
    if (!podpisData) {
      Alert.alert(t('dailyReport.alert.noSignatureTitle'), t('dailyReport.alert.noSignatureBody'));
      return;
    }

    Alert.alert(
      t('dailyReport.confirmSendTitle'),
      t('dailyReport.confirmSendBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dailyReport.send'), onPress: async () => {
            setSending(true);
            try {
              if (!token) { router.replace('/login'); return; }
              await axios.post(`${API_URL}/raporty-dzienne/${existingReport.id}/wyslij`, {}, {
                headers: { Authorization: `Bearer ${token}` }
              });
              void triggerHaptic('success');
              Alert.alert(t('dailyReport.alert.sentTitle'), t('dailyReport.alert.sentBody'));
              setExistingReport(r => (r ? { ...r, status: 'Wyslany' } : r));
            } catch {
              const queued = await queueRequestWithOfflineFallback({
                url: `${API_URL}/raporty-dzienne/${existingReport.id}/wyslij`,
                method: 'POST',
                body: {},
              });
              void triggerHaptic('warning');
              setOfflineQueueCount(queued);
              Alert.alert(t('dailyReport.offlineTitle'), t('dailyReport.alert.offlineSend'));
            } finally {
              setSending(false);
            }
          }
        }
      ]
    );
  };

  const S = makeStyles(theme);
  const totalMinutes = form.zadania.reduce((sum, row) => sum + (parseInt(row.czas_minuty) || 0), 0);
  const filledTasks = form.zadania.filter((row) => (parseInt(row.czas_minuty) || 0) > 0 || row.uwagi.trim()).length;
  const materialCount = form.materialy.filter((row) => row.nazwa.trim()).length;
  const reportStats = [
    { key: 'tasks', label: 'Zlecenia', value: `${filledTasks}/${form.zadania.length}`, icon: 'clipboard-outline' as const, color: theme.accent },
    { key: 'time', label: 'Czas', value: `${Math.round(totalMinutes / 60 * 10) / 10}h`, icon: 'time-outline' as const, color: theme.info },
    { key: 'materials', label: 'Materialy', value: String(materialCount), icon: 'construct-outline' as const, color: theme.warning },
    { key: 'sign', label: 'Podpis', value: podpisData ? 'OK' : '-', icon: 'create-outline' as const, color: podpisData ? theme.success : theme.textMuted },
  ];

  if (guard.ready && !guard.allowed) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  if (!guard.ready) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={[S.loadingText, { color: theme.textMuted }]}>{t('dailyReport.loading')}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={[S.loadingText, { color: theme.textMuted }]}>{t('dailyReport.loading')}</Text>
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={{ flex: 1, backgroundColor: theme.bg }}>
    <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
    <ScrollView
      style={[S.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
    >
      {/* Nagłówek */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="document-text-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Raport brygady</Text>
          <Text style={S.headerTitle}>{t('dailyReport.title')}</Text>
          <Text style={S.headerDate}>{dzisiaj}</Text>
        </View>
        {existingReport && (
        <View style={[
          S.statusBadge,
          {
            backgroundColor: existingReport?.status === 'Wyslany' ? theme.successBg : theme.surface2,
            borderColor: existingReport?.status === 'Wyslany' ? theme.success : theme.border,
          },
        ]}>
          <Text style={[S.statusText, { color: existingReport?.status === 'Wyslany' ? theme.success : theme.textSub }]}>
              {existingReport.status === 'Wyslany' ? 'Wysłany' : 'Roboczy'}
            </Text>
          </View>
        )}
      </View>
      <OfflineQueueBanner
        count={offlineQueueCount}
        warningColor={theme.warning}
        warningBackgroundColor={theme.warningBg}
        borderColor={theme.border}
      />

      <View style={S.reportStats}>
        {reportStats.map((stat) => (
          <View key={stat.key} style={[S.reportStat, { borderColor: `${stat.color}44` }]}>
            <View style={[S.reportStatIcon, { backgroundColor: `${stat.color}1F` }]}>
              <Ionicons name={stat.icon} size={16} color={stat.color} />
            </View>
            <Text style={S.reportStatValue}>{stat.value}</Text>
            <Text style={S.reportStatLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Zlecenia dnia */}
      <View style={[S.section, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ionicons name="clipboard-outline" size={16} color={theme.accent} />
          <Text style={[S.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Zlecenia dnia ({form.zadania.length})</Text>
        </View>
        {form.zadania.length === 0 ? (
          <Text style={[S.emptyText, { color: theme.textMuted }]}>Brak zleceń na dziś</Text>
        ) : form.zadania.map((z, idx) => {
          const zlecenie = zlecenia.find(zl => zl.id === z.task_id);
          return (
            <View key={idx} style={[S.zadanieCard, { backgroundColor: theme.surface2, borderLeftColor: theme.accent }]}>
              <Text style={[S.zadanieKlient, { color: theme.text }]}>
                {zlecenie?.klient_nazwa || `Zlecenie #${z.task_id}`}
              </Text>
              <Text style={[S.zadanieAdres, { color: theme.textMuted }]}>
                {zlecenie?.adres} · {zlecenie?.typ_uslugi}
              </Text>
              <View style={S.zadanieRow}>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>Czas (min):</Text>
                <TextInput
                  style={[S.inputSm, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={z.czas_minuty}
                  onChangeText={v => updateZadanie(idx, 'czas_minuty', v)}
                  keyboardType="numeric"
                  placeholder="np. 120"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.zadanieRow}>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>Uwagi:</Text>
                <TextInput
                  style={[S.inputSm, { flex: 1, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={z.uwagi}
                  onChangeText={v => updateZadanie(idx, 'uwagi', v)}
                  placeholder="Opcjonalne uwagi"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* Materiały */}
      <View style={[S.section, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
        <View style={S.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="construct-outline" size={16} color={theme.accent} />
            <Text style={[S.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Zużyte materiały</Text>
          </View>
          <TouchableOpacity style={[S.addBtn, { backgroundColor: theme.surface2, borderColor: theme.accent }]} onPress={dodajMaterial}>
            <Text style={[S.addBtnText, { color: theme.accent }]}>+ Dodaj</Text>
          </TouchableOpacity>
        </View>
        {form.materialy.length === 0 ? (
          <Text style={[S.emptyText, { color: theme.textMuted }]}>Brak zużytych materiałów</Text>
        ) : form.materialy.map((m, idx) => (
          <View key={idx} style={[S.materialCard, { backgroundColor: theme.surface2 }]}>
            <View style={S.materialHeader}>
              <Text style={[S.materialIdx, { color: theme.textMuted }]}>Materiał {idx + 1}</Text>
              <TouchableOpacity onPress={() => usunMaterial(idx)}>
                <Ionicons name="close-circle" size={22} color={theme.danger} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[S.input, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={m.nazwa}
              onChangeText={v => updateMaterial(idx, 'nazwa', v)}
              placeholder="Nazwa (np. Paliwo, Olej piłarski)"
              placeholderTextColor={theme.inputPlaceholder}
            />
            <View style={S.materialRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>Ilość:</Text>
                <TextInput
                  style={[S.inputSm, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={m.ilosc}
                  onChangeText={v => updateMaterial(idx, 'ilosc', v)}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>Jednostka:</Text>
                <TextInput
                  style={[S.inputSm, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={m.jednostka}
                  onChangeText={v => updateMaterial(idx, 'jednostka', v)}
                  placeholder="szt/l/kg"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>Koszt/szt:</Text>
                <TextInput
                  style={[S.inputSm, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={m.koszt_jednostkowy}
                  onChangeText={v => updateMaterial(idx, 'koszt_jednostkowy', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Opis pracy */}
      <View style={[S.section, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ionicons name="document-text-outline" size={16} color={theme.accent} />
          <Text style={[S.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Opis pracy</Text>
        </View>
        <TextInput
          style={[S.input, { height: 100, textAlignVertical: 'top', backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
          value={form.opis_pracy}
          onChangeText={v => setForm({ ...form, opis_pracy: v })}
          placeholder="Opisz co zostało wykonane dzisiaj..."
          placeholderTextColor={theme.inputPlaceholder}
          multiline
        />
      </View>

      {/* Podpis */}
      <View style={[S.section, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ionicons name="create-outline" size={16} color={theme.accent} />
          <Text style={[S.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Podpis elektroniczny</Text>
        </View>
        {podpisData ? (
          <View style={[S.podpisPreview, { backgroundColor: theme.successBg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="checkmark-circle" size={18} color={theme.success} />
              <Text style={[S.podpisOk, { color: theme.success }]}>Podpis dodany</Text>
            </View>
            <TouchableOpacity onPress={() => { setPodpisData(null); setShowPodpis(true); }}>
              <Text style={[S.podpisZmien, { color: theme.accent }]}>Zmień</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[S.podpisBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]} onPress={() => setShowPodpis(true)}>
            <Ionicons name="pencil" size={20} color={theme.textMuted} />
            <Text style={[S.podpisBtnText, { color: theme.textMuted }]}>Kliknij aby podpisać</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Przyciski */}
      <View style={S.btnRow}>
        <PlatinumCTA
          label="Zapisz"
          style={S.saveBtn}
          onPress={saveRaport}
          disabled={saving}
          loading={saving}
        />
        <PlatinumCTA
          label="Wyślij"
          style={[S.sendBtn, (!existingReport || !podpisData) && S.btnDisabled]}
          onPress={wyslijRaport}
          disabled={sending || !existingReport || !podpisData}
          loading={sending}
        />
      </View>

      {/* Modal podpisu */}
      <PodpisModal
        visible={showPodpis}
        onClose={() => setShowPodpis(false)}
        onSave={(data: string) => {
          setPodpisData(data);
          setShowPodpis(false);
        }}
        theme={theme}
      />
    </ScrollView>
    </KeyboardSafeScreen>
  );
}

function PodpisModal({
  visible,
  onClose,
  onSave,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: string) => void;
  theme: Theme;
}) {
  const { t } = useLanguage();
  const [signed, setSigned] = useState(false);

  const handleSave = () => {
    if (!signed) {
      Alert.alert(t('dailyReport.alert.noSignatureTitle'), t('dailyReport.alert.drawSignature'));
      return;
    }
    const svgData = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><text x="50" y="80" font-size="24" fill="${theme.text}">Podpisano</text></svg>`)}`;
    onSave(svgData);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={P.overlay}>
        <View style={[P.modal, { backgroundColor: theme.surface }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Ionicons name="create" size={20} color={theme.accent} />
            <Text style={[P.title, { color: theme.text }]}>Podpis elektroniczny</Text>
          </View>
          <Text style={[P.sub, { color: theme.textMuted }]}>Dotknij pola poniżej aby potwierdzić podpis</Text>

          <TouchableOpacity
            style={[P.canvas, { backgroundColor: theme.surface2, borderColor: signed ? theme.success : theme.border }, signed && { backgroundColor: theme.successBg }]}
            onPress={() => setSigned(true)}>
            {signed ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={24} color={theme.success} />
                <Text style={[P.canvasSignedText, { color: theme.success }]}>Podpisano</Text>
              </View>
            ) : (
              <Text style={[P.canvasHint, { color: theme.textSub }]}>Dotknij tutaj aby podpisać →</Text>
            )}
          </TouchableOpacity>

          <View style={P.btnRow}>
            <TouchableOpacity style={[P.clearBtn, { backgroundColor: theme.dangerBg }]} onPress={() => setSigned(false)}>
              <Ionicons name="trash-outline" size={14} color={theme.danger} />
              <Text style={[P.clearBtnText, { color: theme.danger }]}>Wyczyść</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[P.cancelBtn, { backgroundColor: theme.surface2 }]} onPress={onClose}>
              <Text style={[P.cancelBtnText, { color: theme.textSub }]}>Anuluj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[P.saveBtn, { backgroundColor: theme.accent }]} onPress={handleSave}>
              <Ionicons name="checkmark" size={14} color={theme.accentText} />
              <Text style={[P.saveBtnText, { color: theme.accentText }]}>Zapisz</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12 },
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
      opacity: t.shadowOpacity * 0.5,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
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
    borderRadius: 16,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBox: { flex: 1, minWidth: 0 },
  headerEyebrow: { color: t.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  headerTitle: { color: t.text, fontSize: 20, lineHeight: 24, fontWeight: '900' },
  headerDate: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  statusBadge: {
    minHeight: 34,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: { fontSize: 11, fontWeight: '900' },
  reportStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, marginBottom: 2 },
  reportStat: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: t.cardBg,
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  reportStatIcon: { width: 30, height: 30, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reportStatValue: { color: t.text, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  reportStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  section: {
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.42,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '900', marginBottom: 12 },
  emptyText: { textAlign: 'center', padding: 16, fontSize: 14, fontWeight: '800' },
  zadanieCard: { borderRadius: 14, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderWidth: 1, borderColor: t.border },
  zadanieKlient: { fontSize: 14, fontWeight: '900', marginBottom: 2 },
  zadanieAdres: { fontSize: 12, marginBottom: 8, fontWeight: '700' },
  zadanieRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  materialCard: { borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  materialHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  materialIdx: { fontSize: 13, fontWeight: '900' },
  materialRow: { flexDirection: 'row', marginTop: 8 },
  fieldLabel: { fontSize: 12, marginBottom: 4, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 12, padding: 11, fontSize: 14, marginTop: 4, fontWeight: '700' },
  inputSm: { borderWidth: 1, borderRadius: 12, padding: 9, fontSize: 13, fontWeight: '700' },
  addBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  addBtnText: { fontSize: 13, fontWeight: '900' },
  podpisPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10 },
  podpisOk: { fontWeight: '600', fontSize: 14 },
  podpisZmien: { fontSize: 13, fontWeight: '600' },
  podpisBtn: { borderWidth: 1, borderRadius: 12, padding: 20, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  podpisBtnText: { fontSize: 15, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 12, margin: 12 },
  saveBtn: { flex: 1 },
  sendBtn: { flex: 1, backgroundColor: t.success },
  btnDisabled: { opacity: 0.5 },
});

const P = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' },
  modal: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, paddingBottom: 44 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  sub: { fontSize: 13, marginBottom: 16 },
  canvas: { height: 150, borderRadius: 12, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  canvasHint: { fontSize: 14 },
  canvasSignedText: { fontSize: 18, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8 },
  clearBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  clearBtnText: { fontWeight: '600', fontSize: 13 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelBtnText: { fontWeight: '600', fontSize: 13 },
  saveBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  saveBtnText: { fontWeight: '700', fontSize: 13 },
});
