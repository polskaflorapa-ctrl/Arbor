import { safeBack } from '../utils/navigation';
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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { OfflineQueueBanner } from '../components/ui/app-state';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { apiFetch, apiJsonFetch, apiUrl } from '../utils/api-client';
import { triggerHaptic } from '../utils/haptics';
import { flushOfflineQueue, getOfflineQueueSize, queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';

import { AppStatusBar } from '../components/ui/app-status-bar';
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
  status?: string;
  czas_planowany_godziny?: string | number | null;
};

type DayPreview = {
  tasks_day: { id: number; klient_nazwa?: string; status?: string }[];
  cash_by_forma: { forma_platnosc?: string | null; sum_kwota?: string | number; cnt?: number }[];
  issues_count?: number;
};

type TeamDayPack = {
  report: { id: number; status?: string } | null;
  lines: unknown[];
  day_preview: DayPreview | null;
};

const toDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const taskDateKey = (value?: string | null) => {
  if (!value) return '';
  const direct = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : toDateKey(d);
};

const isCrewRole = (role?: string | null) => {
  const value = String(role || '').toLowerCase();
  return value === 'brygadzista' || value === 'pomocnik' || value.includes('pomocnik bez');
};

const canCloseTeamDayReport = (role?: string | null) => {
  const value = String(role || '').toLowerCase();
  return value === 'brygadzista' || value === 'pomocnik';
};

const isClosedTask = (status?: string | null) => {
  const value = String(status || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return value === 'zakonczone' || value === 'anulowane';
};

const formatPln = (value?: string | number | null) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00 zl';
  return `${n.toFixed(2)} zl`;
};

