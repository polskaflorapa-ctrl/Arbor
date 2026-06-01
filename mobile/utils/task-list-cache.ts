import AsyncStorage from '@react-native-async-storage/async-storage';

const TASK_LIST_CACHE_PREFIX = 'task_list_cache_v1';
const TASK_DETAIL_CACHE_PREFIX = 'task_detail_cache_v1';
export const TASK_LIST_CACHE_TTL_MS = 18 * 60 * 60 * 1000;
export const TASK_LIST_CACHE_STALE_MS = 15 * 60 * 1000;

type TaskListCachePayload = {
  savedAt: string;
  endpoint: string;
  userId: string;
  tasks: unknown[];
};

type TaskListCacheArgs = {
  endpoint: string;
  user?: { id?: unknown; rola?: unknown; oddzial_id?: unknown } | null;
};

export type TaskListCacheHit = {
  tasks: unknown[];
  savedAt: string;
  stale: boolean;
};

type TaskDetailCachePayload = {
  savedAt: string;
  taskId: string;
  userId: string;
  task: unknown;
  logi: unknown[];
  problemy: unknown[];
  zdjecia: unknown[];
  cmrLista: unknown[];
};

type TaskDetailCacheArgs = {
  taskId: string | number;
  user?: { id?: unknown; rola?: unknown; oddzial_id?: unknown } | null;
};

export type TaskDetailCacheHit = Omit<TaskDetailCachePayload, 'userId'> & {
  stale: boolean;
};

function cacheUserId(user: TaskListCacheArgs['user']) {
  return String(user?.id || 'anonymous').trim() || 'anonymous';
}

function cacheKey(args: TaskListCacheArgs) {
  const endpointKey = String(args.endpoint || '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9:_/-]+/g, '-')
    .slice(0, 120);
  return `${TASK_LIST_CACHE_PREFIX}:${cacheUserId(args.user)}:${endpointKey}`;
}

function detailCacheKey(args: TaskDetailCacheArgs) {
  return `${TASK_DETAIL_CACHE_PREFIX}:${cacheUserId(args.user)}:${String(args.taskId || '').trim()}`;
}

function parseTaskDateKey(value: unknown) {
  if (!value) return '';
  const raw = String(value);
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return raw.slice(0, 10);
}

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isTaskForToday(task: unknown) {
  if (!task || typeof task !== 'object') return false;
  const row = task as Record<string, unknown>;
  return parseTaskDateKey(row.data_planowana ?? row.date ?? row.planned_at) === todayKey();
}

export async function saveTaskListCache(args: TaskListCacheArgs & { tasks: unknown[] }): Promise<void> {
  const payload: TaskListCachePayload = {
    savedAt: new Date().toISOString(),
    endpoint: args.endpoint,
    userId: cacheUserId(args.user),
    tasks: Array.isArray(args.tasks) ? args.tasks : [],
  };
  await AsyncStorage.setItem(cacheKey(args), JSON.stringify(payload));
}

export async function loadTodayTaskListCache(args: TaskListCacheArgs): Promise<TaskListCacheHit | null> {
  const raw = await AsyncStorage.getItem(cacheKey(args));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TaskListCachePayload>;
    if (!parsed || !Array.isArray(parsed.tasks) || !parsed.savedAt) return null;
    const savedAtMs = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAtMs)) return null;
    const ageMs = Date.now() - savedAtMs;
    if (ageMs > TASK_LIST_CACHE_TTL_MS) return null;
    const todayTasks = parsed.tasks.filter(isTaskForToday);
    if (!todayTasks.length) return null;
    return {
      tasks: todayTasks,
      savedAt: parsed.savedAt,
      stale: ageMs > TASK_LIST_CACHE_STALE_MS,
    };
  } catch {
    return null;
  }
}

export async function saveTaskDetailCache(
  args: TaskDetailCacheArgs & {
    task: unknown;
    logi?: unknown[];
    problemy?: unknown[];
    zdjecia?: unknown[];
    cmrLista?: unknown[];
  },
): Promise<void> {
  if (!args.taskId || !args.task) return;
  const payload: TaskDetailCachePayload = {
    savedAt: new Date().toISOString(),
    taskId: String(args.taskId),
    userId: cacheUserId(args.user),
    task: args.task,
    logi: Array.isArray(args.logi) ? args.logi : [],
    problemy: Array.isArray(args.problemy) ? args.problemy : [],
    zdjecia: Array.isArray(args.zdjecia) ? args.zdjecia : [],
    cmrLista: Array.isArray(args.cmrLista) ? args.cmrLista : [],
  };
  await AsyncStorage.setItem(detailCacheKey(args), JSON.stringify(payload));
}

export async function loadTaskDetailCache(args: TaskDetailCacheArgs): Promise<TaskDetailCacheHit | null> {
  const raw = await AsyncStorage.getItem(detailCacheKey(args));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TaskDetailCachePayload>;
    if (!parsed || !parsed.task || !parsed.savedAt) return null;
    const savedAtMs = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAtMs)) return null;
    const ageMs = Date.now() - savedAtMs;
    if (ageMs > TASK_LIST_CACHE_TTL_MS) return null;
    return {
      savedAt: parsed.savedAt,
      taskId: String(parsed.taskId || args.taskId),
      task: parsed.task,
      logi: Array.isArray(parsed.logi) ? parsed.logi : [],
      problemy: Array.isArray(parsed.problemy) ? parsed.problemy : [],
      zdjecia: Array.isArray(parsed.zdjecia) ? parsed.zdjecia : [],
      cmrLista: Array.isArray(parsed.cmrLista) ? parsed.cmrLista : [],
      stale: ageMs > TASK_LIST_CACHE_STALE_MS,
    };
  } catch {
    return null;
  }
}

export function formatTaskListCacheTime(savedAt: string) {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatTaskListCacheNotice(prefix: string, hit: { savedAt: string; stale?: boolean }) {
  const saved = formatTaskListCacheTime(hit.savedAt);
  const parts = [prefix.trim()];
  if (saved) parts.push(`z ${saved}`);
  if (hit.stale) parts.push('starsze niz 15 min - odswiez po powrocie sieci');
  return parts.filter(Boolean).join(' ');
}
