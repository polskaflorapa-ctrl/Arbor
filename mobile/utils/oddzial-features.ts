import { getOddzialFeatureOverridesSync } from './oddzial-feature-overrides';

export type OddzialFeatureKey =
  | '/dashboard'
  | '/misja-dnia'
  | '/nowe-zlecenie'
  | '/harmonogram'
  | '/uzytkownicy-mobile'
  | '/oddzialy-mobile'
  | '/flota-mobile'
  | '/rezerwacje-sprzetu'
  | '/blokady-kalendarza'
  | '/potwierdzenia-ekip'
  | '/kpi-tydzien'
  | '/autoplan-dnia'
  | '/ogledziny'
  | '/wycena'
  | '/wycena-kalendarz'
  | '/wyceny-terenowe'
  | '/zatwierdz-wyceny'
  | '/raporty-mobilne'
  | '/rozliczenia'
  | '/zlecenia'
  | '/raport-dzienny'
  | '/wyceniajacy-hub'
  | '/wyceniajacy-finanse'
  | '/oddzial-funkcje-admin'
  | '/api-diagnostyka'
  | '/powiadomienia'
  | '/profil'
  | '/magazyn-mobile';

export type OddzialFeatureConfig = {
  name: string;
  allowed: OddzialFeatureKey[];
  mission: string;
  focus: string;
  priorityOrder: OddzialFeatureKey[];
  startPath: string;
};

type MatrixShape = {
  default: Omit<OddzialFeatureConfig, 'allowed' | 'priorityOrder'> & {
    allowed: string[];
    priorityOrder: string[];
  };
  oddzialy: Record<string, Omit<OddzialFeatureConfig, 'allowed' | 'priorityOrder'> & {
    allowed: string[];
    priorityOrder: string[];
  }>;
};

// JSON jako centralna konfiguracja funkcji oddzialow.
const MATRIX: MatrixShape = require('../config/oddzial-feature-matrix.json');

const normalizeConfig = (
  raw: MatrixShape['default'] | MatrixShape['oddzialy'][string],
): OddzialFeatureConfig => ({
  name: raw.name,
  mission: raw.mission,
  focus: raw.focus,
  startPath: raw.startPath,
  allowed: raw.allowed as OddzialFeatureKey[],
  priorityOrder: raw.priorityOrder as OddzialFeatureKey[],
});

export const getOddzialFeatureConfig = (oddzialId: string | number | null | undefined): OddzialFeatureConfig => {
  const fallback = normalizeConfig(MATRIX.default);
  const overrides = getOddzialFeatureOverridesSync();
  if (oddzialId === null || oddzialId === undefined) {
    return { ...fallback, name: 'Oddzial (nieustawiony)' };
  }
  const key = String(oddzialId);
  const row = MATRIX.oddzialy[key];
  const base = row ? normalizeConfig(row) : { ...fallback, name: `Oddzial #${key}` };
  const override = overrides[key];
  if (!override) return base;
  return {
    ...base,
    ...override,
    allowed: (override.allowed as OddzialFeatureKey[] | undefined) ?? base.allowed,
    priorityOrder: (override.priorityOrder as OddzialFeatureKey[] | undefined) ?? base.priorityOrder,
  };
};

export const isFeatureEnabledForOddzial = (
  oddzialId: string | number | null | undefined,
  path: string,
): boolean => {
  const config = getOddzialFeatureConfig(oddzialId);
  return config.allowed.includes(path as OddzialFeatureKey);
};

export const sortPathsByOddzialPriority = (
  oddzialId: string | number | null | undefined,
  paths: string[],
): string[] => {
  const { priorityOrder } = getOddzialFeatureConfig(oddzialId);
  const rank = new Map(priorityOrder.map((path, idx) => [path, idx]));
  return [...paths].sort((a, b) => {
    const ra = rank.has(a as OddzialFeatureKey) ? rank.get(a as OddzialFeatureKey)! : 999;
    const rb = rank.has(b as OddzialFeatureKey) ? rank.get(b as OddzialFeatureKey)! : 999;
    return ra - rb;
  });
};

export const getOddzialStartPath = (
  oddzialId: string | number | null | undefined,
): string => {
  const config = getOddzialFeatureConfig(oddzialId);
  if (isFeatureEnabledForOddzial(oddzialId, config.startPath)) {
    return config.startPath;
  }
  return '/dashboard';
};

export const getOddzialIds = (): string[] => Object.keys(MATRIX.oddzialy);

export const getAllFeatureKeys = (): OddzialFeatureKey[] =>
  (MATRIX.default.allowed as OddzialFeatureKey[]);
