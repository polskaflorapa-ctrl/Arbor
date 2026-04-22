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
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
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
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title={t('warehouse.title')} />
      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.accent} />
        }
      >
        <Text style={S.hint}>{t('warehouse.hint')}</Text>
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
    scroll: { flex: 1, padding: 16 },
    hint: { color: theme.textMuted, marginBottom: 12, fontSize: 13 },
    card: {
      backgroundColor: theme.cardBg,
      borderRadius: theme.radiusLg,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      padding: 14,
      marginBottom: 10,
    },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    label: { fontSize: 16, fontWeight: '700', color: theme.text, flex: 1 },
    qty: { marginTop: 6, color: theme.textSub, fontSize: 14 },
    btns: { flexDirection: 'row', gap: 10, marginTop: 10 },
    qbtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: theme.radiusSm,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    qbtnTxt: { fontWeight: '700', color: theme.text },
    addRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 24 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.inputBorder,
      borderRadius: theme.radiusSm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: theme.inputText,
      backgroundColor: theme.inputBg,
    },
    addBtn: {
      width: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent,
      borderRadius: theme.radiusSm,
    },
  });
}
