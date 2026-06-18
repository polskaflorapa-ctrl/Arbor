import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { type CalendarBlock, isYmdBlocked, loadCalendarBlocks } from '../utils/calendar-blocks';
import { fetchWithTimeout } from '../utils/api-client';
import { enqueueOfflineRequest } from '../utils/offline-queue';
import { tryScheduleReservationDayEndReminder } from '../utils/reservation-end-reminder';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';
import {
  REZERWACJA_STATUSY,
  addLocalRezerwacja,
  fetchRezerwacjeApi,
  hasLocalReservationConflict,
  listLocalInRange,
  postRezerwacjaApi,
  putRezerwacjaStatusApi,
  type RezerwacjaStatus,
  type SprzetRezerwacjaRow,
  updateLocalStatus,
} from '../utils/sprzet-rezerwacje';

import { AppStatusBar } from '../components/ui/app-status-bar';
const CREATE_ALLOWED_STATUSES: RezerwacjaStatus[] = ['Zarezerwowane', 'Wydane'];

const STATUS_TRANSITIONS: Record<RezerwacjaStatus, RezerwacjaStatus[]> = {
  Zarezerwowane: ['Wydane', 'Anulowane'],
  Wydane: ['Zwrócone', 'Anulowane'],
  Zwrócone: [],
  Anulowane: [],
};
const CONFLICT_FILTER_KEY = 'fleet_reservation_conflict_filter_v1';

