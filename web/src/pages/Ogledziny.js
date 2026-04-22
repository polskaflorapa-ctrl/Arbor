import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import CityInput from '../components/CityInput';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

const STATUSY = ['Zaplanowane', 'W_Trakcie', 'Zakonczone', 'Anulowane'];

const STATUS_COLOR = {
  Zaplanowane: '#60A5FA',
  W_Trakcie:   '#FBBF24',
  Zakonczone:  'var(--accent)',
  Anulowane:   '#F87171',
};

const STATUS_LABEL = {
  Zaplanowane: 'Zaplanowane',
  W_Trakcie:  'W trakcie',
  Zakonczone:  'Zakończone',
  Anulowane:   'Anulowane',
};

export default function Ogledziny() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [klienciList, setKlienciList] = useState([]);
  const [brygadList, setBrygadList] = useState([]);

  const [form, setForm] = useState({
    klient_id: searchParams.get('klient') || '',
    brygadzista_id: '',
    data_planowana: '',
    adres: '',
    miasto: '',
    notatki: '',
  });

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusNotatki, setStatusNotatki] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const currentUser = getLocalStorageJson('user', {});
  const canManage = ['Dyrektor', 'Administrator', 'Kierownik'].includes(currentUser.rola);
  const canPlan = canManage || currentUser.rola === 'Specjalista';

  const loadLista = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const res = await api.get('/ogledziny', { params });
      setLista(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { loadLista(); }, [loadLista]);

  // Otwórz od razu formularz jeśli ?klient= w URL
  useEffect(() => {
    if (searchParams.get('klient')) {
      loadSelectData();
      setShowForm(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSelectData = async () => {
    try {
      const [kRes, bRes] = await Promise.all([
        api.get('/klienci'),
        api.get('/uzytkownicy?rola=Brygadzista').catch(() => api.get('/uzytkownicy')),
      ]);
      setKlienciList(kRes.data);
      const workers = bRes.data.filter(u => u.rola === 'Brygadzista' || u.rola === 'Kierownik' || u.rola === 'Administrator');
      setBrygadList(workers);
    } catch (e) {
      console.error(e);
    }
  };

  const openForm = async () => {
    await loadSelectData();
    setForm({ klient_id: '', brygadzista_id: '', data_planowana: '', adres: '', miasto: '', notatki: '' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.klient_id) { alert('Wybierz klienta'); return; }
    setSaving(true);
    try {
      await api.post('/ogledziny', {
        ...form,
        klient_id: Number(form.klient_id),
        brygadzista_id: form.brygadzista_id ? Number(form.brygadzista_id) : null,
      });
      setShowForm(false);
      loadLista();
    } catch (e) {
      alert('Błąd: ' + getApiErrorMessage(e, e.message));
    } finally {
      setSaving(false);
    }
  };

  const loadDetail = async (id) => {
    setSelected(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/ogledziny/${id}`);
      setDetail(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleChangeStatus = async () => {
    if (!newStatus) return;
    setStatusSaving(true);
    try {
      await api.put(`/ogledziny/${selected}/status`, { status: newStatus, notatki_wyniki: statusNotatki || null });
      setShowStatusModal(false);
      loadDetail(selected);
      loadLista();
    } catch (e) {
      alert('Błąd: ' + getApiErrorMessage(e, e.message));
    } finally {
      setStatusSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm('Usunąć te oględziny?')) return;
    try {
      await api.delete(`/ogledziny/${selected}`);
      setSelected(null);
      setDetail(null);
      loadLista();
    } catch (e) {
      alert('Błąd: ' + getApiErrorMessage(e, e.message));
    }
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('pl-PL') : '—';
  const fmtDt = (d) => d ? new Date(d).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Brak daty';
  const fmtPln = (v) => v != null ? `${Number(v).toLocaleString('pl-PL')} zł` : '—';

  const sc = (s) => STATUS_COLOR[s] || '#94A3B8';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', height: '100vh' }}>

        {/* ── LEWA KOLUMNA: lista ── */}
        <div style={{ width: 360, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)' }}>

          {/* Nagłówek */}
          <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Oględziny</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{lista.length} rekordów</p>
              </div>
              {canPlan && (
                <button onClick={openForm} style={btn.primary}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Nowe
                </button>
              )}
            </div>

            {/* Filtry statusów */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip active={filterStatus === ''} onClick={() => setFilterStatus('')} color="var(--accent)">Wszystkie</Chip>
              {STATUSY.map(s => (
                <Chip key={s} active={filterStatus === s} onClick={() => setFilterStatus(s)} color={sc(s)}>
                  {STATUS_LABEL[s]}
                </Chip>
              ))}
            </div>
          </div>

          {/* Lista */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Ładowanie...</div>
            ) : lista.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>🔍</div>
                <p>Brak oględzin</p>
              </div>
            ) : lista.map(o => (
              <div
                key={o.id}
                onClick={() => loadDetail(o.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected === o.id ? 'rgba(52,211,153,0.07)' : 'transparent',
                  borderLeft: `3px solid ${selected === o.id ? 'var(--accent)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                      {o.klient_nazwa?.trim() || 'Klient nieznany'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 2 }}>
                      {fmtDt(o.data_planowana)}
                    </div>
                    {o.adres && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {o.adres}{o.miasto ? `, ${o.miasto}` : ''}
                      </div>
                    )}
                    {o.brygadzista_nazwa && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        👷 {o.brygadzista_nazwa}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 7,
                    background: sc(o.status) + '22', color: sc(o.status),
                    whiteSpace: 'nowrap', marginLeft: 8,
                  }}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
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
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p style={{ fontSize: 14 }}>Wybierz oględziny z listy</p>
            </div>
          ) : detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Ładowanie...</div>
          ) : detail && (
            <div style={{ maxWidth: 820, margin: '0 auto', padding: 28 }}>

              {/* Nagłówek */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
                      Oględziny #{detail.id}
                    </h1>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 9,
                      background: sc(detail.status) + '22', color: sc(detail.status),
                    }}>
                      {STATUS_LABEL[detail.status] || detail.status}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sub)' }}>
                    {detail.klient_nazwa?.trim()}
                    {detail.klient_telefon && <span style={{ marginLeft: 8 }}>· {detail.klient_telefon}</span>}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Dodał: {detail.created_by_nazwa} · {fmt(detail.created_at)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {detail.klient_id && (
                    <button onClick={() => navigate(`/klienci`)} style={btn.secondary}>
                      Profil klienta
                    </button>
                  )}
                  <button
                    onClick={() => { setNewStatus(detail.status); setStatusNotatki(detail.notatki_wyniki || ''); setShowStatusModal(true); }}
                    style={btn.secondary}
                  >
                    Zmień status
                  </button>
                  {canManage && (
                    <button onClick={handleDelete} style={btn.danger}>Usuń</button>
                  )}
                </div>
              </div>

              {/* Karty */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <Card title="Termin i lokalizacja">
                  <Row label="Data" value={fmtDt(detail.data_planowana)} />
                  <Row label="Adres" value={detail.adres} />
                  <Row label="Miasto" value={detail.miasto} />
                </Card>
                <Card title="Przypisanie">
                  <Row label="Brygadzista" value={detail.brygadzista_nazwa} />
                  <Row label="Klient firma" value={detail.klient_firma} />
                  <Row label="Tel. klienta" value={detail.klient_telefon} />
                  <Row label="Email klienta" value={detail.klient_email} />
                </Card>
              </div>

              {detail.notatki && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={sec.title}>Notatki</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{detail.notatki}</p>
                </section>
              )}

              {detail.notatki_wyniki && (
                <section style={{ ...sec.wrap, borderColor: 'rgba(52,211,153,0.3)' }}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style={sec.title}>Wyniki oględzin</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{detail.notatki_wyniki}</p>
                </section>
              )}

              {/* Powiązana wycena */}
              {detail.wycena_id && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                    <span style={sec.title}>Powiązana wycena</span>
                  </div>
                  <div style={sec.row}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                        Wycena #{detail.wycena_id}
                        {detail.wartosc_szacowana && (
                          <span style={{ color: 'var(--accent)', marginLeft: 8 }}>{fmtPln(detail.wartosc_szacowana)}</span>
                        )}
                      </div>
                      {detail.wycena_opis && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{detail.wycena_opis}</div>
                      )}
                    </div>
                    {detail.wycena_status && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8,
                        background: 'rgba(52,211,153,0.15)', color: 'var(--accent)' }}>
                        {detail.wycena_status}
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* Zdjęcia */}
              {detail.zdjecia?.length > 0 && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span style={sec.title}>Zdjęcia ({detail.zdjecia.length})</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                    {detail.zdjecia.map(z => (
                      <a key={z.id} href={z.url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={z.url}
                          alt=""
                          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
                        />
                      </a>
                    ))}
                  </div>
                </section>
              )}

            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: nowe oględziny ── */}
      {showForm && (
        <div style={modal.overlay} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={modal.box}>
            <div style={modal.header}>
              <h3 style={modal.title}>Zaplanuj oględziny</h3>
              <button onClick={() => setShowForm(false)} style={modal.closeBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 120px)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '16px 24px 20px' }}>
                <FormField label="Klient *" style={{ gridColumn: 'span 2' }}>
                  <select style={inp.base} value={form.klient_id} onChange={e => {
                    const k = klienciList.find(k => k.id === Number(e.target.value));
                    setForm(f => ({
                      ...f,
                      klient_id: e.target.value,
                      adres: k?.adres || f.adres,
                      miasto: k?.miasto || f.miasto,
                    }));
                  }}>
                    <option value="">— wybierz klienta —</option>
                    {klienciList.map(k => (
                      <option key={k.id} value={k.id}>
                        {k.imie} {k.nazwisko}{k.firma ? ` (${k.firma})` : ''} {k.telefon ? `· ${k.telefon}` : ''}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Brygadzista" style={{ gridColumn: 'span 2' }}>
                  <select style={inp.base} value={form.brygadzista_id} onChange={e => setForm(f => ({ ...f, brygadzista_id: e.target.value }))}>
                    <option value="">— nieprzypisany —</option>
                    {brygadList.map(u => (
                      <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({u.rola})</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Data i godzina" style={{ gridColumn: 'span 2' }}>
                  <input type="datetime-local" style={inp.base} value={form.data_planowana}
                    onChange={e => setForm(f => ({ ...f, data_planowana: e.target.value }))} />
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Tylko termin wizyty u klienta — bez ceny i bez terminu realizacji zlecenia. Wycena i harmonogram brygad powstają później u wyceniającego.
                  </p>
                </FormField>
                <FormField label="Adres">
                  <input style={inp.base} value={form.adres}
                    onChange={e => setForm(f => ({ ...f, adres: e.target.value }))} placeholder="ul. Leśna 1" />
                </FormField>
                <FormField label="Miasto">
                  <CityInput
                    style={inp.base}
                    value={form.miasto}
                    onChange={e => setForm(f => ({ ...f, miasto: e.target.value }))}
                    placeholder="Warszawa"
                    extraCities={klienciList.map((k) => k.miasto)}
                  />
                </FormField>
                <FormField label="Notatki" style={{ gridColumn: 'span 2' }}>
                  <textarea style={{ ...inp.base, resize: 'vertical', minHeight: 70 }} value={form.notatki}
                    onChange={e => setForm(f => ({ ...f, notatki: e.target.value }))}
                    placeholder="Dodatkowe informacje dla brygadzisty..." />
                </FormField>
              </div>
            </div>
            <div style={modal.footer}>
              <button onClick={() => setShowForm(false)} style={btn.secondaryGhost}>Anuluj</button>
              <button onClick={handleSave} disabled={saving} style={btn.primary}>
                {saving ? 'Zapisuję...' : 'Zaplanuj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: zmiana statusu ── */}
      {showStatusModal && (
        <div style={modal.overlay} onClick={e => { if (e.target === e.currentTarget) setShowStatusModal(false); }}>
          <div style={{ ...modal.box, maxWidth: 420 }}>
            <div style={modal.header}>
              <h3 style={modal.title}>Zmień status oględzin</h3>
              <button onClick={() => setShowStatusModal(false)} style={modal.closeBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {STATUSY.map(s => (
                  <button
                    key={s}
                    onClick={() => setNewStatus(s)}
                    style={{
                      padding: '10px 14px', borderRadius: 10, border: `2px solid ${newStatus === s ? sc(s) : 'var(--border)'}`,
                      background: newStatus === s ? sc(s) + '18' : 'var(--bg-deep)',
                      color: newStatus === s ? sc(s) : 'var(--text-sub)',
                      fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <FormField label="Notatki z wyników (opcjonalne)">
                <textarea
                  style={{ ...inp.base, resize: 'vertical', minHeight: 80 }}
                  value={statusNotatki}
                  onChange={e => setStatusNotatki(e.target.value)}
                  placeholder="Co ustalono na oględzinach?"
                />
              </FormField>
            </div>
            <div style={modal.footer}>
              <button onClick={() => setShowStatusModal(false)} style={btn.secondaryGhost}>Anuluj</button>
              <button onClick={handleChangeStatus} disabled={statusSaving || !newStatus} style={btn.primary}>
                {statusSaving ? 'Zapisuję...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pomocnicze komponenty ────────────────────────────────────────────────────
function Chip({ children, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 11px', borderRadius: 8, border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? color + '18' : 'transparent',
        color: active ? color : 'var(--text-muted)',
        fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

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
    padding: '7px 13px', background: 'rgba(248,113,113,0.12)', color: '#F87171',
    border: '1px solid rgba(248,113,113,0.3)', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
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
  wrap: {
    background: 'var(--bg-card)',
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: 16,
    marginBottom: 16,
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    background: 'var(--bg-deep)', borderRadius: 10, border: '1px solid var(--border)',
  },
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
