import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { EmptyState, ErrorBanner } from '../components/ui/app-state';
import { FieldOpsBackdrop, FieldOpsCockpit, FieldOpsHeroImage } from '../components/ui/field-ops-art';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { ScreenHeader } from '../components/ui/screen-header';
import { API_URL } from '../constants/api';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { TASK_STATUS } from '../constants/task-workflow';
import { openAddressInMaps } from '../utils/maps-link';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';

import { AppStatusBar } from '../components/ui/app-status-bar';
type FieldDraft = {
  id: number;
  klient_nazwa?: string;
  klient_telefon?: string;
  adres?: string;
  miasto?: string;
  data_planowana?: string;
  godzina_rozpoczecia?: string;
  status?: string;
  typ_uslugi?: string;
  wartosc_planowana?: number | string | null;
  czas_planowany_godziny?: number | string | null;
  ekipa_id?: number | string | null;
  ekipa_nazwa?: string | null;
  wyceniajacy_nazwa?: string | null;
  oddzial_id?: number | string | null;
  oddzial_nazwa?: string | null;
  photo_total?: number;
  photo_wycena?: number;
  photo_szkic?: number;
  photo_dojazd?: number;
  missing_items?: string[];
  workflow_missing_labels?: string[];
  workflow_ready_for_next?: boolean;
  workflow_next_action?: string;
  workflow_stage_label?: string;
  created_at?: string;
  updated_at?: string;
};

type FilterKey = 'all' | 'field' | 'office' | 'urgent' | 'missing' | 'ready' | 'photos' | 'pricing' | 'planning';

type ReadinessCheck = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  done: boolean;
  hint: string;
};

type TeamLite = {
  id: number | string;
  nazwa: string;
  oddzial_id?: number | string | null;
  oddzial_nazwa?: string | null;
  delegowany?: boolean;
  natywny_oddzial?: boolean;
  zajete_minuty?: number | string | null;
  wolne_minuty?: number | string | null;
};

type OfficePlanForm = {
  data: string;
  godzina: string;
  czas: string;
  ekipaId: string;
  note: string;
};

const PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Oględziny', icon: 'image-outline' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline' },
] as const;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'field', label: 'Teren' },
  { key: 'office', label: 'Do biura' },
  { key: 'urgent', label: 'Pilne' },
  { key: 'missing', label: 'Braki' },
  { key: 'photos', label: 'Foto' },
  { key: 'pricing', label: 'Cena' },
  { key: 'planning', label: 'Plan' },
  { key: 'ready', label: 'Do planu' },
];

const URGENT_AFTER_MINUTES = 120;

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function todayKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputValue(value?: string) {
  if (!value) return todayKey();
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return todayKey();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function timeInputValue(row: FieldDraft) {
  const direct = String(row.godzina_rozpoczecia || '').slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(direct)) return direct;
  const raw = String(row.data_planowana || '');
  if (!raw.includes('T')) return '08:00';
  const fromDate = raw.split('T')[1]?.slice(0, 5) || '';
  return /^\d{2}:\d{2}$/.test(fromDate) ? fromDate : '08:00';
}

