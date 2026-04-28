import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';

const S = {
  wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main: { flex: 1, padding: '20px 24px 40px', maxWidth: 960 },
  tabs: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  tab: (on) => ({
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: on ? 'var(--accent-soft)' : 'var(--card)',
    cursor: 'pointer',
    color: 'var(--text)',
  }),
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  btn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
  },
  select: { padding: 8, borderRadius: 8, border: '1px solid var(--border)', minWidth: 200, background: 'var(--card)' },
  err: { color: 'var(--danger)', marginTop: 8 },
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
      const [a, b, u] = await Promise.all([
        api.get('/quotations/panel/do-przypisania', { headers: h }),
        api.get('/quotations/panel/moje-zatwierdzenia', { headers: h }),
        api.get('/uzytkownicy', { headers: h }).catch(() => ({ data: [] })),
      ]);
      setRows(Array.isArray(a.data) ? a.data : []);
      setQueue(Array.isArray(b.data) ? b.data : []);
      const raw = u.data;
      const list = Array.isArray(raw) ? raw : raw?.items || raw?.rows || [];
      setUsers(list.filter((x) => x.rola === 'Wyceniający'));
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
      setErr('Wybierz wyceniającego');
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

  if (!user || !['Kierownik', 'Dyrektor', 'Administrator', 'Specjalista'].includes(user.rola)) {
    return (
      <div style={S.wrap}>
        <Sidebar />
        <main style={S.main}>
          <PageHeader title={t('nav.fieldQuotes')} subtitle="" />
          <p style={{ color: 'var(--text-muted)' }}>Brak uprawnień do tego modułu.</p>
        </main>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <Sidebar />
      <main style={S.main}>
        <PageHeader title={t('nav.fieldQuotes')} subtitle="Lead z Kommo → przypisanie → zatwierdzenia (M1)" />
        <div style={S.tabs}>
          <button type="button" style={S.tab(tab === 'assign')} onClick={() => setTab('assign')}>
            Wyceny do umówienia
          </button>
          <button type="button" style={S.tab(tab === 'queue')} onClick={() => setTab('queue')}>
            Kolejka zatwierdzeń ({queue.length})
          </button>
        </div>
        {err ? <div style={S.err}>{err}</div> : null}
        {tab === 'assign' && (
          <div>
            {rows.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>Brak leadów oczekujących na przypisanie.</p>
            ) : (
              rows.map((q) => (
                <div key={q.id} style={{ ...S.card, borderColor: String(preId) === String(q.id) ? 'var(--accent)' : undefined }}>
                  <div style={{ fontWeight: 600 }}>
                    #{q.id} {q.klient_nazwa || '—'}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
                    {[q.adres, q.miasto].filter(Boolean).join(', ')}
                  </div>
                  <div style={{ ...S.row, marginTop: 12 }}>
                    <select
                      style={S.select}
                      value={assignPick[q.id] || ''}
                      onChange={(e) => setAssignPick((p) => ({ ...p, [q.id]: e.target.value }))}
                    >
                      <option value="">— wyceniający —</option>
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
          <div>
            {queue.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>Brak pozycji w Twojej kolejce.</p>
            ) : (
              queue.map((q) => (
                <div key={`${q.id}-${q.approval_id}`} style={S.card}>
                  <div style={{ fontWeight: 600 }}>
                    Wycena #{q.id} · rola: {q.wymagany_typ}
                  </div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>{q.klient_nazwa}</div>
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
