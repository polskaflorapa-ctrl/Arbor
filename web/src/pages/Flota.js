import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
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
    return { key: kind.key, state: 'expired', label: `${kind.label} po terminie`, detail: `${Math.abs(health.days)} dni po terminie`, color: '#e2445c' };
  }
  if (health.state === 'soon') {
    return { key: kind.key, state: 'soon', label: `${kind.label} za ${health.days} dni`, detail: fmtDate(value), color: '#fdab3d' };
  }
  if (health.state === 'missing') {
    return { key: kind.key, state: 'missing', label: `Brak daty: ${kind.label}`, detail: 'uzupelnij karte', color: '#676879' };
  }
  return { key: kind.key, state: 'ok', label: `${kind.label} OK`, detail: fmtDate(value), color: '#00c875' };
}

function priorityWeight(state) {
  if (state === 'expired') return 0;
  if (state === 'soon') return 1;
  if (state === 'missing') return 2;
  return 3;
}


export default function Flota() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
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

  const [formPojazd, setFormPojazd] = useState({
    marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '',
    typ: 'Samochód', ekipa_id: '', data_przegladu: '',
    data_ubezpieczenia: '', przebieg: '', notatki: '', oddzial_id: ''
  });

  const [formSprzet, setFormSprzet] = useState({
    nazwa: '', typ: 'Piłarka', nr_seryjny: '', rok_produkcji: '',
    ekipa_id: '', data_przegladu: '', koszt_motogodziny: '',
    notatki: '', oddzial_id: ''
  });

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
      if (!['Prezes', 'Dyrektor'].includes(parsed.rola)) {
        setFiltrOddzial(parsed.oddzial_id?.toString() || '');
      }
    }
    loadAll();
  }, [navigate, loadAll]);

  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const canEdit = isDyrektor || currentUser?.rola === 'Kierownik';

  const resetPojazdForm = () => {
    setEditingPojazdId(null);
    setFormPojazd({ marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '', typ: 'Samochód', ekipa_id: '', data_przegladu: '', data_ubezpieczenia: '', przebieg: '', notatki: '', oddzial_id: '' });
  };

  const resetSprzetForm = () => {
    setEditingSprzetId(null);
    setFormSprzet({ nazwa: '', typ: 'Piłarka', nr_seryjny: '', rok_produkcji: '', ekipa_id: '', data_przegladu: '', koszt_motogodziny: '', notatki: '', oddzial_id: '' });
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
      typ: p.typ || 'Samochód',
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
      typ: s.typ || 'Piłarka',
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

  const fmt = fmtDate;
  const isExpired = (d) => dateHealth(d).state === 'expired';

  const STATUS_KOLOR = {
    'Dostępny':    '#00c875',
    'W użyciu':    '#fdab3d',
    'W naprawie':  '#e2445c',
    'Niedostępny': '#676879',
  };

  const fleetStatusLabel = (status) => t(`fleetStatus.${status}`, { defaultValue: status });
  const localeNum = i18n.language === 'uk' ? 'uk-UA' : i18n.language === 'ru' ? 'ru-RU' : 'pl-PL';
  const repairHeaders = useMemo(() => {
    const h = t('pages.flota.repairHeaders', { returnObjects: true });
    return Array.isArray(h) ? h : [];
  }, [t]);

  const filtrPojazdy = pojazdy.filter(p => !filtrOddzial || p.oddzial_id?.toString() === filtrOddzial);
  const filtrSprzet = sprzet.filter(s => !filtrOddzial || s.oddzial_id?.toString() === filtrOddzial);

  const resourceCards = useMemo(() => {
    const now = new Date();
    const vehicleCards = filtrPojazdy.map((p) => {
      const alerts = [
        dueAlert({ key: 'inspection', label: 'Przeglad' }, p.data_przegladu, now),
        dueAlert({ key: 'insurance', label: 'OC' }, p.data_ubezpieczenia, now),
      ];
      return {
        id: `vehicle-${p.id}`,
        itemId: p.id,
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
      const alerts = [
        dueAlert({ key: 'inspection', label: 'Przeglad' }, s.data_przegladu, now),
      ];
      if (s.next_reservation_from) {
        alerts.push({
          key: 'reservation',
          state: 'soon',
          label: `Rezerwacja ${fmtDate(s.next_reservation_from)}`,
          detail: [s.next_reservation_team, s.next_task_id ? `#${s.next_task_id}` : null, s.next_task_client].filter(Boolean).join(' / ') || fmtDate(s.next_reservation_to),
          color: '#579bfc',
        });
      }
      return {
        id: `equipment-${s.id}`,
        itemId: s.id,
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
  }, [filtrPojazdy, filtrSprzet, localeNum]);

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

  const openResourceCalendar = (card) => {
    const params = new URLSearchParams({ tab: 'equipment', modal: '0' });
    if (card.kind === 'equipment') params.set('equipment', String(card.itemId));
    if (filtrOddzial) params.set('branch', filtrOddzial);
    navigate(`/kalendarz-zasobow?${params.toString()}`);
  };

  const kpiItems = useMemo(() => ([
    { key: 'veh',   label: t('pages.flota.kpiVehicles'),  value: filtrPojazdy.length, color: '#579bfc' },
    { key: 'eq',    label: t('pages.flota.kpiEquipment'), value: filtrSprzet.length,  color: '#579bfc' },
    { key: 'alerts', label: 'Alerty zasobow', value: resourceAlertCount, color: resourceAlertCount ? '#e2445c' : '#00c875' },
    { key: 'overdue', label: 'Po terminie', value: overdueResourceCount, color: overdueResourceCount ? '#e2445c' : '#00c875' },
    { key: 'avail', label: t('pages.flota.kpiAvailable'), value: [...filtrPojazdy, ...filtrSprzet].filter(x => x.status === 'Dostępny').length, color: '#00c875' },
    { key: 'rep',   label: t('pages.flota.kpiInRepair'),  value: naprawy.length,       color: '#e2445c' },
  ]), [t, filtrPojazdy, filtrSprzet, naprawy.length, resourceAlertCount, overdueResourceCount]);

  const tabDefs = useMemo(() => ([
    { key: 'pojazdy', label: t('pages.flota.tabVehicles', { count: filtrPojazdy.length }) },
    { key: 'sprzet', label: t('pages.flota.tabEquipment', { count: filtrSprzet.length }) },
    { key: 'naprawy', label: t('pages.flota.tabRepairs', { count: naprawy.length }) },
  ]), [t, filtrPojazdy.length, filtrSprzet.length, naprawy.length]);
  const isPojazdFormValid = Boolean(
    formPojazd.marka.trim() &&
    formPojazd.model.trim() &&
    formPojazd.nr_rejestracyjny.trim()
  );
  const isSprzetFormValid = Boolean(formSprzet.nazwa.trim());

  return (
    <div className="app-shell fleet-shell" style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
      <Sidebar />
      <main className="app-main fleet-main" style={{ flex: 1, padding: 28, overflowX: 'hidden' }}>

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
                <button
                  type="button"
                  onClick={handleToggleForm}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none';
                  }}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--accent-gradient)',
                    color: 'var(--on-accent)',
                    border: '1px solid var(--accent)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 'bold',
                    transition: 'all 0.2s',
                  }}
                >
                  {showForm ? t('common.cancel') : `+ ${t('pages.flota.add')}`}
                </button>
              )}
            </>
          }
        />

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
          onOpenCalendar={openResourceCalendar}
        />

        {/* Tabs */}
        <div className="fleet-tabs" style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
          {tabDefs.map((tab) => (
            <button key={tab.key}
              type="button"
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
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -2, transition: 'all 0.2s',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Formularz pojazdu */}
        {showForm && canEdit && activeTab === 'pojazdy' && (
          <div className="fleet-form-panel" style={S.formBox}>
            <h3 style={S.formTitle}>{editingPojazdId ? 'Edytuj pojazd' : t('pages.flota.newVehicleTitle')}</h3>
            <form onSubmit={handleAddPojazd}>
              <div style={S.grid}>
                <Field label={t('pages.flota.fieldBrand')}><input style={S.input} value={formPojazd.marka} onChange={e => setFormPojazd({ ...formPojazd, marka: e.target.value })} required placeholder="np. Mercedes" /></Field>
                <Field label={t('pages.flota.fieldModel')}><input style={S.input} value={formPojazd.model} onChange={e => setFormPojazd({ ...formPojazd, model: e.target.value })} required placeholder="np. Sprinter" /></Field>
                <Field label={t('pages.flota.fieldReg')}><input style={S.input} value={formPojazd.nr_rejestracyjny} onChange={e => setFormPojazd({ ...formPojazd, nr_rejestracyjny: e.target.value })} required placeholder="np. KR12345" /></Field>
                <Field label={t('pages.flota.fieldYear')}><input style={S.input} type="number" value={formPojazd.rok_produkcji} onChange={e => setFormPojazd({ ...formPojazd, rok_produkcji: e.target.value })} placeholder="np. 2020" /></Field>
                <Field label={t('pages.flota.fieldType')}>
                  <select style={S.input} value={formPojazd.typ} onChange={e => setFormPojazd({ ...formPojazd, typ: e.target.value })}>
                    {['Samochód', 'Bus', 'Ciężarówka', 'Przyczepa', 'Maszyna'].map((typOption) => <option key={typOption} value={typOption}>{typOption}</option>)}
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
                <button type="button" style={S.cancelBtn} onClick={() => { setShowForm(false); resetPojazdForm(); }}>{t('common.cancel')}</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isPojazdFormValid}>{saving ? t('common.saving') : (editingPojazdId ? 'Zapisz pojazd' : t('pages.flota.addVehicle'))}</button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz sprzętu */}
        {showForm && canEdit && activeTab === 'sprzet' && (
          <div className="fleet-form-panel" style={S.formBox}>
            <h3 style={S.formTitle}>{editingSprzetId ? 'Edytuj sprzet' : t('pages.flota.newEquipmentTitle')}</h3>
            <form onSubmit={handleAddSprzet}>
              <div style={S.grid}>
                <Field label={t('pages.flota.fieldName')}><input style={S.input} value={formSprzet.nazwa} onChange={e => setFormSprzet((prev) => ({ ...prev, nazwa: e.target.value }))} required placeholder="np. Piłarka Husqvarna 572XP" /></Field>
                <Field label={t('pages.flota.fieldType')}>
                  <select style={S.input} value={formSprzet.typ} onChange={e => setFormSprzet((prev) => ({ ...prev, typ: e.target.value }))}>
                    {['Piłarka', 'Rębak', 'Podnośnik', 'Narzędzie', 'Inne'].map((typOption) => <option key={typOption} value={typOption}>{typOption}</option>)}
                  </select>
                </Field>
                <Field label={t('pages.flota.fieldSerial')}><input style={S.input} value={formSprzet.nr_seryjny} onChange={e => setFormSprzet((prev) => ({ ...prev, nr_seryjny: e.target.value }))} /></Field>
                <Field label={t('pages.flota.fieldYear')}><input style={S.input} type="number" value={formSprzet.rok_produkcji} onChange={e => setFormSprzet((prev) => ({ ...prev, rok_produkcji: e.target.value }))} /></Field>
                <Field label={t('pages.flota.fieldInspection')}><input style={S.input} type="date" value={formSprzet.data_przegladu} onChange={e => setFormSprzet((prev) => ({ ...prev, data_przegladu: e.target.value }))} /></Field>
                <Field label={t('pages.flota.fieldMotohour')}><input style={S.input} type="number" step="0.5" value={formSprzet.koszt_motogodziny} onChange={e => setFormSprzet((prev) => ({ ...prev, koszt_motogodziny: e.target.value }))} placeholder="np. 25" /></Field>
                <Field label={t('pages.flota.fieldTeam')}>
                  <select style={S.input} value={formSprzet.ekipa_id} onChange={e => setFormSprzet((prev) => ({ ...prev, ekipa_id: e.target.value }))}>
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
                <button type="button" style={S.cancelBtn} onClick={() => { setShowForm(false); resetSprzetForm(); }}>{t('common.cancel')}</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isSprzetFormValid}>{saving ? t('common.saving') : (editingSprzetId ? 'Zapisz sprzet' : t('pages.flota.addEquipment'))}</button>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                        <DirectionsCarOutlined sx={{ fontSize: 22, flexShrink: 0 }} />
                        {p.marka} {p.model}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{p.nr_rejestracyjny}</div>
                    </div>
                    <select
                      value={p.status || 'Dostępny'}
                      onChange={e => zmienStatus('pojazdy', p.id, e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: 8, border: `2px solid ${STATUS_KOLOR[p.status] || 'var(--text-muted)'}`, fontSize: 12, cursor: 'pointer', backgroundColor: 'var(--surface-field)', color: STATUS_KOLOR[p.status] || 'var(--text-muted)', fontWeight: '600' }}>
                      {Object.keys(STATUS_KOLOR).map((st) => <option key={st} value={st}>{fleetStatusLabel(st)}</option>)}
                    </select>
                    {canEdit && (
                      <div style={S.cardActions}>
                        <button type="button" style={S.ghostBtn} onClick={() => startEditPojazd(p)}>Edytuj</button>
                        <button type="button" style={S.dangerBtn} onClick={() => deleteFleetItem('pojazdy', p.id)}>Usun</button>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                        <HandymanOutlined sx={{ fontSize: 20, flexShrink: 0 }} />
                        {s.nazwa}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.typ}</div>
                    </div>
                    <select
                      value={s.status || 'Dostępny'}
                      onChange={e => zmienStatus('sprzet', s.id, e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: 8, border: `2px solid ${STATUS_KOLOR[s.status] || 'var(--text-muted)'}`, fontSize: 12, cursor: 'pointer', backgroundColor: 'var(--surface-field)', color: STATUS_KOLOR[s.status] || 'var(--text-muted)', fontWeight: '600' }}>
                      {Object.keys(STATUS_KOLOR).map((st) => <option key={st} value={st}>{fleetStatusLabel(st)}</option>)}
                    </select>
                    {canEdit && (
                      <div style={S.cardActions}>
                        <button type="button" style={S.ghostBtn} onClick={() => startEditSprzet(s)}>Edytuj</button>
                        <button type="button" style={S.dangerBtn} onClick={() => deleteFleetItem('sprzet', s.id)}>Usun</button>
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
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ===== NAPRAWY ===== */}
        {activeTab === 'naprawy' && (
          loading ? <LoadingBox text={t('pages.flota.loadingFleet')} /> : naprawy.length === 0 ? (
            <EmptyBox icon={<ConstructionOutlined sx={{ fontSize: 48, opacity: 0.55 }} />} text={t('pages.flota.emptyRepairs')} />
          ) : (
            <div className="fleet-repairs-wrap" style={S.repairsWrap}>
              <div className="fleet-repairs-header" style={S.repairsHeader}>
                {(repairHeaders.length ? repairHeaders : ['Typ', 'Zasób', 'Data', 'Koszt', 'Usterka', 'Wykonawca', 'Status']).slice(0, 7).map((h) => (
                  <span key={h} style={S.repairsHeaderChip}>{h}</span>
                ))}
              </div>
              <div className="fleet-repairs-grid" style={S.repairsGrid}>
                {naprawy.map((n) => (
                  <div className="fleet-repair-card" key={n.id} style={S.repairCard}>
                    <div style={S.repairTop}>
                      <span style={S.repairType}>{n.typ_zasobu}</span>
                      <span style={{ ...S.repairStatus, backgroundColor: n.status === 'Zakończona' ? '#166534' : '#b45309' }}>
                        {t(`fleetRepairStatus.${n.status}`, { defaultValue: n.status })}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Zasób</span>
                      <span style={S.repairValue}>ID: {n.zasob_id}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Data</span>
                      <span style={S.repairValue}>{fmt(n.data_naprawy)}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Koszt</span>
                      <span style={{ ...S.repairValue, color: 'var(--danger)', fontWeight: 700 }}>
                        {n.koszt ? `${parseFloat(n.koszt).toLocaleString('pl-PL')} PLN` : '-'}
                      </span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Usterka</span>
                      <span style={S.repairValue}>{n.opis_usterki || '-'}</span>
                    </div>
                    <div style={S.repairRow}>
                      <span style={S.repairLabel}>Wykonawca</span>
                      <span style={S.repairValue}>{n.wykonawca || '-'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
}

function ResourceCardsPanel({ cards, total, alertCount, onOpenCalendar }) {
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
                style={{ border: `1px solid ${worst.color}`, borderLeft: `4px solid ${worst.color}`, background: 'var(--surface-glass)', borderRadius: 8, padding: 12, boxShadow: 'var(--shadow-md)', minWidth: 0 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>{card.type}</div>
                    <h3 style={{ margin: '2px 0 0', fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.title}</h3>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{card.subtitle}</div>
                  </div>
                  <span style={{ border: `1px solid ${worst.color}`, color: worst.color, borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
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
                      style={{ border: `1px solid ${alert.color}`, color: alert.color, borderRadius: 8, padding: '4px 7px', fontSize: 11, fontWeight: 800 }}
                      title={alert.detail}
                    >
                      {alert.label}
                    </span>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenCalendar(card)}
                  style={{ marginTop: 12, width: '100%', border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontWeight: 700 }}
                >
                  Kalendarz zasobow
                </button>
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

const S = {
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  formBox: { background: 'var(--surface-glass)', borderRadius: 8, padding: 24, marginBottom: 20, boxShadow: 'var(--shadow-md)', border: '1px solid var(--glass-border)' },
  formTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 8 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  cancelBtn: { padding: '9px 18px', backgroundColor: 'var(--surface-field)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  submitBtn: { padding: '9px 18px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.22)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' },
  cardActions: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  ghostBtn: { padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  dangerBtn: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(226,68,92,0.35)', background: 'rgba(226,68,92,0.08)', color: 'var(--danger)', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  repairsWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
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
};