const normalizeTeamDayPack = (data: any): TeamDayPack => {
  const preview = data?.day_preview && typeof data.day_preview === 'object'
    ? {
        tasks_day: Array.isArray(data.day_preview.tasks_day) ? data.day_preview.tasks_day : [],
        cash_by_forma: Array.isArray(data.day_preview.cash_by_forma) ? data.day_preview.cash_by_forma : [],
        issues_count: Number(data.day_preview.issues_count) || 0,
      }
    : null;
  return {
    report: data?.report ?? null,
    lines: Array.isArray(data?.lines) ? data.lines : [],
    day_preview: preview,
  };
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
  const [userRole, setUserRole] = useState('');
  const [teamDayPack, setTeamDayPack] = useState<TeamDayPack | null>(null);
  const [teamDayLoading, setTeamDayLoading] = useState(false);
  const [teamDayBusy, setTeamDayBusy] = useState(false);
  const [cashReviewed, setCashReviewed] = useState(false);
  const [issuesReviewed, setIssuesReviewed] = useState(false);

  const dzisiaj = toDateKey();

  const [form, setForm] = useState<RaportForm>({
    data_raportu: dzisiaj,
    opis_pracy: '',
    zadania: [],
    materialy: [],
  });

  const fetchTeamDayReport = useCallback(async (storedToken: string, role: string) => {
    if (!canCloseTeamDayReport(role)) {
      setTeamDayPack(null);
      return;
    }
    setTeamDayLoading(true);
    try {
      const res = await apiFetch(`/mobile/me/team-day-report?date=${dzisiaj}`, { token: storedToken });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTeamDayPack(normalizeTeamDayPack(await res.json()));
    } catch {
      setTeamDayPack(null);
    } finally {
      setTeamDayLoading(false);
    }
  }, [dzisiaj]);

  const loadData = useCallback(async () => {
    try {
      const { token: storedToken, user } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      const role = String(user?.rola || '');
      setToken(storedToken);
      setUserRole(role);
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
      const taskEndpoint = isCrewRole(role)
        ? `/tasks/moje?data=${dzisiaj}`
        : '/tasks/wszystkie';

      const [zData, rData] = await Promise.all([
        apiFetch(taskEndpoint, { token: storedToken }).then(r => r.json()),
        apiFetch(`/raporty-dzienne?data=${dzisiaj}`, { token: storedToken }).then(r => r.json()),
      ]);

      const rawTasks: TaskLite[] = Array.isArray(zData)
        ? zData
        : Array.isArray(zData?.items) ? zData.items : [];
      const dzisiejsze = isCrewRole(role)
        ? rawTasks
        : rawTasks.filter((z: TaskLite) => taskDateKey(z.data_planowana) === dzisiaj);
      setZlecenia(dzisiejsze);
      await fetchTeamDayReport(storedToken, role);

      if (Array.isArray(rData) && rData.length > 0) {
        const r = rData[0];
        setExistingReport(r);
        const detail = await apiFetch(`/raporty-dzienne/${r.id}`, { token: storedToken }).then(res => res.json());
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
  }, [dzisiaj, fetchTeamDayReport, router, t]);

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
      const reportUrl = apiUrl('/raporty-dzienne');
      const httpRes = await apiJsonFetch(reportUrl, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}`);
      const data = await httpRes.json();
      setExistingReport({ id: data.id, status: 'Roboczy' });
      void triggerHaptic('success');
      Alert.alert(t('dailyReport.alert.savedTitle'), t('dailyReport.alert.savedBody'));
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        url: apiUrl('/raporty-dzienne'),
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
              const sendUrl = apiUrl(`/raporty-dzienne/${existingReport.id}/wyslij`);
              const wysRes = await apiJsonFetch(sendUrl, {
                method: 'POST',
                token,
                body: JSON.stringify({}),
              });
              if (!wysRes.ok) throw new Error(`HTTP ${wysRes.status}`);
              void triggerHaptic('success');
              Alert.alert(t('dailyReport.alert.sentTitle'), t('dailyReport.alert.sentBody'));
              setExistingReport(r => (r ? { ...r, status: 'Wyslany' } : r));
            } catch {
              const queued = await queueRequestWithOfflineFallback({
                url: apiUrl(`/raporty-dzienne/${existingReport.id}/wyslij`),
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

  const closeTeamDay = async () => {
    if (!token) { router.replace('/login'); return; }
    if (!canCloseTeamDayReport(userRole)) return;
    setTeamDayBusy(true);
    try {
      const closeRes = await apiJsonFetch('/mobile/me/team-day-close', {
        method: 'POST',
        token,
        body: JSON.stringify({ report_date: dzisiaj }),
      });
      if (!closeRes.ok) {
        const errBody = await closeRes.json().catch(() => ({})) as { error?: string };
        throw Object.assign(new Error('close-failed'), { apiError: errBody.error });
      }
      await fetchTeamDayReport(token, userRole);
      void triggerHaptic('success');
      Alert.alert('Zamkniecie dnia', 'Raport ekipy zostal przeliczony.');
    } catch (err: any) {
      void triggerHaptic('warning');
      Alert.alert('Zamkniecie dnia', err?.apiError || 'Nie udalo sie przeliczyc raportu ekipy.');
    } finally {
      setTeamDayBusy(false);
    }
  };

  const S = makeStyles(theme);
  const totalMinutes = form.zadania.reduce((sum, row) => sum + (parseInt(row.czas_minuty) || 0), 0);
  const filledTasks = form.zadania.filter((row) => (parseInt(row.czas_minuty) || 0) > 0 || row.uwagi.trim()).length;
  const materialCount = form.materialy.filter((row) => row.nazwa.trim()).length;
  const closedToday = zlecenia.filter((task) => isClosedTask(task.status)).length;
  const openToday = zlecenia.filter((task) => !isClosedTask(task.status)).length;
  const cashRows = teamDayPack?.day_preview?.cash_by_forma ?? [];
  const cashTotal = cashRows.reduce((sum, row) => sum + (Number(row.sum_kwota) || 0), 0);
  const issuesCount = teamDayPack?.day_preview?.issues_count ?? 0;
  const allTimesReady = form.zadania.length === 0 || form.zadania.every((row) => (parseInt(row.czas_minuty) || 0) > 0);
  const descriptionReady = form.opis_pracy.trim().length >= 10;
  const cashReady = cashRows.length === 0 || cashReviewed;
  const issuesReady = issuesCount === 0 || issuesReviewed;
  const teamDayChecks = [
    { key: 'tasks', label: 'Zlecenia zamkniete', value: `${closedToday}/${zlecenia.length}`, ready: zlecenia.length > 0 && openToday === 0 },
    { key: 'time', label: 'Czasy pracy wpisane', value: `${filledTasks}/${form.zadania.length}`, ready: allTimesReady && form.zadania.length > 0 },
    { key: 'desc', label: 'Opis dnia', value: descriptionReady ? 'OK' : 'brak', ready: descriptionReady },
    { key: 'cash', label: 'Kasa sprawdzona', value: cashRows.length ? formatPln(cashTotal) : 'brak', ready: cashReady },
    { key: 'issues', label: 'Problemy sprawdzone', value: String(issuesCount), ready: issuesReady },
    { key: 'sign', label: 'Podpis', value: podpisData ? 'OK' : 'brak', ready: Boolean(podpisData) },
  ];
  const readyChecks = teamDayChecks.filter((check) => check.ready).length;
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
    <AppStatusBar />
    <ScrollView
      style={[S.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
    >
      {/* Nagłówek */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
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

      {canCloseTeamDayReport(userRole) ? (
        <View style={[S.section, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
          <View style={S.teamCloseHeader}>
            <View style={S.teamCloseTitleBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="shield-checkmark-outline" size={17} color={theme.accent} />
                <Text style={[S.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Zamkniecie dnia ekipy</Text>
              </View>
              <Text style={[S.teamCloseSub, { color: theme.textMuted }]}>
                Jedna kontrola przed wyslaniem raportu do biura.
              </Text>
            </View>
            <View style={[S.teamScore, { backgroundColor: readyChecks === teamDayChecks.length ? theme.successBg : theme.surface2 }]}>
              <Text style={[S.teamScoreValue, { color: readyChecks === teamDayChecks.length ? theme.success : theme.accent }]}>
                {readyChecks}/{teamDayChecks.length}
              </Text>
              <Text style={[S.teamScoreLabel, { color: theme.textMuted }]}>gotowe</Text>
            </View>
          </View>

          <View style={S.checkList}>
            {teamDayChecks.map((check) => (
              <View key={check.key} style={[S.checkRow, { borderColor: theme.border }]}>
                <Ionicons
                  name={check.ready ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={check.ready ? theme.success : theme.textMuted}
                />
                <Text style={[S.checkLabel, { color: theme.text }]}>{check.label}</Text>
                <Text style={[S.checkValue, { color: check.ready ? theme.success : theme.textMuted }]}>{check.value}</Text>
              </View>
            ))}
          </View>

          <View style={[S.cashBox, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
            <View style={S.cashHeader}>
              <Text style={[S.cashTitle, { color: theme.text }]}>Kasa od klientow</Text>
              {teamDayLoading ? <ActivityIndicator size="small" color={theme.accent} /> : null}
            </View>
            {cashRows.length === 0 ? (
              <Text style={[S.emptyText, { color: theme.textMuted, padding: 4 }]}>Brak platnosci do rozliczenia.</Text>
            ) : (
              cashRows.map((row, idx) => (
                <View key={`${row.forma_platnosc ?? 'x'}-${idx}`} style={S.cashLine}>
                  <Text style={[S.cashForma, { color: theme.textSub }]}>
                    {row.forma_platnosc?.trim() || 'Inne'} ({row.cnt ?? 0})
                  </Text>
                  <Text style={[S.cashKwota, { color: theme.success }]}>{formatPln(row.sum_kwota)}</Text>
                </View>
              ))
            )}
            {cashRows.length > 0 ? (
              <View style={[S.cashLine, S.cashLineTotal]}>
                <Text style={[S.cashForma, { color: theme.text }]}>Razem</Text>
                <Text style={[S.cashKwota, { color: theme.text }]}>{formatPln(cashTotal)}</Text>
              </View>
            ) : null}
            <View style={S.reviewRow}>
              <TouchableOpacity
                style={[
                  S.reviewChip,
                  { borderColor: cashReady ? theme.success : theme.border, backgroundColor: cashReviewed ? theme.successBg : theme.cardBg },
                ]}
                onPress={() => setCashReviewed(v => !v)}
              >
                <Ionicons name={cashReady ? 'checkmark-circle' : 'cash-outline'} size={15} color={cashReady ? theme.success : theme.textMuted} />
                <Text style={[S.reviewChipText, { color: cashReady ? theme.success : theme.textSub }]}>Kasa sprawdzona</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  S.reviewChip,
                  { borderColor: issuesReady ? theme.success : theme.border, backgroundColor: issuesReviewed ? theme.successBg : theme.cardBg },
                ]}
                onPress={() => setIssuesReviewed(v => !v)}
              >
                <Ionicons name={issuesReady ? 'checkmark-circle' : 'warning-outline'} size={15} color={issuesReady ? theme.success : theme.warning} />
                <Text style={[S.reviewChipText, { color: issuesReady ? theme.success : theme.textSub }]}>Problemy sprawdzone</Text>
              </TouchableOpacity>
            </View>
          </View>

          {teamDayPack?.report ? (
            <Text style={[S.teamReportMeta, { color: theme.textMuted }]}>Raport placowy #{teamDayPack.report.id} jest zapisany.</Text>
          ) : null}

          <TouchableOpacity
            style={[
              S.closeDayBtn,
              { backgroundColor: theme.accent, opacity: teamDayBusy ? 0.65 : 1 },
            ]}
            onPress={() => void closeTeamDay()}
            disabled={teamDayBusy}
          >
            {teamDayBusy ? (
              <ActivityIndicator size="small" color={theme.accentText} />
            ) : (
              <Ionicons name="calculator-outline" size={17} color={theme.accentText} />
            )}
            <Text style={[S.closeDayBtnText, { color: theme.accentText }]}>
              {teamDayBusy ? 'Przeliczam...' : 'Przelicz raport ekipy'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.18,
      radius: t.shadowRadius * 0.46,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation),
    }),
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBox: { flex: 1, minWidth: 0 },
  headerEyebrow: { color: t.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  headerTitle: { color: t.text, fontSize: 19, lineHeight: 23, fontWeight: '900' },
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
  reportStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 2 },
  reportStat: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: t.cardBg,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  reportStatIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reportStatValue: { color: t.text, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  reportStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  section: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.14,
      radius: t.shadowRadius * 0.4,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation),
    }),
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '900', marginBottom: 12 },
  emptyText: { textAlign: 'center', padding: 16, fontSize: 14, fontWeight: '800' },
  teamCloseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  teamCloseTitleBox: { flex: 1, minWidth: 0 },
  teamCloseSub: { fontSize: 12, fontWeight: '700', marginTop: 5, lineHeight: 17 },
  teamScore: { minWidth: 72, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center' },
  teamScoreValue: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  teamScoreLabel: { fontSize: 10, fontWeight: '800', marginTop: 1 },
  checkList: { gap: 7, marginBottom: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, minHeight: 44 },
  checkLabel: { flex: 1, fontSize: 12, fontWeight: '800' },
  checkValue: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cashBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  cashHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cashTitle: { fontSize: 13, fontWeight: '900' },
  cashLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  cashLineTotal: { borderTopWidth: 1, borderTopColor: t.border, marginTop: 2, paddingTop: 8 },
  cashForma: { flex: 1, paddingRight: 10, fontSize: 12, fontWeight: '800' },
  cashKwota: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  reviewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  reviewChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  reviewChipText: { fontSize: 12, fontWeight: '900' },
  teamReportMeta: { fontSize: 12, fontWeight: '800', marginTop: 10 },
  closeDayBtn: { marginTop: 12, borderRadius: 10, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  closeDayBtnText: { fontSize: 14, fontWeight: '900' },
  zadanieCard: { borderRadius: 10, padding: 12, marginBottom: 10, minHeight: 118, borderLeftWidth: 4, borderWidth: 1, borderColor: t.border },
  zadanieKlient: { fontSize: 14, fontWeight: '900', marginBottom: 2 },
  zadanieAdres: { fontSize: 12, marginBottom: 8, fontWeight: '700' },
  zadanieRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  materialCard: { borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  materialHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  materialIdx: { fontSize: 13, fontWeight: '900' },
  materialRow: { flexDirection: 'row', marginTop: 8 },
  fieldLabel: { fontSize: 12, marginBottom: 4, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 10, padding: 11, fontSize: 14, marginTop: 4, fontWeight: '700', minHeight: 44 },
  inputSm: { borderWidth: 1, borderRadius: 10, padding: 9, fontSize: 13, fontWeight: '700', minHeight: 42 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, minHeight: 40, justifyContent: 'center' },
  addBtnText: { fontSize: 13, fontWeight: '900' },
  podpisPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, minHeight: 52 },
  podpisOk: { fontWeight: '600', fontSize: 14 },
  podpisZmien: { fontSize: 13, fontWeight: '600' },
  podpisBtn: { borderWidth: 1, borderRadius: 10, minHeight: 56, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  podpisBtnText: { fontSize: 15, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 10, margin: 12 },
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
