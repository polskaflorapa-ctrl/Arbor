import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import { getStoredToken } from '../utils/storedToken';

const LS_KEY = 'arbor_calendar_blocks_v1';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readBlocks() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBlocks(rows) {
  localStorage.setItem(LS_KEY, JSON.stringify(rows));
}

export default function BlokadyKalendarza() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(() => readBlocks());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    od: todayKey(),
    do: todayKey(),
    opis: '',
  }));

  useEffect(() => {
    if (!getStoredToken()) navigate('/');
  }, [navigate]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => String(a.od).localeCompare(String(b.od))),
    [rows]
  );

  const openForm = () => {
    setError('');
    setForm({ od: todayKey(), do: todayKey(), opis: '' });
    setShowForm(true);
  };

  const closeForm = () => {
    setError('');
    setShowForm(false);
  };

  const addBlock = (e) => {
    e.preventDefault();
    if (!form.od || !form.do) {
      setError('Wybierz datę od i datę do.');
      return;
    }
    if (form.do < form.od) {
      setError('Data końcowa nie może być wcześniejsza niż początkowa.');
      return;
    }
    const next = [
      ...rows,
      {
        id: Date.now(),
        od: form.od,
        do: form.do,
        opis: form.opis.trim(),
        created_at: new Date().toISOString(),
      },
    ];
    setRows(next);
    saveBlocks(next);
    closeForm();
  };

  const removeBlock = (id) => {
    const next = rows.filter((row) => row.id !== id);
    setRows(next);
    saveBlocks(next);
  };

  return (
    <div style={S.wrap}>
      <Sidebar />
      <main style={S.main}>
        <PageHeader
          variant="hero"
          title="Blokady kalendarza"
          subtitle="Zakresy dni bez nowych wycen i oględzin"
          actions={(
            <button type="button" style={S.primaryBtn} onClick={openForm} aria-label="Dodaj blokadę">
              <span style={S.plusIcon}>+</span>
              Dodaj blokadę
            </button>
          )}
        />

        <section style={S.panel}>
          <div style={S.panelHeader}>
            <div>
              <div style={S.panelTitle}>Aktywne blokady</div>
              <div style={S.panelSub}>{sortedRows.length} zakresów w tej przeglądarce</div>
            </div>
          </div>

          {sortedRows.length === 0 ? (
            <div style={S.empty}>Brak zapisanych blokad kalendarza.</div>
          ) : (
            <div style={S.list}>
              {sortedRows.map((row) => (
                <div key={row.id} style={S.row}>
                  <div style={S.dateBadge}>
                    <strong>{row.od}</strong>
                    <span>{row.do}</span>
                  </div>
                  <div style={S.rowBody}>
                    <div style={S.rowTitle}>
                      {row.od === row.do ? row.od : `${row.od} -> ${row.do}`}
                    </div>
                    <div style={S.rowSub}>{row.opis || 'Bez opisu'}</div>
                  </div>
                  <button type="button" style={S.deleteBtn} onClick={() => removeBlock(row.id)}>
                    Usuń
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {showForm ? (
        <div style={S.overlay} onMouseDown={closeForm}>
          <form style={S.modal} onSubmit={addBlock} onMouseDown={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div style={S.modalTitle}>Nowy zakres blokady</div>
              <button type="button" style={S.closeBtn} onClick={closeForm} aria-label="Zamknij">
                ×
              </button>
            </div>
            <label style={S.label}>
              Od
              <input
                type="date"
                value={form.od}
                onChange={(e) => setForm((prev) => ({ ...prev, od: e.target.value }))}
                style={S.input}
                required
              />
            </label>
            <label style={S.label}>
              Do
              <input
                type="date"
                value={form.do}
                onChange={(e) => setForm((prev) => ({ ...prev, do: e.target.value }))}
                style={S.input}
                required
              />
            </label>
            <label style={S.label}>
              Opis
              <input
                value={form.opis}
                onChange={(e) => setForm((prev) => ({ ...prev, opis: e.target.value }))}
                placeholder="np. święto, urlop"
                style={S.input}
              />
            </label>
            {error ? <div style={S.error}>{error}</div> : null}
            <div style={S.modalActions}>
              <button type="button" style={S.secondaryBtn} onClick={closeForm}>
                Anuluj
              </button>
              <button type="submit" style={S.primaryBtn}>
                Zapisz
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

const S = {
  wrap: {
    display: 'flex',
    minHeight: '100vh',
    background: 'var(--forest-pattern), linear-gradient(180deg, rgba(20,53,31,0.26), var(--bg-deep))',
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: '24px clamp(16px, 3vw, 32px) 40px',
  },
  primaryBtn: {
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 16px',
    borderRadius: 8,
    border: '1px solid rgba(155,217,87,0.45)',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontWeight: 850,
    cursor: 'pointer',
  },
  plusIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(5,16,8,0.16)',
    fontWeight: 900,
  },
  panel: {
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.18)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(8,16,11,0.94))',
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
  },
  panelHeader: {
    padding: '16px 18px',
    borderBottom: '1px solid rgba(191,225,146,0.12)',
  },
  panelTitle: { fontSize: 16, fontWeight: 850, color: 'var(--text)' },
  panelSub: { marginTop: 4, fontSize: 12, fontWeight: 650, color: 'var(--text-muted)' },
  empty: {
    margin: 16,
    padding: 18,
    borderRadius: 8,
    border: '1px dashed rgba(191,225,146,0.18)',
    background: 'rgba(155,217,87,0.06)',
    color: 'var(--text-muted)',
    fontWeight: 650,
  },
  list: { padding: 12, display: 'grid', gap: 8 },
  row: {
    display: 'grid',
    gridTemplateColumns: '148px minmax(0, 1fr) auto',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.12)',
    background: 'rgba(5,12,8,0.58)',
  },
  dateBadge: {
    minHeight: 50,
    borderRadius: 8,
    border: '1px solid rgba(155,217,87,0.22)',
    background: 'rgba(155,217,87,0.1)',
    color: 'var(--accent)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '0 10px',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  rowBody: { minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)' },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: 650, color: 'var(--text-muted)' },
  deleteBtn: {
    minHeight: 34,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid rgba(248,113,113,0.35)',
    background: 'rgba(248,113,113,0.08)',
    color: 'var(--danger)',
    cursor: 'pointer',
    fontWeight: 800,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'grid',
    placeItems: 'center',
    padding: 18,
    background: 'rgba(1,5,3,0.72)',
    backdropFilter: 'blur(8px)',
  },
  modal: {
    width: 'min(500px, 100%)',
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.2)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.98), rgba(8,16,11,0.98))',
    boxShadow: 'var(--shadow-lg)',
    padding: 24,
    display: 'grid',
    gap: 14,
  },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: 850, color: 'var(--text)' },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'rgba(5,12,8,0.7)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 20,
    lineHeight: 1,
  },
  label: { display: 'grid', gap: 7, color: 'var(--text-sub)', fontSize: 12, fontWeight: 800 },
  input: {
    width: '100%',
    minHeight: 46,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--input-bg)',
    color: 'var(--text)',
    font: 'inherit',
  },
  error: { color: 'var(--danger)', fontSize: 13, fontWeight: 750 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  secondaryBtn: {
    minHeight: 42,
    padding: '0 16px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'rgba(5,12,8,0.72)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontWeight: 800,
  },
};
