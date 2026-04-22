import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import useAsyncLoad from '../hooks/useAsyncLoad';
import { addTeamMember, removeTeamMember } from '../utils/teamMembersApi';
import { devWarn } from '../utils/devLog';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';


const STATUS_KOLOR = {
  Nowe: 'var(--accent)', Zaplanowane: '#81C784',
  W_Realizacji: '#F9A825', Zakonczone: '#4CAF50', Anulowane: '#EF5350'
};

const ROLA_KOLOR = {
  'Dyrektor':                   '#8B5CF6',
  'Administrator':              '#F59E0B',
  'Kierownik':                  '#3B82F6',
  'Brygadzista':                '#10B981',
  'Specjalista':                '#06B6D4',
  'Wyceniający':                '#A78BFA',
  'Pomocnik':                   '#94A3B8',
  'Pomocnik bez doświadczenia': '#64748B',
  'Magazynier':                 '#F97316',
};

export default function OddzialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [oddzial, setOddzial] = useState(null);
  const [zlecenia, setZlecenia] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [pracownicy, setPracownicy] = useState([]);
  const [wszyscyPracownicy, setWszyscyPracownicy] = useState([]);
  const [activeTab, setActiveTab] = useState('zlecenia');
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [saving, setSaving] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showEkipaForm, setShowEkipaForm] = useState(false);
  const [editEkipa, setEditEkipa] = useState(null);
  const [selectedEkipa, setSelectedEkipa] = useState(null);
  const [ekipaDetail, setEkipaDetail] = useState(null);
  const [showAddCzlonek, setShowAddCzlonek] = useState(false);
  const [brygadzistaProcent, setBrygadzistaProcent] = useState('15');
  const [formEkipa, setFormEkipa] = useState({ nazwa: '', brygadzista_id: '' });
  const [formCzlonek, setFormCzlonek] = useState({ user_id: '', rola: 'Pomocnik' });
  const [showPracownikForm, setShowPracownikForm] = useState(false);
  const [formPracownik, setFormPracownik] = useState({
    imie: '', nazwisko: '', login: '', haslo: '',
    email: '', telefon: '', rola: 'Brygadzista',
    stawka_godzinowa: '', procent_wynagrodzenia: '15',
    stanowisko: '', data_zatrudnienia: '',
  });

  const loadAll = useCallback(async () => {
    const token = getStoredToken();
    const h = authHeaders(token);
    const [oRes, zRes, eRes, uRes] = await Promise.all([
      api.get(`/oddzialy`, { headers: h }),
      api.get(`/tasks/wszystkie`, { headers: h }),
      api.get(`/ekipy`, { headers: h }),
      api.get(`/uzytkownicy`, { headers: h }),
    ]);
    const found = oRes.data.find(o => o.id === parseInt(id));
    setOddzial(found);
    setZlecenia(zRes.data.filter(z => z.oddzial_id === parseInt(id)));
    setEkipy(eRes.data.filter(e => e.oddzial_id === parseInt(id)));
    setPracownicy(uRes.data.filter(p => p.oddzial_id === parseInt(id)));
    setWszyscyPracownicy(uRes.data);
  }, [id]);
  const { loading, reload: reloadAll } = useAsyncLoad(loadAll, {
    immediate: false,
    onError: (err) => devWarn('oddzial-detail', 'loadAll failed', err),
  });

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    reloadAll();
  }, [navigate, reloadAll]);

  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const canEdit = isDyrektor || currentUser?.rola === 'Kierownik';

  const loadEkipaDetail = useCallback(async (ekipaId) => {
    try {
      const token = getStoredToken();
      const res = await api.get(`/ekipy/${ekipaId}`, {
        headers: authHeaders(token)
      });
      setEkipaDetail(res.data);
      setBrygadzistaProcent(String(res.data?.procent_wynagrodzenia || 15));
    } catch (err) { devWarn('oddzial-detail', 'loadEkipaDetail failed', err); }
  }, []);

  const refreshAfterTeamChange = useCallback(async () => {
    if (selectedEkipa?.id) {
      await Promise.all([loadEkipaDetail(selectedEkipa.id), reloadAll()]);
      return;
    }
    await reloadAll();
  }, [selectedEkipa, loadEkipaDetail, reloadAll]);

  const handleEkipaSubmit = async (e) => {
    e.preventDefault();
    setMemberSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const payload = { ...formEkipa, nazwa: formEkipa.nazwa.trim(), oddzial_id: id };
      if (editEkipa) {
        await api.put(`/ekipy/${editEkipa.id}`, payload, { headers: h });
        showMsg(successMessage('Ekipa zaktualizowana!'));
      } else {
        await api.post(`/ekipy`, payload, { headers: h });
        showMsg(successMessage('Ekipa utworzona!'));
      }
      setShowEkipaForm(false);
      setEditEkipa(null);
      setFormEkipa({ nazwa: '', brygadzista_id: '' });
      reloadAll();
      if (selectedEkipa) loadEkipaDetail(selectedEkipa.id);
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEkipa = async (ekipaId) => {
    if (!window.confirm('Usunąć ekipę?')) return;
    try {
      const token = getStoredToken();
      await api.delete(`/ekipy/${ekipaId}`, { headers: authHeaders(token) });
      showMsg(successMessage('Ekipa usunięta!'));
      setSelectedEkipa(null);
      setEkipaDetail(null);
      reloadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    }
  };

  const handleAddCzlonek = async (e) => {
    e.preventDefault();
    const workerId = Number(formCzlonek.user_id);
    const alreadyInTeam = Boolean(
      ekipaDetail?.czlonkowie?.some((c) => Number(c.user_id ?? c.id) === workerId)
    );
    if (alreadyInTeam) {
      showMsg(warningMessage('Ten pracownik jest już przypisany do ekipy.'));
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      const result = await addTeamMember(
        api,
        token,
        selectedEkipa.id,
        workerId,
        formCzlonek.rola
      );
      if (result.duplicate) {
        showMsg(warningMessage('Pracownik jest już przypisany do tej ekipy.'));
        refreshAfterTeamChange();
        return;
      }

      showMsg(successMessage('Pracownik dodany!'));
      setShowAddCzlonek(false);
      setFormCzlonek({ user_id: '', rola: 'Pomocnik' });
      await refreshAfterTeamChange();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setMemberSaving(false);
    }
  };

  const handleRemoveCzlonek = async (userId) => {
    if (memberSaving) return;
    if (!window.confirm('Usunąć z ekipy?')) return;
    setMemberSaving(true);
    try {
      const token = getStoredToken();
      const workerId = Number(userId);
      await removeTeamMember(api, token, selectedEkipa.id, workerId);

      showMsg(successMessage('Usunięto z ekipy!'));
      await refreshAfterTeamChange();
    } catch (err) { showMsg(errorMessage(getApiErrorMessage(err, 'Błąd usuwania'))); }
    finally {
      setMemberSaving(false);
    }
  };

  const zmienProcent = async (userId, procent) => {
    if (rateSaving) return;
    setRateSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/uzytkownicy/${userId}/procent`, { procent_wynagrodzenia: procent }, {
        headers: authHeaders(token)
      });
      showMsg(successMessage('Procent zmieniony!'));
      loadEkipaDetail(selectedEkipa.id);
    } catch (err) { showMsg(errorMessage('Błąd')); }
    finally {
      setRateSaving(false);
    }
  };

  const handlePracownikSubmit = async (e) => {
    e.preventDefault();
    if (formPracownik.haslo.length < 6) { showMsg(errorMessage('Hasło min. 6 znaków')); return; }
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.post(`/uzytkownicy`, {
        ...formPracownik,
        imie: formPracownik.imie.trim(),
        nazwisko: formPracownik.nazwisko.trim(),
        login: formPracownik.login.trim(),
        email: formPracownik.email.trim(),
        telefon: formPracownik.telefon.trim(),
        stanowisko: formPracownik.stanowisko.trim(),
        oddzial_id: id
      }, {
        headers: authHeaders(token)
      });
      showMsg(successMessage('Pracownik dodany!'));
      setShowPracownikForm(false);
      setFormPracownik({ imie: '', nazwisko: '', login: '', haslo: '', email: '', telefon: '', rola: 'Brygadzista', stawka_godzinowa: '', procent_wynagrodzenia: '15', stanowisko: '', data_zatrudnienia: '' });
      reloadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const toggleAktywny = async (e, userId, aktywny) => {
    e.stopPropagation();
    try {
      const token = getStoredToken();
      await api.put(`/uzytkownicy/${userId}/aktywny`, { aktywny: !aktywny }, {
        headers: authHeaders(token)
      });
      reloadAll();
    } catch (err) { devWarn('oddzial-detail', 'toggleAktywny failed', err); }
  };

  const statsMap = useMemo(() => {
    const map = {};
    for (const z of zlecenia) {
      map[z.status] = (map[z.status] || 0) + 1;
    }
    return map;
  }, [zlecenia]);
  const statsByStatus = useCallback((status) => statsMap[status] || 0, [statsMap]);
  const sumaWartosc = useMemo(
    () => zlecenia.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0),
    [zlecenia]
  );
  const brygadzisci = useMemo(
    () => wszyscyPracownicy.filter((u) => u.rola === 'Brygadzista' && u.aktywny),
    [wszyscyPracownicy]
  );
  const wolniPracownicyDoEkipy = useMemo(() => {
    const assignedIds = new Set((ekipaDetail?.czlonkowie || []).map((c) => c.user_id));
    return wszyscyPracownicy.filter((u) => u.aktywny && !assignedIds.has(u.id));
  }, [wszyscyPracownicy, ekipaDetail]);
  const isEkipaFormValid = Boolean(formEkipa.nazwa.trim());
  const isAddCzlonekValid = Boolean(formCzlonek.user_id);
  const isPracownikFormValid = Boolean(
    formPracownik.imie.trim() &&
    formPracownik.nazwisko.trim() &&
    formPracownik.login.trim() &&
    formPracownik.haslo
  );

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12, animation: 'treeSway 2s ease-in-out infinite' }}>🌳</div>
        <p style={{ color: 'var(--accent)', fontWeight: '600' }}>Ładowanie...</p>
      </div>
    </div>
  );

  if (!oddzial) return <div style={{ padding: 40, textAlign: 'center' }}>Nie znaleziono oddziału</div>;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: 28, overflowX: 'hidden' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: 8, fontSize: 14, marginBottom: 20, alignItems: 'center' }}>
          <span style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: '500' }}
            onClick={() => navigate('/oddzialy')}>← Oddziały</span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <span style={{ color: 'var(--text)', fontWeight: '600' }}>{oddzial.nazwa}</span>
        </div>

        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg, #0A1628, var(--accent))',
          borderRadius: 20, padding: '24px 28px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 16,
          boxShadow: '0 4px 20px rgba(56,142,60,0.3)',
          animation: 'fadeIn 0.4s ease forwards',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 48 }}>🏢</span>
            <div>
              <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 'bold', margin: 0, marginBottom: 4 }}>{oddzial.nazwa}</h1>
              <p style={{ color: '#A5D6A7', margin: 0, fontSize: 13 }}>
                📍 {oddzial.miasto}{oddzial.adres ? ` · ${oddzial.adres}` : ''}
              </p>
              {oddzial.kierownik_imie && (
                <p style={{ color: 'var(--border2)', margin: '4px 0 0 0', fontSize: 12 }}>
                  👔 {oddzial.kierownik_imie} {oddzial.kierownik_nazwisko}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Zleceń', value: zlecenia.length },
              { label: 'Ekip', value: ekipy.length },
              { label: 'Pracowników', value: pracownicy.length },
              { label: 'Wartość', value: sumaWartosc.toLocaleString('pl-PL') + ' PLN' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: '#fff' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: '#A5D6A7' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: '📋 Nowe', value: statsByStatus('Nowe'), color: 'var(--accent)', bg: 'rgba(52,211,153,0.1)' },
            { label: '📅 Zaplanowane', value: statsByStatus('Zaplanowane'), color: '#81C784', bg: '#0F172A' },
            { label: '⚡ W realizacji', value: statsByStatus('W_Realizacji'), color: '#F9A825', bg: '#FFF8E1' },
            { label: '✅ Zakończone', value: statsByStatus('Zakonczone'), color: 'var(--accent)', bg: 'rgba(52,211,153,0.1)' },
          ].map(k => (
            <div key={k.label} style={{
              backgroundColor: k.bg, borderRadius: 12, padding: '14px 16px',
              borderTop: `3px solid ${k.color}`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              animation: 'bounceIn 0.4s ease forwards', opacity: 0,
            }}>
              <div style={{ fontSize: 26, fontWeight: 'bold', color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{k.label}</div>
            </div>
          ))}
        </div>

        <StatusMessage
          message={msg}
          style={{ marginBottom: 16, borderRadius: 10, fontSize: 14, animation: 'slideIn 0.3s ease forwards' }}
        />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center', borderBottom: '2px solid var(--border2)', flexWrap: 'wrap' }}>
          {[
            { key: 'zlecenia', label: `📋 Zlecenia (${zlecenia.length})` },
            { key: 'ekipy', label: `👷 Ekipy (${ekipy.length})` },
            { key: 'pracownicy', label: `👥 Pracownicy (${pracownicy.length})` },
          ].map(t => (
            <button key={t.key}
              style={{
                padding: '10px 18px', border: 'none', backgroundColor: 'transparent',
                cursor: 'pointer', fontSize: 14, fontWeight: '500',
                color: activeTab === t.key ? 'var(--accent)' : '#6B7280',
                borderBottom: activeTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -2, transition: 'all 0.2s',
              }}
              onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {activeTab === 'zlecenia' && canEdit && (
              <button style={S.addBtn} onClick={() => navigate('/nowe-zlecenie')}>+ Nowe zlecenie</button>
            )}
            {activeTab === 'ekipy' && canEdit && (
              <button style={S.addBtn} onClick={() => { setEditEkipa(null); setFormEkipa({ nazwa: '', brygadzista_id: '' }); setShowEkipaForm(!showEkipaForm); }}>
                {showEkipaForm ? '✕ Anuluj' : '+ Nowa ekipa'}
              </button>
            )}
            {activeTab === 'pracownicy' && isDyrektor && (
              <button style={S.addBtn} onClick={() => setShowPracownikForm(!showPracownikForm)}>
                {showPracownikForm ? '✕ Anuluj' : '+ Nowy pracownik'}
              </button>
            )}
          </div>
        </div>

        {/* ===== ZLECENIA ===== */}
        {activeTab === 'zlecenia' && (
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            {zlecenia.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                <p>Brak zleceń w tym oddziale</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['ID', 'Klient', 'Adres', 'Ekipa', 'Data', 'Status', 'Wartość', ''].map(h => (
                      <th key={h} style={{ padding: '11px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zlecenia.map((z, i) => (
                    <tr key={z.id}
                      style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)', cursor: 'pointer', transition: 'background 0.15s' }}
                      onClick={() => navigate(`/zlecenia/${z.id}`)}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0F172A'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)'}>
                      <td style={S.td}><span style={{ backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: '600' }}>#{z.id}</span></td>
                      <td style={{ ...S.td, fontWeight: '600' }}>{z.klient_nazwa}</td>
                      <td style={S.td}>{z.adres}</td>
                      <td style={S.td}>{z.ekipa_nazwa || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Brak</span>}</td>
                      <td style={S.td}>{z.data_planowana?.split('T')[0] || '-'}</td>
                      <td style={S.td}>
                        <span style={{ padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', backgroundColor: STATUS_KOLOR[z.status] || '#6B7280' }}>
                          {z.status}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontWeight: '600', color: 'var(--accent)' }}>
                        {z.wartosc_planowana ? `${parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN` : '-'}
                      </td>
                      <td style={S.td}>
                        <button style={S.detailBtn} onClick={e => { e.stopPropagation(); navigate(`/zlecenia/${z.id}`); }}>
                          Otwórz →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== EKIPY ===== */}
        {activeTab === 'ekipy' && (
          <>
            {showEkipaForm && canEdit && (
              <div style={S.formBox}>
                <h3 style={S.formTitle}>{editEkipa ? '✏️ Edytuj ekipę' : '➕ Nowa ekipa'}</h3>
                <form onSubmit={handleEkipaSubmit}>
                  <div style={S.grid}>
                    <Field label="Nazwa ekipy *">
                      <input style={S.input} value={formEkipa.nazwa} onChange={e => setFormEkipa({ ...formEkipa, nazwa: e.target.value })} required placeholder="np. Ekipa A" />
                    </Field>
                    <Field label="Brygadzista">
                      <select style={S.input} value={formEkipa.brygadzista_id} onChange={e => setFormEkipa({ ...formEkipa, brygadzista_id: e.target.value })}>
                        <option value="">-- brak --</option>
                        {brygadzisci.map(u => <option key={u.id} value={u.id}>👷 {u.imie} {u.nazwisko}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div style={S.btnRow}>
                    <button type="button" style={S.cancelBtn} onClick={() => { setShowEkipaForm(false); setEditEkipa(null); }}>Anuluj</button>
                    <button type="submit" style={S.submitBtn} disabled={saving || !isEkipaFormValid}>
                      {saving ? '⏳...' : editEkipa ? '💾 Zapisz' : '➕ Utwórz'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20, alignItems: 'start' }}>
              <div>
                {ekipy.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 16 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>👷</div>
                    <p>Brak ekip w tym oddziale</p>
                  </div>
                ) : ekipy.map((e, i) => (
                  <div key={e.id}
                    onClick={() => { setSelectedEkipa(e); loadEkipaDetail(e.id); setShowAddCzlonek(false); }}
                    style={{
                      backgroundColor: 'var(--bg-card)', borderRadius: 14, padding: 16, marginBottom: 10,
                      boxShadow: selectedEkipa?.id === e.id ? '0 4px 16px rgba(56,142,60,0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                      borderLeft: `4px solid ${selectedEkipa?.id === e.id ? 'var(--accent)' : 'var(--border)'}`,
                      cursor: 'pointer', transition: 'all 0.2s',
                      animation: `slideIn 0.3s ease ${i * 0.06}s forwards`, opacity: 0,
                    }}
                    onMouseEnter={el => { el.currentTarget.style.transform = 'translateX(4px)'; }}
                    onMouseLeave={el => { el.currentTarget.style.transform = 'none'; }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 4 }}>👥 {e.nazwa}</div>
                        {e.brygadzista_imie && (
                          <div style={{ fontSize: 12, color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            👷 {e.brygadzista_imie} {e.brygadzista_nazwisko}
                            {e.procent_wynagrodzenia && <span style={{ backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 'bold' }}>{e.procent_wynagrodzenia}%</span>}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>👷 {e.liczba_czlonkow || 0} pomocników</div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }} onClick={ev => ev.stopPropagation()}>
                          <button style={S.editBtn} onClick={() => { setEditEkipa(e); setFormEkipa({ nazwa: e.nazwa, brygadzista_id: e.brygadzista_id || '' }); setShowEkipaForm(true); }}>✏️</button>
                          {isDyrektor && <button style={S.deleteBtn} onClick={() => handleDeleteEkipa(e.id)}>🗑️</button>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {selectedEkipa && ekipaDetail ? (
                <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(56,142,60,0.12)', animation: 'fadeIn 0.3s ease forwards' }}>
                  <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--accent)', margin: 0 }}>{ekipaDetail.nazwa}</h3>
                  </div>

                  {ekipaDetail.brygadzista_imie && (
                    <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--text-sub)', marginBottom: 10 }}>👷 Brygadzista</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 44, height: 44, borderRadius: 22, background: 'linear-gradient(135deg, var(--accent), #66BB6A)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: 15 }}>
                            {ekipaDetail.brygadzista_imie?.[0]}{ekipaDetail.brygadzista_nazwisko?.[0]}
                          </div>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: '600', color: 'var(--text)' }}>{ekipaDetail.brygadzista_imie} {ekipaDetail.brygadzista_nazwisko}</div>
                            {ekipaDetail.brygadzista_telefon && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📞 {ekipaDetail.brygadzista_telefon}</div>}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>% od zlecenia</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="number" min="1" max="100" step="0.5"
                              value={brygadzistaProcent}
                              onChange={(e) => setBrygadzistaProcent(e.target.value)}
                              style={{ width: 60, padding: '5px 8px', borderRadius: 8, border: '2px solid var(--accent)', fontSize: 14, fontWeight: 'bold', color: 'var(--accent)', textAlign: 'center', outline: 'none' }} />
                            <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>%</span>
                            <button onClick={() => zmienProcent(ekipaDetail.brygadzista_id, brygadzistaProcent)}
                              disabled={rateSaving}
                              style={{ padding: '5px 10px', backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 8, cursor: rateSaving ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 'bold', opacity: rateSaving ? 0.7 : 1 }}>
                              {rateSaving ? '⏳' : 'Zapisz'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--text-sub)' }}>👥 Pomocnicy ({ekipaDetail.czlonkowie?.length || 0})</div>
                      {canEdit && (
                        <button
                          style={{ ...S.addSmallBtn, cursor: memberSaving ? 'not-allowed' : 'pointer', opacity: memberSaving ? 0.7 : 1 }}
                          onClick={() => setShowAddCzlonek(!showAddCzlonek)}
                          disabled={memberSaving}>
                          {showAddCzlonek ? '✕' : '+ Dodaj'}
                        </button>
                      )}
                    </div>

                    {showAddCzlonek && (
                      <form onSubmit={handleAddCzlonek} style={{ backgroundColor: 'var(--bg)', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid #DCEDC8' }}>
                        <Field label="Pracownik *">
                          <select style={S.input} value={formCzlonek.user_id} onChange={e => setFormCzlonek({ ...formCzlonek, user_id: e.target.value })} required>
                            <option value="">-- wybierz --</option>
                            {wolniPracownicyDoEkipy.map(u => (
                              <option key={u.id} value={u.id}>👤 {u.imie} {u.nazwisko} ({u.rola})</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Rola">
                          <select style={S.input} value={formCzlonek.rola} onChange={e => setFormCzlonek({ ...formCzlonek, rola: e.target.value })}>
                            <option value="Pomocnik">Pomocnik</option>
                            <option value="Kierowca">Kierowca</option>
                            <option value="Specjalista">Specjalista</option>
                          </select>
                        </Field>
                        <div style={{ ...S.btnRow, marginTop: 8 }}>
                          <button type="button" style={S.cancelBtn} onClick={() => setShowAddCzlonek(false)}>Anuluj</button>
                          <button type="submit" style={S.submitBtn} disabled={memberSaving || !isAddCzlonekValid}>{memberSaving ? '⏳...' : '+ Dodaj'}</button>
                        </div>
                      </form>
                    )}

                    {!ekipaDetail.czlonkowie?.length ? (
                      <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16, fontSize: 13 }}>Brak pomocników</p>
                    ) : ekipaDetail.czlonkowie.map((c, i) => (
                      <div key={c.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderRadius: 8, marginBottom: 4, transition: 'background 0.15s', animation: `slideIn 0.2s ease ${i * 0.05}s forwards`, opacity: 0 }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0F172A'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                        <div style={{ width: 36, height: 36, borderRadius: 18, background: 'linear-gradient(135deg, var(--border), var(--border2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', flexShrink: 0 }}>
                          {c.imie?.[0]}{c.nazwisko?.[0]}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: '600', color: 'var(--text)' }}>{c.imie} {c.nazwisko}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                            <span style={{ backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>{c.rola}</span>
                            <span>💰 {c.stawka_godzinowa || 0} PLN/h</span>
                          </div>
                        </div>
                        {canEdit && <button style={{ ...S.deleteBtn, cursor: memberSaving ? 'not-allowed' : 'pointer', opacity: memberSaving ? 0.7 : 1 }} onClick={() => handleRemoveCzlonek(c.user_id)} disabled={memberSaving}>✕</button>}
                      </div>
                    ))}
                  </div>

                  {ekipaDetail.brygadzista_imie && <KalkulatorWynagrodzenia ekipa={ekipaDetail} />}
                </div>
              ) : (
                <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 60, textAlign: 'center', color: 'var(--text-muted)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 48, marginBottom: 12, animation: 'treeSway 3s ease-in-out infinite' }}>🌳</div>
                  <p style={{ fontWeight: '600', color: 'var(--text-sub)' }}>Wybierz ekipę</p>
                  <p style={{ fontSize: 13 }}>Kliknij na ekipę aby zobaczyć szczegóły</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ===== PRACOWNICY ===== */}
        {activeTab === 'pracownicy' && (
          <>
            {showPracownikForm && isDyrektor && (
              <div style={S.formBox}>
                <h3 style={S.formTitle}>➕ Nowy pracownik — {oddzial.nazwa}</h3>
                <form onSubmit={handlePracownikSubmit}>
                  <div style={S.grid}>
                    <Field label="Imię *"><input style={S.input} value={formPracownik.imie} onChange={e => setFormPracownik({ ...formPracownik, imie: e.target.value })} required /></Field>
                    <Field label="Nazwisko *"><input style={S.input} value={formPracownik.nazwisko} onChange={e => setFormPracownik({ ...formPracownik, nazwisko: e.target.value })} required /></Field>
                    <Field label="Login *"><input style={S.input} value={formPracownik.login} onChange={e => setFormPracownik({ ...formPracownik, login: e.target.value })} required /></Field>
                    <Field label="Hasło *"><input style={S.input} type="password" value={formPracownik.haslo} onChange={e => setFormPracownik({ ...formPracownik, haslo: e.target.value })} required /></Field>
                    <Field label="Telefon"><input style={S.input} value={formPracownik.telefon} onChange={e => setFormPracownik({ ...formPracownik, telefon: e.target.value })} /></Field>
                    <Field label="Email"><input style={S.input} type="email" value={formPracownik.email} onChange={e => setFormPracownik({ ...formPracownik, email: e.target.value })} /></Field>
                    <Field label="Rola *">
                      <select style={S.input} value={formPracownik.rola} onChange={e => setFormPracownik({ ...formPracownik, rola: e.target.value })}>
                        <optgroup label="Zarząd">
                          <option value="Kierownik">Kierownik</option>
                        </optgroup>
                        <optgroup label="Ekipa">
                          <option value="Brygadzista">Brygadzista</option>
                          <option value="Specjalista">Specjalista</option>
                          <option value="Pomocnik">Pomocnik</option>
                          <option value="Pomocnik bez doświadczenia">Pomocnik bez doświadczenia</option>
                        </optgroup>
                        <optgroup label="Inne">
                          <option value="Wyceniający">Wyceniający</option>
                          <option value="Magazynier">Magazynier</option>
                        </optgroup>
                      </select>
                    </Field>
                    <Field label="Stanowisko"><input style={S.input} value={formPracownik.stanowisko} onChange={e => setFormPracownik({ ...formPracownik, stanowisko: e.target.value })} /></Field>
                    {formPracownik.rola === 'Brygadzista' ? (
                      <Field label="Procent od zlecenia (%)">
                        <input style={S.input} type="number" min="1" max="100" step="0.5" value={formPracownik.procent_wynagrodzenia} onChange={e => setFormPracownik({ ...formPracownik, procent_wynagrodzenia: e.target.value })} />
                      </Field>
                    ) : (
                      <Field label="Stawka godz. (PLN/h)">
                        <input style={S.input} type="number" step="0.5" value={formPracownik.stawka_godzinowa} onChange={e => setFormPracownik({ ...formPracownik, stawka_godzinowa: e.target.value })} />
                      </Field>
                    )}
                  </div>
                  <div style={S.btnRow}>
                    <button type="button" style={S.cancelBtn} onClick={() => setShowPracownikForm(false)}>Anuluj</button>
                    <button type="submit" style={S.submitBtn} disabled={saving || !isPracownikFormValid}>{saving ? '⏳...' : '✓ Utwórz konto'}</button>
                  </div>
                </form>
              </div>
            )}

            <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              {pracownicy.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
                  <p>Brak pracowników w tym oddziale</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Pracownik', 'Login', 'Rola', 'Telefon', 'Stawka/Procent', 'Status', 'Akcje'].map(h => (
                        <th key={h} style={{ padding: '11px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pracownicy.map((p, i) => (
                      <tr key={p.id}
                        style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)', cursor: 'pointer', transition: 'background 0.15s' }}
                        onClick={() => navigate(`/uzytkownicy/${p.id}`)}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0F172A'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)'}>
                        <td style={S.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: (ROLA_KOLOR[p.rola] || '#6B7280') + '22', color: ROLA_KOLOR[p.rola] || '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold', flexShrink: 0 }}>
                              {p.imie?.[0]}{p.nazwisko?.[0]}
                            </div>
                            <span style={{ fontWeight: '600' }}>{p.imie} {p.nazwisko}</span>
                          </div>
                        </td>
                        <td style={{ ...S.td, color: 'var(--text-muted)' }}>@{p.login}</td>
                        <td style={S.td}>
                          <span style={{ padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', backgroundColor: ROLA_KOLOR[p.rola] || '#6B7280' }}>{p.rola}</span>
                        </td>
                        <td style={S.td}>{p.telefon || '-'}</td>
                        <td style={{ ...S.td, fontWeight: '600', color: 'var(--accent)' }}>
                          {p.rola === 'Brygadzista'
                            ? <span style={{ backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 'bold' }}>{p.procent_wynagrodzenia || 15}%</span>
                            : `${p.stawka_godzinowa || 0} PLN/h`}
                        </td>
                        <td style={S.td}>
                          <span style={{ padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', backgroundColor: p.aktywny ? '#4CAF50' : '#EF5350' }}>
                            {p.aktywny ? '✅ Aktywny' : '❌ Nieaktywny'}
                          </span>
                        </td>
                        <td style={S.td} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={S.editBtn} onClick={() => navigate(`/uzytkownicy/${p.id}`)}>✏️</button>
                            {isDyrektor && (
                              <button style={{ ...S.editBtn, backgroundColor: p.aktywny ? '#FFF8E1' : 'rgba(52,211,153,0.1)', color: p.aktywny ? '#F9A825' : 'var(--accent)' }}
                                onClick={e => toggleAktywny(e, p.id, p.aktywny)}>
                                {p.aktywny ? '🔴' : '🟢'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KalkulatorWynagrodzenia({ ekipa }) {
  const [form, setForm] = useState({
    wartosc_brutto: '', vat_stawka: '8',
    godziny_pracy: '', liczba_pracownikow: ekipa.czlonkowie?.length || 0,
    stawka_pomocnika: '25', procent_brygadzisty: ekipa.procent_wynagrodzenia || 15,
  });
  const [wynik, setWynik] = useState(null);
  const fmt = (n) => parseFloat(n || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2 });

  const oblicz = () => {
    const brutto = parseFloat(form.wartosc_brutto) || 0;
    const vat = parseFloat(form.vat_stawka) || 8;
    const netto = brutto / (1 + vat / 100);
    const kosztPom = (parseInt(form.liczba_pracownikow) || 0) * (parseFloat(form.godziny_pracy) || 0) * (parseFloat(form.stawka_pomocnika) || 0);
    const podstawa = netto - kosztPom;
    const wynagrodzenieB = podstawa > 0 ? podstawa * (parseFloat(form.procent_brygadzisty) || 15) / 100 : 0;
    setWynik({ netto, kosztPom, podstawa, wynagrodzenieB });
  };

  return (
    <div style={{ borderTop: '2px solid var(--border)', paddingTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--text-sub)', marginBottom: 12 }}>💰 Kalkulator wynagrodzenia</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Wartość brutto (PLN)', field: 'wartosc_brutto', placeholder: '4500' },
          { label: 'VAT (%)', field: 'vat_stawka', type: 'select' },
          { label: 'Godziny pracy', field: 'godziny_pracy', placeholder: '8' },
          { label: 'Liczba pomocników', field: 'liczba_pracownikow' },
          { label: 'Stawka pomocnika (PLN/h)', field: 'stawka_pomocnika', placeholder: '25' },
          { label: '% brygadzisty', field: 'procent_brygadzisty' },
        ].map(f => (
          <div key={f.field}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: 4 }}>{f.label}</label>
            {f.type === 'select' ? (
              <select style={S.input} value={form[f.field]} onChange={e => setForm({ ...form, [f.field]: e.target.value })}>
                <option value="23">23%</option><option value="8">8%</option><option value="5">5%</option><option value="0">0%</option>
              </select>
            ) : (
              <input style={S.input} type="number" value={form[f.field]} placeholder={f.placeholder} onChange={e => setForm({ ...form, [f.field]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <button onClick={oblicz} style={{ width: '100%', padding: 10, backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>
        🧮 Oblicz wynagrodzenie
      </button>
      {wynik && (
        <div style={{ backgroundColor: 'var(--bg)', borderRadius: 10, padding: 14, border: '1px solid #DCEDC8' }}>
          {[
            { l: 'Wartość netto', v: `${fmt(wynik.netto)} PLN` },
            { l: 'Koszt pomocników', v: `- ${fmt(wynik.kosztPom)} PLN`, c: '#EF5350' },
            { l: 'Podstawa brygadzisty', v: `${fmt(wynik.podstawa)} PLN` },
          ].map(r => (
            <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #DCEDC8', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{r.l}</span>
              <span style={{ fontWeight: '600', color: r.c || 'var(--text)' }}>{r.v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10 }}>
            <span style={{ fontWeight: 'bold', fontSize: 13, color: 'var(--accent)' }}>💰 Wynagrodzenie brygadzisty ({form.procent_brygadzisty}%)</span>
            <span style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--accent)' }}>{fmt(wynik.wynagrodzenieB)} PLN</span>
          </div>
        </div>
      )}
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
  addBtn: { padding: '8px 18px', backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600' },
  addSmallBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600' },
  editBtn: { padding: '4px 10px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  deleteBtn: { padding: '4px 10px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  detailBtn: { padding: '5px 12px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: '600' },
  formBox: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: '4px solid var(--accent)' },
  formTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 8 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  cancelBtn: { padding: '9px 18px', backgroundColor: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  submitBtn: { padding: '9px 18px', backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' },
};
