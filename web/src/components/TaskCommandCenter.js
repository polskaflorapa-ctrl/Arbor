import {
  CREW_REQUIRED_TASK_STATUSES,
  FIELD_EVIDENCE_REQUIRED_TASK_STATUSES,
  TASK_STATUS,
  isTaskClosed,
  isTaskInProgress,
} from '../utils/taskWorkflow';

function day(value) {
  return value ? String(value).slice(0, 10) : '';
}

function isOpenIssue(issue) {
  const status = String(issue?.status || '').toLowerCase();
  return !status || status === 'zgloszony' || status === 'zgłoszony' || status === 'nowe';
}

function buildChecks({
  task,
  issues,
  photos,
  videos,
  documents,
  workflowSla,
  finishRequirements,
  activeWorkLog,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const plannedDay = day(task?.data_planowana || task?.data_wykonania);
  const status = String(task?.status || '');
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(status);
  const needsFieldEvidence = FIELD_EVIDENCE_REQUIRED_TASK_STATUSES.has(status);
  const openIssues = issues.filter(isOpenIssue).length;
  const mediaCount = photos.length + videos.length;
  const requiredPhotoOk =
    (!finishRequirements?.require_po_photo || finishRequirements?.has_po_photo) &&
    (!finishRequirements?.require_przed_photo || finishRequirements?.has_przed_photo);
  const workflowTotal = Number(workflowSla?.checklist_total) || 0;
  const workflowDone = Number(workflowSla?.checklist_done) || 0;

  return [
    {
      key: 'date',
      label: 'Termin',
      detail: plannedDay ? (plannedDay < today && !isTaskClosed(task?.status) ? 'Po terminie' : plannedDay) : 'Brak daty planowanej',
      ok: Boolean(plannedDay) && !(plannedDay < today && !isTaskClosed(task?.status)),
      target: 'szczegoly',
    },
    {
      key: 'team',
      label: 'Ekipa',
      detail: task?.ekipa_nazwa || (task?.ekipa_id ? `ID ${task.ekipa_id}` : 'Nieprzypisana'),
      ok: !needsCrew || Boolean(task?.ekipa_id || task?.ekipa_nazwa),
      target: 'szczegoly',
    },
    {
      key: 'client',
      label: 'Kontakt',
      detail: task?.klient_telefon ? 'Telefon klienta jest zapisany' : 'Brak telefonu klienta',
      ok: Boolean(task?.klient_telefon),
      target: 'szczegoly',
    },
    {
      key: 'media',
      label: 'Dokumentacja',
      detail: `${mediaCount} media, ${documents.length} dokumenty`,
      ok: !needsFieldEvidence || (mediaCount > 0 && requiredPhotoOk),
      target: 'zdjecia',
    },
    {
      key: 'issues',
      label: 'Problemy',
      detail: openIssues ? `${openIssues} otwarte` : 'Brak otwartych problemów',
      ok: openIssues === 0,
      target: 'problemy',
    },
    {
      key: 'workflow',
      label: 'Workflow',
      detail: workflowTotal ? `${workflowDone}/${workflowTotal} checklisty` : 'Brak checklisty',
      ok: workflowTotal === 0 ? true : workflowDone >= workflowTotal,
      target: 'workflow',
    },
    {
      key: 'worklog',
      label: 'Czas pracy',
      detail: activeWorkLog ? 'Trwa aktywny wpis czasu' : 'Brak aktywnego wpisu',
      ok: isTaskInProgress(task?.status) ? Boolean(activeWorkLog) : true,
      target: 'czas',
    },
  ];
}

function nextMove(checks, task) {
  const missing = checks.find((item) => !item.ok);
  if (missing) return { label: missing.label, detail: missing.detail, target: missing.target };
  if (task?.status === TASK_STATUS.NOWE) return { label: 'Wyślij do wyceniającego', detail: 'Biuro ma termin i kontakt, teren może działać', status: TASK_STATUS.WYCENA_TERENOWA };
  if (task?.status === TASK_STATUS.WYCENA_TERENOWA) return { label: 'Klient akceptuje', detail: 'Zdjęcia i cena wracają do biura', status: TASK_STATUS.DO_ZATWIERDZENIA };
  if (task?.status === TASK_STATUS.DO_ZATWIERDZENIA) return { label: 'Zatwierdź plan ekipy', detail: 'Biuro dopina termin, ekipę i odprawę', status: TASK_STATUS.ZAPLANOWANE };
  if (task?.status === TASK_STATUS.ZAPLANOWANE) return { label: 'Start realizacji', detail: 'Można przekazać ekipie', status: TASK_STATUS.W_REALIZACJI };
  if (isTaskInProgress(task?.status)) return { label: 'Zamknięcie', detail: 'Sprawdź płatność i dokumentację', finish: true };
  return { label: 'Monitoring', detail: 'Zlecenie bez krytycznych braków', target: 'workflow' };
}

export default function TaskCommandCenter({
  task,
  issues = [],
  photos = [],
  videos = [],
  documents = [],
  workflowSla,
  finishRequirements,
  activeWorkLog,
  canEdit,
  isCrew,
  onOpenTab,
  onStatusChange,
  onFinish,
  formatCurrency,
}) {
  const checks = buildChecks({
    task,
    issues,
    photos,
    videos,
    documents,
    workflowSla,
    finishRequirements,
    activeWorkLog,
  });
  const done = checks.filter((item) => item.ok).length;
  const score = Math.round((done / checks.length) * 100);
  const move = nextMove(checks, task);
  const value = Number(task?.wartosc_rzeczywista ?? task?.wartosc_planowana ?? 0) || 0;

  const runMove = () => {
    if (move.status && canEdit) onStatusChange?.(move.status);
    else if (move.status) onOpenTab?.('szczegoly');
    else if (move.finish && isCrew) onFinish?.();
    else if (move.finish) onOpenTab?.('workflow');
    else if (move.target) onOpenTab?.(move.target);
  };

  return (
    <section style={s.panel}>
      <div style={s.header}>
        <div>
          <div style={s.eyebrow}>Centrum decyzji zlecenia</div>
          <h2 style={s.title}>Gotowość operacyjna</h2>
        </div>
        <div style={s.scoreBox}>
          <span style={s.score}>{score}%</span>
          <span style={s.scoreLabel}>{done}/{checks.length}</span>
        </div>
      </div>

      <div style={s.moveRow}>
        <div>
          <div style={s.moveLabel}>Najbliższy ruch</div>
          <div style={s.moveText}>{move.label}</div>
          <div style={s.moveDetail}>{move.detail}</div>
        </div>
        <div style={s.valueBox}>
          <span style={s.valueLabel}>Wartość</span>
          <span style={s.value}>{formatCurrency ? formatCurrency(value) : value}</span>
        </div>
        <button type="button" style={s.primaryBtn} onClick={runMove}>
          Otwórz akcję
        </button>
      </div>

      <div style={s.grid}>
        {checks.map((item) => (
          <button key={item.key} type="button" style={s.check} onClick={() => onOpenTab?.(item.target)}>
            <span style={{ ...s.dot, background: item.ok ? 'var(--accent)' : 'var(--warning)' }} />
            <span style={s.checkText}>
              <span style={s.checkLabel}>{item.label}</span>
              <span style={s.checkDetail}>{item.detail}</span>
            </span>
            <span style={{ ...s.state, color: item.ok ? 'var(--accent)' : 'var(--warning)' }}>
              {item.ok ? 'OK' : 'Do uzupełnienia'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

const s = {
  panel: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    padding: 18,
    marginBottom: 20,
    boxShadow: 'var(--shadow-sm)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    letterSpacing: 0,
  },
  title: {
    margin: '4px 0 0',
    fontSize: 20,
    fontWeight: 800,
    color: 'var(--text)',
    letterSpacing: 0,
  },
  scoreBox: {
    minWidth: 88,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: '9px 10px',
    textAlign: 'right',
  },
  score: { display: 'block', fontSize: 25, lineHeight: 1, fontWeight: 850, color: 'var(--accent)' },
  scoreLabel: { display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)' },
  moveRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: 12,
    marginBottom: 12,
  },
  moveLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' },
  moveText: { marginTop: 3, fontSize: 16, color: 'var(--text)', fontWeight: 800 },
  moveDetail: { marginTop: 2, fontSize: 12, color: 'var(--text-sub)' },
  valueBox: { textAlign: 'right', minWidth: 132 },
  valueLabel: { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 },
  value: { display: 'block', marginTop: 3, fontSize: 15, color: 'var(--text)', fontWeight: 800 },
  primaryBtn: {
    minHeight: 36,
    border: '1px solid var(--border2)',
    borderRadius: 6,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
    gap: 10,
  },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 64,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    textAlign: 'left',
    padding: '10px 12px',
    cursor: 'pointer',
  },
  dot: { width: 9, height: 9, borderRadius: '50%', flexShrink: 0 },
  checkText: { display: 'grid', gap: 2, minWidth: 0, flex: 1 },
  checkLabel: { fontSize: 13, fontWeight: 800, color: 'var(--text)' },
  checkDetail: { fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  state: { fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
};
