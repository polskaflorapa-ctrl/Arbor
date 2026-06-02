import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function routeDateFromSearch(search) {
  const value = new URLSearchParams(search || '').get('date') || '';
  return ISO_DATE_RE.test(value) ? value : '';
}

function advisorRefreshFromSearch(search) {
  return new URLSearchParams(search || '').get('refresh') === 'advisor';
}

function autoDispatchReturnPath(date) {
  const params = new URLSearchParams({
    date,
    refresh: 'advisor',
    repaired: '1',
  });
  return `/auto-dispatch?${params.toString()}`;
}

function stripAdvisorRefresh(pathname, search) {
  const params = new URLSearchParams(search || '');
  params.delete('refresh');
  params.delete('repaired');
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}`;
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

const RISK_FILTERS = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'critical', label: 'Krytyczne' },
  { key: 'warning', label: 'Uwagi' },
];
const EMPTY_TASKS = [];

// Reason codes → human-readable labels (kept in Polish; not in locale file)
const REASON_LABEL = {
  no_teams:           'Brak ekip',
  no_capable_team:    'Brak ekipy z wymaganym sprzętem/kompetencjami',
  capacity_exceeded:  'Przekroczony limit godzin',
};

function taskIssueBadge(issues = []) {
  const critical = issues.filter(issue => issue.severity === 'critical').length;
  return critical ? `${critical} kryt.` : `${issues.length} uwag`;
}

function taskHasCriticalIssue(task) {
  return (task.issues || []).some(issue => issue.severity === 'critical');
}

function taskHasWarningOnly(task) {
  const issues = task.issues || [];
  return issues.length > 0 && !taskHasCriticalIssue(task);
}

function issueLabel(issue) {
  return issue?.label || issue?.key || 'Inna uwaga';
}

function taskHasIssueLabel(task, label) {
  return (task.issues || []).some(issue => issueLabel(issue) === label);
}

function summarizeTaskIssues(tasks) {
  const summary = new Map();
  tasks.forEach(task => {
    (task.issues || []).forEach(issue => {
      const label = issueLabel(issue);
      const current = summary.get(label) || { label, count: 0, critical: 0 };
      current.count += 1;
      if (issue.severity === 'critical') current.critical += 1;
      summary.set(label, current);
    });
  });
  return Array.from(summary.values())
    .sort((a, b) => (b.critical - a.critical) || (b.count - a.count) || a.label.localeCompare(b.label))
    .slice(0, 4);
}

const ISSUE_REPAIR_TARGETS = {
  client_phone: { mode: 'edit', step: 'client', field: 'klient_telefon' },
  phone: { mode: 'edit', step: 'client', field: 'klient_telefon' },
  address: { mode: 'edit', step: 'client', field: 'adres' },
  price: { mode: 'edit', step: 'finance', field: 'wartosc_planowana' },
  planned_duration: { mode: 'edit', step: 'finance', field: 'czas_planowany_godziny' },
  duration: { mode: 'edit', step: 'finance', field: 'czas_planowany_godziny' },
  hours: { mode: 'edit', step: 'finance', field: 'czas_planowany_godziny' },
  date: { mode: 'edit', step: 'planning', field: 'data_planowana' },
  slot: { mode: 'edit', step: 'planning', field: 'data_planowana' },
  team: { mode: 'edit', step: 'planning', field: 'ekipa_id' },
  gps: { mode: 'detail', focus: 'officePlan' },
};

function taskPath(task) {
  return task?.task_id ? `/zlecenia/${task.task_id}` : '';
}

function primaryTaskIssue(task) {
  const issues = task?.issues || [];
  return issues.find(issue => issue.severity === 'critical') || issues[0] || null;
}

function repairTargetForIssue(issue) {
  if (!issue?.key) return null;
  return ISSUE_REPAIR_TARGETS[issue.key] || ISSUE_REPAIR_TARGETS[String(issue.key).replace(/^client_/, '')] || null;
}

function taskRepairPath(task, returnTo = '') {
  const basePath = taskPath(task);
  if (!basePath) return '';
  const issue = primaryTaskIssue(task);
  const target = repairTargetForIssue(issue);
  if (!target) return basePath;

  const params = new URLSearchParams();
  if (target.mode === 'edit') {
    params.set('mode', 'edit');
    params.set('step', target.step);
    params.set('field', target.field);
  } else if (target.focus) {
    params.set('focus', target.focus);
  }
  if (issue?.key) params.set('issue', issue.key);
  if (issue?.label) params.set('repairLabel', issue.label);
  if (issue?.action) params.set('repairDetail', issue.action);
  if (returnTo) {
    params.set('returnTo', returnTo);
    params.set('returnLabel', 'AI Dyspozytor');
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildNextDispatchAction(advisor, riskTasks) {
  if (!advisor) return null;
  const metrics = advisor.metrics || {};
  const nextTask = riskTasks.find(taskHasCriticalIssue) || riskTasks.find(taskHasWarningOnly) || null;
  if (nextTask) {
    const issue = primaryTaskIssue(nextTask);
    const critical = taskHasCriticalIssue(nextTask);
    const taskLabel = nextTask.task_numer || (nextTask.task_id ? `#${nextTask.task_id}` : 'Zlecenie');
    const client = nextTask.client ? `${nextTask.client}. ` : '';
    return {
      kind: 'task',
      tone: critical ? 'bad' : 'warn',
      eyebrow: critical ? 'Nastepna blokada' : 'Nastepna uwaga',
      title: `${taskLabel}: ${issueLabel(issue)}`,
      detail: `${client}${issue?.action || 'Otworz zlecenie i uzupelnij dane.'}`,
      button: critical ? 'Napraw blokade' : 'Otworz uwage',
      task: nextTask,
    };
  }

  const blocked = Number(metrics.blocked || 0);
  const warnings = Number(metrics.warnings || 0);
  const total = Number(metrics.tasks_total || 0);
  if (blocked > 0) {
    return {
      kind: 'blocked_summary',
      tone: 'bad',
      eyebrow: 'Blokady w odprawie',
      title: `${blocked} blokad do znalezienia`,
      detail: 'Odprawa nie wskazala konkretnego zlecenia. Odswiez analize po sprawdzeniu listy.',
      button: 'Odswiez odprawe',
    };
  }

  return {
    kind: total > 0 ? 'ready' : 'idle',
    tone: 'ready',
    eyebrow: total > 0 ? 'Gotowe do planowania' : 'Brak zlecen',
    title: total > 0 ? 'Plan gotowy do solvera' : 'Nie ma zlecen do planowania',
    detail: total > 0
      ? (warnings > 0 ? `Bez blokad krytycznych. Zostalo ${warnings} uwag do kontroli.` : 'Brak blokad i uwag w odprawie dnia.')
      : 'Odprawa nie znalazla otwartych zlecen na wybrany dzien.',
    button: total > 0 ? 'Generuj podglad planu' : '',
  };
}

