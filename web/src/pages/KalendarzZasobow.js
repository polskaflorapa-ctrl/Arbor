import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import Sidebar from '../components/Sidebar';

// ─── stałe ────────────────────────────────────────────────────────────────────
const ROW_H = 48;           // px — wysokość wiersza zasobu
const COL_W = 46;           // px — szerokość kolumny dnia
const HEADER_H = 56;        // px — nagłówek z datami
const LABEL_W = 200;        // px — lewa kolumna z nazwą sprzętu
const DNI_PL  = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
const MIESIACE = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze',
                  'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

const STATUS_COLOR = {
  Zarezerwowane: '#3b82f6',
  Wydane:        '#f59e0b',
  Zwrócone:      '#10b981',
  Anulowane:     '#6b7280',
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const toISO = (d) => d.toISOString().split('T')[0];

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a, b) {
  // dni między datami (a, b to stringi YYYY-MM-DD lub Date)
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}

function buildRange(anchor, days) {
  // zwraca tablicę Date — `days` dni zaczynając od poniedziałku tygodnia anchor
  const d = new Date(anchor);
  const dow = d.getDay();
  const pon = new Date(d);
  pon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: days }, (_, i) => addDays(pon, i));
}

// ─── modal nowej rezerwacji ───────────────────────────────────────────────────
function NowaRezerwacjaModal({ sprzet, ekipy, defaultSprzet, defaultDate, onSave, onClose, saving, error }) {
  const [form, setForm] = useState({
    sprzet_id:  String(defaultSprzet || ''),
    ekipa_id:   '',
    data_od:    defaultDate || toISO(new Date()),
    data_do:    defaultDate || toISO(new Date()),
    status:     'Zarezerwowane',
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={mStyles.panel} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Nowa rezerwacja sprzętu</h3>

        <label style={mStyles.label}>Sprzęt</label>
        <select style={mStyles.select} value={form.sprzet_id} onChange={e => set('sprzet_id', e.target.value)}>
          <option value="">— wybierz —</option>
          {sprzet.map(s => <option key={s.id} value={s.id}>{s.nazwa}{s.typ ? ` (${s.typ})` : ''}</option>)}
        </select>

        <label style={mStyles.label}>Ekipa</label>
        <select style={mStyles.select} value={form.ekipa_id} onChange={e => set('ekipa_id', e.target.value)}>
          <option value="">— wybierz —</option>
          {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={mStyles.label}>Od</label>
            <input type="date" style={mStyles.input} value={form.data_od} onChange={e => set('data_od', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={mStyles.label}>Do</label>
            <input type="date" style={mStyles.input} value={form.data_do} onChange={e => set('data_do', e.target.value)} />
          </div>
        </div>

        <label style={mStyles.label}>Status</label>
        <select style={mStyles.select} value={form.status} onChange={e => set('status', e.target.value)}>
          {['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {error && <div style={{ color: 'var(--error)', fontSize: 13, margin: '8px 0 0' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button style={mStyles.btnCancel} onClick={onClose}>Anuluj</button>
          <button style={mStyles.btnSave} disabled={saving}
            onClick={() => onSave(form)}>
            {saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

const mStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  panel:   { background: 'var(--bg-card)', borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 460, width: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
  label:   { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, marginTop: 12 },
  select:  { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 14 },
  input:   { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  btnCancel: { padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 14 },
  btnSave:   { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
};

// ─── podgląd/edycja istniejącej rezerwacji ────────────────────────────────────
function RezerwacjaDetailModal({ rez, ekipy, onStatusChange, onClose, saving }) {
  const [status, setStatus] = useState(rez.status);
  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={mStyles.panel} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Rezerwacja #{rez.id}</h3>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <div><b>Sprzęt:</b> {rez.sprzet_nazwa}</div>
          <div><b>Ekipa:</b> {rez.ekipa_nazwa}</div>
          <div><b>Od:</b> {rez.data_od?.slice(0,10)}</div>
          <div><b>Do:</b> {rez.data_do?.slice(0,10)}</div>
        </div>
        <label style={mStyles.label}>Status</label>
        <select style={mStyles.select} value={status} onChange={e => setStatus(e.target.value)}>
          {['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button style={mStyles.btnCancel} onClick={onClose}>Zamknij</button>
          <button style={mStyles.btnSave} disabled={saving || status === rez.status}
            onClick={() => onStatusChange(rez.id, status)}>
            {saving ? 'Zapisuję…' : 'Zapisz status'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── główny komponent ────────────────────────────────────────────────────────
export default function KalendarzZasobow() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [sprzet, setSprzet]   = useState([]);   // lista equipment_items
  const [ekipy, setEkipy]     = useState([]);
  const [rezerwacje, setRezerwacje] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rangeLen, setRangeLen] = useState(14);  // 14 lub 28 dni
  const [anchor, setAnchor]   = useState(new Date());
  const [msg, setMsg]         = useState('');
  const [msgType, setMsgType] = useState('ok');
  const [modalNew, setModalNew]  = useState(null);   // { sprzetId, date }
  const [modalDet, setModalDet]  = useState(null);   // rez object
  const [saving, setSaving]  = useState(false);
  const [modalErr, setModalErr]  = useState('');

  // drag & drop state (ref — nie triggeruje re-renderu)
  const drag = useRef(null);
  // highlight drop target
  const [dropTarget, setDropTarget] = useState(null); // { sprzetId, date }

  const canEdit = useMemo(() => {
    if (!currentUser) return false;
    return ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik'].includes(currentUser.rola);
  }, [currentUser]);

  // ─── zakres dat ──────────────────────────────────────────────────────────
  const days = useMemo(() => buildRange(anchor, rangeLen), [anchor, rangeLen]);
  const from = useMemo(() => toISO(days[0]), [days]);
  const to   = useMemo(() => toISO(days[days.length - 1]), [days]);

  const periodLabel = useMemo(() => {
    const a = days[0];
    const b = days[days.length - 1];
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()}–${b.getDate()} ${MIESIACE[a.getMonth()]} ${a.getFullYear()}`;
    }
    return `${a.getDate()} ${MIESIACE[a.getMonth()]} — ${b.getDate()} ${MIESIACE[b.getMonth()]} ${b.getFullYear()}`;
  }, [days]);

  const todayISO = toISO(new Date());

  // ─── ładowanie danych ─────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const h = authHeaders(token);
    setLoading(true);
    try {
      const [sRes, eRes] = await Promise.all([
        api.get('/flota/sprzet', { headers: h }),
        api.get('/ekipy', { headers: h }),
      ]);
      setSprzet(Array.isArray(sRes.data) ? sRes.data : sRes.data?.items || []);
      setEkipy(Array.isArray(eRes.data) ? eRes.data : eRes.data?.ekipy || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [navigate]);

  const loadRezerwacje = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    const h = authHeaders(token);
    try {
      const res = await api.get(`/flota/rezerwacje?from=${from}&to=${to}`, { headers: h });
      setRezerwacje(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRezerwacje([]);
    }
  }, [from, to]);

  useEffect(() => {
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    loadRezerwacje();
  }, [loadRezerwacje]);

  // ─── mapa: sprzetId → lista rezerwacji w zakresie ─────────────────────────
  const rezBySprzet = useMemo(() => {
    const map = {};
    for (const r of rezerwacje) {
      if (!map[r.sprzet_id]) map[r.sprzet_id] = [];
      map[r.sprzet_id].push(r);
    }
    return map;
  }, [rezerwacje]);

  // ─── nawigacja ────────────────────────────────────────────────────────────
  const prev = () => setAnchor(a => addDays(a, -rangeLen));
  const next = () => setAnchor(a => addDays(a, rangeLen));
  const goToday = () => setAnchor(new Date());

  // ─── flash message ────────────────────────────────────────────────────────
  const showMsg = (txt, type = 'ok') => {
    setMsg(txt); setMsgType(type);
    setTimeout(() => setMsg(''), 3000);
  };

  // ─── tworzenie rezerwacji ─────────────────────────────────────────────────
  const handleNewSave = async (form) => {
    if (!form.sprzet_id || !form.ekipa_id) {
      setModalErr('Wybierz sprzęt i ekipę.'); return;
    }
    setSaving(true); setModalErr('');
    try {
      const token = getStoredToken();
      await api.post('/flota/rezerwacje', {
        sprzet_id: Number(form.sprzet_id),
        ekipa_id:  Number(form.ekipa_id),
        data_od:   form.data_od,
        data_do:   form.data_do,
        status:    form.status,
      }, { headers: authHeaders(token) });
      setModalNew(null);
      showMsg('Rezerwacja dodana.');
      await loadRezerwacje();
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) setModalErr('Kolizja — sprzęt już zarezerwowany w tym terminie.');
      else setModalErr(code || 'Błąd zapisu.');
    } finally {
      setSaving(false);
    }
  };

  // ─── zmiana statusu ────────────────────────────────────────────────────────
  const handleStatusChange = async (id, status) => {
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/flota/rezerwacje/${id}/status`, { status }, { headers: authHeaders(token) });
      setModalDet(null);
      showMsg('Status zaktualizowany.');
      await loadRezerwacje();
    } catch {
      showMsg('Błąd zapisu statusu.', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ─── drag & drop ──────────────────────────────────────────────────────────
  const handleDragStart = (e, rez, dayISO) => {
    if (!canEdit) { e.preventDefault(); return; }
    drag.current = { rez, dragDayISO: dayISO };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rez.id));
  };

  const handleDragOver = (e, sprzetId, dayISO) => {
    if (!drag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ sprzetId, dayISO });
  };

  const handleDragLeave = () => setDropTarget(null);

  const handleDrop = async (e, sprzetId, dayISO) => {
    e.preventDefault();
    setDropTarget(null);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (String(sprzetId) !== String(d.rez.sprzet_id)) return; // tylko w obrębie tego samego sprzętu

    const delta = diffDays(d.dragDayISO, dayISO);
    if (delta === 0) return;

    const newOd = toISO(addDays(new Date(d.rez.data_od), delta));
    const newDo = toISO(addDays(new Date(d.rez.data_do), delta));

    try {
      const token = getStoredToken();
      await api.patch(`/flota/rezerwacje/${d.rez.id}`, { data_od: newOd, data_do: newDo }, { headers: authHeaders(token) });
      showMsg('Rezerwacja przesunięta.');
      await loadRezerwacje();
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) showMsg('Kolizja — termin zajęty.', 'err');
      else showMsg(code || 'Błąd przesunięcia.', 'err');
    }
  };

  // ─── renderowanie paska rezerwacji ────────────────────────────────────────
  // Zwraca element bar dla danej rezerwacji; oblicza pozycję i szerokość
  const renderBar = (rez, rowIndex) => {
    const rezOd = rez.data_od?.slice(0, 10);
    const rezDo = rez.data_do?.slice(0, 10);
    const firstISO = toISO(days[0]);
    const lastISO  = toISO(days[days.length - 1]);

    // Przytnij do widocznego zakresu
    const startISO = rezOd < firstISO ? firstISO : rezOd;
    const endISO   = rezDo > lastISO  ? lastISO  : rezDo;

    const colStart = diffDays(firstISO, startISO);
    const spanDays = diffDays(startISO, endISO) + 1;
    if (spanDays <= 0 || colStart >= days.length) return null;

    const left   = colStart * COL_W + 2;
    const width  = spanDays * COL_W - 4;
    const color  = STATUS_COLOR[rez.status] || '#6b7280';
    const isAnulowana = rez.status === 'Anulowane';

    return (
      <div
        key={rez.id}
        draggable={canEdit && !isAnulowana}
        onDragStart={(e) => handleDragStart(e, rez, startISO)}
        onClick={(e) => { e.stopPropagation(); setModalDet(rez); }}
        title={`${rez.sprzet_nazwa} | ${rez.ekipa_nazwa}\n${rezOd} → ${rezDo}\nStatus: ${rez.status}`}
        style={{
          position: 'absolute',
          left:     left,
          top:      (rowIndex * ROW_H) + 7,
          width:    width,
          height:   ROW_H - 14,
          background: color,
          borderRadius: 6,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          opacity: isAnulowana ? 0.45 : 1,
          cursor: canEdit && !isAnulowana ? 'grab' : 'pointer',
          userSelect: 'none',
          zIndex: 2,
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }}
      >
        {spanDays > 1 ? `${rez.ekipa_nazwa}` : ''}
      </div>
    );
  };

  // ─── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>Ładowanie kalendarza zasobów…</div>
      </div>
    );
  }

  const totalW = LABEL_W + days.length * COL_W;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── nagłówek strony ───────────────────────────────────────────── */}
        <div style={st.pageHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={st.navBtn} onClick={prev}>‹</button>
            <button style={st.todayBtn} onClick={goToday}>Dziś</button>
            <button style={st.navBtn} onClick={next}>›</button>
            <span style={st.periodLabel}>{periodLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              style={{ ...st.viewBtn, background: rangeLen === 14 ? 'var(--accent)' : 'var(--bg-card2)', color: rangeLen === 14 ? 'var(--on-accent)' : 'var(--text)' }}
              onClick={() => setRangeLen(14)}>2 tygodnie</button>
            <button
              style={{ ...st.viewBtn, background: rangeLen === 28 ? 'var(--accent)' : 'var(--bg-card2)', color: rangeLen === 28 ? 'var(--on-accent)' : 'var(--text)' }}
              onClick={() => setRangeLen(28)}>4 tygodnie</button>
          </div>
          <h2 style={st.pageTitle}>Kalendarz zasobów</h2>
        </div>

        {/* ── flash message ─────────────────────────────────────────────── */}
        {msg && (
          <div style={{ ...st.flash, background: msgType === 'ok' ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)', color: msgType === 'ok' ? '#065f46' : '#991b1b' }}>
            {msg}
          </div>
        )}

        {/* ── legenda statusów ──────────────────────────────────────────── */}
        <div style={st.legend}>
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <span key={s} style={st.legendItem}>
              <span style={{ ...st.legendDot, background: c }} />
              {s}
            </span>
          ))}
          {canEdit && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>Kliknij komórkę — nowa rezerwacja · Przeciągnij bar — zmień termin</span>}
        </div>

        {/* ── główna siatka ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ minWidth: totalW }}>

            {/* nagłówek dat */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
              {/* lewa kolumna — sprzęt */}
              <div style={{ width: LABEL_W, minWidth: LABEL_W, height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, fontWeight: 700, fontSize: 13, borderRight: '1px solid var(--border)', color: 'var(--text-muted)', flexShrink: 0 }}>
                Sprzęt / Zasób
              </div>
              {/* kolumny dni */}
              {days.map((d, i) => {
                const iso = toISO(d);
                const isToday = iso === todayISO;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const firstOfMonth = d.getDate() === 1;
                return (
                  <div key={iso} style={{
                    width: COL_W, minWidth: COL_W, height: HEADER_H,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: isToday ? 'var(--accent-surface)' : isWeekend ? 'var(--bg-card2)' : 'var(--bg-card)',
                    fontSize: 11, flexShrink: 0,
                  }}>
                    {(i === 0 || firstOfMonth) && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        {MIESIACE[d.getMonth()]}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{DNI_PL[d.getDay()]}</span>
                    <span style={{
                      fontSize: 14, fontWeight: isToday ? 800 : 500,
                      color: isToday ? 'var(--accent)' : isWeekend ? 'var(--text-muted)' : 'var(--text)',
                      background: isToday ? 'var(--accent)' : 'transparent',
                      color: isToday ? '#fff' : isWeekend ? 'var(--text-muted)' : 'var(--text)',
                      borderRadius: 20, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* wiersze sprzętu */}
            {sprzet.length === 0 && (
              <div style={{ padding: '40px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                Brak sprzętu. Dodaj urządzenia w module Flota.
              </div>
            )}

            {sprzet.map((s, rowIdx) => {
              const rowRez = rezBySprzet[s.id] || [];
              const isWeekRow = true; // zawsze pokazuj

              return (
                <div key={s.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)', minHeight: ROW_H }}>
                  {/* etykieta sprzętu */}
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W, height: ROW_H,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    paddingLeft: 16, paddingRight: 8,
                    borderRight: '1px solid var(--border)',
                    flexShrink: 0, overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nazwa}</div>
                    {s.typ && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.typ}</div>}
                  </div>

                  {/* komórki dni — wrapper relatywny dla absolutnych barów */}
                  <div style={{ flex: 1, position: 'relative', height: ROW_H }}>
                    {/* tło komórek — drop zones */}
                    {days.map((d) => {
                      const iso = toISO(d);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = iso === todayISO;
                      const isDropHere = dropTarget?.sprzetId === s.id && dropTarget?.dayISO === iso;
                      const colIdx = diffDays(toISO(days[0]), iso);
                      const firstOfMonth = d.getDate() === 1;
                      return (
                        <div
                          key={iso}
                          style={{
                            position: 'absolute',
                            left: colIdx * COL_W,
                            top: 0,
                            width: COL_W,
                            height: ROW_H,
                            borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: isDropHere
                              ? 'rgba(59,130,246,0.25)'
                              : isToday
                              ? 'var(--accent-surface)'
                              : isWeekend
                              ? 'var(--bg-card2)'
                              : 'transparent',
                            cursor: canEdit ? 'pointer' : 'default',
                            zIndex: 1,
                          }}
                          onClick={() => canEdit && setModalNew({ sprzetId: s.id, date: iso })}
                          onDragOver={(e) => handleDragOver(e, s.id, iso)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, s.id, iso)}
                        />
                      );
                    })}

                    {/* paski rezerwacji */}
                    {rowRez.map((rez) => renderBar(rez, 0))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── modals ──────────────────────────────────────────────────────────── */}
      {modalNew && (
        <NowaRezerwacjaModal
          sprzet={sprzet}
          ekipy={ekipy}
          defaultSprzet={modalNew.sprzetId}
          defaultDate={modalNew.date}
          onSave={handleNewSave}
          onClose={() => { setModalNew(null); setModalErr(''); }}
          saving={saving}
          error={modalErr}
        />
      )}
      {modalDet && (
        <RezerwacjaDetailModal
          rez={modalDet}
          ekipy={ekipy}
          onStatusChange={handleStatusChange}
          onClose={() => setModalDet(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

// ─── style ───────────────────────────────────────────────────────────────────
const st = {
  pageHeader: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
    flexWrap: 'wrap',
  },
  pageTitle: {
    margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)',
    marginLeft: 'auto',
  },
  navBtn: {
    width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8,
    background: 'var(--bg-card2)', cursor: 'pointer', fontSize: 18,
    color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  },
  todayBtn: {
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 8,
    background: 'var(--bg-card2)', cursor: 'pointer', fontSize: 13,
    color: 'var(--text)', fontWeight: 500,
  },
  periodLabel: {
    fontSize: 15, fontWeight: 600, color: 'var(--text)',
  },
  viewBtn: {
    padding: '5px 12px', border: 'none', borderRadius: 8,
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  flash: {
    padding: '8px 24px', fontSize: 13, fontWeight: 500,
  },
  legend: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '8px 24px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-card)', fontSize: 12,
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)',
  },
  legendDot: {
    width: 10, height: 10, borderRadius: 3, flexShrink: 0,
  },
};
