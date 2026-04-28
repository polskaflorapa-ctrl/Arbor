const logger = require('../config/logger');

/**
 * Geokodowanie adresu (Nominatim OSM). Wymaga User-Agent zgodnego z polityką OSM.
 * @returns {{ lat: number, lng: number, status: 'ok' } | { status: 'failed', error?: string }}
 */
async function geocodeAddressPoland({ adres, miasto }) {
  const parts = [adres, miasto, 'Polska'].filter((x) => x && String(x).trim());
  if (!parts.length) return { status: 'failed', error: 'Brak adresu' };
  const q = parts.join(', ');
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ArborOS/1.0 (wycena terenowa; kontakt: biuro)' },
    });
    if (!res.ok) {
      logger.warn('geocode nominatim http', { status: res.status });
      return { status: 'failed', error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const hit = Array.isArray(data) && data[0];
    if (!hit || hit.lat == null || hit.lon == null) {
      return { status: 'failed', error: 'Brak wyniku' };
    }
    return { status: 'ok', lat: Number(hit.lat), lng: Number(hit.lon) };
  } catch (e) {
    logger.error('geocode nominatim', { message: e.message });
    return { status: 'failed', error: e.message };
  }
}

module.exports = { geocodeAddressPoland };
