import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'autoplan_rules_v1';

export type AutoplanRules = {
  maxTasksPerTeam: number;
  cityDenylist: string[];
};

export const DEFAULT_AUTOPLAN_RULES: AutoplanRules = {
  maxTasksPerTeam: 12,
  cityDenylist: [] as string[],
};

export const loadAutoplanRules = async (): Promise<AutoplanRules> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_AUTOPLAN_RULES };
    const p = JSON.parse(raw) as Partial<AutoplanRules>;
    const max = Number(p.maxTasksPerTeam);
    const cityDenylist = Array.isArray(p.cityDenylist)
      ? p.cityDenylist.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : [];
    return {
      maxTasksPerTeam: Number.isFinite(max) && max >= 1 && max <= 50 ? Math.floor(max) : DEFAULT_AUTOPLAN_RULES.maxTasksPerTeam,
      cityDenylist,
    };
  } catch {
    return { ...DEFAULT_AUTOPLAN_RULES };
  }
};

export const saveAutoplanRules = async (r: AutoplanRules): Promise<void> => {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      maxTasksPerTeam: Math.min(50, Math.max(1, Math.floor(r.maxTasksPerTeam))),
      cityDenylist: r.cityDenylist.map((x) => x.trim().toLowerCase()).filter(Boolean),
    }),
  );
};
