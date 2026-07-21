import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import DriveEtaOutlined from '@mui/icons-material/DriveEtaOutlined';
import LocalPhoneOutlined from '@mui/icons-material/LocalPhoneOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import SupervisorAccountOutlined from '@mui/icons-material/SupervisorAccountOutlined';
import PageHeader from '../components/PageHeader';
import CommandSidebar from '../components/CommandSidebar';
import StatusMessage from '../components/StatusMessage';
import CityInput from '../components/CityInput';
import { Button } from '../components/ui/Button';
import { ArrowRight, Car, Pencil, Plus, Save, Shuffle, Trash2, X } from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getStoredToken, authHeaders } from '../utils/storedToken';


export default function Oddzialy() {
  const { t } = useTranslation();
  const [oddzialy, setOddzialy] = useState([]);
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [delegacje, setDelegacje] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showDelegacja, setShowDelegacja] = useState(false);
  const [showPrzenies, setShowPrzenies] = useState(false);
  const [editOddzial, setEditOddzial] = useState(null);
  const [saving, setSaving] = useState(false);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [activeTab, setActiveTab] = useState('oddzialy');
  const [currentUser, setCurrentUser] = useState(null);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    nazwa: '', adres: '', miasto: '', kod_pocztowy: '',
    telefon: '', email: '', kierownik_id: ''
  });
  const [formDelegacja, setFormDelegacja] = useState({
    zasob_typ: 'ekipa', ekipa_id: '', user_id: '', oddzial_z: '', oddzial_do: '',
    data_od: '', data_do: '', cel: '', uwagi: ''
  });
  const [formPrzenies, setFormPrzenies] = useState({ user_id: '', oddzial_id: '' });

  const loadAll = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [oRes, uRes, eRes, dRes] = await Promise.all([
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/uzytkownicy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/oddzialy/delegacje/wszystkie`, { headers: h }).catch(() => ({ data: [] })),
      ]);
      setOddzialy(oRes.data);
      setUzytkownicy(uRes.data);
      setEkipy(eRes.data);
      setDelegacje(dRes.data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadAll();
  }, [navigate, loadAll]);

  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      if (editOddzial) {
        await api.put(`/oddzialy/${editOddzial.id}`, {
          ...form,
          nazwa: form.nazwa.trim(),
          miasto: form.miasto.trim(),
          adres: form.adres.trim(),
          kod_pocztowy: form.kod_pocztowy.trim(),
          telefon: form.telefon.trim(),
          email: form.email.trim(),
        }, { headers: h });
        showMsg(successMessage('Oddział zaktualizowany!'));
      } else {
        await api.post(`/oddzialy`, {
          ...form,
          nazwa: form.nazwa.trim(),
          miasto: form.miasto.trim(),
          adres: form.adres.trim(),
          kod_pocztowy: form.kod_pocztowy.trim(),
          telefon: form.telefon.trim(),
          email: form.email.trim(),
        }, { headers: h });
        showMsg(successMessage('Oddział utworzony!'));
      }
      setShowForm(false);
      setEditOddzial(null);
      setForm({ nazwa: '', adres: '', miasto: '', kod_pocztowy: '', telefon: '', email: '', kierownik_id: '' });
      loadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (o) => {
    setEditOddzial(o);
    setForm({ nazwa: o.nazwa || '', adres: o.adres || '', miasto: o.miasto || '', kod_pocztowy: o.kod_pocztowy || '', telefon: o.telefon || '', email: o.email || '', kierownik_id: o.kierownik_id || '' });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Usunąć oddział?')) return;
    try {
      const token = getStoredToken();
      await api.delete(`/oddzialy/${id}`, { headers: authHeaders(token) });
      showMsg(successMessage('Oddział usunięty!'));
      loadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    }
  };

  const handleDelegacja = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.post(`/oddzialy/delegacje`, {
        ...formDelegacja,
        cel: formDelegacja.cel.trim(),
        uwagi: formDelegacja.uwagi.trim(),
      }, { headers: authHeaders(token) });
      showMsg(successMessage('Delegacja dodana!'));
      setShowDelegacja(false);
      setFormDelegacja({ zasob_typ: 'ekipa', ekipa_id: '', user_id: '', oddzial_z: '', oddzial_do: '', data_od: '', data_do: '', cel: '', uwagi: '' });
      loadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const handlePrzenies = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/oddzialy/pracownik/${formPrzenies.user_id}/przenies`, { oddzial_id: formPrzenies.oddzial_id }, { headers: authHeaders(token) });
      showMsg(successMessage('Pracownik przeniesiony!'));
      setShowPrzenies(false);
      setFormPrzenies({ user_id: '', oddzial_id: '' });
      loadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const zmienStatusDelegacji = async (id, status) => {
    try {
      const token = getStoredToken();
      await api.put(`/oddzialy/delegacje/${id}/status`, { status }, { headers: authHeaders(token) });
      loadAll();
    } catch (err) { console.error(err); }
  };

  const STATUS_DELEGACJI_KOLOR = {
    Planowana: '#766440', W_trakcie: '#bd701e',
    Zakonczona: '#7f8c12', Anulowana: '#c0492f'
  };

  const isEstimatorRole = (rola) => String(rola || '').toLowerCase().includes('wyceniaj');
  const wyceniajacy = uzytkownicy.filter((u) => isEstimatorRole(u.rola));
  const oddzialName = (id) => oddzialy.find((o) => String(o.id) === String(id))?.nazwa || 'brak';
  const handleDelegacjaType = (type) => {
    setFormDelegacja((prev) => ({
      ...prev,
      zasob_typ: type,
      ekipa_id: '',
      user_id: '',
      oddzial_z: '',
    }));
  };
  const handleDelegacjaResource = (id) => {
    const source =
      formDelegacja.zasob_typ === 'wyceniajacy'
        ? wyceniajacy.find((u) => String(u.id) === String(id))
        : ekipy.find((e) => String(e.id) === String(id));
    setFormDelegacja((prev) => ({
      ...prev,
      ekipa_id: prev.zasob_typ === 'ekipa' ? id : '',
      user_id: prev.zasob_typ === 'wyceniajacy' ? id : '',
      oddzial_z: source?.oddzial_id ? String(source.oddzial_id) : '',
    }));
  };

  const kierownicy = uzytkownicy.filter(u => u.rola === 'Kierownik' || u.rola === 'Dyrektor');
  const isOddzialFormValid = Boolean(form.nazwa.trim() && form.miasto.trim());
  const isDelegacjaFormValid = Boolean(
    (formDelegacja.zasob_typ === 'wyceniajacy' ? formDelegacja.user_id : formDelegacja.ekipa_id) &&
    formDelegacja.oddzial_z &&
    formDelegacja.oddzial_do &&
    formDelegacja.oddzial_z !== formDelegacja.oddzial_do &&
    formDelegacja.data_od &&
    formDelegacja.cel.trim()
  );
  const isPrzeniesFormValid = Boolean(formPrzenies.user_id && formPrzenies.oddzial_id);

  return (
    <div className="branches-shell" style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <CommandSidebar active="profile" />
      <div className="branches-main" style={{ flex: 1, padding: 28, overflowX: 'hidden' }}>

        <PageHeader
          variant="hero"
          title={t('pages.oddzialy.title')}
          subtitle={t('pages.oddzialy.summary', { count: oddzialy.length })}
          icon={<BusinessOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} />
              {isDyrektor && (
                <>
                  <Button variant="warning" leftIcon={Car} onClick={() => setShowDelegacja(!showDelegacja)}>
                    {t('pages.oddzialy.delegation')}
                  </Button>
                  <Button variant="outline" leftIcon={Shuffle} onClick={() => setShowPrzenies(!showPrzenies)}>
                    {t('pages.oddzialy.transfer')}
                  </Button>
                  <Button
                    leftIcon={showForm ? X : Plus}
                    onClick={() => {
                      setEditOddzial(null);
                      setForm({ nazwa: '', adres: '', miasto: '', kod_pocztowy: '', telefon: '', email: '', kierownik_id: '' });
                      setShowForm(!showForm);
                    }}
                  >
                    {showForm ? t('common.cancel') : `+ ${t('pages.oddzialy.newBranch')}`}
                  </Button>
                </>
              )}
            </>
          }
        />

        {/* Tabs */}
        <div className="branches-tabs" style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--glass-border)' }}>
          {[
            { key: 'oddzialy', label: t('pages.oddzialy.tabBranches', { count: oddzialy.length }) },
            { key: 'delegacje', label: t('pages.oddzialy.tabDelegations', { count: delegacje.length }) },
          ].map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? 'primary' : 'ghost'}
              size="sm"
              style={{ padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: activeTab === tab.key ? 'var(--accent)' : '#8a8069', borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Formularz oddziału */}
        {showForm && isDyrektor && (
          <div className="branches-form-panel" style={S.formBox}>
            <h3 style={S.formTitle}>{editOddzial ? t('pages.oddzialy.formEditTitle') : t('pages.oddzialy.formNewTitle')}</h3>
            <form onSubmit={handleSubmit}>
              <div style={S.grid}>
                <Field label="Nazwa oddziału *"><input style={S.input} value={form.nazwa} onChange={e => setForm({ ...form, nazwa: e.target.value })} required placeholder="np. Oddział Kraków" /></Field>
                <Field label="Miasto *">
                  <CityInput
                    style={S.input}
                    value={form.miasto}
                    onChange={e => setForm({ ...form, miasto: e.target.value })}
                    required
                    extraCities={oddzialy.map((o) => o.miasto)}
                  />
                </Field>
                <Field label="Adres"><input style={S.input} value={form.adres} onChange={e => setForm({ ...form, adres: e.target.value })} /></Field>
                <Field label="Kod pocztowy"><input style={S.input} value={form.kod_pocztowy} onChange={e => setForm({ ...form, kod_pocztowy: e.target.value })} /></Field>
                <Field label="Telefon"><input style={S.input} value={form.telefon} onChange={e => setForm({ ...form, telefon: e.target.value })} /></Field>
                <Field label="Email"><input style={S.input} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Kierownik">
                  <select style={S.input} value={form.kierownik_id} onChange={e => setForm({ ...form, kierownik_id: e.target.value })}>
                    <option value="">-- brak --</option>
                    {kierownicy.map(u => <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({getRoleDisplayName(u.rola)})</option>)}
                  </select>
                </Field>
              </div>
              <div style={S.btnRow}>
                <Button variant="outline" onClick={() => { setShowForm(false); setEditOddzial(null); }}>Anuluj</Button>
                <Button type="submit" loading={saving} disabled={!isOddzialFormValid} leftIcon={Save}>{editOddzial ? t('pages.oddzialy.submitSave') : t('pages.oddzialy.submitCreate')}</Button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz delegacji */}
        {showDelegacja && isDyrektor && (
          <div className="branches-form-panel branches-delegation-form" style={S.formBox}>
            <h3 style={S.formTitle}>{t('pages.oddzialy.newDelegationTitle')}</h3>
            <form onSubmit={handleDelegacja}>
              <div style={S.grid}>
                <Field label="Typ zasobu *">
                  <select style={S.input} value={formDelegacja.zasob_typ} onChange={e => handleDelegacjaType(e.target.value)} required>
                    <option value="ekipa">Ekipa</option>
                    <option value="wyceniajacy">Specjalista ds. wyceny</option>
                  </select>
                </Field>
                {formDelegacja.zasob_typ === 'ekipa' && (
                <Field label="Ekipa *">
                  <select style={S.input} value={formDelegacja.ekipa_id} onChange={e => handleDelegacjaResource(e.target.value)} required>
                    <option value="">-- wybierz ekipę --</option>
                    {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa} ({oddzialName(e.oddzial_id)})</option>)}
                  </select>
                </Field>
                )}
                {formDelegacja.zasob_typ === 'wyceniajacy' && (
                  <Field label="Specjalista ds. wyceny *">
                    <select style={S.input} value={formDelegacja.user_id} onChange={e => handleDelegacjaResource(e.target.value)} required>
                      <option value="">-- wybierz --</option>
                      {wyceniajacy.map(u => <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({oddzialName(u.oddzial_id)})</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Cel *"><input style={S.input} value={formDelegacja.cel} onChange={e => setFormDelegacja({ ...formDelegacja, cel: e.target.value })} required placeholder="np. Wycinka w Rzeszowie" /></Field>
                <Field label="Z oddziału *">
                  <select style={S.input} value={formDelegacja.oddzial_z} onChange={e => setFormDelegacja({ ...formDelegacja, oddzial_z: e.target.value })} required>
                    <option value="">-- wybierz --</option>
                    {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                  </select>
                </Field>
                <Field label="Do oddziału *">
                  <select style={S.input} value={formDelegacja.oddzial_do} onChange={e => setFormDelegacja({ ...formDelegacja, oddzial_do: e.target.value })} required>
                    <option value="">-- wybierz --</option>
                    {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                  </select>
                </Field>
                <Field label="Data od *"><input style={S.input} type="date" value={formDelegacja.data_od} onChange={e => setFormDelegacja({ ...formDelegacja, data_od: e.target.value })} required /></Field>
                <Field label="Data do"><input style={S.input} type="date" value={formDelegacja.data_do} onChange={e => setFormDelegacja({ ...formDelegacja, data_do: e.target.value })} /></Field>
              </div>
              <Field label="Uwagi"><textarea style={{ ...S.input, height: 60 }} value={formDelegacja.uwagi} onChange={e => setFormDelegacja({ ...formDelegacja, uwagi: e.target.value })} /></Field>
              <div style={S.btnRow}>
                <Button variant="outline" onClick={() => setShowDelegacja(false)}>Anuluj</Button>
                <Button type="submit" loading={saving} disabled={!isDelegacjaFormValid} leftIcon={Save}>{t('pages.oddzialy.submitDelegation')}</Button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz przeniesienia */}
        {showPrzenies && isDyrektor && (
          <div className="branches-form-panel branches-transfer-form" style={S.formBox}>
            <h3 style={S.formTitle}>{t('pages.oddzialy.transferFormTitle')}</h3>
            <form onSubmit={handlePrzenies}>
              <div style={S.grid}>
                <Field label="Pracownik *">
                  <select style={S.input} value={formPrzenies.user_id} onChange={e => setFormPrzenies({ ...formPrzenies, user_id: e.target.value })} required>
                    <option value="">-- wybierz --</option>
                    {uzytkownicy.map(u => <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({getRoleDisplayName(u.rola)}) — {oddzialy.find(o => o.id === u.oddzial_id)?.nazwa || 'brak'}</option>)}
                  </select>
                </Field>
                <Field label="Do oddziału *">
                  <select style={S.input} value={formPrzenies.oddzial_id} onChange={e => setFormPrzenies({ ...formPrzenies, oddzial_id: e.target.value })} required>
                    <option value="">-- wybierz --</option>
                    {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa} ({o.miasto})</option>)}
                  </select>
                </Field>
              </div>
              <div style={S.btnRow}>
                <Button variant="outline" onClick={() => setShowPrzenies(false)}>Anuluj</Button>
                <Button type="submit" loading={saving} disabled={!isPrzeniesFormValid} leftIcon={Save}>{t('pages.oddzialy.submitTransfer')}</Button>
              </div>
            </form>
          </div>
        )}

        {/* TAB: Oddziały */}
        {activeTab === 'oddzialy' && (
          <div className="branches-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {oddzialy.length === 0 ? (
              <div className="branches-empty" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', gridColumn: '1/-1' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <BusinessOutlined sx={{ fontSize: 48, opacity: 0.45 }} />
                </div>
                <p>{t('pages.oddzialy.emptyBranches')}</p>
              </div>
            ) : oddzialy.map((o, i) => (
              <div className="branches-card" key={o.id} style={{
                background: 'var(--surface-glass)', borderRadius: 8, padding: 20,
                boxShadow: 'var(--shadow-md)',
                border: '1px solid var(--glass-border)',
                animation: `bounceIn 0.4s ease ${i * 0.06}s forwards`, opacity: 0,
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(56,142,60,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <BusinessOutlined sx={{ fontSize: 36, color: 'var(--accent)', opacity: 0.85 }} />
                  {isDyrektor && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => handleEdit(o)} aria-label={t('common.edit')} style={{ minHeight: 32, padding: '6px 9px' }} />
                      <Button size="sm" variant="danger" leftIcon={Trash2} onClick={() => handleDelete(o.id)} aria-label={t('common.delete')} style={{ minHeight: 32, padding: '6px 9px' }} />
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 4 }}>{o.nazwa}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PlaceOutlined sx={{ fontSize: 16, flexShrink: 0 }} />
                  {o.miasto}
                </div>
                {o.kierownik_imie && (
                  <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SupervisorAccountOutlined sx={{ fontSize: 16, flexShrink: 0 }} />
                    {o.kierownik_imie} {o.kierownik_nazwisko}
                  </div>
                )}
                {o.telefon && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <LocalPhoneOutlined sx={{ fontSize: 16, flexShrink: 0 }} />
                    {o.telefon}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-around', margin: '12px 0', padding: '10px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--accent)' }}>{o.liczba_ekip || 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ekipy</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--accent)' }}>{o.liczba_pracownikow || 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pracownicy</div>
                  </div>
                </div>
                <Button
                  fullWidth
                  variant="outline"
                  rightIcon={ArrowRight}
                  onClick={() => navigate(`/oddzialy/${o.id}`)}
                >
                  {t('pages.oddzialy.seeDetails')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* TAB: Delegacje */}
        {activeTab === 'delegacje' && (
          <div className="branches-delegations-wrap" style={S.delegacjeWrap}>
            {delegacje.length === 0 ? (
              <div className="branches-empty" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', backgroundColor: 'var(--surface-glass)', borderRadius: 8, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <DriveEtaOutlined sx={{ fontSize: 48, opacity: 0.45 }} />
                </div>
                <p>{t('pages.oddzialy.emptyDelegations')}</p>
              </div>
            ) : (
              <div className="branches-delegations-grid" style={S.delegacjeGrid}>
                {delegacje.map((d) => (
                  <div className="branches-delegation-card" key={d.id} style={S.delegacjaCard}>
                    <div style={S.delegacjaTop}>
                      <strong style={{ fontSize: 14, color: 'var(--text)' }}>
                        {d.zasob_nazwa || d.ekipa_nazwa || d.user_nazwa || '-'}
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                          {d.zasob_typ === 'wyceniajacy' ? 'Specjalista ds. wyceny' : 'Ekipa'}
                        </span>
                      </strong>
                      <span style={{ ...S.delegacjaStatus, backgroundColor: STATUS_DELEGACJI_KOLOR[d.status] || '#8a8069' }}>
                        {d.status}
                      </span>
                    </div>
                    <div style={S.delegacjaMetaRow}>
                      <span style={S.delegacjaMetaLabel}>Z oddziału</span>
                      <span style={S.delegacjaMetaValue}>{d.oddzial_z_nazwy || '-'}</span>
                    </div>
                    <div style={S.delegacjaMetaRow}>
                      <span style={S.delegacjaMetaLabel}>Do oddziału</span>
                      <span style={S.delegacjaMetaValue}>{d.oddzial_do_nazwy || '-'}</span>
                    </div>
                    <div style={S.delegacjaMetaRow}>
                      <span style={S.delegacjaMetaLabel}>Cel</span>
                      <span style={S.delegacjaMetaValue}>{d.cel || '-'}</span>
                    </div>
                    <div style={S.delegacjaDates}>
                      <div style={S.delegacjaDateBox}>
                        <div style={S.delegacjaDateLabel}>Data od</div>
                        <div style={S.delegacjaDateValue}>{d.data_od?.split('T')[0] || '-'}</div>
                      </div>
                      <div style={S.delegacjaDateBox}>
                        <div style={S.delegacjaDateLabel}>Data do</div>
                        <div style={S.delegacjaDateValue}>{d.data_do?.split('T')[0] || '-'}</div>
                      </div>
                    </div>
                    <div style={S.delegacjaActionRow}>
                      <select
                        style={S.delegacjaSelect}
                        value={d.status}
                        onChange={e => zmienStatusDelegacji(d.id, e.target.value)}
                      >
                        <option value="Planowana">Planowana</option>
                        <option value="W_trakcie">W trakcie</option>
                        <option value="Zakonczona">Zakończona</option>
                        <option value="Anulowana">Anulowana</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
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
  headerBtn: (bg, color = '#fff') => ({ padding: '10px 18px', backgroundColor: bg, color, border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold' }),
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  editBtn: { padding: '4px 10px', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  deleteBtn: { padding: '4px 10px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#c0492f', border: '1px solid #f6e0d9', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  formBox: { background: 'var(--surface-glass)', borderRadius: 8, padding: 24, marginBottom: 20, boxShadow: 'var(--shadow-md)', border: '1px solid var(--glass-border)' },
  formTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 8 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  cancelBtn: { padding: '9px 18px', backgroundColor: 'var(--surface-field)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  submitBtn: { padding: '9px 18px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.22)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' },
  delegacjeWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  delegacjeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
  delegacjaCard: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-md)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  delegacjaTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  delegacjaStatus: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: 700 },
  delegacjaMetaRow: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  delegacjaMetaLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0, fontWeight: 700 },
  delegacjaMetaValue: { fontSize: 12, color: 'var(--text-sub)', textAlign: 'right', fontWeight: 600 },
  delegacjaDates: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 2 },
  delegacjaDateBox: { background: 'var(--surface-field)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' },
  delegacjaDateLabel: { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0 },
  delegacjaDateValue: { fontSize: 12, color: 'var(--text)', fontWeight: 700, marginTop: 2 },
  delegacjaActionRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 4 },
  delegacjaSelect: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 12, cursor: 'pointer', minWidth: 140 },
};
