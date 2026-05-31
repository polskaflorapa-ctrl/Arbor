import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
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
import { subscribeOfflineFlushDone, subscribeTaskSync } from '../utils/offline-queue-sync-events';
import { getStoredSession, type StoredUser } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';
import { openAddressInMaps } from '../utils/maps-link';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { getTaskFieldExecutionSummary } from '../utils/task-field-execution';
import { formatTaskListCacheTime, loadTodayTaskListCache, saveTaskListCache } from '../utils/task-list-cache';
import { getOfflineQueueStatus, type OfflineQueueStatus } from '../utils/offline-queue';
import { TASK_STATUS, TASK_STATUS_FILTERS, isTaskClosed, makeTaskStatusColorMap, normalizeTaskStatus } from '../constants/task-workflow';

const FIELD_PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Wycena', icon: 'camera-outline' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline' },
] as const;
type OrderQuickMode = 'all' | 'myTurn' | 'today' | 'field' | 'officeReady' | 'needsPlan' | 'missingEvidence' | 'needsSignal' | 'active';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type StageOwnerTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

const ORDER_QUICK_MODE_KEYS: OrderQuickMode[] = [
  'all',
  'myTurn',
  'today',
  'field',
  'officeReady',
  'needsPlan',
  'missingEvidence',
  'needsSignal',
  'active',
];

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

function isCrewRoleValue(role: unknown) {
  const value = String(role || '').toLowerCase();
  return value === 'brygadzista' || value.includes('pomocnik');
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

function taskWorkflowMissingLabels(task: any) {
  const labels = Array.isArray(task?.workflow_missing_labels) ? task.workflow_missing_labels : [];
  return labels.map((label: unknown) => String(label || '').trim()).filter(Boolean);
}

function normalizeWorkflowMatch(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä…/g, 'a')
    .replace(/ä‡/g, 'c')
    .replace(/ä™/g, 'e')
    .replace(/å‚/g, 'l')
    .replace(/å„/g, 'n')
    .replace(/ã³/g, 'o')
    .replace(/å›/g, 's')
    .replace(/åº/g, 'z')
    .replace(/å¼/g, 'z')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

function taskWorkflowMissingIncludes(task: any, patterns: string[]) {
  const haystack = normalizeWorkflowMatch(taskWorkflowMissingLabels(task).join(' '));
  return patterns.some((pattern) => haystack.includes(normalizeWorkflowMatch(pattern)));
}

function taskWorkflowReadyForNext(task: any) {
  return typeof task?.workflow_ready_for_next === 'boolean' ? task.workflow_ready_for_next : null;
}

function taskWorkflowNextAction(task: any) {
  const action = String(task?.workflow_next_action || '').trim();
  return action || '';
}

function readinessIconForKey(key: unknown): IoniconName {
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
      const ready = row?.ready === true || row?.ok === true;
      return {
        key: key || label,
        label,
        value: row?.value != null ? String(row.value) : ready ? 'OK' : 'brak',
        ready,
        icon: readinessIconForKey(key || label),
      };
    })
    .filter(Boolean) as { key: string; label: string; value: string; ready: boolean; icon: IoniconName }[];
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

function taskHasRiskBrief(task: any) {
  if (taskWorkflowMissingIncludes(task, ['bhp', 'ryzyk', 'risk'])) return false;
  const raw = String([
    task?.notatki_wewnetrzne,
    task?.notatki,
    task?.opis,
    task?.opis_pracy,
  ].filter(Boolean).join('\n')).toLowerCase();
  return /ryzyk|bhp|zgod|linie|ogrodzenie|dach|elewac|trudny dojazd|ruch pieszy|brak szczegolnych/.test(raw);
}

