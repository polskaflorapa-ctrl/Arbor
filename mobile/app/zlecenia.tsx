import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { EmptyState, ErrorBanner } from '../components/ui/app-state';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { PlatinumFilterChip } from '../components/ui/platinum-filter-chip';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumPressable } from '../components/ui/platinum-pressable';
import { ScreenHeader } from '../components/ui/screen-header';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';
import { openAddressInMaps } from '../utils/maps-link';
import { TASK_STATUS, TASK_STATUS_FILTERS, isTaskClosed, makeTaskStatusColorMap, normalizeTaskStatus } from '../constants/task-workflow';

const FIELD_PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Wycena', icon: 'camera-outline' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline' },
] as const;
type OrderQuickMode = 'all' | 'today' | 'field' | 'officeReady' | 'needsPlan' | 'missingEvidence' | 'active';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type OfficeFlowStep = {
  key: string;
  label: string;
  hint: string;
  value: number;
  color: string;
  icon: IoniconName;
  mode: OrderQuickMode;
};

function taskNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isFieldDraftTask(task: any) {
  const notes = String(task?.notatki_wewnetrzne || task?.notatki || '');
  return normalizeTaskStatus(task?.status) === TASK_STATUS.WYCENA_TERENOWA ||
    task?.ankieta_uproszczona === true ||
    notes.includes('TRYB TERENOWY') ||
    notes.includes('PRZEKAZANIE DO BIURA') ||
    notes.includes('FORMULARZ WYCENY TERENOWEJ');
}

function isEstimatorRole(role: unknown) {
  return role === 'Wyceniający' || role === 'Wyceniajacy';
}

function hasTaskContact(task: any) {
  return Boolean(String(task?.klient_telefon || '').trim());
}

function hasTaskAddress(task: any) {
  return Boolean(String(task?.adres || task?.miasto || '').trim());
}

function isAssignedToEstimator(task: any, user: any) {
  if (!isEstimatorRole(user?.rola)) return true;
  if (task?.wyceniajacy_id == null || user?.id == null) return false;
  return String(task.wyceniajacy_id) === String(user.id);
}

function parseTaskDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function localDateKey(date: Date | null) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function taskDateKey(task: any) {
  return localDateKey(parseTaskDate(task?.data_planowana));
}

function taskSortValue(task: any) {
  const d = parseTaskDate(task?.data_planowana);
  return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
}

function formatTaskDay(value: unknown) {
  const d = parseTaskDate(value);
  if (!d) return 'Brak terminu';
  return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit' }).format(d);
}

function formatTaskTime(value: unknown) {
  const d = parseTaskDate(value);
  if (!d) return '--:--';
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(d);
}

function taskTimeLabel(task: any) {
  if (task?.godzina_rozpoczecia) return String(task.godzina_rozpoczecia).slice(0, 5);
  return formatTaskTime(task?.data_planowana);
}

function taskEvidenceReadyCount(task: any) {
  return FIELD_PHOTO_REQUIREMENTS.filter((item) => taskNumber(task?.[item.key]) > 0).length;
}

function taskPhotoTotal(task: any) {
  const total = taskNumber(task?.photo_total);
  return total > 0 ? total : taskEvidenceReadyCount(task);
}

