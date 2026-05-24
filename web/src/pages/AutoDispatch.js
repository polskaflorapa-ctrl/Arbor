import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';

const TEAM_COLORS = [
  '#16a34a','#2563eb','#dc2626','#d97706','#7c3aed',
  '#0891b2','#be185d','#65a30d','#c2410c','#1d4ed8',
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function money(value) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

const PRIORITY_COLOR = {
  high: '#dc2626',
  medium: '#d97706',
  low: '#2563eb',
};

// Reason codes → human-readable labels (kept in Polish; not in locale file)
const REASON_LABEL = {
  no_teams:           'Brak ekip',
  no_capable_team:    'Brak ekipy z wymaganym sprzętem/kompetencjami',
  capacity_exceeded:  'Przekroczony limit godzin',
};

function Stat({ label, value, tone }) {
  const bg = tone === 'ok' ? '#dcfce7' : tone === 'warn' ? '#fef9c3' : tone === 'bad' ? '#fee2e2' : 'var(--bg-card)';
  const fg = tone === 'ok' ? '#16a34a' : tone === 'warn' ? '#ca8a04' : tone === 'bad' ? '#dc2626' : 'var(--text)';
  return (
    <div style={{ ...s.statCard, background: bg }}>
      <div style={{ ...s.statValue, color: fg }}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

export default function AutoDispatch() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = readStoredUser();

  const [date, setDate]             = useState(todayIso());
  const [plan, setPlan]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [applying, setApplying]     = useState(false);
  const [savedPlanId, setSavedPlanId] = useState(null);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [advisor, setAdvisor]       = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const [preflightHold, setPreflightHold] = useState(null);

  const fetchAdvisorBrief = useCallback(async () => {
    const token = getStoredToken();
    const res = await api.get('/ai/dispatch-brief', {
      params: { date, oddzial_id: user?.oddzial_id },
      headers: authHeaders(token),
    });
    return res.data;
  }, [date, user?.oddzial_id]);

  const runSolver = useCallback(async (save = false, options = {}) => {
    setLoading(true); setError(''); setSuccess(''); setPlan(null); setSavedPlanId(null);
    try {
      if (save && !options.skipPreflight) {
        const brief = advisor?.date === date ? advisor : await fetchAdvisorBrief();
        setAdvisor(brief);
        const blocked = Number(brief?.metrics?.blocked || 0);
        if (blocked > 0) {
          setPreflightHold({
            blocked,
            warnings: Number(brief?.metrics?.warnings || 0),
            total: Number(brief?.metrics?.tasks_total || 0),
            ready: Number(brief?.metrics?.ready_for_dispatch || 0),
          });
          setError(`AI Dyspozytor zatrzymal zapis planu: ${blocked} zlecen ma blokady krytyczne.`);
          return;
        }
      }
      setPreflightHold(null);
      const token = getStoredToken();
      const endpoint = save ? '/dispatch/plan/save' : '/dispatch/plan';
      const res = await api.post(endpoint, { date, oddzial_id: user?.oddzial_id }, { headers: authHeaders(token) });
      setPlan(res.data);
      if (save && res.data.id) {
        setSavedPlanId(res.data.id);
        setSuccess('Plan zapisany — możesz teraz zastosować.');
      }
      setExpandedTeam(res.data.routes?.[0]?.team_id ?? null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [advisor, date, fetchAdvisorBrief, user?.oddzial_id]);

  const applyPlan = useCallback(async () => {
    if (!savedPlanId) return;
    setApplying(true); setError(''); setSuccess('');
    try {
      const token = getStoredToken();
      const res = await api.post(`/dispatch/apply/${savedPlanId}`, {}, { headers: authHeaders(token) });
      setSuccess(res.data.message || 'Plan zastosowany!');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setApplying(false); }
  }, [savedPlanId]);

  const loadAdvisor = useCallback(async () => {
    setAdvisorLoading(true);
    setAdvisorError('');
    try {
      const brief = await fetchAdvisorBrief();
      setAdvisor(brief);
      setPreflightHold(null);
    } catch (e) {
      setAdvisorError(e.response?.data?.error || e.message);
    } finally {
      setAdvisorLoading(false);
    }
  }, [fetchAdvisorBrief]);

  const stats = plan?.stats;

  return (
    <div style={s.shell}>
      <Sidebar />
      <main style={s.main}>
        {/* Header */}
        <div style={s.topbar}>
          <div>
            <h1 style={s.title}>🗺️ {t('autoDispatch.title')}</h1>
            <p style={s.sub}>{t('autoDispatch.subtitle')}</p>
          </div>
          <button type="button" onClick={() => navigate('/kierownik')} style={s.backBtn}>← Powrót</button>
        </div>

        {/* Controls */}
        <div style={s.controls}>
          <div style={s.controlGroup}>
            <label style={s.label}>{t('autoDispatch.datePicker')}</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setAdvisor(null); setAdvisorError(''); setPreflightHold(null); }}
              style={s.dateInput}
            />
          </div>
          <div style={s.btnRow}>
            <button type="button" onClick={() => runSolver(false)} disabled={loading} style={s.previewBtn}>
              {loading ? `⏳ ${t('autoDispatch.btnPreviewLoading')}` : `▶ ${t('autoDispatch.btnPreview')}`}
            </button>
            <button type="button" onClick={loadAdvisor} disabled={advisorLoading} style={s.aiBtn}>
              {advisorLoading ? 'Analizuje...' : 'AI Dyspozytor'}
            </button>
            <button type="button" onClick={() => runSolver(true)} disabled={loading} style={s.saveBtn}>
              {loading ? '⏳...' : `💾 ${t('autoDispatch.btnSave')}`}
            </button>
            {savedPlanId && (
              <button type="button" onClick={applyPlan} disabled={applying} style={s.applyBtn}>
                {applying ? `⏳ ${t('autoDispatch.btnApplying')}` : `✅ ${t('autoDispatch.btnApply')}`}
              </button>
            )}
          </div>
        </div>

        {error   && <div style={s.errorBox}>{error}</div>}
        {success && <div style={s.successBox}>{success}</div>}
        {advisorError && <div style={s.errorBox}>{advisorError}</div>}

        {preflightHold && (
          <div style={s.preflightBox}>
            <div style={s.preflightText}>
              <strong>AI Dyspozytor zatrzymal zapis planu.</strong>
              <span>
                Gotowe: {preflightHold.ready} / {preflightHold.total}. Blokady: {preflightHold.blocked}.
                {preflightHold.warnings > 0 ? ` Uwagi: ${preflightHold.warnings}.` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => runSolver(true, { skipPreflight: true })}
              disabled={loading}
              style={s.preflightBypassBtn}
            >
              Zapisz mimo blokad
            </button>
          </div>
        )}

        {advisor && (
          <section style={s.advisorPanel}>
            <div style={s.advisorHeader}>
              <div>
                <div style={s.advisorEyebrow}>AI Dyspozytor</div>
                <h2 style={s.advisorTitle}>{advisor.summary || 'Kontrola jakosci planu dnia'}</h2>
              </div>
              <span style={s.advisorSource}>
                {advisor.source === 'ai' ? (advisor.provider || 'AI') : 'Reguly'}
              </span>
            </div>

            <div style={s.advisorMetrics}>
              <Stat
                label="Gotowe"
                value={`${advisor.metrics?.ready_for_dispatch ?? 0} / ${advisor.metrics?.tasks_total ?? 0}`}
                tone="ok"
              />
              <Stat
                label="Blokady"
                value={advisor.metrics?.blocked ?? 0}
                tone={(advisor.metrics?.blocked ?? 0) > 0 ? 'bad' : 'ok'}
              />
              <Stat
                label="Uwagi"
                value={advisor.metrics?.warnings ?? 0}
                tone={(advisor.metrics?.warnings ?? 0) > 0 ? 'warn' : 'ok'}
              />
              <Stat
                label="Jakosc"
                value={`${advisor.metrics?.avg_quality ?? 100}%`}
                tone={(advisor.metrics?.avg_quality ?? 100) >= 80 ? 'ok' : 'warn'}
              />
              <Stat label="Wartosc" value={money(advisor.metrics?.total_value)} />
            </div>

            <div style={s.advisorGrid}>
              <div style={s.advisorColumn}>
                <h3 style={s.sectionTitle}>Rekomendacje</h3>
                {(advisor.recommendations || []).map((item, idx) => (
                  <div key={`${item.title || 'recommendation'}-${idx}`} style={s.recommendation}>
                    <div style={s.recommendationTop}>
                      <span style={{ ...s.priority, background: PRIORITY_COLOR[item.priority] || '#64748b' }}>
                        {item.priority || 'info'}
                      </span>
                      <strong style={s.recommendationTitle}>{item.title}</strong>
                    </div>
                    {item.rationale && <p style={s.recommendationText}>{item.rationale}</p>}
                    {item.suggested_action && <div style={s.recommendationAction}>{item.suggested_action}</div>}
                  </div>
                ))}
              </div>

              <div style={s.advisorColumn}>
                <h3 style={s.sectionTitle}>Ryzykowne zlecenia</h3>
                {(advisor.top_tasks || []).length === 0 && (
                  <div style={s.advisorEmpty}>Brak otwartych zlecen do analizy.</div>
                )}
                {(advisor.top_tasks || []).map(task => (
                  <button
                    key={task.task_id}
                    type="button"
                    style={s.riskTask}
                    onClick={() => task.task_id && navigate(`/zlecenia/${task.task_id}`)}
                  >
                    <span style={s.riskTaskTop}>
                      <strong>{task.task_numer}</strong>
                      <span style={s.qualityPill}>{task.quality_score}%</span>
                    </span>
                    <span style={s.riskTaskClient}>{task.client || 'Bez klienta'} · {task.status || '-'}</span>
                    {(task.issues || []).slice(0, 2).map(issue => (
                      <span key={`${task.task_id}-${issue.key}`} style={s.riskTaskIssue}>
                        {issue.label} — {issue.action}
                      </span>
                    ))}
                    <span style={s.riskTaskFooter}>
                      <span style={(task.issues || []).some(issue => issue.severity === 'critical') ? s.riskBadgeCritical : s.riskBadgeWarn}>
                        {(task.issues || []).filter(issue => issue.severity === 'critical').length
                          ? `${(task.issues || []).filter(issue => issue.severity === 'critical').length} kryt.`
                          : `${(task.issues || []).length} uwag`}
                      </span>
                      <span style={s.openTaskCta}>Otworz zlecenie</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Stats bar */}
        {stats && (
          <div style={s.statsBar}>
            <Stat label={t('autoDispatch.stats.coverage')}
                  value={`${stats.coverage_pct}%`}
                  tone={stats.coverage_pct >= 90 ? 'ok' : stats.coverage_pct >= 60 ? 'warn' : 'bad'} />
            <Stat label={t('autoDispatch.stats.assigned')}
                  value={`${stats.tasks_assigned} / ${stats.tasks_total}`} />
            <Stat label={t('autoDispatch.stats.teamsActive')}
                  value={stats.teams_used} />
            <Stat label={t('autoDispatch.stats.unassigned')}
                  value={stats.tasks_unassigned}
                  tone={stats.tasks_unassigned > 0 ? 'warn' : 'ok'} />
            <Stat label={t('autoDispatch.stats.solverTime')}
                  value={`${stats.solver_ms} ms`} />
          </div>
        )}

        {plan && (
          <div style={s.content}>
            {/* Routes */}
            <div style={s.routesCol}>
              <h2 style={s.sectionTitle}>{t('autoDispatch.routes')} ({plan.routes?.length ?? 0})</h2>
              {(plan.routes || []).map((route, ri) => {
                const color = TEAM_COLORS[ri % TEAM_COLORS.length];
                const open = expandedTeam === route.team_id;
                return (
                  <div key={route.team_id} style={{ ...s.routeCard, borderLeft: `4px solid ${color}` }}>
                    <button
                      type="button"
                      style={s.routeHeader}
                      onClick={() => setExpandedTeam(open ? null : route.team_id)}
                    >
                      <span style={{ ...s.teamDot, background: color }} />
                      <strong style={s.teamName}>{route.team_name}</strong>
                      <span style={s.routeMeta}>{route.stops.length} zlec · {fmt(route.total_min)} · ~{route.distance_km} km</span>
                      <span style={s.chevron}>{open ? '▲' : '▼'}</span>
                    </button>

                    {open && (
                      <div style={s.stopList}>
                        {route.stops.map((stop, si) => (
                          <div key={stop.task_id} style={s.stopRow}>
                            <span style={s.stopNum}>{si + 1}</span>
                            <div style={s.stopBody}>
                              <div style={s.stopTitle}>
                                <strong>{stop.task_numer}</strong>
                                {!stop.time_window_ok && (
                                  <span style={s.lateBadge}>⚠ {t('autoDispatch.timeWindowWarn')}</span>
                                )}
                              </div>
                              <div style={s.stopMeta}>{stop.adres}</div>
                              <div style={s.stopTimes}>
                                {t('autoDispatch.eta')}: <strong>{stop.eta}</strong>
                                {stop.okno_od && ` · ${t('autoDispatch.window')}: ${stop.okno_od}–${stop.okno_do || '?'}`}
                                {` · ${t('autoDispatch.drive')}: ${stop.travel_min}m · ${t('autoDispatch.service')}: ${stop.service_min}m`}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div style={s.returnRow}>
                          🏠 {t('autoDispatch.returnToBase')} — {route.end_time} (+{route.return_travel_min} min)
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Unassigned */}
            {plan.unassigned?.length > 0 && (
              <div style={s.unassignedCol}>
                <h2 style={s.sectionTitle}>{t('autoDispatch.unassigned')} ({plan.unassigned.length})</h2>
                {plan.unassigned.map(u => (
                  <div key={u.task_id} style={s.unassignedCard}>
                    <strong>{u.task_numer}</strong>
                    <div style={s.unassignedAddr}>{u.adres}</div>
                    <div style={s.reasonBadge}>{REASON_LABEL[u.reason] || u.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!plan && !loading && (
          <div style={s.empty}>
            <div style={s.emptyIcon}>🗺️</div>
            <p>{t('autoDispatch.emptyHint')}</p>
          </div>
        )}
      </main>
    </div>
  );
}

const s = {
  shell:    { display: 'flex', minHeight: '100vh', background: 'var(--bg-deep)' },
  main:     { flex: 1, padding: '20px 24px 32px', overflowX: 'hidden', minWidth: 0 },
  topbar:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  title:    { fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 },
  sub:      { fontSize: 13, color: 'var(--text-sub)', marginTop: 4 },
  backBtn:  { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 },
  controls: { display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: '16px 18px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label:    { fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase' },
  dateInput:{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 },
  btnRow:   { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  previewBtn:{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  aiBtn:    { padding: '10px 18px', borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  saveBtn:  { padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  applyBtn: { padding: '10px 18px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  errorBox: { padding: '12px 16px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', marginBottom: 16, fontSize: 14 },
  successBox:{ padding: '12px 16px', borderRadius: 8, background: '#dcfce7', color: '#16a34a', marginBottom: 16, fontSize: 14, fontWeight: 600 },
  preflightBox:{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', marginBottom: 16 },
  preflightText:{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, lineHeight: 1.4 },
  preflightBypassBtn:{ flexShrink: 0, padding: '8px 12px', borderRadius: 7, border: '1px solid #f97316', background: '#fff', color: '#c2410c', cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  advisorPanel:{ marginBottom: 20, padding: '16px 18px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' },
  advisorHeader:{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 14 },
  advisorEyebrow:{ fontSize: 11, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0 },
  advisorTitle:{ margin: '3px 0 0', fontSize: 17, lineHeight: 1.35, color: 'var(--text)' },
  advisorSource:{ flexShrink: 0, padding: '4px 8px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-sub)', fontSize: 11, fontWeight: 700 },
  advisorMetrics:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 14 },
  advisorGrid:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 18, alignItems: 'start' },
  advisorColumn:{ minWidth: 0 },
  recommendation:{ padding: '10px 0', borderTop: '1px solid var(--border-light, var(--border))' },
  recommendationTop:{ display: 'flex', alignItems: 'center', gap: 8 },
  priority:{ color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  recommendationTitle:{ color: 'var(--text)', fontSize: 13 },
  recommendationText:{ margin: '5px 0 0', color: 'var(--text-sub)', fontSize: 12, lineHeight: 1.45 },
  recommendationAction:{ marginTop: 6, color: 'var(--text)', fontSize: 12, fontWeight: 600 },
  advisorEmpty:{ padding: '12px 0', color: 'var(--text-sub)', fontSize: 13, borderTop: '1px solid var(--border-light, var(--border))' },
  riskTask:{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', background: 'none', border: 'none', borderTop: '1px solid var(--border-light, var(--border))', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' },
  riskTaskTop:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 },
  riskTaskClient:{ fontSize: 12, color: 'var(--text-sub)' },
  riskTaskIssue:{ fontSize: 11, color: 'var(--text-muted, var(--text-sub))', lineHeight: 1.35 },
  riskTaskFooter:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  riskBadgeCritical:{ flexShrink: 0, borderRadius: 999, padding: '2px 7px', background: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 900 },
  riskBadgeWarn:{ flexShrink: 0, borderRadius: 999, padding: '2px 7px', background: '#fef9c3', color: '#a16207', fontSize: 10, fontWeight: 900 },
  openTaskCta:{ marginLeft: 'auto', color: '#2563eb', fontSize: 11, fontWeight: 800 },
  qualityPill:{ flexShrink: 0, minWidth: 40, textAlign: 'center', borderRadius: 6, padding: '2px 6px', background: '#f1f5f9', color: '#334155', fontSize: 11, fontWeight: 800 },
  statsBar: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 100, padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)' },
  statValue:{ fontSize: 22, fontWeight: 800 },
  statLabel:{ fontSize: 11, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase', marginTop: 4 },
  content:  { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' },
  routesCol:{ display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle:{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 },
  routeCard:{ background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' },
  routeHeader:{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', textAlign: 'left' },
  teamDot:  { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  teamName: { flex: 1, fontSize: 15 },
  routeMeta:{ fontSize: 12, color: 'var(--text-sub)' },
  chevron:  { fontSize: 12, color: 'var(--text-sub)' },
  stopList: { borderTop: '1px solid var(--border)', padding: '8px 0' },
  stopRow:  { display: 'flex', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border-light, var(--border))' },
  stopNum:  { width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  stopBody: { flex: 1, minWidth: 0 },
  stopTitle:{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 },
  stopMeta: { fontSize: 12, color: 'var(--text-sub)', marginBottom: 2 },
  stopTimes:{ fontSize: 11, color: 'var(--text-muted, var(--text-sub))' },
  lateBadge:{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '1px 5px', fontWeight: 700 },
  returnRow:{ padding: '8px 16px', fontSize: 12, color: 'var(--text-sub)', fontStyle: 'italic' },
  unassignedCol:{ display: 'flex', flexDirection: 'column', gap: 8 },
  unassignedCard:{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid #fca5a5' },
  unassignedAddr:{ fontSize: 12, color: 'var(--text-sub)', margin: '4px 0' },
  reasonBadge:{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 6px', display: 'inline-block', fontWeight: 600 },
  empty:    { textAlign: 'center', padding: '60px 20px', color: 'var(--text-sub)' },
  emptyIcon:{ fontSize: 48, marginBottom: 16 },
};
