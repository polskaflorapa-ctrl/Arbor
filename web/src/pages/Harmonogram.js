import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import Sidebar from '../components/Sidebar';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import TodayOutlined from '@mui/icons-material/TodayOutlined';
import { TASK_STATUS_COLORS } from '../utils/taskWorkflow';

const STATUS_KOLOR = TASK_STATUS_COLORS;

const DNI_KROTKO = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
const MIESIACE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const GODZINY = Array.from({ length: 13 }, (_, i) => i + 6); // 6:00 - 18:00
const TIME_COL_WIDTH = 68;
const HOUR_SLOT_HEIGHT = 64;
const DAY_HEADER_HEIGHT = 64;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 19;
const GPS_ONLINE_MINUTES = 5;
const GPS_STALE_MINUTES = 20;
const PHOTO_EVIDENCE_TYPES = [
  { key: 'wycena', label: 'Wycena' },
  { key: 'szkic', label: 'Szkic' },
  { key: 'dojazd', label: 'Dojazd' },
  { key: 'przed', label: 'Przed' },
  { key: 'po', label: 'Po' },
  { key: 'inne', label: 'Inne' },
];

function photoEvidenceKey(typ) {
  const value = String(typ || '').trim().toLowerCase();
  if (['wycena', 'valuation', 'oględziny', 'ogledziny'].includes(value)) return 'wycena';
  if (['szkic', 'sketch', 'rysunek'].includes(value)) return 'szkic';
  if (['dojazd', 'posesja', 'dojazd_posesja', 'access'].includes(value)) return 'dojazd';
  if (['checkin', 'check_in', 'dojechali'].includes(value)) return 'dojazd';
  if (['przed', 'before'].includes(value)) return 'przed';
  if (['po', 'after'].includes(value)) return 'po';
  return 'inne';
}

function isCheckinWorkLog(log) {
  const status = String(log?.status || '').toLowerCase();
  return status === 'check_in' || status === 'check-in' || status.includes('check');
}

function isOpenWorkLog(log) {
  if (!log || isCheckinWorkLog(log)) return false;
  if (log.end_time) return false;
  const status = String(log.status || '').toLowerCase();
  return Boolean(log.start_time) || status.includes('aktywn') || status.includes('start');
}

