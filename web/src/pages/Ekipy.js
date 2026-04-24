import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import useAsyncLoad from '../hooks/useAsyncLoad';
import { addTeamMember, removeTeamMember } from '../utils/teamMembersApi';
import { devWarn } from '../utils/devLog';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';


export default function Ekipy() {
  const { t } = useTranslation();
  const [ekipy, setEkipy] = useState([]);
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [saving, setSaving] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedEkipa, setSelectedEkipa] = useState(null);
  const [ekipaDetail, setEkipaDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editEkipa, setEditEkipa] = useState(null);
  const [showAddCzlonek, setShowAddCzlonek] = useState(false);
  const [brygadzistaProcent, setBrygadzistaProcent] = useState('15');
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [hoveredEkipa, setHoveredEkipa] = useState(null);
  const KOLORY_EKIP = [
    '#22C55E', '#EAB308', '#EF4444', '#3B82F6',
    '#38bdf8', '#F97316', '#14B8A6', '#EC4899',
    '#64748b', '#F43F5E', '#10B981', '#6B7280',
  ];
  const [form, setForm] = useState({ nazwa: '', brygadzista_id: '', oddzial_id: '', kolor: '#22C55E' });
  const [formCzlonek, setFormCzlonek] = useState({ user_id: '', rola: 'Pomocnik' });
  const navigate = useNavigate();

  const loadAll = useCallback(async () => {
    const token = getStoredToken();
    const h = authHeaders(token);
    const [eRes, uRes, oRes] = await Promise.all([
      api.get(`/ekipy`, { headers: h }),
      api.get(`/uzytkownicy`, { headers: h }),
      api.get(`/oddzialy`, { headers: h }),
    ]);
    setEkipy(eRes.data);
    setUzytkownicy(uRes.data);
    setOddzialy(oRes.data);
  }, []);
  const handleLoadAllError = useCallback((err) => {
    devWarn('ekipy', 'loadAll failed', err);
  }, []);
  const { loading, reload: reloadAll } = useAsyncLoad(loadAll, {
    immediate: false,
    onError: handleLoadAllError,
  });

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const parsed = getLocalStorageJson('user');
    if (parsed) {
      setCurrentUser(parsed);
      if (parsed.rola !== 'Dyrektor' && parsed.rola !== 'Administrator') {
        setFiltrOddzial(parsed.oddzial_id?.toString() || '');
      }
    }
    reloadAll();
  }, [navigate, reloadAll]);

  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const canEdit = !currentUser || (currentUser.rola !== 'Brygadzista' && currentUser.rola !== 'Pomocnik');

  const loadEkipaDetail = useCallback(async (id) => {
    try {
      const token = getStoredToken();
      const res = await api.get(`/ekipy/${id}`, {
        headers: authHeaders(token)
      });
      setEkipaDetail(res.data);
      setBrygadzistaProcent(String(res.data?.procent_wynagrodzenia || 15));
    } catch (err) { devWarn('ekipy', 'loadEkipaDetail failed', err); }
  }, []);

  const refreshAfterTeamChange = useCallback(async () => {
    if (selectedEkipa?.id) {
      await Promise.all([loadEkipaDetail(selectedEkipa.id), reloadAll()]);
      return;
    }
    await reloadAll();
  }, [selectedEkipa, loadEkipaDetail, reloadAll]);

  const handleSelectEkipa = (e) => {
    setSelectedEkipa(e);
    loadEkipaDetail(e.id);
    setShowAddCzlonek(false);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const payload = {
        ...form,
        nazwa: form.nazwa.trim(),
        oddzial_id: form.oddzial_id || currentUser?.oddzial_id
      };
      if (editEkipa) {
        await api.put(`/ekipy/${editEkipa.id}`, payload, { headers: h });
        showMsg(successMessage('Ekipa zaktualizowana!'));
      } else {
        await api.post(`/ekipy`, payload, { headers: h });
        showMsg(successMessage('Ekipa utworzona!'));
      }
      setShowForm(false);
      setEditEkipa(null);
      setForm({ nazwa: '', brygadzista_id: '', oddzial_id: '', kolor: '#22C55E' });
      reloadAll();
      if (selectedEkipa) loadEkipaDetail(selectedEkipa.id);
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (e) => {
    setEditEkipa(e);
    setForm({ nazwa: e.nazwa, brygadzista_id: e.brygadzista_id || '', oddzial_id: e.oddzial_id || '', kolor: e.kolor || '#22C55E' });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Usunąć ekipę? Zlecenia zostaną odpięte.')) return;
    try {
      const token = getStoredToken();
      await api.delete(`/ekipy/${id}`, { headers: authHeaders(token) });
      showMsg(successMessage('Ekipa usunięta!'));
      setSelectedEkipa(null);
      setEkipaDetail(null);
      reloadAll();
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    }
  };

  const handleAddCzlonek = async (ev) => {
    ev.preventDefault();
    const workerId = Number(formCzlonek.user_id);
    const alreadyInTeam = Boolean(
      ekipaDetail?.czlonkowie?.some((c) => Number(c.user_id ?? c.id) === workerId)
    );
    if (alreadyInTeam) {
      showMsg(warningMessage('Ten pracownik jest już przypisany do ekipy.'));
      return;
    }
    setMemberSaving(true);
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
    if (!window.confirm('Usunąć pracownika z ekipy?')) return;
    setMemberSaving(true);
    try {
      const token = getStoredToken();
      const workerId = Number(userId);
      await removeTeamMember(api, token, selectedEkipa.id, workerId);

      showMsg(successMessage('Pracownik usunięty z ekipy!'));
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

  const filtrowaneEkipy = useMemo(
    () => ekipy.filter((e) => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial),
    [ekipy, filtrOddzial]
  );
  const brygadzisci = useMemo(
    () => uzytkownicy.filter((u) => u.rola === 'Brygadzista' && u.aktywny),
    [uzytkownicy]
  );
  const dostepniPracownicy = useMemo(() => {
    const assignedIds = new Set((ekipaDetail?.czlonkowie || []).map((c) => c.user_id));
    return uzytkownicy.filter(
      (u) =>
        u.aktywny &&
        !['Brygadzista', 'Kierownik', 'Dyrektor', 'Administrator'].includes(u.rola) &&
        !assignedIds.has(u.id)
    );
  }, [uzytkownicy, ekipaDetail]);
  const isEkipaFormValid = Boolean(form.nazwa.trim() && (!isDyrektor || form.oddzial_id));
  const isAddCzlonekValid = Boolean(formCzlonek.user_id);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: 28, position: 'relative' }}>

        <PageHeader
          variant="hero"
          title={t('pages.ekipy.title')}
          subtitle={t('pages.ekipy.summary', { count: filtrowaneEkipy.length })}
          icon={<GroupsOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} style={{ animation: 'bounceIn 0.3s ease forwards' }} />
              {isDyrektor && (
                <select
                  style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  value={filtrOddzial}
                  onChange={(e) => setFiltrOddzial(e.target.value)}
                >
                  <option value="">{t('common.allBranches')}</option>
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
                  onClick={() => {
                    setEditEkipa(null);
                    setForm({ nazwa: '', brygadzista_id: '', oddzial_id: '' });
                    setShowForm(!showForm);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: 'var(--bg-card2)',
                    color: 'var(--accent)',
                    border: '1px solid var(--border2)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 'bold',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {showForm ? t('common.cancel') : t('pages.ekipy.newTeam')}
                </button>
              )}
            </>
          }
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12, marginBottom: 16 }}>
          <div style={{ background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Centrum ekip</div>
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-sub)' }}>Ekipy: <strong style={{ color: 'var(--text)' }}>{filtrowaneEkipy.length}</strong> · Pracownicy: <strong style={{ color: 'var(--text)' }}>{uzytkownicy.length}</strong> · Oddziały: <strong style={{ color: 'var(--text)' }}>{oddzialy.length}</strong></div>
          </div>
          <div style={{ background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Akcja</div>
            <button type="button" style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, cursor: 'pointer' }} onClick={() => { setEditEkipa(null); setForm({ nazwa: '', brygadzista_id: '', oddzial_id: '' }); setShowForm(true); }}>
              Dodaj nową ekipę
            </button>
          </div>
        </div>

        {/* Formularz */}
        {showForm && canEdit && (
          <div style={{
            background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 18, padding: 24, marginBottom: 20,
            boxShadow: 'var(--shadow-sm)',
            animation: 'slideIn 0.3s ease forwards',
            borderTop: '1px solid var(--border2)', border: '1px solid var(--border2)',
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16 }}>
              {editEkipa ? t('pages.ekipy.formEditTitle') : t('pages.ekipy.formNewTitle')}
            </h3>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
                <Field label="Nazwa ekipy *">
                  <input style={S.input} value={form.nazwa} onChange={e => setForm({ ...form, nazwa: e.target.value })} required placeholder="np. Ekipa Kraków A" />
                </Field>
                <Field label="Brygadzista">
                  <select style={S.input} value={form.brygadzista_id} onChange={e => setForm({ ...form, brygadzista_id: e.target.value })}>
                    <option value="">-- brak --</option>
                    {brygadzisci.map(u => <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>)}
                  </select>
                </Field>
                {isDyrektor && (
                  <Field label="Oddział *">
                    <select style={S.input} value={form.oddzial_id} onChange={e => setForm({ ...form, oddzial_id: e.target.value })} required>
                      <option value="">-- wybierz --</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <Field label="Kolor ekipy (widoczny w harmonogramie)">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {KOLORY_EKIP.map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm({ ...form, kolor: k })}
                      style={{
                        width: 32, height: 32, borderRadius: '50%', backgroundColor: k, border: 'none',
                        cursor: 'pointer', outline: form.kolor === k ? `3px solid #fff` : 'none',
                        boxShadow: form.kolor === k ? `0 0 0 5px ${k}55` : 'none',
                        transform: form.kolor === k ? 'scale(1.2)' : 'scale(1)',
                        transition: 'all 0.15s',
                      }}
                    />
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: form.kolor, border: '2px solid var(--border)' }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Wybrany: {form.kolor}</span>
                  </div>
                </div>
              </Field>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" style={S.cancelBtn} onClick={() => { setShowForm(false); setEditEkipa(null); }}>Anuluj</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isEkipaFormValid}>
                  {saving ? t('common.saving') : editEkipa ? t('pages.ekipy.saveTeam') : t('pages.ekipy.createTeam')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Dwie kolumny */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, alignItems: 'start' }}>

          {/* Lista ekip */}
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🌿</div>
                <p>Ładowanie ekip...</p>
              </div>
            ) : filtrowaneEkipy.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>
                  <GroupsOutlined style={{ fontSize: 48 }} aria-hidden />
                </div>
                <p style={{ fontWeight: '600' }}>Brak ekip</p>
                {canEdit && <p style={{ fontSize: 13 }}>Kliknij "+ Nowa ekipa" aby dodać</p>}
              </div>
            ) : filtrowaneEkipy.map((e, i) => (
              <div
                key={e.id}
                onClick={() => handleSelectEkipa(e)}
                onMouseEnter={() => setHoveredEkipa(e.id)}
                onMouseLeave={() => setHoveredEkipa(null)}
                style={{
                  background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 14, padding: 16, marginBottom: 10,
                  boxShadow: hoveredEkipa === e.id ? `0 6px 20px ${(e.kolor || '#22C55E')}33` : 'var(--shadow-sm)',
                  borderLeft: `4px solid ${e.kolor || (selectedEkipa?.id === e.id ? 'var(--accent)' : '#334155')}`,
                  cursor: 'pointer',
                  transform: hoveredEkipa === e.id ? 'translateX(4px)' : 'none',
                  transition: 'all 0.2s ease',
                  animation: `slideIn 0.3s ease ${i * 0.06}s forwards`,
                  opacity: 0,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%',
                      backgroundColor: e.kolor || '#6B7280',
                      boxShadow: `0 0 8px ${e.kolor || '#6B7280'}88`,
                      flexShrink: 0,
                    }} />
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--text)', marginBottom: 4 }}>
                        {e.nazwa}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.oddzial_nazwa || '—'}</div>
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6 }} onClick={ev => ev.stopPropagation()}>
                      <button
                        type="button"
                        title={t('common.edit')}
                        aria-label={t('common.edit')}
                        onMouseEnter={e2 => e2.currentTarget.style.backgroundColor = 'var(--border2)'}
                        onMouseLeave={e2 => e2.currentTarget.style.backgroundColor = 'rgba(52,211,153,0.1)'}
                        style={{ padding: '6px 10px', backgroundColor: 'var(--bg-deep)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent)', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center' }}
                        onClick={() => handleEdit(e)}
                      >
                        <EditOutlined style={{ fontSize: 18 }} />
                      </button>
                      {isDyrektor && (
                        <button
                          type="button"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onMouseEnter={e2 => e2.currentTarget.style.backgroundColor = '#FFCDD2'}
                          onMouseLeave={e2 => e2.currentTarget.style.backgroundColor = '#FFEBEE'}
                          style={{ padding: '6px 10px', backgroundColor: 'rgba(248,113,113,0.1)', borderWidth: 1, borderStyle: 'solid', borderColor: '#FFCDD2', borderRadius: 6, cursor: 'pointer', color: '#EF5350', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center' }}
                          onClick={() => handleDelete(e.id)}
                        >
                          <DeleteOutline style={{ fontSize: 18 }} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {e.brygadzista_imie && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-sub)', marginBottom: 6 }}>
                    <span style={{ backgroundColor: '#66BB6A', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 'bold' }}>Brygadzista</span>
                    {e.brygadzista_imie} {e.brygadzista_nazwisko}
                    {e.procent_wynagrodzenia && (
                      <span style={{ backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 'bold' }}>
                        {e.procent_wynagrodzenia}%
                      </span>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.liczba_czlonkow || 0} pomocników</div>
              </div>
            ))}
          </div>

          {/* Szczegóły */}
          {selectedEkipa && ekipaDetail ? (
            <div style={{
              background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 16, padding: 24,
              boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border2)',
              animation: 'fadeIn 0.3s ease forwards',
            }}>
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                <h2 style={{ fontSize: 22, fontWeight: 'bold', color: 'var(--accent)', margin: 0, marginBottom: 4 }}>
                  {ekipaDetail.nazwa}
                </h2>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{ekipaDetail.oddzial_nazwa}</span>
              </div>

              {/* Brygadzista */}
              {ekipaDetail.brygadzista_imie && (
                <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--text-sub)', marginBottom: 12 }}>Brygadzista</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 24,
                        background: 'linear-gradient(135deg, var(--accent), #66BB6A)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 'bold', fontSize: 16,
                      }}>
                        {ekipaDetail.brygadzista_imie?.[0]}{ekipaDetail.brygadzista_nazwisko?.[0]}
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: '600', color: 'var(--text)' }}>
                          {ekipaDetail.brygadzista_imie} {ekipaDetail.brygadzista_nazwisko}
                        </div>
                        {ekipaDetail.brygadzista_telefon && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            📞 {ekipaDetail.brygadzista_telefon}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>% od zlecenia</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number" min="1" max="100" step="0.5"
                          value={brygadzistaProcent}
                          onChange={(e) => setBrygadzistaProcent(e.target.value)}
                          style={{
                            width: 60, padding: '6px 8px', borderRadius: 8,
                            border: '2px solid var(--accent)', fontSize: 14, fontWeight: 'bold',
                            color: 'var(--accent)', textAlign: 'center', outline: 'none',
                          }}
                        />
                        <span style={{ fontWeight: 'bold', color: 'var(--accent)', fontSize: 16 }}>%</span>
                        <button
                          onClick={() => zmienProcent(ekipaDetail.brygadzista_id, brygadzistaProcent)}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--accent-dk)'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--accent)'}
                          disabled={rateSaving}
                          style={{ padding: '6px 12px', backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 8, cursor: rateSaving ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 'bold', transition: 'all 0.2s', opacity: rateSaving ? 0.7 : 1 }}>
                          {rateSaving ? '⏳' : 'Zapisz'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pomocnicy */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--text-sub)' }}>
                    👥 Pomocnicy ({ekipaDetail.czlonkowie?.length || 0})
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setShowAddCzlonek(!showAddCzlonek)}
                        disabled={memberSaving}
                      style={{ padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600' }}>
                      {showAddCzlonek ? '✕ Anuluj' : '+ Dodaj'}
                    </button>
                  )}
                </div>

                {showAddCzlonek && (
                  <form onSubmit={handleAddCzlonek} style={{ backgroundColor: 'var(--bg)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #DCEDC8' }}>
                    <Field label="Pracownik *">
                      <select style={S.input} value={formCzlonek.user_id} onChange={e => setFormCzlonek({ ...formCzlonek, user_id: e.target.value })} required>
                        <option value="">-- wybierz pracownika --</option>
                        {dostepniPracownicy.map(u => (
                          <option key={u.id} value={u.id}>👤 {u.imie} {u.nazwisko} ({u.rola}) — {oddzialy.find(o => o.id === u.oddzial_id)?.nazwa || 'brak'}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Rola w ekipie">
                      <select style={S.input} value={formCzlonek.rola} onChange={e => setFormCzlonek({ ...formCzlonek, rola: e.target.value })}>
                        <option value="Pomocnik">Pomocnik</option>
                        <option value="Kierowca">🚗 Kierowca</option>
                        <option value="Specjalista">🔧 Specjalista</option>
                      </select>
                    </Field>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button type="button" style={S.cancelBtn} onClick={() => setShowAddCzlonek(false)}>Anuluj</button>
                      <button type="submit" style={S.submitBtn} disabled={memberSaving || !isAddCzlonekValid}>
                        {memberSaving ? '⏳...' : '+ Dodaj do ekipy'}
                      </button>
                    </div>
                  </form>
                )}

                {!ekipaDetail.czlonkowie?.length ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--text-muted)', opacity: 0.5 }}>
                      <GroupsOutlined style={{ fontSize: 32 }} aria-hidden />
                    </div>
                    <p>Brak pomocników. Kliknij "+ Dodaj".</p>
                  </div>
                ) : ekipaDetail.czlonkowie.map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 8px', borderRadius: 10, marginBottom: 4,
                      transition: 'background 0.15s',
                      animation: `slideIn 0.2s ease ${i * 0.05}s forwards`, opacity: 0,
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0F172A'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 19,
                      background: 'linear-gradient(135deg, var(--border), var(--border2))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', flexShrink: 0,
                    }}>
                      {c.imie?.[0]}{c.nazwisko?.[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: '600', color: 'var(--text)' }}>{c.imie} {c.nazwisko}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10, marginTop: 2 }}>
                        <span style={{ backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>{c.rola}</span>
                        <span>{t('pages.ekipy.hourlyRate', { rate: c.stawka_godzinowa || 0 })}</span>
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveCzlonek(c.user_id)}
                        disabled={memberSaving}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#FFCDD2'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = '#FFEBEE'}
                        style={{ padding: '4px 10px', backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid #FFCDD2', borderRadius: 6, cursor: memberSaving ? 'not-allowed' : 'pointer', fontSize: 13, color: '#EF5350', transition: 'all 0.15s', opacity: memberSaving ? 0.7 : 1 }}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Kalkulator */}
              {ekipaDetail.brygadzista_imie && (
                <KalkulatorWynagrodzenia ekipa={ekipaDetail} />
              )}
            </div>
          ) : (
            <div style={{
              background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 16, padding: 60,
              textAlign: 'center', color: 'var(--text-muted)',
              boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border2)',
              animation: 'fadeIn 0.4s ease forwards',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color: 'var(--text-muted)', opacity: 0.45 }}>
                <GroupsOutlined style={{ fontSize: 56 }} aria-hidden />
              </div>
              <p style={{ fontSize: 16, fontWeight: '600', color: 'var(--text-sub)' }}>Wybierz ekipę</p>
              <p style={{ fontSize: 13 }}>Kliknij na ekipę aby zobaczyć szczegóły</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KalkulatorWynagrodzenia({ ekipa }) {
  const { t } = useTranslation();
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
    const godz = parseFloat(form.godziny_pracy) || 0;
    const liczbaPrac = parseInt(form.liczba_pracownikow) || 0;
    const stawkaPom = parseFloat(form.stawka_pomocnika) || 0;
    const procent = parseFloat(form.procent_brygadzisty) || 15;
    const kosztPom = liczbaPrac * godz * stawkaPom;
    const podstawa = netto - kosztPom;
    const wynagrodzenieB = podstawa > 0 ? podstawa * procent / 100 : 0;
    setWynik({ netto, kosztPom, podstawa, wynagrodzenieB });
  };

  return (
    <div style={{ borderTop: '2px solid var(--border)', paddingTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--text-sub)', marginBottom: 14 }}>{t('pages.ekipy.salaryCalcTitle')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Wartość brutto (PLN)', field: 'wartosc_brutto', placeholder: '4500' },
          { label: 'Stawka VAT (%)', field: 'vat_stawka', type: 'select' },
          { label: 'Godziny pracy', field: 'godziny_pracy', placeholder: '12' },
          { label: 'Liczba pomocników', field: 'liczba_pracownikow' },
          { label: 'Stawka pomocnika (PLN/h)', field: 'stawka_pomocnika', placeholder: '25' },
          { label: '% brygadzisty', field: 'procent_brygadzisty' },
        ].map(f => (
          <div key={f.field}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: 4 }}>{f.label}</label>
            {f.type === 'select' ? (
              <select style={S.input} value={form[f.field]} onChange={e => setForm({ ...form, [f.field]: e.target.value })}>
                <option value="23">23%</option>
                <option value="8">8%</option>
                <option value="5">5%</option>
                <option value="0">0%</option>
              </select>
            ) : (
              <input style={S.input} type="number" value={form[f.field]} placeholder={f.placeholder}
                onChange={e => setForm({ ...form, [f.field]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <button
        onClick={oblicz}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-dk)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.transform = 'none'; }}
        style={{ width: '100%', padding: 10, backgroundColor: 'var(--bg-card)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', marginBottom: 14, transition: 'all 0.2s' }}>
        Oblicz wynagrodzenie
      </button>
      {wynik && (
        <div style={{ backgroundColor: 'var(--bg)', borderRadius: 12, padding: 16, border: '1px solid #DCEDC8' }}>
          {[
            { label: 'Wartość netto', value: `${fmt(wynik.netto)} PLN` },
            { label: 'Koszt pomocników', value: `- ${fmt(wynik.kosztPom)} PLN`, color: '#EF5350' },
            { label: 'Podstawa brygadzisty', value: `${fmt(wynik.podstawa)} PLN` },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #DCEDC8', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
              <span style={{ fontWeight: '600', color: r.color || 'var(--text)' }}>{r.value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 }}>
            <span style={{ fontWeight: 'bold', fontSize: 14, color: 'var(--accent)' }}>
              {t('pages.ekipy.brygadzistaEarnings', { pct: form.procent_brygadzisty })}
            </span>
            <span style={{ fontWeight: 'bold', fontSize: 20, color: 'var(--accent)' }}>{fmt(wynik.wynagrodzenieB)} PLN</span>
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
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border2)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', backgroundColor: 'var(--bg-card2)', color: 'var(--text)' },
  cancelBtn: { padding: '9px 18px', backgroundColor: 'var(--bg-card2)', color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  submitBtn: { padding: '9px 18px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' },
};
