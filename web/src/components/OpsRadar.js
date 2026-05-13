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
  danger: { border: '1px solid rgba(248,113,113,0.36)' },
  warning: { border: '1px solid rgba(251,191,36,0.34)' },
  info: { border: '1px solid rgba(56,189,248,0.32)' },
  neutral: { border: '1px solid var(--border)' },
};

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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: {
    margin: '4px 0 0',
    fontSize: 20,
    lineHeight: 1.25,
    fontWeight: 750,
    color: 'var(--text)',
    letterSpacing: 0,
  },
  scoreBox: {
    minWidth: 78,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 10px',
    textAlign: 'right',
    background: 'var(--bg-deep)',
  },
  score: {
    display: 'block',
    fontSize: 24,
    fontWeight: 800,
    color: 'var(--accent)',
    lineHeight: 1,
  },
  scoreLabel: {
    display: 'block',
    marginTop: 3,
    fontSize: 11,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  leadRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    marginBottom: 12,
  },
  leadLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' },
  leadText: { marginTop: 3, fontSize: 14, color: 'var(--text)', fontWeight: 650 },
  meta: { fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
  },
  tile: {
    minHeight: 78,
    padding: '10px 12px',
    textAlign: 'left',
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    cursor: 'pointer',
  },
  tileTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  tileLabel: { fontSize: 13, fontWeight: 700 },
  tileCount: { fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' },
  tileDetail: { display: 'block', marginTop: 6, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35 },
};
