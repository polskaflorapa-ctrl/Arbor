export function normalizeReactApiBase(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  value = value.replace(/\/+$/, '');
  if (value === '/api') return '/api';
  if (/\/api$/i.test(value)) return value;
  if (value.startsWith('http://') || value.startsWith('https://')) return `${value}/api`;
  return value;
}

export function getReactApiBase(raw = process.env.REACT_APP_API_URL) {
  return normalizeReactApiBase(raw) || '/api';
}
