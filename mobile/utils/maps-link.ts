import { Linking, Platform } from 'react-native';

export type MapsOpenResult = {
  ok: boolean;
  reason?: 'missing-address' | 'missing-stops' | 'open-failed';
};

function buildQuery(address: string, city?: string): string {
  const parts = [address?.trim(), city?.trim()].filter(Boolean);
  return encodeURIComponent(parts.join(', ') || address);
}

/** Otwiera adres w aplikacji map (Google Maps / Apple Maps). */
export async function openAddressInMaps(address: string, city?: string): Promise<MapsOpenResult> {
  const q = buildQuery(address, city);
  if (!q || q === encodeURIComponent('')) {
    return { ok: false, reason: 'missing-address' };
  }
  const urls =
    Platform.OS === 'ios'
      ? [`maps:0,0?q=${q}`, `https://maps.apple.com/?q=${q}`]
      : [`geo:0,0?q=${q}`, `https://www.google.com/maps/search/?api=1&query=${q}`];
  for (const url of urls) {
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) {
        await Linking.openURL(url);
        return { ok: true };
      }
    } catch {
      /* next */
    }
  }
  try {
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
}

function cleanStop(stop: unknown): string {
  return String(stop || '').trim();
}

/** Otwiera trasę dnia w Google Maps. Dla jednego punktu działa jak zwykła nawigacja do adresu. */
export async function openRouteInMaps(stops: unknown[]): Promise<MapsOpenResult> {
  const clean = stops.map(cleanStop).filter(Boolean);
  if (clean.length === 0) {
    return { ok: false, reason: 'missing-stops' };
  }
  if (clean.length === 1) {
    return openAddressInMaps(clean[0]);
  }

  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(0, -1).join('|');
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
}
