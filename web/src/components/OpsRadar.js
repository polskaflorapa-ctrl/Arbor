import { useMemo } from 'react';
import {
  CREW_REQUIRED_TASK_STATUSES,
  isTaskClosed,
  isTaskInProgress,
} from '../utils/taskWorkflow';
import { Button } from './ui/Button';

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

export default function OpsRadar({ tasks = [], payrollClose, onOpenFilter, onOpenTask, onOpenPath }) {
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

    const isClear = open.length === 0 && alerts.every((alert) => alert.count === 0) && payrollPending === 0;

    return { score, alerts, lead, decisions, openCount: open.length, activeCount: active.length, isClear };
  }, [tasks, payrollClose]);

  const openDecision = (row) => {
    if (row?.task?.id && onOpenTask) {
      onOpenTask(row.task.id);
      return;
    }
    onOpenFilter?.(row?.decision?.filterKey);
  };

  const leadText = model.isClear
    ? 'Dzień zamknięty operacyjnie'
    : model.lead
      ? `${model.lead.label}: ${model.lead.count} do obsłużenia`
      : 'Brak pilnych blokad w bieżących danych';

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
          <div style={s.leadText}>{leadText}</div>
        </div>
        <div style={s.meta}>
          Otwarte: <strong>{model.openCount}</strong> | W realizacji: <strong>{model.activeCount}</strong>
        </div>
      </div>

      {model.isClear ? (
        <div style={s.clearState}>
          <div style={s.clearBadge}>Gotowe</div>
          <strong style={s.clearTitle}>Wszystkie aktywne zlecenia są domknięte</strong>
          <span style={s.clearText}>
            Radar nie widzi zaległych terminów, ekip bez pracy ani pilnych decyzji. Najbliższy ruch to przyjęcie nowego zgłoszenia albo raport dnia.
          </span>
          <div style={s.clearActions}>
            <Button style={s.clearPrimaryBtn} onClick={() => onOpenFilter?.('')}>
              Lista zleceń
            </Button>
            <Button variant="secondary" style={s.clearSecondaryBtn} onClick={() => onOpenPath?.('/raport-dzienny')}>
              Raport dzienny
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div style={s.grid}>
            {model.alerts.map((alert) => (
              <Button
                key={alert.key}
                variant="secondary"
                onClick={() => onOpenFilter?.(alert.key)}
                style={{ ...s.tile, ...(toneStyle[alert.tone] || toneStyle.neutral) }}
              >
                <span style={s.tileTop}>
                  <span style={s.tileLabel}>{alert.label}</span>
                  <span style={s.tileCount}>{alert.count}</span>
                </span>
                <span style={s.tileDetail}>{alert.detail}</span>
              </Button>
            ))}
          </div>

          <div style={s.decisionBlock}>
            <div style={s.decisionHead}>Następne decyzje</div>
            {model.decisions.length === 0 ? (
              <div style={s.emptyRow}>Nie ma zleceń wymagających natychmiastowej reakcji.</div>
            ) : (
              model.decisions.map((row) => (
                <Button
                  key={`${row.decision.filterKey}-${row.task.id || row.decision.label}`}
                  variant="secondary"
                  onClick={() => openDecision(row)}
                  style={s.decisionRow}
                >
                  <span style={{ ...s.decisionMarker, ...(markerTone[row.decision.tone] || markerTone.neutral) }} />
                  <span style={s.decisionText}>
                    <strong style={s.decisionTitle}>{row.decision.label}</strong>
                    <small style={s.decisionReason}>{row.decision.reason}</small>
                    <span style={s.decisionMeta}>{row.decision.meta}</span>
                  </span>
                </Button>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

const toneStyle = {
  danger: { borderLeftColor: '#c0492f' },
  warning: { borderLeftColor: '#bd701e' },
  info: { borderLeftColor: '#f1f3d6' },
  neutral: { borderLeftColor: '#e0d9c8' },
};

const markerTone = {
  danger: { background: '#c0492f' },
  warning: { background: '#bd701e' },
  info: { background: '#f1f3d6' },
  neutral: { background: '#e0d9c8' },
};

const s = {
  panel: {
    background: '#ffffff',
    border: '1px solid #f0ebdd',
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
    borderBottom: '1px solid #f0ebdd',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: 700,
    color: '#5a5040',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  title: {
    margin: '4px 0 0',
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 700,
    color: '#2c2011',
    letterSpacing: 0,
  },
  scoreBox: {
    minWidth: 64,
    border: '1px solid #f0ebdd',
    borderRadius: 4,
    padding: '6px 10px',
    textAlign: 'right',
    background: '#f0ebdd',
  },
  score: {
    display: 'block',
    fontSize: 22,
    fontWeight: 800,
    color: '#2c2011',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  scoreLabel: {
    display: 'block',
    marginTop: 3,
    fontSize: 10,
    color: '#5a5040',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  leadRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 16px',
    borderBottom: '1px solid #f0ebdd',
    background: '#f0ebdd',
  },
  leadLabel: { fontSize: 10, color: '#5a5040', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' },
  leadText: { marginTop: 3, fontSize: 13, color: '#2c2011', fontWeight: 600 },
  meta: { fontSize: 11, color: '#5a5040', whiteSpace: 'nowrap' },
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
    color: '#2c2011',
    border: 'none',
    borderLeft: '3px solid #f0ebdd',
    borderRight: '1px solid #f0ebdd',
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
  tileLabel: { fontSize: 11, fontWeight: 700, color: '#5a5040', textTransform: 'uppercase', letterSpacing: '0.04em' },
  tileCount: { fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#2c2011' },
  tileDetail: { display: 'block', marginTop: 4, fontSize: 11, color: '#5a5040', lineHeight: 1.35 },
  decisionBlock: {
    borderTop: '1px solid #f0ebdd',
  },
  decisionHead: {
    padding: '10px 14px 8px',
    fontSize: 10,
    color: '#5a5040',
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
    borderTop: '1px solid #f0ebdd',
    background: '#ffffff',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  decisionMarker: { width: 3, borderRadius: 999 },
  decisionText: { display: 'grid', gap: 3, minWidth: 0 },
  decisionTitle: { fontSize: 13, color: '#2c2011', lineHeight: 1.25 },
  decisionReason: { fontSize: 12, color: '#2c2011', lineHeight: 1.35 },
  decisionMeta: { fontSize: 11, color: '#5a5040', lineHeight: 1.35 },
  emptyRow: {
    padding: '12px 14px 14px',
    borderTop: '1px solid #f0ebdd',
    color: '#5a5040',
    fontSize: 12,
    fontWeight: 500,
  },
  clearState: {
    padding: '18px 18px 20px',
    borderTop: '1px solid #f0ebdd',
    background: '#f0ebdd',
    display: 'grid',
    gap: 8,
  },
  clearBadge: {
    width: 'fit-content',
    padding: '4px 9px',
    borderRadius: 999,
    background: '#e4efd6',
    color: '#456b1f',
    fontSize: 10,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  clearTitle: {
    color: '#456b1f',
    fontSize: 16,
    lineHeight: 1.25,
  },
  clearText: {
    color: '#456b1f',
    fontSize: 13,
    lineHeight: 1.45,
    maxWidth: 680,
  },
  clearActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  clearPrimaryBtn: {
    border: '1px solid #456b1f',
    background: '#456b1f',
    color: '#ffffff',
    borderRadius: 4,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  clearSecondaryBtn: {
    border: '1px solid #e4efd6',
    background: '#ffffff',
    color: '#456b1f',
    borderRadius: 4,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
