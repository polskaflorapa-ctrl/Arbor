import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OddzialFeatureConfig, OddzialFeatureKey } from './oddzial-features';

const ODDZIAL_OVERRIDES_KEY = 'oddzial_feature_overrides_v1';
const ODDZIAL_OVERRIDES_AUDIT_KEY = 'oddzial_feature_overrides_audit_v1';

export type OddzialFeatureOverride = Partial<
  Pick<OddzialFeatureConfig, 'name' | 'mission' | 'focus' | 'startPath' | 'allowed' | 'priorityOrder'>
>;

export type OverrideMap = Record<string, OddzialFeatureOverride>;
export type OddzialOverrideAuditEntry = {
  id: string;
  ts: string;
  actorId?: string | number | null;
  actorName?: string | null;
  action: 'set_override' | 'clear_override' | 'import_overrides';
  oddzialId?: string;
};

let runtimeOverrides: OverrideMap = {};
let runtimeAudit: OddzialOverrideAuditEntry[] = [];

export const getOddzialFeatureOverridesSync = (): OverrideMap => runtimeOverrides;

/** Scalanie nadpisań z serwera (np. GET /mobile-config) z lokalnymi. */
export const mergeRemoteOddzialFeatureOverrides = async (patch: OverrideMap): Promise<void> => {
  if (!patch || typeof patch !== 'object') return;
  for (const [id, o] of Object.entries(patch)) {
    if (!o || typeof o !== 'object') continue;
    const prev = runtimeOverrides[id] || {};
    runtimeOverrides = { ...runtimeOverrides, [id]: { ...prev, ...o } };
  }
  await persist();
};
export const getOddzialFeatureAuditSync = (): OddzialOverrideAuditEntry[] => runtimeAudit;

export const hydrateOddzialFeatureOverrides = async (): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(ODDZIAL_OVERRIDES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OverrideMap;
      runtimeOverrides = parsed && typeof parsed === 'object' ? parsed : {};
    } else {
      runtimeOverrides = {};
    }
  } catch {
    runtimeOverrides = {};
  }
  try {
    const rawAudit = await AsyncStorage.getItem(ODDZIAL_OVERRIDES_AUDIT_KEY);
    if (rawAudit) {
      const parsedAudit = JSON.parse(rawAudit) as OddzialOverrideAuditEntry[];
      runtimeAudit = Array.isArray(parsedAudit) ? parsedAudit : [];
    } else {
      runtimeAudit = [];
    }
  } catch {
    runtimeAudit = [];
  }
};

const persist = async () => {
  await AsyncStorage.setItem(ODDZIAL_OVERRIDES_KEY, JSON.stringify(runtimeOverrides));
};
const persistAudit = async () => {
  await AsyncStorage.setItem(ODDZIAL_OVERRIDES_AUDIT_KEY, JSON.stringify(runtimeAudit));
};

const appendAudit = async (entry: Omit<OddzialOverrideAuditEntry, 'id' | 'ts'>) => {
  const full: OddzialOverrideAuditEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  runtimeAudit = [full, ...runtimeAudit].slice(0, 100);
  await persistAudit();
};

export const setOddzialFeatureOverride = async (
  oddzialId: string | number,
  override: OddzialFeatureOverride,
  actor?: { id?: string | number | null; name?: string | null },
): Promise<void> => {
  runtimeOverrides = {
    ...runtimeOverrides,
    [String(oddzialId)]: override,
  };
  await persist();
  await appendAudit({
    action: 'set_override',
    oddzialId: String(oddzialId),
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
  });
};

export const clearOddzialFeatureOverride = async (
  oddzialId: string | number,
  actor?: { id?: string | number | null; name?: string | null },
): Promise<void> => {
  const key = String(oddzialId);
  const copy = { ...runtimeOverrides };
  delete copy[key];
  runtimeOverrides = copy;
  await persist();
  await appendAudit({
    action: 'clear_override',
    oddzialId: String(oddzialId),
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
  });
};

export const sanitizeFeatureList = (features: string[]): OddzialFeatureKey[] => {
  return features as OddzialFeatureKey[];
};

export const exportOddzialOverrides = (): string =>
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      overrides: runtimeOverrides,
      audit: runtimeAudit,
    },
    null,
    2,
  );

export const importOddzialOverrides = async (
  payload: string,
  actor?: { id?: string | number | null; name?: string | null },
): Promise<void> => {
  const parsed = JSON.parse(payload) as {
    overrides?: OverrideMap;
    audit?: OddzialOverrideAuditEntry[];
  };
  runtimeOverrides = parsed?.overrides && typeof parsed.overrides === 'object'
    ? parsed.overrides
    : {};
  runtimeAudit = Array.isArray(parsed?.audit) ? parsed.audit.slice(0, 100) : [];
  await persist();
  await appendAudit({
    action: 'import_overrides',
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
  });
};
