import { getLocalStorageJson } from './safeJsonLocalStorage';

export const CITY_SUGGESTIONS = [
  'Warszawa', 'Kraków', 'Łódź', 'Wrocław', 'Poznań', 'Gdańsk', 'Szczecin',
  'Bydgoszcz', 'Lublin', 'Białystok', 'Katowice', 'Gdynia', 'Częstochowa',
  'Radom', 'Sosnowiec', 'Toruń', 'Kielce', 'Rzeszów', 'Gliwice', 'Zabrze',
  'Bytom', 'Olsztyn', 'Bielsko-Biała', 'Zielona Góra', 'Rybnik', 'Opole',
  'Tychy', 'Elbląg', 'Płock', 'Wałbrzych', 'Włocławek', 'Tarnów',
  'Chorzów', 'Kalisz', 'Koszalin', 'Legnica', 'Grudziądz', 'Słupsk',
  'Jaworzno', 'Jastrzębie-Zdrój', 'Nowy Sącz', 'Jelenia Góra', 'Siedlce',
  'Mysłowice', 'Piła', 'Ostrów Wielkopolski', 'Konin', 'Stargard',
  'Przemyśl', 'Łomża'
];

const RECENT_CITIES_KEY = 'arbor_recent_cities';
const RECENT_CITIES_LIMIT = 5;

export function getRecentCities() {
  const parsed = getLocalStorageJson(RECENT_CITIES_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((city) => String(city || '').trim())
    .filter(Boolean)
    .slice(0, RECENT_CITIES_LIMIT);
}

export function saveRecentCity(cityInput) {
  const city = String(cityInput || '').trim();
  if (!city) return;

  const next = [city, ...getRecentCities().filter((c) => c.toLowerCase() !== city.toLowerCase())]
    .slice(0, RECENT_CITIES_LIMIT);
  try {
    localStorage.setItem(RECENT_CITIES_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors (e.g. private mode or quota).
  }
}

export function clearRecentCities() {
  try {
    localStorage.removeItem(RECENT_CITIES_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function mergeCitySuggestions(extraCities = [], options = {}) {
  const { maxItems = 80 } = options;
  const merged = [...getRecentCities(), ...CITY_SUGGESTIONS, ...extraCities]
    .map((city) => String(city || '').trim())
    .filter(Boolean);
  const uniques = [...new Set(merged)];
  const recent = getRecentCities();
  const recentMap = new Map(recent.map((city, idx) => [city.toLowerCase(), idx]));

  const sorted = uniques.sort((a, b) => {
    const aRecent = recentMap.has(a.toLowerCase());
    const bRecent = recentMap.has(b.toLowerCase());
    if (aRecent && bRecent) return recentMap.get(a.toLowerCase()) - recentMap.get(b.toLowerCase());
    if (aRecent) return -1;
    if (bRecent) return 1;
    return a.localeCompare(b, 'pl');
  });
  return sorted.slice(0, maxItems);
}
