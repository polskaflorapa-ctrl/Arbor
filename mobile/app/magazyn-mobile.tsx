import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import {
  addMagazynItem,
  listMagazynItems,
  removeMagazynItem,
  setMagazynQty,
  type MagazynItem,
} from '../utils/magazyn-local';

export default function MagazynMobileScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/magazyn-mobile');
  const [items, setItems] = useState<MagazynItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(async () => {
    setItems(await listMagazynItems());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const S = makeStyles(theme);
  const lowCount = items.filter((it) => it.minQty > 0 && it.qty < it.minQty).length;
  const totalQty = items.reduce((sum, it) => sum + it.qty, 0);

  if (guard.ready && !guard.allowed) return <View style={S.center} />;
  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <StatusBar barStyle={'light-content'} backgroundColor={theme.headerBg} />
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="archive-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Materialy i zapasy</Text>
          <Text style={S.headerTitle}>{t('warehouse.title')}</Text>
          <Text style={S.headerSub}>Szybka kontrola stanow dla ekip i biura.</Text>
        </View>
        <View style={S.headerCount}>
          <Text style={S.headerCountValue}>{items.length}</Text>
          <Text style={S.headerCountLabel}>poz.</Text>
        </View>
      </View>
      <View style={S.statsRow}>
        <View style={S.statCard}>
          <Ionicons name="cube-outline" size={17} color={theme.accent} />
          <Text style={S.statValue}>{totalQty}</Text>
          <Text style={S.statLabel}>Stan</Text>
        </View>
        <View style={[S.statCard, lowCount > 0 && { borderColor: theme.danger + '66' }]}>
          <Ionicons name="warning-outline" size={17} color={lowCount > 0 ? theme.danger : theme.success} />
          <Text style={S.statValue}>{lowCount}</Text>
          <Text style={S.statLabel}>Alerty</Text>
        </View>
        <View style={S.statCard}>
          <Ionicons name="leaf-outline" size={17} color={theme.success} />
          <Text style={S.statValue}>{items.length}</Text>
          <Text style={S.statLabel}>Pozycje</Text>
        </View>
      </View>
      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.accent} />
        }
      >
        <Text style={S.hint}>{t('warehouse.hint')}</Text>
        {items.length === 0 ? (
          <View style={S.empty}>
            <Ionicons name="archive-outline" size={42} color={theme.textMuted} />
            <Text style={S.emptyTitle}>Magazyn jest pusty</Text>
          </View>
        ) : null}
        {items.map((it) => {
          const low = it.minQty > 0 && it.qty < it.minQty;
          return (
            <View key={it.id} style={[S.card, low && { borderColor: theme.danger }]}>
              <View style={S.rowTop}>
                <Text style={S.label}>{it.label}</Text>
                <TouchableOpacity onPress={() => Alert.alert('', t('warehouse.confirmRemove'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('common.ok'), style: 'destructive', onPress: async () => { await removeMagazynItem(it.id); void load(); } },
                ])}>
                  <Ionicons name="trash-outline" size={20} color={theme.danger} />
                </TouchableOpacity>
              </View>
              <Text style={[S.qty, low && { color: theme.danger }]}>
                {t('warehouse.qty')}: {it.qty}
                {it.minQty > 0 ? ` · min: ${it.minQty}` : ''}
              </Text>
              <View style={S.btns}>
                <TouchableOpacity style={S.qbtn} onPress={async () => { await setMagazynQty(it.id, -1); void load(); }}>
                  <Text style={S.qbtnTxt}>−1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.qbtn} onPress={async () => { await setMagazynQty(it.id, 1); void load(); }}>
                  <Text style={S.qbtnTxt}>+1</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        <View style={S.addRow}>
          <TextInput
            style={S.input}
            placeholder={t('warehouse.newPlaceholder')}
            placeholderTextColor={theme.inputPlaceholder}
            value={newLabel}
            onChangeText={setNewLabel}
          />
          <TouchableOpacity
            style={S.addBtn}
            onPress={async () => {
              await addMagazynItem(newLabel);
              setNewLabel('');
              void load();
            }}
          >
            <Ionicons name="add" size={22} color={theme.accentText} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
    header: {
      backgroundColor: theme.cardBg,
      marginHorizontal: 14,
      marginTop: 12,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingTop: 18,
      paddingBottom: 16,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      ...shadowStyle(theme, {
        opacity: theme.shadowOpacity * 0.14,
        radius: theme.shadowRadius * 0.45,
        offsetY: 3,
        elevation: theme.cardElevation + 1,
      }),
    },
    backBtn: {
      width: 42,
      height: 42,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accentLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTextBox: { flex: 1, minWidth: 0 },
    headerEyebrow: {
      color: theme.textMuted,
      fontSize: 10,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0,
    },
    headerTitle: { color: theme.text, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 2 },
    headerSub: { color: theme.textSub, fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 2 },
    headerCount: {
      minWidth: 58,
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    headerCountValue: { color: theme.accent, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
    headerCountLabel: { color: theme.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
    statsRow: {
      flexDirection: 'row',
      marginHorizontal: 14,
      marginBottom: 8,
      gap: 8,
    },
    statCard: {
      flex: 1,
      minHeight: 74,
      backgroundColor: theme.cardBg,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    statValue: { color: theme.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
    statLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '800', textAlign: 'center' },
    scroll: { flex: 1, paddingHorizontal: 14, paddingTop: 4 },
    hint: { color: theme.textMuted, marginBottom: 12, fontSize: 13, fontWeight: '700', lineHeight: 18 },
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 140,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      backgroundColor: theme.cardBg,
      marginBottom: 12,
    },
    emptyTitle: { color: theme.textMuted, fontSize: 13, fontWeight: '800' },
    card: {
      backgroundColor: theme.cardBg,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      padding: 14,
      marginBottom: 10,
      ...shadowStyle(theme, {
        opacity: theme.shadowOpacity * 0.08,
        radius: theme.shadowRadius * 0.28,
        offsetY: 1,
        elevation: Math.max(1, theme.cardElevation - 1),
      }),
    },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    label: { fontSize: 16, fontWeight: '900', color: theme.text, flex: 1 },
    qty: { marginTop: 7, color: theme.textSub, fontSize: 14, fontWeight: '800' },
    btns: { flexDirection: 'row', gap: 10, marginTop: 10 },
    qbtn: {
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 12,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    qbtnTxt: { fontWeight: '900', color: theme.text },
    addRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 24 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.inputBorder,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: theme.inputText,
      backgroundColor: theme.inputBg,
      fontWeight: '700',
    },
    addBtn: {
      width: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent,
      borderRadius: 14,
    },
  });
}
