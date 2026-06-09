import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { TASK_STATUS, isTaskClosed, isTaskDone, isTaskInProgress, normalizeTaskStatus } from '../constants/task-workflow';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { openAddressInMaps, openRouteInMaps } from '../utils/maps-link';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { getOfflineQueueSize } from '../utils/offline-queue';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';
import { getTaskFieldExecutionSummary } from '../utils/task-field-execution';
import { formatTaskListCacheNotice, loadTodayTaskListCache, saveTaskListCache } from '../utils/task-list-cache';

import { AppStatusBar } from '../components/ui/app-status-bar';
type TaskItem = {
  id: number;
  klient_nazwa?: string;
  adres?: string;
  miasto?: string;
  status?: string;
  priorytet?: string;
  data_planowana?: string;
  godzina_rozpoczecia?: string;
  klient_telefon?: string;
  opis?: string;
  opis_pracy?: string;
  notatki?: string;
  notatki_wewnetrzne?: string;
  czas_planowany_godziny?: string | number;
  wartosc_planowana?: string | number;
  budzet?: string | number;
  wartosc_zaproponowana?: string | number;
  wartosc_szacowana?: string | number;
  photo_total?: string | number;
  photo_wycena?: string | number;
  photo_szkic?: string | number;
  photo_dojazd?: string | number;
  wyceniajacy_id?: string | number | null;
  wyceniajacy_nazwa?: string | null;
  ogledziny_id?: string | number | null;
  ankieta_uproszczona?: boolean;
  workflow_missing_labels?: unknown[];
  workflow_ready_for_next?: boolean;
  problem_open?: string | number;
  issues_open?: string | number;
  unresolved_issues_count?: string | number;
  open_problems_count?: string | number;
  problemy_otwarte?: string | number;
  active_work_count?: string | number;
  last_checkin_at?: string | null;
  active_work_started_at?: string | null;
  last_work_finished_at?: string | null;
  problemy?: unknown[];
  issues?: unknown[];
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const localDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isToday = (isoLike?: string) => {
  if (!isoLike) return false;
  const d = new Date(isoLike);
  const normalized = Number.isNaN(d.getTime()) ? isoLike.split('T')[0] : localDateKey(d);
  return normalized === localDateKey(new Date());
};

const formatHour = (hour?: string) => (hour ? hour.slice(0, 5) : '--:--');

const taskNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const parseTaskDate = (value?: string) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const taskSortValue = (task: TaskItem) => {
  const dateValue = parseTaskDate(task.data_planowana)?.getTime();
  if (dateValue) return dateValue;
  const [hRaw, mRaw] = String(task.godzina_rozpoczecia || '').split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return Number.MAX_SAFE_INTEGER;
};

const taskAddressLabel = (task?: TaskItem | null) => {
  if (!task) return '';
  return [task.adres, task.miasto].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
};

const taskEvidenceCount = (task: TaskItem) => {
  const total = taskNumber(task.photo_total);
  if (total > 0) return total;
  return taskNumber(task.photo_wycena) + taskNumber(task.photo_szkic) + taskNumber(task.photo_dojazd);
};

function taskOpenProblemCount(task?: TaskItem | null) {
  const direct = taskNumber(
    task?.problem_open ??
    task?.issues_open ??
    task?.unresolved_issues_count ??
    task?.open_problems_count ??
    task?.problemy_otwarte,
  );
  if (direct > 0) return direct;
  const rows = Array.isArray(task?.problemy)
    ? task.problemy
    : Array.isArray(task?.issues)
      ? task.issues
      : [];
  return rows.filter((row) => {
    const item = row as { status?: unknown; state?: unknown };
    const status = String(item?.status || item?.state || '').toLowerCase();
    return !status || !status.includes('rozw') && !status.includes('closed') && !status.includes('done');
  }).length;
}

function taskNeedsFieldSignal(task: TaskItem) {
  if (isTaskClosed(task.status)) return false;
  const status = normalizeTaskStatus(task.status);
  const fieldExecution = getTaskFieldExecutionSummary(task);
  const crewStage = status === TASK_STATUS.ZAPLANOWANE || status === TASK_STATUS.W_REALIZACJI;
  const fieldStage = status === TASK_STATUS.WYCENA_TERENOWA || status === TASK_STATUS.DO_ZATWIERDZENIA || isFieldTask(task);
  const missingCheckin = fieldExecution.key === 'missing';
  const missingPhotos = fieldExecution.relevant &&
    fieldExecution.missingPhotoLabels.length > 0 &&
    (crewStage || fieldStage);
  return missingCheckin || missingPhotos || taskOpenProblemCount(task) > 0;
}

function taskFieldSignalBreakdown(items: TaskItem[]) {
  const signalRows = items
    .map((task) => ({
      task,
      field: getTaskFieldExecutionSummary(task),
      problems: taskOpenProblemCount(task),
    }))
    .filter((row) => taskNeedsFieldSignal(row.task))
    .sort((a, b) => {
      const priority = (row: typeof a) => {
        if (row.problems > 0) return 0;
        if (row.field.key === 'missing') return 1;
        if (row.field.missingPhotoLabels.length > 0) return 2;
        return 3;
      };
      const byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
      const byDate = taskSortValue(a.task) - taskSortValue(b.task);
      if (byDate !== 0) return byDate;
      return Number(a.task.id || 0) - Number(b.task.id || 0);
    });
  return {
    signalRows,
    signalCount: signalRows.length,
    signalCheckin: signalRows.filter((row) => row.field.key === 'missing').length,
    signalPhotos: signalRows.filter((row) => row.field.relevant && row.field.missingPhotoLabels.length > 0).length,
    signalProblems: signalRows.reduce((sum, row) => sum + row.problems, 0),
    signalNext: signalRows[0] || null,
  };
}

const taskBriefText = (task?: TaskItem | null) => String(
  task?.opis_pracy || task?.opis || task?.notatki_wewnetrzne || task?.notatki || '',
).trim();

const taskWorkflowMissingLabels = (task?: TaskItem | null) => (
  Array.isArray(task?.workflow_missing_labels) ? task.workflow_missing_labels : []
)
  .map((label) => String(label || '').trim())
  .filter(Boolean);

const isFieldTask = (task: TaskItem) => {
  const notes = String([task.notatki_wewnetrzne, task.notatki, task.opis, task.opis_pracy].filter(Boolean).join('\n'));
  return normalizeTaskStatus(task.status) === TASK_STATUS.WYCENA_TERENOWA ||
    task.ankieta_uproszczona === true ||
    notes.includes('TRYB TERENOWY') ||
    notes.includes('PRZEKAZANIE DO BIURA') ||
    notes.includes('FORMULARZ WYCENY TERENOWEJ') ||
    notes.includes('FORMULARZ OGL');
};

const taskAssignedToEstimator = (task: TaskItem, userId: string) => {
  if (!userId || task.wyceniajacy_id == null) return true;
  return String(task.wyceniajacy_id) === userId;
};

const taskMoneyValue = (task: TaskItem) => taskNumber(
  task.wartosc_planowana ?? task.budzet ?? task.wartosc_zaproponowana ?? task.wartosc_szacowana,
);

const taskTimeValue = (task: TaskItem) => taskNumber(task.czas_planowany_godziny);

const taskFieldPackageChecks = (task?: TaskItem | null) => {
  if (!task) return [];
  const evidenceCount = Math.max(
    taskEvidenceCount(task),
    taskNumber(task.photo_wycena) + taskNumber(task.photo_szkic) + taskNumber(task.photo_dojazd),
  );
  const money = taskMoneyValue(task);
  const hours = taskTimeValue(task);
  const missing = taskWorkflowMissingLabels(task);
  return [
    {
      key: 'contact',
      label: 'Telefon klienta',
      value: task.klient_telefon ? 'OK' : 'brak',
      done: Boolean(task.klient_telefon),
      icon: 'call-outline' as IoniconName,
    },
    {
      key: 'address',
      label: 'Adres ogledzin',
      value: taskAddressLabel(task) ? 'OK' : 'brak',
      done: Boolean(taskAddressLabel(task)),
      icon: 'location-outline' as IoniconName,
    },
    {
      key: 'evidence',
      label: 'Zdjecia i szkic',
      value: `${Math.min(evidenceCount, 3)}/3`,
      done: evidenceCount >= 3,
      icon: 'images-outline' as IoniconName,
    },
    {
      key: 'scope',
      label: 'Zakres prac',
      value: taskBriefText(task) ? 'OK' : 'brak',
      done: Boolean(taskBriefText(task)),
      icon: 'list-outline' as IoniconName,
    },
    {
      key: 'money',
      label: 'Cena / budzet',
      value: money > 0 ? `${money.toLocaleString('pl-PL')} PLN` : 'brak',
      done: money > 0,
      icon: 'cash-outline' as IoniconName,
    },
    {
      key: 'time',
      label: 'Czas pracy',
      value: hours > 0 ? `${hours}h` : 'brak',
      done: hours > 0,
      icon: 'time-outline' as IoniconName,
    },
    ...missing.slice(0, 2).map((label, index) => ({
      key: `api-${index}`,
      label,
      value: 'brak',
      done: false,
      icon: 'warning-outline' as IoniconName,
    })),
  ];
};

const taskFieldPackageReady = (task: TaskItem) => {
  if (normalizeTaskStatus(task.status) === TASK_STATUS.DO_ZATWIERDZENIA) return true;
  if (typeof task.workflow_ready_for_next === 'boolean') return task.workflow_ready_for_next;
  const checks = taskFieldPackageChecks(task);
  return checks.length > 0 && checks.every((check) => check.done);
};

const estimatorDocumentationRoute = (task: TaskItem) => {
  if (task.ogledziny_id) {
    const params = [
      `ogledzinyId=${encodeURIComponent(String(task.ogledziny_id))}`,
      `wycenaId=${encodeURIComponent(String(task.id))}`,
      task.klient_nazwa ? `klient=${encodeURIComponent(task.klient_nazwa)}` : '',
    ].filter(Boolean).join('&');
    return `/ogledziny-dokumentacja?${params}`;
  }
  return `/zlecenie/${task.id}?tab=zdjecia&photoFilter=wycena`;
};

const taskPlannedMinutes = (task: TaskItem) => {
  const hours = Number(String(task.czas_planowany_godziny || '').replace(',', '.'));
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  return isTaskInProgress(task.status) ? 75 : 95;
};

const isCrewRole = (role: string) => {
  const value = role.toLowerCase();
  return value === 'brygadzista' || value === 'pomocnik' || value.includes('pomocnik bez');
};

const normalizedRole = (role: string) => role.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const isEstimatorRole = (role: string) => normalizedRole(role).includes('wyceniaj');

const canCloseTeamDayReport = (role: string) => {
  const value = role.toLowerCase();
  return value === 'brygadzista' || value === 'pomocnik';
};

const formatPln = (v: string | number | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} zł`;
};

const formatDuration = (
  minutes: number,
  tf: (key: string, vars?: Record<string, string | number>) => string,
) => {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h <= 0) return tf('misja.time.min', { m });
  if (m === 0) return tf('misja.time.h', { h });
  return tf('misja.time.hm', { h, m });
};

export default function MisjaDniaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/misja-dnia');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [userRole, setUserRole] = useState('');
  const [userId, setUserId] = useState('');
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [cacheNotice, setCacheNotice] = useState('');
  type DayPreview = {
    cash_by_forma: { forma_platnosc?: string | null; sum_kwota?: string | number; cnt?: number }[];
    issues_count?: number;
  };
  const [teamDayPack, setTeamDayPack] = useState<{
    report: { id: number } | null;
    lines: unknown[];
    day_preview: DayPreview | null;
  } | null>(null);
  const [teamDayLoading, setTeamDayLoading] = useState(false);
  const [teamDayBusy, setTeamDayBusy] = useState(false);

  const refreshOfflineQueueCount = useCallback(async () => {
    const count = await getOfflineQueueSize().catch(() => 0);
    setOfflineQueueCount(count);
  }, []);

  const fetchTeamDayReport = useCallback(async (explicitRole?: string) => {
    const role = explicitRole ?? userRole;
    if (!canCloseTeamDayReport(role)) return;
    const { token } = await getStoredSession();
    if (!token) return;
    const date = new Date().toISOString().split('T')[0];
    setTeamDayLoading(true);
    try {
      const res = await fetch(`${API_URL}/mobile/me/team-day-report?date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const preview = data.day_preview && typeof data.day_preview === 'object'
          ? {
              cash_by_forma: Array.isArray(data.day_preview.cash_by_forma) ? data.day_preview.cash_by_forma : [],
              issues_count: Number(data.day_preview.issues_count) || 0,
            }
          : null;
        setTeamDayPack({
          report: data.report ?? null,
          lines: Array.isArray(data.lines) ? data.lines : [],
          day_preview: preview,
        });
      } else {
        setTeamDayPack(null);
      }
    } catch {
      setTeamDayPack(null);
    } finally {
      setTeamDayLoading(false);
    }
  }, [userRole]);

  const loadData = useCallback(async () => {
    try {
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      const ur = user.rola ?? '';
      setUserRole(ur);
      setUserId(String(user.id || ''));
      const endpoint = isCrewRole(ur)
        ? `${API_URL}/tasks/moje`
        : `${API_URL}/tasks/wszystkie`;
      try {
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          setTasks(list);
          setCacheNotice('');
          await saveTaskListCache({ endpoint, user, tasks: list }).catch(() => undefined);
        } else {
          const cached = await loadTodayTaskListCache({ endpoint, user }).catch(() => null);
          if (cached) {
            setTasks(cached.tasks as TaskItem[]);
            setCacheNotice(formatTaskListCacheNotice('Pokazuje plan dnia z cache', cached));
          }
        }
      } catch {
        const cached = await loadTodayTaskListCache({ endpoint, user }).catch(() => null);
        if (cached) {
          setTasks(cached.tasks as TaskItem[]);
          setCacheNotice(formatTaskListCacheNotice('Brak sieci. Pokazuje plan dnia z cache', cached));
        }
      }
      if (canCloseTeamDayReport(ur)) {
        await fetchTeamDayReport(ur);
      } else {
        setTeamDayPack(null);
      }
    } finally {
      await refreshOfflineQueueCount();
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchTeamDayReport, refreshOfflineQueueCount]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      void refreshOfflineQueueCount();
      if (d.flushed > 0) void loadData();
    });
    return unsubscribe;
  }, [loadData, refreshOfflineQueueCount]);

  const todayTasks = useMemo(
    () => tasks.filter((task) => isToday(task.data_planowana)),
    [tasks],
  );

  const sortedTodayTasks = useMemo(
    () => [...todayTasks].sort((a, b) => taskSortValue(a) - taskSortValue(b)),
    [todayTasks],
  );

  const activeNow = useMemo(
    () => sortedTodayTasks.filter((task) => isTaskInProgress(task.status)),
    [sortedTodayTasks],
  );

  const urgentToday = useMemo(
    () => todayTasks.filter((task) => task.priorytet === 'Pilny'),
    [todayTasks],
  );

  const completion = useMemo(() => {
    if (!todayTasks.length) return 0;
    const done = todayTasks.filter((task) => isTaskDone(task.status)).length;
    return Math.round((done / todayTasks.length) * 100);
  }, [todayTasks]);

  useEffect(() => {
    if (canCloseTeamDayReport(userRole) && completion === 100 && todayTasks.length > 0) {
      void fetchTeamDayReport();
    }
  }, [userRole, completion, todayTasks.length, fetchTeamDayReport]);

  const closeTeamDay = useCallback(async () => {
    const { token } = await getStoredSession();
    if (!token) return;
    const date = new Date().toISOString().split('T')[0];
    setTeamDayBusy(true);
    try {
      const res = await fetch(`${API_URL}/mobile/me/team-day-close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_date: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'err');
      Alert.alert('', t('misja.teamDay.ok'));
      await fetchTeamDayReport();
    } catch {
      Alert.alert('', t('misja.teamDay.err'));
    } finally {
      setTeamDayBusy(false);
    }
  }, [fetchTeamDayReport, t]);

  const remainingToday = useMemo(
    () => sortedTodayTasks.filter((task) => !isTaskClosed(task.status)),
    [sortedTodayTasks],
  );

  const crewRoutePlan = useMemo(() => {
    const routeTasks = sortedTodayTasks.filter((task) => normalizeTaskStatus(task.status) !== TASK_STATUS.ANULOWANE);
    const openTasks = routeTasks.filter((task) => !isTaskClosed(task.status));
    const active = routeTasks.find((task) => isTaskInProgress(task.status)) || null;
    const next = active || openTasks.find((task) => normalizeTaskStatus(task.status) === TASK_STATUS.ZAPLANOWANE) || openTasks[0] || null;
    const stops = openTasks.map(taskAddressLabel).filter(Boolean);
    const missingAddresses = openTasks.filter((task) => !taskAddressLabel(task)).length;
    const missingEvidence = openTasks.filter((task) => taskEvidenceCount(task) <= 0).length;
    const plannedMinutes = openTasks.reduce((acc, task) => acc + taskPlannedMinutes(task), 0);
    const doneCount = routeTasks.filter((task) => isTaskDone(task.status)).length;
    const signal = taskFieldSignalBreakdown(openTasks);
    return {
      routeTasks,
      openTasks,
      active,
      next,
      stops,
      missingAddresses,
      missingEvidence,
      plannedMinutes,
      doneCount,
      progressPct: routeTasks.length ? Math.round((doneCount / routeTasks.length) * 100) : 0,
      ...signal,
    };
  }, [sortedTodayTasks]);

  const estimatorDayPlan = useMemo(() => {
    const fieldTasks = sortedTodayTasks.filter((task) => (
      isFieldTask(task) && taskAssignedToEstimator(task, userId) && normalizeTaskStatus(task.status) !== TASK_STATUS.ANULOWANE
    ));
    const openTasks = fieldTasks.filter((task) => !isTaskClosed(task.status));
    const next = openTasks.find((task) => normalizeTaskStatus(task.status) === TASK_STATUS.WYCENA_TERENOWA) || openTasks[0] || null;
    const readyForOffice = openTasks.filter((task) => taskFieldPackageReady(task)).length;
    const missingEvidence = openTasks.filter((task) => taskEvidenceCount(task) < 3).length;
    const missingContact = openTasks.filter((task) => !task.klient_telefon || !taskAddressLabel(task)).length;
    const checks = taskFieldPackageChecks(next);
    const checksDone = checks.filter((check) => check.done).length;
    const signal = taskFieldSignalBreakdown(openTasks);
    return {
      fieldTasks,
      openTasks,
      next,
      readyForOffice,
      missingEvidence,
      missingContact,
      checks,
      checksDone,
      packagePct: checks.length ? Math.round((checksDone / checks.length) * 100) : 0,
      ...signal,
    };
  }, [sortedTodayTasks, userId]);

  const crewCommandChecks = useMemo(() => {
    const next = crewRoutePlan.next;
    return [
      {
        key: 'brief',
        label: 'Brief i zakres',
        hint: next
          ? (taskBriefText(next) ? 'Opis pracy jest w zleceniu.' : 'Brakuje opisu pracy dla najblizszego punktu.')
          : 'Brak otwartych prac.',
        done: !next || Boolean(taskBriefText(next)),
        icon: 'document-text-outline',
      },
      {
        key: 'evidence',
        label: 'Zdjecia / szkic',
        hint: next
          ? (taskEvidenceCount(next) > 0 ? `${taskEvidenceCount(next)} dowodow przy zleceniu.` : 'Dodaj lub sprawdz zdjecia przed praca.')
          : 'Dzien domkniety.',
        done: !next || taskEvidenceCount(next) > 0,
        icon: 'camera-outline',
      },
      {
        key: 'route',
        label: 'Adres i trasa',
        hint: crewRoutePlan.missingAddresses > 0
          ? `Brakuje adresu przy ${crewRoutePlan.missingAddresses} punkcie.`
          : `${crewRoutePlan.stops.length} punktow gotowych do nawigacji.`,
        done: crewRoutePlan.missingAddresses === 0,
        icon: 'navigate-outline',
      },
      {
        key: 'signal',
        label: 'Sygnaly do biura',
        hint: crewRoutePlan.signalCount > 0
          ? `${crewRoutePlan.signalCount} wymaga reakcji: check-in ${crewRoutePlan.signalCheckin}, foto ${crewRoutePlan.signalPhotos}, problemy ${crewRoutePlan.signalProblems}.`
          : 'Check-in, foto i problemy sa pod kontrola.',
        done: crewRoutePlan.signalCount === 0,
        icon: 'radio-outline',
      },
      {
        key: 'report',
        label: 'Zamkniecie dnia',
        hint: crewRoutePlan.openTasks.length === 0
          ? 'Mozna przeliczyc raport dnia.'
          : `Pozostalo ${crewRoutePlan.openTasks.length} prac do domkniecia.`,
        done: crewRoutePlan.openTasks.length === 0 && crewRoutePlan.routeTasks.length > 0,
        icon: 'checkmark-done-outline',
      },
    ];
  }, [crewRoutePlan]);

  const etaMinutes = useMemo(() => {
    // Lekki heurystyczny model ETA: 75 min na aktywne, 95 min na pozostałe.
    return remainingToday.reduce((acc, task) => (
      acc + (isTaskInProgress(task.status) ? 75 : 95)
    ), 0);
  }, [remainingToday]);

  const etaLabel = useMemo(() => {
    if (!remainingToday.length) return t('misja.eta.dayClosed');
    if (etaMinutes <= 120) return t('misja.eta.inReach');
    if (etaMinutes <= 240) return t('misja.eta.midDay');
    return t('misja.eta.heavyLoad');
  }, [etaMinutes, remainingToday.length, t]);

  const callClient = useCallback(async (task?: TaskItem | null) => {
    const phone = String(task?.klient_telefon || '').replace(/[^\d+]/g, '');
    if (!phone) {
      Alert.alert('', 'Brak numeru telefonu klienta.');
      return;
    }
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      Alert.alert('', 'Nie udalo sie uruchomic telefonu.');
    }
  }, []);

  const crewRole = isCrewRole(userRole);
  const estimatorRole = isEstimatorRole(userRole);
  const teamDayReportRole = canCloseTeamDayReport(userRole);

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
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
    <View style={S.root}>
      <AppStatusBar />

      <View style={S.header}>
        <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title}>{t('misja.title')}</Text>
          <Text style={S.subtitle}>{t('misja.subtitle')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            setRefreshing(true);
            void loadData();
          }}
          style={S.refreshBtn}
        >
          <Ionicons name="refresh" size={18} color={theme.headerText} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={S.kpiRow}>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayTasks.length}</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.tasksToday')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{activeNow.length}</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.inProgress')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{urgentToday.length}</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.urgent')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{completion}%</Text>
            <Text style={S.kpiLabel}>{t('misja.kpi.dayProgress')}</Text>
          </View>
        </View>

        {offlineQueueCount > 0 ? (
          <View style={S.offlineNotice}>
            <View style={S.offlineNoticeIcon}>
              <Ionicons name="cloud-offline-outline" size={17} color={theme.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.offlineNoticeTitle}>Tryb odporny na internet</Text>
              <Text style={S.offlineNoticeText}>
                {offlineQueueCount} zmian czeka w kolejce. Dane zostana wyslane po powrocie sieci.
              </Text>
            </View>
          </View>
        ) : null}

        {cacheNotice ? (
          <View style={S.offlineNotice}>
            <View style={S.offlineNoticeIcon}>
              <Ionicons name="file-tray-full-outline" size={17} color={theme.info} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.offlineNoticeTitle}>Plan offline</Text>
              <Text style={S.offlineNoticeText}>{cacheNotice}</Text>
            </View>
          </View>
        ) : null}

        {crewRole ? (
          <View style={S.crewCommandCard}>
            <View style={S.crewCommandHead}>
              <View style={S.crewCommandTitleBox}>
                <Text style={S.crewCommandEyebrow}>Pulpit brygady</Text>
                <Text style={S.crewCommandTitle}>
                  {crewRoutePlan.next ? 'Nastepny punkt trasy' : 'Dzien domkniety'}
                </Text>
              </View>
              <View style={S.crewCommandBadge}>
                <Ionicons
                  name={crewRoutePlan.active ? 'play-circle' : 'navigate-circle-outline'}
                  size={16}
                  color={crewRoutePlan.active ? theme.warning : theme.accent}
                />
                <Text style={[S.crewCommandBadgeText, { color: crewRoutePlan.active ? theme.warning : theme.accent }]}>
                  {crewRoutePlan.active ? 'W pracy' : `${crewRoutePlan.openTasks.length} otwarte`}
                </Text>
              </View>
            </View>

            {crewRoutePlan.next ? (
              <View style={S.crewNextBox}>
                <View style={{ flex: 1 }}>
                  <Text style={S.crewNextTime}>{formatHour(crewRoutePlan.next.godzina_rozpoczecia)}</Text>
                  <Text style={S.crewNextTitle} numberOfLines={2}>
                    {crewRoutePlan.next.klient_nazwa || t('misja.taskFallback', { id: crewRoutePlan.next.id })}
                  </Text>
                  <Text style={S.crewNextAddress} numberOfLines={2} selectable>
                    {taskAddressLabel(crewRoutePlan.next) || 'Brak adresu'}
                  </Text>
                </View>
                <View style={S.crewNextPhotoBadge}>
                  <Text style={S.crewNextPhotoNum}>{taskEvidenceCount(crewRoutePlan.next)}</Text>
                  <Text style={S.crewNextPhotoLabel}>foto</Text>
                </View>
              </View>
            ) : (
              <View style={S.crewNextBox}>
                <Ionicons name="checkmark-done-circle-outline" size={26} color={theme.success} />
                <View style={{ flex: 1 }}>
                  <Text style={S.crewNextTitle}>Nie ma juz otwartych punktow.</Text>
                  <Text style={S.crewNextAddress}>Mozna domknac raport dnia i kase.</Text>
                </View>
              </View>
            )}

            <View style={S.crewStatsRow}>
              <View style={S.crewStatTile}>
                <Text style={S.crewStatValue}>{crewRoutePlan.routeTasks.length}</Text>
                <Text style={S.crewStatLabel}>punkty</Text>
              </View>
              <View style={S.crewStatTile}>
                <Text style={S.crewStatValue}>{crewRoutePlan.active ? 1 : 0}</Text>
                <Text style={S.crewStatLabel}>aktywny</Text>
              </View>
              <View style={S.crewStatTile}>
                <Text style={[S.crewStatValue, crewRoutePlan.missingEvidence > 0 && { color: theme.warning }]}>
                  {crewRoutePlan.missingEvidence}
                </Text>
                <Text style={S.crewStatLabel}>braki foto</Text>
              </View>
              <View style={S.crewStatTile}>
                <Text style={S.crewStatValue}>{formatDuration(crewRoutePlan.plannedMinutes, t)}</Text>
                <Text style={S.crewStatLabel}>ETA</Text>
              </View>
            </View>

            {crewRoutePlan.signalCount > 0 ? (
              <TouchableOpacity
                activeOpacity={0.88}
                style={S.fieldSignalAlert}
                onPress={() => router.push('/zlecenia?mode=needsSignal' as never)}
              >
                <View style={S.fieldSignalIcon}>
                  <Ionicons name="radio-outline" size={18} color={theme.warning} />
                </View>
                <View style={S.fieldSignalBody}>
                  <Text style={S.fieldSignalTitle}>Biuro czeka na sygnal z terenu</Text>
                  <Text style={S.fieldSignalText} numberOfLines={2}>
                    {crewRoutePlan.signalNext
                      ? `${crewRoutePlan.signalNext.task.klient_nazwa || `Zlecenie #${crewRoutePlan.signalNext.task.id}`}: ${crewRoutePlan.signalNext.field.label}. ${crewRoutePlan.signalNext.field.detail}`
                      : 'Otworz zlecenia wymagajace check-in, zdjec albo problemu.'}
                  </Text>
                  <View style={S.fieldSignalPills}>
                    <View style={S.fieldSignalPill}>
                      <Text style={S.fieldSignalPillValue}>{crewRoutePlan.signalCheckin}</Text>
                      <Text style={S.fieldSignalPillLabel}>check-in</Text>
                    </View>
                    <View style={S.fieldSignalPill}>
                      <Text style={S.fieldSignalPillValue}>{crewRoutePlan.signalPhotos}</Text>
                      <Text style={S.fieldSignalPillLabel}>foto</Text>
                    </View>
                    <View style={S.fieldSignalPill}>
                      <Text style={S.fieldSignalPillValue}>{crewRoutePlan.signalProblems}</Text>
                      <Text style={S.fieldSignalPillLabel}>problemy</Text>
                    </View>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.warning} />
              </TouchableOpacity>
            ) : null}

            <View style={S.crewProgressBox}>
              <View style={S.crewProgressMeta}>
                <Text style={S.crewProgressText}>Postep trasy</Text>
                <Text style={S.crewProgressText}>{crewRoutePlan.progressPct}%</Text>
              </View>
              <View style={S.progressTrack}>
                <View style={[S.progressFill, { width: `${crewRoutePlan.progressPct}%` }]} />
              </View>
            </View>

            <View style={S.crewChecks}>
              {crewCommandChecks.map((row) => (
                <View key={row.key} style={S.crewCheckRow}>
                  <View style={[S.crewCheckIcon, { borderColor: row.done ? theme.success : theme.warning }]}>
                    <Ionicons
                      name={(row.done ? 'checkmark-circle' : row.icon) as React.ComponentProps<typeof Ionicons>['name']}
                      size={17}
                      color={row.done ? theme.success : theme.warning}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={S.crewCheckTitle}>{row.label}</Text>
                    <Text style={S.crewCheckHint} numberOfLines={2}>{row.hint}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={S.crewActionsRow}>
              <TouchableOpacity
                style={[S.crewActionBtn, !crewRoutePlan.next && S.crewActionDisabled]}
                disabled={!crewRoutePlan.next}
                onPress={() => crewRoutePlan.next && router.push(`/zlecenie/${crewRoutePlan.next.id}`)}
              >
                <Ionicons name="open-outline" size={16} color={theme.accent} />
                <Text style={S.crewActionText}>Otworz</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.crewActionBtn, !crewRoutePlan.next && S.crewActionDisabled]}
                disabled={!crewRoutePlan.next}
                onPress={() => crewRoutePlan.next && void openAddressInMaps(crewRoutePlan.next.adres || '', crewRoutePlan.next.miasto)}
              >
                <Ionicons name="navigate-outline" size={16} color={theme.info} />
                <Text style={S.crewActionText}>Nawiguj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.crewActionBtn, crewRoutePlan.stops.length === 0 && S.crewActionDisabled]}
                disabled={crewRoutePlan.stops.length === 0}
                onPress={() => void openRouteInMaps(crewRoutePlan.stops)}
              >
                <Ionicons name="map-outline" size={16} color={theme.success} />
                <Text style={S.crewActionText}>Trasa</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.crewActionBtn, !crewRoutePlan.next?.klient_telefon && S.crewActionDisabled]}
                disabled={!crewRoutePlan.next?.klient_telefon}
                onPress={() => void callClient(crewRoutePlan.next)}
              >
                <Ionicons name="call-outline" size={16} color={theme.warning} />
                <Text style={S.crewActionText}>Telefon</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {!crewRole && estimatorRole ? (
          <View style={S.estimatorCommandCard}>
            <View style={S.crewCommandHead}>
              <View style={S.crewCommandTitleBox}>
                <Text style={S.crewCommandEyebrow}>Pulpit specjalisty oględzin</Text>
                <Text style={S.crewCommandTitle}>
                  {estimatorDayPlan.next ? 'Nastepny klient do ogledzin' : 'Brak ogledzin na dzisiaj'}
                </Text>
              </View>
              <View style={S.crewCommandBadge}>
                <Ionicons name="camera-outline" size={16} color={theme.info} />
                <Text style={[S.crewCommandBadgeText, { color: theme.info }]}>
                  {estimatorDayPlan.openTasks.length} otwarte
                </Text>
              </View>
            </View>

            {estimatorDayPlan.next ? (
              <View style={S.estimatorNextBox}>
                <View style={{ flex: 1 }}>
                  <Text style={S.crewNextTime}>{formatHour(estimatorDayPlan.next.godzina_rozpoczecia)}</Text>
                  <Text style={S.crewNextTitle} numberOfLines={2}>
                    {estimatorDayPlan.next.klient_nazwa || t('misja.taskFallback', { id: estimatorDayPlan.next.id })}
                  </Text>
                  <Text style={S.crewNextAddress} numberOfLines={2} selectable>
                    {taskAddressLabel(estimatorDayPlan.next) || 'Brak adresu'}
                  </Text>
                  {taskBriefText(estimatorDayPlan.next) ? (
                    <Text style={S.estimatorBrief} numberOfLines={2}>{taskBriefText(estimatorDayPlan.next)}</Text>
                  ) : null}
                </View>
                <View style={S.estimatorPackageBadge}>
                  <Text style={S.crewNextPhotoNum}>{estimatorDayPlan.packagePct}%</Text>
                  <Text style={S.crewNextPhotoLabel}>pakiet</Text>
                </View>
              </View>
            ) : (
              <View style={S.estimatorNextBox}>
                <Ionicons name="leaf-outline" size={26} color={theme.success} />
                <View style={{ flex: 1 }}>
                  <Text style={S.crewNextTitle}>Nie ma przypisanych ogledzin na dzisiaj.</Text>
                  <Text style={S.crewNextAddress}>Mozesz przejsc do zlecen albo odswiezyc liste.</Text>
                </View>
              </View>
            )}

            <View style={S.crewStatsRow}>
              <View style={S.crewStatTile}>
                <Text style={S.crewStatValue}>{estimatorDayPlan.fieldTasks.length}</Text>
                <Text style={S.crewStatLabel}>wizyty</Text>
              </View>
              <View style={S.crewStatTile}>
                <Text style={[S.crewStatValue, estimatorDayPlan.missingEvidence > 0 && { color: theme.warning }]}>
                  {estimatorDayPlan.missingEvidence}
                </Text>
                <Text style={S.crewStatLabel}>braki foto</Text>
              </View>
              <View style={S.crewStatTile}>
                <Text style={[S.crewStatValue, estimatorDayPlan.missingContact > 0 && { color: theme.warning }]}>
                  {estimatorDayPlan.missingContact}
                </Text>
                <Text style={S.crewStatLabel}>adres/tel</Text>
              </View>
              <View style={S.crewStatTile}>
                <Text style={S.crewStatValue}>{estimatorDayPlan.readyForOffice}</Text>
                <Text style={S.crewStatLabel}>dla biura</Text>
              </View>
            </View>

            {estimatorDayPlan.signalCount > 0 ? (
              <TouchableOpacity
                activeOpacity={0.88}
                style={S.fieldSignalAlert}
                onPress={() => router.push('/zlecenia?mode=needsSignal' as never)}
              >
                <View style={S.fieldSignalIcon}>
                  <Ionicons name="radio-outline" size={18} color={theme.warning} />
                </View>
                <View style={S.fieldSignalBody}>
                  <Text style={S.fieldSignalTitle}>Biuro czeka na pakiet wyceny</Text>
                  <Text style={S.fieldSignalText} numberOfLines={2}>
                    {estimatorDayPlan.signalNext
                      ? `${estimatorDayPlan.signalNext.task.klient_nazwa || `Zlecenie #${estimatorDayPlan.signalNext.task.id}`}: ${estimatorDayPlan.signalNext.field.detail}`
                      : 'Uzupelnij zdjecia, szkic, check-in albo problem w zleceniu.'}
                  </Text>
                  <View style={S.fieldSignalPills}>
                    <View style={S.fieldSignalPill}>
                      <Text style={S.fieldSignalPillValue}>{estimatorDayPlan.signalCheckin}</Text>
                      <Text style={S.fieldSignalPillLabel}>check-in</Text>
                    </View>
                    <View style={S.fieldSignalPill}>
                      <Text style={S.fieldSignalPillValue}>{estimatorDayPlan.signalPhotos}</Text>
                      <Text style={S.fieldSignalPillLabel}>foto</Text>
                    </View>
                    <View style={S.fieldSignalPill}>
                      <Text style={S.fieldSignalPillValue}>{estimatorDayPlan.signalProblems}</Text>
                      <Text style={S.fieldSignalPillLabel}>problemy</Text>
                    </View>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.warning} />
              </TouchableOpacity>
            ) : null}

            {estimatorDayPlan.checks.length ? (
              <>
                <View style={S.crewProgressBox}>
                  <View style={S.crewProgressMeta}>
                    <Text style={S.crewProgressText}>Gotowosc pakietu dla biura</Text>
                    <Text style={S.crewProgressText}>{estimatorDayPlan.checksDone}/{estimatorDayPlan.checks.length}</Text>
                  </View>
                  <View style={S.progressTrack}>
                    <View style={[S.progressFill, { width: `${estimatorDayPlan.packagePct}%` }]} />
                  </View>
                </View>

                <View style={S.crewChecks}>
                  {estimatorDayPlan.checks.map((row) => (
                    <View key={row.key} style={S.crewCheckRow}>
                      <View style={[S.crewCheckIcon, { borderColor: row.done ? theme.success : theme.warning }]}>
                        <Ionicons
                          name={row.done ? 'checkmark-circle' : row.icon}
                          size={17}
                          color={row.done ? theme.success : theme.warning}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.crewCheckTitle}>{row.label}</Text>
                        <Text style={S.crewCheckHint} numberOfLines={1}>{row.value}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <View style={S.crewActionsRow}>
              <TouchableOpacity
                style={[S.crewActionBtn, !estimatorDayPlan.next && S.crewActionDisabled]}
                disabled={!estimatorDayPlan.next}
                onPress={() => estimatorDayPlan.next && router.push(`/zlecenie/${estimatorDayPlan.next.id}`)}
              >
                <Ionicons name="open-outline" size={16} color={theme.accent} />
                <Text style={S.crewActionText}>Otworz</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.crewActionBtn, !estimatorDayPlan.next && S.crewActionDisabled]}
                disabled={!estimatorDayPlan.next}
                onPress={() => estimatorDayPlan.next && router.push(estimatorDocumentationRoute(estimatorDayPlan.next) as never)}
              >
                <Ionicons name="camera-outline" size={16} color={theme.info} />
                <Text style={S.crewActionText}>Dowody</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.crewActionBtn, !estimatorDayPlan.next && S.crewActionDisabled]}
                disabled={!estimatorDayPlan.next}
                onPress={() => estimatorDayPlan.next && void openAddressInMaps(estimatorDayPlan.next.adres || '', estimatorDayPlan.next.miasto)}
              >
                <Ionicons name="navigate-outline" size={16} color={theme.success} />
                <Text style={S.crewActionText}>Nawiguj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.crewActionBtn, !estimatorDayPlan.next?.klient_telefon && S.crewActionDisabled]}
                disabled={!estimatorDayPlan.next?.klient_telefon}
                onPress={() => void callClient(estimatorDayPlan.next)}
              >
                <Ionicons name="call-outline" size={16} color={theme.warning} />
                <Text style={S.crewActionText}>Telefon</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.dayProgress')}</Text>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${completion}%` }]} />
          </View>
          <View style={S.progressMetaRow}>
            <Text style={S.progressMetaText}>
              {t('misja.progress.completed', {
                done: todayTasks.length - remainingToday.length,
                total: todayTasks.length || 0,
              })}
            </Text>
            <Text style={S.progressMetaText}>{completion}%</Text>
          </View>

          <View style={S.etaCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="time-outline" size={16} color={theme.info} />
              <Text style={S.etaTitle}>{t('misja.eta.title')}</Text>
            </View>
            <Text style={S.etaValue}>
              {remainingToday.length ? formatDuration(etaMinutes, t) : t('misja.eta.zero')}
            </Text>
            <Text style={S.etaSub}>
              {etaLabel} • {t('misja.eta.remainingTasks', { count: remainingToday.length })}
            </Text>
          </View>
        </View>

        {teamDayReportRole ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>{t('misja.teamDay.cashTitle')}</Text>
            <Text style={[S.emptyText, { marginBottom: 8 }]}>{t('misja.teamDay.cashSub')}</Text>
            {teamDayLoading && !teamDayPack?.day_preview ? (
              <ActivityIndicator size="small" color={theme.accent} style={{ marginVertical: 6 }} />
            ) : null}
            {teamDayPack?.day_preview ? (
              <>
                {teamDayPack.day_preview.cash_by_forma.length === 0 ? (
                  <Text style={S.emptyText}>{t('misja.teamDay.cashEmpty')}</Text>
                ) : (
                  teamDayPack.day_preview.cash_by_forma.map((row, idx) => (
                    <View key={`${row.forma_platnosc ?? 'x'}-${idx}`} style={S.cashRow}>
                      <Text style={S.cashForma}>{row.forma_platnosc?.trim() || t('misja.teamDay.cashOther')}</Text>
                      <Text style={S.cashKwota}>{formatPln(row.sum_kwota)}</Text>
                    </View>
                  ))
                )}
                {teamDayPack.day_preview.cash_by_forma.length > 0 ? (
                  <Text style={S.cashTotal}>
                    {t('misja.teamDay.cashTotal')}{' '}
                    {formatPln(
                      teamDayPack.day_preview.cash_by_forma.reduce(
                        (acc, r) => acc + (Number(r.sum_kwota) || 0),
                        0,
                      ),
                    )}
                  </Text>
                ) : null}
                {(teamDayPack.day_preview.issues_count ?? 0) > 0 ? (
                  <Text style={S.cashIssues}>
                    {t('misja.teamDay.cashIssues', { count: teamDayPack.day_preview.issues_count ?? 0 })}
                  </Text>
                ) : null}
              </>
            ) : !teamDayLoading ? (
              <Text style={S.emptyText}>{t('misja.teamDay.cashUnavailable')}</Text>
            ) : null}
          </View>
        ) : null}

        {teamDayReportRole && todayTasks.length > 0 && completion === 100 ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>{t('misja.teamDay.title')}</Text>
            <Text style={[S.emptyText, { marginBottom: 10 }]}>{t('misja.teamDay.sub')}</Text>
            {teamDayLoading ? (
              <ActivityIndicator size="small" color={theme.accent} style={{ marginVertical: 8 }} />
            ) : null}
            {!teamDayLoading && teamDayPack?.report ? (
              <Text style={S.teamDayMeta}>{t('misja.teamDay.hasReport', { id: teamDayPack.report.id })}</Text>
            ) : null}
            {!teamDayLoading && !teamDayPack?.report ? (
              <Text style={S.emptyText}>{t('misja.teamDay.noReport')}</Text>
            ) : null}
            <TouchableOpacity
              style={[S.actionBtn, { marginTop: 10, opacity: teamDayBusy ? 0.6 : 1 }]}
              onPress={() => void closeTeamDay()}
              disabled={teamDayBusy}
            >
              {teamDayBusy ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons name="calculator-outline" size={16} color={theme.accent} />
              )}
              <Text style={S.actionText}>{teamDayBusy ? t('misja.teamDay.busy') : t('misja.teamDay.btn')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.now')}</Text>
          {activeNow.length === 0 ? (
            <Text style={S.emptyText}>{t('misja.emptyActive')}</Text>
          ) : (
            activeNow.slice(0, 3).map((task) => (
              <TouchableOpacity
                key={task.id}
                style={S.taskCard}
                onPress={() => router.push(`/zlecenie/${task.id}`)}
              >
                <Text style={S.taskTitle}>
                  {task.klient_nazwa || t('misja.taskFallback', { id: task.id })}
                </Text>
                <Text style={S.taskMeta}>
                  {formatHour(task.godzina_rozpoczecia)} • {task.adres || t('misja.noAddress')}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.todayPlan')}</Text>
          {todayTasks.length === 0 ? (
            <Text style={S.emptyText}>{t('misja.emptyToday')}</Text>
          ) : (
            todayTasks.slice(0, 8).map((task) => (
              <TouchableOpacity
                key={task.id}
                style={S.planRow}
                onPress={() => router.push(`/zlecenie/${task.id}`)}
              >
                <View style={S.planLeft}>
                  <Text style={S.planHour}>{formatHour(task.godzina_rozpoczecia)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.planClient}>
                    {task.klient_nazwa || t('misja.taskFallback', { id: task.id })}
                  </Text>
                  <Text style={S.planAddr}>{task.miasto || ''} {task.adres || ''}</Text>
                </View>
                <Text style={[S.planStatus, task.priorytet === 'Pilny' && { color: theme.danger }]}>
                  {task.priorytet || task.status || '-'}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('misja.section.quickActions')}</Text>
          <View style={S.actionRow}>
            <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/zlecenia')}>
              <Ionicons name="clipboard-outline" size={16} color={theme.accent} />
              <Text style={S.actionText}>{t('misja.action.orders')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/raport-dzienny')}>
              <Ionicons name="document-text-outline" size={16} color={theme.accent} />
              <Text style={S.actionText}>{t('misja.action.dailyReport')}</Text>
            </TouchableOpacity>
          </View>
          {userRole === 'Kierownik' || userRole === 'Dyrektor' || userRole === 'Administrator' ? (
            <View style={S.actionRow}>
              <TouchableOpacity style={S.actionBtn} onPress={() => router.push('/harmonogram')}>
                <Ionicons name="calendar-outline" size={16} color={theme.accent} />
                <Text style={S.actionText}>{t('misja.action.schedule')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.actionBtn} onPress={() => router.push(buildNewOrderRoute({ source: 'misja-dnia' }) as never)}>
                <Ionicons name="add-circle-outline" size={16} color={theme.accent} />
                <Text style={S.actionText}>{t('misja.action.newOrder')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },
  header: {
    paddingTop: 54,
    paddingBottom: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: t.headerText },
  subtitle: { fontSize: 12, color: t.headerSub },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  kpiCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 7,
    backgroundColor: t.surface,
    padding: 12,
  },
  kpiNum: { fontSize: 22, fontWeight: '800', color: t.accent },
  kpiLabel: { fontSize: 12, color: t.textSub, marginTop: 2 },
  offlineNotice: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.warning + '55',
    borderRadius: 6,
    backgroundColor: t.warningBg,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineNoticeIcon: {
    width: 36,
    height: 36,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.cardBg,
    borderWidth: 1,
    borderColor: t.warning + '44',
  },
  offlineNoticeTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  offlineNoticeText: { color: t.textSub, fontSize: 11.5, lineHeight: 16, marginTop: 1 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: t.surface2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: t.success,
    borderRadius: 5,
  },
  progressMetaRow: {
    marginTop: 8,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressMetaText: { fontSize: 12, color: t.textSub, fontWeight: '600' },
  etaCard: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    backgroundColor: t.surface2,
    padding: 10,
    gap: 4,
  },
  etaTitle: { fontSize: 13, fontWeight: '700', color: t.text },
  etaValue: { fontSize: 22, fontWeight: '800', color: t.info },
  etaSub: { fontSize: 12, color: t.textSub },
  crewCommandCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.accentLight,
    borderRadius: 6,
    backgroundColor: t.cardBg,
    padding: 12,
    gap: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.24,
      radius: t.shadowRadius * 0.55,
      offsetY: Math.max(2, t.shadowOffsetY),
      elevation: Math.max(2, t.cardElevation),
    }),
  },
  estimatorCommandCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.info + '55',
    borderRadius: 6,
    backgroundColor: t.cardBg,
    padding: 12,
    gap: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.24,
      radius: t.shadowRadius * 0.55,
      offsetY: Math.max(2, t.shadowOffsetY),
      elevation: Math.max(2, t.cardElevation),
    }),
  },
  crewCommandHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  crewCommandTitleBox: { flex: 1 },
  crewCommandEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    color: t.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  crewCommandTitle: { fontSize: 18, fontWeight: '900', color: t.text, marginTop: 2 },
  crewCommandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 5,
    backgroundColor: t.surface2,
  },
  crewCommandBadgeText: { fontSize: 11, fontWeight: '900' },
  crewNextBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 7,
    backgroundColor: t.surface,
    padding: 10,
  },
  estimatorNextBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: t.info + '44',
    borderRadius: 7,
    backgroundColor: t.surface,
    padding: 10,
  },
  crewNextTime: { fontSize: 12, fontWeight: '900', color: t.info, fontVariant: ['tabular-nums'] },
  crewNextTitle: { fontSize: 15, fontWeight: '900', color: t.text, marginTop: 2 },
  crewNextAddress: { fontSize: 12, color: t.textSub, marginTop: 3, lineHeight: 16 },
  estimatorBrief: { fontSize: 11.5, color: t.textMuted, marginTop: 5, lineHeight: 16 },
  crewNextPhotoBadge: {
    width: 54,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
  },
  crewNextPhotoNum: { fontSize: 18, fontWeight: '900', color: t.accent, fontVariant: ['tabular-nums'] },
  crewNextPhotoLabel: { fontSize: 9, fontWeight: '900', color: t.textMuted, textTransform: 'uppercase' },
  estimatorPackageBadge: {
    width: 60,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.info + '44',
    backgroundColor: t.infoBg,
  },
  crewStatsRow: { flexDirection: 'row', gap: 7 },
  crewStatTile: {
    flex: 1,
    minHeight: 58,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    backgroundColor: t.surface2,
    paddingHorizontal: 7,
  },
  crewStatValue: { fontSize: 15, fontWeight: '900', color: t.text, fontVariant: ['tabular-nums'] },
  crewStatLabel: { fontSize: 9.5, fontWeight: '800', color: t.textMuted, marginTop: 2 },
  fieldSignalAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: t.warning + '55',
    borderRadius: 7,
    backgroundColor: t.warningBg,
    padding: 10,
  },
  fieldSignalIcon: {
    width: 36,
    height: 36,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.warning + '55',
    backgroundColor: t.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldSignalBody: { flex: 1, gap: 6 },
  fieldSignalTitle: { fontSize: 12.5, fontWeight: '900', color: t.warning },
  fieldSignalText: { fontSize: 11.5, fontWeight: '700', color: t.textSub, lineHeight: 16 },
  fieldSignalPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldSignalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: t.warning + '33',
    borderRadius: 5,
    backgroundColor: t.cardBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fieldSignalPillValue: { fontSize: 11, fontWeight: '900', color: t.warning, fontVariant: ['tabular-nums'] },
  fieldSignalPillLabel: { fontSize: 9.5, fontWeight: '900', color: t.textMuted },
  crewProgressBox: { gap: 7 },
  crewProgressMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  crewProgressText: { fontSize: 11, fontWeight: '800', color: t.textSub },
  crewChecks: { gap: 7 },
  crewCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    backgroundColor: t.surface,
    padding: 9,
  },
  crewCheckIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface2,
  },
  crewCheckTitle: { fontSize: 12.5, fontWeight: '900', color: t.text },
  crewCheckHint: { fontSize: 11, color: t.textMuted, lineHeight: 15, marginTop: 1 },
  crewActionsRow: { flexDirection: 'row', gap: 7 },
  crewActionBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    backgroundColor: t.surface2,
    paddingHorizontal: 4,
  },
  crewActionDisabled: { opacity: 0.45 },
  crewActionText: { fontSize: 10.5, fontWeight: '900', color: t.text },
  section: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 7,
    backgroundColor: t.surface,
    padding: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.2,
      radius: t.shadowRadius * 0.48,
      offsetY: Math.max(2, t.shadowOffsetY - 1),
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 10 },
  emptyText: { fontSize: 13, color: t.textMuted },
  taskCard: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    backgroundColor: t.surface2,
  },
  taskTitle: { fontSize: 14, fontWeight: '700', color: t.text },
  taskMeta: { fontSize: 12, color: t.textSub, marginTop: 2 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  planLeft: { width: 46, alignItems: 'center' },
  planHour: { fontSize: 12, fontWeight: '700', color: t.info },
  planClient: { fontSize: 13, fontWeight: '700', color: t.text },
  planAddr: { fontSize: 12, color: t.textSub, marginTop: 2 },
  planStatus: { fontSize: 11, color: t.warning, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    paddingVertical: 10,
    backgroundColor: t.surface2,
  },
  actionText: { fontSize: 12, fontWeight: '700', color: t.text },
  cashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  cashForma: { fontSize: 13, color: t.text, flex: 1, paddingRight: 8 },
  cashKwota: { fontSize: 13, fontWeight: '700', color: t.success },
  cashTotal: { fontSize: 14, fontWeight: '800', color: t.text, marginTop: 10 },
  cashIssues: { fontSize: 12, color: t.warning, marginTop: 8 },
  teamDayMeta: { fontSize: 13, color: t.textSub, marginBottom: 4 },
});
