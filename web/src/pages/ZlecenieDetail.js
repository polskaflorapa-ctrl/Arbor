import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AttachMoney from '@mui/icons-material/AttachMoney';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import FiberManualRecord from '@mui/icons-material/FiberManualRecord';
import HourglassEmptyOutlined from '@mui/icons-material/HourglassEmptyOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import LocalPhoneOutlined from '@mui/icons-material/LocalPhoneOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PendingOutlined from '@mui/icons-material/PendingOutlined';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SmsOutlined from '@mui/icons-material/SmsOutlined';
import SmartDisplayOutlined from '@mui/icons-material/SmartDisplayOutlined';
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined';
import TrendingDownOutlined from '@mui/icons-material/TrendingDownOutlined';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import api from '../api';
import CityInput from '../components/CityInput';
import ModernDataRow from '../components/ModernDataRow';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import TaskCommandCenter from '../components/TaskCommandCenter';
import TaskStatusIcon from '../components/TaskStatusIcon';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { canManageTaskKommo, canSendTaskSms, canViewFinance, readPermissions } from '../utils/permissions';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { telHref } from '../utils/telLink';
import { TASK_STATUSES, getTaskStatusColor, isTaskDone, taskMutationPayload } from '../utils/taskWorkflow';

const BASE = '';
const GPS_ONLINE_MINUTES = 5;
const GPS_STALE_MINUTES = 20;

/** Zgodnie z os/taskSettlement — FINISH_PHOTO_MIN */
const MIN_FINISH_TYP_PHOTOS = 2;
const PHOTO_EVIDENCE_TYPES = [
  { key: 'wycena', label: 'Wycena', hint: 'Widok drzewa i zakresu', requiredForField: true },
  { key: 'szkic', label: 'Szkic', hint: 'Rysunek ciecia / zakres', requiredForField: true },
  { key: 'dojazd', label: 'Dojazd', hint: 'Brama, posesja, dostep', requiredForField: true },
  { key: 'checkin', label: 'Check-in', hint: 'Potwierdzenie miejsca', requiredForField: false },
  { key: 'przed', label: 'Przed', hint: 'Stan przed praca', requiredForField: false },
  { key: 'po', label: 'Po', hint: 'Efekt po pracy', requiredForField: false },
  { key: 'inne', label: 'Inne', hint: 'Dodatkowy dowod', requiredForField: false },
];

function photoTypMatches(typ, allowed) {
  const t = String(typ ?? '')
    .trim()
    .toLowerCase();
  return allowed.some((a) => a.toLowerCase() === t);
}

function photoEvidenceKey(typ) {
  const t = String(typ ?? '')
    .trim()
    .toLowerCase();
  if (['wycena', 'estimate', 'oględziny', 'ogledziny'].includes(t)) return 'wycena';
  if (['szkic', 'sketch', 'rysunek'].includes(t)) return 'szkic';
  if (['dojazd', 'posesja', 'dojazd_posesja', 'access'].includes(t)) return 'dojazd';
  if (['checkin', 'check-in', 'check_in'].includes(t)) return 'checkin';
  if (['przed', 'before'].includes(t)) return 'przed';
  if (['po', 'after'].includes(t)) return 'po';
  return 'inne';
}

function isCheckinWorkLog(row) {
  const status = String(row?.status ?? row ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return status === 'check_in' || status === 'checkin';
}

function finiteCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapsUrl(lat, lng) {
  const latN = finiteCoord(lat);
  const lngN = finiteCoord(lng);
  if (latN == null || lngN == null) return '';
  return `https://maps.google.com/?q=${latN},${lngN}`;
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
    return { key: 'missing', label: 'GPS brak', meta: 'brak sygnalu', color: 'var(--text-muted)', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.28)' };
  }
  if (age <= GPS_ONLINE_MINUTES) {
    return { key: 'online', label: 'GPS online', meta: age <= 0 ? 'teraz' : `${age} min temu`, color: 'var(--success)', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.32)' };
  }
  if (age <= GPS_STALE_MINUTES) {
    return { key: 'stale', label: 'GPS opozniony', meta: `${age} min temu`, color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.34)' };
  }
  return { key: 'offline', label: 'GPS offline', meta: `${age} min temu`, color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.34)' };
}

function gpsSourceLabel(row) {
  if (!row) return 'brak';
  if (row.provider === 'mobile') return 'telefon';
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
  const value = Number(row?.accuracy_m);
  return Number.isFinite(value) ? `~${Math.round(value)} m` : 'brak';
}

