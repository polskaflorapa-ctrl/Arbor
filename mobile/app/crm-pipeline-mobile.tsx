import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { apiFetch, apiJsonFetch } from '../utils/api-client';
import { getStoredSession } from '../utils/session';

const STAGES = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane'] as const;
type StageName = (typeof STAGES)[number];
type ActivityType = 'note' | 'call' | 'task';

type CrmLead = {
  id: number;
  title: string;
  stage: StageName;
  source?: string | null;
  value?: number | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  client_name?: string | null;
  next_action_at?: string | null;
  updated_at?: string | null;
};

type CrmActivity = {
  id: number;
  type: ActivityType;
  text: string;
  due_at?: string | null;
  completed_at?: string | null;
  author_name?: string | null;
  created_at?: string | null;
};

type CrmOverview = {
  kpis?: {
    clients_total?: number;
    tasks_total?: number;
    calls_30d?: number;
    callbacks_open?: number;
  };
  pipeline?: { stage: string; count: number; value: number }[];
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

function plDate(ts?: string | null) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('pl-PL');
  } catch {
    return String(ts);
  }
}

export default function CrmPipelineMobileScreen() {
  const { theme } = useTheme();
  const guard = useOddzialFeatureGuard('/crm-pipeline-mobile');
  const [token, setToken] = useState<string | null>(null);
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [stageFilter, setStageFilter] = useState<'ALL' | StageName>('ALL');
  const [query, setQuery] = useState('');
  const [leadTitle, setLeadTitle] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadValue, setLeadValue] = useState('');
  const [leadSource, setLeadSource] = useState('mobile');
  const [leadBusy, setLeadBusy] = useState(false);
  const [activityText, setActivityText] = useState('');
  const [activityType, setActivityType] = useState<ActivityType>('note');
  const [activityBusy, setActivityBusy] = useState(false);
  const S = makeStyles(theme);

  const selectedLead = useMemo(
    () => leads.find((lead) => Number(lead.id) === Number(selectedLeadId)) || null,
    [leads, selectedLeadId],
  );

  const filteredLeads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (stageFilter !== 'ALL' && lead.stage !== stageFilter) return false;
      if (!q) return true;
      return [lead.title, lead.client_name, lead.phone, lead.email, lead.source, lead.notes]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [leads, query, stageFilter]);

  const loadActivities = useCallback(async (leadId: number, authToken?: string | null) => {
    const tokenToUse = authToken ?? token;
    if (!tokenToUse || !leadId) return;
    setLoadingActivities(true);
    try {
      const res = await apiFetch(`/crm/leads/${leadId}/activities`, { token: tokenToUse });
      const data = await parseResponse(res);
      if (!res.ok) {
        throw new Error(typeof data === 'object' && data && 'error' in data ? String((data as { error?: string }).error) : 'Blad aktywnosci');
      }
      setActivities(Array.isArray(data) ? (data as CrmActivity[]) : []);
    } catch (err) {
      setActivities([]);
      const msg = err instanceof Error ? err.message : 'Blad aktywnosci';
      Alert.alert('CRM', msg);
    } finally {
      setLoadingActivities(false);
    }
  }, [token]);

  const loadData = useCallback(async (authToken?: string | null, branchId?: number | null) => {
    const tokenToUse = authToken ?? token;
    const oddzialToUse = branchId ?? oddzialId;
    if (!tokenToUse) return;
    try {
      const qs = oddzialToUse ? `?oddzial_id=${oddzialToUse}` : '';
      const [overviewRes, leadsRes] = await Promise.all([
        apiFetch(`/crm/overview${qs}`, { token: tokenToUse }),
        apiFetch(`/crm/leads${qs}`, { token: tokenToUse }),
      ]);
      const overviewData = await parseResponse(overviewRes);
      const leadsData = await parseResponse(leadsRes);
      if (!overviewRes.ok || !leadsRes.ok) {
        throw new Error('Nie udalo sie pobrac danych CRM.');
      }
      setOverview((overviewData || null) as CrmOverview | null);
      const rows = Array.isArray(leadsData) ? (leadsData as CrmLead[]) : [];
      setLeads(rows);
      if (!rows.length) {
        setSelectedLeadId(null);
        setActivities([]);
      } else if (!rows.find((x) => Number(x.id) === Number(selectedLeadId))) {
        setSelectedLeadId(rows[0].id);
        await loadActivities(rows[0].id, tokenToUse);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad CRM';
      Alert.alert('CRM', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, oddzialId, selectedLeadId, loadActivities]);

  useEffect(() => {
    void (async () => {
      const session = await getStoredSession();
      if (!session.token) {
        router.replace('/login');
        return;
      }
      setToken(session.token);
      const userOddzialId = Number(session.user?.oddzial_id);
      const resolvedOddzial = Number.isFinite(userOddzialId) && userOddzialId > 0 ? userOddzialId : null;
      setOddzialId(resolvedOddzial);
      await loadData(session.token, resolvedOddzial);
    })();
  }, [loadData]);

  const createLead = async () => {
    if (!token) return;
    if (!leadTitle.trim()) {
      Alert.alert('CRM', 'Podaj tytul leada.');
      return;
    }
    if (!oddzialId) {
      Alert.alert('CRM', 'Brak oddzialu w sesji. Zaloguj sie ponownie.');
      return;
    }
    setLeadBusy(true);
    try {
      const payload = {
        title: leadTitle.trim(),
        oddzial_id: oddzialId,
        phone: leadPhone.trim() || null,
        source: leadSource.trim() || 'mobile',
        value: Number(leadValue) || 0,
      };
      const res = await apiJsonFetch('/crm/leads', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        throw new Error(typeof data === 'object' && data && 'error' in data ? String((data as { error?: string }).error) : 'Nie udalo sie utworzyc leada.');
      }
      setLeadTitle('');
      setLeadPhone('');
      setLeadValue('');
      await loadData();
      Alert.alert('CRM', 'Lead zostal dodany.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad tworzenia leada';
      Alert.alert('CRM', msg);
    } finally {
      setLeadBusy(false);
    }
  };

  const moveLeadStage = async (lead: CrmLead, direction: 'prev' | 'next') => {
    if (!token) return;
    const idx = STAGES.findIndex((stage) => stage === lead.stage);
    if (idx < 0) return;
    const nextIdx = direction === 'next' ? Math.min(STAGES.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (nextIdx === idx) return;
    const nextStage = STAGES[nextIdx];
    try {
      const res = await apiJsonFetch(`/crm/leads/${lead.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ stage: nextStage }),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        throw new Error(typeof data === 'object' && data && 'error' in data ? String((data as { error?: string }).error) : 'Nie udalo sie zmienic etapu.');
      }
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad zmiany etapu';
      Alert.alert('CRM', msg);
    }
  };

  const addActivity = async () => {
    if (!token || !selectedLead) return;
    if (!activityText.trim()) {
      Alert.alert('CRM', 'Wpisz tresc aktywnosci.');
      return;
    }
    setActivityBusy(true);
    try {
      const res = await apiJsonFetch(`/crm/leads/${selectedLead.id}/activities`, {
        method: 'POST',
        token,
        body: JSON.stringify({ type: activityType, text: activityText.trim() }),
      });
      const data = await parseResponse(res);
      if (!res.ok) {
        throw new Error(typeof data === 'object' && data && 'error' in data ? String((data as { error?: string }).error) : 'Nie udalo sie zapisac aktywnosci.');
      }
      setActivityText('');
      setActivityType('note');
      await loadActivities(selectedLead.id);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad aktywnosci';
      Alert.alert('CRM', msg);
    } finally {
      setActivityBusy(false);
    }
  };

  const markTaskDone = async (activityId: number) => {
    if (!token || !selectedLead) return;
    try {
      const res = await apiJsonFetch(`/crm/leads/${selectedLead.id}/activities/${activityId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) throw new Error('Nie udalo sie zamknac zadania.');
      await loadActivities(selectedLead.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Blad aktywnosci';
      Alert.alert('CRM', msg);
    }
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
      <StatusBar barStyle={theme.name === 'light' ? 'dark-content' : 'light-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title="CRM Pipeline" />
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
        <View style={S.kpiRow}>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Klienci</Text>
            <Text style={S.kpiValue}>{overview?.kpis?.clients_total ?? 0}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Polaczenia 30d</Text>
            <Text style={S.kpiValue}>{overview?.kpis?.calls_30d ?? 0}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Callback open</Text>
            <Text style={S.kpiValue}>{overview?.kpis?.callbacks_open ?? 0}</Text>
          </View>
        </View>

        <View style={S.sectionCard}>
          <Text style={S.sectionTitle}>Nowy lead</Text>
          <TextInput
            style={S.input}
            placeholder="Tytul leada"
            placeholderTextColor={theme.inputPlaceholder}
            value={leadTitle}
            onChangeText={setLeadTitle}
          />
          <View style={S.row}>
            <TextInput
              style={[S.input, S.flex]}
              placeholder="Telefon"
              placeholderTextColor={theme.inputPlaceholder}
              value={leadPhone}
              onChangeText={setLeadPhone}
            />
            <TextInput
              style={[S.input, S.valueInput]}
              placeholder="Wartosc"
              placeholderTextColor={theme.inputPlaceholder}
              value={leadValue}
              onChangeText={setLeadValue}
              keyboardType="numeric"
            />
          </View>
          <TextInput
            style={S.input}
            placeholder="Zrodlo (np. mobile, telefon, polecenie)"
            placeholderTextColor={theme.inputPlaceholder}
            value={leadSource}
            onChangeText={setLeadSource}
          />
          <TouchableOpacity style={S.primaryBtn} onPress={() => void createLead()} disabled={leadBusy}>
            <Text style={S.primaryBtnText}>{leadBusy ? 'Zapisywanie...' : 'Dodaj lead'}</Text>
          </TouchableOpacity>
        </View>

        <View style={S.sectionCard}>
          <Text style={S.sectionTitle}>Filtry</Text>
          <TextInput
            style={S.input}
            placeholder="Szukaj po tytule, kliencie, telefonie..."
            placeholderTextColor={theme.inputPlaceholder}
            value={query}
            onChangeText={setQuery}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.stageRow}>
            <TouchableOpacity
              style={[S.stageChip, stageFilter === 'ALL' && S.stageChipActive]}
              onPress={() => setStageFilter('ALL')}
            >
              <Text style={[S.stageChipText, stageFilter === 'ALL' && S.stageChipTextActive]}>Wszystkie</Text>
            </TouchableOpacity>
            {STAGES.map((stage) => (
              <TouchableOpacity
                key={stage}
                style={[S.stageChip, stageFilter === stage && S.stageChipActive]}
                onPress={() => setStageFilter(stage)}
              >
                <Text style={[S.stageChipText, stageFilter === stage && S.stageChipTextActive]}>{stage}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <Text style={S.listLabel}>Leady ({filteredLeads.length})</Text>
        {filteredLeads.length === 0 ? (
          <View style={S.empty}>
            <Text style={S.emptyText}>Brak leadow dla wybranego filtra.</Text>
          </View>
        ) : (
          filteredLeads.map((lead) => (
            <TouchableOpacity
              key={lead.id}
              style={[S.rowCard, Number(selectedLeadId) === Number(lead.id) && S.rowCardActive]}
              onPress={() => {
                setSelectedLeadId(lead.id);
                void loadActivities(lead.id);
              }}
            >
              <View style={S.rowTop}>
                <Text style={S.rowTitle}>{lead.title}</Text>
                <Text style={S.badge}>{lead.stage}</Text>
              </View>
              <Text style={S.rowMeta}>{lead.client_name || 'brak klienta'}  •  {lead.phone || '-'}</Text>
              <Text style={S.rowMeta}>
                wartosc: {(Number(lead.value || 0) || 0).toLocaleString('pl-PL')} PLN
                {lead.source ? `  •  ${lead.source}` : ''}
              </Text>
              <Text style={S.rowMeta}>aktualizacja: {plDate(lead.updated_at)}</Text>
            </TouchableOpacity>
          ))
        )}

        {selectedLead ? (
          <View style={S.sectionCard}>
            <View style={S.rowTop}>
              <Text style={S.sectionTitle}>Lead #{selectedLead.id}</Text>
              <Text style={S.badge}>{selectedLead.stage}</Text>
            </View>
            <Text style={S.rowMeta}>{selectedLead.title}</Text>
            <View style={S.row}>
              <TouchableOpacity style={S.stageBtn} onPress={() => void moveLeadStage(selectedLead, 'prev')}>
                <Ionicons name="chevron-back" size={15} color={theme.text} />
                <Text style={S.stageBtnText}>Cofnij etap</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.stageBtn} onPress={() => void moveLeadStage(selectedLead, 'next')}>
                <Text style={S.stageBtnText}>Nastepny etap</Text>
                <Ionicons name="chevron-forward" size={15} color={theme.text} />
              </TouchableOpacity>
            </View>
            <Text style={S.subHeader}>Nowa aktywnosc</Text>
            <View style={S.row}>
              <TouchableOpacity style={[S.typeChip, activityType === 'note' && S.typeChipActive]} onPress={() => setActivityType('note')}>
                <Text style={[S.typeChipText, activityType === 'note' && S.typeChipTextActive]}>Notatka</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.typeChip, activityType === 'call' && S.typeChipActive]} onPress={() => setActivityType('call')}>
                <Text style={[S.typeChipText, activityType === 'call' && S.typeChipTextActive]}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.typeChip, activityType === 'task' && S.typeChipActive]} onPress={() => setActivityType('task')}>
                <Text style={[S.typeChipText, activityType === 'task' && S.typeChipTextActive]}>Task</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[S.input, S.textarea]}
              placeholder="Co zrobiono / co dalej?"
              placeholderTextColor={theme.inputPlaceholder}
              value={activityText}
              onChangeText={setActivityText}
              multiline
            />
            <TouchableOpacity style={S.primaryBtn} onPress={() => void addActivity()} disabled={activityBusy}>
              <Text style={S.primaryBtnText}>{activityBusy ? 'Zapisywanie...' : 'Dodaj aktywnosc'}</Text>
            </TouchableOpacity>

            <Text style={S.subHeader}>Historia aktywnosci</Text>
            {loadingActivities ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : activities.length === 0 ? (
              <Text style={S.emptyText}>Brak aktywnosci dla tego leada.</Text>
            ) : (
              activities.map((activity) => (
                <View key={activity.id} style={S.activityCard}>
                  <View style={S.rowTop}>
                    <Text style={S.rowTitle}>{activity.type.toUpperCase()}</Text>
                    <Text style={S.rowMeta}>{plDate(activity.created_at)}</Text>
                  </View>
                  <Text style={S.activityText}>{activity.text}</Text>
                  <Text style={S.rowMeta}>
                    autor: {activity.author_name || '-'}
                    {activity.completed_at ? `  •  zamkniete: ${plDate(activity.completed_at)}` : ''}
                  </Text>
                  {activity.type === 'task' && !activity.completed_at ? (
                    <TouchableOpacity style={S.inlineAction} onPress={() => void markTaskDone(activity.id)}>
                      <Ionicons name="checkmark-circle-outline" size={15} color={theme.accent} />
                      <Text style={S.inlineActionText}>Oznacz jako wykonane</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}
        <View style={{ height: 28 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, backgroundColor: t.bg, justifyContent: 'center', alignItems: 'center' },
    scroll: { flex: 1, paddingHorizontal: 12 },
    kpiRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 10 },
    kpiCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 11,
      backgroundColor: t.cardBg,
      paddingVertical: 10,
      paddingHorizontal: 8,
    },
    kpiLabel: { color: t.textSub, fontSize: 11, fontWeight: '600' },
    kpiValue: { color: t.text, fontSize: 18, fontWeight: '800', marginTop: 2 },
    sectionCard: {
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 14,
      backgroundColor: t.cardBg,
      padding: 12,
      marginBottom: 10,
      gap: 8,
    },
    sectionTitle: { color: t.text, fontSize: 15, fontWeight: '800' },
    subHeader: { color: t.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
    input: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 9,
      backgroundColor: t.inputBg,
      color: t.inputText,
      minHeight: 40,
    },
    textarea: { minHeight: 80, textAlignVertical: 'top' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    flex: { flex: 1 },
    valueInput: { width: 110 },
    primaryBtn: {
      minHeight: 42,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: t.accentDark,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    primaryBtnText: { color: t.accentText, fontWeight: '700', fontSize: 13 },
    stageRow: { flexDirection: 'row', gap: 8, paddingRight: 12 },
    stageChip: {
      minHeight: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stageChipActive: { borderColor: t.accent, backgroundColor: t.accentLight },
    stageChipText: { color: t.textSub, fontSize: 12, fontWeight: '600' },
    stageChipTextActive: { color: t.accent, fontWeight: '700' },
    listLabel: { color: t.textSub, fontSize: 12, marginBottom: 6, fontWeight: '700', letterSpacing: 0.5 },
    empty: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 11,
      backgroundColor: t.surface2,
      padding: 14,
      marginBottom: 10,
    },
    emptyText: { color: t.textMuted, fontSize: 12 },
    rowCard: {
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 12,
      backgroundColor: t.cardBg,
      padding: 11,
      gap: 4,
      marginBottom: 8,
    },
    rowCardActive: { borderColor: t.accent, backgroundColor: t.accentLight },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    rowTitle: { color: t.text, fontWeight: '700', fontSize: 13, flex: 1 },
    rowMeta: { color: t.textSub, fontSize: 11 },
    badge: {
      color: t.accent,
      backgroundColor: t.accentLight,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
      fontSize: 11,
      fontWeight: '700',
      overflow: 'hidden',
    },
    stageBtn: {
      flex: 1,
      minHeight: 36,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 5,
      paddingHorizontal: 8,
    },
    stageBtnText: { color: t.text, fontSize: 12, fontWeight: '600' },
    typeChip: {
      minHeight: 34,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    typeChipActive: { borderColor: t.accent, backgroundColor: t.accentLight },
    typeChipText: { color: t.textSub, fontSize: 12, fontWeight: '600' },
    typeChipTextActive: { color: t.accent, fontWeight: '700' },
    activityCard: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      backgroundColor: t.surface2,
      padding: 9,
      gap: 4,
    },
    activityText: { color: t.text, fontSize: 12 },
    inlineAction: {
      minHeight: 34,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.cardBg,
      alignSelf: 'flex-start',
      paddingHorizontal: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    inlineActionText: { color: t.text, fontSize: 12, fontWeight: '600' },
  });
