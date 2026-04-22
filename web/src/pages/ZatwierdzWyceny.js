import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';

const STATUS_KOLOR = { oczekuje: '#F59E0B', zatwierdzono: '#34D399', odrzucono: '#EF4444' };
const STATUS_LABEL = { oczekuje: '⏳ Oczekuje', zatwierdzono: '✅ Zatwierdzono', odrzucono: '❌ Odrzucono' };

function fmt(v) {
  if (!v) return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(v);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pl-PL');
}

export default function ZatwierdzWyceny() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [wyceny, setWyceny] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtr, setFiltr] = useState('oczekuje');
  const [wybranaId, setWybranaId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [powod, setPowod] = useState('');
  const [saving, setSaving] = useState(null); // id aktualnie zapisywanego
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      if (!token) { navigate('/'); return; }
      const u = getLocalStorageJson('user', {});
      setUser(u);
      const h = authHeaders(token);
      const [wRes, eRes] = await Promise.all([
        api.get(`/wyceny?status_akceptacji=${filtr}`, { headers: h }),
        api.get('/ekipy', { headers: h }),
      ]);
      setWyceny(Array.isArray(wRes.data) ? wRes.data : (wRes.data.wyceny || []));
      setEkipy(eRes.data.ekipy || eRes.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [navigate, filtr]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (w) => {
    setWybranaId(wybranaId === w.id ? null : w.id);
    setEditForm({
      ekipa_id: w.ekipa_id?.toString() || '',
      data_wykonania: w.data_wykonania?.split('T')[0] || '',
      godzina_rozpoczecia: w.godzina_rozpoczecia || '08:00',
      wartosc_planowana: w.wartosc_planowana?.toString() || '',
      uwagi: '',
    });
    setPowod('');
    setMsg('');
  };

  const zatwierdz = async (id) => {
    if (!editForm.ekipa_id) { setMsg(warningMessage('Wybierz ekipę przed zatwierdzeniem!')); return; }
    setSaving(id);
    try {
      const token = getStoredToken();
      await api.post(`/wyceny/${id}/zatwierdz`, editForm, { headers: authHeaders(token) });
      setMsg(successMessage('Wycena zatwierdzona i zamieniona w zlecenie!'));
      setWybranaId(null);
      load();
    } catch (err) {
      setMsg(errorMessage(getApiErrorMessage(err, err.message)));
    } finally { setSaving(null); }
  };

  const odrzuc = async (id) => {
    if (!powod.trim()) { setMsg(warningMessage('Wpisz powód odrzucenia!')); return; }
    setSaving(id);
    try {
      const token = getStoredToken();
      await api.post(`/wyceny/${id}/odrzuc`, { powod }, { headers: authHeaders(token) });
      setMsg(successMessage('Wycena odrzucona.'));
      setWybranaId(null);
      load();
    } catch (err) {
      setMsg(errorMessage(getApiErrorMessage(err, err.message)));
    } finally { setSaving(null); }
  };

  const canApprove = user && ['Kierownik', 'Dyrektor', 'Administrator'].includes(user.rola);
  const oczekujaceCount = wyceny.filter(w => w.status_akceptacji === 'oczekuje').length;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => navigate(-1)}>←</button>
        <div>
          <div style={S.headerTitle}>
            ✅ Zatwierdzanie wycen
            {oczekujaceCount > 0 && filtr !== 'oczekuje' && (
              <span style={S.badge}>{oczekujaceCount} oczekujących</span>
            )}
          </div>
          <div style={S.headerSub}>Przegląd i zatwierdzanie wycen od wyceniających</div>
        </div>
      </div>

      <StatusMessage message={msg} style={S.msgBox} />

      {/* Filtry */}
      <div style={S.filtrRow}>
        {['oczekuje', 'zatwierdzono', 'odrzucono'].map(f => (
          <button key={f} style={{ ...S.filtrBtn, ...(filtr === f ? { backgroundColor: STATUS_KOLOR[f], color: '#fff', borderColor: STATUS_KOLOR[f] } : {}) }}
            onClick={() => { setFiltr(f); setWybranaId(null); setMsg(''); }}>
            {STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {/* Lista wycen */}
      <div style={S.list}>
        {loading ? (
          <div style={S.center}>⏳ Ładowanie...</div>
        ) : wyceny.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ color: 'var(--text-sub)', fontSize: 16 }}>
              {filtr === 'oczekuje' ? 'Brak wycen do zatwierdzenia' : `Brak wycen o statusie "${STATUS_LABEL[filtr]}"`}
            </div>
          </div>
        ) : wyceny.map(w => (
          <div key={w.id} style={S.card}>
            {/* Nagłówek karty */}
            <div style={S.cardTop} onClick={() => openEdit(w)}>
              <div style={{ flex: 1 }}>
                <div style={S.cardTitle}>
                  {w.klient_nazwa || 'Klient nieznany'}
                  <span style={{ ...S.statusChip, backgroundColor: STATUS_KOLOR[w.status_akceptacji] + '22', color: STATUS_KOLOR[w.status_akceptacji] }}>
                    {STATUS_LABEL[w.status_akceptacji]}
                  </span>
                </div>
                <div style={S.cardMeta}>📍 {w.adres}, {w.miasto}</div>
                <div style={S.metaGrid}>
                  {w.typ_uslugi && <span style={S.metaChip}>🌳 {w.typ_uslugi}</span>}
                  {w.data_wykonania && <span style={S.metaChip}>📅 {fmtDate(w.data_wykonania)}</span>}
                  {w.godzina_rozpoczecia && <span style={S.metaChip}>🕐 {w.godzina_rozpoczecia}</span>}
                  {w.ekipa_nazwa && <span style={S.metaChip}>👷 {w.ekipa_nazwa}</span>}
                  {w.wartosc_planowana && <span style={{ ...S.metaChip, color: 'var(--accent)', fontWeight: '600' }}>💰 {fmt(w.wartosc_planowana)}</span>}
                  {w.czas_planowany_godziny && <span style={S.metaChip}>⏱ {w.czas_planowany_godziny}h</span>}
                </div>
                {w.wyceniajacy_nazwa && (
                  <div style={S.cardMeta}>👤 Wyceniający: <strong>{w.wyceniajacy_nazwa}</strong></div>
                )}
                {w.wycena_uwagi && (
                  <div style={S.uwagi}>💬 {w.wycena_uwagi}</div>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 20, marginLeft: 12 }}>
                {wybranaId === w.id ? '▲' : '▼'}
              </div>
            </div>

            {/* Panel zatwierdzania — widoczny po rozwinięciu */}
            {wybranaId === w.id && canApprove && w.status_akceptacji === 'oczekuje' && (
              <div style={S.approvePanel}>
                <div style={S.approveTit}>📝 Zatwierdź lub odrzuć — możesz zmodyfikować dane przed zatwierdzeniem:</div>

                <div style={S.approveGrid}>
                  {/* Ekipa */}
                  <div style={S.fieldWrap}>
                    <label style={S.lbl}>👷 Ekipa (obowiązkowa) *</label>
                    <div style={S.ekipyGrid}>
                      {ekipy.map(e => (
                        <div key={e.id}
                          style={{ ...S.ekipaPill, ...(editForm.ekipa_id === e.id.toString() ? { borderColor: e.kolor || 'var(--accent)', backgroundColor: (e.kolor || '#34D399') + '22', color: e.kolor || 'var(--accent)' } : {}) }}
                          onClick={() => setEditForm(f => ({ ...f, ekipa_id: e.id.toString() }))}>
                          <div style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: e.kolor || '#6B7280' }} />
                          {e.nazwa}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Data */}
                  <div style={S.fieldWrap}>
                    <label style={S.lbl}>📅 Data realizacji</label>
                    <input style={S.inp} type="date" value={editForm.data_wykonania} onChange={e => setEditForm(f => ({ ...f, data_wykonania: e.target.value }))} />
                  </div>

                  {/* Godzina */}
                  <div style={S.fieldWrap}>
                    <label style={S.lbl}>🕐 Godzina rozpoczęcia</label>
                    <input style={S.inp} type="time" value={editForm.godzina_rozpoczecia} onChange={e => setEditForm(f => ({ ...f, godzina_rozpoczecia: e.target.value }))} />
                  </div>

                  {/* Wartość */}
                  <div style={S.fieldWrap}>
                    <label style={S.lbl}>💰 Wartość zlecenia (PLN)</label>
                    <input style={S.inp} type="number" step="0.01" value={editForm.wartosc_planowana} onChange={e => setEditForm(f => ({ ...f, wartosc_planowana: e.target.value }))} placeholder="np. 3200" />
                  </div>
                </div>

                {/* Uwagi menedżera */}
                <div style={S.fieldWrap}>
                  <label style={S.lbl}>💬 Uwagi menedżera (opcjonalne)</label>
                  <textarea style={{ ...S.inp, minHeight: 60, resize: 'vertical' }} value={editForm.uwagi} onChange={e => setEditForm(f => ({ ...f, uwagi: e.target.value }))} placeholder="Dodatkowe instrukcje dla ekipy..." />
                </div>

                <StatusMessage message={msg} />

                <div style={S.approveBtns}>
                  {/* Odrzucenie */}
                  <div style={S.odrzucRow}>
                    <input style={{ ...S.inp, flex: 1 }} value={powod} onChange={e => setPowod(e.target.value)} placeholder="Powód odrzucenia (wymagany)..." required />
                    <button style={S.odrzucBtn} onClick={() => odrzuc(w.id)} disabled={saving === w.id || !powod.trim()}>
                      {saving === w.id ? '...' : '❌ Odrzuć'}
                    </button>
                  </div>
                  <button style={S.zatwierdzBtn} onClick={() => zatwierdz(w.id)} disabled={saving === w.id || !editForm.ekipa_id}>
                    {saving === w.id ? '⏳ Zapisywanie...' : '✅ Zatwierdź → Utwórz zlecenie'}
                  </button>
                </div>
              </div>
            )}

            {/* Historia — zatwierdzone/odrzucone */}
            {wybranaId === w.id && w.status_akceptacji !== 'oczekuje' && (
              <div style={S.histPanel}>
                {w.zatwierdzone_przez_nazwa && (
                  <div style={S.histRow}>
                    <span style={S.histLabel}>{w.status_akceptacji === 'zatwierdzono' ? 'Zatwierdził:' : 'Odrzucił:'}</span>
                    <span>{w.zatwierdzone_przez_nazwa}</span>
                  </div>
                )}
                {w.zatwierdzone_at && (
                  <div style={S.histRow}>
                    <span style={S.histLabel}>Data:</span>
                    <span>{fmtDate(w.zatwierdzone_at)}</span>
                  </div>
                )}
                {w.wycena_uwagi && (
                  <div style={S.histRow}>
                    <span style={S.histLabel}>Uwagi:</span>
                    <span>{w.wycena_uwagi}</span>
                  </div>
                )}
                {w.status_akceptacji === 'zatwierdzono' && (
                  <button style={S.openBtn} onClick={() => navigate(`/zlecenia/${w.id}`)}>
                    Otwórz zlecenie →
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const S = {
  root: { minHeight: '100vh', backgroundColor: 'var(--bg)', color: 'var(--text)' },
  header: { display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', background: 'linear-gradient(135deg, var(--sidebar), #1B4332)', borderBottom: '1px solid var(--border)' },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 22, cursor: 'pointer' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: 10 },
  headerSub: { fontSize: 13, color: 'var(--text-sub)', marginTop: 2 },
  badge: { fontSize: 12, fontWeight: '600', padding: '2px 10px', borderRadius: 20, backgroundColor: '#F59E0B', color: '#000' },
  msgBox: { margin: '12px 24px' },

  filtrRow: { display: 'flex', gap: 8, padding: '16px 24px', borderBottom: '1px solid var(--border)' },
  filtrBtn: {
    padding: '8px 18px',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '500',
    transition: 'all 0.15s',
  },

  list: { padding: 20, display: 'flex', flexDirection: 'column', gap: 12 },
  center: { textAlign: 'center', padding: 40, color: 'var(--text-muted)' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 80 },

  card: { backgroundColor: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden' },
  cardTop: { padding: 20, display: 'flex', cursor: 'pointer', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  statusChip: { fontSize: 11, fontWeight: '600', padding: '2px 10px', borderRadius: 20 },
  cardMeta: { fontSize: 13, color: 'var(--text-sub)', marginBottom: 4 },
  metaGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  metaChip: { fontSize: 12, padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-deep)', color: 'var(--text-sub)' },
  uwagi: { marginTop: 8, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', backgroundColor: 'var(--bg-deep)', padding: '8px 12px', borderRadius: 8 },

  approvePanel: { padding: '0 20px 20px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-deep)', display: 'flex', flexDirection: 'column', gap: 14 },
  approveTit: { fontSize: 14, fontWeight: '600', color: 'var(--accent)', paddingTop: 16 },
  approveGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },

  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl: { fontSize: 11, fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase' },
  inp: { padding: '9px 12px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14 },

  ekipyGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  ekipaPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--bg)',
    color: 'var(--text-sub)',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontWeight: '500',
  },

  approveBtns: { display: 'flex', flexDirection: 'column', gap: 8 },
  odrzucRow: { display: 'flex', gap: 8 },
  odrzucBtn: { padding: '9px 16px', backgroundColor: 'var(--bg)', border: '1px solid #EF4444', color: '#EF4444', borderRadius: 8, fontWeight: '600', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  zatwierdzBtn: { padding: '12px 20px', backgroundColor: 'var(--accent)', color: '#052E16', border: 'none', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer' },

  histPanel: { padding: '12px 20px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 },
  histRow: { display: 'flex', gap: 12, fontSize: 13 },
  histLabel: { color: 'var(--text-muted)', minWidth: 100 },
  openBtn: { marginTop: 4, padding: '8px 16px', backgroundColor: 'var(--accent)', color: '#052E16', border: 'none', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', fontSize: 13, alignSelf: 'flex-start' },
};
