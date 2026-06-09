import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Check, Play, RefreshCw, RotateCcw, Send, User } from 'lucide-react';
import api from '../api';
import CommandSidebar from '../components/CommandSidebar';
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

const VIEW_LABELS = {
  inbox: 'Inbox',
  today: 'Dzisiaj',
  upcoming: 'Nadchodzace',
  delegated: 'Delegowane',
  done: 'Gotowe',
};

const PRIORITY_META = {
  low: { label: 'Niski' },
  normal: { label: 'Normalny' },
  high: { label: 'Wazny' },
  urgent: { label: 'Pilne' },
};

const EMPTY_FORM = {
  assigned_to: '',
  title: '',
  opis: '',
  priority: 'normal',
  due_at: '',
};

function TaskButton({ children, leftIcon: LeftIcon, loading = false, fullWidth = false, style, disabled, ...props }) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: fullWidth ? '100%' : undefined,
        opacity: isDisabled ? 0.62 : 1,
        pointerEvents: isDisabled ? 'none' : undefined,
        ...style,
      }}
    >
      {!loading && LeftIcon ? <LeftIcon size={16} aria-hidden /> : null}
      <span>{loading ? 'Pracuje...' : children}</span>
    </button>
  );
}

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
      completed_at: task.completed_at || null,
      assignee_name: task.assignee_name || '',
      assignee_role: task.assignee_role || '',
      created_by_name: task.created_by_name || '',
    }));
}

