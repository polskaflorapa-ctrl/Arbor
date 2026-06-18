import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import ModernDataRow from '../components/ModernDataRow';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getStoredToken } from '../utils/storedToken';

const MANAGEMENT_ROLES = new Set(['Administrator', 'Dyrektor', 'Kierownik']);
const OPEN_STATUSES = new Set(['todo', 'in_progress']);

const STATUS_LABELS = {
  all: 'Wszystkie statusy',
  open: 'Aktywne',
  todo: 'Do zrobienia',
  in_progress: 'W toku',
  done: 'Gotowe',
  archived: 'Archiwum',
};

const PRIORITY_META = {
  low: { label: 'Niski', tone: 'muted' },
  normal: { label: 'Normalny', tone: 'info' },
  high: { label: 'Ważny', tone: 'warn' },
  urgent: { label: 'Pilne', tone: 'danger' },
};

const EMPTY_FORM = {
  assigned_to: '',
  title: '',
  opis: '',
  priority: 'normal',
  due_at: '',
};

function taskPriorityTone(priority) {
  if (priority === 'urgent') return 'danger';
  if (priority === 'high') return 'warning';
  return 'info';
}

function taskStatusTone(status) {
  if (status === 'done') return 'success';
  if (status === 'archived') return 'danger';
  if (status === 'in_progress') return 'info';
  return 'warning';
}

function normalizeTasks(payload) {
  const rows = Array.isArray(payload?.tasks) ? payload.tasks : Array.isArray(payload) ? payload : [];
  return rows
    .filter(Boolean)
    .map((task) => ({
      ...task,
      id: Number(task.id),
      assigned_to: Number(task.assigned_to),
      created_by: Number(task.created_by),
      title: task.title || '',
      opis: task.opis || '',
      status: task.status || 'todo',
      priority: task.priority || 'normal',
      due_at: task.due_at || null,
      created_at: task.created_at || null,
      updated_at: task.updated_at || null,
      completed_at: task.completed_at || null,
      assignee_name: task.assignee_name || '',
      assignee_role: task.assignee_role || '',
      created_by_name: task.created_by_name || '',
    }));
}

