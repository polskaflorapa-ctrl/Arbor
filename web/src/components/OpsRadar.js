import { useMemo } from 'react';
import {
  CREW_REQUIRED_TASK_STATUSES,
  isTaskClosed,
  isTaskInProgress,
} from '../utils/taskWorkflow';

function isoDay(value) {
  return value ? String(value).slice(0, 10) : '';
}

function isOverdue(task, today) {
  const day = isoDay(task.data_planowana || task.data_wykonania);
  return day && day < today && !isTaskClosed(task.status);
}

function money(value) {
  const n = Number(value) || 0;
  return `${n.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

function dateLabel(value) {
  const day = isoDay(value);
  if (!day) return 'bez terminu';
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
}

function taskName(task) {
  const id = task?.id ? `#${task.id}` : 'Zlecenie';
  return `${id} ${task?.klient_nazwa || task?.nazwa || 'bez klienta'}`;
}

function needsCrew(task) {
  return CREW_REQUIRED_TASK_STATUSES.has(task?.status);
}

function decisionForTask(task, today) {
  const day = isoDay(task.data_planowana || task.data_wykonania);
  const value = Number(task.wartosc_planowana || task.wartosc_rzeczywista) || 0;
  const team = task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'bez ekipy');
  const meta = `${dateLabel(day)} | ${value ? money(value) : 'bez kwoty'} | ${team}`;

  if (isOverdue(task, today)) {
    return {
      filterKey: 'overdue',
      priority: 100,
      tone: 'danger',
      label: taskName(task),
      reason: 'Termin po czasie - ustal nowy plan albo potwierdz status.',
      meta,
    };
  }
  if (needsCrew(task) && !task.ekipa_id) {
    return {
      filterKey: 'unassigned',
      priority: 85,
      tone: 'warning',
      label: taskName(task),
      reason: 'Brak ekipy blokuje wykonanie.',
      meta,
    };
  }
  if (task.priorytet === 'Pilny') {
    return {
      filterKey: 'urgent',
      priority: 70,
      tone: 'warning',
      label: taskName(task),
      reason: 'Pilny priorytet do ręcznego sprawdzenia.',
      meta,
    };
  }
  if (!day) {
    return {
      filterKey: 'noDate',
      priority: 60,
      tone: 'neutral',
      label: taskName(task),
      reason: 'Bez terminu nie wejdzie do planu dnia.',
      meta,
    };
  }
  if (day === today) {
    return {
      filterKey: 'today',
      priority: 45,
      tone: 'info',
      label: taskName(task),
      reason: 'Dzisiaj w planie - sprawdź gotowość przed startem.',
      meta,
    };
  }
  return null;
}

