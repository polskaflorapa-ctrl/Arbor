/**
 * M1 — lista wycen terenowych z ARBOR-OS (/api/quotations).
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardSafeScreen } from '../../components/ui/keyboard-safe-screen';
import { PlatinumAppear } from '../../components/ui/platinum-appear';
import { useTheme } from '../../constants/ThemeContext';
import { API_URL } from '../../constants/api';
import type { Theme } from '../../constants/theme';
import { getStoredSession } from '../../utils/session';
import { openAddressInMaps } from '../../utils/maps-link';

type QRow = {
  id: number;
  status?: string;
  klient_nazwa?: string;
  adres?: string;
  miasto?: string;
  wartosc_zaproponowana?: number | string;
};

export default function WycenyTerenoweScreen() {
  const { theme } = useTheme();
  const s = useMemoStyles(theme);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<QRow[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setErr('');
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/quotations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setItems([]);
        setErr(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setErr('Błąd pobierania');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <KeyboardSafeScreen style={s.center}>
        <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
        <ActivityIndicator color={theme.accent} />
      </KeyboardSafeScreen>
    );
  }

  return (
    <KeyboardSafeScreen style={s.screen}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Wróć">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.title}>Wycena u klienta</Text>
        <View style={{ width: 40 }} />
      </View>
      {err ? <Text style={s.err}>{err}</Text> : null}
      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.accent}
          />
        }
      >
        {items.length === 0 ? (
          <PlatinumAppear>
            <Text style={s.muted}>Brak wycen lub brak uprawnień.</Text>
          </PlatinumAppear>
        ) : (
          items.map((q) => (
            <PlatinumAppear key={q.id}>
              <View style={s.card}>
                <TouchableOpacity
                  onPress={() => router.push(`/wyceny-terenowe/${q.id}` as never)}
                  activeOpacity={0.75}
                >
                  <Text style={s.cardTitle}>
                    #{q.id} · {q.status || '—'}
                  </Text>
                  <Text style={s.cardSub}>{q.klient_nazwa || '—'}</Text>
                  <Text style={s.muted}>{[q.adres, q.miasto].filter(Boolean).join(', ')}</Text>
                  {q.wartosc_zaproponowana != null ? (
                    <Text style={s.price}>{Number(q.wartosc_zaproponowana).toFixed(2)} PLN</Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity style={s.mapBtn} onPress={() => void openAddressInMaps(q.adres || '', q.miasto || '')}>
                  <Text style={s.mapBtnTxt}>Mapa</Text>
                </TouchableOpacity>
              </View>
            </PlatinumAppear>
          ))
        )}
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function useMemoStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    backBtn: { padding: 8 },
    title: { fontSize: 18, fontWeight: '700', color: theme.text },
    err: { color: theme.danger, paddingHorizontal: 16, marginTop: 8 },
    list: { padding: 16, paddingBottom: 40 },
    card: {
      backgroundColor: theme.card,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: theme.text },
    cardSub: { marginTop: 4, color: theme.text },
    muted: { marginTop: 4, color: theme.textMuted, fontSize: 13 },
    price: { marginTop: 8, fontWeight: '600', color: theme.accent },
    mapBtn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.accentSoft },
    mapBtnTxt: { color: theme.accent, fontWeight: '600' },
  });
}
