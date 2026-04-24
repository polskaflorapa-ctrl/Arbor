import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';

const STATUS_KOLOR = { oczekuje: '#F59E0B', rezerwacja_wstepna: '#22C55E', do_specjalisty: '#60A5FA', zatwierdzono: '#34D399', odrzucono: '#EF4444' };
const STATUS_LABEL = { oczekuje: '⏳ Oczekuje', rezerwacja_wstepna: '📌 Rezerwacja wstępna', do_specjalisty: '🧠 Do specjalisty', zatwierdzono: '✅ Zatwierdzono', odrzucono: '❌ Odrzucono' };

function fmt(v) {
  if (!v) return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(v);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pl-PL');
}

function fmtPlanDateTime(dateStr, timeStr) {
  if (!dateStr) return '—';
  const hhmm = (timeStr || '08:00').slice(0, 5);
  return `${dateStr} ${hhmm}`;
}

function getPlannerDefaultHour(userId) {
  const key = `arbor_planner_default_hour_${userId || 'global'}`;
  const fromStorage = localStorage.getItem(key);
  if (fromStorage && /^\d{2}:\d{2}$/.test(fromStorage)) return fromStorage;
  return '08:00';
}

function setPlannerDefaultHour(userId, value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return;
  const key = `arbor_planner_default_hour_${userId || 'global'}`;
  localStorage.setItem(key, value);
}

