import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MapOutlined from '@mui/icons-material/MapOutlined';
import MyLocationOutlined from '@mui/icons-material/MyLocationOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import NavigationOutlined from '@mui/icons-material/NavigationOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import Sidebar from '../components/Sidebar';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const ONLINE_MINUTES = 5;
const STALE_MINUTES = 20;
const CLOSED_STATUSES = new Set(['Zakonczone', 'Anulowane', 'Rozliczone']);
const ACTIVE_PLAN_STATUSES = new Set(['Nowe', 'Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji']);
const DAY_START_MINUTES = 8 * 60;
const STANDARD_DAY_END_MINUTES = 18 * 60;
const DAY_END_MINUTES = 22 * 60;
const STANDARD_WORKDAY_LABEL = '08:00-18:00';
const PLANNING_DAY_LABEL = '08:00-22:00';
const COMMAND_MOBILE_VIEWS = new Set(['map', 'decisions', 'timeline']);

function normalizeCommandView(value) {
  return COMMAND_MOBILE_VIEWS.has(value) ? value : 'map';
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      // Fall back below for browsers that expose Clipboard API but block it.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand?.('copy');
    if (!copied) throw new Error('Fallback copy failed');
  } finally {
    document.body.removeChild(textarea);
  }
}

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function hasCountField(row, fields) {
  return fields.some((field) => row?.[field] !== undefined && row?.[field] !== null && row?.[field] !== '');
}

function countField(row, fields) {
  for (const field of fields) {
    const value = Number(row?.[field]);
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

function ageMinutes(iso) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function formatAge(iso) {
  const age = ageMinutes(iso);
  if (age == null) return 'brak czasu';
  if (age <= 0) return 'teraz';
  if (age === 1) return '1 min temu';
  if (age < 60) return `${age} min temu`;
  const hours = Math.floor(age / 60);
  const minutes = age % 60;
  return minutes ? `${hours} h ${minutes} min temu` : `${hours} h temu`;
}

function formatClock(iso) {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function taskDateOnly(task) {
  const raw = String(task?.data_planowana || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = raw ? new Date(raw) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

function taskTime(task) {
  if (task?.godzina_rozpoczecia) return String(task.godzina_rozpoczecia).slice(0, 5);
  return formatClock(task?.data_planowana);
}

function timeToMinutes(value) {
  const raw = String(value || '').slice(0, 5);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DAY_START_MINUTES;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(value) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(value)));
  const h = String(Math.floor(safe / 60)).padStart(2, '0');
  const m = String(safe % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function planDurationMinutes(plan, task) {
  const hours = Number(plan?.czas_planowany_godziny || task?.czas_planowany_godziny || task?.czas_realizacji_godz || 2);
  return Math.max(15, Math.round((Number.isFinite(hours) && hours > 0 ? hours : 2) * 60));
}

function planRangeMinutes(plan, task) {
  const start = timeToMinutes(plan?.godzina_rozpoczecia || taskTime(task));
  const duration = planDurationMinutes(plan, task);
  return { start, end: start + duration, duration };
}

function rangesOverlap(a, b) {
  return a.start < b.end && a.end > b.start;
}

function roundUpToStep(value, step = 30) {
  return Math.ceil(value / step) * step;
}

function normalizeTasks(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return items.filter((task) => task && typeof task === 'object');
}

function taskHasTeam(task) {
  return Boolean(task?.ekipa_id || task?.ekipa_nazwa);
}

function taskHasDate(task) {
  return Boolean(taskDateOnly(task));
}

function taskHasWorkTime(task) {
  return Boolean(task?.godzina_rozpoczecia || toNumber(task?.czas_planowany_godziny) > 0 || toNumber(task?.czas_realizacji_godz) > 0);
}

function planningMissingLabels(task) {
  const missing = [];
  if (!taskHasTeam(task)) missing.push('ekipa');
  if (!taskHasDate(task)) missing.push('termin');
  if (!taskHasWorkTime(task)) missing.push('czas pracy');
  if (!toNumber(task?.wartosc_planowana) && !toNumber(task?.budzet)) missing.push('budzet');
  if (Array.isArray(task?.office_plan_missing_labels)) {
    for (const label of task.office_plan_missing_labels) {
      const clean = String(label || '').trim();
      if (clean && !missing.includes(clean)) missing.push(clean);
    }
  }
  return missing;
}

function quickPlanMissingLabels(plan) {
  const missing = [];
  if (!plan?.data_planowana) missing.push('data');
  if (!plan?.godzina_rozpoczecia) missing.push('godzina');
  if (!plan?.czas_planowany_godziny) missing.push('czas');
  if (!plan?.ekipa_id) missing.push('ekipa');
  if (!String(plan?.sprzet_notatka || '').trim() && !(plan?.sprzet_ids || []).length) missing.push('sprzet');
  return missing;
}

function taskNeedsPlanning(task) {
  if (!task || CLOSED_STATUSES.has(task.status)) return false;
  if (['Nowe', 'Do_Zatwierdzenia'].includes(task.status)) return true;
  if (task.status === 'Wycena_Terenowa') return !task.workflow_ready_for_next;
  if (task.status === 'Zaplanowane') return planningMissingLabels(task).length > 0;
  return false;
}

function planningPriority(task) {
  if (task.status === 'Do_Zatwierdzenia') return 0;
  if (!taskHasDate(task)) return 1;
  if (!taskHasTeam(task)) return 2;
  if (task.status === 'Wycena_Terenowa') return 3;
  if (task.status === 'Nowe') return 4;
  return 9;
}

function planningStageLabel(task) {
  if (task.status === 'Nowe') return 'Telefon / intake';
  if (task.status === 'Wycena_Terenowa') return 'Ogledziny';
  if (task.status === 'Do_Zatwierdzenia') return 'Biuro planuje';
  if (task.status === 'Zaplanowane') return 'Plan niekompletny';
  return taskStatusLabel(task.status);
}

function teamAvailableBranchId(team) {
  return team?.dostepny_w_oddziale_id || team?.delegowany_do_oddzial_id || team?.oddzial_id || '';
}

function teamLabel(team) {
  const name = team?.nazwa || team?.name || `Ekipa #${team?.id || '-'}`;
  const delegated = team?.delegowany || team?.delegacja_id ||
    (team?.oddzial_id && teamAvailableBranchId(team) && String(team.oddzial_id) !== String(teamAvailableBranchId(team)));
  if (!delegated) return name;
  const from = team?.oddzial_macierzysty_nazwa || team?.oddzial_nazwa || 'macierzysty';
  const to = team?.dostepny_w_oddziale_nazwa || team?.delegowany_do_oddzial_nazwa || 'docelowy';
  return `${name} (${from} -> ${to})`;
}

function taskReservedEquipmentIds(task) {
  if (Array.isArray(task?.sprzet_ids)) return task.sprzet_ids.map(String).filter(Boolean);
  const rows = Array.isArray(task?.rezerwacje_sprzetu)
    ? task.rezerwacje_sprzetu
    : Array.isArray(task?.equipment_reservations)
      ? task.equipment_reservations
      : [];
  return [...new Set(rows.map((row) => row?.sprzet_id).filter(Boolean).map(String))];
}

function equipmentBranchId(item) {
  return String(item?.oddzial_id || item?.branch_id || '').trim();
}

function isEquipmentAssignedToTeam(item, teamId) {
  return Boolean(teamId && item?.ekipa_id && String(item.ekipa_id) === String(teamId));
}

function isEquipmentUnavailable(item) {
  const status = String(item?.status || '').toLowerCase();
  return status.includes('serwis') || status.includes('awari') || status.includes('wycof');
}

function activeReservation(row) {
  const status = String(row?.status || '').toLowerCase();
  return !status.includes('anul') && !status.includes('zwr');
}

function reservationOverlapsDay(row, day) {
  const start = String(row?.data_od || '').slice(0, 10);
  const end = String(row?.data_do || '').slice(0, 10);
  return Boolean(day && start && end && start <= day && end >= day);
}

function equipmentLabel(item, { teamId = '', taskBranchId = '' } = {}) {
  const parts = [
    item?.typ,
    item?.nazwa || `Sprzet #${item?.id || '-'}`,
    item?.ekipa_nazwa ? `(${item.ekipa_nazwa})` : '',
  ].filter(Boolean);
  const meta = [];
  if (isEquipmentAssignedToTeam(item, teamId)) meta.push('sprzet ekipy');
  if (taskBranchId && equipmentBranchId(item) && equipmentBranchId(item) !== String(taskBranchId)) {
    meta.push(item?.oddzial_nazwa || `oddzial #${equipmentBranchId(item)}`);
  }
  return `${parts.join(' - ')}${meta.length ? ` | ${meta.join(', ')}` : ''}`;
}

function quickSlotSuggestions(tasks, task, plan) {
  const teamId = String(plan?.ekipa_id || '');
  const day = String(plan?.data_planowana || '');
  if (!teamId || !day) return [];
  const duration = planDurationMinutes(plan, task);
  const busyRanges = (tasks || [])
    .filter((row) => String(row?.id || '') !== String(task?.id || ''))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDateOnly(row) === day)
    .filter((row) => ACTIVE_PLAN_STATUSES.has(row.status))
    .map((row) => ({
      task: row,
      ...planRangeMinutes({
        godzina_rozpoczecia: row.godzina_rozpoczecia,
        czas_planowany_godziny: row.czas_planowany_godziny || row.czas_realizacji_godz,
      }, row),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const suggestions = [];
  let cursor = DAY_START_MINUTES;
  const addFromGap = (start, end) => {
    let value = roundUpToStep(start, 30);
    while (value + duration <= end && suggestions.length < 6) {
      suggestions.push({
        time: minutesToTime(value),
        end: minutesToTime(value + duration),
        minutes: duration,
      });
      value += 30;
    }
  };

  for (const busy of busyRanges) {
    const start = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES, busy.start));
    const end = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES, busy.end));
    if (start - cursor >= duration) addFromGap(cursor, start);
    cursor = Math.max(cursor, end);
    if (suggestions.length >= 6) break;
  }
  if (DAY_END_MINUTES - cursor >= duration) addFromGap(cursor, DAY_END_MINUTES);
  return suggestions;
}

function timelineBlockStyle(range) {
  const span = DAY_END_MINUTES - DAY_START_MINUTES;
  const start = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES, range.start));
  const end = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES, range.end));
  const width = Math.max(1.5, ((end - start) / span) * 100);
  const left = ((start - DAY_START_MINUTES) / span) * 100;
  return { left: `${left}%`, width: `${width}%` };
}

