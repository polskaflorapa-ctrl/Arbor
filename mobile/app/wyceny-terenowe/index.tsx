import { safeBack } from '../../utils/navigation';
/**
 * Lista paczek oględzin dla specjalisty ds. wyceny.
 * To jest mobilny odpowiednik jednej ścieżki: telefon w biurze -> teren -> pakiet dla biura.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppStatusBar } from '../../components/ui/app-status-bar';
import { KeyboardSafeScreen } from '../../components/ui/keyboard-safe-screen';
import { PlatinumAppear } from '../../components/ui/platinum-appear';
import { useTheme } from '../../constants/ThemeContext';
import { API_URL } from '../../constants/api';
import type { Theme } from '../../constants/theme';
import { TASK_STATUS, isTaskClosed, normalizeTaskStatus } from '../../constants/task-workflow';
import { openAddressInMaps } from '../../utils/maps-link';
import { buildNewOrderRoute, currentNewOrderDateTime } from '../../utils/new-order-route';
import { getStoredSession } from '../../utils/session';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const FIELD_PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Wycena', icon: 'camera-outline', type: 'wycena' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline', type: 'szkic' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline', type: 'dojazd' },
] as const;

type FieldTaskRow = {
  id: number;
  status?: string;
  klient_nazwa?: string;
  klient_telefon?: string;
  adres?: string;
  miasto?: string;
  typ_uslugi?: string;
  data_planowana?: string;
  godzina_rozpoczecia?: string;
  oddzial_nazwa?: string;
  wyceniajacy_id?: number | string | null;
  wyceniajacy_nazwa?: string | null;
  ankieta_uproszczona?: boolean;
  wartosc_planowana?: number | string | null;
  czas_planowany_godziny?: number | string | null;
  notatki?: string | null;
  notatki_wewnetrzne?: string | null;
  opis?: string | null;
  opis_pracy?: string | null;
  photo_total?: number | string | null;
  photo_wycena?: number | string | null;
  photo_szkic?: number | string | null;
  photo_dojazd?: number | string | null;
  workflow_ready_for_next?: boolean;
  workflow_next_action?: string;
  workflow_missing_labels?: string[];
  missing_items?: string[];
};

type LegacyQuoteRow = {
  id: number;
  status?: string;
  klient_nazwa?: string;
  adres?: string;
  miasto?: string;
  wartosc_zaproponowana?: number | string;
  wartosc_szacowana?: number | string;
};

type WycenyMode = 'field' | 'legacy';
type FieldListMode = 'all' | 'today' | 'missing' | 'ready';
type FieldActionTone = 'accent' | 'info' | 'success' | 'warning';
type FieldPhotoFilter = 'wycena' | 'szkic' | 'dojazd' | 'all';
type FieldFocusKey = 'scope' | 'time' | 'budget' | 'risk' | 'settlement' | 'client' | 'photos';
type FieldTaskAction = {
  label: string;
  hint: string;
  cta: string;
  tab: 'info' | 'zdjecia';
  icon: IoniconName;
  tone: FieldActionTone;
  fieldFocus?: FieldFocusKey;
  photoFilter?: FieldPhotoFilter;
};

function taskNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function localDateKey(date: Date | null) {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function taskDateKey(task: FieldTaskRow) {
  return localDateKey(parseDate(task.data_planowana));
}

function taskStartMinutes(task: FieldTaskRow) {
  const raw = String(task.godzina_rozpoczecia || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function taskSortValue(task: FieldTaskRow) {
  const d = parseDate(task.data_planowana);
  if (!d) return Number.MAX_SAFE_INTEGER;
  d.setHours(0, taskStartMinutes(task), 0, 0);
  return d.getTime();
}

function formatSlot(task: FieldTaskRow) {
  const d = parseDate(task.data_planowana);
  if (!d) return 'Brak terminu';
  const day = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit' }).format(d);
  const time = task.godzina_rozpoczecia
    ? String(task.godzina_rozpoczecia).slice(0, 5)
    : new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day}, ${time}`;
}

function isEstimatorRole(role: unknown) {
  const normalized = String(role || '')
    .toLowerCase()
    .replace(/[ą]/g, 'a')
    .replace(/[ę]/g, 'e')
    .replace(/[ł]/g, 'l')
    .replace(/[ń]/g, 'n')
    .replace(/[ó]/g, 'o')
    .replace(/[ś]/g, 's')
    .replace(/[żź]/g, 'z');
  return normalized.includes('wyceniaj');
}

function isAssignedToEstimator(task: FieldTaskRow, user: any) {
  if (!isEstimatorRole(user?.rola)) return true;
  if (task.wyceniajacy_id == null || user?.id == null) return false;
  return String(task.wyceniajacy_id) === String(user.id);
}

function isFieldTask(task: FieldTaskRow) {
  const status = normalizeTaskStatus(task.status);
  return (
    status === TASK_STATUS.WYCENA_TERENOWA ||
    status === TASK_STATUS.DO_ZATWIERDZENIA ||
    task.ankieta_uproszczona === true
  );
}

function isOpenFieldTask(task: FieldTaskRow) {
  return isFieldTask(task) && !isTaskClosed(task.status);
}

function taskEvidenceReadyCount(task: FieldTaskRow) {
  return FIELD_PHOTO_REQUIREMENTS.filter((item) => taskNumber(task[item.key]) > 0).length;
}

function taskMissingEvidence(task: FieldTaskRow) {
  return FIELD_PHOTO_REQUIREMENTS.filter((item) => taskNumber(task[item.key]) <= 0);
}

function taskMissingLabels(task: FieldTaskRow) {
  const fromWorkflow = Array.isArray(task.workflow_missing_labels) ? task.workflow_missing_labels : [];
  const fromEndpoint = Array.isArray(task.missing_items) ? task.missing_items : [];
  const labels = [...fromWorkflow, ...fromEndpoint]
    .map((label) => String(label || '').trim())
    .filter(Boolean);
  if (labels.length) return Array.from(new Set(labels));

  const fallback = [];
  if (taskNumber(task.photo_wycena) <= 0) fallback.push('zdjęcie ogólne');
  if (taskNumber(task.photo_szkic) <= 0) fallback.push('szkic zakresu');
  if (taskNumber(task.photo_dojazd) <= 0) fallback.push('dojazd / posesja');
  if (task.wartosc_planowana == null) fallback.push('budżet');
  if (task.czas_planowany_godziny == null) fallback.push('czas pracy');
  return fallback;
}

function taskReadyForOffice(task: FieldTaskRow) {
  if (isTaskClosed(task.status)) return false;
  const status = normalizeTaskStatus(task.status);
  if (status === TASK_STATUS.DO_ZATWIERDZENIA) return true;
  if (typeof task.workflow_ready_for_next === 'boolean') return task.workflow_ready_for_next;
  return taskEvidenceReadyCount(task) >= FIELD_PHOTO_REQUIREMENTS.length &&
    task.wartosc_planowana != null &&
    task.czas_planowany_godziny != null;
}

function fieldFocusForMissingLabel(label: string): FieldFocusKey {
  const normalized = label.toLowerCase();
  if (/zakres|opis|brief|praca/.test(normalized)) return 'scope';
  if (/czas|godzin/.test(normalized)) return 'time';
  if (/bud|cena|kwot|warto/.test(normalized)) return 'budget';
  if (/ryzyk|bhp|bezpiecze/.test(normalized)) return 'risk';
  if (/rozlicz|warunk/.test(normalized)) return 'settlement';
  if (/akcept|klient/.test(normalized)) return 'client';
  return 'scope';
}

function photoFilterForMissingLabel(label: string): FieldPhotoFilter {
  const normalized = label.toLowerCase();
  if (/szkic|rys/.test(normalized)) return 'szkic';
  if (/dojazd|posesj|bram|adres/.test(normalized)) return 'dojazd';
  if (/zdj|foto|wycen/.test(normalized)) return 'wycena';
  return 'all';
}

function taskNextFieldAction(task: FieldTaskRow): FieldTaskAction {
  const firstPhoto = taskMissingEvidence(task)[0];
  if (firstPhoto) {
    return {
      label: `Zrob: ${firstPhoto.label}`,
      hint: 'Najpierw komplet zdjec: wycena, szkic i dojazd.',
      cta: 'Zrob dowod',
      tab: 'zdjecia',
      icon: firstPhoto.icon as IoniconName,
      tone: 'warning',
      photoFilter: firstPhoto.type,
    };
  }
  const missing = taskMissingLabels(task);
  const firstPhotoLabel = missing.find((label) => /zdj|foto|szkic|dojazd/i.test(label));
  if (firstPhotoLabel) {
    return {
      label: `Zrob: ${firstPhotoLabel}`,
      hint: 'Lista otworzy galerie na brakujacym typie zdjecia.',
      cta: 'Zrob dowod',
      tab: 'zdjecia',
      icon: 'camera-outline',
      tone: 'warning',
      photoFilter: photoFilterForMissingLabel(firstPhotoLabel),
    };
  }
  const firstField = missing.find((label) => !/zdj|foto|szkic|dojazd/i.test(label));
  if (firstField) {
    return {
      label: `Uzupelnij: ${firstField}`,
      hint: 'Dopisz zakres, czas, budzet albo ryzyka w pakiecie.',
      cta: 'Uzupelnij',
      tab: 'info',
      icon: 'create-outline',
      tone: 'warning',
      fieldFocus: fieldFocusForMissingLabel(firstField),
    };
  }
  if (taskReadyForOffice(task)) {
    return {
      label: 'Gotowe do biura',
      hint: 'Pakiet moze wrocic do specjalisty do planowania ekipy.',
      cta: 'Przekaz',
      tab: 'info',
      icon: 'send-outline',
      tone: 'success',
    };
  }
  return {
    label: 'Otworz pakiet',
    hint: 'Sprawdz zdjecia, zakres i ustalenia z klientem.',
    cta: 'Pakiet',
    tab: 'info',
    icon: 'leaf-outline',
    tone: 'accent',
  };
}

function fieldActionColor(tone: FieldActionTone, theme: Theme) {
  if (tone === 'info') return theme.info;
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  return theme.accent;
}

function openFieldTask(task: FieldTaskRow, target: FieldTaskAction | 'info' | 'zdjecia' = 'info') {
  const tab = typeof target === 'string' ? target : target.tab;
  const fieldFocus = typeof target === 'string' ? '' : target.fieldFocus || '';
  const photoFilter = typeof target === 'string' ? '' : target.photoFilter || '';
  const params = new URLSearchParams({ tab });
  if (fieldFocus) params.set('fieldFocus', fieldFocus);
  if (photoFilter) params.set('photoFilter', photoFilter);
  router.push(`/zlecenie/${task.id}?${params.toString()}` as never);
}

function taskScopePreview(task: FieldTaskRow) {
  const raw = String(task.notatki_wewnetrzne || task.opis_pracy || task.opis || task.notatki || '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const important = lines.find((line) => /^(zakres|zadanie wyceniacza|zadanie specjalisty|typ prac|opis|notatka)/i.test(line));
  return important || task.typ_uslugi || 'Oględziny u klienta, zdjęcia, szkic, zakres, czas i budżet.';
}

function taskHasRiskBrief(task: FieldTaskRow) {
  const raw = String([
    task.notatki_wewnetrzne,
    task.notatki,
    task.opis,
    task.opis_pracy,
  ].filter(Boolean).join('\n')).toLowerCase();
  return /ryzyk|bhp|zgod|linie|ogrodzenie|dach|elewac|trudny dojazd|ruch pieszy|brak szczegolnych/.test(raw);
}

function taskFieldBriefChecks(task: FieldTaskRow) {
  const evidenceReady = taskEvidenceReadyCount(task) >= FIELD_PHOTO_REQUIREMENTS.length;
  const numbersReady = taskNumber(task.wartosc_planowana) > 0 && taskNumber(task.czas_planowany_godziny) > 0;
  const riskReady = taskHasRiskBrief(task);
  return [
    {
      key: 'phone',
      label: 'Telefon',
      value: task.klient_telefon ? 'OK' : 'brak',
      ok: Boolean(String(task.klient_telefon || '').trim()),
      icon: 'call-outline' as IoniconName,
    },
    {
      key: 'address',
      label: 'Adres',
      value: [task.adres, task.miasto].filter(Boolean).length ? 'OK' : 'brak',
      ok: Boolean(String(task.adres || task.miasto || '').trim()),
      icon: 'location-outline' as IoniconName,
    },
    {
      key: 'photos',
      label: 'Zdjecia',
      value: `${taskEvidenceReadyCount(task)}/${FIELD_PHOTO_REQUIREMENTS.length}`,
      ok: evidenceReady,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'numbers',
      label: 'Cena/czas',
      value: numbersReady ? 'OK' : 'brak',
      ok: numbersReady,
      icon: 'calculator-outline' as IoniconName,
    },
    {
      key: 'risk',
      label: 'BHP',
      value: riskReady ? 'OK' : 'brak',
      ok: riskReady,
      icon: 'shield-checkmark-outline' as IoniconName,
    },
  ];
}

function fieldResponseItems(data: unknown): FieldTaskRow[] {
  if (Array.isArray(data)) return data as FieldTaskRow[];
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) return (data as any).items;
  return [];
}

function legacyResponseItems(data: unknown): LegacyQuoteRow[] {
  return Array.isArray(data) ? data as LegacyQuoteRow[] : [];
}

export default function WycenyTerenoweScreen() {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fieldTasks, setFieldTasks] = useState<FieldTaskRow[]>([]);
  const [legacyItems, setLegacyItems] = useState<LegacyQuoteRow[]>([]);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<WycenyMode>('field');
  const [fieldFilter, setFieldFilter] = useState<FieldListMode>('all');

  const load = useCallback(async () => {
    try {
      setErr('');
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const res = await fetch(`${API_URL}/tasks/field-drafts?limit=100&offset=0`, { headers });

      if (res.status === 404) {
        const legacyRes = await fetch(`${API_URL}/wyceny`, { headers });
        if (!legacyRes.ok) {
          setMode('legacy');
          setFieldTasks([]);
          setLegacyItems([]);
          setErr(`HTTP ${legacyRes.status}`);
          return;
        }
        const legacyJson = await legacyRes.json();
        setLegacyItems(
          legacyResponseItems(legacyJson).map((row) => ({
            ...row,
            wartosc_zaproponowana: row.wartosc_zaproponowana ?? row.wartosc_szacowana,
          })),
        );
        setFieldTasks([]);
        setMode('legacy');
        return;
      }

      if (!res.ok) {
        setFieldTasks([]);
        setLegacyItems([]);
        setErr(`HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      const list = fieldResponseItems(data)
        .filter(isFieldTask)
        .filter((task) => isAssignedToEstimator(task, user))
        .sort((a, b) => taskSortValue(a) - taskSortValue(b));
      setFieldTasks(list);
      setLegacyItems([]);
      setMode('field');
    } catch {
      setErr('Błąd pobierania paczek oględzin.');
      setFieldTasks([]);
      setLegacyItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const stats = useMemo(() => {
    const todayList = fieldTasks.filter((task) => taskDateKey(task) === todayKey);
    const today = todayList.length;
    const openToday = todayList.filter(isOpenFieldTask).length;
    const ready = fieldTasks.filter(taskReadyForOffice).length;
    const missingEvidence = fieldTasks.filter((task) => taskEvidenceReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length).length;
    const totalPhotos = fieldTasks.reduce((sum, task) => sum + taskNumber(task.photo_total), 0);
    return { today, openToday, ready, missingEvidence, totalPhotos };
  }, [fieldTasks, todayKey]);
  const filteredFieldTasks = useMemo(() => {
    if (fieldFilter === 'today') return fieldTasks.filter((task) => taskDateKey(task) === todayKey);
    if (fieldFilter === 'missing') return fieldTasks.filter((task) => taskMissingEvidence(task).length > 0 || taskMissingLabels(task).length > 0);
    if (fieldFilter === 'ready') return fieldTasks.filter(taskReadyForOffice);
    return fieldTasks;
  }, [fieldFilter, fieldTasks, todayKey]);
  const routeTasks = useMemo(() => {
    const open = fieldTasks.filter(isOpenFieldTask);
    const today = open.filter((task) => taskDateKey(task) === todayKey);
    const source = today.length ? today : open;
    return source.slice(0, 5);
  }, [fieldTasks, todayKey]);
  const nextTask = routeTasks[0] || filteredFieldTasks[0] || null;
  const routeCaption = routeTasks.length
    ? stats.openToday > 0
      ? `${stats.openToday} otwarte dzisiaj, kolejka po godzinie wizyty.`
      : 'Brak otwartych wizyt dzisiaj - pokazuje najbliższe otwarte paczki.'
    : 'Brak otwartych paczek do trasy.';
  const openNewFieldDraft = useCallback(() => {
    router.push(buildNewOrderRoute({ source: 'wyceny-terenowe', ...currentNewOrderDateTime() }) as never);
  }, []);
  const fieldFilters: { key: FieldListMode; label: string; count: number; icon: IoniconName; color: string }[] = [
    { key: 'all', label: 'Wszystkie', count: fieldTasks.length, icon: 'albums-outline', color: theme.accent },
    { key: 'today', label: 'Dzisiaj', count: stats.today, icon: 'calendar-outline', color: theme.info },
    { key: 'missing', label: 'Braki', count: stats.missingEvidence, icon: 'alert-circle-outline', color: stats.missingEvidence ? theme.warning : theme.success },
    { key: 'ready', label: 'Do biura', count: stats.ready, icon: 'send-outline', color: theme.success },
  ];

  if (loading) {
    return (
      <KeyboardSafeScreen style={s.center}>
        <AppStatusBar />
        <ActivityIndicator color={theme.accent} />
      </KeyboardSafeScreen>
    );
  }

  return (
    <KeyboardSafeScreen style={s.screen}>
      <AppStatusBar />
      <View style={s.header}>
        <TouchableOpacity onPress={() => safeBack()} style={s.backBtn} accessibilityLabel="Wróć">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.title}>Oględziny terenowe</Text>
        <View style={{ width: 40 }} />
      </View>
      {err ? <Text style={s.err}>{err}</Text> : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.accent}
          />
        }
      >
        {mode === 'field' ? (
          <>
            <PlatinumAppear>
              <View style={s.hero}>
                <View style={s.heroTop}>
                  <View style={s.heroIcon}>
                    <Ionicons name="leaf-outline" size={22} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.heroEyebrow}>Telefon - teren - biuro</Text>
                    <Text style={s.heroTitle}>Paczki dla specjalisty ds. wyceny</Text>
                    <Text style={s.heroText}>
                      Tu wpadają oględziny utworzone przez biuro. Na miejscu dodajesz zdjęcia, szkic, zakres, czas, budżet i ryzyka.
                    </Text>
                  </View>
                </View>
                <View style={s.statsGrid}>
                  <StatTile label="Dzisiaj" value={stats.today} color={theme.info} styles={s} />
                  <StatTile label="Do biura" value={stats.ready} color={theme.success} styles={s} />
                  <StatTile label="Braki foto" value={stats.missingEvidence} color={stats.missingEvidence ? theme.warning : theme.success} styles={s} />
                  <StatTile label="Zdjęcia" value={stats.totalPhotos} color={theme.accent} styles={s} />
                </View>
                <View style={s.heroActions}>
                  {nextTask ? (
                    <TouchableOpacity
                      style={s.heroStartBtn}
                      onPress={() => openFieldTask(nextTask, taskNextFieldAction(nextTask))}
                    >
                      <Ionicons name="navigate-circle-outline" size={16} color={theme.accentText} />
                      <Text style={s.heroStartText}>Start kolejki</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={s.heroPrimaryBtn} onPress={openNewFieldDraft}>
                    <Ionicons name="flash-outline" size={16} color={theme.accentText} />
                    <Text style={s.heroPrimaryText}>Nowy draft u klienta</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.heroSecondaryBtn} onPress={() => router.push('/plan-ogledzin' as never)}>
                    <Ionicons name="calendar-outline" size={15} color={theme.accent} />
                    <Text style={s.heroSecondaryText}>Plan oględzin</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </PlatinumAppear>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterStrip}>
              {fieldFilters.map((filter) => {
                const active = fieldFilter === filter.key;
                return (
                  <TouchableOpacity
                    key={filter.key}
                    style={[
                      s.filterChip,
                      {
                        borderColor: active ? filter.color : theme.border,
                        backgroundColor: active ? filter.color + '16' : theme.surface2,
                      },
                    ]}
                    onPress={() => setFieldFilter(filter.key)}
                  >
                    <Ionicons name={filter.icon} size={14} color={active ? filter.color : theme.textMuted} />
                    <Text style={[s.filterChipText, { color: active ? filter.color : theme.textSub }]}>{filter.label}</Text>
                    <Text style={[s.filterChipCount, { color: active ? filter.color : theme.textMuted }]}>{filter.count}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {nextTask ? (
              <NextFieldFocusCard task={nextTask} theme={theme} styles={s} />
            ) : null}

            {nextTask ? (
              <PlatinumAppear>
                <View style={s.routePanel}>
                  <View style={s.routeHead}>
                    <View style={s.routeIcon}>
                      <Ionicons name="navigate-circle-outline" size={19} color={theme.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.routeTitle}>Kolejka terenowa</Text>
                      <Text style={s.routeSub}>{routeCaption}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.routeOpenBtn}
                      onPress={() => openFieldTask(nextTask, taskNextFieldAction(nextTask))}
                    >
                      <Text style={s.routeOpenText}>Start</Text>
                      <Ionicons name="chevron-forward" size={14} color={theme.accent} />
                    </TouchableOpacity>
                  </View>
                  <View style={s.routeSummary}>
                    <View style={s.routeSummaryItem}>
                      <Text style={s.routeSummaryValue}>{stats.openToday}</Text>
                      <Text style={s.routeSummaryLabel}>otwarte dziś</Text>
                    </View>
                    <View style={s.routeSummaryItem}>
                      <Text style={s.routeSummaryValue}>{routeTasks.length}</Text>
                      <Text style={s.routeSummaryLabel}>w kolejce</Text>
                    </View>
                    <View style={s.routeSummaryItem}>
                      <Text style={[s.routeSummaryValue, { color: theme.success }]}>{stats.ready}</Text>
                      <Text style={s.routeSummaryLabel}>do biura</Text>
                    </View>
                  </View>
                  {routeTasks.slice(0, 4).map((task, index) => {
                    const action = taskNextFieldAction(task);
                    const color = fieldActionColor(action.tone, theme);
                    return (
                      <TouchableOpacity
                        key={`route-${task.id}`}
                        style={[s.routeRow, { borderColor: index === 0 ? theme.accent : theme.border, backgroundColor: index === 0 ? theme.accentLight : theme.cardBg }]}
                        onPress={() => openFieldTask(task, action)}
                      >
                        <View style={[s.routeIndex, { borderColor: color, backgroundColor: color + '16' }]}>
                          <Text style={[s.routeIndexText, { color }]}>{index + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.routeClient} numberOfLines={1}>{task.klient_nazwa || `Zlecenie #${task.id}`}</Text>
                          <Text style={s.routeMeta} numberOfLines={1}>{formatSlot(task)} - {action.label}</Text>
                        </View>
                        <Ionicons name={action.icon} size={17} color={color} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </PlatinumAppear>
            ) : null}

            {fieldTasks.length === 0 ? (
              <PlatinumAppear>
                <View style={s.emptyBox}>
                  <Ionicons name="checkmark-circle-outline" size={28} color={theme.success} />
                  <Text style={s.emptyTitle}>Brak paczek do wyceny</Text>
                  <Text style={s.emptyText}>Gdy specjalista z biura przyjmie telefon i przypisze specjalistę ds. wyceny, zlecenie pojawi się tutaj.</Text>
                  <View style={s.emptyActions}>
                    <TouchableOpacity style={s.emptyPrimaryBtn} onPress={openNewFieldDraft}>
                      <Ionicons name="add-circle-outline" size={16} color={theme.accentText} />
                      <Text style={s.emptyPrimaryText}>Utwórz draft terenowy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.emptySecondaryBtn} onPress={() => router.push('/plan-ogledzin' as never)}>
                      <Text style={s.emptySecondaryText}>Otwórz plan</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </PlatinumAppear>
            ) : filteredFieldTasks.length === 0 ? (
              <PlatinumAppear>
                <View style={s.emptyBox}>
                  <Ionicons name="filter-outline" size={26} color={theme.textMuted} />
                  <Text style={s.emptyTitle}>Nic w tym filtrze</Text>
                  <Text style={s.emptyText}>Zmien filtr albo odswiez liste paczek z biura.</Text>
                </View>
              </PlatinumAppear>
            ) : (
              filteredFieldTasks.map((task, index) => (
                <PlatinumAppear key={`field-${task.id}`} delayMs={18 * Math.min(index, 10)}>
                  <FieldTaskCard task={task} index={index} isNext={nextTask?.id === task.id} theme={theme} styles={s} />
                </PlatinumAppear>
              ))
            )}
          </>
        ) : (
          <>
            <PlatinumAppear>
              <View style={s.infoBox}>
                <Text style={s.infoTitle}>Tryb zgodności</Text>
                <Text style={s.infoText}>
                  Backend nie ma jeszcze endpointu paczek terenowych. Pokazuję klasyczne wyceny, żeby praca nie stanęła.
                </Text>
                <TouchableOpacity style={s.infoBtn} onPress={() => router.push('/wycena' as never)} activeOpacity={0.78}>
                  <Text style={s.infoBtnTxt}>Otwórz klasyczne wyceny</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.infoBtn, s.infoBtnSecondary]} onPress={openNewFieldDraft} activeOpacity={0.78}>
                  <Text style={[s.infoBtnTxt, s.infoBtnSecondaryTxt]}>Nowy draft terenowy</Text>
                </TouchableOpacity>
              </View>
            </PlatinumAppear>
            {legacyItems.length === 0 ? (
              <PlatinumAppear>
                <Text style={s.muted}>Brak wycen lub brak uprawnień.</Text>
              </PlatinumAppear>
            ) : (
              legacyItems.map((q) => (
                <PlatinumAppear key={`legacy-${q.id}`}>
                  <View style={s.card}>
                    <TouchableOpacity onPress={() => router.push(`/wyceny-terenowe/${q.id}` as never)} activeOpacity={0.75}>
                      <Text style={s.cardTitle}>
                        #{q.id} · {q.status || '—'}
                      </Text>
                      <Text style={s.cardSub}>{q.klient_nazwa || '—'}</Text>
                      <Text style={s.muted}>{[q.adres, q.miasto].filter(Boolean).join(', ')}</Text>
                      {q.wartosc_zaproponowana != null ? (
                        <Text style={s.price}>{Number(q.wartosc_zaproponowana).toFixed(2)} PLN</Text>
                      ) : null}
                    </TouchableOpacity>
                    <TouchableOpacity style={s.mapBtn} onPress={() => void openAddressInMaps(q.adres || '', q.miasto || '')}>
                      <Text style={s.mapBtnTxt}>Mapa</Text>
                    </TouchableOpacity>
                  </View>
                </PlatinumAppear>
              ))
            )}
          </>
        )}
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function StatTile({ label, value, color, styles }: { label: string; value: number; color: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[styles.statTile, { borderColor: color + '44', backgroundColor: color + '12' }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function NextFieldFocusCard({
  task,
  theme,
  styles,
}: {
  task: FieldTaskRow;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const action = taskNextFieldAction(task);
  const actionColor = fieldActionColor(action.tone, theme);
  const checks = taskFieldBriefChecks(task);
  const readyCount = checks.filter((check) => check.ok).length;
  const phoneReady = Boolean(String(task.klient_telefon || '').trim());
  const addressReady = Boolean(String(task.adres || task.miasto || '').trim());

  return (
    <PlatinumAppear>
      <View style={[styles.nextFocusCard, { borderColor: actionColor + '66', backgroundColor: actionColor + '10' }]}>
        <View style={styles.nextFocusHead}>
          <View style={[styles.nextFocusIcon, { borderColor: actionColor + '66', backgroundColor: theme.cardBg }]}>
            <Ionicons name={action.icon} size={19} color={actionColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nextFocusEyebrow}>Nastepny klient</Text>
            <Text style={styles.nextFocusTitle} numberOfLines={1}>
              {task.klient_nazwa || `Zlecenie #${task.id}`}
            </Text>
            <Text style={styles.nextFocusSub} numberOfLines={1}>
              {formatSlot(task)} - {[task.adres, task.miasto].filter(Boolean).join(', ') || 'Brak adresu'}
            </Text>
          </View>
          <View style={[styles.nextFocusScore, { borderColor: actionColor }]}>
            <Text style={[styles.nextFocusScoreValue, { color: actionColor }]}>{readyCount}/{checks.length}</Text>
            <Text style={styles.nextFocusScoreLabel}>pakiet</Text>
          </View>
        </View>

        <Text style={styles.nextFocusScope} numberOfLines={2}>{taskScopePreview(task)}</Text>

        <View style={styles.nextFocusChecks}>
          {checks.map((check) => (
            <View
              key={check.key}
              style={[
                styles.nextFocusCheck,
                {
                  borderColor: check.ok ? theme.success + '66' : theme.warning + '66',
                  backgroundColor: check.ok ? theme.successBg : theme.warningBg,
                },
              ]}
            >
              <Ionicons name={check.ok ? 'checkmark-circle' : check.icon} size={14} color={check.ok ? theme.success : theme.warning} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.nextFocusCheckLabel, { color: check.ok ? theme.success : theme.warning }]} numberOfLines={1}>
                  {check.label}
                </Text>
                <Text style={styles.nextFocusCheckValue} numberOfLines={1}>{check.value}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.nextFocusActions}>
          <TouchableOpacity
            style={[styles.nextFocusAction, { opacity: phoneReady ? 1 : 0.46 }]}
            disabled={!phoneReady}
            onPress={() => {
              if (task.klient_telefon) void Linking.openURL(`tel:${task.klient_telefon}`);
            }}
          >
            <Ionicons name="call-outline" size={15} color={theme.accent} />
            <Text style={styles.nextFocusActionText}>Dzwon</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.nextFocusAction, { opacity: addressReady ? 1 : 0.46 }]}
            disabled={!addressReady}
            onPress={() => void openAddressInMaps(task.adres || '', task.miasto || '')}
          >
            <Ionicons name="map-outline" size={15} color={theme.accent} />
            <Text style={styles.nextFocusActionText}>Mapa</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.nextFocusPrimary, { backgroundColor: actionColor, borderColor: actionColor }]}
            onPress={() => openFieldTask(task, action)}
          >
            <Ionicons name={action.icon} size={15} color={theme.accentText} />
            <Text style={styles.nextFocusPrimaryText}>{action.cta}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </PlatinumAppear>
  );
}

function FieldTaskCard({
  task,
  index,
  isNext,
  theme,
  styles,
}: {
  task: FieldTaskRow;
  index: number;
  isNext: boolean;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const ready = taskReadyForOffice(task);
  const missing = taskMissingLabels(task).slice(0, 4);
  const evidenceReady = taskEvidenceReadyCount(task);
  const phoneReady = Boolean(String(task.klient_telefon || '').trim());
  const addressReady = Boolean(String(task.adres || task.miasto || '').trim());
  const statusColor = ready ? theme.success : theme.warning;
  const packageLabel = ready ? 'Gotowe do biura' : `${evidenceReady}/${FIELD_PHOTO_REQUIREMENTS.length} dowody`;
  const nextAction = taskNextFieldAction(task);
  const actionColor = fieldActionColor(nextAction.tone, theme);

  return (
    <View style={[styles.card, isNext && { borderColor: theme.accent, backgroundColor: theme.accentLight }]}>
      <TouchableOpacity
        onPress={() => openFieldTask(task, nextAction)}
        activeOpacity={0.76}
      >
        <View style={styles.cardHead}>
          <View style={[styles.routeIndex, { borderColor: isNext ? theme.accent : theme.border, backgroundColor: isNext ? theme.accent + '16' : theme.surface2 }]}>
            <Text style={[styles.routeIndexText, { color: isNext ? theme.accent : theme.textMuted }]}>{index + 1}</Text>
          </View>
          <View style={styles.timeBadge}>
            <Text style={styles.timeText}>{formatSlot(task)}</Text>
          </View>
          <View style={[styles.statusBadge, { borderColor: statusColor + '66', backgroundColor: statusColor + '14' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{packageLabel}</Text>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{task.klient_nazwa || `Zlecenie #${task.id}`}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{[task.adres, task.miasto].filter(Boolean).join(', ') || 'Brak adresu'}</Text>
        <Text style={styles.scopeText} numberOfLines={2}>{taskScopePreview(task)}</Text>

        <View style={styles.evidenceRow}>
          {FIELD_PHOTO_REQUIREMENTS.map((item) => {
            const done = taskNumber(task[item.key]) > 0;
            return (
              <View
                key={item.key}
                style={[
                  styles.evidencePill,
                  {
                    borderColor: done ? theme.success : theme.warning,
                    backgroundColor: done ? theme.successBg : theme.warningBg,
                  },
                ]}
              >
                <Ionicons name={(done ? 'checkmark-circle' : item.icon) as IoniconName} size={13} color={done ? theme.success : theme.warning} />
                <Text style={[styles.evidenceText, { color: done ? theme.success : theme.warning }]}>{item.label}</Text>
              </View>
            );
          })}
        </View>

        {missing.length ? (
          <View style={styles.missingBox}>
            <Text style={styles.missingLabel}>Brakuje</Text>
            <Text style={styles.missingText}>{missing.join(', ')}</Text>
          </View>
        ) : null}
        <View style={[styles.nextActionBox, { borderColor: actionColor + '66', backgroundColor: actionColor + '12' }]}>
          <Ionicons name={nextAction.icon} size={16} color={actionColor} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.nextActionLabel, { color: actionColor }]}>{nextAction.label}</Text>
            <Text style={styles.nextActionHint} numberOfLines={1}>{nextAction.hint}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { opacity: phoneReady ? 1 : 0.46 }]}
          disabled={!phoneReady}
          onPress={() => {
            if (task.klient_telefon) void Linking.openURL(`tel:${task.klient_telefon}`);
          }}
        >
          <Ionicons name="call-outline" size={15} color={theme.accent} />
          <Text style={styles.actionText}>Dzwoń</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { opacity: addressReady ? 1 : 0.46 }]}
          disabled={!addressReady}
          onPress={() => void openAddressInMaps(task.adres || '', task.miasto || '')}
        >
          <Ionicons name="map-outline" size={15} color={theme.accent} />
          <Text style={styles.actionText}>Mapa</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryAction]}
          onPress={() => openFieldTask(task, nextAction)}
        >
          <Ionicons name={nextAction.icon} size={15} color={theme.accentText} />
          <Text style={styles.primaryActionText}>{nextAction.cta}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.headerBg,
    },
    backBtn: { padding: 8 },
    title: { fontSize: 18, fontWeight: '800', color: theme.text, letterSpacing: 0 },
    err: { color: theme.danger, paddingHorizontal: 16, marginTop: 8, fontWeight: '700' },
    list: { padding: 16, paddingBottom: 44, gap: 12 },
    hero: {
      backgroundColor: theme.cardBg,
      borderRadius: 20,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      gap: 14,
    },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    heroIcon: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: theme.accentLight,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.accent + '33',
    },
    heroEyebrow: { color: theme.accent, fontSize: 10.5, fontWeight: '900', textTransform: 'uppercase' },
    heroTitle: { color: theme.text, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 2 },
    heroText: { color: theme.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 4, fontWeight: '600' },
    heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    heroStartBtn: {
      flexGrow: 1.2,
      minHeight: 42,
      borderRadius: 13,
      backgroundColor: theme.success,
      borderWidth: 1,
      borderColor: theme.success,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    heroStartText: { color: theme.accentText, fontSize: 12.5, fontWeight: '900' },
    heroPrimaryBtn: {
      flexGrow: 1,
      minHeight: 42,
      borderRadius: 13,
      backgroundColor: theme.accent,
      borderWidth: 1,
      borderColor: theme.accentDark,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    heroPrimaryText: { color: theme.accentText, fontSize: 12.5, fontWeight: '900' },
    heroSecondaryBtn: {
      minHeight: 42,
      borderRadius: 13,
      backgroundColor: theme.accentLight,
      borderWidth: 1,
      borderColor: theme.accent + '55',
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    heroSecondaryText: { color: theme.accent, fontSize: 12.5, fontWeight: '900' },
    statsGrid: { flexDirection: 'row', gap: 7 },
    statTile: {
      flex: 1,
      minHeight: 66,
      borderRadius: 14,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      paddingHorizontal: 4,
    },
    statValue: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
    statLabel: { color: theme.textMuted, fontSize: 9.5, fontWeight: '900', textAlign: 'center' },
    filterStrip: { gap: 8, paddingRight: 2 },
    filterChip: {
      minHeight: 38,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 7,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    filterChipText: { fontSize: 11.5, fontWeight: '900' },
    filterChipCount: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
    nextFocusCard: {
      borderRadius: 18,
      borderWidth: 1,
      padding: 12,
      gap: 10,
    },
    nextFocusHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    nextFocusIcon: {
      width: 40,
      height: 40,
      borderRadius: 13,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextFocusEyebrow: { color: theme.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
    nextFocusTitle: { color: theme.text, fontSize: 15, fontWeight: '900', marginTop: 1 },
    nextFocusSub: { color: theme.textSub, fontSize: 11.5, marginTop: 2, fontWeight: '700' },
    nextFocusScore: {
      minWidth: 54,
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: theme.cardBg,
      paddingHorizontal: 8,
      paddingVertical: 6,
      alignItems: 'center',
    },
    nextFocusScoreValue: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
    nextFocusScoreLabel: { color: theme.textMuted, fontSize: 8.5, fontWeight: '900', textTransform: 'uppercase' },
    nextFocusScope: { color: theme.textSub, fontSize: 12, lineHeight: 17, fontWeight: '700' },
    nextFocusChecks: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    nextFocusCheck: {
      flexGrow: 1,
      flexBasis: '46%',
      minWidth: 112,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 7,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    nextFocusCheckLabel: { fontSize: 10.5, fontWeight: '900' },
    nextFocusCheckValue: { color: theme.textMuted, fontSize: 10, fontWeight: '800' },
    nextFocusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    nextFocusAction: {
      flexGrow: 1,
      minHeight: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.cardBg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 10,
    },
    nextFocusActionText: { color: theme.accent, fontSize: 12, fontWeight: '900' },
    nextFocusPrimary: {
      flexGrow: 1.3,
      minHeight: 40,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 10,
    },
    nextFocusPrimaryText: { color: theme.accentText, fontSize: 12, fontWeight: '900' },
    routePanel: {
      backgroundColor: theme.cardBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      gap: 9,
    },
    routeHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    routeIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      backgroundColor: theme.accentLight,
      borderWidth: 1,
      borderColor: theme.accent + '44',
      alignItems: 'center',
      justifyContent: 'center',
    },
    routeTitle: { color: theme.text, fontSize: 14, fontWeight: '900' },
    routeSub: { color: theme.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700' },
    routeOpenBtn: {
      minHeight: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.accent + '55',
      backgroundColor: theme.accentLight,
      paddingHorizontal: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    routeOpenText: { color: theme.accent, fontSize: 11, fontWeight: '900' },
    routeSummary: {
      flexDirection: 'row',
      gap: 8,
    },
    routeSummaryItem: {
      flex: 1,
      minHeight: 54,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 13,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
      gap: 2,
    },
    routeSummaryValue: {
      color: theme.accent,
      fontSize: 16,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    routeSummaryLabel: {
      color: theme.textMuted,
      fontSize: 9.5,
      fontWeight: '900',
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    routeRow: {
      minHeight: 48,
      borderWidth: 1,
      borderRadius: 13,
      paddingHorizontal: 9,
      paddingVertical: 7,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    routeIndex: {
      width: 28,
      height: 28,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    routeIndexText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
    routeClient: { color: theme.text, fontSize: 12.5, fontWeight: '900' },
    routeMeta: { color: theme.textMuted, fontSize: 10.5, marginTop: 1 },
    card: {
      backgroundColor: theme.cardBg,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      gap: 12,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
    timeBadge: {
      borderRadius: 11,
      paddingHorizontal: 9,
      paddingVertical: 6,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    timeText: { color: theme.textSub, fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
    statusBadge: { borderRadius: 11, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1 },
    statusText: { fontSize: 10.5, fontWeight: '900' },
    cardTitle: { fontSize: 16, fontWeight: '900', color: theme.text, letterSpacing: 0 },
    cardSub: { marginTop: 4, color: theme.textSub, fontSize: 12.5, fontWeight: '700' },
    scopeText: { marginTop: 8, color: theme.textMuted, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
    evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
    evidencePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 11,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    evidenceText: { fontSize: 11, fontWeight: '900' },
    missingBox: {
      marginTop: 11,
      borderWidth: 1,
      borderColor: theme.warning + '44',
      backgroundColor: theme.warningBg,
      borderRadius: 12,
      padding: 10,
      gap: 3,
    },
    missingLabel: { color: theme.warning, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
    missingText: { color: theme.textSub, fontSize: 12, fontWeight: '700', lineHeight: 17 },
    nextActionBox: {
      marginTop: 11,
      borderWidth: 1,
      borderRadius: 13,
      paddingHorizontal: 10,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    nextActionLabel: { fontSize: 12.5, fontWeight: '900' },
    nextActionHint: { color: theme.textMuted, fontSize: 10.5, lineHeight: 15, fontWeight: '700', marginTop: 1 },
    actionRow: { flexDirection: 'row', gap: 8 },
    actionBtn: {
      flex: 1,
      minHeight: 42,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    actionText: { color: theme.accent, fontSize: 12, fontWeight: '900' },
    primaryAction: { backgroundColor: theme.accent, borderColor: theme.accentDark },
    primaryActionText: { color: theme.accentText, fontSize: 12, fontWeight: '900' },
    emptyBox: {
      alignItems: 'center',
      gap: 8,
      padding: 22,
      backgroundColor: theme.cardBg,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.cardBorder,
    },
    emptyTitle: { color: theme.text, fontSize: 16, fontWeight: '900' },
    emptyText: { color: theme.textMuted, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
    emptyActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
    emptyPrimaryBtn: {
      minHeight: 40,
      borderRadius: 12,
      backgroundColor: theme.accent,
      borderWidth: 1,
      borderColor: theme.accentDark,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    emptyPrimaryText: { color: theme.accentText, fontSize: 12, fontWeight: '900' },
    emptySecondaryBtn: {
      minHeight: 40,
      borderRadius: 12,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptySecondaryText: { color: theme.textSub, fontSize: 12, fontWeight: '900' },
    muted: { marginTop: 4, color: theme.textMuted, fontSize: 13 },
    price: { marginTop: 8, fontWeight: '700', color: theme.accent },
    infoBox: {
      backgroundColor: theme.surface2,
      borderRadius: 14,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.accent,
    },
    infoTitle: { color: theme.text, fontWeight: '800', fontSize: 15 },
    infoText: { color: theme.textMuted, marginTop: 6, lineHeight: 18 },
    infoBtn: {
      marginTop: 12,
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.accent,
    },
    infoBtnTxt: { color: theme.accentText, fontWeight: '700' },
    infoBtnSecondary: { backgroundColor: theme.accentLight, borderWidth: 1, borderColor: theme.accent + '55' },
    infoBtnSecondaryTxt: { color: theme.accent },
    mapBtn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.accentLight },
    mapBtnTxt: { color: theme.accent, fontWeight: '600' },
  });
}
