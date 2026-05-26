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

  const handleAddPojazd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.post(`/flota/pojazdy`, {
        ...formPojazd,
        marka: formPojazd.marka.trim(),
        model: formPojazd.model.trim(),
        nr_rejestracyjny: formPojazd.nr_rejestracyjny.trim().toUpperCase(),
        notatki: formPojazd.notatki.trim(),
        oddzial_id: formPojazd.oddzial_id || currentUser?.oddzial_id
      }, { headers: authHeaders(token) });
      showMsg(successMessage(t('pages.flota.toastVehicleAdded')));
      setShowForm(false);
      setFormPojazd({ marka: '', model: '', nr_rejestracyjny: '', rok_produkcji: '', typ: 'Samochód', ekipa_id: '', data_przegladu: '', data_ubezpieczenia: '', przebieg: '', notatki: '', oddzial_id: '' });
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
      await api.post(`/flota/sprzet`, {
        ...formSprzet,
        nazwa: formSprzet.nazwa.trim(),
        nr_seryjny: formSprzet.nr_seryjny.trim(),
        notatki: formSprzet.notatki.trim(),
        oddzial_id: formSprzet.oddzial_id || currentUser?.oddzial_id
      }, { headers: authHeaders(token) });
      showMsg(successMessage(t('pages.flota.toastEquipmentAdded')));
      setShowForm(false);
      setFormSprzet({ nazwa: '', typ: 'Piłarka', nr_seryjny: '', rok_produkcji: '', ekipa_id: '', data_przegladu: '', koszt_motogodziny: '', notatki: '', oddzial_id: '' });
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

  const fmt = (d) => d ? d.split('T')[0] : '-';
  const isExpired = (d) => d && new Date(d) < new Date();

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

  const kpiItems = useMemo(() => ([
    { key: 'veh',   label: t('pages.flota.kpiVehicles'),  value: filtrPojazdy.length, color: '#579bfc' },
    { key: 'eq',    label: t('pages.flota.kpiEquipment'), value: filtrSprzet.length,  color: '#579bfc' },
    { key: 'avail', label: t('pages.flota.kpiAvailable'), value: [...filtrPojazdy, ...filtrSprzet].filter(x => x.status === 'Dostępny').length, color: '#00c875' },
    { key: 'rep',   label: t('pages.flota.kpiInRepair'),  value: naprawy.length,       color: '#e2445c' },
  ]), [t, filtrPojazdy, filtrSprzet, naprawy.length]);

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
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
      <Sidebar />
      <main className="app-main" style={{ flex: 1, padding: 28, overflowX: 'hidden' }}>

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
                  onClick={() => setShowForm(!showForm)}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 0, marginBottom: 24, border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)' }}>
          {kpiItems.map((k, i, arr) => (
            <div key={k.key} style={{
              background: 'var(--surface-field)', padding: '14px 16px',
              borderLeft: `3px solid ${k.color}`,
              borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0, fontWeight: 600 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
          {tabDefs.map((tab) => (
            <button key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
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
          <div style={S.formBox}>
            <h3 style={S.formTitle}>{t('pages.flota.newVehicleTitle')}</h3>
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
                <button type="button" style={S.cancelBtn} onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isPojazdFormValid}>{saving ? t('common.saving') : t('pages.flota.addVehicle')}</button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz sprzętu */}
        {showForm && canEdit && activeTab === 'sprzet' && (
          <div style={S.formBox}>
            <h3 style={S.formTitle}>{t('pages.flota.newEquipmentTitle')}</h3>
            <form onSubmit={handleAddSprzet}>
              <div style={S.grid}>
                <Field label={t('pages.flota.fieldName')}><input style={S.input} value={formSprzet.nazwa} onChange={e => setFormSprzet({ ...formSprzet, nazwa: e.target.value })} required placeholder="np. Piłarka Husqvarna 572XP" /></Field>
                <Field label={t('pages.flota.fieldType')}>
                  <select style={S.input} value={formSprzet.typ} onChange={e => setFormSprzet({ ...formSprzet, typ: e.target.value })}>
                    {['Piłarka', 'Rębak', 'Podnośnik', 'Narzędzie', 'Inne'].map((typOption) => <option key={typOption} value={typOption}>{typOption}</option>)}
                  </select>
                </Field>
                <Field label={t('pages.flota.fieldSerial')}><input style={S.input} value={formSprzet.nr_seryjny} onChange={e => setFormSprzet({ ...formSprzet, nr_seryjny: e.target.value })} /></Field>
                <Field label={t('pages.flota.fieldYear')}><input style={S.input} type="number" value={formSprzet.rok_produkcji} onChange={e => setFormSprzet({ ...formSprzet, rok_produkcji: e.target.value })} /></Field>
                <Field label={t('pages.flota.fieldInspection')}><input style={S.input} type="date" value={formSprzet.data_przegladu} onChange={e => setFormSprzet({ ...formSprzet, data_przegladu: e.target.value })} /></Field>
                <Field label={t('pages.flota.fieldMotohour')}><input style={S.input} type="number" step="0.5" value={formSprzet.koszt_motogodziny} onChange={e => setFormSprzet({ ...formSprzet, koszt_motogodziny: e.target.value })} placeholder="np. 25" /></Field>
                <Field label={t('pages.flota.fieldTeam')}>
                  <select style={S.input} value={formSprzet.ekipa_id} onChange={e => setFormSprzet({ ...formSprzet, ekipa_id: e.target.value })}>
                    <option value="">{t('common.noneShort')}</option>
                    {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                  </select>
                </Field>
                {isDyrektor && (
                  <Field label={t('pages.flota.fieldBranch')}>
                    <select style={S.input} value={formSprzet.oddzial_id} onChange={e => setFormSprzet({ ...formSprzet, oddzial_id: e.target.value })}>
                      <option value="">{t('common.choose')}</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <div style={S.btnRow}>
                <button type="button" style={S.cancelBtn} onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isSprzetFormValid}>{saving ? t('common.saving') : t('pages.flota.addEquipment')}</button>
              </div>
            </form>
          </div>
        )}

        {/* ===== POJAZDY ===== */}
        {activeTab === 'pojazdy' && (
          loading ? <LoadingBox text={t('pages.flota.loadingFleet')} /> : filtrPojazdy.length === 0 ? (
            <EmptyBox icon={<DirectionsCarOutlined sx={{ fontSize: 48, opacity: 0.55 }} />} text={t('pages.flota.emptyVehicles')} sub={canEdit ? t('pages.flota.emptyVehiclesHint') : ''} />
          ) : (
            <div style={{ border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)' }}>
              {filtrPojazdy.map((p, i, arr) => (
                <div key={p.id} style={{
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
            <div style={{ border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-glass)', boxShadow: 'var(--shadow-md)' }}>
              {filtrSprzet.map((s, i, arr) => (
                <div key={s.id} style={{
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
            <div style={S.repairsWrap}>
              <div style={S.repairsHeader}>
                {(repairHeaders.length ? repairHeaders : ['Typ', 'Zasób', 'Data', 'Koszt', 'Usterka', 'Wykonawca', 'Status']).slice(0, 7).map((h) => (
                  <span key={h} style={S.repairsHeaderChip}>{h}</span>
                ))}
              </div>
              <div style={S.repairsGrid}>
                {naprawy.map((n) => (
                  <div key={n.id} style={S.repairCard}>
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

function LoadingBox({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <AutorenewOutlined sx={{ fontSize: 40, color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
      </div>
      <p>{text}</p>
    </div>
  );
}

function EmptyBox({ icon, text, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)' }}>
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
