import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AutoFixHighOutlined from '@mui/icons-material/AutoFixHighOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import RestoreOutlined from '@mui/icons-material/RestoreOutlined';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SpeedOutlined from '@mui/icons-material/SpeedOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const RULES_KEY = 'autoplan_rules_v1';
const HISTORY_KEY = 'autoplan_history_v1';
const LAST_APPLIED_KEY = 'autoplan_last_applied_v1';
const DEFAULT_RULES = { maxTasksPerTeam: 12, cityDenylist: [] };
const MODES = ['cost', 'balanced', 'fast'];
const MODE_LABEL = {
  cost: 'Kosztowy',
  balanced: 'Zbalansowany',
  fast: 'Szybki',
};

const PRIORITY_MAP = {
  pilny: 4,
  wysoki: 3,
  high: 3,
  normalny: 2,
  sredni: 2,
  średni: 2,
  medium: 2,
  niski: 1,
  low: 1,
};

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadRules() {
  const raw = readJson(RULES_KEY, DEFAULT_RULES);
  const max = Number(raw?.maxTasksPerTeam);
  return {
    maxTasksPerTeam: Number.isFinite(max) ? Math.min(50, Math.max(1, Math.floor(max))) : DEFAULT_RULES.maxTasksPerTeam,
    cityDenylist: Array.isArray(raw?.cityDenylist)
      ? raw.cityDenylist.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

function saveRules(rules) {
  writeJson(RULES_KEY, {
    maxTasksPerTeam: Math.min(50, Math.max(1, Math.floor(Number(rules.maxTasksPerTeam) || DEFAULT_RULES.maxTasksPerTeam))),
    cityDenylist: rules.cityDenylist.map((x) => String(x).trim().toLowerCase()).filter(Boolean),
  });
}

function loadHistory() {
  const data = readJson(HISTORY_KEY, []);
  return Array.isArray(data) ? data : [];
}

function appendHistory(item) {
  const next = [
    { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() },
    ...loadHistory(),
  ].slice(0, 30);
  writeJson(HISTORY_KEY, next);
  return next;
}

function parsePriority(raw) {
  const s = String(raw || '').toLowerCase();
  return PRIORITY_MAP[s] ?? 1;
}

function taskDateKey(task) {
  const raw = task?.data_planowana || task?.data_zaplanowana || task?.data_wykonania || '';
  return String(raw).slice(0, 10);
}

function isClosedTask(task) {
  const s = String(task?.status || '').toLowerCase();
  return s.includes('zakoncz') || s.includes('zakończ') || s.includes('anul');
}

function teamDisplayName(team) {
  return team?.nazwa || team?.name || `#${team?.id}`;
}

function buildPlan(tasks, teams, mode, rules) {
  if (!tasks.length) return [];
  if (!teams.length) {
    return tasks.map((task) => ({
      taskId: String(task.id),
      client: task.klient_nazwa || `Zlecenie #${task.id}`,
      city: task.miasto || 'Brak miasta',
      priority: parsePriority(task.priorytet),
      currentTeamId: String(task.ekipa_id ?? ''),
      currentStatus: String(task.status ?? ''),
      suggestedTeamId: '',
      suggestedTeam: 'Brak dostępnej ekipy',
      reason: 'Brak ekip do planowania',
      travelPenalty: 0,
      loadScore: 0,
    }));
  }

  const teamLoad = new Map(teams.map((team) => [String(team.id), 0]));
  const sorted = [...tasks].sort((a, b) => {
    const p = parsePriority(b.priorytet) - parsePriority(a.priorytet);
    if (p !== 0) return p;
    return String(taskDateKey(a)).localeCompare(String(taskDateKey(b)));
  });

  return sorted.map((task) => {
    const taskCity = String(task.miasto || '').trim().toLowerCase();
    const cityBlocked = rules.cityDenylist.some((city) => city && (taskCity.includes(city) || city.includes(taskCity)));
    const base = {
      taskId: String(task.id),
      client: task.klient_nazwa || `Zlecenie #${task.id}`,
      city: task.miasto || 'Brak miasta',
      priority: parsePriority(task.priorytet),
      currentTeamId: String(task.ekipa_id ?? ''),
      currentStatus: String(task.status ?? ''),
    };
    if (cityBlocked) {
      return {
        ...base,
        suggestedTeamId: '',
        suggestedTeam: 'Pominięte',
        reason: 'Miasto jest na lokalnej liście blokad',
        travelPenalty: 0,
        loadScore: 0,
      };
    }

    let bestTeam = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const team of teams) {
      const id = String(team.id);
      const load = teamLoad.get(id) ?? 0;
      if (load >= rules.maxTasksPerTeam) continue;
      const teamCity = String(team.oddzial_nazwa || team.miasto || '').toLowerCase();
      const cityMatch = Boolean(taskCity && teamCity && (teamCity.includes(taskCity) || taskCity.includes(teamCity)));
      let score = -load * 2 + parsePriority(task.priorytet);
      if (cityMatch) score += 3;
      if (mode === 'cost') score += cityMatch ? 4 : -2;
      if (mode === 'fast') score += parsePriority(task.priorytet) * 1.4 - (cityMatch ? 0 : 1);
      if (mode === 'balanced') score += cityMatch ? 2 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestTeam = team;
      }
    }

    let picked = bestTeam;
    let overload = false;
    if (!picked) {
      overload = true;
      picked = [...teams].reduce((a, b) => ((teamLoad.get(String(a.id)) ?? 0) <= (teamLoad.get(String(b.id)) ?? 0) ? a : b));
    }

    const pickedId = String(picked.id);
    const nextLoad = (teamLoad.get(pickedId) ?? 0) + 1;
    teamLoad.set(pickedId, nextLoad);
    const teamCity = String(picked.oddzial_nazwa || picked.miasto || '').toLowerCase();
    const cityMatch = Boolean(taskCity && teamCity && (teamCity.includes(taskCity) || taskCity.includes(teamCity)));
    const reasons = ['priorytet', 'balans obciążenia'];
    if (cityMatch) reasons.push('zgodność miasta');
    if (overload) reasons.push('przekroczenie limitu');
    if (mode === 'cost') reasons.push('wariant kosztowy');
    if (mode === 'fast') reasons.push('wariant szybki');

    return {
      ...base,
      suggestedTeamId: pickedId,
      suggestedTeam: teamDisplayName(picked),
      reason: reasons.join(' · '),
      travelPenalty: cityMatch ? 0 : 1,
      loadScore: nextLoad,
    };
  });
}

