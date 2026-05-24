import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { authHeaders, getStoredToken } from '../utils/storedToken';

const CENTRAL_ROLES = new Set(['Prezes', 'Dyrektor', 'Administrator']);
const VIEW_ROLES = new Set([...CENTRAL_ROLES, 'Kierownik']);

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function canViewDigest(user) {
  return VIEW_ROLES.has(normalizeRole(user?.rola));
}

function canRunDigest(user) {
  return CENTRAL_ROLES.has(normalizeRole(user?.rola));
}

function dateLabel(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function money(value) {
  return `${(Number(value) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

function metricValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pl-PL') : '0';
}

function getAlertTone(level) {
  if (level === 'high') return 'danger';
  if (level === 'medium') return 'warning';
  return 'neutral';
}

function summaryFromRunResponse(payload) {
  return payload?.operationalDigest?.global?.summary || payload?.global?.summary || null;
}

function topDetails(digest) {
  const details = digest?.details || {};
  const rows = [];
  for (const task of (details.overdue_tasks || []).slice(0, 2)) {
    rows.push({
      key: `overdue-${task.id}`,
      label: `#${task.id} ${task.klient_nazwa || 'bez klienta'}`,
      meta: `Po terminie od ${dateLabel(task.data_planowana)}`,
      tone: 'danger',
    });
  }
  for (const task of (details.unassigned_tasks || []).slice(0, 2)) {
    rows.push({
      key: `unassigned-${task.id}`,
      label: `#${task.id} ${task.klient_nazwa || 'bez klienta'}`,
      meta: `Bez ekipy, termin ${dateLabel(task.data_planowana)}`,
      tone: 'warning',
    });
  }
  for (const item of (details.fleet_due || []).slice(0, 2)) {
    rows.push({
      key: `fleet-${item.kind}-${item.id}-${item.due_type}`,
      label: item.label || `${item.kind} #${item.id}`,
      meta: `${item.due_type || 'termin'}: ${dateLabel(item.due_date)}`,
      tone: 'info',
    });
  }
  for (const item of (details.margin_risks || []).slice(0, 2)) {
    rows.push({
      key: `margin-${item.id}`,
      label: `#${item.id} ${item.klient_nazwa || 'zlecenie'}`,
      meta: `Marza ${item.margin_pct ?? '-'}%, koszt ${money(item.labor_cost)}`,
      tone: 'danger',
    });
  }
  return rows.slice(0, 6);
}

