import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, RefreshControl, ScrollView,
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
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';
import { openAddressInMaps, openRouteInMaps } from '../utils/maps-link';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { TASK_STATUS, isTaskClosed, makeTaskStatusColorMap } from '../constants/task-workflow';

const FIELD_PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Wycena', icon: 'camera-outline' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline' },
] as const;

function taskNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
        const tasks: any[] = await res.json();
        const counts: Record<string, number> = {};
        tasks.forEach(t => {
          if (t.data_planowana) {
            const d = t.data_planowana.split('T')[0];
            counts[d] = (counts[d] || 0) + 1;
          }
        });
        setMarkedDays(counts);
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
      const res = await fetch(`${API_URL}/tasks/wszystkie`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const all: any[] = await res.json();
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
  const sortedDayTasks = useMemo(() => [...dayTasks].sort(sortRouteTasks), [dayTasks]);
  const routePlan = useMemo(() => {
    const active = sortedDayTasks.filter((task) => !isTaskClosed(task.status));
    const next = active.find((task) => task.status === TASK_STATUS.W_REALIZACJI) ||
      active.find((task) => task.status === TASK_STATUS.ZAPLANOWANE) ||
      active[0] ||
      sortedDayTasks[0] ||
      null;
    const totalHours = sortedDayTasks.reduce((sum, task) => sum + taskNumber(task.czas_planowany_godziny), 0);
    const photosMissing = sortedDayTasks.filter((task) => taskPhotoReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length).length;
    const fieldSlotCount = sortedDayTasks.filter(isFieldHandoffTask).length;
    const routeStops = active
      .map((task) => [task.adres, task.miasto].filter(Boolean).join(', '))
      .filter(Boolean);
    const totalCount = sortedDayTasks.length;
    const doneCount = sortedDayTasks.filter((task) => isTaskClosed(task.status)).length;
    return {
      next,
      activeCount: active.length,
      totalHours,
      photosMissing,
      fieldSlotCount,
      doneCount,
      routeStops,
      progressPct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
    };
  }, [sortedDayTasks]);

  const openSelectedDayRoute = useCallback(async () => {
    void triggerHaptic('light');
    await openRouteInMaps(routePlan.routeStops);
  }, [routePlan.routeStops]);

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
                      { key: 'count', label: 'Zlecenia', value: sortedDayTasks.length, color: theme.accent },
                      { key: 'active', label: 'Aktywne', value: routePlan.activeCount, color: theme.warning },
                      { key: 'hours', label: 'Godziny', value: routePlan.totalHours ? routePlan.totalHours.toFixed(1) : '0', color: theme.info },
                      { key: 'photos', label: 'Braki foto', value: routePlan.photosMissing, color: routePlan.photosMissing ? theme.danger : theme.success },
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
                        <Text style={S.routeProgressValue}>{routePlan.doneCount}/{sortedDayTasks.length}</Text>
                      </View>
                      <View style={S.routeProgressTrack}>
                        <View style={[S.routeProgressFill, { width: `${routePlan.progressPct}%`, backgroundColor: theme.success }]} />
                      </View>
                    </View>
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
                        Trasa dnia
                      </Text>
                    </TouchableOpacity>
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

                {sortedDayTasks.map((task, index) => {
                  const photoReadyCount = taskPhotoReadyCount(task);
                  const photosDone = photoReadyCount >= FIELD_PHOTO_REQUIREMENTS.length;
                  const isFieldSlot = isFieldHandoffTask(task);
                  const handoff = taskHandoffSummary(task);
                  const handoffChecks = taskFieldReadyChecks(task);
                  const handoffReadyCount = handoffChecks.filter((item) => item.ok).length;
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
            {ekipy.map((ekipa: any) => {
              const zadania = dayTasks.filter((t: any) => t.ekipa_id === ekipa.id);
              const zajety = zadania.length > 0;
              const ekipaKolor = ekipa.kolor || theme.textMuted;
              return (
                <View key={ekipa.id} style={[S.ekipaRow, zajety && { backgroundColor: ekipaKolor + '15' }]}>
                  <View style={[S.ekipaStatusDot, { backgroundColor: ekipaKolor, opacity: zajety ? 1 : 0.4 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={S.ekipaNazwa}>{ekipa.nazwa}{ekipa.delegowany ? ' · delegacja' : ''}</Text>
                    {zajety && (
                      <Text style={S.ekipaInfo}>{t('harmonogram.tasksThisDay', { count: zadania.length })}</Text>
                    )}
                  </View>
                  <Text style={[S.ekipaDostepnosc, { color: zajety ? ekipaKolor : theme.textMuted }]}>
                    {zajety ? t('harmonogram.teamBusy') : t('harmonogram.teamFree')}
                  </Text>
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
                {[
                  { icon: 'location-outline' as const, val: `${selectedTask.adres}, ${selectedTask.miasto}` },
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
  ekipaRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  ekipaStatusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  ekipaNazwa: { fontSize: 14, fontWeight: '600', color: t.text },
  ekipaInfo: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  ekipaDostepnosc: { fontSize: 13, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.88)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: t.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: t.cardBorder,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: t.text, flex: 1, marginRight: 8 },
  modalRow: { fontSize: 14, color: t.textSub, flex: 1 },
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
  openBtn: { marginTop: 16 },
});
