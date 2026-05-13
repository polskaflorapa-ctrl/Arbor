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
import { supportsQuotationsModule } from '../../utils/api-capabilities';

type QRow = {
  id: number;
  status?: string;
  klient_nazwa?: string;
  adres?: string;
  miasto?: string;
  wartosc_zaproponowana?: number | string;
  wartosc_szacowana?: number | string;
  legacy?: boolean;
};

type WycenyMode = 'quotations' | 'legacy';

export default function WycenyTerenoweScreen() {
  const { theme } = useTheme();
  const s = useMemoStyles(theme);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<QRow[]>([]);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<WycenyMode>('quotations');

  const load = useCallback(async () => {
    try {
      setErr('');
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      const h = { Authorization: `Bearer ${token}` };
      const loadLegacy = async () => {
        const legacyRes = await fetch(`${API_URL}/wyceny`, { headers: h });
        if (!legacyRes.ok) {
          setMode('legacy');
          setItems([]);
          setErr(`HTTP ${legacyRes.status}`);
          return;
        }
        const legacyJson = await legacyRes.json();
        setItems(
          (Array.isArray(legacyJson) ? legacyJson : []).map((row: QRow) => ({
            ...row,
            wartosc_zaproponowana: row.wartosc_zaproponowana ?? row.wartosc_szacowana,
            legacy: true,
          }))
        );
        setMode('legacy');
      };

      const quotationsReady = await supportsQuotationsModule();
      if (!quotationsReady) {
        await loadLegacy();
        return;
      }
      const res = await fetch(`${API_URL}/quotations`, {
        headers: h,
      });
      if (res.status === 404) {
        await loadLegacy();
        return;
      }
      if (!res.ok) {
        setItems([]);
        setErr(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      setMode('quotations');
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
        <StatusBar barStyle={theme.name !== 'light' ? 'light-content' : 'dark-content'} />
        <ActivityIndicator color={theme.accent} />
      </KeyboardSafeScreen>
    );
  }

  return (
    <KeyboardSafeScreen style={s.screen}>
      <StatusBar barStyle={theme.name !== 'light' ? 'light-content' : 'dark-content'} />
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
        {mode === 'legacy' ? (
          <PlatinumAppear>
            <View style={s.infoBox}>
              <Text style={s.infoTitle}>Tryb zgodności</Text>
              <Text style={s.infoText}>
                Produkcyjny backend czeka na wdrożenie nowego modułu wycen terenowych. Pokazuję dane z klasycznych wycen.
              </Text>
              <TouchableOpacity style={s.infoBtn} onPress={() => router.push('/wycena' as never)} activeOpacity={0.78}>
                <Text style={s.infoBtnTxt}>Otwórz klasyczne wyceny</Text>
              </TouchableOpacity>
            </View>
          </PlatinumAppear>
        ) : null}
        {items.length === 0 ? (
          <PlatinumAppear>
            <Text style={s.muted}>Brak wycen lub brak uprawnień.</Text>
          </PlatinumAppear>
        ) : (
          items.map((q) => (
            <PlatinumAppear key={`${mode}-${q.id}`}>
              <View style={s.card}>
                <TouchableOpacity
                  onPress={() =>
                    mode === 'legacy'
                      ? router.push('/wycena' as never)
                      : router.push(`/wyceny-terenowe/${q.id}` as never)
                  }
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
      backgroundColor: theme.cardBg,
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
    infoBox: {
      backgroundColor: theme.surface2,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.accent,
    },
    infoTitle: { color: theme.text, fontWeight: '800', fontSize: 15 },
    infoText: { color: theme.textMuted, marginTop: 6, lineHeight: 18 },
    infoBtn: {
      marginTop: 12,
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.accent,
    },
    infoBtnTxt: { color: '#fff', fontWeight: '700' },
    mapBtn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.accentLight },
    mapBtnTxt: { color: theme.accent, fontWeight: '600' },
  });
}
