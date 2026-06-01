import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';

const S = {
  wrap: { display: 'flex', minHeight: '100vh', background: 'transparent' },
  main: { flex: 1, padding: '24px clamp(16px, 3vw, 32px) 40px', maxWidth: 'none', minWidth: 0 },
  tabs: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 4, width: 'fit-content', background: 'rgba(255,255,255,0.82)', boxShadow: 'var(--shadow-sm)' },
  tab: (on) => ({
    padding: '9px 14px',
    borderRadius: 6,
    border: '1px solid transparent',
    background: on ? 'var(--accent)' : 'transparent',
    cursor: 'pointer',
    color: on ? 'var(--on-accent)' : 'var(--text-sub)',
    fontWeight: 800,
    fontSize: 13,
  }),
  card: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    boxShadow: 'var(--shadow-sm)',
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  btn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    cursor: 'pointer',
    fontWeight: 800,
  },
  select: { padding: 8, borderRadius: 8, border: '1px solid var(--border)', minWidth: 220, background: 'var(--surface-field)', color: 'var(--text)' },
  err: { color: 'var(--danger)', marginTop: 8, fontWeight: 700 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 },
  empty: { padding: 18, borderRadius: 8, border: '1px dashed var(--glass-border)', background: 'rgba(255,255,255,0.72)', color: 'var(--text-muted)', fontWeight: 650 },
};