function calcKpi(rows) {
  const tasks = rows.length;
  const travelRisk = rows.reduce((sum, row) => sum + row.travelPenalty, 0);
  const avgLoad = tasks ? rows.reduce((sum, row) => sum + row.loadScore, 0) / tasks : 0;
  return {
    tasks,
    travelRisk,
    avgLoad: Number(avgLoad.toFixed(1)),
    score: Number((100 - travelRisk * 8 - avgLoad * 2).toFixed(1)),
  };
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatCard({ icon, label, value }) {
  return (
    <div style={s.statCard}>
      <span style={s.statIcon}>{icon}</span>
      <span>
        <span style={s.statValue}>{value}</span>
        <span style={s.statLabel}>{label}</span>
      </span>
    </div>
  );
}

export default function AutoplanDnia() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [teams, setTeams] = useState([]);
  const [rules, setRules] = useState(() => loadRules());
  const [maxDraft, setMaxDraft] = useState(() => String(loadRules().maxTasksPerTeam));
  const [denyDraft, setDenyDraft] = useState(() => loadRules().cityDenylist.join(', '));
  const [mode, setMode] = useState('balanced');
  const [history, setHistory] = useState(() => loadHistory());
  const [lastApplied, setLastApplied] = useState(() => readJson(LAST_APPLIED_KEY, []));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMessage, setOkMessage] = useState('');
  const todayKey = localDateKey();

  const load = useCallback(async () => {
    const token = getStoredToken();
    const storedUser = readStoredUser();
    if (!token || !storedUser) {
      navigate('/');
      return;
    }
    setUser(storedUser);
    setLoading(true);
    setError('');
    setOkMessage('');
    try {
      const [tasksRes, teamsRes] = await Promise.all([
        api.get('/tasks/wszystkie?limit=100&offset=0', { headers: authHeaders(token) }),
        api.get('/ekipy', { headers: authHeaders(token) }),
      ]);
      setTasks(normalizeList(tasksRes.data));
      setTeams(normalizeList(teamsRes.data));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udało się załadować danych autoplanowania.'));
      setTasks([]);
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const openTasks = useMemo(
    () => tasks.filter((task) => !isClosedTask(task) && (!taskDateKey(task) || taskDateKey(task) >= todayKey)),
    [tasks, todayKey],
  );

  const scenarioMap = useMemo(() => ({
    cost: buildPlan(openTasks, teams, 'cost', rules),
    balanced: buildPlan(openTasks, teams, 'balanced', rules),
    fast: buildPlan(openTasks, teams, 'fast', rules),
  }), [openTasks, teams, rules]);

  const rows = scenarioMap[mode] || [];
  const modeKpi = useMemo(() => Object.fromEntries(MODES.map((m) => [m, calcKpi(scenarioMap[m] || [])])), [scenarioMap]);
  const bestMode = useMemo(() => MODES.reduce((best, current) => (modeKpi[current].score > modeKpi[best].score ? current : best), 'balanced'), [modeKpi]);
  const teamNameById = useMemo(() => Object.fromEntries(teams.map((team) => [String(team.id), teamDisplayName(team)])), [teams]);
  const canApply = ['Prezes', 'Dyrektor', 'Kierownik'].includes(user?.rola);
  const changedCount = rows.filter((row) => row.suggestedTeamId && (row.suggestedTeamId !== row.currentTeamId || String(row.currentStatus || '').toLowerCase() !== 'zaplanowane')).length;

  const persistRules = () => {
    const next = {
      maxTasksPerTeam: Number(maxDraft),
      cityDenylist: denyDraft.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
    };
    saveRules(next);
    const normalized = loadRules();
    setRules(normalized);
    setMaxDraft(String(normalized.maxTasksPerTeam));
    setDenyDraft(normalized.cityDenylist.join(', '));
    setOkMessage('Zapisano reguły i przeliczono warianty planu.');
  };

  const applyCurrentPlan = async () => {
    if (!canApply) {
      setError('Zastosowanie planu jest dostępne dla Prezesa, Dyrektora i Kierownika.');
      return;
    }
    const actionable = rows.filter((row) => row.suggestedTeamId && (row.suggestedTeamId !== row.currentTeamId || String(row.currentStatus || '').toLowerCase() !== 'zaplanowane'));
    if (!actionable.length) {
      setOkMessage('Brak zmian do zastosowania.');
      return;
    }
    const confirmed = window.confirm(`Zastosować przypisania dla ${actionable.length} zleceń?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setOkMessage('');
    const token = getStoredToken();
    const applied = [];
    let failed = 0;
    for (const row of actionable) {
      try {
        await api.put(`/tasks/${row.taskId}`, { ekipa_id: Number(row.suggestedTeamId), status: 'Zaplanowane' }, { headers: authHeaders(token) });
        applied.push({ taskId: row.taskId, prevTeamId: row.currentTeamId, prevStatus: row.currentStatus });
      } catch {
        failed += 1;
      }
    }
    writeJson(LAST_APPLIED_KEY, applied);
    setLastApplied(applied);
    const actor = [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || user?.rola || 'user';
    setHistory(appendHistory({ action: 'apply', mode, ok: applied.length, failed, changed: actionable.length, actor }));
    setSaving(false);
    setOkMessage(`Zastosowano: ${applied.length}. Błędy: ${failed}.`);
    await load();
  };

  const rollbackLastApply = async () => {
    if (!canApply) {
      setError('Rollback planu jest dostępny dla Prezesa, Dyrektora i Kierownika.');
      return;
    }
    if (!lastApplied.length) {
      setOkMessage('Brak ostatniego zastosowania do cofnięcia.');
      return;
    }
    const confirmed = window.confirm(`Cofnąć ostatnie zastosowanie planu (${lastApplied.length} zleceń)?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setOkMessage('');
    const token = getStoredToken();
    let ok = 0;
    let failed = 0;
    for (const item of lastApplied) {
      try {
        await api.put(
          `/tasks/${item.taskId}`,
          { ekipa_id: item.prevTeamId ? Number(item.prevTeamId) : null, status: item.prevStatus || 'Nowe' },
          { headers: authHeaders(token) },
        );
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    localStorage.removeItem(LAST_APPLIED_KEY);
    setLastApplied([]);
    const actor = [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || user?.rola || 'user';
    setHistory(appendHistory({ action: 'rollback', mode, ok, failed, changed: ok + failed, actor }));
    setSaving(false);
    setOkMessage(`Cofnięto: ${ok}. Błędy: ${failed}.`);
    await load();
  };

  const exportHistory = () => {
    if (!history.length) {
      setOkMessage('Historia autoplanowania jest pusta.');
      return;
    }
    downloadCsv('autoplan-historia.csv', [
      ['kiedy', 'akcja', 'tryb', 'zmieniono', 'ok', 'bledy', 'aktor'],
      ...history.map((item) => [item.at, item.action, item.mode, item.changed, item.ok, item.failed || 0, item.actor]),
    ]);
  };

  return (
    <div style={s.root}>
      <Sidebar />
      <main style={s.content}>
        <PageHeader
          title="Autoplan dnia"
          subtitle="Porównanie wariantów przypisania zleceń do ekip: koszt, balans i szybkość. Zmiany zapisują się dopiero po ręcznym zastosowaniu planu."
          icon={<AutoFixHighOutlined />}
          actions={(
            <>
              <button type="button" onClick={load} style={s.secondaryButton} disabled={loading || saving}>
                <RefreshOutlined style={{ fontSize: 18 }} />
                Odśwież
              </button>
              <button type="button" onClick={rollbackLastApply} style={s.secondaryButton} disabled={saving || !lastApplied.length}>
                <RestoreOutlined style={{ fontSize: 18 }} />
                Cofnij
              </button>
              <button type="button" onClick={applyCurrentPlan} style={s.primaryButton} disabled={saving || !changedCount}>
                <SaveOutlined style={{ fontSize: 18 }} />
                {saving ? 'Zapisywanie...' : 'Zastosuj plan'}
              </button>
            </>
          )}
        />

        <StatusMessage message={error || okMessage} tone={error ? 'error' : okMessage ? 'success' : undefined} />

        <section style={s.topGrid}>
          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Reguły lokalne</h2>
                <p style={s.cardSub}>Reguły są zapisane w tej przeglądarce i służą do szybkiego wariantowania.</p>
              </div>
              <TuneOutlined style={{ color: 'var(--accent)' }} />
            </div>
            <div style={s.formGrid}>
              <label style={s.field}>
                <span style={s.label}>Maks. zadań na ekipę</span>
                <input style={s.input} type="number" min="1" max="50" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)} />
              </label>
              <label style={s.field}>
                <span style={s.label}>Miasta wykluczone</span>
                <input style={s.input} value={denyDraft} onChange={(e) => setDenyDraft(e.target.value)} placeholder="np. warszawa, krakow" />
              </label>
            </div>
            <button type="button" onClick={persistRules} style={s.secondaryButton}>
              <SaveOutlined style={{ fontSize: 18 }} />
              Zapisz reguły
            </button>
            {!canApply ? <p style={s.roleGate}>Twoja rola może analizować plan, ale nie może go zastosować.</p> : null}
          </div>

          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>KPI wariantu</h2>
                <p style={s.cardSub}>Aktywny tryb: {MODE_LABEL[mode]}</p>
              </div>
            </div>
            <div style={s.statsGrid}>
              <StatCard icon={<GroupsOutlined />} label="Zadania" value={rows.length} />
              <StatCard icon={<RouteOutlined />} label="Ryzyko dojazdu" value={modeKpi[mode].travelRisk} />
              <StatCard icon={<SpeedOutlined />} label="Śr. obciążenie" value={modeKpi[mode].avgLoad} />
            </div>
          </div>
        </section>

        <section style={s.compareRow}>
          {MODES.map((m) => {
            const kpi = modeKpi[m];
            const active = mode === m;
            const best = bestMode === m;
            return (
              <button key={m} type="button" onClick={() => setMode(m)} style={{ ...s.compareCard, ...(active ? s.compareCardActive : {}) }}>
                <span style={s.compareTop}>
                  <span style={s.compareMode}>{MODE_LABEL[m]}</span>
                  {best ? <span style={s.bestTag}>BEST</span> : null}
                </span>
                <span style={s.compareLine}>Zadania: {kpi.tasks}</span>
                <span style={s.compareLine}>Ryzyko dojazdu: {kpi.travelRisk}</span>
                <span style={s.compareLine}>Śr. obciążenie: {kpi.avgLoad}</span>
                <span style={s.compareScore}>Score: {kpi.score}</span>
              </button>
            );
          })}
        </section>

        <section style={s.gridWide}>
          <div style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Plan do zastosowania</h2>
                <p style={s.cardSub}>{changedCount} zmian względem aktualnych przypisań</p>
              </div>
            </div>
            {loading ? (
              <div style={s.empty}>Ładowanie planu...</div>
            ) : rows.length === 0 ? (
              <div style={s.empty}>Brak otwartych zleceń do zaplanowania.</div>
            ) : (
              <div style={s.planTable}>
                {rows.map((row, idx) => (
                  <Fragment key={`${row.taskId}-${idx}`}>
                    {idx > 0 ? <div style={s.tableHairline} /> : null}
                    <button type="button" onClick={() => navigate(`/zlecenia/${row.taskId}`)} style={s.planRow}>
                      <span style={s.planId}>#{row.taskId}</span>
                      <span style={s.planMain}>
                        <span style={s.planClient}>{row.client}</span>
                        <span style={s.planMeta}>{row.city} · teraz: {teamNameById[row.currentTeamId] || row.currentTeamId || 'bez ekipy'} ({row.currentStatus || '-'})</span>
                        <span style={s.reason}>{row.reason}</span>
                      </span>
                      <span style={s.suggestedTeam}>{row.suggestedTeam}</span>
                    </button>
                  </Fragment>
                ))}
              </div>
            )}
          </div>

          <aside style={s.card}>
            <div style={s.cardHeader}>
              <div>
                <h2 style={s.cardTitle}>Historia</h2>
                <p style={s.cardSub}>Ostatnie zastosowania i rollbacki</p>
              </div>
              <button type="button" onClick={exportHistory} style={s.iconButton} title="Eksport CSV">
                <DownloadOutlined style={{ fontSize: 18 }} />
              </button>
            </div>
            {history.length === 0 ? (
              <div style={s.empty}>Historia jest pusta.</div>
            ) : (
              <div style={s.historyList}>
                {history.slice(0, 8).map((item, idx) => (
                  <Fragment key={item.id}>
                    {idx > 0 ? <div style={s.tableHairline} /> : null}
                    <div style={s.historyRow}>
                      <span style={s.historyAction}>{item.action === 'apply' ? 'APPLY' : 'ROLLBACK'}</span>
                      <span style={s.historyMeta}>
                        {item.at.slice(0, 16).replace('T', ' ')} · {MODE_LABEL[item.mode] || item.mode}
                      </span>
                      <span style={s.historyMeta}>
                        zmiany {item.changed} · OK {item.ok} · błędy {item.failed || 0}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}

const s = {
  root: { display: 'flex', minHeight: '100vh', background: 'var(--forest-pattern), linear-gradient(180deg, rgba(20,53,31,0.28) 0%, var(--bg-deep) 100%)' },
  content: { flex: 1, minWidth: 0, padding: 'clamp(16px, 4vw, 32px)', overflowX: 'hidden' },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid var(--border2)',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    borderRadius: 10,
    padding: '9px 13px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: 'var(--shadow-sm)',
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card2)',
    color: 'var(--text)',
    borderRadius: 10,
    padding: '9px 13px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  iconButton: {
    width: 34,
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border2)',
    background: 'var(--bg-card2)',
    color: 'var(--text-sub)',
    borderRadius: 9,
    cursor: 'pointer',
  },
  topGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 18, marginBottom: 18 },
  gridWide: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 18 },
  card: {
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.18)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))',
    boxShadow: 'var(--shadow-sm)',
    padding: 18,
    minWidth: 0,
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 14 },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 750, color: 'var(--text)', letterSpacing: '0' },
  cardSub: { margin: '4px 0 0', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', lineHeight: 1.4 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  label: { fontSize: 12, fontWeight: 700, color: 'var(--text-sub)' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid var(--border2)',
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 650,
    outline: 'none',
  },
  roleGate: { margin: '10px 0 0', color: 'var(--warning)', fontSize: 12, fontWeight: 700 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 110px), 1fr))', gap: 10 },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.14)',
    background: 'rgba(5,10,7,0.68)',
    padding: 12,
  },
  statIcon: { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' },
  statValue: { display: 'block', color: 'var(--text)', fontSize: 20, fontWeight: 800, lineHeight: 1 },
  statLabel: { display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 11, fontWeight: 650 },
  compareRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14, marginBottom: 18 },
  compareCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
    border: '1px solid rgba(191,225,146,0.18)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))',
    color: 'inherit',
    borderRadius: 8,
    padding: 14,
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
  },
  compareCardActive: { border: '1px solid var(--accent)', boxShadow: '0 0 0 1px var(--accent)' },
  compareTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  compareMode: { color: 'var(--text)', fontSize: 14, fontWeight: 800 },
  bestTag: { borderRadius: 999, background: 'rgba(52,211,153,0.14)', color: 'var(--success)', padding: '2px 8px', fontSize: 10, fontWeight: 850 },
  compareLine: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 600 },
  compareScore: { marginTop: 4, color: 'var(--accent)', fontSize: 14, fontWeight: 850 },
  empty: { padding: '18px 0', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 },
  planTable: { borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(191,225,146,0.14)', background: 'rgba(5,10,7,0.68)' },
  planRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 78,
    padding: '12px 14px',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
  },
  tableHairline: { height: 1, marginLeft: 14, marginRight: 14, background: 'var(--border2)' },
  planId: { width: 58, flexShrink: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 850, fontVariantNumeric: 'tabular-nums' },
  planMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  planClient: { color: 'var(--text)', fontSize: 14, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  planMeta: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  reason: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  suggestedTeam: {
    flexShrink: 0,
    maxWidth: 190,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--success)',
    background: 'rgba(52,211,153,0.12)',
    border: '1px solid rgba(52,211,153,0.22)',
    borderRadius: 999,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  historyList: { borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(191,225,146,0.14)', background: 'rgba(5,10,7,0.68)' },
  historyRow: { display: 'flex', flexDirection: 'column', gap: 3, padding: '11px 12px' },
  historyAction: { color: 'var(--accent)', fontSize: 12, fontWeight: 850 },
  historyMeta: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 650 },
};
