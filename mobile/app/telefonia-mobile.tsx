import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { apiFetch, apiJsonFetch } from '../utils/api-client';
import { getStoredSession } from '../utils/session';

import { AppStatusBar } from '../components/ui/app-status-bar';
type SmsRow = {
  id: number;
  task_id?: number | null;
  telefon?: string | null;
  recipient_phone?: string | null;
  recipient_name?: string | null;
  status?: string | null;
  typ?: string | null;
  created_at?: string | null;
  tresc?: string | null;
};

type CallRow = {
  id: number;
  client_number?: string | null;
  staff_number?: string | null;
  status?: string | null;
  duration_sec?: number | null;
  task_id?: number | null;
  created_at?: string | null;
};

type CallbackRow = {
  id: number;
  oddzial_id?: number | null;
  phone?: string | null;
  task_id?: number | null;
  lead_name?: string | null;
  priority?: 'low' | 'normal' | 'high' | string | null;
  due_at?: string | null;
  status?: 'open' | 'in_progress' | 'done' | 'cancelled' | string | null;
  notes?: string | null;
  created_at?: string | null;
};

async function parseResponse(res: Response) {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

export default function TelefoniaMobileScreen() {
  const { theme } = useTheme();
  const guard = useOddzialFeatureGuard('/telefonia-mobile');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'calls' | 'sms'>('calls');
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [smsRows, setSmsRows] = useState<SmsRow[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [callPhone, setCallPhone] = useState('');
  const [callTaskId, setCallTaskId] = useState('');
  const [smsPhone, setSmsPhone] = useState('');
  const [smsText, setSmsText] = useState('');
  const [callbackPhone, setCallbackPhone] = useState('');
  const [callbackTaskId, setCallbackTaskId] = useState('');
  const [callbackLead, setCallbackLead] = useState('');
  const [callbackDueAt, setCallbackDueAt] = useState('');
  const [callbackNotes, setCallbackNotes] = useState('');
  const [callbackPriority, setCallbackPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [callbackStatusFilter, setCallbackStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'done'>('open');
  const [busyCall, setBusyCall] = useState(false);
  const [busySms, setBusySms] = useState(false);
  const [busyCallback, setBusyCallback] = useState(false);
  const S = makeStyles(theme);

  const smsChars = useMemo(() => smsText.trim().length, [smsText]);

  const loadData = useCallback(
    async (authToken?: string | null) => {
      const tokenToUse = authToken ?? token;
      if (!tokenToUse) return;
      try {
        const callbacksQs = oddzialId ? `?oddzial_id=${oddzialId}` : '';
        const [callsRes, smsRes, callbacksRes] = await Promise.all([
          apiFetch('/telefon/rozmowy?limit=25&offset=0', { token: tokenToUse }),
          apiFetch('/sms/historia?limit=25&offset=0', { token: tokenToUse }),
          apiFetch(`/telephony/callbacks${callbacksQs}`, { token: tokenToUse }),
        ]);
        const callsData = await parseResponse(callsRes);
        const smsData = await parseResponse(smsRes);
        const callbacksData = await parseResponse(callbacksRes);
        const callsRows = Array.isArray(callsData)
          ? (callsData as CallRow[])
          : Array.isArray((callsData as { items?: CallRow[] })?.items)
            ? ((callsData as { items?: CallRow[] }).items as CallRow[])
            : [];
        const smsHistoryRows = Array.isArray(smsData)
          ? (smsData as SmsRow[])
          : Array.isArray((smsData as { items?: SmsRow[] })?.items)
            ? ((smsData as { items?: SmsRow[] }).items as SmsRow[])
            : [];
        const callbackRows = Array.isArray(callbacksData)
          ? (callbacksData as CallbackRow[])
          : Array.isArray((callbacksData as { items?: CallbackRow[] })?.items)
            ? ((callbacksData as { items?: CallbackRow[] }).items as CallbackRow[])
            : [];
        setCalls(callsRows);
        setSmsRows(smsHistoryRows);
        setCallbacks(callbackRows);
      } catch {
        setCalls([]);
        setSmsRows([]);
        setCallbacks([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, oddzialId],
  );

  useEffect(() => {
    void (async () => {
      const session = await getStoredSession();
      if (!session.token) return;
      setToken(session.token);
      const sessionOddzial = Number(session.user?.oddzial_id);
      setOddzialId(Number.isFinite(sessionOddzial) && sessionOddzial > 0 ? sessionOddzial : null);
      await loadData(session.token);
    })();
  }, [loadData]);

  const callClient = async () => {
    if (!token) return;
    if (!callPhone.trim()) {
      Alert.alert('Telefonia', 'Podaj numer klienta.');
      return;
    }
    setBusyCall(true);
    try {
      const taskId = Number(callTaskId);
      const payload = {
        do: callPhone.trim(),
        ...(Number.isFinite(taskId) && taskId > 0 ? { task_id: taskId } : {}),
      };
      const res = await apiJsonFetch('/telefon/polacz-do-klienta', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'error' in data && (data as { error?: string }).error
            ? (data as { error?: string }).error
            : 'Nie udalo sie uruchomic polaczenia.';
        throw new Error(msg);
      }
      Alert.alert('Telefonia', 'Polaczenie zostalo uruchomione.');
      setCallPhone('');
      setCallTaskId('');
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad telefonu.';
      Alert.alert('Telefonia', msg);
    } finally {
      setBusyCall(false);
    }
  };

  const sendManualSms = async () => {
    if (!token) return;
    if (!smsPhone.trim() || !smsText.trim()) {
      Alert.alert('SMS', 'Podaj numer i tresc wiadomosci.');
      return;
    }
    setBusySms(true);
    try {
      const res = await apiJsonFetch('/sms/wyslij', {
        method: 'POST',
        token,
        body: JSON.stringify({
          telefon: smsPhone.trim(),
          tresc: smsText.trim(),
        }),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'error' in data && (data as { error?: string }).error
            ? (data as { error?: string }).error
            : 'Nie udalo sie wyslac SMS.';
        throw new Error(msg);
      }
      Alert.alert('SMS', 'Wiadomosc wyslana.');
      setSmsPhone('');
      setSmsText('');
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad wysylki SMS.';
      Alert.alert('SMS', msg);
    } finally {
      setBusySms(false);
    }
  };

  const createCallback = async () => {
    if (!token) return;
    if (!callbackPhone.trim()) {
      Alert.alert('Telefonia', 'Podaj numer do oddzwonienia.');
      return;
    }
    if (!oddzialId) {
      Alert.alert('Telefonia', 'Brak oddzialu w sesji. Zaloguj sie ponownie.');
      return;
    }
    setBusyCallback(true);
    try {
      const taskId = Number(callbackTaskId);
      const dueRaw = callbackDueAt.trim();
      const dueAt = dueRaw ? new Date(dueRaw) : null;
      const payload = {
        oddzial_id: oddzialId,
        phone: callbackPhone.trim(),
        task_id: Number.isFinite(taskId) && taskId > 0 ? taskId : null,
        lead_name: callbackLead.trim() || null,
        priority: callbackPriority,
        due_at: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : null,
        notes: callbackNotes.trim() || null,
      };
      const res = await apiJsonFetch('/telephony/callbacks', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'error' in data && (data as { error?: string }).error
            ? (data as { error?: string }).error
            : 'Nie udalo sie dodac oddzwonienia.';
        throw new Error(msg);
      }
      Alert.alert('Telefonia', 'Oddzwonienie dodane do kolejki.');
      setCallbackPhone('');
      setCallbackTaskId('');
      setCallbackLead('');
      setCallbackDueAt('');
      setCallbackNotes('');
      setCallbackPriority('normal');
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad callback.';
      Alert.alert('Telefonia', msg);
    } finally {
      setBusyCallback(false);
    }
  };

  const updateCallbackStatus = async (id: number, status: 'open' | 'in_progress' | 'done' | 'cancelled') => {
    if (!token) return;
    try {
      const res = await apiJsonFetch(`/telephony/callbacks/${id}/status`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status }),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        const msg =
          typeof data === 'object' && data && 'error' in data && (data as { error?: string }).error
            ? (data as { error?: string }).error
            : 'Nie udalo sie zaktualizowac callbacku.';
        throw new Error(msg);
      }
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad callback.';
      Alert.alert('Telefonia', msg);
    }
  };

  const callbackRows = useMemo(() => {
    if (callbackStatusFilter === 'all') return callbacks;
    return callbacks.filter((row) => (row.status || 'open') === callbackStatusFilter);
  }, [callbacks, callbackStatusFilter]);
  const openCallbacks = useMemo(
    () => callbacks.filter((row) => (row.status || 'open') === 'open' || row.status === 'in_progress').length,
    [callbacks],
  );

  const openDial = async (raw: string | null | undefined) => {
    if (!raw) return;
    const url = `tel:${raw}`;
    const can = await Linking.canOpenURL(url);
    if (!can) return;
    await Linking.openURL(url);
  };

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
      <AppStatusBar />
      <ScreenHeader title="Telefonia i SMS" />
      <View style={S.statsRow}>
        <View style={S.statPill}>
          <Text style={S.statValue}>{calls.length}</Text>
          <Text style={S.statLabel}>rozmow</Text>
        </View>
        <View style={S.statPill}>
          <Text style={S.statValue}>{openCallbacks}</Text>
          <Text style={S.statLabel}>do oddzw.</Text>
        </View>
        <View style={S.statPill}>
          <Text style={S.statValue}>{smsRows.length}</Text>
          <Text style={S.statLabel}>SMS</Text>
        </View>
      </View>
      <View style={S.tabRow}>
        <TouchableOpacity style={[S.tabBtn, tab === 'calls' && S.tabBtnActive]} onPress={() => setTab('calls')}>
          <Text style={[S.tabText, tab === 'calls' && S.tabTextActive]}>Polaczenia</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.tabBtn, tab === 'sms' && S.tabBtnActive]} onPress={() => setTab('sms')}>
          <Text style={[S.tabText, tab === 'sms' && S.tabTextActive]}>SMS</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={S.scroll}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            tintColor={theme.accent}
          />
        )}
      >
        {tab === 'calls' ? (
          <>
            <View style={S.sectionCard}>
              <Text style={S.sectionTitle}>Polacz do klienta</Text>
              <TextInput
                style={S.input}
                placeholder="Numer klienta, np. +48500100200"
                placeholderTextColor={theme.inputPlaceholder}
                value={callPhone}
                onChangeText={setCallPhone}
              />
              <TextInput
                style={S.input}
                placeholder="ID zlecenia (opcjonalnie)"
                placeholderTextColor={theme.inputPlaceholder}
                value={callTaskId}
                onChangeText={setCallTaskId}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={S.primaryBtn} onPress={() => void callClient()} disabled={busyCall}>
                <Text style={S.primaryBtnText}>{busyCall ? 'Laczenie...' : 'Zadzwon przez system'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={S.listLabel}>Ostatnie rozmowy ({calls.length})</Text>
            {calls.length === 0 ? (
              <View style={S.empty}>
                <Text style={S.emptyText}>Brak rozmow w logu.</Text>
              </View>
            ) : (
              calls.map((row) => (
                <View key={row.id} style={S.rowCard}>
                  <View style={S.rowTop}>
                    <Text style={S.rowTitle}>Rozmowa #{row.id}</Text>
                    <Text style={S.badge}>{row.status || 'unknown'}</Text>
                  </View>
                  <Text style={S.rowMeta}>
                    klient: {row.client_number || '-'}  •  pracownik: {row.staff_number || '-'}
                  </Text>
                  <Text style={S.rowMeta}>
                    {row.created_at ? new Date(row.created_at).toLocaleString('pl-PL') : '-'}
                    {row.duration_sec ? `  •  ${row.duration_sec}s` : ''}
                    {row.task_id ? `  •  zlecenie #${row.task_id}` : ''}
                  </Text>
                  <TouchableOpacity
                    style={S.inlineAction}
                    onPress={() => void openDial(row.client_number)}
                  >
                    <Ionicons name="call-outline" size={14} color={theme.accent} />
                    <Text style={S.inlineActionText}>Oddzwon</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

            <View style={S.sectionCard}>
              <Text style={S.sectionTitle}>Kolejka oddzwonien</Text>
              <TextInput
                style={S.input}
                placeholder="Numer telefonu"
                placeholderTextColor={theme.inputPlaceholder}
                value={callbackPhone}
                onChangeText={setCallbackPhone}
              />
              <View style={S.row}>
                <TextInput
                  style={[S.input, S.flex]}
                  placeholder="Lead / klient (opcjonalnie)"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={callbackLead}
                  onChangeText={setCallbackLead}
                />
                <TextInput
                  style={[S.input, S.smallInput]}
                  placeholder="Task ID"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={callbackTaskId}
                  onChangeText={setCallbackTaskId}
                  keyboardType="number-pad"
                />
              </View>
              <View style={S.row}>
                <TextInput
                  style={[S.input, S.flex]}
                  placeholder="Termin oddzwonienia (YYYY-MM-DD HH:mm)"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={callbackDueAt}
                  onChangeText={setCallbackDueAt}
                />
                <View style={S.priorityRow}>
                  {(['low', 'normal', 'high'] as const).map((priority) => (
                    <TouchableOpacity
                      key={priority}
                      style={[S.priorityChip, callbackPriority === priority && S.priorityChipActive]}
                      onPress={() => setCallbackPriority(priority)}
                    >
                      <Text style={[S.priorityChipText, callbackPriority === priority && S.priorityChipTextActive]}>
                        {priority}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <TextInput
                style={[S.input, S.textarea]}
                placeholder="Notatka do callbacku"
                placeholderTextColor={theme.inputPlaceholder}
                value={callbackNotes}
                onChangeText={setCallbackNotes}
                multiline
              />
              <TouchableOpacity style={S.primaryBtn} onPress={() => void createCallback()} disabled={busyCallback}>
                <Text style={S.primaryBtnText}>{busyCallback ? 'Zapisywanie...' : 'Dodaj oddzwonienie'}</Text>
              </TouchableOpacity>
            </View>

            <View style={S.row}>
              <Text style={S.listLabel}>Callbacki ({callbackRows.length})</Text>
              <View style={S.filterWrap}>
                {(['open', 'in_progress', 'done', 'all'] as const).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[S.filterChip, callbackStatusFilter === status && S.filterChipActive]}
                    onPress={() => setCallbackStatusFilter(status)}
                  >
                    <Text style={[S.filterChipText, callbackStatusFilter === status && S.filterChipTextActive]}>
                      {status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {callbackRows.length === 0 ? (
              <View style={S.empty}>
                <Text style={S.emptyText}>Brak callbackow dla filtra.</Text>
              </View>
            ) : (
              callbackRows.map((row) => (
                <View key={row.id} style={S.rowCard}>
                  <View style={S.rowTop}>
                    <Text style={S.rowTitle}>Callback #{row.id}</Text>
                    <Text style={S.badge}>{row.status || 'open'}</Text>
                  </View>
                  <Text style={S.rowMeta}>
                    {row.lead_name || 'klient'}  •  {row.phone || '-'}
                  </Text>
                  <Text style={S.rowMeta}>
                    due: {row.due_at ? new Date(row.due_at).toLocaleString('pl-PL') : 'brak'}
                    {row.task_id ? `  •  zlecenie #${row.task_id}` : ''}
                    {row.priority ? `  •  ${row.priority}` : ''}
                  </Text>
                  {row.notes ? <Text style={S.smsText}>{row.notes}</Text> : null}
                  <View style={S.callbackActions}>
                    <TouchableOpacity style={S.inlineAction} onPress={() => void openDial(row.phone)}>
                      <Ionicons name="call-outline" size={14} color={theme.accent} />
                      <Text style={S.inlineActionText}>Zadzwon</Text>
                    </TouchableOpacity>
                    {(row.status === 'open' || row.status === 'in_progress') ? (
                      <TouchableOpacity style={S.inlineAction} onPress={() => void updateCallbackStatus(row.id, 'done')}>
                        <Ionicons name="checkmark-circle-outline" size={14} color={theme.success} />
                        <Text style={S.inlineActionText}>Done</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(row.status === 'open' || row.status === 'in_progress') ? (
                      <TouchableOpacity style={S.inlineAction} onPress={() => void updateCallbackStatus(row.id, 'cancelled')}>
                        <Ionicons name="close-circle-outline" size={14} color={theme.danger} />
                        <Text style={S.inlineActionText}>Anuluj</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </>
        ) : (
          <>
            <View style={S.sectionCard}>
              <Text style={S.sectionTitle}>Szybki SMS</Text>
              <TextInput
                style={S.input}
                placeholder="Numer odbiorcy"
                placeholderTextColor={theme.inputPlaceholder}
                value={smsPhone}
                onChangeText={setSmsPhone}
              />
              <TextInput
                style={[S.input, S.textarea]}
                placeholder="Tresc wiadomosci"
                placeholderTextColor={theme.inputPlaceholder}
                value={smsText}
                onChangeText={setSmsText}
                multiline
              />
              <Text style={S.helper}>Znaki: {smsChars}</Text>
              <TouchableOpacity style={S.primaryBtn} onPress={() => void sendManualSms()} disabled={busySms}>
                <Text style={S.primaryBtnText}>{busySms ? 'Wysylanie...' : 'Wyslij SMS'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={S.listLabel}>Historia SMS ({smsRows.length})</Text>
            {smsRows.length === 0 ? (
              <View style={S.empty}>
                <Text style={S.emptyText}>Brak wpisow historii SMS.</Text>
              </View>
            ) : (
              smsRows.map((row) => {
                const phone = row.recipient_phone || row.telefon || '';
                return (
                  <View key={row.id} style={S.rowCard}>
                    <View style={S.rowTop}>
                      <Text style={S.rowTitle}>SMS #{row.id}</Text>
                      <Text style={S.badge}>{row.status || '-'}</Text>
                    </View>
                    <Text style={S.rowMeta}>
                      {row.recipient_name || 'odbiorca'}  •  {phone || '-'}
                    </Text>
                    <Text style={S.rowMeta}>
                      {row.created_at ? new Date(row.created_at).toLocaleString('pl-PL') : '-'}
                      {row.task_id ? `  •  zlecenie #${row.task_id}` : ''}
                    </Text>
                    {row.tresc ? <Text style={S.smsText}>{row.tresc}</Text> : null}
                    <TouchableOpacity style={S.inlineAction} onPress={() => void openDial(phone)}>
                      <Ionicons name="call-outline" size={14} color={theme.accent} />
                      <Text style={S.inlineActionText}>Zadzwon</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </>
        )}
        <View style={{ height: 26 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, backgroundColor: t.bg, justifyContent: 'center', alignItems: 'center' },
    statsRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 8,
    },
    statPill: {
      flex: 1,
      minHeight: 54,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.cardBorder,
      backgroundColor: t.cardBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statValue: { color: t.text, fontSize: 18, fontWeight: '900' },
    statLabel: { color: t.textSub, fontSize: 11, fontWeight: '800', marginTop: 1 },
    tabRow: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: 2,
      paddingBottom: 8,
      backgroundColor: t.bg,
    },
    tabBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.cardBorder,
      backgroundColor: t.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabBtnActive: {
      borderColor: t.accent,
      backgroundColor: t.accentLight,
    },
    tabText: { color: t.textSub, fontWeight: '800', fontSize: 13 },
    tabTextActive: { color: t.accent, fontWeight: '900' },
    scroll: { flex: 1, paddingHorizontal: 12 },
    sectionCard: {
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 12,
      backgroundColor: t.cardBg,
      padding: 12,
      marginBottom: 10,
      gap: 9,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    flex: { flex: 1, minWidth: 190 },
    smallInput: { width: 100, flexGrow: 1 },
    sectionTitle: { color: t.text, fontWeight: '900', fontSize: 15 },
    input: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 11,
      minHeight: 46,
      color: t.inputText,
      backgroundColor: t.inputBg,
    },
    textarea: { minHeight: 78, textAlignVertical: 'top' },
    helper: { color: t.textMuted, fontSize: 11 },
    primaryBtn: {
      minHeight: 50,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent,
      borderWidth: 1,
      borderColor: t.accentDark,
    },
    primaryBtnText: { color: t.accentText, fontWeight: '900', fontSize: 14 },
    listLabel: {
      color: t.textSub,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginBottom: 6,
      marginTop: 4,
    },
    filterWrap: { marginLeft: 'auto', flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 },
    filterChip: {
      minHeight: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterChipActive: { borderColor: t.accent, backgroundColor: t.accentLight },
    filterChipText: { color: t.textSub, fontSize: 10, fontWeight: '700' },
    filterChipTextActive: { color: t.accent },
    priorityRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    priorityChip: {
      minHeight: 38,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    priorityChipActive: { borderColor: t.accent, backgroundColor: t.accentLight },
    priorityChipText: { color: t.textSub, fontSize: 11, fontWeight: '700' },
    priorityChipTextActive: { color: t.accent },
    empty: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      backgroundColor: t.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      marginBottom: 8,
    },
    emptyText: { color: t.textMuted, fontSize: 13 },
    rowCard: {
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 12,
      backgroundColor: t.cardBg,
      padding: 12,
      marginBottom: 8,
      gap: 6,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    rowTitle: { color: t.text, fontWeight: '900', fontSize: 14, flex: 1 },
    badge: {
      color: t.accent,
      fontSize: 11,
      fontWeight: '700',
      backgroundColor: t.accentLight,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    rowMeta: { color: t.textSub, fontSize: 11 },
    smsText: {
      color: t.text,
      fontSize: 12,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 9,
      backgroundColor: t.surface2,
      padding: 8,
      marginTop: 2,
    },
    inlineAction: {
      marginTop: 5,
      minHeight: 40,
      alignSelf: 'flex-start',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    callbackActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    inlineActionText: { color: t.text, fontWeight: '600', fontSize: 12 },
  });
