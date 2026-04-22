import { CITY_SUGGESTIONS } from './citySuggestions';

function capitalizePart(part) {
  if (!part) return part;
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function stripDiacritics(value) {
  return value
    .replace(/[łŁ]/g, (m) => (m === 'ł' ? 'l' : 'L'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const CITY_CANONICAL_MAP = CITY_SUGGESTIONS.reduce((acc, city) => {
  const normalized = stripDiacritics(city).toLowerCase();
  if (!acc[normalized]) acc[normalized] = city;
  return acc;
}, {});

export function normalizeCityName(rawValue) {
  const value = String(rawValue || '').trim().replace(/\s+/g, ' ');
  if (!value) return '';

  const formatted = value
    .split(' ')
    .map((word) => word.split('-').map(capitalizePart).join('-'))
    .join(' ');

  const canonicalKey = stripDiacritics(formatted).toLowerCase();
  return CITY_CANONICAL_MAP[canonicalKey] || formatted;
}