function fullName(user) {
  return [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || user?.login || 'Pracownik';
}

function isOpenTask(task) {
  return OPEN_STATUSES.has(task?.status);
}

function getDayKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
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

function localDateTimeValue(dayOffset, hour) {
  const due = new Date();
  due.setDate(due.getDate() + dayOffset);
  due.setHours(hour, 0, 0, 0);
  const pad = (value) => String(value).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
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
  const [viewFilter, setViewFilter] = useState('inbox');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  const canManage = MANAGEMENT_ROLES.has(user?.rola);

  const setTaskDue = (dayOffset) => {
    setForm((prev) => ({
      ...prev,
      due_at: dayOffset === null ? '' : localDateTimeValue(dayOffset, dayOffset === 0 ? 17 : 9),
    }));
  };

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
      setMessage(err?.response?.data?.error || 'Nie udalo sie zaladowac zadan.');
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
    setForm((prev) => ({ ...prev, assigned_to: prev.assigned_to || String(stored.id || '') }));
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
    const todayKey = new Date().toISOString().slice(0, 10);

    return [...tasks]
      .filter((task) => {
        const due = getDueMeta(task);
        const dueKey = getDayKey(task.due_at);
        const matchesView =
          viewFilter === 'inbox'
            ? Number(task.assigned_to) === Number(user?.id) && isOpenTask(task)
            : viewFilter === 'today'
            ? Number(task.assigned_to) === Number(user?.id) && isOpenTask(task) && (due.today || due.overdue)
            : viewFilter === 'upcoming'
            ? Number(task.assigned_to) === Number(user?.id) && isOpenTask(task) && dueKey && dueKey > todayKey
            : viewFilter === 'delegated'
            ? Number(task.created_by) === Number(user?.id) && Number(task.assigned_to) !== Number(user?.id) && isOpenTask(task)
            : viewFilter === 'done'
            ? task.status === 'done'
            : true;
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
        return matchesView && matchesStatus && matchesPriority && matchesAssignee && (!needle || haystack.includes(needle));
      })
      .sort(sortTasks);
  }, [assigneeFilter, priorityFilter, query, statusFilter, tasks, user?.id, viewFilter]);

  const stats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const ownOpen = tasks.filter((task) => Number(task.assigned_to) === Number(user?.id) && isOpenTask(task));
    const delegatedOpen = tasks.filter((task) => Number(task.created_by) === Number(user?.id) && Number(task.assigned_to) !== Number(user?.id) && isOpenTask(task));
    const overdue = tasks.filter((task) => Number(task.assigned_to) === Number(user?.id) && getDueMeta(task).overdue);
    const today = tasks.filter((task) => Number(task.assigned_to) === Number(user?.id) && getDueMeta(task).today);
    const upcoming = tasks.filter((task) => {
      const dueKey = getDayKey(task.due_at);
      return Number(task.assigned_to) === Number(user?.id) && isOpenTask(task) && dueKey && dueKey > todayKey;
    });
    const done = tasks.filter((task) => Number(task.assigned_to) === Number(user?.id) && task.status === 'done');
    return { ownOpen, delegatedOpen, overdue, today, upcoming, done };
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
    const assignedTo = form.assigned_to || String(user?.id || '');
    if (!assignedTo || !form.title.trim()) {
      setMessage('Wpisz tytul zadania.');
      return;
    }
    if (!canManage && Number(assignedTo) !== Number(user?.id)) {
      setMessage('Mozesz dodawac tylko zadania dla siebie.');
      return;
    }
    setBusyId('create');
    setMessage('');
    try {
      const response = await api.post('/operator-tasks', {
        assigned_to: Number(assignedTo),
        title: form.title.trim(),
        opis: form.opis.trim(),
        priority: form.priority,
        due_at: toIsoFromLocal(form.due_at),
      });
      upsertTask(response.data);
      setForm({ ...EMPTY_FORM, assigned_to: String(user?.id || '') });
      setViewFilter(Number(assignedTo) === Number(user?.id) ? 'inbox' : 'delegated');
      setStatusFilter('open');
      setMessage('Zadanie dodane.');
    } catch (err) {
      setMessage(err?.response?.data?.error || 'Nie udalo sie dodac zadania.');
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
      setMessage(err?.response?.data?.error || 'Nie udalo sie zmienic zadania.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="operator-tasks-shell" style={S.wrap}>
      <CommandSidebar active="orders" />
      <main className="operator-tasks-main" style={S.main}>
        <header className="operator-tasks-header" style={S.header}>
          <div>
            <div style={S.eyebrow}>Osobisty organizer</div>
            <h1 style={S.title}>Moje zadania</h1>
            <p style={S.subtitle}>
              Zapisuj sprawy dla siebie, pilnuj terminow i domykaj prace jak w Todoist, ale wewnatrz Arbor.
            </p>
          </div>
          <div style={S.headerActions}>
            <TaskButton type="button" leftIcon={RefreshCw} style={S.secondaryBtn} onClick={loadData}>Odswiez</TaskButton>
            <TaskButton type="button" leftIcon={User} style={S.primaryBtn} onClick={() => navigate('/profil')}>Moj profil</TaskButton>
          </div>
        </header>

        <section className="operator-tasks-stats" style={S.stats}>
          <div style={S.stat}><span style={S.statLabel}>Inbox</span><strong style={S.statValue}>{stats.ownOpen.length}</strong><small style={S.statHint}>moje aktywne zadania</small></div>
          <div style={S.stat}><span style={S.statLabel}>Dzisiaj</span><strong style={S.statValue}>{stats.today.length}</strong><small style={S.statHint}>termin dzisiaj</small></div>
          <div style={S.stat}><span style={S.statLabel}>Po terminie</span><strong style={S.statValue}>{stats.overdue.length}</strong><small style={S.statHint}>wymaga reakcji</small></div>
          <div style={S.stat}><span style={S.statLabel}>Delegowane</span><strong style={S.statValue}>{stats.delegatedOpen.length}</strong><small style={S.statHint}>wyslane przeze mnie</small></div>
        </section>

        <section className="operator-tasks-views" style={S.viewTabs} aria-label="Widoki zadan">
          {Object.entries(VIEW_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              style={{ ...S.viewTab, ...(viewFilter === key ? S.viewTabActive : null) }}
              onClick={() => {
                setViewFilter(key);
                setStatusFilter(key === 'done' ? 'done' : 'open');
              }}
            >
              {label}
            </button>
          ))}
        </section>

        <div className="operator-tasks-grid" style={S.grid}>
          <section className="operator-tasks-panel operator-tasks-create" style={S.panel}>
            <div style={S.panelHeader}>
              <div>
                <div style={S.eyebrow}>{canManage ? 'Nowe zadanie' : 'Szybki wpis'}</div>
                <div style={S.panelTitle}>{canManage ? 'Dodaj lub deleguj' : 'Dodaj dla siebie'}</div>
              </div>
            </div>
            <form className="operator-tasks-form" style={S.form} onSubmit={createTask}>
              {canManage ? (
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
              ) : null}
              <label style={S.field}>
                <span style={S.label}>Zadanie</span>
                <input
                  style={S.input}
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="np. Oddzwonic do klienta, sprawdzic dokumenty..."
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
              <div style={S.field}>
                <span style={S.label}>Szybki termin</span>
                <div style={S.quickChips}>
                  <button type="button" style={S.quickChip} onClick={() => setTaskDue(0)}>Dzisiaj 17:00</button>
                  <button type="button" style={S.quickChip} onClick={() => setTaskDue(1)}>Jutro 09:00</button>
                  <button type="button" style={S.quickChip} onClick={() => setTaskDue(null)}>Bez terminu</button>
                </div>
              </div>
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
              <div style={S.field}>
                <span style={S.label}>Szybki priorytet</span>
                <div style={S.quickChips}>
                  {[
                    ['normal', 'Normalny'],
                    ['high', 'Wazny'],
                    ['urgent', 'Pilne'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      style={{ ...S.quickChip, ...(form.priority === key ? S.quickChipActive : null) }}
                      onClick={() => setForm((prev) => ({ ...prev, priority: key }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label style={S.field}>
                <span style={S.label}>Opis</span>
                <textarea
                  style={S.textarea}
                  value={form.opis}
                  onChange={(event) => setForm((prev) => ({ ...prev, opis: event.target.value }))}
                  placeholder="Szczegoly, link do zlecenia, oczekiwany wynik..."
                />
              </label>
              <TaskButton type="submit" leftIcon={Send} style={S.primaryWideBtn} loading={busyId === 'create'} fullWidth>
                {busyId === 'create' ? 'Dodaje...' : 'Dodaj zadanie'}
              </TaskButton>
            </form>
          </section>

          <section className="operator-tasks-panel operator-tasks-list" style={{ ...S.panel, ...S.listPanel }}>
            <div style={S.panelHeader}>
              <div>
                <div style={S.eyebrow}>{VIEW_LABELS[viewFilter] || 'Zadania'}</div>
                <div style={S.panelTitle}>{visibleTasks.length} pozycji</div>
              </div>
            </div>
            <div className="operator-tasks-toolbar" style={S.toolbar}>
              <input
                style={S.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj po tytule, osobie, opisie..."
                aria-label="Szukaj zadan"
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
              <div className="modern-data-empty">Brak zadan w tym widoku.</div>
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
                            <TaskButton type="button" leftIcon={Play} style={S.rowBtn} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'in_progress' })}>W toku</TaskButton>
                          ) : null}
                          {canChange && task.status === 'in_progress' ? (
                            <TaskButton type="button" leftIcon={RotateCcw} style={S.rowBtn} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'todo' })}>Do zrobienia</TaskButton>
                          ) : null}
                          {canChange && task.status !== 'done' && task.status !== 'archived' ? (
                            <TaskButton type="button" leftIcon={Check} style={S.rowBtnPrimary} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'done' })}>Gotowe</TaskButton>
                          ) : null}
                          {canManage && task.status === 'done' ? (
                            <TaskButton type="button" leftIcon={Archive} style={S.rowBtn} disabled={busyId === task.id} onClick={() => patchTask(task, { status: 'archived' })}>Archiwum</TaskButton>
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
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 10 },
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
  viewTabs: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-glass)', marginBottom: 14 },
  viewTab: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 850,
  },
  viewTabActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--on-accent)' },
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
  quickChips: { display: 'flex', flexWrap: 'wrap', gap: 7 },
  quickChip: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    padding: '7px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
  },
  quickChipActive: {
    border: '1px solid rgba(20,131,79,0.28)',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
  },
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
};
