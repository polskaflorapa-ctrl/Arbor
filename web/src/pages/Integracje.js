import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

const EMPTY_STATS = { total: 0, sent_demo: 0, byChannel: { sms: 0, email: 0, push: 0 } };
const ROLLBACK_MAX_AGE_DAYS = 14;

export default function Integracje() {
  const navigate = useNavigate();
  const { message, showMessage } = useTimedMessage();
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ channel: '', status: '', task_id: '' });
  const [selectedLogIds, setSelectedLogIds] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [retryAudit, setRetryAudit] = useState([]);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowTs, setNowTs] = useState(Date.now());
  const [security, setSecurity] = useState({ denylist: { users: [], channels: [] }, denylist_history: [] });
  const [users, setUsers] = useState([]);
  const [securityForm, setSecurityForm] = useState({ users: [], channels: [] });
  const [historyFilters, setHistoryFilters] = useState({ actor: '', action: '' });
  const [rollbackConfirmId, setRollbackConfirmId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const headers = authHeaders(token);
      const query = new URLSearchParams();
      if (filters.channel) query.set('channel', filters.channel);
      if (filters.status) query.set('status', filters.status);
      if (filters.task_id) query.set('task_id', filters.task_id);
      query.set('page', String(page));
      query.set('page_size', String(pageSize));
      query.set('sort_by', sortBy);
      query.set('sort_dir', sortDir);
      const [sRes, lRes] = await Promise.all([
        api.get('/integrations/stats', { headers }),
        api.get(`/integrations/logs${query.toString() ? `?${query.toString()}` : ''}`, { headers }),
      ]);
      const aRes = await api.get('/integrations/retry-audit', { headers });
      const [secRes, usersRes] = await Promise.all([
        api.get('/integrations/security', { headers }).catch(() => ({ data: { denylist: { users: [], channels: [] }, denylist_history: [] } })),
        api.get('/uzytkownicy', { headers }).catch(() => ({ data: [] })),
      ]);
      setStats(sRes.data || EMPTY_STATS);
      const items = Array.isArray(lRes.data?.items) ? lRes.data.items : [];
      setLogs(items);
      setTotalPages(Number(lRes.data?.total_pages) || 1);
      setTotalRows(Number(lRes.data?.total) || 0);
      setRetryAudit(Array.isArray(aRes.data) ? aRes.data : []);
      setSecurity(secRes.data || { denylist: { users: [], channels: [] }, denylist_history: [] });
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setSecurityForm({
        users: Array.isArray(secRes.data?.denylist?.users) ? secRes.data.denylist.users : [],
        channels: Array.isArray(secRes.data?.denylist?.channels) ? secRes.data.denylist.channels : [],
      });
      setSelectedLogIds([]);
    } catch (err) {
      showMessage(errorMessage('Błąd ładowania integracji'));
    } finally {
      setLoading(false);
    }
  }, [filters.channel, filters.status, filters.task_id, page, pageSize, sortBy, sortDir, navigate, showMessage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => {
      loadData();
    }, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, loadData]);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const retryLog = async (id) => {
    try {
      const token = getStoredToken();
      await api.post(`/integrations/logs/${id}/retry`, {}, { headers: authHeaders(token) });
      showMessage(successMessage('Retry wysłany (demo).'));
      loadData();
    } catch (err) {
      const retryAfter = Number(err?.response?.data?.retry_after_ms || 0);
      if (err?.response?.status === 429 && retryAfter > 0) {
        setCooldownUntil(Date.now() + retryAfter);
        showMessage(errorMessage(`Rate limit retry. Spróbuj ponownie za ${Math.ceil(retryAfter / 1000)}s.`));
        return;
      }
      showMessage(errorMessage('Błąd retry logu'));
    }
  };

  const retryBatch = async () => {
    if (!selectedLogIds.length) {
      showMessage(errorMessage('Zaznacz logi do retry.'));
      return;
    }
    try {
      const token = getStoredToken();
      const res = await api.post('/integrations/logs/retry-batch', { ids: selectedLogIds }, { headers: authHeaders(token) });
      if (res.data?.rate_limited && Number(res.data?.retry_after_ms || 0) > 0) {
        setCooldownUntil(Date.now() + Number(res.data.retry_after_ms));
      }
      showMessage(successMessage(`Retry batch wykonany: ${res.data?.retried || 0}`));
      loadData();
    } catch (err) {
      const retryAfter = Number(err?.response?.data?.retry_after_ms || 0);
      if (err?.response?.status === 429 && retryAfter > 0) {
        setCooldownUntil(Date.now() + retryAfter);
        showMessage(errorMessage(`Rate limit retry. Spróbuj ponownie za ${Math.ceil(retryAfter / 1000)}s.`));
        return;
      }
      showMessage(errorMessage('Błąd retry batch'));
    }
  };

  const exportCsv = () => {
    const token = getStoredToken();
    if (!token) return;
    const q = new URLSearchParams();
    if (filters.channel) q.set('channel', filters.channel);
    if (filters.status) q.set('status', filters.status);
    if (filters.task_id) q.set('task_id', filters.task_id);
    api.get(`/integrations/logs/export${q.toString() ? `?${q.toString()}` : ''}`, { headers: authHeaders(token), responseType: 'blob' })
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `integracje-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(() => showMessage(errorMessage('Błąd eksportu CSV')));
  };

  const saveDenylist = async () => {
    try {
      const token = getStoredToken();
      await api.patch('/integrations/security/denylist', securityForm, { headers: authHeaders(token) });
      showMessage(successMessage('Denylist zapisana.'));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Brak uprawnień lub błąd zapisu denylisty.'));
    }
  };

  const applyDenylistPreset = async (preset) => {
    try {
      const token = getStoredToken();
      await api.post('/integrations/security/denylist/preset', { preset }, { headers: authHeaders(token) });
      showMessage(successMessage('Preset denylisty zastosowany.'));
      loadData();
    } catch (err) {
      showMessage(errorMessage('Błąd zastosowania presetu denylisty.'));
    }
  };

  const rollbackDenylist = async (historyId) => {
    if (rollbackConfirmId !== historyId) {
      setRollbackConfirmId(historyId);
      showMessage(errorMessage('Kliknij ponownie "Cofnij do tego", aby potwierdzić rollback.'));
      return;
    }
    try {
      const token = getStoredToken();
      await api.post(`/integrations/security/denylist/rollback/${historyId}`, {}, { headers: authHeaders(token) });
      showMessage(successMessage('Rollback denylisty wykonany.'));
      setRollbackConfirmId(null);
      loadData();
    } catch (err) {
      setRollbackConfirmId(null);
      const apiMsg = String(err?.response?.data?.error || '').trim();
      showMessage(errorMessage(apiMsg || 'Błąd rollback denylisty.'));
    }
  };

  const exportDenylistHistoryCsv = () => {
    const rows = filteredDenylistHistory;
    const header = ['id', 'created_at', 'action', 'actor_user_name', 'next_channels', 'next_users'];
    const csv = [
      header.join(','),
      ...rows.map((h) =>
        [
          h.id,
          h.created_at,
          h.action,
          h.actor_user_name || h.actor_user_id || '',
          (h.next?.channels || []).join('|'),
          (h.next?.users || []).join('|'),
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `denylist-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const metrics = useMemo(() => [
    { label: 'Wszystkie logi', value: stats.total || 0 },
    { label: 'Wysłane (demo)', value: stats.sent_demo || 0 },
    { label: 'SMS', value: stats.byChannel?.sms || 0 },
    { label: 'E-mail', value: stats.byChannel?.email || 0 },
    { label: 'Push', value: stats.byChannel?.push || 0 },
  ], [stats]);

  const trend = useMemo(() => {
    const map = new Map();
    for (const l of logs) {
      const day = new Date(l.created_at).toISOString().slice(0, 10);
      map.set(day, (map.get(day) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([day, count]) => ({ day, count }));
  }, [logs]);
  const maxTrend = Math.max(1, ...trend.map((x) => x.count));
  const cooldownMsLeft = Math.max(0, cooldownUntil - nowTs);
  const retryLocked = cooldownMsLeft > 0;
  const filteredDenylistHistory = useMemo(() => {
    const actorQ = historyFilters.actor.trim().toLowerCase();
    const actionQ = historyFilters.action.trim().toLowerCase();
    return (security.denylist_history || []).filter((h) => {
      const actorName = String(h.actor_user_name || h.actor_user_id || '').toLowerCase();
      const action = String(h.action || '').toLowerCase();
      const actorOk = !actorQ || actorName.includes(actorQ);
      const actionOk = !actionQ || action.includes(actionQ);
      return actorOk && actionOk;
    });
  }, [security.denylist_history, historyFilters.actor, historyFilters.action]);

  const isRollbackAllowed = (item) => {
    const createdAtMs = new Date(item?.created_at || 0).getTime();
    if (!createdAtMs) return false;
    const maxAgeMs = ROLLBACK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - createdAtMs <= maxAgeMs;
  };

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        <PageHeader title="Integracje" subtitle="Globalny dashboard logów i retry" />
        <StatusMessage message={message} />

        <div style={styles.metrics}>
          {metrics.map((m) => (
            <div key={m.label} style={styles.metricCard}>
              <div style={styles.metricValue}>{m.value}</div>
              <div style={styles.metricLabel}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 10, color: retryLocked ? '#EF5350' : 'var(--text-muted)', fontSize: 12 }}>
          {retryLocked ? `Retry cooldown: ${Math.ceil(cooldownMsLeft / 1000)}s` : 'Retry gotowe'}
        </div>

        <div style={styles.filters}>
          <input
            style={styles.input}
            placeholder="ID zlecenia"
            value={filters.task_id}
            onChange={(e) => setFilters((f) => ({ ...f, task_id: e.target.value }))}
          />
          <select style={styles.input} value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}>
            <option value="">Wszystkie kanały</option>
            <option value="sms">SMS</option>
            <option value="email">E-mail</option>
            <option value="push">Push</option>
          </select>
          <select style={styles.input} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Wszystkie statusy</option>
            <option value="sent_demo">sent_demo</option>
          </select>
          <button type="button" style={styles.btn} onClick={loadData}>Odśwież</button>
          <button type="button" style={styles.btn} onClick={exportCsv}>Eksport CSV</button>
          <button type="button" style={styles.btn} onClick={retryBatch} disabled={retryLocked}>Retry batch</button>
          <label style={{ ...styles.input, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh 10s
          </label>
          <select style={styles.input} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="created_at">Sort: data</option>
            <option value="channel">Sort: kanał</option>
            <option value="status">Sort: status</option>
            <option value="task_id">Sort: zlecenie</option>
          </select>
          <select style={styles.input} value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
            <option value="desc">Malejąco</option>
            <option value="asc">Rosnąco</option>
          </select>
          <select style={styles.input} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value) || 25); setPage(1); }}>
            <option value={10}>10 / strona</option>
            <option value={25}>25 / strona</option>
            <option value={50}>50 / strona</option>
            <option value={100}>100 / strona</option>
          </select>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Trend dzienny (ostatnie 10 dni)</div>
          <div style={styles.trendRow}>
            {trend.length === 0 ? (
              <div style={styles.empty}>Brak danych trendu.</div>
            ) : trend.map((p) => (
              <div key={p.day} style={styles.trendCol}>
                <div style={{ ...styles.trendBar, height: `${Math.max(8, Math.round((p.count / maxTrend) * 90))}px` }} />
                <div style={styles.trendCount}>{p.count}</div>
                <div style={styles.trendLabel}>{p.day.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Wyniki: {totalRows}</span>
            <span>Strona {page} / {totalPages}</span>
          </div>
          {loading ? (
            <div style={styles.empty}>?adowanie...</div>
          ) : logs.length === 0 ? (
            <div style={styles.empty}>Brak log?w</div>
          ) : (
            <div className="modern-data-stack">
              {logs.map((l) => (
                <ModernDataRow
                  key={l.id}
                  idLabel="Integration Log"
                  idValue={`LOG-${l.id}`}
                  title={l.title}
                  subtitle={`${String(l.channel || '').toUpperCase()} ? #${l.task_id || '-'}`}
                  tone={l.status === 'ok' || l.status === 'sent' ? 'success' : l.status === 'error' ? 'danger' : 'info'}
                  status={l.status || 'brak'}
                  statusValue={l.status || 'brak'}
                  statusState={l.status === 'ok' || l.status === 'sent' ? 'success' : l.status === 'error' ? 'danger' : 'info'}
                  metrics={[
                    { label: 'Data', value: l.created_at ? new Date(l.created_at).toLocaleString('pl-PL') : 'brak' },
                    { label: 'Kana?', value: String(l.channel || '').toUpperCase() || 'brak' },
                    { label: 'Zlecenie', value: l.task_id ? `#${l.task_id}` : 'brak', tone: l.task_id ? 'info' : undefined },
                  ]}
                  actions={
                    <>
                      <label style={styles.checkboxAction}>
                        <input
                          type="checkbox"
                          checked={selectedLogIds.includes(l.id)}
                          onChange={(e) => {
                            setSelectedLogIds((prev) => (
                              e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id)
                            ));
                          }}
                        />
                        Select
                      </label>
                      <button type="button" style={styles.retryBtn} onClick={() => retryLog(l.id)} disabled={retryLocked}>Retry</button>
                    </>
                  }
                />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" style={styles.btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Poprzednia</button>
            <button type="button" style={styles.btn} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Następna</button>
          </div>
        </div>

        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Audit retry (ostatnie akcje)</div>
          {retryAudit.length === 0 ? (
            <div style={styles.empty}>Brak wpis?w audytu.</div>
          ) : (
            <div className="modern-data-stack">
              {retryAudit.slice(0, 20).map((a) => (
                <ModernDataRow
                  key={a.id}
                  idLabel="Retry Audit"
                  idValue={`AUD-${a.id}`}
                  title={a.actor_user_name || `User #${a.actor_user_id}`}
                  subtitle={a.created_at ? new Date(a.created_at).toLocaleString('pl-PL') : 'brak daty'}
                  tone="info"
                  status={a.mode || 'retry'}
                  statusValue={a.mode || 'retry'}
                  statusState="info"
                  metrics={[
                    { label: '?r?d?o logu', value: a.source_log_id ? `#${a.source_log_id}` : 'brak' },
                    { label: 'Nowy log', value: a.created_log_id ? `#${a.created_log_id}` : 'brak', tone: 'success' },
                    { label: 'IP', value: a.ip || 'brak' },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Retry by user (top)</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {Object.entries(stats.retry_by_user || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([name, cnt]) => (
                <div key={name} style={styles.workflowStatRow}>
                  <span>{name}</span>
                  <strong>{cnt}</strong>
                </div>
              ))}
            {Object.keys(stats.retry_by_user || {}).length === 0 && <div style={styles.empty}>Brak danych.</div>}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Denylist kanałów: {(stats.denylist?.channels || []).join(', ') || 'brak'} ·
            Denylist użytkowników: {(stats.denylist?.users || []).join(', ') || 'brak'}
          </div>
        </div>
        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Panel admina denylisty</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Kanały zablokowane</div>
              {['sms', 'email', 'push'].map((ch) => (
                <label key={ch} style={styles.workflowStatRow}>
                  <span>{ch.toUpperCase()}</span>
                  <input
                    type="checkbox"
                    checked={securityForm.channels.includes(ch)}
                    onChange={(e) => {
                      setSecurityForm((prev) => ({
                        ...prev,
                        channels: e.target.checked
                          ? [...prev.channels, ch]
                          : prev.channels.filter((x) => x !== ch),
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Użytkownicy zablokowani</div>
              <div style={{ maxHeight: 180, overflow: 'auto', display: 'grid', gap: 6 }}>
                {users.map((u) => (
                  <label key={u.id} style={styles.workflowStatRow}>
                    <span>{u.imie} {u.nazwisko} ({getRoleDisplayName(u.rola)})</span>
                    <input
                      type="checkbox"
                      checked={securityForm.users.includes(u.id)}
                      onChange={(e) => {
                        setSecurityForm((prev) => ({
                          ...prev,
                          users: e.target.checked
                            ? [...prev.users, u.id]
                            : prev.users.filter((x) => x !== u.id),
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" style={styles.btn} onClick={saveDenylist}>Zapisz denylistę</button>
            <button type="button" style={{ ...styles.btn, marginLeft: 8 }} onClick={() => applyDenylistPreset('block_sms_global')}>
              Preset: blokuj SMS globalnie
            </button>
            <button type="button" style={{ ...styles.btn, marginLeft: 8 }} onClick={() => applyDenylistPreset('allow_all_channels')}>
              Preset: odblokuj kanały
            </button>
            <button type="button" style={{ ...styles.btn, marginLeft: 8 }} onClick={() => applyDenylistPreset('clear_all')}>
              Preset: wyczyść wszystko
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Aktualna denylista (backend): kanały [{(security.denylist?.channels || []).join(', ') || 'brak'}], użytkownicy [{(security.denylist?.users || []).join(', ') || 'brak'}]
          </div>
        </div>
        <div style={styles.tableWrap}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Historia zmian denylisty</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
            <input
              style={styles.input}
              placeholder="Filtr: użytkownik"
              value={historyFilters.actor}
              onChange={(e) => setHistoryFilters((f) => ({ ...f, actor: e.target.value }))}
            />
            <input
              style={styles.input}
              placeholder="Filtr: akcja"
              value={historyFilters.action}
              onChange={(e) => setHistoryFilters((f) => ({ ...f, action: e.target.value }))}
            />
            <button type="button" style={styles.btn} onClick={exportDenylistHistoryCsv}>Eksport CSV</button>
          </div>
          {filteredDenylistHistory.length > 0 ? (
            <div className="modern-data-stack">
              {filteredDenylistHistory.slice(0, 50).map((h) => (
                <ModernDataRow
                  key={h.id}
                  idLabel="Denylist Change"
                  idValue={`DENY-${h.id}`}
                  title={h.action}
                  subtitle={h.actor_user_name || h.actor_user_id || 'system'}
                  tone={isRollbackAllowed(h) ? 'warning' : 'danger'}
                  status={isRollbackAllowed(h) ? 'ROLLBACK READY' : 'LOCKED'}
                  statusValue={isRollbackAllowed(h) ? 'warning' : 'danger'}
                  statusState={isRollbackAllowed(h) ? 'warning' : 'danger'}
                  metrics={[
                    { label: 'Data', value: h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : 'brak' },
                    { label: 'Kana?y next', value: (h.next?.channels || []).join(', ') || 'brak', mono: false },
                    { label: 'Userzy next', value: (h.next?.users || []).join(', ') || 'brak', mono: false },
                    { label: 'Kana?y diff', value: `-${((h.prev?.channels || []).filter((x) => !(h.next?.channels || []).includes(x))).join(', ') || 'brak'} / +${((h.next?.channels || []).filter((x) => !(h.prev?.channels || []).includes(x))).join(', ') || 'brak'}`, mono: false },
                  ]}
                  actions={
                    <>
                      {!isRollbackAllowed(h) ? (
                        <span style={styles.rollbackBlockedBadge}>niedost?pny ({ROLLBACK_MAX_AGE_DAYS}d+)</span>
                      ) : null}
                      <button
                        type="button"
                        style={{
                          ...styles.retryBtn,
                          borderColor: rollbackConfirmId === h.id ? '#EF5350' : 'var(--accent)',
                          color: rollbackConfirmId === h.id ? '#EF5350' : 'var(--accent)',
                          opacity: isRollbackAllowed(h) ? 1 : 0.45,
                          cursor: isRollbackAllowed(h) ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!isRollbackAllowed(h)}
                        onClick={() => rollbackDenylist(h.id)}
                      >
                        Cofnij do tego
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          ) : (
            <div style={styles.empty}>Brak historii zmian denylisty.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: 24 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 },
  metricCard: { background: 'var(--surface-glass)', borderRadius: 8, padding: 12, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)' },
  metricValue: { fontWeight: 800, fontSize: 22, color: 'var(--accent)' },
  metricLabel: { fontSize: 12, color: 'var(--text-muted)' },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  btn: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontWeight: 700 },
  tableWrap: { background: 'var(--surface-glass)', borderRadius: 8, padding: 12, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)', marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 12, padding: 8, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' },
  td: { fontSize: 13, padding: 8, borderBottom: '1px solid var(--border)' },
  retryBtn: { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--accent)', background: 'var(--surface-field)', cursor: 'pointer', fontWeight: 700 },
  checkboxAction: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 },
  empty: { padding: 18, color: 'var(--text-muted)' },
  trendRow: { display: 'flex', alignItems: 'flex-end', gap: 10, minHeight: 130 },
  trendCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 44 },
  trendBar: { width: 22, background: 'var(--accent-gradient)', borderRadius: 6 },
  trendLabel: { fontSize: 10, color: 'var(--text-muted)' },
  trendCount: { fontSize: 11, fontWeight: 700, color: 'var(--text)' },
  workflowStatRow: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 8px', backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', borderRadius: 8 },
  rollbackBlockedBadge: { display: 'inline-block', marginBottom: 6, fontSize: 11, color: '#EF5350', backgroundColor: 'rgba(239,83,80,0.12)', borderRadius: 999, padding: '2px 8px' },
};