function formatAdvisorBrief(advisor) {
  const metrics = advisor?.metrics || {};
  const lines = [
    'AI Dyspozytor - odprawa dnia',
    advisor?.summary ? `Podsumowanie: ${advisor.summary}` : null,
    `Gotowe: ${metrics.ready_for_dispatch ?? 0}/${metrics.tasks_total ?? 0} | Blokady: ${metrics.blocked ?? 0} | Uwagi: ${metrics.warnings ?? 0} | Jakosc: ${metrics.avg_quality ?? 100}%`,
  ].filter(Boolean);

  const recommendations = (advisor?.recommendations || []).slice(0, 3);
  if (recommendations.length) {
    lines.push('', 'Rekomendacje:');
    recommendations.forEach(item => {
      lines.push(`- [${item.priority || 'info'}] ${item.title || 'Bez tytulu'}${item.suggested_action ? ` -> ${item.suggested_action}` : ''}`);
    });
  }

  const riskyTasks = (advisor?.top_tasks || []).slice(0, 5);
  if (riskyTasks.length) {
    lines.push('', 'Ryzykowne zlecenia:');
    riskyTasks.forEach(task => {
      const issues = (task.issues || []).map(issue => issue.label).filter(Boolean).join(', ');
      lines.push(`- ${task.task_numer || `#${task.task_id}`} (${taskIssueBadge(task.issues || [])}) ${task.client || 'Bez klienta'}${issues ? `: ${issues}` : ''}`);
    });
  }

  return lines.join('\n');
}

function stopClientName(stop = {}) {
  return stop.client || stop.klient_nazwa || stop.client_name || '';
}

function stopClientPhone(stop = {}) {
  return stop.client_phone || stop.klient_telefon || stop.phone || stop.telefon || '';
}

function stopHasPhoneSignal(stop = {}) {
  return ['client_phone', 'klient_telefon', 'phone', 'telefon']
    .some(key => Object.prototype.hasOwnProperty.call(stop, key));
}

function dispatchStopWarnings(stop = {}) {
  const warnings = [];
  if (stopHasPhoneSignal(stop) && !stopClientPhone(stop)) {
    warnings.push({ key: 'phone', label: 'Brak telefonu' });
  }
  if (stop.lat == null || stop.lng == null) {
    warnings.push({ key: 'gps', label: 'Brak pinezki GPS' });
  }
  if (stop.time_window_ok === false) {
    warnings.push({ key: 'window', label: 'Ryzyko okna czasowego' });
  }
  return warnings;
}

function stopWindowText(stop = {}) {
  return stop.okno_od ? `okno ${stop.okno_od}-${stop.okno_do || '?'}` : '';
}

function formatDispatchStop(stop = {}, index = 0) {
  const taskLabel = stop.task_numer || (stop.task_id ? `#${stop.task_id}` : 'Zlecenie');
  const client = stopClientName(stop) || 'Bez klienta';
  const phone = stopClientPhone(stop) || 'brak telefonu';
  const address = stop.adres || 'bez adresu';
  const timing = [
    `ETA ${stop.eta || '--:--'}`,
    stopWindowText(stop),
    `dojazd ${stop.travel_min ?? '?'} min`,
    `praca ${stop.service_min ?? '?'} min`,
  ].filter(Boolean).join(' | ');
  const warnings = dispatchStopWarnings(stop).map(item => item.label.toLowerCase());
  return `${index + 1}. ${taskLabel} - ${client} - ${address} | tel: ${phone} | ${timing}${warnings.length ? ` | uwagi: ${warnings.join(', ')}` : ''}`;
}

function formatRouteBrief(route = {}, date = '') {
  const lines = [
    `Odprawa ekipy - ${route.team_name || `Ekipa #${route.team_id || ''}`.trim()}`,
    `Data: ${route.date || date || '-'}`,
    `Zlecenia: ${(route.stops || []).length} | Czas: ${fmt(route.total_min)} | Dystans: ~${route.distance_km ?? 0} km`,
    route.end_time ? `Powrot do bazy: ${route.end_time} (+${route.return_travel_min ?? '?'} min)` : null,
    '',
    'Trasa:',
  ].filter(Boolean);

  (route.stops || []).forEach((stop, index) => {
    lines.push(formatDispatchStop(stop, index));
  });

  return lines.join('\n');
}

function formatDayDispatchBrief(plan = {}, date = '') {
  const stats = plan.stats || {};
  const routes = plan.routes || [];
  const lines = [
    `Plan dnia - ${plan.date || date || '-'}`,
    `Przypisane: ${stats.tasks_assigned ?? 0}/${stats.tasks_total ?? 0} | Ekipy: ${stats.teams_used ?? routes.length} | Pokrycie: ${stats.coverage_pct ?? 0}%`,
  ];

  if (planAppliedStatus(plan)) {
    lines.push('Status: plan zastosowany i gotowy do wyslania ekipom');
  }

  lines.push('', 'Ekipy:');
  routes.forEach((route, index) => {
    lines.push(`${index + 1}. ${route.team_name || `Ekipa #${route.team_id || ''}`.trim()}: ${(route.stops || []).length} zlec, ${fmt(route.total_min)}, koniec ${route.end_time || '-'}`);
    (route.stops || []).forEach((stop, stopIndex) => {
      lines.push(`   ${formatDispatchStop(stop, stopIndex)}`);
    });
  });

  if ((plan.unassigned || []).length) {
    lines.push('', 'Nieprzypisane:');
    plan.unassigned.forEach(item => {
      lines.push(`- ${item.task_numer || `#${item.task_id}`} ${item.adres || ''} (${REASON_LABEL[item.reason] || item.reason || 'bez powodu'})`);
    });
  }

  return lines.join('\n');
}

function planAppliedStatus(plan) {
  return plan?.status === 'applied';
}

function routeBriefKey(route = {}) {
  return `route-${route.team_id || route.team_name || 'team'}`;
}

function routeBriefStatusFromResponse(route = {}, data = {}) {
  const raw = data.status || data;
  const sentTo = Number(raw.sent_to ?? data.notification_count ?? 0) || 0;
  const confirmed = Number(raw.confirmed ?? 0) || 0;
  const pending = Number(raw.pending ?? Math.max(0, sentTo - confirmed)) || 0;
  return {
    brief_id: raw.brief_id ?? data.brief_id ?? null,
    team_id: raw.team_id ?? data.team_id ?? route.team_id ?? null,
    team_name: raw.team_name ?? data.team_name ?? route.team_name ?? '',
    sent_at: raw.sent_at ?? new Date().toISOString(),
    sent_to: sentTo,
    confirmed,
    pending,
    recipients: Array.isArray(raw.recipients) ? raw.recipients : (Array.isArray(data.recipient_details) ? data.recipient_details : []),
  };
}

function routeBriefStatusesFromItems(routes = [], items = []) {
  const routesByTeamId = new Map(
    (routes || [])
      .filter(route => route?.team_id)
      .map(route => [String(route.team_id), route])
  );
  return (items || []).reduce((acc, item) => {
    if (!item?.team_id) return acc;
    const route = routesByTeamId.get(String(item.team_id)) || item;
    acc[routeBriefKey(route)] = routeBriefStatusFromResponse(route, { status: item });
    return acc;
  }, {});
}

function routeBriefStatusText(status = {}) {
  const sentTo = Number(status.sent_to || 0);
  if (!sentTo) return '';
  const confirmed = Number(status.confirmed || 0);
  const pending = Number(status.pending ?? Math.max(0, sentTo - confirmed));
  if (pending <= 0) return `Potwierdzone ${confirmed}/${sentTo}`;
  if (confirmed > 0) return `Potwierdzone ${confirmed}/${sentTo} | czeka ${pending}`;
  return `Wyslano do ${sentTo} | czeka ${pending}`;
}

function routeBriefRecipientName(recipient = {}) {
  return recipient.name || recipient.recipient_name || recipient.login || (recipient.user_id ? `User #${recipient.user_id}` : 'Odbiorca');
}

function routeBriefRecipientConfirmed(recipient = {}) {
  const status = String(recipient.status || '').toLowerCase();
  return Boolean(recipient.confirmed_at) || (status && status !== 'nowe');
}

function routeBriefPendingRecipients(status = {}) {
  return (status.recipients || []).filter(recipient => !routeBriefRecipientConfirmed(recipient));
}

function dispatchPreflightRecommendation(items = []) {
  return (items || []).find((item) => item?.action_kind === 'fix_dispatch_blockers' || item?.id === 'fix_dispatch_blockers') || null;
}

function dispatchPreflightSummary(preflight = {}) {
  const fixedTeams = Number(preflight.fixed_team_count || 0);
  const gpsChecklist = Number(preflight.gps_checklist_count || 0);
  const stillBlocked = Array.isArray(preflight.still_blocked) ? preflight.still_blocked.length : 0;
  const ready = Array.isArray(preflight.ready) ? preflight.ready.length : 0;
  return [
    fixedTeams ? `przypisano ekipy: ${fixedTeams}` : '',
    gpsChecklist ? `checklisty GPS: ${gpsChecklist}` : '',
    ready ? `gotowe po preflight: ${ready}` : '',
    stillBlocked ? `nadal blokuje: ${stillBlocked}` : '',
  ].filter(Boolean).join(' | ');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      // Fall back below for browsers that expose Clipboard API but block it.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand?.('copy');
    if (!copied) throw new Error('Fallback copy failed');
  } finally {
    document.body.removeChild(textarea);
  }
}

function Stat({ label, value, tone }) {
  const bg = tone === 'ok' ? '#dcfce7' : tone === 'warn' ? '#fef9c3' : tone === 'bad' ? '#fee2e2' : 'var(--surface-glass)';
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
  const location = useLocation();
  const { t } = useTranslation();
  const user = readStoredUser();

  const [date, setDate]             = useState(() => routeDateFromSearch(location.search) || todayIso());
  const [plan, setPlan]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [applying, setApplying]     = useState(false);
  const [savedPlanId, setSavedPlanId] = useState(null);
  const [planApplied, setPlanApplied] = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [advisor, setAdvisor]       = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const [preflightHold, setPreflightHold] = useState(null);
  const [preflightApplying, setPreflightApplying] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);
  const [briefCopyText, setBriefCopyText] = useState('');
  const [dispatchBriefCopied, setDispatchBriefCopied] = useState('');
  const [dispatchBriefText, setDispatchBriefText] = useState('');
  const [dispatchBriefSending, setDispatchBriefSending] = useState('');
  const [dispatchBriefReminding, setDispatchBriefReminding] = useState('');
  const [dispatchBriefRemindingAll, setDispatchBriefRemindingAll] = useState(false);
  const [dispatchBriefSendingAll, setDispatchBriefSendingAll] = useState(false);
  const [dispatchBriefSent, setDispatchBriefSent] = useState('');
  const [routeBriefStatuses, setRouteBriefStatuses] = useState({});
  const [dispatchBriefStatusLoading, setDispatchBriefStatusLoading] = useState(false);
  const [dispatchBriefStatusError, setDispatchBriefStatusError] = useState('');
  const [dispatchBriefStatusCheckedAt, setDispatchBriefStatusCheckedAt] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [riskIssueFilter, setRiskIssueFilter] = useState('');

  useEffect(() => {
    const routeDate = routeDateFromSearch(location.search);
    if (!routeDate || routeDate === date) return;
    setDate(routeDate);
    setAdvisor(null);
    setAdvisorError('');
    setPreflightHold(null);
    setPlan(null);
    setSavedPlanId(null);
    setPlanApplied(false);
    setBriefCopied(false);
    setBriefCopyText('');
    setDispatchBriefCopied('');
    setDispatchBriefText('');
    setDispatchBriefSending('');
    setDispatchBriefReminding('');
    setDispatchBriefRemindingAll(false);
    setDispatchBriefSendingAll(false);
    setDispatchBriefSent('');
    setRouteBriefStatuses({});
    setDispatchBriefStatusLoading(false);
    setDispatchBriefStatusError('');
    setDispatchBriefStatusCheckedAt('');
    setRiskFilter('all');
    setRiskIssueFilter('');
  }, [date, location.search]);

  const fetchAdvisorBrief = useCallback(async () => {
    const token = getStoredToken();
    const res = await api.get('/ai/dispatch-brief', {
      params: { date, oddzial_id: user?.oddzial_id },
      headers: authHeaders(token),
    });
    return res.data;
  }, [date, user?.oddzial_id]);

  const fetchOpsRecommendations = useCallback(async () => {
    const token = getStoredToken();
    const res = await api.get('/ops/action-recommendations', {
      params: { date, oddzial_id: user?.oddzial_id },
      headers: authHeaders(token),
    });
    return res.data;
  }, [date, user?.oddzial_id]);

  const runSolver = useCallback(async (save = false, options = {}) => {
    setLoading(true); setError(''); setSuccess(''); setPlan(null); setSavedPlanId(null);
    setPlanApplied(false);
    setDispatchBriefCopied('');
    setDispatchBriefText('');
    setDispatchBriefSending('');
    setDispatchBriefReminding('');
    setDispatchBriefRemindingAll(false);
    setDispatchBriefSendingAll(false);
    setDispatchBriefSent('');
    setRouteBriefStatuses({});
    setDispatchBriefStatusLoading(false);
    setDispatchBriefStatusError('');
    setDispatchBriefStatusCheckedAt('');
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
      const refreshedAdvisor = await fetchAdvisorBrief().catch(() => null);
      if (refreshedAdvisor) {
        setAdvisor(refreshedAdvisor);
      }
      setSuccess(res.data.message || 'Plan zastosowany!');
      setPlanApplied(true);
    } catch (e) {
      const payload = e.response?.data || {};
      if (payload.code === 'TEAM_ABSENT' && Array.isArray(payload.attendance?.absent)) {
        const absent = payload.attendance.absent;
        setPlan(prev => ({
          ...(prev || {}),
          team_availability: {
            ...(prev?.team_availability || {}),
            absent,
          },
        }));
        const names = absent.map(team => team.team_name || `Ekipa #${team.team_id}`).filter(Boolean).join(', ');
        setError(`${payload.error || e.message}${names ? ` Nieobecne: ${names}.` : ''}`);
        return;
      }
      if (payload.code === 'TEAM_COMPETENCY_BLOCKED' && Array.isArray(payload.blocked_assignments)) {
        const blocked = payload.blocked_assignments
          .map((item) => `zlecenie #${item.task_id}: ${(item.missing_competencies || []).join(', ')}`)
          .join('; ');
        setError(`${payload.error || e.message}${blocked ? ` Braki: ${blocked}.` : ''}`);
        return;
      }
      setError(payload.error || e.message);
    } finally { setApplying(false); }
  }, [fetchAdvisorBrief, savedPlanId]);

  const loadAdvisor = useCallback(async () => {
    setAdvisorLoading(true);
    setAdvisorError('');
    setSuccess('');
    setBriefCopied(false);
    setBriefCopyText('');
    setRiskFilter('all');
    setRiskIssueFilter('');
    try {
      const brief = await fetchAdvisorBrief();
      setAdvisor(brief);
      setPreflightHold(null);
      return true;
    } catch (e) {
      setAdvisorError(e.response?.data?.error || e.message);
      return false;
    } finally {
      setAdvisorLoading(false);
    }
  }, [fetchAdvisorBrief]);

  const runDispatchPreflight = useCallback(async () => {
    setPreflightApplying(true);
    setError('');
    setSuccess('');
    try {
      const token = getStoredToken();
      const recPayload = await fetchOpsRecommendations();
      const recommendation = dispatchPreflightRecommendation(recPayload?.recommendations || []);
      if (!recommendation) {
        const refreshedAdvisor = await fetchAdvisorBrief().catch(() => null);
        if (refreshedAdvisor) setAdvisor(refreshedAdvisor);
        setPreflightHold(null);
        setSuccess('Preflight nie znalazl blokad ekipy/GPS dla tego dnia. Mozesz ponowic zapis planu.');
        return;
      }

      const { data } = await api.post(`/ops/action-recommendations/${encodeURIComponent(recommendation.id)}/apply`, {
        date,
        oddzial_id: user?.oddzial_id || null,
        action_kind: recommendation.action_kind || 'fix_dispatch_blockers',
        target_path: recommendation.target_path || '',
        task_ids: recommendation.task_ids || [],
        title: recommendation.title || 'Preflight dispatchera',
      }, {
        headers: authHeaders(token),
      });

      const preflight = data?.dispatch_preflight || {};
      const stillBlocked = Array.isArray(preflight.still_blocked) ? preflight.still_blocked.length : 0;
      const checked = Number(preflight.checked || recommendation.task_count || recommendation.task_ids?.length || 0);
      const ready = Array.isArray(preflight.ready) ? preflight.ready.length : 0;
      const refreshedAdvisor = await fetchAdvisorBrief().catch(() => null);
      if (refreshedAdvisor) setAdvisor(refreshedAdvisor);
      setPreflightHold(stillBlocked > 0 ? {
        blocked: stillBlocked,
        warnings: Number(refreshedAdvisor?.metrics?.warnings || 0),
        total: checked,
        ready,
        summary: dispatchPreflightSummary(preflight),
        still_blocked: preflight.still_blocked || [],
      } : null);
      setSuccess(dispatchPreflightSummary(preflight) || 'Preflight dispatchera wykonany.');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Nie udalo sie uruchomic preflightu dispatchera.');
    } finally {
      setPreflightApplying(false);
    }
  }, [date, fetchAdvisorBrief, fetchOpsRecommendations, user?.oddzial_id]);

  useEffect(() => {
    if (!advisorRefreshFromSearch(location.search)) return undefined;
    const routeDate = routeDateFromSearch(location.search);
    if (routeDate && routeDate !== date) return undefined;

    let cancelled = false;
    (async () => {
      const refreshed = await loadAdvisor();
      if (cancelled) return;
      if (refreshed) {
        setSuccess('Poprawka zapisana. Odprawa odswiezona.');
        navigate(stripAdvisorRefresh(location.pathname, location.search), { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [date, loadAdvisor, location.pathname, location.search, navigate]);

  const copyAdvisorBrief = useCallback(async () => {
    if (!advisor) return;
    const briefText = formatAdvisorBrief(advisor);
    try {
      await copyTextToClipboard(briefText);
      setBriefCopied(true);
      setBriefCopyText('');
      setAdvisorError('');
    } catch (e) {
      setBriefCopied(false);
      setBriefCopyText(briefText);
      setAdvisorError('Automatyczne kopiowanie jest zablokowane. Pakiet odprawy jest zaznaczony ponizej.');
    }
  }, [advisor]);

  const copyDispatchBrief = useCallback(async (text, copiedKey) => {
    if (!text) return;
    try {
      await copyTextToClipboard(text);
      setDispatchBriefCopied(copiedKey);
      setDispatchBriefText('');
      setError('');
    } catch (e) {
      setDispatchBriefCopied('');
      setDispatchBriefText(text);
      setError('Automatyczne kopiowanie odprawy jest zablokowane. Tekst jest zaznaczony ponizej.');
    }
  }, []);

  const copyDayBrief = useCallback(() => {
    if (!plan) return;
    copyDispatchBrief(formatDayDispatchBrief(planApplied ? { ...plan, status: 'applied' } : plan, date), 'day');
  }, [copyDispatchBrief, date, plan, planApplied]);

  const copyRouteBrief = useCallback((route) => {
    copyDispatchBrief(formatRouteBrief(route, date), routeBriefKey(route));
  }, [copyDispatchBrief, date]);

  const sendRouteBrief = useCallback(async (route) => {
    const teamKey = routeBriefKey(route);
    if (!route?.team_id) {
      setError('Nie mozna wyslac odprawy bez identyfikatora ekipy.');
      return;
    }
    setDispatchBriefSending(teamKey);
    setError('');
    setSuccess('');
    try {
      const token = getStoredToken();
      const brief = formatRouteBrief(route, date);
      const taskIds = (route.stops || [])
        .map(stop => Number(stop.task_id))
        .filter(id => Number.isInteger(id) && id > 0);
      const res = await api.post('/dispatch/route-brief/send', {
        date,
        oddzial_id: user?.oddzial_id,
        team_id: route.team_id,
        team_name: route.team_name,
        task_ids: taskIds,
        brief,
      }, { headers: authHeaders(token) });
      const status = routeBriefStatusFromResponse(route, res.data);
      setRouteBriefStatuses(prev => ({ ...prev, [teamKey]: status }));
      setDispatchBriefSent(teamKey);
      setSuccess(`${res.data?.message || 'Odprawa wyslana'}: ${route.team_name || `Ekipa #${route.team_id}`} (${status.sent_to})`);
    } catch (e) {
      setDispatchBriefSent('');
      setError(e.response?.data?.error || e.message);
    } finally {
      setDispatchBriefSending('');
    }
  }, [date, user?.oddzial_id]);

  const sendAllRouteBriefs = useCallback(async () => {
    const routes = (plan?.routes || []).filter(route => route?.team_id && (route.stops || []).length);
    if (!routes.length) {
      setError('Brak tras z ekipami do wyslania.');
      return;
    }
    setDispatchBriefSendingAll(true);
    setError('');
    setSuccess('');
    const token = getStoredToken();
    let sentTeams = 0;
    let sentRecipients = 0;
    const failed = [];
    for (const route of routes) {
      const teamKey = routeBriefKey(route);
      setDispatchBriefSending(teamKey);
      try {
        const brief = formatRouteBrief(route, date);
        const taskIds = (route.stops || [])
          .map(stop => Number(stop.task_id))
          .filter(id => Number.isInteger(id) && id > 0);
        const res = await api.post('/dispatch/route-brief/send', {
          date,
          oddzial_id: user?.oddzial_id,
          team_id: route.team_id,
          team_name: route.team_name,
          task_ids: taskIds,
          brief,
        }, { headers: authHeaders(token) });
        const status = routeBriefStatusFromResponse(route, res.data);
        setRouteBriefStatuses(prev => ({ ...prev, [teamKey]: status }));
        setDispatchBriefSent(teamKey);
        sentTeams += 1;
        sentRecipients += status.sent_to;
      } catch (e) {
        failed.push(route.team_name || `Ekipa #${route.team_id}`);
      }
    }
    setDispatchBriefSending('');
    setDispatchBriefSendingAll(false);
    if (failed.length) {
      setError(`Nie wyslano odpraw: ${failed.join(', ')}.`);
    }
    if (sentTeams > 0) {
      setSuccess(`Wyslano odprawy: ${sentTeams}/${routes.length} ekip, ${sentRecipients} odbiorcow. Czekamy na potwierdzenia.`);
    }
  }, [date, plan?.routes, user?.oddzial_id]);

  const refreshRouteBriefStatuses = useCallback(async ({ quiet = false } = {}) => {
    const routes = (plan?.routes || []).filter(route => route?.team_id);
    if (!routes.length) return false;
    setDispatchBriefStatusLoading(true);
    if (!quiet) {
      setDispatchBriefStatusError('');
      setError('');
    }
    try {
      const token = getStoredToken();
      const teamIds = routes.map(route => route.team_id).join(',');
      const res = await api.get('/dispatch/route-brief/status', {
        params: { date, oddzial_id: user?.oddzial_id, team_ids: teamIds },
        headers: authHeaders(token),
      });
      const statuses = routeBriefStatusesFromItems(routes, res.data?.items || []);
      setRouteBriefStatuses(prev => (quiet ? { ...prev, ...statuses } : statuses));
      setDispatchBriefStatusCheckedAt(new Date().toISOString());
      return true;
    } catch (e) {
      if (!quiet) {
        setDispatchBriefStatusError(e.response?.data?.error || e.message);
      }
      return false;
    } finally {
      setDispatchBriefStatusLoading(false);
    }
  }, [date, plan?.routes, user?.oddzial_id]);

  const remindRouteBriefPending = useCallback(async (route) => {
    const teamKey = routeBriefKey(route);
    const routeStatus = routeBriefStatuses[teamKey];
    const pendingRecipients = routeBriefPendingRecipients(routeStatus);
    if (!routeStatus?.brief_id) {
      setError('Brak wyslanej odprawy dla tej ekipy.');
      return;
    }
    if (!pendingRecipients.length) {
      setSuccess(`Wszyscy odbiorcy potwierdzili odprawe: ${route.team_name || `Ekipa #${route.team_id}`}.`);
      return;
    }
    setDispatchBriefReminding(teamKey);
    setError('');
    setSuccess('');
    try {
      const token = getStoredToken();
      const res = await api.post(
        `/dispatch/route-brief/${routeStatus.brief_id}/remind`,
        {},
        { headers: authHeaders(token) }
      );
      const reminded = Number(res.data?.reminded ?? pendingRecipients.length);
      setSuccess(`${res.data?.message || 'Przypomnienie wyslane'}: ${route.team_name || `Ekipa #${route.team_id}`} (${reminded})`);
      await refreshRouteBriefStatuses({ quiet: true });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setDispatchBriefReminding('');
    }
  }, [refreshRouteBriefStatuses, routeBriefStatuses]);

  const remindAllRouteBriefPending = useCallback(async () => {
    const routes = (plan?.routes || [])
      .filter(route => route?.team_id && (route.stops || []).length)
      .filter((route) => {
        const status = routeBriefStatuses[routeBriefKey(route)];
        return status?.brief_id && routeBriefPendingRecipients(status).length > 0;
      });

    if (!routes.length) {
      setSuccess('Nie ma oczekujacych odbiorcow odpraw.');
      return;
    }

    setDispatchBriefRemindingAll(true);
    setError('');
    setSuccess('');
    const token = getStoredToken();
    let remindedTeams = 0;
    let remindedRecipients = 0;
    const failed = [];

    try {
      for (const route of routes) {
        const teamKey = routeBriefKey(route);
        const routeStatus = routeBriefStatuses[teamKey];
        const pendingRecipients = routeBriefPendingRecipients(routeStatus);
        setDispatchBriefReminding(teamKey);
        try {
          const res = await api.post(
            `/dispatch/route-brief/${routeStatus.brief_id}/remind`,
            {},
            { headers: authHeaders(token) }
          );
          remindedTeams += 1;
          remindedRecipients += Number(res.data?.reminded ?? pendingRecipients.length);
        } catch (e) {
          failed.push(route.team_name || `Ekipa #${route.team_id}`);
        }
      }

      await refreshRouteBriefStatuses({ quiet: true });
    } finally {
      setDispatchBriefReminding('');
      setDispatchBriefRemindingAll(false);
    }

    if (failed.length) {
      setError(`Nie wyslano przypomnien: ${failed.join(', ')}.`);
    }
    if (remindedTeams > 0) {
      setSuccess(`Przypomnienia wyslane: ${remindedTeams}/${routes.length} ekip, ${remindedRecipients} odbiorcow.`);
    }
  }, [plan?.routes, refreshRouteBriefStatuses, routeBriefStatuses]);

  useEffect(() => {
    if (!plan?.routes?.length) return undefined;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refreshRouteBriefStatuses({ quiet: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [plan?.routes, refreshRouteBriefStatuses]);

  const selectRiskFilter = useCallback((filterKey) => {
    setRiskFilter(filterKey);
    setRiskIssueFilter('');
  }, []);

  const toggleRiskIssueFilter = useCallback((label) => {
    setRiskIssueFilter(current => (current === label ? '' : label));
  }, []);

  const openRiskTask = useCallback((task) => {
    const path = taskPath(task);
    if (path) navigate(path);
  }, [navigate]);

  const repairRiskTask = useCallback((task) => {
    const path = taskRepairPath(task, autoDispatchReturnPath(date));
    if (path) navigate(path);
  }, [date, navigate]);

  const riskTasks = advisor?.top_tasks || EMPTY_TASKS;
  const riskStats = useMemo(() => {
    const critical = riskTasks.filter(taskHasCriticalIssue).length;
    const warning = riskTasks.filter(taskHasWarningOnly).length;
    return { all: riskTasks.length, critical, warning };
  }, [riskTasks]);

  const severityFilteredRiskTasks = useMemo(() => {
    if (riskFilter === 'critical') return riskTasks.filter(taskHasCriticalIssue);
    if (riskFilter === 'warning') return riskTasks.filter(taskHasWarningOnly);
    return riskTasks;
  }, [riskFilter, riskTasks]);

  const issueSummary = useMemo(() => summarizeTaskIssues(severityFilteredRiskTasks), [severityFilteredRiskTasks]);

  const filteredRiskTasks = useMemo(() => {
    if (!riskIssueFilter) return severityFilteredRiskTasks;
    return severityFilteredRiskTasks.filter(task => taskHasIssueLabel(task, riskIssueFilter));
  }, [riskIssueFilter, severityFilteredRiskTasks]);

  const nextDispatchAction = useMemo(
    () => buildNextDispatchAction(advisor, riskTasks),
    [advisor, riskTasks]
  );

  const handleNextDispatchAction = useCallback(() => {
    if (!nextDispatchAction) return;
    if (nextDispatchAction.kind === 'task') {
      repairRiskTask(nextDispatchAction.task);
      return;
    }
    if (nextDispatchAction.kind === 'ready') {
      runSolver(false);
      return;
    }
    if (nextDispatchAction.kind === 'blocked_summary') {
      loadAdvisor();
    }
  }, [loadAdvisor, nextDispatchAction, repairRiskTask, runSolver]);

  const stats = plan?.stats;
  const dispatchableRoutes = (plan?.routes || []).filter(route => route?.team_id && (route.stops || []).length);
  const sentRoutesCount = dispatchableRoutes.filter(route => routeBriefStatuses[routeBriefKey(route)]?.sent_to).length;
  const pendingRouteBriefRoutes = dispatchableRoutes.filter((route) => {
    const status = routeBriefStatuses[routeBriefKey(route)];
    return status?.brief_id && routeBriefPendingRecipients(status).length > 0;
  });
  const pendingRouteBriefRecipients = pendingRouteBriefRoutes.reduce((sum, route) => {
    const status = routeBriefStatuses[routeBriefKey(route)];
    return sum + routeBriefPendingRecipients(status).length;
  }, 0);
  const workflowSteps = useMemo(() => {
    const advisorLoaded = Boolean(advisor);
    const blocked = Number(preflightHold?.blocked ?? advisor?.metrics?.blocked ?? 0);
    const warnings = Number(advisor?.metrics?.warnings ?? preflightHold?.warnings ?? 0);
    const hasPlan = Boolean(plan);
    const hasSavedPlan = Boolean(savedPlanId);
    const assigned = Number(stats?.tasks_assigned ?? 0);
    const total = Number(stats?.tasks_total ?? 0);

    return [
      {
        key: 'brief',
        label: 'Odprawa AI',
        detail: advisorLoaded ? 'Gotowa' : 'Uruchom AI Dyspozytora',
        status: advisorLoaded ? 'done' : 'active',
      },
      {
        key: 'quality',
        label: 'Blokady danych',
        detail: advisorLoaded || preflightHold
          ? (blocked > 0 ? `${blocked} do naprawy` : (warnings > 0 ? `${warnings} uwag do kontroli` : 'Brak krytycznych'))
          : 'Czeka na odprawe',
        status: blocked > 0 ? 'blocked' : (advisorLoaded ? 'done' : 'pending'),
      },
      {
        key: 'solver',
        label: 'Podglad solvera',
        detail: hasPlan ? `${assigned} / ${total || assigned} przypisane` : (advisorLoaded && blocked === 0 ? 'Gotowy do generowania' : 'Po naprawach'),
        status: hasPlan ? 'done' : (advisorLoaded && blocked === 0 ? 'active' : 'pending'),
      },
      {
        key: 'release',
        label: 'Zapis i zastosowanie',
        detail: planApplied ? 'Zastosowany' : (hasSavedPlan ? 'Gotowy do zastosowania' : (hasPlan ? 'Zapisz, gdy plan pasuje' : 'Po podgladzie')),
        status: planApplied ? 'done' : (hasSavedPlan || hasPlan ? 'active' : 'pending'),
      },
    ];
  }, [advisor, plan, planApplied, preflightHold, savedPlanId, stats]);

  const availability = plan?.team_availability || null;
  const absentTeams = Array.isArray(availability?.absent) ? availability.absent : [];
  const availabilityTotal = Number(availability?.total ?? 0);
  const availabilityAvailable = Number(availability?.available ?? Math.max(0, availabilityTotal - absentTeams.length));

  return (
    <div className="app-shell autodispatch-shell" style={s.shell}>
      <Sidebar />
      <main className="app-main autodispatch-main" style={s.main}>
        {/* Header */}
        <div className="autodispatch-topbar" style={s.topbar}>
          <div>
            <h1 style={s.title}>{t('autoDispatch.title')}</h1>
            <p style={s.sub}>{t('autoDispatch.subtitle')}</p>
          </div>
          <button type="button" onClick={() => navigate('/kierownik')} style={s.backBtn}>Powrot</button>
        </div>

        {/* Controls */}
        <div className="autodispatch-controls" style={s.controls}>
          <div style={s.controlGroup}>
            <label style={s.label}>{t('autoDispatch.datePicker')}</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setAdvisor(null); setAdvisorError(''); setPreflightHold(null); setPlan(null); setSavedPlanId(null); setPlanApplied(false); setBriefCopied(false); setBriefCopyText(''); setDispatchBriefCopied(''); setDispatchBriefText(''); setDispatchBriefSending(''); setDispatchBriefReminding(''); setDispatchBriefSendingAll(false); setDispatchBriefSent(''); setRouteBriefStatuses({}); setRiskFilter('all'); setRiskIssueFilter(''); }}
              style={s.dateInput}
            />
          </div>
          <div style={s.btnRow}>
            <button type="button" onClick={() => runSolver(false)} disabled={loading} style={s.previewBtn}>
              {loading ? t('autoDispatch.btnPreviewLoading') : t('autoDispatch.btnPreview')}
            </button>
            <button type="button" onClick={loadAdvisor} disabled={advisorLoading} style={s.aiBtn}>
              {advisorLoading ? 'Analizuje...' : 'AI Dyspozytor'}
            </button>
            <button type="button" onClick={() => runSolver(true)} disabled={loading} style={s.saveBtn}>
              {loading ? 'Zapisywanie...' : t('autoDispatch.btnSave')}
            </button>
            {savedPlanId && (
              <button type="button" onClick={applyPlan} disabled={applying} style={s.applyBtn}>
                {applying ? t('autoDispatch.btnApplying') : t('autoDispatch.btnApply')}
              </button>
            )}
          </div>
        </div>

        <section className="autodispatch-workflow" style={s.workflowStrip} aria-label="Postep dyspozycji dnia">
          {workflowSteps.map((step, idx) => (
            <div
              key={step.key}
              style={{
                ...s.workflowStep,
                ...(step.status === 'done'
                  ? s.workflowStepDone
                  : step.status === 'blocked'
                    ? s.workflowStepBlocked
                    : step.status === 'active'
                      ? s.workflowStepActive
                      : s.workflowStepPending),
              }}
            >
              <span
                style={{
                  ...s.workflowStepIndex,
                  ...(step.status === 'done'
                    ? s.workflowStepIndexDone
                    : step.status === 'blocked'
                      ? s.workflowStepIndexBlocked
                      : step.status === 'active'
                        ? s.workflowStepIndexActive
                        : s.workflowStepIndexPending),
                }}
              >
                {idx + 1}
              </span>
              <span style={s.workflowStepText}>
                <strong>{step.label}</strong>
                <span style={s.workflowStepDetail}>{step.detail}</span>
              </span>
            </div>
          ))}
        </section>

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
              {preflightHold.summary ? <span>{preflightHold.summary}</span> : null}
            </div>
            <div style={s.preflightActions}>
              <button
                type="button"
                onClick={runDispatchPreflight}
                disabled={loading || preflightApplying}
                style={s.preflightFixBtn}
              >
                {preflightApplying ? 'Naprawiam...' : 'Uruchom preflight'}
              </button>
              <button
                type="button"
                onClick={() => runSolver(true, { skipPreflight: true })}
                disabled={loading || preflightApplying}
                style={s.preflightBypassBtn}
              >
                Zapisz mimo blokad
              </button>
            </div>
          </div>
        )}

        {advisor && (
          <section className="autodispatch-advisor-panel" style={s.advisorPanel}>
            <div style={s.advisorHeader}>
              <div>
                <div style={s.advisorEyebrow}>AI Dyspozytor</div>
                <h2 style={s.advisorTitle}>{advisor.summary || 'Kontrola jakosci planu dnia'}</h2>
              </div>
              <div style={s.advisorActions}>
                <button type="button" onClick={copyAdvisorBrief} style={s.copyBriefBtn}>
                  {briefCopied ? 'Skopiowano' : 'Kopiuj odprawe'}
                </button>
                <span style={s.advisorSource}>
                  {advisor.source === 'ai' ? (advisor.provider || 'AI') : 'Reguly'}
                </span>
              </div>
            </div>

            {briefCopyText && (
              <textarea
                aria-label="Pakiet odprawy do recznego skopiowania"
                value={briefCopyText}
                readOnly
                autoFocus
                onFocus={e => e.target.select()}
                style={s.manualBrief}
              />
            )}

            <div className="autodispatch-metrics" style={s.advisorMetrics}>
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

            {nextDispatchAction && (
              <div
                style={{
                  ...s.dispatchGate,
                  ...(nextDispatchAction.tone === 'bad'
                    ? s.dispatchGateBad
                    : nextDispatchAction.tone === 'warn'
                      ? s.dispatchGateWarn
                      : s.dispatchGateReady),
                }}
              >
                <div style={s.dispatchGateText}>
                  <span style={s.dispatchGateEyebrow}>{nextDispatchAction.eyebrow}</span>
                  <strong style={s.dispatchGateTitle}>{nextDispatchAction.title}</strong>
                  <span style={s.dispatchGateDetail}>{nextDispatchAction.detail}</span>
                </div>
                {nextDispatchAction.button && (
                  <button
                    type="button"
                    onClick={handleNextDispatchAction}
                    disabled={
                      loading
                      || advisorLoading
                      || (nextDispatchAction.kind === 'task' && !nextDispatchAction.task?.task_id)
                    }
                    style={{
                      ...s.dispatchGateBtn,
                      ...(nextDispatchAction.tone === 'bad'
                        ? s.dispatchGateBtnBad
                        : nextDispatchAction.tone === 'warn'
                          ? s.dispatchGateBtnWarn
                          : s.dispatchGateBtnReady),
                    }}
                  >
                    {loading && nextDispatchAction.kind === 'ready'
                      ? 'Generuje...'
                      : advisorLoading && nextDispatchAction.kind === 'blocked_summary'
                        ? 'Odswieza...'
                        : nextDispatchAction.button}
                  </button>
                )}
              </div>
            )}

            <div className="autodispatch-advisor-grid" style={s.advisorGrid}>
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
                <div style={s.sectionTitleRow}>
                  <h3 style={s.sectionTitle}>Ryzykowne zlecenia</h3>
                  {riskStats.all > 0 && (
                    <div style={s.riskFilters}>
                      {RISK_FILTERS.map(filter => (
                        <button
                          key={filter.key}
                          type="button"
                          aria-pressed={riskFilter === filter.key}
                          onClick={() => selectRiskFilter(filter.key)}
                          style={riskFilter === filter.key ? { ...s.riskFilterBtn, ...s.riskFilterBtnActive } : s.riskFilterBtn}
                        >
                          {filter.label} {riskStats[filter.key]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {issueSummary.length > 0 && (
                  <div style={s.issueSummary} aria-label="Najczestsze braki">
                    <span style={s.issueSummaryLabel}>Braki</span>
                    {issueSummary.map(issue => (
                      <button
                        key={issue.label}
                        type="button"
                        aria-pressed={riskIssueFilter === issue.label}
                        onClick={() => toggleRiskIssueFilter(issue.label)}
                        style={
                          riskIssueFilter === issue.label
                            ? { ...s.issueChip, ...(issue.critical ? s.issueChipCritical : s.issueChipWarn), ...s.issueChipActive }
                            : { ...s.issueChip, ...(issue.critical ? s.issueChipCritical : s.issueChipWarn) }
                        }
                      >
                        {issue.label} {issue.count}
                      </button>
                    ))}
                    {riskIssueFilter && (
                      <button type="button" onClick={() => setRiskIssueFilter('')} style={s.issueClearBtn}>
                        Wyczysc brak
                      </button>
                    )}
                  </div>
                )}
                {riskStats.all === 0 && (
                  <div style={s.advisorEmpty}>Brak otwartych zlecen do analizy.</div>
                )}
                {riskStats.all > 0 && filteredRiskTasks.length === 0 && (
                  <div style={s.advisorEmpty}>Brak zlecen w tym filtrze.</div>
                )}
                {filteredRiskTasks.map(task => (
                  <div key={task.task_id} style={s.riskTask}>
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
                        {taskIssueBadge(task.issues || [])}
                      </span>
                      <span style={s.riskTaskActions}>
                        <button
                          type="button"
                          onClick={() => openRiskTask(task)}
                          disabled={!task.task_id}
                          aria-label={`Otworz zlecenie ${task.task_numer || task.task_id || ''}`.trim()}
                          style={s.openTaskCta}
                        >
                          Otworz zlecenie
                        </button>
                        <button
                          type="button"
                          onClick={() => repairRiskTask(task)}
                          disabled={!task.task_id}
                          aria-label={`Napraw w zleceniu ${task.task_numer || task.task_id || ''}`.trim()}
                          style={s.repairTaskBtn}
                        >
                          Napraw w zleceniu
                        </button>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Stats bar */}
        {stats && (
          <div className="autodispatch-statsbar" style={s.statsBar}>
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

        {availability && (
          <section className="autodispatch-availability-panel" style={absentTeams.length ? { ...s.availabilityPanel, ...s.availabilityPanelWarn } : s.availabilityPanel}>
            <div style={s.availabilityHeader}>
              <div style={s.availabilityTitleWrap}>
                <span style={s.availabilityEyebrow}>Gotowosc ekip</span>
                <strong style={s.availabilityTitle}>
                  {absentTeams.length ? `Nieobecne ekipy: ${absentTeams.length}` : 'Wszystkie ekipy dostepne'}
                </strong>
              </div>
              <span style={absentTeams.length ? { ...s.availabilityCounter, ...s.availabilityCounterWarn } : s.availabilityCounter}>
                {availabilityAvailable}/{availabilityTotal || availabilityAvailable} dostepne
              </span>
            </div>
            {absentTeams.length ? (
              <div style={s.absentTeamList}>
                {absentTeams.map(team => (
                  <div key={`${team.team_id || team.team_name}`} style={s.absentTeamItem}>
                    <strong>{team.team_name || `Ekipa #${team.team_id}`}</strong>
                    <span>{team.note || 'Oznaczona jako nieobecna na ten dzien.'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={s.availabilityNote}>Solver moze korzystac ze wszystkich aktywnych ekip dla wybranego dnia.</p>
            )}
          </section>
        )}

        {plan && (
          <section className="autodispatch-handoff-panel" style={planApplied ? { ...s.handoffPanel, ...s.handoffPanelReady } : s.handoffPanel}>
            <div style={s.handoffHeader}>
              <div style={s.handoffTitleWrap}>
                <span style={s.handoffEyebrow}>Odprawy dla ekip</span>
                <strong style={s.handoffTitle}>
                  {planApplied ? 'Plan gotowy do wyslania ekipom.' : 'Skopiuj plan dnia albo odprawe konkretnej ekipy.'}
                </strong>
                <span style={s.handoffDetail}>
                  {(plan.routes || []).length} ekip · {stats?.tasks_assigned ?? 0}/{stats?.tasks_total ?? 0} zlecen · {stats?.coverage_pct ?? 0}% pokrycia
                </span>
                {dispatchBriefStatusCheckedAt && (
                  <span style={s.handoffStatusMeta}>
                    Status odbioru: {new Date(dispatchBriefStatusCheckedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {dispatchBriefStatusError && (
                  <span style={s.handoffStatusError}>{dispatchBriefStatusError}</span>
                )}
              </div>
              <div style={s.handoffActions}>
                <button type="button" onClick={copyDayBrief} style={s.copyDayBriefBtn}>
                  {dispatchBriefCopied === 'day' ? 'Skopiowano plan dnia' : 'Kopiuj plan dnia'}
                </button>
                <button
                  type="button"
                  onClick={() => refreshRouteBriefStatuses()}
                  disabled={dispatchBriefStatusLoading || dispatchBriefRemindingAll || dispatchBriefSendingAll || dispatchableRoutes.length === 0}
                  style={{
                    ...s.refreshBriefStatusBtn,
                    ...((dispatchBriefStatusLoading || dispatchBriefRemindingAll || dispatchBriefSendingAll || dispatchableRoutes.length === 0) ? s.routeBriefBtnDisabled : {}),
                  }}
                >
                  {dispatchBriefStatusLoading ? 'Odswiezam...' : 'Odswiez odbior'}
                </button>
                <button
                  type="button"
                  onClick={remindAllRouteBriefPending}
                  disabled={dispatchBriefRemindingAll || dispatchBriefSendingAll || pendingRouteBriefRoutes.length === 0}
                  aria-label={`Przypomnij wszystkim oczekujacym (${pendingRouteBriefRecipients})`}
                  style={{
                    ...s.remindAllBriefBtn,
                    ...((dispatchBriefRemindingAll || dispatchBriefSendingAll || pendingRouteBriefRoutes.length === 0) ? s.routeBriefBtnDisabled : {}),
                  }}
                >
                  {dispatchBriefRemindingAll
                    ? 'Przypominam...'
                    : pendingRouteBriefRecipients > 0
                      ? `Przypomnij wszystkim (${pendingRouteBriefRecipients})`
                      : 'Brak oczekujacych'}
                </button>
                <button
                  type="button"
                  onClick={sendAllRouteBriefs}
                  disabled={dispatchBriefSendingAll || dispatchBriefRemindingAll || dispatchableRoutes.length === 0}
                  style={{
                    ...s.sendAllBriefBtn,
                    ...((dispatchBriefSendingAll || dispatchBriefRemindingAll || dispatchableRoutes.length === 0) ? s.routeBriefBtnDisabled : {}),
                  }}
                >
                  {dispatchBriefSendingAll
                    ? 'Wysylanie odpraw...'
                    : sentRoutesCount === dispatchableRoutes.length && dispatchableRoutes.length > 0
                      ? 'Odprawy wyslane'
                      : 'Wyslij odprawy do ekip'}
                </button>
              </div>
            </div>
            {dispatchBriefText && (
              <textarea
                aria-label="Pakiet odpraw dla ekip do recznego skopiowania"
                value={dispatchBriefText}
                readOnly
                autoFocus
                onFocus={e => e.target.select()}
                style={s.manualDispatchBrief}
              />
            )}
          </section>
        )}

        {plan && (
          <div className="autodispatch-content" style={s.content}>
            {/* Routes */}
            <div style={s.routesCol}>
              <h2 style={s.sectionTitle}>{t('autoDispatch.routes')} ({plan.routes?.length ?? 0})</h2>
              {(plan.routes || []).map((route, ri) => {
                const color = TEAM_COLORS[ri % TEAM_COLORS.length];
                const open = expandedTeam === route.team_id;
                const routeKey = routeBriefKey(route);
                const routeStatus = routeBriefStatuses[routeKey];
                const sendingRoute = dispatchBriefSending === routeKey;
                const remindingRoute = dispatchBriefReminding === routeKey;
                const pendingRecipients = routeBriefPendingRecipients(routeStatus);
                const sendDisabled = dispatchBriefSendingAll || dispatchBriefRemindingAll || sendingRoute || !route.team_id || !(route.stops || []).length;
                const remindDisabled = remindingRoute || dispatchBriefRemindingAll || dispatchBriefSendingAll || sendingRoute || !routeStatus?.brief_id || pendingRecipients.length === 0;
                return (
                  <div key={route.team_id} style={{ ...s.routeCard, borderLeft: `4px solid ${color}` }}>
                    <div style={s.routeHeaderRow}>
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
                      <div style={s.routeBriefActions}>
                        {routeStatus && (
                          <span
                            style={{
                              ...s.routeBriefStatus,
                              ...(Number(routeStatus.pending || 0) <= 0 ? s.routeBriefStatusDone : {}),
                            }}
                          >
                            {routeBriefStatusText(routeStatus)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => copyRouteBrief(route)}
                          aria-label={`Kopiuj odprawe ekipy ${route.team_name || route.team_id || ''}`.trim()}
                          style={s.routeBriefBtn}
                        >
                          {dispatchBriefCopied === routeKey
                            ? 'Skopiowano'
                            : 'Kopiuj odprawe ekipy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => sendRouteBrief(route)}
                          disabled={sendDisabled}
                          aria-label={`Wyslij odprawe ekipy ${route.team_name || route.team_id || ''}`.trim()}
                          style={{
                            ...s.routeBriefBtn,
                            ...s.routeSendBtn,
                            ...(sendDisabled ? s.routeBriefBtnDisabled : {}),
                          }}
                        >
                          {sendingRoute
                            ? 'Wysylanie...'
                            : dispatchBriefSent === routeKey
                              ? 'Wyslano'
                              : 'Wyslij odprawe'}
                        </button>
                      </div>
                    </div>
                    {routeStatus?.recipients?.length > 0 && (
                      <div style={s.routeReceiptPanel}>
                        <div style={s.routeReceiptHeader}>
                          <span style={s.routeReceiptTitle}>Odbiorcy odprawy</span>
                          {routeStatus.brief_id && pendingRecipients.length > 0 && (
                            <button
                              type="button"
                              onClick={() => remindRouteBriefPending(route)}
                              disabled={remindDisabled}
                              aria-label={`Przypomnij oczekujacym ${route.team_name || route.team_id || ''}`.trim()}
                              style={{
                                ...s.routeReminderBtn,
                                ...(remindDisabled ? s.routeBriefBtnDisabled : {}),
                              }}
                            >
                              {remindingRoute ? 'Przypomina...' : 'Przypomnij oczekujacym'}
                            </button>
                          )}
                        </div>
                        <div style={s.routeReceiptList}>
                          {routeStatus.recipients.map((recipient, index) => {
                            const confirmed = routeBriefRecipientConfirmed(recipient);
                            const key =
                              recipient.notification_id ||
                              recipient.user_id ||
                              `${routeBriefRecipientName(recipient)}-${index}`;
                            return (
                              <span
                                key={key}
                                style={{
                                  ...s.routeReceiptItem,
                                  ...(confirmed ? s.routeReceiptItemDone : {}),
                                }}
                              >
                                <span style={confirmed ? s.routeReceiptDotDone : s.routeReceiptDot} />
                                <span style={s.routeReceiptName}>{routeBriefRecipientName(recipient)}</span>
                                <span style={s.routeReceiptState}>{confirmed ? 'Potwierdzono' : 'Czeka'}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {open && (
                      <div style={s.stopList}>
                        {route.stops.map((stop, si) => (
                          <DispatchStopRow key={stop.task_id} stop={stop} index={si} t={t} />
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
            <div style={s.emptyIcon}>Mapa</div>
            <p>{t('autoDispatch.emptyHint')}</p>
          </div>
        )}
      </main>
    </div>
  );
}

function DispatchStopRow({ stop, index, t }) {
  const stopWarnings = dispatchStopWarnings(stop);
  const client = stopClientName(stop);
  const phone = stopClientPhone(stop);

  return (
    <div style={s.stopRow}>
      <span style={s.stopNum}>{index + 1}</span>
      <div style={s.stopBody}>
        <div style={s.stopTitle}>
          <strong>{stop.task_numer}</strong>
          {!stop.time_window_ok && (
            <span style={s.lateBadge}>! {t('autoDispatch.timeWindowWarn')}</span>
          )}
        </div>
        <div style={s.stopMeta}>{client ? `${client} | ` : ''}{stop.adres}</div>
        {phone && <div style={s.stopContact}>Tel. {phone}</div>}
        <div style={s.stopTimes}>
          {t('autoDispatch.eta')}: <strong>{stop.eta}</strong>
          {stop.okno_od && ` | ${t('autoDispatch.window')}: ${stop.okno_od}-${stop.okno_do || '?'}`}
          {` | ${t('autoDispatch.drive')}: ${stop.travel_min}m | ${t('autoDispatch.service')}: ${stop.service_min}m`}
        </div>
        {stopWarnings.length > 0 && (
          <div style={s.stopWarnings}>
            {stopWarnings.map(item => (
              <span key={`${stop.task_id}-${item.key}`} style={s.stopWarningPill}>{item.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  shell:    {
    display: 'flex',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f6faf7 0%, #ffffff 46%, #eaf4ee 100%)',
  },
  main:     {
    flex: 1,
    padding: '22px clamp(16px, 2.4vw, 30px) 32px',
    overflowX: 'hidden',
    minWidth: 0,
    maxWidth: 1560,
    width: '100%',
    margin: '0 auto',
  },
  topbar:   {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
    padding: '18px 20px',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 8,
    background:
      'linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(135deg, #07301f 0%, #0f5f3a 58%, #168a4a 100%)',
    backgroundSize: '32px 32px, 32px 32px, auto',
    boxShadow: '0 22px 46px rgba(11,56,37,0.17)',
  },
  title:    { fontSize: 26, fontWeight: 950, color: '#ffffff', margin: 0, lineHeight: 1.08 },
  sub:      { fontSize: 13, color: 'rgba(255,255,255,0.78)', marginTop: 5, fontWeight: 700 },
  backBtn:  { padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.28)', background: '#ffffff', color: '#0F5F3A', cursor: 'pointer', fontSize: 13, fontWeight: 900, boxShadow: '0 14px 28px rgba(0,0,0,0.12)' },
  controls: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    marginBottom: 14,
    padding: '14px 16px',
    background:
      'linear-gradient(90deg, rgba(15,107,63,0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(15,107,63,0.035) 1px, transparent 1px), linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,249,244,0.94))',
    backgroundSize: '32px 32px, 32px 32px, auto',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.14)',
    boxShadow: '0 12px 30px rgba(31,79,50,0.07)',
  },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label:    { fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase' },
  dateInput:{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14 },
  btnRow:   { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  previewBtn:{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.16)', background: '#ffffff', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 800 },
  aiBtn:    { padding: '10px 18px', borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  saveBtn:  { padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  applyBtn: { padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  workflowStrip:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.13)', background: '#ffffff', boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  workflowStep:{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, padding: '7px 8px', borderRadius: 7, border: '1px solid transparent' },
  workflowStepDone:{ background: '#f0fdf4', borderColor: '#bbf7d0' },
  workflowStepActive:{ background: '#eff6ff', borderColor: '#bfdbfe' },
  workflowStepBlocked:{ background: '#fff1f2', borderColor: '#fecaca' },
  workflowStepPending:{ background: '#f8fafc', borderColor: '#e2e8f0' },
  workflowStepIndex:{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 },
  workflowStepIndexDone:{ background: '#16a34a', color: '#fff' },
  workflowStepIndexActive:{ background: '#2563eb', color: '#fff' },
  workflowStepIndexBlocked:{ background: '#dc2626', color: '#fff' },
  workflowStepIndexPending:{ background: '#e2e8f0', color: '#64748b' },
  workflowStepText:{ minWidth: 0, display: 'grid', gap: 1, color: 'var(--text)', fontSize: 12, lineHeight: 1.25 },
  workflowStepDetail:{ color: 'var(--text-sub)', overflowWrap: 'anywhere' },
  errorBox: { padding: '12px 16px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', marginBottom: 16, fontSize: 14 },
  successBox:{ padding: '12px 16px', borderRadius: 8, background: '#dcfce7', color: '#16a34a', marginBottom: 16, fontSize: 14, fontWeight: 600 },
  preflightBox:{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', marginBottom: 16 },
  preflightText:{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, lineHeight: 1.4 },
  preflightActions:{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  preflightFixBtn:{ flexShrink: 0, padding: '8px 12px', borderRadius: 7, border: '1px solid #16a34a', background: '#ecfdf5', color: '#047857', cursor: 'pointer', fontSize: 12, fontWeight: 900 },
  preflightBypassBtn:{ flexShrink: 0, padding: '8px 12px', borderRadius: 7, border: '1px solid #f97316', background: '#fff', color: '#c2410c', cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  advisorPanel:{ marginBottom: 18, padding: '16px 18px', background: '#ffffff', borderRadius: 8, border: '1px solid rgba(15,95,58,0.13)', boxShadow: '0 12px 30px rgba(31,79,50,0.07)' },
  advisorHeader:{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 14 },
  advisorEyebrow:{ fontSize: 11, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0 },
  advisorTitle:{ margin: '3px 0 0', fontSize: 17, lineHeight: 1.35, color: 'var(--text)' },
  advisorActions:{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
  copyBriefBtn:{ padding: '6px 9px', borderRadius: 7, border: '1px solid #2563eb', background: '#fff', color: '#1d4ed8', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  advisorSource:{ flexShrink: 0, padding: '4px 8px', borderRadius: 6, background: 'var(--surface-field)', border: '1px solid var(--border)', color: 'var(--text-sub)', fontSize: 11, fontWeight: 700 },
  manualBrief:{ width: '100%', minHeight: 130, boxSizing: 'border-box', resize: 'vertical', padding: 10, borderRadius: 8, border: '1px solid #f97316', background: '#fff7ed', color: '#7c2d12', fontSize: 12, lineHeight: 1.45, marginBottom: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  advisorMetrics:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 14 },
  dispatchGate:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '11px 12px', marginBottom: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)' },
  dispatchGateBad:{ borderColor: '#fecaca', background: '#fff1f2' },
  dispatchGateWarn:{ borderColor: '#fde68a', background: '#fffbeb' },
  dispatchGateReady:{ borderColor: '#bbf7d0', background: '#f0fdf4' },
  dispatchGateText:{ display: 'grid', gap: 2, minWidth: 0, flex: '1 1 260px' },
  dispatchGateEyebrow:{ color: 'var(--text-sub)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  dispatchGateTitle:{ color: 'var(--text)', fontSize: 13, lineHeight: 1.3 },
  dispatchGateDetail:{ color: 'var(--text-sub)', fontSize: 12, lineHeight: 1.4 },
  dispatchGateBtn:{ flexShrink: 0, padding: '7px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 900 },
  dispatchGateBtnBad:{ border: '1px solid #dc2626', background: '#fff', color: '#b91c1c' },
  dispatchGateBtnWarn:{ border: '1px solid #d97706', background: '#fff', color: '#92400e' },
  dispatchGateBtnReady:{ border: '1px solid #16a34a', background: '#fff', color: '#047857' },
  advisorGrid:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 18, alignItems: 'start' },
  advisorColumn:{ minWidth: 0 },
  sectionTitleRow:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  riskFilters:{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  riskFilterBtn:{ padding: '4px 7px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 10, fontWeight: 800 },
  riskFilterBtnActive:{ border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8' },
  issueSummary:{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 0 4px', borderTop: '1px solid var(--border-light, var(--border))' },
  issueSummaryLabel:{ color: 'var(--text-sub)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' },
  issueChip:{ padding: '4px 7px', borderRadius: 999, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 10, fontWeight: 850 },
  issueChipCritical:{ background: '#fff1f2', color: '#be123c' },
  issueChipWarn:{ background: '#fffbeb', color: '#92400e' },
  issueChipActive:{ border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8' },
  issueClearBtn:{ padding: '4px 7px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 10, fontWeight: 800 },
  recommendation:{ padding: '10px 0', borderTop: '1px solid var(--border-light, var(--border))' },
  recommendationTop:{ display: 'flex', alignItems: 'center', gap: 8 },
  priority:{ color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  recommendationTitle:{ color: 'var(--text)', fontSize: 13 },
  recommendationText:{ margin: '5px 0 0', color: 'var(--text-sub)', fontSize: 12, lineHeight: 1.45 },
  recommendationAction:{ marginTop: 6, color: 'var(--text)', fontSize: 12, fontWeight: 600 },
  advisorEmpty:{ padding: '12px 0', color: 'var(--text-sub)', fontSize: 13, borderTop: '1px solid var(--border-light, var(--border))' },
  riskTask:{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', background: 'none', border: 'none', borderTop: '1px solid var(--border-light, var(--border))', color: 'var(--text)', textAlign: 'left' },
  riskTaskTop:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 },
  riskTaskClient:{ fontSize: 12, color: 'var(--text-sub)' },
  riskTaskIssue:{ fontSize: 11, color: 'var(--text-muted, var(--text-sub))', lineHeight: 1.35 },
  riskTaskFooter:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  riskBadgeCritical:{ flexShrink: 0, borderRadius: 999, padding: '2px 7px', background: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 900 },
  riskBadgeWarn:{ flexShrink: 0, borderRadius: 999, padding: '2px 7px', background: '#fef9c3', color: '#a16207', fontSize: 10, fontWeight: 900 },
  riskTaskActions:{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  openTaskCta:{ padding: '4px 7px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: '#2563eb', cursor: 'pointer', fontSize: 11, fontWeight: 800 },
  repairTaskBtn:{ padding: '4px 7px', borderRadius: 7, border: '1px solid #16a34a', background: '#ecfdf5', color: '#047857', cursor: 'pointer', fontSize: 11, fontWeight: 900 },
  qualityPill:{ flexShrink: 0, minWidth: 40, textAlign: 'center', borderRadius: 6, padding: '2px 6px', background: '#f1f5f9', color: '#334155', fontSize: 11, fontWeight: 800 },
  statsBar: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 },
  statCard: { flex: 1, minWidth: 100, padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.13)', boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  statValue:{ fontSize: 22, fontWeight: 800 },
  statLabel:{ fontSize: 11, fontWeight: 600, color: 'var(--text-sub)', textTransform: 'uppercase', marginTop: 4 },
  availabilityPanel:{ marginBottom: 18, padding: '13px 14px', borderRadius: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  availabilityPanelWarn:{ borderColor: '#fdba74', background: '#fff7ed' },
  availabilityHeader:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  availabilityTitleWrap:{ display: 'grid', gap: 2, minWidth: 0 },
  availabilityEyebrow:{ color: 'var(--text-sub)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  availabilityTitle:{ color: 'var(--text)', fontSize: 14, lineHeight: 1.25 },
  availabilityCounter:{ flexShrink: 0, padding: '5px 9px', borderRadius: 8, border: '1px solid #86efac', background: '#fff', color: '#047857', fontSize: 12, fontWeight: 900 },
  availabilityCounterWarn:{ borderColor: '#fdba74', color: '#c2410c' },
  availabilityNote:{ margin: '8px 0 0', color: 'var(--text-sub)', fontSize: 12 },
  absentTeamList:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8, marginTop: 10 },
  absentTeamItem:{ display: 'grid', gap: 3, padding: '9px 10px', borderRadius: 8, border: '1px solid #fed7aa', background: '#fff', color: '#7c2d12', fontSize: 12 },
  handoffPanel:{ marginBottom: 18, padding: '13px 14px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.13)', background: '#ffffff', boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  handoffPanelReady:{ borderColor: '#86efac', background: '#f0fdf4' },
  handoffHeader:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  handoffTitleWrap:{ display: 'grid', gap: 2, minWidth: 0 },
  handoffEyebrow:{ color: 'var(--text-sub)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  handoffTitle:{ color: 'var(--text)', fontSize: 14, lineHeight: 1.25 },
  handoffDetail:{ color: 'var(--text-sub)', fontSize: 12 },
  handoffStatusMeta:{ color: '#047857', fontSize: 11, fontWeight: 850 },
  handoffStatusError:{ color: '#b91c1c', fontSize: 11, fontWeight: 850 },
  handoffActions:{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', flexShrink: 0 },
  copyDayBriefBtn:{ flexShrink: 0, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  refreshBriefStatusBtn:{ flexShrink: 0, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  remindAllBriefBtn:{ flexShrink: 0, border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  sendAllBriefBtn:{ flexShrink: 0, border: '1px solid #16a34a', background: '#ecfdf5', color: '#047857', borderRadius: 8, padding: '9px 12px', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  manualDispatchBrief:{ width: '100%', minHeight: 96, marginTop: 10, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--text)', padding: 10, fontSize: 12, lineHeight: 1.45, resize: 'vertical' },
  content:  { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' },
  routesCol:{ display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle:{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 },
  routeCard:{ background: '#ffffff', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(15,95,58,0.13)', boxShadow: '0 12px 30px rgba(31,79,50,0.07)' },
  routeHeaderRow:{ display: 'flex', alignItems: 'stretch', gap: 8, padding: '0 8px 0 0' },
  routeHeader:{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', textAlign: 'left' },
  teamDot:  { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  teamName: { flex: 1, fontSize: 15 },
  routeMeta:{ fontSize: 12, color: 'var(--text-sub)' },
  chevron:  { fontSize: 12, color: 'var(--text-sub)' },
  stopList: { borderTop: '1px solid var(--border)', padding: '8px 0' },
  routeBriefRow:{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 8px' },
  routeBriefActions:{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end', padding: '8px 0', flexShrink: 0 },
  routeBriefStatus:{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 8, padding: '6px 8px', fontSize: 11, fontWeight: 900, lineHeight: 1.2 },
  routeBriefStatusDone:{ borderColor: '#86efac', background: '#f0fdf4', color: '#047857' },
  routeBriefBtn:{ border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 850, cursor: 'pointer' },
  routeSendBtn:{ border: '1px solid #16a34a', background: '#ecfdf5', color: '#047857' },
  routeBriefBtnDisabled:{ opacity: 0.58, cursor: 'not-allowed' },
  routeReceiptPanel:{ borderTop: '1px solid var(--border-light, var(--border))', padding: '8px 12px 10px 16px', display: 'grid', gap: 7, background: 'rgba(255,255,255,0.42)' },
  routeReceiptHeader:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  routeReceiptTitle:{ color: 'var(--text-sub)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  routeReminderBtn:{ border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', borderRadius: 8, padding: '5px 8px', fontSize: 11, fontWeight: 900, cursor: 'pointer' },
  routeReceiptList:{ display: 'flex', flexWrap: 'wrap', gap: 7 },
  routeReceiptItem:{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 8, padding: '5px 7px', fontSize: 11, fontWeight: 850, lineHeight: 1.2 },
  routeReceiptItemDone:{ borderColor: '#86efac', background: '#f0fdf4', color: '#047857' },
  routeReceiptDot:{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 },
  routeReceiptDotDone:{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', flexShrink: 0 },
  routeReceiptName:{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  routeReceiptState:{ flexShrink: 0, color: 'inherit', opacity: 0.82 },
  stopRow:  { display: 'flex', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border-light, var(--border))' },
  stopNum:  { width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  stopBody: { flex: 1, minWidth: 0 },
  stopTitle:{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 },
  stopMeta: { fontSize: 12, color: 'var(--text-sub)', marginBottom: 2 },
  stopContact:{ fontSize: 11, color: 'var(--text)', fontWeight: 800, marginBottom: 2 },
  stopTimes:{ fontSize: 11, color: 'var(--text-muted, var(--text-sub))' },
  stopWarnings:{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 },
  stopWarningPill:{ borderRadius: 8, padding: '2px 7px', background: '#fff1f2', color: '#be123c', border: '1px solid #fecaca', fontSize: 10, fontWeight: 900 },
  lateBadge:{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '1px 5px', fontWeight: 700 },
  returnRow:{ padding: '8px 16px', fontSize: 12, color: 'var(--text-sub)', fontStyle: 'italic' },
  unassignedCol:{ display: 'flex', flexDirection: 'column', gap: 8 },
  unassignedCard:{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-field)', border: '1px solid #fca5a5' },
  unassignedAddr:{ fontSize: 12, color: 'var(--text-sub)', margin: '4px 0' },
  reasonBadge:{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 6px', display: 'inline-block', fontWeight: 600 },
  empty:    { textAlign: 'center', padding: '56px 20px', color: 'var(--text-sub)', background: '#ffffff', border: '1px solid rgba(15,95,58,0.13)', borderRadius: 8, boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  emptyIcon:{ fontSize: 18, fontWeight: 950, marginBottom: 10, color: 'var(--accent)' },
};
