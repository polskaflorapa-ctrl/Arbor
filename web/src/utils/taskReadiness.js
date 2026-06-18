export const TASK_READINESS_CHECKS = Object.freeze([
  {
    key: 'phone',
    label: 'Brak telefonu',
    isDone: (task) => String(task?.klient_telefon || task?.telefon || '').replace(/\D/g, '').length >= 7,
  },
  {
    key: 'address',
    label: 'Brak adresu',
    isDone: (task) => Boolean(String(task?.adres || task?.address || '').trim() || String(task?.miasto || '').trim()),
  },
  {
    key: 'scope',
    label: 'Brak zakresu',
    isDone: (task) => Boolean(String(task?.typ_uslugi || task?.opis || task?.opis_pracy || '').trim()),
  },
  {
    key: 'planned_date',
    label: 'Brak terminu',
    isDone: (task) => Boolean(String(task?.data_planowana || task?.data_wykonania || '').trim()),
  },
  {
    key: 'quote',
    label: 'Brak wyceny',
    isDone: (task) => (
      Number(task?.wartosc_planowana || 0) > 0 ||
      Number(task?.wartosc_finalna || 0) > 0 ||
      Number(task?.wartosc || 0) > 0
    ),
  },
  {
    key: 'team',
    label: 'Brak ekipy',
    isDone: (task) => Boolean(task?.ekipa_id || task?.ekipa_nazwa || task?.ekipa),
  },
]);

export function getTaskReadiness(task, checks = TASK_READINESS_CHECKS) {
  const items = checks.map((check) => ({
    key: check.key,
    label: check.label,
    done: Boolean(check.isDone(task)),
  }));
  const blockers = items.filter((item) => !item.done).map(({ key, label }) => ({ key, label }));
  const score = checks.length ? Math.round(((checks.length - blockers.length) / checks.length) * 100) : 100;
  return {
    ready: blockers.length === 0,
    score,
    blockers,
    items,
  };
}

export function summarizeTaskReadiness(tasks = []) {
  const rows = tasks.map((task) => ({
    ...task,
    readiness: getTaskReadiness(task),
  }));
  const blockedTasks = rows.filter((task) => !task.readiness.ready);
  const blockers = {};
  for (const task of blockedTasks) {
    for (const blocker of task.readiness.blockers) {
      blockers[blocker.key] = (blockers[blocker.key] || 0) + 1;
    }
  }
  return {
    total: rows.length,
    ready: rows.length - blockedTasks.length,
    blocked: blockedTasks.length,
    blockers,
    tasks: rows,
    blockedTasks,
  };
}
