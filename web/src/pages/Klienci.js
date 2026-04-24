import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import CityInput from '../components/CityInput';
import api from '../api';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

const ZRODLA = ['telefon', 'polecenie', 'internet', 'social media', 'wizytówka', 'inne'];

export default function Klienci() {
  const navigate = useNavigate();
  const [klienci, setKlienci] = useState([]);
  const [loading, setLoading] = useState(true);
  const [szukaj, setSzukaj] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    imie: '', nazwisko: '', firma: '', telefon: '', email: '',
    adres: '', miasto: '', kod_pocztowy: '', notatki: '', zrodlo: 'telefon',
  });

  const currentUser = getLocalStorageJson('user', {});
  const canDelete = ['Dyrektor', 'Administrator'].includes(currentUser.rola);

  const loadKlienci = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (szukaj) params.szukaj = szukaj;
      const res = await api.get('/klienci', { params });
      setKlienci(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [szukaj]);

  useEffect(() => { loadKlienci(); }, [loadKlienci]);

  const loadDetail = async (id) => {
    setSelected(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/klienci/${id}`);
      setDetail(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const openAddForm = () => {
    setForm({ imie: '', nazwisko: '', firma: '', telefon: '', email: '', adres: '', miasto: '', kod_pocztowy: '', notatki: '', zrodlo: 'telefon' });
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
    });
    setEditMode(true);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.telefon && !form.email) { alert('Podaj telefon lub email'); return; }
    setSaving(true);
    try {
      if (editMode && selected) {
        await api.put(`/klienci/${selected}`, form);
      } else {
        await api.post('/klienci', form);
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
    'Zaplanowane': '#60A5FA', 'W_Trakcie': '#FBBF24',
    'Zakonczone': 'var(--accent)', 'Anulowane': '#F87171',
  }[s] || '#94A3B8');

  const taskStatusColor = (s) => ({
    'Nowe': '#60A5FA', 'W_Trakcie': '#FBBF24', 'Zakończone': 'var(--accent)',
    'Anulowane': '#F87171', 'Wstrzymane': '#94a3b8',
  }[s] || '#94A3B8');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', height: '100vh' }}>

        {/* ── LEWA KOLUMNA: lista ── */}
        <div style={{ width: 340, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)' }}>
          {/* Nagłówek */}
          <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
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
                  background: selected === k.id ? 'rgba(52,211,153,0.07)' : 'transparent',
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
                      <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{k.telefon}</div>
                    )}
                    {k.miasto && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{k.miasto}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {Number(k.liczba_zlecen) > 0 && (
                      <span style={{ fontSize: 10, background: 'rgba(52,211,153,0.15)', color: 'var(--accent)', borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
                        {k.liczba_zlecen} zleceń
                      </span>
                    )}
                    {Number(k.liczba_ogledzen) > 0 && (
                      <span style={{ fontSize: 10, background: 'rgba(96,165,250,0.15)', color: '#60A5FA', borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
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
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
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
            <div style={{ maxWidth: 860, margin: '0 auto', padding: 28 }}>

              {/* Nagłówek szczegółów */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
                    {detail.imie} {detail.nazwisko}
                  </h1>
                  {detail.firma && <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--accent)' }}>{detail.firma}</p>}
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Klient od {fmt(detail.created_at)}
                    {detail.created_by_nazwa && ` · dodał ${detail.created_by_nazwa}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => navigate(`/ogledziny/nowe?klient=${detail.id}`)}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <Card title="Kontakt">
                  <Row label="Telefon" value={detail.telefon} />
                  <Row label="Email" value={detail.email} />
                  <Row label="Adres" value={detail.adres} />
                  <Row label="Miasto" value={detail.miasto} />
                  <Row label="Kod poczt." value={detail.kod_pocztowy} />
                </Card>
                <Card title="Informacje">
                  <Row label="Źródło" value={detail.zrodlo} />
                  <Row label="Zlecenia" value={detail.zlecenia?.length || 0} />
                  <Row label="Oględziny" value={detail.ogledziny?.length || 0} />
                  {detail.notatki && <Row label="Notatki" value={detail.notatki} />}
                </Card>
              </div>

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
      </div>

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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 24px 20px' }}>
                <FormField label="Imię">
                  <input style={inp.base} value={form.imie} onChange={e => setForm(f => ({ ...f, imie: e.target.value }))} placeholder="Jan" />
                </FormField>
                <FormField label="Nazwisko">
                  <input style={inp.base} value={form.nazwisko} onChange={e => setForm(f => ({ ...f, nazwisko: e.target.value }))} placeholder="Kowalski" />
                </FormField>
                <FormField label="Firma" style={{ gridColumn: 'span 2' }}>
                  <input style={inp.base} value={form.firma} onChange={e => setForm(f => ({ ...f, firma: e.target.value }))} placeholder="Nazwa firmy (opcjonalne)" />
                </FormField>
                <FormField label="Telefon *">
                  <input style={inp.base} value={form.telefon} onChange={e => setForm(f => ({ ...f, telefon: e.target.value }))} placeholder="+48 000 000 000" />
                </FormField>
                <FormField label="Email">
                  <input style={inp.base} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jan@firma.pl" />
                </FormField>
                <FormField label="Adres" style={{ gridColumn: 'span 2' }}>
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
                <FormField label="Źródło kontaktu" style={{ gridColumn: 'span 2' }}>
                  <select style={inp.base} value={form.zrodlo} onChange={e => setForm(f => ({ ...f, zrodlo: e.target.value }))}>
                    {ZRODLA.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </FormField>
                <FormField label="Notatki" style={{ gridColumn: 'span 2' }}>
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
    <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>{title}</div>
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
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
const btn = {
  primary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
    background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 9,
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  secondary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
    background: 'var(--bg-deep)', color: 'var(--text-sub)', border: '1px solid var(--border)',
    borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  secondaryGhost: {
    padding: '9px 18px', background: 'transparent', color: 'var(--text-sub)',
    border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  danger: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
    background: 'rgba(248,113,113,0.12)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
};

const inp = {
  base: {
    width: '100%', padding: '9px 11px', background: 'var(--input-bg)',
    border: '1px solid var(--input-border)', borderRadius: 9,
    color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
};

const sec = {
  wrap: { background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16, marginBottom: 16 },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    background: 'var(--bg-deep)', borderRadius: 10, border: '1px solid var(--border)',
    transition: 'background 0.15s',
  },
};

const badge = {
  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8, whiteSpace: 'nowrap',
};

const modal = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 500,
  },
  box: {
    width: '90%', maxWidth: 600, background: 'var(--bg-card)',
    borderRadius: 18, border: '1px solid var(--border)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
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