function taskCrewStartChecks(task: any) {
  const apiChecks = apiReadinessChecks(task, 'crew_execution_checks');
  if (apiChecks.length) return apiChecks;
  const evidenceCount = taskEvidenceReadyCount(task);
  const plannedHours = taskNumber(task?.czas_planowany_godziny);
  const equipmentCount = taskEquipmentReservationCount(task);
  const riskReady = taskHasRiskBrief(task);
  return [
    {
      key: 'address',
      label: 'Adres',
      value: hasTaskAddress(task) ? 'OK' : 'brak',
      ready: hasTaskAddress(task),
      icon: 'location-outline' as IoniconName,
    },
    {
      key: 'scope',
      label: 'Zakres',
      value: taskScopePreview(task) ? 'OK' : 'brak',
      ready: Boolean(taskScopePreview(task)),
      icon: 'list-outline' as IoniconName,
    },
    {
      key: 'photos',
      label: 'Zdjecia wyceny',
      value: `${evidenceCount}/${FIELD_PHOTO_REQUIREMENTS.length}`,
      ready: evidenceCount >= FIELD_PHOTO_REQUIREMENTS.length,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'time',
      label: 'Plan czasu',
      value: plannedHours > 0 ? `${plannedHours}h` : 'brak',
      ready: plannedHours > 0,
      icon: 'time-outline' as IoniconName,
    },
    {
      key: 'equipment',
      label: 'Sprzet',
      value: equipmentCount > 0 ? `${equipmentCount} poz.` : 'brak',
      ready: equipmentCount > 0,
      icon: 'construct-outline' as IoniconName,
    },
    {
      key: 'risk',
      label: 'BHP',
      value: riskReady ? 'OK' : 'brak',
      ready: riskReady,
      icon: 'shield-checkmark-outline' as IoniconName,
    },
  ];
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

function taskEquipmentReservationCount(task: any) {
  const direct = taskNumber(
    task?.equipment_reserved_count ??
    task?.sprzet_reserved_count ??
    task?.rezerwacje_sprzetu_count,
  );
  if (direct > 0) return direct;
  if (Array.isArray(task?.equipment_reservations)) return task.equipment_reservations.length;
  if (Array.isArray(task?.rezerwacje_sprzetu)) return task.rezerwacje_sprzetu.length;
  const ids = task?.sprzet_ids ?? task?.sprzetIds;
  if (Array.isArray(ids)) return ids.filter(Boolean).length;
  if (typeof ids === 'string') return ids.split(',').map((id) => id.trim()).filter(Boolean).length;
  const equipmentFlags = [
    'rebak',
    'pila_wysiegniku',
    'nozyce_dlugie',
    'kosiarka',
    'podkaszarka',
    'lopata',
    'mulczer',
    'arborysta',
  ];
  return equipmentFlags.filter((key) => Boolean(task?.[key])).length;
}

function taskOfficeMoneyAndTime(task: any) {
  const value = taskNumber(
    task?.wartosc_planowana ??
    task?.budzet ??
    task?.wartosc_zaproponowana ??
    task?.wartosc_szacowana,
  );
  const hours = taskNumber(task?.czas_planowany_godziny ?? task?.czas_realizacji_godz);
  return {
    value,
    hours,
    ready: value > 0 && hours > 0,
    label: value > 0 && hours > 0
      ? `${value.toLocaleString('pl-PL')} PLN / ${hours}h`
      : value > 0
        ? `${value.toLocaleString('pl-PL')} PLN / brak h`
        : hours > 0
          ? `brak ceny / ${hours}h`
          : 'brak',
  };
}

function taskOfficePlanChecks(task: any) {
  const apiChecks = apiReadinessChecks(task, 'office_plan_checks');
  if (apiChecks.length) return apiChecks;
  const evidenceCount = taskEvidenceReadyCount(task);
  const equipmentCount = taskEquipmentReservationCount(task);
  const moneyAndTime = taskOfficeMoneyAndTime(task);
  const scopeReady = Boolean(taskScopePreview(task));
  return [
    {
      key: 'photos',
      label: 'Zdjecia',
      value: `${evidenceCount}/${FIELD_PHOTO_REQUIREMENTS.length}`,
      ready: evidenceCount >= FIELD_PHOTO_REQUIREMENTS.length,
      icon: 'images-outline' as IoniconName,
    },
    {
      key: 'scope',
      label: 'Zakres',
      value: scopeReady ? 'OK' : 'brak',
      ready: scopeReady,
      icon: 'list-outline' as IoniconName,
    },
    {
      key: 'money',
      label: 'Cena/czas',
      value: moneyAndTime.label,
      ready: moneyAndTime.ready,
      icon: 'cash-outline' as IoniconName,
    },
    {
      key: 'team',
      label: 'Ekipa',
      value: task?.ekipa_nazwa || (task?.ekipa_id ? `#${task.ekipa_id}` : 'brak'),
      ready: taskHasAssignedCrew(task),
      icon: 'people-outline' as IoniconName,
    },
    {
      key: 'slot',
      label: 'Termin',
      value: taskHasPlannedSlot(task) ? `${formatTaskDay(task?.data_planowana)} ${taskTimeLabel(task)}` : 'brak',
      ready: taskHasPlannedSlot(task),
      icon: 'calendar-number-outline' as IoniconName,
    },
    {
      key: 'equipment',
      label: 'Sprzet',
      value: equipmentCount > 0 ? `${equipmentCount} poz.` : 'brak',
      ready: equipmentCount > 0,
      icon: 'cube-outline' as IoniconName,
    },
  ];
}

function taskReservationRouteParams(task: any) {
  const params: Record<string, string> = {
    prefZlecenie: String(task?.id || ''),
    prefData: taskDateKey(task) || '',
  };
  if (task?.ekipa_id) params.prefEkipa = String(task.ekipa_id);
  const ids = task?.sprzet_ids ?? task?.sprzetIds;
  const firstEquipmentId = Array.isArray(ids)
    ? ids.map((id) => String(id || '').trim()).find(Boolean)
    : typeof ids === 'string'
      ? ids.split(',').map((id) => id.trim()).find(Boolean)
      : '';
  if (firstEquipmentId) params.prefSprzet = firstEquipmentId;
  return params;
}

function taskEvidenceComplete(task: any) {
  if (taskWorkflowMissingIncludes(task, ['zdjec', 'zdję', 'szkic', 'dojazd', 'photo'])) return false;
  return taskEvidenceReadyCount(task) === FIELD_PHOTO_REQUIREMENTS.length;
}

function taskReadyForOffice(task: any) {
  if (isTaskClosed(task?.status)) return false;
  const status = normalizeTaskStatus(task?.status);
  if (status === TASK_STATUS.DO_ZATWIERDZENIA) return true;
  const apiReady = taskWorkflowReadyForNext(task);
  if (status === TASK_STATUS.WYCENA_TERENOWA && apiReady !== null) return apiReady;
  return isFieldDraftTask(task) && taskEvidenceComplete(task);
}

function taskNeedsCrewPlan(task: any) {
  if (isTaskClosed(task?.status)) return false;
  const status = normalizeTaskStatus(task?.status);
  const officeStage = status === TASK_STATUS.DO_ZATWIERDZENIA || status === TASK_STATUS.ZAPLANOWANE || taskReadyForOffice(task);
  if (!officeStage) return false;
  if (typeof task?.office_plan_ready === 'boolean') return !task.office_plan_ready;
  if (taskWorkflowMissingIncludes(task, ['ekipa', 'team', 'termin pracy', 'work_date', 'sprzet', 'equipment', 'czas', 'budzet', 'cena', 'zakres'])) return true;
  return taskOfficePlanChecks(task).some((check) => !check.ready);
}

function taskReadyForCrew(task: any) {
  const status = normalizeTaskStatus(task?.status);
  if (typeof task?.crew_execution_ready === 'boolean') {
    return status === TASK_STATUS.ZAPLANOWANE
      ? task.crew_execution_ready
      : taskReadyForOffice(task) && task.crew_execution_ready;
  }
  const planReady = taskOfficePlanChecks(task).every((check) => check.ready);
  if (status === TASK_STATUS.ZAPLANOWANE) return planReady;
  const apiReady = taskWorkflowReadyForNext(task);
  if (status === TASK_STATUS.DO_ZATWIERDZENIA && apiReady !== null) return apiReady && planReady;
  return taskReadyForOffice(task) && planReady;
}

function userRole(user: any) {
  return String(user?.rola || '').toLowerCase();
}

function taskBranchMatchesUser(task: any, user: any) {
  if (!user?.oddzial_id || !task?.oddzial_id) return true;
  return String(user.oddzial_id) === String(task.oddzial_id);
}

function taskAssignedToUserCrew(task: any, user: any) {
  const userId = String(user?.id || '');
  const userTeamId = String(user?.ekipa_id || '');
  const taskTeamId = String(task?.ekipa_id || '');
  const taskLeaderId = String(task?.brygadzista_id || '');
  return Boolean((userTeamId && taskTeamId === userTeamId) || (userId && taskLeaderId === userId));
}

function taskMatchesCurrentUserTurn(task: any, user: any) {
  if (!user || !task || isTaskClosed(task?.status)) return false;
  const role = userRole(user);
  const status = normalizeTaskStatus(task?.status);
  const userId = String(user?.id || '');
  const blockers = taskWorkflowMissingLabels(task).length > 0;

  if (role.includes('wyceniaj')) {
    return status === TASK_STATUS.WYCENA_TERENOWA && String(task?.wyceniajacy_id || '') === userId;
  }

  if (role.includes('bryg') || role.includes('pomoc')) {
    const scopedCrewListFallback = !user?.ekipa_id && !task?.ekipa_id && !task?.brygadzista_id;
    return (taskAssignedToUserCrew(task, user) || scopedCrewListFallback) &&
      (status === TASK_STATUS.ZAPLANOWANE || status === TASK_STATUS.W_REALIZACJI);
  }

  if (role.includes('specjal') || role.includes('sprzed')) {
    return taskBranchMatchesUser(task, user) &&
      (status === TASK_STATUS.NOWE || status === TASK_STATUS.DO_ZATWIERDZENIA || taskReadyForOffice(task) || taskNeedsFieldSignal(task));
  }

  if (role.includes('kierownik')) {
    return taskBranchMatchesUser(task, user) &&
      (status === TASK_STATUS.NOWE || status === TASK_STATUS.DO_ZATWIERDZENIA ||
        taskReadyForOffice(task) || taskNeedsCrewPlan(task) || taskNeedsFieldSignal(task) || blockers);
  }

  if (role.includes('prezes') || role.includes('dyrektor') || role.includes('admin')) {
    return status === TASK_STATUS.NOWE || status === TASK_STATUS.DO_ZATWIERDZENIA ||
      taskReadyForOffice(task) || taskNeedsCrewPlan(task) || taskNeedsFieldSignal(task) || blockers;
  }

  return !isTaskClosed(status);
}

function taskStageOwnerSummary(task: any) {
  const status = normalizeTaskStatus(task?.status);
  const missing = taskWorkflowMissingLabels(task);

  if (isTaskClosed(status)) {
    return {
      owner: 'Biuro',
      title: 'Zamkniete',
      detail: 'Zlecenie jest rozliczone albo zakonczone.',
      tone: 'success' as StageOwnerTone,
      icon: 'checkmark-done-outline' as IoniconName,
    };
  }

  if (status === TASK_STATUS.WYCENA_TERENOWA || isFieldDraftTask(task)) {
    if (taskReadyForOffice(task)) {
      return {
        owner: 'Biuro',
        title: 'Do zatwierdzenia',
        detail: 'Pakiet z terenu jest gotowy do planowania.',
        tone: 'info' as StageOwnerTone,
        icon: 'file-tray-full-outline' as IoniconName,
      };
    }
    return {
      owner: task?.wyceniajacy_nazwa || 'Specjalista ds. wyceny',
      title: 'Teren',
      detail: missing[0] || 'Zrob zdjecia, szkic, dojazd i opis zakresu.',
      tone: 'warning' as StageOwnerTone,
      icon: 'camera-outline' as IoniconName,
    };
  }

  if (status === TASK_STATUS.NOWE) {
    return {
      owner: 'Specjalista biura',
      title: 'Telefon',
      detail: 'Ustal klienta, adres i termin ogledzin.',
      tone: 'accent' as StageOwnerTone,
      icon: 'call-outline' as IoniconName,
    };
  }

  if (status === TASK_STATUS.DO_ZATWIERDZENIA || taskNeedsCrewPlan(task)) {
    return {
      owner: 'Biuro / kierownik',
      title: 'Plan ekipy',
      detail: 'Dobierz brygade, termin, sprzet i kalendarz.',
      tone: taskNeedsCrewPlan(task) ? 'warning' as StageOwnerTone : 'info' as StageOwnerTone,
      icon: 'calendar-number-outline' as IoniconName,
    };
  }

  if ((status === TASK_STATUS.ZAPLANOWANE || status === TASK_STATUS.W_REALIZACJI) && taskNeedsFieldSignal(task)) {
    const fieldExecution = getTaskFieldExecutionSummary(task);
    const problems = taskOpenProblemCount(task);
    return {
      owner: task?.ekipa_nazwa || 'Brygada',
      title: problems > 0 ? 'Problem w terenie' : fieldExecution.label,
      detail: problems > 0 ? `${problems} otwarte problemy do reakcji.` : fieldExecution.detail,
      tone: problems > 0 || fieldExecution.tone === 'danger' ? 'danger' as StageOwnerTone : 'warning' as StageOwnerTone,
      icon: problems > 0 ? 'warning-outline' as IoniconName : 'radio-outline' as IoniconName,
    };
  }

  if (status === TASK_STATUS.ZAPLANOWANE) {
    return {
      owner: task?.ekipa_nazwa || 'Brygada',
      title: 'Gotowe do pracy',
      detail: 'Ekipa ma instrukcje, zdjecia i slot w planie.',
      tone: 'success' as StageOwnerTone,
      icon: 'people-circle-outline' as IoniconName,
    };
  }

  if (status === TASK_STATUS.W_REALIZACJI) {
    return {
      owner: task?.ekipa_nazwa || 'Ekipa',
      title: 'W terenie',
      detail: 'Realizacja trwa. Pilnuj zdjec i statusu koncowego.',
      tone: 'success' as StageOwnerTone,
      icon: 'construct-outline' as IoniconName,
    };
  }

  return {
    owner: 'Biuro',
    title: 'Do sprawdzenia',
    detail: taskWorkflowNextAction(task) || 'Sprawdz nastepny krok w szczegolach.',
    tone: 'muted' as StageOwnerTone,
    icon: 'git-network-outline' as IoniconName,
  };
}

function taskStageOwnerColor(tone: StageOwnerTone, theme: Theme) {
  if (tone === 'info') return theme.info;
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  if (tone === 'danger') return theme.danger;
  if (tone === 'muted') return theme.textMuted;
  return theme.accent;
}

function fieldExecutionToneColor(tone: string, theme: Theme) {
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  if (tone === 'danger') return theme.danger;
  return theme.textMuted;
}

function normalizeOrderQuickMode(value: unknown): OrderQuickMode | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = String(raw || '').trim();
  return ORDER_QUICK_MODE_KEYS.includes(key as OrderQuickMode) ? key as OrderQuickMode : null;
}