function taskScopePreview(task: any) {
  const lines = String(task?.notatki_wewnetrzne || task?.notatki || task?.opis || task?.opis_pracy || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const scope = lines.find((line) => line.toLowerCase().startsWith('zakres'));
  return scope || task?.opis || task?.opis_pracy || task?.typ_uslugi || '';
}

function taskStatusIs(task: any, status: string) {
  return normalizeTaskStatus(task?.status) === status;
}

function taskHasAssignedCrew(task: any) {
  return Boolean(task?.ekipa_id || task?.ekipa_nazwa);
}

function taskHasPlannedSlot(task: any) {
  return Boolean(task?.data_planowana && (task?.godzina_rozpoczecia || task?.czas_planowany_godziny));
}

function taskEvidenceComplete(task: any) {
  return taskEvidenceReadyCount(task) === FIELD_PHOTO_REQUIREMENTS.length;
}

function taskReadyForOffice(task: any) {
  return isFieldDraftTask(task) && taskEvidenceComplete(task) && !isTaskClosed(task?.status);
}

function taskNeedsCrewPlan(task: any) {
  return taskReadyForOffice(task) && (!taskHasAssignedCrew(task) || !taskHasPlannedSlot(task));
}

function taskReadyForCrew(task: any) {
  return taskReadyForOffice(task) && taskHasAssignedCrew(task) && taskHasPlannedSlot(task);
}

function sortCrewTasks(a: any, b: any) {
  const statusPriority = (task: any) => {
    if (task?.status === TASK_STATUS.W_REALIZACJI) return 0;
    if (task?.status === TASK_STATUS.ZAPLANOWANE) return 1;
    if (isTaskClosed(task?.status)) return 4;
    return 2;
  };
  const byStatus = statusPriority(a) - statusPriority(b);
  if (byStatus !== 0) return byStatus;
  const byDate = taskSortValue(a) - taskSortValue(b);
  if (byDate !== 0) return byDate;
  return Number(a?.id || 0) - Number(b?.id || 0);
}

export default function ZleceniaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/zlecenia');
  const [user, setUser] = useState<any>(null);
  const [zlecenia, setZlecenia] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filtrStatus, setFiltrStatus] = useState('');
  const [quickMode, setQuickMode] = useState<OrderQuickMode>('all');
  const [error, setError] = useState<string | null>(null);

  const statusKolor = useMemo(() => makeTaskStatusColorMap(theme), [theme]);

  const statusLabel = useCallback(
    (code: string) => t(`zlecenia.status.${code || 'all'}`),
    [t],
  );

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const { token, user: parsedUser } = await getStoredSession();
      if (!token) { router.replace('/login'); return; }
      if (parsedUser) setUser(parsedUser);
      const rola = parsedUser?.rola;
      const endpoint = (rola === 'Pomocnik' || rola === 'Brygadzista')
        ? `${API_URL}/tasks/moje` : `${API_URL}/tasks/wszystkie`;
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = (Array.isArray(d) ? d : []).filter((task) => isAssignedToEstimator(task, parsedUser));
        setZlecenia(list);
        setFiltered(list);
      } else {
        setError(t('zlecenia.errorServer', { status: res.status, detail: d.error || '—' }));
      }
    } catch (e: any) {
      setError(t('zlecenia.errorConnection', { detail: e.message || '' }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void loadData();
    });
    return unsubscribe;
  }, [loadData]);

  useEffect(() => {
    let wynik = zlecenia;
    if (search) {
      wynik = wynik.filter(z =>
        z.klient_nazwa?.toLowerCase().includes(search.toLowerCase()) ||
        z.adres?.toLowerCase().includes(search.toLowerCase()) ||
        z.miasto?.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (quickMode === 'today') {
      const today = localDateKey(new Date());
      wynik = wynik.filter((z) => taskDateKey(z) === today);
    } else if (quickMode === 'field') {
      wynik = wynik.filter(isFieldDraftTask);
    } else if (quickMode === 'officeReady') {
      wynik = wynik.filter(taskReadyForOffice);
    } else if (quickMode === 'needsPlan') {
      wynik = wynik.filter(taskNeedsCrewPlan);
    } else if (quickMode === 'missingEvidence') {
      wynik = wynik.filter((z) => isFieldDraftTask(z) && taskEvidenceReadyCount(z) < FIELD_PHOTO_REQUIREMENTS.length);
    } else if (quickMode === 'active') {
      wynik = wynik.filter((z) => !isTaskClosed(z.status));
    }
    if (filtrStatus) wynik = wynik.filter(z => z.status === filtrStatus);
    setFiltered(wynik);
  }, [quickMode, search, filtrStatus, zlecenia]);

  const isBrygadzista = user?.rola === 'Brygadzista';
  const isPomocnik = user?.rola === 'Pomocnik';
  const isWyceniajacy = isEstimatorRole(user?.rola);
  const isCrew = isBrygadzista || isPomocnik;
  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const displayList = useMemo(() => {
    const list = [...filtered];
    return isCrew ? list.sort(sortCrewTasks) : list;
  }, [filtered, isCrew]);
  const crewPlan = useMemo(() => {
    const active = zlecenia
      .filter((z) => !isTaskClosed(z.status))
      .sort(sortCrewTasks);
    const today = active.filter((z) => taskDateKey(z) === todayKey);
    const inProgress = active.filter((z) => z.status === TASK_STATUS.W_REALIZACJI);
    const scheduledToday = today.filter((z) => z.status === TASK_STATUS.ZAPLANOWANE);
    const missingEvidenceToday = today.filter((z) => taskEvidenceReadyCount(z) < FIELD_PHOTO_REQUIREMENTS.length);
    const fieldSlotToday = today.filter(isFieldDraftTask);
    const todayHours = today.reduce((sum, z) => sum + taskNumber(z.czas_planowany_godziny), 0);
    const next = inProgress[0] || scheduledToday[0] || today[0] || active[0] || null;
    const routePreview = (today.length ? today : active).slice(0, 5);
    const nextPhotoReady = next ? taskEvidenceReadyCount(next) : 0;
    return {
      active,
      today,
      inProgressCount: inProgress.length,
      scheduledTodayCount: scheduledToday.length,
      missingEvidenceTodayCount: missingEvidenceToday.length,
      fieldSlotTodayCount: fieldSlotToday.length,
      todayHours,
      next,
      nextPhotoReady,
      routePreview,
    };
  }, [todayKey, zlecenia]);
  const orderSummary = useMemo(() => {
    const active = zlecenia.filter((z) => !isTaskClosed(z.status));
    const today = active.filter((z) => taskDateKey(z) === todayKey);
    const fieldDrafts = zlecenia.filter(isFieldDraftTask);
    const missingEvidence = fieldDrafts.filter((z) => taskEvidenceReadyCount(z) < FIELD_PHOTO_REQUIREMENTS.length);
    const officeReady = fieldDrafts.filter(taskReadyForOffice);
    const needsPlan = fieldDrafts.filter(taskNeedsCrewPlan);
    const readyForCrew = fieldDrafts.filter(taskReadyForCrew);
    return {
      active: active.length,
      today: today.length,
      fieldDrafts: fieldDrafts.length,
      missingEvidence: missingEvidence.length,
      officeReady: officeReady.length,
      needsPlan: needsPlan.length,
      readyForCrew: readyForCrew.length,
    };
  }, [todayKey, zlecenia]);
  const estimatorPlan = useMemo(() => {
    const fieldTasks = zlecenia
      .filter((task) => !isTaskClosed(task.status))
      .filter(isFieldDraftTask)
      .sort((a, b) => taskSortValue(a) - taskSortValue(b));
    const today = fieldTasks.filter((task) => taskDateKey(task) === todayKey);
    const openToday = today.filter((task) => normalizeTaskStatus(task.status) !== TASK_STATUS.DO_ZATWIERDZENIA);
    const next = openToday[0] || fieldTasks[0] || null;
    const missingContact = today.filter((task) => !hasTaskContact(task)).length;
    const missingAddress = today.filter((task) => !hasTaskAddress(task)).length;
    const readyForOffice = fieldTasks.filter(taskReadyForOffice).length;
    const missingEvidence = fieldTasks.filter((task) => taskEvidenceReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length).length;
    return {
      today,
      openToday,
      next,
      routePreview: (today.length ? today : fieldTasks).slice(0, 6),
      missingContact,
      missingAddress,
      readyForOffice,
      missingEvidence,
    };
  }, [todayKey, zlecenia]);
  const quickModeOptions: { key: OrderQuickMode; label: string; count: number; color: string; icon: IoniconName }[] = [
    { key: 'all', label: 'Wszystkie', count: zlecenia.length, color: theme.accent, icon: 'albums-outline' },
    { key: 'today', label: 'Dzisiaj', count: orderSummary.today, color: theme.info, icon: 'calendar-outline' },
    { key: 'active', label: 'Aktywne', count: orderSummary.active, color: theme.success, icon: 'pulse-outline' },
    { key: 'field', label: 'Teren', count: orderSummary.fieldDrafts, color: theme.accent, icon: 'leaf-outline' },
    { key: 'officeReady', label: 'Do biura', count: orderSummary.officeReady, color: theme.info, icon: 'file-tray-full-outline' },
    { key: 'needsPlan', label: 'Plan ekipy', count: orderSummary.needsPlan, color: orderSummary.needsPlan ? theme.warning : theme.success, icon: 'calendar-number-outline' },
    { key: 'missingEvidence', label: 'Braki foto', count: orderSummary.missingEvidence, color: orderSummary.missingEvidence ? theme.warning : theme.success, icon: 'camera-outline' },
  ];
  const officeFlow = useMemo(() => {
    const active = zlecenia.filter((z) => !isTaskClosed(z.status));
    const phone = active.filter((z) => taskStatusIs(z, TASK_STATUS.NOWE)).length;
    const field = active.filter((z) => taskStatusIs(z, TASK_STATUS.WYCENA_TERENOWA) || isFieldDraftTask(z)).length;
    const office = active.filter(taskReadyForOffice).length;
    const plan = active.filter(taskNeedsCrewPlan).length;
    const crew = active.filter(taskReadyForCrew).length;
    const stages: OfficeFlowStep[] = [
      { key: 'phone', label: 'Telefon', hint: 'nowe', value: phone, color: theme.success, icon: 'call-outline', mode: 'active' },
      { key: 'field', label: 'Teren', hint: 'wycena', value: field, color: theme.info, icon: 'camera-outline', mode: 'field' },
      { key: 'office', label: 'Biuro', hint: 'dowody OK', value: office, color: theme.accent, icon: 'file-tray-full-outline', mode: 'officeReady' },
      { key: 'plan', label: 'Plan', hint: 'ekipa/slot', value: plan, color: plan ? theme.warning : theme.success, icon: 'calendar-number-outline', mode: 'needsPlan' },
      { key: 'crew', label: 'Ekipa', hint: 'gotowe', value: crew, color: theme.success, icon: 'people-circle-outline', mode: 'today' },
    ];
    const nextMode: OrderQuickMode = orderSummary.needsPlan
      ? 'needsPlan'
      : orderSummary.officeReady
        ? 'officeReady'
        : orderSummary.missingEvidence
          ? 'missingEvidence'
          : 'active';
    const nextTitle = orderSummary.needsPlan
      ? 'Najpierw dobierz ekipę i godzinę'
      : orderSummary.officeReady
        ? 'Pakiety z terenu czekają w biurze'
        : orderSummary.missingEvidence
          ? 'Uzupełnij brakujące zdjęcia'
          : 'Brak krytycznego zatoru';
    const nextSub = orderSummary.needsPlan
      ? `${orderSummary.needsPlan} zleceń wymaga planu ekipy przed przekazaniem dalej.`
      : orderSummary.officeReady
        ? `${orderSummary.officeReady} pakietów ma komplet dowodów i może być opracowane.`
        : orderSummary.missingEvidence
          ? `${orderSummary.missingEvidence} zleceń z terenu nie ma pełnego pakietu foto.`
          : 'Lista jest uporządkowana. Możesz pracować po aktywnych zleceniach.';
    return { stages, nextMode, nextTitle, nextSub };
  }, [orderSummary.missingEvidence, orderSummary.needsPlan, orderSummary.officeReady, theme, zlecenia]);
  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;
  }

  if (loading) return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;

  return (
    <KeyboardSafeScreen style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />

      <ScreenHeader
        title={t('zlecenia.title')}
        right={
          !isBrygadzista && !isPomocnik ? (
            <PlatinumCTA
              label="+"
              style={S.headerAddBtn}
              onPress={() => {
                void triggerHaptic('light');
                router.push('/nowe-zlecenie');
              }}
            />
          ) : null
        }
      />
      <View style={S.ordersHero}>
        <View style={S.ordersHeroTop}>
          <View style={S.ordersHeroIcon}>
            <PlatinumIconBadge icon="leaf-outline" color={theme.accent} size={20} style={S.ordersHeroIconBadge} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.ordersHeroEyebrow}>ARBOR-OS OPERACJE</Text>
            <Text style={S.ordersHeroTitle}>{isCrew ? 'Plan pracy ekipy' : 'Centrum zleceń'}</Text>
            <Text style={S.ordersHeroSub}>
              {isCrew ? 'Trasa, dowody i statusy na dzisiaj.' : 'Zlecenia, wyceny terenowe i gotowość do biura.'}
            </Text>
          </View>
        </View>
        <View style={S.ordersHeroStats}>
          {[
            { label: 'Aktywne', value: orderSummary.active, color: theme.accent },
            { label: 'Dzisiaj', value: orderSummary.today, color: theme.info },
            { label: 'Z terenu', value: orderSummary.fieldDrafts, color: theme.success },
            { label: 'Braki foto', value: orderSummary.missingEvidence, color: orderSummary.missingEvidence ? theme.warning : theme.success },
          ].map((item) => (
            <View key={item.label} style={[S.ordersHeroStat, { borderColor: item.color + '44', backgroundColor: item.color + '12' }]}>
              <Text style={[S.ordersHeroStatValue, { color: item.color }]}>{item.value}</Text>
              <Text style={S.ordersHeroStatLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.modeScroll} contentContainerStyle={S.modeContent}>
        {quickModeOptions.map((mode) => {
          const active = quickMode === mode.key;
          return (
            <TouchableOpacity
              key={mode.key}
              style={[
                S.modeChip,
                {
                  backgroundColor: active ? mode.color + '18' : theme.surface2,
                  borderColor: active ? mode.color : theme.border,
                },
              ]}
              onPress={() => {
                setQuickMode(mode.key);
                void triggerHaptic('light');
              }}
            >
              <PlatinumIconBadge
                icon={mode.icon}
                color={active ? mode.color : theme.textMuted}
                size={9}
                style={S.modeIcon}
              />
              <Text style={[S.modeLabel, { color: active ? mode.color : theme.textSub }]}>{mode.label}</Text>
              <Text style={[S.modeCount, { color: active ? mode.color : theme.textMuted }]}>{mode.count}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {isWyceniajacy && !isCrew ? (
        <View style={S.estimatorTodayCard}>
          <View style={S.estimatorTodayHead}>
            <PlatinumIconBadge icon="navigate-circle-outline" color={theme.accent} size={18} style={S.estimatorTodayIcon} />
            <View style={{ flex: 1 }}>
              <Text style={S.estimatorTodayTitle}>Moje oględziny dzisiaj</Text>
              <Text style={S.estimatorTodaySub}>Telefon, mapa, zdjęcia i pakiet dla biura bez szukania po liście.</Text>
            </View>
            <TouchableOpacity
              style={S.estimatorTodayFilter}
              onPress={() => {
                setQuickMode('today');
                setFiltrStatus('');
                void triggerHaptic('light');
              }}
            >
              <Text style={S.estimatorTodayFilterText}>Dzisiaj</Text>
            </TouchableOpacity>
          </View>
          <View style={S.estimatorStatsGrid}>
            {[
              { key: 'today', label: 'Plan', value: estimatorPlan.today.length, color: theme.info },
              { key: 'left', label: 'Zostało', value: estimatorPlan.openToday.length, color: theme.accent },
              { key: 'photo', label: 'Braki foto', value: estimatorPlan.missingEvidence, color: estimatorPlan.missingEvidence ? theme.warning : theme.success },
              { key: 'office', label: 'Do biura', value: estimatorPlan.readyForOffice, color: theme.success },
            ].map((item) => (
              <View key={item.key} style={[S.estimatorStatTile, { borderColor: item.color + '55', backgroundColor: item.color + '13' }]}>
                <Text style={[S.estimatorStatValue, { color: item.color }]}>{item.value}</Text>
                <Text style={S.estimatorStatLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {estimatorPlan.next ? (
            <View style={S.estimatorNextCard}>
              <View style={S.estimatorNextTop}>
                <View style={[S.estimatorNextTime, { borderColor: theme.accent, backgroundColor: theme.accentLight }]}>
                  <Text style={[S.estimatorNextTimeText, { color: theme.accent }]}>{taskTimeLabel(estimatorPlan.next)}</Text>
                  <Text style={S.estimatorNextDateText}>{formatTaskDay(estimatorPlan.next.data_planowana)}</Text>
                </View>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => {
                    void triggerHaptic('light');
                    router.push(`/zlecenie/${estimatorPlan.next.id}`);
                  }}
                >
                  <Text style={S.estimatorNextLabel}>Następna wizyta</Text>
                  <Text style={S.estimatorNextClient} numberOfLines={1}>{estimatorPlan.next.klient_nazwa || `Zlecenie #${estimatorPlan.next.id}`}</Text>
                  <Text style={S.estimatorNextAddress} numberOfLines={1}>
                    {[estimatorPlan.next.adres, estimatorPlan.next.miasto].filter(Boolean).join(', ') || 'Brak adresu'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={S.estimatorEvidenceRow}>
                {FIELD_PHOTO_REQUIREMENTS.map((item) => {
                  const done = taskNumber(estimatorPlan.next?.[item.key]) > 0;
                  return (
                    <View key={item.key} style={[S.estimatorEvidencePill, { borderColor: done ? theme.success : theme.warning, backgroundColor: done ? theme.successBg : theme.warningBg }]}>
                      <PlatinumIconBadge icon={done ? 'checkmark-circle' : item.icon} color={done ? theme.success : theme.warning} size={8} style={S.estimatorEvidenceIcon} />
                      <Text style={[S.estimatorEvidenceText, { color: done ? theme.success : theme.warning }]}>{item.label}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={S.estimatorActionRow}>
                <TouchableOpacity
                  disabled={!hasTaskContact(estimatorPlan.next)}
                  style={[S.estimatorActionBtn, { opacity: hasTaskContact(estimatorPlan.next) ? 1 : 0.46 }]}
                  onPress={() => {
                    if (estimatorPlan.next?.klient_telefon) void Linking.openURL(`tel:${estimatorPlan.next.klient_telefon}`);
                  }}
                >
                  <Ionicons name="call-outline" size={15} color={theme.accent} />
                  <Text style={S.estimatorActionText}>Dzwoń</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={!hasTaskAddress(estimatorPlan.next)}
                  style={[S.estimatorActionBtn, { opacity: hasTaskAddress(estimatorPlan.next) ? 1 : 0.46 }]}
                  onPress={() => void openAddressInMaps(estimatorPlan.next?.adres || '', estimatorPlan.next?.miasto || '')}
                >
                  <Ionicons name="map-outline" size={15} color={theme.accent} />
                  <Text style={S.estimatorActionText}>Mapa</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.estimatorActionBtn, S.estimatorPrimaryAction]}
                  onPress={() => {
                    void triggerHaptic('light');
                    router.push(`/zlecenie/${estimatorPlan.next.id}?tab=zdjecia` as never);
                  }}
                >
                  <Ionicons name="camera-outline" size={15} color={theme.accentText} />
                  <Text style={S.estimatorPrimaryActionText}>Pakiet</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={S.estimatorEmptyBox}>
              <Ionicons name="checkmark-done-outline" size={17} color={theme.success} />
              <Text style={S.estimatorEmptyText}>Brak otwartych oględzin na dzisiaj.</Text>
            </View>
          )}
          {estimatorPlan.routePreview.length > 1 ? (
            <View style={S.estimatorRouteList}>
              {estimatorPlan.routePreview.map((task, index) => {
                const ready = taskEvidenceReadyCount(task) >= FIELD_PHOTO_REQUIREMENTS.length;
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[S.estimatorRouteRow, { borderColor: task.id === estimatorPlan.next?.id ? theme.accent : theme.border, backgroundColor: task.id === estimatorPlan.next?.id ? theme.accentLight : theme.surface2 }]}
                    onPress={() => {
                      void triggerHaptic('light');
                      router.push(`/zlecenie/${task.id}`);
                    }}
                  >
                    <View style={[S.estimatorRouteIndex, { borderColor: ready ? theme.success : theme.warning }]}>
                      <Text style={[S.estimatorRouteIndexText, { color: ready ? theme.success : theme.warning }]}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.estimatorRouteClient} numberOfLines={1}>{task.klient_nazwa || `Zlecenie #${task.id}`}</Text>
                      <Text style={S.estimatorRouteMeta} numberOfLines={1}>{taskTimeLabel(task)} - {[task.adres, task.miasto].filter(Boolean).join(', ') || 'Brak adresu'}</Text>
                    </View>
                    <Ionicons name={ready ? 'checkmark-circle' : 'camera-outline'} size={17} color={ready ? theme.success : theme.warning} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Wyszukiwarka */}
      <View style={S.searchRow}>
        <PlatinumIconBadge icon="search-outline" color={theme.textMuted} size={20} style={S.searchIconBadge} />
        <TextInput
          style={S.searchInput}
          placeholder={t('zlecenia.searchPlaceholder')}
          placeholderTextColor={theme.inputPlaceholder}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
            <TouchableOpacity onPress={() => { void triggerHaptic('light'); setSearch(''); }}>
            <PlatinumIconBadge icon="close-circle" color={theme.textMuted} size={20} style={S.clearIconBadge} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filtry */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={S.filtryScroll} contentContainerStyle={S.filtryContent}>
        {TASK_STATUS_FILTERS.map(s => (
          <PlatinumFilterChip
            key={s}
            style={S.filtrBtn}
            active={filtrStatus === s}
            color={theme.accent}
            label={statusLabel(s)}
            onPress={() => {
              void triggerHaptic('light');
              setFiltrStatus(s);
            }}
          />
        ))}
      </ScrollView>

      {/* Błąd */}
      {!isCrew ? (
        <View style={S.officeFlowCard}>
          <View style={S.officeFlowHead}>
            <View style={S.officeFlowIcon}>
              <Ionicons name="git-network-outline" size={18} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.officeFlowTitle}>Proces zlecenia</Text>
              <Text style={S.officeFlowSub}>Telefon - teren - biuro - plan ekipy - realizacja.</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.officeFlowStrip}>
            {officeFlow.stages.map((step) => {
              const active = quickMode === step.mode;
              return (
                <TouchableOpacity
                  key={step.key}
                  style={[
                    S.officeFlowStep,
                    {
                      borderColor: active ? step.color : theme.border,
                      backgroundColor: active ? step.color + '16' : theme.surface2,
                    },
                  ]}
                  onPress={() => {
                    setQuickMode(step.mode);
                    void triggerHaptic('light');
                  }}
                >
                  <View style={[S.officeFlowStepIcon, { borderColor: step.color + '55', backgroundColor: step.color + '14' }]}>
                    <Ionicons name={step.icon} size={15} color={step.color} />
                  </View>
                  <Text style={[S.officeFlowStepValue, { color: step.color }]}>{step.value}</Text>
                  <Text style={S.officeFlowStepLabel} numberOfLines={1}>{step.label}</Text>
                  <Text style={S.officeFlowStepHint} numberOfLines={1}>{step.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={S.officeNextBox}>
            <View style={{ flex: 1 }}>
              <Text style={S.officeNextTitle}>{officeFlow.nextTitle}</Text>
              <Text style={S.officeNextSub}>{officeFlow.nextSub}</Text>
            </View>
            <TouchableOpacity
              style={S.officeNextBtn}
              onPress={() => {
                setQuickMode(officeFlow.nextMode);
                void triggerHaptic('light');
              }}
            >
              <Text style={S.officeNextBtnText}>Pokaż</Text>
              <Ionicons name="chevron-forward" size={15} color={theme.accent} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      {isCrew ? (
        <View style={S.crewTodayCard}>
          <View style={S.crewTodayHead}>
            <PlatinumIconBadge icon="leaf-outline" color={theme.success} size={18} style={S.crewTodayIcon} />
            <View style={{ flex: 1 }}>
              <Text style={S.crewTodayTitle}>Praca ekipy dzisiaj</Text>
              <Text style={S.crewTodaySub}>
                Kolejka zleceń, dokumentacja i szybkie wejście w teren.
              </Text>
            </View>
          </View>
          <View style={S.crewStatsGrid}>
            {[
              { key: 'today', label: 'Dzisiaj', value: crewPlan.today.length, color: theme.accent },
              { key: 'work', label: 'W toku', value: crewPlan.inProgressCount, color: theme.warning },
              { key: 'hours', label: 'Godziny', value: crewPlan.todayHours ? crewPlan.todayHours.toFixed(1) : '0', color: theme.info },
              { key: 'field', label: 'Z terenu', value: crewPlan.fieldSlotTodayCount, color: theme.success },
              { key: 'photos', label: 'Braki foto', value: crewPlan.missingEvidenceTodayCount, color: crewPlan.missingEvidenceTodayCount ? theme.danger : theme.success },
            ].map((item) => (
              <View key={item.key} style={[S.crewStatTile, { borderColor: item.color + '55', backgroundColor: item.color + '14' }]}>
                <Text style={[S.crewStatValue, { color: item.color }]}>{item.value}</Text>
                <Text style={S.crewStatLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {crewPlan.next ? (
            <PlatinumPressable
              style={S.crewNextCard}
              onPress={() => {
                void triggerHaptic('light');
                router.push(`/zlecenie/${crewPlan.next.id}`);
              }}
            >
              <View style={S.crewNextTop}>
                <View style={[S.crewNextTime, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                  <Text style={[S.crewNextTimeText, { color: theme.accent }]}>{taskTimeLabel(crewPlan.next)}</Text>
                  <Text style={S.crewNextDayText}>{formatTaskDay(crewPlan.next.data_planowana)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={S.crewNextTitleRow}>
                    <Text style={S.crewNextLabel}>Następne zlecenie</Text>
                    <View style={[S.crewNextStatus, { backgroundColor: (statusKolor[crewPlan.next.status as keyof typeof statusKolor] || theme.textMuted) + '22' }]}>
                      <Text style={[S.crewNextStatusText, { color: statusKolor[crewPlan.next.status as keyof typeof statusKolor] || theme.textMuted }]}>
                        {statusLabel(crewPlan.next.status)}
                      </Text>
                    </View>
                  </View>
                  <Text style={S.crewNextClient} numberOfLines={1}>{crewPlan.next.klient_nazwa || `Zlecenie #${crewPlan.next.id}`}</Text>
                  <Text style={S.crewNextAddress} numberOfLines={1}>
                    {[crewPlan.next.adres, crewPlan.next.miasto].filter(Boolean).join(', ') || 'Brak adresu'}
                  </Text>
                </View>
              </View>
              <View style={S.crewNextBottom}>
                <View style={[S.crewDocPill, { borderColor: crewPlan.nextPhotoReady >= FIELD_PHOTO_REQUIREMENTS.length ? theme.success : theme.warning }]}>
                  <PlatinumIconBadge
                    icon={crewPlan.nextPhotoReady >= FIELD_PHOTO_REQUIREMENTS.length ? 'checkmark-circle' : 'camera-outline'}
                    color={crewPlan.nextPhotoReady >= FIELD_PHOTO_REQUIREMENTS.length ? theme.success : theme.warning}
                    size={9}
                    style={S.crewDocIcon}
                  />
                  <Text style={[S.crewDocText, { color: crewPlan.nextPhotoReady >= FIELD_PHOTO_REQUIREMENTS.length ? theme.success : theme.warning }]}>
                    Dowody {crewPlan.nextPhotoReady}/{FIELD_PHOTO_REQUIREMENTS.length}
                  </Text>
                </View>
                {crewPlan.next.czas_planowany_godziny ? (
                  <Text style={S.crewNextMeta}>{crewPlan.next.czas_planowany_godziny} h plan</Text>
                ) : null}
                <View style={S.crewOpenBtn}>
                  <Text style={S.crewOpenText}>Otwórz</Text>
                  <PlatinumIconBadge icon="chevron-forward" color={theme.accent} size={8} style={S.crewOpenIcon} />
                </View>
              </View>
            </PlatinumPressable>
          ) : (
            <View style={S.crewNoWork}>
              <PlatinumIconBadge icon="checkmark-done-outline" color={theme.success} size={16} style={S.crewNoWorkIcon} />
              <Text style={S.crewNoWorkText}>Brak aktywnych zleceń dla ekipy.</Text>
            </View>
          )}
          {crewPlan.routePreview.length > 0 ? (
            <View style={S.crewRoutePreview}>
              <View style={S.crewRoutePreviewHead}>
                <PlatinumIconBadge icon="git-branch-outline" color={theme.accent} size={10} style={S.crewRoutePreviewIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={S.crewRoutePreviewTitle}>{crewPlan.today.length ? 'Trasa dnia' : 'Najbliższa kolejka'}</Text>
                  <Text style={S.crewRoutePreviewSub}>Kolejność, godzina i komplet dowodów.</Text>
                </View>
              </View>
              <View style={S.crewRoutePreviewList}>
                {crewPlan.routePreview.map((task, index) => {
                  const ready = taskEvidenceReadyCount(task) >= FIELD_PHOTO_REQUIREMENTS.length;
                  const color = statusKolor[task.status as keyof typeof statusKolor] || theme.textMuted;
                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={[S.crewRoutePreviewRow, { borderColor: color + '45', backgroundColor: task.id === crewPlan.next?.id ? theme.accentLight : theme.cardBg }]}
                      onPress={() => {
                        void triggerHaptic('light');
                        router.push(`/zlecenie/${task.id}`);
                      }}
                    >
                      <View style={[S.crewRoutePreviewIndex, { borderColor: color, backgroundColor: color + '18' }]}>
                        <Text style={[S.crewRoutePreviewIndexText, { color }]}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.crewRoutePreviewClient} numberOfLines={1}>{task.klient_nazwa || `Zlecenie #${task.id}`}</Text>
                        <Text style={S.crewRoutePreviewMeta} numberOfLines={1}>
                          {taskTimeLabel(task)} - {[task.adres, task.miasto].filter(Boolean).join(', ') || 'Brak adresu'}
                        </Text>
                      </View>
                      <View style={[S.crewRoutePreviewPhoto, { borderColor: ready ? theme.success : theme.warning }]}>
                        <PlatinumIconBadge
                          icon={ready ? 'checkmark-circle' : 'camera-outline'}
                          color={ready ? theme.success : theme.warning}
                          size={8}
                          style={S.crewRoutePreviewPhotoIcon}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Licznik */}
      <View style={S.counterRow}>
        <Text style={S.counterText}>{t('zlecenia.count', { count: displayList.length })}</Text>
      </View>

      {/* Lista */}
      <ScrollView style={S.list} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={theme.accent} colors={[theme.accent]} />}>
        {displayList.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            iconColor={theme.textMuted}
            title={t('zlecenia.emptyTitle')}
            subtitle={search ? t('zlecenia.emptySubtitleSearch') : t('zlecenia.emptySubtitleNone')}
          />
        ) : displayList.map((z, i) => {
          const kolor = statusKolor[z.status as keyof typeof statusKolor] || theme.textMuted;
          const fieldDraft = isFieldDraftTask(z);
          const photoReadyCount = taskEvidenceReadyCount(z);
          const photoReady = photoReadyCount === FIELD_PHOTO_REQUIREMENTS.length;
          const photoTotal = taskPhotoTotal(z);
          const missingEvidenceItems = FIELD_PHOTO_REQUIREMENTS.filter((item) => taskNumber(z[item.key]) <= 0);
          const evidenceHint = photoReady
            ? 'Komplet: wycena, szkic i dojazd'
            : `Brakuje: ${missingEvidenceItems.map((item) => item.label).join(', ')}`;
          const handoffReady = taskReadyForCrew(z);
          const isNextCrewTask = isCrew && crewPlan.next?.id === z.id;
          const isTodayTask = taskDateKey(z) === todayKey;
          const scopePreview = taskScopePreview(z);
          return (
            <PlatinumAppear key={z.id} delayMs={20 * Math.min(i, 8)}>
              <PlatinumPressable style={[S.card, isNextCrewTask && { borderColor: theme.accent, backgroundColor: theme.accentLight }]}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(`/zlecenie/${z.id}`);
                }}>
                {isCrew ? (
                  <View style={[S.crewCardRail, { borderRightColor: kolor + '55', backgroundColor: isNextCrewTask ? theme.cardBg : theme.surface2 }]}>
                    <Text style={[S.crewCardRailIndex, { color: kolor }]}>{i + 1}</Text>
                    <View style={[S.crewCardRailDot, { backgroundColor: kolor }]} />
                    <Text style={S.crewCardRailTime}>{taskTimeLabel(z)}</Text>
                    {isTodayTask ? <Text style={S.crewCardRailToday}>dziś</Text> : null}
                  </View>
                ) : (
                  <View style={[S.cardStripe, { backgroundColor: kolor }]} />
                )}
                <View style={S.cardContent}>
                  <View style={S.cardTop}>
                    <Text style={S.cardId}>{isCrew ? (isNextCrewTask ? 'Następne' : `Punkt ${i + 1}`) : `#${z.id}`}</Text>
                    <View style={S.cardBadges}>
                      {isCrew && isTodayTask ? (
                        <View style={[S.routeBadge, { backgroundColor: theme.accentLight, borderColor: theme.accent + '66' }]}>
                          <Text style={[S.routeBadgeText, { color: theme.accent }]}>dzisiaj</Text>
                        </View>
                      ) : null}
                      {fieldDraft ? (
                        <View style={[S.fieldBadge, { backgroundColor: handoffReady ? theme.successBg : theme.warningBg, borderColor: handoffReady ? theme.success : theme.warning }]}>
                          <PlatinumIconBadge
                            icon={handoffReady ? 'checkmark-done-outline' : 'trail-sign-outline'}
                            color={handoffReady ? theme.success : theme.warning}
                            size={9}
                            style={S.fieldBadgeIcon}
                          />
                          <Text style={[S.fieldBadgeText, { color: handoffReady ? theme.success : theme.warning }]}>
                            {handoffReady ? 'teren gotowy' : 'draft teren'}
                          </Text>
                        </View>
                      ) : null}
                      <View style={[S.badge, { backgroundColor: kolor + '28' }]}>
                        <Text style={[S.badgeText, { color: kolor }]}>{statusLabel(z.status) || z.status}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={S.cardKlient}>{z.klient_nazwa}</Text>
                  <View style={S.metaRow}>
                    <PlatinumIconBadge icon="location-outline" color={theme.textSub} size={11} style={S.metaIconBadge} />
                    <Text style={S.metaText}> {z.adres}, {z.miasto}</Text>
                  </View>
                  <View style={S.cardBottom}>
                    {z.typ_uslugi ? <View style={S.typChip}><Text style={S.typText}>{z.typ_uslugi}</Text></View> : null}
                    {z.data_planowana ? (
                      <View style={S.metaRow}>
                        <PlatinumIconBadge icon="calendar-outline" color={theme.textMuted} size={10} style={S.metaIconBadge} />
                        <Text style={S.dateText}> {z.data_planowana.split('T')[0]}</Text>
                      </View>
                    ) : null}
                    {!isBrygadzista && !isPomocnik && z.wartosc_planowana ? (
                      <Text style={S.wartosc}>{parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN</Text>
                    ) : null}
                  </View>
                  {z.ekipa_nazwa ? (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="people-outline" color={theme.textMuted} size={10} style={S.metaIconBadge} />
                      <Text style={S.metaSmall}> {z.ekipa_nazwa}</Text>
                    </View>
                  ) : null}
                  {isCrew && scopePreview ? (
                    <View style={[S.crewScopePreview, { borderColor: theme.border, backgroundColor: theme.surface2 }]}>
                      <PlatinumIconBadge icon="list-outline" color={theme.accent} size={9} style={S.crewScopePreviewIcon} />
                      <Text style={S.crewScopePreviewText} numberOfLines={2}>{scopePreview}</Text>
                    </View>
                  ) : null}
                  {fieldDraft ? (
                    <View style={[S.fieldMiniPanel, { borderColor: photoReady ? theme.success + '55' : theme.warning + '55', backgroundColor: photoReady ? theme.successBg : theme.warningBg }]}>
                      <View style={S.fieldMiniTop}>
                        <PlatinumIconBadge
                          icon="shield-checkmark-outline"
                          color={photoReady ? theme.success : theme.warning}
                          size={10}
                          style={S.fieldMiniIcon}
                        />
                        <Text style={[S.fieldMiniTitle, { color: photoReady ? theme.success : theme.warning }]}>
                          Odprawa: {photoReadyCount}/{FIELD_PHOTO_REQUIREMENTS.length} dowody
                        </Text>
                        <Text style={S.fieldMiniTotal}>{photoTotal} zdj.</Text>
                      </View>
                      <View style={S.fieldMiniChecks}>
                        {FIELD_PHOTO_REQUIREMENTS.map((item) => {
                          const done = taskNumber(z[item.key]) > 0;
                          return (
                            <View key={item.key} style={[S.fieldMiniCheck, { borderColor: done ? theme.success : theme.warning }]}>
                              <PlatinumIconBadge
                                icon={done ? 'checkmark-circle' : item.icon}
                                color={done ? theme.success : theme.warning}
                                size={8}
                                style={S.fieldMiniCheckIcon}
                              />
                              <Text style={[S.fieldMiniCheckText, { color: done ? theme.success : theme.warning }]}>{item.label}</Text>
                            </View>
                          );
                        })}
                      </View>
                      <View style={S.fieldMiniFooter}>
                        <Text style={[S.fieldMiniHint, { color: photoReady ? theme.success : theme.warning }]} numberOfLines={1}>
                          {evidenceHint}
                        </Text>
                        <TouchableOpacity
                          style={[S.fieldMiniOpenBtn, { borderColor: photoReady ? theme.success + '55' : theme.warning + '55', backgroundColor: theme.cardBg }]}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            router.push(`/zlecenie/${z.id}?tab=zdjecia` as never);
                          }}
                        >
                          <Text style={[S.fieldMiniOpenText, { color: photoReady ? theme.success : theme.warning }]}>Media</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                  {isCrew ? (
                    <View style={S.crewCardActions}>
                      <TouchableOpacity
                        style={[S.crewCardActionBtn, { borderColor: theme.accent + '55', backgroundColor: theme.cardBg }]}
                        onPress={(event) => {
                          event.stopPropagation();
                          void triggerHaptic('light');
                          router.push(`/zlecenie/${z.id}`);
                        }}
                      >
                        <PlatinumIconBadge icon="open-outline" color={theme.accent} size={8} style={S.crewCardActionIcon} />
                        <Text style={[S.crewCardActionText, { color: theme.accent }]}>Praca</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.crewCardActionBtn, { borderColor: photoReady ? theme.success + '55' : theme.warning + '55', backgroundColor: theme.cardBg }]}
                        onPress={(event) => {
                          event.stopPropagation();
                          void triggerHaptic('light');
                          router.push(`/zlecenie/${z.id}?tab=zdjecia` as never);
                        }}
                      >
                        <PlatinumIconBadge
                          icon={photoReady ? 'checkmark-circle' : 'camera-outline'}
                          color={photoReady ? theme.success : theme.warning}
                          size={8}
                          style={S.crewCardActionIcon}
                        />
                        <Text style={[S.crewCardActionText, { color: photoReady ? theme.success : theme.warning }]}>
                          Dowody {photoReadyCount}/{FIELD_PHOTO_REQUIREMENTS.length}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={9} style={S.chevronBadge} />
              </PlatinumPressable>
            </PlatinumAppear>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  headerAddBtn: {
    minWidth: 42,
    minHeight: 40,
    paddingHorizontal: 0,
    borderRadius: 12,
  },
  platinumBar: {
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2 + 'EE',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.16,
      radius: t.shadowRadius * 0.36,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  platinumBarIcon: { width: 24, height: 24, borderRadius: 8 },
  platinumBarText: {
    color: t.textSub,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  ordersHero: {
    marginHorizontal: 14,
    marginTop: 12,
    borderRadius: t.radiusXl,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 15,
    gap: 13,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity,
      radius: t.shadowRadius,
      offsetY: t.shadowOffsetY,
      elevation: t.cardElevation,
    }),
  },
  ordersHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  ordersHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ordersHeroIconBadge: { width: 34, height: 34, borderRadius: 11 },
  ordersHeroEyebrow: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  ordersHeroTitle: { color: t.text, fontSize: 20, fontWeight: '900', marginTop: 2 },
  ordersHeroSub: { color: t.textSub, fontSize: 12, fontWeight: '700', marginTop: 3, lineHeight: 17 },
  ordersHeroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ordersHeroStat: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  ordersHeroStatValue: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  ordersHeroStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 },
  modeScroll: { marginTop: 9 },
  modeContent: { paddingHorizontal: 14, paddingVertical: 4, gap: 8, flexDirection: 'row' },
  modeChip: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeIcon: { width: 20, height: 20, borderRadius: 7 },
  modeLabel: { fontSize: 11.5, fontWeight: '900' },
  modeCount: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeFlowCard: {
    marginHorizontal: 14,
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 12,
    gap: 11,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.12,
      radius: t.shadowRadius * 0.38,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  officeFlowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  officeFlowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeFlowTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  officeFlowSub: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  officeFlowStrip: { gap: 8, paddingRight: 4 },
  officeFlowStep: {
    minWidth: 104,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 9,
    gap: 2,
  },
  officeFlowStepIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  officeFlowStepValue: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeFlowStepLabel: { color: t.text, fontSize: 12, fontWeight: '900' },
  officeFlowStepHint: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  officeNextBox: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.accentLight,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  officeNextTitle: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  officeNextSub: { color: t.textSub, fontSize: 11, lineHeight: 15, marginTop: 2 },
  officeNextBtn: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.cardBg,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  officeNextBtnText: { color: t.accent, fontSize: 11, fontWeight: '900' },
  estimatorTodayCard: {
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 12,
    gap: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.12,
      radius: t.shadowRadius * 0.38,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  estimatorTodayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  estimatorTodayIcon: { width: 38, height: 38, borderRadius: 12 },
  estimatorTodayTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  estimatorTodaySub: { color: t.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  estimatorTodayFilter: {
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  estimatorTodayFilterText: { color: t.accent, fontSize: 11, fontWeight: '900' },
  estimatorStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  estimatorStatTile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 70,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  estimatorStatValue: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  estimatorStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  estimatorNextCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    padding: 11,
    gap: 10,
  },
  estimatorNextTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  estimatorNextTime: {
    width: 62,
    minHeight: 54,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  estimatorNextTimeText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  estimatorNextDateText: { color: t.textMuted, fontSize: 10, fontWeight: '800', marginTop: 2 },
  estimatorNextLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  estimatorNextClient: { color: t.text, fontSize: 14, fontWeight: '900', marginTop: 2 },
  estimatorNextAddress: { color: t.textSub, fontSize: 12, marginTop: 2 },
  estimatorEvidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  estimatorEvidencePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  estimatorEvidenceIcon: { width: 16, height: 16, borderRadius: 6 },
  estimatorEvidenceText: { fontSize: 11, fontWeight: '900' },
  estimatorActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  estimatorActionBtn: {
    flexGrow: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.cardBg,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  estimatorActionText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  estimatorPrimaryAction: {
    borderColor: t.accent,
    backgroundColor: t.accent,
  },
  estimatorPrimaryActionText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  estimatorEmptyBox: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.success,
    backgroundColor: t.successBg,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  estimatorEmptyText: { color: t.success, fontSize: 12, fontWeight: '900' },
  estimatorRouteList: { gap: 7 },
  estimatorRouteRow: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  estimatorRouteIndex: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.cardBg,
  },
  estimatorRouteIndexText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  estimatorRouteClient: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  estimatorRouteMeta: { color: t.textMuted, fontSize: 10.5, marginTop: 1 },
  crewTodayCard: {
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 12,
    gap: 11,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.12,
      radius: t.shadowRadius * 0.38,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  crewTodayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  crewTodayIcon: { width: 38, height: 38, borderRadius: 12 },
  crewTodayTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  crewTodaySub: { color: t.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  crewStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  crewStatTile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 70,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  crewStatValue: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  crewNextCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    padding: 11,
    gap: 10,
  },
  crewNextTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  crewNextTime: {
    width: 62,
    minHeight: 54,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  crewNextTimeText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewNextDayText: { color: t.textMuted, fontSize: 10, fontWeight: '800', marginTop: 2 },
  crewNextTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  crewNextLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', flex: 1 },
  crewNextStatus: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  crewNextStatusText: { fontSize: 10, fontWeight: '900' },
  crewNextClient: { color: t.text, fontSize: 14, fontWeight: '900' },
  crewNextAddress: { color: t.textSub, fontSize: 12, marginTop: 2 },
  crewNextBottom: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  crewDocPill: {
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: t.cardBg,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  crewDocIcon: { width: 16, height: 16, borderRadius: 6 },
  crewDocText: { fontSize: 11, fontWeight: '900' },
  crewNextMeta: { color: t.textMuted, fontSize: 11, fontWeight: '800' },
  crewOpenBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  crewOpenText: { color: t.accent, fontSize: 11, fontWeight: '900' },
  crewOpenIcon: { width: 16, height: 16, borderRadius: 6 },
  crewNoWork: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.success,
    backgroundColor: t.successBg,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crewNoWorkIcon: { width: 30, height: 30, borderRadius: 10 },
  crewNoWorkText: { color: t.success, fontSize: 12, fontWeight: '900' },
  crewRoutePreview: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    padding: 10,
    gap: 8,
  },
  crewRoutePreviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crewRoutePreviewIcon: { width: 24, height: 24, borderRadius: 8 },
  crewRoutePreviewTitle: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  crewRoutePreviewSub: { color: t.textMuted, fontSize: 10.5, marginTop: 1 },
  crewRoutePreviewList: { gap: 7 },
  crewRoutePreviewRow: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  crewRoutePreviewIndex: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewRoutePreviewIndexText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewRoutePreviewClient: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  crewRoutePreviewMeta: { color: t.textMuted, fontSize: 10.5, marginTop: 1 },
  crewRoutePreviewPhoto: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.cardBg,
  },
  crewRoutePreviewPhotoIcon: { width: 15, height: 15, borderRadius: 5 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surface2,
    marginHorizontal: 14,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
    paddingHorizontal: 12, paddingVertical: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.08,
      radius: t.shadowRadius * 0.24,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  searchIconBadge: { width: 28, height: 28, borderRadius: 9, marginRight: 8 },
  clearIconBadge: { width: 28, height: 28, borderRadius: 9 },
  searchInput: { flex: 1, fontSize: 15, color: t.inputText, height: 40 },
  filtryScroll: { backgroundColor: 'transparent', marginTop: 8 },
  filtryContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  filtrBtn: {},
  counterRow: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  counterText: { fontSize: 12, color: t.textMuted, fontWeight: '600' },
  list: { flex: 1, paddingHorizontal: 14, paddingTop: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 13, color: t.textMuted },
  card: {
    flexDirection: 'row', backgroundColor: t.cardBg,
    borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden',
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.1,
      radius: t.shadowRadius * 0.36,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  cardStripe: { width: 4 },
  crewCardRail: {
    width: 58,
    borderRightWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  crewCardRailIndex: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewCardRailDot: { width: 10, height: 10, borderRadius: 5 },
  crewCardRailTime: { color: t.text, fontSize: 11.5, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewCardRailToday: { color: t.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  cardContent: { flex: 1, padding: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 7 },
  cardId: { fontSize: 11.5, color: t.textMuted, fontWeight: '900' },
  cardBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10.5, fontWeight: '900' },
  routeBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  routeBadgeText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  fieldBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fieldBadgeIcon: { width: 16, height: 16, borderRadius: 6 },
  fieldBadgeText: { fontSize: 10, fontWeight: '800' },
  cardKlient: { fontSize: 16, fontWeight: '900', color: t.text, marginBottom: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  metaIconBadge: { width: 20, height: 20, borderRadius: 7 },
  metaText: { fontSize: 12, color: t.textSub, flex: 1 },
  metaSmall: { fontSize: 11, color: t.textMuted },
  cardBottom: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 },
  typChip: { backgroundColor: t.surface2, borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingHorizontal: 8, paddingVertical: 4 },
  typText: { fontSize: 11, color: t.textSub, fontWeight: '800' },
  dateText: { fontSize: 11, color: t.textMuted },
  wartosc: { fontSize: 12, color: t.accent, fontWeight: '700' },
  crewScopePreview: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  crewScopePreviewIcon: { width: 18, height: 18, borderRadius: 6 },
  crewScopePreviewText: { flex: 1, color: t.textSub, fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  fieldMiniPanel: {
    marginTop: 9,
    borderWidth: 1,
    borderRadius: 10,
    padding: 9,
    gap: 7,
  },
  fieldMiniTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldMiniIcon: { width: 18, height: 18, borderRadius: 6 },
  fieldMiniTitle: { flex: 1, fontSize: 11, fontWeight: '900' },
  fieldMiniTotal: { fontSize: 10, color: t.textMuted, fontWeight: '800', fontVariant: ['tabular-nums'] },
  fieldMiniChecks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldMiniCheck: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: t.cardBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fieldMiniCheckIcon: { width: 14, height: 14, borderRadius: 5 },
  fieldMiniCheckText: { fontSize: 10, fontWeight: '800' },
  fieldMiniFooter: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldMiniHint: { flex: 1, fontSize: 10.5, fontWeight: '900' },
  fieldMiniOpenBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fieldMiniOpenText: { fontSize: 10, fontWeight: '900' },
  crewCardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },
  crewCardActionBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  crewCardActionIcon: { width: 15, height: 15, borderRadius: 5 },
  crewCardActionText: { fontSize: 10.5, fontWeight: '900' },
  chevronBadge: { width: 22, height: 22, borderRadius: 8, alignSelf: 'center', marginRight: 6 },
});
