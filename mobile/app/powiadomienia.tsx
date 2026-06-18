import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { EmptyState, ErrorBanner } from '../components/ui/app-state';
import { FieldOpsBackdrop, FieldOpsHeroImage } from '../components/ui/field-ops-art';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { apiFetch, apiJsonFetch, apiUrl } from '../utils/api-client';
import { supportsQuotationsModule } from '../utils/api-capabilities';
import { flushOfflineQueue, getOfflineQueueSize, queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { triggerHaptic } from '../utils/haptics';
import { getRoleDisplayName } from '../utils/role-display';
import { getStoredSession } from '../utils/session';
import { registerExpoPushTokenWithBackend } from '../utils/expo-push-backend';

import { AppStatusBar } from '../components/ui/app-status-bar';
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

type InboxStat = {
  id: string;
  label: string;
  value: number;
  icon: IoniconName;
  color: string;
  bg: string;
};

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

function normalizeNotificationsPayload(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const maybeItems = (payload as { items?: unknown }).items;
    if (Array.isArray(maybeItems)) return maybeItems;
  }
  return [];
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
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);
  const [approvalQueue, setApprovalQueue] = useState<any[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<number | null>(null);
  const [selectedTyp, setSelectedTyp] = useState('skonczylem_wczesniej');
  const [selectedTask, setSelectedTask] = useState('');
  const [selectedKierownik, setSelectedKierownik] = useState('');
  const [tresc, setTresc] = useState('');
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);

  const notifColors = useMemo(() => notifTypeColors(theme), [theme]);
  const unreadCount = useMemo(
    () => powiadomienia.filter((n) => n.status === 'Nowe').length,
    [powiadomienia],
  );
  const visiblePowiadomienia = useMemo(
    () => (showOnlyUnread ? powiadomienia.filter((n) => n.status === 'Nowe') : powiadomienia),
    [powiadomienia, showOnlyUnread],
  );
  const inboxFocus = useMemo(() => {
    if (approvalQueue.length > 0) return `Do decyzji: ${approvalQueue.length}`;
    if (unreadCount > 0) return `Nowe wiadomości: ${unreadCount}`;
    if (offlineQueueCount > 0) return `Czeka synchronizacja: ${offlineQueueCount}`;
    return 'Inbox bez pilnych blokad.';
  }, [approvalQueue.length, offlineQueueCount, unreadCount]);
  const inboxStats = useMemo<InboxStat[]>(() => ([
    {
      id: 'unread',
      label: 'Nowe',
      value: unreadCount,
      icon: 'mail-unread-outline',
      color: theme.info,
      bg: theme.infoBg,
    },
    {
      id: 'approvals',
      label: 'Decyzje',
      value: approvalQueue.length,
      icon: 'shield-checkmark-outline',
      color: theme.success,
      bg: theme.successBg,
    },
    {
      id: 'offline',
      label: 'Offline',
      value: offlineQueueCount,
      icon: 'cloud-offline-outline',
      color: offlineQueueCount > 0 ? theme.warning : theme.textMuted,
      bg: offlineQueueCount > 0 ? theme.warningBg : theme.surface3,
    },
    {
      id: 'orders',
      label: 'Zlecenia',
      value: zlecenia.length,
      icon: 'clipboard-outline',
      color: theme.accent,
      bg: theme.accentLight,
    },
  ]), [approvalQueue.length, offlineQueueCount, theme, unreadCount, zlecenia.length]);

  const showNotice = useCallback((message: string, tone: 'success' | 'warning' = 'success') => {
    setNotice({ message, tone });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  const registerPush = useCallback(async () => {
    setPushBusy(true);
    try {
      if (!Device.isDevice) {
        void triggerHaptic('warning');
        showNotice('Push: wymagane fizyczne urządzenie.', 'warning');
        return;
      }
      const perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        void triggerHaptic('warning');
        showNotice('Brak zgody na powiadomienia.', 'warning');
        return;
      }
      const projectId =
        (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } })?.extra?.eas?.projectId ??
        (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
      const res = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId: String(projectId) })
        : await Notifications.getExpoPushTokenAsync();
      setPushToken(res.data);
      const { token: jwt } = await getStoredSession();
      if (jwt && res.data) void registerExpoPushTokenWithBackend(jwt, res.data);
    } catch (e: unknown) {
      void triggerHaptic('error');
      const msg = e instanceof Error ? e.message : String(e);
      showNotice(msg || 'Nie udało się pobrać tokena (EAS projectId?).', 'warning');
    } finally {
      setPushBusy(false);
    }
  }, [showNotice]);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const { token: storedToken } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
      const [zRes, uRes, nRes] = await Promise.all([
        apiFetch('/tasks/moje', { token: storedToken }),
        apiFetch('/uzytkownicy', { token: storedToken }),
        apiFetch('/notifications', { token: storedToken }),
      ]);
      if (zRes.ok) { const d = await zRes.json(); setZlecenia(Array.isArray(d) ? d : []); }
      if (uRes.ok) {
        const users = await uRes.json();
        setKierownicy((Array.isArray(users) ? users : []).filter((u: any) => u.rola === 'Kierownik' || u.rola === 'Dyrektor'));
      }
      if (nRes.ok) {
        const d = await nRes.json();
        setPowiadomienia(normalizeNotificationsPayload(d));
      }
      else setPowiadomienia([]);
      const quotationsReady = await supportsQuotationsModule();
      if (!quotationsReady) {
        setApprovalQueue([]);
      } else {
        try {
          const aRes = await apiFetch('/quotations/panel/moje-zatwierdzenia', { token: storedToken });
          if (aRes.ok) {
            const approvals = await aRes.json();
            setApprovalQueue(Array.isArray(approvals) ? approvals : []);
          } else {
            setApprovalQueue([]);
          }
        } catch {
          setApprovalQueue([]);
        }
      }
    } catch {
      setPowiadomienia([]);
      setApprovalQueue([]);
      setError(t('notif.errorLoad'));
      setOfflineQueueCount(await getOfflineQueueSize());
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void loadData();
    });
    return unsubscribe;
  }, [loadData]);

  const markNotificationAsRead = useCallback(
    async (notificationId: number | string) => {
      const parsedId = Number(notificationId);
      if (!Number.isFinite(parsedId) || !token) return;
      const path = apiUrl(`/notifications/${parsedId}/odczytaj`);
      try {
        const res = await apiFetch(path, {
          method: 'PUT',
          token,
        });
        if (res.ok) {
          setPowiadomienia((prev) =>
            prev.map((n) =>
              Number(n.id) === parsedId && n.status !== 'Odczytane'
                ? { ...n, status: 'Odczytane', data_odczytu: n.data_odczytu || new Date().toISOString() }
                : n,
            ),
          );
          return;
        }
      } catch {
        // fallback offline poniżej
      }
      const queued = await queueRequestWithOfflineFallback({
        dedupeKey: `notif-read:${parsedId}`,
        url: path,
        method: 'PUT',
        body: {},
      });
      setOfflineQueueCount(queued);
      setPowiadomienia((prev) =>
        prev.map((n) =>
          Number(n.id) === parsedId && n.status !== 'Odczytane'
            ? { ...n, status: 'Odczytane', data_odczytu: n.data_odczytu || new Date().toISOString() }
            : n,
        ),
      );
    },
    [token],
  );

  const markAllAsRead = useCallback(async () => {
    if (!token || unreadCount <= 0) return;
    const path = apiUrl('/notifications/odczytaj-wszystkie');
    try {
      const res = await apiFetch(path, {
        method: 'PUT',
        token,
      });
      if (res.ok) {
        void triggerHaptic('success');
        setPowiadomienia((prev) =>
          prev.map((n) =>
            n.status !== 'Odczytane'
              ? { ...n, status: 'Odczytane', data_odczytu: n.data_odczytu || new Date().toISOString() }
              : n,
          ),
        );
        return;
      }
    } catch {
      // fallback offline poniżej
    }
    const queued = await queueRequestWithOfflineFallback({
      dedupeKey: 'notif-read:all',
      url: path,
      method: 'PUT',
      body: {},
    });
    setOfflineQueueCount(queued);
    void triggerHaptic('warning');
    setPowiadomienia((prev) =>
      prev.map((n) =>
        n.status !== 'Odczytane'
          ? { ...n, status: 'Odczytane', data_odczytu: n.data_odczytu || new Date().toISOString() }
          : n,
      ),
    );
    showNotice(t('notif.alert.offlineReadQueued'), 'warning');
  }, [showNotice, token, unreadCount, t]);

  const decideApproval = useCallback(
    async (row: any, decyzja: 'Approved' | 'Returned') => {
      if (!token) {
        router.replace('/login');
        return;
      }
      const approvalId = Number(row?.approval_id);
      const quotationId = Number(row?.id);
      if (!Number.isFinite(approvalId) || !Number.isFinite(quotationId)) return;
      const payload =
        decyzja === 'Returned'
          ? { decyzja, komentarz: 'Zwrot z mobile inbox — uzupełnij dane i wyślij ponownie.' }
          : { decyzja };
      const endpoint = apiUrl(`/quotations/${quotationId}/approvals/${approvalId}/decision`);
      setApprovalBusyId(approvalId);
      try {
        const res = await apiJsonFetch(endpoint, {
          method: 'POST',
          token,
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setApprovalQueue((prev) => prev.filter((it) => Number(it.approval_id) !== approvalId));
          void triggerHaptic('success');
          showNotice(decyzja === 'Approved' ? 'Oględziny zatwierdzone.' : 'Oględziny zostały zwrócone.');
        } else if (res.status === 404) {
          void triggerHaptic('warning');
          showNotice(
            'Backend produkcyjny czeka jeszcze na wdrożenie nowego modułu wycen terenowych. Decyzja nie została wysłana.',
            'warning',
          );
        } else if (res.status >= 500) {
          const queued = await queueRequestWithOfflineFallback({
            dedupeKey: `approval-decision:${approvalId}`,
            url: endpoint,
            method: 'POST',
            body: payload as Record<string, unknown>,
          });
          setOfflineQueueCount(queued);
          setApprovalQueue((prev) => prev.filter((it) => Number(it.approval_id) !== approvalId));
          void triggerHaptic('warning');
          showNotice('Decyzja została zapisana i wyśle się po odzyskaniu połączenia.', 'warning');
        } else {
          const msg = await res.text().catch(() => '');
          void triggerHaptic('warning');
          showNotice(msg.slice(0, 200) || `HTTP ${res.status}`, 'warning');
        }
      } catch {
        const queued = await queueRequestWithOfflineFallback({
          dedupeKey: `approval-decision:${approvalId}`,
          url: endpoint,
          method: 'POST',
          body: payload as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        setApprovalQueue((prev) => prev.filter((it) => Number(it.approval_id) !== approvalId));
        void triggerHaptic('warning');
        showNotice('Decyzja została zapisana i wyśle się po odzyskaniu połączenia.', 'warning');
      } finally {
        setApprovalBusyId(null);
      }
    },
    [showNotice, token],
  );

  const wyslij = async () => {
    if (!selectedKierownik) {
      showNotice(t('notif.alert.pickRecipient'), 'warning');
      return;
    }
    setSending(true);
    setError(null);
    try {
      if (!token) { router.replace('/login'); return; }
      const payload = { to_user_id: selectedKierownik, task_id: selectedTask || null, typ: selectedTyp, tresc };
      const notificationsUrl = apiUrl('/notifications');
      const res = await apiJsonFetch(notificationsUrl, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        void triggerHaptic('success');
        showNotice(t('notif.alert.sentBody'));
        setShowForm(false); setTresc(''); setSelectedTask('');
        loadData();
      } else {
        const queued = await queueRequestWithOfflineFallback({
          url: notificationsUrl,
          method: 'POST',
          body: payload as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        void triggerHaptic('warning');
        showNotice(t('notif.alert.noConnectionBody'), 'warning');
      }
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        url: apiUrl('/notifications'),
        method: 'POST',
        body: { to_user_id: selectedKierownik, task_id: selectedTask || null, typ: selectedTyp, tresc },
      });
      setOfflineQueueCount(queued);
      void triggerHaptic('warning');
      showNotice(t('notif.alert.offlineBody'), 'warning');
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
      <FieldOpsBackdrop />
      <AppStatusBar />

      <ScreenHeader
        title={t('notif.title')}
        right={
          <TouchableOpacity
            style={S.headerActionBtn}
            onPress={() => {
              void triggerHaptic('light');
              setShowForm(!showForm);
            }}
          >
            <Ionicons name={showForm ? 'close' : 'add'} size={24} color={theme.accent} />
          </TouchableOpacity>
        }
      />
      {notice ? (
        <View
          style={[
            S.notice,
            {
              backgroundColor: notice.tone === 'warning' ? theme.warningBg : theme.successBg,
              borderColor: notice.tone === 'warning' ? theme.warning : theme.success,
            },
          ]}
        >
          <Ionicons
            name={notice.tone === 'warning' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={16}
            color={notice.tone === 'warning' ? theme.warning : theme.success}
          />
          <Text
            style={[
              S.noticeText,
              { color: notice.tone === 'warning' ? theme.warning : theme.success },
            ]}
          >
            {notice.message}
          </Text>
        </View>
      ) : null}
      {offlineQueueCount > 0 ? (
        <View style={S.offlineInfo}>
          <Ionicons name="cloud-offline-outline" size={14} color={theme.warning} />
          <Text style={S.offlineInfoText}>{t('notif.offlineQueue', { count: offlineQueueCount })}</Text>
        </View>
      ) : null}

      {!showForm ? (
        <>
          <View style={S.inboxHero}>
            <View style={S.inboxHeroTop}>
              <View style={S.inboxHeroIcon}>
                <Ionicons name="radio-outline" size={23} color={theme.accent} />
              </View>
              <View style={S.inboxHeroText}>
                <Text style={S.inboxHeroEyebrow}>INBOX OPERACYJNY</Text>
                <Text style={S.inboxHeroTitle}>Decyzje i komunikaty</Text>
                <Text style={S.inboxHeroCopy}>{inboxFocus}</Text>
              </View>
              <FieldOpsHeroImage variant="dispatch" size={74} />
              <TouchableOpacity
                style={S.inboxHeroAdd}
                onPress={() => {
                  void triggerHaptic('light');
                  setShowForm(true);
                }}
              >
                <Ionicons name="add" size={20} color={theme.accentText} />
              </TouchableOpacity>
            </View>
            <View style={S.inboxStatsGrid}>
              {inboxStats.map((item) => (
                <View key={item.id} style={S.inboxStatCard}>
                  <View style={[S.inboxStatIcon, { backgroundColor: item.bg }]}>
                    <Ionicons name={item.icon} size={17} color={item.color} />
                  </View>
                  <Text style={S.inboxStatValue}>{item.value}</Text>
                  <Text style={S.inboxStatLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={S.toolbarRow}>
            <View style={S.unreadPill}>
              <Ionicons name="mail-unread-outline" size={14} color={theme.info} />
              <Text style={S.unreadPillText}>{t('notif.unreadCount', { count: unreadCount })}</Text>
            </View>
            <TouchableOpacity
              style={[S.toolbarBtn, showOnlyUnread && S.toolbarBtnActive]}
              onPress={() => {
                void triggerHaptic('light');
                setShowOnlyUnread((prev) => !prev);
              }}
            >
              <Ionicons name={showOnlyUnread ? 'funnel' : 'funnel-outline'} size={14} color={showOnlyUnread ? theme.accentText : theme.accent} />
              <Text style={[S.toolbarBtnText, showOnlyUnread && S.toolbarBtnTextActive]}>
                {showOnlyUnread ? t('notif.filterUnreadOn') : t('notif.filterUnreadOff')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.toolbarBtn, S.toolbarBtnWide, unreadCount <= 0 && S.toolbarBtnDisabled]}
              onPress={() => { void markAllAsRead(); }}
              disabled={unreadCount <= 0}
            >
              <Ionicons name="checkmark-done-outline" size={14} color={unreadCount > 0 ? theme.accent : theme.textMuted} />
              <Text style={[S.toolbarBtnText, unreadCount <= 0 && { color: theme.textMuted }]}>
                {t('notif.markAllRead')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={S.pushCard}>
            <Text style={S.pushTitle}>{t('notifications.push.title')}</Text>
            <Text style={S.pushSub}>{t('notifications.push.sub')}</Text>
            <PlatinumCTA
              label={t('notifications.push.permission')}
              style={S.pushCta}
              onPress={() => { void registerPush(); }}
              disabled={pushBusy}
              loading={pushBusy}
            />
            <Text style={S.pushToken} selectable>
              {pushToken || t('notifications.push.none')}
            </Text>
            {pushToken ? (
              <TouchableOpacity
                onPress={() => {
                  void Clipboard.setStringAsync(pushToken);
                  showNotice(t('common.copy'));
                }}
              >
                <Text style={S.pushCopy}>{t('notifications.push.copy')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      ) : null}

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
                  {k.imie} {k.nazwisko} · {getRoleDisplayName(k.rola)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={S.label}>{t('notif.label.messageOptional')}</Text>
          <TextInput style={S.textArea} multiline numberOfLines={3}
            value={tresc} onChangeText={setTresc}
            placeholder={t('notif.placeholder.message')} placeholderTextColor={theme.inputPlaceholder} />

          <PlatinumCTA
            label={t('notif.send')}
            style={S.sendBtn}
            onPress={wyslij}
            disabled={sending}
            loading={sending}
          />
          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      {!showForm && (
        <ScrollView style={S.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={theme.accent} />}>
          {error ? <ErrorBanner message={error} /> : null}
          {approvalQueue.length > 0 ? (
            <View style={S.approvalsSection}>
              <Text style={S.approvalsTitle}>Decyzje do zatwierdzenia ({approvalQueue.length})</Text>
              <Text style={S.approvalsSub}>Zarządzaj wycenami bezpośrednio z telefonu.</Text>
              {approvalQueue.slice(0, 8).map((row) => {
                const busy = approvalBusyId === Number(row.approval_id);
                return (
                  <View key={`${row.id}-${row.approval_id}`} style={S.approvalCard}>
                    <View style={S.approvalTop}>
                      <Text style={S.approvalClient}>{row.klient_nazwa || `Wycena #${row.id}`}</Text>
                      <Text style={S.approvalType}>{String(row.wymagany_typ || 'approval')}</Text>
                    </View>
                    <Text style={S.approvalMeta}>#{row.id} · {row.status || 'W_Zatwierdzeniu'}</Text>
                    {row.due_at ? (
                      <Text style={S.approvalMeta}>Termin: {new Date(row.due_at).toLocaleString(dateLocale)}</Text>
                    ) : null}
                    <View style={S.approvalActions}>
                      <TouchableOpacity
                        style={[S.approvalBtn, S.approvalBtnOpen]}
                        onPress={() => router.push(`/wyceny-terenowe/${row.id}`)}
                        disabled={busy}
                      >
                        <Text style={S.approvalBtnOpenText}>Otwórz</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.approvalBtn, S.approvalBtnReturn]}
                        onPress={() => { void decideApproval(row, 'Returned'); }}
                        disabled={busy}
                      >
                        <Text style={S.approvalBtnReturnText}>Odeślij</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.approvalBtn, S.approvalBtnApprove]}
                        onPress={() => { void decideApproval(row, 'Approved'); }}
                        disabled={busy}
                      >
                        {busy ? <ActivityIndicator size="small" color={theme.accentText} /> : <Text style={S.approvalBtnApproveText}>Zatwierdź</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
          {visiblePowiadomienia.length === 0 ? (
            <EmptyState
              icon="notifications-outline"
              iconColor={theme.textMuted}
              title={showOnlyUnread ? t('notif.emptyUnreadTitle') : t('notif.emptyTitle')}
              subtitle={showOnlyUnread ? t('notif.emptyUnreadSubtitle') : t('notif.emptySubtitle')}
            />
          ) : visiblePowiadomienia.map(n => {
            const kolor = notifColors[n.typ as keyof typeof notifColors] || theme.textSub;
            return (
              <TouchableOpacity key={n.id}
                style={[S.card, n.status === 'Nowe' && { borderLeftColor: theme.accent, borderLeftWidth: 3 }]}
                onPress={() => {
                  void markNotificationAsRead(n.id);
                  if (n.task_id) router.push(`/zlecenie/${n.task_id}`);
                }}>
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
  headerActionBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  offlineInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.warning + '55',
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: t.warningBg,
  },
  offlineInfoText: { color: t.warning, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  inboxHero: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 10,
    padding: 13,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(9,20,16,0.94)' : 'rgba(254,255,252,0.94)',
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.18,
      radius: t.shadowRadius * 0.46,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation),
    }),
  },
  inboxHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inboxHeroIcon: {
    width: 46,
    height: 46,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.accentLight,
  },
  inboxHeroText: { flex: 1, minWidth: 0, gap: 2 },
  inboxHeroEyebrow: {
    color: t.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  inboxHeroTitle: { color: t.text, fontSize: 19, lineHeight: 23, fontWeight: '900' },
  inboxHeroCopy: { color: t.textSub, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  inboxHeroAdd: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent,
  },
  inboxStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inboxStatCard: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 76,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.name === 'dark' ? 'rgba(14,28,23,0.9)' : 'rgba(234,240,231,0.88)',
    minHeight: 72,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
  },
  inboxStatIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxStatValue: {
    color: t.text,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  inboxStatLabel: { color: t.textMuted, fontSize: 10, fontWeight: '800' },
  toolbarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  unreadPill: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.infoBg,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 40,
  },
  unreadPillText: { color: t.info, fontSize: 12, fontWeight: '700' },
  toolbarBtn: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 40,
    justifyContent: 'center',
  },
  toolbarBtnWide: {
    flexBasis: '100%',
  },
  toolbarBtnActive: {
    backgroundColor: t.accentLight,
    borderColor: t.accent,
  },
  toolbarBtnDisabled: {
    opacity: 0.65,
  },
  toolbarBtnText: { color: t.accent, fontSize: 12, fontWeight: '700' },
  toolbarBtnTextActive: { color: t.accent },
  pushCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.name === 'dark' ? 'rgba(14,28,23,0.92)' : 'rgba(234,240,231,0.9)',
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.12,
      radius: t.shadowRadius * 0.32,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  pushTitle: { color: t.text, fontWeight: '800', marginBottom: 6, fontSize: 14 },
  pushSub: { color: t.textMuted, fontSize: 12, marginBottom: 10 },
  pushCta: { alignSelf: 'flex-start', marginBottom: 10 },
  pushToken: { color: t.textSub, fontSize: 11, marginBottom: 6 },
  pushCopy: { color: t.accent, fontWeight: '700' },
  form: { flex: 1, paddingHorizontal: 12, paddingTop: 12 },
  formTitle: { fontSize: 18, fontWeight: '900', color: t.text, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '900', color: t.textSub, marginBottom: 8, marginTop: 12, textTransform: 'uppercase' },
  typCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 66,
    padding: 12, borderRadius: 6, borderWidth: 1, borderColor: t.border,
    backgroundColor: t.surface, marginBottom: 8,
  },
  typIconBg: { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  typLabel: { fontSize: 14, fontWeight: '900', color: t.text, marginBottom: 2 },
  typSub: { fontSize: 12, lineHeight: 16, color: t.textMuted, fontWeight: '700' },
  selectBox: { backgroundColor: t.surface, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: t.border },
  selectItem: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.border },
  selectText: { fontSize: 14, color: t.text, fontWeight: '700' },
  textArea: {
    backgroundColor: t.inputBg, borderRadius: 6, padding: 12,
    fontSize: 14, borderWidth: 1, borderColor: t.inputBorder,
    minHeight: 90, textAlignVertical: 'top', color: t.inputText,
  },
  sendBtn: { marginTop: 16 },
  list: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  approvalsSection: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2 + 'EE',
    padding: 11,
    marginBottom: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.16,
      radius: t.shadowRadius * 0.42,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation),
    }),
  },
  approvalsTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  approvalsSub: { color: t.textMuted, fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 3, marginBottom: 8 },
  approvalCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 10,
    minHeight: 112,
    marginTop: 8,
  },
  approvalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  approvalClient: { flex: 1, color: t.text, fontSize: 13, fontWeight: '700' },
  approvalType: { color: t.info, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  approvalMeta: { color: t.textMuted, fontSize: 11, marginTop: 2 },
  approvalActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  approvalBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 40,
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalBtnOpen: { borderColor: t.border, backgroundColor: t.surface2 },
  approvalBtnOpenText: { color: t.textSub, fontSize: 12, fontWeight: '700' },
  approvalBtnReturn: { borderColor: t.warning, backgroundColor: t.warningBg },
  approvalBtnReturnText: { color: t.warning, fontSize: 12, fontWeight: '700' },
  approvalBtnApprove: { borderColor: t.success, backgroundColor: t.success },
  approvalBtnApproveText: { color: t.accentText, fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 14, color: t.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: t.cardBg,
    borderRadius: 7,
    padding: 12,
    marginBottom: 10,
    minHeight: 96,
    gap: 11,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.14,
      radius: t.shadowRadius * 0.4,
      offsetY: 2,
      elevation: Math.max(1, t.cardElevation),
    }),
  },
  iconBg: { width: 42, height: 42, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  cardOd: { fontSize: 13.5, fontWeight: '900', color: t.text },
  cardTime: { fontSize: 11, color: t.textMuted, fontWeight: '700' },
  cardTyp: { fontSize: 12.5, color: t.textSub, marginBottom: 2, fontWeight: '800' },
  cardTresc: { fontSize: 12, lineHeight: 16, color: t.textMuted, fontStyle: 'italic', marginBottom: 2 },
  cardTask: { fontSize: 11, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
});