export default function OpsRadar({ tasks = [], payrollClose, onOpenFilter, onOpenTask }) {
  const model = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const open = tasks.filter((task) => !isTaskClosed(task.status));
    const overdue = open.filter((task) => isOverdue(task, today));
    const unassigned = open.filter((task) => needsCrew(task) && !task.ekipa_id);
    const urgent = open.filter((task) => task.priorytet === 'Pilny');
    const todayTasks = open.filter((task) => isoDay(task.data_planowana || task.data_wykonania) === today);
    const noDate = open.filter((task) => !isoDay(task.data_planowana || task.data_wykonania));
    const active = open.filter((task) => isTaskInProgress(task.status));
    const riskValue = overdue.reduce((sum, task) => sum + (Number(task.wartosc_planowana) || 0), 0);
    const payrollPending = Number(payrollClose?.pending_count) || 0;
    const score = Math.max(
      0,
      100 -
        overdue.length * 12 -
        unassigned.length * 8 -
        urgent.length * 8 -
        noDate.length * 5 -
        payrollPending * 10,
    );

    const alerts = [
      {
        key: 'overdue',
        label: 'Przeterminowane',
        detail: riskValue ? `${money(riskValue)} ryzyka` : 'Po terminie',
        count: overdue.length,
        tone: 'danger',
      },
      {
        key: 'unassigned',
        label: 'Bez ekipy',
        detail: 'Brak właściciela wykonania',
        count: unassigned.length,
        tone: 'warning',
      },
      {
        key: 'urgent',
        label: 'Pilne',
        detail: 'Priorytet do ręcznego sprawdzenia',
        count: urgent.length,
        tone: 'warning',
      },
      {
        key: 'today',
        label: 'Dzisiaj',
        detail: 'Plan na bieżący dzień',
        count: todayTasks.length,
        tone: 'info',
      },
      {
        key: 'noDate',
        label: 'Bez terminu',
        detail: 'Nie wejdą do planu dnia',
        count: noDate.length,
        tone: 'neutral',
      },
    ].sort((a, b) => b.count - a.count);

    const lead = alerts.find((alert) => alert.count > 0);
    const decisions = open
      .map((task) => ({ task, decision: decisionForTask(task, today) }))
      .filter((row) => row.decision)
      .sort((a, b) => b.decision.priority - a.decision.priority)
      .slice(0, 3);

    return { score, alerts, lead, decisions, openCount: open.length, activeCount: active.length };
  }, [tasks, payrollClose]);

  const openDecision = (row) => {
    if (row?.task?.id && onOpenTask) {
      onOpenTask(row.task.id);
      return;
    }
    onOpenFilter?.(row?.decision?.filterKey);
  };

  return (
    <section style={s.panel}>
      <div style={s.header}>
        <div>
          <div style={s.eyebrow}>Radar operacyjny</div>
          <h2 style={s.title}>Co wymaga decyzji teraz</h2>
        </div>
        <div style={s.scoreBox}>
          <span style={s.score}>{model.score}</span>
          <span style={s.scoreLabel}>health</span>
        </div>
      </div>

      <div style={s.leadRow}>
        <div>
          <div style={s.leadLabel}>Najbliższy ruch</div>
          <div style={s.leadText}>
            {model.lead
              ? `${model.lead.label}: ${model.lead.count} do obsłużenia`
              : 'Brak pilnych blokad w bieżących danych'}
          </div>
        </div>
        <div style={s.meta}>
          Otwarte: <strong>{model.openCount}</strong> | W realizacji: <strong>{model.activeCount}</strong>
        </div>
      </div>

      <div style={s.grid}>
        {model.alerts.map((alert) => (
          <button
            key={alert.key}
            type="button"
            onClick={() => onOpenFilter?.(alert.key)}
            style={{ ...s.tile, ...(toneStyle[alert.tone] || toneStyle.neutral) }}
          >
            <span style={s.tileTop}>
              <span style={s.tileLabel}>{alert.label}</span>
              <span style={s.tileCount}>{alert.count}</span>
            </span>
            <span style={s.tileDetail}>{alert.detail}</span>
          </button>
        ))}
      </div>

      <div style={s.decisionBlock}>
        <div style={s.decisionHead}>Następne decyzje</div>
        {model.decisions.length === 0 ? (
          <div style={s.emptyRow}>Nie ma zleceń wymagających natychmiastowej reakcji.</div>
        ) : (
          model.decisions.map((row) => (
            <button
              key={`${row.decision.filterKey}-${row.task.id || row.decision.label}`}
              type="button"
              onClick={() => openDecision(row)}
              style={s.decisionRow}
            >
              <span style={{ ...s.decisionMarker, ...(markerTone[row.decision.tone] || markerTone.neutral) }} />
              <span style={s.decisionText}>
                <strong style={s.decisionTitle}>{row.decision.label}</strong>
                <small style={s.decisionReason}>{row.decision.reason}</small>
                <span style={s.decisionMeta}>{row.decision.meta}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

const toneStyle = {
  danger: { borderLeftColor: '#e2445c' },
  warning: { borderLeftColor: '#fdab3d' },
  info: { borderLeftColor: '#579bfc' },
  neutral: { borderLeftColor: '#c5c7d0' },
};

const markerTone = {
  danger: { background: '#e2445c' },
  warning: { background: '#fdab3d' },
  info: { background: '#579bfc' },
  neutral: { background: '#c5c7d0' },
};

const s = {
  panel: {
    background: '#ffffff',
    border: '1px solid #e6e9ef',
    borderRadius: 4,
    padding: 0,
    marginBottom: 14,
    boxShadow: 'none',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
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
  scoreBox: {
    minWidth: 64,
    border: '1px solid #e6e9ef',
    borderRadius: 4,
    padding: '6px 10px',
    textAlign: 'right',
    background: '#f5f6f8',
  },
  score: {
    display: 'block',
    fontSize: 22,
    fontWeight: 800,
    color: '#323338',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  scoreLabel: {
    display: 'block',
    marginTop: 3,
    fontSize: 10,
    color: '#676879',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  leadRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 16px',
    borderBottom: '1px solid #e6e9ef',
    background: '#f5f6f8',
  },
  leadLabel: { fontSize: 10, color: '#676879', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' },
  leadText: { marginTop: 3, fontSize: 13, color: '#323338', fontWeight: 600 },
  meta: { fontSize: 11, color: '#676879', whiteSpace: 'nowrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 0,
  },
  tile: {
    minHeight: 72,
    padding: '10px 14px',
    textAlign: 'left',
    background: '#ffffff',
    color: '#323338',
    border: 'none',
    borderLeft: '3px solid #e6e9ef',
    borderRight: '1px solid #e6e9ef',
    borderBottom: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tileTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  tileLabel: { fontSize: 11, fontWeight: 700, color: '#676879', textTransform: 'uppercase', letterSpacing: '0.04em' },
  tileCount: { fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#323338' },
  tileDetail: { display: 'block', marginTop: 4, fontSize: 11, color: '#676879', lineHeight: 1.35 },
  decisionBlock: {
    borderTop: '1px solid #e6e9ef',
  },
  decisionHead: {
    padding: '10px 14px 8px',
    fontSize: 10,
    color: '#676879',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  decisionRow: {
    width: '100%',
    minHeight: 58,
    display: 'grid',
    gridTemplateColumns: '3px minmax(0, 1fr)',
    gap: 11,
    padding: '10px 14px',
    border: 'none',
    borderTop: '1px solid #e6e9ef',
    background: '#ffffff',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  decisionMarker: { width: 3, borderRadius: 999 },
  decisionText: { display: 'grid', gap: 3, minWidth: 0 },
  decisionTitle: { fontSize: 13, color: '#323338', lineHeight: 1.25 },
  decisionReason: { fontSize: 12, color: '#323338', lineHeight: 1.35 },
  decisionMeta: { fontSize: 11, color: '#676879', lineHeight: 1.35 },
  emptyRow: {
    padding: '12px 14px 14px',
    borderTop: '1px solid #e6e9ef',
    color: '#676879',
    fontSize: 12,
    fontWeight: 500,
  },
};
