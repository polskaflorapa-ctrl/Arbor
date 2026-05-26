/**
 * ARBOR-OS: Centralny klient HTTP
 * Automatycznie dodaje token JWT do każdego żądania
 * i przekierowuje do loginu gdy token wygaśnie (401)
 */
import axios from 'axios';
import { getReactApiBase } from './utils/apiBase';
import { getStoredToken } from './utils/storedToken';
import {
  getMockData,
  isTestModeEnabled,
  getTestUser,
  TEST_TOKEN,
  getMockTaskDetail,
  getMockTaskLogi,
  getMockTaskPhotos,
  getMockTaskProblems,
  mockAddTaskPhotoInTestMode,
  mockDeleteTaskPhotoInTestMode,
  mockMarkTaskFinishedInTestMode,
  mockUpdateTaskInTestMode,
  getMockQuotationDetail,
} from './utils/testMode';

/** Vite dev: API_URL=/api + proxy z `vite.config.js` (ARBOR_API_PROXY_TARGET) omija CORS. */
const API_URL = getReactApiBase();
let isRedirectingToLogin = false;
const API_URL_WITHOUT_API_SUFFIX = API_URL.replace(/\/api\/?$/, '');
const HAS_VALID_API_FALLBACK_BASE =
  Boolean(API_URL_WITHOUT_API_SUFFIX) &&
  API_URL_WITHOUT_API_SUFFIX !== API_URL;
const isUnsafeFallbackBase = API_URL_WITHOUT_API_SUFFIX === '/' || API_URL_WITHOUT_API_SUFFIX === '.';
const MOCK_OPS_EVENTS_KEY = 'arbor-test-mode-ops-action-events';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

// Axios 1.x may expose adapter names (e.g. ['xhr', 'http', 'fetch']) instead of a function.
// Resolve it before overriding the adapter for test-mode mocks.
const originalAdapter = axios.getAdapter
  ? axios.getAdapter(api.defaults.adapter || axios.defaults.adapter)
  : api.defaults.adapter || axios.defaults.adapter;

function getRequestPath(url) {
  if (!url) return '';
  let path = String(url).split('?')[0].replace(/\/+$|\/\?+$/g, '');
  try {
    if (/^https?:\/\//i.test(path)) {
      path = new URL(path).pathname.replace(/\/+$/g, '');
    }
  } catch {
    // Keep the original path when URL parsing fails.
  }
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/^\/api(?=\/|$)/, '') || '/';
}

function parseJsonData(data) {
  if (!data) return {};
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data;
}

