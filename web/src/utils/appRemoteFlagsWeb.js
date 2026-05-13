/**
 * Zgodnie z mobile `app-remote-flags.ts` — flagi boolean z konfiguracji (np. autoplanRelaxApplyRoles).
 */
export function getAppFlagSync(key, defaultValue = false) {
  try {
    const raw = localStorage.getItem('app_remote_flags_v1');
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, key)) {
      return Boolean(parsed[key]);
    }
  } catch {
    /* ignore */
  }
  return defaultValue;
}
