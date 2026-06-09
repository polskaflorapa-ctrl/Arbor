import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import LocalPhoneOutlined from '@mui/icons-material/LocalPhoneOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import MyLocationOutlined from '@mui/icons-material/MyLocationOutlined';
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import api from '../api';
import PageHeader from '../components/PageHeader';
import CommandSidebar from '../components/CommandSidebar';
import StatusMessage from '../components/StatusMessage';
import TaskStatusIcon from '../components/TaskStatusIcon';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { telHref } from '../utils/telLink';
import {
  TASK_STATUS,
  TASK_STATUSES,
  getTaskStatusColor,
  isTaskDone,
  isTaskInProgress,
  taskMutationPayload,
} from '../utils/taskWorkflow';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cockpitTone(tone) {
  if (tone === 'danger') return { color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.24)' };
  if (tone === 'warning') return { color: 'var(--warning)', bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.26)' };
  if (tone === 'ok') return { color: 'var(--success)', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.24)' };
  return { color: 'var(--accent)', bg: 'var(--accent-surface)', border: 'var(--border)' };
}

function gpsLabel(status, ageMin) {
  if (status === 'online') return ageMin == null ? 'online' : `${ageMin} min`;
  if (status === 'stale') return ageMin == null ? 'opozniony' : `${ageMin} min`;
  if (status === 'offline') return ageMin == null ? 'offline' : `${ageMin} min`;
  return 'brak';
}

function formatMinutes(value) {
  const total = Math.round(Number(value || 0));
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (!hours) return `${sign}${minutes} min`;
  if (!minutes) return `${sign}${hours} h`;
  return `${sign}${hours} h ${minutes} min`;
}

function formatMoney(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
}

const PLAN_REASON_OPTIONS = [
  { value: 'zakres', label: 'Wiekszy zakres' },
  { value: 'dojazd', label: 'Dojazd' },
  { value: 'sprzet', label: 'Sprzet' },
  { value: 'klient', label: 'Klient' },
  { value: 'pogoda', label: 'Pogoda' },
  { value: 'inne', label: 'Inne' },
];

const RECOMMENDATION_BLOCKER_LABELS = {
  team: 'brak ekipy',
  gps: 'brak GPS',
  phone: 'brak tel.',
  address: 'brak adresu',
  duration: 'brak czasu',
  issue: 'problem',
};

function recommendationPreviewMeta(task) {
  if (task?.issue_label) return task.issue_label;
  const blockers = (task?.blockers || [])
    .map((key) => RECOMMENDATION_BLOCKER_LABELS[key] || key)
    .filter(Boolean);
  if (blockers.length > 0) return blockers.slice(0, 2).join(', ');
  const delta = Number(task?.delta_minutes || 0);
  if (Math.abs(delta) > 0) return formatMinutes(delta);
  return task?.ekipa_nazwa || 'Otworz';
}

function recommendationSort(a, b) {
  return Number(a?.rank || 999) - Number(b?.rank || 999);
}

function withRecommendationVisibility(state, recommendation, hidden) {
  if (!state || !recommendation?.id) return state;
  const id = recommendation.id;
  const active = (state.recommendations || []).filter((item) => item.id !== id);
  const hiddenItems = (state.hidden_recommendations || []).filter((item) => item.id !== id);
  const nextActive = hidden ? active : [recommendation, ...active].sort(recommendationSort);
  const nextHidden = hidden ? [recommendation, ...hiddenItems].sort(recommendationSort) : hiddenItems;
  return {
    ...state,
    recommendations: nextActive,
    hidden_recommendations: nextHidden,
    summary: {
      ...(state.summary || {}),
      total: nextActive.length,
      high: nextActive.filter((item) => item.priority === 'high').length,
      actionable: nextActive.filter((item) => item.action_kind && item.action_kind !== 'none').length,
      hidden_today: nextHidden.length,
    },
  };
}

function CockpitMetric({ label, value, detail, tone = 'info' }) {
  const t = cockpitTone(tone);
  return (
    <div style={{ ...styles.cockpitMetric, background: t.bg, borderColor: t.border }}>
      <span style={styles.cockpitMetricLabel}>{label}</span>
      <strong style={{ ...styles.cockpitMetricValue, color: t.color }}>{value}</strong>
      {detail ? <small style={styles.cockpitMetricDetail}>{detail}</small> : null}
    </div>
  );
}

