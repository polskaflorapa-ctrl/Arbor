import { useMemo } from 'react';
import { isTaskClosed, isTaskInProgress } from '../utils/taskWorkflow';

function isoDay(value) {
  return value ? String(value).slice(0, 10) : '';
}

function isOverdue(task, today) {
  const day = isoDay(task.data_planowana || task.data_wykonania);
  return day && day < today && !isTaskClosed(task.status);
}

function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('pl-PL', { maximumFractionDigits: 0 }) + ' PLN';
}

export default function OpsRadar({ tasks = [], payrollClose, onOpenFilter }) {
  const model = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const open = tasks.filter((task) => !isTaskClosed(task.status));
    const overdue = open.filter((task) => isOverdue(task, today));
    const unassigned = open.filter((task) => !task.ekipa_id);
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
    return { score, alerts, lead, openCount: open.length, activeCount: active.length };
  }, [tasks, payrollClose]);

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
          Otwarte: <strong>{model.openCount}</strong> · W realizacji: <strong>{model.activeCount}</strong>
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
    </section>
  );
}

const toneStyle = {
  danger:  { borderLeftColor: '#e2445c' },
  warning: { borderLeftColor: '#fdab3d' },
  info:    { borderLeftColor: '#579bfc' },
  neutral: { borderLeftColor: '#e6e9ef' },
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
};