function gpsPlatformLabel(row) {
  const platform = String(row?.platform || '').trim();
  const activity = String(row?.activity || '').trim();
  return [platform, activity].filter(Boolean).join(' / ') || 'brak';
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function taskGpsHistoryDate(task) {
  const raw = String(task?.data_planowana || task?.data_rozpoczecia || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return todayKey();
}

function buildTaskGpsHistoryParams(task, liveLocation, dateOverride) {
  const params = new URLSearchParams({
    date: dateOverride || taskGpsHistoryDate(task),
    limit: '360',
  });
  if (task?.ekipa_id) params.set('team_id', task.ekipa_id);
  else if (task?.wyceniajacy_id) params.set('user_id', task.wyceniajacy_id);
  else if (liveLocation?.user_id) params.set('user_id', liveLocation.user_id);
  else if (liveLocation?.vehicle_id) params.set('vehicle_id', liveLocation.vehicle_id);
  else if (liveLocation?.nr_rejestracyjny) params.set('plate_number', liveLocation.nr_rejestracyjny);
  else return null;
  return params;
}

function normalizeGpsHistoryRows(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return items
    .map((row) => ({
      ...row,
      lat: finiteCoord(row.lat),
      lng: finiteCoord(row.lng),
      speed_kmh: Number.isFinite(Number(row.speed_kmh)) ? Number(row.speed_kmh) : null,
      accuracy_m: Number.isFinite(Number(row.accuracy_m)) ? Number(row.accuracy_m) : null,
      battery_pct: Number.isFinite(Number(row.battery_pct)) ? Number(row.battery_pct) : null,
    }))
    .filter((row) => row.lat != null && row.lng != null)
    .sort((a, b) => new Date(a.recorded_at || 0).getTime() - new Date(b.recorded_at || 0).getTime());
}

function gpsHistoryRangeLabel(rows) {
  if (!rows.length) return 'brak danych';
  const first = rows[0]?.recorded_at;
  const last = rows[rows.length - 1]?.recorded_at;
  const fmt = (value) => value ? new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  return `${fmt(first)} - ${fmt(last)}`;
}

function gpsHistoryMaxSpeed(rows) {
  const max = rows.reduce((acc, row) => Math.max(acc, Number(row.speed_kmh) || 0), 0);
  return max ? `${Math.round(max)} km/h` : 'brak';
}

function gpsHistoryRouteUrl(rows) {
  if (!rows.length) return '';
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (rows.length < 2) return mapsUrl(last.lat, last.lng);
  return `https://www.google.com/maps/dir/?api=1&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}`;
}

function gpsPointLabel(row) {
  const time = row?.recorded_at ? new Date(row.recorded_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const speed = Number.isFinite(Number(row?.speed_kmh)) ? `${Math.round(Number(row.speed_kmh))} km/h` : 'predkosc b.d.';
  return `${time} / ${speed}`;
}

const PRIORYTET_KOLOR = {
  Niski: 'var(--text-muted)',
  Normalny: '#1d4ed8',
  Wysoki: '#b45309',
  Pilny: 'var(--danger)'
};

const SMS_SZABLONY = [
  { typ: 'zaplanowane', label: 'Potwierdzenie zlecenia' },
  { typ: 'w_drodze', label: 'Ekipa jest w drodze' },
  { typ: 'na_miejscu', label: 'Ekipa na miejscu' },
  { typ: 'zakonczone', label: 'Zlecenie zakończone' },
  { typ: 'przypomnienie', label: 'Przypomnienie o jutrzejszym zleceniu' },
];

function SmsTemplateIcon({ typ }) {
  const sx = { fontSize: 20, flexShrink: 0 };
  switch (typ) {
    case 'zaplanowane':
      return <EventAvailableOutlined sx={sx} />;
    case 'w_drodze':
      return <DirectionsCarOutlined sx={sx} />;
    case 'na_miejscu':
      return <PlaceOutlined sx={sx} />;
    case 'zakonczone':
      return <CheckCircleOutline sx={sx} />;
    case 'przypomnienie':
      return <NotificationsActiveOutlined sx={sx} />;
    default:
      return <SmsOutlined sx={sx} />;
  }
}

function isActiveEquipmentReservation(row) {
  const status = String(row?.status || '').toLowerCase();
  return !status.includes('anul') && !status.includes('zwr');
}

function equipmentDisplayName(row) {
  return [row?.sprzet_typ, row?.sprzet_nazwa || (row?.sprzet_id ? `Sprzet #${row.sprzet_id}` : '')]
    .filter(Boolean)
    .join(' - ') || 'Sprzet';
}

export default function ZlecenieDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef();
  const videoInputRef = useRef();
  const documentInputRef = useRef();
  const [zlecenie, setZlecenie] = useState(null);
  const [workLogs, setWorkLogs] = useState([]);
  const [liveLocation, setLiveLocation] = useState(null);
  const [gpsHistory, setGpsHistory] = useState([]);
  const [gpsHistoryDate, setGpsHistoryDate] = useState('');
  const [gpsHistoryLoading, setGpsHistoryLoading] = useState(false);
  const [gpsHistoryError, setGpsHistoryError] = useState('');
  const [issues, setIssues] = useState([]);
  const [zdjecia, setZdjecia] = useState([]);
  const [wideo, setWideo] = useState([]);
  const [dokumenty, setDokumenty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('szczegoly');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [typZdjecia, setTypZdjecia] = useState('przed');
  const [uploadPhotoOpis, setUploadPhotoOpis] = useState('');
  const [uploadPhotoTagi, setUploadPhotoTagi] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [mediaEvidenceFilter, setMediaEvidenceFilter] = useState('all');
  const [mediaSort, setMediaSort] = useState('newest');
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaTagsInput, setMediaTagsInput] = useState('');
  const [mediaOpisInput, setMediaOpisInput] = useState('');
  const [savingMediaMeta, setSavingMediaMeta] = useState(false);
  const [sendingSms, setSendingSms] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [dniowki, setDniowki] = useState([]);
  const [workflowChecklist, setWorkflowChecklist] = useState([]);
  const [workflowReminders, setWorkflowReminders] = useState([]);
  const [workflowEvents, setWorkflowEvents] = useState([]);
  const [workflowSla, setWorkflowSla] = useState({ checklist_done: 0, checklist_total: 0, reminders_overdue: 0 });
  const [checklistInput, setChecklistInput] = useState('');
  const [reminderTitleInput, setReminderTitleInput] = useState('');
  const [reminderDueInput, setReminderDueInput] = useState('');
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [docCategoryInput, setDocCategoryInput] = useState('protokol');
  const [docStatusInput, setDocStatusInput] = useState('roboczy');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [documentOpisInput, setDocumentOpisInput] = useState('');
  const [savingDocumentMeta, setSavingDocumentMeta] = useState(false);
  const [integrationSettings, setIntegrationSettings] = useState({ sms: true, email: true, push: true, auto_on_status: true, auto_on_reminder: true });
  const [integrationLogs, setIntegrationLogs] = useState([]);
  const [taskKommoPayload, setTaskKommoPayload] = useState(null);
  const [loadingTaskKommoPayload, setLoadingTaskKommoPayload] = useState(false);
  const [pushingTaskKommo, setPushingTaskKommo] = useState(false);
  const [showTaskKommoPayload, setShowTaskKommoPayload] = useState(false);
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [finishPayForm, setFinishPayForm] = useState({
    forma_platnosc: 'Gotowka',
    kwota_odebrana: '',
    faktura_vat: false,
    nip: '',
  });
  const [finishNotatki, setFinishNotatki] = useState('');
  const [finishUsageNazwa, setFinishUsageNazwa] = useState('');
  const [finishUsageIlosc, setFinishUsageIlosc] = useState('');
  const [finishUsageKoszt, setFinishUsageKoszt] = useState('');
  const [finishOperationalCosts, setFinishOperationalCosts] = useState({
    sprzet: '',
    paliwo: '',
    utylizacja: '',
    inne: '',
  });
  const [finishCostSuggestions, setFinishCostSuggestions] = useState(null);
  const [finishCostSuggestionsLoading, setFinishCostSuggestionsLoading] = useState(false);
  const [finishSubmitting, setFinishSubmitting] = useState(false);

  const isBrygadzista = currentUser?.rola === 'Brygadzista';
  const isPomocnik = currentUser?.rola === 'Pomocnik';
  const isEkipa = isBrygadzista || isPomocnik;
  const canEdit = !isBrygadzista && !isPomocnik;
  const permissions = useMemo(() => readPermissions(), [currentUser?.rola]);
  const canSeeFinance = canViewFinance(currentUser, permissions);
  const canUseTaskSms = canSendTaskSms(currentUser);
  const canUseTaskKommo = canManageTaskKommo(currentUser);

 useEffect(() => {
  const token = getStoredToken();
  if (!token) { navigate('/'); return; }
  const u = getLocalStorageJson('user');
  if (u) setCurrentUser(u);
  setShowTaskKommoPayload(false);
  setTaskKommoPayload(null);
  loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [id]);

  const loadAll = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [zRes, wRes, iRes, pRes, vRes, dRes, wfRes, docsRes, intRes, liveRes] = await Promise.all([
        api.get(`/tasks/${id}`, { headers: h }),
        api.get(`/tasks/${id}/logi`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/problemy`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/zdjecia`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/wideo`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/dniowki/zlecenie/${id}`, { headers: h }).catch(() => ({ data: { dniowki: [] } })),
        api.get(`/tasks/${id}/workflow`, { headers: h }).catch(() => ({ data: { checklist: [], reminders: [], events: [], sla: { checklist_done: 0, checklist_total: 0, reminders_overdue: 0 } } })),
        api.get(`/tasks/${id}/dokumenty`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/integrations`, { headers: h }).catch(() => ({ data: { settings: { sms: true, email: true, push: true, auto_on_status: true, auto_on_reminder: true }, logs: [] } })),
        api.get('/ekipy/live-locations', { headers: h, dedupe: false }).catch(() => ({ data: { items: [] } })),
      ]);
      const taskData = zRes.data;
      const liveRows = Array.isArray(liveRes.data) ? liveRes.data : liveRes.data?.items || [];
      const taskLive = liveRows.find((row) => taskData?.ekipa_id && String(row?.ekipa_id || '') === String(taskData.ekipa_id))
        || liveRows.find((row) => taskData?.wyceniajacy_id && String(row?.wyceniajacy_id || row?.user_id || '') === String(taskData.wyceniajacy_id))
        || null;
      setZlecenie(taskData);
      setEditForm(taskData);
      setLiveLocation(taskLive);
      void loadGpsHistory(taskData, taskLive, h, taskGpsHistoryDate(taskData));
      setWorkLogs(wRes.data);
      setIssues(iRes.data);
      setZdjecia(Array.isArray(pRes.data) ? pRes.data : []);
      setWideo(Array.isArray(vRes.data) ? vRes.data : []);
      setDniowki(dRes.data?.dniowki || []);
      setWorkflowChecklist(Array.isArray(wfRes.data?.checklist) ? wfRes.data.checklist : []);
      setWorkflowReminders(Array.isArray(wfRes.data?.reminders) ? wfRes.data.reminders : []);
      setWorkflowEvents(Array.isArray(wfRes.data?.events) ? wfRes.data.events : []);
      setWorkflowSla(wfRes.data?.sla || { checklist_done: 0, checklist_total: 0, reminders_overdue: 0 });
      setDokumenty(Array.isArray(docsRes.data) ? docsRes.data : []);
      setIntegrationSettings(intRes.data?.settings || { sms: true, email: true, push: true, auto_on_status: true, auto_on_reminder: true });
      setIntegrationLogs(Array.isArray(intRes.data?.logs) ? intRes.data.logs : []);
    } catch (err) {
      console.error('Błąd ładowania:', err);
      setLiveLocation(null);
      setGpsHistory([]);
      setGpsHistoryError('');
      showMsg(errorMessage('Błąd ładowania danych'));
    } finally {
      setLoading(false);
    }
  };

  const loadGpsHistory = async (taskArg = zlecenie, liveArg = liveLocation, headersArg = null, dateArg = null) => {
    const date = dateArg || gpsHistoryDate || taskGpsHistoryDate(taskArg);
    const params = buildTaskGpsHistoryParams(taskArg, liveArg, date);
    setGpsHistoryDate(date);
    if (!params) {
      setGpsHistory([]);
      setGpsHistoryError('Brak ekipy, uzytkownika albo pojazdu do historii GPS.');
      setGpsHistoryLoading(false);
      return;
    }

    setGpsHistoryLoading(true);
    setGpsHistoryError('');
    try {
      const token = getStoredToken();
      const headers = headersArg || authHeaders(token);
      const { data } = await api.get(`/ekipy/gps-history?${params.toString()}`, {
        headers,
        dedupe: false,
      });
      setGpsHistory(normalizeGpsHistoryRows(data));
      if (data?.date) setGpsHistoryDate(data.date);
    } catch (err) {
      setGpsHistory([]);
      setGpsHistoryError(getApiErrorMessage(err, 'Nie udalo sie pobrac historii GPS dla zlecenia.'));
    } finally {
      setGpsHistoryLoading(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const token = getStoredToken();
      const {
        ekipa_nazwa: _en,
        oddzial_nazwa: _on,
        kierownik_nazwa: _kn,
        wyceniajacy_nazwa: _wn,
        zatwierdzone_przez_nazwa: _zn,
        ...payload
      } = editForm;
      await api.put(`/tasks/${id}`, payload, {
        headers: authHeaders(token)
      });
      showMsg(successMessage('Zapisano zmiany!'));
      setEditMode(false);
      loadAll();
    } catch (err) {
      showMsg(errorMessage('Błąd zapisu'));
    } finally {
      setSaving(false);
    }
  };

  const zmienStatus = async (status) => {
    try {
      const token = getStoredToken();
      const { data } = await api.put(`/tasks/${id}/status`, { status }, {
        headers: authHeaders(token)
      });
      setZlecenie((prev) => ({
        ...(prev || {}),
        ...taskMutationPayload(data),
        id: data?.id || prev?.id || Number(id),
        status: data?.status || status,
      }));
      showMsg(successMessage(`Status zmieniony na ${status}`));
      loadAll();
    } catch (err) {
      showMsg(errorMessage('Błąd zmiany statusu'));
    }
  };

  const wyslijSms = async (typ) => {
    setSendingSms(typ);
    try {
      const token = getStoredToken();
      await api.post(`/sms/zlecenie/${id}`, { typ }, { headers: authHeaders(token) });
      showMsg(successMessage('SMS wysłany do klienta!'));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd wysyłania SMS')));
    } finally {
      setSendingSms('');
    }
  };

  const pobierzPdf = async () => {
    try {
      const res = await api.get(`/pdf/zlecenie/${id}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `zlecenie-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udało się pobrać PDF.')));
    }
  };

  const loadTaskKommoPayload = async () => {
    setLoadingTaskKommoPayload(true);
    try {
      const token = getStoredToken();
      const res = await api.get(`/tasks/${id}/kommo-payload`, { headers: authHeaders(token) });
      setTaskKommoPayload(res.data);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, t('kommoCrm.payloadError'))));
    } finally {
      setLoadingTaskKommoPayload(false);
    }
  };

  const pushTaskKommo = async () => {
    setPushingTaskKommo(true);
    try {
      const token = getStoredToken();
      const res = await api.post(`/tasks/${id}/kommo-push`, {}, { headers: authHeaders(token) });
      if (res.data?.ok) {
        showMsg(successMessage(t('kommoCrm.pushSuccess')));
        await loadAll();
        setTaskKommoPayload(null);
      } else {
        showMsg(errorMessage(res.data?.error || t('kommoCrm.pushError')));
      }
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, t('kommoCrm.pushError'))));
    } finally {
      setPushingTaskKommo(false);
    }
  };

  const toggleTaskKommoPayload = async () => {
    if (showTaskKommoPayload) {
      setShowTaskKommoPayload(false);
      return;
    }
    setShowTaskKommoPayload(true);
    await loadTaskKommoPayload();
  };

  const uploadZdjecie = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const token = getStoredToken();
      const formData = new FormData();
      formData.append('zdjecie', file);
      formData.append('typ', typZdjecia);
      const note = uploadPhotoOpis.trim().slice(0, 4000);
      if (note) formData.append('opis', note);
      const tagsCsv = uploadPhotoTagi.trim();
      if (tagsCsv) formData.append('tagi', tagsCsv.slice(0, 2000));
      await api.post(`/tasks/${id}/zdjecia`, formData, {
        headers: { ...authHeaders(token), 'Content-Type': 'multipart/form-data' }
      });
      showMsg(successMessage('Zdjęcie dodane!'));
      setUploadPhotoOpis('');
      setUploadPhotoTagi('');
      loadAll();
    } catch (err) {
      showMsg(errorMessage('Błąd uploadu zdjęcia'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const uploadWideo = async (file) => {
    if (!file) return;
    setUploadingVideo(true);
    try {
      const token = getStoredToken();
      const formData = new FormData();
      formData.append('wideo', file);
      await api.post(`/tasks/${id}/wideo`, formData, {
        headers: { ...authHeaders(token), 'Content-Type': 'multipart/form-data' }
      });
      showMsg(successMessage('Film dodany!'));
      loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd uploadu filmu')));
    } finally {
      setUploadingVideo(false);
    }
  };

  const refreshMediaEditor = (media) => {
    setMediaOpisInput(media?.opis || '');
    setMediaTagsInput(Array.isArray(media?.tagi) ? media.tagi.join(', ') : '');
  };

  const savePhotoMeta = async () => {
    if (!selectedPhoto) return;
    setSavingMediaMeta(true);
    try {
      const token = getStoredToken();
      await api.patch(
        `/tasks/${id}/zdjecia/${selectedPhoto.id}`,
        { opis: mediaOpisInput, tagi: mediaTagsInput },
        { headers: authHeaders(token) }
      );
      showMsg(successMessage('Zapisano metadane zdjęcia.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd zapisu metadanych zdjęcia')));
    } finally {
      setSavingMediaMeta(false);
    }
  };

  const saveVideoMeta = async () => {
    if (!selectedVideo) return;
    setSavingMediaMeta(true);
    try {
      const token = getStoredToken();
      await api.patch(
        `/tasks/${id}/wideo/${selectedVideo.id}`,
        { opis: mediaOpisInput, tagi: mediaTagsInput },
        { headers: authHeaders(token) }
      );
      showMsg(successMessage('Zapisano metadane filmu.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd zapisu metadanych filmu')));
    } finally {
      setSavingMediaMeta(false);
    }
  };

  const deletePhoto = async (photoId) => {
    const ok = window.confirm('Usunac to zdjecie?');
    if (!ok) return;
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}/zdjecia/${photoId}`, { headers: authHeaders(token) });
      if (selectedPhoto?.id === photoId) setSelectedPhoto(null);
      showMsg(successMessage('Zdjęcie usunięte.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd usuwania zdjęcia')));
    }
  };

  const deleteVideo = async (videoId) => {
    const ok = window.confirm('Usunac ten film?');
    if (!ok) return;
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}/wideo/${videoId}`, { headers: authHeaders(token) });
      if (selectedVideo?.id === videoId) setSelectedVideo(null);
      showMsg(successMessage('Film usunięty.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd usuwania filmu')));
    }
  };

  const addChecklistItem = async () => {
    const text = checklistInput.trim();
    if (!text) return;
    try {
      const token = getStoredToken();
      await api.post(`/tasks/${id}/workflow/checklist`, { text }, { headers: authHeaders(token) });
      setChecklistInput('');
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd dodawania checklisty')));
    }
  };

  const toggleChecklistItem = async (item) => {
    try {
      const token = getStoredToken();
      await api.patch(`/tasks/${id}/workflow/checklist/${item.id}`, { done: !item.done }, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd aktualizacji checklisty')));
    }
  };

  const removeChecklistItem = async (itemId) => {
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}/workflow/checklist/${itemId}`, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd usuwania checklisty')));
    }
  };

  const addReminder = async () => {
    const title = reminderTitleInput.trim();
    if (!title) return;
    try {
      const token = getStoredToken();
      await api.post(
        `/tasks/${id}/workflow/reminders`,
        { title, due_at: reminderDueInput ? new Date(reminderDueInput).toISOString() : null },
        { headers: authHeaders(token) }
      );
      setReminderTitleInput('');
      setReminderDueInput('');
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd dodawania przypomnienia')));
    }
  };

  const toggleReminderDone = async (item) => {
    try {
      const token = getStoredToken();
      await api.patch(`/tasks/${id}/workflow/reminders/${item.id}`, { done: !item.done }, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd aktualizacji przypomnienia')));
    }
  };

  const removeReminder = async (itemId) => {
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}/workflow/reminders/${itemId}`, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd usuwania przypomnienia')));
    }
  };

  const uploadDocument = async (file) => {
    if (!file) return;
    setUploadingDocument(true);
    try {
      const token = getStoredToken();
      const formData = new FormData();
      formData.append('dokument', file);
      formData.append('kategoria', docCategoryInput);
      formData.append('status', docStatusInput);
      await api.post(`/tasks/${id}/dokumenty`, formData, {
        headers: { ...authHeaders(token), 'Content-Type': 'multipart/form-data' }
      });
      showMsg(successMessage('Dokument dodany.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd uploadu dokumentu')));
    } finally {
      setUploadingDocument(false);
    }
  };

  const saveDocumentMeta = async () => {
    if (!selectedDocument) return;
    setSavingDocumentMeta(true);
    try {
      const token = getStoredToken();
      await api.patch(
        `/tasks/${id}/dokumenty/${selectedDocument.id}`,
        { opis: documentOpisInput, kategoria: docCategoryInput, status: docStatusInput },
        { headers: authHeaders(token) }
      );
      showMsg(successMessage('Zapisano metadane dokumentu.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd zapisu dokumentu')));
    } finally {
      setSavingDocumentMeta(false);
    }
  };

  const bumpDocumentVersion = async (docId) => {
    try {
      const token = getStoredToken();
      await api.patch(`/tasks/${id}/dokumenty/${docId}`, { bump_version: true }, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd wersjonowania dokumentu')));
    }
  };

  const deleteDocument = async (docId) => {
    const ok = window.confirm('Usunac ten dokument?');
    if (!ok) return;
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}/dokumenty/${docId}`, { headers: authHeaders(token) });
      if (selectedDocument?.id === docId) setSelectedDocument(null);
      showMsg(successMessage('Dokument usunięty.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd usuwania dokumentu')));
    }
  };

  const updateIntegrationSetting = async (key, value) => {
    try {
      const token = getStoredToken();
      await api.patch(`/tasks/${id}/integrations/settings`, { [key]: value }, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Błąd zapisu ustawień integracji')));
    }
  };

  const sendIntegrationTest = async (channel) => {
    try {
      const token = getStoredToken();
      await api.post(
        `/tasks/${id}/integrations/send-test`,
        { channel, title: `Test ${channel.toUpperCase()} ze zlecenia` },
        { headers: authHeaders(token) }
      );
      showMsg(successMessage(`Test ${channel.toUpperCase()} wysłany.`));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, `Błąd testu ${channel.toUpperCase()}`)));
    }
  };

  const formatDate = (d) => d ? d.split('T')[0] : '-';
  const formatDateTime = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('pl-PL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };
  const formatMinutes = (min) => {
    if (!min) return '0h 0min';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}h ${m}min`;
  };
  const formatCurrency = (value) => {
    if (!value) return '0 PLN';
    return parseFloat(value).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN';
  };

  const lacznie = workLogs.reduce((s, w) => s + (parseFloat(w.duration_hours) * 60 || parseFloat(w.czas_pracy_minuty) || 0), 0);
  const wartosc = parseFloat(zlecenie?.wartosc_planowana || 0);
  const kosztRobocizny = (lacznie / 60) * 45 * 3;
  const marza = wartosc - kosztRobocizny;
  const marzaProcent = wartosc > 0 ? ((marza / wartosc) * 100).toFixed(1) : 0;

  const mediaSearchNorm = mediaSearch.trim().toLowerCase();
  const mediaSortFactor = mediaSort === 'oldest' ? 1 : -1;
  const photoEvidenceCounts = useMemo(() => {
    const counts = Object.fromEntries(PHOTO_EVIDENCE_TYPES.map((type) => [type.key, 0]));
    for (const photo of zdjecia) {
      const key = photoEvidenceKey(photo?.typ);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [zdjecia]);
  const photoEvidenceRequiredTypes = useMemo(() => (
    PHOTO_EVIDENCE_TYPES.filter((type) => {
      if (type.requiredForField) return true;
      if (type.key === 'przed') return !!zlecenie?.finish_requirements?.require_przed_photo || zlecenie?.status === 'W_Realizacji';
      if (type.key === 'po') return !!zlecenie?.finish_requirements?.require_po_photo || zlecenie?.status === 'W_Realizacji';
      return false;
    })
  ), [zlecenie?.finish_requirements?.require_po_photo, zlecenie?.finish_requirements?.require_przed_photo, zlecenie?.status]);
  const photoEvidenceMissingTypes = photoEvidenceRequiredTypes.filter((type) => !photoEvidenceCounts[type.key]);
  const photoEvidenceReadyCount = photoEvidenceRequiredTypes.length - photoEvidenceMissingTypes.length;
  const photoEvidencePct = photoEvidenceRequiredTypes.length
    ? Math.round((photoEvidenceReadyCount / photoEvidenceRequiredTypes.length) * 100)
    : 100;
  const filteredPhotos = zdjecia
    .filter((x) => mediaTypeFilter === 'all' || mediaTypeFilter === 'photos')
    .filter((x) => mediaEvidenceFilter === 'all' || photoEvidenceKey(x?.typ) === mediaEvidenceFilter)
    .filter((x) => {
      if (!mediaSearchNorm) return true;
      const pool = [x.typ, x.autor, x.opis, ...(x.tagi || [])].filter(Boolean).join(' ').toLowerCase();
      return pool.includes(mediaSearchNorm);
    })
    .slice()
    .sort((a, b) => (new Date(a.created_at || a.data_dodania).getTime() - new Date(b.created_at || b.data_dodania).getTime()) * mediaSortFactor);
  const filteredVideos = wideo
    .filter((x) => mediaTypeFilter === 'all' || mediaTypeFilter === 'videos')
    .filter((x) => {
      if (!mediaSearchNorm) return true;
      const pool = [x.nazwa, x.autor, x.opis, ...(x.tagi || [])].filter(Boolean).join(' ').toLowerCase();
      return pool.includes(mediaSearchNorm);
    })
    .slice()
    .sort((a, b) => (new Date(a.created_at || a.data_dodania).getTime() - new Date(b.created_at || b.data_dodania).getTime()) * mediaSortFactor);
  const filteredPhotoIds = new Set(filteredPhotos.map((photo) => String(photo.id)));
  const photoEvidenceSections = PHOTO_EVIDENCE_TYPES
    .map((type) => ({
      ...type,
      photos: zdjecia.filter((photo) => photoEvidenceKey(photo?.typ) === type.key && filteredPhotoIds.has(String(photo.id))),
      total: photoEvidenceCounts[type.key] || 0,
    }))
    .filter((section) => section.photos.length > 0);
  const equipmentReservations = useMemo(
    () => Array.isArray(zlecenie?.equipment_reservations) ? zlecenie.equipment_reservations : [],
    [zlecenie]
  );
  const activeEquipmentReservations = useMemo(
    () => equipmentReservations.filter(isActiveEquipmentReservation),
    [equipmentReservations]
  );
  const latestCheckin = useMemo(() => {
    const rows = workLogs
      .filter(isCheckinWorkLog)
      .slice()
      .sort((a, b) => new Date(b.start_time || b.created_at || 0).getTime() - new Date(a.start_time || a.created_at || 0).getTime());
    return rows[0] || null;
  }, [workLogs]);
  const checkinPhoto = useMemo(
    () => zdjecia.find((photo) => photoTypMatches(photo?.typ, ['checkin'])) || null,
    [zdjecia]
  );
  const latestCheckinMapUrl = latestCheckin
    ? mapsUrl(latestCheckin.start_lat ?? latestCheckin.end_lat, latestCheckin.start_lng ?? latestCheckin.end_lng)
    : '';
  const liveStatus = gpsStatus(liveLocation);
  const liveMapUrl = liveLocation ? mapsUrl(liveLocation.lat, liveLocation.lng) : '';
  const gpsHistoryPreview = useMemo(() => gpsHistory.slice(-5).reverse(), [gpsHistory]);
  const gpsHistoryMapUrl = useMemo(() => gpsHistoryRouteUrl(gpsHistory), [gpsHistory]);

  const finishRequirements = useMemo(() => {
    const raw = zlecenie?.finish_requirements;
    const countPo = zdjecia.filter((z) => photoTypMatches(z?.typ, ['po', 'after'])).length;
    const countPrzed = zdjecia.filter((z) =>
      photoTypMatches(z?.typ, ['przed', 'before', 'checkin'])
    ).length;
    const hasPoLocal = countPo >= MIN_FINISH_TYP_PHOTOS;
    const hasPrzedLocal = countPrzed >= MIN_FINISH_TYP_PHOTOS;
    if (raw && typeof raw.require_po_photo === 'boolean') {
      return {
        require_po_photo: !!raw.require_po_photo,
        require_przed_photo: !!raw.require_przed_photo,
        require_material_usage: !!raw.require_material_usage,
        has_po_photo: !!raw.has_po_photo || hasPoLocal,
        has_przed_photo: !!raw.has_przed_photo || hasPrzedLocal,
      };
    }
    return {
      require_po_photo: false,
      require_przed_photo: false,
      require_material_usage: false,
      has_po_photo: hasPoLocal,
      has_przed_photo: hasPrzedLocal,
    };
  }, [zlecenie, zdjecia]);

  const activeWorkLog = workLogs.find((w) => w.end_time == null || w.end_time === '');
  const finishPhotoBlocked =
    (finishRequirements.require_po_photo && !finishRequirements.has_po_photo) ||
    (finishRequirements.require_przed_photo && !finishRequirements.has_przed_photo);

  const loadFinishCostSuggestions = async () => {
    setFinishCostSuggestionsLoading(true);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/tasks/${id}/finish-cost-suggestions`, { headers: authHeaders(token) });
      setFinishCostSuggestions(data);
      return data;
    } catch {
      setFinishCostSuggestions(null);
      return null;
    } finally {
      setFinishCostSuggestionsLoading(false);
    }
  };

  const suggestedFinishCosts = (suggestions = finishCostSuggestions) => {
    const next = { sprzet: '', paliwo: '', utylizacja: '', inne: '' };
    for (const item of suggestions?.suggestions || []) {
      const amount = Number(item?.amount);
      if (Object.prototype.hasOwnProperty.call(next, item?.category) && Number.isFinite(amount) && amount > 0) {
        next[item.category] = String(amount);
      }
    }
    return next;
  };

  const openFinishModal = () => {
    if (finishPhotoBlocked) {
      const missing = [];
      if (finishRequirements.require_po_photo && !finishRequirements.has_po_photo) {
        missing.push('co najmniej 2 zdjęcia typu Po');
      }
      if (finishRequirements.require_przed_photo && !finishRequirements.has_przed_photo) {
        missing.push('co najmniej 2 zdjęcia Przed / check-in');
      }
      showMsg(errorMessage(`Przed zakończeniem uzupełnij: ${missing.join(', ')}.`));
      return;
    }
    const defKwota = zlecenie?.wartosc_rzeczywista ?? zlecenie?.wartosc_planowana ?? '';
    setFinishPayForm({
      forma_platnosc: 'Gotowka',
      kwota_odebrana: defKwota !== '' && defKwota != null ? String(defKwota) : '',
      faktura_vat: false,
      nip: '',
    });
    setFinishNotatki('');
    setFinishUsageNazwa('');
    setFinishUsageIlosc('');
    setFinishUsageKoszt('');
    setFinishOperationalCosts({ sprzet: '', paliwo: '', utylizacja: '', inne: '' });
    setFinishCostSuggestions(null);
    setFinishModalOpen(true);
    void loadFinishCostSuggestions().then((data) => {
      const next = suggestedFinishCosts(data);
      if (Object.values(next).some(Boolean)) setFinishOperationalCosts(next);
    });
  };

  const submitFinish = async () => {
    const { forma_platnosc, kwota_odebrana, faktura_vat, nip } = finishPayForm;
    const parseOptionalFinishMoney = (value, label) => {
      const raw = String(value || '').trim().replace(',', '.');
      if (!raw) return null;
      const parsed = parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        showMsg(errorMessage(`Podaj poprawny koszt: ${label}.`));
        return false;
      }
      return Math.round(parsed * 100) / 100;
    };
    if (forma_platnosc === 'Gotowka') {
      const k = parseFloat(String(kwota_odebrana).replace(',', '.'));
      if (!Number.isFinite(k) || k < 0) {
        showMsg(errorMessage('Podaj kwotę odebraną (gotówka).'));
        return;
      }
    }
    if (faktura_vat || forma_platnosc === 'Faktura_VAT') {
      const n = String(nip || '').replace(/\s/g, '');
      if (n.length < 10) {
        showMsg(errorMessage('Podaj NIP przy fakturze VAT.'));
        return;
      }
    }
    if (finishRequirements.require_material_usage && !finishUsageNazwa.trim()) {
      showMsg(errorMessage('Podaj nazwę zużytego materiału (wymóg serwera).'));
      return;
    }
    const usageCost = parseOptionalFinishMoney(finishUsageKoszt, 'materialy');
    if (usageCost === false) return;
    const costLabels = {
      sprzet: 'sprzet',
      paliwo: 'paliwo',
      utylizacja: 'utylizacja',
      inne: 'inne',
    };
    const koszty_operacyjne = [];
    for (const [category, value] of Object.entries(finishOperationalCosts)) {
      const amount = parseOptionalFinishMoney(value, costLabels[category] || category);
      if (amount === false) return;
      if (amount != null) {
        koszty_operacyjne.push({
          category,
          amount,
          label: costLabels[category] || category,
          source: 'web_finish',
        });
      }
    }
    setFinishSubmitting(true);
    try {
      const token = getStoredToken();
      let lat = null;
      let lng = null;
      if (navigator.geolocation) {
        await new Promise((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const tid = setTimeout(done, 11000);
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(tid);
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
              done();
            },
            () => {
              clearTimeout(tid);
              done();
            },
            { timeout: 10000, maximumAge: 120000 }
          );
        });
      }
      const noteTrim = finishNotatki.trim();
      const usageNazwa = finishUsageNazwa.trim();
      const usageIloscRaw = finishUsageIlosc.trim().replace(',', '.');
      const usageIlosc = usageNazwa && usageIloscRaw ? parseFloat(usageIloscRaw) : NaN;
      const zuzyte_materialy =
        usageNazwa.length > 0
          ? [
              {
                nazwa: usageNazwa.slice(0, 200),
                ...(Number.isFinite(usageIlosc) ? { ilosc: usageIlosc, jednostka: 'szt' } : {}),
                ...(usageCost != null ? { koszt_laczny: usageCost } : {}),
              },
            ]
          : undefined;
      await api.post(
        `/tasks/${id}/finish`,
        {
          lat,
          lng,
          notatki: noteTrim || undefined,
          ...(zuzyte_materialy ? { zuzyte_materialy } : {}),
          ...(koszty_operacyjne.length ? { koszty_operacyjne } : {}),
          payment: {
            forma_platnosc,
            kwota_odebrana: forma_platnosc === 'Gotowka' ? parseFloat(String(kwota_odebrana).replace(',', '.')) : null,
            faktura_vat: !!faktura_vat,
            nip: nip || null,
            ...(noteTrim ? { notatki: noteTrim } : {}),
          },
        },
        { headers: authHeaders(token) }
      );
      setFinishModalOpen(false);
      showMsg(successMessage('Zlecenie zakończone.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udało się zakończyć zlecenia')));
    } finally {
      setFinishSubmitting(false);
    }
  };

  if (loading) return <div style={styles.center}><div style={styles.spinner} />Ładowanie...</div>;
  if (!zlecenie) return <div style={styles.center}>Nie znaleziono zlecenia</div>;

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        {/* Breadcrumb */}
        <div style={styles.topBar}>
          <div style={styles.breadcrumb}>
            <span style={styles.link} onClick={() => navigate('/zlecenia')}>← Zlecenia</span>
            <span style={styles.sep}>/</span>
            <span>Zlecenie #{id}</span>
          </div>
          <div style={styles.topActions}>
            <button type="button" style={styles.pdfBtn} onClick={pobierzPdf}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <PictureAsPdfOutlined sx={{ fontSize: 18 }} />
                Pobierz PDF
              </span>
            </button>
            <StatusMessage message={msg} />
            {canEdit && (
              editMode ? (
                <>
                  <button type="button" style={styles.cancelBtn} onClick={() => setEditMode(false)}>{t('common.cancel')}</button>
                  <button type="button" style={styles.saveBtn} onClick={saveEdit} disabled={saving}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {saving ? <HourglassEmptyOutlined sx={{ fontSize: 18 }} /> : null}
                      {saving ? t('common.saving') : 'Zapisz zmiany'}
                    </span>
                  </button>
                </>
              ) : (
                <button type="button" style={styles.editBtn} onClick={() => setEditMode(true)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <EditOutlined sx={{ fontSize: 18 }} />
                    {t('common.edit')}
                  </span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Hero */}
        <div style={styles.heroCard}>
          <div style={styles.heroLeft}>
            <div style={styles.heroTitle}>
              {editMode && canEdit
                ? <input style={styles.editInput} value={editForm.klient_nazwa || ''} onChange={e => setEditForm({...editForm, klient_nazwa: e.target.value})} />
                : zlecenie.klient_nazwa
              }
            </div>
            <div style={styles.heroAddr}>
              {editMode && canEdit ? (
                <div style={{display:'flex', gap:8}}>
                  <input style={styles.editInputSm} value={editForm.adres || ''} onChange={e => setEditForm({...editForm, adres: e.target.value})} placeholder="Adres" />
                  <CityInput
                    style={styles.editInputSm}
                    value={editForm.miasto || ''}
                    onChange={e => setEditForm({...editForm, miasto: e.target.value})}
                    placeholder="Miasto"
                    extraCities={[zlecenie?.miasto]}
                  />
                </div>
              ) : `${zlecenie.adres}, ${zlecenie.miasto}`}
            </div>
            <div style={styles.heroContact}>
              {editMode && canEdit
                ? <input style={styles.editInputSm} value={editForm.klient_telefon || ''} onChange={e => setEditForm({...editForm, klient_telefon: e.target.value})} placeholder="Telefon klienta" />
                : zlecenie.klient_telefon
                  ? (
                    telHref(zlecenie.klient_telefon) ? (
                      <a href={telHref(zlecenie.klient_telefon)} style={{ ...styles.phoneLink, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <LocalPhoneOutlined sx={{ fontSize: 18 }} />
                        {zlecenie.klient_telefon}
                      </a>
                    ) : (
                      <span style={{ ...styles.phoneLink, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <LocalPhoneOutlined sx={{ fontSize: 18 }} />
                        {zlecenie.klient_telefon}
                      </span>
                    )
                  )
                  : <span style={{color:'var(--text-muted)', fontSize:13}}>Brak telefonu</span>
              }
              {!editMode && zlecenie.klient_telefon && zlecenie.oddzial_id && (
                <Link
                  to={`/telefonia?tab=calls&oddzial_id=${zlecenie.oddzial_id}&phone=${encodeURIComponent(zlecenie.klient_telefon)}&task_id=${zlecenie.id}`}
                  style={{ ...styles.mapBtn, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                >
                  <LocalPhoneOutlined sx={{ fontSize: 16 }} />
                  Log w Telefonii
                </Link>
              )}
              {!editMode && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(zlecenie.adres + ' ' + zlecenie.miasto)}`}
                  target="_blank" rel="noreferrer" style={{ ...styles.mapBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <MapOutlined sx={{ fontSize: 16 }} />
                  Mapa
                </a>
              )}
            </div>
          </div>
          <div style={styles.heroBadges}>
            {canEdit ? (
              <select style={{...styles.statusSelect, backgroundColor: getTaskStatusColor(zlecenie.status, 'var(--text-muted)')}}
                value={zlecenie.status} onChange={e => zmienStatus(e.target.value)}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`taskStatus.${s}`, { defaultValue: s })}</option>
                ))}
              </select>
            ) : (
              <span style={{ ...styles.statusSelect, backgroundColor: getTaskStatusColor(zlecenie.status, 'var(--text-muted)'), padding: '6px 16px', borderRadius: 999, color: '#fff', fontSize: 13, fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TaskStatusIcon status={zlecenie.status} size={16} color="#fff" />
                {t(`taskStatus.${zlecenie.status}`, { defaultValue: zlecenie.status })}
              </span>
            )}
            <span style={{ ...styles.prioBadge, color: PRIORYTET_KOLOR[zlecenie.priorytet] || 'var(--text-muted)', borderColor: PRIORYTET_KOLOR[zlecenie.priorytet] || 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <FiberManualRecord sx={{ fontSize: 14, color: PRIORYTET_KOLOR[zlecenie.priorytet] || 'var(--text-muted)' }} />
              {zlecenie.priorytet || 'Normalny'}
            </span>
          </div>
        </div>

        {/* KPI */}
        <div style={styles.kpiRow}>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent)', display: canSeeFinance ? undefined : 'none' }}>
            <div style={styles.kpiIcon}><AttachMoney sx={{ fontSize: 26, color: 'var(--accent)' }} /></div>
            <div style={styles.kpiNum}>{formatCurrency(wartosc)}</div>
            <div style={styles.kpiLabel}>Wartość</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--warning)' }}>
            <div style={styles.kpiIcon}><ScheduleOutlined sx={{ fontSize: 26, color: 'var(--warning)' }} /></div>
            <div style={styles.kpiNum}>{formatMinutes(lacznie)}</div>
            <div style={styles.kpiLabel}>Czas pracy</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--danger)', display: canSeeFinance ? undefined : 'none' }}>
            <div style={styles.kpiIcon}><PaymentsOutlined sx={{ fontSize: 26, color: 'var(--danger)' }} /></div>
            <div style={styles.kpiNum}>{formatCurrency(kosztRobocizny)}</div>
            <div style={styles.kpiLabel}>Koszt robocizny</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: marza >= 0 ? 'var(--success)' : 'var(--danger)', display: canSeeFinance ? undefined : 'none' }}>
            <div style={styles.kpiIcon}>{marza >= 0 ? <TrendingUpOutlined sx={{ fontSize: 26, color: 'var(--success)' }} /> : <TrendingDownOutlined sx={{ fontSize: 26, color: 'var(--danger)' }} />}</div>
            <div style={{ ...styles.kpiNum, color: marza >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {formatCurrency(marza)} ({marzaProcent}%)
            </div>
            <div style={styles.kpiLabel}>Marża</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--warning)' }}>
            <div style={styles.kpiIcon}><WarningAmberOutlined sx={{ fontSize: 26, color: 'var(--warning)' }} /></div>
            <div style={styles.kpiNum}>{issues.length}</div>
            <div style={styles.kpiLabel}>Problemy</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#1d4ed8' }}>
            <div style={styles.kpiIcon}><PhotoCameraOutlined sx={{ fontSize: 26, color: '#1d4ed8' }} /></div>
            <div style={styles.kpiNum}>{zdjecia.length}</div>
            <div style={styles.kpiLabel}>Zdjęcia</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#38bdf8' }}>
            <div style={styles.kpiIcon}><SmartDisplayOutlined sx={{ fontSize: 26, color: '#38bdf8' }} /></div>
            <div style={styles.kpiNum}>{wideo.length}</div>
            <div style={styles.kpiLabel}>Filmy</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent)' }}>
            <div style={styles.kpiIcon}><ChecklistOutlined sx={{ fontSize: 26, color: 'var(--accent)' }} /></div>
            <div style={styles.kpiNum}>{activeEquipmentReservations.length}</div>
            <div style={styles.kpiLabel}>Sprzet</div>
          </div>
        </div>

        <TaskCommandCenter
          task={zlecenie}
          issues={issues}
          photos={zdjecia}
          videos={wideo}
          documents={dokumenty}
          workflowSla={workflowSla}
          finishRequirements={finishRequirements}
          activeWorkLog={activeWorkLog}
          canEdit={canEdit}
          isCrew={isEkipa}
          onOpenTab={setActiveTab}
          onStatusChange={zmienStatus}
          onFinish={openFinishModal}
          formatCurrency={formatCurrency}
        />

        <div style={{
          ...styles.presenceCard,
          borderColor: latestCheckin ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.34)'
        }}>
          <div style={styles.presenceHead}>
            <div style={styles.presenceTitleWrap}>
              <span style={{
                ...styles.presenceIcon,
                color: latestCheckin ? 'var(--success)' : 'var(--warning)',
                backgroundColor: latestCheckin ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)'
              }}>
                <PlaceOutlined sx={{ fontSize: 20 }} />
              </span>
              <div>
                <div style={styles.presenceTitle}>Dojazd / GPS ekipy</div>
                <div style={styles.presenceSub}>
                  {zlecenie.ekipa_nazwa || zlecenie.wyceniajacy_nazwa || 'Brak przypisanej ekipy'}
                </div>
              </div>
            </div>
            <span style={{
              ...styles.presencePill,
              color: latestCheckin ? 'var(--success)' : 'var(--warning)',
              backgroundColor: latestCheckin ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
              borderColor: latestCheckin ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.34)'
            }}>
              {latestCheckin ? 'DOJECHALI' : checkinPhoto ? 'CHECK-IN FOTO' : 'CZEKA NA CHECK-IN'}
            </span>
          </div>

          <div style={styles.presenceGrid}>
            <div style={styles.presenceMetric}>
              <span>Check-in GPS</span>
              <strong>{latestCheckin ? formatDateTime(latestCheckin.start_time) : checkinPhoto ? 'jest zdjecie check-in' : 'brak'}</strong>
            </div>
            <div style={styles.presenceMetric}>
              <span>Ostatni sygnal live</span>
              <strong style={{ color: liveStatus.color }}>{liveStatus.label} / {liveStatus.meta}</strong>
            </div>
            <div style={styles.presenceMetric}>
              <span>GPS z</span>
              <strong>{gpsSourceLabel(liveLocation)}</strong>
            </div>
            <div style={styles.presenceMetric}>
              <span>Wyslal sygnal</span>
              <strong>{gpsSenderLabel(liveLocation)}</strong>
            </div>
            <div style={styles.presenceMetric}>
              <span>Dokladnosc</span>
              <strong>{gpsAccuracyLabel(liveLocation)}</strong>
            </div>
            <div style={styles.presenceMetric}>
              <span>Urzadzenie</span>
              <strong>{gpsPlatformLabel(liveLocation)}</strong>
            </div>
            <div style={styles.presenceMetric}>
              <span>Koordynaty</span>
              <strong>
                {latestCheckin?.start_lat
                  ? `${Number(latestCheckin.start_lat).toFixed(5)}, ${Number(latestCheckin.start_lng).toFixed(5)}`
                  : liveLocation?.lat
                    ? `${Number(liveLocation.lat).toFixed(5)}, ${Number(liveLocation.lng).toFixed(5)}`
                    : '-'}
              </strong>
            </div>
          </div>

          <div style={styles.presenceActions}>
            {latestCheckinMapUrl ? (
              <a href={latestCheckinMapUrl} target="_blank" rel="noreferrer" style={styles.mapBtn}>Mapa check-in</a>
            ) : null}
            {liveMapUrl ? (
              <a href={liveMapUrl} target="_blank" rel="noreferrer" style={styles.mapBtn}>Mapa live</a>
            ) : null}
            <button type="button" style={styles.uploadBtn} onClick={() => setActiveTab('czas')}>Rejestr czasu</button>
            {canEdit ? <button type="button" style={styles.uploadBtn} onClick={() => navigate('/mapa-live')}>Mapa wszystkich ekip</button> : null}
          </div>

          <div style={styles.gpsHistoryBox}>
            <div style={styles.gpsHistoryHead}>
              <div>
                <div style={styles.gpsHistoryTitle}>Historia trasy dnia</div>
                <div style={styles.gpsHistorySub}>
                  {gpsHistoryDate || taskGpsHistoryDate(zlecenie)} / {zlecenie.ekipa_nazwa || zlecenie.wyceniajacy_nazwa || 'brak przypisania'}
                </div>
              </div>
              <div style={styles.gpsHistoryControls}>
                <input
                  aria-label="Data historii GPS"
                  type="date"
                  value={gpsHistoryDate}
                  onChange={(event) => setGpsHistoryDate(event.target.value)}
                  style={styles.gpsHistoryDateInput}
                />
                <button
                  type="button"
                  style={styles.mapBtn}
                  onClick={() => loadGpsHistory(zlecenie, liveLocation, null, gpsHistoryDate)}
                  disabled={gpsHistoryLoading}
                >
                  {gpsHistoryLoading ? 'Laduje...' : 'Odswiez'}
                </button>
                {gpsHistoryMapUrl ? (
                  <a href={gpsHistoryMapUrl} target="_blank" rel="noreferrer" style={styles.mapBtn}>Trasa GPS</a>
                ) : null}
                <span style={styles.gpsHistoryCount}>{gpsHistory.length} pkt</span>
              </div>
            </div>

            {gpsHistoryError ? (
              <div style={styles.gpsHistoryError}>{gpsHistoryError}</div>
            ) : null}

            <div style={styles.gpsHistorySummary}>
              <div style={styles.presenceMetric}>
                <span>Zakres</span>
                <strong>{gpsHistoryRangeLabel(gpsHistory)}</strong>
              </div>
              <div style={styles.presenceMetric}>
                <span>Max predkosc</span>
                <strong>{gpsHistoryMaxSpeed(gpsHistory)}</strong>
              </div>
              <div style={styles.presenceMetric}>
                <span>Ostatni punkt</span>
                <strong>{gpsHistory.length ? formatDateTime(gpsHistory[gpsHistory.length - 1].recorded_at) : 'brak'}</strong>
              </div>
            </div>

            {gpsHistoryLoading ? (
              <div style={styles.empty}>Laduje historie GPS...</div>
            ) : gpsHistory.length ? (
              <>
                <div style={styles.gpsHistoryStrip}>
                  {gpsHistory.slice(-36).map((point, index) => (
                    <a
                      key={`${point.provider}-${point.recorded_at}-${index}`}
                      href={mapsUrl(point.lat, point.lng)}
                      target="_blank"
                      rel="noreferrer"
                      title={`${formatDateTime(point.recorded_at)} / ${gpsSourceLabel(point)}`}
                      style={{
                        ...styles.gpsHistoryDot,
                        backgroundColor: point.provider === 'mobile' ? 'var(--success)' : '#1d4ed8',
                        opacity: 0.35 + ((index + 1) / Math.min(36, gpsHistory.length)) * 0.65,
                      }}
                    />
                  ))}
                </div>
                <div style={styles.gpsHistoryTimeline}>
                  {gpsHistoryPreview.map((point, index) => (
                    <div key={`${point.provider}-${point.recorded_at}-${index}`} style={styles.gpsHistoryPoint}>
                      <span style={{ ...styles.gpsHistoryPointDot, backgroundColor: point.provider === 'mobile' ? 'var(--success)' : '#1d4ed8' }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={styles.gpsHistoryPointTitle}>{gpsPointLabel(point)} / {gpsSourceLabel(point)}</div>
                        <div style={styles.gpsHistoryPointMeta}>
                          {gpsSenderLabel(point)} / {gpsAccuracyLabel(point)} / {point.speed_kmh != null ? `${Math.round(point.speed_kmh)} km/h` : 'predkosc brak'}
                        </div>
                      </div>
                      <a href={mapsUrl(point.lat, point.lng)} target="_blank" rel="noreferrer" style={styles.mapBtn}>Mapa</a>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={styles.empty}>Brak punktow GPS dla dnia zlecenia. Jesli ekipa ma wlaczona mobilke, punkty pojawia sie automatycznie.</div>
            )}
          </div>
        </div>

        {isEkipa && zlecenie?.status === 'W_Realizacji' && (
          <div style={{ ...styles.card, borderLeft: '4px solid var(--accent)' }}>
            <div style={styles.cardTitle}>Zakończenie zlecenia (ekipa)</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
              Zakończenie przekazuje płatność do systemu (F3.9) i zamyka czas pracy — tak samo jak w aplikacji mobilnej.
              {!activeWorkLog && (
                <span>
                  {' '}
                  <strong>Brak aktywnego wpisu czasu pracy</strong> — uruchom najpierw START w aplikacji mobilnej (pole pracy).
                </span>
              )}
            </p>
            {finishPhotoBlocked && (
              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  fontSize: 13,
                  color: 'var(--text-sub)',
                }}
              >
                Dodaj w zakładce Media wymagane zdjęcia (min. 2 × Po i/lub min. 2 × Przed), zgodnie z ustawieniami serwera.
              </div>
            )}
            <button
              type="button"
              style={{
                ...styles.saveBtn,
                opacity: finishPhotoBlocked || !activeWorkLog ? 0.55 : 1,
                cursor: finishPhotoBlocked || !activeWorkLog ? 'not-allowed' : 'pointer',
              }}
              disabled={Boolean(finishPhotoBlocked || !activeWorkLog)}
              onClick={() => openFinishModal()}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <CheckCircleOutline sx={{ fontSize: 18 }} />
                Zakończ zlecenie (płatność)
              </span>
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={styles.tabs}>
          {[
            { key: 'szczegoly', label: `Szczegóły` },
            { key: 'czas', label: `Czas pracy (${workLogs.length})` },
            { key: 'problemy', label: `Problemy (${issues.length})` },
            { key: 'zdjecia', label: `Media (${zdjecia.length + wideo.length})` },
            { key: 'workflow', label: `Workflow` },
            { key: 'dokumenty', label: `Dokumenty (${dokumenty.length})` },
            { key: 'integracje', label: `Integracje` },
            { key: 'dniowki', label: `Dniówki (${dniowki.length})` },
          ].map((tabItem) => (
            <button key={tabItem.key} type="button" style={{ ...styles.tab, ...(activeTab === tabItem.key ? styles.tabActive : {}) }}
              onClick={() => setActiveTab(tabItem.key)}>
              {tabItem.label}
            </button>
          ))}
        </div>

        {/* TAB: Szczegóły */}
        {activeTab === 'szczegoly' && (
          <div style={styles.twoCol}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>Szczegóły zlecenia</div>
              <Row label="Typ usługi" value={
                editMode && canEdit
                  ? <select style={styles.editInputSm} value={editForm.typ_uslugi || ''} onChange={e => setEditForm({...editForm, typ_uslugi: e.target.value})}>
                      {['Wycinka','Pielęgnacja','Ogrodnictwo','Frezowanie pniaków','Inne'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  : zlecenie.typ_uslugi
              } />
              <Row label="Data planowana" value={
                editMode && canEdit
                  ? <input style={styles.editInputSm} type="date" value={editForm.data_planowana?.split('T')[0] || ''} onChange={e => setEditForm({...editForm, data_planowana: e.target.value})} />
                  : formatDate(zlecenie.data_planowana)
              } />
              <Row label="Czas planowany" value={
                editMode && canEdit
                  ? <input style={styles.editInputSm} type="number" step="0.5" value={editForm.czas_planowany_godziny || ''} onChange={e => setEditForm({...editForm, czas_planowany_godziny: e.target.value})} />
                  : `${zlecenie.czas_planowany_godziny || 0}h`
              } />
              <Row label="Wartość" value={
                editMode && canEdit
                  ? <input style={styles.editInputSm} type="number" step="0.01" value={editForm.wartosc_planowana || ''} onChange={e => setEditForm({...editForm, wartosc_planowana: e.target.value})} />
                  : formatCurrency(wartosc)
              } />
              <Row
                label="Dop. usługi (szt.)"
                value={
                  editMode && canEdit ? (
                    <input
                      style={styles.editInputSm}
                      type="number"
                      min="0"
                      step="1"
                      value={editForm.dodatkowe_uslugi_liczba ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, dodatkowe_uslugi_liczba: e.target.value })}
                    />
                  ) : (
                    String(zlecenie.dodatkowe_uslugi_liczba ?? 0)
                  )
                }
              />
              <Row
                label="Bony (szt.)"
                value={
                  editMode && canEdit ? (
                    <input
                      style={styles.editInputSm}
                      type="number"
                      min="0"
                      step="1"
                      value={editForm.bony_liczba ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, bony_liczba: e.target.value })}
                    />
                  ) : (
                    String(zlecenie.bony_liczba ?? 0)
                  )
                }
              />
              <Row label="Priorytet" value={
                editMode && canEdit
                  ? <select style={styles.editInputSm} value={editForm.priorytet || ''} onChange={e => setEditForm({...editForm, priorytet: e.target.value})}>
                      {['Niski','Normalny','Wysoki','Pilny'].map(p => <option key={p}>{p}</option>)}
                    </select>
                  : zlecenie.priorytet
              } />
              <Row label="Ekipa" value={zlecenie.ekipa_nazwa || 'Nieprzypisana'} />
              <Row label="Kierownik" value={zlecenie.kierownik_nazwa || '-'} />
              <Row label="Oddział" value={zlecenie.oddzial_nazwa || '-'} />
              <div style={styles.notatki}>
                <div style={styles.notatkiLabel}>Opis / notatki wewnętrzne</div>
                {editMode && canEdit
                  ? <textarea style={{...styles.editInput, height: 100, marginTop: 8, resize: 'vertical'}}
                      value={editForm.notatki_wewnetrzne || ''}
                      onChange={e => setEditForm({...editForm, notatki_wewnetrzne: e.target.value})}
                      placeholder="Opis zlecenia, instrukcje, dostęp..." />
                  : <div style={styles.notatkiText}>{zlecenie.notatki_wewnetrzne || 'Brak notatek'}</div>
                }
              </div>
            </div>

            <div>
              {/* Zmiana statusu */}
              {canEdit && (
                <div style={styles.card}>
                  <div style={styles.cardTitle}>Zmień status</div>
                  <div style={styles.statusGrid}>
                    {TASK_STATUSES.map((s) => (
                      <button key={s} type="button" style={{
                        ...styles.statusBtn,
                        backgroundColor: zlecenie.status === s ? getTaskStatusColor(s) : 'var(--border)',
                        color: zlecenie.status === s ? '#fff' : 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }} onClick={() => zmienStatus(s)}>
                        <TaskStatusIcon status={s} size={16} color={zlecenie.status === s ? '#fff' : undefined} />
                        {t(`taskStatus.${s}`, { defaultValue: s })}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Lokalizacja */}
              <div style={styles.card}>
                <div style={styles.cardTitle}>Lokalizacja</div>
                <a href={`https://maps.google.com/?q=${encodeURIComponent(zlecenie.adres + ' ' + zlecenie.miasto)}`}
                  target="_blank" rel="noreferrer" style={{ ...styles.mapBigBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <PlaceOutlined sx={{ fontSize: 20 }} />
                  {zlecenie.adres}, {zlecenie.miasto}
                </a>
              </div>

              <div style={styles.card}>
                <div style={styles.cardTitle}>Sprzet i instrukcje dla ekipy</div>
                {equipmentReservations.length ? (
                  <div style={styles.equipmentList}>
                    {equipmentReservations.map((row) => {
                      const active = isActiveEquipmentReservation(row);
                      return (
                        <div key={row.id} style={{ ...styles.equipmentCard, opacity: active ? 1 : 0.62 }}>
                          <div style={styles.equipmentTop}>
                            <strong>{equipmentDisplayName(row)}</strong>
                            <span style={{ ...styles.equipmentStatus, ...(active ? styles.equipmentStatusActive : styles.equipmentStatusInactive) }}>
                              {row.status || 'Zarezerwowane'}
                            </span>
                          </div>
                          <div style={styles.equipmentMeta}>
                            {row.ekipa_nazwa || zlecenie.ekipa_nazwa || 'Ekipa'} · {formatDate(row.data_od)} - {formatDate(row.data_do)}
                          </div>
                          {row.nr_seryjny && <div style={styles.equipmentMeta}>Nr seryjny: {row.nr_seryjny}</div>}
                          {row.notatki && <div style={styles.equipmentNote}>{row.notatki}</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={styles.empty}>
                    Brak sprzetu przypisanego do zlecenia. Biuro moze go dodac w Planie biura albo w Kalendarzu zasobow.
                  </div>
                )}
              </div>

              {/* PDF */}
              <div style={styles.card}>
                <div style={styles.cardTitle}>Dokumenty</div>
                <button type="button" style={styles.pdfBigBtn} onClick={pobierzPdf}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <PictureAsPdfOutlined sx={{ fontSize: 20 }} />
                    Pobierz protokół PDF
                  </span>
                </button>
              </div>

              {/* Kommo (CRM) — zlecenie */}
              {canUseTaskKommo && (
              <div style={styles.card}>
                <div style={styles.cardTitle}>{t('kommoCrm.taskSectionTitle')}</div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
                  {t('kommoCrm.taskSectionHint')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" style={styles.pdfBtn} disabled={pushingTaskKommo} onClick={pushTaskKommo}>
                    {pushingTaskKommo ? '…' : t('kommoCrm.push')}
                  </button>
                  <button type="button" style={styles.pdfBtn} onClick={toggleTaskKommoPayload}>
                    {showTaskKommoPayload ? t('kommoCrm.hidePayload') : t('kommoCrm.showPayload')}
                  </button>
                  {showTaskKommoPayload && (
                    <button
                      type="button"
                      style={styles.pdfBtn}
                      disabled={loadingTaskKommoPayload}
                      onClick={loadTaskKommoPayload}
                    >
                      {loadingTaskKommoPayload ? '…' : t('kommoCrm.refreshPayload')}
                    </button>
                  )}
                </div>
                {zlecenie.kommo_last_sync_at ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
                    {t('kommoCrm.lastSync')}{' '}
                    {new Date(zlecenie.kommo_last_sync_at).toLocaleString()}
                    {zlecenie.kommo_last_sync_status === 'ok' ? ' · OK' : ''}
                    {zlecenie.kommo_last_sync_http ? ` · HTTP ${zlecenie.kommo_last_sync_http}` : ''}
                    {zlecenie.kommo_last_sync_error ? ` · ${zlecenie.kommo_last_sync_error}` : ''}
                  </p>
                ) : null}
                {showTaskKommoPayload && (
                  <pre
                    style={{
                      marginTop: 12,
                      marginBottom: 0,
                      fontSize: 11,
                      overflow: 'auto',
                      maxHeight: 240,
                      padding: 10,
                      background: 'var(--surface-field)',
                      borderRadius: 8,
                    }}
                  >
                    {loadingTaskKommoPayload ? '…' : taskKommoPayload ? JSON.stringify(taskKommoPayload, null, 2) : '—'}
                  </pre>
                )}
              </div>
              )}

              {/* SMS */}
              {canUseTaskSms && (
                <div style={styles.card}>
                  <div style={styles.cardTitle}>SMS do klienta</div>
                  {!zlecenie.klient_telefon ? (
                    <div style={{ ...styles.noPhone, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <LocalPhoneOutlined sx={{ fontSize: 20, opacity: 0.6 }} />
                      Brak numeru telefonu klienta.
                    </div>
                  ) : (
                    <>
                      <div style={styles.smsInfo}>
                        Wyślij SMS na: <strong>{zlecenie.klient_telefon}</strong>
                      </div>
                      {SMS_SZABLONY.map(s => (
                        <button key={s.typ} type="button" style={{
                          ...styles.smsBtn,
                          opacity: sendingSms === s.typ ? 0.6 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }} onClick={() => wyslijSms(s.typ)} disabled={sendingSms !== ''}>
                          {sendingSms === s.typ ? (
                            <>
                              <HourglassEmptyOutlined sx={{ fontSize: 20 }} />
                              Wysyłanie…
                            </>
                          ) : (
                            <>
                              <SmsTemplateIcon typ={s.typ} />
                              {s.label}
                            </>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'workflow' && (
          <div style={styles.twoCol}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <ChecklistOutlined sx={{ fontSize: 20 }} />
                  Checklista wykonania
                </span>
              </div>
              <div style={styles.inlineForm}>
                <input
                  style={styles.editInput}
                  placeholder="Dodaj krok do wykonania..."
                  value={checklistInput}
                  onChange={(e) => setChecklistInput(e.target.value)}
                />
                <button type="button" style={styles.uploadBtn} onClick={addChecklistItem}>Dodaj</button>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                Postęp: {workflowSla.checklist_done}/{workflowSla.checklist_total}
              </div>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {workflowChecklist.map((item) => (
                  <div key={item.id} style={styles.workflowRow}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <input type="checkbox" checked={!!item.done} onChange={() => toggleChecklistItem(item)} />
                      <span style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.7 : 1 }}>
                        {item.text}
                      </span>
                    </label>
                    <button type="button" style={styles.mediaDeleteBtn} onClick={() => removeChecklistItem(item.id)}>
                      <DeleteOutline sx={{ fontSize: 14 }} />
                      Usuń
                    </button>
                  </div>
                ))}
                {workflowChecklist.length === 0 && <div style={styles.empty}>Brak pozycji checklisty.</div>}
              </div>
            </div>

            <div>
              <div style={styles.card}>
                <div style={styles.cardTitle}>Przypomnienia / SLA</div>
                <div style={styles.inlineForm}>
                  <input
                    style={styles.editInput}
                    placeholder="Tytuł przypomnienia..."
                    value={reminderTitleInput}
                    onChange={(e) => setReminderTitleInput(e.target.value)}
                  />
                  <input
                    style={styles.editInputSm}
                    type="datetime-local"
                    value={reminderDueInput}
                    onChange={(e) => setReminderDueInput(e.target.value)}
                  />
                  <button type="button" style={styles.uploadBtn} onClick={addReminder}>Dodaj</button>
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: workflowSla.reminders_overdue > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                  Przeterminowane: {workflowSla.reminders_overdue}
                </div>
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  {workflowReminders.map((item) => (
                    <div key={item.id} style={styles.workflowRow}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        <input type="checkbox" checked={!!item.done} onChange={() => toggleReminderDone(item)} />
                        <span style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.7 : 1 }}>
                          {item.title} {item.due_at ? `(${formatDateTime(item.due_at)})` : ''}
                        </span>
                      </label>
                      <button type="button" style={styles.mediaDeleteBtn} onClick={() => removeReminder(item.id)}>
                        <DeleteOutline sx={{ fontSize: 14 }} />
                        Usuń
                      </button>
                    </div>
                  ))}
                  {workflowReminders.length === 0 && <div style={styles.empty}>Brak przypomnień.</div>}
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardTitle}>Historia workflow</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {workflowEvents.map((ev) => (
                    <div key={ev.id} style={styles.issueCard}>
                      <div style={styles.issueHeader}>
                        <span style={{ ...styles.badge, backgroundColor: '#3B82F6' }}>
                          {ev.type === 'status_change' ? 'Status' : 'Zdarzenie'}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateTime(ev.created_at)}</span>
                      </div>
                      {ev.type === 'status_change' ? (
                        <div style={styles.issueOpis}>Zmiana statusu: <strong>{ev.from || '-'}</strong> → <strong>{ev.to || '-'}</strong></div>
                      ) : null}
                      <div style={styles.issueFooter}>Użytkownik: {ev.by_name || '-'}</div>
                    </div>
                  ))}
                  {workflowEvents.length === 0 && <div style={styles.empty}>Brak historii workflow.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dokumenty' && (
          <div style={styles.card}>
            <div style={styles.zdjeciaHeader}>
              <div style={styles.cardTitle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <DescriptionOutlined sx={{ fontSize: 20 }} />
                  Dokumenty zlecenia
                </span>
              </div>
              <div style={styles.uploadBox}>
                <select style={styles.filtrSelect} value={docCategoryInput} onChange={(e) => setDocCategoryInput(e.target.value)}>
                  <option value="protokol">Protokół</option>
                  <option value="umowa">Umowa</option>
                  <option value="faktura">Faktura</option>
                  <option value="zdjecie_opisowe">Załącznik opisowy</option>
                  <option value="inne">Inne</option>
                </select>
                <select style={styles.filtrSelect} value={docStatusInput} onChange={(e) => setDocStatusInput(e.target.value)}>
                  <option value="roboczy">Roboczy</option>
                  <option value="do_akceptacji">Do akceptacji</option>
                  <option value="zaakceptowany">Zaakceptowany</option>
                  <option value="archiwalny">Archiwalny</option>
                </select>
                <button type="button" style={styles.uploadBtn} onClick={() => documentInputRef.current?.click()} disabled={uploadingDocument}>
                  {uploadingDocument ? 'Wysyłanie…' : '+ Dodaj dokument'}
                </button>
                <input
                  ref={documentInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => uploadDocument(e.target.files?.[0])}
                />
              </div>
            </div>

            {dokumenty.length === 0 ? (
              <div style={styles.empty}>Brak dokumentów.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {dokumenty.map((doc) => (
                  <div key={doc.id} style={styles.workflowRow}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{doc.nazwa}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        kat: {doc.kategoria || '-'} · status: {doc.status || '-'} · wersja: v{doc.wersja || 1}
                      </div>
                    </div>
                    <a href={`${BASE}${doc.sciezka}`} target="_blank" rel="noreferrer" style={styles.mapBtn}>Podgląd</a>
                    <button
                      type="button"
                      style={styles.uploadBtn}
                      onClick={() => {
                        setSelectedDocument(doc);
                        setDocumentOpisInput(doc.opis || '');
                        setDocCategoryInput(doc.kategoria || 'inne');
                        setDocStatusInput(doc.status || 'roboczy');
                      }}
                    >
                      Edytuj
                    </button>
                    <button type="button" style={styles.uploadBtn} onClick={() => bumpDocumentVersion(doc.id)}>
                      +Wersja
                    </button>
                    <button type="button" style={styles.mediaDeleteBtn} onClick={() => deleteDocument(doc.id)}>
                      <DeleteOutline sx={{ fontSize: 14 }} />
                      Usuń
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedDocument && (
              <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Edycja: {selectedDocument.nazwa}</div>
                <textarea
                  style={{ ...styles.editInput, minHeight: 80 }}
                  placeholder="Opis dokumentu..."
                  value={documentOpisInput}
                  onChange={(e) => setDocumentOpisInput(e.target.value)}
                />
                <div style={{ marginTop: 8 }}>
                  <button type="button" style={styles.saveBtn} disabled={savingDocumentMeta} onClick={saveDocumentMeta}>
                    {savingDocumentMeta ? 'Zapisywanie…' : 'Zapisz metadane'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'integracje' && (
          <div style={styles.twoCol}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>Automaty i kanały</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  ['sms', 'Kanał SMS'],
                  ['email', 'Kanał E-mail'],
                  ['push', 'Kanał Push'],
                  ['auto_on_status', 'Automat po zmianie statusu'],
                  ['auto_on_reminder', 'Automat po przypomnieniu'],
                ].map(([key, label]) => (
                  <label key={key} style={styles.workflowRow}>
                    <input
                      type="checkbox"
                      checked={!!integrationSettings[key]}
                      onChange={(e) => updateIntegrationSetting(key, e.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" style={styles.uploadBtn} onClick={() => sendIntegrationTest('sms')}>Test SMS</button>
                <button type="button" style={styles.uploadBtn} onClick={() => sendIntegrationTest('email')}>Test E-mail</button>
                <button type="button" style={styles.uploadBtn} onClick={() => sendIntegrationTest('push')}>Test Push</button>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.cardTitle}>Log integracji</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {integrationLogs.map((log) => (
                  <div key={log.id} style={styles.issueCard}>
                    <div style={styles.issueHeader}>
                      <span style={{ ...styles.badge, backgroundColor: '#0284c7' }}>{String(log.channel || '').toUpperCase()}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateTime(log.created_at)}</span>
                    </div>
                    <div style={styles.issueOpis}>{log.title}</div>
                    <div style={styles.issueFooter}>
                      {log.status} · {log.created_by_name || '-'}
                    </div>
                  </div>
                ))}
                {integrationLogs.length === 0 && <div style={styles.empty}>Brak logów integracji.</div>}
              </div>
            </div>
          </div>
        )}

        {/* TAB: Czas pracy */}
        {activeTab === 'czas' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Rejestr czasu pracy — {workLogs.length} wpisów</div>
            {workLogs.length === 0 ? (
              <div style={styles.empty}>Brak zarejestrowanego czasu. Brygadzista rejestruje przez aplikację mobilną.</div>
            ) : (
              <div className="modern-data-stack">
                {workLogs.map((w) => {
                  const isCheckin = isCheckinWorkLog(w);
                  const rowMapUrl = mapsUrl(w.start_lat, w.start_lng);
                  return (
                    <ModernDataRow
                      key={w.id}
                      idLabel={isCheckin ? 'Check-in' : 'Work Log'}
                      idValue={isCheckin ? `ARRIVE-${w.id}` : `TIME-${w.id}`}
                      title={w.pracownik || 'Pracownik'}
                      subtitle={w.start_lat ? `${w.start_lat}, ${w.start_lng}` : 'GPS start: brak'}
                      tone={isCheckin || w.status === 'Zakończony' ? 'success' : 'warning'}
                      status={isCheckin ? 'Dojechali' : w.status === 'Zakończony' ? 'Zakończony' : 'W trakcie'}
                      statusValue={w.status}
                      statusState={isCheckin || w.status === 'Zakończony' ? 'success' : 'warning'}
                      metrics={[
                        { label: isCheckin ? 'Dojazd' : 'Start', value: formatDateTime(w.start_time) },
                        { label: 'Stop', value: isCheckin ? 'punkt GPS' : formatDateTime(w.end_time) },
                        { label: 'Czas', value: isCheckin ? '0 min' : formatMinutes(w.duration_hours * 60 || w.czas_pracy_minuty), tone: 'success' },
                      ]}
                      actions={
                        rowMapUrl ? (
                          <a href={rowMapUrl} target="_blank" rel="noreferrer" style={styles.mapLink}>
                            GPS
                          </a>
                        ) : null
                      }
                    />
                  );
                })}
                <ModernDataRow
                  idLabel="Summary"
                  idValue="TOTAL"
                  title="Łącznie"
                  subtitle="Suma zarejestrowanego czasu pracy"
                  tone="success"
                  status="TOTAL"
                  statusValue="success"
                  statusState="success"
                  metrics={[
                    { label: 'Czas razem', value: formatMinutes(lacznie), tone: 'success' },
                    { label: 'Wpisy', value: workLogs.length },
                  ]}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB: Problemy */}
        {activeTab === 'problemy' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Zgłoszenia problemów — {issues.length}</div>
            {issues.length === 0
              ? <div style={styles.empty}>Brak problemów</div>
              : issues.map(issue => (
                  <div key={issue.id} style={styles.issueCard}>
                    <div style={styles.issueHeader}>
                      <span style={{ ...styles.badge, backgroundColor: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <WarningAmberOutlined sx={{ fontSize: 14 }} />
                        {issue.typ?.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontSize: 12, color: issue.status === 'Zgloszony' ? 'var(--warning)' : 'var(--success)', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {issue.status === 'Zgloszony' ? <PendingOutlined sx={{ fontSize: 14 }} /> : <CheckCircleOutline sx={{ fontSize: 14 }} />}
                        {issue.status === 'Zgloszony' ? 'Zgłoszony' : 'Rozwiązany'}
                      </span>
                      <span style={{fontSize:12, color:'var(--text-muted)', marginLeft:'auto'}}>{formatDateTime(issue.created_at)}</span>
                    </div>
                    {issue.opis && <div style={styles.issueOpis}>{issue.opis}</div>}
                    <div style={styles.issueFooter}>Zgłosił: {issue.zglaszajacy || '-'}</div>
                  </div>
                ))
            }
          </div>
        )}

        {/* TAB: Media */}
        {activeTab === 'zdjecia' && (
          <div style={styles.card}>
            <div style={styles.zdjeciaHeader}>
              <div style={styles.cardTitle}>Dokumentacja (zdjęcia i filmy)</div>
              <div style={styles.uploadBox}>
                <input
                  style={styles.editInputSm}
                  placeholder="Szukaj media/tagi/opis..."
                  value={mediaSearch}
                  onChange={(e) => setMediaSearch(e.target.value)}
                />
                <select style={styles.filtrSelect} value={mediaTypeFilter} onChange={e => setMediaTypeFilter(e.target.value)}>
                  <option value="all">Wszystko</option>
                  <option value="photos">Tylko zdjęcia</option>
                  <option value="videos">Tylko filmy</option>
                </select>
                <select style={styles.filtrSelect} value={mediaSort} onChange={e => setMediaSort(e.target.value)}>
                  <option value="newest">Najnowsze</option>
                  <option value="oldest">Najstarsze</option>
                </select>
                <select style={styles.filtrSelect} value={typZdjecia} onChange={e => setTypZdjecia(e.target.value)}>
                  <option value="wycena">Wycena / zakres</option>
                  <option value="szkic">Szkic zakresu</option>
                  <option value="dojazd">Dojazd / posesja</option>
                  <option value="checkin">Check-in</option>
                  <option value="przed">Przed praca</option>
                  <option value="po">Po pracy</option>
                  <option value="inne">Inne</option>
                </select>
                <input
                  type="text"
                  style={{ ...styles.editInputSm, minWidth: 200, maxWidth: 320 }}
                  placeholder="Notatka do zdjęcia (opcjonalnie)"
                  value={uploadPhotoOpis}
                  onChange={(e) => setUploadPhotoOpis(e.target.value)}
                  maxLength={2000}
                  disabled={uploadingPhoto}
                />
                <input
                  type="text"
                  style={{ ...styles.editInputSm, minWidth: 160, maxWidth: 280 }}
                  placeholder="Tagi (np. licznik, szyba — po przecinku)"
                  value={uploadPhotoTagi}
                  onChange={(e) => setUploadPhotoTagi(e.target.value)}
                  maxLength={2000}
                  disabled={uploadingPhoto}
                />
                <button type="button" style={styles.uploadBtn} onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}>
                  {uploadingPhoto ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <HourglassEmptyOutlined sx={{ fontSize: 18 }} />
                      Wysyłanie…
                    </span>
                  ) : (
                    '+ Dodaj zdjęcie'
                  )}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}}
                  onChange={e => uploadZdjecie(e.target.files[0])} />
                <button type="button" style={styles.uploadBtn} onClick={() => videoInputRef.current?.click()} disabled={uploadingVideo}>
                  {uploadingVideo ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <HourglassEmptyOutlined sx={{ fontSize: 18 }} />
                      Wysyłanie filmu…
                    </span>
                  ) : (
                    '+ Dodaj film'
                  )}
                </button>
                <input ref={videoInputRef} type="file" accept="video/*" style={{display:'none'}}
                  onChange={e => uploadWideo(e.target.files[0])} />
              </div>
            </div>
            <div style={{
              ...styles.evidenceWebCard,
              borderColor: photoEvidenceMissingTypes.length ? 'rgba(245,158,11,0.34)' : 'rgba(34,197,94,0.32)'
            }}>
              <div style={styles.evidenceWebHead}>
                <div>
                  <div style={styles.evidenceWebTitle}>Pakiet dowodowy z terenu</div>
                  <div style={styles.evidenceWebSub}>
                    Te same kategorie co w mobilce: wycena, szkic, dojazd, check-in, przed i po.
                  </div>
                </div>
                <span style={{
                  ...styles.evidenceWebScore,
                  color: photoEvidenceMissingTypes.length ? 'var(--warning)' : 'var(--success)',
                  borderColor: photoEvidenceMissingTypes.length ? 'rgba(245,158,11,0.34)' : 'rgba(34,197,94,0.32)',
                  backgroundColor: photoEvidenceMissingTypes.length ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)'
                }}>
                  {photoEvidenceReadyCount}/{photoEvidenceRequiredTypes.length || 0} / {photoEvidencePct}%
                </span>
              </div>
              <div style={styles.evidenceWebGrid}>
                <button
                  type="button"
                  style={{
                    ...styles.evidenceWebChip,
                    ...(mediaEvidenceFilter === 'all' ? styles.evidenceWebChipActive : {})
                  }}
                  onClick={() => setMediaEvidenceFilter('all')}
                >
                  Wszystkie <strong>{zdjecia.length}</strong>
                </button>
                {PHOTO_EVIDENCE_TYPES.map((type) => {
                  const required = photoEvidenceRequiredTypes.some((row) => row.key === type.key);
                  const missing = required && !photoEvidenceCounts[type.key];
                  const active = mediaEvidenceFilter === type.key;
                  return (
                    <button
                      type="button"
                      key={type.key}
                      style={{
                        ...styles.evidenceWebChip,
                        ...(active ? styles.evidenceWebChipActive : {}),
                        ...(missing ? styles.evidenceWebChipMissing : {}),
                      }}
                      onClick={() => {
                        setMediaTypeFilter('photos');
                        setMediaEvidenceFilter(type.key);
                      }}
                    >
                      {type.label} <strong>{photoEvidenceCounts[type.key] || 0}</strong>
                    </button>
                  );
                })}
              </div>
              {photoEvidenceMissingTypes.length ? (
                <div style={styles.evidenceWebMissing}>
                  Brakuje: {photoEvidenceMissingTypes.map((type) => type.label).join(', ')}
                </div>
              ) : (
                <div style={styles.evidenceWebOk}>Pakiet zdjec wyglada kompletnie dla biura i ekipy.</div>
              )}
            </div>
            {filteredPhotos.length === 0 && filteredVideos.length === 0 ? (
              <div style={styles.emptyBig}>
                <div style={{ ...styles.emptyIcon, display: 'flex', justifyContent: 'center' }}>
                  <ImageOutlined sx={{ fontSize: 48, opacity: 0.45 }} />
                </div>
                <p>Brak mediów</p>
                <p style={styles.emptySub}>Dodaj zdjęcie lub film używając przycisków powyżej.</p>
              </div>
            ) : (
              <>
                {photoEvidenceSections.map((section) => (
                  <PhotoSection
                    key={section.key}
                    title={`${section.label} (${section.photos.length}/${section.total})`}
                    subtitle={section.hint}
                    photos={section.photos}
                    base={BASE}
                    formatDateTime={formatDateTime}
                    onSelect={(p) => { setSelectedPhoto(p); refreshMediaEditor(p); }}
                    onDelete={deletePhoto}
                  />
                ))}                {filteredVideos.length > 0 && <VideoSection title={`Filmy (${filteredVideos.length})`} videos={filteredVideos} base={BASE} formatDateTime={formatDateTime} onSelect={(v) => { setSelectedVideo(v); refreshMediaEditor(v); }} onDelete={deleteVideo} />}
              </>
            )}
          </div>
        )}

        {/* TAB: Dniówki */}
        {activeTab === 'dniowki' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Naliczone dniówki</div>
            {dniowki.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0', fontSize: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                {isTaskDone(zlecenie?.status) ? (
                  <>
                    <WarningAmberOutlined sx={{ fontSize: 32, opacity: 0.7 }} />
                    <span>Brak dniówek — sprawdź, czy backend ma podpiętą trasę /dniowki/zlecenie/:id</span>
                  </>
                ) : (
                  <>
                    <HourglassEmptyOutlined sx={{ fontSize: 32, opacity: 0.7 }} />
                    <span>Dniówki zostaną naliczone automatycznie po zmianie statusu na &quot;Zakończone&quot;</span>
                  </>
                )}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 8 }}>
                  {dniowki.map(d => (
                    <div key={d.id} style={{ backgroundColor: 'var(--surface-field)', borderRadius: 8, padding: 16, border: `1px solid ${d.zatwierdzona ? 'var(--accent)' : 'var(--border)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontWeight: '600', color: 'var(--text)', fontSize: 15 }}>
                          {d.imie} {d.nazwisko}
                        </div>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, backgroundColor: d.zatwierdzona ? 'var(--accent)22' : '#F59E0B22', color: d.zatwierdzona ? 'var(--accent)' : '#F59E0B', fontWeight: '600' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {d.zatwierdzona ? <CheckCircleOutline sx={{ fontSize: 14 }} /> : <HourglassEmptyOutlined sx={{ fontSize: 14 }} />}
                            {d.zatwierdzona ? 'Zatwierdzona' : 'Oczekuje'}
                          </span>
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{getRoleDisplayName(d.rola)}</div>
                      {d.stawka_typ === 'procent' ? (
                        <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>
                          {d.stawka_wartosc}% × {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(d.wartosc_zlecenia)}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>
                          {d.godziny}h × {d.stawka_wartosc} PLN/h
                        </div>
                      )}
                      <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--accent)', marginTop: 8 }}>
                        {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(d.kwota)}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: '12px 16px', backgroundColor: 'var(--bg)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-sub)', fontWeight: '600' }}>Łącznie wypłacono:</span>
                  <span style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--accent)' }}>
                    {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(dniowki.reduce((s, d) => s + parseFloat(d.kwota || 0), 0))}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {finishModalOpen && (
          <div
            style={styles.overlay}
            onClick={() => !finishSubmitting && setFinishModalOpen(false)}
            role="presentation"
          >
            <div
              style={{ ...styles.overlayContent, maxWidth: 480, width: '100%' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                style={styles.overlayClose}
                onClick={() => !finishSubmitting && setFinishModalOpen(false)}
                aria-label="Zamknij"
              >
                <CloseOutlined sx={{ fontSize: 20, color: '#fff' }} />
              </button>
              <div style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 14, fontSize: 17 }}>Płatność klienta</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Forma płatności</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {['Gotowka', 'Przelew', 'Faktura_VAT', 'Brak'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${finishPayForm.forma_platnosc === f ? 'var(--accent)' : 'var(--border)'}`,
                      background: finishPayForm.forma_platnosc === f ? 'var(--accent-gradient)' : 'var(--surface-field)',
                      color: finishPayForm.forma_platnosc === f ? 'var(--on-accent)' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                    onClick={() => setFinishPayForm((p) => ({ ...p, forma_platnosc: f }))}
                  >
                    {f.replace('_', ' ')}
                  </button>
                ))}
              </div>
              {finishPayForm.forma_platnosc === 'Gotowka' && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Kwota odebrana (PLN)</div>
                  <input
                    style={{ ...styles.editInput, marginBottom: 10 }}
                    type="text"
                    inputMode="decimal"
                    value={finishPayForm.kwota_odebrana}
                    onChange={(e) => setFinishPayForm((p) => ({ ...p, kwota_odebrana: e.target.value }))}
                  />
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Uwagi przy dużej różnicy kwoty gotówki od wartości zlecenia (wymagane przy różnicy {'>'} 5%)
                  </div>
                  <textarea
                    style={{ ...styles.editInput, minHeight: 72, marginBottom: 10 }}
                    placeholder="Wpisz uzasadnienie, jeśli kwota różni się znacząco od wartości zlecenia"
                    value={finishNotatki}
                    onChange={(e) => setFinishNotatki(e.target.value)}
                  />
                </>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--text)' }}>Faktura VAT</span>
                <input
                  type="checkbox"
                  checked={finishPayForm.faktura_vat}
                  onChange={(e) => setFinishPayForm((p) => ({ ...p, faktura_vat: e.target.checked }))}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>NIP (jeśli faktura)</div>
              <input
                style={{ ...styles.editInput, marginBottom: 12 }}
                value={finishPayForm.nip}
                onChange={(e) => setFinishPayForm((p) => ({ ...p, nip: e.target.value }))}
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                {finishRequirements.require_material_usage
                  ? 'Zużyte materiały — wymagana nazwa'
                  : 'Zużyte materiały (opcjonalnie)'}
              </div>
              <input
                style={{ ...styles.editInput, marginBottom: 8 }}
                placeholder="Nazwa materiału"
                value={finishUsageNazwa}
                onChange={(e) => setFinishUsageNazwa(e.target.value)}
              />
              <input
                style={{ ...styles.editInput, marginBottom: 14 }}
                placeholder="Ilość (opcjonalnie)"
                inputMode="decimal"
                value={finishUsageIlosc}
                onChange={(e) => setFinishUsageIlosc(e.target.value)}
              />
              <input
                style={{ ...styles.editInput, marginBottom: 14 }}
                placeholder="Koszt materiałów PLN (opcjonalnie)"
                inputMode="decimal"
                value={finishUsageKoszt}
                onChange={(e) => setFinishUsageKoszt(e.target.value)}
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                Koszty operacyjne do marży (opcjonalnie)
              </div>
              <div style={{
                display: 'flex',
                gap: 10,
                padding: 10,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface-field)',
                marginBottom: 10,
                alignItems: 'flex-start',
              }}>
                <AttachMoney sx={{ fontSize: 18, color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                    {finishCostSuggestionsLoading ? 'Pobieram stawki oddzialu...' : 'Podpowiedzi ze stawek oddzialu'}
                  </div>
                  {finishCostSuggestions?.suggestions?.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {finishCostSuggestions.suggestions.map((item) => (
                        <button
                          key={item.category}
                          type="button"
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '6px 8px',
                            background: 'var(--surface-field)',
                            color: 'var(--text)',
                            cursor: Number(item.amount) > 0 ? 'pointer' : 'default',
                            fontSize: 12,
                          }}
                          onClick={() => {
                            const amount = Number(item.amount);
                            if (Number.isFinite(amount) && amount > 0) {
                              setFinishOperationalCosts((prev) => ({ ...prev, [item.category]: String(amount) }));
                            }
                          }}
                          title={item.basis}
                        >
                          {item.label}: {formatCurrency(item.amount || 0)}
                        </button>
                      ))}
                      <button
                        type="button"
                        style={{
                          border: '1px solid var(--accent)',
                          borderRadius: 8,
                          padding: '6px 8px',
                          background: 'var(--accent-soft, rgba(155,217,87,0.14))',
                          color: 'var(--accent)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                        onClick={() => setFinishOperationalCosts(suggestedFinishCosts())}
                      >
                        Uzyj sugestii
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Formularz przyjmie realne koszty, a backend odrzuci wartosci ujemne lub poza limitem marzy.
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                {[
                  ['sprzet', 'Sprzęt PLN'],
                  ['paliwo', 'Paliwo PLN'],
                  ['utylizacja', 'Utylizacja PLN'],
                  ['inne', 'Inne PLN'],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    style={styles.editInput}
                    placeholder={label}
                    inputMode="decimal"
                    value={finishOperationalCosts[key]}
                    onChange={(e) => setFinishOperationalCosts((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" style={styles.cancelBtn} disabled={finishSubmitting} onClick={() => setFinishModalOpen(false)}>
                  Anuluj
                </button>
                <button type="button" style={styles.saveBtn} disabled={finishSubmitting} onClick={() => void submitFinish()}>
                  {finishSubmitting ? '…' : 'Zakończ zlecenie'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal zdjęcia */}
        {selectedPhoto && (
          <div style={styles.overlay} onClick={() => setSelectedPhoto(null)}>
            <div style={styles.overlayContent} onClick={e => e.stopPropagation()}>
              <button type="button" style={styles.overlayClose} onClick={() => setSelectedPhoto(null)} aria-label={t('common.cancel')}>
                <CloseOutlined sx={{ fontSize: 20, color: '#fff' }} />
              </button>
              <img src={`${BASE}${selectedPhoto.sciezka}`} alt="Zdjęcie" style={styles.overlayImg} />
              <div style={styles.overlayInfo}>
                <strong>{selectedPhoto.typ === 'Przed' ? 'PRZED' : selectedPhoto.typ === 'Po' ? 'PO' : 'INNE'}</strong>
                <span>· {selectedPhoto.autor || '-'}</span>
                <span>· {formatDateTime(selectedPhoto.data_dodania)}</span>
              </div>
              <div style={styles.mediaMetaBox}>
                <textarea
                  style={{ ...styles.editInput, minHeight: 80 }}
                  placeholder="Opis..."
                  value={mediaOpisInput}
                  onChange={(e) => setMediaOpisInput(e.target.value)}
                />
                <input
                  style={styles.editInput}
                  placeholder="Tagi (po przecinku)"
                  value={mediaTagsInput}
                  onChange={(e) => setMediaTagsInput(e.target.value)}
                />
                <button type="button" style={styles.saveBtn} disabled={savingMediaMeta} onClick={savePhotoMeta}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <SaveOutlined sx={{ fontSize: 18 }} />
                    Zapisz metadane
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedVideo && (
          <div style={styles.overlay} onClick={() => setSelectedVideo(null)}>
            <div style={styles.overlayContent} onClick={e => e.stopPropagation()}>
              <button type="button" style={styles.overlayClose} onClick={() => setSelectedVideo(null)} aria-label={t('common.cancel')}>
                <CloseOutlined sx={{ fontSize: 20, color: '#fff' }} />
              </button>
              <video src={`${BASE}${selectedVideo.sciezka}`} controls style={styles.overlayVideo} />
              <div style={styles.overlayInfo}>
                <strong>{selectedVideo.nazwa || 'Film'}</strong>
                <span>· {selectedVideo.autor || '-'}</span>
                <span>· {formatDateTime(selectedVideo.created_at)}</span>
              </div>
              <div style={styles.mediaMetaBox}>
                <textarea
                  style={{ ...styles.editInput, minHeight: 80 }}
                  placeholder="Opis..."
                  value={mediaOpisInput}
                  onChange={(e) => setMediaOpisInput(e.target.value)}
                />
                <input
                  style={styles.editInput}
                  placeholder="Tagi (po przecinku)"
                  value={mediaTagsInput}
                  onChange={(e) => setMediaTagsInput(e.target.value)}
                />
                <button type="button" style={styles.saveBtn} disabled={savingMediaMeta} onClick={saveVideoMeta}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <SaveOutlined sx={{ fontSize: 18 }} />
                    Zapisz metadane
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoSection({ title, subtitle, photos, base, formatDateTime, onSelect, onDelete }) {
  return (
    <div style={{marginBottom: 24}}>
      <div style={styles.photoSectionTitle}>{title}</div>
      {subtitle ? <div style={styles.photoSectionSub}>{subtitle}</div> : null}
      <div style={styles.photoGrid}>
        {photos.map(p => (
          <div key={p.id} style={styles.photoCard} onClick={() => onSelect(p)}>
            <img src={`${base}${p.sciezka}`} alt={p.typ} style={styles.photoImg}
              onError={(e) => {
                const el = e.target;
                el.style.backgroundColor = 'var(--border)';
                el.style.height = '140px';
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.alt = '';
                el.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>');
              }}
            />
            <div style={styles.photoInfo}>
              <div style={styles.photoAutor}>{p.autor || '-'}</div>
              <div style={styles.photoTime}>{formatDateTime(p.data_dodania)}</div>
              {p.opis ? (
                <div style={styles.photoOpisSnippet} title={p.opis}>
                  {p.opis.length > 120 ? `${p.opis.slice(0, 120)}…` : p.opis}
                </div>
              ) : null}
              {Array.isArray(p.tagi) && p.tagi.length > 0 ? (
                <div style={styles.photoTagSnippet} title={p.tagi.join(', ')}>
                  {p.tagi.slice(0, 5).join(' · ')}
                  {p.tagi.length > 5 ? '…' : ''}
                </div>
              ) : null}
              <button
                type="button"
                style={styles.mediaDeleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p.id);
                }}
              >
                <DeleteOutline sx={{ fontSize: 14 }} />
                Usuń
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VideoSection({ title, videos, base, formatDateTime, onSelect, onDelete }) {
  return (
    <div style={{marginBottom: 24}}>
      <div style={styles.photoSectionTitle}>{title}</div>
      <div style={styles.photoGrid}>
        {videos.map(v => (
          <div key={v.id} style={styles.photoCard} onClick={() => onSelect(v)}>
            <div style={styles.videoThumb}>
              <SmartDisplayOutlined sx={{ fontSize: 42, color: '#1d4ed8' }} />
            </div>
            <div style={styles.photoInfo}>
              <div style={styles.photoAutor}>{v.nazwa || 'Film'}</div>
              <div style={styles.photoTime}>{formatDateTime(v.created_at)}</div>
              <button
                type="button"
                style={styles.mediaDeleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(v.id);
                }}
              >
                <DeleteOutline sx={{ fontSize: 14 }} />
                Usuń
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'var(--bg)', gap: 12 },
  spinner: { width: 24, height: 24, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  breadcrumb: { display: 'flex', gap: 8, fontSize: 14, alignItems: 'center', flexWrap: 'wrap' },
  link: { color: 'var(--accent)', cursor: 'pointer', fontWeight: '500', '&:hover': { textDecoration: 'underline' } },
  sep: { color: 'var(--text-muted)' },
  topActions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  pdfBtn: { padding: '8px 16px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)', cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s' },
  editBtn: { padding: '8px 18px', backgroundColor: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: '#1e40af' } },
  saveBtn: { padding: '8px 18px', backgroundColor: 'var(--success)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: '#166534' } },
  cancelBtn: { padding: '8px 18px', backgroundColor: 'var(--surface-field)', color: 'var(--text-sub)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  heroCard: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 24, marginBottom: 20, boxShadow: 'var(--shadow-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 },
  heroLeft: { flex: 1 },
  heroTitle: { fontSize: 'clamp(20px, 5vw, 24px)', fontWeight: 'bold', color: 'var(--accent)', marginBottom: 8 },
  heroAddr: { fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 },
  heroContact: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  phoneLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: '600', fontSize: 14 },
  mapBtn: { backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', padding: '4px 12px', borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: '500' },
  heroBadges: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  statusSelect: { padding: '6px 12px', borderRadius: 999, color: '#fff', fontSize: 13, fontWeight: '600', border: 'none', cursor: 'pointer' },
  prioBadge: {
    padding: '4px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'transparent',
  },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 },
  kpi: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '14px 16px', boxShadow: 'var(--shadow-md)', borderTopWidth: 3, borderTopStyle: 'solid', textAlign: 'center' },
  kpiIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiNum: { fontSize: 'clamp(14px, 3vw, 18px)', fontWeight: 'bold', color: 'var(--text)' },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border)', flexWrap: 'wrap' },
  tab: { padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 20, boxShadow: 'var(--shadow-md)', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  presenceCard: { background: 'var(--surface-glass)', borderRadius: 8, padding: 18, boxShadow: 'var(--shadow-md)', marginBottom: 20, border: '1px solid var(--glass-border)' },
  presenceHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  presenceTitleWrap: { display: 'flex', alignItems: 'center', gap: 12 },
  presenceIcon: { width: 42, height: 42, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  presenceTitle: { fontSize: 16, fontWeight: 800, color: 'var(--text)' },
  presenceSub: { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 },
  presencePill: { border: '1px solid var(--border)', borderRadius: 999, padding: '6px 10px', fontSize: 11, fontWeight: 800, letterSpacing: 0.5 },
  presenceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  presenceMetric: { backgroundColor: 'var(--surface-field)', borderRadius: 8, padding: '10px 12px', minWidth: 0 },
  presenceActions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  gpsHistoryBox: { marginTop: 14, border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.54)', padding: 12 },
  gpsHistoryHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  gpsHistoryTitle: { fontSize: 14, fontWeight: 900, color: 'var(--text)' },
  gpsHistorySub: { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 },
  gpsHistoryControls: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  gpsHistoryDateInput: { padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--surface-field)', color: 'var(--text)', fontSize: 12, fontWeight: 700 },
  gpsHistoryCount: { border: '1px solid var(--border)', borderRadius: 999, padding: '5px 9px', color: 'var(--accent)', backgroundColor: 'var(--surface-field)', fontSize: 12, fontWeight: 900 },
  gpsHistoryError: { border: '1px solid rgba(239,68,68,0.28)', color: 'var(--danger)', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '9px 10px', marginBottom: 10, fontSize: 12, fontWeight: 800 },
  gpsHistorySummary: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 },
  gpsHistoryStrip: { display: 'flex', alignItems: 'center', gap: 5, minHeight: 34, border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--surface-field)', padding: '9px 10px', overflowX: 'auto', marginBottom: 10 },
  gpsHistoryDot: { width: 10, height: 10, borderRadius: '50%', border: '1px solid rgba(15,95,58,0.22)', flex: '0 0 auto' },
  gpsHistoryTimeline: { display: 'grid', gap: 8, maxHeight: 300, overflow: 'auto', paddingRight: 2 },
  gpsHistoryPoint: { display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--surface-field)', padding: 10, minWidth: 0 },
  gpsHistoryPointDot: { width: 10, height: 10, borderRadius: '50%', flex: '0 0 auto' },
  gpsHistoryPointTitle: { color: 'var(--text)', fontSize: 13, fontWeight: 900 },
  gpsHistoryPointMeta: { color: 'var(--text-muted)', fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' },
  equipmentList: { display: 'grid', gap: 10 },
  equipmentCard: { border: '1px solid var(--border)', borderRadius: 8, padding: 12, backgroundColor: 'var(--surface-field)' },
  equipmentTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'var(--text)', flexWrap: 'wrap' },
  equipmentStatus: { padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  equipmentStatusActive: { backgroundColor: 'rgba(34,197,94,0.16)', color: 'var(--accent)' },
  equipmentStatusInactive: { backgroundColor: 'rgba(148,163,184,0.18)', color: 'var(--text-muted)' },
  equipmentMeta: { marginTop: 5, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.35 },
  equipmentNote: { marginTop: 8, padding: '8px 10px', borderRadius: 8, backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.45 },
  notatki: { marginTop: 16, backgroundColor: 'var(--surface-field)', borderRadius: 8, padding: 14 },
  notatkiLabel: { fontSize: 12, color: 'var(--warning)', fontWeight: '600', marginBottom: 6 },
  notatkiText: { fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.6 },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 },
  statusBtn: { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { transform: 'translateY(-1px)' } },
  mapBigBtn: { display: 'block', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: '500', marginBottom: 8, textAlign: 'center', transition: 'all 0.2s' },
  pdfBigBtn: { display: 'block', width: '100%', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 14, fontWeight: '500', textAlign: 'center', transition: 'all 0.2s' },
  smsInfo: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, padding: '6px 10px', backgroundColor: 'var(--surface-field)', borderRadius: 6 },
  smsBtn: { display: 'block', width: '100%', padding: '10px 14px', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', marginBottom: 8, textAlign: 'left', transition: 'all 0.2s' },
  noPhone: { textAlign: 'center', padding: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--surface-field)', borderRadius: 8 },
  evidenceWebCard: { border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--surface-field)', padding: 14, marginBottom: 16 },
  evidenceWebHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  evidenceWebTitle: { fontSize: 15, fontWeight: 900, color: 'var(--text)' },
  evidenceWebSub: { fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.35 },
  evidenceWebScore: { border: '1px solid var(--border)', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' },
  evidenceWebGrid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  evidenceWebChip: { border: '1px solid var(--border)', borderRadius: 999, backgroundColor: 'var(--surface-field)', color: 'var(--text-sub)', padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  evidenceWebChipActive: { color: 'var(--accent)', borderColor: 'var(--accent)', backgroundColor: 'rgba(34,197,94,0.12)' },
  evidenceWebChipMissing: { color: 'var(--warning)', borderColor: 'rgba(245,158,11,0.4)', backgroundColor: 'rgba(245,158,11,0.12)' },
  evidenceWebMissing: { marginTop: 10, color: 'var(--warning)', fontSize: 12, fontWeight: 800 },
  evidenceWebOk: { marginTop: 10, color: 'var(--success)', fontSize: 12, fontWeight: 800 },
  empty: { textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 14 },
  emptyBig: { textAlign: 'center', color: 'var(--text-muted)', padding: 48, fontSize: 14 },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 },
  emptySub: { fontSize: 12, marginTop: 4, opacity: 0.7 },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  th: { padding: '12px 14px', backgroundColor: 'var(--surface-field)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 13, fontWeight: '700' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  badge: { padding: '3px 10px', borderRadius: 999, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  mapLink: { color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontWeight: '500' },
  issueCard: { padding: 14, backgroundColor: 'var(--surface-field)', borderRadius: 8, marginBottom: 12, borderLeft: '4px solid var(--warning)' },
  issueHeader: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  issueOpis: { fontSize: 14, color: 'var(--text-sub)', margin: '8px 0 4px', lineHeight: 1.5 },
  issueFooter: { fontSize: 11, color: 'var(--text-muted)', marginTop: 6 },
  zdjeciaHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 },
  uploadBox: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filtrSelect: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  uploadBtn: { padding: '8px 16px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.22)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s' },
  photoSectionTitle: { fontSize: 13, fontWeight: '600', color: 'var(--accent)', marginBottom: 12, display: 'inline-block', backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', padding: '4px 12px', borderRadius: 6 },
  photoSectionSub: { fontSize: 12, color: 'var(--text-muted)', marginTop: -6, marginBottom: 10 },
  photoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 },
  photoCard: { borderRadius: 8, overflow: 'hidden', boxShadow: 'var(--shadow-md)', cursor: 'pointer', background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', transition: 'all 0.2s' },
  photoImg: { width: '100%', height: 140, objectFit: 'cover', display: 'block' },
  photoInfo: { padding: '8px 10px' },
  photoAutor: { fontSize: 12, fontWeight: '600', color: 'var(--text)' },
  photoTime: { fontSize: 10, color: 'var(--text-muted)', marginTop: 2 },
  photoOpisSnippet: {
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.35,
    marginTop: 4,
    marginBottom: 2,
    maxHeight: 48,
    overflow: 'hidden',
  },
  photoTagSnippet: {
    fontSize: 10,
    color: 'var(--accent)',
    fontWeight: 600,
    marginTop: 2,
    marginBottom: 2,
    lineHeight: 1.3,
    maxHeight: 32,
    overflow: 'hidden',
  },
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  overlayContent: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 20, maxWidth: '80vw', position: 'relative' },
  overlayClose: { position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  overlayImg: { maxWidth: '70vw', maxHeight: '70vh', objectFit: 'contain', display: 'block', borderRadius: 8 },
  overlayVideo: { maxWidth: '70vw', maxHeight: '70vh', display: 'block', borderRadius: 8 },
  overlayInfo: { marginTop: 10, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  videoThumb: { width: '100%', height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-field)' },
  mediaMetaBox: { display: 'grid', gap: 8, marginTop: 10 },
  mediaDeleteBtn: { marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid rgba(248,113,113,0.35)', color: 'var(--danger)', background: 'transparent', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' },
  inlineForm: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' },
  workflowRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', backgroundColor: 'var(--surface-field)', borderRadius: 8 },
  editInput: { width: '100%', padding: '8px 12px', borderRadius: 8, border: '2px solid var(--accent)', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  editInputSm: { padding: '5px 8px', borderRadius: 6, border: '1px solid var(--accent)', fontSize: 13, outline: 'none' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 14, gap: 12 },
  rowLabel: { color: 'var(--text-muted)', flexShrink: 0 },
  rowValue: { fontWeight: '600', color: 'var(--text)', textAlign: 'right', wordBreak: 'break-word' }
};

// Dodaj animację
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);