type ReservationRouteParams = {
  prefData?: string | string[];
  date?: string | string[];
  prefZlecenie?: string | string[];
  task?: string | string[];
  zlecenie?: string | string[];
  prefSprzet?: string | string[];
  equipment?: string | string[];
  sprzet?: string | string[];
  prefEkipa?: string | string[];
  team?: string | string[];
  ekipa?: string | string[];
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function onlyDigits(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function toPositiveNumber(value: string): number | null {
  const n = Number(onlyDigits(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rowTaskId(row: SprzetRezerwacjaRow): string {
  return row.task_id != null ? String(row.task_id) : '';
}

function taskReservationLabel(row: SprzetRezerwacjaRow): string {
  const id = rowTaskId(row);
  if (!id) return '';
  return `#${id}${row.task_klient_nazwa ? ` ${row.task_klient_nazwa}` : ''}`;
}

function monthRange(y: number, m0: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m0 + 1)}-01`;
  const last = new Date(y, m0 + 1, 0).getDate();
  const to = `${y}-${pad(m0 + 1)}-${pad(last)}`;
  return { from, to };
}

function isValidYmdDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yRaw, mRaw, dRaw] = value.split('-');
  const y = Number(yRaw);
  const m = Number(mRaw);
  const d = Number(dRaw);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isPastYmdDate(value: string): boolean {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayYmd = `${yyyy}-${mm}-${dd}`;
  return value < todayYmd;
}

export default function RezerwacjeSprzetuScreen() {
  const params = useLocalSearchParams<ReservationRouteParams>();
  const prefDataRaw = firstParam(params.prefData) || firstParam(params.date);
  const prefTaskRaw = onlyDigits(firstParam(params.prefZlecenie) || firstParam(params.task) || firstParam(params.zlecenie));
  const prefSprzetRaw = (firstParam(params.prefSprzet) || firstParam(params.equipment) || firstParam(params.sprzet)).split(',')[0] || '';
  const prefEkipaRaw = firstParam(params.prefEkipa) || firstParam(params.team) || firstParam(params.ekipa);
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const guard = useOddzialFeatureGuard('/rezerwacje-sprzetu');
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';

  const [token, setToken] = useState<string | null>(null);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth0, setViewMonth0] = useState(() => new Date().getMonth());
  const [rows, setRows] = useState<SprzetRezerwacjaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiListingDown, setApiListingDown] = useState(false);
  const [showOnlyConflicts, setShowOnlyConflicts] = useState(false);
  const [taskFilterId, setTaskFilterId] = useState('');
  const [showOnlyTask, setShowOnlyTask] = useState(false);

  const [sprzetList, setSprzetList] = useState<{ id: number; nazwa: string; typ?: string }[]>([]);
  const [ekipyList, setEkipyList] = useState<{ id: number; nazwa: string }[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [formSprzetId, setFormSprzetId] = useState<number | null>(null);
  const [formEkipaId, setFormEkipaId] = useState<number | null>(null);
  const [formCalyDzien, setFormCalyDzien] = useState(true);
  const [formStatus, setFormStatus] = useState<RezerwacjaStatus>('Zarezerwowane');
  const [formTaskId, setFormTaskId] = useState('');
  const listRef = useRef<ScrollView | null>(null);
  const rowOffsetsRef = useRef<Record<string, number>>({});
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [jumpBusy, setJumpBusy] = useState(false);
  const jumpCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([]);
  const [exportingMonth, setExportingMonth] = useState(false);
  const [reservationNotice, setReservationNotice] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);

  const { from, to } = useMemo(() => monthRange(viewYear, viewMonth0), [viewYear, viewMonth0]);

  const showReservationNotice = useCallback((message: string, tone: 'success' | 'warning' = 'success') => {
    setReservationNotice({ message, tone });
  }, []);

  useEffect(() => {
    if (!reservationNotice) return;
    const timer = setTimeout(() => setReservationNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [reservationNotice]);

  const loadRefs = useCallback(async (auth: string) => {
    const h = { Authorization: `Bearer ${auth}` };
    const [sRes, eRes] = await Promise.all([
      fetchWithTimeout(`${API_URL}/flota/sprzet`, { headers: h }),
      fetchWithTimeout(`${API_URL}/ekipy?include_delegacje=1`, { headers: h }),
    ]);
    if (sRes.ok) {
      const d = await sRes.json();
      setSprzetList(Array.isArray(d) ? d.map((x: any) => ({ id: x.id, nazwa: x.nazwa, typ: x.typ })) : []);
    }
    if (eRes.ok) {
      const d = await eRes.json();
      const items = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
      setEkipyList(items.map((x: any) => ({ id: x.id, nazwa: x.nazwa })));
    }
  }, []);

  const loadReservations = useCallback(async (auth: string | null) => {
    if (!auth) return;
    const api = await fetchRezerwacjeApi(auth, from, to);
    setApiListingDown(!api.ok || api.notImplemented);
    const local = await listLocalInRange(from, to);
    const apiIds = new Set(api.items.map((r) => r.id));
    const extraLocal = local.filter((r) => r.localOnly && r.id && !apiIds.has(r.id));
    const merged = [...api.items, ...extraLocal].sort((a, b) =>
      a.data.localeCompare(b.data) || String(a.sprzet_nazwa).localeCompare(String(b.sprzet_nazwa)),
    );
    setRows(merged);
  }, [from, to]);

  const init = useCallback(async () => {
    const { token: tok } = await getStoredSession();
    setToken(tok);
    if (!tok) {
      router.replace('/login');
      return;
    }
    await loadRefs(tok);
    setLoading(false);
    setRefreshing(false);
  }, [loadRefs]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void loadCalendarBlocks().then(setCalendarBlocks);
  }, []);

  useEffect(() => {
    if (!prefDataRaw || !isValidYmdDate(prefDataRaw)) return;
    setFormDate(prefDataRaw);
    const [y, m] = prefDataRaw.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(m)) {
      setViewYear(y);
      setViewMonth0(m - 1);
    }
    setModalOpen(true);
  }, [prefDataRaw]);

  useEffect(() => {
    if (prefTaskRaw) {
      setTaskFilterId(prefTaskRaw);
      setShowOnlyTask(true);
      setFormTaskId(prefTaskRaw);
    }
    const sprzetId = toPositiveNumber(prefSprzetRaw);
    if (sprzetId) setFormSprzetId(sprzetId);
    const ekipaId = toPositiveNumber(prefEkipaRaw);
    if (ekipaId) setFormEkipaId(ekipaId);
  }, [prefEkipaRaw, prefSprzetRaw, prefTaskRaw]);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(CONFLICT_FILTER_KEY);
        if (saved === 'true') setShowOnlyConflicts(true);
      } catch {
        // ignore storage read errors
      }
    })();
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(CONFLICT_FILTER_KEY, showOnlyConflicts ? 'true' : 'false');
  }, [showOnlyConflicts]);

  useEffect(() => {
    if (!token || loading) return;
    void loadReservations(token);
  }, [viewYear, viewMonth0, token, loading, loadReservations]);

  const onRefresh = () => {
    setRefreshing(true);
    void (async () => {
      if (token) {
        await loadRefs(token);
        await loadReservations(token);
      }
      setRefreshing(false);
    })();
  };

  const monthTitle = new Date(viewYear, viewMonth0, 1).toLocaleString(dateLocale, {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  };

  const statusLabel = (s: RezerwacjaStatus) => t(`fleetReserve.status.${s}`);
  const activeRows = useMemo(
    () => rows.filter((r) => r.status !== 'Anulowane' && r.status !== 'Zwrócone'),
    [rows],
  );
  const conflictKeySet = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of activeRows) {
      const key = `${String(r.sprzet_id)}|${r.data}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return new Set([...map.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [activeRows]);
  const conflictCount = useMemo(
    () => rows.filter((r) => conflictKeySet.has(`${String(r.sprzet_id)}|${r.data}`)).length,
    [rows, conflictKeySet],
  );
  const visibleRows = useMemo(() => {
    const focusedTask = taskFilterId.trim();
    const list = rows.filter((r) => {
      if (showOnlyTask && focusedTask && rowTaskId(r) !== focusedTask) return false;
      if (showOnlyConflicts && !conflictKeySet.has(`${String(r.sprzet_id)}|${r.data}`)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const aFocused = focusedTask && rowTaskId(a) === focusedTask ? 1 : 0;
      const bFocused = focusedTask && rowTaskId(b) === focusedTask ? 1 : 0;
      if (aFocused !== bFocused) return bFocused - aFocused;
      const aConflict = conflictKeySet.has(`${String(a.sprzet_id)}|${a.data}`) ? 1 : 0;
      const bConflict = conflictKeySet.has(`${String(b.sprzet_id)}|${b.data}`) ? 1 : 0;
      if (aConflict !== bConflict) return bConflict - aConflict;
      return a.data.localeCompare(b.data) || String(a.sprzet_nazwa).localeCompare(String(b.sprzet_nazwa));
    });
  }, [rows, showOnlyConflicts, showOnlyTask, taskFilterId, conflictKeySet]);
  const firstConflictIndex = useMemo(
    () => visibleRows.findIndex((r) => conflictKeySet.has(`${String(r.sprzet_id)}|${r.data}`)),
    [visibleRows, conflictKeySet],
  );
  const hasFormConflict = useMemo(() => {
    if (!formSprzetId || !isValidYmdDate(formDate)) return false;
    return rows.some((r) =>
      String(r.sprzet_id) === String(formSprzetId) &&
      r.data === formDate &&
      r.status !== 'Anulowane' &&
      r.status !== 'Zwrócone',
    );
  }, [rows, formSprzetId, formDate]);
  const dateBlocked = useMemo(() => isYmdBlocked(formDate, calendarBlocks), [formDate, calendarBlocks]);
  const canSubmitForm = useMemo(
    () =>
      Boolean(formSprzetId && formEkipaId) &&
      isValidYmdDate(formDate) &&
      !isPastYmdDate(formDate) &&
      !hasFormConflict &&
      !dateBlocked,
    [formSprzetId, formEkipaId, formDate, hasFormConflict, dateBlocked],
  );
  const dashboardStats = [
    { key: 'month', label: 'Miesiac', value: rows.length, icon: 'calendar-outline' as const, color: theme.accent },
    { key: 'active', label: 'Aktywne', value: activeRows.length, icon: 'checkmark-circle-outline' as const, color: theme.success },
    { key: 'conflict', label: 'Konflikty', value: conflictCount, icon: 'warning-outline' as const, color: conflictCount > 0 ? theme.danger : theme.success },
    { key: 'assets', label: 'Sprzet', value: sprzetList.length, icon: 'construct-outline' as const, color: theme.info },
  ];
  const submitBlockReason = useMemo(() => {
    if (canSubmitForm) return null;
    if (!formSprzetId || !formEkipaId) return t('fleetReserve.submitHint.pickRequired');
    if (!isValidYmdDate(formDate)) return t('fleetReserve.alert.badDate');
    if (isPastYmdDate(formDate)) return t('fleetReserve.alert.pastDate');
    if (dateBlocked) return t('fleetReserve.alert.calendarBlocked');
    if (hasFormConflict) return t('fleetReserve.alert.conflictOnList');
    return t('fleetReserve.submitHint.fixForm');
  }, [canSubmitForm, formSprzetId, formEkipaId, formDate, hasFormConflict, dateBlocked, t]);

  const openNewReservationModal = () => {
    if (sprzetList.length > 0) setFormSprzetId((prev) => prev ?? sprzetList[0].id);
    if (ekipyList.length > 0) setFormEkipaId((prev) => prev ?? ekipyList[0].id);
    if (taskFilterId && !formTaskId) setFormTaskId(taskFilterId);
    setModalOpen(true);
  };

  const scrollToFirstConflict = () => {
    if (firstConflictIndex < 0 || jumpBusy) return;
    setJumpBusy(true);
    if (jumpCooldownRef.current) clearTimeout(jumpCooldownRef.current);
    jumpCooldownRef.current = setTimeout(() => setJumpBusy(false), 900);
    const first = visibleRows[firstConflictIndex];
    if (!first) return;
    setHighlightedRowId(first.id);
    pulseAnim.setValue(0);
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedRowId(null), 1200);
    const y = rowOffsetsRef.current[first.id];
    if (typeof y === 'number') {
      listRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
      return;
    }
    const approxCardHeight = 220;
    listRef.current?.scrollTo({ y: Math.max(0, firstConflictIndex * approxCardHeight), animated: true });
  };

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (jumpCooldownRef.current) clearTimeout(jumpCooldownRef.current);
  }, []);

  const saveReservation = async () => {
    if (!token) return;
    if (!isValidYmdDate(formDate)) {
      void triggerHaptic('warning');
      showReservationNotice(t('fleetReserve.alert.badDate'), 'warning');
      return;
    }
    const blocks = await loadCalendarBlocks();
    setCalendarBlocks(blocks);
    if (isYmdBlocked(formDate, blocks)) {
      void triggerHaptic('warning');
      showReservationNotice(t('fleetReserve.alert.calendarBlocked'), 'warning');
      return;
    }
    if (isPastYmdDate(formDate)) {
      void triggerHaptic('warning');
      showReservationNotice(t('fleetReserve.alert.pastDate'), 'warning');
      return;
    }
    if (!formSprzetId || !formEkipaId) {
      void triggerHaptic('warning');
      showReservationNotice(t('fleetReserve.alert.pickEquipmentTeam'), 'warning');
      return;
    }
    const hasVisibleConflict = rows.some((r) =>
      String(r.sprzet_id) === String(formSprzetId) &&
      r.data === formDate &&
      r.status !== 'Anulowane' &&
      r.status !== 'Zwrócone',
    );
    if (hasVisibleConflict) {
      void triggerHaptic('warning');
      showReservationNotice(t('fleetReserve.alert.conflictOnList'), 'warning');
      return;
    }
    const sprzet = sprzetList.find((x) => x.id === formSprzetId);
    const ekipa = ekipyList.find((x) => x.id === formEkipaId);
    const taskId = toPositiveNumber(formTaskId);
    const body = {
      sprzet_id: formSprzetId,
      ekipa_id: formEkipaId,
      data_od: formDate,
      data_do: formDate,
      caly_dzien: formCalyDzien,
      status: formStatus,
      ...(taskId ? { task_id: taskId, notatki: `Plan zlecenia #${taskId}` } : {}),
    };
    const res = await postRezerwacjaApi(token, body);
    if (res.ok) {
      void triggerHaptic('success');
      setModalOpen(false);
      await loadReservations(token);
      void tryScheduleReservationDayEndReminder({
        dateYmd: formDate,
        sprzetLabel: sprzet?.nazwa ?? `#${formSprzetId}`,
      });
      showReservationNotice(t('fleetReserve.alert.savedServer'));
      return;
    }
    const canFallbackOffline = res.notImplemented || res.error === 'network';
    if (!canFallbackOffline) {
      void triggerHaptic('error');
      showReservationNotice(res.error || t('fleetReserve.alert.serverValidationError'), 'warning');
      return;
    }
    const hasLocalConflict = await hasLocalReservationConflict(formSprzetId, formDate);
    if (hasLocalConflict) {
      void triggerHaptic('error');
      showReservationNotice(t('fleetReserve.alert.localConflict'), 'warning');
      return;
    }
    await addLocalRezerwacja({
      sprzet_id: formSprzetId,
      sprzet_nazwa: sprzet?.nazwa ?? `#${formSprzetId}`,
      ekipa_id: formEkipaId,
      ekipa_nazwa: ekipa?.nazwa ?? `#${formEkipaId}`,
      data: formDate,
      caly_dzien: formCalyDzien,
      status: formStatus,
      task_id: taskId,
      notatki: taskId ? `Plan zlecenia #${taskId}` : null,
      localOnly: true,
    });
    await enqueueOfflineRequest({
      url: `${API_URL}/flota/rezerwacje`,
      method: 'POST',
      body: body as unknown as Record<string, unknown>,
    });
    void triggerHaptic('success');
    setModalOpen(false);
    await loadReservations(token);
    void tryScheduleReservationDayEndReminder({
      dateYmd: formDate,
      sprzetLabel: sprzet?.nazwa ?? `#${formSprzetId}`,
    });
    showReservationNotice(t('fleetReserve.alert.savedLocal'));
  };

  const exportMonthCsv = async () => {
    if (!rows.length) {
      showReservationNotice(t('fleetReserve.exportMonthEmpty'), 'warning');
      return;
    }
    setExportingMonth(true);
    try {
      const header = 'id,data,sprzet_id,sprzet,ekipa_id,ekipa,status,task_id,localOnly';
      const lines = rows.map((r) =>
        [
          String(r.id).replace(/,/g, ' '),
          r.data,
          String(r.sprzet_id),
          String(r.sprzet_nazwa ?? '').replace(/,/g, ' '),
          String(r.ekipa_id),
          String(r.ekipa_nazwa ?? '').replace(/,/g, ' '),
          r.status,
          rowTaskId(r),
          r.localOnly ? '1' : '0',
        ].join(','),
      );
      const csv = [header, ...lines].join('\n');
      await Clipboard.setStringAsync(csv);
      await Share.share({ title: t('fleetReserve.exportMonthTitle'), message: csv });
    } catch {
      showReservationNotice(t('fleetReserve.exportMonthFail'), 'warning');
    } finally {
      setExportingMonth(false);
    }
  };

  const changeRowStatus = async (row: SprzetRezerwacjaRow, status: RezerwacjaStatus) => {
    if (status === row.status) return;
    if (!STATUS_TRANSITIONS[row.status]?.includes(status)) {
      showReservationNotice(t('fleetReserve.alert.invalidTransition'), 'warning');
      return;
    }
    if (!token) return;
    if (String(row.id).startsWith('local-')) {
      await updateLocalStatus(row.id, status);
      await loadReservations(token);
      return;
    }
    const put = await putRezerwacjaStatusApi(token, row.id, status);
    if (put.ok) {
      await loadReservations(token);
      return;
    }
    const canQueueOffline = put.notImplemented || put.error === 'network';
    if (!canQueueOffline) {
      showReservationNotice(put.error || t('fleetReserve.alert.statusUpdateError'), 'warning');
      return;
    }
    await enqueueOfflineRequest({
      url: `${API_URL}/flota/rezerwacje/${row.id}/status`,
      method: 'PUT',
      body: { status },
    });
    showReservationNotice(t('fleetReserve.alert.statusQueued'));
  };

  const S = makeStyles(theme);

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
      <AppStatusBar />
      <View style={S.header}>
        <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="calendar-number-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Rezerwacje operacyjne</Text>
          <Text style={S.headerTitle}>{t('fleetReserve.title')}</Text>
          <Text style={S.headerSub}>Sprzet, ekipy, konflikty i wydania w jednym miesiacu.</Text>
        </View>
        <TouchableOpacity onPress={openNewReservationModal} style={S.addBtn} accessibilityRole="button">
          <Ionicons name="add" size={22} color={theme.accentText} />
        </TouchableOpacity>
      </View>

      {reservationNotice ? (
        <View
          style={[
            S.notice,
            {
              backgroundColor: reservationNotice.tone === 'warning' ? theme.warningBg : theme.successBg,
              borderColor: reservationNotice.tone === 'warning' ? theme.warning : theme.success,
            },
          ]}
        >
          <Ionicons
            name={reservationNotice.tone === 'warning' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={16}
            color={reservationNotice.tone === 'warning' ? theme.warning : theme.success}
          />
          <Text
            style={[
              S.noticeText,
              { color: reservationNotice.tone === 'warning' ? theme.warning : theme.success },
            ]}
          >
            {reservationNotice.message}
          </Text>
        </View>
      ) : null}

      <View style={S.dashboardStats}>
        {dashboardStats.map((stat) => (
          <View key={stat.key} style={[S.dashboardStat, { borderColor: stat.color + '44' }]}>
            <View style={[S.dashboardStatIcon, { backgroundColor: stat.color + '1F' }]}>
              <Ionicons name={stat.icon} size={16} color={stat.color} />
            </View>
            <Text style={S.dashboardStatValue}>{stat.value}</Text>
            <Text style={S.dashboardStatLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {apiListingDown && (
        <View style={S.banner}>
          <Ionicons name="cloud-offline-outline" size={16} color={theme.warning} />
          <Text style={S.bannerTxt}>{t('fleetReserve.localMode')}</Text>
        </View>
      )}

      <View style={S.monthRow}>
        <TouchableOpacity onPress={() => shiftMonth(-1)} style={S.monthBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.accent} />
        </TouchableOpacity>
        <Text style={S.monthTitle}>{monthTitle}</Text>
        <TouchableOpacity onPress={() => shiftMonth(1)} style={S.monthBtn}>
          <Ionicons name="chevron-forward" size={22} color={theme.accent} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[S.exportMonthBtn, exportingMonth && { opacity: 0.6 }]}
          onPress={() => void exportMonthCsv()}
          disabled={exportingMonth}
        >
          <Ionicons name="download-outline" size={18} color={theme.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={listRef}
        style={S.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />
        }
      >
        <Text style={S.hint}>{t('fleetReserve.hint')}</Text>
        <View style={S.filterRow}>
          <TouchableOpacity
            style={[S.filterBtn, showOnlyConflicts && { backgroundColor: theme.dangerBg, borderColor: theme.danger }]}
            onPress={() => setShowOnlyConflicts((v) => !v)}
          >
            <Ionicons name="alert-circle-outline" size={14} color={showOnlyConflicts ? theme.danger : theme.textMuted} />
            <Text style={[S.filterBtnTxt, showOnlyConflicts && { color: theme.danger }]}>
              {showOnlyConflicts ? t('fleetReserve.filter.all') : t('fleetReserve.filter.onlyConflicts')}
            </Text>
            <View style={[S.filterCountBadge, showOnlyConflicts && { backgroundColor: theme.danger }]}>
              <Text style={[S.filterCountTxt, showOnlyConflicts && { color: theme.accentText }]}>
                {String(conflictCount)}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.jumpBtn, (firstConflictIndex < 0 || jumpBusy) && { opacity: 0.5 }]}
            onPress={scrollToFirstConflict}
            disabled={firstConflictIndex < 0 || jumpBusy}
          >
            <Ionicons name="arrow-down-circle-outline" size={14} color={theme.textMuted} />
            <Text style={S.jumpBtnTxt}>
              {jumpBusy ? t('fleetReserve.filter.scrolling') : t('fleetReserve.filter.firstConflict')}
            </Text>
          </TouchableOpacity>
        </View>
        {taskFilterId ? (
          <View style={S.taskContextBox}>
            <View style={S.taskContextHead}>
              <View style={[S.taskContextIcon, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                <Ionicons name="briefcase-outline" size={16} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.taskContextTitle}>Zlecenie #{taskFilterId}</Text>
                <Text style={S.taskContextSub}>
                  Rezerwacje sprzetu przypiete do konkretnej pracy.
                </Text>
              </View>
            </View>
            <View style={S.taskContextActions}>
              <TouchableOpacity
                style={[S.taskContextBtn, showOnlyTask && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                onPress={() => setShowOnlyTask((value) => !value)}
              >
                <Text style={[S.taskContextBtnText, showOnlyTask && { color: theme.accentText }]}>
                  {showOnlyTask ? 'Tylko to zlecenie' : 'Wszystkie'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.taskContextBtn}
                onPress={() => router.push(`/zlecenie/${taskFilterId}` as never)}
              >
                <Ionicons name="open-outline" size={13} color={theme.accent} />
                <Text style={[S.taskContextBtnText, { color: theme.accent }]}>Karta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.taskContextBtn}
                onPress={() => {
                  setTaskFilterId('');
                  setShowOnlyTask(false);
                  setFormTaskId('');
                }}
              >
                <Ionicons name="close-outline" size={13} color={theme.textMuted} />
                <Text style={S.taskContextBtnText}>Wyczysc</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        <View style={S.flowBox}>
          <Text style={S.flowTitle}>{t('fleetReserve.flowTitle')}</Text>
          <View style={S.flowRow}>
            <Ionicons name="add-circle-outline" size={14} color={theme.info} />
            <Text style={S.flowLine}>{t('fleetReserve.flowLine1')}</Text>
          </View>
          <View style={S.flowRow}>
            <Ionicons name="git-branch-outline" size={14} color={theme.accent} />
            <Text style={S.flowLine}>{t('fleetReserve.flowLine2')}</Text>
          </View>
        </View>
        {visibleRows.length === 0 ? (
          <View style={S.empty}>
            <Text style={S.emptyTxt}>
              {showOnlyConflicts ? t('fleetReserve.emptyConflicts') : t('fleetReserve.empty')}
            </Text>
          </View>
        ) : (
          visibleRows.map((row) => (
            (() => {
              const conflictKey = `${String(row.sprzet_id)}|${row.data}`;
              const hasConflict = conflictKeySet.has(conflictKey);
              const isHighlighted = highlightedRowId === row.id;
              const pulseScale = pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.015],
              });
              const pulseOpacity = pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.92],
              });
              return (
            <Animated.View
              key={row.id}
              onLayout={(evt) => {
                rowOffsetsRef.current[row.id] = evt.nativeEvent.layout.y;
              }}
              style={[
                S.card,
                row.localOnly && { borderLeftColor: theme.warning },
                taskFilterId && rowTaskId(row) === taskFilterId && { borderLeftColor: theme.info, backgroundColor: theme.surface2 },
                isHighlighted && {
                  borderColor: theme.accent,
                  borderWidth: 2,
                  backgroundColor: theme.surface2,
                },
                isHighlighted && {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            >
              <View style={S.cardTop}>
                <Text style={S.cardMain}>{row.sprzet_nazwa}</Text>
                <View style={S.pillWrap}>
                  {hasConflict && (
                    <View style={[S.pill, { backgroundColor: theme.danger }]}>
                      <Text style={S.pillTxt}>{t('fleetReserve.badgeConflict')}</Text>
                    </View>
                  )}
                  {row.localOnly && (
                    <View style={[S.pill, { backgroundColor: theme.warning }]}>
                      <Text style={S.pillTxt}>{t('fleetReserve.badgeLocal')}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={S.metaRow}>
                <Ionicons name="people-outline" size={14} color={theme.textMuted} />
                <Text style={S.metaTxt}>{row.ekipa_nazwa}</Text>
              </View>
              {rowTaskId(row) ? (
                <TouchableOpacity
                  style={S.taskMetaRow}
                  onPress={() => router.push(`/zlecenie/${rowTaskId(row)}` as never)}
                >
                  <Ionicons name="briefcase-outline" size={14} color={theme.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={S.taskMetaText}>{taskReservationLabel(row)}</Text>
                    {row.task_adres ? <Text style={S.taskMetaSub} numberOfLines={1}>{row.task_adres}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
                </TouchableOpacity>
              ) : null}
              <View style={S.metaRow}>
                <Ionicons name="calendar-outline" size={14} color={theme.textMuted} />
                <Text style={S.metaTxt}>
                  {row.data}
                  {row.caly_dzien ? ` · ${t('fleetReserve.fullDay')}` : ''}
                </Text>
              </View>
              <View style={S.metaRow}>
                <Ionicons name="flag-outline" size={14} color={theme.accent} />
                <Text style={[S.metaTxt, { color: theme.accent, fontWeight: '600' }]}>{statusLabel(row.status)}</Text>
              </View>
              <Text style={S.statusHint}>{t('fleetReserve.statusChangeHint')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.statusRow}>
                {REZERWACJA_STATUSY.map((st) => (
                  (() => {
                    const isAllowedTransition = row.status === st || STATUS_TRANSITIONS[row.status]?.includes(st);
                    return (
                  <TouchableOpacity
                    key={st}
                    style={[
                      S.statusChip,
                      row.status === st && { backgroundColor: theme.accent },
                      !isAllowedTransition && { opacity: 0.45 },
                    ]}
                    onPress={() => {
                      if (!isAllowedTransition) return;
                      void changeRowStatus(row, st);
                    }}
                    disabled={!isAllowedTransition}
                  >
                    <Text style={[S.statusChipTxt, row.status === st && { color: theme.accentText }]}>{statusLabel(st)}</Text>
                  </TouchableOpacity>
                    );
                  })()
                ))}
              </ScrollView>
            </Animated.View>
              );
            })()
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={S.overlay}>
            <View style={S.modalBox}>
              <View style={S.modalHeader}>
                <Text style={S.modalTitle}>{t('fleetReserve.newTitle')}</Text>
                <TouchableOpacity onPress={() => setModalOpen(false)}>
                  <Ionicons name="close" size={24} color={theme.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={S.fieldLbl}>{t('fleetReserve.fieldDate')}</Text>
                <TextInput
                  style={S.input}
                  value={formDate}
                  onChangeText={setFormDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textMuted}
                />

                <Text style={S.fieldLbl}>Zlecenie (opcjonalnie)</Text>
                <TextInput
                  style={S.input}
                  value={formTaskId}
                  onChangeText={(value) => setFormTaskId(onlyDigits(value))}
                  placeholder="ID zlecenia"
                  keyboardType="number-pad"
                  placeholderTextColor={theme.textMuted}
                />

                <Text style={S.fieldLbl}>{t('fleetReserve.fieldEquipment')}</Text>
                <ScrollView style={S.pickerScroll} nestedScrollEnabled>
                  {sprzetList.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[S.pickRow, formSprzetId === s.id && { borderWidth: 2, borderColor: theme.accent }]}
                      onPress={() => setFormSprzetId(s.id)}
                    >
                      <Text style={S.pickTxt}>{s.nazwa}{s.typ ? ` · ${s.typ}` : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={S.fieldLbl}>{t('fleetReserve.fieldTeam')}</Text>
                <ScrollView style={S.pickerScroll} nestedScrollEnabled>
                  {ekipyList.map((e) => (
                    <TouchableOpacity
                      key={e.id}
                      style={[S.pickRow, formEkipaId === e.id && { borderWidth: 2, borderColor: theme.accent }]}
                      onPress={() => setFormEkipaId(e.id)}
                    >
                      <Text style={S.pickTxt}>{e.nazwa}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={S.switchRow}>
                  <Text style={S.fieldLbl}>{t('fleetReserve.fieldFullDay')}</Text>
                  <Switch value={formCalyDzien} onValueChange={setFormCalyDzien} trackColor={{ true: theme.accent }} />
                </View>

                <Text style={S.fieldLbl}>{t('fleetReserve.fieldStatusRequired')}</Text>
                <View style={S.modalInfoBox}>
                  <View style={S.flowRow}>
                    <Ionicons name="add-circle-outline" size={14} color={theme.info} />
                    <Text style={S.modalInfoText}>{t('fleetReserve.flowLine1')}</Text>
                  </View>
                  <View style={S.flowRow}>
                    <Ionicons name="git-branch-outline" size={14} color={theme.accent} />
                    <Text style={S.modalInfoText}>{t('fleetReserve.flowLine2')}</Text>
                  </View>
                </View>
                {hasFormConflict && (
                  <View style={S.conflictWarnBox}>
                    <Ionicons name="warning-outline" size={15} color={theme.danger} />
                    <Text style={S.conflictWarnTxt}>{t('fleetReserve.alert.conflictOnList')}</Text>
                  </View>
                )}
                <View style={S.statusWrap}>
                  {CREATE_ALLOWED_STATUSES.map((st) => (
                    <TouchableOpacity
                      key={st}
                      style={[S.statusChip, formStatus === st && { backgroundColor: theme.accent }]}
                      onPress={() => setFormStatus(st)}
                    >
                      <Text style={[S.statusChipTxt, formStatus === st && { color: theme.accentText }]}>{statusLabel(st)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={S.modalBtns}>
                  <TouchableOpacity style={S.cancelBtn} onPress={() => setModalOpen(false)}>
                    <Text style={S.cancelTxt}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <PlatinumCTA
                    style={[S.saveBtn, !canSubmitForm && { opacity: 0.5 }]}
                    label={t('fleetReserve.save')}
                    onPress={() => void saveReservation()}
                    disabled={!canSubmitForm}
                  />
                </View>
                {!canSubmitForm && (
                  <Text style={S.submitHintTxt}>{submitBlockReason}</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    header: {
      backgroundColor: theme.cardBg,
      marginHorizontal: 14,
      marginTop: 12,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingTop: 18,
      paddingBottom: 16,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      ...shadowStyle(theme, {
        opacity: theme.shadowOpacity * 0.14,
        radius: theme.shadowRadius * 0.45,
        offsetY: 3,
        elevation: theme.cardElevation + 1,
      }),
    },
    backBtn: {
      width: 42,
      height: 42,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accentLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTextBox: { flex: 1, minWidth: 0 },
    headerEyebrow: {
      color: theme.textMuted,
      fontSize: 10,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0,
    },
    headerTitle: { color: theme.text, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 2 },
    headerSub: { color: theme.textSub, fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 2 },
    addBtn: {
      width: 42,
      height: 42,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.accentDark,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notice: {
      marginHorizontal: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderRadius: 7,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    noticeText: { flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 16 },
    dashboardStats: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: 14,
      marginBottom: 8,
      gap: 8,
    },
    dashboardStat: {
      flexGrow: 1,
      flexBasis: '22%',
      minWidth: 74,
      backgroundColor: theme.cardBg,
      borderRadius: 7,
      padding: 10,
      alignItems: 'center',
      borderWidth: 1,
      gap: 3,
    },
    dashboardStatIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    dashboardStatValue: { color: theme.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
    dashboardStatLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '800', textAlign: 'center' },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 14,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 6,
      backgroundColor: theme.warningBg,
      borderWidth: 1,
      borderColor: theme.warning,
    },
    bannerTxt: { flex: 1, fontSize: 13, color: theme.textSub, fontWeight: '700' },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: 14,
      marginBottom: 8,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      backgroundColor: theme.cardBg,
    },
    monthBtn: { padding: 8, borderRadius: 7, backgroundColor: theme.surface2 },
    monthTitle: { flex: 1, fontSize: 16, fontWeight: '900', color: theme.text, textTransform: 'capitalize', textAlign: 'center' },
    exportMonthBtn: { padding: 8 },
    scroll: { flex: 1 },
    hint: { fontSize: 13, color: theme.textMuted, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, fontWeight: '700', lineHeight: 18 },
    flowBox: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 10,
      borderRadius: 7,
      backgroundColor: theme.cardBg,
      borderWidth: 1,
      borderColor: theme.cardBorder,
    },
    flowTitle: { color: theme.text, fontWeight: '900', fontSize: 13, marginBottom: 4 },
    flowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    flowLine: { color: theme.textMuted, fontSize: 12, marginBottom: 2, fontWeight: '700' },
    filterRow: {
      paddingHorizontal: 16,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    filterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.cardBg,
    },
    filterBtnTxt: {
      fontSize: 12,
      fontWeight: '800',
      color: theme.textMuted,
    },
    filterCountBadge: {
      minWidth: 20,
      height: 20,
      borderRadius: 6,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.border,
    },
    filterCountTxt: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.text,
    },
    jumpBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.cardBg,
    },
    jumpBtnTxt: {
      fontSize: 12,
      fontWeight: '800',
      color: theme.textMuted,
    },
    taskContextBox: {
      marginHorizontal: 16,
      marginBottom: 10,
      padding: 12,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.cardBg,
      gap: 10,
    },
    taskContextHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    taskContextIcon: {
      width: 34,
      height: 34,
      borderRadius: 7,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    taskContextTitle: { color: theme.text, fontSize: 14, fontWeight: '900' },
    taskContextSub: { color: theme.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
    taskContextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    taskContextBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
    },
    taskContextBtnText: { color: theme.textMuted, fontSize: 12, fontWeight: '900' },
    modalInfoBox: {
      marginHorizontal: 16,
      marginBottom: 10,
      padding: 10,
      borderRadius: 8,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    modalInfoText: {
      color: theme.textMuted,
      fontSize: 12,
      marginBottom: 2,
    },
    conflictWarnBox: {
      marginHorizontal: 16,
      marginBottom: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.danger,
      backgroundColor: theme.dangerBg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    conflictWarnTxt: {
      flex: 1,
      color: theme.danger,
      fontSize: 12,
      fontWeight: '600',
    },
    empty: { padding: 24, alignItems: 'center' },
    emptyTxt: { color: theme.textMuted, fontSize: 15, fontWeight: '800' },
    card: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 14,
      borderRadius: 7,
      backgroundColor: theme.cardBg,
      borderLeftWidth: 4,
      borderLeftColor: theme.accent,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      ...shadowStyle(theme, {
        opacity: theme.shadowOpacity * 0.09,
        radius: theme.shadowRadius * 0.3,
        offsetY: 1,
        elevation: Math.max(1, theme.cardElevation - 1),
      }),
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
    cardMain: { fontSize: 17, fontWeight: '900', color: theme.text, flex: 1 },
    pillWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 },
    pillTxt: { fontSize: 11, fontWeight: '900', color: theme.accentText },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    metaTxt: { fontSize: 14, color: theme.textSub, fontWeight: '700' },
    taskMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      marginBottom: 6,
    },
    taskMetaText: { color: theme.accent, fontSize: 13, fontWeight: '900' },
    taskMetaSub: { color: theme.textMuted, fontSize: 11, fontWeight: '700', marginTop: 1 },
    statusHint: { fontSize: 12, color: theme.textMuted, marginTop: 8, marginBottom: 6, fontWeight: '700' },
    statusRow: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
    statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
    statusChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 5,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    statusChipTxt: { fontSize: 12, fontWeight: '800', color: theme.text },
    overlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.88)', justifyContent: 'flex-end' },
    modalBox: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: '88%',
      paddingBottom: 24,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    modalTitle: { fontSize: 18, fontWeight: '700', color: theme.text },
    fieldLbl: { fontSize: 13, fontWeight: '600', color: theme.textMuted, marginTop: 12, marginBottom: 6, marginHorizontal: 16 },
    input: {
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      padding: 12,
      fontSize: 16,
      color: theme.text,
      backgroundColor: theme.bg,
    },
    pickerScroll: { maxHeight: 140, marginHorizontal: 16, borderWidth: 1, borderColor: theme.border, borderRadius: 6 },
    pickRow: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    pickTxt: { fontSize: 15, color: theme.text },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: 16,
      marginTop: 8,
    },
    modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20, marginHorizontal: 16 },
    cancelBtn: { paddingVertical: 12, paddingHorizontal: 16 },
    cancelTxt: { color: theme.textMuted, fontWeight: '600' },
    saveBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 6 },
    submitHintTxt: {
      marginTop: 8,
      marginHorizontal: 16,
      color: theme.textMuted,
      fontSize: 12,
    },
  });
}
