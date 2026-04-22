import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'client_contact_notes_v1';
const MAX_PER_CLIENT = 40;

export type ContactNote = { ts: string; text: string; clientKey: string };

export function clientHistoryKey(phone?: string, name?: string): string {
  const p = (phone || '').replace(/\s/g, '');
  if (p) return `p:${p}`;
  const n = (name || '').trim().toLowerCase();
  return n ? `n:${n}` : '_';
}

async function readMap(): Promise<Record<string, ContactNote[]>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === 'object' ? (p as Record<string, ContactNote[]>) : {};
  } catch {
    return {};
  }
}

async function writeMap(m: Record<string, ContactNote[]>): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(m));
}

export async function appendContactNote(clientKey: string, text: string): Promise<void> {
  const t = text.trim();
  if (!t || !clientKey || clientKey === '_') return;
  const m = await readMap();
  const list = m[clientKey] || [];
  const next: ContactNote = { ts: new Date().toISOString(), text: t, clientKey };
  m[clientKey] = [next, ...list].slice(0, MAX_PER_CLIENT);
  await writeMap(m);
}

export async function listContactNotes(clientKey: string, limit = 15): Promise<ContactNote[]> {
  if (!clientKey || clientKey === '_') return [];
  const m = await readMap();
  return (m[clientKey] || []).slice(0, limit);
}
