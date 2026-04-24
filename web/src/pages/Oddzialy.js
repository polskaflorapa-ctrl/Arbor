import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import DriveEtaOutlined from '@mui/icons-material/DriveEtaOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LocalPhoneOutlined from '@mui/icons-material/LocalPhoneOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import SupervisorAccountOutlined from '@mui/icons-material/SupervisorAccountOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import CityInput from '../components/CityInput';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
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
    ekipa_id: '', oddzial_z: '', oddzial_do: '',
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
      console.log(err);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadAll();
  }, [navigate, loadAll]);

  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
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
      setFormDelegacja({ ekipa_id: '', oddzial_z: '', oddzial_do: '', data_od: '', data_do: '', cel: '', uwagi: '' });
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
    } catch (err) { console.log(err); }
  };

  const STATUS_DELEGACJI_KOLOR = {
    Planowana: '#3B82F6', W_trakcie: '#F9A825',
    Zakonczona: '#4CAF50', Anulowana: '#EF5350'
  };

  const kierownicy = uzytkownicy.filter(u => u.rola === 'Kierownik' || u.rola === 'Dyrektor');
  const isOddzialFormValid = Boolean(form.nazwa.trim() && form.miasto.trim());
  const isDelegacjaFormValid = Boolean(
    formDelegacja.ekipa_id &&
    formDelegacja.oddzial_z &&
    formDelegacja.oddzial_do &&
    formDelegacja.data_od &&
    formDelegacja.cel.trim()
  );
  const isPrzeniesFormValid = Boolean(formPrzenies.user_id && formPrzenies.oddzial_id);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: 28, overflowX: 'hidden' }}>

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
                  <button type="button" style={S.headerBtn('#F9A825')} onClick={() => setShowDelegacja(!showDelegacja)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <DriveEtaOutlined sx={{ fontSize: 18 }} />
                      {t('pages.oddzialy.delegation')}
                    </span>
                  </button>
                  <button type="button" style={S.headerBtn('#38bdf8')} onClick={() => setShowPrzenies(!showPrzenies)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <SwapHorizOutlined sx={{ fontSize: 18 }} />
                      {t('pages.oddzialy.transfer')}
                    </span>
                  </button>
                  <button
                    type="button"
                    style={S.headerBtn('var(--accent)', '#162032')}
                    onClick={() => {
                      setEditOddzial(null);
                      setForm({ nazwa: '', adres: '', miasto: '', kod_pocztowy: '', telefon: '', email: '', kierownik_id: '' });
                      setShowForm(!showForm);
                    }}
                  >
                    {showForm ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <CloseOutlined sx={{ fontSize: 18 }} />
                        {t('common.cancel')}
                      </span>
                    ) : (
                      `+ ${t('pages.oddzialy.newBranch')}`
                    )}
                  </button>
                </>
              )}
            </>
          }
        />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border2)' }}>
          {[
            { key: 'oddzialy', label: t('pages.oddzialy.tabBranches', { count: oddzialy.length }) },
            { key: 'delegacje', label: t('pages.oddzialy.tabDelegations', { count: delegacje.length }) },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              style={{ padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: activeTab === tab.key ? 'var(--accent)' : '#6B7280', borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Formularz oddziału */}
        {showForm && isDyrektor && (
          <div style={S.formBox}>
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
                    {kierownicy.map(u => <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({u.rola})</option>)}
                  </select>
                </Field>
              </div>
              <div style={S.btnRow}>
                <button type="button" style={S.cancelBtn} onClick={() => { setShowForm(false); setEditOddzial(null); }}>Anuluj</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isOddzialFormValid}>{saving ? t('common.saving') : editOddzial ? t('pages.oddzialy.submitSave') : t('pages.oddzialy.submitCreate')}</button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz delegacji */}
        {showDelegacja && isDyrektor && (
          <div style={S.formBox}>
            <h3 style={S.formTitle}>{t('pages.oddzialy.newDelegationTitle')}</h3>
            <form onSubmit={handleDelegacja}>
              <div style={S.grid}>
                <Field label="Ekipa *">
                  <select style={S.input} value={formDelegacja.ekipa_id} onChange={e => setFormDelegacja({ ...formDelegacja, ekipa_id: e.target.value })} required>
                    <option value="">-- wybierz ekipę --</option>
                    {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                  </select>
                </Field>
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
                <button type="button" style={S.cancelBtn} onClick={() => setShowDelegacja(false)}>Anuluj</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isDelegacjaFormValid}>{saving ? t('common.saving') : t('pages.oddzialy.submitDelegation')}</button>
              </div>
            </form>
          </div>
        )}

        {/* Formularz przeniesienia */}
        {showPrzenies && isDyrektor && (
          <div style={S.formBox}>
            <h3 style={S.formTitle}>{t('pages.oddzialy.transferFormTitle')}</h3>
            <form onSubmit={handlePrzenies}>
              <div style={S.grid}>
                <Field label="Pracownik *">
                  <select style={S.input} value={formPrzenies.user_id} onChange={e => setFormPrzenies({ ...formPrzenies, user_id: e.target.value })} required>
                    <option value="">-- wybierz --</option>
                    {uzytkownicy.map(u => <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({u.rola}) — {oddzialy.find(o => o.id === u.oddzial_id)?.nazwa || 'brak'}</option>)}
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
                <button type="button" style={S.cancelBtn} onClick={() => setShowPrzenies(false)}>Anuluj</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isPrzeniesFormValid}>{saving ? t('common.saving') : t('pages.oddzialy.submitTransfer')}</button>
              </div>
            </form>
          </div>
        )}

        {/* TAB: Oddziały */}
        {activeTab === 'oddzialy' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {oddzialy.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', gridColumn: '1/-1' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <BusinessOutlined sx={{ fontSize: 48, opacity: 0.45 }} />
                </div>
                <p>{t('pages.oddzialy.emptyBranches')}</p>
              </div>
            ) : oddzialy.map((o, i) => (
              <div key={o.id} style={{
                backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                borderTop: '4px solid var(--accent)',
                animation: `bounceIn 0.4s ease ${i * 0.06}s forwards`, opacity: 0,
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(56,142,60,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <BusinessOutlined sx={{ fontSize: 36, color: 'var(--accent)', opacity: 0.85 }} />
                  {isDyrektor && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={S.editBtn} onClick={() => handleEdit(o)} aria-label={t('common.edit')}>
                        <EditOutlined sx={{ fontSize: 18 }} />
                      </button>
                      <button type="button" style={S.deleteBtn} onClick={() => handleDelete(o.id)} aria-label={t('common.delete')}>
                        <DeleteOutline sx={{ fontSize: 18 }} />
                      </button>
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
                <button
                  style={{ width: '100%', padding: '8px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600' }}
                  onClick={() => navigate(`/oddzialy/${o.id}`)}>
                  {t('pages.oddzialy.seeDetails')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* TAB: Delegacje */}
        {activeTab === 'delegacje' && (
          <div style={S.delegacjeWrap}>
            {delegacje.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border2)' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <DriveEtaOutlined sx={{ fontSize: 48, opacity: 0.45 }} />
                </div>
                <p>{t('pages.oddzialy.emptyDelegations')}</p>
              </div>
            ) : (
              <div style={S.delegacjeGrid}>
                {delegacje.map((d) => (
                  <div key={d.id} style={S.delegacjaCard}>
                    <div style={S.delegacjaTop}>
                      <strong style={{ fontSize: 14, color: 'var(--text)' }}>{d.ekipa_nazwa || '-'}</strong>
                      <span style={{ ...S.delegacjaStatus, backgroundColor: STATUS_DELEGACJI_KOLOR[d.status] || '#6B7280' }}>
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
  editBtn: { padding: '4px 10px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  deleteBtn: { padding: '4px 10px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  formBox: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: '4px solid var(--accent)' },
  formTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 8 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  cancelBtn: { padding: '9px 18px', backgroundColor: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  submitBtn: { padding: '9px 18px', backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' },
  delegacjeWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  delegacjeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
  delegacjaCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  delegacjaTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  delegacjaStatus: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: 700 },
  delegacjaMetaRow: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  delegacjaMetaLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 },
  delegacjaMetaValue: { fontSize: 12, color: 'var(--text-sub)', textAlign: 'right', fontWeight: 600 },
  delegacjaDates: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 2 },
  delegacjaDateBox: { background: 'var(--bg-deep)', border: '1px solid var(--border2)', borderRadius: 10, padding: '8px 10px' },
  delegacjaDateLabel: { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' },
  delegacjaDateValue: { fontSize: 12, color: 'var(--text)', fontWeight: 700, marginTop: 2 },
  delegacjaActionRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 4 },
  delegacjaSelect: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)', fontSize: 12, cursor: 'pointer', minWidth: 140 },
};
