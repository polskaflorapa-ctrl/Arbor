import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import ModernDataRow from '../components/ModernDataRow';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pln(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(n);
}
function num(n) {
  return n == null ? '—' : Number(n).toLocaleString('pl-PL');
}
function pct(n) {
  return n == null ? '—' : `${n}%`;
}
function delta(n) {
  if (n == null) return null;
  return { label: `${n >= 0 ? '+' : ''}${n}%`, color: n >= 0 ? '#16a34a' : '#dc2626' };
}

// ─── CSV export helper ───────────────────────────────────────────────────────

function downloadCSV(rows, filename) {
  if (!rows?.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [
    keys.join(';'),
    ...rows.map(r => keys.map(k => {
      const v = r[k] ?? '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(';'))
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Drill-down modal ────────────────────────────────────────────────────────

function DrillModal({ title, tasks, loading, onClose }) {
  return (
    <div style={dm.overlay} onClick={onClose}>
      <div style={dm.panel} onClick={e => e.stopPropagation()}>
        <div style={dm.header}>
          <span style={dm.title}>{title}</span>
          <button style={dm.close} onClick={onClose}>✕</button>
        </div>
        {loading
          ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>Ładowanie…</div>
          : tasks.length === 0
          ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>Brak zleceń</div>
          : (
            <div className="modern-data-stack" style={{ overflowY: 'auto', maxHeight: '60vh', padding: 12 }}>
              {tasks.map(t => (
                <ModernDataRow
                  key={t.id}
                  idLabel="Order"
                  idValue={t.numer || `#${t.id}`}
                  title={t.typ_uslugi || 'Zlecenie'}
                  subtitle={`${t.oddzial_nazwa || 'brak oddziału'} · ${t.ekipa_nazwa || 'brak ekipy'}`}
                  tone={t.status === 'Zakonczone' ? 'success' : t.status === 'Anulowane' ? 'danger' : 'info'}
                  status={t.status}
                  statusValue={t.status}
                  statusState={t.status === 'Zakonczone' ? 'success' : t.status === 'Anulowane' ? 'danger' : 'info'}
                  metrics={[
                    { label: 'Data', value: t.data_planowana?.slice(0,10) || '—' },
                    { label: 'Ekipa', value: t.ekipa_nazwa || '—', mono: false },
                    { label: 'Plan PLN', value: t.wartosc_planowana ? pln(t.wartosc_planowana) : '—', tone: 'success' },
                  ]}
                />
              ))}
            </div>
          )
        }
        {!loading && tasks.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{tasks.length} zleceń (maks. 100)</span>
            <button style={dm.csvBtn} onClick={() => downloadCSV(tasks, `drill-${Date.now()}.csv`)}>⬇ CSV</button>
          </div>
        )}
      </div>
    </div>
  );
}

const dm = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel:   { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, width: '100%', maxWidth: 860, boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' },
  title:   { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  close:   { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-sub)' },
  th:      { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' },
  tr:      { borderBottom: '1px solid var(--border-light, var(--border))', transition: 'background 0.15s' },
  td:      { padding: '9px 10px', color: 'var(--text)', verticalAlign: 'middle' },
  badge:   { display: 'inline-block', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#fff', fontWeight: 600 },
  csvBtn:  { padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 },
};

// ─── Inline SVG bar chart ────────────────────────────────────────────────────

function BarChart({ data, valueKey, labelKey, color = 'var(--accent)', height = 160, onBarClick }) {
  if (!data?.length) return <div style={ch.empty}>Brak danych</div>;
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  const barW = Math.max(8, Math.floor(480 / data.length) - 4);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${Math.max(480, data.length * (barW + 4))} ${height + 30}`}
           style={{ width: '100%', display: 'block' }}>
        {data.map((d, i) => {
          const h = Math.round(((d[valueKey] || 0) / max) * (height - 20));
          const x = i * (barW + 4) + 2;
          const y = height - h;
          return (
            <g key={i} style={{ cursor: onBarClick ? 'pointer' : 'default' }}
               onClick={() => onBarClick && onBarClick(d)}>
              <rect x={x} y={y} width={barW} height={h} rx={3}
                    fill={color} opacity={0.85} />
              <rect x={x} y={0} width={barW} height={height + 30} fill="transparent" />
              <text x={x + barW / 2} y={height + 14} textAnchor="middle"
                    fontSize={9} fill="var(--text-sub)">
                {String(d[labelKey] || '').slice(-8)}
              </text>
              {h > 20 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle"
                      fontSize={8} fill="var(--text-sub)">
                  {d[valueKey] >= 1000 ? `${Math.round(d[valueKey] / 1000)}k` : d[valueKey]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Donut slice chart ───────────────────────────────────────────────────────

const DONUT_COLORS = ['#16a34a','#2563eb','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#65a30d','#c2410c'];

function DonutChart({ data, valueKey, labelKey, size = 160 }) {
  if (!data?.length) return <div style={ch.empty}>Brak danych</div>;
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  if (total === 0) return <div style={ch.empty}>Brak danych</div>;
  const r = 60, cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;
  const slices = data.slice(0, 9).map((d, i) => {
    const frac = (d[valueKey] || 0) / total;
    const start = angle;
    angle += frac * 2 * Math.PI;
    const lx = cx + r * Math.cos(start + frac * Math.PI);
    const ly = cy + r * Math.sin(start + frac * Math.PI);
    return { d, i, frac, start, end: angle, lx, ly };
  });
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }}>
        {slices.map(({ d, i, frac, start, end }) => {
          const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
          const large = frac > 0.5 ? 1 : 0;
          return (
            <path key={i}
              d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`}
              fill={DONUT_COLORS[i % DONUT_COLORS.length]}
              opacity={0.88}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--surface-field)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={10} fill="var(--text)" fontWeight="700">
          {data.length} typy
        </text>
      </svg>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
        {slices.map(({ d, i }) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: DONUT_COLORS[i % DONUT_COLORS.length], flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d[labelKey]}
            </span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, tone, deltaPct }) {
  const { t } = useTranslation();
  const bg = tone === 'ok' ? '#dcfce7' : tone === 'warn' ? '#fef9c3' : tone === 'bad' ? '#fee2e2' : 'var(--surface-glass)';
  const fg = tone === 'ok' ? '#16a34a' : tone === 'warn' ? '#ca8a04' : tone === 'bad' ? '#dc2626' : 'var(--text)';
  const d = delta(deltaPct);
  return (
    <div style={{ ...s.kpiCard, background: bg }}>
      <div style={{ ...s.kpiValue, color: fg }}>{value}</div>
      {d && <div style={{ fontSize: 11, color: d.color, fontWeight: 700 }}>{d.label} {t('biDashboard.kpi.vsPrevious')}</div>}
      <div style={s.kpiLabel}>{label}</div>
      {sub && <div style={s.kpiSub}>{sub}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BiDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [days, setDays]           = useState(30);
  const [overview, setOverview]   = useState(null);
  const [trend, setTrend]         = useState([]);
  const [branches, setBranches]   = useState([]);
  const [serviceMix, setServiceMix] = useState([]);
  const [teams, setTeams]         = useState([]);
  const [funnel, setFunnel]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // Drill-down
  const [drill, setDrill]         = useState(null); // { title, tasks, loading }

  // Alerts tab
  const [alertCfg, setAlertCfg]   = useState(() => {
    const saved = getLocalStorageJson('bi_alert_cfg');
    return saved || { completion_threshold: 60, overdue_threshold: 10, recipients: '', days: 30 };
  });
  const [alertResult, setAlertResult] = useState(null);
  const [alertChecking, setAlertChecking] = useState(false);

  // Defined inside component so they pick up the current language via t()
  const PERIODS = [
    { label: t('biDashboard.periods.d7'),   days: 7 },
    { label: t('biDashboard.periods.d30'),  days: 30 },
    { label: t('biDashboard.periods.d90'),  days: 90 },
    { label: t('biDashboard.periods.d365'), days: 365 },
  ];

  const TABS = [
    { key: 'overview', label: `📈 ${t('biDashboard.tabs.overview')}` },
    { key: 'branches', label: `🏢 ${t('biDashboard.tabs.branches')}` },
    { key: 'teams',    label: `👥 ${t('biDashboard.tabs.teams')}` },
    { key: 'services', label: `🌳 ${t('biDashboard.tabs.services')}` },
    { key: 'funnel',   label: `🎯 ${t('biDashboard.tabs.funnel')}` },
    { key: 'alerts',   label: `⚡ Alerty` },
  ];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const token = getStoredToken();
    const h = { headers: authHeaders(token) };
    try {
      const [ov, tr, br, sm, tm, fn] = await Promise.all([
        api.get(`/bi/overview?days=${days}`, h),
        api.get(`/bi/revenue-trend?months=12`, h),
        api.get(`/bi/branch-comparison?days=${days}`, h),
        api.get(`/bi/service-mix?days=${days}`, h),
        api.get(`/bi/team-performance?days=${days}`, h),
        api.get(`/bi/funnel?days=${days}`, h),
      ]);
      setOverview(ov.data);
      setTrend(tr.data);
      setBranches(br.data);
      setServiceMix(sm.data);
      setTeams(tm.data);
      setFunnel(fn.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // ── Drill-down ──────────────────────────────────────────────────────────────
  const openDrill = useCallback(async ({ title, dim, id, val }) => {
    setDrill({ title, tasks: [], loading: true });
    const token = getStoredToken();
    const h = authHeaders(token);
    try {
      const params = new URLSearchParams({ dim, days });
      if (id)  params.set('id', id);
      if (val) params.set('val', val);
      const res = await api.get(`/bi/drill?${params}`, { headers: h });
      setDrill({ title, tasks: Array.isArray(res.data) ? res.data : [], loading: false });
    } catch {
      setDrill({ title, tasks: [], loading: false });
    }
  }, [days]);

  // ── Alerty ──────────────────────────────────────────────────────────────────
  const checkAlerts = useCallback(async () => {
    setAlertChecking(true); setAlertResult(null);
    const token = getStoredToken();
    try {
      const res = await api.post('/bi/alerts/check', alertCfg, { headers: authHeaders(token) });
      setAlertResult(res.data);
    } catch (e) {
      setAlertResult({ error: e.response?.data?.error || e.message });
    } finally {
      setAlertChecking(false);
    }
  }, [alertCfg]);

  const saveAlertCfg = (next) => {
    setAlertCfg(next);
    try { localStorage.setItem('bi_alert_cfg', JSON.stringify(next)); } catch {}
  };

  const ov = overview;

  return (
    <div style={s.shell}>
      <Sidebar />
      <main style={s.main}>
        {/* Header */}
        <div style={s.topbar}>
          <div>
            <h1 style={s.title}>📊 {t('biDashboard.title')}</h1>
            <p style={s.sub}>{t('biDashboard.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={s.periodRow}>
              {PERIODS.map(p => (
                <button key={p.days} type="button"
                  onClick={() => setDays(p.days)}
                  style={{ ...s.periodBtn, ...(days === p.days ? s.periodBtnActive : {}) }}>
                  {p.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={load} disabled={loading} style={s.refreshBtn}>
              {loading ? '⏳' : '↻'}
            </button>
            <button type="button" style={s.refreshBtn} title="Eksportuj CSV"
              onClick={() => {
                if (activeTab === 'branches') downloadCSV(branches, `oddzialy-${days}d.csv`);
                else if (activeTab === 'teams') downloadCSV(teams, `ekipy-${days}d.csv`);
                else if (activeTab === 'services') downloadCSV(serviceMix, `uslugi-${days}d.csv`);
                else if (activeTab === 'overview' && ov) downloadCSV([ov], `kpi-${days}d.csv`);
              }}>⬇ CSV</button>
            <button type="button" onClick={() => navigate('/kierownik')} style={s.backBtn}>← Powrót</button>
          </div>
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        {/* Tabs */}
        <div style={s.tabs}>
          {TABS.map(tab => (
            <button key={tab.key} type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{ ...s.tab, ...(activeTab === tab.key ? s.tabActive : {}) }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div style={s.content}>
            {/* KPI row */}
            <div style={s.kpiRow}>
              <KpiCard label={t('biDashboard.kpi.revenuePlan')} value={pln(ov?.revenue_planned)}
                deltaPct={ov?.revenue_delta_pct} tone={ov?.revenue_delta_pct >= 0 ? 'ok' : 'warn'} />
              <KpiCard label={t('biDashboard.kpi.revenueActual')} value={pln(ov?.revenue_actual)} />
              <KpiCard label={t('biDashboard.kpi.tasks')} value={num(ov?.tasks_total)}
                deltaPct={ov?.tasks_delta_pct} />
              <KpiCard label={t('biDashboard.kpi.completion')} value={pct(ov?.completion_pct)}
                tone={ov?.completion_pct >= 80 ? 'ok' : ov?.completion_pct >= 50 ? 'warn' : 'bad'} />
              <KpiCard label={t('biDashboard.kpi.overdue')} value={num(ov?.tasks_overdue)}
                tone={ov?.tasks_overdue > 0 ? 'warn' : 'ok'} />
              <KpiCard label={t('biDashboard.kpi.unassigned')} value={num(ov?.tasks_unassigned)}
                tone={ov?.tasks_unassigned > 0 ? 'warn' : 'ok'} />
            </div>

            {/* Revenue trend */}
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.revenueTrend')}</div>
              <BarChart data={trend} valueKey="revenue_planned" labelKey="month"
                color="var(--accent)" height={140} />
            </div>

            {/* Two-col: tasks by month + service mix */}
            <div style={s.twoCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>{t('biDashboard.charts.tasksMonthly')}</div>
                <BarChart data={trend} valueKey="tasks_count" labelKey="month"
                  color="#2563eb" height={120} />
              </div>
              <div style={s.card}>
                <div style={s.cardTitle}>{t('biDashboard.charts.serviceMixTop')}</div>
                <DonutChart data={serviceMix} valueKey="revenue" labelKey="typ_uslugi" />
              </div>
            </div>
          </div>
        )}

        {/* ── BRANCHES TAB ── */}
        {activeTab === 'branches' && (
          <div style={s.content}>
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.branchComparison')} — ostatnie {days} dni</div>
              <div className="modern-data-stack">
                {branches.map(b => (
                  <ModernDataRow
                    key={b.oddzial_id}
                    idLabel="Branch"
                    idValue={`BR-${b.oddzial_id}`}
                    title={b.oddzial_nazwa}
                    subtitle={`Aktywne ekipy: ${num(b.teams_active)}`}
                    tone={b.tasks_overdue > 0 ? 'warning' : 'success'}
                    status={b.completion_pct >= 80 ? 'ON TRACK' : 'WATCH'}
                    statusValue={b.completion_pct >= 80 ? 'success' : 'warning'}
                    statusState={b.completion_pct >= 80 ? 'success' : 'warning'}
                    onClick={() => openDrill({ title: `Zlecenia — ${b.oddzial_nazwa}`, dim: 'oddzial', id: b.oddzial_id })}
                    metrics={[
                      { label: 'Zlecenia', value: num(b.tasks_total) },
                      { label: 'Ukończone', value: num(b.tasks_done), tone: 'success' },
                      { label: 'Skuteczność', value: pct(b.completion_pct), tone: b.completion_pct >= 80 ? 'success' : 'warning' },
                      { label: 'Zaległe', value: num(b.tasks_overdue), tone: b.tasks_overdue > 0 ? 'danger' : undefined },
                      { label: 'Plan PLN', value: pln(b.revenue_planned) },
                      { label: 'Real PLN', value: pln(b.revenue_actual), tone: 'success' },
                    ]}
                  />
                ))}
              </div>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.revenueByBranch')}</div>
              <BarChart data={branches} valueKey="revenue_planned" labelKey="oddzial_nazwa"
                color="var(--accent)" height={140}
                onBarClick={b => openDrill({ title: `Zlecenia — ${b.oddzial_nazwa}`, dim: 'oddzial', id: b.oddzial_id })} />
            </div>
          </div>
        )}

        {/* ── TEAMS TAB ── */}
        {activeTab === 'teams' && (
          <div style={s.content}>
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.teamRanking')} — ostatnie {days} dni</div>
              <div className="modern-data-stack">
                {teams.map(tm => (
                  <ModernDataRow
                    key={tm.team_id}
                    idLabel="Team Rank"
                    idValue={`#${tm.rank}`}
                    title={tm.team_name}
                    subtitle={tm.oddzial_nazwa}
                    tone={tm.tasks_overdue > 0 ? 'warning' : 'success'}
                    status={tm.completion_pct >= 80 ? 'HIGH PERF' : 'TRACKED'}
                    statusValue={tm.completion_pct >= 80 ? 'success' : 'info'}
                    statusState={tm.completion_pct >= 80 ? 'success' : 'info'}
                    onClick={() => openDrill({ title: `Zlecenia — ${tm.team_name}`, dim: 'ekipa', id: tm.team_id })}
                    metrics={[
                      { label: 'Zlecenia', value: num(tm.tasks_total) },
                      { label: 'Ukończone', value: num(tm.tasks_done), tone: 'success' },
                      { label: 'Skuteczność', value: pct(tm.completion_pct), tone: tm.completion_pct >= 80 ? 'success' : 'warning' },
                      { label: 'Zaległe', value: num(tm.tasks_overdue), tone: tm.tasks_overdue > 0 ? 'danger' : undefined },
                      { label: 'Przychód plan', value: pln(tm.revenue), tone: 'success' },
                    ]}
                  />
                ))}
                {teams.length === 0 && <div className="modern-data-empty">Brak danych</div>}
              </div>
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.teamRevenueTop')}</div>
              <BarChart data={teams.slice(0, 10)} valueKey="revenue" labelKey="team_name"
                color="#7c3aed" height={140}
                onBarClick={tm => openDrill({ title: `Zlecenia — ${tm.team_name}`, dim: 'ekipa', id: tm.team_id })} />
            </div>
          </div>
        )}

        {/* ── SERVICES TAB ── */}
        {activeTab === 'services' && (
          <div style={s.content}>
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.serviceMix')} — ostatnie {days} dni</div>
              <DonutChart data={serviceMix} valueKey="revenue" labelKey="typ_uslugi" size={200} />
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Przychód wg usługi</div>
              <BarChart data={serviceMix} valueKey="revenue" labelKey="typ_uslugi"
                color="#d97706" height={140}
                onBarClick={sm => openDrill({ title: `Zlecenia — ${sm.typ_uslugi}`, dim: 'usluga', val: sm.typ_uslugi })} />
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.serviceDetails')}</div>
              <div className="modern-data-stack">
                {serviceMix.map((sm, i) => (
                  <ModernDataRow
                    key={i}
                    idLabel="Service Mix"
                    idValue={`SVC-${i + 1}`}
                    title={sm.typ_uslugi}
                    subtitle={`Udział: ${pct(sm.pct)}`}
                    tone="info"
                    status="REVENUE"
                    statusValue="info"
                    statusState="info"
                    onClick={() => openDrill({ title: `Zlecenia — ${sm.typ_uslugi}`, dim: 'usluga', val: sm.typ_uslugi })}
                    metrics={[
                      { label: 'Zlecenia', value: num(sm.tasks_count) },
                      { label: 'Przychód', value: pln(sm.revenue), tone: 'success' },
                      { label: 'Udział', value: pct(sm.pct), tone: 'info' },
                    ]}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── FUNNEL TAB ── */}
        {activeTab === 'funnel' && funnel && (
          <div style={s.content}>
            <div style={s.kpiRow}>
              <KpiCard label={t('biDashboard.kpi.quotesTotal')}    value={num(funnel.quotes_total)} />
              <KpiCard label={t('biDashboard.kpi.quotesAccepted')} value={num(funnel.quotes_accepted)}
                sub={`Wskaźnik: ${pct(funnel.acceptance_rate)}`}
                tone={funnel.acceptance_rate >= 60 ? 'ok' : 'warn'} />
              <KpiCard label={t('biDashboard.kpi.quotesRejected')} value={num(funnel.quotes_rejected)}
                tone={funnel.quotes_rejected > 0 ? 'warn' : 'ok'} />
              <KpiCard label={t('biDashboard.kpi.converted')} value={num(funnel.converted_to_task)}
                sub={`${pct(funnel.conversion_rate)} konwersji`}
                tone={funnel.conversion_rate >= 50 ? 'ok' : 'warn'} />
              <KpiCard label={t('biDashboard.kpi.pipelineValue')} value={pln(funnel.pipeline_value)} />
            </div>

            {/* Visual funnel */}
            <div style={s.card}>
              <div style={s.cardTitle}>{t('biDashboard.charts.funnel')}</div>
              <div style={s.funnelWrap}>
                {[
                  { label: t('biDashboard.funnelSteps.allQuotes'), value: funnel.quotes_total,      color: '#2563eb' },
                  { label: t('biDashboard.funnelSteps.accepted'),  value: funnel.quotes_accepted,   color: '#7c3aed' },
                  { label: t('biDashboard.funnelSteps.orders'),    value: funnel.converted_to_task, color: '#16a34a' },
                ].map((step, i, arr) => {
                  const maxV = arr[0].value || 1;
                  const w = Math.round((step.value / maxV) * 100);
                  return (
                    <div key={i} style={s.funnelStep}>
                      <div style={{ ...s.funnelBar, width: `${w}%`, background: step.color }}>
                        <span style={s.funnelLabel}>{step.label}</span>
                        <span style={s.funnelVal}>{num(step.value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── ALERTS TAB ── */}
        {activeTab === 'alerts' && (
          <div style={s.content}>
            <div style={s.card}>
              <div style={s.cardTitle}>⚡ Konfiguracja alertów KPI</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
                <div>
                  <label style={al.label}>Próg ukończenia (%) — alert gdy poniżej</label>
                  <input type="number" style={al.input} min={0} max={100}
                    value={alertCfg.completion_threshold}
                    onChange={e => saveAlertCfg({ ...alertCfg, completion_threshold: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={al.label}>Maksymalna liczba przeterminowanych zleceń</label>
                  <input type="number" style={al.input} min={0}
                    value={alertCfg.overdue_threshold}
                    onChange={e => saveAlertCfg({ ...alertCfg, overdue_threshold: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={al.label}>Okres analizy (dni)</label>
                  <input type="number" style={al.input} min={7} max={365}
                    value={alertCfg.days}
                    onChange={e => saveAlertCfg({ ...alertCfg, days: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={al.label}>Adresy e-mail (oddzielone przecinkiem)</label>
                  <input type="text" style={al.input} placeholder="dyrektor@firma.pl, kierownik@firma.pl"
                    value={alertCfg.recipients}
                    onChange={e => saveAlertCfg({ ...alertCfg, recipients: e.target.value })} />
                  <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>
                    Wymaga skonfigurowanego SMTP_HOST, SMTP_USER, SMTP_PASS na serwerze
                  </div>
                </div>
                <button style={al.btn} disabled={alertChecking} onClick={checkAlerts}>
                  {alertChecking ? '⏳ Sprawdzam…' : '🔍 Sprawdź teraz i wyślij e-mail'}
                </button>
              </div>
            </div>

            {alertResult && !alertResult.error && (
              <div style={s.card}>
                <div style={s.cardTitle}>Wynik sprawdzenia — {alertResult.checked_at?.slice(0,19)?.replace('T',' ')}</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={al.stat}><span style={al.statN}>{alertResult.completion_pct}%</span><span style={al.statL}>Ukończenie</span></div>
                  <div style={al.stat}><span style={al.statN}>{alertResult.tasks_total}</span><span style={al.statL}>Zleceń</span></div>
                  <div style={al.stat}><span style={al.statN}>{alertResult.tasks_overdue}</span><span style={al.statL}>Przeterminowane</span></div>
                </div>
                {alertResult.alerts.length === 0
                  ? <div style={{ color: '#16a34a', fontWeight: 600 }}>✅ Wszystko w normie — brak alertów</div>
                  : alertResult.alerts.map((a, i) => (
                      <div key={i} style={{ color: '#dc2626', fontWeight: 600, marginBottom: 6 }}>{a}</div>
                    ))
                }
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-sub)' }}>
                  E-mail: {alertResult.email?.sent ? '✅ Wysłano' : alertResult.email?.skipped === 'no_alerts' ? '— brak alertów' : alertResult.email?.skipped === 'no_smtp' ? '⚠️ Brak SMTP' : alertResult.email?.skipped === 'no_to' ? '⚠️ Brak adresów e-mail' : '❌ Błąd'}
                </div>
              </div>
            )}
            {alertResult?.error && (
              <div style={s.errorBox}>Błąd: {alertResult.error}</div>
            )}
          </div>
        )}

        {loading && !ov && activeTab !== 'alerts' && (
          <div style={s.emptyState}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
            <p>Ładowanie danych analitycznych…</p>
          </div>
        )}
      </main>

      {/* Drill-down modal */}
      {drill && (
        <DrillModal
          title={drill.title}
          tasks={drill.tasks}
          loading={drill.loading}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

const s = {
  shell:    { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main:     { flex: 1, padding: '20px 24px 40px', overflowX: 'hidden', minWidth: 0 },
  topbar:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  title:    { fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 },
  sub:      { fontSize: 13, color: 'var(--text-sub)', marginTop: 4 },
  periodRow:{ display: 'flex', gap: 4 },
  periodBtn:{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 13 },
  periodBtnActive: { background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700 },
  refreshBtn:{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 },
  backBtn:  { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 },
  errorBox: { padding: '12px 16px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', marginBottom: 16, fontSize: 14 },
  tabs:     { display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' },
  tab:      { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  tabActive:{ background: 'var(--bg)', border: '1px solid var(--accent)', color: 'var(--accent)', fontWeight: 700 },
  content:  { display: 'flex', flexDirection: 'column', gap: 16 },
  kpiRow:   { display: 'flex', gap: 12, flexWrap: 'wrap' },
  kpiCard:  { flex: 1, minWidth: 130, padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' },
  kpiValue: { fontSize: 24, fontWeight: 800, marginBottom: 2 },
  kpiLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', marginTop: 6 },
  kpiSub:   { fontSize: 11, color: 'var(--text-muted, var(--text-sub))', marginTop: 2 },
  card:     { background: 'var(--surface-glass)', borderRadius: 8, border: '1px solid var(--glass-border)', padding: '16px 18px', boxShadow: 'var(--shadow-md)' },
  cardTitle:{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14 },
  twoCol:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  table:    { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:       { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' },
  tr:       { borderBottom: '1px solid var(--border-light, var(--border))' },
  td:       { padding: '10px 10px', color: 'var(--text)', verticalAlign: 'middle' },
  tdNum:    { padding: '10px 10px', color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  emptyState:{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-sub)' },
  funnelWrap:{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' },
  funnelStep:{ width: '100%' },
  funnelBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 6, minWidth: 80, transition: 'width 0.4s ease' },
  funnelLabel:{ color: '#fff', fontWeight: 600, fontSize: 13 },
  funnelVal: { color: 'rgba(255,255,255,0.9)', fontWeight: 800, fontSize: 15 },
};

const ch = {
  empty: { textAlign: 'center', padding: '30px 0', color: 'var(--text-sub)', fontSize: 13 },
};

const al = {
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  btn:   { padding: '10px 20px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent, #fff)', cursor: 'pointer', fontSize: 14, fontWeight: 700, width: '100%' },
  stat:  { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', minWidth: 100 },
  statN: { fontSize: 24, fontWeight: 800, color: 'var(--text)' },
  statL: { fontSize: 11, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase', marginTop: 4 },
};
