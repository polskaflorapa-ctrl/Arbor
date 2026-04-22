import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, RefreshControl, ScrollView,
  StyleSheet, StatusBar, Text, TouchableOpacity, View
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { getStoredSession } from '../utils/session';

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
        const eRes = await fetch(`${API_URL}/ekipy`, { headers: h });
        if (eRes.ok) setEkipy(await eRes.json());
      }
    } catch {
      // po odświeżeniu użytkownik dostanie kolejny fetch
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, user?.rola]);

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

  const statusKolorMap = useMemo(() => ({
    Nowe: theme.info,
    Zaplanowane: theme.chartViolet,
    W_Realizacji: theme.warning,
    Zakonczone: theme.success,
    Anulowane: theme.danger,
  }), [theme]);

  const taskStatusLabel = useCallback(
    (code: string) => t(`zlecenia.status.${code}`),
    [t],
  );

  const ekipaKolorMap: Record<number, string> = Object.fromEntries(
    ekipy.filter((e: any) => e.kolor).map((e: any) => [e.id, e.kolor])
  );
  const getKolor = (task: any): string =>
    ekipaKolorMap[task.ekipa_id] || statusKolorMap[task.status as keyof typeof statusKolorMap] || theme.textMuted;

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
            <Ionicons name="chevron-back" size={22} color={theme.accent} />
          </TouchableOpacity>
          <Text style={S.monthTitle}>{monthTitle}</Text>
          <TouchableOpacity onPress={nextMonth} style={S.navBtn}>
            <Ionicons name="chevron-forward" size={22} color={theme.accent} />
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
            ) : dayTasks.length === 0 ? (
              <View style={S.emptyDay}>
                <Text style={S.emptyDayText}>{t('harmonogram.emptyDay')}</Text>
                {isManager && (
                  <PlatinumCTA
                    label={t('harmonogram.addOrder')}
                    style={S.addBtn}
                    onPress={() => {
                      void triggerHaptic('light');
                      router.push('/nowe-zlecenie');
                    }}
                  />
                )}
              </View>
            ) : (
              <>
                {dayTasks.map(task => (
                  <TouchableOpacity
                    key={task.id}
                    style={S.taskCard}
                    onPress={() => { setSelectedTask(task); setModalVisible(true); }}
                  >
                    <View style={[S.taskStatusBar, { backgroundColor: getKolor(task) }]} />
                    <View style={S.taskContent}>
                      <View style={S.taskRow}>
                        <Text style={S.taskClient}>{task.klient_nazwa || t('harmonogram.noClient')}</Text>
                        <View style={[S.statusBadge, { backgroundColor: getKolor(task) + '22' }]}>
                          <Text style={[S.statusText, { color: getKolor(task) }]}>
                            {task.status ? taskStatusLabel(task.status) || task.status : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <Ionicons name="location-outline" size={11} color={theme.textMuted} />
                        <Text style={S.taskAddr}>{task.adres}, {task.miasto}</Text>
                      </View>
                      {task.godzina_rozpoczecia ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="time-outline" size={11} color={theme.textMuted} />
                          <Text style={S.taskMeta}>{task.godzina_rozpoczecia}</Text>
                        </View>
                      ) : null}
                      {task.ekipa_nazwa ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="people-outline" size={11} color={theme.textMuted} />
                          <Text style={S.taskMeta}>{task.ekipa_nazwa}</Text>
                        </View>
                      ) : null}
                      {task.typ_uslugi ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="leaf-outline" size={11} color={theme.textMuted} />
                          <Text style={S.taskMeta}>{task.typ_uslugi}</Text>
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
                {isManager && (
                  <PlatinumCTA
                    label={t('harmonogram.addOrder')}
                    style={S.addBtn}
                    onPress={() => {
                      void triggerHaptic('light');
                      router.push('/nowe-zlecenie');
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
              <Ionicons name="people-outline" size={16} color={theme.accent} />
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
                    <Text style={S.ekipaNazwa}>{ekipa.nazwa}</Text>
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
                    <Ionicons name="close" size={22} color={theme.textMuted} />
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
                  { icon: 'document-text-outline' as const, val: selectedTask.notatki_wewnetrzne || null },
                ].filter(r => r.val).map((r, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Ionicons name={r.icon} size={14} color={theme.textMuted} />
                    <Text style={S.modalRow}>{r.val}</Text>
                  </View>
                ))}
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
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, justifyContent: 'center', alignItems: 'center' },
  monthTitle: { fontSize: 17, fontWeight: 'bold', color: t.accent },

  calendarBox: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 16, padding: 12,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.5,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
    borderWidth: 1, borderColor: t.cardBorder,
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
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.5,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
  },
  daySectionTitle: { fontSize: 16, fontWeight: 'bold', color: t.accent, marginBottom: 12 },
  emptyDay: { alignItems: 'center', paddingVertical: 20 },
  emptyDayText: { color: t.textMuted, fontSize: 14, marginBottom: 12 },
  addBtn: {
    marginTop: 8,
  },

  taskCard: {
    flexDirection: 'row', borderRadius: 12, backgroundColor: t.surface2,
    marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder,
  },
  taskStatusBar: { width: 5 },
  taskContent: { flex: 1, padding: 12 },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  taskClient: { fontSize: 15, fontWeight: '600', color: t.text, flex: 1, marginRight: 8 },
  taskAddr: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  taskMeta: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },

  ekipySection: {
    backgroundColor: t.cardBg, margin: 12, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: t.cardBorder,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.5,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 2,
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
  openBtn: { marginTop: 16 },
});
