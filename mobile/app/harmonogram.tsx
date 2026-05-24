import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Linking, Modal, RefreshControl, ScrollView, Share,
  StyleSheet, StatusBar, Text, TouchableOpacity, View
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { subscribeOfflineFlushDone, subscribeTaskSync } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';
import { openAddressInMaps, openRouteInMaps } from '../utils/maps-link';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { getTaskFieldExecutionSummary } from '../utils/task-field-execution';
import { TASK_STATUS, isTaskClosed, makeTaskStatusColorMap } from '../constants/task-workflow';

const FIELD_PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Wycena', icon: 'camera-outline' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline' },
] as const;
type ReadinessIconName = React.ComponentProps<typeof PlatinumIconBadge>['icon'];

type EquipmentReservation = {
  id: string | number;
  sprzet_id?: string | number | null;
  sprzet_nazwa?: string | null;
  ekipa_id?: string | number | null;
  ekipa_nazwa?: string | null;
  data_od?: string | null;
  data_do?: string | null;
  status?: string | null;
  task_id?: string | number | null;
  task_klient_nazwa?: string | null;
  notatki?: string | null;
};

function taskNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateKey(value: unknown) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function parseTaskDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function taskTimeLabel(task: any) {
  if (task?.godzina_rozpoczecia) return String(task.godzina_rozpoczecia).slice(0, 5);
  const raw = String(task?.data_planowana || '');
  if (!raw.includes('T')) return '--:--';
  const d = parseTaskDate(raw);
  if (!d) return '--:--';
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(d);
}

function taskStartMinutes(task: any) {
  const label = taskTimeLabel(task);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(label)) return null;
  const [h, m] = label.split(':').map(Number);
  return h * 60 + m;
}

function taskDurationMinutes(task: any) {
  const hours = taskNumber(task?.czas_planowany_godziny ?? task?.czas_realizacji_godz);
  return Math.max(15, Math.round((hours > 0 ? hours : 2) * 60));
}

