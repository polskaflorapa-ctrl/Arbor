import { Alert, Linking, Platform } from 'react-native';

function buildQuery(address: string, city?: string): string {
  const parts = [address?.trim(), city?.trim()].filter(Boolean);
  return encodeURIComponent(parts.join(', ') || address);
}

/** Otwiera adres w aplikacji map (Google Maps / Apple Maps). */
export async function openAddressInMaps(address: string, city?: string): Promise<void> {
  const q = buildQuery(address, city);
  if (!q || q === encodeURIComponent('')) {
    Alert.alert('', 'Brak adresu do nawigacji.');
    return;
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
        return;
      }
    } catch {
      /* next */
    }
  }
  try {
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
  } catch {
    Alert.alert('', 'Nie udało się otworzyć map.');
  }
}
