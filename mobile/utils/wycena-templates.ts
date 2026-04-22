import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'wycena_templates_v1';

export type WycenaTemplate = {
  id: string;
  name: string;
  createdAt: string;
  /** Pola formularza wyceny (JSON-serializable). */
  snapshot: Record<string, unknown>;
};

async function readAll(): Promise<WycenaTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

async function writeAll(items: WycenaTemplate[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items.slice(0, 30)));
}

export async function listWycenaTemplates(): Promise<WycenaTemplate[]> {
  const all = await readAll();
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveWycenaTemplate(name: string, snapshot: Record<string, unknown>): Promise<void> {
  const trimmed = name.trim() || 'Szablon';
  const all = await readAll();
  const item: WycenaTemplate = {
    id: `${Date.now()}`,
    name: trimmed,
    createdAt: new Date().toISOString(),
    snapshot: { ...snapshot },
  };
  await writeAll([item, ...all.filter((t) => t.name !== trimmed)]);
}

export async function deleteWycenaTemplate(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((t) => t.id !== id));
}