function taskOpenProblemCount(task: any) {
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
  return rows.filter((row: any) => {
    const status = String(row?.status || row?.state || '').toLowerCase();
    return !status || !status.includes('rozw') && !status.includes('closed') && !status.includes('done');
  }).length;
}

function taskNeedsFieldSignal(task: any) {
  if (isTaskClosed(task?.status)) return false;
  const status = normalizeTaskStatus(task?.status);
  const fieldExecution = getTaskFieldExecutionSummary(task);
  const crewStage = status === TASK_STATUS.ZAPLANOWANE || status === TASK_STATUS.W_REALIZACJI;
  const missingCheckin = fieldExecution.key === 'missing';
  const missingPhotos = fieldExecution.relevant &&
    fieldExecution.missingPhotoLabels.length > 0 &&
    (crewStage || isFieldDraftTask(task) || status === TASK_STATUS.DO_ZATWIERDZENIA);
  return missingCheckin || missingPhotos || taskOpenProblemCount(task) > 0;
}

function photoFilterForRequirement(key: string) {
  return key.replace(/^photo_/, '');
}

function taskListAction(task: any) {
  const status = normalizeTaskStatus(task?.status);
  const missingPhoto = FIELD_PHOTO_REQUIREMENTS.find((item) => taskNumber(task?.[item.key]) <= 0);

  if ((status === TASK_STATUS.WYCENA_TERENOWA || isFieldDraftTask(task)) && missingPhoto) {
    return {
      label: `Dodaj ${missingPhoto.label}`,
      detail: 'Najpierw komplet zdjec z terenu.',
      icon: missingPhoto.icon as IoniconName,
      route: `/zlecenie/${task.id}?tab=zdjecia&photoFilter=${photoFilterForRequirement(missingPhoto.key)}`,
    };
  }

  if (status === TASK_STATUS.WYCENA_TERENOWA || isFieldDraftTask(task)) {
    return {
      label: taskReadyForOffice(task) ? 'Przekaz do biura' : 'Uzupelnij pakiet',
      detail: taskReadyForOffice(task) ? 'Pakiet terenowy jest gotowy do decyzji biura.' : 'Domknij zakres, cene, czas i BHP.',
      icon: taskReadyForOffice(task) ? 'send-outline' as IoniconName : 'clipboard-outline' as IoniconName,
      route: `/zlecenie/${task.id}?fieldFocus=${taskReadyForOffice(task) ? 'client' : 'scope'}`,
    };
  }

  if (status === TASK_STATUS.NOWE) {
    return {
      label: 'Ustal ogledziny',
      detail: 'Telefon, adres i termin dla specjalisty ds. wyceny.',
      icon: 'call-outline' as IoniconName,
      route: `/zlecenie/${task.id}`,
    };
  }

  if (taskNeedsCrewPlan(task)) {
    return {
      label: 'Zaplanuj ekipe',
      detail: 'Dobierz brygade, termin, sprzet i czas pracy.',
      icon: 'calendar-number-outline' as IoniconName,
      route: `/zlecenie/${task.id}`,
    };
  }

  if (taskReadyForCrew(task)) {
    return {
      label: 'Brief ekipy',
      detail: 'Sprawdz instrukcje, zdjecia i plan wykonania.',
      icon: 'people-circle-outline' as IoniconName,
      route: `/zlecenie/${task.id}`,
    };
  }

  return {
    label: 'Otworz',
    detail: taskWorkflowNextAction(task) || 'Sprawdz karte zlecenia.',
    icon: 'open-outline' as IoniconName,
    route: `/zlecenie/${task.id}`,
  };
}

function taskOperationPriority(task: any, user: any, todayKey: string) {
  const status = normalizeTaskStatus(task?.status);
  if (taskMatchesCurrentUserTurn(task, user)) return 0;
  if (taskNeedsFieldSignal(task)) return 1;
  if (taskNeedsCrewPlan(task)) return 2;
  if (taskReadyForOffice(task)) return 3;
  if (status === TASK_STATUS.NOWE) return 4;
  if (isFieldDraftTask(task) && taskEvidenceReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length) return 5;
  if (taskDateKey(task) === todayKey) return 5;
  if (status === TASK_STATUS.W_REALIZACJI) return 6;
  if (status === TASK_STATUS.ZAPLANOWANE) return 7;
  return 20;
}

