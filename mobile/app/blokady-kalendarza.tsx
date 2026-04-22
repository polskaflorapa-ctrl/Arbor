import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { type CalendarBlock, loadCalendarBlocks, saveCalendarBlocks } from '../utils/calendar-blocks';

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default function BlokadyKalendarzaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/blokady-kalendarza');
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [modal, setModal] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');

  const refresh = useCallback(async () => {
    setBlocks(await loadCalendarBlocks());
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const openAdd = () => {
    const d = new Date().toISOString().slice(0, 10);
    setFrom(d);
    setTo(d);
    setLabel('');
    setModal(true);
  };

  const saveNew = async () => {
    if (!isYmd(from) || !isYmd(to)) {
      Alert.alert(t('common.error'), t('calendarBlocks.badRange'));
      return;
    }
    if (from > to) {
      Alert.alert(t('common.error'), t('calendarBlocks.rangeOrder'));
      return;
    }
    const next: CalendarBlock = {
      id: `blk_${Date.now()}`,
      from,
      to,
      label: label.trim() || t('calendarBlocks.unnamed'),
    };
    await saveCalendarBlocks([next, ...blocks]);
    await refresh();
    setModal(false);
  };

  const remove = async (id: string) => {
    await saveCalendarBlocks(blocks.filter((b) => b.id !== id));
    await refresh();
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) return <View style={S.root} />;
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
      <ScreenHeader
        title={t('calendarBlocks.title')}
        right={
          <TouchableOpacity onPress={openAdd}>
            <Ionicons name="add-circle-outline" size={26} color={theme.headerText} />
          </TouchableOpacity>
        }
      />
      <ScrollView style={S.scroll} contentContainerStyle={S.scrollPad}>
        <Text style={S.hint}>{t('calendarBlocks.hint')}</Text>
        {blocks.length === 0 ? (
          <Text style={S.empty}>{t('calendarBlocks.empty')}</Text>
        ) : (
          blocks.map((b) => (
            <View key={b.id} style={S.card}>
              <View style={S.cardTop}>
                <Text style={S.cardTitle}>{b.label}</Text>
                <TouchableOpacity onPress={() => void remove(b.id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={20} color={theme.danger} />
                </TouchableOpacity>
              </View>
              <Text style={S.cardSub}>
                {b.from} → {b.to}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={modal} transparent animationType="fade">
        <View style={S.modalBackdrop}>
          <View style={S.modalBox}>
            <Text style={S.modalTitle}>{t('calendarBlocks.addTitle')}</Text>
            <Text style={S.lbl}>{t('calendarBlocks.from')}</Text>
            <TextInput style={S.inp} value={from} onChangeText={setFrom} placeholder="2026-04-21" />
            <Text style={S.lbl}>{t('calendarBlocks.to')}</Text>
            <TextInput style={S.inp} value={to} onChangeText={setTo} placeholder="2026-04-25" />
            <Text style={S.lbl}>{t('calendarBlocks.label')}</Text>
            <TextInput style={S.inp} value={label} onChangeText={setLabel} placeholder={t('calendarBlocks.labelPh')} />
            <View style={S.modalRow}>
              <TouchableOpacity style={S.btnGhost} onPress={() => setModal(false)}>
                <Text style={S.btnGhostTxt}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.btnPrimary} onPress={() => void saveNew()}>
                <Text style={S.btnPrimaryTxt}>{t('calendarBlocks.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    scroll: { flex: 1 },
    scrollPad: { padding: 16, paddingBottom: 40 },
    hint: { fontSize: 13, color: theme.textMuted, marginBottom: 12 },
    empty: { color: theme.textMuted, fontSize: 14 },
    card: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { fontSize: 15, fontWeight: '700', color: theme.text, flex: 1 },
    cardSub: { fontSize: 13, color: theme.textMuted, marginTop: 6 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: '#0008',
      justifyContent: 'center',
      padding: 24,
    },
    modalBox: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    modalTitle: { fontSize: 16, fontWeight: '800', color: theme.text, marginBottom: 12 },
    lbl: { fontSize: 12, color: theme.textMuted, marginBottom: 4 },
    inp: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
      color: theme.text,
      backgroundColor: theme.surface2,
    },
    modalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
    btnGhost: { paddingVertical: 10, paddingHorizontal: 14 },
    btnGhostTxt: { color: theme.textMuted, fontWeight: '700' },
    btnPrimary: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
    btnPrimaryTxt: { color: theme.accentText, fontWeight: '800' },
  });
}
