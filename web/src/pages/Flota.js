import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import CommandSidebar from '../components/CommandSidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { CalendarDays, CheckCircle, FileText, Image, Pencil, Plus, Save, Trash2, Upload, Wrench, X } from 'lucide-react';
import AutorenewOutlined from '@mui/icons-material/AutorenewOutlined';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import ConstructionOutlined from '@mui/icons-material/ConstructionOutlined';
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined';
import HandymanOutlined from '@mui/icons-material/HandymanOutlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SecurityOutlined from '@mui/icons-material/SecurityOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { localDateKey } from '../utils/localDateKey';

const ALERT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(value) {
  return value ? String(value).split('T')[0] : '-';
}

function formDate(value) {
  return value ? String(value).split('T')[0] : '';
}

function dateHealth(value, now = new Date()) {
  if (!value) return { state: 'missing', days: null };
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return { state: 'missing', days: null };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.ceil((dueDay.getTime() - today.getTime()) / DAY_MS);
  if (days < 0) return { state: 'expired', days };
  if (days <= ALERT_WINDOW_DAYS) return { state: 'soon', days };
  return { state: 'ok', days };
}

function dueAlert(kind, value, now) {
  const health = dateHealth(value, now);
  if (health.state === 'expired') {
    return { key: kind.key, state: 'expired', label: `${kind.label} po terminie`, detail: `${Math.abs(health.days)} dni po terminie`, color: '#c0492f' };
  }
  if (health.state === 'soon') {
    return { key: kind.key, state: 'soon', label: `${kind.label} za ${health.days} dni`, detail: fmtDate(value), color: '#bd701e' };
  }
  if (health.state === 'missing') {
    return { key: kind.key, state: 'missing', label: `Brak daty: ${kind.label}`, detail: 'uzupelnij karte', color: '#5a5040' };
  }
  return { key: kind.key, state: 'ok', label: `${kind.label} OK`, detail: fmtDate(value), color: '#7f8c12' };
}

function documentDueAlert(doc, now = new Date()) {
  if (!doc?.wazny_do) return null;
  const label = doc.kategoria || doc.nazwa_pliku || 'Dokument';
  const health = dateHealth(doc.wazny_do, now);
  if (health.state === 'expired') {
    return { key: `doc-${doc.id}`, state: 'expired', label: `${label} po terminie`, detail: `${Math.abs(health.days)} dni po terminie`, color: '#c0492f' };
  }
  if (health.state === 'soon') {
    return { key: `doc-${doc.id}`, state: 'soon', label: `${label} za ${health.days} dni`, detail: fmtDate(doc.wazny_do), color: '#bd701e' };
  }
  return null;
}

function priorityWeight(state) {
  if (state === 'expired') return 0;
  if (state === 'soon') return 1;
  if (state === 'missing') return 2;
  return 3;
}

const FLEET_STATUS_OPTIONS = ['Dostepny', 'W uzyciu', 'W naprawie', 'Niedostepny'];
const VEHICLE_TYPE_OPTIONS = ['Samochod', 'Bus', 'Ciezarowka', 'Przyczepa', 'Maszyna'];
const EQUIPMENT_TYPE_OPTIONS = ['Pilarka', 'Rebak', 'Podnosnik', 'Narzedzie', 'Inne'];
const REPAIR_PRIORITY_OPTIONS = ['Normalny', 'Pilny', 'Krytyczny'];
const FLEET_DOCUMENT_OPTIONS = ['OC', 'UDT', 'Gwarancja', 'Instrukcja', 'Faktura zakupu', 'Inne'];
const ACTIVE_RESERVATION_STATUSES = new Set(['Zarezerwowane', 'Wydane']);

function todayYmd() {
  return localDateKey();
}

function addMonthsYmd(months) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return localDateKey(date);
}

function reservationIsActive(reservation) {
  return ACTIVE_RESERVATION_STATUSES.has(String(reservation?.status || ''));
}