function isYmd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHhMm(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function teamsForDraft(row: FieldDraft | null, teams: TeamLite[]) {
  if (!row) return teams;
  const branchId = String(row.oddzial_id || '');
  const scoped = teams.filter((team) => (
    !branchId ||
    !team.oddzial_id ||
    String(team.oddzial_id) === branchId ||
    team.delegowany ||
    team.natywny_oddzial
  ));
  return scoped.sort((a, b) => {
    const aNative = branchId && String(a.oddzial_id || '') === branchId ? 1 : 0;
    const bNative = branchId && String(b.oddzial_id || '') === branchId ? 1 : 0;
    if (aNative !== bNative) return bNative - aNative;
    return String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl');
  });
}

function createPlanForm(row: FieldDraft, teams: TeamLite[]): OfficePlanForm {
  const availableTeams = teamsForDraft(row, teams);
  const currentTeam = row.ekipa_id ? String(row.ekipa_id) : '';
  const fallbackTeam = currentTeam || (availableTeams[0]?.id != null ? String(availableTeams[0].id) : '');
  return {
    data: dateInputValue(row.data_planowana),
    godzina: timeInputValue(row),
    czas: row.czas_planowany_godziny != null && String(row.czas_planowany_godziny).trim()
      ? String(row.czas_planowany_godziny)
      : '2',
    ekipaId: fallbackTeam,
    note: '',
  };
}

function formatDate(value?: string) {
  if (!value) return 'bez terminu';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.split('T')[0] || value;
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function missingList(row: FieldDraft) {
  const workflow = Array.isArray(row.workflow_missing_labels) ? row.workflow_missing_labels.filter(Boolean) : [];
  if (workflow.length) return workflow;
  return Array.isArray(row.missing_items) ? row.missing_items.filter(Boolean) : [];
}

function draftAgeMinutes(row: FieldDraft) {
  const raw = row.created_at || row.updated_at || row.data_planowana;
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function draftAgeLabel(row: FieldDraft) {
  const minutes = draftAgeMinutes(row);
  if (minutes < 1) return 'teraz';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.floor(hours / 24)} dni`;
}

function completionScore(row: FieldDraft) {
  const checks = [
    asNumber(row.photo_wycena) > 0,
    asNumber(row.photo_szkic) > 0,
    asNumber(row.photo_dojazd) > 0,
    hasPrice(row),
    hasPlannedTime(row),
    hasTeam(row),
  ];
  return checks.filter(Boolean).length / checks.length;
}

function formatMoney(value: unknown) {
  const amount = asNumber(value);
  return amount > 0 ? `${amount.toLocaleString('pl-PL')} PLN` : 'bez ceny';
}

function photoPackageReady(row: FieldDraft) {
  return PHOTO_REQUIREMENTS.every((req) => asNumber(row[req.key]) > 0);
}

function hasPrice(row: FieldDraft) {
  return asNumber(row.wartosc_planowana) > 0;
}

function hasPlannedTime(row: FieldDraft) {
  return asNumber(row.czas_planowany_godziny) > 0;
}

function hasTeam(row: FieldDraft) {
  return !!row.ekipa_id || !!row.ekipa_nazwa;
}

function hasCrewPlan(row: FieldDraft) {
  return hasTeam(row) && hasPlannedTime(row);
}

function isFieldStage(row: FieldDraft) {
  return String(row.status || '') === TASK_STATUS.WYCENA_TERENOWA;
}

function isOfficeStage(row: FieldDraft) {
  return String(row.status || '') === TASK_STATUS.DO_ZATWIERDZENIA;
}

function isReadyToPlan(row: FieldDraft) {
  return isOfficeStage(row) && missingList(row).length === 0;
}

function isLegacyReady(row: FieldDraft) {
  return !isOfficeStage(row) && missingList(row).length === 0;
}

function stageMeta(row: FieldDraft, theme: Theme) {
  if (isReadyToPlan(row)) {
    return {
      label: 'Do planu',
      hint: 'klient zaakceptowal, biuro dopina termin',
      icon: 'calendar-number-outline' as const,
      color: theme.success,
    };
  }
  if (isOfficeStage(row)) {
    return {
      label: 'Biuro sprawdza',
      hint: 'zaakceptowane, ale paczka ma braki',
      icon: 'file-tray-full-outline' as const,
      color: theme.accent,
    };
  }
  if (isLegacyReady(row)) {
    return {
      label: 'Gotowe z terenu',
      hint: 'uzupelnij status do biura',
      icon: 'checkmark-done-outline' as const,
      color: theme.info,
    };
  }
  return {
    label: 'Teren / braki',
    hint: 'specjalista oględzin domyka zdjecia i zakres',
    icon: 'alert-circle-outline' as const,
    color: theme.warning,
  };
}

function readinessChecks(row: FieldDraft): ReadinessCheck[] {
  const photosReady = PHOTO_REQUIREMENTS.filter((req) => asNumber(row[req.key]) > 0).length;
  const price = asNumber(row.wartosc_planowana);
  const hours = asNumber(row.czas_planowany_godziny);
  const teamReady = hasTeam(row);

  return [
    {
      key: 'photos',
      label: 'Zdjęcia',
      icon: 'images-outline',
      done: photosReady === PHOTO_REQUIREMENTS.length,
      hint: `${photosReady}/${PHOTO_REQUIREMENTS.length}`,
    },
    {
      key: 'price',
      label: 'Cena',
      icon: 'cash-outline',
      done: hasPrice(row),
      hint: price > 0 ? `${price.toLocaleString('pl-PL')} PLN` : 'brak',
    },
    {
      key: 'time',
      label: 'Czas',
      icon: 'time-outline',
      done: hasPlannedTime(row),
      hint: hours > 0 ? `${hours} h` : 'brak',
    },
    {
      key: 'team',
      label: 'Ekipa',
      icon: 'people-outline',
      done: teamReady,
      hint: row.ekipa_nazwa || 'brak',
    },
  ];
}

function primaryMissing(row: FieldDraft) {
  if (row.workflow_ready_for_next && row.workflow_next_action) return row.workflow_next_action;
  const missing = missingList(row);
  if (!missing.length) return row.workflow_next_action || 'Przekazac do planowania';
  return missing[0];
}

function isUrgent(row: FieldDraft) {
  if (missingList(row).length === 0) return false;
  if (draftAgeMinutes(row) >= URGENT_AFTER_MINUTES) return true;
  return completionScore(row) < 0.5;
}

function sortOfficeDrafts(a: FieldDraft, b: FieldDraft) {
  const aReadyToPlan = isReadyToPlan(a) ? 1 : 0;
  const bReadyToPlan = isReadyToPlan(b) ? 1 : 0;
  if (aReadyToPlan !== bReadyToPlan) return bReadyToPlan - aReadyToPlan;
  const aOffice = isOfficeStage(a) ? 1 : 0;
  const bOffice = isOfficeStage(b) ? 1 : 0;
  if (aOffice !== bOffice) return bOffice - aOffice;
  const aUrgent = isUrgent(a) ? 1 : 0;
  const bUrgent = isUrgent(b) ? 1 : 0;
  if (aUrgent !== bUrgent) return bUrgent - aUrgent;
  const aReady = missingList(a).length === 0 ? 1 : 0;
  const bReady = missingList(b).length === 0 ? 1 : 0;
  if (aReady !== bReady) return bReady - aReady;
  const ageDiff = draftAgeMinutes(b) - draftAgeMinutes(a);
  if (ageDiff !== 0) return ageDiff;
  return completionScore(a) - completionScore(b);
}

export default function WycenyDoBiuraScreen() {
  const { theme } = useTheme();
  const S = makeStyles(theme);
  const [items, setItems] = useState<FieldDraft[]>([]);
  const [filter, setFilter] = useState<FilterKey>('missing');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [planRow, setPlanRow] = useState<FieldDraft | null>(null);
  const [planForm, setPlanForm] = useState<OfficePlanForm>({ data: todayKey(), godzina: '08:00', czas: '2', ekipaId: '', note: '' });
  const [planBusy, setPlanBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(async (authToken: string) => {
    setTeamsLoading(true);
    try {
      const res = await fetch(`${API_URL}/ekipy?include_delegacje=1`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => []);
      const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setTeams(rows.map((row: any) => ({
        id: row.id,
        nazwa: row.nazwa || `Ekipa #${row.id}`,
        oddzial_id: row.oddzial_id,
        oddzial_nazwa: row.oddzial_nazwa,
        delegowany: Boolean(row.delegowany),
        natywny_oddzial: Boolean(row.natywny_oddzial),
        zajete_minuty: row.zajete_minuty,
        wolne_minuty: row.wolne_minuty,
      })));
    } catch {
      setTeams([]);
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/tasks/field-drafts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItems([]);
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setItems(Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);
      void loadTeams(token);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać kolejki.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadTeams]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void load();
    });
    return unsubscribe;
  }, [load]);

  const stats = useMemo(() => {
    const complete = items.filter((row) => missingList(row).length === 0).length;
    const urgent = items.filter(isUrgent).length;
    const fieldOpen = items.filter(isFieldStage).length;
    const officeIncoming = items.filter(isOfficeStage).length;
    const readyToPlan = items.filter(isReadyToPlan).length;
    const oldestOpen = items
      .filter((row) => missingList(row).length > 0)
      .sort((a, b) => draftAgeMinutes(b) - draftAgeMinutes(a))[0];
    return {
      total: items.length,
      complete,
      urgent,
      fieldOpen,
      officeIncoming,
      readyToPlan,
      missing: Math.max(0, items.length - complete),
      oldestOpen,
    };
  }, [items]);
  const visibleItems = useMemo(() => {
    return items
      .filter((row) => {
        const ready = missingList(row).length === 0;
        if (filter === 'field') return isFieldStage(row);
        if (filter === 'office') return isOfficeStage(row);
        if (filter === 'urgent') return isUrgent(row);
        if (filter === 'missing') return !ready;
        if (filter === 'photos') return !photoPackageReady(row);
        if (filter === 'pricing') return !hasPrice(row);
        if (filter === 'planning') return !hasCrewPlan(row);
        if (filter === 'ready') return isReadyToPlan(row);
        return true;
      })
      .sort(sortOfficeDrafts);
  }, [filter, items]);

  const nextDraft = useMemo(() => [...items].sort(sortOfficeDrafts)[0] || null, [items]);
  const evidenceSummary = useMemo(() => {
    const evidenceReady = items.filter(photoPackageReady).length;
    const photoTotal = items.reduce((sum, row) => sum + asNumber(row.photo_total), 0);
    const missingSketch = items.filter((row) => asNumber(row.photo_szkic) <= 0).length;
    const missingAccess = items.filter((row) => asNumber(row.photo_dojazd) <= 0).length;
    const missingPhotos = items.filter((row) => !photoPackageReady(row)).length;
    const missingPrice = items.filter((row) => !hasPrice(row)).length;
    const missingPlan = items.filter((row) => !hasCrewPlan(row)).length;
    const readyToApprove = items.filter(isReadyToPlan).length;
    return { evidenceReady, photoTotal, missingSketch, missingAccess, missingPhotos, missingPrice, missingPlan, readyToApprove };
  }, [items]);
  const evidenceCards: {
    key: string;
    label: string;
    value: string;
    hint: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    color: string;
  }[] = [
    {
      key: 'photo',
      label: 'Foto komplet',
      value: `${evidenceSummary.evidenceReady}/${stats.total}`,
      hint: 'oględziny + szkic + dojazd',
      icon: 'images-outline',
      color: theme.success,
    },
    {
      key: 'sketch',
      label: 'Braki szkicu',
      value: String(evidenceSummary.missingSketch),
      hint: 'co trzeba przyciac',
      icon: 'create-outline',
      color: evidenceSummary.missingSketch ? theme.warning : theme.success,
    },
    {
      key: 'access',
      label: 'Braki dojazdu',
      value: String(evidenceSummary.missingAccess),
      hint: 'wjazd, brama, miejsce',
      icon: 'navigate-outline',
      color: evidenceSummary.missingAccess ? theme.warning : theme.success,
    },
    {
      key: 'approve',
      label: 'Do zatwierdzenia',
      value: String(evidenceSummary.readyToApprove),
      hint: `${evidenceSummary.photoTotal} zdjec lacznie`,
      icon: 'checkmark-done-outline',
      color: theme.accent,
    },
  ];
  const bottleneckCards: {
    key: FilterKey;
    label: string;
    value: number;
    hint: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    color: string;
  }[] = [
    {
      key: 'photos',
      label: 'Foto pakiet',
      value: evidenceSummary.missingPhotos,
      hint: 'oględziny, szkic, dojazd',
      icon: 'images-outline',
      color: evidenceSummary.missingPhotos ? theme.warning : theme.success,
    },
    {
      key: 'pricing',
      label: 'Cena',
      value: evidenceSummary.missingPrice,
      hint: 'brak kwoty dla klienta',
      icon: 'cash-outline',
      color: evidenceSummary.missingPrice ? theme.warning : theme.success,
    },
    {
      key: 'planning',
      label: 'Plan ekipy',
      value: evidenceSummary.missingPlan,
      hint: 'ekipa i czas pracy',
      icon: 'calendar-number-outline',
      color: evidenceSummary.missingPlan ? theme.warning : theme.success,
    },
    {
      key: 'ready',
      label: 'Do planu',
      value: stats.readyToPlan,
      hint: 'status Do_Zatwierdzenia',
      icon: 'checkmark-done-outline',
      color: stats.readyToPlan ? theme.accent : theme.textMuted,
    },
  ];

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const openOfficePlan = (row: FieldDraft) => {
    setError(null);
    setPlanRow(row);
    setPlanForm(createPlanForm(row, teams));
    void triggerHaptic('light');
  };

  const submitOfficePlan = async () => {
    if (!planRow) return;
    if (!isYmd(planForm.data)) {
      void triggerHaptic('warning');
      setError('Wpisz datę pracy w formacie RRRR-MM-DD.');
      return;
    }
    if (!isHhMm(planForm.godzina)) {
      void triggerHaptic('warning');
      setError('Wpisz godzinę rozpoczęcia w formacie HH:MM.');
      return;
    }
    if (!planForm.ekipaId) {
      void triggerHaptic('warning');
      setError('Wybierz ekipę do realizacji.');
      return;
    }
    if (asNumber(planForm.czas) <= 0) {
      void triggerHaptic('warning');
      setError('Wpisz dodatni czas pracy w godzinach.');
      return;
    }
    setPlanBusy(true);
    setError(null);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/tasks/${planRow.id}/office-plan`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_planowana: planForm.data,
          godzina_rozpoczecia: planForm.godzina,
          czas_planowany_godziny: planForm.czas,
          ekipa_id: planForm.ekipaId,
          sprzet_notatka: planForm.note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        void triggerHaptic('warning');
        setError(data?.error || `Nie zaplanowano zlecenia #${planRow.id}.`);
        return;
      }
      void triggerHaptic('success');
      setPlanRow(null);
      setItems((prev) => prev.filter((item) => item.id !== planRow.id));
      Alert.alert('Zaplanowane', data?.message || `Zlecenie #${planRow.id} przekazane do harmonogramu ekipy.`);
      void load();
    } catch (err) {
      void triggerHaptic('error');
      setError(err instanceof Error ? err.message : `Nie zaplanowano zlecenia #${planRow.id}.`);
    } finally {
      setPlanBusy(false);
    }
  };

  const nextDraftMissing = nextDraft ? missingList(nextDraft) : [];
  const nextDraftReady = !!nextDraft && isReadyToPlan(nextDraft);
  const nextDraftPackageComplete = !!nextDraft && nextDraftMissing.length === 0;
  const nextDraftLegacyReady = !!nextDraft && isLegacyReady(nextDraft);
  const nextDraftUrgent = !!nextDraft && isUrgent(nextDraft);
  const nextDraftScore = nextDraft ? completionScore(nextDraft) : 0;
  const nextDraftAddress = nextDraft ? [nextDraft.adres, nextDraft.miasto].filter(Boolean).join(', ') : '';
  const nextDraftStage = nextDraft ? stageMeta(nextDraft, theme) : null;
  const nextDraftColor = nextDraftReady ? theme.success : nextDraftUrgent ? theme.danger : nextDraftStage?.color || theme.warning;
  const planTeams = useMemo(() => teamsForDraft(planRow, teams), [planRow, teams]);

  if (loading) {
    return (
      <KeyboardSafeScreen style={S.center}>
        <FieldOpsBackdrop />
        <AppStatusBar backgroundColor={theme.bg} />
        <ActivityIndicator color={theme.accent} size="large" />
      </KeyboardSafeScreen>
    );
  }

  return (
    <KeyboardSafeScreen style={S.root}>
      <FieldOpsBackdrop />
      <AppStatusBar backgroundColor={theme.bg} />
      <ScreenHeader title="Do opracowania" edgeSlotWidth={48} />

      <ScrollView
        style={S.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={S.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {error ? <ErrorBanner message={error} /> : null}

        <View style={S.commandPanel}>
          <View style={S.commandTop}>
            <View style={S.commandIcon}>
              <Ionicons name="file-tray-full-outline" size={18} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.commandTitle}>Kolejka oględzin</Text>
              <Text style={S.commandText}>Rozdzielamy paczki z terenu od zestawów gotowych do planowania.</Text>
              <Text style={S.commandMeta}>
                SLA: pilne po 2h lub poniżej 50% danych
                {stats.oldestOpen ? ` · najstarszy czeka ${draftAgeLabel(stats.oldestOpen)}` : ''}
              </Text>
            </View>
            <FieldOpsHeroImage variant="inspection" size={72} />
            <TouchableOpacity style={S.refreshBtn} onPress={onRefresh}>
              <Ionicons name="refresh-outline" size={17} color={theme.accent} />
            </TouchableOpacity>
          </View>
          <FieldOpsCockpit variant="inspection" style={S.commandCockpit} />
        </View>

        <View style={S.kpiRow}>
          <KpiCard label="W kolejce" value={stats.total} color={theme.accent} theme={theme} />
          <KpiCard label="Teren" value={stats.fieldOpen} color={theme.warning} theme={theme} />
          <KpiCard label="Do biura" value={stats.officeIncoming} color={theme.accent} theme={theme} />
          <KpiCard label="Do planu" value={stats.readyToPlan} color={theme.success} theme={theme} />
          <KpiCard label="Braki" value={stats.missing} color={theme.warning} theme={theme} />
          <KpiCard label="Pilne" value={stats.urgent} color={theme.danger} theme={theme} />
        </View>

        <View style={S.officeBoard}>
          <View style={S.officeBoardHead}>
            <View style={S.officeBoardTitleWrap}>
              <View style={S.officeBoardIcon}>
                <Ionicons name="leaf-outline" size={17} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.officeBoardTitle}>Dowody terenowe</Text>
                <Text style={S.officeBoardSub}>Szybka kontrola: klient, zdjecia, szkic, dojazd i ekipa.</Text>
              </View>
            </View>
            <View style={S.officeBoardBadge}>
              <Text style={S.officeBoardBadgeText}>{stats.readyToPlan ? `${stats.readyToPlan} do planu` : `${stats.fieldOpen} z terenu`}</Text>
            </View>
          </View>

          <View style={S.officeBoardGrid}>
            {evidenceCards.map((card) => (
              <View key={card.key} style={S.evidenceCard}>
                <View style={[S.evidenceIcon, { backgroundColor: card.color + '18' }]}>
                  <Ionicons name={card.icon} size={16} color={card.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.evidenceLabel}>{card.label}</Text>
                  <Text style={S.evidenceHint} numberOfLines={1}>{card.hint}</Text>
                </View>
                <Text style={[S.evidenceValue, { color: card.color }]}>{card.value}</Text>
              </View>
            ))}
          </View>

          <View style={S.bottleneckBoard}>
            <View style={S.bottleneckHead}>
              <Ionicons name="options-outline" size={15} color={theme.accent} />
              <Text style={S.bottleneckTitle}>Co blokuje przekazanie dalej</Text>
            </View>
            <View style={S.bottleneckGrid}>
              {bottleneckCards.map((card) => {
                const active = filter === card.key;
                return (
                  <TouchableOpacity
                    key={card.key}
                    style={[
                      S.bottleneckCard,
                      {
                        borderColor: active ? card.color : theme.border,
                        backgroundColor: active ? card.color + '16' : theme.surface2,
                      },
                    ]}
                    onPress={() => {
                      setFilter(card.key);
                      void triggerHaptic('light');
                    }}
                  >
                    <View style={[S.bottleneckIcon, { backgroundColor: card.color + '18' }]}>
                      <Ionicons name={card.icon} size={15} color={card.color} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={S.bottleneckLabel} numberOfLines={1}>{card.label}</Text>
                      <Text style={S.bottleneckHint} numberOfLines={1}>{card.hint}</Text>
                    </View>
                    <Text style={[S.bottleneckValue, { color: card.color }]}>{card.value}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={S.officeFlow}>
            {['Telefon', 'Ogledziny', 'Foto pakiet', 'Plan ekipy'].map((step, index) => (
              <View key={step} style={S.officeFlowStep}>
                <View style={[S.officeFlowDot, index >= 2 && { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                  <Text style={[S.officeFlowNo, index >= 2 && { color: theme.accent }]}>{index + 1}</Text>
                </View>
                <Text style={S.officeFlowText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>

        {nextDraft ? (
          <View style={S.focusCard}>
            <View style={[S.cardAccent, { backgroundColor: nextDraftColor }]} />
            <View style={S.focusHeader}>
              <View style={[S.focusIcon, { backgroundColor: nextDraftColor + '1A' }]}>
                <Ionicons
                  name={nextDraftReady ? 'checkmark-done-outline' : nextDraftUrgent ? 'flame-outline' : nextDraftStage?.icon || 'file-tray-full-outline'}
                  size={18}
                  color={nextDraftColor}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.focusEyebrow}>
                  {nextDraftReady ? 'Do planu' : nextDraftUrgent ? 'Najpierw rozwiazac' : nextDraftStage?.label || 'Nastepna sprawa dla biura'}
                </Text>
                <Text style={S.focusTitle} numberOfLines={1}>
                  #{nextDraft.id} {nextDraft.klient_nazwa || 'Bez klienta'}
                </Text>
                <Text style={S.focusSub} numberOfLines={1}>
                  {nextDraftAddress || 'Brak adresu'} · {nextDraftStage?.label || 'Etap'} · czeka {draftAgeLabel(nextDraft)}
                </Text>
              </View>
              <View style={[S.focusBadge, { backgroundColor: nextDraftColor + '20', borderColor: nextDraftColor + '66' }]}>
                <Text style={[S.focusBadgeText, { color: nextDraftColor }]}>{Math.round(nextDraftScore * 100)}%</Text>
              </View>
            </View>

            <View style={S.progressTrack}>
              <View style={[S.progressFill, { width: `${Math.round(nextDraftScore * 100)}%`, backgroundColor: nextDraftColor }]} />
            </View>

            <View style={S.checklistGrid}>
              {readinessChecks(nextDraft).map((check) => (
                <View
                  key={check.key}
                  style={[
                    S.checkChip,
                    {
                      borderColor: check.done ? theme.success + '77' : theme.warning + '77',
                      backgroundColor: check.done ? theme.successBg : theme.warningBg,
                    },
                  ]}
                >
                  <Ionicons name={check.done ? 'checkmark-circle-outline' : check.icon} size={14} color={check.done ? theme.success : theme.warning} />
                  <Text style={[S.checkLabel, { color: check.done ? theme.success : theme.warning }]}>{check.label}</Text>
                  <Text style={[S.checkHint, { color: theme.textSub }]} numberOfLines={1}>{check.hint}</Text>
                </View>
              ))}
            </View>

            <View style={[S.nextStepBox, { borderColor: nextDraftColor, backgroundColor: nextDraftColor + '14' }]}>
              <Ionicons name={nextDraftReady ? 'calendar-outline' : nextDraftPackageComplete || nextDraftLegacyReady ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={16} color={nextDraftColor} />
              <Text style={[S.nextStepText, { color: nextDraftColor }]}>
                {nextDraftReady ? 'Paczka kompletna: zaplanowac termin i zatwierdzic ekipe.' : nextDraftPackageComplete ? 'Paczka kompletna, ale status jeszcze nie jest Do_Zatwierdzenia.' : `Domknac: ${primaryMissing(nextDraft)}`}
              </Text>
            </View>

            <View style={S.actions}>
              {nextDraft.klient_telefon ? (
                <TouchableOpacity
                  style={S.actionBtn}
                  onPress={() => {
                    void triggerHaptic('light');
                    void Linking.openURL(`tel:${nextDraft.klient_telefon}`);
                  }}
                >
                  <Ionicons name="call-outline" size={15} color={theme.success} />
                  <Text style={[S.actionText, { color: theme.success }]}>Dzwoń</Text>
                </TouchableOpacity>
              ) : null}
              {nextDraftAddress ? (
                <TouchableOpacity
                  style={S.actionBtn}
                  onPress={() => {
                    void triggerHaptic('light');
                    void openAddressInMaps(nextDraft.adres || '', nextDraft.miasto || '');
                  }}
                >
                  <Ionicons name="map-outline" size={15} color={theme.warning} />
                  <Text style={[S.actionText, { color: theme.warning }]}>Mapa</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={S.actionBtn}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(`/zlecenie/${nextDraft.id}?tab=zdjecia` as never);
                }}
              >
                <Ionicons name="camera-outline" size={15} color={theme.info} />
                <Text style={[S.actionText, { color: theme.info }]}>Zdjęcia</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.actionBtn}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(`/zlecenie/${nextDraft.id}` as never);
                }}
              >
                <Ionicons name="open-outline" size={15} color={theme.accent} />
                <Text style={[S.actionText, { color: theme.accent }]}>Otwórz kartę</Text>
              </TouchableOpacity>
              {nextDraftReady ? (
                <TouchableOpacity
                  style={[S.actionBtn, S.actionBtnPrimary]}
                  onPress={() => openOfficePlan(nextDraft)}
                >
                  <Ionicons name="calendar-number-outline" size={15} color={theme.accentText} />
                  <Text style={S.actionPrimaryText}>Zaplanuj ekipę</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={S.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[S.filterBtn, active && { backgroundColor: theme.accentLight, borderColor: theme.accent }]}
                onPress={() => {
                  setFilter(f.key);
                  void triggerHaptic('light');
                }}
              >
                <Text style={[S.filterText, active && { color: theme.accent }]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {items.length === 0 ? (
          <EmptyState
            icon="checkmark-done-circle-outline"
            title="Brak draftów do opracowania"
            subtitle="Gdy specjalista oględzin zapisze draft terenowy, pojawi się tutaj."
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon="filter-outline"
            title="Nic w tym filtrze"
            subtitle="Zmień filtr albo odśwież kolejkę."
          />
        ) : (
          visibleItems.map((item, index) => {
            const missing = missingList(item);
            const packageComplete = missing.length === 0;
            const ready = isReadyToPlan(item);
            const urgent = isUrgent(item);
            const score = completionScore(item);
            const address = [item.adres, item.miasto].filter(Boolean).join(', ');
            const stage = stageMeta(item, theme);
            const priorityColor = ready ? theme.success : urgent ? theme.danger : stage.color;
            const priorityLabel = ready ? 'do planu' : urgent ? 'pilne' : stage.label;
            return (
              <PlatinumAppear key={item.id} delayMs={20 * Math.min(index, 8)}>
                <View style={S.card}>
                  <View style={[S.cardAccent, { backgroundColor: priorityColor }]} />
                  <View style={S.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={S.cardTitle} numberOfLines={1}>#{item.id} {item.klient_nazwa || 'Bez klienta'}</Text>
                      <Text style={S.cardSub} numberOfLines={1}>{address || 'Brak adresu'}</Text>
                    </View>
                    <View style={[S.readyBadge, { backgroundColor: priorityColor + '22' }]}>
                      <Text style={[S.readyBadgeText, { color: priorityColor }]}>
                        {priorityLabel}
                      </Text>
                    </View>
                  </View>

                  <View style={S.progressBlock}>
                    <View style={S.progressTop}>
                      <Text style={S.progressLabel}>Kompletność pakietu</Text>
                      <Text style={[S.progressValue, { color: packageComplete ? theme.success : theme.warning }]}>
                        {Math.round(score * 100)}%
                      </Text>
                    </View>
                    <View style={S.progressTrack}>
                      <View style={[S.progressFill, { width: `${Math.round(score * 100)}%`, backgroundColor: packageComplete ? theme.success : theme.warning }]} />
                    </View>
                  </View>

                  <View style={S.metaGrid}>
                    <MetaPill icon={stage.icon} text={stage.label} theme={theme} />
                    <MetaPill icon="calendar-outline" text={formatDate(item.data_planowana)} theme={theme} />
                    <MetaPill icon="cash-outline" text={formatMoney(item.wartosc_planowana)} theme={theme} />
                    <MetaPill icon="time-outline" text={item.czas_planowany_godziny ? `${item.czas_planowany_godziny} h` : 'bez czasu'} theme={theme} />
                    <MetaPill icon="people-outline" text={item.ekipa_nazwa || 'bez ekipy'} theme={theme} />
                    <MetaPill icon="timer-outline" text={`czeka ${draftAgeLabel(item)}`} theme={theme} />
                  </View>

                  <View style={S.photoRow}>
                    {PHOTO_REQUIREMENTS.map((req) => {
                      const value = asNumber(item[req.key]);
                      const ok = value > 0;
                      return (
                        <View key={req.key} style={[S.photoPill, { borderColor: ok ? theme.success : theme.warning, backgroundColor: ok ? theme.successBg : theme.warningBg }]}>
                          <Ionicons name={req.icon} size={13} color={ok ? theme.success : theme.warning} />
                          <Text style={[S.photoPillText, { color: ok ? theme.success : theme.warning }]}>{req.label}: {value}</Text>
                        </View>
                      );
                    })}
                  </View>

                  <View style={S.checklistGrid}>
                    {readinessChecks(item).map((check) => (
                      <View
                        key={check.key}
                        style={[
                          S.checkChip,
                          {
                            borderColor: check.done ? theme.success + '77' : theme.warning + '77',
                            backgroundColor: check.done ? theme.successBg : theme.warningBg,
                          },
                        ]}
                      >
                        <Ionicons name={check.done ? 'checkmark-circle-outline' : check.icon} size={14} color={check.done ? theme.success : theme.warning} />
                        <Text style={[S.checkLabel, { color: check.done ? theme.success : theme.warning }]}>{check.label}</Text>
                        <Text style={[S.checkHint, { color: theme.textSub }]} numberOfLines={1}>{check.hint}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={[S.nextStepBox, { borderColor: priorityColor, backgroundColor: priorityColor + '18' }]}>
                    <Ionicons name={ready ? 'checkmark-done-outline' : urgent ? 'flame-outline' : packageComplete ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={16} color={priorityColor} />
                    <Text style={[S.nextStepText, { color: priorityColor }]}>
                      {ready ? 'Nastepny krok: zaplanowac ekipe i termin.' : packageComplete ? 'Paczka kompletna, ale status jeszcze nie przeszedl do biura.' : `${urgent ? 'Pilne: ' : 'Nastepny krok: '}${primaryMissing(item)}`}
                    </Text>
                  </View>

                  {missing.length > 0 ? (
                    <View style={S.missingBox}>
                      <Text style={S.missingTitle}>Brakuje:</Text>
                      <View style={S.missingChips}>
                        {missing.map((m) => (
                          <View key={m} style={S.missingChip}>
                            <Text style={S.missingChipText}>{m}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <View style={[S.readyBox, { borderColor: theme.success, backgroundColor: theme.successBg }]}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={theme.success} />
                      <Text style={[S.readyText, { color: theme.success }]}>
                        {ready ? 'Pakiet terenowy jest kompletny do dalszego planowania.' : 'Pakiet jest kompletny, ale czeka jeszcze na status Do_Zatwierdzenia.'}
                      </Text>
                    </View>
                  )}

                  <View style={S.actions}>
                    <TouchableOpacity
                      style={S.actionBtn}
                      onPress={() => {
                        void triggerHaptic('light');
                        router.push(`/zlecenie/${item.id}` as never);
                      }}
                    >
                      <Ionicons name="open-outline" size={15} color={theme.accent} />
                      <Text style={[S.actionText, { color: theme.accent }]}>Otwórz</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={S.actionBtn}
                      onPress={() => {
                        void triggerHaptic('light');
                        router.push(`/zlecenie/${item.id}?tab=zdjecia` as never);
                      }}
                    >
                      <Ionicons name="camera-outline" size={15} color={theme.info} />
                      <Text style={[S.actionText, { color: theme.info }]}>Zdjęcia</Text>
                    </TouchableOpacity>
                    {ready ? (
                      <TouchableOpacity
                        style={[S.actionBtn, S.actionBtnPrimary]}
                        onPress={() => openOfficePlan(item)}
                      >
                        <Ionicons name="calendar-number-outline" size={15} color={theme.accentText} />
                        <Text style={S.actionPrimaryText}>Zaplanuj</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.data_planowana ? (
                      <TouchableOpacity
                        style={S.actionBtn}
                        onPress={() => {
                          void triggerHaptic('light');
                          const prefData = item.data_planowana?.split('T')[0] || '';
                          router.push({
                            pathname: '/rezerwacje-sprzetu',
                            params: { prefData, prefZlecenie: String(item.id) },
                          } as never);
                        }}
                      >
                        <Ionicons name="construct-outline" size={15} color={theme.accent} />
                        <Text style={[S.actionText, { color: theme.accent }]}>Sprzęt</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.klient_telefon ? (
                      <TouchableOpacity style={S.actionBtn} onPress={() => Linking.openURL(`tel:${item.klient_telefon}`)}>
                        <Ionicons name="call-outline" size={15} color={theme.success} />
                        <Text style={[S.actionText, { color: theme.success }]}>Dzwoń</Text>
                      </TouchableOpacity>
                    ) : null}
                    {address ? (
                      <TouchableOpacity style={S.actionBtn} onPress={() => void openAddressInMaps(item.adres || '', item.miasto || '')}>
                        <Ionicons name="map-outline" size={15} color={theme.warning} />
                        <Text style={[S.actionText, { color: theme.warning }]}>Mapa</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </PlatinumAppear>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={!!planRow}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!planBusy) setPlanRow(null);
        }}
      >
        <KeyboardAvoidingView
          style={S.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={S.modalSheet}>
            <View style={S.modalHeader}>
              <View style={S.modalIcon}>
                <Ionicons name="calendar-number-outline" size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.modalEyebrow}>Plan biura</Text>
                <Text style={S.modalTitle} numberOfLines={1}>
                  {planRow ? `#${planRow.id} ${planRow.klient_nazwa || 'Bez klienta'}` : 'Zlecenie'}
                </Text>
                <Text style={S.modalSub} numberOfLines={1}>
                  {planRow ? [planRow.adres, planRow.miasto].filter(Boolean).join(', ') || 'Brak adresu' : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={S.modalClose}
                onPress={() => {
                  if (!planBusy) setPlanRow(null);
                }}
              >
                <Ionicons name="close-outline" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={S.modalContent} keyboardShouldPersistTaps="handled">
              <View style={S.planInputGrid}>
                <View style={S.planInputCell}>
                  <Text style={S.inputLabel}>Data pracy</Text>
                  <TextInput
                    value={planForm.data}
                    onChangeText={(value) => setPlanForm((current) => ({ ...current, data: value }))}
                    placeholder="2026-05-21"
                    placeholderTextColor={theme.textMuted}
                    style={S.input}
                  />
                </View>
                <View style={S.planInputCell}>
                  <Text style={S.inputLabel}>Godzina</Text>
                  <TextInput
                    value={planForm.godzina}
                    onChangeText={(value) => setPlanForm((current) => ({ ...current, godzina: value }))}
                    placeholder="08:00"
                    placeholderTextColor={theme.textMuted}
                    style={S.input}
                  />
                </View>
                <View style={S.planInputCell}>
                  <Text style={S.inputLabel}>Czas pracy</Text>
                  <TextInput
                    value={planForm.czas}
                    onChangeText={(value) => setPlanForm((current) => ({ ...current, czas: value.replace(',', '.') }))}
                    placeholder="2"
                    placeholderTextColor={theme.textMuted}
                    keyboardType="decimal-pad"
                    style={S.input}
                  />
                </View>
              </View>

              <View style={S.planSection}>
                <View style={S.planSectionHead}>
                  <Text style={S.inputLabel}>Ekipa</Text>
                  {teamsLoading ? <ActivityIndicator size="small" color={theme.accent} /> : null}
                </View>
                <View style={S.teamGrid}>
                  {planTeams.map((team) => {
                    const active = String(team.id) === String(planForm.ekipaId);
                    const loadText = team.wolne_minuty != null
                      ? `wolne ${team.wolne_minuty} min`
                      : team.zajete_minuty != null
                        ? `zajęte ${team.zajete_minuty} min`
                        : team.oddzial_nazwa || 'ekipa';
                    return (
                      <TouchableOpacity
                        key={String(team.id)}
                        style={[S.teamChip, active && S.teamChipActive]}
                        onPress={() => {
                          setPlanForm((current) => ({ ...current, ekipaId: String(team.id) }));
                          void triggerHaptic('light');
                        }}
                      >
                        <Ionicons
                          name={active ? 'checkmark-circle-outline' : 'people-outline'}
                          size={15}
                          color={active ? theme.accent : theme.textMuted}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[S.teamName, active && { color: theme.accent }]} numberOfLines={1}>
                            {team.nazwa}
                          </Text>
                          <Text style={S.teamMeta} numberOfLines={1}>{loadText}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {!teamsLoading && planTeams.length === 0 ? (
                    <View style={S.emptyTeamBox}>
                      <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
                      <Text style={S.emptyTeamText}>Brak ekip dla tego oddziału. Odśwież ekran albo dodaj delegację.</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={S.planSection}>
                <Text style={S.inputLabel}>Sprzęt / uwagi dla magazynu</Text>
                <TextInput
                  value={planForm.note}
                  onChangeText={(value) => setPlanForm((current) => ({ ...current, note: value }))}
                  placeholder="Np. rębak, zwyżka, ograniczony wjazd, odpady do wywozu..."
                  placeholderTextColor={theme.textMuted}
                  multiline
                  style={[S.input, S.noteInput]}
                />
              </View>
            </ScrollView>

            <View style={S.modalActions}>
              <TouchableOpacity
                style={S.cancelBtn}
                onPress={() => {
                  if (!planBusy) setPlanRow(null);
                }}
                disabled={planBusy}
              >
                <Text style={S.cancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.submitBtn, planBusy && { opacity: 0.7 }]}
                onPress={() => void submitOfficePlan()}
                disabled={planBusy}
              >
                {planBusy ? (
                  <ActivityIndicator size="small" color={theme.accentText} />
                ) : (
                  <Ionicons name="checkmark-done-outline" size={16} color={theme.accentText} />
                )}
                <Text style={S.submitText}>Zapisz plan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardSafeScreen>
  );
}

function KpiCard({ label, value, color, theme }: { label: string; value: number; color: string; theme: Theme }) {
  return (
    <View style={[stylesShared.kpiCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
      <Text style={[stylesShared.kpiValue, { color }]}>{value}</Text>
      <Text style={[stylesShared.kpiLabel, { color: theme.textSub }]}>{label}</Text>
    </View>
  );
}

function MetaPill({ icon, text, theme }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; theme: Theme }) {
  return (
    <View style={[stylesShared.metaPill, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
      <Ionicons name={icon} size={13} color={theme.textMuted} />
      <Text style={[stylesShared.metaText, { color: theme.textSub }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const stylesShared = StyleSheet.create({
  kpiCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 92,
    borderWidth: 1,
    borderRadius: 7,
    padding: 12,
    alignItems: 'center',
  },
  kpiValue: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  kpiLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  metaPill: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: { flex: 1, fontSize: 12, fontWeight: '700' },
});

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 44, gap: 12 },
  commandPanel: {
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(24,224,123,0.20)' : t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(8,18,14,0.94)' : t.cardBg,
    borderRadius: 7,
    padding: 14,
  },
  commandTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  commandIcon: {
    width: 38,
    height: 38,
    borderRadius: 6,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  commandText: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  commandMeta: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 5, fontWeight: '700' },
  commandCockpit: {
    marginTop: 2,
    marginBottom: -2,
  },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(24,224,123,0.20)' : t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(16,28,24,0.92)' : t.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  officeBoard: {
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(24,224,123,0.18)' : t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(8,18,14,0.92)' : t.cardBg,
    borderRadius: 7,
    padding: 13,
    gap: 12,
  },
  officeBoardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  officeBoardTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  officeBoardIcon: {
    width: 36,
    height: 36,
    borderRadius: 7,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeBoardTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  officeBoardSub: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  officeBoardBadge: {
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  officeBoardBadgeText: { color: t.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  officeBoardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceCard: {
    width: '48%',
    minHeight: 76,
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(255,255,255,0.10)' : t.border,
    backgroundColor: t.name === 'dark' ? 'rgba(16,28,24,0.88)' : t.surface2,
    borderRadius: 6,
    padding: 10,
    gap: 7,
  },
  evidenceIcon: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceLabel: { color: t.text, fontSize: 12, fontWeight: '900' },
  evidenceHint: { color: t.textMuted, fontSize: 10, fontWeight: '700', marginTop: 2 },
  evidenceValue: {
    position: 'absolute',
    right: 10,
    top: 10,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  bottleneckBoard: {
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(255,255,255,0.10)' : t.border,
    backgroundColor: t.name === 'dark' ? 'rgba(16,28,24,0.84)' : t.surface2,
    borderRadius: 6,
    padding: 10,
    gap: 9,
  },
  bottleneckHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bottleneckTitle: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  bottleneckGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bottleneckCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottleneckIcon: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottleneckLabel: { color: t.text, fontSize: 11.5, fontWeight: '900' },
  bottleneckHint: { color: t.textMuted, fontSize: 10, lineHeight: 14, marginTop: 1 },
  bottleneckValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeFlow: {
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(255,255,255,0.10)' : t.border,
    backgroundColor: t.name === 'dark' ? 'rgba(16,28,24,0.84)' : t.surface2,
    borderRadius: 6,
    padding: 8,
    flexDirection: 'row',
    gap: 6,
  },
  officeFlowStep: { flex: 1, alignItems: 'center', gap: 5 },
  officeFlowDot: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeFlowNo: { color: t.textMuted, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeFlowText: { color: t.textSub, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  focusCard: {
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(24,224,123,0.18)' : t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(8,18,14,0.92)' : t.cardBg,
    borderRadius: 7,
    padding: 14,
    paddingLeft: 17,
    gap: 11,
    overflow: 'hidden',
  },
  focusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  focusIcon: {
    width: 40,
    height: 40,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusEyebrow: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  focusTitle: { color: t.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  focusSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  focusBadge: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  focusBadgeText: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    borderRadius: 7,
    padding: 5,
  },
  filterBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 6,
    paddingVertical: 9,
    alignItems: 'center',
  },
  filterText: { color: t.textMuted, fontSize: 11, fontWeight: '900' },
  card: {
    borderWidth: 1,
    borderColor: t.name === 'dark' ? 'rgba(24,224,123,0.16)' : t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(8,18,14,0.92)' : t.cardBg,
    borderRadius: 7,
    padding: 14,
    paddingLeft: 17,
    gap: 11,
    overflow: 'hidden',
  },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  cardSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  readyBadge: { borderRadius: 5, paddingHorizontal: 9, paddingVertical: 5 },
  readyBadgeText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  progressBlock: { gap: 6 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { color: t.textSub, fontSize: 11, fontWeight: '800' },
  progressValue: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 7, borderRadius: 5, backgroundColor: t.surface2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 5 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  photoPill: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoPillText: { fontSize: 11, fontWeight: '900' },
  checklistGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  checkChip: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  checkLabel: { fontSize: 11, fontWeight: '900' },
  checkHint: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '800' },
  nextStepBox: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  nextStepText: { flex: 1, fontSize: 12, fontWeight: '900' },
  missingBox: {
    borderWidth: 1,
    borderColor: t.warning + '55',
    backgroundColor: t.warningBg,
    borderRadius: 7,
    padding: 10,
    gap: 7,
  },
  missingTitle: { color: t.warning, fontSize: 12, fontWeight: '900' },
  missingChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  missingChip: {
    backgroundColor: t.cardBg,
    borderColor: t.warning + '55',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  missingChipText: { color: t.warning, fontSize: 11, fontWeight: '800' },
  readyBox: {
    borderWidth: 1,
    borderRadius: 7,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  readyText: { flex: 1, fontSize: 12, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionText: { fontSize: 12, fontWeight: '900' },
  actionBtnPrimary: {
    borderColor: t.accent,
    backgroundColor: t.accent,
  },
  actionPrimaryText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(3, 10, 7, 0.48)',
  },
  modalSheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 14,
    gap: 12,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEyebrow: { color: t.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  modalTitle: { color: t.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  modalSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  modalClose: {
    width: 40,
    height: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: { gap: 12, paddingBottom: 4 },
  planInputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  planInputCell: { flexGrow: 1, flexBasis: '30%', minWidth: 96, gap: 6 },
  inputLabel: { color: t.textSub, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 7,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: t.text,
    fontSize: 13,
    fontWeight: '800',
  },
  planSection: { gap: 8 },
  planSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  teamChip: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 56,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamChipActive: {
    borderColor: t.accent,
    backgroundColor: t.accentLight,
  },
  teamName: { color: t.text, fontSize: 12, fontWeight: '900' },
  teamMeta: { color: t.textMuted, fontSize: 10, marginTop: 2, fontWeight: '700' },
  emptyTeamBox: {
    width: '100%',
    borderWidth: 1,
    borderColor: t.warning + '66',
    backgroundColor: t.warningBg,
    borderRadius: 7,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyTeamText: { flex: 1, color: t.warning, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  noteInput: {
    minHeight: 86,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingTop: 12,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: t.textSub, fontSize: 13, fontWeight: '900' },
  submitBtn: {
    flex: 1.3,
    minHeight: 46,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accent,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  submitText: { color: t.accentText, fontSize: 13, fontWeight: '900' },
});