function taskIsOperationallyRelevant(task: any, user: any, todayKey: string) {
  if (isTaskClosed(task?.status)) return false;
  const status = normalizeTaskStatus(task?.status);
  return taskMatchesCurrentUserTurn(task, user) ||
    taskNeedsFieldSignal(task) ||
    taskNeedsCrewPlan(task) ||
    taskReadyForOffice(task) ||
    status === TASK_STATUS.NOWE ||
    (isFieldDraftTask(task) && taskEvidenceReadyCount(task) < FIELD_PHOTO_REQUIREMENTS.length) ||
    taskDateKey(task) === todayKey;
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
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/zlecenia');
  const [user, setUser] = useState<StoredUser | null>(null);
  const [zlecenia, setZlecenia] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filtrStatus, setFiltrStatus] = useState('');
  const [quickMode, setQuickMode] = useState<OrderQuickMode>(() => normalizeOrderQuickMode(params.mode) || 'all');
  const [error, setError] = useState<string | null>(null);
  const [offlineQueueStatus, setOfflineQueueStatus] = useState<OfflineQueueStatus>({
    count: 0,
    retryBlocked: 0,
    lastError: '',
    oldestCreatedAt: '',
  });

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
      const endpoint = isCrewRoleValue(rola)
        ? `${API_URL}/tasks/moje` : `${API_URL}/tasks/wszystkie`;
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = (Array.isArray(d) ? d : []).filter((task) => isAssignedToEstimator(task, parsedUser));
        await saveTaskListCache({ endpoint, user: parsedUser, tasks: list }).catch(() => undefined);
        setZlecenia(list);
        setFiltered(list);
      } else {
        const cached = await loadTodayTaskListCache({ endpoint, user: parsedUser }).catch(() => null);
        if (cached) {
          const list = cached.tasks.filter((task) => isAssignedToEstimator(task, parsedUser));
          setZlecenia(list);
          setFiltered(list);
          setQuickMode('today');
          const saved = formatTaskListCacheTime(cached.savedAt);
          setError(`Brak polaczenia z API. Pokazuje dzisiejsze zlecenia z cache${saved ? ` z ${saved}` : ''}.`);
        } else {
          setError(t('zlecenia.errorServer', { status: res.status, detail: d.error || '—' }));
        }
      }
    } catch (e: any) {
      const { user: cachedUser } = await getStoredSession().catch(() => ({ user: null as StoredUser | null }));
      const rola = cachedUser?.rola;
      const endpoint = isCrewRoleValue(rola)
        ? `${API_URL}/tasks/moje` : `${API_URL}/tasks/wszystkie`;
      const cached = await loadTodayTaskListCache({ endpoint, user: cachedUser }).catch(() => null);
      if (cached) {
        const list = cached.tasks.filter((task) => isAssignedToEstimator(task, cachedUser));
        setZlecenia(list);
        setFiltered(list);
        setQuickMode('today');
        const saved = formatTaskListCacheTime(cached.savedAt);
        setError(`Brak sieci. Pokazuje dzisiejsze zlecenia z cache${saved ? ` z ${saved}` : ''}.`);
      } else {
        setError(t('zlecenia.errorConnection', { detail: e.message || '' }));
      }
    } finally {
      const queueStatus = await getOfflineQueueStatus().catch(() => null);
      if (queueStatus) setOfflineQueueStatus(queueStatus);
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const routeMode = normalizeOrderQuickMode(params.mode);
    if (routeMode && routeMode !== quickMode) setQuickMode(routeMode);
  }, [params.mode, quickMode]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      setOfflineQueueStatus((current) => ({
        ...current,
        count: d.left,
        retryBlocked: d.left > 0 ? current.retryBlocked : 0,
      }));
      if (d.flushed > 0) void loadData();
    });
    return unsubscribe;
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeTaskSync(() => {
      void loadData();
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
    } else if (quickMode === 'needsSignal') {
      wynik = wynik.filter(taskNeedsFieldSignal);
    } else if (quickMode === 'myTurn') {
      wynik = wynik.filter((z) => taskMatchesCurrentUserTurn(z, user));
    } else if (quickMode === 'active') {
      wynik = wynik.filter((z) => !isTaskClosed(z.status));
    }
    if (filtrStatus) wynik = wynik.filter(z => z.status === filtrStatus);
    setFiltered(wynik);
  }, [quickMode, search, filtrStatus, user, zlecenia]);

  const isWyceniajacy = isEstimatorRole(user?.rola);
  const isCrew = isCrewRoleValue(user?.rola);
  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const displayList = useMemo(() => {
    const list = [...filtered];
    if (isCrew) return list.sort(sortCrewTasks);
    return list.sort((a, b) => {
      const byPriority = taskOperationPriority(a, user, todayKey) - taskOperationPriority(b, user, todayKey);
      if (byPriority !== 0) return byPriority;
      const byDate = taskSortValue(a) - taskSortValue(b);
      if (byDate !== 0) return byDate;
      return Number(a?.id || 0) - Number(b?.id || 0);
    });
  }, [filtered, isCrew, todayKey, user]);
  const crewPlan = useMemo(() => {
    const active = zlecenia
      .filter((z) => !isTaskClosed(z.status))
      .sort(sortCrewTasks);
    const today = active.filter((z) => taskDateKey(z) === todayKey);
    const inProgress = active.filter((z) => z.status === TASK_STATUS.W_REALIZACJI);
    const scheduledToday = today.filter((z) => z.status === TASK_STATUS.ZAPLANOWANE);
    const missingEvidenceToday = today.filter((z) => taskEvidenceReadyCount(z) < FIELD_PHOTO_REQUIREMENTS.length);
    const missingAddressToday = today.filter((z) => !hasTaskAddress(z));
    const missingScopeToday = today.filter((z) => !taskScopePreview(z));
    const missingTimeToday = today.filter((z) => taskNumber(z.czas_planowany_godziny) <= 0);
    const fieldSlotToday = today.filter(isFieldDraftTask);
    const todayHours = today.reduce((sum, z) => sum + taskNumber(z.czas_planowany_godziny), 0);
    const next = inProgress[0] || scheduledToday[0] || today[0] || active[0] || null;
    const routePreview = (today.length ? today : active).slice(0, 5);
    const nextPhotoReady = next ? taskEvidenceReadyCount(next) : 0;
    const startChecks = next ? taskCrewStartChecks(next) : [];
    const readyChecks = startChecks.filter((check) => check.ready).length;
    return {
      active,
      today,
      inProgressCount: inProgress.length,
      scheduledTodayCount: scheduledToday.length,
      missingEvidenceTodayCount: missingEvidenceToday.length,
      missingAddressTodayCount: missingAddressToday.length,
      missingScopeTodayCount: missingScopeToday.length,
      missingTimeTodayCount: missingTimeToday.length,
      fieldSlotTodayCount: fieldSlotToday.length,
      todayHours,
      next,
      nextPhotoReady,
      startChecks,
      readyChecks,
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
    const needsSignal = active.filter(taskNeedsFieldSignal);
    const openProblems = active.filter((z) => taskOpenProblemCount(z) > 0);
    return {
      active: active.length,
      today: today.length,
      fieldDrafts: fieldDrafts.length,
      missingEvidence: missingEvidence.length,
      officeReady: officeReady.length,
      needsPlan: needsPlan.length,
      readyForCrew: readyForCrew.length,
      needsSignal: needsSignal.length,
      openProblems: openProblems.length,
    };
  }, [todayKey, zlecenia]);
  const myTurnCount = useMemo(
    () => zlecenia.filter((task) => taskMatchesCurrentUserTurn(task, user)).length,
    [user, zlecenia],
  );
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
    { key: 'myTurn', label: 'Moje teraz', count: myTurnCount, color: myTurnCount ? theme.warning : theme.success, icon: 'radio-button-on-outline' },
    { key: 'all', label: 'Wszystkie', count: zlecenia.length, color: theme.accent, icon: 'albums-outline' },
    { key: 'today', label: 'Dzisiaj', count: orderSummary.today, color: theme.info, icon: 'calendar-outline' },
    { key: 'active', label: 'Aktywne', count: orderSummary.active, color: theme.success, icon: 'pulse-outline' },
    { key: 'field', label: 'Teren', count: orderSummary.fieldDrafts, color: theme.accent, icon: 'leaf-outline' },
    { key: 'officeReady', label: 'Do biura', count: orderSummary.officeReady, color: theme.info, icon: 'file-tray-full-outline' },
    { key: 'needsPlan', label: 'Plan ekipy', count: orderSummary.needsPlan, color: orderSummary.needsPlan ? theme.warning : theme.success, icon: 'calendar-number-outline' },
    { key: 'missingEvidence', label: 'Braki foto', count: orderSummary.missingEvidence, color: orderSummary.missingEvidence ? theme.warning : theme.success, icon: 'camera-outline' },
    { key: 'needsSignal', label: 'Brak sygnalu', count: orderSummary.needsSignal, color: orderSummary.needsSignal ? theme.danger : theme.success, icon: 'radio-outline' },
  ];
  const officeFlow = useMemo(() => {
    const active = zlecenia.filter((z) => !isTaskClosed(z.status));
    const phone = active.filter((z) => taskStatusIs(z, TASK_STATUS.NOWE)).length;
    const field = active.filter((z) => taskStatusIs(z, TASK_STATUS.WYCENA_TERENOWA) || isFieldDraftTask(z)).length;
    const signal = active.filter(taskNeedsFieldSignal).length;
    const office = active.filter(taskReadyForOffice).length;
    const plan = active.filter(taskNeedsCrewPlan).length;
    const crew = active.filter(taskReadyForCrew).length;
    const stages: OfficeFlowStep[] = [
      { key: 'myTurn', label: 'Moje teraz', hint: 'moja kolej', value: myTurnCount, color: myTurnCount ? theme.warning : theme.success, icon: 'radio-button-on-outline', mode: 'myTurn' },
      { key: 'phone', label: 'Telefon', hint: 'nowe', value: phone, color: theme.success, icon: 'call-outline', mode: 'active' },
      { key: 'field', label: 'Teren', hint: 'wycena', value: field, color: theme.info, icon: 'camera-outline', mode: 'field' },
      { key: 'signal', label: 'Sygnal', hint: 'check-in', value: signal, color: signal ? theme.danger : theme.success, icon: 'radio-outline', mode: 'needsSignal' },
      { key: 'office', label: 'Biuro', hint: 'dowody OK', value: office, color: theme.accent, icon: 'file-tray-full-outline', mode: 'officeReady' },
      { key: 'plan', label: 'Plan', hint: 'ekipa/slot', value: plan, color: plan ? theme.warning : theme.success, icon: 'calendar-number-outline', mode: 'needsPlan' },
      { key: 'crew', label: 'Ekipa', hint: 'gotowe', value: crew, color: theme.success, icon: 'people-circle-outline', mode: 'today' },
    ];
    const nextMode: OrderQuickMode = myTurnCount
      ? 'myTurn'
      : orderSummary.needsSignal
      ? 'needsSignal'
      : orderSummary.needsPlan
      ? 'needsPlan'
      : orderSummary.officeReady
        ? 'officeReady'
        : orderSummary.missingEvidence
          ? 'missingEvidence'
          : 'active';
    const nextTitle = myTurnCount
      ? 'Najpierw Twoja kolej'
      : orderSummary.needsSignal
      ? 'Najpierw brak sygnalu z terenu'
      : orderSummary.needsPlan
      ? 'Najpierw dobierz ekipę i godzinę'
      : orderSummary.officeReady
        ? 'Pakiety z terenu czekają w biurze'
        : orderSummary.missingEvidence
          ? 'Uzupełnij brakujące zdjęcia'
          : 'Brak krytycznego zatoru';
    const nextSub = myTurnCount
      ? `${myTurnCount} zlecen czeka na ruch tej roli.`
      : orderSummary.needsSignal
      ? `${orderSummary.needsSignal} zlecen wymaga check-inu, zdjec albo reakcji na problem.`
      : orderSummary.needsPlan
      ? `${orderSummary.needsPlan} zleceń wymaga planu ekipy przed przekazaniem dalej.`
      : orderSummary.officeReady
        ? `${orderSummary.officeReady} pakietów ma komplet dowodów i może być opracowane.`
        : orderSummary.missingEvidence
          ? `${orderSummary.missingEvidence} zleceń z terenu nie ma pełnego pakietu foto.`
          : 'Lista jest uporządkowana. Możesz pracować po aktywnych zleceniach.';
    return { stages, nextMode, nextTitle, nextSub };
  }, [myTurnCount, orderSummary.missingEvidence, orderSummary.needsPlan, orderSummary.needsSignal, orderSummary.officeReady, theme, zlecenia]);
  const operationsQueue = useMemo(() => {
    const relevant = zlecenia
      .filter((task) => taskIsOperationallyRelevant(task, user, todayKey))
      .sort((a, b) => {
        const byPriority = taskOperationPriority(a, user, todayKey) - taskOperationPriority(b, user, todayKey);
        if (byPriority !== 0) return byPriority;
        const byDate = taskSortValue(a) - taskSortValue(b);
        if (byDate !== 0) return byDate;
        return Number(a?.id || 0) - Number(b?.id || 0);
      });
    const rows = relevant.slice(0, 4).map((task) => {
      const stage = taskStageOwnerSummary(task);
      const action = taskListAction(task);
      return {
        task,
        stage,
        action,
        color: taskStageOwnerColor(stage.tone, theme),
        isMine: taskMatchesCurrentUserTurn(task, user),
      };
    });
    return {
      rows,
      hiddenCount: Math.max(0, relevant.length - rows.length),
    };
  }, [theme, todayKey, user, zlecenia]);
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
      <StatusBar barStyle={'light-content'} backgroundColor={theme.headerBg} />

      <ScreenHeader
        title={t('zlecenia.title')}
        right={
          !isCrew ? (
            <PlatinumCTA
              label="+"
              style={S.headerAddBtn}
              onPress={() => {
                void triggerHaptic('light');
                router.push(buildNewOrderRoute({ source: 'zlecenia' }) as never);
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
            { label: 'Brak sygnalu', value: orderSummary.needsSignal, color: orderSummary.needsSignal ? theme.danger : theme.success },
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

      {!isCrew && operationsQueue.rows.length ? (
        <View style={S.operationsQueueCard}>
          <View style={S.operationsQueueHead}>
            <View style={S.operationsQueueIcon}>
              <Ionicons name="radio-outline" size={18} color={theme.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={S.operationsQueueTitle}>Kolejka operacyjna</Text>
              <Text style={S.operationsQueueSub}>
                Najpierw rzeczy, ktore blokuja przejscie od telefonu do ekipy.
              </Text>
            </View>
            {operationsQueue.hiddenCount > 0 ? (
              <View style={S.operationsQueueMore}>
                <Text style={S.operationsQueueMoreText}>+{operationsQueue.hiddenCount}</Text>
              </View>
            ) : null}
          </View>
          <View style={S.operationsQueueRows}>
            {operationsQueue.rows.map((item, index) => (
              <TouchableOpacity
                key={item.task.id}
                style={[
                  S.operationsQueueRow,
                  {
                    borderColor: item.isMine ? theme.warning : item.color + '55',
                    backgroundColor: item.isMine ? theme.warningBg : theme.surface2,
                  },
                ]}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(item.action.route as never);
                }}
              >
                <View style={[S.operationsQueueIndex, { borderColor: item.color, backgroundColor: theme.cardBg }]}>
                  <Text style={[S.operationsQueueIndexText, { color: item.color }]}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={S.operationsQueueRowTop}>
                    <Text style={S.operationsQueueClient} numberOfLines={1}>
                      {item.task.klient_nazwa || `Zlecenie #${item.task.id}`}
                    </Text>
                    {item.isMine ? (
                      <View style={[S.operationsQueueMineBadge, { borderColor: theme.warning, backgroundColor: theme.cardBg }]}>
                        <Text style={[S.operationsQueueMineText, { color: theme.warning }]}>moja kolej</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={S.operationsQueueMeta} numberOfLines={1}>
                    {[item.task.adres, item.task.miasto].filter(Boolean).join(', ') || statusLabel(item.task.status)}
                  </Text>
                  <Text style={S.operationsQueueDetail} numberOfLines={2}>
                    {item.stage.owner}: {item.action.detail}
                  </Text>
                </View>
                <View style={[S.operationsQueueAction, { borderColor: item.color + '55', backgroundColor: theme.cardBg }]}>
                  <Ionicons name={item.action.icon} size={14} color={item.color} />
                  <Text style={[S.operationsQueueActionText, { color: item.color }]} numberOfLines={1}>
                    {item.action.label}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      {offlineQueueStatus.count > 0 ? (
        <View style={[S.offlineQueueBanner, { borderColor: theme.warning, backgroundColor: theme.warningBg }]}>
          <PlatinumIconBadge icon="cloud-upload-outline" color={theme.warning} size={16} style={S.offlineQueueIcon} />
          <View style={{ flex: 1 }}>
            <Text style={[S.offlineQueueTitle, { color: theme.warning }]}>
              Offline: {offlineQueueStatus.count} {offlineQueueStatus.count === 1 ? 'akcja czeka' : 'akcje czekaja'} na wyslanie
            </Text>
            <Text style={S.offlineQueueSub}>
              {offlineQueueStatus.retryBlocked > 0
                ? `${offlineQueueStatus.retryBlocked} pozycje czekaja na kolejne retry.`
                : 'Synchronizacja ruszy automatycznie po odzyskaniu polaczenia.'}
              {offlineQueueStatus.lastError ? ` Ostatni blad: ${offlineQueueStatus.lastError}` : ''}
            </Text>
          </View>
        </View>
      ) : null}

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
                <View style={[S.crewDocPill, { borderColor: theme.accent + '66' }]}>
                  <PlatinumIconBadge
                    icon="shield-checkmark-outline"
                    color={theme.accent}
                    size={9}
                    style={S.crewDocIcon}
                  />
                  <Text style={[S.crewDocText, { color: theme.accent }]}>
                    Start: BHP + foto przed
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
          {crewPlan.next ? (
            <View style={S.crewBriefBox}>
              <View style={S.crewBriefHead}>
                <PlatinumIconBadge icon="shield-checkmark-outline" color={theme.accent} size={10} style={S.crewBriefIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={S.crewBriefTitle}>Odprawa startowa</Text>
                  <Text style={S.crewBriefSub}>
                    {crewPlan.readyChecks}/{crewPlan.startChecks.length} gotowe przed ruszeniem do pracy.
                  </Text>
                </View>
              </View>
              <View style={S.crewBriefChecks}>
                {crewPlan.startChecks.map((check) => (
                  <View
                    key={check.key}
                    style={[
                      S.crewBriefCheck,
                      {
                        borderColor: check.ready ? theme.success + '66' : theme.warning + '66',
                        backgroundColor: check.ready ? theme.successBg : theme.warningBg,
                      },
                    ]}
                  >
                    <PlatinumIconBadge
                      icon={check.ready ? 'checkmark-circle' : check.icon}
                      color={check.ready ? theme.success : theme.warning}
                      size={8}
                      style={S.crewBriefCheckIcon}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[S.crewBriefCheckLabel, { color: check.ready ? theme.success : theme.warning }]} numberOfLines={1}>
                        {check.label}
                      </Text>
                      <Text style={S.crewBriefCheckValue} numberOfLines={1}>{check.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={S.crewBriefWarningRow}>
                {[
                  { key: 'addr', label: 'Adres', value: crewPlan.missingAddressTodayCount },
                  { key: 'scope', label: 'Zakres', value: crewPlan.missingScopeTodayCount },
                  { key: 'time', label: 'Czas', value: crewPlan.missingTimeTodayCount },
                ].map((item) => (
                  <View key={item.key} style={[S.crewBriefWarningChip, { borderColor: item.value ? theme.warning + '66' : theme.success + '55' }]}>
                    <Text style={[S.crewBriefWarningValue, { color: item.value ? theme.warning : theme.success }]}>{item.value}</Text>
                    <Text style={S.crewBriefWarningLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <View style={S.crewBriefActions}>
                <TouchableOpacity
                  disabled={!hasTaskAddress(crewPlan.next)}
                  style={[S.crewBriefAction, { opacity: hasTaskAddress(crewPlan.next) ? 1 : 0.5 }]}
                  onPress={() => void openAddressInMaps(crewPlan.next?.adres || '', crewPlan.next?.miasto || '')}
                >
                  <Ionicons name="map-outline" size={15} color={theme.accent} />
                  <Text style={S.crewBriefActionText}>Mapa</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={S.crewBriefAction}
                  onPress={() => {
                    void triggerHaptic('light');
                    router.push(`/zlecenie/${crewPlan.next.id}?tab=zdjecia` as never);
                  }}
                >
                  <Ionicons name="camera-outline" size={15} color={theme.accent} />
                  <Text style={S.crewBriefActionText}>Zdjecia</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={S.crewBriefAction}
                  onPress={() => {
                    void triggerHaptic('light');
                    router.push('/raport-dzienny' as never);
                  }}
                >
                  <Ionicons name="document-text-outline" size={15} color={theme.accent} />
                  <Text style={S.crewBriefActionText}>Raport</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
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
          const workflowNextAction = taskWorkflowNextAction(z);
          const evidenceHint = photoReady
            ? (workflowNextAction || 'Komplet: wycena, szkic i dojazd')
            : (workflowNextAction || `Brakuje: ${missingEvidenceItems.map((item) => item.label).join(', ')}`);
          const handoffReady = taskReadyForCrew(z);
          const isNextCrewTask = isCrew && crewPlan.next?.id === z.id;
          const isTodayTask = taskDateKey(z) === todayKey;
          const scopePreview = taskScopePreview(z);
          const stageOwner = taskStageOwnerSummary(z);
          const stageOwnerColor = taskStageOwnerColor(stageOwner.tone, theme);
          const fieldExecution = getTaskFieldExecutionSummary(z);
          const openProblemCount = taskOpenProblemCount(z);
          const fieldSignalNeedsAttention = taskNeedsFieldSignal(z);
          const fieldExecutionColor = openProblemCount > 0
            ? theme.danger
            : fieldExecutionToneColor(fieldExecution.tone, theme);
          const fieldSignalVisible = fieldExecution.relevant || openProblemCount > 0;
          const isMyTurnTask = taskMatchesCurrentUserTurn(z, user);
          const officePlanChecks = taskOfficePlanChecks(z);
          const officePlanReadyCount = officePlanChecks.filter((check) => check.ready).length;
          const officePlanComplete = officePlanReadyCount === officePlanChecks.length;
          const crewStartChecks = isCrew ? taskCrewStartChecks(z) : [];
          const crewStartReadyCount = crewStartChecks.filter((check) => check.ready).length;
          const crewStartComplete = crewStartChecks.length > 0 && crewStartReadyCount === crewStartChecks.length;
          const crewStartMissing = crewStartChecks.filter((check) => !check.ready).map((check) => check.label);
          const showOfficePlanMini = !isCrew && !isTaskClosed(z.status) && (
            taskReadyForOffice(z) ||
            taskNeedsCrewPlan(z) ||
            normalizeTaskStatus(z.status) === TASK_STATUS.DO_ZATWIERDZENIA ||
            normalizeTaskStatus(z.status) === TASK_STATUS.ZAPLANOWANE
          );
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
                    {!isCrew && z.wartosc_planowana ? (
                      <Text style={S.wartosc}>{parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN</Text>
                    ) : null}
                  </View>
                  {z.ekipa_nazwa ? (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="people-outline" color={theme.textMuted} size={10} style={S.metaIconBadge} />
                      <Text style={S.metaSmall}> {z.ekipa_nazwa}</Text>
                    </View>
                  ) : null}
                  <View style={[
                    S.stageOwnerMini,
                    {
                      borderColor: isMyTurnTask ? theme.warning : stageOwnerColor + '55',
                      backgroundColor: isMyTurnTask ? theme.warningBg : stageOwnerColor + '10',
                    },
                  ]}>
                    <View style={[S.stageOwnerIcon, { borderColor: stageOwnerColor + '55', backgroundColor: theme.cardBg }]}>
                      <Ionicons name={stageOwner.icon} size={15} color={stageOwnerColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.stageOwnerLabel, { color: isMyTurnTask ? theme.warning : theme.textMuted }]}>
                        {isMyTurnTask ? 'Twoja kolej' : 'Kto ma pilke'}
                      </Text>
                      <Text style={S.stageOwnerTitle} numberOfLines={1}>{stageOwner.owner} - {stageOwner.title}</Text>
                      <Text style={S.stageOwnerDetail} numberOfLines={2}>{stageOwner.detail}</Text>
                    </View>
                  </View>
                  {isCrew && scopePreview ? (
                    <View style={[S.crewScopePreview, { borderColor: theme.border, backgroundColor: theme.surface2 }]}>
                      <PlatinumIconBadge icon="list-outline" color={theme.accent} size={9} style={S.crewScopePreviewIcon} />
                      <Text style={S.crewScopePreviewText} numberOfLines={2}>{scopePreview}</Text>
                    </View>
                  ) : null}
                  {fieldSignalVisible ? (
                    <View style={[S.fieldExecutionMini, { borderColor: fieldExecutionColor + '66', backgroundColor: fieldExecutionColor + '10' }]}>
                      <View style={S.fieldExecutionHead}>
                        <PlatinumIconBadge
                          icon={openProblemCount > 0 ? 'warning-outline' : fieldExecution.key === 'active' ? 'pulse-outline' : fieldExecution.key === 'missing' ? 'alert-circle-outline' : 'navigate-circle-outline'}
                          color={fieldExecutionColor}
                          size={9}
                          style={S.fieldExecutionIcon}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[S.fieldExecutionTitle, { color: fieldExecutionColor }]} numberOfLines={1}>
                            {openProblemCount > 0 ? 'Problem w terenie' : fieldExecution.label}
                          </Text>
                          <Text style={S.fieldExecutionDetail} numberOfLines={1}>
                            {openProblemCount > 0 ? `${openProblemCount} otwarte - reakcja biura lub kierownika` : fieldExecution.detail}
                          </Text>
                        </View>
                        {fieldSignalNeedsAttention ? (
                          <View style={[S.fieldExecutionAlertPill, { borderColor: fieldExecutionColor + '66', backgroundColor: theme.cardBg }]}>
                            <Text style={[S.fieldExecutionAlertText, { color: fieldExecutionColor }]}>reakcja</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={S.fieldExecutionDocs}>
                        {fieldExecution.photoItems.map((item) => {
                          const done = item.count > 0;
                          return (
                            <View
                              key={item.key}
                              style={[
                                S.fieldExecutionDocChip,
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
                        {openProblemCount > 0 ? (
                          <View style={[S.fieldExecutionDocChip, { borderColor: theme.danger + '66', backgroundColor: theme.dangerBg }]}>
                            <Text style={[S.fieldExecutionDocText, { color: theme.danger }]}>
                              Problemy: {openProblemCount}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={S.fieldExecutionActions}>
                        <TouchableOpacity
                          style={[S.fieldExecutionAction, { borderColor: fieldExecutionColor + '66', backgroundColor: theme.cardBg }]}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            router.push(`/zlecenie/${z.id}?tab=${openProblemCount > 0 ? 'problemy' : 'logi'}` as never);
                          }}
                        >
                          <Ionicons name={openProblemCount > 0 ? 'warning-outline' : 'radio-outline'} size={13} color={fieldExecutionColor} />
                          <Text style={[S.fieldExecutionActionText, { color: fieldExecutionColor }]}>
                            {openProblemCount > 0 ? 'Problem' : 'Sygnal'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[S.fieldExecutionAction, { borderColor: theme.accent + '55', backgroundColor: theme.cardBg }]}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            router.push(`/zlecenie/${z.id}?tab=zdjecia` as never);
                          }}
                        >
                          <Ionicons name="images-outline" size={13} color={theme.accent} />
                          <Text style={[S.fieldExecutionActionText, { color: theme.accent }]}>Foto</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                  {isCrew ? (
                    <View style={[
                      S.crewStartMini,
                      {
                        borderColor: crewStartComplete ? theme.success + '66' : theme.warning + '66',
                        backgroundColor: crewStartComplete ? theme.successBg : theme.warningBg,
                      },
                    ]}>
                      <View style={S.crewStartMiniHead}>
                        <View style={[S.crewStartMiniIcon, { borderColor: crewStartComplete ? theme.success : theme.warning, backgroundColor: theme.cardBg }]}>
                          <Ionicons name={crewStartComplete ? 'checkmark-done-outline' : 'shield-outline'} size={15} color={crewStartComplete ? theme.success : theme.warning} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[S.crewStartMiniTitle, { color: crewStartComplete ? theme.success : theme.warning }]}>
                            Start pracy {crewStartReadyCount}/{crewStartChecks.length}
                          </Text>
                          <Text style={S.crewStartMiniSub} numberOfLines={1}>
                            {crewStartComplete ? 'Karta gotowa dla brygady.' : `Brakuje: ${crewStartMissing.slice(0, 3).join(', ')}`}
                          </Text>
                        </View>
                      </View>
                      <View style={S.crewStartMiniGrid}>
                        {crewStartChecks.map((check) => (
                          <View
                            key={check.key}
                            style={[
                              S.crewStartMiniCheck,
                              {
                                borderColor: check.ready ? theme.success + '66' : theme.warning + '66',
                                backgroundColor: check.ready ? theme.cardBg : theme.warningBg,
                              },
                            ]}
                          >
                            <PlatinumIconBadge
                              icon={check.ready ? 'checkmark-circle' : check.icon}
                              color={check.ready ? theme.success : theme.warning}
                              size={8}
                              style={S.crewStartMiniCheckIcon}
                            />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[S.crewStartMiniCheckLabel, { color: check.ready ? theme.success : theme.warning }]} numberOfLines={1}>{check.label}</Text>
                              <Text style={S.crewStartMiniCheckValue} numberOfLines={1}>{check.value}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
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
                  {showOfficePlanMini ? (
                    <View style={[
                      S.officePlanMini,
                      {
                        borderColor: officePlanComplete ? theme.success + '66' : theme.warning + '66',
                        backgroundColor: officePlanComplete ? theme.successBg : theme.warningBg,
                      },
                    ]}>
                      <View style={S.officePlanMiniHead}>
                        <View style={[S.officePlanMiniIcon, { borderColor: officePlanComplete ? theme.success : theme.warning, backgroundColor: theme.cardBg }]}>
                          <Ionicons name={officePlanComplete ? 'checkmark-done-outline' : 'calendar-number-outline'} size={15} color={officePlanComplete ? theme.success : theme.warning} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[S.officePlanMiniTitle, { color: officePlanComplete ? theme.success : theme.warning }]}>
                            Plan biura {officePlanReadyCount}/{officePlanChecks.length}
                          </Text>
                          <Text style={S.officePlanMiniSub} numberOfLines={1}>
                            {officePlanComplete ? 'Gotowe do przekazania ekipie.' : 'Domknij plan zanim ekipa ruszy w teren.'}
                          </Text>
                        </View>
                      </View>
                      <View style={S.officePlanMiniGrid}>
                        {officePlanChecks.map((check) => (
                          <View
                            key={check.key}
                            style={[
                              S.officePlanMiniCheck,
                              {
                                borderColor: check.ready ? theme.success + '66' : theme.warning + '66',
                                backgroundColor: check.ready ? theme.cardBg : theme.warningBg,
                              },
                            ]}
                          >
                            <PlatinumIconBadge
                              icon={check.ready ? 'checkmark-circle' : check.icon}
                              color={check.ready ? theme.success : theme.warning}
                              size={8}
                              style={S.officePlanMiniCheckIcon}
                            />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[S.officePlanMiniCheckLabel, { color: check.ready ? theme.success : theme.warning }]} numberOfLines={1}>{check.label}</Text>
                              <Text style={S.officePlanMiniCheckValue} numberOfLines={1}>{check.value}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                      <View style={S.officePlanMiniActions}>
                        <TouchableOpacity
                          style={[S.officePlanMiniAction, { borderColor: theme.accent + '55', backgroundColor: theme.cardBg }]}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            router.push(`/zlecenie/${z.id}` as never);
                          }}
                        >
                          <Ionicons name="create-outline" size={14} color={theme.accent} />
                          <Text style={[S.officePlanMiniActionText, { color: theme.accent }]}>Plan</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[S.officePlanMiniAction, { borderColor: theme.info + '55', backgroundColor: theme.cardBg }]}
                          onPress={(event) => {
                            event.stopPropagation();
                            void triggerHaptic('light');
                            router.push({
                              pathname: '/rezerwacje-sprzetu',
                              params: taskReservationRouteParams(z),
                            } as never);
                          }}
                        >
                          <Ionicons name="cube-outline" size={14} color={theme.info} />
                          <Text style={[S.officePlanMiniActionText, { color: theme.info }]}>Sprzet</Text>
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
  operationsQueueCard: {
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
  operationsQueueHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  operationsQueueIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operationsQueueTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  operationsQueueSub: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  operationsQueueMore: {
    minWidth: 34,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  operationsQueueMoreText: {
    color: t.accent,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  operationsQueueRows: { gap: 8 },
  operationsQueueRow: {
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  operationsQueueIndex: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operationsQueueIndexText: {
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  operationsQueueRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  operationsQueueClient: { flex: 1, color: t.text, fontSize: 13, fontWeight: '900' },
  operationsQueueMineBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  operationsQueueMineText: { fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase' },
  operationsQueueMeta: { color: t.textMuted, fontSize: 10.5, fontWeight: '800', marginTop: 2 },
  operationsQueueDetail: { color: t.textSub, fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 3 },
  operationsQueueAction: {
    maxWidth: 104,
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  operationsQueueActionText: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: '900',
    textAlign: 'center',
  },
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
  crewBriefBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    padding: 10,
    gap: 9,
  },
  crewBriefHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crewBriefIcon: { width: 24, height: 24, borderRadius: 8 },
  crewBriefTitle: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  crewBriefSub: { color: t.textMuted, fontSize: 10.5, marginTop: 1, fontWeight: '700' },
  crewBriefChecks: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  crewBriefCheck: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 118,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  crewBriefCheckIcon: { width: 16, height: 16, borderRadius: 6 },
  crewBriefCheckLabel: { fontSize: 10.5, fontWeight: '900' },
  crewBriefCheckValue: { color: t.textMuted, fontSize: 10, fontWeight: '800', marginTop: 1 },
  crewBriefWarningRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  crewBriefWarningChip: {
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: t.cardBg,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  crewBriefWarningValue: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewBriefWarningLabel: { color: t.textMuted, fontSize: 10.5, fontWeight: '900' },
  crewBriefActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  crewBriefAction: {
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
  crewBriefActionText: { color: t.accent, fontSize: 12, fontWeight: '900' },
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
  offlineQueueBanner: {
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  offlineQueueIcon: { width: 30, height: 30, borderRadius: 10 },
  offlineQueueTitle: { fontSize: 12.5, fontWeight: '900' },
  offlineQueueSub: { color: t.textSub, fontSize: 10.5, fontWeight: '700', lineHeight: 15, marginTop: 1 },
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
  stageOwnerMini: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stageOwnerIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageOwnerLabel: { fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase' },
  stageOwnerTitle: { color: t.text, fontSize: 12.5, fontWeight: '900', marginTop: 1 },
  stageOwnerDetail: { color: t.textSub, fontSize: 11, lineHeight: 15, marginTop: 1 },
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
  fieldExecutionMini: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
    gap: 8,
  },
  fieldExecutionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldExecutionIcon: { width: 22, height: 22, borderRadius: 8 },
  fieldExecutionTitle: { fontSize: 12, fontWeight: '900' },
  fieldExecutionDetail: { color: t.textSub, fontSize: 10.5, fontWeight: '800', marginTop: 1 },
  fieldExecutionAlertPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  fieldExecutionAlertText: { fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase' },
  fieldExecutionDocs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  fieldExecutionDocChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  fieldExecutionDocText: { fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
  fieldExecutionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  fieldExecutionAction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  fieldExecutionActionText: { fontSize: 10.5, fontWeight: '900' },
  crewStartMini: {
    marginTop: 9,
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
    gap: 8,
  },
  crewStartMiniHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crewStartMiniIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewStartMiniTitle: { fontSize: 12, fontWeight: '900' },
  crewStartMiniSub: { color: t.textSub, fontSize: 10.5, fontWeight: '800', marginTop: 1 },
  crewStartMiniGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  crewStartMiniCheck: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 7,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  crewStartMiniCheckIcon: { width: 15, height: 15, borderRadius: 5 },
  crewStartMiniCheckLabel: { fontSize: 10, fontWeight: '900' },
  crewStartMiniCheckValue: { color: t.textMuted, fontSize: 9.5, fontWeight: '800', marginTop: 1 },
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
  officePlanMini: {
    marginTop: 9,
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
    gap: 8,
  },
  officePlanMiniHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  officePlanMiniIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officePlanMiniTitle: { fontSize: 12, fontWeight: '900' },
  officePlanMiniSub: { color: t.textSub, fontSize: 10.5, fontWeight: '800', marginTop: 1 },
  officePlanMiniGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  officePlanMiniCheck: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 112,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  officePlanMiniCheckIcon: { width: 15, height: 15, borderRadius: 5 },
  officePlanMiniCheckLabel: { fontSize: 10.5, fontWeight: '900' },
  officePlanMiniCheckValue: { color: t.textMuted, fontSize: 10, fontWeight: '800', marginTop: 1 },
  officePlanMiniActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  officePlanMiniAction: {
    flexGrow: 1,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  officePlanMiniActionText: { fontSize: 10.5, fontWeight: '900' },
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
