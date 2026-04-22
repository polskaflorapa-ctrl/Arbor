import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, StatusBar,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { getStoredSession } from '../utils/session';

export default function PomocnikScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [pomocnicy, setPomocnicy] = useState<any[]>([]);

  useEffect(() => { fetchPomocnicy(); }, []);

  const fetchPomocnicy = async () => {
    try {
      const { token } = await getStoredSession();
      if (!token) { router.replace('/login'); return; }
      const response = await fetch(`${API_URL}/auth/pomocnicy`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setPomocnicy(Array.isArray(data) ? data : []);
    } catch {
      setPomocnicy([]);
    } finally {
      setLoading(false);
    }
  };

  const S = makeStyles(theme);

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.container}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Ionicons name="people-outline" size={20} color={theme.headerText} />
          <Text style={S.title}>Moja ekipa</Text>
        </View>
      </View>

      <FlatList
        style={{ flex: 1, padding: 12 }}
        data={pomocnicy}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={S.card}>
            <View style={[S.avatar, { backgroundColor: theme.accent + '22' }]}>
              <Text style={[S.avatarText, { color: theme.accent }]}>
                {item.imie?.[0]}{item.nazwisko?.[0]}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.name}>{item.imie} {item.nazwisko}</Text>
              {item.stawka_godzinowa && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <Ionicons name="cash-outline" size={13} color={theme.accent} />
                  <Text style={S.rate}>{item.stawka_godzinowa} PLN/h</Text>
                </View>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={S.emptyBox}>
            <Ionicons name="people-outline" size={48} color={theme.textMuted} />
            <Text style={S.empty}>Brak pomocników w ekipie</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: t.headerText },
  card: {
    backgroundColor: t.cardBg, padding: 16, borderRadius: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: t.cardBorder, elevation: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: 'bold' },
  name: { fontSize: 16, fontWeight: 'bold', color: t.text },
  rate: { fontSize: 14, color: t.accent, fontWeight: '600' },
  emptyBox: { alignItems: 'center', paddingTop: 60, gap: 12 },
  empty: { textAlign: 'center', color: t.textMuted, fontSize: 15 },
});
