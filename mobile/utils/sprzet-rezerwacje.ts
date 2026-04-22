import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/api';

const LOCAL_KEY = 'sprzet_rezerwacje_local_v1';

/** Status rezerwacji — wymagany przy utworzeniu i przy każdej zmianie. */
export const REZERWACJA_STATUSY = ['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'] as const;
export type RezerwacjaStatus = (typeof REZERWACJA_STATUSY)[number];

export type SprzetRezerwacjaRow = {
  id: string;
  sprzet_id: number | string;
  sprzet_nazwa: string;
  ekipa_id: number | string;
  ekipa_nazwa: string;
  /** Dzień rezerwacji YYYY-MM-DD (przy caly_dzien = jeden dzień). */
  data: string;
  caly_dzien: boolean;
  status: RezerwacjaStatus;
  /** Zapisane tylko w telefonie (backend niedostępny lub 404). */
  localOnly?: boolean;
};

function isStatus(s: string): s is RezerwacjaStatus {
  return (REZERWACJA_STATUSY as readonly string[]).includes(s);
}

export function normalizeStatus(s: unknown): RezerwacjaStatus {
  const t = typeof s === 'string' ? s : '';
  return isStatus(t) ? t : 'Zarezerwowane';
}

/** Mapowanie odpowiedzi API → wiersz UI (elastyczne nazwy pól). */
export function normalizeApiRezerwacja(x: Record<string, unknown>): SprzetRezerwacjaRow {
  const rawData = (x.data_od ?? x.data ?? x.dzien) as string | undefined;
  const data = (rawData || '').toString().split('T')[0] || '';
  const sprzetObj = (x.sprzet && typeof x.sprzet === 'object' ? x.sprzet : null) as { nazwa?: unknown } | null;
  const ekipaObj = (x.ekipa && typeof x.ekipa === 'object' ? x.ekipa : null) as { nazwa?: unknown } | null;
  return {
    id: String(x.id ?? ''),
    sprzet_id: (x.sprzet_id ?? x.sprzetId ?? '') as string | number,
    sprzet_nazwa: String(x.sprzet_nazwa ?? x.nazwa_sprzetu ?? sprzetObj?.nazwa ?? '—'),
    ekipa_id: (x.ekipa_id ?? x.ekipaId ?? '') as string | number,
    ekipa_nazwa: String(x.ekipa_nazwa ?? x.nazwa_ekipy ?? ekipaObj?.nazwa ?? '—'),
    data,
    caly_dzien: x.caly_dzien !== false && x.pelny_dzien !== false,
    status: normalizeStatus(x.status),
    localOnly: false,
  };
}

async function readLocal(): Promise<SprzetRezerwacjaRow[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as SprzetRezerwacjaRow[]) : [];
  } catch {
    return [];
  }
}

async function writeLocal(items: SprzetRezerwacjaRow[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(items.slice(0, 200)));
}

export async function listLocalInRange(fromYmd: string, toYmd: string): Promise<SprzetRezerwacjaRow[]> {
  const all = await readLocal();
  return all.filter((r) => r.data >= fromYmd && r.data <= toYmd);
}

export async function hasLocalReservationConflict(
  sprzetId: number | string,
  dataYmd: string,
): Promise<boolean> {
  const all = await readLocal();
  const id = String(sprzetId);
  return all.some((r) =>
    String(r.sprzet_id) === id &&
    r.data === dataYmd &&
    r.status !== 'Anulowane' &&
    r.status !== 'Zwrócone',
  );
}

export async function addLocalRezerwacja(row: Omit<SprzetRezerwacjaRow, 'id'>): Promise<SprzetRezerwacjaRow> {
  const id = `local-${Date.now()}`;
  const full: SprzetRezerwacjaRow = { ...row, id, localOnly: true };
  const all = await readLocal();
  await writeLocal([full, ...all]);
  return full;
}

export async function updateLocalStatus(id: string, status: RezerwacjaStatus): Promise<void> {
  const all = await readLocal();
  await writeLocal(
    all.map((r) => (r.id === id ? { ...r, status } : r)),
  );
}

export type FetchRezerwacjeResult = { ok: boolean; notImplemented: boolean; items: SprzetRezerwacjaRow[] };

export async function fetchRezerwacjeApi(token: string, from: string, to: string): Promise<FetchRezerwacjeResult> {
  try {
    const res = await fetch(
      `${API_URL}/flota/rezerwacje?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return { ok: false, notImplemented: true, items: [] };
    if (!res.ok) return { ok: false, notImplemented: false, items: [] };
    const d = await res.json().catch(() => null);
    const arr = Array.isArray(d) ? d : (d as { rezerwacje?: unknown[] })?.rezerwacje;
    if (!Array.isArray(arr)) return { ok: true, notImplemented: false, items: [] };
    return {
      ok: true,
      notImplemented: false,
      items: arr.map((x) => normalizeApiRezerwacja(x as Record<string, unknown>)).filter((r) => r.id),
    };
  } catch {
    return { ok: false, notImplemented: false, items: [] };
  }
}

export type PostRezerwacjaBody = {
  sprzet_id: number | string;
  ekipa_id: number | string;
  data_od: string;
  data_do: string;
  caly_dzien: boolean;
  status: RezerwacjaStatus;
};

export async function postRezerwacjaApi(
  token: string,
  body: PostRezerwacjaBody,
): Promise<{ ok: boolean; notImplemented: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/flota/rezerwacje`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 404) return { ok: false, notImplemented: true };
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { ok: false, notImplemented: false, error: (e as { error?: string }).error || `HTTP ${res.status}` };
    }
    const d = await res.json().catch(() => ({}));
    const id = (d as { id?: unknown }).id;
    return { ok: true, notImplemented: false, id: id != null ? String(id) : undefined };
  } catch {
    return { ok: false, notImplemented: false, error: 'network' };
  }
}

export async function putRezerwacjaStatusApi(
  token: string,
  id: string | number,
  status: RezerwacjaStatus,
): Promise<{ ok: boolean; notImplemented: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/flota/rezerwacje/${id}/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.status === 404) return { ok: false, notImplemented: true, error: 'HTTP 404' };
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { ok: false, notImplemented: false, error: (e as { error?: string }).error || `HTTP ${res.status}` };
    }
    return { ok: true, notImplemented: false };
  } catch {
    return { ok: false, notImplemented: false, error: 'network' };
  }
}
