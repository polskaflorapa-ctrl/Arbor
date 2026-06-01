import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { loadCalendarBlocks, saveCalendarBlocks } from '../utils/calendarBlocks';
import { getStoredToken } from '../utils/storedToken';

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default function BlokadyKalendarza() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(() => {
    setBlocks(loadCalendarBlocks());
  }, []);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    refresh();
    setLoading(false);
    const onStorage = (e) => {
      if (e.key === 'calendar_blocks_v1') refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [navigate, refresh]);

  const openAdd = () => {
    const d = new Date().toISOString().slice(0, 10);
    setFrom(d);
    setTo(d);
    setLabel('');
    setModal(true);
    setMsg('');
  };

  const saveNew = () => {
    if (!isYmd(from) || !isYmd(to)) {
      setMsg(t('calendarBlocks.badRange'));
      return;
    }
    if (from > to) {
      setMsg(t('calendarBlocks.rangeOrder'));
      return;
    }
    const next = {
      id: `blk_${Date.now()}`,
      from,
      to,
      label: label.trim() || t('calendarBlocks.unnamed'),
    };
    saveCalendarBlocks([next, ...blocks]);
    refresh();
    setModal(false);
    setMsg('');
  };

  const remove = (id) => {
    saveCalendarBlocks(blocks.filter((b) => b.id !== id));
    refresh();
  };

  const S = {
    root: { display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '16px 20px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--surface-glass)',
      boxShadow: 'var(--shadow-sm)',
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      cursor: 'pointer',
      color: 'var(--text)',
    },
    title: { fontSize: 18, fontWeight: 800, color: 'var(--text)', flex: 1 },
    addBtn: {
      padding: '10px 16px',
      borderRadius: 10,
      border: '1px solid rgba(20,131,79,0.24)',
      background: 'var(--accent-gradient)',
      color: 'var(--on-accent)',
      fontWeight: 700,
      cursor: 'pointer',
    },
    main: { padding: 20, maxWidth: 560, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
    hint: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.45 },
    empty: { color: 'var(--text-muted)', fontSize: 14 },
    card: {
      padding: 14,
      borderRadius: 8,
      border: '1px solid var(--glass-border)',
      background: 'var(--surface-glass)',
      boxShadow: 'var(--shadow-sm)',
      marginBottom: 10,
    },
    cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
    cardTitle: { fontWeight: 700, color: 'var(--text)', fontSize: 15 },
    cardSub: { fontSize: 13, color: 'var(--text-sub)', marginTop: 6 },
    trash: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--danger, #EF4444)',
      fontSize: 18,
      padding: 4,
    },
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 16,
    },
    modal: {
      background: 'var(--surface-glass)',
      borderRadius: 8,
      padding: 22,
      maxWidth: 400,
      width: '100%',
      border: '1px solid var(--glass-border)',
      boxShadow: 'var(--shadow-lg)',
    },
    modalTitle: { fontSize: 17, fontWeight: 800, marginBottom: 14, color: 'var(--text)' },
    lbl: { fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 4 },
    inp: {
      width: '100%',
      padding: '10px 12px',
      marginBottom: 12,
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--text)',
      fontSize: 14,
      boxSizing: 'border-box',
    },
    row: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 },
    btnGhost: {
      padding: '10px 16px',
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--text-sub)',
      cursor: 'pointer',
    },
    btnPrimary: {
      padding: '10px 16px',
      borderRadius: 10,
      border: '1px solid rgba(20,131,79,0.24)',
      background: 'var(--accent-gradient)',
      color: 'var(--on-accent)',
      fontWeight: 700,
      cursor: 'pointer',
    },
  };

  if (loading) return null;

  return (
    <div className="app-shell calendar-blocks-shell">
      <Sidebar />
      <main className="app-main calendar-blocks-main" style={S.root}>
        <div className="calendar-blocks-header" style={S.header}>
          <button type="button" style={S.backBtn} onClick={() => navigate(-1)} aria-label="back">
            ←
          </button>
          <div style={S.title}>{t('calendarBlocks.title')}</div>
          <button type="button" style={S.addBtn} onClick={openAdd}>
            +
          </button>
        </div>
        <StatusMessage message={msg} tone={msg ? 'warning' : undefined} style={{ margin: '12px 20px 0' }} />
        <div className="calendar-blocks-content" style={S.main}>
          <p style={S.hint}>{t('calendarBlocks.hint')}</p>
          {blocks.length === 0 ? (
            <div className="calendar-blocks-empty" style={S.empty}>{t('calendarBlocks.empty')}</div>
          ) : (
            blocks.map((b) => (
              <div className="calendar-blocks-card" key={b.id} style={S.card}>
                <div style={S.cardTop}>
                  <div style={S.cardTitle}>{b.label}</div>
                  <button type="button" style={S.trash} onClick={() => remove(b.id)} title="Usuń">
                    🗑
                  </button>
                </div>
                <div style={S.cardSub}>
                  {b.from} → {b.to}
                </div>
              </div>
            ))
          )}
        </div>

        {modal && (
          <div className="calendar-blocks-overlay" style={S.overlay} onMouseDown={() => setModal(false)} role="presentation">
            <div className="calendar-blocks-modal" style={S.modal} onMouseDown={(e) => e.stopPropagation()} role="dialog">
              <div style={S.modalTitle}>{t('calendarBlocks.addTitle')}</div>
              <div style={S.lbl}>{t('calendarBlocks.from')}</div>
              <input style={S.inp} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2026-05-06" />
              <div style={S.lbl}>{t('calendarBlocks.to')}</div>
              <input style={S.inp} value={to} onChange={(e) => setTo(e.target.value)} placeholder="2026-05-06" />
              <div style={S.lbl}>{t('calendarBlocks.label')}</div>
              <input
                style={S.inp}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('calendarBlocks.labelPh')}
              />
              <div style={S.row}>
                <button type="button" style={S.btnGhost} onClick={() => setModal(false)}>
                  {t('common.cancel')}
                </button>
                <button type="button" style={S.btnPrimary} onClick={saveNew}>
                  {t('calendarBlocks.save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
