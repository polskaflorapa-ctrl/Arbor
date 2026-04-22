import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/api';
import { mergeAppRemoteFlags } from './app-remote-flags';
import { mergeRemoteOddzialFeatureOverrides, type OverrideMap } from './oddzial-feature-overrides';

const LAST_API_VERSION_KEY = 'arbor_last_api_version_v1';

export async function getLastReportedApiVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_API_VERSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Opcjonalny endpoint serwera: GET /api/mobile-config lub GET /api/config/mobile
 * (pełny URL: `${API_URL}/mobile-config` — patrz constants/api.)
 *
 * Odpowiedź 200 + JSON. Aplikacja akceptuje jeden z kluczy (pierwszy znaleziony):
 * - `oddzialFeatureOverrides` (preferowane)
 * - `overrides`
 * - `oddzialy`
 *
 * Opcjonalnie: `appFlags` — mapa string → boolean (np. `autoplanRelaxApplyRoles`), scalana do
 * `utils/app-remote-flags.ts` i odczytywana synchronicznie (`getAppFlagSync`).
 *
 * Wartość: mapa `oddzialId` (string, np. "1") → obiekt częściowy jak w macierzy:
 * `name`, `mission`, `focus`, `startPath`, `allowed[]`, `priorityOrder[]`.
 * Ścieżki w `allowed` / `priorityOrder` muszą być znane z `OddzialFeatureKey` (utils/oddzial-features).
 *
 * Przykład pliku: config/mobile-config.example.json
 *
 * Nagłówki (zalecane): `X-Api-Version: 1.4.0` — zapisywane lokalnie do diagnostyki.
 */
export async function fetchAndApplyMobileRemoteConfig(token: string | null): Promise<{
  ok: boolean;
  applied: boolean;
  detail: string;
}> {
  const paths = [`${API_URL}/mobile-config`, `${API_URL}/config/mobile`];
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  for (const url of paths) {
    try {
      const res = await fetch(url, { headers });
      const ver = res.headers.get('x-api-version') || res.headers.get('X-Api-Version');
      if (ver) await AsyncStorage.setItem(LAST_API_VERSION_KEY, ver);

      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return { ok: true, applied: false, detail: 'empty_json' };
      }
      const appFlags = body.appFlags as Record<string, unknown> | undefined;
      let flagsApplied = false;
      if (appFlags && typeof appFlags === 'object') {
        await mergeAppRemoteFlags(appFlags);
        flagsApplied = true;
      }
      const raw =
        (body.oddzialFeatureOverrides as OverrideMap | undefined) ||
        (body.overrides as OverrideMap | undefined) ||
        (body.oddzialy as OverrideMap | undefined);
      if (raw && typeof raw === 'object') {
        await mergeRemoteOddzialFeatureOverrides(raw);
        return { ok: true, applied: true, detail: flagsApplied ? `${url}|overrides+flags` : url };
      }
      if (flagsApplied) return { ok: true, applied: true, detail: `${url}|flags_only` };
      return { ok: true, applied: false, detail: 'no_overrides_key' };
    } catch {
      /* try next path */
    }
  }
  return { ok: false, applied: false, detail: 'unreachable' };
}
