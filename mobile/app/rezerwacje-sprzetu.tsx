import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { type CalendarBlock, isYmdBlocked, loadCalendarBlocks } from '../utils/calendar-blocks';
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

const CREATE_ALLOWED_STATUSES: RezerwacjaStatus[] = ['Zarezerwowane', 'Wydane'];

const STATUS_TRANSITIONS: Record<RezerwacjaStatus, RezerwacjaStatus[]> = {
  Zarezerwowane: ['Wydane', 'Anulowane'],
  Wydane: ['Zwrócone', 'Anulowane'],
  Zwrócone: [],
  Anulowane: [],
};
const CONFLICT_FILTER_KEY = 'fleet_reservation_conflict_filter_v1';

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
  const params = useLocalSearchParams<{ prefData?: string | string[]; prefZlecenie?: string | string[] }>();
  const prefDataRaw = Array.isArray(params.prefData) ? params.prefData[0] : params.prefData;
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

  const [sprzetList, setSprzetList] = useState<{ id: number; nazwa: string; typ?: string }[]>([]);
  const [ekipyList, setEkipyList] = useState<{ id: number; nazwa: string }[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [formSprzetId, setFormSprzetId] = useState<number | null>(null);
  const [formEkipaId, setFormEkipaId] = useState<number | null>(null);
  const [formCalyDzien, setFormCalyDzien] = useState(true);
  const [formStatus, setFormStatus] = useState<RezerwacjaStatus>('Zarezerwowane');
  const listRef = useRef<ScrollView | null>(null);
  const rowOffsetsRef = useRef<Record<string, number>>({});
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [jumpBusy, setJumpBusy] = useState(false);
  const jumpCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([]);
  const [exportingMonth, setExportingMonth] = useState(false);

  const { from, to } = useMemo(() => monthRange(viewYear, viewMonth0), [viewYear, viewMonth0]);

  const loadRefs = useCallback(async (auth: string) => {
    const h = { Authorization: `Bearer ${auth}` };
    const [sRes, eRes] = await Promise.all([
      fetch(`${API_URL}/flota/sprzet`, { headers: h }),
      fetch(`${API_URL}/ekipy`, { headers: h }),
    ]);
    if (sRes.ok) {
      const d = await sRes.json();
      setSprzetList(Array.isArray(d) ? d.map((x: any) => ({ id: x.id, nazwa: x.nazwa, typ: x.typ })) : []);
    }
    if (eRes.ok) {
      const d = await eRes.json();
      setEkipyList(Array.isArray(d) ? d.map((x: any) => ({ id: x.id, nazwa: x.nazwa })) : []);
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
    if (!showOnlyConflicts) {
      return [...rows].sort((a, b) => {
        const aConflict = conflictKeySet.has(`${String(a.sprzet_id)}|${a.data}`) ? 1 : 0;
        const bConflict = conflictKeySet.has(`${String(b.sprzet_id)}|${b.data}`) ? 1 : 0;
        return bConflict - aConflict;
      });
    }
    return rows.filter((r) => conflictKeySet.has(`${String(r.sprzet_id)}|${r.data}`));
  }, [rows, showOnlyConflicts, conflictKeySet]);
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
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.badDate'));
      return;
    }
    const blocks = await loadCalendarBlocks();
    setCalendarBlocks(blocks);
    if (isYmdBlocked(formDate, blocks)) {
      void triggerHaptic('warning');
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.calendarBlocked'));
      return;
    }
    if (isPastYmdDate(formDate)) {
      void triggerHaptic('warning');
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.pastDate'));
      return;
    }
    if (!formSprzetId || !formEkipaId) {
      void triggerHaptic('warning');
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.pickEquipmentTeam'));
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
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.conflictOnList'));
      return;
    }
    const sprzet = sprzetList.find((x) => x.id === formSprzetId);
    const ekipa = ekipyList.find((x) => x.id === formEkipaId);
    const body = {
      sprzet_id: formSprzetId,
      ekipa_id: formEkipaId,
      data_od: formDate,
      data_do: formDate,
      caly_dzien: formCalyDzien,
      status: formStatus,
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
      Alert.alert(t('wyceny.alert.savedTitle'), t('fleetReserve.alert.savedServer'));
      return;
    }
    const canFallbackOffline = res.notImplemented || res.error === 'network';
    if (!canFallbackOffline) {
      void triggerHaptic('error');
      Alert.alert(t('wyceny.alert.saveFail'), res.error || t('fleetReserve.alert.serverValidationError'));
      return;
    }
    const hasLocalConflict = await hasLocalReservationConflict(formSprzetId, formDate);
    if (hasLocalConflict) {
      void triggerHaptic('error');
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.localConflict'));
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
    Alert.alert(t('wyceny.alert.savedTitle'), t('fleetReserve.alert.savedLocal'));
  };

  const exportMonthCsv = async () => {
    if (!rows.length) {
      Alert.alert(t('fleetReserve.exportMonthTitle'), t('fleetReserve.exportMonthEmpty'));
      return;
    }
    setExportingMonth(true);
    try {
      const header = 'id,data,sprzet_id,sprzet,ekipa_id,ekipa,status,localOnly';
      const lines = rows.map((r) =>
        [
          String(r.id).replace(/,/g, ' '),
          r.data,
          String(r.sprzet_id),
          String(r.sprzet_nazwa ?? '').replace(/,/g, ' '),
          String(r.ekipa_id),
          String(r.ekipa_nazwa ?? '').replace(/,/g, ' '),
          r.status,
          r.localOnly ? '1' : '0',
        ].join(','),
      );
      const csv = [header, ...lines].join('\n');
      await Clipboard.setStringAsync(csv);
      await Share.share({ title: t('fleetReserve.exportMonthTitle'), message: csv });
    } catch {
      Alert.alert(t('fleetReserve.exportMonthTitle'), t('fleetReserve.exportMonthFail'));
    } finally {
      setExportingMonth(false);
    }
  };

  const changeRowStatus = async (row: SprzetRezerwacjaRow, status: RezerwacjaStatus) => {
    if (status === row.status) return;
    if (!STATUS_TRANSITIONS[row.status]?.includes(status)) {
      Alert.alert(t('wyceny.alert.saveFail'), t('fleetReserve.alert.invalidTransition'));
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
      Alert.alert(t('wyceny.alert.saveFail'), put.error || t('fleetReserve.alert.statusUpdateError'));
      return;
    }
    await enqueueOfflineRequest({
      url: `${API_URL}/flota/rezerwacje/${row.id}/status`,
      method: 'PUT',
      body: { status },
    });
    Alert.alert(t('wyceny.alert.savedTitle'), t('fleetReserve.alert.statusQueued'));
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
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader
        title={t('fleetReserve.title')}
        right={
          <TouchableOpacity onPress={openNewReservationModal} accessibilityRole="button">
            <Ionicons name="add-circle-outline" size={26} color={theme.headerText} />
          </TouchableOpacity>
        }
      />

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
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: theme.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    bannerTxt: { flex: 1, fontSize: 13, color: theme.textSub },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    monthBtn: { padding: 8 },
    monthTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.text, textTransform: 'capitalize', textAlign: 'center' },
    exportMonthBtn: { padding: 8 },
    scroll: { flex: 1 },
    hint: { fontSize: 13, color: theme.textMuted, padding: 16, paddingBottom: 8 },
    flowBox: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 10,
      borderRadius: 10,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    flowTitle: { color: theme.text, fontWeight: '700', fontSize: 13, marginBottom: 4 },
    flowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    flowLine: { color: theme.textMuted, fontSize: 12, marginBottom: 2 },
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
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    filterBtnTxt: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textMuted,
    },
    filterCountBadge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
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
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    jumpBtnTxt: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textMuted,
    },
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
    emptyTxt: { color: theme.textMuted, fontSize: 15 },
    card: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 14,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderLeftWidth: 4,
      borderLeftColor: theme.accent,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
        android: { elevation: 2 },
      }),
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    cardMain: { fontSize: 17, fontWeight: '700', color: theme.text, flex: 1 },
    pillWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    pillTxt: { fontSize: 11, fontWeight: '700', color: theme.accentText },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    metaTxt: { fontSize: 14, color: theme.textSub },
    statusHint: { fontSize: 12, color: theme.textMuted, marginTop: 8, marginBottom: 6 },
    statusRow: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
    statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
    statusChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: theme.border,
    },
    statusChipTxt: { fontSize: 12, fontWeight: '600', color: theme.text },
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
      borderRadius: 10,
      padding: 12,
      fontSize: 16,
      color: theme.text,
      backgroundColor: theme.bg,
    },
    pickerScroll: { maxHeight: 140, marginHorizontal: 16, borderWidth: 1, borderColor: theme.border, borderRadius: 10 },
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
    saveBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10 },
    submitHintTxt: {
      marginTop: 8,
      marginHorizontal: 16,
      color: theme.textMuted,
      fontSize: 12,
    },
  });
}
