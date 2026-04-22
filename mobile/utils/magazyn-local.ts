import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'magazyn_local_items_v1';

export type MagazynItem = {
  id: string;
  label: string;
  qty: number;
  minQty: number;
};

async function read(): Promise<MagazynItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw == null) return defaultSeed();
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return defaultSeed();
    return p as MagazynItem[];
  } catch {
    return defaultSeed();
  }
}

function defaultSeed(): MagazynItem[] {
  return [
    { id: '1', label: 'Piła spalinowa', qty: 4, minQty: 2 },
    { id: '2', label: 'Podkaszarka', qty: 6, minQty: 3 },
    { id: '3', label: 'Hełm + odzież', qty: 12, minQty: 10 },
  ];
}

async function write(items: MagazynItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function listMagazynItems(): Promise<MagazynItem[]> {
  return read();
}

export async function setMagazynQty(id: string, delta: number): Promise<void> {
  const items = await read();
  const next = items.map((i) =>
    i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i,
  );
  await write(next);
}

export async function addMagazynItem(label: string, minQty = 0): Promise<void> {
  const items = await read();
  const id = `${Date.now()}`;
  await write([...items, { id, label: label.trim() || 'Pozycja', qty: 0, minQty }]);
}

export async function removeMagazynItem(id: string): Promise<void> {
  const items = await read();
  await write(items.filter((i) => i.id !== id));
}