function minutesLabel(value: number) {
  const minutes = Math.max(0, Math.round(value));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function taskEndTimeLabel(task: any) {
  const start = taskStartMinutes(task);
  if (start == null) return '--:--';
  return minutesLabel(start + taskDurationMinutes(task));
}

function taskSortValue(task: any) {
  const d = parseTaskDate(task?.data_planowana);
  return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
}

function sortRouteTasks(a: any, b: any) {
  const priority = (task: any) => {
    if (task?.status === TASK_STATUS.W_REALIZACJI) return 0;
    if (task?.status === TASK_STATUS.ZAPLANOWANE) return 1;
    if (isTaskClosed(task?.status)) return 4;
    return 2;
  };
  const byStatus = priority(a) - priority(b);
  if (byStatus !== 0) return byStatus;
  const byDate = taskSortValue(a) - taskSortValue(b);
  if (byDate !== 0) return byDate;
  return Number(a?.id || 0) - Number(b?.id || 0);
}

function taskPhotoReadyCount(task: any) {
  return FIELD_PHOTO_REQUIREMENTS.filter((item) => taskNumber(task?.[item.key]) > 0).length;
}

function taskFieldNotes(task: any) {
  return String(task?.notatki_wewnetrzne || task?.opis || '');
}

function isFieldHandoffTask(task: any) {
  const notes = taskFieldNotes(task);
  return Boolean(
    task?.ankieta_uproszczona ||
    notes.includes('TRYB TERENOWY') ||
    notes.includes('FORMULARZ WYCENY TERENOWEJ') ||
    notes.includes('PRZEKAZANIE DO BIURA'),
  );
}

function protocolLine(task: any, label: string) {
  const prefix = `${label}:`;
  const line = taskFieldNotes(task)
    .split(/\r?\n/)
    .find((item) => item.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

function compactProtocolValue(value: string, fallback: string) {
  const clean = String(value || '').trim();
  return clean && clean !== '-' ? clean : fallback;
}

function taskHandoffSummary(task: any) {
  return {
    work: compactProtocolValue(protocolLine(task, 'Zakres prac'), task?.typ_uslugi || 'zakres z karty'),
    risks: compactProtocolValue(protocolLine(task, 'Ryzyka'), 'brak ryzyk'),
    access: compactProtocolValue(protocolLine(task, 'Dostęp / parking / uwagi posesji'), 'brak uwag dojazdu'),
    result: compactProtocolValue(protocolLine(task, 'Wynik rozmowy'), 'wynik w karcie'),
  };
}

function taskFieldReadyChecks(task: any) {
  const photoReady = taskPhotoReadyCount(task) >= FIELD_PHOTO_REQUIREMENTS.length;
  return [
    { key: 'team', label: 'Ekipa', ok: !!task?.ekipa_id || !!task?.ekipa_nazwa },
    { key: 'time', label: 'Czas', ok: taskNumber(task?.czas_planowany_godziny) > 0 },
    { key: 'photos', label: 'Foto', ok: photoReady },
    { key: 'price', label: 'Cena', ok: taskNumber(task?.wartosc_planowana) > 0 },
  ];
}

function countScheduleConflicts(tasks: any[]) {
  const planned = tasks
    .map((task) => {
      const start = taskStartMinutes(task);
      if (start == null) return null;
      return { start, end: start + taskDurationMinutes(task) };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.start - b.start) as { start: number; end: number }[];
  let conflicts = 0;
  let previousEnd = -1;
  for (const slot of planned) {
    if (slot.start < previousEnd) conflicts += 1;
    previousEnd = Math.max(previousEnd, slot.end);
  }
  return conflicts;
}

function hasTaskAddress(task: any) {
  return Boolean(String(task?.adres || '').trim() || String(task?.miasto || '').trim());
}

function taskAddressLabel(task: any) {
  return [task?.adres, task?.miasto].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
}

function taskPhoneNumber(task: any) {
  return String(task?.klient_telefon || task?.telefon || '').trim();
}

async function openTaskPhone(task: any) {
  const phone = taskPhoneNumber(task).replace(/\s+/g, '');
  if (!phone) return;
  await Linking.openURL(`tel:${phone}`);
}

function readinessIconForKey(key: unknown): ReadinessIconName {
  const normalized = String(key || '').toLowerCase();
  if (normalized.includes('photo') || normalized.includes('zdj') || normalized.includes('dowod')) return 'images-outline';
  if (normalized.includes('scope') || normalized.includes('brief') || normalized.includes('zakres')) return 'list-outline';
  if (normalized.includes('money') || normalized.includes('price') || normalized.includes('cena')) return 'cash-outline';
  if (normalized.includes('time') || normalized.includes('hour') || normalized.includes('czas')) return 'time-outline';
  if (normalized.includes('team') || normalized.includes('ekipa')) return 'people-outline';
  if (normalized.includes('slot') || normalized.includes('date') || normalized.includes('termin')) return 'calendar-number-outline';
  if (normalized.includes('equipment') || normalized.includes('sprzet')) return 'cube-outline';
  if (normalized.includes('risk') || normalized.includes('bhp')) return 'shield-checkmark-outline';
  if (normalized.includes('address') || normalized.includes('adres')) return 'location-outline';
  return 'checkmark-circle-outline';
}

function apiReadinessChecks(task: any, field: string) {
  const rows = Array.isArray(task?.[field]) ? task[field] : [];
  return rows
    .map((row: any) => {
      const key = String(row?.key || '').trim();
      const label = String(row?.label || key || '').trim();
      if (!label) return null;
      const ok = row?.ready === true || row?.ok === true;
      return {
        key: key || label,
        label,
        value: row?.value != null ? String(row.value) : ok ? 'OK' : 'brak',
        ok,
        icon: readinessIconForKey(key || label),
      };
    })
    .filter(Boolean) as { key: string; label: string; value: string; ok: boolean; icon: ReadinessIconName }[];
}

function taskScopeReady(task: any) {
  return Boolean(
    compactProtocolValue(protocolLine(task, 'Zakres prac'), '') ||
    task?.opis ||
    task?.opis_pracy ||
    task?.typ_uslugi,
  );
}

function taskRiskReady(task: any) {
  const riskLine = compactProtocolValue(protocolLine(task, 'Ryzyka'), '');
  if (riskLine) return true;
  const raw = taskFieldNotes(task).toLowerCase();
  return /ryzyk|bhp|zgod|linie|ogrodzenie|dach|elewac|trudny dojazd|ruch pieszy|brak szczegolnych/.test(raw);
}

function taskEquipmentCount(task: any, equipmentRows: EquipmentReservation[]) {
  if (equipmentRows.length > 0) return equipmentRows.length;
  const ids = task?.sprzet_ids ?? task?.sprzetIds;
  if (Array.isArray(ids)) return ids.filter(Boolean).length;
  if (typeof ids === 'string') return ids.split(',').map((id) => id.trim()).filter(Boolean).length;
  const flags = ['rebak', 'pila_wysiegniku', 'nozyce_dlugie', 'kosiarka', 'podkaszarka', 'lopata', 'mulczer', 'arborysta'];
  return flags.filter((key) => Boolean(task?.[key])).length;
}

function taskExecutionReadyChecks(task: any, equipmentRows: EquipmentReservation[]) {
  const apiChecks = apiReadinessChecks(task, 'crew_execution_checks');
  if (apiChecks.length) return apiChecks;
  const photoCount = taskPhotoReadyCount(task);
  const hours = taskNumber(task?.czas_planowany_godziny ?? task?.czas_realizacji_godz);
  const value = taskNumber(task?.wartosc_planowana ?? task?.budzet ?? task?.wartosc_zaproponowana ?? task?.wartosc_szacowana);
  const equipmentCount = taskEquipmentCount(task, equipmentRows);
  return [
    { key: 'address', label: 'Adres', value: hasTaskAddress(task) ? 'OK' : 'brak', ok: hasTaskAddress(task), icon: 'location-outline' as const },
    { key: 'scope', label: 'Zakres', value: taskScopeReady(task) ? 'OK' : 'brak', ok: taskScopeReady(task), icon: 'list-outline' as const },
    { key: 'photos', label: 'Dowody', value: `${photoCount}/${FIELD_PHOTO_REQUIREMENTS.length}`, ok: photoCount >= FIELD_PHOTO_REQUIREMENTS.length, icon: 'camera-outline' as const },
    { key: 'money', label: 'Cena/czas', value: value > 0 && hours > 0 ? 'OK' : 'brak', ok: value > 0 && hours > 0, icon: 'cash-outline' as const },
    { key: 'team', label: 'Ekipa', value: task?.ekipa_nazwa || (task?.ekipa_id ? `#${task.ekipa_id}` : 'brak'), ok: Boolean(task?.ekipa_id || task?.ekipa_nazwa), icon: 'people-outline' as const },
    { key: 'equipment', label: 'Sprzet', value: equipmentCount > 0 ? `${equipmentCount}` : 'brak', ok: equipmentCount > 0, icon: 'cube-outline' as const },
    { key: 'risk', label: 'BHP', value: taskRiskReady(task) ? 'OK' : 'brak', ok: taskRiskReady(task), icon: 'shield-checkmark-outline' as const },
  ];
}

function fieldExecutionToneColor(tone: string, theme: Theme) {
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  if (tone === 'danger') return theme.danger;
  return theme.textMuted;
}

function isActiveReservation(row: EquipmentReservation) {
  const status = String(row.status || '').toLowerCase();
  return !status.startsWith('anul') && !status.startsWith('zwr');
}

function reservationCoversDay(row: EquipmentReservation, day: string) {
  if (!day) return false;
  const from = dateKey(row.data_od);
  const to = dateKey(row.data_do) || from;
  return Boolean(from && day >= from && day <= to);
}

function reservationDisplayName(row: EquipmentReservation) {
  return String(row.sprzet_nazwa || (row.sprzet_id ? `Sprzet #${row.sprzet_id}` : 'Sprzet'));
}

function taskMapSearchLink(task: any) {
  const address = taskAddressLabel(task);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
}

function taskBriefScope(task: any) {
  return compactProtocolValue(
    protocolLine(task, 'Zakres prac'),
    task?.opis_pracy || task?.opis || task?.typ_uslugi || 'zakres w karcie zlecenia',
  );
}

function taskBriefEquipmentLabel(rows: EquipmentReservation[]) {
  return rows.length ? rows.map(reservationDisplayName).join(', ') : 'brak rezerwacji';
}

function buildTaskDayBriefLine(task: any, index: number, equipmentRows: EquipmentReservation[]) {
  const fieldExecution = getTaskFieldExecutionSummary(task);
  const phone = taskPhoneNumber(task);
  const mapLink = taskMapSearchLink(task);
  return [
    `${index + 1}. ${taskTimeLabel(task)}-${taskEndTimeLabel(task)} | ${task?.klient_nazwa || `Zlecenie #${task?.id}`}`,
    `Adres: ${taskAddressLabel(task) || 'brak adresu'}`,
    `Zakres: ${taskBriefScope(task)}`,
    `Ekipa: ${task?.ekipa_nazwa || (task?.ekipa_id ? `#${task.ekipa_id}` : 'brak')}`,
    `Sprzet: ${taskBriefEquipmentLabel(equipmentRows)}`,
    `Foto: ${taskPhotoReadyCount(task)}/${FIELD_PHOTO_REQUIREMENTS.length} | Teren: ${fieldExecution.label}`,
    phone ? `Tel: ${phone}` : '',
    mapLink ? `Mapa: ${mapLink}` : '',
  ].filter(Boolean).join('\n');
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function HarmonogramScreen() {
  const { theme } = useTheme();
  const { language, t } = useLanguage();
  const guard = useOddzialFeatureGuard('/harmonogram');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  const [markedDays, setMarkedDays] = useState<Record<string, number>>({});
  const [dayTasks, setDayTasks] = useState<any[]>([]);
  const [ekipy, setEkipy] = useState<any[]>([]);
  const [equipmentReservations, setEquipmentReservations] = useState<EquipmentReservation[]>([]);
  const [equipmentReservationsDown, setEquipmentReservationsDown] = useState(false);
  const [teamFilter, setTeamFilter] = useState('all');
  const [loadingDay, setLoadingDay] = useState(false);

  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const init = useCallback(async () => {
    try {
      const { token: storedToken, user: storedUser } = await getStoredSession();
      if (!storedToken || !storedUser) { router.replace('/login'); return; }
      setToken(storedToken);
      setUser(storedUser);
    } catch {
      router.replace('/login');
    }
  }, []);

  const fetchMonthData = useCallback(async (year: number, month: number) => {
    setLoading(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${token}` };
      const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const res = await fetch(`${API_URL}/tasks/wszystkie?from=${from}&to=${to}`, { headers: h });
      if (res.ok) {
        const data = await res.json();
        const tasks: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        const counts: Record<string, number> = {};
        tasks.forEach(t => {
          if (t.data_planowana) {
            const d = t.data_planowana.split('T')[0];
            counts[d] = (counts[d] || 0) + 1;
          }
        });
        setMarkedDays(counts);
      }

      const reservationRes = await fetch(`${API_URL}/flota/rezerwacje?from=${from}&to=${to}`, { headers: h });
      if (reservationRes.ok) {
        const data = await reservationRes.json().catch(() => []);
        setEquipmentReservations(Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);
        setEquipmentReservationsDown(false);
      } else {
        setEquipmentReservations([]);
        setEquipmentReservationsDown(true);
      }

      const isManager = ['Dyrektor', 'Administrator', 'Kierownik'].includes(user?.rola);
      if (isManager) {
        const branchId = user?.oddzial_id != null ? String(user.oddzial_id) : '';
        const eUrl = branchId
          ? `${API_URL}/oddzialy/${branchId}/zasoby?date=${from}`
          : `${API_URL}/ekipy`;
        const eRes = await fetch(eUrl, { headers: h });
        if (eRes.ok) {
          const data = await eRes.json();
          setEkipy(Array.isArray(data?.ekipy) ? data.ekipy : Array.isArray(data) ? data : []);
        }
      }
    } catch {
      // po odświeżeniu użytkownik dostanie kolejny fetch
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, user?.rola, user?.oddzial_id]);

  const fetchDayTasks = useCallback(async (year: number, month: number, day: number) => {
    setLoadingDay(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const res = await fetch(`${API_URL}/tasks/wszystkie?from=${dateStr}&to=${dateStr}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const all: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        setDayTasks(all.filter(t => t.data_planowana?.split('T')[0] === dateStr));
      }
    } catch {
      setDayTasks([]);
    } finally {
      setLoadingDay(false);
    }
  }, [token]);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    if (user) void fetchMonthData(viewYear, viewMonth);
  }, [fetchMonthData, viewYear, viewMonth, user]);

  useEffect(() => {
    if (user && selectedDay) void fetchDayTasks(viewYear, viewMonth, selectedDay);
  }, [fetchDayTasks, selectedDay, viewYear, viewMonth, user]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed <= 0) return;
      setRefreshing(true);
      void fetchMonthData(viewYear, viewMonth);
      if (selectedDay) void fetchDayTasks(viewYear, viewMonth, selectedDay);
    });
    return unsubscribe;
  }, [fetchMonthData, fetchDayTasks, viewYear, viewMonth, selectedDay]);

  useEffect(() => {
    const unsubscribe = subscribeTaskSync(() => {
      if (!user) return;
      setRefreshing(true);
      void fetchMonthData(viewYear, viewMonth);
      if (selectedDay) void fetchDayTasks(viewYear, viewMonth, selectedDay);
    });
    return unsubscribe;
  }, [fetchMonthData, fetchDayTasks, viewYear, viewMonth, selectedDay, user]);

  useEffect(() => {
    if (!selectedTask) return;
    const freshTask = dayTasks.find((task) => String(task?.id) === String(selectedTask.id));
    if (freshTask && freshTask !== selectedTask) setSelectedTask(freshTask);
  }, [dayTasks, selectedTask]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchMonthData(viewYear, viewMonth);
    if (selectedDay) fetchDayTasks(viewYear, viewMonth, selectedDay);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
    setSelectedDay(0);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
    setSelectedDay(0);
  };

  const cells = getCalendarDays(viewYear, viewMonth);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isManager = ['Dyrektor', 'Administrator', 'Kierownik'].includes(user?.rola);

  const monthLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(monthLocale, { weekday: 'short' }),
      ),
    [monthLocale],
  );
  const monthTitle = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString(monthLocale, { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth, monthLocale],
  );
  const gapWeekdays = useMemo(() => {
    if (!isManager) return [];
    const last = new Date(viewYear, viewMonth + 1, 0).getDate();
    const out: string[] = [];
    for (let d = 1; d <= last; d++) {
      const dt = new Date(viewYear, viewMonth, d);
      const wd = dt.getDay();
      if (wd === 0 || wd === 6) continue;
      const cellStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = markedDays[cellStr] || 0;
      if (count === 0) out.push(cellStr);
    }
    return out;
  }, [isManager, viewYear, viewMonth, markedDays]);
  const selectedDateTitle = useMemo(() => {
    if (selectedDay <= 0) return '';
    return new Date(viewYear, viewMonth, selectedDay).toLocaleDateString(monthLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, [viewYear, viewMonth, selectedDay, monthLocale]);

  const statusKolorMap = useMemo(() => makeTaskStatusColorMap(theme), [theme]);

  const taskStatusLabel = useCallback(
    (code: string) => t(`zlecenia.status.${code}`),
    [t],
  );

  const ekipaKolorMap: Record<number, string> = Object.fromEntries(
    ekipy.filter((e: any) => e.kolor).map((e: any) => [e.id, e.kolor])
  );
  const getKolor = (task: any): string =>
    ekipaKolorMap[task.ekipa_id] || statusKolorMap[task.status as keyof typeof statusKolorMap] || theme.textMuted;
  const selectedDateKey = selectedDay > 0
    ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
    : '';
  const dayEquipmentReservations = useMemo(
    () => equipmentReservations.filter((row) => reservationCoversDay(row, selectedDateKey)),
    [equipmentReservations, selectedDateKey],
  );
  const activeDayEquipmentReservations = useMemo(
    () => dayEquipmentReservations.filter(isActiveReservation),
    [dayEquipmentReservations],
  );
  const equipmentConflictKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of activeDayEquipmentReservations) {
      const key = String(row.sprzet_id || '');
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [activeDayEquipmentReservations]);
  const equipmentConflictCount = useMemo(
    () => activeDayEquipmentReservations.filter((row) => equipmentConflictKeys.has(String(row.sprzet_id || ''))).length,
    [activeDayEquipmentReservations, equipmentConflictKeys],
  );
  const sortedDayTasks = useMemo(() => [...dayTasks].sort(sortRouteTasks), [dayTasks]);
  useEffect(() => {
    setTeamFilter('all');
  }, [selectedDateKey]);
  const visibleDayTasks = useMemo(() => {
    if (teamFilter === 'all') return sortedDayTasks;
    if (teamFilter === 'unassigned') return sortedDayTasks.filter((task) => !task.ekipa_id && !task.ekipa_nazwa);
    return sortedDayTasks.filter((task) => String(task.ekipa_id || '') === teamFilter);
  }, [sortedDayTasks, teamFilter]);
  const visibleEquipmentReservations = useMemo(() => {
    if (teamFilter === 'all') return activeDayEquipmentReservations;
    if (teamFilter === 'unassigned') {
      return activeDayEquipmentReservations.filter((row) => !row.ekipa_id && !row.ekipa_nazwa);
    }
    return activeDayEquipmentReservations.filter((row) => String(row.ekipa_id || '') === teamFilter);
  }, [activeDayEquipmentReservations, teamFilter]);
  const equipmentByTaskId = useMemo(() => {
    const map = new Map<string, EquipmentReservation[]>();
    for (const row of activeDayEquipmentReservations) {
      if (!row.task_id) continue;
      const key = String(row.task_id);
      const prev = map.get(key) || [];
      prev.push(row);
      map.set(key, prev);
    }
    return map;
  }, [activeDayEquipmentReservations]);
  const equipmentRowsForTask = useCallback((task: any) => {
    if (!task?.id) return [];
    return equipmentByTaskId.get(String(task.id)) || [];
  }, [equipmentByTaskId]);
  const openReservationContext = useCallback((input: {
    date?: string;
    taskId?: string | number | null;
    teamId?: string | number | null;
    equipmentId?: string | number | null;
  } = {}) => {
    const params: Record<string, string> = {};
    const date = input.date || selectedDateKey;
    if (date) params.prefData = date;
    if (input.taskId) params.prefZlecenie = String(input.taskId);
    if (input.teamId) params.prefEkipa = String(input.teamId);
    if (input.equipmentId) params.prefSprzet = String(input.equipmentId);
    router.push({ pathname: '/rezerwacje-sprzetu', params } as never);
  }, [selectedDateKey]);
  const selectedTaskEquipmentRows = useMemo(
    () => (selectedTask ? equipmentRowsForTask(selectedTask) : []),
    [equipmentRowsForTask, selectedTask],
  );
  const teamFilterOptions = useMemo(() => {
    const unassigned = sortedDayTasks.filter((task) => !task.ekipa_id && !task.ekipa_nazwa).length;
    const unassignedReservations = activeDayEquipmentReservations.filter((row) => !row.ekipa_id && !row.ekipa_nazwa).length;
    return [
      { key: 'all', label: 'Wszystkie', count: sortedDayTasks.length + activeDayEquipmentReservations.length, color: theme.accent },
      ...ekipy.map((ekipa: any) => ({
        key: String(ekipa.id),
        label: ekipa.nazwa || `Ekipa #${ekipa.id}`,
        count: sortedDayTasks.filter((task) => String(task.ekipa_id || '') === String(ekipa.id)).length +
          activeDayEquipmentReservations.filter((row) => String(row.ekipa_id || '') === String(ekipa.id)).length,
        color: ekipa.kolor || theme.accent,
      })),
      { key: 'unassigned', label: 'Bez ekipy', count: unassigned + unassignedReservations, color: unassigned || unassignedReservations ? theme.warning : theme.textMuted },
    ].filter((item) => item.key === 'all' || item.key === 'unassigned' || item.count > 0);
  }, [activeDayEquipmentReservations, ekipy, sortedDayTasks, theme.accent, theme.textMuted, theme.warning]);
  const routePlan = useMemo(() => {
    const active = visibleDayTasks.filter((task) => !isTaskClosed(task.status));
    const next = active.find((task) => task.status === TASK_STATUS.W_REALIZACJI) ||
      active.find((task) => task.status === TASK_STATUS.ZAPLANOWANE) ||
      active[0] ||
      visibleDayTasks[0] ||
      null;
    const totalHours = visibleDayTasks.reduce((sum, task) => sum + taskNumber(task.czas_planowany_godziny), 0);
    const photosMissing = visibleDayTasks.filter((task) => taskPhotoReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length).length;
    const executionBlocked = visibleDayTasks.filter((task) =>
      !isTaskClosed(task.status) &&
      taskExecutionReadyChecks(task, equipmentRowsForTask(task)).some((check) => !check.ok),
    ).length;
    const missingEquipment = visibleDayTasks.filter((task) =>
      !isTaskClosed(task.status) &&
      !taskExecutionReadyChecks(task, equipmentRowsForTask(task)).find((check) => check.key === 'equipment')?.ok,
    ).length;
    const noCheckin = visibleDayTasks.filter((task) => getTaskFieldExecutionSummary(task).key === 'missing').length;
    const fieldActive = visibleDayTasks.filter((task) => getTaskFieldExecutionSummary(task).key === 'active').length;
    const fieldSlotCount = visibleDayTasks.filter(isFieldHandoffTask).length;
    const routeStops = active
      .map((task) => [task.adres, task.miasto].filter(Boolean).join(', '))
      .filter(Boolean);
    const totalCount = visibleDayTasks.length;
    const doneCount = visibleDayTasks.filter((task) => isTaskClosed(task.status)).length;
    return {
      next,
      activeCount: active.length,
      totalHours,
      photosMissing,
      executionBlocked,
      missingEquipment,
      noCheckin,
      fieldActive,
      fieldSlotCount,
      doneCount,
      routeStops,
      progressPct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
    };
  }, [equipmentRowsForTask, visibleDayTasks]);

  const teamDayPlans = useMemo(() => (
    ekipy.map((ekipa: any) => {
      const tasks = sortedDayTasks
        .filter((task: any) => String(task.ekipa_id || '') === String(ekipa.id))
        .sort(sortRouteTasks);
      const active = tasks.filter((task: any) => !isTaskClosed(task.status));
      const next = active.find((task: any) => task.status === TASK_STATUS.W_REALIZACJI) ||
        active.find((task: any) => task.status === TASK_STATUS.ZAPLANOWANE) ||
        active[0] ||
        tasks[0] ||
        null;
      const totalHours = tasks.reduce((sum: number, task: any) => sum + taskNumber(task.czas_planowany_godziny), 0);
      const doneCount = tasks.filter((task: any) => isTaskClosed(task.status)).length;
      const missingPhotos = tasks.filter((task: any) => taskPhotoReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length).length;
      const missingAddress = tasks.filter((task: any) => !hasTaskAddress(task)).length;
      const conflictCount = countScheduleConflicts(tasks);
      const equipmentRows = activeDayEquipmentReservations
        .filter((row) => String(row.ekipa_id || '') === String(ekipa.id))
        .sort((a, b) => reservationDisplayName(a).localeCompare(reservationDisplayName(b)));
      const equipmentConflictCount = equipmentRows.filter((row) => equipmentConflictKeys.has(String(row.sprzet_id || ''))).length;
      const firstStart = tasks.map(taskStartMinutes).filter((item): item is number => item != null).sort((a, b) => a - b)[0] ?? null;
      const lastEnd = tasks
        .map((task: any) => {
          const start = taskStartMinutes(task);
          return start == null ? null : start + taskDurationMinutes(task);
        })
        .filter((item): item is number => item != null)
        .sort((a, b) => b - a)[0] ?? null;
      const routeStops = active
        .map((task: any) => [task.adres, task.miasto].filter(Boolean).join(', '))
        .filter(Boolean);
      const notReadyCount = active.filter((task: any) =>
        taskExecutionReadyChecks(task, equipmentRowsForTask(task)).some((check) => !check.ok),
      ).length;
      const missingEquipment = active.filter((task: any) =>
        !taskExecutionReadyChecks(task, equipmentRowsForTask(task)).find((check) => check.key === 'equipment')?.ok,
      ).length;
      return {
        ekipa,
        tasks,
        active,
        next,
        totalHours,
        doneCount,
        missingPhotos,
        missingAddress,
        conflictCount,
        equipmentRows,
        equipmentCount: equipmentRows.length,
        equipmentConflictCount,
        notReadyCount,
        missingEquipment,
        firstStart,
        lastEnd,
        routeStops,
        progressPct: tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0,
      };
    })
  ), [activeDayEquipmentReservations, ekipy, equipmentConflictKeys, equipmentRowsForTask, sortedDayTasks]);

  const scheduleHealth = useMemo(() => {
    const busyTeams = teamDayPlans.filter((plan) => plan.tasks.length > 0).length;
    const overloadedTeams = teamDayPlans.filter((plan) => plan.totalHours > 8).length;
    const conflictCount = teamDayPlans.reduce((sum, plan) => sum + plan.conflictCount, 0);
    const unassignedTasks = sortedDayTasks.filter((task) => !task.ekipa_id && !task.ekipa_nazwa).length;
    const missingAddress = sortedDayTasks.filter((task) => !hasTaskAddress(task)).length;
    const noStartTime = sortedDayTasks.filter((task) => taskStartMinutes(task) == null).length;
    const executionBlocked = sortedDayTasks.filter((task) =>
      !isTaskClosed(task.status) &&
      taskExecutionReadyChecks(task, equipmentRowsForTask(task)).some((check) => !check.ok),
    ).length;
    const missingEquipment = sortedDayTasks.filter((task) =>
      !isTaskClosed(task.status) &&
      !taskExecutionReadyChecks(task, equipmentRowsForTask(task)).find((check) => check.key === 'equipment')?.ok,
    ).length;
    return {
      busyTeams,
      freeTeams: Math.max(0, ekipy.length - busyTeams),
      overloadedTeams,
      conflictCount,
      equipmentReservations: activeDayEquipmentReservations.length,
      equipmentConflictCount,
      unassignedTasks,
      missingAddress,
      noStartTime,
      executionBlocked,
      missingEquipment,
      equipmentReservationsDown,
      ok: conflictCount === 0 &&
        equipmentConflictCount === 0 &&
        unassignedTasks === 0 &&
        missingAddress === 0 &&
        noStartTime === 0 &&
        executionBlocked === 0 &&
        missingEquipment === 0 &&
        !equipmentReservationsDown,
    };
  }, [activeDayEquipmentReservations.length, ekipy.length, equipmentConflictCount, equipmentReservationsDown, equipmentRowsForTask, sortedDayTasks, teamDayPlans]);

  const openSelectedDayRoute = useCallback(async () => {
    void triggerHaptic('light');
    await openRouteInMaps(routePlan.routeStops);
  }, [routePlan.routeStops]);

  const shareDayBrief = useCallback(async (title: string, briefTasks: any[]) => {
    const rows = [...briefTasks].sort(sortRouteTasks);
    if (!rows.length) return;
    const totalHours = rows.reduce((sum, task) => sum + taskNumber(task?.czas_planowany_godziny), 0);
    const missingAddress = rows.filter((task) => !hasTaskAddress(task)).length;
    const conflictCount = countScheduleConflicts(rows);
    const notReady = rows.filter((task) =>
      !isTaskClosed(task?.status) &&
      taskExecutionReadyChecks(task, equipmentRowsForTask(task)).some((check) => !check.ok),
    ).length;
    const equipmentConflicts = rows.filter((task) =>
      equipmentRowsForTask(task).some((row) => equipmentConflictKeys.has(String(row.sprzet_id || ''))),
    ).length;
    const control = [
      conflictCount ? `kolizje godzin: ${conflictCount}` : '',
      equipmentConflicts ? `kolizje sprzetu: ${equipmentConflicts}` : '',
      notReady ? `niegotowe karty: ${notReady}` : '',
      missingAddress ? `brak adresu: ${missingAddress}` : '',
    ].filter(Boolean);
    const message = [
      title,
      `Data: ${selectedDateTitle || selectedDateKey}`,
      `Punkty: ${rows.length} | Czas: ${totalHours ? totalHours.toFixed(1) : '0'} h`,
      `Kontrola: ${control.length ? control.join(' | ') : 'plan gotowy'}`,
      '',
      ...rows.map((task, index) => buildTaskDayBriefLine(task, index, equipmentRowsForTask(task))),
      '',
      'ARBOR-OS: plan dnia z aplikacji.',
    ].join('\n\n');

    try {
      await Share.share({ title, message });
    } catch {
      // Udostepnianie jest pomocnicze; nie blokujemy pracy harmonogramu.
    }
  }, [equipmentConflictKeys, equipmentRowsForTask, selectedDateKey, selectedDateTitle]);

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

  if (loading && !refreshing) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      <ScrollView
        style={S.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        <ScreenHeader
          title={t('harmonogram.title')}
          paddingTop={52}
          edgeSlotWidth={36}
          backIconSize={22}
        />

        {/* Month navigator */}
        <View style={S.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={S.navBtn}>
            <PlatinumIconBadge icon="chevron-back" color={theme.accent} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
          </TouchableOpacity>
          <Text style={S.monthTitle}>{monthTitle}</Text>
          <TouchableOpacity onPress={nextMonth} style={S.navBtn}>
            <PlatinumIconBadge icon="chevron-forward" color={theme.accent} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
          </TouchableOpacity>
        </View>

        {/* Calendar */}
        <View style={S.calendarBox}>
          <View style={S.weekRow}>
            {weekdayLabels.map((d) => (
              <View key={d} style={S.dayHeaderCell}>
                <Text style={S.dayHeaderText}>{d}</Text>
              </View>
            ))}
          </View>
          {Array.from({ length: cells.length / 7 }, (_, wi) => (
            <View key={wi} style={S.weekRow}>
              {cells.slice(wi * 7, wi * 7 + 7).map((day, ci) => {
                const cellStr = day
                  ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  : '';
                const count = cellStr ? (markedDays[cellStr] || 0) : 0;
                const isToday = cellStr === todayStr;
                const isSelected = day !== null && day === selectedDay;
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[
                      S.dayCell,
                      isToday && S.todayCell,
                      isSelected && S.selectedCell,
                      !day && S.emptyCell,
                    ]}
                    onPress={() => day && setSelectedDay(day)}
                    disabled={!day}
                  >
                    {day ? (
                      <>
                        <Text style={[
                          S.dayNum,
                          isSelected && S.dayNumSelected,
                          isToday && !isSelected && S.dayNumToday,
                        ]}>{day}</Text>
                        {count > 0 && (
                          <View style={[S.dot, { backgroundColor: isSelected ? theme.accentText : theme.accent }]}>
                            <Text style={[S.dotText, { color: isSelected ? theme.accent : theme.accentText }]}>{count}</Text>
                          </View>
                        )}
                      </>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        {isManager && (
          <View style={{ paddingHorizontal: 16, marginTop: 12, marginBottom: 4 }}>
            <Text style={{ fontWeight: '700', color: theme.text, fontSize: 15 }}>{t('harmonogram.gapsTitle')}</Text>
            {gapWeekdays.length === 0 ? (
              <Text style={{ color: theme.textMuted, marginTop: 6 }}>{t('harmonogram.gapsEmpty')}</Text>
            ) : (
              <Text style={{ color: theme.textSub, marginTop: 6, lineHeight: 20 }}>{gapWeekdays.join(', ')}</Text>
            )}
          </View>
        )}

        {/* Day tasks */}
        {selectedDay > 0 && (
          <View style={S.daySection}>
            <Text style={S.daySectionTitle}>{selectedDateTitle}</Text>
            {!loadingDay && sortedDayTasks.length > 0 ? (
              <View style={[S.opsPanel, { borderColor: scheduleHealth.ok ? theme.success + '66' : theme.warning + '77', backgroundColor: scheduleHealth.ok ? theme.successBg : theme.warningBg }]}>
                <View style={S.opsHead}>
                  <PlatinumIconBadge
                    icon={scheduleHealth.ok ? 'checkmark-done-outline' : 'alert-circle-outline'}
                    color={scheduleHealth.ok ? theme.success : theme.warning}
                    size={12}
                    style={S.opsIcon}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[S.opsTitle, { color: scheduleHealth.ok ? theme.success : theme.warning }]}>
                      {scheduleHealth.ok ? 'Dzień gotowy do realizacji' : 'Dzień wymaga kontroli biura'}
                    </Text>
                    <Text style={S.opsSub}>
                      Sprawdzamy ekipy, godziny, adresy, sprzet i pakiet wykonania przed wyjazdem.
                    </Text>
                  </View>
                </View>
                <View style={S.opsGrid}>
                  {[
                    { key: 'busy', label: 'Ekipy zajęte', value: `${scheduleHealth.busyTeams}/${ekipy.length || scheduleHealth.busyTeams}`, color: theme.accent },
                    { key: 'free', label: 'Wolne', value: scheduleHealth.freeTeams, color: theme.success },
                    { key: 'over', label: 'Przeciążone', value: scheduleHealth.overloadedTeams, color: scheduleHealth.overloadedTeams ? theme.danger : theme.success },
                    { key: 'conflicts', label: 'Konflikty', value: scheduleHealth.conflictCount, color: scheduleHealth.conflictCount ? theme.danger : theme.success },
                    { key: 'equipment', label: 'Sprzet', value: scheduleHealth.equipmentReservations, color: theme.info },
                    { key: 'equipment-conflicts', label: 'Kolizje sprz.', value: scheduleHealth.equipmentConflictCount, color: scheduleHealth.equipmentConflictCount ? theme.danger : theme.success },
                    { key: 'team', label: 'Bez ekipy', value: scheduleHealth.unassignedTasks, color: scheduleHealth.unassignedTasks ? theme.warning : theme.success },
                    { key: 'addr', label: 'Bez adresu', value: scheduleHealth.missingAddress, color: scheduleHealth.missingAddress ? theme.warning : theme.success },
                    { key: 'ready', label: 'Nie gotowe', value: scheduleHealth.executionBlocked, color: scheduleHealth.executionBlocked ? theme.danger : theme.success },
                    { key: 'equipment-missing', label: 'Brak sprz.', value: scheduleHealth.missingEquipment, color: scheduleHealth.missingEquipment ? theme.warning : theme.success },
                  ].map((item) => (
                    <View key={item.key} style={[S.opsTile, { borderColor: item.color + '55', backgroundColor: item.color + '12' }]}>
                      <Text style={[S.opsValue, { color: item.color }]}>{item.value}</Text>
                      <Text style={S.opsLabel}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                {scheduleHealth.noStartTime > 0 ? (
                  <View style={S.opsWarning}>
                    <PlatinumIconBadge icon="time-outline" color={theme.warning} size={9} style={S.routeSmallIcon} />
                    <Text style={S.opsWarningText}>{scheduleHealth.noStartTime} zleceń nie ma godziny startu.</Text>
                  </View>
                ) : null}
                {scheduleHealth.executionBlocked > 0 ? (
                  <View style={S.opsWarning}>
                    <PlatinumIconBadge icon="shield-outline" color={theme.danger} size={9} style={S.routeSmallIcon} />
                    <Text style={[S.opsWarningText, { color: theme.danger }]}>
                      {scheduleHealth.executionBlocked} zlecen wymaga uzupelnienia karty wykonania przed wyjazdem.
                    </Text>
                  </View>
                ) : null}
                {scheduleHealth.equipmentConflictCount > 0 ? (
                  <View style={S.opsWarning}>
                    <PlatinumIconBadge icon="cube-outline" color={theme.danger} size={9} style={S.routeSmallIcon} />
                    <Text style={[S.opsWarningText, { color: theme.danger }]}>
                      {scheduleHealth.equipmentConflictCount} rezerwacji sprzetu koliduje w tym dniu.
                    </Text>
                  </View>
                ) : null}
                {equipmentReservationsDown ? (
                  <View style={S.opsWarning}>
                    <PlatinumIconBadge icon="cloud-offline-outline" color={theme.warning} size={9} style={S.routeSmallIcon} />
                    <Text style={S.opsWarningText}>Nie udalo sie pobrac rezerwacji sprzetu.</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {loadingDay ? (
              <ActivityIndicator color={theme.accent} style={{ marginTop: 12 }} />
            ) : sortedDayTasks.length === 0 ? (
              <View style={S.emptyDay}>
                <Text style={S.emptyDayText}>{t('harmonogram.emptyDay')}</Text>
                {isManager && (
                  <PlatinumCTA
                    label={t('harmonogram.addOrder')}
                    style={S.addBtn}
                    onPress={() => {
                      void triggerHaptic('light');
                      router.push(buildNewOrderRoute({ source: 'harmonogram', data: selectedDateKey }) as never);
                    }}
                  />
                )}
              </View>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={S.teamFilterRow}
                >
                  {teamFilterOptions.map((item) => {
                    const active = teamFilter === item.key;
                    return (
                      <TouchableOpacity
                        key={item.key}
                        style={[
                          S.teamFilterChip,
                          {
                            borderColor: active ? item.color : theme.border,
                            backgroundColor: active ? item.color + '16' : theme.surface2,
                          },
                        ]}
                        onPress={() => {
                          setTeamFilter(item.key);
                          void triggerHaptic('light');
                        }}
                      >
                        <Text style={[S.teamFilterText, { color: active ? item.color : theme.textSub }]} numberOfLines={1}>
                          {item.label}
                        </Text>
                        <View style={[S.teamFilterCount, { backgroundColor: item.color + '18' }]}>
                          <Text style={[S.teamFilterCountText, { color: item.color }]}>{item.count}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={S.routeCommandCard}>
                  <View style={S.routeCommandHead}>
                    <PlatinumIconBadge icon="navigate-outline" color={theme.accent} size={16} style={S.routeCommandIcon} />
                    <View style={{ flex: 1 }}>
                      <Text style={S.routeCommandTitle}>Plan trasy ekipy</Text>
                      <Text style={S.routeCommandSub}>
                        Kolejność dnia, zdjęcia i szybkie wejście w realizację.
                      </Text>
                    </View>
                  </View>
                  <View style={S.routeStatsGrid}>
                    {[
                      { key: 'count', label: 'Zlecenia', value: visibleDayTasks.length, color: theme.accent },
                      { key: 'active', label: 'Aktywne', value: routePlan.activeCount, color: theme.warning },
                      { key: 'hours', label: 'Godziny', value: routePlan.totalHours ? routePlan.totalHours.toFixed(1) : '0', color: theme.info },
                      { key: 'photos', label: 'Braki foto', value: routePlan.photosMissing, color: routePlan.photosMissing ? theme.danger : theme.success },
                      { key: 'ready', label: 'Nie gotowe', value: routePlan.executionBlocked, color: routePlan.executionBlocked ? theme.danger : theme.success },
                      { key: 'checkin', label: 'Brak check-in', value: routePlan.noCheckin, color: routePlan.noCheckin ? theme.danger : theme.success },
                      { key: 'work', label: 'Praca trwa', value: routePlan.fieldActive, color: routePlan.fieldActive ? theme.warning : theme.success },
                      { key: 'equipment', label: 'Brak sprz.', value: routePlan.missingEquipment, color: routePlan.missingEquipment ? theme.warning : theme.success },
                      { key: 'field', label: 'Z terenu', value: routePlan.fieldSlotCount, color: theme.success },
                    ].map((item) => (
                      <View key={item.key} style={[S.routeStatTile, { borderColor: item.color + '55', backgroundColor: item.color + '14' }]}>
                        <Text style={[S.routeStatValue, { color: item.color }]}>{item.value}</Text>
                        <Text style={S.routeStatLabel}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={S.routeProgressRow}>
                    <View style={{ flex: 1 }}>
                      <View style={S.routeProgressTop}>
                        <Text style={S.routeProgressLabel}>Postęp dnia</Text>
                        <Text style={S.routeProgressValue}>{routePlan.doneCount}/{visibleDayTasks.length}</Text>
                      </View>
                      <View style={S.routeProgressTrack}>
                        <View style={[S.routeProgressFill, { width: `${routePlan.progressPct}%`, backgroundColor: theme.success }]} />
                      </View>
                    </View>
                    <View style={S.routeMapButtons}>
                      <TouchableOpacity
                        style={[
                          S.routeMapButton,
                          {
                            borderColor: visibleDayTasks.length ? theme.success + '55' : theme.border,
                            backgroundColor: visibleDayTasks.length ? theme.successBg : theme.cardBg,
                            opacity: visibleDayTasks.length ? 1 : 0.55,
                          },
                        ]}
                        onPress={() => {
                          void triggerHaptic('light');
                          void shareDayBrief('Odprawa dnia brygady', visibleDayTasks);
                        }}
                        disabled={!visibleDayTasks.length}
                      >
                        <PlatinumIconBadge icon="document-text-outline" color={visibleDayTasks.length ? theme.success : theme.textMuted} size={9} style={S.routeMapIcon} />
                        <Text style={[S.routeMapText, { color: visibleDayTasks.length ? theme.success : theme.textMuted }]}>
                          Odprawa
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          S.routeMapButton,
                          {
                            borderColor: routePlan.routeStops.length ? theme.accent : theme.border,
                            backgroundColor: routePlan.routeStops.length ? theme.accentLight : theme.cardBg,
                            opacity: routePlan.routeStops.length ? 1 : 0.55,
                          },
                        ]}
                        onPress={() => { void openSelectedDayRoute(); }}
                        disabled={!routePlan.routeStops.length}
                      >
                        <PlatinumIconBadge icon="map-outline" color={routePlan.routeStops.length ? theme.accent : theme.textMuted} size={9} style={S.routeMapIcon} />
                        <Text style={[S.routeMapText, { color: routePlan.routeStops.length ? theme.accent : theme.textMuted }]}>
                          Trasa
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {routePlan.next ? (
                    <View style={S.nextRouteCard}>
                      <View style={[S.nextRouteTime, { borderColor: getKolor(routePlan.next), backgroundColor: getKolor(routePlan.next) + '16' }]}>
                        <Text style={[S.nextRouteTimeText, { color: getKolor(routePlan.next) }]}>{taskTimeLabel(routePlan.next)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.nextRouteLabel}>Następny punkt</Text>
                        <Text style={S.nextRouteClient} numberOfLines={1}>{routePlan.next.klient_nazwa || t('harmonogram.noClient')}</Text>
                        <Text style={S.nextRouteAddress} numberOfLines={1}>{[routePlan.next.adres, routePlan.next.miasto].filter(Boolean).join(', ') || 'Brak adresu'}</Text>
                      </View>
                      <TouchableOpacity
                        style={S.nextRouteOpen}
                        onPress={() => {
                          void triggerHaptic('light');
                          router.push(`/zlecenie/${routePlan.next.id}`);
                        }}
                      >
                        <Text style={S.nextRouteOpenText}>Start</Text>
                        <PlatinumIconBadge icon="chevron-forward" color={theme.accent} size={8} style={S.nextRouteOpenIcon} />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {(visibleEquipmentReservations.length > 0 || equipmentReservationsDown) ? (
                  <View style={S.equipmentPanel}>
                    <View style={S.equipmentHead}>
                      <PlatinumIconBadge icon="cube-outline" color={theme.info} size={13} style={S.equipmentIcon} />
                      <View style={{ flex: 1 }}>
                        <Text style={S.equipmentTitle}>Sprzet dnia</Text>
                        <Text style={S.equipmentSub}>Rezerwacje pod wybrany dzien i filtr ekipy.</Text>
                      </View>
                      <TouchableOpacity
                        style={S.equipmentAction}
                        onPress={() => {
                          void triggerHaptic('light');
                          openReservationContext({
                            teamId: teamFilter !== 'all' && teamFilter !== 'unassigned' ? teamFilter : null,
                          });
                        }}
                      >
                        <Text style={S.equipmentActionText}>Rezerwuj</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={S.equipmentStatsRow}>
                      {[
                        { key: 'all', label: 'Rezerwacje', value: visibleEquipmentReservations.length, color: theme.info },
                        { key: 'conflicts', label: 'Kolizje', value: visibleEquipmentReservations.filter((row) => equipmentConflictKeys.has(String(row.sprzet_id || ''))).length, color: equipmentConflictCount ? theme.danger : theme.success },
                      ].map((item) => (
                        <View key={item.key} style={[S.equipmentStat, { borderColor: item.color + '55', backgroundColor: item.color + '12' }]}>
                          <Text style={[S.equipmentStatValue, { color: item.color }]}>{item.value}</Text>
                          <Text style={S.equipmentStatLabel}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                    {equipmentReservationsDown ? (
                      <View style={S.equipmentEmpty}>
                        <Text style={S.equipmentEmptyText}>Lista sprzetu jest chwilowo niedostepna.</Text>
                      </View>
                    ) : (
                      visibleEquipmentReservations.slice(0, 6).map((row) => {
                        const hasConflict = equipmentConflictKeys.has(String(row.sprzet_id || ''));
                        return (
                          <TouchableOpacity
                            key={String(row.id)}
                            style={[S.equipmentRow, hasConflict && { borderColor: theme.danger + '66', backgroundColor: theme.dangerBg }]}
                            onPress={() => {
                              void triggerHaptic('light');
                              openReservationContext({
                                date: dateKey(row.data_od) || selectedDateKey,
                                taskId: row.task_id,
                                teamId: row.ekipa_id,
                                equipmentId: row.sprzet_id,
                              });
                            }}
                          >
                            <View style={[S.equipmentDot, { backgroundColor: hasConflict ? theme.danger : theme.info }]} />
                            <View style={{ flex: 1 }}>
                              <Text style={S.equipmentName} numberOfLines={1}>{reservationDisplayName(row)}</Text>
                              <Text style={S.equipmentMeta} numberOfLines={1}>
                                {row.ekipa_nazwa || 'Bez ekipy'}{row.task_id ? ` · #${row.task_id} ${row.task_klient_nazwa || ''}` : ''}
                              </Text>
                            </View>
                            {row.task_id ? (
                              <TouchableOpacity
                                style={S.equipmentTaskBtn}
                                onPress={(event) => {
                                  event.stopPropagation();
                                  void triggerHaptic('light');
                                  router.push(`/zlecenie/${row.task_id}` as never);
                                }}
                              >
                                <Text style={S.equipmentTaskBtnText}>Karta</Text>
                              </TouchableOpacity>
                            ) : null}
                            <View style={[S.equipmentBadge, { borderColor: hasConflict ? theme.danger + '55' : theme.border, backgroundColor: hasConflict ? theme.danger + '14' : theme.cardBg }]}>
                              <Text style={[S.equipmentBadgeText, { color: hasConflict ? theme.danger : theme.textMuted }]}>
                                {hasConflict ? 'Kolizja' : row.status || 'OK'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                    {!equipmentReservationsDown && visibleEquipmentReservations.length > 6 ? (
                      <Text style={S.equipmentMore}>+{visibleEquipmentReservations.length - 6} kolejne rezerwacje w module sprzetu.</Text>
                    ) : null}
                  </View>
                ) : null}

                {visibleDayTasks.length === 0 ? (
                  <View style={S.filterEmptyBox}>
                    <PlatinumIconBadge icon="filter-outline" color={theme.textMuted} size={12} style={S.opsIcon} />
                    <Text style={S.filterEmptyTitle}>Brak zleceń w tym filtrze</Text>
                    <Text style={S.filterEmptyText}>Wybierz inną ekipę albo pokaż wszystkie zlecenia dnia.</Text>
                  </View>
                ) : null}

                {visibleDayTasks.map((task, index) => {
                  const photoReadyCount = taskPhotoReadyCount(task);
                  const photosDone = photoReadyCount >= FIELD_PHOTO_REQUIREMENTS.length;
                  const isFieldSlot = isFieldHandoffTask(task);
                  const handoff = taskHandoffSummary(task);
                  const handoffChecks = taskFieldReadyChecks(task);
                  const handoffReadyCount = handoffChecks.filter((item) => item.ok).length;
                  const taskEquipmentRows = equipmentRowsForTask(task);
                  const taskEquipmentConflicts = taskEquipmentRows.filter((row) => equipmentConflictKeys.has(String(row.sprzet_id || ''))).length;
                  const executionChecks = taskExecutionReadyChecks(task, taskEquipmentRows);
                  const executionReadyCount = executionChecks.filter((item) => item.ok).length;
                  const executionComplete = executionReadyCount === executionChecks.length;
                  const executionMissing = executionChecks.filter((item) => !item.ok).map((item) => item.label);
                  const fieldExecution = getTaskFieldExecutionSummary(task);
                  const fieldExecutionColor = fieldExecutionToneColor(fieldExecution.tone, theme);
                  return (
                  <TouchableOpacity
                    key={task.id}
                    style={S.taskCard}
                    onPress={() => { setSelectedTask(task); setModalVisible(true); }}
                  >
                    <View style={S.routeRail}>
                      <Text style={S.routeIndex}>{index + 1}</Text>
                      <View style={[S.routeDot, { backgroundColor: getKolor(task) }]} />
                      <Text style={S.routeTime}>{taskTimeLabel(task)}</Text>
                      <Text style={S.routeEndTime}>{taskEndTimeLabel(task)}</Text>
                    </View>
                    <View style={S.taskContent}>
                      <View style={S.taskRow}>
                        <Text style={S.taskClient}>{task.klient_nazwa || t('harmonogram.noClient')}</Text>
                        <View style={[S.statusBadge, { backgroundColor: getKolor(task) + '22' }]}>
                          <Text style={[S.statusText, { color: getKolor(task) }]}>
                            {task.status ? taskStatusLabel(task.status) || task.status : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <PlatinumIconBadge icon="location-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                        <Text style={S.taskAddr}>{task.adres}, {task.miasto}</Text>
                      </View>
                      {task.godzina_rozpoczecia ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <PlatinumIconBadge icon="time-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                          <Text style={S.taskMeta}>{task.godzina_rozpoczecia}</Text>
                        </View>
                      ) : null}
                      {task.ekipa_nazwa ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <PlatinumIconBadge icon="people-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                          <Text style={S.taskMeta}>{task.ekipa_nazwa}</Text>
                        </View>
                      ) : null}
                      {task.typ_uslugi ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <PlatinumIconBadge icon="leaf-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                          <Text style={S.taskMeta}>{task.typ_uslugi}</Text>
                        </View>
                      ) : null}
                      {!isTaskClosed(task.status) ? (
                        <View style={[
                          S.executionPanel,
                          {
                            borderColor: executionComplete ? theme.success + '66' : theme.warning + '66',
                            backgroundColor: executionComplete ? theme.successBg : theme.warningBg,
                          },
                        ]}>
                          <View style={S.executionHead}>
                            <PlatinumIconBadge
                              icon={executionComplete ? 'checkmark-done-outline' : 'shield-outline'}
                              color={executionComplete ? theme.success : theme.warning}
                              size={10}
                              style={S.executionIcon}
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={[S.executionTitle, { color: executionComplete ? theme.success : theme.warning }]}>
                                Gotowość wykonania {executionReadyCount}/{executionChecks.length}
                              </Text>
                              <Text style={S.executionSub} numberOfLines={1}>
                                {executionComplete ? 'Brygada ma komplet danych.' : `Brakuje: ${executionMissing.slice(0, 3).join(', ')}`}
                              </Text>
                            </View>
                          </View>
                          <View style={S.executionGrid}>
                            {executionChecks.map((item) => (
                              <View
                                key={item.key}
                                style={[
                                  S.executionCheck,
                                  {
                                    borderColor: item.ok ? theme.success + '66' : theme.warning + '66',
                                    backgroundColor: item.ok ? theme.cardBg : theme.warningBg,
                                  },
                                ]}
                              >
                                <PlatinumIconBadge
                                  icon={item.ok ? 'checkmark-circle' : item.icon}
                                  color={item.ok ? theme.success : theme.warning}
                                  size={7}
                                  style={S.executionCheckIcon}
                                />
                                <Text style={[S.executionCheckText, { color: item.ok ? theme.success : theme.warning }]} numberOfLines={1}>
                                  {item.label}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : null}
                      {fieldExecution.relevant ? (
                        <View style={[S.fieldExecutionPanel, { borderColor: fieldExecutionColor + '66', backgroundColor: fieldExecutionColor + '10' }]}>
                          <View style={S.fieldExecutionHead}>
                            <PlatinumIconBadge
                              icon={fieldExecution.key === 'active' ? 'pulse-outline' : fieldExecution.key === 'missing' ? 'alert-circle-outline' : 'navigate-circle-outline'}
                              color={fieldExecutionColor}
                              size={10}
                              style={S.fieldExecutionIcon}
                            />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[S.fieldExecutionTitle, { color: fieldExecutionColor }]} numberOfLines={1}>
                                {fieldExecution.label}
                              </Text>
                              <Text style={S.fieldExecutionSub} numberOfLines={1}>{fieldExecution.detail}</Text>
                            </View>
                          </View>
                          <View style={S.fieldExecutionDocs}>
                            {fieldExecution.photoItems.map((item) => {
                              const done = item.count > 0;
                              return (
                                <View
                                  key={item.key}
                                  style={[
                                    S.fieldExecutionDoc,
                                    {
                                      borderColor: done ? theme.success + '66' : theme.warning + '66',
                                      backgroundColor: done ? theme.cardBg : theme.warningBg,
                                    },
                                  ]}
                                >
                                  <Text style={[S.fieldExecutionDocText, { color: done ? theme.success : theme.warning }]}>
                                    {item.label}: {item.count}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      ) : null}
                      {isFieldSlot ? (
                        <View style={S.fieldSlotPanel}>
                          <View style={S.fieldSlotHead}>
                            <PlatinumIconBadge icon="flag-outline" color={theme.success} size={11} style={S.fieldSlotIcon} />
                            <View style={{ flex: 1 }}>
                              <Text style={S.fieldSlotTitle}>Slot z terenu</Text>
                              <Text style={S.fieldSlotSub}>Zakres, ryzyka i dowody dla brygady</Text>
                            </View>
                            <View style={S.fieldSlotScore}>
                              <Text style={S.fieldSlotScoreText}>{handoffReadyCount}/{handoffChecks.length}</Text>
                            </View>
                          </View>
                          <View style={S.fieldSlotChecks}>
                            {handoffChecks.map((item) => (
                              <View
                                key={item.key}
                                style={[
                                  S.fieldCheckChip,
                                  {
                                    borderColor: item.ok ? theme.success + '70' : theme.warning + '70',
                                    backgroundColor: item.ok ? theme.successBg : theme.warningBg,
                                  },
                                ]}
                              >
                                <Text style={[S.fieldCheckText, { color: item.ok ? theme.success : theme.warning }]}>
                                  {item.label}
                                </Text>
                              </View>
                            ))}
                          </View>
                          <View style={S.fieldSummaryGrid}>
                            <View style={S.fieldSummaryItem}>
                              <Text style={S.fieldSummaryLabel}>Zakres</Text>
                              <Text style={S.fieldSummaryText} numberOfLines={2}>{handoff.work}</Text>
                            </View>
                            <View style={S.fieldSummaryItem}>
                              <Text style={S.fieldSummaryLabel}>Ryzyka</Text>
                              <Text style={S.fieldSummaryText} numberOfLines={2}>{handoff.risks}</Text>
                            </View>
                            <View style={S.fieldSummaryItem}>
                              <Text style={S.fieldSummaryLabel}>Dojazd</Text>
                              <Text style={S.fieldSummaryText} numberOfLines={2}>{handoff.access}</Text>
                            </View>
                          </View>
                        </View>
                      ) : null}
                      <View style={S.routeCardActions}>
                        <View style={[S.photoPill, { borderColor: photosDone ? theme.success : theme.warning, backgroundColor: photosDone ? theme.successBg : theme.warningBg }]}>
                          <PlatinumIconBadge
                            icon={photosDone ? 'checkmark-circle' : 'camera-outline'}
                            color={photosDone ? theme.success : theme.warning}
                            size={8}
                            style={S.photoPillIcon}
                          />
                          <Text style={[S.photoPillText, { color: photosDone ? theme.success : theme.warning }]}>
                            Foto {photoReadyCount}/{FIELD_PHOTO_REQUIREMENTS.length}
                          </Text>
                        </View>
                        {(task.adres || task.miasto) ? (
                          <TouchableOpacity
                            style={S.routeSmallBtn}
                            onPress={(event) => {
                              event.stopPropagation();
                              void triggerHaptic('light');
                              void openAddressInMaps(task.adres || '', task.miasto || '');
                            }}
                          >
                            <PlatinumIconBadge icon="map-outline" color={theme.info} size={8} style={S.routeSmallIcon} />
                            <Text style={[S.routeSmallText, { color: theme.info }]}>Mapa</Text>
                          </TouchableOpacity>
                        ) : null}
                        {taskPhoneNumber(task) ? (
                          <TouchableOpacity
                            style={S.routeSmallBtn}
                            onPress={(event) => {
                              event.stopPropagation();
                              void triggerHaptic('light');
                              void openTaskPhone(task);
                            }}
                          >
                            <PlatinumIconBadge icon="call-outline" color={theme.success} size={8} style={S.routeSmallIcon} />
                            <Text style={[S.routeSmallText, { color: theme.success }]}>Telefon</Text>
                          </TouchableOpacity>
                        ) : null}
                        {isFieldSlot ? (
                          <TouchableOpacity
                            style={S.routeSmallBtn}
                            onPress={(event) => {
                              event.stopPropagation();
                              void triggerHaptic('light');
                              router.push(`/zlecenie/${task.id}?tab=zdjecia` as never);
                            }}
                          >
                            <PlatinumIconBadge icon="images-outline" color={theme.success} size={8} style={S.routeSmallIcon} />
                            <Text style={[S.routeSmallText, { color: theme.success }]}>Dowody</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={S.routeSmallBtn}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            openReservationContext({ taskId: task.id, teamId: task.ekipa_id });
                          }}
                        >
                          <PlatinumIconBadge icon="cube-outline" color={taskEquipmentConflicts ? theme.danger : theme.info} size={8} style={S.routeSmallIcon} />
                          <Text style={[S.routeSmallText, { color: taskEquipmentConflicts ? theme.danger : theme.info }]}>
                            Sprzet {taskEquipmentRows.length}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={S.routeSmallBtn}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            router.push(`/zlecenie/${task.id}`);
                          }}
                        >
                          <PlatinumIconBadge icon="open-outline" color={theme.accent} size={8} style={S.routeSmallIcon} />
                          <Text style={[S.routeSmallText, { color: theme.accent }]}>Zlecenie</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                  );
                })}
                {isManager && (
                  <PlatinumCTA
                    label={t('harmonogram.addOrder')}
                    style={S.addBtn}
                    onPress={() => {
                      void triggerHaptic('light');
                      router.push(buildNewOrderRoute({ source: 'harmonogram', data: selectedDateKey }) as never);
                    }}
                  />
                )}
              </>
            )}
          </View>
        )}

        {/* Team availability (managers only) */}
        {isManager && ekipy.length > 0 && selectedDay > 0 && (
          <View style={S.ekipySection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <PlatinumIconBadge icon="people-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
              <Text style={S.ekipySectionTitle}>{t('harmonogram.teamsTitle')}</Text>
            </View>
            {teamDayPlans.map((plan) => {
              const { ekipa } = plan;
              const zajety = plan.tasks.length > 0;
              const ekipaKolor = ekipa.kolor || theme.textMuted;
              return (
                <View key={ekipa.id} style={[S.ekipaRouteCard, zajety && { borderColor: ekipaKolor + '66', backgroundColor: ekipaKolor + '10' }]}>
                  <View style={S.ekipaRouteHead}>
                    <View style={[S.ekipaStatusDot, { backgroundColor: ekipaKolor, opacity: zajety ? 1 : 0.4 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={S.ekipaNazwa}>{ekipa.nazwa}{ekipa.delegowany ? ' · delegacja' : ''}</Text>
                      <Text style={S.ekipaInfo}>
                        {zajety
                          ? `${t('harmonogram.tasksThisDay', { count: plan.tasks.length })} · ${plan.firstStart != null && plan.lastEnd != null ? `${minutesLabel(plan.firstStart)}-${minutesLabel(plan.lastEnd)}` : 'bez godzin'}`
                          : t('harmonogram.teamFree')}
                      </Text>
                    </View>
                    <View style={[S.ekipaStatusBadge, { backgroundColor: zajety ? ekipaKolor + '18' : theme.surface2, borderColor: zajety ? ekipaKolor + '55' : theme.border }]}>
                      <Text style={[S.ekipaDostepnosc, { color: zajety ? ekipaKolor : theme.textMuted }]}>
                        {zajety ? t('harmonogram.teamBusy') : t('harmonogram.teamFree')}
                      </Text>
                    </View>
                  </View>

                  {zajety ? (
                    <>
                      <View style={S.ekipaStatsRow}>
                        {[
                          { key: 'jobs', label: 'Prace', value: plan.tasks.length, color: ekipaKolor },
                          { key: 'hours', label: 'Godz.', value: plan.totalHours ? plan.totalHours.toFixed(1) : '0', color: theme.info },
                          { key: 'done', label: 'Done', value: `${plan.doneCount}/${plan.tasks.length}`, color: theme.success },
                          { key: 'photo', label: 'Foto', value: plan.missingPhotos, color: plan.missingPhotos ? theme.warning : theme.success },
                          { key: 'conflict', label: 'Kolizje', value: plan.conflictCount, color: plan.conflictCount ? theme.danger : theme.success },
                          { key: 'equipment', label: 'Sprzet', value: plan.equipmentCount, color: plan.equipmentConflictCount ? theme.danger : theme.info },
                          { key: 'ready', label: 'Nie got.', value: plan.notReadyCount, color: plan.notReadyCount ? theme.danger : theme.success },
                          { key: 'missing-equipment', label: 'Brak sprz.', value: plan.missingEquipment, color: plan.missingEquipment ? theme.warning : theme.success },
                          { key: 'addr', label: 'Adres', value: plan.missingAddress, color: plan.missingAddress ? theme.warning : theme.success },
                        ].map((item) => (
                          <View key={item.key} style={[S.ekipaStatTile, { borderColor: item.color + '55', backgroundColor: item.color + '12' }]}>
                            <Text style={[S.ekipaStatValue, { color: item.color }]}>{item.value}</Text>
                            <Text style={S.ekipaStatLabel}>{item.label}</Text>
                          </View>
                        ))}
                      </View>

                      <View style={S.ekipaProgressBox}>
                        <View style={S.routeProgressTop}>
                          <Text style={S.routeProgressLabel}>Postęp brygady</Text>
                          <Text style={S.routeProgressValue}>{plan.doneCount}/{plan.tasks.length}</Text>
                        </View>
                        <View style={S.routeProgressTrack}>
                          <View style={[S.routeProgressFill, { width: `${plan.progressPct}%`, backgroundColor: ekipaKolor }]} />
                        </View>
                      </View>

                      {plan.equipmentRows.length > 0 ? (
                        <View style={S.teamEquipmentBox}>
                          <View style={S.teamEquipmentHead}>
                            <PlatinumIconBadge icon="cube-outline" color={plan.equipmentConflictCount ? theme.danger : theme.info} size={8} style={S.routeSmallIcon} />
                            <Text style={S.teamEquipmentTitle}>Sprzet brygady</Text>
                          </View>
                          {plan.equipmentRows.slice(0, 3).map((row) => {
                            const hasConflict = equipmentConflictKeys.has(String(row.sprzet_id || ''));
                            return (
                              <TouchableOpacity
                                key={String(row.id)}
                                style={S.teamEquipmentRow}
                                onPress={() => {
                                  void triggerHaptic('light');
                                  openReservationContext({
                                    date: dateKey(row.data_od) || selectedDateKey,
                                    taskId: row.task_id,
                                    teamId: row.ekipa_id,
                                    equipmentId: row.sprzet_id,
                                  });
                                }}
                              >
                                <Text style={[S.teamEquipmentName, { color: hasConflict ? theme.danger : theme.textSub }]} numberOfLines={1}>
                                  {reservationDisplayName(row)}
                                </Text>
                                <Text style={[S.teamEquipmentStatus, { color: hasConflict ? theme.danger : theme.textMuted }]}>
                                  {hasConflict ? 'Kolizja' : row.status || 'OK'}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                          {plan.equipmentRows.length > 3 ? (
                            <Text style={S.teamEquipmentMore}>+{plan.equipmentRows.length - 3} jeszcze</Text>
                          ) : null}
                        </View>
                      ) : null}

                      {(plan.totalHours > 8 || plan.conflictCount > 0 || plan.equipmentConflictCount > 0 || plan.notReadyCount > 0 || plan.missingAddress > 0) ? (
                        <View style={[S.teamWarningBox, { borderColor: plan.conflictCount || plan.equipmentConflictCount || plan.notReadyCount ? theme.danger + '66' : theme.warning + '66', backgroundColor: plan.conflictCount || plan.equipmentConflictCount || plan.notReadyCount ? theme.dangerBg : theme.warningBg }]}>
                          <PlatinumIconBadge
                            icon={plan.conflictCount || plan.equipmentConflictCount || plan.notReadyCount ? 'alert-circle-outline' : 'warning-outline'}
                            color={plan.conflictCount || plan.equipmentConflictCount || plan.notReadyCount ? theme.danger : theme.warning}
                            size={9}
                            style={S.routeSmallIcon}
                          />
                          <Text style={[S.teamWarningText, { color: plan.conflictCount || plan.equipmentConflictCount || plan.notReadyCount ? theme.danger : theme.warning }]}>
                            {plan.conflictCount
                              ? `${plan.conflictCount} kolizji godzin - sprawdź plan.`
                              : plan.equipmentConflictCount
                                ? `${plan.equipmentConflictCount} kolizji sprzetu - sprawdz rezerwacje.`
                              : plan.notReadyCount
                                ? `${plan.notReadyCount} zlecen nie ma kompletnej karty wykonania.`
                              : plan.totalHours > 8
                                ? `Obciążenie ${plan.totalHours.toFixed(1)} h - może wymagać drugiej ekipy.`
                                : `${plan.missingAddress} zleceń bez adresu.`}
                          </Text>
                        </View>
                      ) : null}

                      {plan.next ? (
                        <View style={S.ekipaNextRow}>
                          <View style={[S.nextRouteTime, { borderColor: ekipaKolor, backgroundColor: ekipaKolor + '16' }]}>
                            <Text style={[S.nextRouteTimeText, { color: ekipaKolor }]}>{taskTimeLabel(plan.next)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={S.nextRouteLabel}>Następne zlecenie</Text>
                            <Text style={S.nextRouteClient} numberOfLines={1}>{plan.next.klient_nazwa || t('harmonogram.noClient')}</Text>
                            <Text style={S.nextRouteAddress} numberOfLines={1}>{[plan.next.adres, plan.next.miasto].filter(Boolean).join(', ') || 'Brak adresu'}</Text>
                          </View>
                          <TouchableOpacity
                            style={S.nextRouteOpen}
                            onPress={() => {
                              void triggerHaptic('light');
                              router.push(`/zlecenie/${plan.next.id}`);
                            }}
                          >
                            <Text style={S.nextRouteOpenText}>Karta</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      <View style={S.ekipaActionsRow}>
                        <TouchableOpacity
                          style={S.routeSmallBtn}
                          onPress={() => {
                            void triggerHaptic('light');
                            void shareDayBrief(`Odprawa - ${ekipa.nazwa || `Ekipa #${ekipa.id}`}`, plan.tasks);
                          }}
                        >
                          <PlatinumIconBadge icon="document-text-outline" color={theme.success} size={8} style={S.routeSmallIcon} />
                          <Text style={[S.routeSmallText, { color: theme.success }]}>Brief</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            S.routeSmallBtn,
                            {
                              opacity: plan.routeStops.length ? 1 : 0.55,
                              borderColor: plan.routeStops.length ? theme.accent + '55' : theme.border,
                            },
                          ]}
                          disabled={!plan.routeStops.length}
                          onPress={() => {
                            void triggerHaptic('light');
                            void openRouteInMaps(plan.routeStops);
                          }}
                        >
                          <PlatinumIconBadge icon="map-outline" color={plan.routeStops.length ? theme.accent : theme.textMuted} size={8} style={S.routeSmallIcon} />
                          <Text style={[S.routeSmallText, { color: plan.routeStops.length ? theme.accent : theme.textMuted }]}>Trasa ekipy</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={S.routeSmallBtn}
                          onPress={() => {
                            void triggerHaptic('light');
                            openReservationContext({ teamId: ekipa.id });
                          }}
                        >
                          <PlatinumIconBadge icon="cube-outline" color={plan.equipmentConflictCount ? theme.danger : theme.info} size={8} style={S.routeSmallIcon} />
                          <Text style={[S.routeSmallText, { color: plan.equipmentConflictCount ? theme.danger : theme.info }]}>Sprzet</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={S.routeSmallBtn}
                          onPress={() => {
                            void triggerHaptic('light');
                            router.push('/potwierdzenia-ekip' as never);
                          }}
                        >
                          <PlatinumIconBadge icon="people-circle-outline" color={theme.success} size={8} style={S.routeSmallIcon} />
                          <Text style={[S.routeSmallText, { color: theme.success }]}>Obecność</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Task detail modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <TouchableOpacity style={S.modalOverlay} activeOpacity={1} onPress={() => setModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={S.modalBox}>
            {selectedTask && (
              <>
                <View style={S.modalHeader}>
                  <Text style={S.modalTitle}>{selectedTask.klient_nazwa}</Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
                  </TouchableOpacity>
                </View>
                <View style={[S.statusBadge, { backgroundColor: getKolor(selectedTask) + '22', alignSelf: 'flex-start', marginBottom: 12 }]}>
                  <Text style={[S.statusText, { color: getKolor(selectedTask) }]}>
                    {selectedTask.status ? taskStatusLabel(selectedTask.status) || selectedTask.status : ''}
                  </Text>
                </View>
                <View style={S.modalCalendarCard}>
                  <View style={S.modalCalendarTop}>
                    <PlatinumIconBadge icon="calendar-number-outline" color={theme.accent} size={12} style={S.modalCalendarIcon} />
                    <View style={{ flex: 1 }}>
                      <Text style={S.modalCalendarEyebrow}>Karta dnia ekipy</Text>
                      <Text style={S.modalCalendarTitle} numberOfLines={2}>
                        {taskAddressLabel(selectedTask) || selectedTask.klient_nazwa || 'Zlecenie bez adresu'}
                      </Text>
                    </View>
                  </View>
                  <View style={S.modalCalendarMetaGrid}>
                    <View style={S.modalCalendarMeta}>
                      <Text style={S.modalCalendarMetaLabel}>Czas</Text>
                      <Text style={S.modalCalendarMetaValue}>
                        {taskTimeLabel(selectedTask)}-{taskEndTimeLabel(selectedTask)}
                      </Text>
                    </View>
                    <View style={S.modalCalendarMeta}>
                      <Text style={S.modalCalendarMetaLabel}>Ekipa</Text>
                      <Text style={S.modalCalendarMetaValue} numberOfLines={1}>
                        {selectedTask.ekipa_nazwa || 'Do przypisania'}
                      </Text>
                    </View>
                    <View style={S.modalCalendarMeta}>
                      <Text style={S.modalCalendarMetaLabel}>Foto</Text>
                      <Text style={S.modalCalendarMetaValue}>
                        {taskPhotoReadyCount(selectedTask)}/{FIELD_PHOTO_REQUIREMENTS.length}
                      </Text>
                    </View>
                  </View>
                  <View style={S.modalCalendarActions}>
                    <TouchableOpacity
                      style={[S.modalCalendarAction, !taskAddressLabel(selectedTask) && { opacity: 0.55 }]}
                      disabled={!taskAddressLabel(selectedTask)}
                      onPress={() => {
                        void triggerHaptic('light');
                        void openAddressInMaps(selectedTask.adres || '', selectedTask.miasto || '');
                      }}
                    >
                      <PlatinumIconBadge icon="map-outline" color={theme.info} size={9} style={S.routeSmallIcon} />
                      <Text style={[S.modalCalendarActionText, { color: theme.info }]}>Mapa</Text>
                    </TouchableOpacity>
                    {taskPhoneNumber(selectedTask) ? (
                      <TouchableOpacity
                        style={S.modalCalendarAction}
                        onPress={() => {
                          void triggerHaptic('light');
                          void openTaskPhone(selectedTask);
                        }}
                      >
                        <PlatinumIconBadge icon="call-outline" color={theme.success} size={9} style={S.routeSmallIcon} />
                        <Text style={[S.modalCalendarActionText, { color: theme.success }]}>Telefon</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={S.modalCalendarAction}
                      onPress={() => {
                        void triggerHaptic('light');
                        setModalVisible(false);
                        router.push(`/zlecenie/${selectedTask.id}?tab=zdjecia` as never);
                      }}
                    >
                      <PlatinumIconBadge icon="images-outline" color={theme.accent} size={9} style={S.routeSmallIcon} />
                      <Text style={[S.modalCalendarActionText, { color: theme.accent }]}>Zdjecia</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {[
                  { icon: 'location-outline' as const, val: taskAddressLabel(selectedTask) || null },
                  { icon: 'time-outline' as const, val: selectedTask.godzina_rozpoczecia ? `Godzina: ${selectedTask.godzina_rozpoczecia}` : null },
                  { icon: 'people-outline' as const, val: selectedTask.ekipa_nazwa ? `Ekipa: ${selectedTask.ekipa_nazwa}` : null },
                  { icon: 'leaf-outline' as const, val: selectedTask.typ_uslugi ? `Typ: ${selectedTask.typ_uslugi}` : null },
                  { icon: 'flash-outline' as const, val: selectedTask.priorytet ? `Priorytet: ${selectedTask.priorytet}` : null },
                  { icon: 'hourglass-outline' as const, val: selectedTask.czas_planowany_godziny ? `Czas: ${selectedTask.czas_planowany_godziny}h` : null },
                  { icon: 'cash-outline' as const, val: selectedTask.wartosc_planowana ? `Wartość: ${selectedTask.wartosc_planowana} zł` : null },
                  { icon: 'document-text-outline' as const, val: isFieldHandoffTask(selectedTask) ? null : selectedTask.notatki_wewnetrzne || null },
                ].filter(r => r.val).map((r, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <PlatinumIconBadge icon={r.icon} color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={S.modalRow}>{r.val}</Text>
                  </View>
                ))}
                {isFieldHandoffTask(selectedTask) ? (
                  <View style={S.modalHandoffBox}>
                    <View style={S.fieldSlotHead}>
                      <PlatinumIconBadge icon="flag-outline" color={theme.success} size={11} style={S.fieldSlotIcon} />
                      <View style={{ flex: 1 }}>
                        <Text style={S.modalHandoffTitle}>Odprawa z terenu</Text>
                        <Text style={S.fieldSlotSub}>{taskHandoffSummary(selectedTask).result}</Text>
                      </View>
                    </View>
                    <View style={S.fieldSlotChecks}>
                      {taskFieldReadyChecks(selectedTask).map((item) => (
                        <View
                          key={item.key}
                          style={[
                            S.fieldCheckChip,
                            {
                              borderColor: item.ok ? theme.success + '70' : theme.warning + '70',
                              backgroundColor: item.ok ? theme.successBg : theme.warningBg,
                            },
                          ]}
                        >
                          <Text style={[S.fieldCheckText, { color: item.ok ? theme.success : theme.warning }]}>
                            {item.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {[
                      { label: 'Zakres', value: taskHandoffSummary(selectedTask).work },
                      { label: 'Ryzyka', value: taskHandoffSummary(selectedTask).risks },
                      { label: 'Dojazd', value: taskHandoffSummary(selectedTask).access },
                    ].map((item) => (
                      <View key={item.label} style={S.modalHandoffRow}>
                        <Text style={S.fieldSummaryLabel}>{item.label}</Text>
                        <Text style={S.fieldSummaryText}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <View style={S.modalEquipmentBox}>
                  <View style={S.modalEquipmentHead}>
                    <PlatinumIconBadge
                      icon="cube-outline"
                      color={selectedTaskEquipmentRows.some((row) => equipmentConflictKeys.has(String(row.sprzet_id || ''))) ? theme.danger : theme.info}
                      size={10}
                      style={S.routeSmallIcon}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={S.modalEquipmentTitle}>Sprzet do pracy</Text>
                      <Text style={S.modalEquipmentSub}>
                        {selectedTaskEquipmentRows.length
                          ? `${selectedTaskEquipmentRows.length} rezerwacji podpietych do zlecenia.`
                          : 'Brak sprzetu podpietego do tego zlecenia.'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={S.modalEquipmentBtn}
                      onPress={() => {
                        void triggerHaptic('light');
                        setModalVisible(false);
                        openReservationContext({ taskId: selectedTask.id, teamId: selectedTask.ekipa_id });
                      }}
                    >
                      <Text style={S.modalEquipmentBtnText}>Rezerwuj</Text>
                    </TouchableOpacity>
                  </View>
                  {selectedTaskEquipmentRows.slice(0, 3).map((row) => {
                    const hasConflict = equipmentConflictKeys.has(String(row.sprzet_id || ''));
                    return (
                      <TouchableOpacity
                        key={String(row.id)}
                        style={[S.modalEquipmentRow, hasConflict && { borderColor: theme.danger + '66', backgroundColor: theme.dangerBg }]}
                        onPress={() => {
                          void triggerHaptic('light');
                          setModalVisible(false);
                          openReservationContext({
                            date: dateKey(row.data_od) || selectedDateKey,
                            taskId: row.task_id || selectedTask.id,
                            teamId: row.ekipa_id || selectedTask.ekipa_id,
                            equipmentId: row.sprzet_id,
                          });
                        }}
                      >
                        <Text style={[S.modalEquipmentName, { color: hasConflict ? theme.danger : theme.text }]} numberOfLines={1}>
                          {reservationDisplayName(row)}
                        </Text>
                        <Text style={[S.modalEquipmentStatus, { color: hasConflict ? theme.danger : theme.textMuted }]}>
                          {hasConflict ? 'Kolizja' : row.status || 'OK'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <PlatinumCTA
                  label={t('harmonogram.openTask')}
                  style={S.openBtn}
                  onPress={() => {
                    void triggerHaptic('light');
                    setModalVisible(false);
                    router.push(`/zlecenie/${selectedTask.id}`);
                  }}
                />
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },

  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.cardBg, paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  navBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.bg, justifyContent: 'center', alignItems: 'center' },
  monthTitle: { fontSize: 17, fontWeight: 'bold', color: t.accent },

  calendarBox: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.18,
      radius: t.shadowRadius * 0.45,
      offsetY: Math.max(2, t.shadowOffsetY - 1),
      elevation: 1,
    }),
  },
  weekRow: { flexDirection: 'row' },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  dayHeaderText: { fontSize: 12, fontWeight: '600', color: t.textMuted },
  dayCell: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8, margin: 2, paddingVertical: 4 },
  todayCell: { borderWidth: 2, borderColor: t.accent },
  selectedCell: { backgroundColor: t.accent },
  emptyCell: { backgroundColor: 'transparent' },
  dayNum: { fontSize: 14, color: t.textSub, fontWeight: '500' },
  dayNumSelected: { color: t.accentText, fontWeight: 'bold' },
  dayNumToday: { color: t.accent, fontWeight: 'bold' },
  dot: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2 },
  dotText: { fontSize: 10, fontWeight: 'bold' },

  daySection: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.18,
      radius: t.shadowRadius * 0.45,
      offsetY: Math.max(2, t.shadowOffsetY - 1),
      elevation: 1,
    }),
  },
  daySectionTitle: { fontSize: 16, fontWeight: 'bold', color: t.accent, marginBottom: 12 },
  opsPanel: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  opsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  opsIcon: { width: 30, height: 30, borderRadius: 10 },
  opsTitle: { fontSize: 14, fontWeight: '900' },
  opsSub: { color: t.textSub, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  opsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  opsTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 82,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  opsValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  opsLabel: { color: t.textMuted, fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' },
  opsWarning: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.warning + '55',
    backgroundColor: t.cardBg,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  opsWarningText: { flex: 1, color: t.warning, fontSize: 11.5, fontWeight: '800' },
  teamFilterRow: {
    gap: 8,
    paddingRight: 12,
    paddingBottom: 10,
  },
  teamFilterChip: {
    minHeight: 38,
    maxWidth: 190,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  teamFilterText: { maxWidth: 130, fontSize: 11.5, fontWeight: '900' },
  teamFilterCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  teamFilterCountText: { fontSize: 10.5, fontWeight: '900', fontVariant: ['tabular-nums'] },
  filterEmptyBox: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  filterEmptyTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  filterEmptyText: { color: t.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  equipmentPanel: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.info + '45',
    backgroundColor: t.surface2,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  equipmentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  equipmentIcon: { width: 32, height: 32, borderRadius: 11 },
  equipmentTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  equipmentSub: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  equipmentAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.info + '55',
    backgroundColor: t.info + '12',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  equipmentActionText: { color: t.info, fontSize: 11, fontWeight: '900' },
  equipmentStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  equipmentStat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 8,
    alignItems: 'center',
  },
  equipmentStatValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  equipmentStatLabel: { color: t.textMuted, fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase' },
  equipmentRow: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  equipmentDot: { width: 8, height: 8, borderRadius: 4 },
  equipmentName: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  equipmentMeta: { color: t.textMuted, fontSize: 10.5, marginTop: 1 },
  equipmentBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  equipmentBadgeText: { fontSize: 10, fontWeight: '900' },
  equipmentTaskBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  equipmentTaskBtnText: { color: t.accent, fontSize: 10, fontWeight: '900' },
  equipmentEmpty: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    padding: 10,
  },
  equipmentEmptyText: { color: t.textMuted, fontSize: 11.5, textAlign: 'center' },
  equipmentMore: { color: t.textMuted, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  emptyDay: { alignItems: 'center', paddingVertical: 20 },
  emptyDayText: { color: t.textMuted, fontSize: 14, marginBottom: 12 },
  addBtn: {
    marginTop: 8,
  },
  routeCommandCard: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  routeCommandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeCommandIcon: { width: 36, height: 36, borderRadius: 12 },
  routeCommandTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  routeCommandSub: { color: t.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  routeStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  routeStatTile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 68,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  routeStatValue: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  routeStatLabel: { color: t.textMuted, fontSize: 9.5, fontWeight: '800', textTransform: 'uppercase' },
  routeProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    padding: 10,
  },
  routeProgressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  routeProgressLabel: { color: t.textMuted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  routeProgressValue: { color: t.text, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  routeProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: t.surface2,
  },
  routeProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  routeMapButtons: {
    gap: 7,
    alignItems: 'stretch',
  },
  routeMapButton: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  routeMapIcon: { width: 17, height: 17, borderRadius: 6 },
  routeMapText: { fontSize: 11, fontWeight: '900' },
  nextRouteCard: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nextRouteTime: {
    width: 58,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  nextRouteTimeText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  nextRouteLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  nextRouteClient: { color: t.text, fontSize: 14, fontWeight: '900', marginTop: 1 },
  nextRouteAddress: { color: t.textSub, fontSize: 11, marginTop: 2 },
  nextRouteOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  nextRouteOpenText: { color: t.accent, fontSize: 11, fontWeight: '900' },
  nextRouteOpenIcon: { width: 16, height: 16, borderRadius: 6 },

  taskCard: {
    flexDirection: 'row', borderRadius: 12, backgroundColor: t.surface2,
    marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder,
  },
  taskStatusBar: { width: 5 },
  routeRail: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRightWidth: 1,
    borderRightColor: t.border,
    backgroundColor: t.cardBg,
    paddingVertical: 10,
  },
  routeIndex: { color: t.textMuted, fontSize: 10, fontWeight: '900' },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeTime: { color: t.text, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  routeEndTime: { color: t.textMuted, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  taskContent: { flex: 1, padding: 12 },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  taskClient: { fontSize: 15, fontWeight: '600', color: t.text, flex: 1, marginRight: 8 },
  taskAddr: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  taskMeta: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  routeCardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
  },
  photoPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  photoPillIcon: { width: 15, height: 15, borderRadius: 5 },
  photoPillText: { fontSize: 10.5, fontWeight: '900' },
  routeSmallBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  routeSmallIcon: { width: 15, height: 15, borderRadius: 5 },
  routeSmallText: { fontSize: 10.5, fontWeight: '900' },
  executionPanel: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  executionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  executionIcon: { width: 22, height: 22, borderRadius: 8 },
  executionTitle: { fontSize: 11.5, fontWeight: '900' },
  executionSub: { color: t.textMuted, fontSize: 10.5, fontWeight: '800', marginTop: 1 },
  executionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  executionCheck: {
    flexGrow: 1,
    minWidth: 76,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  executionCheckIcon: { width: 13, height: 13, borderRadius: 5 },
  executionCheckText: { fontSize: 9.5, fontWeight: '900' },
  fieldExecutionPanel: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  fieldExecutionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldExecutionIcon: { width: 24, height: 24, borderRadius: 8 },
  fieldExecutionTitle: { fontSize: 12, fontWeight: '900' },
  fieldExecutionSub: { color: t.textMuted, fontSize: 10.5, fontWeight: '800', marginTop: 1 },
  fieldExecutionDocs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  fieldExecutionDoc: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  fieldExecutionDocText: { fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
  fieldSlotPanel: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.success + '45',
    backgroundColor: t.successBg,
    padding: 10,
    gap: 8,
  },
  fieldSlotHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldSlotIcon: { width: 24, height: 24, borderRadius: 8 },
  fieldSlotTitle: { color: t.text, fontSize: 12, fontWeight: '900' },
  fieldSlotSub: { color: t.textMuted, fontSize: 10.5, lineHeight: 14, marginTop: 1 },
  fieldSlotScore: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.success + '55',
    backgroundColor: t.cardBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fieldSlotScoreText: { color: t.success, fontSize: 10.5, fontWeight: '900', fontVariant: ['tabular-nums'] },
  fieldSlotChecks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  fieldCheckChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fieldCheckText: { fontSize: 10, fontWeight: '900' },
  fieldSummaryGrid: {
    gap: 6,
  },
  fieldSummaryItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  fieldSummaryLabel: { color: t.textMuted, fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase' },
  fieldSummaryText: { color: t.textSub, fontSize: 11.5, lineHeight: 16, marginTop: 2 },

  ekipySection: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.18,
      radius: t.shadowRadius * 0.45,
      offsetY: Math.max(2, t.shadowOffsetY - 1),
      elevation: 1,
    }),
  },
  ekipySectionTitle: { fontSize: 15, fontWeight: 'bold', color: t.text },
  ekipaRouteCard: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  ekipaRouteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ekipaRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  ekipaStatusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  ekipaNazwa: { fontSize: 14, fontWeight: '600', color: t.text },
  ekipaInfo: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  ekipaStatusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  ekipaDostepnosc: { fontSize: 13, fontWeight: '600' },
  ekipaStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ekipaStatTile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 64,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  ekipaStatValue: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  ekipaStatLabel: { color: t.textMuted, fontSize: 9.5, fontWeight: '800', textTransform: 'uppercase' },
  ekipaProgressBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    padding: 10,
  },
  ekipaNextRow: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ekipaActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  teamWarningBox: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  teamWarningText: { flex: 1, fontSize: 11.5, lineHeight: 16, fontWeight: '900' },
  teamEquipmentBox: {
    borderWidth: 1,
    borderColor: t.info + '35',
    backgroundColor: t.cardBg,
    borderRadius: 12,
    padding: 10,
    gap: 7,
  },
  teamEquipmentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  teamEquipmentTitle: { color: t.text, fontSize: 11.5, fontWeight: '900', textTransform: 'uppercase' },
  teamEquipmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  teamEquipmentName: { flex: 1, fontSize: 11.5, fontWeight: '800' },
  teamEquipmentStatus: { fontSize: 10.5, fontWeight: '900' },
  teamEquipmentMore: { color: t.textMuted, fontSize: 10.5, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.88)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: t.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: t.cardBorder,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: t.text, flex: 1, marginRight: 8 },
  modalRow: { fontSize: 14, color: t.textSub, flex: 1 },
  modalCalendarCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.accent + '40',
    backgroundColor: t.accentLight,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  modalCalendarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalCalendarIcon: { width: 30, height: 30, borderRadius: 10 },
  modalCalendarEyebrow: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  modalCalendarTitle: { color: t.text, fontSize: 14, fontWeight: '900', marginTop: 1 },
  modalCalendarMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalCalendarMeta: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  modalCalendarMetaLabel: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  modalCalendarMetaValue: { color: t.text, fontSize: 12, fontWeight: '900', marginTop: 2 },
  modalCalendarActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalCalendarAction: {
    flexGrow: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.cardBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  modalCalendarActionText: { fontSize: 12, fontWeight: '900' },
  modalHandoffBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.success + '45',
    backgroundColor: t.successBg,
    padding: 12,
    gap: 8,
    marginTop: 4,
  },
  modalHandoffTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  modalHandoffRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalEquipmentBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.info + '45',
    backgroundColor: t.surface2,
    padding: 12,
    gap: 8,
    marginTop: 10,
  },
  modalEquipmentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalEquipmentTitle: { color: t.text, fontSize: 13.5, fontWeight: '900' },
  modalEquipmentSub: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 1 },
  modalEquipmentBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.info + '55',
    backgroundColor: t.info + '12',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  modalEquipmentBtnText: { color: t.info, fontSize: 11, fontWeight: '900' },
  modalEquipmentRow: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalEquipmentName: { flex: 1, fontSize: 12, fontWeight: '900' },
  modalEquipmentStatus: { fontSize: 10.5, fontWeight: '900' },
  openBtn: { marginTop: 16 },
});