function countByStatus(items) {
  return {
    oczekuje: items.filter((w) => w.status_akceptacji === 'oczekuje').length,
      rezerwacja_wstepna: items.filter((w) => w.status_akceptacji === 'rezerwacja_wstepna').length,
    do_specjalisty: items.filter((w) => w.status_akceptacji === 'do_specjalisty').length,
    zatwierdzono: items.filter((w) => w.status_akceptacji === 'zatwierdzono').length,
    odrzucono: items.filter((w) => w.status_akceptacji === 'odrzucono').length,
  };
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
    const defaultHour = getPlannerDefaultHour(user?.id);
    setWybranaId(wybranaId === w.id ? null : w.id);
    setEditForm({
      ekipa_id: (w.proponowana_ekipa_id || w.ekipa_id)?.toString() || '',
      data_wykonania: (w.proponowana_data || w.data_wykonania)?.split('T')[0] || '',
      godzina_rozpoczecia: (w.proponowana_godzina || w.godzina_rozpoczecia || defaultHour),
      wartosc_planowana: w.wartosc_planowana?.toString() || '',
      uwagi: '',
    });
    setPowod('');
    setMsg('');
  };

  const zatwierdz = async (id) => {
    if (!editForm.ekipa_id || !editForm.data_wykonania || !editForm.godzina_rozpoczecia) {
      setMsg(warningMessage('Przed zatwierdzeniem uzupełnij: ekipę, datę i godzinę planowania.'));
      return;
    }
    setSaving(id);
    try {
      const token = getStoredToken();
      await api.post(`/wyceny/${id}/zatwierdz`, editForm, { headers: authHeaders(token) });
      setPlannerDefaultHour(user?.id, editForm.godzina_rozpoczecia);
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

  const canApprove = user && ['Kierownik', 'Dyrektor', 'Administrator', 'Specjalista'].includes(user.rola);
  const statusCounts = countByStatus(wyceny);
  const headerActions = (
    <>
      <button type="button" style={S.backBtn} onClick={() => navigate(-1)}>Powrót</button>
      {canApprove ? <span style={S.headerPill}>Uprawnienia: zatwierdzanie aktywne</span> : null}
    </>
  );

  return (
    <div style={S.root}>
      <div style={S.bgOrbTop} />
      <div style={S.bgOrbBottom} />
      <div style={S.pageWrap}>
        <PageHeader
          variant="hero"
          title="Zatwierdzanie wycen"
          subtitle="Przeglądaj zgłoszenia, popraw dane realizacji i zatwierdzaj je do planu zleceń."
          actions={headerActions}
        />

        <StatusMessage message={msg} style={S.msgBox} />

        <div style={S.metricsRow}>
          <div style={S.metricCard}>
            <div style={S.metricLabel}>Oczekujące</div>
            <div style={{ ...S.metricValue, color: STATUS_KOLOR.oczekuje }}>{statusCounts.oczekuje}</div>
          </div>
          <div style={S.metricCard}>
            <div style={S.metricLabel}>Rezerwacje</div>
            <div style={{ ...S.metricValue, color: STATUS_KOLOR.rezerwacja_wstepna }}>{statusCounts.rezerwacja_wstepna}</div>
          </div>
          <div style={S.metricCard}>
            <div style={S.metricLabel}>Do specjalisty</div>
            <div style={{ ...S.metricValue, color: STATUS_KOLOR.do_specjalisty }}>{statusCounts.do_specjalisty}</div>
          </div>
          <div style={S.metricCard}>
            <div style={S.metricLabel}>Zatwierdzone</div>
            <div style={{ ...S.metricValue, color: STATUS_KOLOR.zatwierdzono }}>{statusCounts.zatwierdzono}</div>
          </div>
          <div style={S.metricCard}>
            <div style={S.metricLabel}>Odrzucone</div>
            <div style={{ ...S.metricValue, color: STATUS_KOLOR.odrzucono }}>{statusCounts.odrzucono}</div>
          </div>
        </div>

        <div style={S.filtrRow}>
          {['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty', 'zatwierdzono', 'odrzucono'].map(f => (
            <button
              key={f}
              style={{ ...S.filtrBtn, ...(filtr === f ? { backgroundColor: STATUS_KOLOR[f], color: 'var(--on-accent)', borderColor: STATUS_KOLOR[f] } : {}) }}
              onClick={() => { setFiltr(f); setWybranaId(null); setMsg(''); }}
            >
              {STATUS_LABEL[f]}
            </button>
          ))}
        </div>

        <div style={S.workflowRow}>
          <div style={S.workflowStep}>
            <div style={S.workflowTitle}>1. Rezerwacja</div>
            <div style={S.workflowText}>Wybór ekipy, data i godzina przed decyzją.</div>
          </div>
          <div style={S.workflowStep}>
            <div style={S.workflowTitle}>2. Decyzja</div>
            <div style={S.workflowText}>Akceptacja lub odrzucenie z uzasadnieniem.</div>
          </div>
          <div style={S.workflowStep}>
            <div style={S.workflowTitle}>3. Zlecenie</div>
            <div style={S.workflowText}>Po zatwierdzeniu automatyczne przejście do realizacji.</div>
          </div>
        </div>

        <div style={S.list}>
          {loading ? (
            <div style={S.center}>Ładowanie wycen...</div>
          ) : wyceny.length === 0 ? (
            <div style={S.empty}>
              <div style={{ color: 'var(--text-sub)', fontSize: 16 }}>
                {filtr === 'oczekuje' ? 'Brak wycen do zatwierdzenia' : `Brak wycen o statusie "${STATUS_LABEL[filtr]}"`}
              </div>
            </div>
          ) : wyceny.map(w => (
            <div key={w.id} style={S.card}>
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
                    {w.wartosc_planowana && <span style={{ ...S.metaChip, color: 'var(--accent)', fontWeight: '700' }}>💰 {fmt(w.wartosc_planowana)}</span>}
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

              {wybranaId === w.id && canApprove && ['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty'].includes(w.status_akceptacji) && (
                <div style={S.approvePanel}>
                  <div style={S.approveTit}>Zatwierdź lub odrzuć — możesz zmodyfikować dane przed zatwierdzeniem:</div>

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

                <div style={S.planPreviewBox}>
                  <div style={S.planPreviewTitle}>Podgląd zapisu planowania</div>
                  {!editForm.ekipa_id || !editForm.data_wykonania || !editForm.godzina_rozpoczecia ? (
                    <div style={S.planPreviewWarn}>
                      Uwaga: planowanie niepełne
                      {!editForm.ekipa_id ? ' • brak ekipy' : ''}
                      {!editForm.data_wykonania ? ' • brak daty' : ''}
                      {!editForm.godzina_rozpoczecia ? ' • brak godziny' : ''}
                    </div>
                  ) : null}
                  <div style={S.planPreviewRow}>
                    <span style={S.planPreviewLabel}>Termin do zlecenia:</span>
                    <span style={S.planPreviewValue}>
                      {fmtPlanDateTime(editForm.data_wykonania, editForm.godzina_rozpoczecia)}
                    </span>
                  </div>
                  <div style={S.planPreviewRow}>
                    <span style={S.planPreviewLabel}>Ekipa:</span>
                    <span style={S.planPreviewValue}>
                      {ekipy.find((e) => String(e.id) === String(editForm.ekipa_id))?.nazwa || '—'}
                    </span>
                  </div>
                  <div style={S.planPreviewRow}>
                    <span style={S.planPreviewLabel}>Wartość:</span>
                    <span style={S.planPreviewValue}>
                      {editForm.wartosc_planowana ? fmt(Number(editForm.wartosc_planowana)) : '—'}
                    </span>
                  </div>
                </div>

                  <StatusMessage message={msg} />

                  <div style={S.approveBtns}>
                    <div style={S.odrzucRow}>
                      <input style={{ ...S.inp, flex: 1 }} value={powod} onChange={e => setPowod(e.target.value)} placeholder="Powód odrzucenia (wymagany)..." required />
                      <button style={S.odrzucBtn} onClick={() => odrzuc(w.id)} disabled={saving === w.id || !powod.trim()}>
                        {saving === w.id ? '...' : '❌ Odrzuć'}
                      </button>
                    </div>
                    <button
                      style={S.zatwierdzBtn}
                      onClick={() => zatwierdz(w.id)}
                      disabled={saving === w.id || !editForm.ekipa_id || !editForm.data_wykonania || !editForm.godzina_rozpoczecia}
                    >
                      {saving === w.id ? 'Zapisywanie...' : '✅ Zatwierdź i utwórz zlecenie'}
                    </button>
                  </div>
                </div>
              )}

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
                  {w.status_akceptacji === 'zatwierdzono' && w.task_id && (
                    <button style={S.openBtn} onClick={() => navigate(`/zlecenia/${w.task_id}`)}>
                      Otwórz zlecenie →
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const S = {
  root: { minHeight: '100vh', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%)', color: 'var(--text)', position: 'relative', overflow: 'hidden' },
  bgOrbTop: { position: 'fixed', top: -130, right: -120, width: 350, height: 350, borderRadius: '50%', background: 'radial-gradient(circle, rgba(165,107,255,0.24) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 },
  bgOrbBottom: { position: 'fixed', bottom: -140, left: -120, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(112,182,255,0.17) 0%, transparent 72%)', pointerEvents: 'none', zIndex: 0 },
  pageWrap: { maxWidth: 1200, margin: '0 auto', padding: '20px 24px 28px', position: 'relative', zIndex: 1 },
  backBtn: {
    padding: '8px 14px',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border2)',
    backgroundColor: 'var(--bg-card2)',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  headerPill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border2)',
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 600,
  },
  msgBox: { marginBottom: 16 },
  metricsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 },
  metricCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 14,
    border: '1px solid var(--border2)',
    boxShadow: 'var(--shadow-sm)',
    padding: '12px 14px',
  },
  metricLabel: { fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' },
  metricValue: { fontSize: 26, lineHeight: 1, fontWeight: 800 },
  filtrRow: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  filtrBtn: {
    padding: '8px 18px',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border2)',
    backgroundColor: 'var(--bg-card2)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '600',
    transition: 'all 0.15s',
  },
  workflowRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    marginBottom: 14,
  },
  workflowStep: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    padding: '10px 12px',
    boxShadow: 'var(--shadow-sm)',
  },
  workflowTitle: { fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em' },
  workflowText: { marginTop: 4, fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.35 },

  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  center: { textAlign: 'center', padding: 40, color: 'var(--text-muted)' },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 14,
    border: '1px solid var(--border2)',
  },

  card: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 16,
    border: '1px solid var(--border2)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },
  cardTop: { padding: 20, display: 'flex', cursor: 'pointer', gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  statusChip: { fontSize: 11, fontWeight: '700', padding: '2px 10px', borderRadius: 20 },
  cardMeta: { fontSize: 13, color: 'var(--text-sub)', marginBottom: 4 },
  metaGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  metaChip: { fontSize: 12, padding: '3px 10px', borderRadius: 20, backgroundColor: 'var(--bg-deep)', color: 'var(--text-sub)', border: '1px solid var(--border)', fontWeight: 600 },
  uwagi: { marginTop: 8, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', backgroundColor: 'var(--bg-deep)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' },

  approvePanel: { padding: '0 20px 20px', borderTop: '1px solid var(--border2)', backgroundColor: 'var(--bg-deep)', display: 'flex', flexDirection: 'column', gap: 14 },
  approveTit: { fontSize: 14, fontWeight: '700', color: 'var(--accent)', paddingTop: 16 },
  planPreviewBox: {
    marginTop: -4,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid var(--border2)',
    backgroundColor: 'rgba(52,211,153,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  planPreviewTitle: { fontSize: 12, fontWeight: 800, color: 'var(--accent)' },
  planPreviewWarn: {
    fontSize: 11,
    fontWeight: 700,
    color: '#F59E0B',
    backgroundColor: 'rgba(245,158,11,0.14)',
    border: '1px solid rgba(245,158,11,0.3)',
    borderRadius: 8,
    padding: '6px 8px',
  },
  planPreviewRow: { display: 'flex', gap: 8, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' },
  planPreviewLabel: { color: 'var(--text-muted)', fontWeight: 700, minWidth: 118 },
  planPreviewValue: { color: 'var(--text)', fontWeight: 700 },
  approveGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },

  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl: { fontSize: 11, fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' },
  inp: { padding: '9px 12px', backgroundColor: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontSize: 14 },

  ekipyGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  ekipaPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border2)',
    backgroundColor: 'var(--bg)',
    color: 'var(--text-sub)',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontWeight: '600',
  },

  approveBtns: { display: 'flex', flexDirection: 'column', gap: 8 },
  odrzucRow: { display: 'flex', gap: 8 },
  odrzucBtn: { padding: '9px 16px', backgroundColor: 'var(--bg-deep)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, fontWeight: '700', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  zatwierdzBtn: { padding: '12px 20px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' },

  histPanel: { padding: '12px 20px 20px', borderTop: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 8 },
  histRow: { display: 'flex', gap: 12, fontSize: 13 },
  histLabel: { color: 'var(--text-muted)', minWidth: 100, fontWeight: 700 },
  openBtn: { marginTop: 4, padding: '8px 16px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 8, fontWeight: 800, cursor: 'pointer', fontSize: 13, alignSelf: 'flex-start' },
};