function getLogTimestamp(log, field = 'start_time') {
  const ts = new Date(log?.[field] || log?.start_time || log?.created_at || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function latestByTimestamp(items, field = 'start_time') {
  return [...items].sort((a, b) => getLogTimestamp(b, field) - getLogTimestamp(a, field))[0] || null;
}

function formatClock(raw) {
  if (!raw) return '-';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function formatElapsed(raw) {
  if (!raw) return '-';
  const dt = new Date(raw).getTime();
  if (!Number.isFinite(dt)) return '-';
  const minutes = Math.max(0, Math.round((Date.now() - dt) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function getWorkTelemetry(logs = []) {
  const checkin = latestByTimestamp(logs.filter(isCheckinWorkLog));
  const active = latestByTimestamp(logs.filter(isOpenWorkLog));
  const finished = latestByTimestamp(logs.filter((log) => !isCheckinWorkLog(log) && log?.end_time), 'end_time');

  if (active) {
    return {
      key: 'active',
      label: 'Praca trwa',
      detail: `start ${formatClock(active.start_time)} / ${formatElapsed(active.start_time)}`,
      tone: 'ok',
      checkin,
      active,
      finished,
    };
  }
  if (finished) {
    return {
      key: 'finished',
      label: 'Praca zamknieta',
      detail: `koniec ${formatClock(finished.end_time)}`,
      tone: 'ok',
      checkin,
      active,
      finished,
    };
  }
  if (checkin) {
    return {
      key: 'arrived',
      label: 'Dojechali',
      detail: `${formatClock(checkin.start_time)} / ${formatElapsed(checkin.start_time)} temu`,
      tone: 'warn',
      checkin,
      active,
      finished,
    };
  }
  return {
    key: 'missing',
    label: 'Brak potwierdzenia',
    detail: 'czekamy na check-in z mobilki',
    tone: 'danger',
    checkin,
    active,
    finished,
  };
}

function formatBlockTime(z) {
  if (z.godzina_rozpoczecia) return String(z.godzina_rozpoczecia).slice(0, 5);
  if (z.data_planowana) {
    try {
      const dt = new Date(z.data_planowana);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      }
    } catch {
      /* ignore */
    }
  }
  return '08:00';
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function visibleDateRange(date, view) {
  if (view === 'miesiac') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { from: toISODate(start), to: toISODate(end) };
  }
  if (view === 'tydzien') {
    const start = weekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  const day = toISODate(date);
  return { from: day, to: day };
}

function dateFromRouteParam(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function routeDateFromSearch(search) {
  return dateFromRouteParam(new URLSearchParams(search || '').get('date'));
}

function routeViewFromSearch(search) {
  const view = String(new URLSearchParams(search || '').get('view') || '').trim();
  return ['dzien', 'tydzien', 'miesiac'].includes(view) ? view : '';
}

function routeParam(search, key) {
  return String(new URLSearchParams(search || '').get(key) || '').trim();
}

function routeHasParam(search, key) {
  return new URLSearchParams(search || '').has(key);
}

function isActiveReservation(row) {
  const status = String(row?.status || '').toLowerCase();
  return !status.includes('anul') && !status.includes('zwr');
}

function taskPhotoCount(task) {
  return Number(task?.photo_total || task?.photos_count || task?.zdjecia_count || 0) || 0;
}

function taskHasWorkBrief(task) {
  return Boolean(String(task?.opis_pracy || task?.opis || task?.wynik || task?.notatki_wewnetrzne || '').trim());
}

function taskDayKey(task) {
  const raw = task?.data_planowana;
  if (!raw) return '';
  if (typeof raw === 'string' && raw.length >= 10) return raw.slice(0, 10);
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? '' : toISODate(dt);
}

function taskStartMinutes(task) {
  if (task?.godzina_rozpoczecia) {
    const [h, m] = String(task.godzina_rozpoczecia).split(':').map(Number);
    if (Number.isFinite(h)) return (h * 60) + (Number.isFinite(m) ? m : 0);
  }
  if (task?.data_planowana) {
    const dt = new Date(task.data_planowana);
    if (!Number.isNaN(dt.getTime())) return (dt.getHours() * 60) + dt.getMinutes();
  }
  return 8 * 60;
}

function taskDurationMinutes(task) {
  const hours = Number(task?.czas_planowany_godziny || task?.czas_realizacji_godz || 1);
  return Math.max(15, Math.round((Number.isFinite(hours) ? hours : 1) * 60));
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function formatMinutesAsHours(minutes) {
  const value = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}h`;
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function taskPlanDateObject(task, fallbackDate) {
  const dt = task?.data_planowana ? new Date(task.data_planowana) : null;
  return dt && !Number.isNaN(dt.getTime()) ? dt : fallbackDate;
}

function clampPlanHour(task) {
  const hour = Math.floor(taskStartMinutes(task) / 60);
  if (!Number.isFinite(hour)) return 8;
  return Math.min(18, Math.max(6, hour));
}

function taskRiskReady(task) {
  const raw = String([
    task?.notatki_wewnetrzne,
    task?.notatki,
    task?.opis,
    task?.opis_pracy,
    task?.wynik,
    task?.ryzyka,
  ].filter(Boolean).join('\n')).toLowerCase();
  return /ryzyk|bhp|zgod|linie|ogrodzenie|dach|elewac|trudny dojazd|ruch pieszy|brak szczegolnych/.test(raw);
}

function taskHasEquipment(task) {
  const directCount = Number(task?.equipment_reserved_count || task?.sprzet_count || 0) || 0;
  const names = String(task?.equipment_reserved_names || '').trim();
  const flags = [
    'rebak',
    'pila_wysiegniku',
    'nozyce_dlugie',
    'kosiarka',
    'podkaszarka',
    'lopata',
    'mulczer',
    'arborysta',
  ];
  const hasFlag = flags.some((key) => Boolean(task?.[key]));
  const explicitNoEquipment = /bez dodatkowego|brak sprzetu|nie dotyczy/.test(String(task?.sprzet_notatka || '').toLowerCase());
  return directCount > 0 || Boolean(names) || hasFlag || explicitNoEquipment;
}

function getCrewPackageReadiness(task) {
  const missingLabels = Array.isArray(task?.crew_execution_missing_labels)
    ? task.crew_execution_missing_labels.map((label) => String(label || '').trim()).filter(Boolean)
    : [];
  const totalCountRaw = Number(task?.crew_execution_total_count);
  const readyCountRaw = Number(task?.crew_execution_ready_count);
  const hasApiReadiness = typeof task?.crew_execution_ready === 'boolean' || Number.isFinite(totalCountRaw) || Number.isFinite(readyCountRaw);

  if (hasApiReadiness) {
    const totalCount = Number.isFinite(totalCountRaw) && totalCountRaw > 0
      ? totalCountRaw
      : Math.max(missingLabels.length + (Number.isFinite(readyCountRaw) ? readyCountRaw : 0), 1);
    const readyCount = Number.isFinite(readyCountRaw)
      ? readyCountRaw
      : Math.max(0, totalCount - missingLabels.length);
    return {
      ready: typeof task?.crew_execution_ready === 'boolean' ? task.crew_execution_ready : missingLabels.length === 0,
      readyCount,
      totalCount,
      missingLabels,
    };
  }

  const hasMoney = task?.wartosc_planowana != null || task?.budzet != null || task?.kwota_minimalna != null;
  const hasTime = task?.data_planowana && taskDurationMinutes(task) > 0;
  const checks = [
    { label: 'Adres', ready: Boolean(String(task?.adres || task?.miasto || '').trim()) },
    { label: 'Zdjecia', ready: taskPhotoCount(task) > 0 },
    { label: 'Zakres', ready: taskHasWorkBrief(task) },
    { label: 'Cena/czas', ready: hasMoney && hasTime },
    { label: 'Ekipa', ready: Boolean(task?.ekipa_id || task?.ekipa_nazwa) },
    { label: 'Termin', ready: Boolean(task?.data_planowana) },
    { label: 'Sprzet', ready: taskHasEquipment(task) },
    { label: 'BHP', ready: taskRiskReady(task) },
  ];
  const fallbackMissing = checks.filter((item) => !item.ready).map((item) => item.label);
  return {
    ready: fallbackMissing.length === 0,
    readyCount: checks.length - fallbackMissing.length,
    totalCount: checks.length,
    missingLabels: fallbackMissing,
  };
}

function isClosedTask(task) {
  const status = String(task?.status || '').toLowerCase();
  return status.includes('zakon') || status.includes('anul');
}

function taskAddressLabel(task) {
  return [task?.adres, task?.miasto].map((item) => String(item || '').trim()).filter(Boolean).join(', ') || '-';
}

function taskEquipmentLabel(task) {
  const names = String(task?.equipment_reserved_names || task?.sprzet_notatka || '').trim();
  const count = Number(task?.equipment_reserved_count || task?.sprzet_count || 0) || 0;
  if (names) return names;
  if (count > 0) return `${count} pozycji`;
  return taskHasEquipment(task) ? 'oznaczone w formularzu' : '-';
}

function taskBudgetLabel(task) {
  const value = Number(task?.wartosc_planowana ?? task?.budzet ?? task?.kwota_minimalna ?? 0);
  return Number.isFinite(value) && value > 0 ? `${value.toLocaleString('pl-PL')} zl` : '-';
}

function taskPhoneLabel(task) {
  return String(task?.klient_telefon || task?.telefon || '').trim() || 'brak';
}

function taskMapsHref(task) {
  const lat = Number(task?.pin_lat ?? task?.lat);
  const lng = Number(task?.pin_lng ?? task?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const address = taskAddressLabel(task);
  return address && address !== '-'
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : '';
}

function taskCrewScope(task) {
  return String(task?.opis_pracy || task?.opis || task?.wynik || task?.notatki_wewnetrzne || '').trim() || 'brak opisu';
}

function taskPlanLabel(task) {
  return `${taskDayKey(task) || 'bez daty'} ${formatBlockTime(task)}`;
}

function buildTaskCrewBrief({
  task,
  photos = [],
  photoEvidence = [],
  readiness = null,
  missingLabels = [],
  telemetry = null,
  gps = null,
}) {
  const mapUrl = taskMapsHref(task);
  const evidenceLine = photoEvidence.length
    ? photoEvidence.map((item) => `${item.label}: ${item.count || 0}`).join(', ')
    : `${taskPhotoCount(task)} zdj.`;
  const photoLines = photos.slice(0, 8).map((photo, index) => {
    const label = PHOTO_EVIDENCE_TYPES.find((item) => item.key === photoEvidenceKey(photo?.typ))?.label || 'Zdjecie';
    const url = String(photo?.sciezka || photo?.url || '').trim();
    const desc = String(photo?.opis || photo?.description || '').trim();
    return `${index + 1}. ${label}${desc ? ` - ${desc}` : ''}${url ? ` | ${url}` : ''}`;
  });
  const readinessText = readiness
    ? `${readiness.readyCount}/${readiness.totalCount}${readiness.ready ? ' gotowe' : ' braki'}`
    : 'brak danych';
  const blockers = missingLabels.length ? missingLabels.join(', ') : 'brak';

  return [
    `ARBOR-OS | ODPRAWA EKIPY | Zlecenie #${task.id}`,
    `Klient: ${task.klient_nazwa || 'brak'} | Telefon: ${taskPhoneLabel(task)}`,
    `Adres: ${taskAddressLabel(task)}`,
    mapUrl ? `Mapa: ${mapUrl}` : null,
    `Termin: ${taskPlanLabel(task)} | Ekipa: ${task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak')}`,
    `Status: ${task.status || 'brak'} | Budzet: ${taskBudgetLabel(task)} | Czas: ${formatMinutesAsHours(taskDurationMinutes(task))}`,
    `Sprzet: ${taskEquipmentLabel(task)}`,
    '',
    `Zakres prac: ${taskCrewScope(task)}`,
    `Pakiet: ${readinessText} | Blokery: ${blockers}`,
    `Zdjecia: ${evidenceLine}`,
    photoLines.length ? `Lista zdjec:\n${photoLines.join('\n')}` : 'Lista zdjec: brak zaladowanych miniaturek w harmonogramie',
    '',
    `GPS: ${gps?.label || 'brak'} / ${gps?.meta || 'brak sygnalu'}`,
    `Teren: ${telemetry?.label || 'brak'} / ${telemetry?.detail || 'brak danych'}`,
    '',
    'Instrukcja: ekipa potwierdza dojazd, zakres, zdjecia i ryzyka w mobilce przed rozpoczeciem pracy.',
  ].filter(Boolean).join('\n');
}

function buildDayCrewBrief({ dayLabel, dayISO, tasks = [], dispatchRows = [], liveByTeam = new Map() }) {
  const sortedTasks = [...tasks].sort((a, b) => {
    const aStart = taskStartMinutes(a);
    const bStart = taskStartMinutes(b);
    if (aStart !== bStart) return aStart - bStart;
    return Number(a.id || 0) - Number(b.id || 0);
  });
  const value = sortedTasks.reduce((sum, task) => sum + (Number(task?.wartosc_planowana) || 0), 0);
  const readyCount = sortedTasks.filter((task) => getCrewPackageReadiness(task).ready).length;
  const teamLines = dispatchRows.map((row) => {
    const live = liveByTeam.get(String(row.team?.id || ''));
    const gps = gpsStatus(live);
    const parts = [
      `${row.team?.nazwa || 'Ekipa'}: ${row.tasks.length} prac`,
      formatMinutesAsHours(row.loadMinutes),
      `GPS ${gps.label}/${gps.meta}`,
      row.conflictIds.size ? `konflikty ${row.conflictIds.size}` : null,
      row.packageBlockedCount ? `braki ${row.packageBlockedCount}` : null,
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  });
  const taskLines = sortedTasks.map((task, index) => {
    const readiness = getCrewPackageReadiness(task);
    const missing = readiness.missingLabels.length ? ` | braki: ${readiness.missingLabels.join(', ')}` : '';
    const mapUrl = taskMapsHref(task);
    return [
      `${index + 1}. ${formatBlockTime(task)} | ${task.klient_nazwa || `#${task.id}`} | ${task.ekipa_nazwa || 'bez ekipy'}`,
      `   Adres: ${taskAddressLabel(task)} | Tel: ${taskPhoneLabel(task)}`,
      `   Zakres: ${taskCrewScope(task)}`,
      `   Budzet/czas/sprzet: ${taskBudgetLabel(task)} | ${formatMinutesAsHours(taskDurationMinutes(task))} | ${taskEquipmentLabel(task)}`,
      `   Pakiet: ${readiness.readyCount}/${readiness.totalCount}${missing}`,
      mapUrl ? `   Mapa: ${mapUrl}` : null,
    ].filter(Boolean).join('\n');
  });

  return [
    `ARBOR-OS | ODPRAWA DNIA | ${dayLabel} (${dayISO})`,
    `Zlecenia: ${sortedTasks.length} | Pakiety gotowe: ${readyCount}/${sortedTasks.length} | Wartosc: ${value.toLocaleString('pl-PL')} zl`,
    '',
    'Ekipy:',
    teamLines.length ? teamLines.join('\n') : '- brak ekip w widoku',
    '',
    'Zlecenia:',
    taskLines.length ? taskLines.join('\n\n') : 'Brak zaplanowanych zlecen.',
  ].join('\n');
}

function gpsAgeMinutes(row) {
  const raw = row?.recorded_at || row?.last_seen_at || row?.timestamp;
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function gpsStatus(row) {
  const age = gpsAgeMinutes(row);
  if (age == null) {
    return {
      key: 'missing',
      label: 'GPS brak',
      meta: 'brak sygnalu',
      color: 'var(--text-muted)',
      bg: 'rgba(148,163,184,0.12)',
      border: 'rgba(148,163,184,0.24)',
    };
  }
  if (age <= GPS_ONLINE_MINUTES) {
    return {
      key: 'online',
      label: 'GPS online',
      meta: age <= 0 ? 'teraz' : `${age} min`,
      color: 'var(--accent)',
      bg: 'rgba(34,197,94,0.12)',
      border: 'rgba(34,197,94,0.32)',
    };
  }
  if (age <= GPS_STALE_MINUTES) {
    return {
      key: 'stale',
      label: 'GPS opozniony',
      meta: `${age} min`,
      color: 'var(--warning)',
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.34)',
    };
  }
  return {
    key: 'offline',
    label: 'GPS offline',
    meta: `${age} min`,
    color: 'var(--danger)',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.34)',
  };
}

function gpsSourceLabel(row) {
  if (!row) return 'brak';
  if (row.provider === 'mobile') return 'mobilka';
  if (row.provider === 'juwentus') return 'Juwentus';
  return row.provider || 'GPS';
}

export default function Harmonogram() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialRouteDate = routeDateFromSearch(location.search);
  const [zlecenia, setZlecenia] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [rezerwacje, setRezerwacje] = useState([]);
  const [liveLocations, setLiveLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtrOddzial, setFiltrOddzial] = useState(() => routeParam(location.search, 'oddzial'));
  const [filtrEkipa, setFiltrEkipa] = useState(() => routeParam(location.search, 'team'));
  const [currentDate, setCurrentDate] = useState(() => initialRouteDate || new Date());
  const [widok, setWidok] = useState(() => routeViewFromSearch(location.search) || 'tydzien');
  const [currentUser, setCurrentUser] = useState(null);
  const [planErr, setPlanErr] = useState('');
  const [planMsg, setPlanMsg] = useState('');
  const [dragOverTeamId, setDragOverTeamId] = useState('');
  const [dragOverSlotKey, setDragOverSlotKey] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState(() => routeParam(location.search, 'task'));
  const [selectedTaskLogi, setSelectedTaskLogi] = useState([]);
  const [selectedTaskPhotos, setSelectedTaskPhotos] = useState([]);
  const [selectedTaskTelemetryLoading, setSelectedTaskTelemetryLoading] = useState(false);
  const isBrygadzista = currentUser?.rola === 'Brygadzista';
  const dateRange = useMemo(() => visibleDateRange(currentDate, widok), [currentDate, widok]);
  const rezerwacjeByTask = useMemo(() => {
    const map = new Map();
    for (const row of rezerwacje) {
      if (!row?.task_id || !isActiveReservation(row)) continue;
      const key = String(row.task_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [rezerwacje]);

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      
      let zleceniaEndpoint = `/tasks/wszystkie`;
      if (isBrygadzista) {
        zleceniaEndpoint = `/tasks/moje`;
      }
      
      const [zRes, oRes, eRes, rRes, liveRes] = await Promise.all([
        api.get(zleceniaEndpoint, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/flota/rezerwacje?from=${dateRange.from}&to=${dateRange.to}`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/ekipy/live-locations`, { headers: h, dedupe: false }).catch(() => ({ data: { items: [] } })),
      ]);
      const rawZ = zRes.data;
      setZlecenia(Array.isArray(rawZ) ? rawZ : rawZ?.items || []);
      const rawO = oRes.data;
      setOddzialy(Array.isArray(rawO) ? rawO : rawO?.oddzialy || []);
      const rawE = eRes.data;
      setEkipy(Array.isArray(rawE) ? rawE : rawE?.ekipy || []);
      setRezerwacje(Array.isArray(rRes.data) ? rRes.data : []);
      const rawLive = liveRes.data;
      setLiveLocations(Array.isArray(rawLive) ? rawLive : rawLive?.items || []);
    } catch (err) {
      console.error('Błąd ładowania:', err);
      setRezerwacje([]);
      setLiveLocations([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, isBrygadzista]);

  const patchTaskPlan = useCallback(
    async (taskId, dayDate, hour, teamId = null) => {
      setPlanErr('');
      setPlanMsg('');
      const savePlan = async (overrideAbsent = false) => {
        const token = getStoredToken();
        const h = authHeaders(token);
        const iso = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, 0, 0, 0).toISOString();
        const payload = { data_planowana: iso };
        if (teamId != null) payload.ekipa_id = teamId;
        if (overrideAbsent) payload.absence_override = true;
        return api.patch(`/tasks/${taskId}/plan`, payload, { headers: h });
      };
      const applyResponse = async (res, overrideAbsent = false) => {
        const data = res.data || {};
        const missingLabels = Array.isArray(data.office_plan_missing_labels)
          ? data.office_plan_missing_labels.map((label) => String(label || '').trim()).filter(Boolean)
          : [];
        if (data.plan_promoted) {
          setPlanMsg(data.message || 'Zlecenie zaplanowane i gotowe dla ekipy.');
        } else if (missingLabels.length) {
          setPlanErr(data.message || `Plan zapisany, ale brakuje: ${missingLabels.join(', ')}.`);
        } else {
          setPlanMsg(
            data.message
            || (overrideAbsent
              ? 'Termin zapisany z potwierdzeniem nieobecnej ekipy.'
              : (teamId != null ? 'Ekipa i termin zaktualizowane.' : 'Termin zaktualizowany.'))
          );
        }
        await loadData();
      };
      try {
        await applyResponse(await savePlan(false), false);
      } catch (err) {
        const payload = err?.response?.data || {};
        if (payload.code === 'TEAM_ABSENT') {
          const attendance = payload.attendance || {};
          const reason = attendance.note ? ` Powod: ${attendance.note}.` : '';
          const confirmed = typeof window !== 'undefined' && window.confirm
            ? window.confirm(`${attendance.teamName || 'Wybrana ekipa'} jest oznaczona jako nieobecna.${reason} Czy kierownik potwierdza planowanie mimo braku gotowosci?`)
            : false;
          if (!confirmed) {
            setPlanErr('Planowanie przerwane: ekipa jest nieobecna.');
            return;
          }
          try {
            await applyResponse(await savePlan(true), true);
            return;
          } catch (overrideErr) {
            setPlanErr(getApiErrorMessage(overrideErr));
            return;
          }
        }
        setPlanErr(getApiErrorMessage(err));
      }
    },
    [loadData]
  );

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadData();
    const intervalId = setInterval(() => loadData(), 60000);
    return () => clearInterval(intervalId);
  }, [navigate, loadData]);

  useEffect(() => {
    setPlanMsg('');
    setPlanErr('');
  }, [currentDate, widok]);

  useEffect(() => {
    const routeDate = routeDateFromSearch(location.search);
    const routeView = routeViewFromSearch(location.search);
    const routeOddzial = routeParam(location.search, 'oddzial');
    const routeTeam = routeParam(location.search, 'team');
    const routeTask = routeParam(location.search, 'task');
    const hasRouteDate = routeHasParam(location.search, 'date');
    const hasRouteView = routeHasParam(location.search, 'view');
    const hasAnyRouteState =
      hasRouteDate ||
      hasRouteView ||
      routeHasParam(location.search, 'oddzial') ||
      routeHasParam(location.search, 'team') ||
      routeHasParam(location.search, 'task');

    if (hasRouteDate && routeDate) {
      setCurrentDate((prev) => (toISODate(prev) === toISODate(routeDate) ? prev : routeDate));
    } else if (!hasAnyRouteState) {
      setCurrentDate(new Date());
    }
    if (hasRouteView) setWidok(routeView || 'tydzien');
    else if (!hasAnyRouteState) setWidok('tydzien');
    setFiltrOddzial(routeOddzial);
    setFiltrEkipa(routeTeam);
    setSelectedTaskId(routeTask);
  }, [location.search]);

  const isKierownik = currentUser?.rola === 'Kierownik';
  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const canEdit = isDyrektor || isKierownik;

  const getTydzien = (date) => {
    const pon = weekStart(date);
    return Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(pon);
      dd.setDate(pon.getDate() + i);
      return dd;
    });
  };

  // Build a quick lookup: ekipa_id → kolor
  const ekipaKolorMap = useMemo(() => Object.fromEntries(
    ekipy.filter(e => e.kolor).map(e => [e.id, e.kolor])
  ), [ekipy]);

  const getKolor = useCallback(
    (z) => ekipaKolorMap[z.ekipa_id] || STATUS_KOLOR[z.status] || 'var(--text-muted)',
    [ekipaKolorMap]
  );

  const tydzien = getTydzien(currentDate);
  const dzisiaj = toISODate(new Date());
  const selectedDayISO = toISODate(currentDate);
  const selectedDayLabel = currentDate.toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  const selectedTask = useMemo(
    () => zlecenia.find((task) => String(task.id) === String(selectedTaskId)) || null,
    [zlecenia, selectedTaskId]
  );
  const selectedTaskReadiness = useMemo(
    () => selectedTask ? getCrewPackageReadiness(selectedTask) : null,
    [selectedTask]
  );
  const selectedOfficeMissingLabels = useMemo(() => {
    if (!selectedTask) return [];
    if (Array.isArray(selectedTask.office_plan_missing_labels)) {
      return selectedTask.office_plan_missing_labels.map((label) => String(label || '').trim()).filter(Boolean);
    }
    return selectedTaskReadiness?.missingLabels || [];
  }, [selectedTask, selectedTaskReadiness]);

  const zleceniaNaDzien = (date) => {
    const dateStr = toISODate(date);
    return zlecenia.filter(z => {
      if (taskDayKey(z) !== dateStr) return false;
      if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
      if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
      return true;
    });
  };

  const dispatchTeams = useMemo(() => (
    ekipy.filter((team) => {
      if (filtrOddzial && String(team.oddzial_id || '') !== filtrOddzial) return false;
      if (filtrEkipa && String(team.id || '') !== filtrEkipa) return false;
      return true;
    })
  ), [ekipy, filtrOddzial, filtrEkipa]);

  const liveByTeam = useMemo(() => {
    const map = new Map();
    for (const point of liveLocations) {
      const teamId = point?.ekipa_id ?? point?.team_id;
      if (teamId == null || teamId === '') continue;
      const key = String(teamId);
      const previous = map.get(key);
      const currentTs = new Date(point?.recorded_at || point?.last_seen_at || point?.timestamp || 0).getTime();
      const previousTs = new Date(previous?.recorded_at || previous?.last_seen_at || previous?.timestamp || 0).getTime();
      if (!previous || (Number.isFinite(currentTs) && (!Number.isFinite(previousTs) || currentTs > previousTs))) {
        map.set(key, point);
      }
    }
    return map;
  }, [liveLocations]);
  const selectedTaskLivePoint = useMemo(() => {
    if (!selectedTask?.ekipa_id) return null;
    return liveByTeam.get(String(selectedTask.ekipa_id)) || null;
  }, [liveByTeam, selectedTask]);
  const selectedTaskGpsStatus = gpsStatus(selectedTaskLivePoint);
  const selectedTaskWorkTelemetry = useMemo(
    () => getWorkTelemetry(selectedTaskLogi),
    [selectedTaskLogi]
  );
  const selectedPhotoEvidence = useMemo(() => {
    const counts = Object.fromEntries(PHOTO_EVIDENCE_TYPES.map((type) => [type.key, 0]));
    for (const photo of selectedTaskPhotos) {
      const key = photoEvidenceKey(photo?.typ);
      counts[key] = (counts[key] || 0) + 1;
    }
    return PHOTO_EVIDENCE_TYPES.map((type) => ({ ...type, count: counts[type.key] || 0 }));
  }, [selectedTaskPhotos]);
  const selectedPhotoEvidenceReady = selectedPhotoEvidence.filter((item) => item.count > 0).length;

  useEffect(() => {
    if (!selectedTask?.id) {
      setSelectedTaskLogi([]);
      setSelectedTaskPhotos([]);
      setSelectedTaskTelemetryLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadSelectedTelemetry = async () => {
      setSelectedTaskTelemetryLoading(true);
      try {
        const token = getStoredToken();
        const h = authHeaders(token);
        const [logsRes, photosRes] = await Promise.all([
          api.get(`/tasks/${selectedTask.id}/logi`, { headers: h }).catch(() => ({ data: [] })),
          api.get(`/tasks/${selectedTask.id}/zdjecia`, { headers: h }).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setSelectedTaskLogi(Array.isArray(logsRes.data) ? logsRes.data : []);
        setSelectedTaskPhotos(Array.isArray(photosRes.data) ? photosRes.data : []);
      } finally {
        if (!cancelled) setSelectedTaskTelemetryLoading(false);
      }
    };

    loadSelectedTelemetry();
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.id]);

  const selectedDayTasks = useMemo(() => (
    zlecenia.filter((task) => {
      if (taskDayKey(task) !== selectedDayISO) return false;
      if (filtrOddzial && String(task.oddzial_id || '') !== filtrOddzial) return false;
      if (filtrEkipa && String(task.ekipa_id || '') !== filtrEkipa) return false;
      return true;
    })
  ), [zlecenia, selectedDayISO, filtrOddzial, filtrEkipa]);

  const dispatchRows = useMemo(() => {
    const rows = new Map();
    for (const team of dispatchTeams) {
      rows.set(String(team.id), {
        team,
        tasks: [],
        loadMinutes: 0,
        conflictIds: new Set(),
        packageBlockedCount: 0,
        firstMissing: '',
      });
    }

    for (const task of selectedDayTasks) {
      const teamId = task?.ekipa_id ? String(task.ekipa_id) : '';
      if (!teamId) continue;
      if (!rows.has(teamId)) {
        rows.set(teamId, {
          team: {
            id: task.ekipa_id,
            nazwa: task.ekipa_nazwa || `Ekipa #${task.ekipa_id}`,
            oddzial_id: task.oddzial_id,
            kolor: getKolor(task),
          },
          tasks: [],
          loadMinutes: 0,
          conflictIds: new Set(),
          packageBlockedCount: 0,
          firstMissing: '',
        });
      }
      const row = rows.get(teamId);
      const readiness = getCrewPackageReadiness(task);
      const start = taskStartMinutes(task);
      const end = start + taskDurationMinutes(task);
      row.tasks.push({ task, start, end, readiness });
      row.loadMinutes += Math.max(0, end - start);
      if (!readiness.ready) {
        row.packageBlockedCount += 1;
        if (!row.firstMissing) row.firstMissing = readiness.missingLabels[0] || 'pakiet ekipy';
      }
    }

    for (const row of rows.values()) {
      row.tasks.sort((a, b) => a.start - b.start);
      for (let i = 0; i < row.tasks.length; i += 1) {
        for (let j = i + 1; j < row.tasks.length; j += 1) {
          if (rangesOverlap(row.tasks[i], row.tasks[j])) {
            row.conflictIds.add(String(row.tasks[i].task.id));
            row.conflictIds.add(String(row.tasks[j].task.id));
          }
        }
      }
    }

    return Array.from(rows.values()).sort((a, b) => {
      const aBusy = a.tasks.length ? 0 : 1;
      const bBusy = b.tasks.length ? 0 : 1;
      if (aBusy !== bBusy) return aBusy - bBusy;
      return String(a.team?.nazwa || '').localeCompare(String(b.team?.nazwa || ''), 'pl');
    });
  }, [dispatchTeams, selectedDayTasks, getKolor]);

  const dispatchConflictIds = useMemo(() => {
    const ids = new Set();
    for (const row of dispatchRows) {
      for (const id of row.conflictIds) ids.add(id);
    }
    return ids;
  }, [dispatchRows]);

  const dispatchQueue = useMemo(() => (
    zlecenia
      .filter((task) => {
        if (isClosedTask(task)) return false;
        if (filtrOddzial && String(task.oddzial_id || '') !== filtrOddzial) return false;
        if (filtrEkipa && task.ekipa_id && String(task.ekipa_id) !== filtrEkipa) return false;
        const status = String(task.status || '').toLowerCase();
        const readiness = getCrewPackageReadiness(task);
        return !task.data_planowana
          || !task.ekipa_id
          || !readiness.ready
          || status.includes('wycena')
          || status.includes('zatwierdzenia')
          || status === 'nowe';
      })
      .sort((a, b) => {
        const aDay = taskDayKey(a) || '9999-12-31';
        const bDay = taskDayKey(b) || '9999-12-31';
        if (aDay !== bDay) return aDay.localeCompare(bDay);
        return Number(b.id || 0) - Number(a.id || 0);
      })
      .slice(0, 8)
  ), [zlecenia, filtrOddzial, filtrEkipa]);

  const dispatchStats = useMemo(() => {
    const packageBlocked = selectedDayTasks.filter((task) => !getCrewPackageReadiness(task).ready).length;
    const unassigned = selectedDayTasks.filter((task) => !task?.ekipa_id).length;
    const loadMinutes = dispatchRows.reduce((sum, row) => sum + row.loadMinutes, 0);
    return {
      scheduled: selectedDayTasks.length,
      loadLabel: formatMinutesAsHours(loadMinutes),
      conflictCount: dispatchConflictIds.size,
      packageBlocked,
      unassigned,
    };
  }, [selectedDayTasks, dispatchRows, dispatchConflictIds]);

  const dispatchGpsStats = useMemo(() => {
    const stats = { total: dispatchRows.length, online: 0, stale: 0, offline: 0, missing: 0 };
    for (const row of dispatchRows) {
      const point = liveByTeam.get(String(row.team?.id || ''));
      const key = gpsStatus(point).key;
      if (key === 'online') stats.online += 1;
      else if (key === 'stale') stats.stale += 1;
      else if (key === 'offline') stats.offline += 1;
      else stats.missing += 1;
    }
    return stats;
  }, [dispatchRows, liveByTeam]);

  const copyTextToClipboard = useCallback(async (text, successMessage) => {
    setPlanErr('');
    setPlanMsg('');
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error('Clipboard unavailable');
        }
      } else {
        throw new Error('Clipboard unavailable');
      }
      setPlanMsg(successMessage);
    } catch {
      setPlanErr('Nie udalo sie skopiowac odprawy.');
    }
  }, []);

  const copySelectedTaskBrief = useCallback(() => {
    if (!selectedTask) {
      setPlanErr('Najpierw wybierz zlecenie w harmonogramie.');
      return;
    }
    const text = buildTaskCrewBrief({
      task: selectedTask,
      photos: selectedTaskPhotos,
      photoEvidence: selectedPhotoEvidence,
      readiness: selectedTaskReadiness,
      missingLabels: selectedOfficeMissingLabels,
      telemetry: selectedTaskWorkTelemetry,
      gps: selectedTaskGpsStatus,
    });
    void copyTextToClipboard(text, `Odprawa zlecenia #${selectedTask.id} skopiowana.`);
  }, [
    copyTextToClipboard,
    selectedOfficeMissingLabels,
    selectedPhotoEvidence,
    selectedTask,
    selectedTaskGpsStatus,
    selectedTaskPhotos,
    selectedTaskReadiness,
    selectedTaskWorkTelemetry,
  ]);

  const copySelectedDayBrief = useCallback(() => {
    const text = buildDayCrewBrief({
      dayLabel: selectedDayLabel,
      dayISO: selectedDayISO,
      tasks: selectedDayTasks,
      dispatchRows,
      liveByTeam,
    });
    void copyTextToClipboard(text, `Odprawa dnia ${selectedDayISO} skopiowana.`);
  }, [copyTextToClipboard, dispatchRows, liveByTeam, selectedDayISO, selectedDayLabel, selectedDayTasks]);

  const confirmSelectedForCrew = useCallback(() => {
    if (!canEdit || !selectedTask?.id || !selectedTask?.ekipa_id) return;
    const date = taskPlanDateObject(selectedTask, currentDate);
    void patchTaskPlan(selectedTask.id, date, clampPlanHour(selectedTask), selectedTask.ekipa_id);
  }, [canEdit, currentDate, patchTaskPlan, selectedTask]);

  const handleDropOnTeam = useCallback((event, teamId) => {
    if (!canEdit || !teamId) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOverTeamId('');
    const raw = event.dataTransfer.getData('application/json');
    if (!raw) return;
    let taskId;
    try {
      taskId = JSON.parse(raw).taskId;
    } catch {
      return;
    }
    if (!taskId) return;
    const task = zlecenia.find((item) => String(item.id) === String(taskId));
    setSelectedTaskId(String(taskId));
    const hour = clampPlanHour(task);
    void patchTaskPlan(taskId, currentDate, hour, teamId);
  }, [canEdit, currentDate, patchTaskPlan, zlecenia]);

  const handleDropOnDispatchSlot = useCallback((event, teamId, hour) => {
    if (!canEdit || !teamId) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOverSlotKey('');
    setDragOverTeamId('');
    const raw = event.dataTransfer.getData('application/json');
    if (!raw) return;
    let taskId;
    try {
      taskId = JSON.parse(raw).taskId;
    } catch {
      return;
    }
    if (!taskId) return;
    setSelectedTaskId(String(taskId));
    void patchTaskPlan(taskId, currentDate, hour, teamId);
  }, [canEdit, currentDate, patchTaskPlan]);

  const getGodzinaStart = (z) => {
    if (z.godzina_rozpoczecia) {
      const [h, m] = String(z.godzina_rozpoczecia).split(':').map(Number);
      if (Number.isFinite(h)) return h + (Number.isFinite(m) ? m / 60 : 0);
    }
    if (z.data_planowana) {
      try {
        const dt = new Date(z.data_planowana);
        if (!Number.isNaN(dt.getTime())) {
          return dt.getHours() + dt.getMinutes() / 60;
        }
      } catch {
        /* ignore */
      }
    }
    return 8;
  };

  const getCzasTrwania = (z) => {
    return parseFloat(z.czas_planowany_godziny) || 1;
  };

  const layoutDayBlocks = (items) => {
    const sorted = [...items].sort((a, b) => getGodzinaStart(a) - getGodzinaStart(b));
    const lanesEnd = [];
    const placed = [];
    for (const z of sorted) {
      const start = getGodzinaStart(z);
      const end = start + getCzasTrwania(z);
      let lane = 0;
      while (lane < lanesEnd.length && lanesEnd[lane] > start) lane += 1;
      lanesEnd[lane] = end;
      placed.push({ z, start, end, lane });
    }
    const laneCount = Math.max(1, lanesEnd.length);
    return placed.map((item) => ({ ...item, laneCount }));
  };

  const prevPeriod = () => {
    const d = new Date(currentDate);
    if (widok === 'dzien') d.setDate(d.getDate() - 1);
    else if (widok === 'tydzien') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCurrentDate(d);
  };

  const nextPeriod = () => {
    const d = new Date(currentDate);
    if (widok === 'dzien') d.setDate(d.getDate() + 1);
    else if (widok === 'tydzien') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  const getTytul = () => {
    if (widok === 'dzien') {
      return currentDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (widok === 'tydzien') {
      const pon = tydzien[0];
      const nd = tydzien[6];
      return `${pon.getDate()} ${MIESIACE[pon.getMonth()]} — ${nd.getDate()} ${MIESIACE[nd.getMonth()]} ${nd.getFullYear()}`;
    }
    return `${MIESIACE[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  };

  const renderDzien = (dni) => (
    <div style={styles.calBody}>
      <div style={{...styles.timeGrid, gridTemplateColumns: `${TIME_COL_WIDTH}px repeat(${dni.length}, 1fr)`}}>
        <div style={styles.timeCorner} />
        {dni.map(d => {
          const ds = toISODate(d);
          const isToday = ds === dzisiaj;
          return (
            <div key={ds} style={{...styles.dayColHeader, backgroundColor: isToday ? 'var(--accent-surface)' : 'var(--surface-field)'}}>
              <div style={{...styles.dayColDow, color: isToday ? 'var(--accent)' : 'var(--text-muted)'}}>
                {DNI_KROTKO[d.getDay() === 0 ? 6 : d.getDay() - 1]}
              </div>
              <div style={{
                ...styles.dayColNum,
                backgroundColor: isToday ? 'var(--accent)' : 'transparent',
                color: isToday ? 'var(--on-accent)' : 'var(--text)'
              }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.scrollArea}>
        <div style={{...styles.timeGrid, gridTemplateColumns: `${TIME_COL_WIDTH}px repeat(${dni.length}, 1fr)`}}>
          <div style={styles.timeCol}>
            {GODZINY.map(h => (
              <div key={h} style={styles.timeSlot}>
                <span style={styles.timeLabel}>{h}:00</span>
              </div>
            ))}
          </div>

          {dni.map(d => {
            const ds = toISODate(d);
            const isToday = ds === dzisiaj;
            const zl = zleceniaNaDzien(d);

            const dayBlocks = layoutDayBlocks(zl);
            const isTodayColumn = isToday && widok !== 'miesiac';
            const now = new Date();
            const nowDecimal = now.getHours() + now.getMinutes() / 60;
            const showNowLine = isTodayColumn && nowDecimal >= DAY_START_HOUR && nowDecimal <= DAY_END_HOUR;
            const nowTop = (nowDecimal - DAY_START_HOUR) * HOUR_SLOT_HEIGHT;

            return (
              <div key={ds} style={{...styles.dayCol, backgroundColor: isToday ? 'var(--accent-surface)' : 'var(--surface-field)'}}>
                {GODZINY.map((h) => (
                  <div
                    key={h}
                    style={styles.hourCell}
                    onClick={() => canEdit && navigate(`/nowe-zlecenie?data=${ds}&godzina=${h}:00`)}
                    onDragOver={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      const raw = e.dataTransfer.getData('application/json');
                      if (!raw) return;
                      let taskId;
                      try {
                        taskId = JSON.parse(raw).taskId;
                      } catch {
                        return;
                      }
                      if (!taskId) return;
                      void patchTaskPlan(taskId, d, h);
                    }}
                  />
                ))}

                {showNowLine && (
                  <div style={{ ...styles.nowLine, top: nowTop }}>
                    <span style={styles.nowDot} />
                  </div>
                )}

                {dayBlocks.map(({ z, start, lane, laneCount }) => {
                  const top = (start - DAY_START_HOUR) * HOUR_SLOT_HEIGHT;
                  const height = Math.max(getCzasTrwania(z) * HOUR_SLOT_HEIGHT, 34);
                  const kolor = getKolor(z);
                  const photoCount = taskPhotoCount(z);
                  const equipmentCount = (rezerwacjeByTask.get(String(z.id)) || []).length;
                  const hasBrief = taskHasWorkBrief(z);
                  const hasConflict = dispatchConflictIds.has(String(z.id));
                  const gap = 4;
                  const colWidth = `calc((100% - ${(laneCount - 1) * gap}px) / ${laneCount})`;
                  const left = `calc(${lane} * (${colWidth} + ${gap}px))`;

                  return (
                    <div
                      key={z.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        if (!canEdit) return;
                        e.dataTransfer.setData('application/json', JSON.stringify({ taskId: z.id }));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      style={{
                      ...styles.zlecenieBlock,
                      ...(hasConflict ? styles.zlecenieBlockConflict : {}),
                      top: top,
                      height: height,
                      width: colWidth,
                      left: left,
                      right: 'auto',
                      backgroundColor: kolor + '22',
                      borderLeft: `3px solid ${kolor}`,
                      cursor: canEdit ? 'grab' : 'pointer',
                    }} onClick={(e) => { e.stopPropagation(); setSelectedTaskId(String(z.id)); }}>
                      <div style={{...styles.blockTitle, color: kolor}}>
                        {formatBlockTime(z)} {z.klient_nazwa}
                      </div>
                      {height > 45 && (
                        <div style={styles.blockSub}>{z.ekipa_nazwa || 'Brak ekipy'}</div>
                      )}
                      {height > 52 && (
                        <div style={styles.blockBadges}>
                          {hasConflict && (
                            <span style={{ ...styles.blockBadge, ...styles.blockBadgeDanger }} title="Konflikt godzin dla tej ekipy">
                              konflikt
                            </span>
                          )}
                          <span
                            style={{ ...styles.blockBadge, ...(photoCount ? styles.blockBadgeOk : styles.blockBadgeWarn) }}
                            title={photoCount ? `${photoCount} zdjec w zleceniu` : 'Brak zdjec z ogledzin / pracy'}
                          >
                            {photoCount ? `${photoCount} zdj.` : 'bez zdj.'}
                          </span>
                          <span
                            style={{ ...styles.blockBadge, ...(equipmentCount ? styles.blockBadgeOk : styles.blockBadgeNeutral) }}
                            title={equipmentCount ? `${equipmentCount} aktywne rezerwacje sprzetu` : 'Brak sprzetu przypisanego do zlecenia'}
                          >
                            {equipmentCount ? `${equipmentCount} sprz.` : 'sprz. -'}
                          </span>
                          {!hasBrief && (
                            <span style={{ ...styles.blockBadge, ...styles.blockBadgeWarn }} title="Brak opisu pracy dla ekipy">
                              opis -
                            </span>
                          )}
                        </div>
                      )}
                      {height > 82 && z.adres && (
                        <div style={styles.blockSub}>{z.adres.substring(0, 20)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderMiesiac = () => {
    const rok = currentDate.getFullYear();
    const miesiac = currentDate.getMonth();
    const pierwszyDzien = new Date(rok, miesiac, 1);
    const ostatniDzien = new Date(rok, miesiac + 1, 0);
    const dniArray = [];
    let dow = pierwszyDzien.getDay();
    dow = dow === 0 ? 6 : dow - 1;
    for (let i = 0; i < dow; i++) dniArray.push(null);
    for (let i = 1; i <= ostatniDzien.getDate(); i++) dniArray.push(new Date(rok, miesiac, i));

    return (
      <div style={styles.miesiacGrid}>
        {DNI_KROTKO.map(d => <div key={d} style={styles.miesiacHeader}>{d}</div>)}
        {dniArray.map((data, i) => {
          if (!data) return <div key={`e-${i}`} style={styles.miesiacEmpty} />;
          const ds = toISODate(data);
          const isToday = ds === dzisiaj;
          const zl = zleceniaNaDzien(data);
          return (
            <div key={ds} style={{
              ...styles.miesiacCell,
              backgroundColor: isToday ? 'var(--accent-surface)' : 'var(--surface-field)',
              border: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
            }} onClick={() => { setCurrentDate(data); setWidok('dzien'); }}>
              <div style={{...styles.miesiacNum, color: isToday ? 'var(--accent)' : 'var(--text)', fontWeight: isToday ? 'bold' : 'normal'}}>
                {data.getDate()}
              </div>
              {zl.slice(0, 3).map(z => (
                <div key={z.id} style={{...styles.miesiacChip, backgroundColor: getKolor(z)}}>
                  {formatBlockTime(z)} {z.klient_nazwa?.substring(0, 12)}
                </div>
              ))}
              {zl.length > 3 && <div style={styles.miesiacMore}>+{zl.length - 3} więcej</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const filtrowaneEkipy = ekipy.filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial);

  return (
    <div className="app-shell" style={styles.container}>
      <Sidebar />
      <main className="app-main" style={styles.main}>
        <div style={styles.headerRow}>
          <div style={styles.navRow}>
            <button style={styles.todayBtn} onClick={goToday}>
              <TodayOutlined style={{ fontSize: 17 }} aria-hidden />
              Dziś
            </button>
            <button style={styles.navBtn} onClick={prevPeriod} aria-label="Poprzedni okres">
              <ChevronLeftOutlined style={{ fontSize: 20 }} aria-hidden />
            </button>
            <button style={styles.navBtn} onClick={nextPeriod} aria-label="Następny okres">
              <ChevronRightOutlined style={{ fontSize: 20 }} aria-hidden />
            </button>
            <h2 style={styles.calTitle}>{getTytul()}</h2>
          </div>
          <div style={styles.headerRight}>
            {!isBrygadzista && (
              <>
                <select style={styles.filtrSelect} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">Wszystkie oddziały</option>
                  {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                </select>
                <select style={styles.filtrSelect} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                  <option value="">Wszystkie ekipy</option>
                  {filtrowaneEkipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                </select>
              </>
            )}
            <div style={styles.widokBtns}>
              {['dzien', 'tydzien', 'miesiac'].map(w => (
                <button key={w} style={{...styles.widokBtn, ...(widok === w ? styles.widokBtnActive : {})}}
                  data-testid={`harmonogram-view-${w}`}
                  onClick={() => setWidok(w)}>
                  {w === 'dzien' ? 'Dzień' : w === 'tydzien' ? 'Tydzień' : 'Miesiąc'}
                </button>
              ))}
            </div>
            {canEdit && (
              <button style={styles.addBtn} onClick={() => navigate('/nowe-zlecenie')}>
                <AddOutlined style={{ fontSize: 17 }} aria-hidden />
                Nowe zlecenie
              </button>
            )}
          </div>
        </div>

        {(planErr || planMsg) && (
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            {planErr ? <span style={{ color: 'var(--danger)' }}>{planErr}</span> : null}
            {planMsg ? <span style={{ color: 'var(--accent)' }}>{planMsg}</span> : null}
          </div>
        )}
        {canEdit && !loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Przeciągnij blok zlecenia na inny dzień lub godzinę, aby zmienić termin (widok dzień / tydzień).
            Rezerwacje sprzętu z tego zlecenia przesuwają się razem z terminem.
          </div>
        ) : null}
        {!loading ? (
          <div style={styles.readinessHint}>
            Na blokach: zdjęcia z oględzin/pracy, aktywny sprzęt i brak opisu dla ekipy.
          </div>
        ) : null}

        {!loading ? (
          <section style={styles.dispatchPanel} data-testid="harmonogram-dispatch-panel">
            <div style={styles.dispatchHead}>
              <div>
                <div style={styles.dispatchEyebrow}>Centrum planowania ekip</div>
                <h3 style={styles.dispatchTitle}>Dispatch dnia: {selectedDayLabel}</h3>
                <p style={styles.dispatchSubtitle}>
                  Przeciagnij zlecenie z kolejki na konkretny slot: ekipa + godzina.
                </p>
              </div>
              <div style={styles.dispatchHeadActions}>
                <button
                  type="button"
                  style={styles.dispatchLinkBtn}
                  onClick={copySelectedDayBrief}
                >
                  Kopiuj odprawe dnia
                </button>
                <button
                  type="button"
                  style={styles.dispatchLinkBtn}
                  onClick={() => navigate('/mapa-live')}
                >
                  Mapa live
                </button>
                <button
                  type="button"
                  style={styles.dispatchLinkBtn}
                  onClick={() => navigate('/kalendarz-zasobow')}
                >
                  Otworz kalendarz zasobow
                </button>
              </div>
            </div>

            <div style={styles.dispatchKpis}>
              <div style={styles.dispatchKpi}>
                <span>Prace w dniu</span>
                <strong>{dispatchStats.scheduled}</strong>
              </div>
              <div style={styles.dispatchKpi}>
                <span>Planowane godziny</span>
                <strong>{dispatchStats.loadLabel}</strong>
              </div>
              <div style={{ ...styles.dispatchKpi, ...(dispatchStats.conflictCount ? styles.dispatchKpiDanger : {}) }}>
                <span>Konflikty</span>
                <strong>{dispatchStats.conflictCount}</strong>
              </div>
              <div style={{ ...styles.dispatchKpi, ...(dispatchStats.packageBlocked ? styles.dispatchKpiWarn : {}) }}>
                <span>Braki pakietu</span>
                <strong>{dispatchStats.packageBlocked}</strong>
              </div>
              <div style={{ ...styles.dispatchKpi, ...(dispatchStats.unassigned ? styles.dispatchKpiWarn : {}) }}>
                <span>Bez ekipy</span>
                <strong>{dispatchStats.unassigned}</strong>
              </div>
              <div style={{ ...styles.dispatchKpi, ...((dispatchGpsStats.stale || dispatchGpsStats.offline || dispatchGpsStats.missing) ? styles.dispatchKpiWarn : {}) }}>
                <span>GPS online</span>
                <strong>{dispatchGpsStats.online}/{dispatchGpsStats.total}</strong>
              </div>
            </div>

            <div style={styles.dispatchSlotBoard} data-testid="harmonogram-dispatch-slot-board">
              <div style={styles.dispatchSlotHeader}>
                <span style={styles.dispatchSlotHeaderTeam}>Ekipa</span>
                <div style={styles.dispatchSlotHours}>
                  {GODZINY.map((hour) => (
                    <span key={hour} style={styles.dispatchSlotHourLabel}>{formatHourLabel(hour)}</span>
                  ))}
                </div>
              </div>
              <div style={styles.dispatchSlotRows}>
                {dispatchRows.length ? dispatchRows.map((row) => {
                  const teamId = row.team?.id;
                  const color = row.team?.kolor || 'var(--accent)';
                  const livePoint = liveByTeam.get(String(teamId || ''));
                  const liveStatus = gpsStatus(livePoint);
                  return (
                    <div key={teamId || row.team?.nazwa} style={styles.dispatchSlotRow} data-testid="harmonogram-dispatch-slot-row">
                      <div style={styles.dispatchSlotTeam}>
                        <span style={{ ...styles.dispatchTeamDot, background: color, boxShadow: `0 0 10px ${color}88` }} />
                        <div>
                          <strong style={styles.dispatchSlotTeamName}>{row.team?.nazwa || 'Ekipa'}</strong>
                          <span style={styles.dispatchSlotTeamMeta}>{row.tasks.length} prac / {formatMinutesAsHours(row.loadMinutes)}</span>
                          <span
                            style={{
                              ...styles.dispatchGpsPill,
                              color: liveStatus.color,
                              background: liveStatus.bg,
                              borderColor: liveStatus.border,
                            }}
                            title={`${liveStatus.label} - ${liveStatus.meta} - ${gpsSourceLabel(livePoint)}`}
                          >
                            {liveStatus.label} - {liveStatus.meta}
                          </span>
                        </div>
                      </div>
                      <div style={styles.dispatchSlotCells}>
                        {GODZINY.map((hour) => {
                          const slotKey = `${teamId || 'team'}-${hour}`;
                          const slotTasks = row.tasks.filter(({ start }) => {
                            const startHour = Math.floor(start / 60);
                            return startHour === hour;
                          });
                          const isSlotTarget = dragOverSlotKey === slotKey;
                          const hasConflict = slotTasks.some(({ task }) => dispatchConflictIds.has(String(task.id)));
                          return (
                            <div
                              key={slotKey}
                              data-testid="harmonogram-dispatch-slot"
                              style={{
                                ...styles.dispatchSlotCell,
                                ...(isSlotTarget ? styles.dispatchSlotCellDrop : {}),
                                ...(hasConflict ? styles.dispatchSlotCellConflict : {}),
                              }}
                              onDragEnter={(event) => {
                                if (!canEdit || !teamId) return;
                                event.preventDefault();
                                setDragOverSlotKey(slotKey);
                              }}
                              onDragOver={(event) => {
                                if (!canEdit) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                              }}
                              onDragLeave={() => {
                                if (isSlotTarget) setDragOverSlotKey('');
                              }}
                              onDrop={(event) => handleDropOnDispatchSlot(event, teamId, hour)}
                            >
                              {slotTasks.slice(0, 2).map(({ task }) => {
                                const readiness = getCrewPackageReadiness(task);
                                const chipColor = dispatchConflictIds.has(String(task.id))
                                  ? 'var(--danger)'
                                  : readiness.ready ? color : 'var(--warning)';
                                return (
                                  <button
                                    type="button"
                                    key={task.id}
                                    style={{ ...styles.dispatchSlotTask, borderColor: chipColor, color: chipColor }}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedTaskId(String(task.id));
                                    }}
                                    draggable={canEdit}
                                    onDragStart={(event) => {
                                      if (!canEdit) return;
                                      event.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id }));
                                      event.dataTransfer.effectAllowed = 'move';
                                    }}
                                  >
                                    {task.klient_nazwa || `#${task.id}`}
                                  </button>
                                );
                              })}
                              {slotTasks.length > 2 ? (
                                <span style={styles.dispatchSlotMore}>+{slotTasks.length - 2}</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }) : (
                  <div style={styles.dispatchEmpty}>Brak ekip do pokazania w siatce.</div>
                )}
              </div>
            </div>

            <div style={styles.dispatchGrid}>
              <div style={styles.dispatchTeamsGrid}>
                {dispatchRows.length ? dispatchRows.map((row) => {
                  const color = row.team?.kolor || 'var(--accent)';
                  const loadPct = Math.min(100, Math.round((row.loadMinutes / (8 * 60)) * 100));
                  const conflictCount = row.conflictIds.size;
                  const isDropTarget = dragOverTeamId === String(row.team?.id || '');
                  const livePoint = liveByTeam.get(String(row.team?.id || ''));
                  const liveStatus = gpsStatus(livePoint);
                  return (
                    <button
                      type="button"
                      key={row.team?.id || row.team?.nazwa}
                      style={{ ...styles.dispatchTeamCard, ...(isDropTarget ? styles.dispatchTeamCardDrop : {}) }}
                      data-testid="harmonogram-dispatch-team"
                      onClick={() => row.team?.id && setFiltrEkipa(String(row.team.id))}
                      onDragEnter={(event) => {
                        if (!canEdit || !row.team?.id) return;
                        event.preventDefault();
                        setDragOverTeamId(String(row.team.id));
                      }}
                      onDragOver={(event) => {
                        if (!canEdit) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDragLeave={() => {
                        if (isDropTarget) setDragOverTeamId('');
                      }}
                      onDrop={(event) => handleDropOnTeam(event, row.team?.id)}
                    >
                      <div style={styles.dispatchTeamTop}>
                        <span style={{ ...styles.dispatchTeamDot, background: color, boxShadow: `0 0 10px ${color}88` }} />
                        <div>
                          <strong style={styles.dispatchTeamName}>{row.team?.nazwa || 'Ekipa'}</strong>
                          <span style={styles.dispatchTeamMeta}>
                            {row.tasks.length} prac / {formatMinutesAsHours(row.loadMinutes)}
                          </span>
                        </div>
                      </div>
                      <div style={styles.dispatchLoadTrack}>
                        <span style={{ ...styles.dispatchLoadFill, width: `${loadPct}%`, background: color }} />
                      </div>
                      <div style={styles.dispatchTeamBadges}>
                        <span style={styles.dispatchBadge}>{loadPct}% dnia</span>
                        <span
                          style={{
                            ...styles.dispatchBadge,
                            color: liveStatus.color,
                            borderColor: liveStatus.border,
                            background: liveStatus.bg,
                          }}
                        >
                          {liveStatus.label} / {gpsSourceLabel(livePoint)}
                        </span>
                        {conflictCount ? <span style={{ ...styles.dispatchBadge, ...styles.dispatchBadgeDanger }}>konflikt {conflictCount}</span> : null}
                        {row.packageBlockedCount ? (
                          <span style={{ ...styles.dispatchBadge, ...styles.dispatchBadgeWarn }}>
                            braki: {row.firstMissing}
                          </span>
                        ) : (
                          <span style={{ ...styles.dispatchBadge, ...styles.dispatchBadgeOk }}>pakiet OK</span>
                        )}
                      </div>
                    </button>
                  );
                }) : (
                  <div style={styles.dispatchEmpty}>Brak ekip dla wybranego filtra.</div>
                )}
              </div>

              <aside style={styles.dispatchQueue} data-testid="harmonogram-dispatch-queue">
                <div style={styles.dispatchQueueHeader}>
                  <strong>Kolejka do dopiecia</strong>
                  <span>{dispatchQueue.length}</span>
                </div>
                <div style={styles.dispatchQueueList}>
                  {dispatchQueue.length ? dispatchQueue.map((task) => {
                    const readiness = getCrewPackageReadiness(task);
                    const missing = readiness.missingLabels.slice(0, 2).join(', ') || 'gotowe do planu';
                    return (
                      <button
                        type="button"
                        key={task.id}
                        style={styles.dispatchQueueItem}
                        data-testid="harmonogram-dispatch-queue-item"
                        draggable={canEdit}
                        onDragStart={(event) => {
                          if (!canEdit) return;
                          event.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id }));
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => setSelectedTaskId(String(task.id))}
                      >
                        <strong>{task.klient_nazwa || `Zlecenie #${task.id}`}</strong>
                        <span style={styles.dispatchQueueMeta}>
                          {task.ekipa_nazwa || 'bez ekipy'} / {taskDayKey(task) || 'bez terminu'}
                        </span>
                        <span style={readiness.ready ? styles.dispatchQueueOk : styles.dispatchQueueWarn}>
                          {readiness.ready ? 'Pakiet gotowy' : missing}
                        </span>
                      </button>
                    );
                  }) : (
                    <div style={styles.dispatchEmpty}>Nie ma nic pilnego w kolejce.</div>
                  )}
                </div>
              </aside>
            </div>
          </section>
        ) : null}

        {selectedTask ? (
          <section style={styles.quickPanel} data-testid="harmonogram-quick-panel">
            <div style={styles.quickPanelHead}>
              <div>
                <div style={styles.dispatchEyebrow}>Szybki pakiet zlecenia</div>
                <h3 style={styles.quickPanelTitle}>{selectedTask.klient_nazwa || `Zlecenie #${selectedTask.id}`}</h3>
                <p style={styles.quickPanelSubtitle}>{taskAddressLabel(selectedTask)}</p>
              </div>
              <button type="button" style={styles.quickCloseBtn} onClick={() => setSelectedTaskId('')}>
                Zamknij
              </button>
            </div>

            <div style={styles.quickGrid}>
              <div style={styles.quickField}>
                <span>Status</span>
                <strong>{selectedTask.status || '-'}</strong>
              </div>
              <div style={styles.quickField}>
                <span>Ekipa / termin</span>
                <strong>{selectedTask.ekipa_nazwa || 'bez ekipy'} / {taskDayKey(selectedTask) || 'bez terminu'} {formatBlockTime(selectedTask)}</strong>
              </div>
              <div style={styles.quickField}>
                <span>GPS ekipy</span>
                <strong style={{ color: selectedTaskGpsStatus.color }}>
                  {selectedTaskGpsStatus.label} / {selectedTaskGpsStatus.meta}
                </strong>
              </div>
              <div style={styles.quickField}>
                <span>Teren live</span>
                <strong style={selectedTaskWorkTelemetry.tone === 'ok' ? styles.quickOkText : selectedTaskWorkTelemetry.tone === 'warn' ? styles.quickWarnText : styles.quickDangerText}>
                  {selectedTaskTelemetryLoading ? 'Ladowanie...' : selectedTaskWorkTelemetry.label}
                </strong>
                <small style={styles.quickFieldMeta}>{selectedTaskWorkTelemetry.detail}</small>
              </div>
              <div style={styles.quickField}>
                <span>Zdjecia</span>
                <strong>{selectedTaskPhotos.length || taskPhotoCount(selectedTask)}</strong>
                <small style={styles.quickFieldMeta}>{selectedPhotoEvidenceReady}/6 typow pakietu</small>
              </div>
              <div style={styles.quickField}>
                <span>Budzet / czas</span>
                <strong>{taskBudgetLabel(selectedTask)} / {formatMinutesAsHours(taskDurationMinutes(selectedTask))}</strong>
              </div>
              <div style={styles.quickField}>
                <span>Sprzet</span>
                <strong>{taskEquipmentLabel(selectedTask)}</strong>
              </div>
              <div style={styles.quickField}>
                <span>Pakiet</span>
                <strong style={selectedOfficeMissingLabels.length ? styles.quickWarnText : styles.quickOkText}>
                  {selectedOfficeMissingLabels.length ? 'braki' : 'gotowy'}
                </strong>
              </div>
            </div>

            <div style={styles.quickTelemetryPanel}>
              <div style={styles.quickTelemetryHead}>
                <div>
                  <span style={styles.quickTelemetryEyebrow}>Kontrola wykonania</span>
                  <strong style={styles.quickTelemetryTitle}>Check-in, start pracy i dowody</strong>
                </div>
                <span
                  style={{
                    ...styles.dispatchBadge,
                    ...(selectedTaskWorkTelemetry.tone === 'ok'
                      ? styles.dispatchBadgeOk
                      : selectedTaskWorkTelemetry.tone === 'warn'
                        ? styles.dispatchBadgeWarn
                        : styles.dispatchBadgeDanger),
                  }}
                >
                  {selectedTaskTelemetryLoading ? 'sync' : selectedTaskWorkTelemetry.label}
                </span>
              </div>
              <div style={styles.quickTelemetryGrid}>
                <div style={styles.quickTelemetryItem}>
                  <span>Dojazd</span>
                  <strong>{formatClock(selectedTaskWorkTelemetry.checkin?.start_time)}</strong>
                </div>
                <div style={styles.quickTelemetryItem}>
                  <span>Start pracy</span>
                  <strong>{formatClock(selectedTaskWorkTelemetry.active?.start_time || selectedTaskWorkTelemetry.finished?.start_time)}</strong>
                </div>
                <div style={styles.quickTelemetryItem}>
                  <span>Koniec</span>
                  <strong>{formatClock(selectedTaskWorkTelemetry.finished?.end_time)}</strong>
                </div>
                <div style={styles.quickTelemetryItem}>
                  <span>Logi / zdjecia</span>
                  <strong>{selectedTaskLogi.length} / {selectedTaskPhotos.length}</strong>
                </div>
              </div>
              <div style={styles.quickPhotoStrip}>
                {selectedPhotoEvidence.map((item) => (
                  <span
                    key={item.key}
                    style={{
                      ...styles.quickPhotoChip,
                      ...(item.count ? styles.quickPhotoChipReady : styles.quickPhotoChipMissing),
                    }}
                  >
                    {item.label}: {item.count}
                  </span>
                ))}
              </div>
            </div>

            <div style={styles.quickBrief}>
              <span>Zakres / instrukcja dla ekipy</span>
              <p>{selectedTask.opis_pracy || selectedTask.opis || selectedTask.wynik || selectedTask.notatki_wewnetrzne || '-'}</p>
            </div>

            <div style={styles.quickMissingWrap}>
              {selectedOfficeMissingLabels.length ? selectedOfficeMissingLabels.map((label) => (
                <span key={label} style={{ ...styles.dispatchBadge, ...styles.dispatchBadgeWarn }}>{label}</span>
              )) : (
                <span style={{ ...styles.dispatchBadge, ...styles.dispatchBadgeOk }}>pakiet biura OK</span>
              )}
            </div>

            <div style={styles.quickActions}>
              <button type="button" style={styles.dispatchLinkBtn} onClick={copySelectedTaskBrief}>
                Kopiuj odprawe zlecenia
              </button>
              <button
                type="button"
                style={{
                  ...styles.addBtn,
                  ...(!selectedTask.ekipa_id ? styles.quickActionDisabled : {}),
                }}
                disabled={!selectedTask.ekipa_id}
                onClick={confirmSelectedForCrew}
              >
                Zatwierdz dla ekipy
              </button>
              <button type="button" style={styles.dispatchLinkBtn} onClick={() => navigate(`/zlecenia/${selectedTask.id}`)}>
                Otworz szczegoly
              </button>
            </div>
          </section>
        ) : null}

        {loading ? (
          <div style={styles.loading}>Ładowanie harmonogramu...</div>
        ) : (
          <div style={styles.calendarWrap}>
            {widok === 'dzien' && renderDzien([currentDate])}
            {widok === 'tydzien' && renderDzien(tydzien)}
            {widok === 'miesiac' && renderMiesiac()}
          </div>
        )}

        {/* Legenda */}
        <div style={styles.legenda}>
          {ekipy.filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial).length > 0 ? (
            <>
              <span style={styles.legendaTitle}>
                <GroupsOutlined style={{ fontSize: 16 }} aria-hidden />
                Ekipy:
              </span>
              {ekipy
                .filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial)
                .map(e => (
                  <div key={e.id} style={styles.legendaItem}>
                    <div style={{...styles.legendaDot, backgroundColor: e.kolor || 'var(--text-muted)', boxShadow: `0 0 6px ${e.kolor || '#94a3b8'}88`}} />
                    <span style={styles.legendaLabel}>{e.nazwa}</span>
                  </div>
                ))}
            </>
          ) : (
            <>
              <span style={styles.legendaTitle}>
                <CalendarMonthOutlined style={{ fontSize: 16 }} aria-hidden />
                Statusy:
              </span>
              {Object.entries(STATUS_KOLOR).map(([status, kolor]) => (
                <div key={status} style={styles.legendaItem}>
                  <div style={{...styles.legendaDot, backgroundColor: kolor}} />
                  <span style={styles.legendaLabel}>{status}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', background: 'transparent' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #0B3825 0%, #0F5F3A 58%, #168A4A 100%)',
    padding: '16px 18px',
    boxShadow: '0 22px 46px rgba(11,56,37,0.16)',
  },
  navRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  calTitle: { fontSize: 24, fontWeight: 950, color: '#FFFFFF', margin: 0, lineHeight: 1.15 },
  todayBtn: {
    minHeight: 36,
    padding: '7px 13px',
    background: '#FFFFFF',
    border: '1px solid rgba(255,255,255,0.26)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 900,
    color: '#0F5F3A',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    boxShadow: '0 14px 28px rgba(0,0,0,0.12)',
  },
  navBtn: {
    width: 36,
    height: 36,
    padding: 0,
    backgroundColor: 'rgba(255,255,255,0.11)',
    border: '1px solid rgba(255,255,255,0.22)',
    borderRadius: 8,
    cursor: 'pointer',
    color: '#FFFFFF',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  filtrSelect: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.28)', fontSize: 13, backgroundColor: '#FFFFFF', color: 'var(--text)', minHeight: 36, fontWeight: 800 },
  widokBtns: { display: 'flex', border: '1px solid rgba(255,255,255,0.24)', borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' },
  widokBtn: { padding: '8px 13px', border: 'none', borderRight: '1px solid rgba(255,255,255,0.18)', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 900, color: 'rgba(255,255,255,0.82)', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none' },
  widokBtnActive: { background: '#FFFFFF', color: '#0F5F3A', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)' },
  addBtn: {
    minHeight: 36,
    padding: '8px 15px',
    background: '#FFFFFF',
    color: '#0F5F3A',
    border: '1px solid rgba(255,255,255,0.28)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 900,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    boxShadow: '0 14px 28px rgba(0,0,0,0.12)',
  },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--surface-glass)' },
  calendarWrap: { background: 'var(--surface-raised)', border: '1px solid var(--glass-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', overflow: 'hidden', flex: 1, minHeight: 520 },
  readinessHint: { marginBottom: 10, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 },
  dispatchPanel: { border: '1px solid var(--glass-border)', borderRadius: 8, background: '#FFFFFF', boxShadow: 'var(--shadow-md)', padding: 14, marginBottom: 14 },
  dispatchHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  dispatchEyebrow: { fontSize: 10, fontWeight: 900, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0 },
  dispatchTitle: { margin: '2px 0 3px', color: 'var(--text)', fontSize: 18, fontWeight: 950, lineHeight: 1.15 },
  dispatchSubtitle: { margin: 0, color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, maxWidth: 720, lineHeight: 1.45 },
  dispatchHeadActions: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' },
  dispatchLinkBtn: { minHeight: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', color: 'var(--accent)', fontWeight: 900, fontSize: 12, padding: '7px 11px', cursor: 'pointer' },
  dispatchKpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 },
  dispatchKpi: { minHeight: 62, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-field)', padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: 'var(--shadow-sm)' },
  dispatchKpiWarn: { borderColor: 'rgba(245,158,11,0.42)', background: 'rgba(245,158,11,0.09)' },
  dispatchKpiDanger: { borderColor: 'rgba(239,68,68,0.46)', background: 'rgba(239,68,68,0.1)' },
  dispatchSlotBoard: { border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-field)', marginBottom: 12, overflowX: 'auto', boxShadow: 'var(--shadow-sm)' },
  dispatchSlotHeader: { display: 'grid', gridTemplateColumns: '180px minmax(780px, 1fr)', borderBottom: '1px solid var(--border)', minWidth: 960 },
  dispatchSlotHeaderTeam: { padding: '10px 12px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 950, textTransform: 'uppercase' },
  dispatchSlotHours: { display: 'grid', gridTemplateColumns: `repeat(${GODZINY.length}, minmax(72px, 1fr))` },
  dispatchSlotHourLabel: { minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 950 },
  dispatchSlotRows: { minWidth: 960 },
  dispatchSlotRow: { display: 'grid', gridTemplateColumns: '180px minmax(780px, 1fr)', borderBottom: '1px solid var(--border)' },
  dispatchSlotTeam: { display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', color: 'var(--text)', minHeight: 74 },
  dispatchSlotTeamName: { display: 'block', color: 'var(--text)', fontSize: 12, fontWeight: 950, lineHeight: 1.25 },
  dispatchSlotTeamMeta: { display: 'block', color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, marginTop: 2 },
  dispatchGpsPill: { display: 'inline-flex', alignItems: 'center', maxWidth: '100%', minHeight: 18, border: '1px solid', borderRadius: 999, padding: '1px 6px', marginTop: 5, fontSize: 9, fontWeight: 950, whiteSpace: 'nowrap' },
  dispatchSlotCells: { display: 'grid', gridTemplateColumns: `repeat(${GODZINY.length}, minmax(72px, 1fr))` },
  dispatchSlotCell: { minHeight: 74, borderLeft: '1px solid var(--border)', padding: 5, background: 'rgba(255,255,255,0.012)', display: 'flex', flexDirection: 'column', gap: 4, transition: 'all 0.15s ease' },
  dispatchSlotCellDrop: { background: 'rgba(34,197,94,0.12)', boxShadow: 'inset 0 0 0 2px rgba(34,197,94,0.38)' },
  dispatchSlotCellConflict: { background: 'rgba(239,68,68,0.08)' },
  dispatchSlotTask: { width: '100%', minHeight: 22, border: '1px solid', borderRadius: 7, background: 'var(--surface-field)', padding: '3px 5px', fontSize: 10, fontWeight: 950, textAlign: 'left', cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dispatchSlotMore: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 900, padding: '0 4px' },
  dispatchGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12, alignItems: 'stretch' },
  dispatchTeamsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, alignContent: 'start' },
  dispatchTeamCard: { textAlign: 'left', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-field)', color: 'var(--text)', padding: 12, cursor: 'pointer', boxShadow: 'var(--shadow-sm)', minHeight: 126 },
  dispatchTeamCardDrop: { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px rgba(34,197,94,0.22), var(--shadow-md)', transform: 'translateY(-1px)' },
  dispatchTeamTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  dispatchTeamDot: { width: 12, height: 12, borderRadius: '50%', flex: '0 0 auto' },
  dispatchTeamName: { display: 'block', fontSize: 13, fontWeight: 950, color: 'var(--text)', lineHeight: 1.2 },
  dispatchTeamMeta: { display: 'block', marginTop: 2, fontSize: 11, color: 'var(--text-muted)', fontWeight: 800 },
  dispatchLoadTrack: { height: 7, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden', marginBottom: 10 },
  dispatchLoadFill: { display: 'block', height: '100%', borderRadius: 999, minWidth: 2 },
  dispatchTeamBadges: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  dispatchBadge: { display: 'inline-flex', alignItems: 'center', minHeight: 20, border: '1px solid var(--border)', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', background: 'var(--surface-field)', maxWidth: '100%' },
  dispatchBadgeOk: { color: 'var(--accent)', borderColor: 'rgba(34,197,94,0.28)', background: 'rgba(34,197,94,0.12)' },
  dispatchBadgeWarn: { color: 'var(--warning)', borderColor: 'rgba(245,158,11,0.36)', background: 'rgba(245,158,11,0.12)' },
  dispatchBadgeDanger: { color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.38)', background: 'rgba(239,68,68,0.12)' },
  dispatchQueue: { border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-field)', padding: 12, minWidth: 0 },
  dispatchQueueHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, color: 'var(--text)', fontSize: 13, fontWeight: 950 },
  dispatchQueueList: { display: 'grid', gap: 8, maxHeight: 310, overflowY: 'auto', paddingRight: 2 },
  dispatchQueueItem: { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-field)', color: 'var(--text)', padding: 10, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 4, fontSize: 12 },
  dispatchQueueMeta: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 800 },
  dispatchQueueWarn: { color: 'var(--warning)', fontSize: 11, fontWeight: 900 },
  dispatchQueueOk: { color: 'var(--accent)', fontSize: 11, fontWeight: 900 },
  dispatchEmpty: { border: '1px dashed var(--border)', borderRadius: 10, padding: 12, color: 'var(--text-muted)', background: 'var(--surface-field)', fontSize: 12, fontWeight: 800 },
  quickPanel: { border: '1px solid var(--glass-border)', borderRadius: 12, background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)', padding: 14, marginBottom: 14 },
  quickPanelHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  quickPanelTitle: { margin: '2px 0 2px', color: 'var(--text)', fontSize: 17, fontWeight: 950, lineHeight: 1.15 },
  quickPanelSubtitle: { margin: 0, color: 'var(--text-muted)', fontSize: 12, fontWeight: 800 },
  quickCloseBtn: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', color: 'var(--text-muted)', padding: '7px 10px', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 10 },
  quickField: { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-field)', padding: '9px 10px', display: 'grid', gap: 3 },
  quickFieldMeta: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 800, lineHeight: 1.25 },
  quickTelemetryPanel: { border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-field)', padding: 12, marginBottom: 10, boxShadow: 'var(--shadow-sm)' },
  quickTelemetryHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  quickTelemetryEyebrow: { display: 'block', color: 'var(--text-muted)', fontSize: 10, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0 },
  quickTelemetryTitle: { display: 'block', color: 'var(--text)', fontSize: 13, fontWeight: 950, marginTop: 2 },
  quickTelemetryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 },
  quickTelemetryItem: { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-field)', padding: '8px 9px', display: 'grid', gap: 3 },
  quickPhotoStrip: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  quickPhotoChip: { display: 'inline-flex', alignItems: 'center', minHeight: 22, border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 950, background: 'var(--surface-field)' },
  quickPhotoChipReady: { color: 'var(--accent)', borderColor: 'rgba(34,197,94,0.28)', background: 'rgba(34,197,94,0.11)' },
  quickPhotoChipMissing: { color: 'var(--text-muted)', borderColor: 'rgba(148,163,184,0.22)', background: 'rgba(148,163,184,0.09)' },
  quickBrief: { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-field)', padding: '10px 12px', marginBottom: 10 },
  quickMissingWrap: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  quickActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  quickWarnText: { color: 'var(--warning)' },
  quickOkText: { color: 'var(--accent)' },
  quickDangerText: { color: 'var(--danger)' },
  quickActionDisabled: { opacity: 0.55, cursor: 'not-allowed', filter: 'grayscale(0.2)' },
  calBody: { display: 'flex', flexDirection: 'column', minHeight: 520, height: '100%' },
  timeGrid: { display: 'grid' },
  timeCorner: { position: 'sticky', top: 0, zIndex: 30, height: DAY_HEADER_HEIGHT, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--surface-field), var(--surface-glass))' },
  dayColHeader: { position: 'sticky', top: 0, zIndex: 20, height: DAY_HEADER_HEIGHT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' },
  dayColDow: { fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  dayColNum: { width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 900, marginTop: 4 },
  scrollArea: { overflowY: 'auto', flex: 1 },
  timeCol: { borderRight: '1px solid var(--border)' },
  timeSlot: { height: HOUR_SLOT_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 10, paddingTop: 6, borderBottom: '1px solid var(--border)' },
  timeLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800 },
  dayCol: { position: 'relative', borderRight: '1px solid var(--border)' },
  hourCell: { height: HOUR_SLOT_HEIGHT, borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s', background: 'rgba(255,255,255,0.012)' },
  zlecenieBlock: { position: 'absolute', left: 6, right: 6, borderRadius: 8, padding: '7px 8px', cursor: 'pointer', overflow: 'hidden', zIndex: 10, boxShadow: 'var(--shadow-sm)', transition: 'transform 0.15s', border: '1px solid var(--border)' },
  zlecenieBlockConflict: { boxShadow: '0 0 0 2px rgba(239,68,68,0.38), var(--shadow-md)', borderColor: 'rgba(239,68,68,0.62)' },
  nowLine: { position: 'absolute', left: 0, right: 0, borderTop: '2px dashed var(--danger)', zIndex: 9, pointerEvents: 'none' },
  nowDot: { position: 'absolute', left: -4, top: -5, width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--danger)' },
  blockTitle: { fontSize: 11, fontWeight: 900, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  blockSub: { fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 },
  blockBadges: { display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', overflow: 'hidden', maxHeight: 20 },
  blockBadge: { display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: 999, fontSize: 9, fontWeight: 900, lineHeight: '16px', whiteSpace: 'nowrap', border: '1px solid transparent' },
  blockBadgeOk: { backgroundColor: 'rgba(34,197,94,0.16)', color: 'var(--accent)', borderColor: 'rgba(34,197,94,0.28)' },
  blockBadgeWarn: { backgroundColor: 'rgba(245,158,11,0.16)', color: 'var(--warning)', borderColor: 'rgba(245,158,11,0.32)' },
  blockBadgeDanger: { backgroundColor: 'rgba(239,68,68,0.16)', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.34)' },
  blockBadgeNeutral: { backgroundColor: 'rgba(148,163,184,0.16)', color: 'var(--text-muted)', borderColor: 'rgba(148,163,184,0.24)' },
  miesiacGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, padding: 16, minHeight: 500 },
  miesiacHeader: { textAlign: 'center', fontSize: 12, fontWeight: 900, color: 'var(--text-muted)', padding: '6px 0', textTransform: 'uppercase' },
  miesiacEmpty: { minHeight: 100 },
  miesiacCell: { minHeight: 108, borderRadius: 8, padding: 8, cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.15s', background: 'var(--surface-field)' },
  miesiacNum: { fontSize: 13, marginBottom: 5, fontWeight: 900 },
  miesiacChip: { fontSize: 10, color: 'var(--on-accent)', padding: '3px 6px', borderRadius: 6, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 },
  miesiacMore: { fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 800 },
  legenda: { display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', alignItems: 'center', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--surface-glass)', padding: '10px 12px' },
  legendaTitle: { fontSize: 12, fontWeight: 900, color: 'var(--text-sub)', display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendaItem: { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 7px', background: 'var(--surface-field)' },
  legendaDot: { width: 10, height: 10, borderRadius: '50%' },
  legendaLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800 }
};