export default function WycenyTerenowe() {
  const { t } = useTranslation();
  const [sp] = useSearchParams();
  const preId = sp.get('id');
  const [tab, setTab] = useState('assign');
  const [rows, setRows] = useState([]);
  const [queue, setQueue] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignPick, setAssignPick] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const user = useMemo(() => readStoredUser(), []);

  const load = useCallback(async () => {
    const token = getStoredToken();
    const h = authHeaders(token);
    setErr('');
    try {
      const emptyOn404 = (promise) =>
        promise.catch((e) => {
          if (e?.response?.status === 404) return { data: [] };
          throw e;
        });
      const [a, b, u] = await Promise.all([
        emptyOn404(api.get('/quotations/panel/do-przypisania', { headers: h })),
        emptyOn404(api.get('/quotations/panel/moje-zatwierdzenia', { headers: h })),
        api.get('/uzytkownicy', { headers: h }).catch(() => ({ data: [] })),
      ]);
      setRows(Array.isArray(a.data) ? a.data : []);
      setQueue(Array.isArray(b.data) ? b.data : []);
      const raw = u.data;
      const list = Array.isArray(raw) ? raw : raw?.items || raw?.rows || [];
      setUsers(list.filter((x) => x.rola === 'Wyceniający' || x.rola === 'Wyceniajacy' || x.rola === 'Specjalista'));
    } catch (e) {
      setErr(getApiErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doAssign = async (qid) => {
    const wyc = assignPick[qid];
    if (!wyc) {
      setErr('Wybierz specjalistę ds. wyceny');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.post(
        `/quotations/${qid}/assign`,
        { wyceniajacy_id: Number(wyc) },
        { headers: authHeaders(getStoredToken()) }
      );
      await load();
    } catch (e) {
      setErr(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doDecision = async (qid, aid, decyzja) => {
    const komentarz =
      decyzja === 'Rejected'
        ? window.prompt('Uzasadnienie odrzucenia (wymagane):') || ''
        : decyzja === 'Returned'
          ? window.prompt('Uwagi do poprawy:') || ''
          : '';
    if (decyzja === 'Rejected' && !komentarz.trim()) {
      setErr('Odrzucenie wymaga komentarza');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.post(
        `/quotations/${qid}/approvals/${aid}/decision`,
        { decyzja, komentarz: komentarz || null },
        { headers: authHeaders(getStoredToken()) }
      );
      await load();
    } catch (e) {
      setErr(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user || !['Kierownik', 'Prezes', 'Dyrektor', 'Specjalista', 'Wyceniający', 'Wyceniajacy'].includes(user.rola)) {
    return (
      <div className="field-quotes-shell" style={S.wrap}>
        <Sidebar />
        <main className="field-quotes-main" style={S.main}>
          <PageHeader variant="hero" title={t('nav.fieldQuotes')} subtitle="" />
          <p style={{ color: 'var(--text-muted)' }}>Brak uprawnień do tego modułu.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="field-quotes-shell" style={S.wrap}>
      <Sidebar />
      <main className="field-quotes-main" style={S.main}>
        <PageHeader variant="hero" title={t('nav.fieldQuotes')} subtitle="Lead z Kommo -> przypisanie -> zatwierdzenia (M1)" />
        <div className="field-quotes-tabs" style={S.tabs}>
          <button type="button" style={S.tab(tab === 'assign')} onClick={() => setTab('assign')}>
            Wyceny do umówienia
          </button>
          <button type="button" style={S.tab(tab === 'queue')} onClick={() => setTab('queue')}>
            Kolejka zatwierdzeń ({queue.length})
          </button>
        </div>
        {err ? <div style={S.err}>{err}</div> : null}
        {tab === 'assign' && (
          <div className="field-quotes-grid" style={S.grid}>
            {rows.length === 0 ? (
              <div style={S.empty}>Brak leadów oczekujących na przypisanie.</div>
            ) : (
              rows.map((q) => (
                <div key={q.id} className="field-quotes-card" style={{ ...S.card, borderColor: String(preId) === String(q.id) ? 'var(--accent)' : undefined }}>
                  <div style={{ fontWeight: 600 }}>
                    #{q.id} {q.klient_nazwa || '—'}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
                    {[q.adres, q.miasto].filter(Boolean).join(', ')}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <Link
                      to={`/wyceny-terenowe/${q.id}`}
                      style={{ color: 'var(--accent)', fontSize: 14 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Szczegóły · wysyłka oferty →
                    </Link>
                    <Link
                      to={`/wyceny-terenowe/${q.id}?focus=sketch`}
                      style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('fieldQuotesSketch.listLink')} →
                    </Link>
                  </div>
                  <div style={{ ...S.row, marginTop: 12 }}>
                    <select
                      style={S.select}
                      value={assignPick[q.id] || ''}
                      onChange={(e) => setAssignPick((p) => ({ ...p, [q.id]: e.target.value }))}
                    >
                      <option value="">— specjalista ds. wyceny —</option>
                      {users
                        .filter((u) => !u.oddzial_id || String(u.oddzial_id) === String(q.oddzial_id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.imie} {u.nazwisko}
                          </option>
                        ))}
                    </select>
                    <button type="button" style={S.btn} disabled={busy} onClick={() => doAssign(q.id)}>
                      Przypisz
                    </button>
                  </div>
                  {!q.lat ? <div style={S.err}>Brak geokodowania — popraw adres w Kommo.</div> : null}
                </div>
              ))
            )}
          </div>
        )}
        {tab === 'queue' && (
          <div className="field-quotes-grid" style={S.grid}>
            {queue.length === 0 ? (
              <div style={S.empty}>Brak pozycji w Twojej kolejce.</div>
            ) : (
              queue.map((q) => (
                <div key={`${q.id}-${q.approval_id}`} className="field-quotes-card" style={S.card}>
                  <div style={{ fontWeight: 600 }}>
                    Wycena #{q.id} · rola: {q.wymagany_typ}
                  </div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>{q.klient_nazwa}</div>
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <Link to={`/wyceny-terenowe/${q.id}`} style={{ color: 'var(--accent)', fontSize: 14 }}>
                      Szczegóły · wysyłka oferty →
                    </Link>
                    <Link
                      to={`/wyceny-terenowe/${q.id}?focus=sketch`}
                      style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}
                    >
                      {t('fieldQuotesSketch.listLink')} →
                    </Link>
                  </div>
                  <div style={{ ...S.row, marginTop: 12, gap: 10 }}>
                    <button type="button" style={{ ...S.btn, background: '#166534' }} disabled={busy} onClick={() => doDecision(q.id, q.approval_id, 'Approved')}>
                      Zatwierdź
                    </button>
                    <button type="button" style={{ ...S.btn, background: '#b45309' }} disabled={busy} onClick={() => doDecision(q.id, q.approval_id, 'Returned')}>
                      Zwróć
                    </button>
                    <button type="button" style={{ ...S.btn, background: '#991b1b' }} disabled={busy} onClick={() => doDecision(q.id, q.approval_id, 'Rejected')}>
                      Odrzuć
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
