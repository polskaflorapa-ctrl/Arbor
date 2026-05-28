import { Text, View } from 'react-native';

import type { Theme } from '../constants/theme';

export function InfoRow({ label, val, theme }: { label: string; val: string; theme: Theme }) {
  if (!val) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ fontSize: 13, color: theme.textMuted, width: 100 }}>{label}:</Text>
      <Text style={{ fontSize: 13, color: theme.text, flex: 1 }}>{val}</Text>
    </View>
  );
}
