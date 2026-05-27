/**
 * Dev panel dla włączania/wyłączania trybu testowego + diagnostyki API.
 * Ukryty panel dostępny pod kombinacją klawiszy Ctrl+Shift+D
 * Parity z mobile: test-mode.tsx + api-diagnostyka.tsx
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getReactApiBase } from '../utils/apiBase';
import { clearAuthSession } from '../utils/authSession';
import { isTestModeEnabled, toggleTestMode, TEST_USERS } from '../utils/testMode';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getStoredToken } from '../utils/storedToken';
import './DevPanel.css';

const API_BASE = getReactApiBase();
const AUTO_REFRESH_MS = 30000;
const DIAG_HISTORY_KEY = 'api_diagnostic_history_v1';
const DIAG_HISTORY_MAX = 5;
const SPARKLINE_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function makeProbe(name) {
  return { name, status: 'idle', httpCode: null, latencyMs: null };
}

function calcAvgLatency(results) {
  const vals = results.map((r) => r.latencyMs).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function healthLabel(results) {
  const checked = results.filter((r) => r.status !== 'idle');
  if (!checked.length) return '⬤ —';
  const ok = checked.filter((r) => r.status === 'ok').length;
  if (ok === checked.length) return '🟢 Zdrowe';
  if (ok === 0) return '🔴 Niedostępne';
  return '🟡 Częściowe';
}

function buildSparkline(history) {
  const vals = history.map((h) => h.avgLatency).filter((v) => typeof v === 'number' && Number.isFinite(v)).reverse();
  if (!vals.length) return '—';
  if (vals.length === 1) return `${SPARKLINE_BARS[3]} (${vals[0]} ms)`;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(max - min, 1);
  const bars = vals.map((v) => {
    const idx = Math.min(SPARKLINE_BARS.length - 1, Math.max(0, Math.round(((v - min) / range) * (SPARKLINE_BARS.length - 1))));
    return SPARKLINE_BARS[idx];
  });
  return `${bars.join('')} (${vals[vals.length - 1]}→${vals[0]} ms)`;
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(DIAG_HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(DIAG_HISTORY_KEY, JSON.stringify(h.slice(0, DIAG_HISTORY_MAX))); } catch {}
}

const INITIAL_PROBES = [
  makeProbe('Backend /health'),
  makeProbe('Auth /auth/me'),
  makeProbe('Zadania /tasks/wszystkie'),
  makeProbe('Panel wycen /quotations/panel/do-przypisania'),
  makeProbe('Zatwierdz. wycen /quotations/panel/moje-zatwierdzenia'),
  makeProbe('Konfiguracja /mobile-config'),
  makeProbe('Rezerwacje sprzętu /flota/rezerwacje'),
];

async function runProbe(name, url, token, okExtra = []) {
  const start = Date.now();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(url, { headers });
    const latencyMs = Date.now() - start;
    const isOk = res.ok || okExtra.includes(res.status);
    return { name, status: isOk ? 'ok' : 'error', httpCode: res.status, latencyMs };
  } catch {
    return { name, status: 'error', httpCode: null, latencyMs: Date.now() - start };
  }
}

async function runAllProbes(token) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const from = `${y}-${m}-01`;
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  const to = `${y}-${m}-${String(last).padStart(2, '0')}`;

  return Promise.all([
    runProbe('Backend /health', `${API_BASE}/health`, null),
    runProbe('Auth /auth/me', `${API_BASE}/auth/me`, token, [401, 403]),
    runProbe('Zadania /tasks/wszystkie', `${API_BASE}/tasks/wszystkie`, token, [401, 403]),
    runProbe('Panel wycen', `${API_BASE}/quotations/panel/do-przypisania`, token, [401, 403]),
    runProbe('Zatwierdz. wycen', `${API_BASE}/quotations/panel/moje-zatwierdzenia`, token, [401, 403]),
    runProbe('Konfiguracja /mobile-config', `${API_BASE}/mobile-config`, token, [401, 403, 404]),
    runProbe('Rezerwacje sprzętu', `${API_BASE}/flota/rezerwacje?from=${from}&to=${to}`, token, [401, 403, 404]),
  ]);
}

export function DevPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState('testmode'); // 'testmode' | 'apihealth'
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [selectedUser, setSelectedUser] = useState('dyrektor');

  // API health state
  const [probes, setProbes] = useState(INITIAL_PROBES);
  const [running, setRunning] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef(null);

  useEffect(() => {
    setTestModeEnabled(isTestModeEnabled());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const runDiagnostics = useCallback(async () => {
    setRunning(true);
    try {
      const token = getStoredToken();
      const results = await runAllProbes(token);
      setProbes(results);
      const now = new Date().toISOString();
      const avg = calcAvgLatency(results);
      setHistory((prev) => {
        const next = [{ checkedAt: now, healthLabel: healthLabel(results), avgLatency: avg }, ...prev].slice(0, DIAG_HISTORY_MAX);
        saveHistory(next);
        return next;
      });
      setLastChecked(now);
    } finally {
      setRunning(false);
    }
  }, []);

  // Auto-refresh management
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (autoRefresh && isOpen && tab === 'apihealth') {
      autoRefreshRef.current = setInterval(runDiagnostics, AUTO_REFRESH_MS);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [autoRefresh, isOpen, tab, runDiagnostics]);

  const handleTestModeToggle = () => {
    const newState = !testModeEnabled;
    toggleTestMode(newState);
    setTestModeEnabled(newState);
    if (newState) {
      const user = TEST_USERS[selectedUser];
      clearAuthSession();
      localStorage.setItem('token', 'test_token_' + Date.now());
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.removeItem('permissions');
      alert(`✓ Tryb testowy włączony\nRola: ${getRoleDisplayName(user.rola)}`);
      window.location.reload();
    } else {
      clearAuthSession();
      alert('✗ Tryb testowy wyłączony');
      window.location.reload();
    }
  };

  const handleUserChange = (role) => {
    setSelectedUser(role);
    if (testModeEnabled) {
      const user = TEST_USERS[role];
      localStorage.setItem('user', JSON.stringify(user));
      alert(`✓ Zmieniono rolę na: ${getRoleDisplayName(user.rola)}`);
      window.location.reload();
    }
  };

  const handleInvalidSession = () => {
    const fallbackUser = TEST_USERS[selectedUser] || TEST_USERS.dyrektor;
    if (!localStorage.getItem('user')) {
      localStorage.setItem('user', JSON.stringify(fallbackUser));
      localStorage.removeItem('permissions');
    }
    localStorage.setItem('token', `invalid_dev_token_${Date.now()}`);
    window.location.hash = '#/dashboard';
    window.location.reload();
  };

  if (!isOpen) return null;

  const sparkline = buildSparkline(history);
  const okCount = probes.filter((p) => p.status === 'ok').length;
  const errCount = probes.filter((p) => p.status === 'error').length;

  return (
    <div className="dev-panel">
      <div className="dev-panel-content" style={{ maxWidth: 460 }}>
        <div className="dev-panel-header">
          <h3>🛠️ Dev Panel</h3>
          <button className="dev-panel-close" onClick={() => setIsOpen(false)} aria-label="Zamknij">×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {[['testmode', '🧪 Test mode'], ['apihealth', '📡 Diagnostyka API']].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: 'none',
              background: tab === key ? '#ff6b6b' : 'rgba(255,107,107,0.12)',
              color: tab === key ? '#fff' : '#ccc',
              fontWeight: tab === key ? 700 : 400,
              fontSize: 12,
              cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>

        {tab === 'testmode' && (
          <>
            <div className="dev-panel-section">
              <label>
                <input type="checkbox" checked={testModeEnabled} onChange={handleTestModeToggle} />
                Włącz tryb testowy
              </label>
              <p className="dev-panel-hint">
                {testModeEnabled ? '✓ Tryb testowy jest aktywny' : '✗ Tryb testowy jest wyłączony'}
              </p>
            </div>
            {testModeEnabled && (
              <div className="dev-panel-section">
                <label htmlFor="user-select">Testowy użytkownik:</label>
                <select id="user-select" value={selectedUser} onChange={(e) => handleUserChange(e.target.value)}>
                  <option value="dyrektor">Dyrektor</option>
                  <option value="kierownik">Kierownik Oddziału</option>
                  <option value="brygadzista">Brygadzista</option>
                  <option value="wyceniajacy">Specjalista ds. wyceny</option>
                </select>
              </div>
            )}
            <div className="dev-panel-section">
              <button
                type="button"
                onClick={handleInvalidSession}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,107,107,0.35)',
                  background: 'rgba(255,107,107,0.12)',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Symuluj niewazny token
              </button>
              <p className="dev-panel-hint">
                Zostawia uzytkownika w storage, ale podmienia JWT na bledny, zeby sprawdzic powrot do logowania po `401`.
              </p>
            </div>
          </>
        )}

        {tab === 'apihealth' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: '#aaa' }}>
                {probes.some((p) => p.status !== 'idle') ? `${healthLabel(probes)} · OK ${okCount}/${probes.length}` : 'Nie sprawdzono'}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <label style={{ fontSize: 11, color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} style={{ width: 14, height: 14, accentColor: '#ff6b6b', cursor: 'pointer' }} />
                  auto 30s
                </label>
                <button type="button" disabled={running} onClick={runDiagnostics} style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none', background: '#ff6b6b',
                  color: '#fff', fontWeight: 700, fontSize: 12, cursor: running ? 'default' : 'pointer', opacity: running ? 0.6 : 1,
                }}>
                  {running ? '…' : 'Sprawdź'}
                </button>
              </div>
            </div>

            {probes.map((p) => (
              <div key={p.name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12,
              }}>
                <span style={{ color: p.status === 'ok' ? '#4ade80' : p.status === 'error' ? '#f87171' : '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {p.status === 'ok' ? '✓' : p.status === 'error' ? '✗' : '○'} {p.name}
                </span>
                <span style={{ color: '#aaa', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {p.httpCode ? `HTTP ${p.httpCode}` : ''}
                  {p.latencyMs != null ? ` · ${p.latencyMs}ms` : ''}
                </span>
              </div>
            ))}

            {errCount > 0 && (
              <p style={{ fontSize: 11, color: '#f87171', marginTop: 8, marginBottom: 0 }}>
                {errCount} błąd(y) — sprawdź czy OS backend jest uruchomiony.
              </p>
            )}

            {history.length > 0 && (
              <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  Historia · latencja: <span style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{sparkline}</span>
                </div>
                {history.slice(0, 3).map((h, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{h.checkedAt ? new Date(h.checkedAt).toLocaleTimeString('pl-PL') : '—'}</span>
                    <span>{h.healthLabel}</span>
                    <span>{h.avgLatency != null ? `${h.avgLatency}ms` : '—'}</span>
                  </div>
                ))}
              </div>
            )}

            {lastChecked && (
              <p style={{ fontSize: 10, color: '#555', marginTop: 6, marginBottom: 0 }}>
                Ostatnie sprawdzenie: {new Date(lastChecked).toLocaleTimeString('pl-PL')}
              </p>
            )}
          </>
        )}

        <div className="dev-panel-footer">
          <p>Otwórz ponownie: Ctrl+Shift+D</p>
        </div>
      </div>
    </div>
  );
}