function fullName(user) {
  return [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || user?.login || 'Pracownik';
}

function formatDateTime(value) {
  if (!value) return 'bez terminu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'bez terminu';
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isOpenTask(task) {
  return OPEN_STATUSES.has(task?.status);
}

function getDueMeta(task) {
  if (!task?.due_at) return { label: 'bez terminu', overdue: false, today: false, sort: '9999-12-31T23:59:59.999Z' };
  const date = new Date(task.due_at);
  if (Number.isNaN(date.getTime())) return { label: 'bez terminu', overdue: false, today: false, sort: '9999-12-31T23:59:59.999Z' };
  const today = new Date().toISOString().slice(0, 10);
  const day = date.toISOString().slice(0, 10);
  return {
    label: formatDateTime(task.due_at),
    overdue: isOpenTask(task) && date.getTime() < Date.now(),
    today: isOpenTask(task) && day === today,
    sort: date.toISOString(),
  };
}

function toIsoFromLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sortTasks(a, b) {
  const aOpen = isOpenTask(a);
  const bOpen = isOpenTask(b);
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  const aDue = getDueMeta(a).sort;
  const bDue = getDueMeta(b).sort;
  return aDue.localeCompare(bDue) || new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

export default function ZadaniaOperatora() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  const canManage = MANAGEMENT_ROLES.has(user?.rola);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [tasksRes, usersRes] = await Promise.all([
        api.get('/operator-tasks', { dedupe: false }),
        api.get('/uzytkownicy', { dedupe: false }).catch(() => ({ data: [] })),
      ]);
      setTasks(normalizeTasks(tasksRes.data));
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
    } catch (err) {
      setMessage(err?.response?.data?.error || 'Nie udało się załadować zadań.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = readStoredUser();
    if (!getStoredToken() || !stored) {
      navigate('/');
      return;
    }
    setUser(stored);
    loadData();
  }, [loadData, navigate]);

  const assignableUsers = useMemo(() => {
    const active = users.filter((row) => row.aktywny !== false);
    if (user?.rola === 'Kierownik') {
      return active.filter((row) => String(row.oddzial_id || '') === String(user.oddzial_id || '') || Number(row.id) === Number(user.id));
    }
    return active;
  }, [user, users]);

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...tasks]
      .filter((task) => {
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'open' ? isOpenTask(task) : task.status === statusFilter);
        const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
        const matchesAssignee = assigneeFilter === 'all' || String(task.assigned_to) === String(assigneeFilter);
        const haystack = [
          task.title,
          task.opis,
          task.assignee_name,
          task.assignee_role,
          task.created_by_name,
          STATUS_LABELS[task.status],
          PRIORITY_META[task.priority]?.label,
        ].join(' ').toLowerCase();
        return matchesStatus && matchesPriority && matchesAssignee && (!needle || haystack.includes(needle));
      })
      .sort(sortTasks);
  }, [assigneeFilter, priorityFilter, query, statusFilter, tasks]);

  const stats = useMemo(() => {
    const ownOpen = tasks.filter((task) => Number(task.assigned_to) === Number(user?.id) && isOpenTask(task));
    const delegatedOpen = tasks.filter((task) => Number(task.created_by) === Number(user?.id) && isOpenTask(task));
    const overdue = tasks.filter((task) => getDueMeta(task).overdue);
    const done = tasks.filter((task) => task.status === 'done');
    return { ownOpen, delegatedOpen, overdue, done };
  }, [tasks, user?.id]);

  const upsertTask = (updated) => {
    setTasks((prev) => {
      const normalized = normalizeTasks([updated])[0];
      if (!normalized) return prev;
      return prev.some((task) => Number(task.id) === Number(normalized.id))
        ? prev.map((task) => (Number(task.id) === Number(normalized.id) ? normalized : task))
        : [normalized, ...prev];
    });
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (!canManage) return;
    if (!form.assigned_to || !form.title.trim()) {
      setMessage('Wybierz pracownika i wpisz zadanie.');
      return;
    }
    setBusyId('create');
    setMessage('');
    try {
      const response = await api.post('/operator-tasks', {
        assigned_to: Number(form.assigned_to),
        title: form.title.trim(),
        opis: form.opis.trim(),
        priority: form.priority,
        due_at: toIsoFromLocal(form.due_at),
      });
      upsertTask(response.data);
      setForm(EMPTY_FORM);
      setMessage('Zadanie wysłane do profilu pracownika.');
    } catch (err) {
      setMessage(err?.response?.data?.error || 'Nie udało się wysłać zadania.');
    } finally {
      setBusyId(null);
    }
  };

  const patchTask = async (task, patch) => {
    if (!task?.id) return;
    setBusyId(task.id);
    setMessage('');
    try {
      const response = await api.patch(`/operator-tasks/${task.id}`, patch);
      upsertTask(response.data);
    } catch (err) {
      setMessage(err?.response?.data?.error || 'Nie udało się zmienić zadania.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="operator-tasks-shell" style={S.wrap}>
      <Sidebar />
      <main className="operator-tasks-main" style={S.main}>
        <header className="operator-tasks-header" style={S.header}>
          <div>
            <div style={S.eyebrow}>Zadania zespołu</div>
            <h1 style={S.title}>Panel Todo Polska Flora</h1>
            <p style={S.subtitle}>
              Przydzielaj zadania pracownikom, śledź terminy i domykaj sprawy widoczne bezpośrednio w profilu.
            </p>
          </div>
          <div style={S.headerActions}>
            <button type="button" style={S.secondaryBtn} onClick={loadData}>Odśwież</button>
            <button type="button" style={S.primaryBtn} onClick={() => navigate('/profil')}>Mój profil</button>
          </div>
        </header>

        <section className="operator-tasks-stats" style={S.stats}>
          <div style={S.stat}><span style={S.statLabel}>Moje aktywne</span><strong style={S.statValue}>{stats.ownOpen.length}</strong><small style={S.statHint}>zadania przypisane do mnie</small></div>
          <div style={S.stat}><span style={S.statLabel}>Wysłane przeze mnie</span><strong style={S.statValue}>{stats.delegatedOpen.length}</strong><small style={S.statHint}>otwarte polecenia</small></div>
          <div style={S.stat}><span style={S.statLabel}>Po terminie</span><strong style={S.statValue}>{stats.overdue.length}</strong><small style={S.statHint}>wymagają reakcji</small></div>
          <div style={S.stat}><span style={S.statLabel}>Gotowe</span><strong style={S.statValue}>{stats.done.length}</strong><small style={S.statHint}>zamknięte w rejestrze</small></div>
        </section>

        <div className="operator-tasks-grid" style={S.grid}>
          {canManage ? (
            <section className="operator-tasks-panel operator-tasks-create" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Nowe polecenie</div>
                  <div style={S.panelTitle}>Wyślij do profilu pracownika</div>
                </div>
              </div>
              <form className="operator-tasks-form" style={S.form} onSubmit={createTask}>
                <label style={S.field}>
                  <span style={S.label}>Pracownik</span>
                  <select
                    style={S.input}
                    value={form.assigned_to}
                    onChange={(event) => setForm((prev) => ({ ...prev, assigned_to: event.target.value }))}
                    aria-label="Pracownik zadania"
                  >
                    <option value="">Wybierz pracownika</option>
                    {assignableUsers.map((row) => (
                      <option key={row.id} value={row.id}>{fullName(row)} ({getRoleDisplayName(row.rola)})</option>
                    ))}
                  </select>
                </label>
                <label style={S.field}>
                  <span style={S.label}>Zadanie</span>
                  <input
                    style={S.input}
                    value={form.title}
                    onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="np. Sprawdź dokumenty do zlecenia"
                  />
                </label>
                <label style={S.field}>
                  <span style={S.label}>Termin</span>
                  <input
                    style={S.input}
                    type="datetime-local"
                    value={form.due_at}
                    onChange={(event) => setForm((prev) => ({ ...prev, due_at: event.target.value }))}
                  />
                </label>
                <label style={S.field}>
                  <span style={S.label}>Priorytet</span>
                  <select
                    style={S.input}
                    value={form.priority}
                    onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                    aria-label="Priorytet zadania"
                  >
                    {Object.entries(PRIORITY_META).map(([key, meta]) => (
                      <option key={key} value={key}>{meta.label}</option>
                    ))}
                  </select>
                </label>
                <label style={S.field}>
                  <span style={S.label}>Opis</span>
                  <textarea
                    style={S.textarea}
                    value={form.opis}
                    onChange={(event) => setForm((prev) => ({ ...prev, opis: event.target.value }))}
                    placeholder="Szczegóły, link do zlecenia, oczekiwany wynik..."
                  />
                </label>
                <button type="submit" style={S.primaryWideBtn} disabled={busyId === 'create'}>
                  {busyId === 'create' ? 'Wysyłam...' : 'Wyślij zadanie'}
                </button>
              </form>
            </section>
          ) : null}

          <section className="operator-tasks-panel operator-tasks-list" style={{ ...S.panel, ...S.listPanel }}>
            <div style={S.panelHeader}>
              <div>
                <div style={S.eyebrow}>Rejestr zadań</div>
                <div style={S.panelTitle}>{visibleTasks.length} pozycji</div>
              </div>
            </div>
            <div className="operator-tasks-toolbar" style={S.toolbar}>
              <input
                style={S.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj po tytule, osobie, opisie..."
                aria-label="Szukaj zadań"
              />
              <select style={S.input} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status zadania">
                <option value="open">Aktywne</option>
                <option value="all">Wszystkie statusy</option>
                <option value="todo">Do zrobienia</option>
                <option value="in_progress">W toku</option>
                <option value="done">Gotowe</option>
                <option value="archived">Archiwum</option>
              </select>
              <select style={S.input} value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Priorytet">
                <option value="all">Wszystkie priorytety</option>
                {Object.entries(PRIORITY_META).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
              {canManage ? (
                <select style={S.input} value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} aria-label="Pracownik">
                  <option value="all">Wszyscy pracownicy</option>
                  {assignableUsers.map((row) => (
                    <option key={row.id} value={row.id}>{fullName(row)}</option>
                  ))}
                </select>
              ) : null}
            </div>

            {message ? <div style={S.alert}>{message}</div> : null}
            {loading ? (
              <div className="modern-data-empty">Ladowanie zadan...</div>
            ) : visibleTasks.length === 0 ? (
              <div className="modern-data-empty">Brak zadan pasujacych do filtrow.</div>
            ) : (
              <div className="modern-data-stack">
                {visibleTasks.map((task) => {
                  const due = getDueMeta(task);
                  const priority = PRIORITY_META[task.priority] || PRIORITY_META.normal;
                  const canChange = canManage || Number(task.assigned_to) === Number(user?.id) || Number(task.created_by) === Number(user?.id);
                  return (
                    <ModernDataRow
                      key={task.id}
                      idLabel="Task ID"
                      idValue={`TASK-${task.id}`}
                      title={task.title}
                      subtitle={task.opis || 'Brak opisu'}
                      tone={due.overdue ? 'danger' : taskPriorityTone(task.priority)}
                      status={STATUS_LABELS[task.status] || task.status}
                      statusValue={task.status}
                      statusState={taskStatusTone(task.status)}
                      metrics={[
                        { label: 'Priorytet', value: priority.label, tone: taskPriorityTone(task.priority), mono: false },
                        { label: 'Osoba', value: task.assignee_name || `#${task.assigned_to}`, mono: false },
                        { label: 'Utworzyl', value: task.created_by_name || `#${task.created_by}`, mono: false },
                        { label: 'Termin', value: due.label, tone: due.overdue ? 'danger' : due.today ? 'warning' : undefined, mono: false },
                      ]}
                      actions={
                        <>
                          {canChange && task.status !== 'in_progress' && task.status !== 'done' && task.status !== 'archived' ? (
                            <button type="button" style={S.rowBtn} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'in_progress' })}>W toku</button>
                          ) : null}
                          {canChange && task.status === 'in_progress' ? (
                            <button type="button" style={S.rowBtn} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'todo' })}>Do zrobienia</button>
                          ) : null}
                          {canChange && task.status !== 'done' && task.status !== 'archived' ? (
                            <button type="button" style={S.rowBtnPrimary} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'done' })}>Gotowe</button>
                          ) : null}
                          {canManage && task.status === 'done' ? (
                            <button type="button" style={S.rowBtn} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'archived' })}>Archiwum</button>
                          ) : null}
                        </>
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