function quickDayTimeline(tasks, task, plan) {
  const teamId = String(plan?.ekipa_id || '');
  const day = String(plan?.data_planowana || '');
  if (!teamId || !day) {
    return { busy: [], selected: null, hours: [] };
  }
  const busy = (tasks || [])
    .filter((row) => String(row?.id || '') !== String(task?.id || ''))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDateOnly(row) === day)
    .filter((row) => ACTIVE_PLAN_STATUSES.has(row.status))
    .map((row) => ({
      task: row,
      ...planRangeMinutes({
        godzina_rozpoczecia: row.godzina_rozpoczecia,
        czas_planowany_godziny: row.czas_planowany_godziny || row.czas_realizacji_godz,
      }, row),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const selected = plan?.godzina_rozpoczecia
    ? {
      ...planRangeMinutes(plan, task),
      task,
    }
    : null;
  const hours = [];
  for (let value = DAY_START_MINUTES; value <= DAY_END_MINUTES; value += 60) {
    hours.push(minutesToTime(value));
  }
  return { busy, selected, hours };
}

function quickTeamConflicts(tasks, task, plan) {
  const teamId = String(plan?.ekipa_id || '');
  const day = String(plan?.data_planowana || '');
  if (!teamId || !day) return { conflicts: [], outsideWorkday: false };
  const range = planRangeMinutes(plan, task);
  const outsideWorkday = range.start < DAY_START_MINUTES || range.end > STANDARD_DAY_END_MINUTES;
  const conflicts = (tasks || [])
    .filter((row) => String(row?.id || '') !== String(task?.id || ''))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDateOnly(row) === day)
    .filter((row) => ACTIVE_PLAN_STATUSES.has(row.status))
    .filter((row) => rangesOverlap(range, planRangeMinutes({
      godzina_rozpoczecia: row.godzina_rozpoczecia,
      czas_planowany_godziny: row.czas_planowany_godziny || row.czas_realizacji_godz,
    }, row)))
    .slice(0, 5);
  return { conflicts, outsideWorkday };
}

function quickEquipmentConflicts(reservations, task, plan) {
  const day = String(plan?.data_planowana || '');
  const teamId = String(plan?.ekipa_id || '');
  const selected = new Set((plan?.sprzet_ids || []).map(String));
  if (!day || !selected.size) return [];
  return (reservations || [])
    .filter(activeReservation)
    .filter((row) => selected.has(String(row?.sprzet_id || '')))
    .filter((row) => String(row?.task_id || '') !== String(task?.id || ''))
    .filter((row) => String(row?.ekipa_id || '') !== teamId)
    .filter((row) => reservationOverlapsDay(row, day))
    .slice(0, 8);
}

function teamEquipmentIdsForPlan(equipmentItems, teamId) {
  if (!teamId) return [];
  return [...new Set((equipmentItems || [])
    .filter((item) => isEquipmentAssignedToTeam(item, teamId))
    .filter((item) => !isEquipmentUnavailable(item))
    .map((item) => String(item.id))
    .filter(Boolean))];
}

function buildPlanDefaults(task) {
  return {
    data_planowana: taskDateOnly(task) || todayIso(),
    godzina_rozpoczecia: task?.godzina_rozpoczecia ? String(task.godzina_rozpoczecia).slice(0, 5) : '08:00',
    czas_planowany_godziny: String(task?.czas_planowany_godziny || task?.czas_realizacji_godz || '2'),
    ekipa_id: task?.ekipa_id ? String(task.ekipa_id) : '',
    sprzet_notatka: task?.sprzet_notatka || task?.equipment_reserved_names || '',
    sprzet_ids: taskReservedEquipmentIds(task),
  };
}

function getFreshness(row) {
  const age = ageMinutes(row.recorded_at);
  if (age == null) return { key: 'unknown', label: 'Brak czasu', color: '#94A3B8' };
  if (age <= ONLINE_MINUTES) return { key: 'online', label: 'Online', color: '#14834F' };
  if (age <= STALE_MINUTES) return { key: 'stale', label: 'Opóźniony', color: '#B7791F' };
  return { key: 'offline', label: 'Offline', color: '#BE123C' };
}

function sourceLabel(row) {
  if (row.provider === 'mobile') return 'Telefon';
  if (row.provider === 'juwentus') return 'GPS auta';
  return row.provider || 'GPS';
}

function gpsSenderLabel(row) {
  if (!row) return 'brak';
  if (row.provider === 'mobile') {
    return row.user_name || row.wyceniajacy_nazwa || `Uzytkownik #${row.user_id || '-'}`;
  }
  const plate = row.nr_rejestracyjny ? `Auto ${row.nr_rejestracyjny}` : 'Auto';
  return row.user_name ? `${plate} / ${row.user_name}` : plate;
}

function gpsAccuracyLabel(row) {
  const accuracy = toNumber(row?.accuracy_m);
  if (accuracy == null) return 'brak';
  return `~${Math.round(accuracy)} m`;
}

function gpsBatteryLabel(row) {
  const battery = toNumber(row?.battery_pct);
  if (battery == null) return 'brak';
  return `${Math.round(battery)}%`;
}

function gpsPlatformLabel(row) {
  const platform = String(row?.platform || '').trim();
  const activity = String(row?.activity || '').trim();
  return [platform, activity].filter(Boolean).join(' / ') || 'brak';
}

function subjectLabel(row) {
  if (row.provider === 'mobile') {
    if (String(row.user_rola || '').toLowerCase().startsWith('wyceniaj')) {
      return row.user_name || row.wyceniajacy_nazwa || `Wyceniajacy #${row.user_id}`;
    }
    return row.user_name || row.ekipa_nazwa || `Uzytkownik #${row.user_id}`;
  }
  return row.ekipa_nazwa || row.nr_rejestracyjny || 'Pojazd';
}

function roleLabel(row) {
  if (row.provider === 'mobile') {
    return [row.user_rola || 'Pracownik terenowy', row.ekipa_nazwa].filter(Boolean).join(' / ');
  }
  if (row.wyceniajacy_nazwa) return 'Pojazd + wyceniajacy';
  return 'Pojazd / ekipa';
}

function mapHref(row) {
  if (!row) return '';
  const lat = toNumber(row.lat ?? row.pin_lat);
  const lng = toNumber(row.lng ?? row.pin_lng);
  return lat != null && lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
    : '';
}

function useNarrowViewport(maxWidth = 760) {
  const getMatch = useCallback(() => (
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  ), [maxWidth]);
  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setMatches(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [maxWidth]);

  return matches;
}

function taskAddress(task) {
  return [task?.adres, task?.miasto].filter(Boolean).join(', ') || 'Brak adresu';
}

function taskClient(task) {
  return task?.klient_nazwa || task?.klient || `Zlecenie #${task?.id || '-'}`;
}

function taskStatusLabel(status) {
  return String(status || 'Brak statusu').replace(/_/g, ' ');
}

function taskStatusColor(status) {
  if (status === 'W_Realizacji') return '#14834F';
  if (status === 'Zaplanowane') return '#0E7490';
  if (status === 'Do_Zatwierdzenia') return '#B7791F';
  if (status === 'Wycena_Terenowa') return '#3F7D20';
  if (CLOSED_STATUSES.has(status)) return '#94A3B8';
  return '#64748B';
}

function taskPhotoSummary(task) {
  const wycena = countField(task, ['photo_wycena', 'photos_wycena', 'wycena_photo_count']);
  const szkic = countField(task, ['photo_szkic', 'photos_szkic', 'sketch_photo_count']);
  const dojazd = countField(task, ['photo_dojazd', 'photos_dojazd', 'drive_photo_count']);
  const rawTotal = countField(task, ['photo_total', 'photos_total', 'photos_count', 'zdjecia_count']);
  const total = Math.max(rawTotal, wycena + szkic + dojazd);
  const missing = [];
  if (wycena <= 0) missing.push('zdjecie wyceny');
  if (szkic <= 0) missing.push('szkic');
  if (dojazd <= 0) missing.push('dojazd');
  return {
    wycena,
    szkic,
    dojazd,
    total,
    missing,
    ready: missing.length === 0,
    label: `${Math.max(0, 3 - missing.length)}/3`,
  };
}

function taskNeedsPhotoEvidence(task) {
  return ['Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji'].includes(task?.status);
}

function taskIssueSummary(task) {
  const totalFields = ['problem_total', 'problemy_total', 'issues_total', 'issues_count', 'problemy_count'];
  const openFields = ['problem_open', 'problemy_open', 'issues_open', 'open_issues_count', 'otwarte_problemy_count'];
  const total = countField(task, totalFields);
  const open = hasCountField(task, openFields) ? countField(task, openFields) : total;
  return { total, open };
}

function taskNeedsArrivalSignal(task) {
  return ['Zaplanowane', 'W_Realizacji'].includes(task?.status) && Boolean(task?.ekipa_id || task?.ekipa_nazwa);
}

function taskHasArrivalSignal(task) {
  const activeCount = countField(task, ['active_work_count', 'active_logs_count']);
  return Boolean(task?.last_checkin_at || task?.active_work_started_at || task?.last_work_finished_at || activeCount > 0);
}

function taskArrivalLabel(task) {
  if (task?.active_work_started_at || countField(task, ['active_work_count', 'active_logs_count']) > 0) {
    return task?.active_work_started_at ? `Praca / ${formatAge(task.active_work_started_at)}` : 'Praca aktywna';
  }
  if (task?.last_checkin_at) return `Check-in / ${formatAge(task.last_checkin_at)}`;
  if (task?.last_work_finished_at) return `Zamkniete / ${formatAge(task.last_work_finished_at)}`;
  return 'Brak check-in';
}

function normalizeRows(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return items
    .map((row) => ({
      ...row,
      lat: toNumber(row.lat),
      lng: toNumber(row.lng),
      speed_kmh: toNumber(row.speed_kmh),
      heading: toNumber(row.heading),
      accuracy_m: toNumber(row.accuracy_m),
      battery_pct: toNumber(row.battery_pct),
    }))
    .filter((row) => row.lat != null && row.lng != null);
}

function historyParamsForRow(row) {
  const params = new URLSearchParams({
    date: todayIso(),
    limit: '360',
  });
  if (row.provider) params.set('provider', row.provider);
  if (row.ekipa_id) params.set('team_id', row.ekipa_id);
  else if (row.user_id) params.set('user_id', row.user_id);
  else if (row.vehicle_id) params.set('vehicle_id', row.vehicle_id);
  else if (row.nr_rejestracyjny) params.set('plate_number', row.nr_rejestracyjny);
  return params;
}

function historyRangeLabel(rows) {
  if (!rows.length) return 'brak danych';
  return `${formatClock(rows[0].recorded_at)} - ${formatClock(rows[rows.length - 1].recorded_at)}`;
}

function historyMaxSpeed(rows) {
  const max = rows.reduce((acc, row) => Math.max(acc, toNumber(row.speed_kmh) || 0), 0);
  return max ? `${Math.round(max)} km/h` : 'brak';
}

function pointPosition(row, bounds) {
  if (!bounds) return { left: '50%', top: '50%' };
  const latRange = Math.max(0.0001, bounds.maxLat - bounds.minLat);
  const lngRange = Math.max(0.0001, bounds.maxLng - bounds.minLng);
  const left = 8 + ((row.lng - bounds.minLng) / lngRange) * 84;
  const top = 92 - ((row.lat - bounds.minLat) / latRange) * 84;
  return {
    left: `${Math.max(6, Math.min(94, left))}%`,
    top: `${Math.max(6, Math.min(94, top))}%`,
  };
}

function percentValue(value) {
  return Number(String(value || '0').replace('%', '')) || 0;
}

function taskMapPoint(task) {
  const lat = toNumber(task?.pin_lat ?? task?.lat ?? task?.latitude);
  const lng = toNumber(task?.pin_lng ?? task?.lng ?? task?.longitude);
  return lat != null && lng != null ? { lat, lng } : null;
}

function plannedValue(task) {
  const value = Number(task?.wartosc_planowana || task?.wartosc_rzeczywista || task?.budzet || 0);
  return Number.isFinite(value) ? value : 0;
}

function moneyCompact(value) {
  const amount = Number(value) || 0;
  if (amount >= 1000000) return `${(amount / 1000000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln`;
  if (amount >= 1000) return `${Math.round(amount / 1000).toLocaleString('pl-PL')} tys.`;
  return amount ? `${amount.toLocaleString('pl-PL')} PLN` : 'brak';
}

export default function MapaLive() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNarrow = useNarrowViewport();
  const [rows, setRows] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [teams, setTeams] = useState([]);
  const [equipmentItems, setEquipmentItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastLoadAt, setLastLoadAt] = useState(null);
  const [quickPlanTask, setQuickPlanTask] = useState(null);
  const [quickPlan, setQuickPlan] = useState(() => buildPlanDefaults({}));
  const [quickPlanSaving, setQuickPlanSaving] = useState(false);
  const [quickPlanMsg, setQuickPlanMsg] = useState('');
  const [quickPlanErr, setQuickPlanErr] = useState('');
  const [quickPlanReservations, setQuickPlanReservations] = useState([]);
  const [quickPlanReservationsLoading, setQuickPlanReservationsLoading] = useState(false);
  const [quickPlanReservationsErr, setQuickPlanReservationsErr] = useState('');
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedCommandTaskId, setSelectedCommandTaskId] = useState(() => searchParams.get('task') || '');
  const [commandMobileView, setCommandMobileView] = useState(() => normalizeCommandView(searchParams.get('view')));
  const [commandCopyMsg, setCommandCopyMsg] = useState('');

  const user = useMemo(() => getLocalStorageJson('user', {}), []);
  const canSeeAll = ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);

  useEffect(() => {
    const nextTaskId = searchParams.get('task') || '';
    const nextView = normalizeCommandView(searchParams.get('view'));
    setSelectedCommandTaskId((prev) => (prev === nextTaskId ? prev : nextTaskId));
    setCommandMobileView((prev) => (prev === nextView ? prev : nextView));
  }, [searchParams]);

  const updateCommandUrl = useCallback((updates) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        if (value == null || value === '') {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const selectCommandTask = useCallback((task) => {
    const taskId = task?.id ? String(task.id) : '';
    setSelectedCommandTaskId(taskId);
    updateCommandUrl({ task: taskId });
  }, [updateCommandUrl]);

  const changeCommandMobileView = useCallback((view) => {
    const nextView = normalizeCommandView(view);
    setCommandMobileView(nextView);
    updateCommandUrl({ view: nextView });
  }, [updateCommandUrl]);

  const copyCommandLink = useCallback(async (task) => {
    if (!task?.id || typeof window === 'undefined') return;
    const params = new URLSearchParams(searchParams);
    params.set('task', String(task.id));
    params.set('view', commandMobileView);
    const url = `${window.location.origin}${window.location.pathname}#/mapa-live?${params.toString()}`;
    try {
      await copyTextToClipboard(url);
      setCommandCopyMsg('Link skopiowany');
    } catch (err) {
      setCommandCopyMsg('Nie udało się skopiować');
    }
    window.setTimeout(() => setCommandCopyMsg(''), 4000);
  }, [commandMobileView, searchParams]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    const token = getStoredToken();
    if (!token) {
      navigate('/');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const headers = authHeaders(token);
      const [liveRes, branchRes, taskRes, teamsRes, equipmentRes] = await Promise.all([
        api.get(`/ekipy/live-locations${refresh ? '?refresh=1' : ''}`, { headers, dedupe: false }),
        api.get('/oddzialy', { headers }).catch(() => ({ data: [] })),
        api.get('/tasks/wszystkie', { headers, dedupe: false }).catch(() => ({ data: [] })),
        api.get('/ekipy?include_delegacje=1', { headers }).catch(() => ({ data: [] })),
        api.get('/flota/sprzet?include_delegacje=1', { headers }).catch(() => ({ data: [] })),
      ]);
      setRows(normalizeRows(liveRes.data));
      setTasks(normalizeTasks(taskRes.data));
      setTeams(Array.isArray(teamsRes.data) ? teamsRes.data : teamsRes.data?.ekipy || teamsRes.data?.items || []);
      setEquipmentItems(Array.isArray(equipmentRes.data) ? equipmentRes.data : equipmentRes.data?.items || []);
      setBranches(Array.isArray(branchRes.data) ? branchRes.data : branchRes.data?.oddzialy || []);
      setLastLoadAt(new Date());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udało się pobrać pozycji GPS.'));
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
    const intervalId = setInterval(() => load(), 60000);
    return () => clearInterval(intervalId);
  }, [load]);

  useEffect(() => {
    const day = String(quickPlan.data_planowana || '').slice(0, 10);
    if (!quickPlanTask?.id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setQuickPlanReservations([]);
      setQuickPlanReservationsErr('');
      setQuickPlanReservationsLoading(false);
      return undefined;
    }

    let ignore = false;
    async function loadQuickPlanReservations() {
      const token = getStoredToken();
      if (!token) return;
      setQuickPlanReservationsLoading(true);
      setQuickPlanReservationsErr('');
      try {
        const { data } = await api.get(
          `/flota/rezerwacje?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
          { headers: authHeaders(token), dedupe: false },
        );
        if (!ignore) setQuickPlanReservations(Array.isArray(data) ? data : data?.items || []);
      } catch (err) {
        if (!ignore) {
          setQuickPlanReservations([]);
          setQuickPlanReservationsErr(getApiErrorMessage(err, 'Nie udalo sie sprawdzic rezerwacji sprzetu.'));
        }
      } finally {
        if (!ignore) setQuickPlanReservationsLoading(false);
      }
    }
    loadQuickPlanReservations();
    return () => {
      ignore = true;
    };
  }, [quickPlan.data_planowana, quickPlanTask?.id]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (selectedBranch && String(row.oddzial_id || '') !== String(selectedBranch)) return false;
    if (selectedProvider && row.provider !== selectedProvider) return false;
    return true;
  }), [rows, selectedBranch, selectedProvider]);

  const branchTasks = useMemo(() => tasks.filter((task) => {
    if (selectedBranch && String(task.oddzial_id || '') !== String(selectedBranch)) return false;
    return true;
  }), [tasks, selectedBranch]);

  const todaysTasks = useMemo(() => branchTasks.filter((task) => taskDateOnly(task) === todayIso()), [branchTasks]);

  const liveByTeamId = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      if (!row.ekipa_id) continue;
      const key = String(row.ekipa_id);
      const prev = map.get(key);
      if (!prev || new Date(row.recorded_at || 0) > new Date(prev.recorded_at || 0)) map.set(key, row);
    }
    return map;
  }, [filteredRows]);

  const liveByEstimatorId = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      const id = row.wyceniajacy_id || row.user_id;
      if (!id) continue;
      const key = String(id);
      const prev = map.get(key);
      if (!prev || new Date(row.recorded_at || 0) > new Date(prev.recorded_at || 0)) map.set(key, row);
    }
    return map;
  }, [filteredRows]);

  const taskLiveRow = useCallback((task) => {
    if (task?.ekipa_id && liveByTeamId.has(String(task.ekipa_id))) return liveByTeamId.get(String(task.ekipa_id));
    if (task?.wyceniajacy_id && liveByEstimatorId.has(String(task.wyceniajacy_id))) return liveByEstimatorId.get(String(task.wyceniajacy_id));
    return null;
  }, [liveByTeamId, liveByEstimatorId]);

  const activeTasks = useMemo(
    () => todaysTasks.filter((task) => !CLOSED_STATUSES.has(task.status)),
    [todaysTasks],
  );

  const planningQueue = useMemo(
    () => branchTasks
      .filter(taskNeedsPlanning)
      .sort((a, b) => planningPriority(a) - planningPriority(b) || Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 12),
    [branchTasks],
  );

  const tasksWithoutGps = useMemo(
    () => activeTasks.filter((task) =>
      ['Zaplanowane', 'W_Realizacji', 'Wycena_Terenowa'].includes(task.status) && !taskLiveRow(task)
    ),
    [activeTasks, taskLiveRow],
  );

  const staleTaskGps = useMemo(
    () => activeTasks.filter((task) => {
      const live = taskLiveRow(task);
      if (!live) return false;
      return ['stale', 'offline'].includes(getFreshness(live).key);
    }),
    [activeTasks, taskLiveRow],
  );

  const checkinGapTasks = useMemo(
    () => activeTasks
      .filter(taskNeedsArrivalSignal)
      .filter((task) => !taskHasArrivalSignal(task))
      .sort((a, b) => planningPriority(a) - planningPriority(b) || String(taskTime(a)).localeCompare(String(taskTime(b))))
      .slice(0, 10),
    [activeTasks],
  );

  const photoGapTasks = useMemo(
    () => branchTasks
      .filter((task) => !CLOSED_STATUSES.has(task.status))
      .filter(taskNeedsPhotoEvidence)
      .filter((task) => !taskPhotoSummary(task).ready)
      .sort((a, b) => planningPriority(a) - planningPriority(b) || Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 10),
    [branchTasks],
  );

  const problemTasks = useMemo(
    () => branchTasks
      .filter((task) => !CLOSED_STATUSES.has(task.status))
      .filter((task) => taskIssueSummary(task).open > 0)
      .sort((a, b) => taskIssueSummary(b).open - taskIssueSummary(a).open || Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 10),
    [branchTasks],
  );

  const commandTaskIds = useMemo(() => new Set([
    ...activeTasks,
    ...planningQueue,
    ...tasksWithoutGps,
    ...staleTaskGps,
    ...problemTasks,
  ].map((task) => String(task.id))), [activeTasks, planningQueue, problemTasks, staleTaskGps, tasksWithoutGps]);

  useEffect(() => {
    if (loading || !selectedCommandTaskId || !tasks.length) return;
    if (!commandTaskIds.has(String(selectedCommandTaskId))) selectCommandTask(null);
  }, [commandTaskIds, loading, selectCommandTask, selectedCommandTaskId, tasks.length]);

  const bounds = useMemo(() => {
    if (!filteredRows.length) return null;
    return filteredRows.reduce((acc, row) => ({
      minLat: Math.min(acc.minLat, row.lat),
      maxLat: Math.max(acc.maxLat, row.lat),
      minLng: Math.min(acc.minLng, row.lng),
      maxLng: Math.max(acc.maxLng, row.lng),
    }), {
      minLat: filteredRows[0].lat,
      maxLat: filteredRows[0].lat,
      minLng: filteredRows[0].lng,
      maxLng: filteredRows[0].lng,
    });
  }, [filteredRows]);

  const stats = useMemo(() => filteredRows.reduce((acc, row) => {
    const fresh = getFreshness(row).key;
    acc.total += 1;
    acc[fresh] = (acc[fresh] || 0) + 1;
    if (row.provider === 'mobile') acc.mobile += 1;
    if (row.provider === 'juwentus') acc.vehicles += 1;
    return acc;
  }, { total: 0, online: 0, stale: 0, offline: 0, unknown: 0, mobile: 0, vehicles: 0 }), [filteredRows]);

  const taskBounds = useMemo(() => {
    const taskPoints = activeTasks.map(taskMapPoint).filter(Boolean);
    const allPoints = [...filteredRows, ...taskPoints];
    if (!allPoints.length) return bounds;
    return allPoints.reduce((acc, row) => ({
      minLat: Math.min(acc.minLat, row.lat),
      maxLat: Math.max(acc.maxLat, row.lat),
      minLng: Math.min(acc.minLng, row.lng),
      maxLng: Math.max(acc.maxLng, row.lng),
    }), {
      minLat: allPoints[0].lat,
      maxLat: allPoints[0].lat,
      minLng: allPoints[0].lng,
      maxLng: allPoints[0].lng,
    });
  }, [activeTasks, bounds, filteredRows]);

  const branchName = useCallback((id) => {
    const branch = branches.find((item) => String(item.id) === String(id));
    return branch?.nazwa || (id ? `Oddział #${id}` : 'Bez oddziału');
  }, [branches]);

  const openGpsHistory = useCallback(async (row) => {
    const token = getStoredToken();
    if (!token) {
      navigate('/');
      return;
    }
    setHistoryTarget(row);
    setHistoryRows([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const params = historyParamsForRow(row);
      const { data } = await api.get(`/ekipy/gps-history?${params.toString()}`, {
        headers: authHeaders(token),
        dedupe: false,
      });
      const normalized = normalizeRows(data)
        .sort((a, b) => new Date(a.recorded_at || 0) - new Date(b.recorded_at || 0));
      setHistoryRows(normalized);
    } catch (err) {
      setHistoryRows([]);
      setHistoryError(getApiErrorMessage(err, 'Nie udalo sie pobrac historii GPS.'));
    } finally {
      setHistoryLoading(false);
    }
  }, [navigate]);

  const quickPlanTeams = useMemo(() => {
    const branchId = quickPlanTask?.oddzial_id || selectedBranch || '';
    if (!branchId) return teams;
    return teams.filter((team) => String(teamAvailableBranchId(team) || '') === String(branchId));
  }, [quickPlanTask?.oddzial_id, selectedBranch, teams]);

  const quickPlanEquipmentOptions = useMemo(() => {
    const selected = new Set((quickPlan.sprzet_ids || []).map(String));
    const branchId = String(quickPlanTask?.oddzial_id || selectedBranch || '').trim();
    const teamId = quickPlan.ekipa_id;
    return [...equipmentItems]
      .filter((item) => {
        if (selected.has(String(item.id))) return true;
        const sameBranch = !branchId || !equipmentBranchId(item) || equipmentBranchId(item) === branchId;
        const assignedToTeam = isEquipmentAssignedToTeam(item, teamId);
        return (sameBranch || assignedToTeam) && !isEquipmentUnavailable(item);
      })
      .sort((a, b) => {
        const aTeam = isEquipmentAssignedToTeam(a, teamId) ? 0 : 1;
        const bTeam = isEquipmentAssignedToTeam(b, teamId) ? 0 : 1;
        if (aTeam !== bTeam) return aTeam - bTeam;
        return String(a.typ || '').localeCompare(String(b.typ || ''), 'pl') ||
          String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl');
      });
  }, [equipmentItems, quickPlan.ekipa_id, quickPlan.sprzet_ids, quickPlanTask?.oddzial_id, selectedBranch]);

  const selectedQuickPlanEquipment = useMemo(
    () => quickPlanEquipmentOptions.filter((item) =>
      (quickPlan.sprzet_ids || []).some((id) => String(id) === String(item.id))
    ),
    [quickPlan.sprzet_ids, quickPlanEquipmentOptions],
  );

  const quickPlanTeamEquipmentIds = useMemo(
    () => teamEquipmentIdsForPlan(quickPlanEquipmentOptions, quickPlan.ekipa_id),
    [quickPlan.ekipa_id, quickPlanEquipmentOptions],
  );

  const quickPlanSlotSuggestions = useMemo(
    () => quickSlotSuggestions(tasks, quickPlanTask, {
      data_planowana: quickPlan.data_planowana,
      czas_planowany_godziny: quickPlan.czas_planowany_godziny,
      ekipa_id: quickPlan.ekipa_id,
    }),
    [quickPlan.czas_planowany_godziny, quickPlan.data_planowana, quickPlan.ekipa_id, quickPlanTask, tasks],
  );

  const quickPlanTimeline = useMemo(
    () => quickDayTimeline(tasks, quickPlanTask, {
      data_planowana: quickPlan.data_planowana,
      godzina_rozpoczecia: quickPlan.godzina_rozpoczecia,
      czas_planowany_godziny: quickPlan.czas_planowany_godziny,
      ekipa_id: quickPlan.ekipa_id,
    }),
    [quickPlan.czas_planowany_godziny, quickPlan.data_planowana, quickPlan.ekipa_id, quickPlan.godzina_rozpoczecia, quickPlanTask, tasks],
  );

  const quickPlanTeamConflicts = useMemo(
    () => quickTeamConflicts(tasks, quickPlanTask, quickPlan),
    [quickPlan, quickPlanTask, tasks],
  );

  const quickPlanEquipmentConflicts = useMemo(
    () => quickEquipmentConflicts(quickPlanReservations, quickPlanTask, quickPlan),
    [quickPlan, quickPlanReservations, quickPlanTask],
  );

  const quickPlanHasHardConflicts = quickPlanTeamConflicts.conflicts.length > 0 || quickPlanEquipmentConflicts.length > 0;
  const quickPlanMissing = useMemo(() => quickPlanMissingLabels(quickPlan), [quickPlan]);
  const quickPlanReservationsBlocked = quickPlanReservationsLoading || Boolean(quickPlanReservationsErr);
  const quickPlanReady = quickPlanMissing.length === 0 && !quickPlanHasHardConflicts && !quickPlanReservationsBlocked;
  const quickPlanStatusTone = quickPlanReady
    ? '#14834F'
    : quickPlanHasHardConflicts
      ? '#BE123C'
      : quickPlanReservationsLoading
        ? '#0E7490'
        : quickPlanReservationsErr
          ? '#B7791F'
          : '#B7791F';
  const quickPlanStatusLabel = quickPlanReady
    ? 'Plan gotowy'
    : quickPlanHasHardConflicts
      ? 'Konflikt w planie'
      : quickPlanReservationsLoading
        ? 'Sprawdzam rezerwacje'
        : quickPlanReservationsErr
          ? 'Radar sprzetu nie odpowiada'
          : `Braki: ${quickPlanMissing.join(', ') || 'sprawdz plan'}`;
  const quickPlanStatusHint = quickPlanReady
    ? 'Biuro moze zapisac plan i przekazac ekipie komplet informacji.'
    : quickPlanHasHardConflicts
      ? 'Usun konflikt ekipy albo sprzetu przed zapisem.'
      : quickPlanReservationsLoading
        ? 'Czekam na radar rezerwacji sprzetu dla tej daty.'
        : quickPlanReservationsErr
          ? 'Odblokuj zapis dopiero po sprawdzeniu rezerwacji sprzetu.'
          : 'Uzupelnij wymagane pola, zeby zlecenie nie wrocilo do chaosu.';
  const canAutoFitQuickPlan = quickPlan.ekipa_id ? quickPlanSlotSuggestions.length > 0 : quickPlanTeams.length > 0;

  const openQuickPlan = useCallback((task) => {
    setQuickPlanTask(task);
    setQuickPlan(buildPlanDefaults(task));
    setQuickPlanMsg('');
    setQuickPlanErr('');
  }, []);

  const setQuickPlanField = useCallback((field, value) => {
    setQuickPlan((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setQuickPlanEquipment = useCallback((selectedOptions) => {
    const ids = Array.from(selectedOptions || []).map((option) => option.value).filter(Boolean);
    setQuickPlan((prev) => ({ ...prev, sprzet_ids: ids }));
  }, []);

  const autoFitQuickPlan = useCallback(() => {
    if (!quickPlanTask?.id) return;
    setQuickPlanErr('');
    setQuickPlanMsg('');

    const applyCandidate = ({ teamId, teamName, slot, equipmentIds }) => {
      setQuickPlan((prev) => {
        const nextEquipmentIds = equipmentIds.length
          ? equipmentIds
          : String(prev.ekipa_id || '') === String(teamId)
            ? prev.sprzet_ids || []
            : [];
        const nextNote = String(prev.sprzet_notatka || '').trim()
          ? prev.sprzet_notatka
          : nextEquipmentIds.length
            ? 'Sprzet przypisany do ekipy.'
            : 'Bez dodatkowego sprzetu.';
        return {
          ...prev,
          ekipa_id: String(teamId),
          godzina_rozpoczecia: slot.time,
          sprzet_ids: nextEquipmentIds,
          sprzet_notatka: nextNote,
        };
      });
      setQuickPlanMsg(`Auto-dopasowano ${teamName}: ${slot.time}-${slot.end}.`);
    };

    if (quickPlan.ekipa_id) {
      const firstSlot = quickPlanSlotSuggestions[0];
      if (!firstSlot) {
        setQuickPlanErr(`Brak wolnego slotu dla tej ekipy w godzinach ${PLANNING_DAY_LABEL}.`);
        return;
      }
      const equipmentIds = quickEquipmentConflicts(quickPlanReservations, quickPlanTask, {
        ...quickPlan,
        sprzet_ids: quickPlanTeamEquipmentIds,
      }).length
        ? []
        : quickPlanTeamEquipmentIds;
      const selectedTeam = quickPlanTeams.find((team) => String(team.id) === String(quickPlan.ekipa_id));
      applyCandidate({
        teamId: quickPlan.ekipa_id,
        teamName: selectedTeam ? teamLabel(selectedTeam) : `Ekipa #${quickPlan.ekipa_id}`,
        slot: firstSlot,
        equipmentIds,
      });
      return;
    }

    for (const team of quickPlanTeams) {
      const teamId = String(team.id);
      const candidatePlan = { ...quickPlan, ekipa_id: teamId };
      const slot = quickSlotSuggestions(tasks, quickPlanTask, candidatePlan)[0];
      if (!slot) continue;
      const teamEquipmentIds = teamEquipmentIdsForPlan(equipmentItems, teamId);
      const equipmentIds = quickEquipmentConflicts(quickPlanReservations, quickPlanTask, {
        ...candidatePlan,
        sprzet_ids: teamEquipmentIds,
      }).length
        ? []
        : teamEquipmentIds;
      applyCandidate({ teamId, teamName: teamLabel(team), slot, equipmentIds });
      return;
    }

    setQuickPlanErr(`Nie znalazlem wolnej ekipy w godzinach ${PLANNING_DAY_LABEL} dla tej daty.`);
  }, [
    equipmentItems,
    quickPlan,
    quickPlanReservations,
    quickPlanSlotSuggestions,
    quickPlanTask,
    quickPlanTeamEquipmentIds,
    quickPlanTeams,
    tasks,
  ]);

  const submitQuickPlan = useCallback(async () => {
    if (!quickPlanTask?.id) return;

    if (quickPlanMissing.length) {
      setQuickPlanErr(`Uzupelnij: ${quickPlanMissing.join(', ')}.`);
      return;
    }
    if (quickPlanReservationsLoading) {
      setQuickPlanErr('Poczekaj, sprawdzam rezerwacje sprzetu.');
      return;
    }
    if (quickPlanReservationsErr) {
      setQuickPlanErr('Nie zapisuje bez radaru rezerwacji sprzetu. Odswiez dane albo sprobuj ponownie.');
      return;
    }
    if (quickPlanHasHardConflicts) {
      setQuickPlanErr('Najpierw usun konflikty ekipy albo sprzetu.');
      return;
    }

    setQuickPlanSaving(true);
    setQuickPlanErr('');
    setQuickPlanMsg('');
    try {
      const token = getStoredToken();
      const payload = { ...quickPlan };
      if (!payload.sprzet_ids?.length) delete payload.sprzet_ids;
      const { data } = await api.put(
        `/tasks/${quickPlanTask.id}/office-plan`,
        payload,
        { headers: authHeaders(token) },
      );
      setQuickPlanMsg(data?.message || 'Zlecenie zaplanowane.');
      await load({ refresh: false });
      setQuickPlanTask((prev) => (prev ? { ...prev, ...(data || {}), status: data?.status || 'Zaplanowane' } : prev));
    } catch (err) {
      setQuickPlanErr(getApiErrorMessage(err, 'Nie udalo sie zapisac planu.'));
    } finally {
      setQuickPlanSaving(false);
    }
  }, [load, quickPlan, quickPlanHasHardConflicts, quickPlanMissing, quickPlanReservationsErr, quickPlanReservationsLoading, quickPlanTask]);

  const commandCenter = (
    <CommandCenter
      isNarrow={isNarrow}
      rows={filteredRows}
      activeTasks={activeTasks}
      planningQueue={planningQueue}
      tasksWithoutGps={tasksWithoutGps}
      staleTaskGps={staleTaskGps}
      checkinGapTasks={checkinGapTasks}
      photoGapTasks={photoGapTasks}
      problemTasks={problemTasks}
      stats={stats}
      bounds={taskBounds}
      lastLoadAt={lastLoadAt}
      taskLiveRow={taskLiveRow}
      branchName={branchName}
      selectedTaskId={selectedCommandTaskId}
      mobileView={commandMobileView}
      copyMessage={commandCopyMsg}
      onSelectTask={selectCommandTask}
      onMobileViewChange={changeCommandMobileView}
      onCopyLink={copyCommandLink}
      onOpenTask={(task) => navigate(`/zlecenia/${task.id}`)}
      onOpenPlan={(task) => openQuickPlan(task)}
      onOpenSchedule={() => navigate('/harmonogram')}
    />
  );

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main" style={{ ...S.main, ...(isNarrow ? S.mainNarrow : null) }}>
        <section style={{ ...S.hero, ...(isNarrow ? S.heroNarrow : null) }}>
          <div style={{ ...S.heroIcon, ...(isNarrow ? S.heroIconNarrow : null) }}><MapOutlined /></div>
          <div style={{ ...S.heroCopy, ...(isNarrow ? S.fullWidth : null) }}>
            <div style={S.eyebrow}>Live operations</div>
            <h1 style={{ ...S.title, ...(isNarrow ? S.titleNarrow : null) }}>Mapa live brygad i wyceniających</h1>
            <p style={S.subtitle}>
              Ostatnia znana pozycja z mobilki i GPS pojazdów. Kierownik widzi kto jest online, kto ma stary sygnał i gdzie otworzyć trasę.
            </p>
          </div>
          <button type="button" onClick={() => load({ refresh: true })} style={{ ...S.refreshBtn, ...(isNarrow ? S.fullWidthButton : null) }} disabled={loading}>
            <RefreshOutlined style={{ fontSize: 18 }} />
            {loading ? 'Odświeżam...' : 'Odśwież GPS'}
          </button>
        </section>

        {error ? <div style={S.error}><WarningAmberOutlined style={{ fontSize: 18 }} />{error}</div> : null}

        {isNarrow ? commandCenter : null}

        <section style={{ ...S.toolbar, ...(isNarrow ? S.toolbarNarrow : null) }}>
          <div style={{ ...S.filterGroup, ...(isNarrow ? S.fullWidth : null) }}>
            <label style={S.label}>Oddział</label>
            <select
              value={selectedBranch}
              onChange={(event) => setSelectedBranch(event.target.value)}
              style={S.select}
              disabled={!canSeeAll}
            >
              <option value="">{canSeeAll ? 'Wszystkie oddziały' : branchName(user?.oddzial_id)}</option>
              {canSeeAll && branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.nazwa}</option>
              ))}
            </select>
          </div>
          <div style={{ ...S.filterGroup, ...(isNarrow ? S.fullWidth : null) }}>
            <label style={S.label}>Źródło</label>
            <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)} style={S.select}>
              <option value="">Wszystkie źródła</option>
              <option value="mobile">Telefon</option>
              <option value="juwentus">GPS auta</option>
            </select>
          </div>
          <div style={{ ...S.lastSync, ...(isNarrow ? S.lastSyncNarrow : null) }}>
            Ostatnie odświeżenie: <strong>{lastLoadAt ? formatClock(lastLoadAt.toISOString()) : '--:--'}</strong>
          </div>
        </section>

        {!isNarrow ? commandCenter : null}

        <section style={S.kpiGrid}>
          <Kpi label="Wszystkie sygnały" value={stats.total} tone="#0E7490" />
          <Kpi label="Online ≤ 5 min" value={stats.online || 0} tone="#14834F" />
          <Kpi label="Opóźnione" value={stats.stale || 0} tone="#B7791F" />
          <Kpi label="Offline > 20 min" value={stats.offline || 0} tone="#BE123C" />
          <Kpi label="Z mobilki" value={stats.mobile} tone="#14834F" />
          <Kpi label="Z pojazdów" value={stats.vehicles} tone="#0E7490" />
          <Kpi label="Zlecenia dzisiaj" value={activeTasks.length} tone="#3F7D20" />
          <Kpi label="Do zaplanowania" value={planningQueue.length} tone="#B7791F" />
          <Kpi label="Brak check-in" value={checkinGapTasks.length} tone="#BE123C" />
          <Kpi label="Braki zdjec" value={photoGapTasks.length} tone="#B7791F" />
          <Kpi label="Problemy" value={problemTasks.length} tone="#BE123C" />
        </section>

        <section style={S.officeLivePanel}>
          <div style={{ ...S.panelHeader, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
            <div>
              <div style={S.panelTitle}>Biuro na zywo</div>
              <div style={S.panelSub}>
                Jedno miejsce do kontroli pracy: GPS, zdjecia, check-in i problemy z terenu.
              </div>
            </div>
            <span style={S.officeLiveStamp}>Dzisiaj / {todayIso()}</span>
          </div>
          <div style={S.officeLiveGrid}>
            <OfficeAlertColumn
              title="Brak GPS"
              subtitle="Plan jest, sygnalu nie ma"
              tone="#BE123C"
              tasks={tasksWithoutGps}
              empty="Brak zlecen bez GPS."
              onOpen={(task) => navigate(`/zlecenia/${task.id}`)}
              meta={(task) => `${taskTime(task)} / ${task.ekipa_nazwa || task.wyceniajacy_nazwa || 'teren'}`}
            />
            <OfficeAlertColumn
              title="Stary sygnal"
              subtitle="Mobilka albo pojazd milczy"
              tone="#B7791F"
              tasks={staleTaskGps}
              empty="Sygnaly wygladaja aktualnie."
              onOpen={(task) => navigate(`/zlecenia/${task.id}`)}
              meta={(task) => {
                const live = taskLiveRow(task);
                return live ? `${getFreshness(live).label} / ${formatAge(live.recorded_at)}` : 'brak';
              }}
            />
            <OfficeAlertColumn
              title="Brak check-in"
              subtitle="Plan jest, ale teren nie potwierdzil miejsca"
              tone="#BE123C"
              tasks={checkinGapTasks}
              empty="Wszystkie ekipy potwierdzily teren."
              onOpen={(task) => navigate(`/zlecenia/${task.id}`)}
              meta={(task) => `${taskTime(task)} / ${task.ekipa_nazwa || `ekipa #${task.ekipa_id}`}`}
            />
            <OfficeAlertColumn
              title="Braki zdjec"
              subtitle="Wycena, szkic, dojazd"
              tone="#B7791F"
              tasks={photoGapTasks}
              empty="Pakiety zdjec sa kompletne."
              onOpen={(task) => navigate(`/zlecenia/${task.id}`)}
              meta={(task) => {
                const photos = taskPhotoSummary(task);
                return `${photos.label} gotowe / brakuje: ${photos.missing.join(', ')}`;
              }}
            />
            <OfficeAlertColumn
              title="Problemy"
              subtitle="Tematy wymagajace reakcji"
              tone="#BE123C"
              tasks={problemTasks}
              empty="Brak otwartych problemow."
              onOpen={(task) => navigate(`/zlecenia/${task.id}`)}
              meta={(task) => {
                const issues = taskIssueSummary(task);
                return `${issues.open} otwarte / ${issues.total} razem`;
              }}
            />
          </div>
        </section>

        <section style={S.dispatchPanel}>
          <div style={{ ...S.panelHeader, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
            <div>
              <div style={S.panelTitle}>Dyspozytornia dnia</div>
              <div style={S.panelSub}>
                Dzisiejsze zlecenia z przypisanym sygnalem GPS, statusem pracy i szybkimi akcjami.
              </div>
            </div>
            <button type="button" style={S.secondaryBtn} onClick={() => navigate('/harmonogram')}>
              <CalendarMonthOutlined style={{ fontSize: 16 }} />
              Harmonogram
            </button>
          </div>

          <div style={S.queueSection}>
            <div style={{ ...S.queueHead, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
              <div>
                <div style={S.queueTitle}>Kolejka do dopięcia</div>
                <div style={S.panelSub}>Bez ekipy, bez terminu, bez czasu pracy albo do zatwierdzenia po ogledzinach.</div>
              </div>
              <span style={{ ...S.badge, borderColor: '#B7791F', color: '#B7791F' }}>
                {planningQueue.length} tematów
              </span>
            </div>
            <div style={S.queueList}>
              {planningQueue.length ? planningQueue.map((task) => (
                <PlanningTaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => navigate(`/zlecenia/${task.id}`)}
                  onSchedule={() => openQuickPlan(task)}
                />
              )) : (
                <div style={S.emptyList}>Kolejka planowania jest czysta dla wybranego oddzialu.</div>
              )}
            </div>
          </div>

          {quickPlanTask ? (
            <div style={S.quickPlanPanel}>
              <div style={S.queueHead}>
                <div>
                  <div style={S.queueTitle}>Szybkie planowanie</div>
                  <div style={S.panelSub}>{taskClient(quickPlanTask)} - {taskAddress(quickPlanTask)}</div>
                </div>
                <span style={S.quickPlanHeaderActions}>
                  <button
                    type="button"
                    style={{
                      ...S.mapBtn,
                      opacity: canAutoFitQuickPlan ? 1 : 0.62,
                      cursor: canAutoFitQuickPlan ? 'pointer' : 'not-allowed',
                    }}
                    onClick={autoFitQuickPlan}
                    disabled={!canAutoFitQuickPlan}
                  >
                    Auto-dopasuj
                  </button>
                  <button type="button" style={S.secondaryBtn} onClick={() => setQuickPlanTask(null)}>
                    Zamknij
                  </button>
                </span>
              </div>

              <div
                style={{
                  ...S.quickPlanReadiness,
                  borderColor: `${quickPlanStatusTone}55`,
                  boxShadow: `0 0 0 1px ${quickPlanStatusTone}16, 0 12px 26px rgba(15,95,58,0.1)`,
                }}
              >
                <span
                  style={{
                    ...S.quickPlanReadyDot,
                    background: quickPlanStatusTone,
                    boxShadow: `0 0 0 4px ${quickPlanStatusTone}18`,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ color: quickPlanStatusTone }}>{quickPlanStatusLabel}</strong>
                  <span>{quickPlanStatusHint}</span>
                </div>
              </div>

              <div style={{ ...S.quickPlanGrid, ...(isNarrow ? S.quickPlanGridNarrow : null) }}>
                <label style={S.quickPlanField}>
                  <span style={S.metricLabel}>Data</span>
                  <input
                    type="date"
                    value={quickPlan.data_planowana}
                    onChange={(event) => setQuickPlanField('data_planowana', event.target.value)}
                    style={S.quickPlanInput}
                  />
                </label>
                <label style={S.quickPlanField}>
                  <span style={S.metricLabel}>Godzina</span>
                  <input
                    type="time"
                    value={quickPlan.godzina_rozpoczecia}
                    onChange={(event) => setQuickPlanField('godzina_rozpoczecia', event.target.value)}
                    style={S.quickPlanInput}
                  />
                </label>
                <label style={S.quickPlanField}>
                  <span style={S.metricLabel}>Czas pracy</span>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={quickPlan.czas_planowany_godziny}
                    onChange={(event) => setQuickPlanField('czas_planowany_godziny', event.target.value)}
                    style={S.quickPlanInput}
                  />
                </label>
                <label style={S.quickPlanField}>
                  <span style={S.metricLabel}>Ekipa</span>
                  <select
                    value={quickPlan.ekipa_id}
                    onChange={(event) => setQuickPlanField('ekipa_id', event.target.value)}
                    style={S.quickPlanInput}
                  >
                    <option value="">Wybierz ekipe</option>
                    {quickPlanTeams.map((team) => (
                      <option key={team.id} value={team.id}>{teamLabel(team)}</option>
                    ))}
                  </select>
                </label>
                <label style={{ ...S.quickPlanField, gridColumn: '1 / -1' }}>
                  <span style={S.metricLabel}>Sprzet do rezerwacji</span>
                  <select
                    multiple
                    value={quickPlan.sprzet_ids || []}
                    onChange={(event) => setQuickPlanEquipment(event.target.selectedOptions)}
                    style={{ ...S.quickPlanInput, ...S.quickPlanMultiSelect }}
                  >
                    {quickPlanEquipmentOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {equipmentLabel(item, {
                          teamId: quickPlan.ekipa_id,
                          taskBranchId: quickPlanTask?.oddzial_id || selectedBranch,
                        })}
                      </option>
                    ))}
                  </select>
                  <span style={S.quickPlanHint}>
                    {selectedQuickPlanEquipment.length
                      ? `Wybrano: ${selectedQuickPlanEquipment.map((item) => item.nazwa || `#${item.id}`).join(', ')}`
                      : 'Wybierz sprzet albo wpisz uwage typu: bez dodatkowego sprzetu.'}
                  </span>
                  <span style={S.quickPlanActions}>
                    <button
                      type="button"
                      style={{ ...S.tinyBtn, opacity: quickPlanTeamEquipmentIds.length ? 1 : 0.55 }}
                      disabled={!quickPlanTeamEquipmentIds.length}
                      onClick={() => setQuickPlanField('sprzet_ids', quickPlanTeamEquipmentIds)}
                    >
                      Sprzet tej ekipy
                    </button>
                    <button
                      type="button"
                      style={S.tinyBtn}
                      onClick={() => setQuickPlanField('sprzet_ids', [])}
                    >
                      Wyczysc
                    </button>
                  </span>
                </label>
                <label style={{ ...S.quickPlanField, gridColumn: '1 / -1' }}>
                  <span style={S.metricLabel}>Sprzet / uwagi dla ekipy</span>
                  <input
                    type="text"
                    value={quickPlan.sprzet_notatka}
                    onChange={(event) => setQuickPlanField('sprzet_notatka', event.target.value)}
                    placeholder="np. rebak + podnosnik albo bez dodatkowego sprzetu"
                    style={S.quickPlanInput}
                  />
                </label>
              </div>

              {quickPlan.ekipa_id && quickPlan.data_planowana ? (
                <div style={S.quickSlotPanel}>
                  <div style={S.quickSlotHead}>
                    <strong>Najblizsze wolne godziny</strong>
                    <span>{quickPlan.czas_planowany_godziny || '2'} h pracy</span>
                  </div>
                  {quickPlanSlotSuggestions.length ? (
                    <div style={S.quickSlotList}>
                      {quickPlanSlotSuggestions.map((slot) => (
                        <button
                          key={`${slot.time}-${slot.end}`}
                          type="button"
                          style={{
                            ...S.quickSlotBtn,
                            ...(quickPlan.godzina_rozpoczecia === slot.time ? S.quickSlotBtnActive : {}),
                          }}
                          onClick={() => setQuickPlanField('godzina_rozpoczecia', slot.time)}
                        >
                          <strong>{slot.time}</strong>
                          <span>do {slot.end}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={S.quickSlotEmpty}>Brak wolnego slotu dla tej ekipy w godzinach {PLANNING_DAY_LABEL}.</div>
                  )}
                </div>
              ) : null}

              {quickPlan.ekipa_id && quickPlan.data_planowana ? (
                <div style={S.quickTimelinePanel}>
                  <div style={S.quickTimelineHead}>
                    <strong>Oś dnia ekipy</strong>
                    <span>{PLANNING_DAY_LABEL}</span>
                  </div>
                  <div style={S.quickTimelineTrack}>
                    {quickPlanTimeline.hours.map((hour, index) => (
                      <span
                        key={hour}
                        style={{
                          ...S.quickTimelineTick,
                          left: `${(index / Math.max(1, quickPlanTimeline.hours.length - 1)) * 100}%`,
                        }}
                      />
                    ))}
                    {quickPlanTimeline.busy.map((block) => (
                      <span
                        key={block.task.id}
                        style={{ ...S.quickTimelineBusy, ...timelineBlockStyle(block) }}
                        title={`${taskTime(block.task)}-${minutesToTime(block.end)} ${taskClient(block.task)}`}
                      >
                        {taskTime(block.task)}
                      </span>
                    ))}
                    {quickPlanTimeline.selected ? (
                      <span
                        style={{ ...S.quickTimelineSelected, ...timelineBlockStyle(quickPlanTimeline.selected) }}
                        title={`${quickPlan.godzina_rozpoczecia}-${minutesToTime(quickPlanTimeline.selected.end)} ${taskClient(quickPlanTask)}`}
                      >
                        Plan
                      </span>
                    ) : null}
                  </div>
                  <div style={S.quickTimelineHours}>
                    {quickPlanTimeline.hours.map((hour) => (
                      <span key={hour}>{hour}</span>
                    ))}
                  </div>
                  <div style={S.quickTimelineLegend}>
                    <span><i style={{ ...S.quickTimelineDot, background: '#B7791F' }} /> zajete</span>
                    <span><i style={{ ...S.quickTimelineDot, background: '#14834F' }} /> wybrany plan</span>
                  </div>
                </div>
              ) : null}

              {quickPlanReservationsLoading ? (
                <div style={S.quickPlanInfo}>Sprawdzam rezerwacje sprzetu dla wybranej daty...</div>
              ) : null}
              {quickPlanReservationsErr ? <div style={S.quickPlanWarn}>{quickPlanReservationsErr}</div> : null}
              {quickPlanTeamConflicts.outsideWorkday ? (
                <div style={S.quickPlanWarn}>Wybrany czas wychodzi poza standardowe godziny pracy {STANDARD_WORKDAY_LABEL}. Zapis jest dozwolony, bo ekipy czasem koncza pozniej.</div>
              ) : null}
              {quickPlanTeamConflicts.conflicts.length ? (
                <div style={S.quickPlanError}>
                  <strong>Konflikt ekipy w tym terminie</strong>
                  <ul style={S.quickPlanConflictList}>
                    {quickPlanTeamConflicts.conflicts.map((row) => {
                      const range = planRangeMinutes({
                        godzina_rozpoczecia: row.godzina_rozpoczecia,
                        czas_planowany_godziny: row.czas_planowany_godziny || row.czas_realizacji_godz,
                      }, row);
                      return (
                        <li key={row.id}>
                          {taskTime(row)}-{minutesToTime(range.end)} - {taskClient(row)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {quickPlanEquipmentConflicts.length ? (
                <div style={S.quickPlanError}>
                  <strong>Konflikt rezerwacji sprzetu</strong>
                  <ul style={S.quickPlanConflictList}>
                    {quickPlanEquipmentConflicts.map((row) => (
                      <li key={row.id}>
                        {row.sprzet_nazwa || `Sprzet #${row.sprzet_id}`} - {row.ekipa_nazwa || 'inna ekipa'}
                        {row.task_id ? `, zlecenie #${row.task_id}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {quickPlanErr ? <div style={S.quickPlanError}>{quickPlanErr}</div> : null}
              {quickPlanMsg ? <div style={S.quickPlanOk}>{quickPlanMsg}</div> : null}

              <div style={S.cardActions}>
                <button
                  type="button"
                  style={{
                    ...S.mapBtn,
                    opacity: quickPlanSaving || !quickPlanReady ? 0.65 : 1,
                    cursor: quickPlanSaving || !quickPlanReady ? 'not-allowed' : 'pointer',
                  }}
                  onClick={submitQuickPlan}
                  disabled={quickPlanSaving || !quickPlanReady}
                >
                  <CalendarMonthOutlined style={{ fontSize: 16 }} />
                  {quickPlanSaving
                    ? 'Zapisuje...'
                    : quickPlanReady
                      ? 'Zapisz plan'
                      : quickPlanHasHardConflicts
                        ? 'Usun konflikty'
                        : quickPlanReservationsLoading
                          ? 'Sprawdzam...'
                          : 'Uzupelnij plan'}
                </button>
                <button type="button" style={S.secondaryBtn} onClick={() => navigate(`/zlecenia/${quickPlanTask.id}`)}>
                  Pelna karta
                </button>
              </div>
            </div>
          ) : null}

          <div style={S.alertStrip}>
            <div style={{ ...S.alertCard, borderColor: tasksWithoutGps.length ? 'rgba(190,18,60,0.28)' : 'rgba(20,131,79,0.2)' }}>
              <WarningAmberOutlined style={{ color: tasksWithoutGps.length ? '#BE123C' : '#14834F', fontSize: 18 }} />
              <span>
                {tasksWithoutGps.length
                  ? `${tasksWithoutGps.length} zlecen ma plan, ale nie ma sygnalu GPS.`
                  : 'Kazde aktywne zlecenie z planem ma sygnal GPS albo czeka na start.'}
              </span>
            </div>
            <div style={{ ...S.alertCard, borderColor: staleTaskGps.length ? 'rgba(183,121,31,0.28)' : 'rgba(20,131,79,0.14)' }}>
              <MyLocationOutlined style={{ color: staleTaskGps.length ? '#B7791F' : '#64748B', fontSize: 18 }} />
              <span>
                {staleTaskGps.length
                  ? `${staleTaskGps.length} zlecen ma opozniony albo stary sygnal.`
                  : 'Brak opoznionych sygnalow przy aktywnych zleceniach.'}
              </span>
            </div>
          </div>

          <div style={S.dispatchList}>
            {activeTasks.length ? activeTasks
              .slice()
              .sort((a, b) => String(taskTime(a)).localeCompare(String(taskTime(b))) || Number(a.id || 0) - Number(b.id || 0))
              .map((task) => (
                <DispatchTaskCard
                  key={task.id}
                  task={task}
                  live={taskLiveRow(task)}
                  onOpen={() => navigate(`/zlecenia/${task.id}`)}
                  onSchedule={() => navigate('/harmonogram')}
                />
              )) : (
                <div style={S.emptyList}>
                  Brak aktywnych zlecen na dzisiaj w tym filtrze. Jesli biuro doda zlecenia, pojawia sie tutaj automatycznie.
                </div>
              )}
          </div>
        </section>

        <section style={{ ...S.grid, ...(isNarrow ? S.gridNarrow : null) }}>
          <div style={{ ...S.radarPanel, ...(isNarrow ? S.radarPanelNarrow : null) }}>
            <div style={{ ...S.panelHeader, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
              <div>
                <div style={S.panelTitle}>Radar pozycji</div>
                <div style={S.panelSub}>Widok orientacyjny według koordynatów GPS</div>
              </div>
              <MyLocationOutlined style={{ color: '#14834F' }} />
            </div>
            <div style={{ ...S.radar, ...(isNarrow ? S.radarNarrow : null) }}>
              <div style={S.gridLineH} />
              <div style={S.gridLineV} />
              <div style={S.radarCircleLarge} />
              <div style={S.radarCircleSmall} />
              {filteredRows.map((row, index) => {
                const fresh = getFreshness(row);
                const pos = pointPosition(row, bounds);
                return (
                  <a
                    key={`${row.provider}-${row.user_id || row.vehicle_id || row.nr_rejestracyjny}-${index}`}
                    href={mapHref(row)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...S.radarPoint, ...pos, borderColor: fresh.color, color: fresh.color }}
                    title={`${subjectLabel(row)} - ${sourceLabel(row)} - ${formatAge(row.recorded_at)}`}
                  >
                    {index + 1}
                  </a>
                );
              })}
              {!filteredRows.length ? <div style={S.emptyRadar}>Brak sygnałów GPS dla filtra</div> : null}
            </div>
          </div>

          <div style={{ ...S.listPanel, ...(isNarrow ? S.panelNarrow : null) }}>
            <div style={{ ...S.panelHeader, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
              <div>
                <div style={S.panelTitle}>Sygnały live</div>
                <div style={S.panelSub}>Kliknij “Mapa”, żeby otworzyć dokładną pozycję</div>
              </div>
            </div>
            <div style={S.locationList}>
              {filteredRows.length ? filteredRows.map((row, index) => {
                const fresh = getFreshness(row);
                const href = mapHref(row);
                return (
                  <article key={`${row.provider}-${row.user_id || row.vehicle_id || row.nr_rejestracyjny}-${index}`} style={S.locationCard}>
                    <div style={{ ...S.statusRail, background: fresh.color }} />
                    <div style={{ ...S.locationTop, ...(isNarrow ? S.locationTopNarrow : null) }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={S.locationName}>{subjectLabel(row)}</div>
                        <div style={S.locationMeta}>
                          {roleLabel(row)} · {branchName(row.oddzial_id)}
                        </div>
                      </div>
                      <span style={{ ...S.badge, borderColor: fresh.color, color: fresh.color }}>
                        {fresh.label}
                      </span>
                    </div>
                    <div style={{ ...S.detailsGrid, ...(isNarrow ? S.detailsGridNarrow : null) }}>
                      <Metric label="Zrodlo" value={sourceLabel(row)} />
                      <Metric label="Wyslal" value={gpsSenderLabel(row)} />
                      <Metric label="Sync" value={formatAge(row.recorded_at)} />
                      <Metric label="Dokladnosc" value={gpsAccuracyLabel(row)} />
                      <Metric label="Bateria" value={gpsBatteryLabel(row)} />
                      <Metric label="Predkosc" value={row.speed_kmh != null ? `${Math.round(row.speed_kmh)} km/h` : 'brak'} />
                      <Metric label="Urzadzenie" value={gpsPlatformLabel(row)} />
                      <Metric label="GPS" value={`${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`} />
                    </div>
                    <div style={{ ...S.cardActions, ...(isNarrow ? S.cardActionsNarrow : null) }}>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" style={S.mapBtn}>
                          <NavigationOutlined style={{ fontSize: 16 }} />
                          Mapa
                        </a>
                      ) : null}
                      {row.ekipa_id ? (
                        <button type="button" style={S.secondaryBtn} onClick={() => navigate('/harmonogram')}>
                          Harmonogram
                        </button>
                      ) : null}
                      <button type="button" style={S.secondaryBtn} onClick={() => openGpsHistory(row)}>
                        Historia dnia
                      </button>
                    </div>
                  </article>
                );
              }) : (
                <div style={S.emptyList}>Brak aktualnych pozycji. Mobilka wyśle sygnał, gdy brygadzista albo wyceniający ma aktywną aplikację.</div>
              )}
            </div>
          </div>
        </section>

        {historyTarget ? (
          <section style={S.historyPanel}>
            <div style={{ ...S.panelHeader, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
              <div>
                <div style={S.panelTitle}>Historia GPS dnia</div>
                <div style={S.panelSub}>
                  {subjectLabel(historyTarget)} / {sourceLabel(historyTarget)} / {todayIso()}
                </div>
              </div>
              <button
                type="button"
                style={S.secondaryBtn}
                onClick={() => {
                  setHistoryTarget(null);
                  setHistoryRows([]);
                  setHistoryError('');
                }}
              >
                Zamknij
              </button>
            </div>

            {historyError ? <div style={S.error}><WarningAmberOutlined style={{ fontSize: 18 }} />{historyError}</div> : null}

            <div style={S.historySummary}>
              <Metric label="Punktow" value={historyRows.length} />
              <Metric label="Zakres" value={historyRangeLabel(historyRows)} />
              <Metric label="Max predkosc" value={historyMaxSpeed(historyRows)} />
              <Metric label="Wyslal" value={gpsSenderLabel(historyTarget)} />
            </div>

            {historyLoading ? (
              <div style={S.emptyList}>Laduje trase z dzisiejszego dnia...</div>
            ) : historyRows.length ? (
              <>
                <div style={S.historyRouteStrip}>
                  {historyRows.slice(-36).map((point, index) => (
                    <a
                      key={`${point.provider}-${point.recorded_at}-${index}`}
                      href={mapHref(point)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        ...S.historyRouteDot,
                        opacity: 0.35 + ((index + 1) / Math.min(36, historyRows.length)) * 0.65,
                      }}
                      title={`${formatClock(point.recorded_at)} / ${gpsAccuracyLabel(point)}`}
                    />
                  ))}
                </div>
                <div style={S.historyTimeline}>
                  {historyRows.slice(-80).map((point, index) => (
                    <div key={`${point.provider}-${point.recorded_at}-${index}`} style={{ ...S.historyPoint, ...(isNarrow ? S.historyPointNarrow : null) }}>
                      <span style={{ ...S.historyPointDot, background: point.provider === 'mobile' ? '#14834F' : '#0E7490' }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={S.historyPointTitle}>{formatClock(point.recorded_at)} / {sourceLabel(point)}</div>
                        <div style={S.historyPointMeta}>
                          {gpsSenderLabel(point)} / {gpsAccuracyLabel(point)} / {point.speed_kmh != null ? `${Math.round(point.speed_kmh)} km/h` : 'predkosc brak'}
                        </div>
                      </div>
                      <a href={mapHref(point)} target="_blank" rel="noreferrer" style={S.mapBtn}>
                        Mapa
                      </a>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={S.emptyList}>Brak punktow GPS dla tej osoby albo ekipy w dzisiejszym dniu.</div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div style={S.kpiCard}>
      <div style={{ ...S.kpiGlow, background: tone }} />
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color: tone }}>{value}</div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div style={S.metricLabel}>{label}</div>
      <div style={S.metricValue}>{value}</div>
    </div>
  );
}

function OfficeAlertColumn({ title, subtitle, tone, tasks, empty, onOpen, meta }) {
  return (
    <article style={{ ...S.officeLiveColumn, borderColor: tasks.length ? `${tone}42` : 'rgba(20,131,79,0.14)' }}>
      <div style={S.officeLiveColumnHead}>
        <div style={{ minWidth: 0 }}>
          <div style={S.officeLiveTitle}>{title}</div>
          <div style={S.officeLiveSub}>{subtitle}</div>
        </div>
        <span style={{ ...S.officeLiveCount, color: tone, borderColor: `${tone}45`, background: `${tone}12` }}>
          {tasks.length}
        </span>
      </div>

      <div style={S.officeLiveList}>
        {tasks.length ? tasks.map((task) => (
          <button
            type="button"
            key={task.id}
            style={S.officeLiveTask}
            onClick={() => onOpen(task)}
          >
            <span style={{ ...S.officeLiveDot, background: tone }} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <strong style={S.officeLiveTaskTitle}>{taskClient(task)}</strong>
              <span style={S.officeLiveTaskMeta}>{taskAddress(task)}</span>
              <span style={S.officeLiveTaskFooter}>{meta(task)}</span>
            </span>
          </button>
        )) : (
          <div style={S.officeLiveEmpty}>{empty}</div>
        )}
      </div>
    </article>
  );
}

function DispatchTaskCard({ task, live, onOpen, onSchedule }) {
  const fresh = live ? getFreshness(live) : { label: 'Brak GPS', color: '#BE123C', key: 'missing' };
  const liveHref = live ? mapHref(live) : mapHref(task);
  const isRisk = !live || ['stale', 'offline'].includes(fresh.key);
  const photos = taskPhotoSummary(task);
  const issues = taskIssueSummary(task);

  return (
    <article style={{ ...S.dispatchCard, borderColor: isRisk ? 'rgba(190,18,60,0.22)' : 'rgba(20,131,79,0.16)' }}>
      <div style={{ ...S.statusRail, background: taskStatusColor(task.status) }} />
      <div style={S.dispatchTop}>
        <div style={S.dispatchIcon}>
          <AssignmentOutlined style={{ fontSize: 18 }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.dispatchTitle}>{taskClient(task)}</div>
          <div style={S.dispatchMeta}>{taskAddress(task)}</div>
        </div>
        <span style={{ ...S.badge, borderColor: taskStatusColor(task.status), color: taskStatusColor(task.status) }}>
          {taskStatusLabel(task.status)}
        </span>
      </div>

      <div style={S.dispatchFacts}>
        <Metric label="Start" value={taskTime(task)} />
        <Metric label="Ekipa" value={task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'Brak')} />
        <Metric label="GPS" value={live ? `${fresh.label} / ${formatAge(live.recorded_at)}` : 'Brak sygnalu'} />
        <Metric label="Check-in" value={taskArrivalLabel(task)} />
        <Metric label="Zdjecia" value={`${photos.total} / pakiet ${photos.label}`} />
        <Metric label="Problemy" value={issues.open ? `${issues.open} otwarte` : 'brak'} />
        <Metric label="GPS z" value={live ? sourceLabel(live) : 'brak'} />
        <Metric label="Wyslal" value={live ? gpsSenderLabel(live) : 'brak'} />
        <Metric label="Bateria GPS" value={live ? gpsBatteryLabel(live) : 'brak'} />
      </div>

      <div style={S.cardActions}>
        <button type="button" style={S.secondaryBtn} onClick={onOpen}>
          Zlecenie
        </button>
        <button type="button" style={S.secondaryBtn} onClick={onSchedule}>
          Plan
        </button>
        {liveHref ? (
          <a href={liveHref} target="_blank" rel="noreferrer" style={S.mapBtn}>
            <NavigationOutlined style={{ fontSize: 16 }} />
            {live ? 'GPS' : 'Mapa'}
          </a>
        ) : null}
      </div>
    </article>
  );
}

function PlanningTaskCard({ task, onOpen, onSchedule }) {
  const missing = planningMissingLabels(task);
  const stage = planningStageLabel(task);
  const color = taskStatusColor(task.status);

  return (
    <article style={S.planningCard}>
      <div style={{ ...S.statusRail, background: color }} />
      <div style={S.planningTop}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.dispatchTitle}>{taskClient(task)}</div>
          <div style={S.dispatchMeta}>{taskAddress(task)}</div>
        </div>
        <span style={{ ...S.badge, borderColor: color, color }}>{stage}</span>
      </div>

      <div style={S.missingRow}>
        {missing.length ? missing.slice(0, 5).map((label) => (
          <span key={label} style={S.missingPill}>{label}</span>
        )) : <span style={S.missingPill}>do kontroli</span>}
      </div>

      <div style={S.dispatchFacts}>
        <Metric label="Termin" value={taskHasDate(task) ? `${taskDateOnly(task)} ${taskTime(task)}` : 'brak'} />
        <Metric label="Ekipa" value={task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak')} />
      </div>

      <div style={S.cardActions}>
        <button type="button" style={S.secondaryBtn} onClick={onOpen}>Karta</button>
        <button type="button" style={S.mapBtn} onClick={onSchedule}>Planowanie</button>
      </div>
    </article>
  );
}

function CommandCenter({
  isNarrow,
  rows,
  activeTasks,
  planningQueue,
  tasksWithoutGps,
  staleTaskGps,
  checkinGapTasks,
  photoGapTasks,
  problemTasks,
  stats,
  bounds,
  lastLoadAt,
  taskLiveRow,
  branchName,
  selectedTaskId,
  mobileView,
  copyMessage,
  onSelectTask,
  onMobileViewChange,
  onCopyLink,
  onOpenTask,
  onOpenPlan,
  onOpenSchedule,
}) {
  const riskValue = activeTasks.reduce((sum, task) => {
    const risky = !taskLiveRow(task) || problemTasks.some((row) => String(row.id) === String(task.id));
    return risky ? sum + plannedValue(task) : sum;
  }, 0);
  const critical = [
    ...tasksWithoutGps.map((task) => ({ task, tone: '#BE123C', reason: 'Brak GPS przy planie' })),
    ...staleTaskGps.map((task) => ({ task, tone: '#B7791F', reason: 'Stary sygnał GPS' })),
    ...planningQueue.map((task) => ({ task, tone: '#B7791F', reason: `Braki: ${planningMissingLabels(task).join(', ') || 'plan'}` })),
    ...problemTasks.map((task) => ({ task, tone: '#BE123C', reason: 'Otwarty problem z terenu' })),
  ].filter((row, index, list) => list.findIndex((item) => String(item.task.id) === String(row.task.id)) === index).slice(0, 6);
  const taskPool = [...critical.map((row) => row.task), ...activeTasks, ...planningQueue];
  const selected = taskPool.find((task) => selectedTaskId && String(task.id) === String(selectedTaskId)) ||
    critical[0]?.task ||
    activeTasks[0] ||
    planningQueue[0] ||
    null;
  const selectedLive = selected ? taskLiveRow(selected) : null;
  const selectedFresh = selectedLive ? getFreshness(selectedLive) : null;
  const timelineTasks = activeTasks
    .slice()
    .sort((a, b) => String(taskTime(a)).localeCompare(String(taskTime(b))) || Number(a.id || 0) - Number(b.id || 0))
    .slice(0, isNarrow ? 8 : 18);
  const routeLines = activeTasks.slice(0, 10).map((task) => {
    const live = taskLiveRow(task);
    const destination = taskMapPoint(task);
    if (!live || !destination || !bounds) return null;
    const from = pointPosition(live, bounds);
    const to = pointPosition(destination, bounds);
    return {
      id: task.id,
      x1: percentValue(from.left),
      y1: percentValue(from.top),
      x2: percentValue(to.left),
      y2: percentValue(to.top),
      color: String(task.id) === String(selected?.id) ? '#2563EB' : '#94A3B8',
    };
  }).filter(Boolean);
  const commandKpis = [
    { label: 'Aktywne dzisiaj', value: activeTasks.length, tone: '#0E7490' },
    { label: 'Bez GPS', value: tasksWithoutGps.length, tone: tasksWithoutGps.length ? '#BE123C' : '#14834F' },
    { label: 'Do dopięcia', value: planningQueue.length, tone: planningQueue.length ? '#B7791F' : '#14834F' },
    { label: 'Ryzyko wartości', value: moneyCompact(riskValue), tone: riskValue ? '#BE123C' : '#14834F' },
  ];
  const mobileTabs = [
    { id: 'map', label: 'Mapa', value: rows.length + activeTasks.length, icon: MapOutlined },
    { id: 'decisions', label: 'Decyzje', value: critical.length, icon: AssignmentOutlined },
    { id: 'timeline', label: 'Plan dnia', value: timelineTasks.length, icon: CalendarMonthOutlined },
  ];
  const kpiMarkup = (
    <div style={{ ...S.commandKpis, ...(isNarrow ? S.commandKpisNarrow : null) }}>
      {commandKpis.map((item) => (
        <div key={item.label} style={S.commandKpi}>
          <span style={S.commandKpiLabel}>{item.label}</span>
          <strong style={{ ...S.commandKpiValue, color: item.tone }}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
  const selectedCard = selected && (!isNarrow || selectedTaskId) ? (
    <div style={{ ...S.commandSelected, ...(isNarrow ? S.commandMobileSheet : {}) }}>
      <div style={S.commandSelectedTop}>
        <div>
          <div style={S.commandSelectedLabel}>{isNarrow ? 'Panel akcji' : 'Wybrany temat'}</div>
          <strong>{taskClient(selected)}</strong>
        </div>
        {isNarrow ? (
          <button type="button" style={S.commandSheetClose} onClick={() => onSelectTask?.(null)}>
            Zamknij
          </button>
        ) : null}
      </div>
      <span>{taskAddress(selected)}</span>
      <div style={S.commandSelectedFacts}>
        <Metric label="Status" value={taskStatusLabel(selected.status)} />
        <Metric label="GPS" value={selectedFresh ? `${selectedFresh.label} / ${formatAge(selectedLive.recorded_at)}` : 'brak'} />
        <Metric label="Wartość" value={moneyCompact(plannedValue(selected))} />
        <Metric label="Termin" value={`${taskDateOnly(selected) || 'brak'} ${taskTime(selected)}`} />
      </div>
      <div style={{ ...S.cardActions, ...(isNarrow ? S.commandSheetActions : {}) }}>
        <button type="button" style={S.mapBtn} onClick={() => onOpenPlan(selected)}>
          <CalendarMonthOutlined style={{ fontSize: 16 }} />
          Dopnij plan
        </button>
        {selected.klient_telefon ? (
          <a href={`tel:${selected.klient_telefon}`} style={S.secondaryBtn}>
            <PhoneOutlined style={{ fontSize: 16 }} />
            Zadzwoń
          </a>
        ) : null}
        {mapHref(selectedLive || selected) ? (
          <a href={mapHref(selectedLive || selected)} target="_blank" rel="noreferrer" style={S.secondaryBtn}>
            <NavigationOutlined style={{ fontSize: 16 }} />
            {selectedLive ? 'GPS' : 'Mapa'}
          </a>
        ) : null}
        <button type="button" style={S.secondaryBtn} onClick={() => onOpenTask(selected)}>
          <AssignmentOutlined style={{ fontSize: 16 }} />
          Karta
        </button>
        <button type="button" style={S.secondaryBtn} onClick={() => onCopyLink?.(selected)}>
          <ContentCopyOutlined style={{ fontSize: 16 }} />
          Kopiuj link
        </button>
      </div>
      {copyMessage ? <div style={S.commandCopyMsg}>{copyMessage}</div> : null}
    </div>
  ) : null;

  return (
    <section style={{ ...S.command, ...(isNarrow ? S.commandNarrow : null) }}>
      <div style={{ ...S.commandHeader, ...(isNarrow ? S.panelHeaderNarrow : null) }}>
        <div>
          <div style={S.commandEyebrow}>Dyspozytornia operacyjna</div>
          <h2 style={S.commandTitle}>Mapa decyzji: ekipa, trasa, termin i ryzyko</h2>
          <p style={S.commandSub}>
            Warstwa łączy sygnał live, plan dnia, blokady dispatchu i jakość danych w jednym widoku kierownika.
          </p>
        </div>
        <div style={S.commandStatus}>
          <span style={{ ...S.statusDot, background: stats.offline || stats.stale ? '#B7791F' : '#14834F' }} />
          <span>{stats.online} online / {stats.stale + stats.offline} opóźnione</span>
          <strong>{lastLoadAt ? formatClock(lastLoadAt.toISOString()) : '--:--'}</strong>
        </div>
      </div>

      {isNarrow ? (
        <div style={S.commandTabs} role="tablist" aria-label="Tryb widoku dyspozytorni">
          {mobileTabs.map((tab) => {
            const active = mobileView === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                style={{ ...S.commandTab, ...(active ? S.commandTabActive : {}) }}
                onClick={() => onMobileViewChange?.(tab.id)}
              >
                <span style={S.commandTabLabel}>
                  <TabIcon style={{ fontSize: 15 }} />
                  <span>{tab.label}</span>
                </span>
                <strong>{tab.value}</strong>
              </button>
            );
          })}
        </div>
      ) : null}

      {isNarrow ? kpiMarkup : null}

      {!isNarrow ? kpiMarkup : null}

      {(!isNarrow || mobileView !== 'timeline') ? (
      <div style={{ ...S.commandBody, ...(isNarrow ? S.commandBodyNarrow : null) }}>
        {(!isNarrow || mobileView === 'map') ? (
        <div style={S.commandMapPanel}>
          <div style={S.commandMapTop}>
            <div>
              <strong style={S.commandMapTitle}>Warstwa terenowa</strong>
              <span style={S.commandMapSub}>Trasy są schematyczne, punkty GPS pozostają źródłowe.</span>
            </div>
            <button type="button" style={S.secondaryBtn} onClick={onOpenSchedule}>
              <CalendarMonthOutlined style={{ fontSize: 16 }} />
              Harmonogram
            </button>
          </div>
          <div style={{ ...S.commandMap, ...(isNarrow ? S.commandMapNarrow : null) }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={S.commandRouteLayer} aria-hidden="true">
              {routeLines.map((line) => (
                <line
                  key={line.id}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={line.color}
                  strokeWidth={String(line.id) === String(selected?.id) ? 0.85 : 0.45}
                  strokeDasharray={String(line.id) === String(selected?.id) ? '0' : '2 2'}
                  strokeLinecap="round"
                  opacity={String(line.id) === String(selected?.id) ? 0.92 : 0.5}
                />
              ))}
            </svg>
            <div style={S.commandMapGrid} />
            {rows.slice(0, 18).map((row, index) => {
              const fresh = getFreshness(row);
              const pos = pointPosition(row, bounds);
              const active = selectedLive && String(selectedLive.recorded_at) === String(row.recorded_at);
              const rowTask = activeTasks.find((task) => {
                const live = taskLiveRow(task);
                return live && String(live.recorded_at) === String(row.recorded_at);
              });
              return (
                <a
                  key={`${row.provider}-${row.user_id || row.vehicle_id || row.nr_rejestracyjny}-${index}`}
                  href={mapHref(row)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!rowTask) return;
                    event.preventDefault();
                    onSelectTask?.(rowTask);
                  }}
                  style={{
                    ...S.commandCrewPoint,
                    ...pos,
                    borderColor: fresh.color,
                    color: fresh.color,
                    ...(active ? S.commandCrewPointActive : {}),
                  }}
                  title={`${subjectLabel(row)} / ${fresh.label} / ${formatAge(row.recorded_at)}`}
                >
                  {row.provider === 'juwentus' ? 'A' : 'M'}
                </a>
              );
            })}
            {activeTasks.slice(0, 18).map((task) => {
              const point = taskMapPoint(task);
              if (!point || !bounds) return null;
              const pos = pointPosition(point, bounds);
              const active = String(task.id) === String(selected?.id);
              return (
                <button
                  key={`task-${task.id}`}
                  type="button"
                  onClick={() => onSelectTask?.(task)}
                  style={{
                    ...S.commandTaskPoint,
                    ...pos,
                    borderColor: taskStatusColor(task.status),
                    ...(active ? S.commandTaskPointActive : {}),
                  }}
                  title={`${taskClient(task)} / ${taskStatusLabel(task.status)}`}
                >
                  #{task.id}
                </button>
              );
            })}
            {!rows.length && !activeTasks.some(taskMapPoint) ? (
              <div style={S.emptyRadar}>Brak punktów do narysowania dla filtra</div>
            ) : null}
            <div style={S.commandMapLegend}>
              <span><i style={{ background: '#14834F' }} /> live</span>
              <span><i style={{ background: '#B7791F' }} /> opóźnione</span>
              <span><i style={{ background: '#BE123C' }} /> blokada</span>
              <span><i style={{ background: '#2563EB' }} /> wybrana trasa</span>
            </div>
          </div>
        </div>
        ) : null}

        {(!isNarrow || mobileView === 'decisions') ? (
        <aside style={S.commandQueue}>
          <div style={S.commandQueueHead}>
            <strong>Następne decyzje</strong>
            <span>{critical.length || 0} tematów</span>
          </div>
          {critical.length ? critical.map(({ task, tone, reason }) => {
            const active = String(task.id) === String(selected?.id);
            return (
              <button
                key={task.id}
                type="button"
                aria-pressed={active}
                style={{
                  ...S.commandDecision,
                  ...(active ? S.commandDecisionActive : {}),
                }}
                onClick={() => onSelectTask?.(task)}
              >
                <span style={{ ...S.commandDecisionRail, background: tone }} />
                <span style={S.commandDecisionBody}>
                  <span style={S.commandDecisionTitleRow}>
                    <strong>{taskClient(task)}</strong>
                    {active ? <span style={S.commandSelectedBadge}>Wybrane</span> : null}
                  </span>
                  <small>{reason}</small>
                  <span>{taskTime(task)} / {task.ekipa_nazwa || 'bez ekipy'} / {branchName(task.oddzial_id)}</span>
                </span>
              </button>
            );
          }) : (
            <div style={S.commandEmpty}>Nie widzę krytycznych blokad w aktualnym filtrze.</div>
          )}

          {!isNarrow ? selectedCard : null}
        </aside>
        ) : null}
      </div>
      ) : null}

      {isNarrow ? selectedCard : null}

      {(!isNarrow || mobileView === 'timeline') ? (
      <div style={{ ...S.commandTimeline, ...(isNarrow ? S.commandTimelineNarrow : {}) }}>
        <div style={S.commandTimelineHead}>
          <strong>Plan dnia ekip</strong>
          <span>{PLANNING_DAY_LABEL}</span>
        </div>
        <div style={S.commandTimelineRows}>
          {timelineTasks.length ? timelineTasks.map((task) => {
            const range = planRangeMinutes({
              godzina_rozpoczecia: task.godzina_rozpoczecia,
              czas_planowany_godziny: task.czas_planowany_godziny || task.czas_realizacji_godz,
            }, task);
            const risky = !taskLiveRow(task) || problemTasks.some((row) => String(row.id) === String(task.id));
            return (
              <button
                key={task.id}
                type="button"
                style={{
                  ...S.commandTimelineRow,
                  ...(isNarrow ? S.commandTimelineRowNarrow : {}),
                  ...(String(task.id) === String(selected?.id) ? S.commandTimelineRowActive : {}),
                }}
                onClick={() => onSelectTask?.(task)}
              >
                <span style={{ ...S.commandTimelineTeam, ...(isNarrow ? S.commandTimelineTeamNarrow : {}) }}>
                  {task.ekipa_nazwa || 'Bez ekipy'}
                </span>
                <span style={S.commandTimelineTrack}>
                  <span
                    style={{
                      ...S.commandTimelineBlock,
                      ...timelineBlockStyle(range),
                      background: risky ? 'rgba(190,18,60,0.18)' : 'rgba(37,99,235,0.16)',
                      borderColor: risky ? 'rgba(190,18,60,0.34)' : 'rgba(37,99,235,0.32)',
                      color: risky ? '#9F1239' : '#1D4ED8',
                    }}
                  >
                    {taskTime(task)} #{task.id}
                  </span>
                </span>
              </button>
            );
          }) : (
            <div style={S.commandEmpty}>Brak zleceń w planie dnia dla tego filtra.</div>
          )}
        </div>
      </div>
      ) : null}
    </section>
  );
}

const glass = {
  background: 'rgba(255,255,255,0.88)',
  border: '1px solid rgba(20,131,79,0.14)',
  boxShadow: '0 18px 44px rgba(15,95,58,0.1)',
  backdropFilter: 'blur(14px)',
};

const S = {
  main: {
    padding: 28,
    minHeight: '100vh',
    background: 'linear-gradient(135deg, rgba(246,251,247,0.96), rgba(255,255,255,0.9) 44%, rgba(229,246,236,0.78))',
  },
  mainNarrow: {
    padding: 12,
    overflowX: 'hidden',
  },
  fullWidth: {
    width: '100%',
    minWidth: 0,
  },
  fullWidthButton: {
    width: '100%',
    justifyContent: 'center',
  },
  hero: {
    ...glass,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 8,
    padding: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 14,
    background: 'linear-gradient(135deg, #0B3825 0%, #0F5F3A 58%, #168A4A 100%)',
    border: '1px solid rgba(15,95,58,0.18)',
    boxShadow: '0 22px 46px rgba(11,56,37,0.18)',
  },
  heroNarrow: {
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
  },
  heroCopy: {
    flex: '1 1 360px',
    minWidth: 220,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 8,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(255,255,255,0.12)',
    color: '#DFF7E8',
    border: '1px solid rgba(255,255,255,0.22)',
  },
  heroIconNarrow: {
    width: 44,
    height: 44,
  },
  eyebrow: {
    color: '#86EFAC',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0,
    fontWeight: 950,
  },
  titleNarrow: {
    fontSize: 22,
    lineHeight: 1.12,
  },
  title: {
    margin: '4px 0',
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 1.15,
    fontWeight: 950,
  },
  subtitle: {
    margin: 0,
    color: 'rgba(240,253,244,0.78)',
    fontSize: 13,
    maxWidth: 820,
    lineHeight: 1.45,
    fontWeight: 700,
  },
  refreshBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(255,255,255,0.28)',
    background: '#FFFFFF',
    color: '#0F5F3A',
    borderRadius: 8,
    padding: '11px 14px',
    fontWeight: 950,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: '0 16px 34px rgba(0,0,0,0.14)',
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    border: '1px solid rgba(190,18,60,0.22)',
    background: 'rgba(254,226,226,0.72)',
    color: '#BE123C',
    fontWeight: 700,
  },
  toolbar: {
    ...glass,
    borderRadius: 8,
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  toolbarNarrow: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 10,
    padding: 12,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    minWidth: 190,
  },
  label: {
    color: 'var(--text-muted)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0,
    fontWeight: 950,
  },
  select: {
    background: '#fff',
    color: 'var(--text)',
    border: '1px solid rgba(20,131,79,0.16)',
    borderRadius: 8,
    padding: '10px 12px',
    outline: 'none',
    boxShadow: '0 10px 24px rgba(15,95,58,0.06)',
  },
  lastSync: {
    marginLeft: 'auto',
    color: 'var(--text-muted)',
    fontSize: 13,
    border: '1px solid rgba(20,131,79,0.14)',
    borderRadius: 8,
    background: 'rgba(240,247,242,0.78)',
    padding: '8px 10px',
  },
  lastSyncNarrow: {
    marginLeft: 0,
    width: '100%',
    overflowWrap: 'anywhere',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    gap: 12,
    marginBottom: 14,
  },
  kpiCard: {
    ...glass,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 8,
    padding: '14px 14px 14px 17px',
    minHeight: 118,
    background: '#FFFFFF',
    border: '1px solid rgba(15,95,58,0.13)',
    boxShadow: '0 12px 26px rgba(15,95,58,0.06)',
  },
  kpiGlow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    opacity: 0.82,
  },
  kpiLabel: {
    color: 'var(--text-muted)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0,
    fontWeight: 950,
  },
  kpiValue: {
    marginTop: 8,
    fontSize: 26,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  command: {
    ...glass,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    background: '#F8FAF9',
    border: '1px solid rgba(37,99,235,0.12)',
    boxShadow: '0 18px 42px rgba(15,35,58,0.08)',
  },
  commandNarrow: {
    padding: 12,
  },
  commandHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 12,
  },
  commandEyebrow: {
    color: '#2563EB',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0,
    fontWeight: 950,
  },
  commandTitle: {
    margin: '4px 0 0',
    color: '#111827',
    fontSize: 22,
    lineHeight: 1.12,
    fontWeight: 950,
  },
  commandSub: {
    margin: '5px 0 0',
    color: '#64748B',
    fontSize: 12,
    lineHeight: 1.45,
    fontWeight: 700,
    maxWidth: 760,
  },
  commandStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(15,23,42,0.1)',
    background: '#FFFFFF',
    borderRadius: 8,
    padding: '8px 10px',
    color: '#334155',
    fontSize: 12,
    fontWeight: 850,
    whiteSpace: 'nowrap',
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: '50%',
    boxShadow: '0 0 0 4px rgba(20,131,79,0.12)',
  },
  commandTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 6,
    margin: '0 0 10px',
    padding: 4,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.08)',
    background: '#FFFFFF',
  },
  commandTab: {
    minWidth: 0,
    minHeight: 42,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 6,
    border: '1px solid transparent',
    borderRadius: 8,
    background: 'transparent',
    color: '#475569',
    padding: '7px 8px',
    fontSize: 11,
    fontWeight: 900,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  commandTabActive: {
    borderColor: 'rgba(37,99,235,0.28)',
    background: '#EFF6FF',
    color: '#1D4ED8',
    boxShadow: '0 8px 18px rgba(37,99,235,0.08)',
  },
  commandTabLabel: {
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  commandKpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  commandKpisNarrow: {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    marginBottom: 10,
  },
  commandKpi: {
    border: '1px solid rgba(15,23,42,0.08)',
    background: '#FFFFFF',
    borderRadius: 8,
    padding: 11,
    minHeight: 70,
  },
  commandKpiLabel: {
    display: 'block',
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0,
    fontWeight: 950,
  },
  commandKpiValue: {
    display: 'block',
    marginTop: 8,
    fontSize: 20,
    lineHeight: 1,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
  },
  commandBody: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.45fr) minmax(300px, 0.55fr)',
    gap: 12,
    alignItems: 'stretch',
  },
  commandBodyNarrow: {
    gridTemplateColumns: '1fr',
  },
  commandMapPanel: {
    minWidth: 0,
    border: '1px solid rgba(15,23,42,0.08)',
    background: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
  },
  commandMapTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
    color: '#111827',
    fontSize: 13,
    fontWeight: 900,
  },
  commandMapTitle: {
    display: 'block',
    color: '#111827',
    fontSize: 13,
    lineHeight: 1.25,
  },
  commandMapSub: {
    display: 'block',
    color: '#64748B',
    fontSize: 11,
    lineHeight: 1.35,
    marginTop: 2,
    fontWeight: 750,
  },
  commandMap: {
    position: 'relative',
    minHeight: 390,
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid rgba(37,99,235,0.12)',
    background: 'linear-gradient(135deg, #F8FAFC, #ECFDF5 48%, #EFF6FF)',
  },
  commandMapNarrow: {
    minHeight: 340,
  },
  commandMapGrid: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(rgba(15,23,42,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.055) 1px, transparent 1px)',
    backgroundSize: '48px 48px',
    maskImage: 'radial-gradient(circle at 50% 50%, black, transparent 82%)',
  },
  commandRouteLayer: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 1,
  },
  commandCrewPoint: {
    position: 'absolute',
    zIndex: 3,
    transform: 'translate(-50%, -50%)',
    width: 32,
    height: 32,
    borderRadius: 8,
    border: '2px solid currentColor',
    display: 'grid',
    placeItems: 'center',
    background: '#FFFFFF',
    color: '#14834F',
    textDecoration: 'none',
    fontSize: 11,
    fontWeight: 950,
    boxShadow: '0 10px 22px rgba(15,23,42,0.12)',
  },
  commandCrewPointActive: {
    width: 40,
    height: 40,
    borderColor: '#2563EB',
    color: '#2563EB',
    boxShadow: '0 0 0 5px rgba(37,99,235,0.12), 0 14px 28px rgba(37,99,235,0.18)',
  },
  commandTaskPoint: {
    position: 'absolute',
    zIndex: 4,
    transform: 'translate(-50%, -50%)',
    minWidth: 42,
    height: 25,
    borderRadius: 8,
    border: '1px solid currentColor',
    display: 'grid',
    placeItems: 'center',
    background: '#111827',
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 950,
    cursor: 'pointer',
  },
  commandTaskPointActive: {
    background: '#2563EB',
    boxShadow: '0 0 0 5px rgba(37,99,235,0.14), 0 16px 30px rgba(37,99,235,0.18)',
  },
  commandMapLegend: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    zIndex: 5,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    border: '1px solid rgba(15,23,42,0.08)',
    background: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    padding: '8px 9px',
    color: '#334155',
    fontSize: 11,
    fontWeight: 850,
  },
  commandQueue: {
    minWidth: 0,
    border: '1px solid rgba(15,23,42,0.08)',
    background: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  commandQueueHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    color: '#111827',
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 2,
  },
  commandDecision: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '3px minmax(0, 1fr)',
    gap: 9,
    border: '1px solid rgba(15,23,42,0.08)',
    background: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    color: '#111827',
    textAlign: 'left',
    cursor: 'pointer',
  },
  commandDecisionActive: {
    borderColor: 'rgba(37,99,235,0.3)',
    background: '#EFF6FF',
    boxShadow: '0 10px 24px rgba(37,99,235,0.08)',
  },
  commandDecisionRail: {
    width: 3,
    borderRadius: 8,
  },
  commandDecisionBody: {
    minWidth: 0,
    display: 'grid',
    gap: 3,
  },
  commandDecisionTitleRow: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commandSelectedBadge: {
    flex: '0 0 auto',
    border: '1px solid rgba(37,99,235,0.22)',
    background: '#FFFFFF',
    color: '#1D4ED8',
    borderRadius: 8,
    padding: '3px 6px',
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  commandSelected: {
    marginTop: 4,
    border: '1px solid rgba(37,99,235,0.18)',
    background: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
    color: '#111827',
  },
  commandMobileSheet: {
    position: 'sticky',
    bottom: 10,
    zIndex: 20,
    marginTop: 12,
    boxShadow: '0 -18px 38px rgba(15,23,42,0.18)',
  },
  commandSelectedTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 3,
  },
  commandSelectedLabel: {
    color: '#2563EB',
    fontSize: 10,
    textTransform: 'uppercase',
    fontWeight: 950,
    marginBottom: 5,
  },
  commandSheetClose: {
    border: '1px solid rgba(37,99,235,0.18)',
    background: '#FFFFFF',
    color: '#1D4ED8',
    borderRadius: 8,
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 900,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  commandSelectedFacts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 9,
    marginTop: 10,
  },
  commandSheetActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  commandCopyMsg: {
    marginTop: 8,
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: 900,
  },
  commandEmpty: {
    border: '1px dashed rgba(15,23,42,0.14)',
    borderRadius: 8,
    color: '#64748B',
    padding: 12,
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'center',
  },
  commandTimeline: {
    marginTop: 12,
    border: '1px solid rgba(15,23,42,0.08)',
    background: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
  },
  commandTimelineNarrow: {
    marginTop: 0,
  },
  commandTimelineHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    color: '#111827',
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 9,
  },
  commandTimelineRows: {
    display: 'grid',
    gap: 7,
  },
  commandTimelineRow: {
    display: 'grid',
    gridTemplateColumns: '150px minmax(0, 1fr)',
    gap: 10,
    alignItems: 'center',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
  },
  commandTimelineRowNarrow: {
    gridTemplateColumns: '1fr',
    gap: 5,
    padding: '2px 0',
  },
  commandTimelineRowActive: {
    filter: 'drop-shadow(0 8px 16px rgba(37,99,235,0.12))',
  },
  commandTimelineTeam: {
    color: '#475569',
    fontSize: 11,
    fontWeight: 900,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  commandTimelineTeamNarrow: {
    whiteSpace: 'normal',
    lineHeight: 1.2,
  },
  commandTimelineTrack: {
    position: 'relative',
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    background: '#F1F5F9',
    border: '1px solid rgba(15,23,42,0.07)',
  },
  commandTimelineBlock: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 6,
    border: '1px solid rgba(37,99,235,0.24)',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap',
    minWidth: 72,
  },
  officeLivePanel: {
    ...glass,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
  },
  officeLiveStamp: {
    borderRadius: 8,
    border: '1px solid rgba(20,131,79,0.18)',
    background: 'rgba(240,247,242,0.9)',
    color: '#14834F',
    padding: '7px 10px',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  officeLiveGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
    gap: 10,
  },
  officeLiveColumn: {
    borderRadius: 8,
    border: '1px solid rgba(20,131,79,0.14)',
    background: 'rgba(255,255,255,0.76)',
    padding: 12,
    minHeight: 214,
    boxShadow: '0 12px 28px rgba(15,95,58,0.06)',
  },
  officeLiveColumnHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  panelHeaderNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  officeLiveTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
  },
  officeLiveSub: {
    color: 'var(--text-muted)',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 1.35,
  },
  officeLiveCount: {
    minWidth: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid rgba(20,131,79,0.14)',
    display: 'inline-grid',
    placeItems: 'center',
    fontSize: 14,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
  },
  officeLiveList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  officeLiveTask: {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 9,
    border: '1px solid rgba(20,131,79,0.12)',
    background: 'rgba(246,251,247,0.78)',
    color: 'var(--text)',
    borderRadius: 8,
    padding: 10,
    textAlign: 'left',
    cursor: 'pointer',
  },
  officeLiveDot: {
    flex: '0 0 auto',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginTop: 6,
  },
  officeLiveTaskTitle: {
    display: 'block',
    fontSize: 12,
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  officeLiveTaskMeta: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 11,
    marginTop: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  officeLiveTaskFooter: {
    display: 'block',
    color: '#34493B',
    fontSize: 11,
    fontWeight: 800,
    marginTop: 5,
    lineHeight: 1.35,
  },
  officeLiveEmpty: {
    borderRadius: 8,
    border: '1px dashed rgba(20,131,79,0.18)',
    color: 'var(--text-muted)',
    padding: 12,
    fontSize: 12,
    lineHeight: 1.45,
  },
  dispatchPanel: {
    ...glass,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
  },
  queueSection: {
    borderRadius: 8,
    border: '1px solid rgba(183,121,31,0.18)',
    background: 'rgba(255,251,235,0.72)',
    padding: 12,
    marginBottom: 12,
  },
  queueHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  queueTitle: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 900,
  },
  queueList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 10,
  },
  quickPlanGridNarrow: {
    gridTemplateColumns: '1fr',
  },
  planningCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid rgba(20,131,79,0.12)',
    background: 'rgba(255,255,255,0.82)',
    padding: 13,
    boxShadow: '0 10px 24px rgba(15,95,58,0.06)',
  },
  planningTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  missingRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  missingPill: {
    borderRadius: 8,
    border: '1px solid rgba(183,121,31,0.24)',
    background: 'rgba(255,251,235,0.86)',
    color: '#B7791F',
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900,
  },
  quickPlanPanel: {
    borderRadius: 8,
    border: '1px solid rgba(20,131,79,0.18)',
    background: 'rgba(240,247,242,0.72)',
    padding: 12,
    marginBottom: 12,
  },
  quickPlanReadiness: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    border: '1px solid rgba(20,131,79,0.14)',
    background: 'rgba(255,255,255,0.82)',
    padding: '10px 12px',
    marginBottom: 12,
  },
  quickPlanReadyDot: {
    flex: '0 0 auto',
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  quickPlanGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
  },
  quickPlanHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  quickPlanField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  quickPlanInput: {
    background: '#fff',
    color: 'var(--text)',
    border: '1px solid rgba(20,131,79,0.16)',
    borderRadius: 8,
    padding: '10px 12px',
    outline: 'none',
    minHeight: 40,
  },
  quickPlanMultiSelect: {
    minHeight: 120,
    resize: 'vertical',
  },
  quickPlanHint: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.35,
  },
  quickPlanActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 7,
  },
  tinyBtn: {
    borderRadius: 999,
    border: '1px solid rgba(20,131,79,0.16)',
    background: 'rgba(255,255,255,0.78)',
    color: 'var(--text)',
    padding: '6px 9px',
    fontSize: 11,
    fontWeight: 900,
    cursor: 'pointer',
  },
  quickSlotPanel: {
    marginTop: 12,
    borderRadius: 14,
    border: '1px solid rgba(20,131,79,0.18)',
    background: 'rgba(240,247,242,0.8)',
    padding: 12,
  },
  quickSlotHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
    color: 'var(--text)',
    fontSize: 12,
  },
  quickSlotList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickSlotBtn: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    borderRadius: 13,
    border: '1px solid rgba(20,131,79,0.2)',
    background: '#fff',
    color: '#102218',
    padding: '8px 11px',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
    minWidth: 74,
  },
  quickSlotBtnActive: {
    borderColor: '#14834F',
    background: 'rgba(20,131,79,0.1)',
    boxShadow: '0 10px 24px rgba(20,131,79,0.1)',
  },
  quickSlotEmpty: {
    borderRadius: 12,
    border: '1px dashed rgba(20,131,79,0.18)',
    color: 'var(--text-muted)',
    padding: 10,
    fontSize: 12,
    fontWeight: 800,
  },
  quickTimelinePanel: {
    marginTop: 12,
    borderRadius: 14,
    border: '1px solid rgba(20,131,79,0.14)',
    background: 'rgba(255,255,255,0.76)',
    padding: 12,
  },
  quickTimelineHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    color: 'var(--text)',
    fontSize: 12,
    marginBottom: 10,
  },
  quickTimelineTrack: {
    position: 'relative',
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    border: '1px solid rgba(20,131,79,0.14)',
    background: 'linear-gradient(90deg, rgba(20,131,79,0.06), rgba(14,116,144,0.05))',
  },
  quickTimelineTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    background: 'rgba(20,131,79,0.12)',
  },
  quickTimelineBusy: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 10,
    background: 'rgba(183,121,31,0.18)',
    border: '1px solid rgba(183,121,31,0.34)',
    color: '#6B4E16',
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  quickTimelineSelected: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 11,
    background: 'rgba(20,131,79,0.2)',
    border: '1px solid rgba(20,131,79,0.38)',
    color: '#0F5F3A',
    boxShadow: '0 10px 22px rgba(20,131,79,0.12)',
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  quickTimelineHours: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 4,
    marginTop: 6,
    color: 'var(--text-muted)',
    fontSize: 9,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  quickTimelineLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
  },
  quickTimelineDot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 6,
    verticalAlign: 'middle',
  },
  quickPlanError: {
    marginTop: 10,
    borderRadius: 12,
    border: '1px solid rgba(190,18,60,0.22)',
    background: 'rgba(254,226,226,0.7)',
    color: '#BE123C',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  quickPlanWarn: {
    marginTop: 10,
    borderRadius: 12,
    border: '1px solid rgba(183,121,31,0.24)',
    background: 'rgba(255,251,235,0.76)',
    color: '#B7791F',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  quickPlanInfo: {
    marginTop: 10,
    borderRadius: 12,
    border: '1px solid rgba(14,116,144,0.2)',
    background: 'rgba(236,253,245,0.72)',
    color: '#0E7490',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  quickPlanConflictList: {
    margin: '6px 0 0 18px',
    padding: 0,
    color: 'inherit',
    lineHeight: 1.55,
  },
  quickPlanOk: {
    marginTop: 10,
    borderRadius: 12,
    border: '1px solid rgba(20,131,79,0.22)',
    background: 'rgba(220,252,231,0.7)',
    color: '#14834F',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  alertStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  alertCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    border: '1px solid rgba(20,131,79,0.14)',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.78)',
    color: 'var(--text)',
    padding: 12,
    fontSize: 13,
    fontWeight: 800,
  },
  dispatchList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: 10,
  },
  dispatchCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 14,
    border: '1px solid rgba(20,131,79,0.12)',
    background: 'rgba(255,255,255,0.84)',
    padding: 14,
    boxShadow: '0 12px 28px rgba(15,95,58,0.06)',
  },
  dispatchTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  dispatchIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(20,131,79,0.1)',
    color: '#14834F',
    border: '1px solid rgba(20,131,79,0.18)',
    flexShrink: 0,
  },
  dispatchTitle: {
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 900,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dispatchMeta: {
    color: 'var(--text-muted)',
    fontSize: 12,
    marginTop: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dispatchFacts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: 14,
    alignItems: 'start',
  },
  gridNarrow: {
    gridTemplateColumns: '1fr',
  },
  radarPanel: {
    ...glass,
    borderRadius: 8,
    padding: 16,
    minHeight: 540,
  },
  radarPanelNarrow: {
    padding: 12,
    minHeight: 'auto',
  },
  listPanel: {
    ...glass,
    borderRadius: 8,
    padding: 16,
  },
  panelNarrow: {
    padding: 12,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  panelTitle: {
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
  },
  panelSub: {
    color: 'var(--text-muted)',
    fontSize: 12,
    marginTop: 2,
  },
  radar: {
    position: 'relative',
    height: 470,
    overflow: 'hidden',
    borderRadius: 14,
    background: 'radial-gradient(circle at center, rgba(20,131,79,0.12), rgba(255,255,255,0.92) 58%), linear-gradient(135deg, rgba(236,253,245,0.82), rgba(240,249,255,0.72))',
    border: '1px solid rgba(20,131,79,0.14)',
  },
  radarNarrow: {
    height: 320,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    background: 'rgba(20,131,79,0.12)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    background: 'rgba(20,131,79,0.12)',
  },
  radarCircleLarge: {
    position: 'absolute',
    inset: '12%',
    borderRadius: '50%',
    border: '1px solid rgba(20,131,79,0.16)',
  },
  radarCircleSmall: {
    position: 'absolute',
    inset: '31%',
    borderRadius: '50%',
    border: '1px solid rgba(20,131,79,0.18)',
  },
  radarPoint: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: '2px solid currentColor',
    display: 'grid',
    placeItems: 'center',
    color: '#0E7490',
    background: '#fff',
    textDecoration: 'none',
    fontWeight: 900,
    boxShadow: '0 8px 18px rgba(15,95,58,0.12)',
  },
  emptyRadar: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    color: 'var(--text-muted)',
    fontWeight: 800,
  },
  locationList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxHeight: 700,
    overflow: 'auto',
    paddingRight: 2,
  },
  locationCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 14,
    border: '1px solid rgba(20,131,79,0.12)',
    background: 'rgba(255,255,255,0.82)',
    padding: 14,
    boxShadow: '0 10px 24px rgba(15,95,58,0.06)',
  },
  statusRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  locationTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  locationTopNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  locationName: {
    color: 'var(--text)',
    fontSize: 15,
    fontWeight: 900,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  locationMeta: {
    color: 'var(--text-muted)',
    fontSize: 12,
    marginTop: 3,
  },
  badge: {
    border: '1px solid currentColor',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 900,
    background: 'rgba(255,255,255,0.78)',
    whiteSpace: 'nowrap',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  detailsGridNarrow: {
    gridTemplateColumns: '1fr',
  },
  metricLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 800,
  },
  metricValue: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 800,
    marginTop: 3,
    fontVariantNumeric: 'tabular-nums',
  },
  cardActions: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  cardActionsNarrow: {
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  mapBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    border: '1px solid rgba(20,131,79,0.24)',
    background: '#14834F',
    color: '#fff',
    textDecoration: 'none',
    padding: '8px 10px',
    fontWeight: 900,
    fontSize: 12,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    border: '1px solid rgba(20,131,79,0.16)',
    background: 'rgba(255,255,255,0.82)',
    color: 'var(--text)',
    padding: '8px 10px',
    fontWeight: 800,
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'none',
    fontFamily: 'inherit',
  },
  historyPanel: {
    ...glass,
    borderRadius: 8,
    padding: 16,
    marginTop: 14,
  },
  historySummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    gap: 10,
    border: '1px solid rgba(20,131,79,0.12)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.82)',
    padding: 12,
    marginBottom: 12,
  },
  historyRouteStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    border: '1px solid rgba(20,131,79,0.12)',
    borderRadius: 8,
    background: 'linear-gradient(90deg, rgba(236,253,245,0.86), rgba(240,249,255,0.78))',
    padding: '10px 12px',
    overflowX: 'auto',
    marginBottom: 10,
  },
  historyRouteDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#14834F',
    border: '1px solid rgba(15,95,58,0.22)',
    flex: '0 0 auto',
  },
  historyTimeline: {
    display: 'grid',
    gap: 8,
    maxHeight: 360,
    overflow: 'auto',
    paddingRight: 2,
  },
  historyPoint: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid rgba(20,131,79,0.12)',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.84)',
    padding: 10,
    minWidth: 0,
  },
  historyPointNarrow: {
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  historyPointDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flex: '0 0 auto',
  },
  historyPointTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
  },
  historyPointMeta: {
    color: 'var(--text-muted)',
    fontSize: 12,
    marginTop: 2,
    overflowWrap: 'anywhere',
  },
  emptyList: {
    borderRadius: 14,
    border: '1px dashed rgba(20,131,79,0.18)',
    color: 'var(--text-muted)',
    padding: 20,
    textAlign: 'center',
    fontWeight: 700,
  },
};
