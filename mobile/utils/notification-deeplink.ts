type NotificationData = Record<string, unknown> | undefined | null;

const FALLBACK_NOTIFICATION_PATH = '/powiadomienia';

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(data: NotificationData, keys: string[]) {
  if (!data) return '';
  for (const key of keys) {
    const value = stringValue(data[key]);
    if (value) return value;
  }
  return '';
}

function firstId(data: NotificationData, keys: string[]) {
  if (!data) return '';
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
    const raw = stringValue(value);
    if (/^\d+$/.test(raw)) return raw;
  }
  return '';
}

function normalizeInternalPath(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return normalizeInternalPath(`${url.pathname}${url.search}`);
    } catch {
      return '';
    }
  }
  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const path = withoutScheme.startsWith('/') ? withoutScheme : raw;
  if (!path.startsWith('/')) return '';
  if (path.startsWith('//')) return '';
  return path;
}

/** Expo Router path for a push notification payload. */
export function getNotificationDeepLink(data: NotificationData): string {
  const taskId = firstId(data, ['taskId', 'task_id', 'zlecenieId', 'zlecenie_id', 'orderId', 'order_id']);
  if (taskId) {
    const tab = firstString(data, ['tab']);
    const suffix = tab && /^[a-zA-Z0-9_-]+$/.test(tab) ? `?tab=${encodeURIComponent(tab)}` : '';
    return `/zlecenie/${taskId}${suffix}`;
  }

  const explicitPath = normalizeInternalPath(firstString(data, ['path', 'url', 'route', 'href']));
  if (explicitPath) return explicitPath;

  const type = firstString(data, ['type']);
  const screen = normalizeInternalPath(firstString(data, ['screen']));
  if (type === 'autoplan_daily_brief' || screen === '/autoplan-dnia') return '/autoplan-dnia';
  if (type === 'quotation_approval' || screen === '/wyceny-terenowe') return '/wyceny-terenowe';
  if (type === 'reservation_day_end' || screen === '/rezerwacje-sprzetu') return '/rezerwacje-sprzetu';
  if (type === 'raport_dnia_ekipy' || type === 'payroll_team_day_approved') return FALLBACK_NOTIFICATION_PATH;
  if (screen) return screen;

  return FALLBACK_NOTIFICATION_PATH;
}
