import { apiFetch } from './api-client';

type ApiHealthPayload = {
  wersja?: unknown;
  version?: unknown;
  features?: Record<string, unknown> | null;
};

export function healthSupportsQuotations(payload: ApiHealthPayload | null): boolean {
  if (!payload) return true;

  if (payload.features && typeof payload.features === 'object') {
    return payload.features.quotations === true;
  }

  const version = String(payload.wersja ?? payload.version ?? '');
  return version.toLowerCase().includes('quotations');
}

export async function fetchApiHealth(): Promise<ApiHealthPayload | null> {
  const response = await apiFetch('/health');
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export async function supportsQuotationsModule(): Promise<boolean> {
  try {
    return healthSupportsQuotations(await fetchApiHealth());
  } catch {
    return true;
  }
}
