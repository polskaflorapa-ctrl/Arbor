/**
 * Logika autoplanu zsynchronizowana z mobile (`autoplan-dnia.tsx`, `autoplan-rules-local.ts`, `autoplan-history.ts`).
 * Klucze localStorage identyczne z aplikacją mobilną — historia KPI tygodnia jest wspólna przy tym samym profilu przeglądarki.
 */

const HISTORY_KEY = 'autoplan_history_v1';
const RULES_KEY = 'autoplan_rules_v1';
const MAX_HISTORY_ITEMS = 30;

export const DEFAULT_AUTOPLAN_RULES = {
  maxTasksPerTeam: 12,
  cityDenylist: [],
};

export function loadAutoplanRules() {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return { ...DEFAULT_AUTOPLAN_RULES };
    const p = JSON.parse(raw);
    const max = Number(p.maxTasksPerTeam);
    const cityDenylist = Array.isArray(p.cityDenylist)
      ? p.cityDenylist.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : [];
    return {
      maxTasksPerTeam:
        Number.isFinite(max) && max >= 1 && max <= 50 ? Math.floor(max) : DEFAULT_AUTOPLAN_RULES.maxTasksPerTeam,
      cityDenylist,
    };
  } catch {
    return { ...DEFAULT_AUTOPLAN_RULES };
  }
}

export function saveAutoplanRules(r) {
  localStorage.setItem(
    RULES_KEY,
    JSON.stringify({
      maxTasksPerTeam: Math.min(50, Math.max(1, Math.floor(r.maxTasksPerTeam))),
      cityDenylist: r.cityDenylist.map((x) => x.trim().toLowerCase()).filter(Boolean),
    }),
  );
}

export function loadAutoplanHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendAutoplanHistory(item) {
  const existing = loadAutoplanHistory();
  const next = [
    {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
    },
    ...existing,
  ].slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

const PRIORITY_MAP = {
  wysoki: 3,
  high: 3,
  pilny: 3,
  średni: 2,
  sredni: 2,
  medium: 2,
  niski: 1,
  low: 1,
};

export function parsePriority(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return 1;
  return PRIORITY_MAP[s] ?? 1;
}

/**
 * @param {(key: string) => string} tr Tłumaczenia — klucze jak w mobile: `autoplan.unknownClient` → przekaż (k) => t(`pages.autoplan.labels.${k}`) po mapowaniu w komponencie
 */
export function buildPlan(tasks, teams, tr, mode, rules) {
  const tFull = typeof tr === 'function' ? tr : (k) => k;
  if (!tasks.length) return [];
  if (!teams.length) {
    return tasks.map((task) => ({
      taskId: String(task.id),
      client: task.klient_nazwa || tFull('unknownClient'),
      city: task.miasto || tFull('unknownCity'),
      priority: parsePriority(task.priorytet),
      currentTeamId: String(task.ekipa_id ?? ''),
      currentStatus: String(task.status ?? ''),
      suggestedTeamId: '',
      suggestedTeam: tFull('noTeamAvailable'),
      reason: tFull('reasonNoTeam'),
      travelPenalty: 0,
      loadScore: 0,
    }));
  }

  const teamLoad = new Map();
  for (const tm of teams) teamLoad.set(String(tm.id), 0);

  const sortedTasks = [...tasks].sort((a, b) => {
    const p = parsePriority(b.priorytet) - parsePriority(a.priorytet);
    if (p !== 0) return p;
    const ad = String(a.data_planowana || '');
    const bd = String(b.data_planowana || '');
    return ad.localeCompare(bd);
  });

  const plan = [];
  for (const task of sortedTasks) {
    const taskCity = String(task.miasto || '').trim().toLowerCase();
    const cityBlocked =
      rules.cityDenylist.length > 0 &&
      rules.cityDenylist.some((d) => d && (taskCity.includes(d) || d.includes(taskCity)));
    if (cityBlocked) {
      plan.push({
        taskId: String(task.id),
        client: task.klient_nazwa || tFull('unknownClient'),
        city: task.miasto || tFull('unknownCity'),
        priority: parsePriority(task.priorytet),
        currentTeamId: String(task.ekipa_id ?? ''),
        currentStatus: String(task.status ?? ''),
        suggestedTeamId: '',
        suggestedTeam: tFull('noTeamAvailable'),
        reason: tFull('reasonCityBlocked'),
        travelPenalty: 0,
        loadScore: 0,
      });
      continue;
    }

    let bestTeam = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const team of teams) {
      const id = String(team.id);
      const load = teamLoad.get(id) ?? 0;
      if (load >= rules.maxTasksPerTeam) continue;
      let score = -load * 2;
      const teamCity = String(team.oddzial_nazwa || '').toLowerCase();
      const cityMatch = taskCity && teamCity && taskCity.includes(teamCity);
      if (cityMatch) score += 3;
      if (mode === 'cost') score += cityMatch ? 4 : -1;
      if (mode === 'fast') score += cityMatch ? 2 : -3;
      if (mode === 'fast') score += parsePriority(task.priorytet) * 1.5;
      if (mode === 'cost') score -= parsePriority(task.priorytet) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestTeam = team;
      }
    }

    let picked = bestTeam;
    let overload = false;
    if (!picked) {
      overload = true;
      picked = [...teams].reduce((a, b) =>
        (teamLoad.get(String(a.id)) ?? 0) <= (teamLoad.get(String(b.id)) ?? 0) ? a : b,
      );
    }
    const pickedId = String(picked.id);
    teamLoad.set(pickedId, (teamLoad.get(pickedId) ?? 0) + 1);

    const reasonBits = [tFull('reasonPriority'), tFull('reasonLoad')];
    if (overload) reasonBits.push(tFull('reasonOverload'));
    const match = taskCity && String(picked.oddzial_nazwa || '').toLowerCase().includes(taskCity);
    if (match) {
      reasonBits.push(tFull('reasonCityMatch'));
    }
    if (mode === 'cost') reasonBits.push(tFull('reasonCostMode'));
    if (mode === 'fast') reasonBits.push(tFull('reasonFastMode'));

    plan.push({
      taskId: String(task.id),
      client: task.klient_nazwa || tFull('unknownClient'),
      city: task.miasto || tFull('unknownCity'),
      priority: parsePriority(task.priorytet),
      currentTeamId: String(task.ekipa_id ?? ''),
      currentStatus: String(task.status ?? ''),
      suggestedTeamId: pickedId,
      suggestedTeam: picked.nazwa || `#${picked.id}`,
      reason: reasonBits.join(' · '),
      travelPenalty: match ? 0 : 1,
      loadScore: teamLoad.get(pickedId) ?? 1,
    });
  }
  return plan;
}

export function calcPlanKpi(rows) {
  const tasks = rows.length;
  const travelRisk = rows.reduce((acc, r) => acc + r.travelPenalty, 0);
  const avgLoad = tasks ? rows.reduce((acc, r) => acc + r.loadScore, 0) / tasks : 0;
  const score = Number((100 - travelRisk * 8 - avgLoad * 2).toFixed(1));
  return {
    tasks,
    travelRisk,
    avgLoad: Number(avgLoad.toFixed(1)),
    score,
  };
}

export function startOfWeekUtc(d = new Date()) {
  const x = new Date(d);
  const day = x.getUTCDay();
  const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