const S = {
  wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main: { flex: 1, padding: '24px 28px 48px', minWidth: 0 },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    padding: 18,
    borderRadius: 8,
    border: '1px solid var(--glass-border)',
    background: 'var(--surface-glass)',
    boxShadow: 'var(--shadow-md)',
    marginBottom: 14,
  },
  eyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  title: { margin: '4px 0 8px', color: 'var(--text)', fontSize: 28, lineHeight: 1.1, fontWeight: 900 },
  subtitle: { margin: 0, color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.45, fontWeight: 650, maxWidth: 740 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryBtn: {
    minHeight: 40,
    border: '1px solid rgba(20,131,79,0.24)',
    borderRadius: 8,
    background: 'var(--accent-gradient)',
    color: 'var(--on-accent)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 900,
  },
  secondaryBtn: {
    minHeight: 40,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 850,
  },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 },
  stat: {
    minHeight: 92,
    display: 'grid',
    gap: 5,
    alignContent: 'space-between',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    boxShadow: 'var(--shadow-sm)',
    padding: '12px 14px',
  },
  statLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  statValue: { color: 'var(--accent)', fontSize: 24, fontWeight: 950, lineHeight: 1.1 },
  statHint: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(310px, 360px) minmax(0, 1fr)', gap: 14, alignItems: 'start' },
  panel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    boxShadow: 'var(--shadow-md)',
    padding: 14,
    minWidth: 0,
  },
  listPanel: { gridColumn: 'auto' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  panelTitle: { color: 'var(--text)', fontSize: 18, lineHeight: 1.2, fontWeight: 900 },
  form: { display: 'grid', gap: 10 },
  field: { display: 'grid', gap: 5 },
  label: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  toolbar: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 },
  input: {
    minHeight: 40,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 700,
    outline: 'none',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  textarea: {
    minHeight: 88,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text)',
    padding: '9px 10px',
    fontSize: 13,
    fontWeight: 700,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  primaryWideBtn: {
    minHeight: 42,
    border: '1px solid rgba(20,131,79,0.24)',
    borderRadius: 8,
    background: 'var(--accent-gradient)',
    color: 'var(--on-accent)',
    padding: '9px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 950,
  },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 920 },
  th: {
    textAlign: 'left',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    background: 'var(--surface-field)',
    borderBottom: '1px solid var(--border)',
    padding: '10px 12px',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  trOverdue: { background: 'rgba(248,113,113,0.06)' },
  td: { padding: '12px', verticalAlign: 'top', color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.4 },
  taskTitle: { display: 'block', color: 'var(--text)', fontSize: 14, fontWeight: 900, marginBottom: 5 },
  cellTitle: { display: 'block', color: 'var(--text)', fontSize: 13, fontWeight: 850 },
  muted: { display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, marginTop: 5 },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 24,
    padding: '3px 8px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    fontSize: 12,
    fontWeight: 900,
  },
  badgeOk: { color: '#34D399', borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.09)' },
  badgeInfo: { color: '#60A5FA', borderColor: 'rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.09)' },
  badgeWarn: { color: '#F9A825', borderColor: 'rgba(249,168,37,0.35)', background: 'rgba(249,168,37,0.09)' },
  badgeDanger: { color: '#F87171', borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.09)' },
  badgeMuted: { color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--surface-field)' },
  due: { display: 'inline-flex', color: 'var(--text-sub)', fontWeight: 850 },
  dueToday: { color: '#F9A825' },
  dueOverdue: { color: '#F87171' },
  rowActions: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  rowBtn: {
    minHeight: 32,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
  },
  rowBtnPrimary: {
    minHeight: 32,
    border: '1px solid rgba(20,131,79,0.24)',
    borderRadius: 8,
    background: 'var(--accent-gradient)',
    color: 'var(--on-accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
  },
  alert: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '10px 12px',
    marginBottom: 10,
    fontSize: 13,
    fontWeight: 800,
  },
  empty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '16px 12px',
    color: 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.45,
  },
};
