import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, StatusBar,
} from 'react-native';
import { EmptyState, ErrorBanner } from '../components/ui/app-state';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { flushOfflineQueue, getOfflineQueueSize, queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { getStoredSession } from '../utils/session';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const NOTIF_TYPES: { value: string; icon: IoniconName }[] = [
  { value: 'skonczylem_wczesniej', icon: 'checkmark-circle-outline' },
  { value: 'potrzebuje_czasu', icon: 'time-outline' },
  { value: 'problem', icon: 'warning-outline' },
  { value: 'pytanie', icon: 'help-circle-outline' },
  { value: 'info', icon: 'information-circle-outline' },
];

const NOTIF_ICON: Record<string, IoniconName> = {
  skonczylem_wczesniej: 'checkmark-circle-outline',
  potrzebuje_czasu: 'time-outline',
  problem: 'warning-outline',
  pytanie: 'help-circle-outline',
  info: 'information-circle-outline',
};

function notifTypeColors(theme: Theme) {
  return {
    skonczylem_wczesniej: theme.success,
    potrzebuje_czasu: theme.warning,
    problem: theme.danger,
    pytanie: theme.info,
    info: theme.textMuted,
  };
}

export default function Powiadomienia() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const guard = useOddzialFeatureGuard('/powiadomienia');
  const [zlecenia, setZlecenia] = useState<any[]>([]);
  const [kierownicy, setKierownicy] = useState<any[]>([]);
  const [powiadomienia, setPowiadomienia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTyp, setSelectedTyp] = useState('skonczylem_wczesniej');
  const [selectedTask, setSelectedTask] = useState('');
  const [selectedKierownik, setSelectedKierownik] = useState('');
  const [tresc, setTresc] = useState('');
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const notifColors = useMemo(() => notifTypeColors(theme), [theme]);

  const registerPush = useCallback(async () => {
    setPushBusy(true);
    try {
      if (!Device.isDevice) {
        Alert.alert('', 'Push: wymagane fizyczne urządzenie.');
        return;
      }
      const perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('', 'Brak zgody na powiadomienia.');
        return;
      }
      const projectId =
        (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } })?.extra?.eas?.projectId ??
        (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
      const res = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId: String(projectId) })
        : await Notifications.getExpoPushTokenAsync();
      setPushToken(res.data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('', msg || 'Nie udało się pobrać tokena (EAS projectId?).');
    } finally {
      setPushBusy(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
      const h = { Authorization: `Bearer ${storedToken}` } as Record<string, string>;
      const [zRes, uRes, nRes] = await Promise.all([
        fetch(`${API_URL}/tasks/moje`, { headers: h }),
        fetch(`${API_URL}/uzytkownicy`, { headers: h }),
        fetch(`${API_URL}/notifications`, { headers: h }),
      ]);
      if (zRes.ok) { const d = await zRes.json(); setZlecenia(Array.isArray(d) ? d : []); }
      if (uRes.ok) {
        const users = await uRes.json();
        setKierownicy((Array.isArray(users) ? users : []).filter((u: any) => u.rola === 'Kierownik' || u.rola === 'Dyrektor'));
      }
      if (nRes.ok) { const d = await nRes.json(); setPowiadomienia(Array.isArray(d) ? d : []); }
      else setPowiadomienia([]);
    } catch {
      setPowiadomienia([]);
      setError(t('notif.errorLoad'));
      setOfflineQueueCount(await getOfflineQueueSize());
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);

  const wyslij = async () => {
    if (!selectedKierownik) {
      Alert.alert(t('notif.alert.errorTitle'), t('notif.alert.pickRecipient'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      if (!token) { router.replace('/login'); return; }
      const payload = { to_user_id: selectedKierownik, task_id: selectedTask || null, typ: selectedTyp, tresc };
      const res = await fetch(`${API_URL}/notifications`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        Alert.alert(t('notif.alert.sentTitle'), t('notif.alert.sentBody'));
        setShowForm(false); setTresc(''); setSelectedTask('');
        loadData();
      } else {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/notifications`,
          method: 'POST',
          body: payload as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.noConnectionTitle'), t('notif.alert.noConnectionBody'));
      }
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        url: `${API_URL}/notifications`,
        method: 'POST',
        body: { to_user_id: selectedKierownik, task_id: selectedTask || null, typ: selectedTyp, tresc },
      });
      setOfflineQueueCount(queued);
      Alert.alert(t('notif.alert.offlineTitle'), t('notif.alert.offlineBody'));
    }
    finally { setSending(false); }
  };

  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const fmtTime = (d: string) => {
    if (!d) return '';
    const date = new Date(d);
    const diff = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diff < 1) return t('notif.time.justNow');
    if (diff < 60) return t('notif.time.minAgo', { n: diff });
    if (diff < 1440) return t('notif.time.hoursAgo', { n: Math.floor(diff / 60) });
    return date.toLocaleDateString(dateLocale);
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;
  }

  if (loading) return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;

  return (
    <KeyboardSafeScreen style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />

      <ScreenHeader
        title={t('notif.title')}
        right={
          <TouchableOpacity style={S.headerActionBtn} onPress={() => setShowForm(!showForm)}>
            <Ionicons name={showForm ? 'close' : 'add'} size={24} color={theme.accent} />
          </TouchableOpacity>
        }
      />
      {offlineQueueCount > 0 ? (
        <View style={S.offlineInfo}>
          <Ionicons name="cloud-offline-outline" size={14} color={theme.warning} />
          <Text style={S.offlineInfoText}>{t('notif.offlineQueue', { count: offlineQueueCount })}</Text>
        </View>
      ) : null}

      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 12,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface2,
        }}
      >
        <Text style={{ fontWeight: '700', color: theme.text, marginBottom: 6 }}>{t('notifications.push.title')}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 12, marginBottom: 10 }}>{t('notifications.push.sub')}</Text>
        <TouchableOpacity
          style={{
            alignSelf: 'flex-start',
            backgroundColor: theme.accent,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 8,
            marginBottom: 10,
          }}
          onPress={() => { void registerPush(); }}
          disabled={pushBusy}
        >
          {pushBusy ? (
            <ActivityIndicator color={theme.accentText} size="small" />
          ) : (
            <Text style={{ color: theme.accentText, fontWeight: '700' }}>{t('notifications.push.permission')}</Text>
          )}
        </TouchableOpacity>
        <Text style={{ color: theme.textSub, fontSize: 11, marginBottom: 6 }} selectable>
          {pushToken || t('notifications.push.none')}
        </Text>
        {pushToken ? (
          <TouchableOpacity
            onPress={() => {
              void Clipboard.setStringAsync(pushToken);
              Alert.alert('', t('common.copy'));
            }}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('notifications.push.copy')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {showForm && (
        <ScrollView
          style={S.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <Text style={S.formTitle}>{t('notif.formTitle')}</Text>

          <Text style={S.label}>{t('notif.label.type')}</Text>
          {NOTIF_TYPES.map((row) => {
            const rowColor = notifColors[row.value as keyof typeof notifColors] ?? theme.textMuted;
            return (
            <TouchableOpacity key={row.value}
              style={[S.typCard, selectedTyp === row.value && { borderColor: rowColor, backgroundColor: rowColor + '18' }]}
              onPress={() => setSelectedTyp(row.value)}>
              <View style={[S.typIconBg, { backgroundColor: rowColor + '22' }]}>
                <Ionicons name={row.icon} size={20} color={rowColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.typLabel, selectedTyp === row.value && { color: rowColor }]}>
                  {t(`notif.type.${row.value}.label`)}
                </Text>
                <Text style={S.typSub}>{t(`notif.type.${row.value}.sub`)}</Text>
              </View>
              {selectedTyp === row.value && <Ionicons name="checkmark-circle" size={20} color={rowColor} />}
            </TouchableOpacity>
          );})}

          <Text style={S.label}>{t('notif.label.taskOptional')}</Text>
          <View style={S.selectBox}>
            <TouchableOpacity style={[S.selectItem, !selectedTask && { backgroundColor: theme.accent + '18' }]} onPress={() => setSelectedTask('')}>
              <Text style={[S.selectText, !selectedTask && { color: theme.accent }]}>{t('common.none')}</Text>
            </TouchableOpacity>
            {zlecenia.map(z => (
              <TouchableOpacity key={z.id} style={[S.selectItem, selectedTask === z.id.toString() && { backgroundColor: theme.accent + '18' }]}
                onPress={() => setSelectedTask(z.id.toString())}>
                <Text style={[S.selectText, selectedTask === z.id.toString() && { color: theme.accent }]}>#{z.id} {z.klient_nazwa}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={S.label}>{t('notif.label.sendTo')}</Text>
          <View style={S.selectBox}>
            {kierownicy.map(k => (
              <TouchableOpacity key={k.id} style={[S.selectItem, selectedKierownik === k.id.toString() && { backgroundColor: theme.accent + '18' }]}
                onPress={() => setSelectedKierownik(k.id.toString())}>
                <Text style={[S.selectText, selectedKierownik === k.id.toString() && { color: theme.accent }]}>
                  {k.imie} {k.nazwisko} · {k.rola}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={S.label}>{t('notif.label.messageOptional')}</Text>
          <TextInput style={S.textArea} multiline numberOfLines={3}
            value={tresc} onChangeText={setTresc}
            placeholder={t('notif.placeholder.message')} placeholderTextColor={theme.inputPlaceholder} />

          <TouchableOpacity style={[S.sendBtn, sending && { opacity: 0.6 }]} onPress={wyslij} disabled={sending}>
            {sending ? <ActivityIndicator color={theme.accentText} /> : (
              <><Ionicons name="send" size={16} color={theme.accentText} /><Text style={S.sendText}>  {t('notif.send')}</Text></>
            )}
          </TouchableOpacity>
          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      {!showForm && (
        <ScrollView style={S.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={theme.accent} />}>
          {error ? <ErrorBanner message={error} /> : null}
          {powiadomienia.length === 0 ? (
            <EmptyState
              icon="notifications-outline"
              iconColor={theme.textMuted}
              title={t('notif.emptyTitle')}
              subtitle={t('notif.emptySubtitle')}
            />
          ) : powiadomienia.map(n => {
            const kolor = notifColors[n.typ as keyof typeof notifColors] || theme.textSub;
            return (
              <TouchableOpacity key={n.id}
                style={[S.card, n.status === 'Nowe' && { borderLeftColor: theme.accent, borderLeftWidth: 3 }]}
                onPress={() => n.task_id && router.push(`/zlecenie/${n.task_id}`)}>
                <View style={[S.iconBg, { backgroundColor: kolor + '22' }]}>
                  <Ionicons name={NOTIF_ICON[n.typ] || 'megaphone-outline'} size={22} color={kolor} />
                </View>
                <View style={S.cardContent}>
                  <View style={S.cardHeader}>
                    <Text style={S.cardOd}>{n.od_kogo || t('notif.you')}</Text>
                    <Text style={S.cardTime}>{fmtTime(n.data_utworzenia)}</Text>
                  </View>
                  <Text style={S.cardTyp}>
                    {NOTIF_TYPES.some((r) => r.value === n.typ) ? t(`notif.type.${n.typ}.label`) : n.typ}
                  </Text>
                  {n.tresc ? <Text style={S.cardTresc}>{n.tresc}</Text> : null}
                  {n.klient_nazwa ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                      <Ionicons name="clipboard-outline" size={11} color={theme.accent} />
                      <Text style={[S.cardTask, { color: theme.accent }]}> {n.klient_nazwa}</Text>
                    </View>
                  ) : null}
                </View>
                {n.status === 'Nowe' && <View style={[S.dot, { backgroundColor: theme.accent }]} />}
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  headerActionBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  offlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: t.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  offlineInfoText: { color: t.warning, fontSize: 12, fontWeight: '600' },
  form: { flex: 1, padding: 16 },
  formTitle: { fontSize: 18, fontWeight: '700', color: t.text, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: t.textSub, marginBottom: 8, marginTop: 12 },
  typCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: t.border,
    backgroundColor: t.surface, marginBottom: 8,
  },
  typIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typLabel: { fontSize: 14, fontWeight: '600', color: t.text, marginBottom: 2 },
  typSub: { fontSize: 12, color: t.textMuted },
  selectBox: { backgroundColor: t.surface, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: t.border },
  selectItem: { padding: 13, borderBottomWidth: 1, borderBottomColor: t.border },
  selectText: { fontSize: 14, color: t.text, fontWeight: '500' },
  textArea: {
    backgroundColor: t.inputBg, borderRadius: 14, padding: 14,
    fontSize: 14, borderWidth: 1, borderColor: t.inputBorder,
    minHeight: 90, textAlignVertical: 'top', color: t.inputText,
  },
  sendBtn: {
    backgroundColor: t.accent, padding: 16, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 16, flexDirection: 'row',
  },
  sendText: { color: t.accentText, fontWeight: '700', fontSize: 15 },
  list: { flex: 1, padding: 14 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 14, color: t.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: t.cardBg, borderRadius: 14,
    padding: 14, marginBottom: 10, gap: 12,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  iconBg: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  cardOd: { fontSize: 13, fontWeight: '700', color: t.text },
  cardTime: { fontSize: 11, color: t.textMuted },
  cardTyp: { fontSize: 13, color: t.textSub, marginBottom: 2 },
  cardTresc: { fontSize: 12, color: t.textMuted, fontStyle: 'italic', marginBottom: 2 },
  cardTask: { fontSize: 11, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
});
