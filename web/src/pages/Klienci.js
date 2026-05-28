import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import CityInput from '../components/CityInput';
import api from '../api';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { telHref } from '../utils/telLink';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';
import { getTaskStatusColor } from '../utils/taskWorkflow';

const ZRODLA = ['telefon', 'polecenie', 'internet', 'social media', 'wizytówka', 'inne'];
const SEGMENTY = ['VIP', 'Stały klient', 'Nowy lead', 'Do odzyskania', 'B2B', 'B2C'];

function tagsToInput(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function parseTags(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 24);
}

function customFieldsToInput(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return '';
  return Object.entries(fields).map(([key, value]) => `${key}: ${value ?? ''}`).join('\n');
}

function parseCustomFields(value) {
  return Object.fromEntries(
    String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return [line, true];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
      .filter(([key]) => key)
      .slice(0, 50)
  );
}

export default function Klienci() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [klienci, setKlienci] = useState([]);
  const [loading, setLoading] = useState(true);
  const [szukaj, setSzukaj] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    imie: '', nazwisko: '', firma: '', telefon: '', email: '',
    adres: '', miasto: '', kod_pocztowy: '', notatki: '', zrodlo: 'telefon',
    segment: '', tags: '', custom_fields: '',
  });
  const [klientKommoPayload, setKlientKommoPayload] = useState(null);
  const [loadingKlientKommoPayload, setLoadingKlientKommoPayload] = useState(false);
  const [pushingKlientKommo, setPushingKlientKommo] = useState(false);
  const [showKlientKommoPayload, setShowKlientKommoPayload] = useState(false);

  const currentUser = getLocalStorageJson('user', {});
  const canDelete = ['Prezes', 'Dyrektor'].includes(currentUser.rola);

  const loadKlienci = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (szukaj) params.szukaj = szukaj;
      if (segmentFilter) params.segment = segmentFilter;
      if (tagFilter) params.tag = tagFilter;
      const res = await api.get('/klienci', { params });
      setKlienci(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [szukaj, segmentFilter, tagFilter]);

  useEffect(() => { loadKlienci(); }, [loadKlienci]);

  const loadDetail = async (id) => {
    setSelected(id);
    setDetailLoading(true);
    setDetail(null);
    setShowKlientKommoPayload(false);
    setKlientKommoPayload(null);
    try {
      const res = await api.get(`/klienci/${id}`);
      setDetail(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadKlientKommoPayload = async () => {
    if (!selected) return;
    setLoadingKlientKommoPayload(true);
    try {
      const token = getStoredToken();
      const res = await api.get(`/klienci/${selected}/kommo-payload`, { headers: authHeaders(token) });
      setKlientKommoPayload(res.data);
    } catch (e) {
      alert(t('kommoCrm.payloadError') + ': ' + getApiErrorMessage(e, ''));
    } finally {
      setLoadingKlientKommoPayload(false);
    }
  };

  const pushKlientKommo = async () => {
    if (!selected) return;
    setPushingKlientKommo(true);
    try {
      const token = getStoredToken();
      const res = await api.post(`/klienci/${selected}/kommo-push`, {}, { headers: authHeaders(token) });
      if (res.data?.ok) {
        alert(t('kommoCrm.pushSuccess'));
        await loadDetail(selected);
        setKlientKommoPayload(null);
      } else {
        alert(res.data?.error || t('kommoCrm.pushError'));
      }
    } catch (e) {
      alert(t('kommoCrm.pushError') + ': ' + getApiErrorMessage(e, ''));
    } finally {
      setPushingKlientKommo(false);
    }
  };

  const toggleKlientKommoPayload = async () => {
    if (showKlientKommoPayload) {
      setShowKlientKommoPayload(false);
      return;
    }
    setShowKlientKommoPayload(true);
    await loadKlientKommoPayload();
  };

  const openAddForm = () => {
    setForm({ imie: '', nazwisko: '', firma: '', telefon: '', email: '', adres: '', miasto: '', kod_pocztowy: '', notatki: '', zrodlo: 'telefon', segment: '', tags: '', custom_fields: '' });
    setEditMode(false);
    setShowForm(true);
  };

  const openEditForm = () => {
    if (!detail) return;
    setForm({
      imie: detail.imie || '',
      nazwisko: detail.nazwisko || '',
      firma: detail.firma || '',
      telefon: detail.telefon || '',
      email: detail.email || '',
      adres: detail.adres || '',
      miasto: detail.miasto || '',
      kod_pocztowy: detail.kod_pocztowy || '',
      notatki: detail.notatki || '',
      zrodlo: detail.zrodlo || 'telefon',
      segment: detail.segment || '',
      tags: tagsToInput(detail.tags),
      custom_fields: customFieldsToInput(detail.custom_fields),
    });
    setEditMode(true);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.telefon && !form.email) { alert('Podaj telefon lub email'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: parseTags(form.tags),
        custom_fields: parseCustomFields(form.custom_fields),
      };
      if (editMode && selected) {
        await api.put(`/klienci/${selected}`, payload);
      } else {
        await api.post('/klienci', payload);
      }
      setShowForm(false);
      await loadKlienci();
      if (editMode && selected) loadDetail(selected);
    } catch (e) {
      alert('Błąd zapisu: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm('Usunąć tego klienta?')) return;
    try {
      await api.delete(`/klienci/${selected}`);
      setSelected(null);
      setDetail(null);
      loadKlienci();
    } catch (e) {
      alert('Błąd: ' + (e.response?.data?.error || e.message));
    }
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('pl-PL') : '—';
  const fmtPln = (v) => v != null ? `${Number(v).toLocaleString('pl-PL')} zł` : '—';

  const statusColor = (s) => ({
    'Zaplanowane': '#1d4ed8', 'W_Trakcie': '#b45309',
    'Zakonczone': 'var(--accent-dk)', 'Anulowane': 'var(--danger)',
  }[s] || 'var(--text-muted)');

  const taskStatusColor = (s) => ({
    'W_Trakcie': '#b45309', 'Zakończone': 'var(--accent-dk)',
    'Anulowane': 'var(--danger)', 'Wstrzymane': 'var(--text-muted)',
  }[s] || getTaskStatusColor(s, 'var(--text-muted)'));

  return (
    <div className="app-shell clients-shell" style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
      <Sidebar />
      <main className="clients-main" style={{ flex: 1, display: 'flex', overflow: 'hidden', height: '100vh', minWidth: 0 }}>

        {/* ── LEWA KOLUMNA: lista ── */}
        <div style={{ width: 360, borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', background: '#ffffff', boxShadow: '8px 0 24px rgba(15,107,63,0.06)' }}>
          {/* Nagłówek */}
          <div style={{ padding: '20px 16px 14px', borderBottom: '1px solid rgba(15,107,63,0.12)', background: 'linear-gradient(135deg, rgba(240,247,242,0.98), #ffffff)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Klienci</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {klienci.length} rekordów
                </p>
              </div>
              <button onClick={openAddForm} style={btn.primary}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Nowy
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={szukaj}
                onChange={e => setSzukaj(e.target.value)}
                placeholder="Szukaj klienta..."
                style={{ ...inp.base, paddingLeft: 32, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} style={inp.base}>
                <option value="">Wszystkie segmenty</option>
                {SEGMENTY.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
              </select>
              <input
                value={tagFilter}
                onChange={e => setTagFilter(e.target.value)}
                placeholder="Tag"
                style={inp.base}
              />
            </div>
          </div>

          {/* Lista */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Ładowanie...</div>
            ) : klienci.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>👤</div>
                <p>Brak klientów</p>
              </div>
            ) : klienci.map(k => (
              <div
                key={k.id}
                onClick={() => loadDetail(k.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected === k.id ? 'var(--accent-surface)' : '#ffffff',
                  borderLeft: `3px solid ${selected === k.id ? 'var(--accent)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 2 }}>
                      {k.imie} {k.nazwisko}
                      {k.firma && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>· {k.firma}</span>}
                    </div>
                    {k.telefon && (
                      <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                        {telHref(k.telefon) ? (
                          <a href={telHref(k.telefon)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                            {k.telefon}
                          </a>
                        ) : (
                          k.telefon
                        )}
                      </div>
                    )}
                    {k.miasto && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{k.miasto}</div>
                    )}
                    {(k.segment || (Array.isArray(k.tags) && k.tags.length > 0)) && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                        {k.segment ? <span style={miniPill}>{k.segment}</span> : null}
                        {(Array.isArray(k.tags) ? k.tags.slice(0, 3) : []).map((tag) => (
                          <span key={tag} style={miniPill}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {Number(k.liczba_zlecen) > 0 && (
                      <span style={{ fontSize: 10, background: 'var(--accent-surface)', color: 'var(--accent-dk)', border: '1px solid var(--logo-tint-border)', borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
                        {k.liczba_zlecen} zleceń
                      </span>
                    )}
                    {Number(k.liczba_ogledzen) > 0 && (
                      <span style={{ fontSize: 10, background: 'var(--accent-surface)', color: 'var(--accent-dk)', border: '1px solid var(--logo-tint-border)', borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
                        {k.liczba_ogledzen} ogl.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── PRAWA KOLUMNA: szczegóły ── */}
        <div style={{ flex: 1, overflowY: 'auto', background: 'transparent' }}>
          {!selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" style={{ opacity: 0.3, marginBottom: 16 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <p style={{ fontSize: 14 }}>Wybierz klienta z listy</p>
            </div>
          ) : detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              Ładowanie...
            </div>
          ) : detail && (
            <div style={{ maxWidth: 1040, margin: '0 auto', padding: 28 }}>

              {/* Nagłówek szczegółów */}
              <div className="clients-client-hero" style={sec.clientHero}>
                <div>
                  <div style={sec.eyebrow}>Paszport klienta</div>
                  <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.08, fontWeight: 950, color: '#ffffff' }}>
                    {detail.imie} {detail.nazwisko}
                  </h1>
                  {detail.firma && <p style={{ margin: '6px 0 0', fontSize: 14, color: '#bbf7d0', fontWeight: 850 }}>{detail.firma}</p>}
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(240,253,244,0.78)', fontWeight: 750 }}>
                    Klient od {fmt(detail.created_at)}
                    {detail.created_by_nazwa && ` · dodał ${detail.created_by_nazwa}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => navigate(`/ogledziny?klient=${detail.id}`)}
                    style={btn.secondary}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    Zaplanuj oględziny
                  </button>
                  <button onClick={openEditForm} style={btn.secondary}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edytuj
                  </button>
                  {canDelete && (
                    <button onClick={handleDelete} style={btn.danger}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      Usuń
                    </button>
                  )}
                </div>
              </div>

              {/* Karty z danymi */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, marginBottom: 24 }}>
                <Card title="Kontakt">
                  <Row
                    label="Telefon"
                    value={
                      detail.telefon
                        ? telHref(detail.telefon)
                          ? (
                              <a href={telHref(detail.telefon)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                                {detail.telefon}
                              </a>
                            )
                          : detail.telefon
                        : null
                    }
                  />
                  <Row label="Email" value={detail.email} />
                  <Row label="Adres" value={detail.adres} />
                  <Row label="Miasto" value={detail.miasto} />
                  <Row label="Kod poczt." value={detail.kod_pocztowy} />
                </Card>
                <Card title="Informacje">
                  <Row label="Źródło" value={detail.zrodlo} />
                  <Row label="Segment" value={detail.segment} />
                  <Row label="Zlecenia" value={detail.zlecenia?.length || 0} />
                  <Row label="Oględziny" value={detail.ogledziny?.length || 0} />
                  {detail.notatki && <Row label="Notatki" value={detail.notatki} />}
                </Card>
                <Card title="CRM">
                  {Array.isArray(detail.tags) && detail.tags.length > 0 ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {detail.tags.map((tag) => <span key={tag} style={tagPill}>#{tag}</span>)}
                    </div>
                  ) : (
                    <Row label="Tagi" value="—" />
                  )}
                  {detail.custom_fields && typeof detail.custom_fields === 'object' && Object.keys(detail.custom_fields).length > 0 ? (
                    Object.entries(detail.custom_fields).map(([key, value]) => (
                      <Row key={key} label={key} value={String(value ?? '—')} />
                    ))
                  ) : (
                    <Row label="Pola własne" value="—" />
                  )}
                </Card>
              </div>

              <section style={{ ...sec.wrap, marginBottom: 24 }}>
                <div style={sec.header}>
                  <span style={sec.title}>{t('kommoCrm.klientSectionTitle')}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
                  {t('kommoCrm.klientSectionHint')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" onClick={pushKlientKommo} disabled={pushingKlientKommo} style={btn.secondary}>
                    {pushingKlientKommo ? '…' : t('kommoCrm.push')}
                  </button>
                  <button type="button" onClick={toggleKlientKommoPayload} style={btn.secondary}>
                    {showKlientKommoPayload ? t('kommoCrm.hidePayload') : t('kommoCrm.showPayload')}
                  </button>
                  {showKlientKommoPayload && (
                    <button
                      type="button"
                      onClick={loadKlientKommoPayload}
                      disabled={loadingKlientKommoPayload}
                      style={btn.secondary}
                    >
                      {loadingKlientKommoPayload ? '…' : t('kommoCrm.refreshPayload')}
                    </button>
                  )}
                </div>
                {detail.kommo_last_sync_at ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
                    {t('kommoCrm.lastSync')}{' '}
                    {new Date(detail.kommo_last_sync_at).toLocaleString()}
                    {detail.kommo_last_sync_status === 'ok' ? ' · OK' : ''}
                    {detail.kommo_last_sync_error ? ` · ${detail.kommo_last_sync_error}` : ''}
                  </p>
                ) : null}
                {showKlientKommoPayload && (
                  <pre
                    style={{
                      marginTop: 12,
                      fontSize: 11,
                      overflow: 'auto',
                      maxHeight: 240,
                      padding: 12,
                      background: 'var(--surface-field)',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                    }}
                  >
                    {loadingKlientKommoPayload ? '…' : klientKommoPayload ? JSON.stringify(klientKommoPayload, null, 2) : '—'}
                  </pre>
                )}
              </section>

              {/* Historia oględzin */}
              {detail.ogledziny?.length > 0 && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <span style={sec.title}>Oględziny ({detail.ogledziny.length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detail.ogledziny.map(o => (
                      <div key={o.id} style={sec.row}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                            {o.data_planowana ? new Date(o.data_planowana).toLocaleString('pl-PL') : 'Brak daty'}
                            {o.adres && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>{o.adres}, {o.miasto}</span>}
                          </div>
                          {o.brygadzista_nazwa && (
                            <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Brygadzista: {o.brygadzista_nazwa}</div>
                          )}
                        </div>
                        <span style={{ ...badge, background: statusColor(o.status) + '22', color: statusColor(o.status) }}>
                          {o.status?.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Historia zleceń */}
              {detail.zlecenia?.length > 0 && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                    <span style={sec.title}>Zlecenia ({detail.zlecenia.length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detail.zlecenia.map(z => (
                      <div
                        key={z.id}
                        onClick={() => navigate(`/zlecenia/${z.id}`)}
                        style={{ ...sec.row, cursor: 'pointer' }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                            #{z.id} · {z.typ_uslugi || 'Zlecenie'}
                            {z.adres && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>{z.adres}, {z.miasto}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {fmt(z.data_planowana)}
                            {z.ekipa_nazwa && <span style={{ marginLeft: 8 }}>· {z.ekipa_nazwa}</span>}
                            {z.wartosc_planowana && <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 600 }}>{fmtPln(z.wartosc_planowana)}</span>}
                          </div>
                        </div>
                        <span style={{ ...badge, background: taskStatusColor(z.status) + '22', color: taskStatusColor(z.status) }}>
                          {z.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

            </div>
          )}
        </div>
      </main>

      {/* ── MODAL: formularz ── */}
      {showForm && (
        <div style={modal.overlay} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={modal.box}>
            <div style={modal.header}>
              <h3 style={modal.title}>{editMode ? 'Edytuj klienta' : 'Nowy klient'}</h3>
              <button onClick={() => setShowForm(false)} style={modal.closeBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 120px)', padding: '4px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12, padding: '0 24px 20px' }}>
                <FormField label="Imię">
                  <input style={inp.base} value={form.imie} onChange={e => setForm(f => ({ ...f, imie: e.target.value }))} placeholder="Jan" />
                </FormField>
                <FormField label="Nazwisko">
                  <input style={inp.base} value={form.nazwisko} onChange={e => setForm(f => ({ ...f, nazwisko: e.target.value }))} placeholder="Kowalski" />
                </FormField>
                <FormField label="Firma" style={{ gridColumn: '1 / -1' }}>
                  <input style={inp.base} value={form.firma} onChange={e => setForm(f => ({ ...f, firma: e.target.value }))} placeholder="Nazwa firmy (opcjonalne)" />
                </FormField>
                <FormField label="Telefon *">
                  <input style={inp.base} value={form.telefon} onChange={e => setForm(f => ({ ...f, telefon: e.target.value }))} placeholder="+48 000 000 000" />
                </FormField>
                <FormField label="Email">
                  <input style={inp.base} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jan@firma.pl" />
                </FormField>
                <FormField label="Adres" style={{ gridColumn: '1 / -1' }}>
                  <input style={inp.base} value={form.adres} onChange={e => setForm(f => ({ ...f, adres: e.target.value }))} placeholder="ul. Leśna 1" />
                </FormField>
                <FormField label="Miasto">
                  <CityInput
                    style={inp.base}
                    value={form.miasto}
                    onChange={e => setForm(f => ({ ...f, miasto: e.target.value }))}
                    placeholder="Warszawa"
                    extraCities={klienci.map((k) => k.miasto)}
                  />
                </FormField>
                <FormField label="Kod pocztowy">
                  <input style={inp.base} value={form.kod_pocztowy} onChange={e => setForm(f => ({ ...f, kod_pocztowy: e.target.value }))} placeholder="00-000" />
                </FormField>
                <FormField label="Źródło kontaktu" style={{ gridColumn: '1 / -1' }}>
                  <select style={inp.base} value={form.zrodlo} onChange={e => setForm(f => ({ ...f, zrodlo: e.target.value }))}>
                    {ZRODLA.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </FormField>
                <FormField label="Segment">
                  <select style={inp.base} value={form.segment} onChange={e => setForm(f => ({ ...f, segment: e.target.value }))}>
                    <option value="">Brak segmentu</option>
                    {SEGMENTY.map(segment => <option key={segment} value={segment}>{segment}</option>)}
                  </select>
                </FormField>
                <FormField label="Tagi">
                  <input style={inp.base} value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="np. premium, ogrod, pilne" />
                </FormField>
                <FormField label="Pola własne" style={{ gridColumn: '1 / -1' }}>
                  <textarea
                    style={{ ...inp.base, resize: 'vertical', minHeight: 76 }}
                    value={form.custom_fields}
                    onChange={e => setForm(f => ({ ...f, custom_fields: e.target.value }))}
                    placeholder={'Budzet: 12000\nPreferowany kanal: WhatsApp'}
                  />
                </FormField>
                <FormField label="Notatki" style={{ gridColumn: '1 / -1' }}>
                  <textarea style={{ ...inp.base, resize: 'vertical', minHeight: 80 }} value={form.notatki} onChange={e => setForm(f => ({ ...f, notatki: e.target.value }))} placeholder="Dodatkowe informacje o kliencie..." />
                </FormField>
              </div>
            </div>
            <div style={modal.footer}>
              <button onClick={() => setShowForm(false)} style={btn.secondaryGhost}>Anuluj</button>
              <button onClick={handleSave} disabled={saving} style={btn.primary}>
                {saving ? 'Zapisuję...' : editMode ? 'Zapisz zmiany' : 'Dodaj klienta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pomocnicze komponenty ────────────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 8, border: '1px solid var(--glass-border)', padding: 16, boxShadow: 'var(--shadow-md)' }}>
      <div style={{ fontSize: 11, fontWeight: 950, color: 'var(--text-muted)', letterSpacing: 0, marginBottom: 12, textTransform: 'uppercase' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function FormField({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</label>
      {children}
    </div>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
const btn = {
  primary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
    background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.22)', borderRadius: 8,
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  secondary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
    background: '#ffffff', color: 'var(--accent-dk)', border: '1px solid rgba(15,107,63,0.18)',
    borderRadius: 8, fontSize: 12, fontWeight: 850, cursor: 'pointer',
  },
  secondaryGhost: {
    padding: '9px 18px', background: '#ffffff', color: 'var(--text-sub)',
    border: '1px solid rgba(15,107,63,0.18)', borderRadius: 8, fontSize: 13, fontWeight: 850, cursor: 'pointer',
  },
  danger: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
    background: 'rgba(248,113,113,0.12)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
};

const inp = {
  base: {
    width: '100%', minHeight: 40, padding: '9px 11px', background: '#ffffff',
    border: '1px solid rgba(15,107,63,0.18)', borderRadius: 8,
    color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
};

const sec = {
  clientHero: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 18,
    padding: 18,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'linear-gradient(135deg, #0B3825 0%, #0F5F3A 58%, #168A4A 100%)',
    boxShadow: '0 22px 46px rgba(11,56,37,0.16)',
  },
  eyebrow: {
    color: '#86efac',
    fontSize: 11,
    fontWeight: 950,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  wrap: { background: '#ffffff', borderRadius: 8, border: '1px solid var(--glass-border)', padding: 16, marginBottom: 16, boxShadow: 'var(--shadow-md)' },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    background: '#ffffff', borderRadius: 8, border: '1px solid rgba(15,107,63,0.14)',
    transition: 'background 0.15s',
  },
};

const badge = {
  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8, whiteSpace: 'nowrap',
};

const miniPill = {
  fontSize: 10,
  background: 'rgba(20,131,79,0.08)',
  color: 'var(--accent-dk)',
  border: '1px solid rgba(20,131,79,0.18)',
  borderRadius: 6,
  padding: '2px 6px',
  fontWeight: 800,
};

const tagPill = {
  ...miniPill,
  fontSize: 12,
  padding: '4px 8px',
};

const modal = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(6,16,11,0.68)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 500,
  },
  box: {
    width: '90%', maxWidth: 640, background: '#ffffff',
    borderRadius: 8, border: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column',
    maxHeight: '90vh',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' },
  footer: {
    padding: '16px 24px', borderTop: '1px solid var(--border)',
    display: 'flex', justifyContent: 'flex-end', gap: 10,
  },
};