export default function OperationalDigestPanel({ user }) {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [compact, setCompact] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 840));

  const allowed = canViewDigest(user);
  const runAllowed = canRunDigest(user);

  const loadPreview = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const token = getStoredToken();
      const res = await api.get('/automations/daily-digest/preview', {
        headers: authHeaders(token),
        dedupe: false,
      });
      setDigest(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udalo sie pobrac digestu operacyjnego.'));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setCompact(window.innerWidth < 840);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const runNow = async () => {
    if (!runAllowed) return;
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const token = getStoredToken();
      const res = await api.post('/automations/run-daily', {}, { headers: authHeaders(token) });
      const summary = summaryFromRunResponse(res.data);
      setMessage(
        summary
          ? `Digest wyslany. Pilne: ${summary.high_alerts || 0}, wszystkie alerty: ${summary.total_alerts || 0}.`
          : 'Digest uruchomiony.'
      );
      await loadPreview();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udalo sie uruchomic digestu.'));
    } finally {
      setRunning(false);
    }
  };

  const summary = digest?.summary || {};
  const alertRows = Array.isArray(digest?.alerts) ? digest.alerts : [];
  const detailRows = useMemo(() => topDetails(digest), [digest]);
  const healthTone = Number(summary.high_alerts || 0) > 0 ? 'danger' : Number(summary.medium_alerts || 0) > 0 ? 'warning' : 'success';
  const headerStyle = compact ? { ...styles.header, flexDirection: 'column', alignItems: 'stretch' } : styles.header;
  const actionsStyle = compact ? { ...styles.actions, justifyContent: 'flex-start' } : styles.actions;
  const scoreRailStyle = compact ? { ...styles.scoreRail, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : styles.scoreRail;
  const contentGridStyle = compact ? { ...styles.contentGrid, gridTemplateColumns: 'minmax(0, 1fr)' } : styles.contentGrid;
  const alertColumnStyle = compact ? { ...styles.alertColumn, borderRight: 0, borderBottom: '1px solid #e6e9ef' } : styles.alertColumn;

  if (!allowed) return null;

  return (
    <section style={styles.panel}>
      <div style={headerStyle}>
        <div>
          <div style={styles.eyebrow}>Poranny digest</div>
          <h2 style={styles.title}>Operacje do decyzji</h2>
          <p style={styles.sub}>
            {digest?.date ? `Stan na ${dateLabel(digest.date)}` : 'Podglad alertow z automatyzacji dziennej.'}
          </p>
        </div>
        <div style={actionsStyle}>
          <button type="button" onClick={loadPreview} disabled={loading || running} style={styles.ghostButton}>
            {loading ? 'Odswiezam...' : 'Odswiez'}
          </button>
          {runAllowed ? (
            <button type="button" onClick={runNow} disabled={loading || running} style={styles.primaryButton}>
              {running ? 'Uruchamiam...' : 'Uruchom teraz'}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {message ? <div style={styles.successBox}>{message}</div> : null}

      <div style={styles.body}>
        <div style={scoreRailStyle}>
          <div style={{ ...styles.scoreCard, ...(scoreTone[healthTone] || scoreTone.neutral) }}>
            <span style={styles.scoreValue}>{metricValue(summary.high_alerts)}</span>
            <span style={styles.scoreLabel}>pilne</span>
          </div>
          <div style={styles.scoreCard}>
            <span style={styles.scoreValue}>{metricValue(summary.medium_alerts)}</span>
            <span style={styles.scoreLabel}>uwaga</span>
          </div>
          <div style={styles.scoreCard}>
            <span style={styles.scoreValue}>{metricValue(summary.today_tasks)}</span>
            <span style={styles.scoreLabel}>dzis</span>
          </div>
          <div style={styles.scoreCard}>
            <span style={styles.scoreValue}>{metricValue(summary.unassigned_tasks)}</span>
            <span style={styles.scoreLabel}>bez ekipy</span>
          </div>
        </div>

        <div style={contentGridStyle}>
          <div style={alertColumnStyle}>
            <div style={styles.sectionTitle}>Alerty</div>
            {loading && !digest ? (
              <div style={styles.empty}>Ladowanie digestu...</div>
            ) : alertRows.length === 0 ? (
              <div style={styles.empty}>Brak krytycznych alertow na start dnia.</div>
            ) : (
              alertRows.slice(0, 7).map((alert) => (
                <div key={alert.type || alert.title} style={styles.alertRow}>
                  <span style={{ ...styles.dot, ...(dotTone[getAlertTone(alert.level)] || dotTone.neutral) }} />
                  <span style={styles.alertText}>
                    <strong>{alert.title || alert.type}</strong>
                    <small>{alert.count || 0} | {alert.action || 'Do sprawdzenia'}</small>
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={styles.detailColumn}>
            <div style={styles.sectionTitle}>Najblizsze pozycje</div>
            {detailRows.length === 0 ? (
              <div style={styles.empty}>Nie ma pozycji wymagajacych reakcji.</div>
            ) : (
              detailRows.map((row) => (
                <div key={row.key} style={styles.detailRow}>
                  <span style={{ ...styles.detailTone, ...(dotTone[row.tone] || dotTone.neutral) }} />
                  <span style={styles.detailText}>
                    <strong>{row.label}</strong>
                    <small>{row.meta}</small>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const scoreTone = {
  danger: { borderLeftColor: '#e2445c', background: '#fff5f7' },
  warning: { borderLeftColor: '#fdab3d', background: '#fff8ec' },
  success: { borderLeftColor: '#00c875', background: '#f0fbf5' },
  neutral: { borderLeftColor: '#e6e9ef', background: '#ffffff' },
};

const dotTone = {
  danger: { background: '#e2445c' },
  warning: { background: '#fdab3d' },
  info: { background: '#579bfc' },
  success: { background: '#00c875' },
  neutral: { background: '#c5c7d0' },
};

const buttonBase = {
  minHeight: 32,
  borderRadius: 4,
  padding: '0 12px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

const styles = {
  panel: {
    border: '1px solid #e6e9ef',
    borderRadius: 4,
    background: '#ffffff',
    boxShadow: 'none',
    marginBottom: 14,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    padding: '14px 16px 12px',
    borderBottom: '1px solid #e6e9ef',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: 700,
    color: '#676879',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  title: {
    margin: '4px 0 0',
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 700,
    color: '#323338',
    letterSpacing: 0,
  },
  sub: {
    margin: '5px 0 0',
    fontSize: 12,
    lineHeight: 1.35,
    color: '#676879',
    fontWeight: 500,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  ghostButton: {
    ...buttonBase,
    border: '1px solid #e6e9ef',
    background: '#ffffff',
    color: '#676879',
  },
  primaryButton: {
    ...buttonBase,
    border: '1px solid #0f6b3f',
    background: '#0f6b3f',
    color: '#ffffff',
  },
  errorBox: {
    margin: '12px 16px 0',
    padding: '9px 10px',
    borderRadius: 4,
    background: '#fff5f7',
    border: '1px solid rgba(226,68,92,0.24)',
    color: '#a02438',
    fontSize: 12,
    fontWeight: 600,
  },
  successBox: {
    margin: '12px 16px 0',
    padding: '9px 10px',
    borderRadius: 4,
    background: '#f0fbf5',
    border: '1px solid rgba(0,200,117,0.25)',
    color: '#0f6b3f',
    fontSize: 12,
    fontWeight: 600,
  },
  body: { padding: 0 },
  scoreRail: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    borderBottom: '1px solid #e6e9ef',
  },
  scoreCard: {
    minHeight: 72,
    display: 'grid',
    alignContent: 'center',
    gap: 4,
    padding: '10px 14px',
    borderLeft: '3px solid #e6e9ef',
    borderRight: '1px solid #e6e9ef',
    background: '#ffffff',
  },
  scoreValue: {
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 800,
    color: '#323338',
    fontVariantNumeric: 'tabular-nums',
  },
  scoreLabel: {
    fontSize: 10,
    color: '#676879',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, .8fr)',
    gap: 0,
  },
  alertColumn: { minWidth: 0, borderRight: '1px solid #e6e9ef' },
  detailColumn: { minWidth: 0 },
  sectionTitle: {
    padding: '11px 14px 8px',
    fontSize: 10,
    color: '#676879',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  alertRow: {
    minHeight: 50,
    display: 'grid',
    gridTemplateColumns: '10px minmax(0,1fr)',
    gap: 10,
    alignItems: 'center',
    padding: '10px 14px',
    borderTop: '1px solid #e6e9ef',
  },
  dot: { width: 10, height: 10, borderRadius: '50%' },
  alertText: { display: 'grid', gap: 3, minWidth: 0 },
  detailRow: {
    minHeight: 50,
    display: 'grid',
    gridTemplateColumns: '3px minmax(0,1fr)',
    gap: 10,
    padding: '10px 14px',
    borderTop: '1px solid #e6e9ef',
  },
  detailTone: { width: 3, borderRadius: 999 },
  detailText: { display: 'grid', gap: 3, minWidth: 0 },
  empty: {
    padding: '14px',
    borderTop: '1px solid #e6e9ef',
    color: '#676879',
    fontSize: 12,
    fontWeight: 500,
  },
};