function reservationOverlaps(a, b) {
  return String(a?.data_od || '') <= String(b?.data_do || '') && String(a?.data_do || '') >= String(b?.data_od || '');
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zl`;
}

function repairIsClosed(status) {
  return String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .includes('zakoncz');
}

function repairDueState(repair, now = new Date()) {
  if (!repair?.termin_odbioru || repairIsClosed(repair.status)) return { state: 'none', days: null };
  const due = new Date(repair.termin_odbioru);
  if (Number.isNaN(due.getTime())) return { state: 'none', days: null };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.ceil((dueDay.getTime() - today.getTime()) / DAY_MS);
  if (days < 0) return { state: 'overdue', days };
  if (days <= 2) return { state: 'soon', days };
  return { state: 'ok', days };
}

function repairDowntimeDays(repair, now = new Date()) {
  if (!repair?.data_naprawy) return 0;
  const start = new Date(repair.data_naprawy);
  if (Number.isNaN(start.getTime())) return 0;
  const endSource = repair.data_zakonczenia || (repairIsClosed(repair.status) ? repair.updated_at : now);
  const end = new Date(endSource || now);
  if (Number.isNaN(end.getTime())) return 0;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.ceil((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1);
}

function repairDowntimeLoss(repair) {
  return repairDowntimeDays(repair) * (Number(repair?.strata_dzienna || 0) || 0);
}

function normalizeFleetTab(value) {
  const text = String(value || '').toLowerCase();
  if (['sprzet', 'equipment'].includes(text)) return 'sprzet';
  if (['naprawy', 'repairs', 'repair'].includes(text)) return 'naprawy';
  if (['pojazdy', 'vehicles', 'vehicle'].includes(text)) return 'pojazdy';
  return 'pojazdy';
}

function normalizeRepairKind(value) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (['auto', 'pojazd', 'vehicle', 'vehicles', 'car'].includes(text)) return 'pojazd';
  if (['sprzet', 'equipment', 'tool'].includes(text)) return 'sprzet';
  return '';
}

function MaintenanceControlPanel({ summary, activeFilter, onOpenRepairs, onNewRepair, onExport }) {
  const filters = [
    { key: 'all', label: 'Wszystkie', count: summary.allCount },
    { key: 'open', label: 'Otwarte', count: summary.openCount },
    { key: 'overdue', label: 'Po terminie', count: summary.overdueCount },
    { key: 'noInvoice', label: 'Bez faktury', count: summary.withoutInvoiceCount },
    { key: 'closed', label: 'Zamkniete', count: summary.closedCount },
  ];
  return (
    <section style={S.maintenancePanel}>
      <div style={S.maintenanceHeader}>
        <div>
          <div style={S.maintenanceEyebrow}>Kontrola napraw</div>
          <h2 style={S.maintenanceTitle}>
            {summary.openCount ? `${summary.openCount} otwarte naprawy` : 'Naprawy pod kontrola'}
          </h2>
        </div>
        <div style={S.maintenanceActions}>
          <Button variant="secondary" size="sm" style={S.maintenanceSecondaryBtn} leftIcon={FileText} onClick={onExport}>Eksport CSV</Button>
          <Button size="sm" style={S.maintenancePrimaryBtn} leftIcon={Plus} onClick={onNewRepair}>Nowa naprawa</Button>
        </div>
      </div>
      <div style={S.maintenanceFilters}>
        {filters.map((filter) => (
          <Button
            key={filter.key}
            variant={activeFilter === filter.key ? 'primary' : 'secondary'}
            size="sm"
            style={{ ...S.maintenanceFilterBtn, ...(activeFilter === filter.key ? S.maintenanceFilterBtnActive : {}) }}
            onClick={() => onOpenRepairs(filter.key)}
          >
            {filter.label} <strong>{filter.count}</strong>
          </Button>
        ))}
      </div>
      <div style={S.maintenanceGrid}>
        <div style={S.maintenanceMetric}>
          <span>Koszt razem</span>
          <strong>{formatMoney(summary.totalCost)}</strong>
          <small>serwis, czesci, faktury</small>
        </div>
        <div style={S.maintenanceMetric}>
          <span>Koszt otwarty</span>
          <strong>{formatMoney(summary.openCost)}</strong>
          <small>aktywnie blokuje zasoby</small>
        </div>
        <div style={S.maintenanceMetric}>
          <span>Strata przestoju</span>
          <strong>{formatMoney(summary.downtimeLoss)}</strong>
          <small>{summary.downtimeDays} dni bez zasobu</small>
        </div>
        <div style={S.maintenanceMetric}>
          <span>Faktury</span>
          <strong>{formatMoney(summary.invoiceCost)}</strong>
          <small>udokumentowane koszty</small>
        </div>
        <div style={S.maintenanceMetric}>
          <span>Czesci</span>
          <strong>{formatMoney(summary.partsCost)}</strong>
          <small>materialy w naprawach</small>
        </div>
        <div style={S.maintenanceMetric}>
          <span>Po terminie</span>
          <strong style={{ color: summary.overdueCount ? 'var(--danger)' : 'var(--text)' }}>{summary.overdueCount}</strong>
          <small>{summary.soonCount} blisko terminu</small>
        </div>
        <div style={S.maintenanceMetric}>
          <span>Bez faktury</span>
          <strong>{summary.withoutInvoiceCount}</strong>
          <small>koszt wpisany, brak dokumentu</small>
        </div>
      </div>
      <div style={S.maintenanceTopList}>
        {summary.topRepairs.length ? summary.topRepairs.map((repair) => (
          <Button key={repair.id} variant="secondary" style={S.maintenanceTopItem} onClick={() => onOpenRepairs('all')}>
            <span>{repair.assetLabel}</span>
            <strong>{formatMoney(repair.costValue)}</strong>
          </Button>
        )) : (
          <div style={S.maintenanceEmpty}>Brak kosztow napraw do analizy.</div>
        )}
      </div>
    </section>
  );
}

export default function Flota() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [pojazdy, setPojazdy] = useState([]);
  const [sprzet, setSprzet] = useState([]);
  const [naprawy, setNaprawy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pojazdy');
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [editingPojazdId, setEditingPojazdId] = useState(null);
  const [editingSprzetId, setEditingSprzetId] = useState(null);
  const [repairDraft, setRepairDraft] = useState(null);
  const [repairSaving, setRepairSaving] = useState(false);
  const [assetPhotos, setAssetPhotos] = useState({});
  const [assetDocuments, setAssetDocuments] = useState({});
  const [assetHistory, setAssetHistory] = useState({});
  const [assetDocumentDrafts, setAssetDocumentDrafts] = useState({});
  const [photoUploadingKey, setPhotoUploadingKey] = useState('');
  const [documentUploadingKey, setDocumentUploadingKey] = useState('');
  const [repairInvoices, setRepairInvoices] = useState({});
  const [invoiceDrafts, setInvoiceDrafts] = useState({});
  const [invoiceUploadingId, setInvoiceUploadingId] = useState('');
  const [repairParts, setRepairParts] = useState({});
  const [partDrafts, setPartDrafts] = useState({});
  const [partSavingId, setPartSavingId] = useState('');
  const [assetReservations, setAssetReservations] = useState({});
  const [reservationDrafts, setReservationDrafts] = useState({});
  const [reservationSavingKey, setReservationSavingKey] = useState('');
  const [protocolDrafts, setProtocolDrafts] = useState({});
  const [protocolFiles, setProtocolFiles] = useState({});
  const [protocolSavingId, setProtocolSavingId] = useState('');
  const [protocolOpenId, setProtocolOpenId] = useState('');
  const [repairQuickFilter, setRepairQuickFilter] = useState('all');

  const [formPojazd, setFormPojazd] = useState({
    marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '',
    typ: 'Samochod', status: 'Dostepny', ekipa_id: '', data_przegladu: '',
    data_ubezpieczenia: '', przebieg: '', notatki: '', oddzial_id: ''
  });

  const [formSprzet, setFormSprzet] = useState({
    nazwa: '', typ: 'Pilarka', status: 'Dostepny', nr_seryjny: '', rok_produkcji: '',
    ekipa_id: '', data_przegladu: '', koszt_motogodziny: '',
    notatki: '', oddzial_id: ''
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const tab = params.get('tab');
    if (tab) setActiveTab(normalizeFleetTab(tab));
  }, [location.search]);

  const loadAll = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [pRes, sRes, nRes, oRes, eRes] = await Promise.all([
        api.get(`/flota/pojazdy`, { headers: h }),
        api.get(`/flota/sprzet`, { headers: h }),
        api.get(`/flota/naprawy`, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
      ]);
      setPojazdy(pRes.data);
      setSprzet(sRes.data);
      setNaprawy(nRes.data);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const parsed = getLocalStorageJson('user');
    if (parsed) {
      setCurrentUser(parsed);
      if (!['Prezes', 'Dyrektor', 'Administrator'].includes(parsed.rola)) {
        setFiltrOddzial(parsed.oddzial_id?.toString() || '');
      }
    }
    loadAll();
  }, [navigate, loadAll]);

  const isDyrektor = ['Prezes', 'Dyrektor', 'Administrator'].includes(currentUser?.rola);
  const canEdit = isDyrektor || currentUser?.rola === 'Kierownik';

  const resetPojazdForm = () => {
    setEditingPojazdId(null);
    setFormPojazd({ marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '', typ: 'Samochod', status: 'Dostepny', ekipa_id: '', data_przegladu: '', data_ubezpieczenia: '', przebieg: '', notatki: '', oddzial_id: '' });
  };

  const resetSprzetForm = () => {
    setEditingSprzetId(null);
    setFormSprzet({ nazwa: '', typ: 'Pilarka', status: 'Dostepny', nr_seryjny: '', rok_produkcji: '', ekipa_id: '', data_przegladu: '', koszt_motogodziny: '', notatki: '', oddzial_id: '' });
  };

  const handleToggleForm = () => {
    if (showForm) {
      setShowForm(false);
      resetPojazdForm();
      resetSprzetForm();
      return;
    }
    if (activeTab === 'sprzet') resetSprzetForm();
    else resetPojazdForm();
    setShowForm(true);
  };

  const handleAddPojazd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      const existingPojazd = editingPojazdId ? pojazdy.find((item) => item.id === editingPojazdId) : null;
      const payload = {
        ...formPojazd,
        marka: formPojazd.marka.trim(),
        model: formPojazd.model.trim(),
        nr_rejestracyjny: formPojazd.nr_rejestracyjny.trim().toUpperCase(),
        notatki: formPojazd.notatki.trim(),
        ekipa_id: formPojazd.ekipa_id || existingPojazd?.ekipa_id || '',
        oddzial_id: formPojazd.oddzial_id || existingPojazd?.oddzial_id || currentUser?.oddzial_id
      };
      if (editingPojazdId) {
        await api.put(`/flota/pojazdy/${editingPojazdId}`, payload, { headers: authHeaders(token) });
      } else {
        await api.post(`/flota/pojazdy`, payload, { headers: authHeaders(token) });
      }
      showMsg(successMessage(editingPojazdId ? 'Pojazd zapisany' : t('pages.flota.toastVehicleAdded')));
      setShowForm(false);
      resetPojazdForm();
      loadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSprzet = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      const existingSprzet = editingSprzetId ? sprzet.find((item) => item.id === editingSprzetId) : null;
      const payload = {
        ...formSprzet,
        nazwa: formSprzet.nazwa.trim(),
        nr_seryjny: formSprzet.nr_seryjny.trim(),
        notatki: formSprzet.notatki.trim(),
        ekipa_id: formSprzet.ekipa_id || existingSprzet?.ekipa_id || '',
        oddzial_id: formSprzet.oddzial_id || existingSprzet?.oddzial_id || currentUser?.oddzial_id
      };
      if (editingSprzetId) {
        await api.put(`/flota/sprzet/${editingSprzetId}`, payload, { headers: authHeaders(token) });
      } else {
        await api.post(`/flota/sprzet`, payload, { headers: authHeaders(token) });
      }
      showMsg(successMessage(editingSprzetId ? 'Sprzet zapisany' : t('pages.flota.toastEquipmentAdded')));
      setShowForm(false);
      resetSprzetForm();
      loadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const zmienStatus = async (typ, id, status) => {
    try {
      const token = getStoredToken();
      await api.put(`/flota/${typ}/${id}/status`, { status }, {
        headers: authHeaders(token)
      });
      loadAll();
    } catch (err) { console.error(err); }
  };

  const startEditPojazd = (p) => {
    setActiveTab('pojazdy');
    setEditingSprzetId(null);
    setEditingPojazdId(p.id);
    setShowForm(true);
    setFormPojazd({
      marka: p.marka || '',
      model: p.model || '',
      nr_rejestracyjny: p.nr_rejestracyjny || '',
      rok_produkcji: p.rok_produkcji || '',
      typ: p.typ || 'Samochod',
      status: p.status || 'Dostepny',
      ekipa_id: p.ekipa_id || '',
      data_przegladu: formDate(p.data_przegladu),
      data_ubezpieczenia: formDate(p.data_ubezpieczenia),
      przebieg: p.przebieg || '',
      notatki: p.notatki || '',
      oddzial_id: p.oddzial_id || '',
    });
  };

  const startEditSprzet = (s) => {
    setActiveTab('sprzet');
    setEditingPojazdId(null);
    setEditingSprzetId(s.id);
    setShowForm(true);
    setFormSprzet({
      nazwa: s.nazwa || '',
      typ: s.typ || 'Pilarka',
      status: s.status || 'Dostepny',
      nr_seryjny: s.nr_seryjny || '',
      rok_produkcji: s.rok_produkcji || '',
      ekipa_id: s.ekipa_id || '',
      data_przegladu: formDate(s.data_przegladu),
      koszt_motogodziny: s.koszt_motogodziny || '',
      notatki: s.notatki || '',
      oddzial_id: s.oddzial_id || '',
    });
  };

  const deleteFleetItem = async (type, id) => {
    const label = type === 'pojazdy' ? 'pojazd' : 'sprzet';
    const ok = typeof window !== 'undefined' && window.confirm ? window.confirm(`Usunac ${label}?`) : true;
    if (!ok) return;
    try {
      const token = getStoredToken();
      await api.delete(`/flota/${type}/${id}`, { headers: authHeaders(token) });
      showMsg(successMessage(type === 'pojazdy' ? 'Pojazd usuniety' : 'Sprzet usuniety'));
      loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, `Nie udalo sie usunac ${label}.`)));
    }
  };

  const assetKey = (type, id) => `${type}:${id}`;

  const updateAssetTeam = async (type, item, ekipaId) => {
    try {
      const token = getStoredToken();
      const payload = {
        ...item,
        ekipa_id: ekipaId || '',
        oddzial_id: item.oddzial_id || currentUser?.oddzial_id || '',
      };
      await api.put(`/flota/${type}/${item.id}`, payload, { headers: authHeaders(token) });
      showMsg(successMessage(type === 'sprzet' ? 'Sprzet przepisany do ekipy.' : 'Pojazd przepisany do ekipy.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie przepisac zasobu do ekipy.')));
    }
  };

  const renewAssetInspection = async (type, item, months = 12) => {
    try {
      const token = getStoredToken();
      const nextDate = addMonthsYmd(months);
      const payload = {
        ...item,
        data_przegladu: nextDate,
        oddzial_id: item.oddzial_id || currentUser?.oddzial_id || '',
        ekipa_id: item.ekipa_id || '',
      };
      await api.put(`/flota/${type}/${item.id}`, payload, { headers: authHeaders(token) });
      showMsg(successMessage(`Przeglad ustawiony do ${nextDate}.`));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie odnowic przegladu.')));
    }
  };

  const loadAssetPhotos = async (type, id) => {
    const key = assetKey(type, id);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/flota/${type}/${id}/zdjecia`, { headers: authHeaders(token), dedupe: false });
      setAssetPhotos((prev) => ({ ...prev, [key]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie pobrac zdjec zasobu.')));
    }
  };

  const uploadAssetPhoto = async (type, item, file) => {
    if (!file) return;
    const key = assetKey(type, item.id);
    setPhotoUploadingKey(key);
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('zdjecie', file);
      form.append('opis', type === 'sprzet' ? 'Zdjecie sprzetu' : 'Zdjecie pojazdu');
      await api.post(`/flota/${type}/${item.id}/zdjecia`, form, { headers: authHeaders(token) });
      showMsg(successMessage('Zdjecie dodane do karty zasobu.'));
      await loadAssetPhotos(type, item.id);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie dodac zdjecia.')));
    } finally {
      setPhotoUploadingKey('');
    }
  };

  const deleteAssetPhoto = async (type, item, photoId) => {
    try {
      const token = getStoredToken();
      await api.delete(`/flota/${type}/${item.id}/zdjecia/${photoId}`, { headers: authHeaders(token) });
      showMsg(successMessage('Zdjecie usuniete.'));
      await loadAssetPhotos(type, item.id);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie usunac zdjecia.')));
    }
  };

  const loadAssetDocuments = async (type, id) => {
    const key = assetKey(type, id);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/flota/${type}/${id}/dokumenty`, { headers: authHeaders(token), dedupe: false });
      setAssetDocuments((prev) => ({ ...prev, [key]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie pobrac dokumentow zasobu.')));
    }
  };

  const loadAssetHistory = async (type, id) => {
    const key = assetKey(type, id);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/flota/${type}/${id}/historia`, { headers: authHeaders(token), dedupe: false });
      setAssetHistory((prev) => ({ ...prev, [key]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie pobrac historii zasobu.')));
    }
  };

  const loadAssetReservations = async (type, id) => {
    if (type !== 'sprzet') return;
    const key = assetKey(type, id);
    try {
      const token = getStoredToken();
      const from = todayYmd();
      const to = addMonthsYmd(2);
      const { data } = await api.get(`/flota/rezerwacje?from=${from}&to=${to}`, { headers: authHeaders(token), dedupe: false });
      const rows = (Array.isArray(data) ? data : [])
        .filter((row) => String(row.sprzet_id) === String(id))
        .sort((a, b) => String(a.data_od || '').localeCompare(String(b.data_od || '')));
      setAssetReservations((prev) => ({ ...prev, [key]: rows }));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie pobrac rezerwacji sprzetu.')));
    }
  };

  const setReservationDraft = (type, id, field, value) => {
    const key = assetKey(type, id);
    setReservationDrafts((prev) => ({
      ...prev,
      [key]: {
        ekipa_id: '',
        data_od: todayYmd(),
        data_do: todayYmd(),
        ...(prev[key] || {}),
        [field]: value,
      },
    }));
  };

  const createAssetReservation = async (item, status = 'Zarezerwowane') => {
    const key = assetKey('sprzet', item.id);
    const draft = reservationDrafts[key] || {};
    const ekipaId = draft.ekipa_id || item.ekipa_id || ekipy[0]?.id || '';
    const dataOd = draft.data_od || todayYmd();
    const dataDo = draft.data_do || dataOd;
    if (!ekipaId) {
      showMsg(errorMessage('Wybierz ekipe do wydania sprzetu.'));
      return;
    }
    const candidate = { data_od: dataOd, data_do: dataDo };
    const conflict = (assetReservations[key] || []).some((row) => reservationIsActive(row) && reservationOverlaps(row, candidate));
    if (conflict) {
      showMsg(errorMessage('Konflikt: ten sprzet jest juz zajety w tym terminie.'));
      return;
    }
    setReservationSavingKey(`${key}:${status}`);
    try {
      const token = getStoredToken();
      await api.post('/flota/rezerwacje', {
        sprzet_id: item.id,
        ekipa_id: ekipaId,
        data_od: dataOd,
        data_do: dataDo,
        caly_dzien: true,
        status,
      }, { headers: authHeaders(token) });
      showMsg(successMessage(status === 'Wydane' ? 'Sprzet wydany ekipie.' : 'Sprzet zarezerwowany.'));
      setReservationDrafts((prev) => ({ ...prev, [key]: { ekipa_id: ekipaId, data_od: todayYmd(), data_do: todayYmd() } }));
      await Promise.all([loadAssetReservations('sprzet', item.id), loadAssetHistory('sprzet', item.id), loadAll()]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zapisac rezerwacji sprzetu.')));
    } finally {
      setReservationSavingKey('');
    }
  };

  const updateReservationStatus = async (item, reservation, status) => {
    const key = assetKey('sprzet', item.id);
    setReservationSavingKey(`${key}:${reservation.id}:${status}`);
    try {
      const token = getStoredToken();
      await api.put(`/flota/rezerwacje/${reservation.id}/status`, { status }, { headers: authHeaders(token) });
      showMsg(successMessage(`Status rezerwacji: ${status}.`));
      await Promise.all([loadAssetReservations('sprzet', item.id), loadAssetHistory('sprzet', item.id), loadAll()]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zmienic statusu rezerwacji.')));
    } finally {
      setReservationSavingKey('');
    }
  };

  const setProtocolDraft = (reservationId, field, value) => {
    setProtocolDrafts((prev) => ({
      ...prev,
      [reservationId]: {
        typ: 'kontrola',
        stan: 'OK',
        licznik_mtg: '',
        paliwo_osprzet: '',
        osoba: '',
        podpis: '',
        koszt_uszkodzen: '',
        notatka: '',
        ...(prev[reservationId] || {}),
        [field]: value,
      },
    }));
  };

  const setProtocolUploadFiles = (reservationId, files) => {
    setProtocolFiles((prev) => ({ ...prev, [reservationId]: Array.from(files || []) }));
  };

  const submitReservationProtocol = async (item, reservation) => {
    const draft = protocolDrafts[reservation.id] || {};
    setProtocolSavingId(String(reservation.id));
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('typ', draft.typ || (reservation.status === 'Wydane' ? 'zwrot' : 'wydanie'));
      form.append('stan', draft.stan || 'OK');
      form.append('licznik_mtg', draft.licznik_mtg || '');
      form.append('paliwo_osprzet', draft.paliwo_osprzet || '');
      form.append('osoba', draft.osoba || '');
      form.append('podpis', draft.podpis || '');
      form.append('koszt_uszkodzen', draft.koszt_uszkodzen || 0);
      form.append('notatka', draft.notatka || '');
      for (const file of protocolFiles[reservation.id] || []) {
        form.append('zdjecia', file);
      }
      await api.post(`/flota/rezerwacje/${reservation.id}/protokoly`, form, { headers: authHeaders(token) });
      showMsg(successMessage('Protokol sprzetu zapisany.'));
      setProtocolDrafts((prev) => ({ ...prev, [reservation.id]: { typ: 'kontrola', stan: 'OK', licznik_mtg: '', paliwo_osprzet: '', osoba: '', podpis: '', koszt_uszkodzen: '', notatka: '' } }));
      setProtocolFiles((prev) => ({ ...prev, [reservation.id]: [] }));
      await Promise.all([
        loadAssetReservations('sprzet', item.id),
        loadAssetPhotos('sprzet', item.id),
        loadAssetHistory('sprzet', item.id),
        loadAll(),
      ]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zapisac protokolu sprzetu.')));
    } finally {
      setProtocolSavingId('');
    }
  };

  const setAssetDocumentDraft = (type, id, field, value) => {
    const key = assetKey(type, id);
    setAssetDocumentDrafts((prev) => ({
      ...prev,
      [key]: {
        kategoria: 'Inne',
        wazny_do: '',
        ...(prev[key] || {}),
        [field]: value,
      },
    }));
  };

  const uploadAssetDocument = async (type, item, file) => {
    if (!file) return;
    const key = assetKey(type, item.id);
    const draft = assetDocumentDrafts[key] || {};
    setDocumentUploadingKey(key);
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('dokument', file);
      form.append('kategoria', draft.kategoria || 'Inne');
      form.append('opis', type === 'sprzet' ? 'Dokument sprzetu' : 'Dokument pojazdu');
      if (draft.wazny_do) form.append('wazny_do', draft.wazny_do);
      await api.post(`/flota/${type}/${item.id}/dokumenty`, form, { headers: authHeaders(token) });
      showMsg(successMessage('Dokument dodany do karty zasobu.'));
      setAssetDocumentDrafts((prev) => ({ ...prev, [key]: { kategoria: 'Inne', wazny_do: '' } }));
      await loadAssetDocuments(type, item.id);
      await loadAssetHistory(type, item.id);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie dodac dokumentu.')));
    } finally {
      setDocumentUploadingKey('');
    }
  };

  const deleteAssetDocument = async (type, item, docId) => {
    try {
      const token = getStoredToken();
      await api.delete(`/flota/${type}/${item.id}/dokumenty/${docId}`, { headers: authHeaders(token) });
      showMsg(successMessage('Dokument usuniety.'));
      await loadAssetDocuments(type, item.id);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie usunac dokumentu.')));
    }
  };

  const loadRepairInvoices = async (repairId) => {
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/flota/naprawy/${repairId}/faktury`, { headers: authHeaders(token), dedupe: false });
      setRepairInvoices((prev) => ({ ...prev, [repairId]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie pobrac faktur naprawy.')));
    }
  };

  const setInvoiceDraft = (repairId, field, value) => {
    setInvoiceDrafts((prev) => ({
      ...prev,
      [repairId]: { numer: '', kwota: '', opis: '', ...(prev[repairId] || {}), [field]: value },
    }));
  };

  const uploadRepairInvoice = async (repair, file) => {
    if (!file) return;
    const draft = invoiceDrafts[repair.id] || {};
    setInvoiceUploadingId(String(repair.id));
    try {
      const token = getStoredToken();
      const form = new FormData();
      form.append('faktura', file);
      form.append('numer', draft.numer || '');
      form.append('kwota', draft.kwota || repair.koszt || '');
      form.append('opis', draft.opis || 'Faktura naprawy');
      await api.post(`/flota/naprawy/${repair.id}/faktury`, form, { headers: authHeaders(token) });
      showMsg(successMessage('Faktura dodana do naprawy.'));
      setInvoiceDrafts((prev) => ({ ...prev, [repair.id]: { numer: '', kwota: '', opis: '' } }));
      await Promise.all([loadRepairInvoices(repair.id), loadAll()]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie dodac faktury.')));
    } finally {
      setInvoiceUploadingId('');
    }
  };

  const deleteRepairInvoice = async (repair, invoiceId) => {
    try {
      const token = getStoredToken();
      await api.delete(`/flota/naprawy/${repair.id}/faktury/${invoiceId}`, { headers: authHeaders(token) });
      showMsg(successMessage('Faktura usunieta z naprawy.'));
      await Promise.all([loadRepairInvoices(repair.id), loadAll()]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie usunac faktury.')));
    }
  };

  const loadRepairParts = async (repairId) => {
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/flota/naprawy/${repairId}/czesci`, { headers: authHeaders(token), dedupe: false });
      setRepairParts((prev) => ({ ...prev, [repairId]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie pobrac czesci naprawy.')));
    }
  };

  const setPartDraft = (repairId, field, value) => {
    setPartDrafts((prev) => ({
      ...prev,
      [repairId]: {
        nazwa: '',
        ilosc: '1',
        cena: '',
        kategoria: 'Czesc',
        ...(prev[repairId] || {}),
        [field]: value,
      },
    }));
  };

  const addRepairPart = async (repair) => {
    const draft = partDrafts[repair.id] || {};
    if (!String(draft.nazwa || '').trim()) return;
    setPartSavingId(String(repair.id));
    try {
      const token = getStoredToken();
      await api.post(`/flota/naprawy/${repair.id}/czesci`, {
        nazwa: draft.nazwa,
        ilosc: draft.ilosc || 1,
        cena: draft.cena || 0,
        kategoria: draft.kategoria || 'Czesc',
      }, { headers: authHeaders(token) });
      showMsg(successMessage('Czesc dodana do naprawy.'));
      setPartDrafts((prev) => ({ ...prev, [repair.id]: { nazwa: '', ilosc: '1', cena: '', kategoria: 'Czesc' } }));
      await Promise.all([loadRepairParts(repair.id), loadAll()]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie dodac czesci.')));
    } finally {
      setPartSavingId('');
    }
  };

  const deleteRepairPart = async (repair, partId) => {
    try {
      const token = getStoredToken();
      await api.delete(`/flota/naprawy/${repair.id}/czesci/${partId}`, { headers: authHeaders(token) });
      showMsg(successMessage('Czesc usunieta z naprawy.'));
      await Promise.all([loadRepairParts(repair.id), loadAll()]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie usunac czesci.')));
    }
  };

  const openEmptyRepairDraft = () => {
    const defaultItem = filtrSprzet[0] || filtrPojazdy[0] || null;
    const kind = defaultItem && filtrSprzet[0] ? 'sprzet' : 'pojazd';
    setRepairDraft({
      kind,
      item: defaultItem,
      typ_zasobu: kind === 'pojazd' ? 'Pojazd' : 'Sprzet',
      zasob_id: defaultItem?.id || '',
      label: defaultItem
        ? (kind === 'pojazd'
          ? [defaultItem.marka, defaultItem.model, defaultItem.nr_rejestracyjny].filter(Boolean).join(' ')
          : [defaultItem.nazwa, defaultItem.typ].filter(Boolean).join(' / '))
        : 'Wybierz zasob',
      data_naprawy: todayYmd(),
      opis_usterki: '',
      opis_naprawy: '',
      wykonawca: '',
      koszt: '',
      termin_odbioru: '',
      data_zakonczenia: '',
      strata_dzienna: '',
      priorytet: 'Normalny',
      status: 'W toku',
      oddzial_id: defaultItem?.oddzial_id || currentUser?.oddzial_id || '',
    });
  };

  const openRepairDraft = (kind, item) => {
    setRepairDraft({
      kind,
      item,
      typ_zasobu: kind === 'pojazd' ? 'Pojazd' : 'Sprzet',
      zasob_id: item.id,
      label: kind === 'pojazd'
        ? [item.marka, item.model, item.nr_rejestracyjny].filter(Boolean).join(' ')
        : [item.nazwa, item.typ].filter(Boolean).join(' / '),
      data_naprawy: todayYmd(),
      opis_usterki: '',
      opis_naprawy: '',
      wykonawca: '',
      koszt: '',
      termin_odbioru: '',
      data_zakonczenia: '',
      strata_dzienna: '',
      priorytet: 'Normalny',
      status: 'W toku',
      oddzial_id: item.oddzial_id || currentUser?.oddzial_id || '',
    });
  };

  const openEditRepairDraft = (repair) => {
    const kind = normalizeRepairKind(repair?.typ_zasobu) || 'sprzet';
    const options = kind === 'pojazd' ? pojazdy : sprzet;
    const item = options.find((asset) => String(asset.id) === String(repair.zasob_id)) || null;
    setRepairDraft({
      id: repair.id,
      kind,
      item,
      typ_zasobu: kind === 'pojazd' ? 'Pojazd' : 'Sprzet',
      zasob_id: repair.zasob_id || '',
      label: getRepairAssetLabel(repair),
      data_naprawy: formDate(repair.data_naprawy) || todayYmd(),
      opis_usterki: repair.opis_usterki || '',
      opis_naprawy: repair.opis_naprawy || '',
      wykonawca: repair.wykonawca || '',
      koszt: repair.koszt ?? '',
      termin_odbioru: formDate(repair.termin_odbioru),
      data_zakonczenia: formDate(repair.data_zakonczenia),
      strata_dzienna: repair.strata_dzienna ?? '',
      priorytet: repair.priorytet || 'Normalny',
      status: repair.status || 'W toku',
      oddzial_id: repair.oddzial_id || item?.oddzial_id || currentUser?.oddzial_id || '',
    });
  };

  const submitRepairDraft = async (event) => {
    event.preventDefault();
    if (!repairDraft || !repairDraft.zasob_id || !repairDraft.opis_usterki.trim()) return;
    setRepairSaving(true);
    try {
      const token = getStoredToken();
      const payload = {
        typ_zasobu: repairDraft.typ_zasobu,
        zasob_id: repairDraft.zasob_id,
        data_naprawy: repairDraft.data_naprawy,
        opis_usterki: repairDraft.opis_usterki.trim(),
        opis_naprawy: repairDraft.opis_naprawy.trim() || null,
        wykonawca: repairDraft.wykonawca.trim() || null,
        koszt: repairDraft.koszt || null,
        termin_odbioru: repairDraft.termin_odbioru || null,
        data_zakonczenia: repairDraft.data_zakonczenia || null,
        strata_dzienna: repairDraft.strata_dzienna || null,
        priorytet: repairDraft.priorytet || 'Normalny',
        status: repairDraft.status,
        oddzial_id: repairDraft.oddzial_id || currentUser?.oddzial_id,
      };
      if (repairDraft.id) {
        await api.put(`/flota/naprawy/${repairDraft.id}`, payload, { headers: authHeaders(token) });
      } else {
        await api.post('/flota/naprawy', payload, { headers: authHeaders(token) });
      }
      showMsg(successMessage(repairDraft.id ? 'Naprawa zaktualizowana.' : 'Naprawa zapisana.'));
      setRepairDraft(null);
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zapisac naprawy.')));
    } finally {
      setRepairSaving(false);
    }
  };

  const closeRepair = async (repair, options = {}) => {
    if (!repair || repairSaving) return;
    setRepairSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/flota/naprawy/${repair.id}`, {
        ...repair,
        status: 'Zakonczona',
        data_zakonczenia: repair.data_zakonczenia || todayYmd(),
        opis_naprawy: repair.opis_naprawy || 'Zakonczono naprawe',
      }, { headers: authHeaders(token) });
      showMsg(successMessage('Naprawa zakonczona. Zasob jest dostepny.'));
      await loadAll();
      if (options.returnTo) {
        navigate(options.returnTo);
      }
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zakonczyc naprawy.')));
    } finally {
      setRepairSaving(false);
    }
  };

  const deleteRepair = async (repair) => {
    if (!repair) return;
    const ok = typeof window !== 'undefined' && window.confirm
      ? window.confirm('Usunac naprawe razem z fakturami?')
      : true;
    if (!ok) return;
    setRepairSaving(true);
    try {
      const token = getStoredToken();
      await api.delete(`/flota/naprawy/${repair.id}`, { headers: authHeaders(token) });
      showMsg(successMessage('Naprawa usunieta.'));
      await loadAll();
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie usunac naprawy.')));
    } finally {
      setRepairSaving(false);
    }
  };

  const openAssetDetail = (type, item) => {
    const params = new URLSearchParams(location.search || '');
    params.set('asset', `${type}:${item.id}`);
    if (type === 'sprzet') params.set('tab', 'sprzet');
    if (type === 'pojazdy') params.set('tab', 'pojazdy');
    navigate(`/flota?${params.toString()}`);
    void loadAssetPhotos(type, item.id);
    void loadAssetDocuments(type, item.id);
    void loadAssetHistory(type, item.id);
  };

  const closeAssetDetail = () => {
    const params = new URLSearchParams(location.search || '');
    params.delete('asset');
    navigate(`/flota?${params.toString()}`);
  };

  const openRepairsForAsset = (kind, item) => {
    const params = new URLSearchParams({
      tab: 'naprawy',
      kind,
      resource: String(item.id),
    });
    if (filtrOddzial) params.set('oddzial', filtrOddzial);
    setRepairQuickFilter('all');
    setActiveTab('naprawy');
    navigate(`/flota?${params.toString()}`);
  };

  const exportRepairsCsv = (rows = naprawy) => {
    const sourceRows = Array.isArray(rows) && rows.length ? rows : naprawy;
    const header = ['id', 'typ_zasobu', 'zasob', 'data_naprawy', 'data_zakonczenia', 'przestoj_dni', 'strata_dzienna', 'strata_przestoju', 'termin_odbioru', 'termin_status', 'priorytet', 'status', 'koszt', 'faktury_kwota', 'faktury_count', 'czesci_kwota', 'czesci_count', 'usterka', 'wykonawca'];
    const csv = [
      header.join(';'),
      ...sourceRows.map((repair) => {
        const due = repairDueState(repair);
        return [
          repair.id,
          repair.typ_zasobu,
          getRepairAssetLabel(repair),
          fmt(repair.data_naprawy),
          fmt(repair.data_zakonczenia),
          repairDowntimeDays(repair),
          Number(repair.strata_dzienna || 0) || '',
          repairDowntimeLoss(repair) || '',
          fmt(repair.termin_odbioru),
          due.state === 'overdue' ? `${Math.abs(due.days)} dni po terminie` : due.state === 'soon' ? `${due.days} dni do terminu` : due.state,
          repair.priorytet || 'Normalny',
          repair.status || '',
          Number(repair.koszt || 0) || '',
          Number(repair.faktury_kwota || 0) || '',
          Number(repair.faktury_count || 0) || 0,
          Number(repair.czesci_kwota || 0) || '',
          Number(repair.czesci_count || 0) || 0,
          repair.opis_usterki || '',
          repair.wykonawca || '',
        ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';');
      }),
    ].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `flota-naprawy-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const fmt = fmtDate;
  const isExpired = (d) => dateHealth(d).state === 'expired';

  const STATUS_KOLOR = {
    Dostepny: '#7f8c12',
    'W uzyciu': '#bd701e',
    Niedostepny: '#5a5040',
    'Dostępny':    '#7f8c12',
    'W użyciu':    '#bd701e',
    'W naprawie':  '#c0492f',
    'Niedostępny': '#5a5040',
  };

  const fleetStatusLabel = (status) => t(`fleetStatus.${status}`, { defaultValue: status });
  const localeNum = i18n.language === 'uk' ? 'uk-UA' : i18n.language === 'ru' ? 'ru-RU' : 'pl-PL';
  const repairHeaders = useMemo(() => {
    const h = t('pages.flota.repairHeaders', { returnObjects: true });
    return Array.isArray(h) ? h : [];
  }, [t]);

  const filtrPojazdy = pojazdy.filter(p => !filtrOddzial || p.oddzial_id?.toString() === filtrOddzial);
  const filtrSprzet = sprzet.filter(s => !filtrOddzial || s.oddzial_id?.toString() === filtrOddzial);

  useEffect(() => {
    const visible = [
      ...filtrPojazdy.map((item) => ['pojazdy', item.id]),
      ...filtrSprzet.map((item) => ['sprzet', item.id]),
    ].slice(0, 30);
    visible.forEach(([type, id]) => {
      const key = assetKey(type, id);
      if (!Array.isArray(assetDocuments[key])) {
        void loadAssetDocuments(type, id);
      }
    });
  }, [filtrPojazdy, filtrSprzet, assetDocuments]);

  const resourceCards = useMemo(() => {
    const now = new Date();
    const vehicleCards = filtrPojazdy.map((p) => {
      const docs = assetDocuments[assetKey('pojazdy', p.id)] || [];
      const alerts = [
        dueAlert({ key: 'inspection', label: 'Przeglad' }, p.data_przegladu, now),
        dueAlert({ key: 'insurance', label: 'OC' }, p.data_ubezpieczenia, now),
        ...(docs.length === 0 ? [{ key: 'docs-missing', state: 'missing', label: 'Brak dokumentow', detail: 'dodaj OC / fakture / gwarancje', color: '#5a5040' }] : []),
        ...docs.map((doc) => documentDueAlert(doc, now)).filter(Boolean),
      ];
      return {
        id: `vehicle-${p.id}`,
        itemId: p.id,
        assetType: 'pojazdy',
        asset: p,
        kind: 'vehicle',
        type: 'Pojazd',
        title: [p.marka, p.model].filter(Boolean).join(' ') || `Pojazd #${p.id}`,
        subtitle: p.nr_rejestracyjny || p.typ || '-',
        branch: p.oddzial_nazwa || '-',
        team: p.ekipa_nazwa || 'bez ekipy',
        status: p.status || 'Dostepny',
        alerts,
        meta: p.przebieg ? `${parseInt(p.przebieg, 10).toLocaleString(localeNum)} km` : p.typ,
      };
    });
    const equipmentCards = filtrSprzet.map((s) => {
      const docs = assetDocuments[assetKey('sprzet', s.id)] || [];
      const alerts = [
        dueAlert({ key: 'inspection', label: 'Przeglad' }, s.data_przegladu, now),
        ...(docs.length === 0 ? [{ key: 'docs-missing', state: 'missing', label: 'Brak dokumentow', detail: 'dodaj UDT / gwarancje / instrukcje', color: '#5a5040' }] : []),
        ...docs.map((doc) => documentDueAlert(doc, now)).filter(Boolean),
      ];
      if (s.next_reservation_from) {
        alerts.push({
          key: 'reservation',
          state: 'soon',
          label: `Rezerwacja ${fmtDate(s.next_reservation_from)}`,
          detail: [s.next_reservation_team, s.next_task_id ? `#${s.next_task_id}` : null, s.next_task_client].filter(Boolean).join(' / ') || fmtDate(s.next_reservation_to),
          color: '#f1f3d6',
        });
      }
      return {
        id: `equipment-${s.id}`,
        itemId: s.id,
        assetType: 'sprzet',
        asset: s,
        kind: 'equipment',
        type: 'Sprzet',
        title: s.nazwa || `Sprzet #${s.id}`,
        subtitle: [s.typ, s.nr_seryjny].filter(Boolean).join(' / ') || '-',
        branch: s.oddzial_nazwa || '-',
        team: s.ekipa_nazwa || 'bez ekipy',
        status: s.status || 'Dostepny',
        alerts,
        meta: s.next_task_id ? `Zlecenie #${s.next_task_id}` : (s.koszt_motogodziny ? `Motogodzina ${s.koszt_motogodziny} PLN` : 'stawka nieustawiona'),
      };
    });

    return [...vehicleCards, ...equipmentCards].sort((a, b) => {
      const aWeight = Math.min(...a.alerts.map((alert) => priorityWeight(alert.state)));
      const bWeight = Math.min(...b.alerts.map((alert) => priorityWeight(alert.state)));
      return aWeight - bWeight || a.title.localeCompare(b.title, 'pl');
    });
  }, [assetDocuments, filtrPojazdy, filtrSprzet, localeNum]);

  const resourceRiskCards = useMemo(
    () => resourceCards.filter((card) => card.alerts.some((alert) => alert.state !== 'ok')).slice(0, 8),
    [resourceCards],
  );
  const resourceAlertCount = useMemo(
    () => resourceCards.reduce((sum, card) => sum + card.alerts.filter((alert) => ['expired', 'soon'].includes(alert.state)).length, 0),
    [resourceCards],
  );
  const overdueResourceCount = useMemo(
    () => resourceCards.filter((card) => card.alerts.some((alert) => alert.state === 'expired')).length,
    [resourceCards],
  );
  const repairCostTotal = useMemo(
    () => naprawy.reduce((sum, repair) => sum + (Number(repair.faktury_kwota ?? repair.koszt ?? 0) || 0) + (Number(repair.czesci_kwota || 0) || 0), 0),
    [naprawy],
  );
  const fleetCommand = useMemo(() => {
    const allResources = [...filtrPojazdy, ...filtrSprzet];
    const total = allResources.length;
    const available = allResources.filter((item) => ['Dostepny', 'Dostępny'].includes(item.status)).length;
    const inUse = allResources.filter((item) => ['W uzyciu', 'W użyciu'].includes(item.status)).length;
    const inRepair = allResources.filter((item) => String(item.status || '').toLowerCase().includes('napraw')).length;
    const openRepairs = naprawy.filter((repair) => !repairIsClosed(repair.status)).length;
    const readiness = total ? Math.max(0, Math.round(((available + inUse * 0.7) / total) * 100) - overdueResourceCount * 8 - openRepairs * 4) : 0;
    const nextRisk = resourceRiskCards[0];
    const nextAction = openRepairs
      ? 'Domknij naprawy'
      : overdueResourceCount
        ? 'Sprawdz terminy'
        : resourceAlertCount
          ? 'Kontrola przed planem'
          : 'Zasoby gotowe';
    return {
      total,
      available,
      inUse,
      inRepair,
      openRepairs,
      repairCostTotal,
      readiness,
      nextRisk,
      nextAction,
    };
  }, [filtrPojazdy, filtrSprzet, naprawy, overdueResourceCount, repairCostTotal, resourceAlertCount, resourceRiskCards]);

  const selectedAssetDetail = useMemo(() => {
    const raw = new URLSearchParams(location.search || '').get('asset') || '';
    const [type, id] = raw.split(':');
    if (!['pojazdy', 'sprzet'].includes(type) || !id) return null;
    const item = (type === 'pojazdy' ? pojazdy : sprzet).find((row) => String(row.id) === String(id));
    if (!item) return null;
    const key = assetKey(type, item.id);
    const kind = type === 'pojazdy' ? 'pojazd' : 'sprzet';
    const repairs = naprawy
      .filter((repair) => normalizeRepairKind(repair.typ_zasobu) === kind && String(repair.zasob_id) === String(item.id))
      .sort((a, b) => String(b.data_naprawy || '').localeCompare(String(a.data_naprawy || '')));
    const repairCost = repairs.reduce((sum, repair) => sum + (Number(repair.faktury_kwota ?? repair.koszt ?? 0) || 0) + (Number(repair.czesci_kwota || 0) || 0), 0);
    const downtimeLoss = repairs.reduce((sum, repair) => sum + repairDowntimeLoss(repair), 0);
    const documents = assetDocuments[key] || [];
    const reservations = type === 'sprzet' ? (assetReservations[key] || []) : [];
    const activeReservations = reservations.filter(reservationIsActive);
    const nextReservation = activeReservations
      .filter((row) => String(row.data_do || '') >= todayYmd())
      .sort((a, b) => String(a.data_od || '').localeCompare(String(b.data_od || '')))[0] || null;
    const reservationConflict = activeReservations.some((row, index) => activeReservations.some((other, otherIndex) => (
      otherIndex > index && String(other.sprzet_id) === String(row.sprzet_id) && reservationOverlaps(row, other)
    )));
    const documentAlerts = documents.map((doc) => documentDueAlert(doc)).filter(Boolean);
    const missingDocAlert = documents.length === 0
      ? [{ key: 'docs-missing', state: 'missing', label: 'Brak dokumentow', detail: type === 'pojazdy' ? 'dodaj OC / fakture / gwarancje' : 'dodaj UDT / gwarancje / instrukcje', color: '#5a5040' }]
      : [];
    const reservationAlerts = type === 'sprzet'
      ? [
        ...(nextReservation ? [{ key: 'reservation-next', state: 'soon', label: `Wydanie ${fmtDate(nextReservation.data_od)}`, detail: nextReservation.ekipa_nazwa || 'ekipa', color: '#f1f3d6' }] : []),
        ...(reservationConflict ? [{ key: 'reservation-conflict', state: 'expired', label: 'Konflikt rezerwacji', detail: 'sprawdz terminy wydania', color: '#c0492f' }] : []),
      ]
      : [];
    const alerts = type === 'pojazdy'
      ? [
        dueAlert({ key: 'inspection', label: 'Przeglad' }, item.data_przegladu),
        dueAlert({ key: 'insurance', label: 'OC' }, item.data_ubezpieczenia),
        ...missingDocAlert,
        ...documentAlerts,
      ]
      : [dueAlert({ key: 'inspection', label: 'Przeglad' }, item.data_przegladu), ...reservationAlerts, ...missingDocAlert, ...documentAlerts];
    return {
      type,
      kind,
      item,
      key,
      label: type === 'pojazdy'
        ? [item.marka, item.model, item.nr_rejestracyjny].filter(Boolean).join(' ')
        : [item.nazwa, item.typ, item.nr_seryjny].filter(Boolean).join(' / '),
      subtitle: [item.oddzial_nazwa, item.ekipa_nazwa || 'bez ekipy', item.status].filter(Boolean).join(' / '),
      photos: assetPhotos[key] || [],
      documents,
      history: assetHistory[key] || [],
      reservations,
      activeReservations,
      nextReservation,
      repairs,
      repairCost,
      downtimeLoss,
      openRepairs: repairs.filter((repair) => !repairIsClosed(repair.status)).length,
      alerts,
    };
  }, [assetDocuments, assetHistory, assetPhotos, assetReservations, location.search, naprawy, pojazdy, sprzet]);

  useEffect(() => {
    if (!selectedAssetDetail) return;
    if (!Array.isArray(assetPhotos[selectedAssetDetail.key])) {
      void loadAssetPhotos(selectedAssetDetail.type, selectedAssetDetail.item.id);
    }
    if (!Array.isArray(assetDocuments[selectedAssetDetail.key])) {
      void loadAssetDocuments(selectedAssetDetail.type, selectedAssetDetail.item.id);
    }
    if (!Array.isArray(assetHistory[selectedAssetDetail.key])) {
      void loadAssetHistory(selectedAssetDetail.type, selectedAssetDetail.item.id);
    }
    if (selectedAssetDetail.type === 'sprzet' && !Array.isArray(assetReservations[selectedAssetDetail.key])) {
      void loadAssetReservations(selectedAssetDetail.type, selectedAssetDetail.item.id);
    }
  }, [assetDocuments, assetHistory, assetPhotos, assetReservations, selectedAssetDetail]);

  const openResourceCalendar = (card) => {
    const params = new URLSearchParams({ tab: 'equipment', modal: '0' });
    if (card.kind === 'equipment') params.set('equipment', String(card.itemId));
    if (filtrOddzial) params.set('branch', filtrOddzial);
    navigate(`/kalendarz-zasobow?${params.toString()}`);
  };

  const kpiItems = useMemo(() => ([
    { key: 'veh',   label: t('pages.flota.kpiVehicles'),  value: filtrPojazdy.length, color: '#f1f3d6' },
    { key: 'eq',    label: t('pages.flota.kpiEquipment'), value: filtrSprzet.length,  color: '#f1f3d6' },
    { key: 'alerts', label: 'Alerty zasobow', value: resourceAlertCount, color: resourceAlertCount ? '#c0492f' : '#7f8c12' },
    { key: 'overdue', label: 'Po terminie', value: overdueResourceCount, color: overdueResourceCount ? '#c0492f' : '#7f8c12' },
    { key: 'avail', label: t('pages.flota.kpiAvailable'), value: [...filtrPojazdy, ...filtrSprzet].filter(x => ['Dostepny', 'Dostępny'].includes(x.status)).length, color: '#7f8c12' },
    { key: 'rep',   label: t('pages.flota.kpiInRepair'),  value: naprawy.length,       color: '#c0492f' },
  ]), [t, filtrPojazdy, filtrSprzet, naprawy.length, resourceAlertCount, overdueResourceCount]);

  const tabDefs = useMemo(() => ([
    { key: 'pojazdy', label: t('pages.flota.tabVehicles', { count: filtrPojazdy.length }) },
    { key: 'sprzet', label: t('pages.flota.tabEquipment', { count: filtrSprzet.length }) },
    { key: 'naprawy', label: t('pages.flota.tabRepairs', { count: naprawy.length }) },
  ]), [t, filtrPojazdy.length, filtrSprzet.length, naprawy.length]);

  const repairFocus = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return {
      teamId: params.get('team') || '',
      kind: normalizeRepairKind(params.get('kind')),
      resourceId: params.get('resource') || '',
      returnTo: params.get('returnTo') || '',
      returnLabel: params.get('returnLabel') || '',
    };
  }, [location.search]);
  const repairFocusActive = Boolean(repairFocus.teamId || repairFocus.kind || repairFocus.resourceId);
  const repairAssetMetaByKey = useMemo(() => {
    const rows = new Map();
    for (const item of pojazdy) {
      rows.set(`pojazd:${item.id}`, {
        kind: 'pojazd',
        id: item.id,
        teamId: item.ekipa_id,
        label: [item.marka, item.model, item.nr_rejestracyjny].filter(Boolean).join(' ') || `Pojazd #${item.id}`,
      });
    }
    for (const item of sprzet) {
      rows.set(`sprzet:${item.id}`, {
        kind: 'sprzet',
        id: item.id,
        teamId: item.ekipa_id,
        label: [item.nazwa, item.typ].filter(Boolean).join(' / ') || `Sprzet #${item.id}`,
      });
    }
    return rows;
  }, [pojazdy, sprzet]);
  const filteredNaprawy = useMemo(() => {
    const focusedRows = repairFocusActive ? naprawy.filter((repair) => {
      const kind = normalizeRepairKind(repair.typ_zasobu);
      const asset = repairAssetMetaByKey.get(`${kind}:${repair.zasob_id}`);
      if (repairFocus.kind && kind !== repairFocus.kind) return false;
      if (repairFocus.resourceId && String(repair.zasob_id || '') !== String(repairFocus.resourceId)) return false;
      if (repairFocus.teamId && String(asset?.teamId || '') !== String(repairFocus.teamId)) return false;
      return true;
    }) : naprawy;
    if (repairQuickFilter === 'open') return focusedRows.filter((repair) => !repairIsClosed(repair.status));
    if (repairQuickFilter === 'closed') return focusedRows.filter((repair) => repairIsClosed(repair.status));
    if (repairQuickFilter === 'noInvoice') return focusedRows.filter((repair) => Number(repair.koszt || 0) > 0 && Number(repair.faktury_count || 0) === 0);
    if (repairQuickFilter === 'overdue') return focusedRows.filter((repair) => repairDueState(repair).state === 'overdue');
    return focusedRows;
  }, [naprawy, repairAssetMetaByKey, repairFocus.kind, repairFocus.resourceId, repairFocus.teamId, repairFocusActive, repairQuickFilter]);
  const repairFocusLabel = useMemo(() => {
    const parts = [];
    if (repairFocus.teamId) {
      const team = ekipy.find((item) => String(item.id) === String(repairFocus.teamId));
      parts.push(team?.nazwa || `Ekipa #${repairFocus.teamId}`);
    }
    if (repairFocus.kind && repairFocus.resourceId) {
      const asset = repairAssetMetaByKey.get(`${repairFocus.kind}:${repairFocus.resourceId}`);
      parts.push(asset?.label || `Zasob #${repairFocus.resourceId}`);
    }
    return parts.join(' / ');
  }, [ekipy, repairAssetMetaByKey, repairFocus.kind, repairFocus.resourceId, repairFocus.teamId]);
  const getRepairAssetLabel = useCallback((repair) => {
    const kind = normalizeRepairKind(repair?.typ_zasobu);
    const asset = repairAssetMetaByKey.get(`${kind}:${repair?.zasob_id}`);
    return asset?.label ? `${asset.label} (#${repair.zasob_id})` : `ID: ${repair?.zasob_id || '-'}`;
  }, [repairAssetMetaByKey]);
  const assetRepairSummary = useMemo(() => {
    const rows = new Map();
    for (const repair of naprawy) {
      const kind = normalizeRepairKind(repair.typ_zasobu);
      if (!kind || !repair.zasob_id) continue;
      const key = assetKey(kind === 'pojazd' ? 'pojazdy' : 'sprzet', repair.zasob_id);
      const current = rows.get(key) || { count: 0, open: 0, cost: 0, lastDate: null };
      current.count += 1;
      if (!repairIsClosed(repair.status)) current.open += 1;
      current.cost += (Number(repair.faktury_kwota ?? repair.koszt ?? 0) || 0) + (Number(repair.czesci_kwota || 0) || 0);
      if (!current.lastDate || String(repair.data_naprawy || '') > String(current.lastDate || '')) {
        current.lastDate = repair.data_naprawy || null;
      }
      rows.set(key, current);
    }
    return rows;
  }, [naprawy]);
  const maintenanceSummary = useMemo(() => {
    const openRows = naprawy.filter((repair) => !repairIsClosed(repair.status));
    const overdueRows = openRows.filter((repair) => repairDueState(repair).state === 'overdue');
    const soonRows = openRows.filter((repair) => repairDueState(repair).state === 'soon');
    const downtimeDays = naprawy.reduce((sum, repair) => sum + repairDowntimeDays(repair), 0);
    const downtimeLoss = naprawy.reduce((sum, repair) => sum + repairDowntimeLoss(repair), 0);
    const invoiceCost = naprawy.reduce((sum, repair) => sum + (Number(repair.faktury_kwota || 0) || 0), 0);
    const partsCost = naprawy.reduce((sum, repair) => sum + (Number(repair.czesci_kwota || 0) || 0), 0);
    const openCost = openRows.reduce((sum, repair) => sum + (Number(repair.faktury_kwota ?? repair.koszt ?? 0) || 0) + (Number(repair.czesci_kwota || 0) || 0), 0);
    const withoutInvoice = naprawy.filter((repair) => Number(repair.faktury_count || 0) === 0 && Number(repair.koszt || 0) > 0);
    const topRepairs = [...naprawy]
      .map((repair) => ({ ...repair, costValue: (Number(repair.faktury_kwota ?? repair.koszt ?? 0) || 0) + (Number(repair.czesci_kwota || 0) || 0) }))
      .filter((repair) => repair.costValue > 0)
      .sort((a, b) => b.costValue - a.costValue)
      .slice(0, 4)
      .map((repair) => ({ ...repair, assetLabel: getRepairAssetLabel(repair) }));
    return {
      allCount: naprawy.length,
      totalCost: repairCostTotal,
      invoiceCost,
      partsCost,
      openCost,
      openCount: openRows.length,
      overdueCount: overdueRows.length,
      soonCount: soonRows.length,
      downtimeDays,
      downtimeLoss,
      closedCount: naprawy.filter((repair) => repairIsClosed(repair.status)).length,
      withoutInvoiceCount: withoutInvoice.length,
      topRepairs,
    };
  }, [getRepairAssetLabel, naprawy, repairCostTotal]);
  const isPojazdFormValid = Boolean(
    formPojazd.marka.trim() &&
    formPojazd.model.trim() &&
    formPojazd.nr_rejestracyjny.trim()
  );
  const isSprzetFormValid = Boolean(formSprzet.nazwa.trim());

  return (
    <div className="app-shell fleet-shell" style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
      <CommandSidebar active="fleet" user={currentUser} />
      <main className="app-main command-content-main fleet-main" style={{ flex: 1, padding: 28, overflowX: 'hidden' }}>

        <PageHeader
          variant="hero"
          title={t('pages.flota.title')}
          subtitle={t('pages.flota.summary', { vehicles: filtrPojazdy.length, equipment: filtrSprzet.length })}
          icon={<LocalShippingOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} />
              {isDyrektor && (
                <select
                  style={{ padding: '8px 12px', borderRadius: 10, border: 'none', fontSize: 13 }}
                  value={filtrOddzial}
                  onChange={(e) => setFiltrOddzial(e.target.value)}
                >
                  <option value="">{t('pages.flota.allBranchesOption')}</option>
                  {oddzialy.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nazwa}
                    </option>
                  ))}
                </select>
              )}
              {canEdit && (
                <Button onClick={handleToggleForm} leftIcon={showForm ? X : Plus}>
                  {showForm ? t('common.cancel') : `+ ${t('pages.flota.add')}`}
                </Button>
              )}
            </>
          }
        />

        <section className="fleet-command-radar">
          <div className="fleet-command-lead">
            <span>Command Fleet</span>
            <strong>{fleetCommand.readiness}%</strong>
            <small>{fleetCommand.nextAction}</small>
          </div>
          {[
            { label: 'Zasoby', value: fleetCommand.total, detail: `${filtrPojazdy.length} aut / ${filtrSprzet.length} sprzetu`, tone: 'blue' },
            { label: 'Gotowe', value: fleetCommand.available, detail: 'dostepne do planu', tone: 'good' },
            { label: 'W pracy', value: fleetCommand.inUse, detail: 'aktywnie przypisane', tone: 'blue' },
            { label: 'Naprawy', value: fleetCommand.openRepairs || fleetCommand.inRepair, detail: 'otwarte blokady', tone: (fleetCommand.openRepairs || fleetCommand.inRepair) ? 'danger' : 'good' },
            { label: 'Koszt napraw', value: formatMoney(fleetCommand.repairCostTotal), detail: 'serwis + faktury', tone: fleetCommand.repairCostTotal ? 'danger' : 'good' },
            { label: 'Alerty', value: resourceAlertCount, detail: overdueResourceCount ? `${overdueResourceCount} po terminie` : 'przeglady i OC', tone: resourceAlertCount ? 'warning' : 'good' },
            { label: 'Najblizsze', value: fleetCommand.nextRisk?.title || '-', detail: fleetCommand.nextRisk?.alerts?.find((alert) => alert.state !== 'ok')?.label || 'brak ryzyk', tone: fleetCommand.nextRisk ? 'warning' : 'good' },
          ].map((card) => (
            <div key={card.label} className={`fleet-command-card is-${card.tone}`}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </div>
          ))}
          <div className="fleet-command-actions">
            <Button variant="secondary" size="sm" leftIcon={CalendarDays} onClick={() => navigate('/kalendarz-zasobow')}>
              Kalendarz
            </Button>
            <Button variant="secondary" size="sm" leftIcon={Wrench} onClick={() => setActiveTab('naprawy')}>
              Naprawy
            </Button>
            <Button size="sm" leftIcon={Plus} onClick={() => { setActiveTab('naprawy'); openEmptyRepairDraft(); }}>
              Nowa naprawa
            </Button>
          </div>
        </section>

        {/* KPI */}
        <div className="fleet-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 0, marginBottom: 24, border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)' }}>
          {kpiItems.map((k, i, arr) => (
            <div className="fleet-kpi-card" key={k.key} style={{
              background: 'var(--surface-field)', padding: '14px 16px',
              borderLeft: `3px solid ${k.color}`,
              borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0, fontWeight: 600 }}>{k.label}</div>
            </div>
          ))}
        </div>

        <ResourceCardsPanel
          cards={resourceRiskCards}
          total={resourceCards.length}
          alertCount={resourceAlertCount}
          onOpenDetail={openAssetDetail}
          onOpenCalendar={openResourceCalendar}
        />

        <MaintenanceControlPanel
          summary={maintenanceSummary}
          activeFilter={repairQuickFilter}
          onOpenRepairs={(filter = 'all') => { setRepairQuickFilter(filter); setActiveTab('naprawy'); }}
          onNewRepair={() => { setActiveTab('naprawy'); openEmptyRepairDraft(); }}
          onExport={() => exportRepairsCsv(filteredNaprawy)}
        />

        {selectedAssetDetail && (
          <AssetDetailPanel
            detail={selectedAssetDetail}
            canEdit={canEdit}
            ekipy={ekipy}
            reservationDraft={reservationDrafts[selectedAssetDetail.key] || {}}
            reservationSavingKey={reservationSavingKey}
            protocolDrafts={protocolDrafts}
            protocolFiles={protocolFiles}
            protocolSavingId={protocolSavingId}
            protocolOpenId={protocolOpenId}
            onClose={closeAssetDetail}
            onOpenRepairs={() => openRepairsForAsset(selectedAssetDetail.kind, selectedAssetDetail.item)}
            onNewRepair={() => openRepairDraft(selectedAssetDetail.kind, selectedAssetDetail.item)}
            onLoadPhotos={() => loadAssetPhotos(selectedAssetDetail.type, selectedAssetDetail.item.id)}
            onLoadDocuments={() => loadAssetDocuments(selectedAssetDetail.type, selectedAssetDetail.item.id)}
            onLoadHistory={() => loadAssetHistory(selectedAssetDetail.type, selectedAssetDetail.item.id)}
            onLoadReservations={() => loadAssetReservations(selectedAssetDetail.type, selectedAssetDetail.item.id)}
            onReservationDraftChange={(field, value) => setReservationDraft(selectedAssetDetail.type, selectedAssetDetail.item.id, field, value)}
            onCreateReservation={(status) => createAssetReservation(selectedAssetDetail.item, status)}
            onUpdateReservationStatus={(reservation, status) => updateReservationStatus(selectedAssetDetail.item, reservation, status)}
            onProtocolDraftChange={setProtocolDraft}
            onProtocolFilesChange={setProtocolUploadFiles}
            onSubmitProtocol={(reservation) => submitReservationProtocol(selectedAssetDetail.item, reservation)}
            onToggleProtocol={(reservationId) => setProtocolOpenId((prev) => (String(prev) === String(reservationId) ? '' : String(reservationId)))}
            onDeletePhoto={(photoId) => deleteAssetPhoto(selectedAssetDetail.type, selectedAssetDetail.item, photoId)}
            onDeleteDocument={(docId) => deleteAssetDocument(selectedAssetDetail.type, selectedAssetDetail.item, docId)}
          />
        )}

        {/* Tabs */}
        <div className="fleet-tabs" style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
          {tabDefs.map((tab) => (
            <Button key={tab.key}
              variant={activeTab === tab.key ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveTab(tab.key);
                setShowForm(false);
                resetPojazdForm();
                resetSprzetForm();
              }}
              style={{
                padding: '10px 18px', border: 'none', backgroundColor: 'transparent',
                cursor: 'pointer', fontSize: 14, fontWeight: '500',
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                borderBottomWidth: 2,
                borderBottomStyle: 'solid',
                borderBottomColor: activeTab === tab.key ? 'var(--accent)' : 'transparent',
                marginBottom: -2, transition: 'all 0.2s',
              }}>
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Formularz pojazdu */}
        {showForm && canEdit && activeTab === 'pojazdy' && (
          <div className="fleet-form-panel" style={S.formBox}>
            <h3 style={S.formTitle}>{editingPojazdId ? 'Edytuj pojazd' : t('pages.flota.newVehicleTitle')}</h3>
            <form onSubmit={handleAddPojazd}>
              <div style={S.quickRow}>
                <Button type="button" size="sm" variant="warning" leftIcon={Wrench} onClick={() => setFormPojazd((prev) => ({ ...prev, typ: 'Samochod', status: 'W naprawie' }))}>Samochod w naprawie</Button>
                <Button type="button" size="sm" variant="outline" leftIcon={CheckCircle} onClick={() => setFormPojazd((prev) => ({ ...prev, status: 'Dostepny' }))}>Dostepny</Button>
              </div>
              <div style={S.grid}>
                <Field label={t('pages.flota.fieldBrand')}><input style={S.input} value={formPojazd.marka} onChange={e => setFormPojazd({ ...formPojazd, marka: e.target.value })} required placeholder="np. Mercedes" /></Field>
                <Field label={t('pages.flota.fieldModel')}><input style={S.input} value={formPojazd.model} onChange={e => setFormPojazd({ ...formPojazd, model: e.target.value })} required placeholder="np. Sprinter" /></Field>
                <Field label={t('pages.flota.fieldReg')}><input style={S.input} value={formPojazd.nr_rejestracyjny} onChange={e => setFormPojazd({ ...formPojazd, nr_rejestracyjny: e.target.value })} required placeholder="np. KR12345" /></Field>
                <Field label={t('pages.flota.fieldYear')}><input style={S.input} type="number" value={formPojazd.rok_produkcji} onChange={e => setFormPojazd({ ...formPojazd, rok_produkcji: e.target.value })} placeholder="np. 2020" /></Field>
                <Field label={t('pages.flota.fieldType')}>
                  <select style={S.input} value={formPojazd.typ} onChange={e => setFormPojazd({ ...formPojazd, typ: e.target.value })}>
                    {VEHICLE_TYPE_OPTIONS.map((typOption) => <option key={typOption} value={typOption}>{typOption}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select style={S.input} value={formPojazd.status} onChange={e => setFormPojazd({ ...formPojazd, status: e.target.value })}>
                    {FLEET_STATUS_OPTIONS.map((statusOption) => <option key={statusOption} value={statusOption}>{fleetStatusLabel(statusOption)}</option>)}
                  </select>
                </Field>
                <Field label={t('pages.flota.fieldTeam')}>
                  <select style={S.input} value={formPojazd.ekipa_id} onChange={e => setFormPojazd({ ...formPojazd, ekipa_id: e.target.value })}>
                    <option value="">{t('common.noneShort')}</option>
                    {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                  </select>
                </Field>
                <Field label={t('pages.flota.fieldInspection')}><input style={S.input} type="date" value={formPojazd.data_przegladu} onChange={e => setFormPojazd({ ...formPojazd, data_przegladu: e.target.value })} /></Field>
                <Field label={t('pages.flota.fieldInsurance')}><input style={S.input} type="date" value={formPojazd.data_ubezpieczenia} onChange={e => setFormPojazd({ ...formPojazd, data_ubezpieczenia: e.target.value })} /></Field>
                <Field label={t('pages.flota.fieldMileage')}><input style={S.input} type="number" value={formPojazd.przebieg} onChange={e => setFormPojazd({ ...formPojazd, przebieg: e.target.value })} placeholder="np. 150000" /></Field>
                {isDyrektor && (
                  <Field label={t('pages.flota.fieldBranch')}>
                    <select style={S.input} value={formPojazd.oddzial_id} onChange={e => setFormPojazd({ ...formPojazd, oddzial_id: e.target.value })}>
                      <option value="">{t('common.choose')}</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <div style={S.btnRow}>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetPojazdForm(); }}>{t('common.cancel')}</Button>
                <Button type="submit" loading={saving} disabled={!isPojazdFormValid} leftIcon={Save}>{editingPojazdId ? 'Zapisz pojazd' : t('pages.flota.addVehicle')}</Button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz sprzętu */}
        {showForm && canEdit && activeTab === 'sprzet' && (
          <div className="fleet-form-panel" style={S.formBox}>
            <h3 style={S.formTitle}>{editingSprzetId ? 'Edytuj sprzet' : t('pages.flota.newEquipmentTitle')}</h3>
            <form onSubmit={handleAddSprzet}>
              <div style={S.quickRow}>
                <Button type="button" size="sm" variant="warning" leftIcon={Wrench} onClick={() => setFormSprzet((prev) => ({ ...prev, typ: 'Rebak', status: 'W naprawie' }))}>Rebak w naprawie</Button>
                <Button type="button" size="sm" variant="outline" leftIcon={CheckCircle} onClick={() => setFormSprzet((prev) => ({ ...prev, status: 'Dostepny' }))}>Dostepny</Button>
              </div>
              <div style={S.grid}>
                <Field label={t('pages.flota.fieldName')}><input aria-label={t('pages.flota.fieldName')} style={S.input} value={formSprzet.nazwa} onChange={e => setFormSprzet((prev) => ({ ...prev, nazwa: e.target.value }))} required placeholder="np. Piłarka Husqvarna 572XP" /></Field>
                <Field label={t('pages.flota.fieldType')}>
                  <select style={S.input} value={formSprzet.typ} onChange={e => setFormSprzet((prev) => ({ ...prev, typ: e.target.value }))}>
                    {EQUIPMENT_TYPE_OPTIONS.map((typOption) => <option key={typOption} value={typOption}>{typOption}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select style={S.input} value={formSprzet.status} onChange={e => setFormSprzet((prev) => ({ ...prev, status: e.target.value }))}>
                    {FLEET_STATUS_OPTIONS.map((statusOption) => <option key={statusOption} value={statusOption}>{fleetStatusLabel(statusOption)}</option>)}
                  </select>
                </Field>
                <Field label={t('pages.flota.fieldSerial')}><input style={S.input} value={formSprzet.nr_seryjny} onChange={e => setFormSprzet((prev) => ({ ...prev, nr_seryjny: e.target.value }))} /></Field>
                <Field label={t('pages.flota.fieldYear')}><input style={S.input} type="number" value={formSprzet.rok_produkcji} onChange={e => setFormSprzet((prev) => ({ ...prev, rok_produkcji: e.target.value }))} /></Field>
                <Field label={t('pages.flota.fieldInspection')}><input style={S.input} type="date" value={formSprzet.data_przegladu} onChange={e => setFormSprzet((prev) => ({ ...prev, data_przegladu: e.target.value }))} /></Field>
                <Field label={t('pages.flota.fieldMotohour')}><input style={S.input} type="number" step="0.5" value={formSprzet.koszt_motogodziny} onChange={e => setFormSprzet((prev) => ({ ...prev, koszt_motogodziny: e.target.value }))} placeholder="np. 25" /></Field>
                <Field label={t('pages.flota.fieldTeam')}>
                  <select aria-label={t('pages.flota.fieldTeam')} style={S.input} value={formSprzet.ekipa_id} onChange={e => setFormSprzet((prev) => ({ ...prev, ekipa_id: e.target.value }))}>
                    <option value="">{t('common.noneShort')}</option>
                    {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                  </select>
                </Field>
                {isDyrektor && (
                  <Field label={t('pages.flota.fieldBranch')}>
                    <select style={S.input} value={formSprzet.oddzial_id} onChange={e => setFormSprzet((prev) => ({ ...prev, oddzial_id: e.target.value }))}>
                      <option value="">{t('common.choose')}</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <div style={S.btnRow}>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetSprzetForm(); }}>{t('common.cancel')}</Button>
                <Button type="submit" loading={saving} disabled={!isSprzetFormValid} leftIcon={Save}>{editingSprzetId ? 'Zapisz sprzet' : t('pages.flota.addEquipment')}</Button>
              </div>
            </form>
          </div>
        )}

        {/* ===== POJAZDY ===== */}
        {activeTab === 'pojazdy' && (
          loading ? <LoadingBox text={t('pages.flota.loadingFleet')} /> : filtrPojazdy.length === 0 ? (
            <EmptyBox icon={<DirectionsCarOutlined sx={{ fontSize: 48, opacity: 0.55 }} />} text={t('pages.flota.emptyVehicles')} sub={canEdit ? t('pages.flota.emptyVehiclesHint') : ''} />
          ) : (
            <div className="fleet-list-panel" style={{ border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)' }}>
              {filtrPojazdy.map((p, i, arr) => (
                <div className="fleet-resource-row" key={p.id} style={{
                  background: 'var(--surface-field)', padding: '14px 20px',
                  borderLeft: `4px solid ${STATUS_KOLOR[p.status] || 'var(--border)'}`,
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <Button
                        variant="ghost"
                        aria-label={`Otworz karte zasobu ${p.marka || ''} ${p.model || ''} ${p.nr_rejestracyjny || ''}`.trim()}
                        onClick={() => openAssetDetail('pojazdy', p)}
                        style={S.assetTitleButton}
                      >
                        <DirectionsCarOutlined sx={{ fontSize: 22, flexShrink: 0 }} />
                        {p.marka} {p.model}
                      </Button>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{p.nr_rejestracyjny}</div>
                    </div>
                    <select
                      value={p.status || 'Dostepny'}
                      onChange={e => zmienStatus('pojazdy', p.id, e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: 8, border: `2px solid ${STATUS_KOLOR[p.status] || 'var(--text-muted)'}`, fontSize: 12, cursor: 'pointer', backgroundColor: 'var(--surface-field)', color: STATUS_KOLOR[p.status] || 'var(--text-muted)', fontWeight: '600' }}>
                      {FLEET_STATUS_OPTIONS.map((st) => <option key={st} value={st}>{fleetStatusLabel(st)}</option>)}
                    </select>
                    {canEdit && (
                      <div style={S.cardActions}>
                        <Button size="sm" variant="warning" leftIcon={Wrench} onClick={() => openRepairDraft('pojazd', p)}>Zglos naprawe</Button>
                        <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => startEditPojazd(p)}>Edytuj</Button>
                        <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => deleteFleetItem('pojazdy', p.id)}>Usun</Button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CalendarTodayOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                      {t('pages.flota.cardYear')}: {p.rok_produkcji || '-'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <PlaceOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.oddzial_nazwa || '-'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: isExpired(p.data_przegladu) ? 'var(--danger)' : 'var(--text-muted)' }}>
                      <HandymanOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                      {t('pages.flota.cardInspection')}: {fmt(p.data_przegladu)}
                      {isExpired(p.data_przegladu) && <WarningAmberOutlined sx={{ fontSize: 14, marginLeft: 2 }} />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: isExpired(p.data_ubezpieczenia) ? 'var(--danger)' : 'var(--text-muted)' }}>
                      <SecurityOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                      {t('pages.flota.cardInsurance')}: {fmt(p.data_ubezpieczenia)}
                      {isExpired(p.data_ubezpieczenia) && <WarningAmberOutlined sx={{ fontSize: 14, marginLeft: 2 }} />}
                    </div>
                    {p.przebieg && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ScheduleOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                        {parseInt(p.przebieg, 10).toLocaleString(localeNum)} km
                      </div>
                    )}
                  </div>
                  <FleetAssetControls
                    type="pojazdy"
                    item={p}
                    ekipy={ekipy}
                    photos={assetPhotos[assetKey('pojazdy', p.id)]}
                    documents={assetDocuments[assetKey('pojazdy', p.id)]}
                    documentDraft={assetDocumentDrafts[assetKey('pojazdy', p.id)]}
                    repairSummary={assetRepairSummary.get(assetKey('pojazdy', p.id))}
                    uploading={photoUploadingKey === assetKey('pojazdy', p.id)}
                    documentUploading={documentUploadingKey === assetKey('pojazdy', p.id)}
                    canEdit={canEdit}
                    onTeamChange={updateAssetTeam}
                    onRenewInspection={renewAssetInspection}
                    onLoadPhotos={loadAssetPhotos}
                    onUploadPhoto={uploadAssetPhoto}
                    onDeletePhoto={deleteAssetPhoto}
                    onLoadDocuments={loadAssetDocuments}
                    onUploadDocument={uploadAssetDocument}
                    onDocumentDraftChange={setAssetDocumentDraft}
                    onDeleteDocument={deleteAssetDocument}
                    onOpenDetail={openAssetDetail}
                    onOpenRepairs={openRepairsForAsset}
                  />
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ===== SPRZĘT ===== */}
        {activeTab === 'sprzet' && (
          loading ? <LoadingBox text={t('pages.flota.loadingFleet')} /> : filtrSprzet.length === 0 ? (
            <EmptyBox icon={<BuildOutlined sx={{ fontSize: 48, opacity: 0.55 }} />} text={t('pages.flota.emptyEquipment')} sub={canEdit ? t('pages.flota.emptyEquipmentHint') : ''} />
          ) : (
            <div className="fleet-list-panel" style={{ border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)' }}>
              {filtrSprzet.map((s, i, arr) => (
                <div className="fleet-resource-row" key={s.id} style={{
                  background: 'var(--surface-field)', padding: '14px 20px',
                  borderLeft: `4px solid ${STATUS_KOLOR[s.status] || 'var(--border)'}`,
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <Button
                        variant="ghost"
                        aria-label={`Otworz karte zasobu ${s.nazwa || ''} ${s.nr_inwentarzowy || ''}`.trim()}
                        onClick={() => openAssetDetail('sprzet', s)}
                        style={S.assetTitleButton}
                      >
                        <HandymanOutlined sx={{ fontSize: 20, flexShrink: 0 }} />
                        {s.nazwa}
                      </Button>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.typ}</div>
                    </div>
                    <select
                      value={s.status || 'Dostepny'}
                      onChange={e => zmienStatus('sprzet', s.id, e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: 8, border: `2px solid ${STATUS_KOLOR[s.status] || 'var(--text-muted)'}`, fontSize: 12, cursor: 'pointer', backgroundColor: 'var(--surface-field)', color: STATUS_KOLOR[s.status] || 'var(--text-muted)', fontWeight: '600' }}>
                      {FLEET_STATUS_OPTIONS.map((st) => <option key={st} value={st}>{fleetStatusLabel(st)}</option>)}
                    </select>
                    {canEdit && (
                      <div style={S.cardActions}>
                        <Button size="sm" variant="warning" leftIcon={Wrench} onClick={() => openRepairDraft('sprzet', s)}>Zglos naprawe</Button>
                        <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => startEditSprzet(s)}>Edytuj</Button>
                        <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => deleteFleetItem('sprzet', s.id)}>Usun</Button>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {s.nr_seryjny && <div>{s.nr_seryjny}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <PlaceOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.oddzial_nazwa || '-'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: isExpired(s.data_przegladu) ? 'var(--danger)' : 'var(--text-muted)' }}>
                      <HandymanOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                      {t('pages.flota.cardInspection')}: {fmt(s.data_przegladu)}
                      {isExpired(s.data_przegladu) && <WarningAmberOutlined sx={{ fontSize: 14, marginLeft: 2 }} />}
                    </div>
                    {s.koszt_motogodziny && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ScheduleOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                        {t('pages.flota.motohourRate', { value: s.koszt_motogodziny })}
                      </div>
                    )}
                  </div>
                  <FleetAssetControls
                    type="sprzet"
                    item={s}
                    ekipy={ekipy}
                    photos={assetPhotos[assetKey('sprzet', s.id)]}
                    documents={assetDocuments[assetKey('sprzet', s.id)]}
                    documentDraft={assetDocumentDrafts[assetKey('sprzet', s.id)]}
                    repairSummary={assetRepairSummary.get(assetKey('sprzet', s.id))}
                    uploading={photoUploadingKey === assetKey('sprzet', s.id)}
                    documentUploading={documentUploadingKey === assetKey('sprzet', s.id)}
                    canEdit={canEdit}
                    onTeamChange={updateAssetTeam}
                    onRenewInspection={renewAssetInspection}
                    onLoadPhotos={loadAssetPhotos}
                    onUploadPhoto={uploadAssetPhoto}
                    onDeletePhoto={deleteAssetPhoto}
                    onLoadDocuments={loadAssetDocuments}
                    onUploadDocument={uploadAssetDocument}
                    onDocumentDraftChange={setAssetDocumentDraft}
                    onDeleteDocument={deleteAssetDocument}
                    onOpenDetail={openAssetDetail}
                    onOpenRepairs={openRepairsForAsset}
                  />
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ===== NAPRAWY ===== */}
        {activeTab === 'naprawy' && (
          loading ? <LoadingBox text={t('pages.flota.loadingFleet')} /> : filteredNaprawy.length === 0 ? (
            <EmptyBox icon={<ConstructionOutlined sx={{ fontSize: 48, opacity: 0.55 }} />} text={t('pages.flota.emptyRepairs')} />
          ) : (
            <div className="fleet-repairs-wrap" style={S.repairsWrap}>
              {repairFocusActive && (
                <div style={S.repairFocusBox}>
                  <div>
                    <span style={S.repairFocusEyebrow}>Widok z planu biura</span>
                    <strong style={S.repairFocusTitle}>Naprawy zawężone</strong>
                    <small style={S.repairFocusDetail}>{repairFocusLabel || 'Wybrany zasob albo ekipa'}</small>
                  </div>
                  <div style={S.repairFocusActions}>
                    {repairFocus.returnTo && (
                      <Button size="sm" onClick={() => navigate(repairFocus.returnTo)}>
                        Wroc do planu biura
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => navigate('/flota?tab=naprawy')}>
                      Pokaz wszystkie naprawy
                    </Button>
                  </div>
                </div>
              )}
              <div style={S.repairFilterBar}>
                {[
                  ['all', 'Wszystkie'],
                  ['open', 'Otwarte'],
                  ['overdue', 'Po terminie'],
                  ['noInvoice', 'Bez faktury'],
                  ['closed', 'Zamkniete'],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    variant={repairQuickFilter === key ? 'primary' : 'secondary'}
                    size="sm"
                    style={{ ...S.repairFilterBtn, ...(repairQuickFilter === key ? S.repairFilterBtnActive : {}) }}
                    onClick={() => setRepairQuickFilter(key)}
                  >
                    {label}
                  </Button>
                ))}
                <Button variant="secondary" size="sm" style={S.repairFilterExportBtn} leftIcon={FileText} onClick={() => exportRepairsCsv(filteredNaprawy)}>
                  Eksport CSV
                </Button>
              </div>
              <div className="fleet-repairs-header" style={S.repairsHeader}>
                {(repairHeaders.length ? repairHeaders : ['Typ', 'Zasób', 'Data', 'Koszt', 'Usterka', 'Wykonawca', 'Status']).slice(0, 7).map((h) => (
                  <span key={h} style={S.repairsHeaderChip}>{h}</span>
                ))}
              </div>
              <div className="fleet-repairs-grid" style={S.repairsGrid}>
                {filteredNaprawy.map((n) => (
                  <div className="fleet-repair-card" key={n.id} style={S.repairCard}>
                    <div style={S.repairTop}>
                      <span style={S.repairType}>{n.typ_zasobu}</span>
                      <span style={{ ...S.repairStatus, backgroundColor: n.status === 'Zakończona' ? '#456b1f' : '#995510' }}>
                        {t(`fleetRepairStatus.${n.status}`, { defaultValue: n.status })}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Zasób</span>
                      <span style={S.repairValue}>{getRepairAssetLabel(n)}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Data</span>
                      <span style={S.repairValue}>{fmt(n.data_naprawy)}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Termin</span>
                      <span style={{
                        ...S.repairValue,
                        color: repairDueState(n).state === 'overdue' ? 'var(--danger)' : repairDueState(n).state === 'soon' ? '#995510' : 'var(--text-sub)',
                        fontWeight: repairDueState(n).state === 'overdue' ? 900 : 700,
                      }}>
                        {n.termin_odbioru
                          ? `${fmt(n.termin_odbioru)}${repairDueState(n).state === 'overdue' ? ` (${Math.abs(repairDueState(n).days)} dni po)` : repairDueState(n).state === 'soon' ? ` (${repairDueState(n).days} dni)` : ''}`
                          : '-'}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Priorytet</span>
                      <span style={{
                        ...S.repairValue,
                        color: n.priorytet === 'Krytyczny' ? 'var(--danger)' : n.priorytet === 'Pilny' ? '#995510' : 'var(--text-sub)',
                        fontWeight: n.priorytet === 'Krytyczny' ? 900 : 700,
                      }}>
                        {n.priorytet || 'Normalny'}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Koszt</span>
                      <span style={{ ...S.repairValue, color: 'var(--danger)', fontWeight: 700 }}>
                        {n.koszt ? `${parseFloat(n.koszt).toLocaleString('pl-PL')} PLN` : '-'}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Czesci</span>
                      <span style={{ ...S.repairValue, color: Number(n.czesci_kwota || 0) ? 'var(--danger)' : 'var(--text-sub)', fontWeight: 700 }}>
                        {Number(n.czesci_kwota || 0) ? `${formatMoney(n.czesci_kwota)} / ${n.czesci_count || 0}` : '-'}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Przestoj</span>
                      <span style={{ ...S.repairValue, color: repairDowntimeLoss(n) ? 'var(--danger)' : 'var(--text-sub)', fontWeight: repairDowntimeLoss(n) ? 900 : 700 }}>
                        {repairDowntimeDays(n)} dni{repairDowntimeLoss(n) ? ` / ${formatMoney(repairDowntimeLoss(n))}` : ''}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Koniec</span>
                      <span style={S.repairValue}>{fmt(n.data_zakonczenia)}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Usterka</span>
                      <span style={S.repairValue}>{n.opis_usterki || '-'}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Wykonawca</span>
                      <span style={S.repairValue}>{n.wykonawca || '-'}</span>
                    </div>
                    <div style={S.invoiceBox}>
                      <div style={S.invoiceTop}>
                        <span><FileText size={14} /> Faktury</span>
                        <Button variant="ghost" size="sm" style={S.invoiceGhostBtn} leftIcon={FileText} onClick={() => loadRepairInvoices(n.id)}>
                          {Array.isArray(repairInvoices[n.id]) ? `${repairInvoices[n.id].length} plikow` : `${n.faktury_count || 0} zapisane`}
                        </Button>
                      </div>
                      {canEdit && (
                        <div style={S.invoiceForm}>
                          <input
                            style={S.invoiceInput}
                            value={invoiceDrafts[n.id]?.numer || ''}
                            onChange={(e) => setInvoiceDraft(n.id, 'numer', e.target.value)}
                            placeholder="Nr faktury"
                          />
                          <input
                            style={S.invoiceInput}
                            type="number"
                            step="0.01"
                            value={invoiceDrafts[n.id]?.kwota || ''}
                            onChange={(e) => setInvoiceDraft(n.id, 'kwota', e.target.value)}
                            placeholder="Kwota"
                          />
                          <label style={S.invoiceUploadBtn}>
                            <Upload size={14} /> {invoiceUploadingId === String(n.id) ? 'Wgrywam' : 'Dodaj fakture'}
                            <input
                              type="file"
                              accept="image/*,.pdf,application/pdf"
                              style={{ display: 'none' }}
                              disabled={invoiceUploadingId === String(n.id)}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                uploadRepairInvoice(n, file);
                              }}
                            />
                          </label>
                        </div>
                      )}
                      {Array.isArray(repairInvoices[n.id]) && repairInvoices[n.id].length > 0 && (
                        <div style={S.invoiceLinks}>
                          {repairInvoices[n.id].slice(0, 4).map((invoice) => (
                            <div key={invoice.id} style={S.invoiceLinkRow}>
                              <a href={invoice.url} target="_blank" rel="noreferrer" style={S.invoiceLink}>
                                {invoice.numer || invoice.nazwa_pliku || `Faktura #${invoice.id}`} {invoice.kwota ? `- ${formatMoney(invoice.kwota)}` : ''}
                              </a>
                              {canEdit && (
                                <Button variant="danger" size="sm" style={S.invoiceDeleteBtn} leftIcon={Trash2} onClick={() => deleteRepairInvoice(n, invoice.id)}>
                                  Usun
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={S.invoiceBox}>
                      <div style={S.invoiceTop}>
                        <span><Wrench size={14} /> Czesci i materialy</span>
                        <Button variant="ghost" size="sm" style={S.invoiceGhostBtn} leftIcon={FileText} onClick={() => loadRepairParts(n.id)}>
                          {Array.isArray(repairParts[n.id]) ? `${repairParts[n.id].length} pozycji` : `${n.czesci_count || 0} zapisane`}
                        </Button>
                      </div>
                      {canEdit && (
                        <div style={S.partForm}>
                          <input
                            style={S.invoiceInput}
                            value={partDrafts[n.id]?.nazwa || ''}
                            onChange={(e) => setPartDraft(n.id, 'nazwa', e.target.value)}
                            placeholder="Czesc / material"
                          />
                          <input
                            style={S.invoiceInput}
                            type="number"
                            step="0.01"
                            min="0"
                            value={partDrafts[n.id]?.ilosc || ''}
                            onChange={(e) => setPartDraft(n.id, 'ilosc', e.target.value)}
                            placeholder="Ilosc"
                          />
                          <input
                            style={S.invoiceInput}
                            type="number"
                            step="0.01"
                            min="0"
                            value={partDrafts[n.id]?.cena || ''}
                            onChange={(e) => setPartDraft(n.id, 'cena', e.target.value)}
                            placeholder="Cena"
                          />
                          <Button size="sm" loading={partSavingId === String(n.id)} disabled={!String(partDrafts[n.id]?.nazwa || '').trim()} onClick={() => addRepairPart(n)}>
                            Dodaj
                          </Button>
                        </div>
                      )}
                      {Array.isArray(repairParts[n.id]) && repairParts[n.id].length > 0 && (
                        <div style={S.invoiceLinks}>
                          {repairParts[n.id].slice(0, 5).map((part) => (
                            <div key={part.id} style={S.partLinkRow}>
                              <span style={S.invoiceLink}>
                                {part.nazwa} / {part.ilosc} x {formatMoney(part.cena)} = {formatMoney(part.kwota_laczna)}
                              </span>
                              {canEdit && (
                                <Button variant="danger" size="sm" style={S.invoiceDeleteBtn} leftIcon={Trash2} onClick={() => deleteRepairPart(n, part.id)}>
                                  Usun
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <Button fullWidth variant="outline" leftIcon={Pencil} onClick={() => openEditRepairDraft(n)}>
                        Edytuj naprawe
                      </Button>
                    )}
                    {!repairIsClosed(n.status) && canEdit && (
                      <div style={S.repairCloseActions}>
                        {repairFocus.returnTo && (
                          <Button fullWidth loading={repairSaving} onClick={() => closeRepair(n, { returnTo: repairFocus.returnTo })}>
                            Zakoncz i wroc do planu biura
                          </Button>
                        )}
                        <Button fullWidth variant={repairFocus.returnTo ? 'outline' : 'primary'} loading={repairSaving} onClick={() => closeRepair(n)}>
                          Zakoncz naprawe
                        </Button>
                      </div>
                    )}
                    {canEdit && (
                      <Button fullWidth variant="danger" loading={repairSaving} onClick={() => deleteRepair(n)}>
                        Usun naprawe
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        <RepairDialog
          draft={repairDraft}
          saving={repairSaving}
          onChange={setRepairDraft}
          onSubmit={submitRepairDraft}
          onClose={() => setRepairDraft(null)}
          pojazdy={filtrPojazdy}
          sprzet={filtrSprzet}
        />
      </main>
    </div>
  );
}

function ResourceCardsPanel({ cards, total, alertCount, onOpenDetail, onOpenCalendar }) {
  return (
    <section
      className="fleet-resource-cards-panel"
      data-testid="fleet-resource-cards-panel"
      style={{ marginBottom: 22 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0, fontWeight: 800 }}>
            Karty zasobow
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: 18, color: 'var(--text)' }}>
            {alertCount ? `${alertCount} alertow przed startem ekip` : 'Zasoby gotowe operacyjnie'}
          </h2>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
          {cards.length}/{total} kart wymaga uwagi
        </div>
      </div>

      {cards.length === 0 ? (
        <div
          data-testid="fleet-resource-cards-empty"
          style={{ border: '1px solid var(--glass-border)', background: 'var(--surface-glass)', borderRadius: 8, padding: 14, color: 'var(--text-sub)', boxShadow: 'var(--shadow-md)' }}
        >
          Brak przeterminowanych lub zblizajacych sie przegladow i OC w wybranym oddziale.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {cards.map((card) => {
            const worst = card.alerts.reduce((acc, alert) => (priorityWeight(alert.state) < priorityWeight(acc.state) ? alert : acc), card.alerts[0]);
            return (
              <article
                key={card.id}
                data-testid={`fleet-resource-card-${card.id}`}
                style={{ borderWidth: '1px 1px 1px 4px', borderStyle: 'solid', borderColor: worst.color, background: 'var(--surface-glass)', borderRadius: 8, padding: 12, boxShadow: 'var(--shadow-md)', minWidth: 0 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>{card.type}</div>
                    <Button
                      variant="ghost"
                      aria-label={`Otworz karte zasobu ${card.title} ${card.subtitle}`.trim()}
                      onClick={() => onOpenDetail?.(card.assetType, card.asset)}
                      style={S.assetTitleButton}
                    >
                      <h3 style={{ margin: '2px 0 0', fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.title}</h3>
                    </Button>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{card.subtitle}</div>
                  </div>
                  <span style={{ borderWidth: 1, borderStyle: 'solid', borderColor: worst.color, color: worst.color, borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {worst.state === 'expired' ? 'STOP' : worst.state === 'soon' ? 'UWAGA' : 'KARTA'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text-sub)' }}>
                  <span>{card.branch}</span>
                  <span style={{ textAlign: 'right' }}>{card.team}</span>
                  <span>{card.status}</span>
                  <span style={{ textAlign: 'right' }}>{card.meta || '-'}</span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {card.alerts.map((alert) => (
                    <span
                      key={alert.key}
                      data-testid={`fleet-alert-card-${card.id}-${alert.key}`}
                      style={{ borderWidth: 1, borderStyle: 'solid', borderColor: alert.color, color: alert.color, borderRadius: 8, padding: '4px 7px', fontSize: 11, fontWeight: 800 }}
                      title={alert.detail}
                    >
                      {alert.label}
                    </span>
                  ))}
                </div>

                <Button
                  fullWidth
                  variant="outline"
                  leftIcon={CalendarDays}
                  onClick={() => onOpenCalendar(card)}
                  style={{ marginTop: 12 }}
                >
                  Kalendarz zasobow
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LoadingBox({ text }) {
  return (
    <div className="fleet-state-panel" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <AutorenewOutlined sx={{ fontSize: 40, color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
      </div>
      <p>{text}</p>
    </div>
  );
}

function EmptyBox({ icon, text, sub }) {
  return (
    <div className="fleet-state-panel" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>{icon}</div>
      <p style={{ fontWeight: '600', color: 'var(--text-sub)' }}>{text}</p>
      {sub && <p style={{ fontSize: 13 }}>{sub}</p>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' }}>{label}</label>
      {children}
    </div>
  );
}

function FleetAssetControls({
  type,
  item,
  ekipy,
  photos,
  documents,
  documentDraft,
  repairSummary,
  uploading,
  documentUploading,
  canEdit,
  onTeamChange,
  onRenewInspection,
  onLoadPhotos,
  onUploadPhoto,
  onDeletePhoto,
  onLoadDocuments,
  onUploadDocument,
  onDocumentDraftChange,
  onDeleteDocument,
  onOpenDetail,
  onOpenRepairs,
}) {
  const loaded = Array.isArray(photos);
  const docsLoaded = Array.isArray(documents);
  const docDraft = { kategoria: 'Inne', wazny_do: '', ...(documentDraft || {}) };
  const kind = type === 'pojazdy' ? 'pojazd' : 'sprzet';
  return (
    <div style={S.assetControlBox}>
      <div style={S.assetControlMain}>
        <label style={S.assetControlLabel}>Ekipa</label>
        <select
          style={S.assetControlSelect}
          value={item.ekipa_id || ''}
          disabled={!canEdit}
          onChange={(e) => onTeamChange(type, item, e.target.value)}
        >
          <option value="">Bez ekipy</option>
          {ekipy.map((team) => <option key={team.id} value={team.id}>{team.nazwa}</option>)}
        </select>
      </div>
      <div style={S.assetActionStack}>
        <Button variant="secondary" style={S.assetHistoryButton} onClick={() => onOpenDetail(type, item)}>
          <span>Karta</span>
          <strong>{item.status || '-'}</strong>
          <small>{item.ekipa_nazwa || 'bez ekipy'}</small>
        </Button>
        <Button variant="secondary" style={S.assetHistoryButton} onClick={() => onOpenRepairs(kind, item)}>
          <span>Historia</span>
          <strong>{repairSummary?.count || 0} / {formatMoney(repairSummary?.cost || 0)}</strong>
          <small>{repairSummary?.open ? `${repairSummary.open} otwarte` : (repairSummary?.lastDate ? `ostatnio ${fmtDate(repairSummary.lastDate)}` : 'brak napraw')}</small>
        </Button>
      </div>
      <div style={S.assetPhotoPanel}>
        {canEdit && (
          <Button variant="secondary" size="sm" style={S.assetPhotoButton} leftIcon={CheckCircle} onClick={() => onRenewInspection(type, item, 12)}>
            Przeglad +12m
          </Button>
        )}
        <Button variant="secondary" size="sm" style={S.assetPhotoButton} leftIcon={Image} onClick={() => onLoadPhotos(type, item.id)}>
          {loaded ? `${photos.length} zdj.` : 'Zdjecia'}
        </Button>
        {canEdit && (
          <label style={S.assetUploadButton}>
            <Upload size={14} /> {uploading ? 'Wgrywam' : 'Dodaj'}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                onUploadPhoto(type, item, file);
              }}
            />
          </label>
        )}
        {loaded && photos.slice(0, 3).map((photo) => (
          <span key={photo.id} style={S.assetThumbWrap}>
            <a href={photo.url} target="_blank" rel="noreferrer" style={S.assetThumbLink}>
              <img src={photo.url} alt={photo.opis || 'Zdjecie zasobu'} style={S.assetThumb} />
            </a>
            {canEdit && (
              <Button variant="danger" size="sm" style={S.assetThumbDelete} leftIcon={X} onClick={() => onDeletePhoto(type, item, photo.id)} aria-label="Usun zdjecie" />
            )}
          </span>
        ))}
        <Button variant="secondary" size="sm" style={S.assetPhotoButton} leftIcon={FileText} onClick={() => onLoadDocuments(type, item.id)}>
          {docsLoaded ? `${documents.length} dok.` : 'Dokumenty'}
        </Button>
        {canEdit && (
          <select
            style={S.assetDocSelect}
            value={docDraft.kategoria}
            onChange={(e) => onDocumentDraftChange(type, item.id, 'kategoria', e.target.value)}
            title="Typ dokumentu"
          >
            {FLEET_DOCUMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        )}
        {canEdit && (
          <input
            style={S.assetDocDateInput}
            type="date"
            value={docDraft.wazny_do || ''}
            onChange={(e) => onDocumentDraftChange(type, item.id, 'wazny_do', e.target.value)}
            title="Wazny do"
          />
        )}
        {canEdit && (
          <label style={S.assetUploadButton}>
            <Upload size={14} /> {documentUploading ? 'Wgrywam' : 'Dodaj dok.'}
            <input
              type="file"
              accept="image/*,.pdf,application/pdf"
              style={{ display: 'none' }}
              disabled={documentUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                onUploadDocument(type, item, file);
              }}
            />
          </label>
        )}
        {docsLoaded && documents.slice(0, 4).map((doc) => (
          <span key={doc.id} style={S.assetDocumentChip}>
            <a href={doc.url} target="_blank" rel="noreferrer" style={S.assetDocumentLink}>
              {doc.kategoria || doc.nazwa_pliku || `Dokument #${doc.id}`}
            </a>
            {canEdit && (
              <Button variant="danger" size="sm" style={S.assetDocumentDelete} leftIcon={X} onClick={() => onDeleteDocument(type, item, doc.id)} aria-label="Usun dokument" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function AssetDetailPanel({
  detail,
  canEdit,
  ekipy = [],
  reservationDraft = {},
  reservationSavingKey = '',
  protocolDrafts = {},
  protocolFiles = {},
  protocolSavingId = '',
  protocolOpenId = '',
  onClose,
  onOpenRepairs,
  onNewRepair,
  onLoadPhotos,
  onLoadDocuments,
  onLoadHistory,
  onLoadReservations,
  onReservationDraftChange,
  onCreateReservation,
  onUpdateReservationStatus,
  onProtocolDraftChange,
  onProtocolFilesChange,
  onSubmitProtocol,
  onToggleProtocol,
  onDeletePhoto,
  onDeleteDocument,
}) {
  const item = detail.item;
  const isVehicle = detail.type === 'pojazdy';
  const openAlerts = detail.alerts.filter((alert) => alert.state !== 'ok');
  const reservationKey = detail.key;
  const draftTeam = reservationDraft.ekipa_id || item.ekipa_id || ekipy[0]?.id || '';
  const draftStart = reservationDraft.data_od || todayYmd();
  const draftEnd = reservationDraft.data_do || draftStart;
  const reservationCandidate = { data_od: draftStart, data_do: draftEnd };
  const hasReservationConflict = (detail.reservations || []).some((row) => reservationIsActive(row) && reservationOverlaps(row, reservationCandidate));
  const canSaveReservation = canEdit && !isVehicle && draftTeam && draftStart && draftEnd && draftEnd >= draftStart && !hasReservationConflict;
  return (
    <section style={S.assetDetailPanel}>
      <div style={S.assetDetailHeader}>
        <div>
          <div style={S.assetDetailEyebrow}>Karta zasobu</div>
          <h2 style={S.assetDetailTitle}>{detail.label || `Zasob #${item.id}`}</h2>
          <p style={S.assetDetailSubtitle}>{detail.subtitle}</p>
        </div>
        <div style={S.assetDetailActions}>
          <Button size="sm" variant="outline" leftIcon={Wrench} onClick={onOpenRepairs}>Historia napraw</Button>
          {canEdit && <Button size="sm" leftIcon={Plus} onClick={onNewRepair}>Nowa naprawa</Button>}
          <Button size="sm" variant="ghost" leftIcon={X} onClick={onClose}>Zamknij</Button>
        </div>
      </div>

      <div style={S.assetDetailGrid}>
        <div style={S.assetDetailMetric}><span>Status</span><strong>{item.status || '-'}</strong><small>{item.ekipa_nazwa || 'bez ekipy'}</small></div>
        <div style={S.assetDetailMetric}><span>Naprawy</span><strong>{detail.repairs.length}</strong><small>{detail.openRepairs} otwarte</small></div>
        <div style={S.assetDetailMetric}><span>Koszt napraw</span><strong>{formatMoney(detail.repairCost)}</strong><small>faktury + wpisy</small></div>
        <div style={S.assetDetailMetric}><span>Strata przestoju</span><strong>{formatMoney(detail.downtimeLoss)}</strong><small>{detail.repairs.reduce((sum, repair) => sum + repairDowntimeDays(repair), 0)} dni</small></div>
      </div>

      <div style={S.assetDetailColumns}>
        <div style={S.assetDetailSection}>
          <h3>Informacje</h3>
          <div style={S.assetInfoGrid}>
            <span>Oddzial</span><strong>{item.oddzial_nazwa || '-'}</strong>
            <span>Typ</span><strong>{item.typ || '-'}</strong>
            <span>{isVehicle ? 'Rejestracja' : 'Nr seryjny'}</span><strong>{isVehicle ? item.nr_rejestracyjny || '-' : item.nr_seryjny || '-'}</strong>
            <span>Rok</span><strong>{item.rok_produkcji || '-'}</strong>
            <span>Przeglad</span><strong>{fmtDate(item.data_przegladu)}</strong>
            {isVehicle && <><span>OC</span><strong>{fmtDate(item.data_ubezpieczenia)}</strong></>}
            {isVehicle && <><span>Przebieg</span><strong>{item.przebieg ? `${Number(item.przebieg).toLocaleString('pl-PL')} km` : '-'}</strong></>}
            {!isVehicle && <><span>Motogodzina</span><strong>{item.koszt_motogodziny ? `${item.koszt_motogodziny} PLN` : '-'}</strong></>}
          </div>
        </div>

        <div style={S.assetDetailSection}>
          <h3>Alerty</h3>
          {openAlerts.length ? openAlerts.map((alert) => (
            <div key={alert.key} style={{ ...S.assetAlertRow, border: `1px solid ${alert.color}` }}>
              <strong>{alert.label}</strong>
              <span>{alert.detail}</span>
            </div>
          )) : <div style={S.assetEmptyLine}>Brak aktywnych alertow.</div>}
        </div>
      </div>

      <div style={S.assetDetailColumns}>
        <div style={S.assetDetailSection}>
          <div style={S.assetSectionTop}>
            <h3>Zdjecia</h3>
            <Button variant="secondary" size="sm" style={S.assetMiniBtn} leftIcon={Image} onClick={onLoadPhotos}>Odswiez</Button>
          </div>
          <div style={S.assetMediaGrid}>
            {detail.photos.length ? detail.photos.slice(0, 8).map((photo) => (
              <span key={photo.id} style={S.assetDetailThumbWrap}>
                <a href={photo.url} target="_blank" rel="noreferrer" style={S.assetDetailThumbLink}>
                  <img src={photo.url} alt={photo.opis || 'Zdjecie zasobu'} style={S.assetDetailThumb} />
                </a>
                {canEdit && <Button variant="danger" size="sm" style={S.assetThumbDelete} leftIcon={X} onClick={() => onDeletePhoto(photo.id)} aria-label="Usun zdjecie" />}
              </span>
            )) : <div style={S.assetEmptyLine}>Kliknij Zdjecia albo dodaj pierwsze zdjecie na karcie.</div>}
          </div>
        </div>

        <div style={S.assetDetailSection}>
          <div style={S.assetSectionTop}>
            <h3>Dokumenty</h3>
            <Button variant="secondary" size="sm" style={S.assetMiniBtn} leftIcon={FileText} onClick={onLoadDocuments}>Odswiez</Button>
          </div>
          <div style={S.assetDocList}>
            {detail.documents.length ? detail.documents.map((doc) => (
              <div key={doc.id} style={{ ...S.assetDocRow, borderColor: dateHealth(doc.wazny_do).state === 'expired' ? 'rgba(226,68,92,0.45)' : dateHealth(doc.wazny_do).state === 'soon' ? 'rgba(253,171,61,0.45)' : 'var(--border)' }}>
                <a href={doc.url} target="_blank" rel="noreferrer">{doc.kategoria || doc.nazwa_pliku || `Dokument #${doc.id}`}</a>
                <span>{doc.wazny_do ? `wazny do ${fmtDate(doc.wazny_do)}` : 'bez terminu'}</span>
                {canEdit && <Button variant="danger" size="sm" leftIcon={Trash2} onClick={() => onDeleteDocument(doc.id)}>Usun</Button>}
              </div>
            )) : <div style={S.assetEmptyLine}>Brak dokumentow w karcie zasobu.</div>}
          </div>
        </div>
      </div>

      {!isVehicle && (
        <div style={S.assetDetailSection}>
          <div style={S.assetSectionTop}>
            <h3>Wydania i rezerwacje</h3>
            <Button variant="secondary" size="sm" style={S.assetMiniBtn} leftIcon={CalendarDays} onClick={onLoadReservations}>Odswiez</Button>
          </div>
          {canEdit && (
            <div style={S.reservationForm}>
              <select
                style={S.invoiceInput}
                value={draftTeam}
                onChange={(e) => onReservationDraftChange('ekipa_id', e.target.value)}
              >
                <option value="">Wybierz ekipe</option>
                {ekipy.map((team) => (
                  <option key={team.id} value={team.id}>{team.nazwa}</option>
                ))}
              </select>
              <input
                style={S.invoiceInput}
                type="date"
                value={draftStart}
                onChange={(e) => onReservationDraftChange('data_od', e.target.value)}
              />
              <input
                style={S.invoiceInput}
                type="date"
                value={draftEnd}
                onChange={(e) => onReservationDraftChange('data_do', e.target.value)}
              />
              <Button
                size="sm"
                disabled={!canSaveReservation}
                loading={reservationSavingKey === `${reservationKey}:Zarezerwowane`}
                leftIcon={CalendarDays}
                onClick={() => onCreateReservation('Zarezerwowane')}
              >
                Zarezerwuj
              </Button>
              <Button
                size="sm"
                disabled={!canSaveReservation}
                loading={reservationSavingKey === `${reservationKey}:Wydane`}
                leftIcon={CheckCircle}
                onClick={() => onCreateReservation('Wydane')}
              >
                Wydaj sprzet
              </Button>
            </div>
          )}
          {hasReservationConflict && <div style={S.reservationWarning}>Konflikt terminu: ten sprzet jest juz zajety w wybranym zakresie.</div>}
          <div style={S.reservationList}>
            {detail.reservations?.length ? detail.reservations.map((reservation) => (
              <div key={reservation.id} style={S.reservationRow}>
                <div style={S.reservationMain}>
                  <strong>{fmtDate(reservation.data_od)} - {fmtDate(reservation.data_do)}</strong>
                  <span>{reservation.ekipa_nazwa || `Ekipa #${reservation.ekipa_id}`} / {reservation.status || '-'}</span>
                </div>
                {canEdit && (
                  <div style={S.reservationActions}>
                    {reservation.status === 'Zarezerwowane' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={reservationSavingKey === `${reservationKey}:${reservation.id}:Wydane`}
                        onClick={() => onUpdateReservationStatus(reservation, 'Wydane')}
                      >
                        Wydaj
                      </Button>
                    )}
                    {reservation.status === 'Wydane' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={reservationSavingKey === `${reservationKey}:${reservation.id}:Zwrócone`}
                        onClick={() => onUpdateReservationStatus(reservation, 'Zwrócone')}
                      >
                        Zwroc
                      </Button>
                    )}
                    {reservationIsActive(reservation) && (
                      <Button
                        size="sm"
                        variant="danger"
                        loading={reservationSavingKey === `${reservationKey}:${reservation.id}:Anulowane`}
                        onClick={() => onUpdateReservationStatus(reservation, 'Anulowane')}
                      >
                        Anuluj
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={FileText}
                      onClick={() => onToggleProtocol(reservation.id)}
                    >
                      Protokol
                    </Button>
                  </div>
                )}
                {canEdit && (
                  <ReservationProtocolCard
                    reservation={reservation}
                    open={String(protocolOpenId) === String(reservation.id)}
                    draft={protocolDrafts[reservation.id]}
                    files={protocolFiles[reservation.id] || []}
                    saving={protocolSavingId === String(reservation.id)}
                    onDraftChange={(field, value) => onProtocolDraftChange(reservation.id, field, value)}
                    onFilesChange={(files) => onProtocolFilesChange(reservation.id, files)}
                    onSubmit={() => onSubmitProtocol(reservation)}
                  />
                )}
              </div>
            )) : <div style={S.assetEmptyLine}>Brak aktywnych rezerwacji w najblizszych 2 miesiacach.</div>}
          </div>
        </div>
      )}

      <div style={S.assetDetailSection}>
        <div style={S.assetSectionTop}>
          <h3>Ostatnie naprawy</h3>
          <Button variant="secondary" size="sm" style={S.assetMiniBtn} leftIcon={Wrench} onClick={onOpenRepairs}>Pokaz wszystkie</Button>
        </div>
        <div style={S.assetRepairList}>
          {detail.repairs.length ? detail.repairs.slice(0, 5).map((repair) => (
            <div key={repair.id} style={S.assetRepairRow}>
              <strong>{fmtDate(repair.data_naprawy)} / {repair.status || '-'}</strong>
              <span>{repair.opis_usterki || '-'}</span>
              <b>{formatMoney((Number(repair.faktury_kwota ?? repair.koszt ?? 0) || 0) + (Number(repair.czesci_kwota || 0) || 0))}</b>
            </div>
          )) : <div style={S.assetEmptyLine}>Brak historii napraw.</div>}
        </div>
      </div>

      <div style={S.assetDetailSection}>
        <div style={S.assetSectionTop}>
          <h3>Historia zmian</h3>
          <Button variant="secondary" size="sm" style={S.assetMiniBtn} leftIcon={CalendarDays} onClick={onLoadHistory}>Odswiez</Button>
        </div>
        <div style={S.assetTimeline}>
          {detail.history.length ? detail.history.slice(0, 12).map((event) => (
            <div key={event.id} style={S.assetTimelineRow}>
              <div style={S.assetTimelineDot} />
              <div style={S.assetTimelineBody}>
                <strong>{event.action || 'Zmiana'}</strong>
                <span>{event.detail || '-'}</span>
                <small>{fmtDate(event.created_at)} / {event.created_by_name || 'system'}</small>
              </div>
            </div>
          )) : <div style={S.assetEmptyLine}>Brak zapisanych zmian. Nowe akcje beda tu widoczne automatycznie.</div>}
        </div>
      </div>
    </section>
  );
}

function ReservationProtocolCard({ reservation, open = false, draft = {}, files = [], saving, onDraftChange, onFilesChange, onSubmit }) {
  const protocolDraft = {
    typ: reservation.status === 'Wydane' ? 'zwrot' : 'wydanie',
    stan: 'OK',
    licznik_mtg: '',
    paliwo_osprzet: '',
    osoba: '',
    podpis: '',
    koszt_uszkodzen: '',
    notatka: '',
    ...draft,
  };
  const protocols = Array.isArray(reservation.protokoly) ? reservation.protokoly : [];
  const lastProtocol = protocols.slice().sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] || null;
  const damageCost = protocols.reduce((sum, protocol) => sum + (Number(protocol.koszt_uszkodzen || 0) || 0), 0);

  if (!open) {
    if (!protocols.length) return null;
    return (
      <div style={S.protocolSummary}>
        <strong>{protocols.length} protokol(e)</strong>
        <span>ostatni: {lastProtocol?.typ || '-'} / {lastProtocol?.stan || '-'}</span>
        <b>{formatMoney(damageCost)}</b>
      </div>
    );
  }

  return (
    <div style={S.protocolBox}>
      <div style={S.protocolTop}>
        <strong>Protokol wydania / zwrotu</strong>
        <span>{lastProtocol ? `ostatni: ${lastProtocol.typ} / ${lastProtocol.stan}` : 'brak protokolu'}</span>
      </div>
      <div style={S.protocolForm}>
        <select style={S.invoiceInput} value={protocolDraft.typ} onChange={(e) => onDraftChange('typ', e.target.value)}>
          <option value="wydanie">Wydanie</option>
          <option value="zwrot">Zwrot</option>
          <option value="kontrola">Kontrola</option>
        </select>
        <select style={S.invoiceInput} value={protocolDraft.stan} onChange={(e) => onDraftChange('stan', e.target.value)}>
          <option value="OK">OK</option>
          <option value="Do kontroli">Do kontroli</option>
          <option value="Uszkodzony">Uszkodzony</option>
          <option value="Braki">Braki</option>
        </select>
        <input style={S.invoiceInput} value={protocolDraft.licznik_mtg} onChange={(e) => onDraftChange('licznik_mtg', e.target.value)} placeholder="mtg / licznik" />
        <input style={S.invoiceInput} value={protocolDraft.osoba} onChange={(e) => onDraftChange('osoba', e.target.value)} placeholder="osoba odbierajaca" />
        <input style={S.invoiceInput} type="number" step="0.01" value={protocolDraft.koszt_uszkodzen} onChange={(e) => onDraftChange('koszt_uszkodzen', e.target.value)} placeholder="koszt strat" />
        <input style={S.invoiceInput} value={protocolDraft.podpis} onChange={(e) => onDraftChange('podpis', e.target.value)} placeholder="podpis / potwierdzenie" />
      </div>
      <textarea
        style={S.protocolNote}
        value={protocolDraft.notatka}
        onChange={(e) => onDraftChange('notatka', e.target.value)}
        placeholder="notatka: uszkodzenia, braki, paliwo, osprzet, uwagi ekipy"
      />
      <div style={S.protocolActions}>
        <label style={S.invoiceUploadBtn}>
          <Upload size={14} />
          Zdjecia stanu
          <input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFilesChange(e.target.files)} />
        </label>
        <span>{files.length ? `${files.length} plikow` : 'bez plikow'}</span>
        <Button size="sm" loading={saving} onClick={onSubmit}>Zapisz protokol</Button>
      </div>
      {protocols.length > 0 && (
        <div style={S.protocolHistory}>
          {protocols.slice(-3).reverse().map((protocol) => (
            <div key={protocol.id} style={S.protocolHistoryRow}>
              <strong>{protocol.typ} / {protocol.stan}</strong>
              <span>{fmtDate(protocol.created_at)} / {protocol.osoba || protocol.podpis || protocol.created_by_name || '-'}</span>
              <b>{formatMoney(protocol.koszt_uszkodzen)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepairDialog({ draft, saving, onChange, onSubmit, onClose, pojazdy = [], sprzet = [] }) {
  if (!draft) return null;
  const setField = (field, value) => onChange((prev) => ({ ...prev, [field]: value }));
  const assetOptions = draft.typ_zasobu === 'Pojazd' ? pojazdy : sprzet;
  const setRepairAssetType = (value) => {
    const nextType = value === 'Pojazd' ? 'Pojazd' : 'Sprzet';
    const options = nextType === 'Pojazd' ? pojazdy : sprzet;
    const first = options[0] || null;
    onChange((prev) => ({
      ...prev,
      kind: nextType === 'Pojazd' ? 'pojazd' : 'sprzet',
      typ_zasobu: nextType,
      zasob_id: first?.id || '',
      item: first,
      label: first
        ? (nextType === 'Pojazd'
          ? [first.marka, first.model, first.nr_rejestracyjny].filter(Boolean).join(' ')
          : [first.nazwa, first.typ].filter(Boolean).join(' / '))
        : 'Wybierz zasob',
      oddzial_id: first?.oddzial_id || prev.oddzial_id || '',
    }));
  };
  const setRepairAsset = (value) => {
    const selected = assetOptions.find((item) => String(item.id) === String(value)) || null;
    onChange((prev) => ({
      ...prev,
      zasob_id: selected?.id || '',
      item: selected,
      label: selected
        ? (prev.typ_zasobu === 'Pojazd'
          ? [selected.marka, selected.model, selected.nr_rejestracyjny].filter(Boolean).join(' ')
          : [selected.nazwa, selected.typ].filter(Boolean).join(' / '))
        : 'Wybierz zasob',
      oddzial_id: selected?.oddzial_id || prev.oddzial_id || '',
    }));
  };
  return (
    <div style={S.modalBackdrop} role="dialog" aria-modal="true" aria-label="Zglos naprawe">
      <form style={S.modalPanel} onSubmit={onSubmit}>
        <div style={S.modalHeader}>
          <div>
            <div style={S.modalEyebrow}>Naprawa zasobu</div>
            <h3 style={S.modalTitle}>{draft.id ? 'Edytuj naprawe' : 'Zglos naprawe'}</h3>
            <p style={S.modalSubtitle}>{draft.label || `Zasob #${draft.zasob_id}`}</p>
          </div>
          <Button size="sm" variant="ghost" leftIcon={X} onClick={onClose} style={S.modalCloseBtn} aria-label="Zamknij" />
        </div>
        <div style={S.modalGrid}>
          <Field label="Typ zasobu">
            <select style={S.input} value={draft.typ_zasobu} onChange={(e) => setRepairAssetType(e.target.value)}>
              <option value="Sprzet">Sprzet</option>
              <option value="Pojazd">Pojazd</option>
            </select>
          </Field>
          <Field label="Sprzet / pojazd">
            <select style={S.input} value={draft.zasob_id || ''} onChange={(e) => setRepairAsset(e.target.value)} required>
              <option value="">Wybierz zasob</option>
              {assetOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {draft.typ_zasobu === 'Pojazd'
                    ? [item.marka, item.model, item.nr_rejestracyjny].filter(Boolean).join(' ')
                    : [item.nazwa, item.typ, item.nr_seryjny].filter(Boolean).join(' / ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data">
            <input style={S.input} type="date" value={draft.data_naprawy} onChange={(e) => setField('data_naprawy', e.target.value)} required />
          </Field>
          <Field label="Status">
            <select style={S.input} value={draft.status} onChange={(e) => setField('status', e.target.value)}>
              <option value="W toku">W toku</option>
              <option value="Zakonczona">Zakonczona</option>
            </select>
          </Field>
          <Field label="Termin odbioru">
            <input style={S.input} type="date" value={draft.termin_odbioru || ''} onChange={(e) => setField('termin_odbioru', e.target.value)} />
          </Field>
          <Field label="Data zakonczenia">
            <input style={S.input} type="date" value={draft.data_zakonczenia || ''} onChange={(e) => setField('data_zakonczenia', e.target.value)} />
          </Field>
          <Field label="Priorytet">
            <select style={S.input} value={draft.priorytet || 'Normalny'} onChange={(e) => setField('priorytet', e.target.value)}>
              {REPAIR_PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </Field>
          <Field label="Serwis / wykonawca">
            <input style={S.input} value={draft.wykonawca} onChange={(e) => setField('wykonawca', e.target.value)} placeholder="np. serwis lokalny" />
          </Field>
          <Field label="Koszt">
            <input style={S.input} type="number" step="0.01" value={draft.koszt} onChange={(e) => setField('koszt', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Strata dzienna">
            <input style={S.input} type="number" step="0.01" value={draft.strata_dzienna || ''} onChange={(e) => setField('strata_dzienna', e.target.value)} placeholder="np. 450" />
          </Field>
        </div>
        <Field label="Co sie stalo *">
          <textarea style={{ ...S.input, minHeight: 84, resize: 'vertical' }} value={draft.opis_usterki} onChange={(e) => setField('opis_usterki', e.target.value)} required placeholder="Opis usterki dla biura/serwisu" />
        </Field>
        <Field label="Opis naprawy">
          <textarea style={{ ...S.input, minHeight: 70, resize: 'vertical' }} value={draft.opis_naprawy} onChange={(e) => setField('opis_naprawy', e.target.value)} placeholder="Opcjonalnie, gdy naprawa jest zakonczona" />
        </Field>
        <div style={S.modalActions}>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button type="submit" loading={saving} disabled={!draft.zasob_id || !draft.opis_usterki.trim()} leftIcon={Save}>
            {draft.id ? 'Zapisz zmiany' : 'Zapisz naprawe'}
          </Button>
        </div>
      </form>
    </div>
  );
}

const S = {
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  formBox: { background: 'var(--surface-glass)', borderRadius: 8, padding: 24, marginBottom: 20, boxShadow: 'var(--shadow-md)', border: '1px solid var(--glass-border)' },
  formTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16 },
  quickRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 8 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  cancelBtn: { padding: '9px 18px', backgroundColor: 'var(--surface-field)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  submitBtn: { padding: '9px 18px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.22)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' },
  cardActions: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  ghostBtn: { padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  dangerBtn: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(226,68,92,0.35)', background: 'rgba(226,68,92,0.08)', color: 'var(--danger)', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  warningBtn: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(180,83,9,0.35)', background: 'rgba(245,158,11,0.1)', color: '#995510', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  assetTitleButton: { display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', color: 'var(--text)', cursor: 'pointer', padding: 0, fontSize: 15, fontWeight: 700, textAlign: 'left' },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalPanel: { width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--surface-glass)', color: 'var(--text)', border: '1px solid var(--glass-border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  modalHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 12 },
  modalEyebrow: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  modalTitle: { margin: '3px 0 2px', fontSize: 20, color: 'var(--text)' },
  modalSubtitle: { margin: 0, fontSize: 13, color: 'var(--text-muted)' },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 },
  modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 },
  repairsWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  repairFocusBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    border: '1px solid rgba(248,113,113,0.34)',
    borderRadius: 8,
    background: 'rgba(248,113,113,0.08)',
    padding: 12,
  },
  repairFocusEyebrow: { display: 'block', fontSize: 10, fontWeight: 900, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: 0 },
  repairFocusTitle: { display: 'block', fontSize: 15, fontWeight: 950, color: 'var(--text)', marginTop: 2 },
  repairFocusDetail: { display: 'block', fontSize: 12, fontWeight: 750, color: 'var(--text-sub)', marginTop: 3 },
  repairFocusActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  primarySoftBtn: { padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.28)', background: 'rgba(20,131,79,0.12)', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  repairsHeader: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  repairsHeaderChip: { fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 8px', background: 'var(--surface-field)' },
  repairsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
  repairCard: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-md)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  repairTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  repairType: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent)', padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700 },
  repairStatus: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: 700 },
  repairRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  repairLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0, fontWeight: 700 },
  repairValue: { fontSize: 12, color: 'var(--text-sub)', textAlign: 'right', fontWeight: 600 },
  repairCloseActions: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  repairCloseBtn: { marginTop: 4, width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.28)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  repairCloseBtnSecondary: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  maintenancePanel: { marginBottom: 22, border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)', padding: 14 },
  maintenanceHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  maintenanceEyebrow: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 900, letterSpacing: 0 },
  maintenanceTitle: { margin: '2px 0 0', color: 'var(--text)', fontSize: 18, lineHeight: 1.2 },
  maintenanceActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  maintenancePrimaryBtn: { padding: '8px 11px', borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(20,131,79,0.28)', backgroundColor: 'var(--accent)', backgroundImage: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  maintenanceSecondaryBtn: { padding: '8px 11px', borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', backgroundColor: 'var(--surface-field)', backgroundImage: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  maintenanceFilters: { display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 },
  maintenanceFilterBtn: { borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 999, backgroundColor: 'var(--surface-field)', backgroundImage: 'none', color: 'var(--text-sub)', cursor: 'pointer', padding: '6px 10px', fontSize: 12, fontWeight: 850 },
  maintenanceFilterBtnActive: { borderColor: 'rgba(20,131,79,0.38)', backgroundColor: 'rgba(20,131,79,0.12)', backgroundImage: 'none', color: 'var(--accent)' },
  maintenanceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
  maintenanceMetric: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', padding: 10, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  maintenanceTopList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 10 },
  maintenanceTopItem: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', textAlign: 'left', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(226,68,92,0.24)', borderRadius: 8, backgroundColor: 'rgba(226,68,92,0.06)', backgroundImage: 'none', color: 'var(--text)', padding: '8px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  maintenanceEmpty: { border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', padding: 10, fontSize: 12, fontWeight: 800 },
  assetControlBox: { display: 'grid', gridTemplateColumns: 'minmax(170px, 0.8fr) minmax(180px, 0.8fr) minmax(240px, 1.2fr)', gap: 10, alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' },
  assetControlMain: { display: 'grid', gridTemplateColumns: '52px 1fr', gap: 8, alignItems: 'center', minWidth: 0 },
  assetControlLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 900 },
  assetControlSelect: { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text)', minWidth: 0, fontSize: 12, fontWeight: 700 },
  assetActionStack: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minWidth: 0 },
  assetHistoryButton: { display: 'grid', gridTemplateColumns: '1fr', gap: 2, textAlign: 'left', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-glass)', color: 'var(--text)', cursor: 'pointer', padding: '7px 9px', minWidth: 0 },
  assetPhotoPanel: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap', minWidth: 0 },
  assetPhotoButton: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  assetUploadButton: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 9px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.3)', background: 'rgba(20,131,79,0.1)', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  assetThumbWrap: { position: 'relative', display: 'inline-flex' },
  assetThumbLink: { display: 'inline-flex', width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface-field)' },
  assetThumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  assetThumbDelete: { position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 999, border: '1px solid rgba(226,68,92,0.4)', background: 'var(--surface-glass)', color: 'var(--danger)', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0 },
  assetDocumentChip: { display: 'inline-grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 4, maxWidth: 150, border: '1px solid rgba(20,131,79,0.24)', borderRadius: 8, background: 'rgba(20,131,79,0.08)', padding: '5px 6px', minWidth: 0 },
  assetDocumentLink: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)', fontSize: 11, fontWeight: 900, textDecoration: 'none' },
  assetDocumentDelete: { border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: 0 },
  assetDocSelect: { minWidth: 82, maxWidth: 130, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text-sub)', fontSize: 11, fontWeight: 800 },
  assetDocDateInput: { width: 126, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text-sub)', fontSize: 11, fontWeight: 800 },
  assetDetailPanel: { marginBottom: 20, border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  assetDetailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 12 },
  assetDetailEyebrow: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 900, letterSpacing: 0 },
  assetDetailTitle: { margin: '3px 0 2px', fontSize: 22, color: 'var(--text)', lineHeight: 1.15 },
  assetDetailSubtitle: { margin: 0, color: 'var(--text-sub)', fontSize: 13, fontWeight: 700 },
  assetDetailActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  assetDetailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
  assetDetailMetric: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', padding: 10, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  assetDetailColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 },
  assetDetailSection: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', padding: 12, minWidth: 0 },
  assetSectionTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  assetMiniBtn: { borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 8, backgroundColor: 'var(--surface-glass)', backgroundImage: 'none', color: 'var(--text-sub)', cursor: 'pointer', padding: '5px 8px', fontSize: 11, fontWeight: 850 },
  assetInfoGrid: { display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '7px 10px', fontSize: 12, color: 'var(--text-muted)' },
  assetAlertRow: { border: '1px solid', borderRadius: 8, padding: 9, display: 'grid', gap: 2, marginBottom: 6, background: 'var(--surface-glass)', color: 'var(--text)' },
  assetEmptyLine: { border: '1px dashed var(--border)', borderRadius: 8, padding: 10, color: 'var(--text-muted)', fontSize: 12, fontWeight: 800 },
  assetMediaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 },
  assetDetailThumbWrap: { position: 'relative', display: 'block', minWidth: 0 },
  assetDetailThumbLink: { display: 'block', aspectRatio: '1 / 1', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface-glass)' },
  assetDetailThumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  assetDocList: { display: 'grid', gap: 7 },
  assetDocRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(80px, auto) auto', gap: 8, alignItems: 'center', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 8, background: 'var(--surface-glass)', padding: 8, fontSize: 12, minWidth: 0 },
  assetRepairList: { display: 'grid', gap: 7 },
  assetRepairRow: { display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr) auto', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-glass)', padding: 8, fontSize: 12, minWidth: 0 },
  assetTimeline: { display: 'grid', gap: 8 },
  assetTimelineRow: { display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 8, alignItems: 'start' },
  assetTimelineDot: { width: 9, height: 9, borderRadius: 999, background: 'var(--accent)', marginTop: 5, boxShadow: '0 0 0 4px rgba(20,131,79,0.12)' },
  assetTimelineBody: { display: 'grid', gap: 2, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-glass)', padding: 8, minWidth: 0, fontSize: 12, color: 'var(--text-sub)' },
  invoiceBox: { border: '1px solid var(--border)', borderRadius: 8, padding: 9, background: 'var(--surface-field)', display: 'flex', flexDirection: 'column', gap: 8 },
  invoiceTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 900, color: 'var(--text-sub)' },
  invoiceGhostBtn: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-glass)', color: 'var(--text-muted)', cursor: 'pointer', padding: '5px 8px', fontSize: 11, fontWeight: 800 },
  invoiceForm: { display: 'grid', gridTemplateColumns: '1fr 0.7fr auto', gap: 6, alignItems: 'center' },
  partForm: { display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 72px 86px auto', gap: 6, alignItems: 'center' },
  reservationForm: { display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 130px 130px auto auto', gap: 7, alignItems: 'center', marginBottom: 8 },
  reservationWarning: { border: '1px solid rgba(226,68,92,0.35)', borderRadius: 8, background: 'rgba(226,68,92,0.08)', color: 'var(--danger)', padding: 9, fontSize: 12, fontWeight: 900, marginBottom: 8 },
  reservationList: { display: 'grid', gap: 7 },
  reservationRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-glass)', padding: 8, minWidth: 0 },
  reservationMain: { display: 'grid', gap: 2, minWidth: 0, fontSize: 12, color: 'var(--text-sub)' },
  reservationActions: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  protocolSummary: { gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(140px, auto) auto', gap: 8, alignItems: 'center', border: '1px solid rgba(20,131,79,0.18)', borderRadius: 8, background: 'rgba(20,131,79,0.06)', color: 'var(--text-sub)', padding: '7px 9px', fontSize: 12, minWidth: 0 },
  protocolBox: { gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', padding: 9, display: 'grid', gap: 8, minWidth: 0 },
  protocolTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-sub)', flexWrap: 'wrap' },
  protocolForm: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 7, alignItems: 'center' },
  protocolNote: { width: '100%', minHeight: 58, resize: 'vertical', boxSizing: 'border-box', padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text)', fontSize: 12 },
  protocolActions: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: 12, fontWeight: 800 },
  protocolHistory: { display: 'grid', gap: 5, borderTop: '1px solid var(--border)', paddingTop: 7 },
  protocolHistoryRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(120px, auto) auto', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-sub)' },
  invoiceInput: { minWidth: 0, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', color: 'var(--text)', fontSize: 12 },
  invoiceUploadBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, whiteSpace: 'nowrap', padding: '7px 9px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.3)', background: 'rgba(20,131,79,0.1)', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  invoiceLinks: { display: 'flex', flexDirection: 'column', gap: 4 },
  invoiceLinkRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center', minWidth: 0 },
  partLinkRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center', minWidth: 0 },
  invoiceLink: { color: 'var(--accent)', fontSize: 12, fontWeight: 800, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  invoiceDeleteBtn: { border: '1px solid rgba(226,68,92,0.28)', borderRadius: 7, background: 'rgba(226,68,92,0.08)', color: 'var(--danger)', cursor: 'pointer', padding: '4px 7px', fontSize: 11, fontWeight: 900 },
  repairFilterBar: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)', padding: 8 },
  repairFilterBtn: { border: '1px solid var(--border)', borderRadius: 999, background: 'var(--surface-glass)', color: 'var(--text-sub)', cursor: 'pointer', padding: '6px 10px', fontSize: 12, fontWeight: 850 },
  repairFilterBtnActive: { border: '1px solid rgba(20,131,79,0.38)', background: 'rgba(20,131,79,0.12)', color: 'var(--accent)' },
  repairFilterExportBtn: { marginLeft: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-glass)', color: 'var(--text)', cursor: 'pointer', padding: '6px 10px', fontSize: 12, fontWeight: 900 },
};