function getRequestDate(config) {
  const fromParams = config?.params?.date;
  if (fromParams) return String(fromParams);
  try {
    const raw = String(config?.url || '');
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
    return new URLSearchParams(query).get('date') || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getMockOpsEvents() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(MOCK_OPS_EVENTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMockOpsEvents(events) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MOCK_OPS_EVENTS_KEY, JSON.stringify(events.slice(-200)));
}

function addMockOpsEvent(event) {
  const events = getMockOpsEvents();
  const next = {
    id: Date.now(),
    created_at: new Date().toISOString(),
    ...event,
  };
  events.push(next);
  saveMockOpsEvents(events);
  return next;
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row?.[key];
    if (value) acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getTestUserForLogin(login) {
  const normalized = String(login || '').trim().toLowerCase();
  if (normalized.includes('dyrektor')) return getTestUser('dyrektor');
  if (normalized.includes('kierownik')) return getTestUser('kierownik');
  if (normalized.includes('brygadzista')) return getTestUser('brygadzista');
  if (normalized.includes('wyceniajacy') || normalized.includes('wyceniający')) return getTestUser('wyceniajacy');
  return getTestUser('dyrektor');
}

function getTestModeMockResponse(config) {
  const method = String(config?.method || 'get').toLowerCase();
  const path = getRequestPath(String(config.url || ''));

  if (path === '/auth/login' && method === 'post') {
    const body = parseJsonData(config.data);
    const user = getTestUserForLogin(body.login);
    return {
      data: { token: TEST_TOKEN, user },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  if (path === '/ops/kierownik-today' && method === 'get') {
    const date = getRequestDate(config);
    const tasks = (getMockData('/tasks/wszystkie') || []).filter((task) => {
      const planned = String(task.data_planowana || '').slice(0, 10);
      return !planned || planned === date;
    });
    const teams = getMockData('/ekipy') || [];
    const openTasks = tasks.filter((task) => !['Zakonczone', 'Anulowane'].includes(task.status));
    const risky = openTasks
      .map((task) => {
        const blockers = [];
        if (!task.ekipa_id) blockers.push('Brak ekipy');
        if (!task.klient_telefon) blockers.push('Brak telefonu');
        if (!task.pin_lat || !task.pin_lng) blockers.push('Brak pinezki GPS');
        if (!task.czas_planowany_godziny && !task.czas_obslugi_min) blockers.push('Brak czasu pracy');
        return { task, blockers };
      })
      .filter((row) => row.blockers.length > 0);
    const blockerCounts = risky.reduce((acc, row) => {
      row.blockers.forEach((label) => {
        acc[label] = (acc[label] || 0) + 1;
      });
      return acc;
    }, {});
    return {
      data: {
        date,
        oddzial_id: config?.params?.oddzial_id || null,
        summary: {
          tasks_total: tasks.length,
          open: openTasks.length,
          done: tasks.filter((task) => task.status === 'Zakonczone').length,
          in_progress: tasks.filter((task) => task.status === 'W_Realizacji').length,
          ready_for_dispatch: Math.max(0, openTasks.length - risky.length),
          blocked: risky.length,
          unassigned: openTasks.filter((task) => !task.ekipa_id).length,
          open_issues: 0,
          unread_notifications: 0,
          active_teams: teams.length,
          assigned_teams: new Set(openTasks.map((task) => task.ekipa_id).filter(Boolean)).size,
          gps_online: 0,
          gps_attention: 0,
        },
        blockers: Object.entries(blockerCounts).map(([label, count]) => ({
          key: label.toLowerCase().replace(/\s+/g, '_'),
          label,
          count,
          action: 'Otworz zlecenia',
          tone: label.includes('ekipy') || label.includes('GPS') ? 'danger' : 'warning',
          path: '/zlecenia',
        })),
        tasks: risky.slice(0, 8).map(({ task, blockers }) => ({
          id: task.id,
          numer: task.numer || `ZLE-${String(task.id).padStart(4, '0')}`,
          klient_nazwa: task.klient_nazwa,
          status: task.status,
          blocker_labels: blockers,
          action_path: `/zlecenia/${task.id}`,
        })),
        teams: teams.slice(0, 8).map((team) => ({
          id: team.id,
          nazwa: team.nazwa,
          tasks_total: openTasks.filter((task) => String(task.ekipa_id) === String(team.id)).length,
          in_progress: openTasks.filter((task) => String(task.ekipa_id) === String(team.id) && task.status === 'W_Realizacji').length,
          gps_status: 'missing',
          gps_age_min: null,
        })),
        generated_at: new Date().toISOString(),
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  if (path === '/ops/plan-vs-real' && method === 'get') {
    const date = getRequestDate(config);
    const oddzialId = config?.params?.oddzial_id || null;
    const sourceTasks = (getMockData('/tasks/wszystkie') || []).filter((task) => {
      const planned = String(task.data_planowana || '').slice(0, 10);
      if (planned && planned !== date) return false;
      return !oddzialId || String(task.oddzial_id || '') === String(oddzialId);
    });
    const closedStatuses = ['Zakonczone', 'Anulowane'];
    const rows = sourceTasks.map((task) => {
      const plannedMinutes = Math.max(0, Math.round(Number(task.czas_obslugi_min || 0) || Number(task.czas_planowany_godziny || 0) * 60));
      const hasStarted = task.status === 'W_Realizacji' || task.status === 'Zakonczone';
      const hasFinished = task.status === 'Zakonczone';
      const realMinutes = hasFinished
        ? Math.max(0, plannedMinutes - 10)
        : hasStarted
          ? plannedMinutes + 45
          : 0;
      let issue = null;
      if (plannedMinutes <= 0) issue = { key: 'missing_duration', label: 'Brak czasu planu', tone: 'warning', rank: 2 };
      else if (hasStarted && realMinutes > plannedMinutes + 30) issue = { key: 'overrun', label: 'Przekroczenie planu', tone: 'danger', rank: 0 };
      else if (hasStarted && !hasFinished && !closedStatuses.includes(task.status)) issue = { key: 'missing_finish', label: 'Brak zamkniecia', tone: 'warning', rank: 1 };
      else if (!hasStarted && !closedStatuses.includes(task.status)) issue = { key: 'not_started', label: 'Nie wystartowalo', tone: 'warning', rank: 3 };
      return {
        id: task.id,
        numer: task.numer || `ZLE-${String(task.id).padStart(4, '0')}`,
        klient_nazwa: task.klient_nazwa,
        status: task.status,
        ekipa_id: task.ekipa_id,
        ekipa_nazwa: task.ekipa_nazwa,
        oddzial_id: task.oddzial_id,
        oddzial_nazwa: task.oddzial_nazwa,
        planned_minutes: plannedMinutes,
        real_minutes: realMinutes,
        delta_minutes: realMinutes - plannedMinutes,
        has_started: hasStarted,
        has_finished: hasFinished,
        logs_total: hasStarted ? 1 : 0,
        wartosc_planowana: Number(task.wartosc_planowana || task.budzet || 0),
        wartosc_rzeczywista: Number(task.wartosc_rzeczywista || 0),
        ...(issue ? {
          issue_key: issue.key,
          issue_label: issue.label,
          tone: issue.tone,
          issue_rank: issue.rank,
          action_path: `/zlecenia/${task.id}`,
        } : {}),
      };
    });
    const finished = rows.filter((task) => task.status === 'Zakonczone' || task.has_finished);
    const plannedMinutes = rows.reduce((sum, task) => sum + task.planned_minutes, 0);
    const realMinutes = rows.reduce((sum, task) => sum + task.real_minutes, 0);
    const issueCount = (key) => rows.filter((task) => task.issue_key === key).length;
    return {
      data: {
        date,
        oddzial_id: oddzialId,
        summary: {
          planned_tasks: rows.length,
          started_tasks: rows.filter((task) => task.has_started).length,
          finished_tasks: finished.length,
          not_started_tasks: issueCount('not_started'),
          overrun_tasks: issueCount('overrun'),
          missing_finish_tasks: issueCount('missing_finish'),
          missing_duration_tasks: issueCount('missing_duration'),
          planned_minutes: plannedMinutes,
          real_minutes: realMinutes,
          delta_minutes: realMinutes - plannedMinutes,
          value_planned: rows.reduce((sum, task) => sum + task.wartosc_planowana, 0),
          value_done: finished.reduce((sum, task) => sum + (task.wartosc_rzeczywista || task.wartosc_planowana), 0),
        },
        issues: ['overrun', 'missing_finish', 'missing_duration', 'not_started']
          .map((key) => ({ key, count: issueCount(key) }))
          .filter((item) => item.count > 0),
        tasks: rows
          .filter((task) => task.issue_key || Math.abs(task.delta_minutes) >= 30)
          .sort((a, b) => (a.issue_rank ?? 9) - (b.issue_rank ?? 9) || Math.abs(b.delta_minutes) - Math.abs(a.delta_minutes))
          .slice(0, 8),
        generated_at: new Date().toISOString(),
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  if (path === '/ops/action-insights' && method === 'get') {
    const date = getRequestDate(config);
    const oddzialId = config?.params?.oddzial_id || null;
    const range = config?.params?.range === 'today' ? 'today' : 'week';
    const fromDate = new Date(`${date}T00:00:00.000Z`);
    if (range === 'week') fromDate.setUTCDate(fromDate.getUTCDate() - 6);
    const toDate = new Date(`${date}T00:00:00.000Z`);
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    const events = getMockOpsEvents().filter((event) => {
      const created = new Date(event.created_at || 0);
      if (created < fromDate || created >= toDate) return false;
      return !oddzialId || String(event.oddzial_id || '') === String(oddzialId);
    });
    const reasonLabels = {
      dojazd: 'Dojazd',
      zakres: 'Wiekszy zakres',
      sprzet: 'Sprzet',
      klient: 'Klient',
      pogoda: 'Pogoda',
      inne: 'Inne',
    };
    const issueLabels = {
      missing_duration: 'Brak czasu planu',
      not_started: 'Nie wystartowalo',
      overrun: 'Przekroczenie planu',
      missing_finish: 'Brak zamkniecia',
      under_plan: 'Ponizej planu',
    };
    const actionLabels = {
      set_duration: 'Ustawienie czasu',
      mark_reason: 'Powod odchylenia',
      remind_team: 'Przypomnienie ekipy',
    };
    const reasonCounts = countBy(events, 'reason_code');
    const issueCounts = countBy(events, 'issue_key');
    const actionCounts = countBy(events, 'action_type');
    const deltaValues = events.map((event) => Number(event.delta_minutes)).filter(Number.isFinite);
    return {
      data: {
        date,
        range,
        oddzial_id: oddzialId,
        summary: {
          total_events: events.length,
          affected_tasks: new Set(events.map((event) => event.task_id).filter(Boolean)).size,
          reasons_total: events.filter((event) => event.reason_code).length,
          reminders: actionCounts.remind_team || 0,
          duration_updates: actionCounts.set_duration || 0,
          avg_delta_minutes: deltaValues.length ? Math.round(deltaValues.reduce((sum, value) => sum + value, 0) / deltaValues.length) : 0,
          top_reason: null,
        },
        reasons: Object.entries(reasonCounts)
          .map(([reason_code, count]) => ({
            reason_code,
            label: reasonLabels[reason_code] || reason_code,
            count,
            share: events.length ? Math.round((count / events.length) * 100) : 0,
            avg_delta_minutes: 0,
          }))
          .sort((a, b) => b.count - a.count),
        issues: Object.entries(issueCounts)
          .map(([issue_key, count]) => ({ issue_key, label: issueLabels[issue_key] || issue_key, count }))
          .sort((a, b) => b.count - a.count),
        actions: Object.entries(actionCounts)
          .map(([action_type, count]) => ({ action_type, label: actionLabels[action_type] || action_type, count }))
          .sort((a, b) => b.count - a.count),
        recent: events.slice(-8).reverse().map((event) => ({
          ...event,
          action_label: actionLabels[event.action_type] || event.action_type,
          issue_label: issueLabels[event.issue_key] || event.issue_key,
          reason_label: reasonLabels[event.reason_code] || event.reason_code,
        })),
        generated_at: new Date().toISOString(),
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mPlanRealAction = path.match(/^\/ops\/plan-vs-real\/tasks\/(\d+)\/action$/);
  if (mPlanRealAction && method === 'post') {
    const body = parseJsonData(config.data);
    const taskId = mPlanRealAction[1];
    const current = getMockTaskDetail(taskId);
    const noteLine = `PLAN VS REAL / ${body.action || 'action'} / ${new Date().toISOString()}`;
    const nextNotes = [current?.notatki_wewnetrzne, noteLine, body.note].filter(Boolean).join('\n\n');
    let patch = { notatki_wewnetrzne: nextNotes };
    let message = 'Akcja zapisana';
    let notificationCount = 0;
    if (body.action === 'set_duration') {
      const minutes = Math.max(15, Math.round(Number(body.planned_minutes || Number(body.planned_hours || 0) * 60 || 120)));
      patch = {
        ...patch,
        czas_planowany_godziny: Math.round((minutes / 60) * 100) / 100,
        czas_obslugi_min: minutes,
      };
      message = 'Czas planu zapisany';
    } else if (body.action === 'mark_reason') {
      patch = {
        ...patch,
        plan_real_reason_code: body.reason_code || 'inne',
      };
      message = 'Powod zapisany';
    } else if (body.action === 'remind_team') {
      message = 'Przypomnienie wyslane';
      notificationCount = current?.ekipa_id ? 1 : 0;
    }
    const event = addMockOpsEvent({
      task_id: Number(taskId),
      oddzial_id: current?.oddzial_id || null,
      action_type: body.action,
      issue_key: body.issue_key || (body.action === 'set_duration' ? 'missing_duration' : body.action === 'remind_team' ? 'not_started' : 'overrun'),
      reason_code: body.reason_code || null,
      delta_minutes: Number.isFinite(Number(body.delta_minutes)) ? Math.round(Number(body.delta_minutes)) : null,
      planned_minutes: Number.isFinite(Number(patch.czas_obslugi_min || body.planned_minutes)) ? Math.round(Number(patch.czas_obslugi_min || body.planned_minutes)) : null,
      real_minutes: Number.isFinite(Number(body.real_minutes)) ? Math.round(Number(body.real_minutes)) : null,
      numer: current?.numer || `ZLE-${String(taskId).padStart(4, '0')}`,
      klient_nazwa: current?.klient_nazwa,
      notification_count: notificationCount,
    });
    return {
      data: {
        message,
        action: body.action,
        task: mockUpdateTaskInTestMode(taskId, patch),
        event,
        notification_count: notificationCount,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  if (path === '/ekipy/attendance' && method === 'get') {
    const date = getRequestDate(config);
    const teams = getMockData('/ekipy') || [];
    const items = teams.map((team) => ({
      id: `${team.id}_${date}`,
      dateYmd: date,
      teamId: String(team.id),
      teamName: team.nazwa || `Ekipa #${team.id}`,
      present: true,
      note: '',
      actor: 'Tryb testowy',
      at: new Date().toISOString(),
      oddzial_id: team.oddzial_id || null,
    }));
    return {
      data: { date, items, summary: { total: items.length, confirmed: items.length, absent: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTeamAttendance = path.match(/^\/ekipy\/(\d+)\/attendance$/);
  if (mTeamAttendance && method === 'put') {
    const body = parseJsonData(config.data);
    const date = String(body.dateYmd || body.date || new Date().toISOString().slice(0, 10));
    const teams = getMockData('/ekipy') || [];
    const team = teams.find((item) => String(item.id) === String(mTeamAttendance[1])) || {};
    return {
      data: {
        item: {
          id: `${mTeamAttendance[1]}_${date}`,
          dateYmd: date,
          teamId: String(mTeamAttendance[1]),
          teamName: team.nazwa || `Ekipa #${mTeamAttendance[1]}`,
          present: body.present !== false,
          note: body.note || '',
          actor: 'Tryb testowy',
          at: new Date().toISOString(),
          oddzial_id: team.oddzial_id || null,
        },
        message: 'Potwierdzenie ekipy zapisane',
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksId = path.match(/^\/tasks\/(\d+)$/);
  if (mTasksId && method === 'get') {
    return {
      data: getMockTaskDetail(mTasksId[1]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }
  if (mTasksId && method === 'put') {
    const body = parseJsonData(config.data);
    return {
      data: mockUpdateTaskInTestMode(mTasksId[1], body),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksStatus = path.match(/^\/tasks\/(\d+)\/status$/);
  if (mTasksStatus && method === 'put') {
    const body = parseJsonData(config.data);
    return {
      data: mockUpdateTaskInTestMode(mTasksStatus[1], { status: body.status }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksOfficePlan = path.match(/^\/tasks\/(\d+)\/office-plan$/);
  if (mTasksOfficePlan && method === 'put') {
    const body = parseJsonData(config.data);
    const teams = getMockData('/ekipy') || [];
    const plannedTeam = teams.find((team) => String(team.id) === String(body.ekipa_id));
    const data = mockUpdateTaskInTestMode(mTasksOfficePlan[1], {
      data_planowana: body.data_planowana,
      godzina_rozpoczecia: body.godzina_rozpoczecia,
      czas_planowany_godziny: body.czas_planowany_godziny,
      ekipa_id: body.ekipa_id,
      ekipa_nazwa: plannedTeam?.nazwa || (body.ekipa_id ? `Ekipa #${body.ekipa_id}` : ''),
      sprzet_ids: body.sprzet_ids || [],
      sprzet_notatka: body.sprzet_notatka || '',
      status: 'Zaplanowane',
    });
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksLogi = path.match(/^\/tasks\/(\d+)\/logi$/);
  if (mTasksLogi && method === 'get') {
    return {
      data: getMockTaskLogi(mTasksLogi[1]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksPhotos = path.match(/^\/tasks\/(\d+)\/zdjecia$/);
  if (mTasksPhotos && method === 'get') {
    return {
      data: getMockTaskPhotos(mTasksPhotos[1]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }
  if (mTasksPhotos && method === 'post') {
    return {
      data: mockAddTaskPhotoInTestMode(mTasksPhotos[1], config.data),
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksPhotoId = path.match(/^\/tasks\/(\d+)\/zdjecia\/([^/]+)$/);
  if (mTasksPhotoId && method === 'delete') {
    return {
      data: mockDeleteTaskPhotoInTestMode(mTasksPhotoId[1], mTasksPhotoId[2]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksProblems = path.match(/^\/tasks\/(\d+)\/problemy$/);
  if (mTasksProblems && method === 'get') {
    return {
      data: getMockTaskProblems(mTasksProblems[1]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mQuotationsId = path.match(/^\/quotations\/(\d+)$/);
  if (mQuotationsId && method === 'get') {
    return {
      data: getMockQuotationDetail(mQuotationsId[1]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mQuotationsResend = path.match(/^\/quotations\/(\d+)\/resend-client-offer$/);
  if (mQuotationsResend && method === 'post') {
    return {
      data: getMockQuotationDetail(mQuotationsResend[1]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mTasksFinish = path.match(/^\/tasks\/(\d+)\/finish$/);
  if (mTasksFinish && method === 'post') {
    mockMarkTaskFinishedInTestMode(mTasksFinish[1]);
    return {
      data: { message: 'Zlecenie zakończone', wartosc_netto_do_rozliczenia: 1425 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  const mockData = getMockData(path);
  if (mockData !== null) {
    return {
      data: mockData,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {},
    };
  }

  return null;
}

api.defaults.adapter = async (config) => {
  if (isTestModeEnabled()) {
    const mockResponse = getTestModeMockResponse(config);
    if (mockResponse) return mockResponse;
  }
  return originalAdapter(config);
};

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK']);
const NETWORK_RETRY_DELAY_MS = 400;
const NETWORK_COOLDOWN_MS = 3000;
const inFlightGetRequests = new Map();
let networkCooldownUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return String(value ?? '');
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${key}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function buildGetDedupeKey(url, config = {}) {
  const baseURL = config.baseURL || api.defaults.baseURL || '';
  const paramsKey = stableStringify(config.params || {});
  return `${baseURL}|${url}|${paramsKey}`;
}

const originalGet = api.get.bind(api);
api.get = (url, config = {}) => {
  if (config?.dedupe === false) {
    return originalGet(url, config);
  }

  const key = buildGetDedupeKey(url, config);
  const inFlight = inFlightGetRequests.get(key);
  if (inFlight) return inFlight;

  const request = originalGet(url, config).finally(() => {
    inFlightGetRequests.delete(key);
  });
  inFlightGetRequests.set(key, request);
  return request;
};

function buildRequestDebug(config, response) {
  const method = (config?.method || 'get').toUpperCase();
  const baseURL = config?.baseURL || api.defaults.baseURL || '';
  const urlPath = config?.url || '';
  let fullUrl = `${baseURL}${urlPath}`;
  try {
    if (baseURL && urlPath) {
      fullUrl = new URL(urlPath, baseURL).toString();
    }
  } catch {
    // Fallback to concatenation when URL cannot be resolved.
  }

  return {
    method,
    baseURL,
    urlPath,
    fullUrl,
    status: response?.status,
    responseData: response?.data,
  };
}

// ── Request interceptor: dodaj token do każdego żądania ───────────────────────
api.interceptors.request.use(
  (config) => {
    const method = String(config?.method || 'get').toLowerCase();
    if (method === 'get' && Date.now() < networkCooldownUntil) {
      const cooldownError = new Error('Network cooldown in progress');
      cooldownError.code = 'ERR_NETWORK_COOLDOWN';
      cooldownError.userMessage = 'Sieć chwilowo przeciążona. Ponawiam za moment.';
      return Promise.reject(cooldownError);
    }

    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: obsługa 401 (token wygasł) ─────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const requestDebug = buildRequestDebug(config, error.response);
    error.requestDebug = requestDebug;
    const canRetryWithoutApiPrefix =
      error.response?.status === 404 &&
      !config._retriedWithoutApiPrefix &&
      typeof config.url === 'string' &&
      config.url.startsWith('/') &&
      HAS_VALID_API_FALLBACK_BASE;

    if (canRetryWithoutApiPrefix) {
      config._retriedWithoutApiPrefix = true;
      const retryBaseURL = isUnsafeFallbackBase ? API_URL : API_URL_WITHOUT_API_SUFFIX;
      return api.request({
        ...config,
        baseURL: retryBaseURL,
      });
    }

    const method = String(config.method || 'get').toLowerCase();
    const canRetryNetworkRequest =
      method === 'get' &&
      !config._retriedNetworkOnce &&
      (RETRYABLE_ERROR_CODES.has(error.code) || RETRYABLE_STATUS_CODES.has(error.response?.status));

    if (canRetryNetworkRequest) {
      config._retriedNetworkOnce = true;
      await sleep(NETWORK_RETRY_DELAY_MS);
      return api.request(config);
    }

    if (error.code === 'ECONNABORTED') {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage = 'Przekroczono czas oczekiwania na odpowiedź serwera.';
    } else if (error.code === 'ERR_NETWORK') {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage = `Brak połączenia z serwerem (${requestDebug.fullUrl || API_URL}).`;
    } else if (error.code === 'ERR_NETWORK_COOLDOWN') {
      error.userMessage = 'Sieć chwilowo przeciążona. Ponawiam za moment.';
    } else if (error.response?.status === 404) {
      error.userMessage = `Nie znaleziono zasobu API (${requestDebug.method} ${requestDebug.fullUrl || requestDebug.urlPath}).`;
    } else if (error.response?.status === 502 || error.response?.status === 504) {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage =
        'Backend API nie odpowiada (brama/proxy). Uruchom API: w katalogu projektu `npm run server` lub `cd server && npm start` ' +
        '(domyślnie http://localhost:3001). W dev Vite żądania `/api` idą przez proxy w `vite.config.js` — ustaw `ARBOR_API_PROXY_TARGET` w `.env.local`, jeśli API jest na innym hoście/porcie.';
    } else if (error.response?.status >= 500) {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage = `Błąd serwera API (${requestDebug.method} ${requestDebug.fullUrl || requestDebug.urlPath}).`;
    }

    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      const isOnLoginPage = window.location.pathname === '/';
      if (!isOnLoginPage && !isRedirectingToLogin) {
        isRedirectingToLogin = true;
        window.location.assign('/');
      }
    }

    if (process.env.NODE_ENV !== 'production' && error.response?.status >= 400) {
      console.warn(
        `[api] request failed ${requestDebug.status || ''} ${requestDebug.method} ${requestDebug.fullUrl || requestDebug.urlPath}`,
        requestDebug,
      );
    }

    return Promise.reject(error);
  }
);

export const API = API_URL;
export default api;