export default function Kierownik() {
  const { t } = useTranslation();
  const [zlecenia, setZlecenia] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrStatus, setFiltrStatus] = useState('');
  const [filtrData, setFiltrData] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [sortBy, setSortBy] = useState('data');
  const [cockpitDate, setCockpitDate] = useState(todayIso);
  const [cockpit, setCockpit] = useState(null);
  const [cockpitLoading, setCockpitLoading] = useState(false);
  const [cockpitError, setCockpitError] = useState('');
  const [planReal, setPlanReal] = useState(null);
  const [dispatchPlans, setDispatchPlans] = useState([]);
  const [actionInsights, setActionInsights] = useState(null);
  const [actionHistory, setActionHistory] = useState(null);
  const [actionHistoryFilter, setActionHistoryFilter] = useState('risk');
  const [actionRecommendations, setActionRecommendations] = useState(null);
  const [planActionDrafts, setPlanActionDrafts] = useState({});
  const [planActionSaving, setPlanActionSaving] = useState('');
  const navigate = useNavigate();

  const isDyrektor = (u) => ['Prezes', 'Dyrektor'].includes(u?.rola);
  const isKierownik = (u) => u?.rola === 'Kierownik';

  const loadData = useCallback(async (u) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const endpoint = ['Prezes', 'Dyrektor'].includes(u?.rola)
        ? `/tasks/wszystkie`
        : `/tasks`;
      const [zRes, eRes, oRes] = await Promise.all([
        api.get(endpoint, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setEkipy(eRes.data);
      setOddzialy(oRes.data);
    } catch (err) {
      console.error('Błąd ładowania:', err);
      showMsg(errorMessage('Błąd ładowania danych'));
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  const loadCockpit = useCallback(async (u, dateValue, oddzialId) => {
    if (!u) return;
    setCockpitLoading(true);
    setCockpitError('');
    try {
      const token = getStoredToken();
      const params = { date: dateValue || todayIso() };
      if (['Prezes', 'Dyrektor'].includes(u?.rola) && oddzialId) {
        params.oddzial_id = oddzialId;
      }
      const actionHistoryParams = {
        ...params,
        range: 'week',
        limit: 12,
        ...(actionHistoryFilter === 'risk' ? { q: 'risk_' } : {}),
        ...(actionHistoryFilter && actionHistoryFilter !== 'all' && actionHistoryFilter !== 'risk' ? { action_type: actionHistoryFilter } : {}),
      };
      const [cockpitResponse, planRealResponse, dispatchPlansResponse, insightsResponse, actionHistoryResponse, recommendationsResponse] = await Promise.all([
        api.get('/ops/kierownik-today', {
          params,
          headers: authHeaders(token),
          dedupe: false,
        }),
        api.get('/ops/plan-vs-real', {
          params,
          headers: authHeaders(token),
          dedupe: false,
        }),
        api.get('/dispatch/plans', {
          params: { ...params, limit: 1 },
          headers: authHeaders(token),
          dedupe: false,
        }),
        api.get('/ops/action-insights', {
          params: { ...params, range: 'week' },
          headers: authHeaders(token),
          dedupe: false,
        }),
        api.get('/ops/action-history', {
          params: actionHistoryParams,
          headers: authHeaders(token),
          dedupe: false,
        }),
        api.get('/ops/action-recommendations', {
          params,
          headers: authHeaders(token),
          dedupe: false,
        }),
      ]);
      setCockpit(cockpitResponse.data);
      setPlanReal(planRealResponse.data);
      setDispatchPlans(Array.isArray(dispatchPlansResponse.data) ? dispatchPlansResponse.data : []);
      setActionInsights(insightsResponse.data);
      setActionHistory(actionHistoryResponse.data);
      setActionRecommendations(recommendationsResponse.data);
    } catch (err) {
      setCockpitError(getApiErrorMessage(err, 'Nie udalo sie wczytac cockpit kierownika.'));
    } finally {
      setCockpitLoading(false);
    }
  }, [actionHistoryFilter]);

  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setUser(parsedUser);
    if (isKierownik(parsedUser)) {
      setFiltrOddzial(parsedUser.oddzial_id?.toString() || '');
    }
    loadData(parsedUser);
  }, [navigate, loadData]);

  useEffect(() => {
    if (!user) return;
    const oddzialForCockpit = isDyrektor(user) ? filtrOddzial : user.oddzial_id;
    loadCockpit(user, cockpitDate, oddzialForCockpit);
  }, [cockpitDate, filtrOddzial, loadCockpit, user]);

  const przypisz = async (taskId, ekipaId) => {
    const applyAssignment = async (overrideAbsent = false) => {
      const token = getStoredToken();
      const { data } = await api.put(`/tasks/${taskId}/przypisz`,
        { ekipa_id: ekipaId || null, ...(overrideAbsent ? { absence_override: true } : {}) },
        { headers: authHeaders(token) }
      );
      setZlecenia((prev) => prev.map((z) => (
        z.id === taskId ? { ...z, ekipa_id: ekipaId || null, ...taskMutationPayload(data) } : z
      )));
      showMsg(successMessage(overrideAbsent ? 'Ekipa przypisana z potwierdzeniem kierownika.' : 'Ekipa przypisana!'));
      loadData(user);
    };

    try {
      await applyAssignment(false);
    } catch (err) {
      const payload = err?.response?.data || {};
      if (payload.code === 'TEAM_ABSENT') {
        const attendance = payload.attendance || {};
        const reason = attendance.note ? ` Powod: ${attendance.note}.` : '';
        const confirmed = typeof window !== 'undefined' && window.confirm
          ? window.confirm(`${attendance.teamName || 'Wybrana ekipa'} jest oznaczona jako nieobecna.${reason} Czy kierownik potwierdza przypisanie mimo braku gotowosci?`)
          : false;
        if (!confirmed) {
          showMsg(errorMessage('Przypisanie przerwane: ekipa jest nieobecna.'));
          return;
        }
        try {
          await applyAssignment(true);
          return;
        } catch (overrideErr) {
          showMsg(errorMessage(overrideErr?.response?.data?.error || 'Blad zapisu potwierdzenia'));
          return;
        }
      }
      showMsg(errorMessage(getApiErrorMessage(err, payload.error || 'Blad zapisu')));
    }
  };

  const zmienStatus = async (taskId, status) => {
    try {
      const token = getStoredToken();
      const { data } = await api.put(`/tasks/${taskId}/status`,
        { status },
        { headers: authHeaders(token) }
      );
      setZlecenia((prev) => prev.map((z) => (
        z.id === taskId ? { ...z, status, ...taskMutationPayload(data) } : z
      )));
      showMsg(successMessage(`Status zmieniony na ${status}`));
      loadData(user);
    } catch (err) {
      showMsg(errorMessage('Błąd zmiany statusu'));
    }
  };

  const updatePlanActionDraft = useCallback((taskId, patch) => {
    setPlanActionDrafts((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || {}), ...patch },
    }));
  }, []);

  const runPlanAction = useCallback(async (task, action) => {
    const draft = planActionDrafts[task.id] || {};
    const payload = {
      action,
      issue_key: task.issue_key || null,
      delta_minutes: task.delta_minutes,
      planned_minutes: task.planned_minutes,
      real_minutes: task.real_minutes,
    };
    if (action === 'set_duration') {
      const plannedHours = Number(draft.hours || (task.planned_minutes ? task.planned_minutes / 60 : 2));
      if (!Number.isFinite(plannedHours) || plannedHours <= 0) {
        showMsg(errorMessage('Podaj poprawny czas planu.'));
        return;
      }
      payload.planned_hours = plannedHours;
      payload.previous_planned_minutes = task.planned_minutes || 0;
      payload.note = draft.note || '';
    } else if (action === 'mark_reason') {
      payload.reason_code = draft.reason_code || 'zakres';
      payload.note = draft.note || '';
    } else if (action === 'remind_team') {
      payload.note = draft.note || '';
    }

    const key = `${task.id}:${action}`;
    setPlanActionSaving(key);
    try {
      const token = getStoredToken();
      const { data } = await api.post(`/ops/plan-vs-real/tasks/${task.id}/action`, payload, {
        headers: authHeaders(token),
      });
      showMsg(successMessage(data?.message || 'Akcja zapisana.'));
      setPlanActionDrafts((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
      const oddzialForCockpit = ['Prezes', 'Dyrektor'].includes(user?.rola) ? filtrOddzial : user?.oddzial_id;
      await Promise.all([
        loadCockpit(user, cockpitDate, oddzialForCockpit),
        loadData(user),
      ]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zapisac akcji.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, filtrOddzial, loadCockpit, loadData, planActionDrafts, showMsg, user]);

  const recordRecommendationDecision = useCallback(async (recommendation, decision, note = '', source = '') => {
    if (!recommendation?.id) return null;
    const token = getStoredToken();
    const oddzialForCockpit = ['Prezes', 'Dyrektor'].includes(user?.rola) ? filtrOddzial : user?.oddzial_id;
    const { data } = await api.post(`/ops/action-recommendations/${encodeURIComponent(recommendation.id)}/feedback`, {
      date: cockpitDate,
      decision,
      oddzial_id: oddzialForCockpit || null,
      target_path: recommendation.target_path || '',
      task_ids: recommendation.task_ids || [],
      note: note || recommendation.title || '',
      source,
    }, {
      headers: authHeaders(token),
    });
    return { data, oddzialForCockpit };
  }, [cockpitDate, filtrOddzial, user]);

  const runRecommendationAction = useCallback(async (recommendation) => {
    if (!recommendation || recommendation.action_kind === 'none') return;
    const key = `recommendation:${recommendation.id}`;
    setPlanActionSaving(key);
    try {
      const token = getStoredToken();
      const oddzialForCockpit = ['Prezes', 'Dyrektor'].includes(user?.rola) ? filtrOddzial : user?.oddzial_id;
      const { data } = await api.post(`/ops/action-recommendations/${encodeURIComponent(recommendation.id)}/apply`, {
        date: cockpitDate,
        oddzial_id: oddzialForCockpit || null,
        action_kind: recommendation.action_kind || 'open_tasks',
        target_path: recommendation.target_path || '',
        task_ids: recommendation.task_ids || [],
        suggested_minutes: recommendation.suggested_minutes || null,
        title: recommendation.title || '',
      }, {
        headers: authHeaders(token),
      });
      if (data?.navigate_to) {
        navigate(data.navigate_to);
        return;
      }

      showMsg(successMessage(`Wykonano: ${recommendation.title}`));
      await Promise.all([
        loadCockpit(user, cockpitDate, oddzialForCockpit),
        loadData(user),
      ]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie wykonac rekomendacji.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, filtrOddzial, loadCockpit, loadData, navigate, showMsg, user]);

  const dismissRecommendation = useCallback(async (recommendation) => {
    if (!recommendation?.id) return;
    const key = `recommendation-hide:${recommendation.id}`;
    setPlanActionSaving(key);
    try {
      const result = await recordRecommendationDecision(recommendation, 'dismissed', '', 'hide');
      setActionRecommendations((current) => withRecommendationVisibility(current, recommendation, true));
      showMsg(successMessage('Rekomendacja ukryta na dzis.'));
      await loadCockpit(user, cockpitDate, result?.oddzialForCockpit);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie ukryc rekomendacji.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, loadCockpit, recordRecommendationDecision, showMsg, user]);

  const restoreRecommendation = useCallback(async (recommendation) => {
    if (!recommendation?.id) return;
    const key = `recommendation-restore:${recommendation.id}`;
    setPlanActionSaving(key);
    try {
      const result = await recordRecommendationDecision(recommendation, 'accepted', '', 'restore');
      setActionRecommendations((current) => withRecommendationVisibility(current, recommendation, false));
      showMsg(successMessage('Rekomendacja przywrocona.'));
      await loadCockpit(user, cockpitDate, result?.oddzialForCockpit);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie przywrocic rekomendacji.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, loadCockpit, recordRecommendationDecision, showMsg, user]);

  const copyRiskReport = useCallback(async () => {
    const text = cockpit?.risk_report?.text || '';
    if (!text) {
      showMsg(errorMessage('Raport ryzyk jest jeszcze pusty.'));
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      showMsg(successMessage('Raport ryzyk skopiowany.'));
    } catch {
      showMsg(errorMessage('Nie udalo sie skopiowac raportu.'));
    }
  }, [cockpit, showMsg]);

  const runRiskAction = useCallback(async (risk, action) => {
    if (!risk?.id) return;
    if (!risk.task_id && action !== 'acknowledge') {
      showMsg(errorMessage('To ryzyko nie jest powiazane ze zleceniem.'));
      return;
    }
    const key = `risk:${risk.id}:${action}`;
    setPlanActionSaving(key);
    try {
      const token = getStoredToken();
      const { data } = await api.post('/ops/risk-report/actions', {
        action,
        risk_id: risk.id,
        risk_type: risk.type,
        task_id: risk.task_id || null,
        note: risk.title || '',
      }, {
        headers: authHeaders(token),
      });
      showMsg(successMessage(data?.message || 'Akcja ryzyka zapisana.'));
      const oddzialForCockpit = ['Prezes', 'Dyrektor'].includes(user?.rola) ? filtrOddzial : user?.oddzial_id;
      await loadCockpit(user, cockpitDate, oddzialForCockpit);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie wykonac akcji ryzyka.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, filtrOddzial, loadCockpit, showMsg, user]);

  const runConflictFix = useCallback(async (risk) => {
    if (!risk?.task_id || !['team_conflict', 'equipment_conflict'].includes(risk.type)) {
      showMsg(errorMessage('Dla tego ryzyka nie ma automatycznej naprawy.'));
      return;
    }
    const key = `risk:${risk.id}:fix_conflict`;
    setPlanActionSaving(key);
    try {
      const token = getStoredToken();
      const { data } = await api.get('/ops/risk-report/actions/options', {
        params: {
          risk_id: risk.id,
          risk_type: risk.type,
          task_id: risk.task_id,
        },
        headers: authHeaders(token),
      });
      const option = (data?.options || [])[0];
      if (!option) {
        showMsg(errorMessage('Brak bezkolizyjnej alternatywy dla tego ryzyka.'));
        return;
      }
      const action = risk.type === 'team_conflict' ? 'reassign_team' : 'replace_equipment';
      const ok = typeof window !== 'undefined' && window.confirm
        ? window.confirm(`${option.impact}\n\nZastosowac te zmiane?`)
        : true;
      if (!ok) return;
      const payload = {
        action,
        risk_id: risk.id,
        risk_type: risk.type,
        task_id: risk.task_id,
        note: risk.title || '',
        ...(action === 'reassign_team' ? { team_id: option.team_id } : { sprzet_id: option.sprzet_id }),
      };
      const result = await api.post('/ops/risk-report/actions', payload, {
        headers: authHeaders(token),
      });
      showMsg(successMessage(result.data?.message || 'Konflikt poprawiony.'));
      const oddzialForCockpit = ['Prezes', 'Dyrektor'].includes(user?.rola) ? filtrOddzial : user?.oddzial_id;
      await Promise.all([
        loadCockpit(user, cockpitDate, oddzialForCockpit),
        loadData(user),
      ]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie naprawic konfliktu.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, filtrOddzial, loadCockpit, loadData, showMsg, user]);

  const applyDispatchPlan = useCallback(async (planRow) => {
    if (!planRow?.id) return;
    const key = `dispatch-plan:${planRow.id}`;
    setPlanActionSaving(key);
    try {
      const token = getStoredToken();
      const result = await api.post(`/dispatch/apply/${planRow.id}`, {}, {
        headers: authHeaders(token),
      });
      showMsg(successMessage(result.data?.message || 'Plan dispatchera zastosowany.'));
      const oddzialForCockpit = ['Prezes', 'Dyrektor'].includes(user?.rola) ? filtrOddzial : user?.oddzial_id;
      await Promise.all([
        loadCockpit(user, cockpitDate, oddzialForCockpit),
        loadData(user),
      ]);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udalo sie zastosowac planu dispatchera.')));
    } finally {
      setPlanActionSaving('');
    }
  }, [cockpitDate, filtrOddzial, loadCockpit, loadData, showMsg, user]);

  const filtrowane = zlecenia.filter(z => {
    if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
    if (filtrStatus && z.status !== filtrStatus) return false;
    if (filtrData && z.data_planowana?.split('T')[0] !== filtrData) return false;
    if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'data') return new Date(b.data_planowana) - new Date(a.data_planowana);
    if (sortBy === 'priorytet') {
      const priority = { 'Pilny': 4, 'Wysoki': 3, 'Normalny': 2, 'Niski': 1 };
      return (priority[b.priorytet] || 0) - (priority[a.priorytet] || 0);
    }
    return 0;
  });

  const ekipyDlaOddzialu = (oddzialId) =>
    ekipy.filter(e => !oddzialId || e.oddzial_id === parseInt(oddzialId));

  const statsByOddzial = oddzialy.map(o => ({
    ...o,
    nowe: zlecenia.filter(z => z.oddzial_id === o.id && z.status === TASK_STATUS.NOWE).length,
    w_realizacji: zlecenia.filter(z => z.oddzial_id === o.id && isTaskInProgress(z.status)).length,
    zakonczone: zlecenia.filter(z => z.oddzial_id === o.id && isTaskDone(z.status)).length,
    lacznie: zlecenia.filter(z => z.oddzial_id === o.id).length,
  }));

  const clearFilters = () => {
    setFiltrOddzial('');
    setFiltrStatus('');
    setFiltrData('');
    setFiltrEkipa('');
  };

  const cockpitSummary = cockpit?.summary || {};
  const cockpitBlockers = cockpit?.blockers || [];
  const cockpitTasks = cockpit?.tasks || [];
  const cockpitTeams = cockpit?.teams || [];
  const cockpitMarginRisks = cockpit?.margin_risks || [];
  const cockpitRiskReport = cockpit?.risk_report || {};
  const cockpitRiskCounts = cockpitRiskReport.counts || {};
  const cockpitRiskItems = cockpitRiskReport.items || [];
  const planRealSummary = planReal?.summary || {};
  const planRealTasks = planReal?.tasks || [];
  const planRealDelta = Number(planRealSummary.delta_minutes || 0);
  const planRealDeltaTone = planRealDelta > 30 ? 'danger' : planRealDelta < -30 ? 'warning' : 'ok';
  const latestDispatchPlan = dispatchPlans[0] || null;
  const latestDispatchStats = latestDispatchPlan?.stats || {};
  const latestDispatchSaving = latestDispatchPlan?.id ? planActionSaving === `dispatch-plan:${latestDispatchPlan.id}` : false;
  const actionInsightSummary = actionInsights?.summary || {};
  const actionInsightReasons = actionInsights?.reasons || [];
  const actionInsightIssues = actionInsights?.issues || [];
  const actionInsightRecent = actionInsights?.recent || [];
  const actionHistoryItems = actionHistory?.items || [];
  const actionHistorySummary = actionHistory?.summary || {};
  const actionRecommendationSummary = actionRecommendations?.summary || {};
  const actionRecommendationItems = actionRecommendations?.recommendations || [];
  const actionRecommendationHiddenItems = actionRecommendations?.hidden_recommendations || [];

  return (
    <div className="app-shell kierownik-shell" style={styles.container}>
      <CommandSidebar active="dashboard" />
      <main className="app-main command-content-main kierownik-main" style={styles.main}>
        <PageHeader
          variant="hero"
          title={t('pages.kierownik.title')}
          subtitle={t('pages.kierownik.subtitle')}
          icon={<MapOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} />
              <button type="button" style={{ ...styles.addBtn, background: 'var(--surface-field)', color: 'var(--text)', border: '1px solid var(--border)', marginRight: 8 }} onClick={() => navigate('/auto-dispatch')}>
                <BoltOutlined style={{ fontSize: 17 }} />
                Auto-Dispatch
              </button>
              <button type="button" style={styles.addBtn} onClick={() => navigate('/nowe-zlecenie')}>
                + {t('common.newOrder')}
              </button>
            </>
          }
        />

        <section className="kierownik-cockpit-panel" style={styles.cockpitPanel}>
          <div style={styles.cockpitHeader}>
            <div>
              <div style={styles.cockpitTitleRow}>
                <MyLocationOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} />
                <h2 style={styles.cockpitTitle}>Cockpit kierownika</h2>
              </div>
              <p style={styles.cockpitSub}>Dzisiejsze blokady, gotowosc ekip i zadania do interwencji.</p>
            </div>
            <div style={styles.cockpitControls}>
              <input
                type="date"
                value={cockpitDate}
                onChange={(e) => setCockpitDate(e.target.value || todayIso())}
                style={styles.cockpitDate}
              />
              <button
                type="button"
                style={styles.cockpitRefresh}
                onClick={() => loadCockpit(user, cockpitDate, isDyrektor(user) ? filtrOddzial : user?.oddzial_id)}
                disabled={cockpitLoading}
              >
                <RefreshOutlined sx={{ fontSize: 16 }} />
                {cockpitLoading ? 'Odswiezam' : 'Odswiez'}
              </button>
            </div>
          </div>

          {cockpitError ? (
            <div style={styles.cockpitError}>{cockpitError}</div>
          ) : null}

          <div style={styles.cockpitMetrics}>
            <CockpitMetric
              label="Zlecenia dzis"
              value={cockpitLoading ? '...' : cockpitSummary.tasks_total ?? 0}
              detail={`${cockpitSummary.open ?? 0} otwarte`}
            />
            <CockpitMetric
              label="Gotowe do wyslania"
              value={cockpitLoading ? '...' : cockpitSummary.ready_for_dispatch ?? 0}
              detail="bez blokad"
              tone="ok"
            />
            <CockpitMetric
              label="Blokady"
              value={cockpitLoading ? '...' : cockpitSummary.blocked ?? 0}
              detail={`${cockpitSummary.unassigned ?? 0} bez ekipy`}
              tone={(cockpitSummary.blocked ?? 0) > 0 ? 'danger' : 'ok'}
            />
            <CockpitMetric
              label="W realizacji"
              value={cockpitLoading ? '...' : cockpitSummary.in_progress ?? 0}
              detail={`${cockpitSummary.done ?? 0} zamkniete`}
            />
            <CockpitMetric
              label="Problemy"
              value={cockpitLoading ? '...' : cockpitSummary.open_issues ?? 0}
              detail={`${cockpitSummary.unread_notifications ?? 0} powiadomien`}
              tone={(cockpitSummary.open_issues ?? 0) > 0 ? 'warning' : 'ok'}
            />
            <CockpitMetric
              label="Marza"
              value={cockpitLoading ? '...' : cockpitSummary.margin_risks ?? 0}
              detail="ponizej progu"
              tone={(cockpitSummary.margin_risks ?? 0) > 0 ? 'danger' : 'ok'}
            />
            <CockpitMetric
              label="GPS ekip"
              value={cockpitLoading ? '...' : `${cockpitSummary.gps_online ?? 0}/${cockpitSummary.assigned_teams ?? 0}`}
              detail={`${cockpitSummary.gps_attention ?? 0} do sprawdzenia`}
              tone={(cockpitSummary.gps_attention ?? 0) > 0 ? 'warning' : 'ok'}
            />
          </div>

          <div
            data-testid="manager-dispatch-plan-panel"
            style={styles.dispatchPlanBand}
          >
            <div style={styles.planRealHeader}>
              <div style={styles.cockpitSectionTitle}>
                <BoltOutlined sx={{ fontSize: 18, color: 'var(--accent)' }} />
                Wynik dispatchera dnia
              </div>
              <span style={styles.planRealDate}>{cockpitDate}</span>
            </div>
            {!latestDispatchPlan ? (
              <div style={styles.dispatchPlanEmpty}>
                Brak zapisanego planu dispatchera dla tej daty.
                <button
                  type="button"
                  style={styles.planActionGhost}
                  onClick={() => navigate(`/auto-dispatch?date=${cockpitDate}`)}
                >
                  Generuj plan
                </button>
              </div>
            ) : (
              <div style={styles.dispatchPlanRow}>
                <span style={styles.dispatchPlanMain}>
                  <strong>Plan #{latestDispatchPlan.id}</strong>
                  <small>
                    {latestDispatchPlan.created_by_name || 'AI Dispatcher'} / {String(latestDispatchPlan.created_at || '').slice(0, 16).replace('T', ' ')}
                  </small>
                </span>
                <span style={styles.dispatchPlanStat}>
                  {latestDispatchStats.tasks_assigned ?? 0}/{latestDispatchStats.tasks_total ?? 0}
                  <small>zlecen</small>
                </span>
                <span style={styles.dispatchPlanStat}>
                  {latestDispatchStats.teams_used ?? latestDispatchPlan.routes_count ?? 0}
                  <small>ekip</small>
                </span>
                <span style={styles.dispatchPlanStat}>
                  {latestDispatchStats.coverage_pct ?? 0}%
                  <small>pokrycia</small>
                </span>
                <span style={styles.dispatchPlanStat}>
                  {latestDispatchPlan.unassigned_count ?? latestDispatchStats.tasks_unassigned ?? 0}
                  <small>bez przydzialu</small>
                </span>
                <span style={styles.dispatchPlanActions}>
                  <button
                    type="button"
                    style={styles.planActionGhost}
                    onClick={() => navigate(`/auto-dispatch?date=${cockpitDate}`)}
                  >
                    Wczytaj w Auto-dispatch
                  </button>
                  <button
                    type="button"
                    style={styles.planActionBtn}
                    onClick={() => applyDispatchPlan(latestDispatchPlan)}
                    disabled={Boolean(planActionSaving) || latestDispatchPlan.status === 'applied'}
                  >
                    {latestDispatchPlan.status === 'applied' ? 'Zastosowany' : latestDispatchSaving ? 'Stosuje' : 'Zastosuj plan'}
                  </button>
                </span>
              </div>
            )}
          </div>

          <div style={styles.riskReportBand}>
            <div style={styles.planRealHeader}>
              <div style={styles.cockpitSectionTitle}>
                <ReportProblemOutlined sx={{ fontSize: 18, color: (cockpitRiskCounts.critical || 0) > 0 ? 'var(--danger)' : 'var(--accent)' }} />
                Raport ryzyk dnia
              </div>
              <button type="button" style={styles.compactActionBtn} onClick={copyRiskReport}>
                Kopiuj raport
              </button>
            </div>
            <div style={styles.riskReportMetrics}>
              <CockpitMetric
                label="Krytyczne"
                value={cockpitLoading ? '...' : cockpitRiskCounts.critical ?? 0}
                detail={`${cockpitRiskCounts.total ?? 0} lacznie`}
                tone={(cockpitRiskCounts.critical ?? 0) > 0 ? 'danger' : 'ok'}
              />
              <CockpitMetric
                label="Zadarma/SMS"
                value={cockpitLoading ? '...' : cockpitRiskCounts.sms_delivery ?? 0}
                detail="niedostarczone lub bez statusu"
                tone={(cockpitRiskCounts.sms_delivery ?? 0) > 0 ? 'warning' : 'ok'}
              />
              <CockpitMetric
                label="Kommo"
                value={cockpitLoading ? '...' : cockpitRiskCounts.kommo_sync ?? 0}
                detail="retry i dead-letter"
                tone={(cockpitRiskCounts.kommo_sync ?? 0) > 0 ? 'danger' : 'ok'}
              />
              <CockpitMetric
                label="Okna klienta"
                value={cockpitLoading ? '...' : cockpitRiskCounts.client_window ?? 0}
                detail="poza planem lub bez zgody"
                tone={(cockpitRiskCounts.client_window ?? 0) > 0 ? 'warning' : 'ok'}
              />
              <CockpitMetric
                label="Konflikty"
                value={cockpitLoading ? '...' : (cockpitRiskCounts.team_conflict ?? 0) + (cockpitRiskCounts.equipment_conflict ?? 0)}
                detail="ekipy i sprzet"
                tone={((cockpitRiskCounts.team_conflict ?? 0) + (cockpitRiskCounts.equipment_conflict ?? 0)) > 0 ? 'danger' : 'ok'}
              />
            </div>
            {cockpitRiskItems.length === 0 ? (
              <div style={styles.planRealEmpty}>Brak ryzyk dnia do natychmiastowej reakcji.</div>
            ) : (
              <div style={styles.riskReportList}>
                {cockpitRiskItems.slice(0, 8).map((risk) => {
                  const tone = cockpitTone(risk.severity === 'critical' ? 'danger' : 'warning');
                  return (
                    <div
                      key={risk.id}
                      style={styles.riskReportRow}
                    >
                      <span style={{ ...styles.riskSeverity, color: tone.color, background: tone.bg, borderColor: tone.border }}>
                        {risk.severity === 'critical' ? 'Pilne' : 'Uwaga'}
                      </span>
                      <span style={styles.riskReportBody}>
                        <strong>{risk.title}</strong>
                        <small>{risk.detail || risk.action}</small>
                        {risk.owner_label || risk.owner_role ? (
                          <small>{[risk.owner_label, risk.escalation].filter(Boolean).join(' / ')}</small>
                        ) : null}
                      </span>
                      <span style={styles.riskReportType}>{risk.type}</span>
                      <span style={styles.riskActionGroup}>
                        <button
                          type="button"
                          style={styles.planActionGhost}
                          onClick={() => navigate(risk.action_path || (risk.task_id ? `/zlecenia/${risk.task_id}` : '/kierownik'))}
                        >
                          Otworz
                        </button>
                        {['sms_delivery', 'client_window'].includes(risk.type) ? (
                          <button
                            type="button"
                            style={styles.planActionBtn}
                            disabled={planActionSaving === `risk:${risk.id}:resend_zadarma_sms`}
                            onClick={() => runRiskAction(risk, 'resend_zadarma_sms')}
                          >
                            {planActionSaving === `risk:${risk.id}:resend_zadarma_sms` ? 'Wysylam' : 'Zadarma SMS'}
                          </button>
                        ) : null}
                        {risk.task_id ? (
                          <button
                            type="button"
                            style={styles.planActionBtn}
                            disabled={planActionSaving === `risk:${risk.id}:queue_zadarma_call`}
                            onClick={() => runRiskAction(risk, 'queue_zadarma_call')}
                          >
                            {planActionSaving === `risk:${risk.id}:queue_zadarma_call` ? 'Lacze' : 'Zadarma tel.'}
                          </button>
                        ) : null}
                        {['team_conflict', 'equipment_conflict'].includes(risk.type) ? (
                          <button
                            type="button"
                            style={styles.planActionBtn}
                            disabled={planActionSaving === `risk:${risk.id}:fix_conflict`}
                            onClick={() => runConflictFix(risk)}
                          >
                            {planActionSaving === `risk:${risk.id}:fix_conflict` ? 'Sprawdzam' : 'Napraw'}
                          </button>
                        ) : null}
                        {['kommo_sync', 'margin'].includes(risk.type) || !risk.task_id ? (
                          <button
                            type="button"
                            style={styles.planActionGhost}
                            disabled={planActionSaving === `risk:${risk.id}:acknowledge`}
                            onClick={() => runRiskAction(risk, 'acknowledge')}
                          >
                            {planActionSaving === `risk:${risk.id}:acknowledge` ? 'Zapisuje' : 'Potwierdz'}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {cockpitMarginRisks.length > 0 ? (
            <div style={styles.marginRiskBand}>
              <div style={styles.planRealHeader}>
                <div style={styles.cockpitSectionTitle}>
                  <ReportProblemOutlined sx={{ fontSize: 18, color: 'var(--danger)' }} />
                  Marza ponizej progu oddzialu
                </div>
                <span style={styles.planRealDate}>{cockpitMarginRisks.length} do sprawdzenia</span>
              </div>
              <div style={styles.marginRiskList}>
                {cockpitMarginRisks.map((risk) => (
                  <button
                    type="button"
                    key={risk.id}
                    style={styles.marginRiskRow}
                    onClick={() => navigate(risk.action_path || `/zlecenia/${risk.id}`)}
                  >
                    <span style={styles.marginRiskMain}>
                      <strong>{risk.numer || `#${risk.id}`}</strong>
                      <small>{risk.klient_nazwa || 'Bez klienta'}</small>
                    </span>
                    <span style={styles.marginRiskMoney}>
                      {formatMoney(risk.gross_margin)} / koszt {formatMoney(risk.total_known_cost)}
                    </span>
                    <span style={styles.marginRiskPct}>
                      {risk.margin_pct ?? '-'}% / prog {risk.threshold_pct}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div style={styles.planRealBand}>
            <div style={styles.planRealHeader}>
              <div style={styles.cockpitSectionTitle}>
                <TrendingUpOutlined sx={{ fontSize: 18 }} />
                Plan vs real
              </div>
              <span style={styles.planRealDate}>{planReal?.date || cockpitDate}</span>
            </div>
            <div style={styles.planRealMetrics}>
              <CockpitMetric
                label="Czas"
                value={cockpitLoading ? '...' : `${formatMinutes(planRealSummary.planned_minutes)} / ${formatMinutes(planRealSummary.real_minutes)}`}
                detail={`${planRealSummary.started_tasks ?? 0}/${planRealSummary.planned_tasks ?? 0} wystartowalo`}
              />
              <CockpitMetric
                label="Odchylka"
                value={cockpitLoading ? '...' : formatMinutes(planRealDelta)}
                detail={`${planRealSummary.overrun_tasks ?? 0} przekroczen`}
                tone={planRealDeltaTone}
              />
              <CockpitMetric
                label="Do reakcji"
                value={cockpitLoading ? '...' : (planRealTasks.length || 0)}
                detail={`${planRealSummary.not_started_tasks ?? 0} bez startu, ${planRealSummary.missing_finish_tasks ?? 0} bez zamkniecia, ${planRealSummary.missing_duration_tasks ?? 0} bez czasu`}
                tone={(planRealTasks.length || 0) > 0 ? 'warning' : 'ok'}
              />
            </div>
            {planRealTasks.length === 0 ? (
              <div style={styles.planRealEmpty}>Plan trzyma sie bez istotnych odchylen.</div>
            ) : (
              <div style={styles.planRealList}>
                {planRealTasks.map((task) => {
                  const tone = cockpitTone(task.tone || (task.delta_minutes > 30 ? 'danger' : 'warning'));
                  const draft = planActionDrafts[task.id] || {};
                  const savingDuration = planActionSaving === `${task.id}:set_duration`;
                  const savingReason = planActionSaving === `${task.id}:mark_reason`;
                  const savingReminder = planActionSaving === `${task.id}:remind_team`;
                  return (
                    <div
                      key={task.id}
                      style={styles.planRealRow}
                    >
                      <span style={{ ...styles.planRealDelta, color: tone.color, background: tone.bg }}>
                        {formatMinutes(task.delta_minutes)}
                      </span>
                      <span style={styles.planRealBody}>
                        <strong>{task.numer}</strong>
                        <small>{task.klient_nazwa || 'Bez klienta'}{task.ekipa_nazwa ? ` / ${task.ekipa_nazwa}` : ''}</small>
                      </span>
                      <span style={{ ...styles.planRealIssue, color: tone.color, borderColor: tone.border }}>
                        {task.issue_label || 'Odchylenie'}
                      </span>
                      <span style={styles.planActionControls}>
                        {task.issue_key === 'missing_duration' ? (
                          <>
                            <input
                              type="number"
                              min="0.25"
                              max="12"
                              step="0.25"
                              value={draft.hours ?? (task.planned_minutes ? String(Math.round((task.planned_minutes / 60) * 100) / 100) : '2')}
                              onChange={(e) => updatePlanActionDraft(task.id, { hours: e.target.value })}
                              style={styles.planActionNumber}
                            />
                            <button
                              type="button"
                              style={styles.planActionBtn}
                              onClick={() => runPlanAction(task, 'set_duration')}
                              disabled={Boolean(planActionSaving)}
                            >
                              {savingDuration ? 'Zapisuje' : 'Zapisz czas'}
                            </button>
                          </>
                        ) : null}
                        {task.issue_key === 'not_started' ? (
                          <button
                            type="button"
                            style={styles.planActionBtn}
                            onClick={() => runPlanAction(task, 'remind_team')}
                            disabled={Boolean(planActionSaving)}
                          >
                            {savingReminder ? 'Wysylam' : 'Przypomnij'}
                          </button>
                        ) : null}
                        {['overrun', 'missing_finish', 'under_plan'].includes(task.issue_key) ? (
                          <>
                            <select
                              value={draft.reason_code || 'zakres'}
                              onChange={(e) => updatePlanActionDraft(task.id, { reason_code: e.target.value })}
                              style={styles.planActionSelect}
                            >
                              {PLAN_REASON_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={draft.note || ''}
                              onChange={(e) => updatePlanActionDraft(task.id, { note: e.target.value })}
                              placeholder="notatka"
                              style={styles.planActionNote}
                            />
                            <button
                              type="button"
                              style={styles.planActionBtn}
                              onClick={() => runPlanAction(task, 'mark_reason')}
                              disabled={Boolean(planActionSaving)}
                            >
                              {savingReason ? 'Zapisuje' : 'Zapisz powod'}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          style={styles.planActionGhost}
                          onClick={() => navigate(task.action_path || `/zlecenia/${task.id}`)}
                        >
                          Otworz
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={styles.recommendationsBand}>
            <div style={styles.recommendationsHeader}>
              <div style={styles.cockpitSectionTitle}>
                <BoltOutlined sx={{ fontSize: 18 }} />
                Sugerowane ruchy
              </div>
              <span style={styles.planRealDate}>
                {actionRecommendationSummary.high ?? 0} pilne / {actionRecommendationSummary.actionable ?? 0} wykonalne / {actionRecommendationSummary.accepted_today ?? 0} podjete / {actionRecommendationSummary.hidden_today ?? 0} ukryte
              </span>
            </div>
            {actionRecommendationItems.length === 0 ? (
              <div style={styles.actionInsightsEmpty}>Brak rekomendacji dla wybranego dnia.</div>
            ) : (
              <div style={styles.recommendationsGrid}>
                {actionRecommendationItems.map((item) => {
                  const tone = cockpitTone(item.tone || (item.priority === 'high' ? 'danger' : 'info'));
                  const savingRecommendation = planActionSaving === `recommendation:${item.id}`;
                  const hidingRecommendation = planActionSaving === `recommendation-hide:${item.id}`;
                  const previewTasks = Array.isArray(item.task_preview) ? item.task_preview.slice(0, 3) : [];
                  return (
                    <div key={item.id} style={{ ...styles.recommendationCard, borderColor: tone.border }}>
                      <div style={styles.recommendationTop}>
                        <span style={{ ...styles.recommendationRank, color: tone.color, background: tone.bg }}>
                          {item.rank}
                        </span>
                        <span style={styles.recommendationBody}>
                          <strong>{item.title}</strong>
                          <small>{item.rationale}</small>
                          {item.accepted_today ? <em style={styles.recommendationAccepted}>Podjete dzis</em> : null}
                        </span>
                      </div>
                      <div style={styles.recommendationActionText}>{item.suggested_action}</div>
                      {previewTasks.length > 0 ? (
                        <div style={styles.recommendationPreview}>
                          <div style={styles.recommendationPreviewTitle}>Podglad zlecen</div>
                          {previewTasks.map((task) => (
                            <button
                              key={`${item.id}-${task.id}`}
                              type="button"
                              style={styles.recommendationPreviewRow}
                              onClick={() => navigate(task.target_path || `/zlecenia/${task.id}`)}
                            >
                              <span style={styles.recommendationPreviewBody}>
                                <strong>{task.numer}</strong>
                                <small>{task.klient_nazwa || 'Bez klienta'}{task.ekipa_nazwa ? ` / ${task.ekipa_nazwa}` : ''}</small>
                              </span>
                              <span style={{ ...styles.recommendationPreviewMeta, color: tone.color, borderColor: tone.border }}>
                                {recommendationPreviewMeta(task)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div style={styles.recommendationFooter}>
                        <span style={styles.recommendationImpact}>{item.impact_label}</span>
                        <span style={styles.recommendationButtons}>
                          {item.action_kind !== 'none' ? (
                            <button
                              type="button"
                              style={{ ...styles.recommendationPrimary, color: tone.color, background: tone.bg, borderColor: tone.border }}
                              onClick={() => runRecommendationAction(item)}
                              disabled={Boolean(planActionSaving)}
                            >
                              {savingRecommendation ? 'Robie' : item.primary_label}
                            </button>
                          ) : null}
                          {item.secondary_label ? (
                            <button
                              type="button"
                              style={styles.recommendationGhost}
                              onClick={() => navigate(item.target_path || '/kierownik')}
                              disabled={Boolean(planActionSaving)}
                            >
                              {item.secondary_label}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            style={styles.recommendationQuiet}
                            onClick={() => dismissRecommendation(item)}
                            disabled={Boolean(planActionSaving)}
                          >
                            {hidingRecommendation ? 'Ukrywam' : 'Pomin dzis'}
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {actionRecommendationHiddenItems.length > 0 ? (
              <div style={styles.hiddenRecommendations}>
                <div style={styles.hiddenRecommendationsTitle}>Ukryte dzis</div>
                {actionRecommendationHiddenItems.slice(0, 4).map((item) => {
                  const restoringRecommendation = planActionSaving === `recommendation-restore:${item.id}`;
                  return (
                    <div key={`hidden-${item.id}`} style={styles.hiddenRecommendationRow}>
                      <span style={styles.hiddenRecommendationBody}>
                        <strong>{item.title}</strong>
                        <small>{item.impact_label || item.suggested_action}</small>
                      </span>
                      <button
                        type="button"
                        style={styles.recommendationGhost}
                        onClick={() => restoreRecommendation(item)}
                        disabled={Boolean(planActionSaving)}
                      >
                        {restoringRecommendation ? 'Przywracam' : 'Przywroc'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div style={styles.actionInsightsBand}>
            <div style={styles.actionInsightsHeader}>
              <div style={styles.cockpitSectionTitle}>
                <ReportProblemOutlined sx={{ fontSize: 18 }} />
                Co rozwala dzien
              </div>
              <span style={styles.planRealDate}>ostatnie 7 dni</span>
            </div>
            <div style={styles.actionInsightsSummary}>
              <span><strong>{actionInsightSummary.total_events ?? 0}</strong> decyzji</span>
              <span><strong>{actionInsightSummary.affected_tasks ?? 0}</strong> zlecen</span>
              <span><strong>{actionInsightSummary.reminders ?? 0}</strong> przypomnien</span>
              <span><strong>{formatMinutes(actionInsightSummary.avg_delta_minutes)}</strong> sr. odchylka</span>
            </div>
            {actionInsightReasons.length === 0 && actionInsightIssues.length === 0 ? (
              <div style={styles.actionInsightsEmpty}>Brak zapisanych powodow. Gdy kierownik oznaczy przyczyne odchylenia, ranking pojawi sie tutaj.</div>
            ) : (
              <div style={styles.actionInsightsGrid}>
                <div style={styles.actionInsightsReasons}>
                  {actionInsightReasons.slice(0, 4).map((reason) => (
                    <div key={reason.reason_code} style={styles.reasonRow}>
                      <span style={styles.reasonLabel}>{reason.label}</span>
                      <span style={styles.reasonTrack}>
                        <span style={{ ...styles.reasonFill, width: `${Math.max(8, Math.min(100, reason.share || 0))}%` }} />
                      </span>
                      <strong style={styles.reasonCount}>{reason.count}</strong>
                    </div>
                  ))}
                </div>
                <div style={styles.issuePills}>
                  {actionInsightIssues.slice(0, 4).map((issue) => (
                    <span key={issue.issue_key} style={styles.issuePill}>{issue.label}: {issue.count}</span>
                  ))}
                  {actionInsightRecent[0] ? (
                    <span style={styles.issuePillMuted}>
                      Ostatnio: {actionInsightRecent[0].numer} / {actionInsightRecent[0].action_label}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div style={styles.actionHistoryBand}>
            <div style={styles.actionInsightsHeader}>
              <div style={styles.cockpitSectionTitle}>
                <AssignmentOutlined sx={{ fontSize: 18 }} />
                Historia decyzji operacyjnych
              </div>
              <select
                value={actionHistoryFilter}
                onChange={(e) => setActionHistoryFilter(e.target.value)}
                style={styles.planActionSelect}
              >
                <option value="risk">Ryzyka</option>
                <option value="all">Wszystkie</option>
                <option value="risk_reassign_team">Przepiecie ekip</option>
                <option value="risk_replace_equipment">Przepiecie sprzetu</option>
                <option value="risk_resend_sms">Zadarma SMS</option>
                <option value="risk_queue_call">Zadarma tel.</option>
                <option value="mark_reason">Powody odchylen</option>
              </select>
            </div>
            <div style={styles.actionInsightsSummary}>
              <span><strong>{actionHistory?.total ?? 0}</strong> wpisow</span>
              <span><strong>{(actionHistorySummary.actions || []).length}</strong> typow decyzji</span>
              <span><strong>{(actionHistorySummary.issues || []).length}</strong> typow ryzyk</span>
            </div>
            {actionHistoryItems.length === 0 ? (
              <div style={styles.actionInsightsEmpty}>Brak decyzji dla tego filtra.</div>
            ) : (
              <div style={styles.actionHistoryList}>
                {actionHistoryItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    style={styles.actionHistoryRow}
                    onClick={() => navigate(item.action_path || (item.task_id ? `/zlecenia/${item.task_id}` : '/kierownik'))}
                  >
                    <span style={styles.actionHistoryTime}>
                      {String(item.created_at || '').slice(11, 16) || '--:--'}
                    </span>
                    <span style={styles.actionHistoryBody}>
                      <strong>{item.action_label || item.action_type}</strong>
                      <small>{item.numer || '-'}{item.klient_nazwa ? ` / ${item.klient_nazwa}` : ''}</small>
                    </span>
                    <span style={styles.actionHistoryOutcome}>
                      {item.outcome || item.issue_label || item.risk_type || '-'}
                    </span>
                    <span style={styles.actionHistoryActor}>{item.actor_name || '-'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={styles.cockpitGrid}>
            <div style={styles.cockpitColumn}>
              <div style={styles.cockpitSectionTitle}>
                <ReportProblemOutlined sx={{ fontSize: 18 }} />
                Priorytety naprawy
              </div>
              {cockpitBlockers.length === 0 ? (
                <div style={styles.cockpitEmpty}>Brak aktywnych blokad dla wybranej daty.</div>
              ) : cockpitBlockers.map((item) => {
                const tone = cockpitTone(item.tone);
                return (
                  <button
                    type="button"
                    key={item.key}
                    style={{ ...styles.blockerRow, borderColor: tone.border }}
                    onClick={() => navigate(item.path || '/kierownik')}
                  >
                    <span style={{ ...styles.blockerCount, color: tone.color, background: tone.bg }}>{item.count}</span>
                    <span style={styles.blockerBody}>
                      <strong>{item.label}</strong>
                      <small>{item.action}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={styles.cockpitColumn}>
              <div style={styles.cockpitSectionTitle}>
                <AssignmentOutlined sx={{ fontSize: 18 }} />
                Zlecenia do interwencji
              </div>
              {cockpitTasks.length === 0 ? (
                <div style={styles.cockpitEmpty}>Nie ma zlecen wymagajacych reakcji.</div>
              ) : cockpitTasks.map((task) => (
                <div key={task.id} style={styles.cockpitTask}>
                  <div style={styles.cockpitTaskTop}>
                    <strong>{task.numer}</strong>
                    <span style={styles.cockpitTaskStatus}>{task.status || '-'}</span>
                  </div>
                  <div style={styles.cockpitTaskClient}>{task.klient_nazwa || 'Bez klienta'}</div>
                  <div style={styles.cockpitChips}>
                    {(task.blocker_labels || []).slice(0, 3).map((label) => (
                      <span key={`${task.id}-${label}`} style={styles.cockpitChip}>{label}</span>
                    ))}
                  </div>
                  <button type="button" style={styles.cockpitTaskBtn} onClick={() => navigate(task.action_path || `/zlecenia/${task.id}`)}>
                    Napraw
                  </button>
                </div>
              ))}
            </div>

            <div style={styles.cockpitColumn}>
              <div style={styles.cockpitSectionTitle}>
                <GroupsOutlined sx={{ fontSize: 18 }} />
                Ekipy i GPS
              </div>
              {cockpitTeams.length === 0 ? (
                <div style={styles.cockpitEmpty}>Brak aktywnych ekip w dzisiejszym planie.</div>
              ) : cockpitTeams.map((team) => {
                const toneName = team.gps_status === 'online' ? 'ok' : team.gps_status === 'missing' ? 'danger' : 'warning';
                const tone = cockpitTone(toneName);
                return (
                  <div key={team.id} style={styles.teamLine}>
                    <span style={styles.teamName}>{team.nazwa}</span>
                    <span style={styles.teamMeta}>{team.tasks_total} zlec. / {team.in_progress} w toku</span>
                    <span style={{ ...styles.gpsPill, color: tone.color, background: tone.bg }}>
                      {gpsLabel(team.gps_status, team.gps_age_min)}
                    </span>
                  </div>
                );
              })}
              <button type="button" style={styles.cockpitSecondaryBtn} onClick={() => navigate('/mapa-live')}>
                <NotificationsActiveOutlined sx={{ fontSize: 16 }} />
                Mapa live i powiadomienia
              </button>
            </div>
          </div>
        </section>

        {/* Statystyki oddziałów (tylko dla dyrektora) */}
        {isDyrektor(user) && (
          <div className="kierownik-branches" style={styles.oddzialyRow}>
            {statsByOddzial.map(o => (
              <div
                className="kierownik-branch-card"
                key={o.id}
                style={{
                  ...styles.oddzialCard,
                  borderTop: `4px solid ${filtrOddzial === o.id.toString() ? 'var(--accent)' : 'var(--border)'}`
                }}
                onClick={() => setFiltrOddzial(filtrOddzial === o.id.toString() ? '' : o.id.toString())}
              >
                <div style={{ ...styles.oddzialNazwa, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BusinessOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} />
                  {o.nazwa}
                </div>
                <div style={{ ...styles.oddzialStats, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <AssignmentOutlined sx={{ fontSize: 16 }} />
                    {o.nowe}
                  </span>
                  <span style={{ color: '#F9A825', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <BoltOutlined sx={{ fontSize: 16 }} />
                    {o.w_realizacji}
                  </span>
                  <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircleOutline sx={{ fontSize: 16 }} />
                    {o.zakonczone}
                  </span>
                </div>
                <div style={styles.oddzialTotal}>Łącznie: {o.lacznie}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtry */}
        <div className="kierownik-filters" style={styles.filtryRow}>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterStatus')}</label>
            <select style={styles.filtrSelect} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
              <option value="">{t('pages.kierownik.all')}</option>
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>{t(`taskStatus.${status}`, { defaultValue: status })}</option>
              ))}
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterDate')}</label>
            <input style={styles.filtrSelect} type="date" value={filtrData} onChange={e => setFiltrData(e.target.value)} />
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterTeam')}</label>
            <select style={styles.filtrSelect} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
              <option value="">{t('common.allTeams')}</option>
              {ekipy.filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial).map(e => (
                <option key={e.id} value={e.id}>{e.nazwa}</option>
              ))}
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterSort')}</label>
            <select style={styles.filtrSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="data">{t('pages.kierownik.sortByDate')}</option>
              <option value="priorytet">{t('pages.kierownik.sortByPriority')}</option>
            </select>
          </div>
          {(filtrOddzial || filtrStatus || filtrData || filtrEkipa) && (
            <button style={styles.clearBtn} onClick={clearFilters}>{t('pages.kierownik.clearFilters')}</button>
          )}
          <div style={styles.filtrCount}>{t('pages.kierownik.countTasks', { count: filtrowane.length })}</div>
        </div>

        {/* Lista zleceń cards-first */}
        {loading ? (
          <div style={styles.loading}>{t('pages.kierownik.loadingTasks')}</div>
        ) : (
          <div className="kierownik-cards-wrap" style={styles.cardsWrap}>
            {filtrowane.length === 0 ? (
              <div className="kierownik-empty-state" style={{ ...styles.tableWrap, textAlign: 'center', color: 'var(--text-muted)', padding: 60 }}>
                <div style={{ ...styles.emptyIcon, display: 'flex', justifyContent: 'center' }}>
                  <MapOutlined sx={{ fontSize: 48, opacity: 0.35, color: 'var(--text-muted)' }} />
                </div>
                <p>{t('pages.kierownik.emptyFiltered')}</p>
              </div>
            ) : (
              <div className="kierownik-cards-grid" style={styles.cardsGrid}>
                {filtrowane.map((z) => (
                  <div key={z.id} className="kierownik-task-card" style={styles.taskCard}>
                    <div style={styles.taskCardTop}>
                      <span style={styles.idBadge}>#{z.id}</span>
                      <span style={{ ...styles.badge, backgroundColor: getTaskStatusColor(z.status), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <TaskStatusIcon status={z.status} size={14} color="#fff" />
                        {t(`taskStatus.${z.status}`, { defaultValue: z.status })}
                      </span>
                    </div>
                    <div style={styles.klientNazwa}>{z.klient_nazwa}</div>
                    {z.klient_telefon && (
                      <div style={{ ...styles.klientTel, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <LocalPhoneOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                        {telHref(z.klient_telefon) ? (
                          <a href={telHref(z.klient_telefon)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                            {z.klient_telefon}
                          </a>
                        ) : (
                          z.klient_telefon
                        )}
                      </div>
                    )}
                    <div style={styles.taskMeta}>{z.adres}{z.miasto ? `, ${z.miasto}` : ''}</div>
                    <div style={styles.taskRow}>
                      <span style={styles.oddzialBadge}>{z.oddzial_nazwa || '-'}</span>
                      <span style={styles.taskDate}>{z.data_planowana ? z.data_planowana.split('T')[0] : '-'}</span>
                    </div>
                    {z.priorytet && <span style={styles.priorytetBadge(z.priorytet)}>{z.priorytet}</span>}
                    <div style={styles.taskActions}>
                      <select style={styles.select} value={z.ekipa_id || ''} onChange={e => przypisz(z.id, e.target.value)}>
                        <option value="">{t('common.noneShort')}</option>
                        {ekipyDlaOddzialu(z.oddzial_id).map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                      </select>
                      <select style={styles.select} value={z.status} onChange={e => zmienStatus(z.id, e.target.value)}>
                        {TASK_STATUSES.map((status) => (
                          <option key={status} value={status}>{t(`taskStatus.${status}`, { defaultValue: status })}</option>
                        ))}
                      </select>
                      <button style={styles.detailBtn} onClick={() => navigate(`/zlecenia/${z.id}`)}>
                        {t('pages.kierownik.detailsBtn')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', background: 'linear-gradient(135deg, #f6faf7 0%, #ffffff 46%, #eaf4ee 100%)' },
  main: { flex: 1, width: '100%', maxWidth: 1560, margin: '0 auto', padding: '22px clamp(16px, 2.4vw, 30px) 32px', overflowX: 'hidden' },
  cockpitPanel: {
    marginBottom: 20,
    padding: '16px clamp(14px, 2vw, 20px)',
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    boxShadow: '0 14px 34px rgba(31,79,50,0.075)',
  },
  cockpitHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  cockpitTitleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  cockpitTitle: { margin: 0, color: 'var(--text)', fontSize: 19, fontWeight: 900 },
  cockpitSub: { margin: '4px 0 0', color: 'var(--text-sub)', fontSize: 13, fontWeight: 650 },
  cockpitControls: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cockpitDate: { minHeight: 36, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.16)', background: '#ffffff', color: 'var(--text)', fontSize: 13 },
  cockpitRefresh: {
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 11px',
    borderRadius: 8,
    border: '1px solid rgba(15,95,58,0.16)',
    background: '#ffffff',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
  },
  cockpitError: { marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.22)', fontSize: 13 },
  cockpitMetrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 },
  cockpitMetric: { minHeight: 82, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, padding: '10px 12px', background: '#ffffff', boxShadow: '0 8px 20px rgba(31,79,50,0.045)' },
  cockpitMetricLabel: { color: 'var(--text-sub)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 },
  cockpitMetricValue: { fontSize: 24, lineHeight: 1, fontWeight: 900 },
  cockpitMetricDetail: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 650 },
  riskReportBand: { marginBottom: 14, paddingTop: 14, borderTop: '1px solid var(--border)' },
  riskReportMetrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 8 },
  riskReportList: { display: 'grid', gap: 0, borderTop: '1px solid var(--border)' },
  riskReportRow: {
    width: '100%',
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '8px 0',
    border: 0,
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    textAlign: 'left',
    cursor: 'pointer',
    flexWrap: 'wrap',
  },
  riskSeverity: { minWidth: 58, height: 26, border: '1px solid var(--border)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' },
  riskReportBody: { minWidth: 180, flex: '1 1 260px', display: 'grid', gap: 2, fontSize: 12 },
  riskReportType: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', whiteSpace: 'nowrap' },
  riskActionGroup: { marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  compactActionBtn: { minHeight: 30, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 11, fontWeight: 850, whiteSpace: 'nowrap' },
  marginRiskBand: { marginBottom: 14, paddingTop: 14, borderTop: '1px solid var(--border)' },
  marginRiskList: { display: 'grid', gap: 0, borderTop: '1px solid var(--border)' },
  marginRiskRow: {
    width: '100%',
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
    padding: '8px 0',
    border: 0,
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  marginRiskMain: { minWidth: 130, flex: '1 1 180px', display: 'grid', gap: 2, fontSize: 12 },
  marginRiskMoney: { flex: '1 1 150px', color: 'var(--text-sub)', fontSize: 12, fontWeight: 750 },
  marginRiskPct: { justifySelf: 'end', border: '1px solid rgba(239,68,68,0.24)', borderRadius: 8, padding: '4px 7px', color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' },
  planRealBand: { marginBottom: 14, paddingTop: 14, borderTop: '1px solid var(--border)' },
  planRealHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  planRealDate: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 800 },
  dispatchPlanBand: { marginBottom: 14, paddingTop: 14, borderTop: '1px solid var(--border)' },
  dispatchPlanEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 0 2px', color: 'var(--text-muted)', fontSize: 12 },
  dispatchPlanRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 10, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, background: '#ffffff', boxShadow: '0 8px 20px rgba(31,79,50,0.045)' },
  dispatchPlanMain: { minWidth: 180, flex: '1 1 220px', display: 'grid', gap: 2, color: 'var(--text)', fontSize: 13 },
  dispatchPlanStat: { minWidth: 72, display: 'grid', gap: 2, justifyItems: 'center', color: 'var(--text)', fontSize: 16, fontWeight: 900 },
  dispatchPlanActions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' },
  planRealMetrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 8 },
  planRealList: { display: 'grid', gap: 0, borderTop: '1px solid var(--border)' },
  planRealRow: { width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', textAlign: 'left', flexWrap: 'wrap' },
  planRealDelta: { minWidth: 58, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' },
  planRealBody: { minWidth: 130, flex: '1 1 180px', display: 'grid', gap: 2, fontSize: 12 },
  planRealIssue: { border: '1px solid var(--border)', borderRadius: 8, padding: '3px 7px', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap' },
  planActionControls: { marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  planActionNumber: { width: 72, minHeight: 30, padding: '5px 7px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 12, fontWeight: 700 },
  planActionSelect: { minHeight: 30, padding: '5px 7px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 12, fontWeight: 700 },
  planActionNote: { width: 130, minHeight: 30, padding: '5px 7px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 12 },
  planActionBtn: { minHeight: 30, padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(20,131,79,0.24)', background: 'var(--accent-surface)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 850, whiteSpace: 'nowrap' },
  planActionGhost: { minHeight: 30, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  planRealEmpty: { padding: '10px 0 2px', color: 'var(--text-muted)', fontSize: 12 },
  recommendationsBand: { marginBottom: 14, padding: '12px 0 2px', borderTop: '1px solid var(--border)' },
  recommendationsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  recommendationsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 10 },
  recommendationCard: { minWidth: 0, display: 'grid', gap: 8, padding: 10, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, background: '#ffffff', boxShadow: '0 8px 20px rgba(31,79,50,0.045)' },
  recommendationTop: { display: 'flex', alignItems: 'flex-start', gap: 9, minWidth: 0 },
  recommendationRank: { minWidth: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 950, flexShrink: 0 },
  recommendationBody: { minWidth: 0, display: 'grid', gap: 3, color: 'var(--text)', fontSize: 12 },
  recommendationAccepted: { justifySelf: 'start', padding: '2px 6px', borderRadius: 7, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.24)', fontSize: 10, fontStyle: 'normal', fontWeight: 850 },
  recommendationActionText: { color: 'var(--text-sub)', fontSize: 12, lineHeight: 1.35 },
  recommendationPreview: { display: 'grid', gap: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid rgba(15,95,58,0.11)', background: 'rgba(241,249,244,0.68)' },
  recommendationPreviewTitle: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0 },
  recommendationPreviewRow: { width: '100%', minHeight: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' },
  recommendationPreviewBody: { minWidth: 0, display: 'grid', gap: 1, fontSize: 11, overflow: 'hidden' },
  recommendationPreviewMeta: { maxWidth: 120, padding: '2px 6px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 10, fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 },
  recommendationFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  recommendationImpact: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 750 },
  recommendationButtons: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  recommendationPrimary: { minHeight: 30, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' },
  recommendationGhost: { minHeight: 30, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  recommendationQuiet: { minHeight: 30, padding: '5px 9px', borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  hiddenRecommendations: { marginTop: 10, display: 'grid', gap: 6, paddingTop: 10, borderTop: '1px dashed var(--border)' },
  hiddenRecommendationsTitle: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0 },
  hiddenRecommendationRow: { minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', color: 'var(--text-sub)' },
  hiddenRecommendationBody: { minWidth: 0, display: 'grid', gap: 2, fontSize: 12 },
  actionInsightsBand: { marginBottom: 14, padding: '12px 0 2px', borderTop: '1px solid var(--border)' },
  actionInsightsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  actionInsightsSummary: { display: 'flex', gap: 8, flexWrap: 'wrap', color: 'var(--text-sub)', fontSize: 12, marginBottom: 8 },
  actionInsightsEmpty: { color: 'var(--text-muted)', fontSize: 12, padding: '6px 0 2px' },
  actionInsightsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 12, alignItems: 'start' },
  actionInsightsReasons: { display: 'grid', gap: 6 },
  actionHistoryBand: { marginBottom: 14, padding: '12px 0 2px', borderTop: '1px solid var(--border)' },
  actionHistoryList: { display: 'grid', gap: 0, borderTop: '1px solid var(--border)' },
  actionHistoryRow: { width: '100%', minHeight: 42, display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', flexWrap: 'wrap' },
  actionHistoryTime: { minWidth: 44, color: 'var(--text-muted)', fontSize: 11, fontWeight: 900 },
  actionHistoryBody: { minWidth: 160, flex: '1 1 220px', display: 'grid', gap: 2, fontSize: 12 },
  actionHistoryOutcome: { flex: '1 1 180px', color: 'var(--text-sub)', fontSize: 11, fontWeight: 800 },
  actionHistoryActor: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  reasonRow: { display: 'grid', gridTemplateColumns: '120px minmax(80px, 1fr) auto', alignItems: 'center', gap: 8, fontSize: 12 },
  reasonLabel: { color: 'var(--text)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  reasonTrack: { height: 8, borderRadius: 8, background: 'var(--surface-field)', border: '1px solid var(--border)', overflow: 'hidden' },
  reasonFill: { display: 'block', height: '100%', borderRadius: 8, background: 'var(--accent)' },
  reasonCount: { color: 'var(--accent)', fontSize: 12 },
  issuePills: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  issuePill: { borderRadius: 8, padding: '4px 8px', background: 'rgba(245,158,11,0.13)', color: 'var(--warning)', fontSize: 11, fontWeight: 850 },
  issuePillMuted: { borderRadius: 8, padding: '4px 8px', background: 'var(--surface-field)', color: 'var(--text-sub)', border: '1px solid var(--border)', fontSize: 11, fontWeight: 750 },
  cockpitGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 12, alignItems: 'start' },
  cockpitColumn: { minWidth: 0, border: '1px solid rgba(15,95,58,0.12)', borderRadius: 8, background: '#ffffff', padding: 12, boxShadow: '0 8px 20px rgba(31,79,50,0.045)' },
  cockpitSectionTitle: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, color: 'var(--text)', fontSize: 13, fontWeight: 850 },
  cockpitEmpty: { padding: '12px 0', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 },
  blockerRow: { width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', border: '0 solid var(--border)', borderTopWidth: 1, background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' },
  blockerCount: { minWidth: 34, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900 },
  blockerBody: { minWidth: 0, display: 'grid', gap: 2, fontSize: 12 },
  cockpitTask: { display: 'grid', gap: 5, padding: '9px 0', borderTop: '1px solid var(--border)' },
  cockpitTaskTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13 },
  cockpitTaskStatus: { flexShrink: 0, color: 'var(--text-sub)', fontSize: 11, fontWeight: 700 },
  cockpitTaskClient: { color: 'var(--text-sub)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cockpitChips: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  cockpitChip: { borderRadius: 999, padding: '2px 7px', background: 'rgba(245,158,11,0.13)', color: 'var(--warning)', fontSize: 10, fontWeight: 800 },
  cockpitTaskBtn: { justifySelf: 'start', marginTop: 2, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 850 },
  teamLine: { minHeight: 38, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)', padding: '7px 0' },
  teamName: { minWidth: 0, color: 'var(--text)', fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  teamMeta: { color: 'var(--text-sub)', fontSize: 11, whiteSpace: 'nowrap' },
  gpsPill: { minWidth: 58, textAlign: 'center', borderRadius: 999, padding: '3px 7px', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap' },
  cockpitSecondaryBtn: { marginTop: 10, width: '100%', minHeight: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 'clamp(24px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 'clamp(12px, 3vw, 14px)' },
  headerRight: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  addBtn: { minHeight: 38, padding: '9px 16px', background: 'var(--accent-gradient)', color: 'var(--on-accent)', border: '1px solid rgba(20,131,79,0.22)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 900, transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 },
  oddzialyRow: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  oddzialCard: { background: '#ffffff', border: '1px solid rgba(15,95,58,0.13)', borderRadius: 8, padding: '12px 16px', cursor: 'pointer', boxShadow: '0 10px 24px rgba(31,79,50,0.06)', minWidth: 140, transition: 'all 0.2s' },
  oddzialNazwa: { fontSize: 13, fontWeight: '600', color: 'var(--text)', marginBottom: 6 },
  oddzialStats: { display: 'flex', gap: 8, fontSize: 11, flexWrap: 'wrap' },
  oddzialTotal: { fontSize: 10, color: 'var(--text-muted)', marginTop: 6 },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap', background: 'linear-gradient(90deg, rgba(15,107,63,0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(15,107,63,0.035) 1px, transparent 1px), linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,249,244,0.94))', backgroundSize: '32px 32px, 32px 32px, auto', border: '1px solid rgba(15,95,58,0.13)', padding: '12px 16px', borderRadius: 8, boxShadow: '0 10px 24px rgba(31,79,50,0.055)' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  filtrLabel: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  filtrSelect: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', backgroundColor: 'var(--surface-field)', color: 'var(--text)' },
  clearBtn: { padding: '6px 12px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500' },
  filtrCount: { marginLeft: 'auto', fontSize: 13, color: 'var(--accent)', fontWeight: '600' },
  tableWrap: { background: '#ffffff', border: '1px solid rgba(15,95,58,0.13)', borderRadius: 8, overflow: 'auto', boxShadow: '0 10px 24px rgba(31,79,50,0.06)' },
  cardsWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 },
  taskCard: {
    background: '#ffffff',
    border: '1px solid rgba(15,95,58,0.13)',
    borderRadius: 8,
    boxShadow: '0 10px 24px rgba(31,79,50,0.06)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  taskCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  taskMeta: { fontSize: 12, color: 'var(--text-sub)' },
  taskRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  taskDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  taskActions: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th: { padding: '12px 14px', backgroundColor: 'var(--surface-field)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 13, fontWeight: '700', position: 'sticky', top: 0 },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' },
  idBadge: { backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 6, fontSize: 13, fontWeight: '600' },
  klientNazwa: { fontWeight: '600', color: 'var(--text)' },
  klientTel: { fontSize: 11, color: 'var(--accent)', marginTop: 2 },
  miasto: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  badge: { padding: '3px 10px', borderRadius: 999, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  oddzialBadge: { backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 6, fontSize: 12 },
  priorytetBadge: (priorytet) => ({
    display: 'inline-block',
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 4,
    marginTop: 4,
    backgroundColor: priorytet === 'Pilny' ? '#FFEBEE' : priorytet === 'Wysoki' ? '#FFF8E1' : 'rgba(52,211,153,0.1)',
    color: priorytet === 'Pilny' ? '#EF5350' : priorytet === 'Wysoki' ? '#F9A825' : 'var(--accent)'
  }),
  select: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', backgroundColor: 'var(--surface-field)', color: 'var(--text)', minWidth: 130 },
  detailBtn: { padding: '5px 12px', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s' },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 }
};
