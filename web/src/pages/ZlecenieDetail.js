import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import TaskStatusIcon from '../components/TaskStatusIcon';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const BASE = '';

const STATUS_KOLOR = {
  Nowe: 'var(--accent)',
  Zaplanowane: '#15803D',
  W_Realizacji: '#F9A825',
  Zakonczone: '#166534',
  Anulowane: '#EF5350'
};

const PRIORYTET_KOLOR = {
  Niski: '#9CA3AF',
  Normalny: '#2196F3',
  Wysoki: '#F9A825',
  Pilny: '#EF5350'
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

export default function ZlecenieDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef();
  const videoInputRef = useRef();
  const documentInputRef = useRef();
  const [zlecenie, setZlecenie] = useState(null);
  const [workLogs, setWorkLogs] = useState([]);
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
  const [typZdjecia, setTypZdjecia] = useState('Przed');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
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

  const isBrygadzista = currentUser?.rola === 'Brygadzista';
  const isPomocnik = currentUser?.rola === 'Pomocnik';
  const canEdit = !isBrygadzista && !isPomocnik;

 useEffect(() => {
  const token = getStoredToken();
  if (!token) { navigate('/'); return; }
  const u = getLocalStorageJson('user');
  if (u) setCurrentUser(u);
  loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [id]);

  const loadAll = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [zRes, wRes, iRes, pRes, vRes, dRes, wfRes, docsRes, intRes] = await Promise.all([
        api.get(`/tasks/${id}`, { headers: h }),
        api.get(`/tasks/${id}/logi`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/problemy`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/zdjecia`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/wideo`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/dniowki/zlecenie/${id}`, { headers: h }).catch(() => ({ data: { dniowki: [] } })),
        api.get(`/tasks/${id}/workflow`, { headers: h }).catch(() => ({ data: { checklist: [], reminders: [], events: [], sla: { checklist_done: 0, checklist_total: 0, reminders_overdue: 0 } } })),
        api.get(`/tasks/${id}/dokumenty`, { headers: h }).catch(() => ({ data: [] })),
        api.get(`/tasks/${id}/integrations`, { headers: h }).catch(() => ({ data: { settings: { sms: true, email: true, push: true, auto_on_status: true, auto_on_reminder: true }, logs: [] } })),
      ]);
      setZlecenie(zRes.data);
      setEditForm(zRes.data);
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
      console.log('Błąd ładowania:', err);
      showMsg(errorMessage('Błąd ładowania danych'));
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/tasks/${id}`, editForm, {
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
      await api.put(`/tasks/${id}/status`, { status }, {
        headers: authHeaders(token)
      });
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

  const uploadZdjecie = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const token = getStoredToken();
      const formData = new FormData();
      formData.append('zdjecie', file);
      formData.append('typ', typZdjecia);
      await api.post(`/tasks/${id}/zdjecia`, formData, {
        headers: { ...authHeaders(token), 'Content-Type': 'multipart/form-data' }
      });
      showMsg(successMessage('Zdjęcie dodane!'));
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

  const zdjeciaPrzed = zdjecia.filter(z => z.typ === 'Przed' || z.typ === 'przed');
  const zdjeciaPo = zdjecia.filter(z => z.typ === 'Po' || z.typ === 'po');
  const zdjeciaInne = zdjecia.filter(z => !['Przed', 'przed', 'Po', 'po'].includes(z.typ));
  const mediaSearchNorm = mediaSearch.trim().toLowerCase();
  const mediaSortFactor = mediaSort === 'oldest' ? 1 : -1;
  const filteredPhotos = zdjecia
    .filter((x) => mediaTypeFilter === 'all' || mediaTypeFilter === 'photos')
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
                    <a href={`tel:${zlecenie.klient_telefon}`} style={{ ...styles.phoneLink, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <LocalPhoneOutlined sx={{ fontSize: 18 }} />
                      {zlecenie.klient_telefon}
                    </a>
                  )
                  : <span style={{color:'#9CA3AF', fontSize:13}}>Brak telefonu</span>
              }
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
              <select style={{...styles.statusSelect, backgroundColor: STATUS_KOLOR[zlecenie.status] || '#6B7280'}}
                value={zlecenie.status} onChange={e => zmienStatus(e.target.value)}>
                {['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane'].map((s) => (
                  <option key={s} value={s}>{t(`taskStatus.${s}`, { defaultValue: s })}</option>
                ))}
              </select>
            ) : (
              <span style={{ ...styles.statusSelect, backgroundColor: STATUS_KOLOR[zlecenie.status] || '#6B7280', padding: '6px 16px', borderRadius: 20, color: '#fff', fontSize: 13, fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TaskStatusIcon status={zlecenie.status} size={16} color="#fff" />
                {t(`taskStatus.${zlecenie.status}`, { defaultValue: zlecenie.status })}
              </span>
            )}
            <span style={{ ...styles.prioBadge, color: PRIORYTET_KOLOR[zlecenie.priorytet] || '#9CA3AF', borderColor: PRIORYTET_KOLOR[zlecenie.priorytet] || '#9CA3AF', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <FiberManualRecord sx={{ fontSize: 14, color: PRIORYTET_KOLOR[zlecenie.priorytet] || '#9CA3AF' }} />
              {zlecenie.priorytet || 'Normalny'}
            </span>
          </div>
        </div>

        {/* KPI */}
        <div style={styles.kpiRow}>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent)' }}>
            <div style={styles.kpiIcon}><AttachMoney sx={{ fontSize: 26, color: 'var(--accent)' }} /></div>
            <div style={styles.kpiNum}>{formatCurrency(wartosc)}</div>
            <div style={styles.kpiLabel}>Wartość</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#F9A825' }}>
            <div style={styles.kpiIcon}><ScheduleOutlined sx={{ fontSize: 26, color: '#F9A825' }} /></div>
            <div style={styles.kpiNum}>{formatMinutes(lacznie)}</div>
            <div style={styles.kpiLabel}>Czas pracy</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#EF5350' }}>
            <div style={styles.kpiIcon}><PaymentsOutlined sx={{ fontSize: 26, color: '#EF5350' }} /></div>
            <div style={styles.kpiNum}>{formatCurrency(kosztRobocizny)}</div>
            <div style={styles.kpiLabel}>Koszt robocizny</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: marza >= 0 ? '#4CAF50' : '#EF5350' }}>
            <div style={styles.kpiIcon}>{marza >= 0 ? <TrendingUpOutlined sx={{ fontSize: 26, color: '#4CAF50' }} /> : <TrendingDownOutlined sx={{ fontSize: 26, color: '#EF5350' }} />}</div>
            <div style={{ ...styles.kpiNum, color: marza >= 0 ? '#4CAF50' : '#EF5350' }}>
              {formatCurrency(marza)} ({marzaProcent}%)
            </div>
            <div style={styles.kpiLabel}>Marża</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#F9A825' }}>
            <div style={styles.kpiIcon}><WarningAmberOutlined sx={{ fontSize: 26, color: '#F9A825' }} /></div>
            <div style={styles.kpiNum}>{issues.length}</div>
            <div style={styles.kpiLabel}>Problemy</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#2196F3' }}>
            <div style={styles.kpiIcon}><PhotoCameraOutlined sx={{ fontSize: 26, color: '#2196F3' }} /></div>
            <div style={styles.kpiNum}>{zdjecia.length}</div>
            <div style={styles.kpiLabel}>Zdjęcia</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#38bdf8' }}>
            <div style={styles.kpiIcon}><SmartDisplayOutlined sx={{ fontSize: 26, color: '#38bdf8' }} /></div>
            <div style={styles.kpiNum}>{wideo.length}</div>
            <div style={styles.kpiLabel}>Filmy</div>
          </div>
        </div>

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
                    {['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane'].map((s) => (
                      <button key={s} type="button" style={{
                        ...styles.statusBtn,
                        backgroundColor: zlecenie.status === s ? STATUS_KOLOR[s] : 'var(--border)',
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

              {/* SMS */}
              {canEdit && (
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
                <div style={{ marginTop: 12, fontSize: 12, color: workflowSla.reminders_overdue > 0 ? '#EF5350' : 'var(--text-muted)' }}>
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
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Pracownik</th>
                      <th style={styles.th}>Start</th>
                      <th style={styles.th}>Stop</th>
                      <th style={styles.th}>Czas</th>
                      <th style={styles.th}>GPS start</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workLogs.map((w, i) => (
                      <tr key={w.id} style={{backgroundColor: i%2===0?'var(--bg-card)':'var(--bg-deep)'}}>
                        <td style={{...styles.td, fontWeight:'600'}}>{w.pracownik || '-'}</td>
                        <td style={styles.td}>{formatDateTime(w.start_time)}</td>
                        <td style={styles.td}>{formatDateTime(w.end_time)}</td>
                        <td style={{...styles.td, fontWeight:'600', color:'var(--accent)'}}>{formatMinutes(w.duration_hours * 60 || w.czas_pracy_minuty)}</td>
                        <td style={styles.td}>
                          {w.start_lat
                            ? <a href={`https://maps.google.com/?q=${w.start_lat},${w.start_lng}`} target="_blank" rel="noreferrer" style={styles.mapLink}>📍 GPS</a>
                            : '-'}
                        </td>
                        <td style={styles.td}>
                          <span style={{ ...styles.badge, backgroundColor: w.status === 'Zakończony' ? '#166534' : '#b45309', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {w.status === 'Zakończony' ? <CheckCircleOutline sx={{ fontSize: 14 }} /> : <HourglassEmptyOutlined sx={{ fontSize: 14 }} />}
                            {w.status === 'Zakończony' ? 'Zakończony' : 'W trakcie'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr style={{backgroundColor:'rgba(52,211,153,0.1)'}}>
                      <td style={{...styles.td, fontWeight:'bold'}} colSpan={3}>ŁĄCZNIE</td>
                      <td style={{...styles.td, fontWeight:'bold', color:'var(--accent)', fontSize:16}}>{formatMinutes(lacznie)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
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
                      <span style={{ fontSize: 12, color: issue.status === 'Zgloszony' ? '#F9A825' : '#4CAF50', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {issue.status === 'Zgloszony' ? <PendingOutlined sx={{ fontSize: 14 }} /> : <CheckCircleOutline sx={{ fontSize: 14 }} />}
                        {issue.status === 'Zgloszony' ? 'Zgłoszony' : 'Rozwiązany'}
                      </span>
                      <span style={{fontSize:12, color:'#9CA3AF', marginLeft:'auto'}}>{formatDateTime(issue.created_at)}</span>
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
                  <option value="Przed">Przed pracą</option>
                  <option value="Po">Po pracy</option>
                  <option value="inne">Inne</option>
                </select>
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
                {zdjeciaPrzed.length > 0 && <PhotoSection title={`Przed pracą (${zdjeciaPrzed.length})`} photos={zdjeciaPrzed.filter((x) => filteredPhotos.some((f) => f.id === x.id))} base={BASE} formatDateTime={formatDateTime} onSelect={(p) => { setSelectedPhoto(p); refreshMediaEditor(p); }} onDelete={deletePhoto} />}
                {zdjeciaPo.length > 0 && <PhotoSection title={`Po pracy (${zdjeciaPo.length})`} photos={zdjeciaPo.filter((x) => filteredPhotos.some((f) => f.id === x.id))} base={BASE} formatDateTime={formatDateTime} onSelect={(p) => { setSelectedPhoto(p); refreshMediaEditor(p); }} onDelete={deletePhoto} />}
                {zdjeciaInne.length > 0 && <PhotoSection title={`Inne (${zdjeciaInne.length})`} photos={zdjeciaInne.filter((x) => filteredPhotos.some((f) => f.id === x.id))} base={BASE} formatDateTime={formatDateTime} onSelect={(p) => { setSelectedPhoto(p); refreshMediaEditor(p); }} onDelete={deletePhoto} />}
                {filteredVideos.length > 0 && <VideoSection title={`Filmy (${filteredVideos.length})`} videos={filteredVideos} base={BASE} formatDateTime={formatDateTime} onSelect={(v) => { setSelectedVideo(v); refreshMediaEditor(v); }} onDelete={deleteVideo} />}
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
                {zlecenie?.status === 'Zakonczone' ? (
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
                    <div key={d.id} style={{ backgroundColor: 'var(--bg-deep)', borderRadius: 12, padding: 16, border: `1px solid ${d.zatwierdzona ? 'var(--accent)' : 'var(--border)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontWeight: '600', color: 'var(--text)', fontSize: 15 }}>
                          {d.imie} {d.nazwisko}
                        </div>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, backgroundColor: d.zatwierdzona ? 'var(--accent)22' : '#F59E0B22', color: d.zatwierdzona ? 'var(--accent)' : '#F59E0B', fontWeight: '600' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {d.zatwierdzona ? <CheckCircleOutline sx={{ fontSize: 14 }} /> : <HourglassEmptyOutlined sx={{ fontSize: 14 }} />}
                            {d.zatwierdzona ? 'Zatwierdzona' : 'Oczekuje'}
                          </span>
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{d.rola}</div>
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

function PhotoSection({ title, photos, base, formatDateTime, onSelect, onDelete }) {
  return (
    <div style={{marginBottom: 24}}>
      <div style={styles.photoSectionTitle}>{title}</div>
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
              <SmartDisplayOutlined sx={{ fontSize: 42, color: '#38bdf8' }} />
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
  pdfBtn: { padding: '8px 16px', backgroundColor: 'var(--bg-deep)', color: '#fff', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
  editBtn: { padding: '8px 18px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: '#1976D2' } },
  saveBtn: { padding: '8px 18px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-card)' } },
  cancelBtn: { padding: '8px 18px', backgroundColor: 'var(--bg-card)', color: 'var(--text-sub)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  heroCard: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 },
  heroLeft: { flex: 1 },
  heroTitle: { fontSize: 'clamp(20px, 5vw, 24px)', fontWeight: 'bold', color: 'var(--accent)', marginBottom: 8 },
  heroAddr: { fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 },
  heroContact: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  phoneLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: '600', fontSize: 14 },
  mapBtn: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '4px 12px', borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: '500' },
  heroBadges: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  statusSelect: { padding: '6px 12px', borderRadius: 20, color: '#fff', fontSize: 13, fontWeight: '600', border: 'none', cursor: 'pointer' },
  prioBadge: {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'transparent',
  },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 },
  kpi: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderTopWidth: 3, borderTopStyle: 'solid', textAlign: 'center' },
  kpiIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiNum: { fontSize: 'clamp(14px, 3vw, 18px)', fontWeight: 'bold', color: 'var(--text)' },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border)', flexWrap: 'wrap' },
  tab: { padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  notatki: { marginTop: 16, backgroundColor: 'var(--bg-deep)', borderRadius: 8, padding: 14 },
  notatkiLabel: { fontSize: 12, color: '#F9A825', fontWeight: '600', marginBottom: 6 },
  notatkiText: { fontSize: 14, color: 'var(--text-sub)', lineHeight: 1.6 },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 },
  statusBtn: { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { transform: 'translateY(-1px)' } },
  mapBigBtn: { display: 'block', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '12px 16px', borderRadius: 10, textDecoration: 'none', fontSize: 14, fontWeight: '500', marginBottom: 8, textAlign: 'center', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--border2)' } },
  pdfBigBtn: { display: 'block', width: '100%', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '12px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: '500', textAlign: 'center', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--border2)' } },
  smsInfo: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, padding: '6px 10px', backgroundColor: 'var(--bg-deep)', borderRadius: 6 },
  smsBtn: { display: 'block', width: '100%', padding: '10px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', marginBottom: 8, textAlign: 'left', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--border2)', transform: 'translateX(4px)' } },
  noPhone: { textAlign: 'center', padding: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 8 },
  empty: { textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 14 },
  emptyBig: { textAlign: 'center', color: 'var(--text-muted)', padding: 48, fontSize: 14 },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 },
  emptySub: { fontSize: 12, marginTop: 4, opacity: 0.7 },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  th: { padding: '12px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  badge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  mapLink: { color: 'var(--accent)', textDecoration: 'none', fontSize: 12, fontWeight: '500' },
  issueCard: { padding: 14, backgroundColor: 'var(--bg-deep)', borderRadius: 8, marginBottom: 12, borderLeft: '4px solid #F9A825' },
  issueHeader: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  issueOpis: { fontSize: 14, color: 'var(--text-sub)', margin: '8px 0 4px', lineHeight: 1.5 },
  issueFooter: { fontSize: 11, color: 'var(--text-muted)', marginTop: 6 },
  zdjeciaHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 },
  uploadBox: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filtrSelect: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  uploadBtn: { padding: '8px 16px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)' } },
  photoSectionTitle: { fontSize: 13, fontWeight: '600', color: 'var(--accent)', marginBottom: 12, display: 'inline-block', backgroundColor: 'var(--bg-deep)', padding: '4px 12px', borderRadius: 6 },
  photoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 },
  photoCard: { borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer', backgroundColor: 'var(--bg-card)', transition: 'all 0.2s', '&:hover': { transform: 'scale(1.02)' } },
  photoImg: { width: '100%', height: 140, objectFit: 'cover', display: 'block' },
  photoInfo: { padding: '8px 10px' },
  photoAutor: { fontSize: 12, fontWeight: '600', color: 'var(--text)' },
  photoTime: { fontSize: 10, color: 'var(--text-muted)', marginTop: 2 },
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  overlayContent: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 20, maxWidth: '80vw', position: 'relative' },
  overlayClose: { position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  overlayImg: { maxWidth: '70vw', maxHeight: '70vh', objectFit: 'contain', display: 'block', borderRadius: 8 },
  overlayVideo: { maxWidth: '70vw', maxHeight: '70vh', display: 'block', borderRadius: 8 },
  overlayInfo: { marginTop: 10, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  videoThumb: { width: '100%', height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-deep)' },
  mediaMetaBox: { display: 'grid', gap: 8, marginTop: 10 },
  mediaDeleteBtn: { marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #EF5350', color: '#EF5350', background: 'transparent', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' },
  inlineForm: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' },
  workflowRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', backgroundColor: 'var(--bg-deep)', borderRadius: 8 },
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
