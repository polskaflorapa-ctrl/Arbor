import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import * as Clipboard from 'expo-clipboard';
import { getAppFlagSync } from '../utils/app-remote-flags';
import {
  DEFAULT_AUTOPLAN_RULES,
  loadAutoplanRules,
  saveAutoplanRules,
  type AutoplanRules,
} from '../utils/autoplan-rules-local';
import { appendAutoplanHistory, loadAutoplanHistory, type AutoplanHistoryItem } from '../utils/autoplan-history';
import {
  cancelAutoplanDailyReminder,
  getAutoplanReminderTime,
  hasAutoplanDailyReminder,
  scheduleAutoplanDailyReminder,
  setAutoplanReminderTime,
  type ReminderTime,
} from '../utils/autoplan-reminder';
import { queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { getStoredSession } from '../utils/session';

type TaskLite = {
  id: string | number;
  klient_nazwa?: string;
  miasto?: string;
  adres?: string;
  priorytet?: string;
  status?: string;
  data_planowana?: string;
  ekipa_id?: string | number | null;
};

type TeamLite = {
  id: string | number;
  nazwa: string;
  oddzial_nazwa?: string;
};

type PlanRow = {
  taskId: string;
  client: string;
  city: string;
  priority: number;
  currentTeamId: string;
  currentStatus: string;
  suggestedTeamId: string;
  suggestedTeam: string;
  reason: string;
  travelPenalty: number;
  loadScore: number;
};

type PlanMode = 'balanced' | 'cost' | 'fast';
type PlanKpi = { tasks: number; travelRisk: number; avgLoad: number; score: number };
type AppliedChange = { taskId: string; prevTeamId: string; prevStatus: string };
type DayKpi = { total: number; applies: number; rollbacks: number; ok: number; queued: number };
type RiskLevel = 'high' | 'medium' | 'low';

const REMINDER_PRESETS: ReminderTime[] = [
  { hour: 8, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 17, minute: 30 },
  { hour: 18, minute: 0 },
  { hour: 20, minute: 0 },
];

function formatClock(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function shiftClockByMinutes(h: number, m: number, deltaMinutes: number): ReminderTime {
  let total = h * 60 + m + deltaMinutes;
  total = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

const PRIORITY_MAP: Record<string, number> = {
  wysoki: 3,
  high: 3,
  sredni: 2,
  medium: 2,
  niski: 1,
  low: 1,
};

function parsePriority(raw: unknown): number {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return 1;
  return PRIORITY_MAP[s] ?? 1;
}

function buildPlan(
  tasks: TaskLite[],
  teams: TeamLite[],
  t: (k: string) => string,
  mode: PlanMode,
  rules: AutoplanRules,
): PlanRow[] {
  if (!tasks.length) return [];
  if (!teams.length) {
    return tasks.map((task) => ({
      taskId: String(task.id),
      client: task.klient_nazwa || t('autoplan.unknownClient'),
      city: task.miasto || t('autoplan.unknownCity'),
      priority: parsePriority(task.priorytet),
      currentTeamId: String(task.ekipa_id ?? ''),
      currentStatus: String(task.status ?? ''),
      suggestedTeamId: '',
      suggestedTeam: t('autoplan.noTeamAvailable'),
      reason: t('autoplan.reason.noTeam'),
      travelPenalty: 0,
      loadScore: 0,
    }));
  }

  const teamLoad = new Map<string, number>();
  for (const tm of teams) teamLoad.set(String(tm.id), 0);

  const sortedTasks = [...tasks].sort((a, b) => {
    const p = parsePriority(b.priorytet) - parsePriority(a.priorytet);
    if (p !== 0) return p;
    const ad = String(a.data_planowana || '');
    const bd = String(b.data_planowana || '');
    return ad.localeCompare(bd);
  });

  const plan: PlanRow[] = [];
  for (const task of sortedTasks) {
    const taskCity = String(task.miasto || '').trim().toLowerCase();
    const cityBlocked =
      rules.cityDenylist.length > 0 &&
      rules.cityDenylist.some((d) => d && (taskCity.includes(d) || d.includes(taskCity)));
    if (cityBlocked) {
      plan.push({
        taskId: String(task.id),
        client: task.klient_nazwa || t('autoplan.unknownClient'),
        city: task.miasto || t('autoplan.unknownCity'),
        priority: parsePriority(task.priorytet),
        currentTeamId: String(task.ekipa_id ?? ''),
        currentStatus: String(task.status ?? ''),
        suggestedTeamId: '',
        suggestedTeam: t('autoplan.noTeamAvailable'),
        reason: t('autoplan.reason.cityBlocked'),
        travelPenalty: 0,
        loadScore: 0,
      });
      continue;
    }

    let bestTeam: TeamLite | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const team of teams) {
      const id = String(team.id);
      const load = teamLoad.get(id) ?? 0;
      if (load >= rules.maxTasksPerTeam) continue;
      let score = -load * 2;
      const teamCity = String(team.oddzial_nazwa || '').toLowerCase();
      const cityMatch = taskCity && teamCity && taskCity.includes(teamCity);
      if (cityMatch) score += 3;
      if (mode === 'cost') score += cityMatch ? 4 : -1;
      if (mode === 'fast') score += cityMatch ? 2 : -3;
      if (mode === 'fast') score += parsePriority(task.priorytet) * 1.5;
      if (mode === 'cost') score -= parsePriority(task.priorytet) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestTeam = team;
      }
    }

    let picked = bestTeam;
    let overload = false;
    if (!picked) {
      overload = true;
      picked = [...teams].reduce((a, b) =>
        (teamLoad.get(String(a.id)) ?? 0) <= (teamLoad.get(String(b.id)) ?? 0) ? a : b,
      );
    }
    const pickedId = String(picked.id);
    teamLoad.set(pickedId, (teamLoad.get(pickedId) ?? 0) + 1);

    const reasonBits = [
      t('autoplan.reason.priority'),
      t('autoplan.reason.load'),
    ];
    if (overload) reasonBits.push(t('autoplan.reason.overload'));
    const match = taskCity && String(picked.oddzial_nazwa || '').toLowerCase().includes(taskCity);
    if (match) {
      reasonBits.push(t('autoplan.reason.cityMatch'));
    }
    if (mode === 'cost') reasonBits.push(t('autoplan.reason.costMode'));
    if (mode === 'fast') reasonBits.push(t('autoplan.reason.fastMode'));

    plan.push({
      taskId: String(task.id),
      client: task.klient_nazwa || t('autoplan.unknownClient'),
      city: task.miasto || t('autoplan.unknownCity'),
      priority: parsePriority(task.priorytet),
      currentTeamId: String(task.ekipa_id ?? ''),
      currentStatus: String(task.status ?? ''),
      suggestedTeamId: pickedId,
      suggestedTeam: picked.nazwa || `#${picked.id}`,
      reason: reasonBits.join(' · '),
      travelPenalty: match ? 0 : 1,
      loadScore: teamLoad.get(pickedId) ?? 1,
    });
  }
  return plan;
}

function calcPlanKpi(rows: PlanRow[]): PlanKpi {
  const tasks = rows.length;
  const travelRisk = rows.reduce((acc, r) => acc + r.travelPenalty, 0);
  const avgLoad = tasks ? rows.reduce((acc, r) => acc + r.loadScore, 0) / tasks : 0;
  // Lower is better: penalize travel risk and load variance proxy.
  const score = Number((100 - travelRisk * 8 - avgLoad * 2).toFixed(1));
  return {
    tasks,
    travelRisk,
    avgLoad: Number(avgLoad.toFixed(1)),
    score,
  };
}

export default function AutoplanDniaScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/autoplan-dnia');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [mode, setMode] = useState<PlanMode>('balanced');
  const [applying, setApplying] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [scenarioMap, setScenarioMap] = useState<Record<PlanMode, PlanRow[]>>({
    cost: [],
    balanced: [],
    fast: [],
  });
  const [lastApplied, setLastApplied] = useState<AppliedChange[]>([]);
  const [teamNameById, setTeamNameById] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<AutoplanHistoryItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportingDaily, setExportingDaily] = useState(false);
  const [sharingMgmt, setSharingMgmt] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderTime, setReminderTimeState] = useState<ReminderTime>({ hour: 17, minute: 30 });
  const [rulesMaxDraft, setRulesMaxDraft] = useState(String(DEFAULT_AUTOPLAN_RULES.maxTasksPerTeam));
  const [rulesDenyDraft, setRulesDenyDraft] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [userRola, setUserRola] = useState('');

  const load = useCallback(async () => {
    const { token, user } = await getStoredSession();
    setUserRola(String(user?.rola ?? ''));
    if (!token) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const rulesSnapshot = await loadAutoplanRules();
      setRulesMaxDraft(String(rulesSnapshot.maxTasksPerTeam));
      setRulesDenyDraft(rulesSnapshot.cityDenylist.join(', '));

      const [tasksRes, teamsRes] = await Promise.all([
        fetch(`${API_URL}/tasks/wszystkie`, { headers }),
        fetch(`${API_URL}/ekipy`, { headers }),
      ]);
      const tasksData = tasksRes.ok ? await tasksRes.json() : [];
      const teamsData = teamsRes.ok ? await teamsRes.json() : [];

      const tasks: TaskLite[] = Array.isArray(tasksData)
        ? tasksData
            .filter((x: any) => x && x.id != null && x.status !== 'Zakonczone' && x.status !== 'Anulowane')
            .map((x: any) => ({
              id: x.id,
              klient_nazwa: x.klient_nazwa,
              miasto: x.miasto,
              adres: x.adres,
              priorytet: x.priorytet,
              status: x.status,
              data_planowana: x.data_planowana,
              ekipa_id: x.ekipa_id,
            }))
        : [];

      const teams: TeamLite[] = Array.isArray(teamsData)
        ? teamsData.map((x: any) => ({ id: x.id, nazwa: x.nazwa || `#${x.id}`, oddzial_nazwa: x.oddzial_nazwa }))
        : [];
      const names: Record<string, string> = {};
      for (const tm of teams) names[String(tm.id)] = tm.nazwa;
      setTeamNameById(names);

      const costPlan = buildPlan(tasks, teams, t, 'cost', rulesSnapshot);
      const balancedPlan = buildPlan(tasks, teams, t, 'balanced', rulesSnapshot);
      const fastPlan = buildPlan(tasks, teams, t, 'fast', rulesSnapshot);
      setScenarioMap({ cost: costPlan, balanced: balancedPlan, fast: fastPlan });
      setRows(mode === 'cost' ? costPlan : mode === 'fast' ? fastPlan : balancedPlan);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const canApplyPlan =
    ['Dyrektor', 'Administrator', 'Kierownik'].includes(userRola) ||
    (getAppFlagSync('autoplanRelaxApplyRoles') && ['Brygadzista', 'Specjalista'].includes(userRola));

  const persistAutoplanRules = async () => {
    const maxParsed = parseInt(rulesMaxDraft, 10);
    const max = Number.isFinite(maxParsed)
      ? Math.min(50, Math.max(1, maxParsed))
      : DEFAULT_AUTOPLAN_RULES.maxTasksPerTeam;
    const deny = rulesDenyDraft
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const next: AutoplanRules = { maxTasksPerTeam: max, cityDenylist: deny };
    setSavingRules(true);
    try {
      await saveAutoplanRules(next);
      Alert.alert(t('common.saved'), t('autoplan.rules.saved'));
      setRefreshing(true);
      void load();
    } finally {
      setSavingRules(false);
    }
  };

  const applyCurrentPlan = async () => {
    const { token, user } = await getStoredSession();
    if (!token) return;
    const rola = String(user?.rola ?? '');
    const okRola =
      ['Dyrektor', 'Administrator', 'Kierownik'].includes(rola) ||
      (getAppFlagSync('autoplanRelaxApplyRoles') && ['Brygadzista', 'Specjalista'].includes(rola));
    if (!okRola) {
      Alert.alert(t('autoplan.applyTitle'), t('autoplan.roleGate'));
      return;
    }
    const activeRows = scenarioMap[mode];
    const actionable = activeRows.filter(
      (r) =>
        r.suggestedTeamId &&
        (r.suggestedTeamId !== r.currentTeamId || String(r.currentStatus || '').toLowerCase() !== 'zaplanowane'),
    );
    if (!actionable.length) {
      Alert.alert(t('autoplan.applyTitle'), t('autoplan.applyNothing'));
      return;
    }
    Alert.alert(t('autoplan.applyTitle'), t('autoplan.applyConfirm', { count: actionable.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'),
        onPress: async () => {
          setApplying(true);
          let ok = 0;
          let queued = 0;
          const appliedSnapshot: AppliedChange[] = [];
          for (const row of actionable) {
            const url = `${API_URL}/tasks/${row.taskId}`;
            const body = { ekipa_id: Number(row.suggestedTeamId), status: 'Zaplanowane' };
            try {
              const res = await fetch(url, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (res.ok) {
                ok += 1;
                appliedSnapshot.push({
                  taskId: row.taskId,
                  prevTeamId: row.currentTeamId,
                  prevStatus: row.currentStatus,
                });
              }
              else {
                await queueRequestWithOfflineFallback({ url, method: 'PUT', body });
                queued += 1;
              }
            } catch {
              await queueRequestWithOfflineFallback({ url, method: 'PUT', body });
              queued += 1;
            }
          }
          setApplying(false);
          setLastApplied(appliedSnapshot);
          const actor = [String(user?.imie || ''), String(user?.nazwisko || '')].join(' ').trim() || String(user?.rola || 'user');
          const hist = await appendAutoplanHistory({
            action: 'apply',
            mode,
            ok,
            queued,
            changed: actionable.length,
            actor,
          });
          setHistory(hist);
          Alert.alert(t('autoplan.applyResultTitle'), t('autoplan.applyResultBody', { ok, queued }));
          void load();
        },
      },
    ]);
  };

  const rollbackLastApply = async () => {
    if (!lastApplied.length) {
      Alert.alert(t('autoplan.rollbackTitle'), t('autoplan.rollbackNothing'));
      return;
    }
    const { token, user } = await getStoredSession();
    if (!token) return;
    const rola = String(user?.rola ?? '');
    const okRola =
      ['Dyrektor', 'Administrator', 'Kierownik'].includes(rola) ||
      (getAppFlagSync('autoplanRelaxApplyRoles') && ['Brygadzista', 'Specjalista'].includes(rola));
    if (!okRola) {
      Alert.alert(t('autoplan.rollbackTitle'), t('autoplan.roleGate'));
      return;
    }
    Alert.alert(t('autoplan.rollbackTitle'), t('autoplan.rollbackConfirm', { count: lastApplied.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'),
        onPress: async () => {
          setRollingBack(true);
          let ok = 0;
          let queued = 0;
          for (const ch of lastApplied) {
            const url = `${API_URL}/tasks/${ch.taskId}`;
            const body = { ekipa_id: ch.prevTeamId ? Number(ch.prevTeamId) : null, status: ch.prevStatus || 'Nowe' };
            try {
              const res = await fetch(url, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (res.ok) ok += 1;
              else {
                await queueRequestWithOfflineFallback({ url, method: 'PUT', body });
                queued += 1;
              }
            } catch {
              await queueRequestWithOfflineFallback({ url, method: 'PUT', body });
              queued += 1;
            }
          }
          setRollingBack(false);
          setLastApplied([]);
          const actor = [String(user?.imie || ''), String(user?.nazwisko || '')].join(' ').trim() || String(user?.rola || 'user');
          const hist = await appendAutoplanHistory({
            action: 'rollback',
            mode,
            ok,
            queued,
            changed: lastApplied.length,
            actor,
          });
          setHistory(hist);
          Alert.alert(t('autoplan.rollbackResultTitle'), t('autoplan.rollbackResultBody', { ok, queued }));
          void load();
        },
      },
    ]);
  };

  const exportHistoryCsv = async () => {
    if (!history.length) {
      Alert.alert(t('autoplan.exportTitle'), t('autoplan.historyEmpty'));
      return;
    }
    setExporting(true);
    try {
      const header = 'at,action,mode,changed,ok,queued,actor';
      const rowsCsv = history.map((h) =>
        [h.at, h.action, h.mode, String(h.changed), String(h.ok), String(h.queued), String(h.actor).replace(/,/g, ' ')].join(','),
      );
      const csv = [header, ...rowsCsv].join('\n');
      await Clipboard.setStringAsync(csv);
      await Share.share({
        message: `${t('autoplan.exportIntro')}\n\n${csv}`,
      });
      Alert.alert(t('autoplan.exportTitle'), t('autoplan.exportDone'));
    } catch {
      Alert.alert(t('autoplan.exportTitle'), t('autoplan.exportFail'));
    } finally {
      setExporting(false);
    }
  };

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayHistory = history.filter((h) => h.at.slice(0, 10) === todayKey);
  const todayKpi: DayKpi = todayHistory.reduce(
    (acc, h) => ({
      total: acc.total + 1,
      applies: acc.applies + (h.action === 'apply' ? 1 : 0),
      rollbacks: acc.rollbacks + (h.action === 'rollback' ? 1 : 0),
      ok: acc.ok + h.ok,
      queued: acc.queued + h.queued,
    }),
    { total: 0, applies: 0, rollbacks: 0, ok: 0, queued: 0 },
  );
  const rollbackRate = todayKpi.total ? todayKpi.rollbacks / todayKpi.total : 0;
  const offlineRate = todayKpi.total ? todayKpi.queued / todayKpi.total : 0;
  const riskLevel: RiskLevel =
    offlineRate >= 0.35 || rollbackRate >= 0.35
      ? 'high'
      : offlineRate >= 0.2 || rollbackRate >= 0.2
        ? 'medium'
        : 'low';
  const riskLabel =
    riskLevel === 'high'
      ? t('autoplan.risk.high')
      : riskLevel === 'medium'
        ? t('autoplan.risk.medium')
        : t('autoplan.risk.low');
  const riskReason =
    offlineRate >= rollbackRate
      ? t('autoplan.risk.reason.offline', { value: `${Math.round(offlineRate * 100)}%` })
      : t('autoplan.risk.reason.rollback', { value: `${Math.round(rollbackRate * 100)}%` });
  const actionAdvice =
    riskLevel === 'high'
      ? offlineRate >= rollbackRate
        ? t('autoplan.risk.action.highOffline')
        : t('autoplan.risk.action.highRollback')
      : riskLevel === 'medium'
        ? offlineRate >= rollbackRate
          ? t('autoplan.risk.action.mediumOffline')
          : t('autoplan.risk.action.mediumRollback')
        : t('autoplan.risk.action.low');

  const exportDailyReport = async () => {
    if (!todayHistory.length) {
      Alert.alert(t('autoplan.dailyTitle'), t('autoplan.dailyEmpty'));
      return;
    }
    setExportingDaily(true);
    try {
      const summary = [
        `${t('autoplan.dailySummaryDate')}: ${todayKey}`,
        `${t('autoplan.dailySummaryTotal')}: ${todayKpi.total}`,
        `${t('autoplan.dailySummaryApply')}: ${todayKpi.applies}`,
        `${t('autoplan.dailySummaryRollback')}: ${todayKpi.rollbacks}`,
        `${t('autoplan.dailySummaryOk')}: ${todayKpi.ok}`,
        `${t('autoplan.dailySummaryQueued')}: ${todayKpi.queued}`,
      ].join('\n');

      const header = 'at,action,mode,changed,ok,queued,actor';
      const rowsCsv = todayHistory.map((h) =>
        [h.at, h.action, h.mode, String(h.changed), String(h.ok), String(h.queued), String(h.actor).replace(/,/g, ' ')].join(','),
      );
      const csv = [header, ...rowsCsv].join('\n');
      await Clipboard.setStringAsync(`${summary}\n\n${csv}`);
      await Share.share({
        message: `${t('autoplan.dailyIntro')}\n\n${summary}\n\n${csv}`,
      });
      Alert.alert(t('autoplan.dailyTitle'), t('autoplan.dailyDone'));
    } catch {
      Alert.alert(t('autoplan.dailyTitle'), t('autoplan.dailyFail'));
    } finally {
      setExportingDaily(false);
    }
  };

  const shareManagementBrief = async () => {
    if (!todayHistory.length) {
      Alert.alert(t('autoplan.dailyTitle'), t('autoplan.dailyEmpty'));
      return;
    }
    setSharingMgmt(true);
    try {
      const mgmtText = [
        `${t('autoplan.mgmt.title')} (${todayKey})`,
        `${t('autoplan.risk.title')}: ${riskLabel}`,
        `${t('autoplan.dailySummaryTotal')}: ${todayKpi.total} | ${t('autoplan.dailySummaryApply')}: ${todayKpi.applies} | ${t('autoplan.dailySummaryRollback')}: ${todayKpi.rollbacks}`,
        `${t('autoplan.dailySummaryOk')}: ${todayKpi.ok} | ${t('autoplan.dailySummaryQueued')}: ${todayKpi.queued}`,
        `${t('autoplan.risk.action.title')}: ${actionAdvice}`,
      ].join('\n');

      const header = 'at,action,mode,changed,ok,queued,actor';
      const rowsCsv = todayHistory.map((h) =>
        [h.at, h.action, h.mode, String(h.changed), String(h.ok), String(h.queued), String(h.actor).replace(/,/g, ' ')].join(','),
      );
      const csv = [header, ...rowsCsv].join('\n');
      await Clipboard.setStringAsync(`${mgmtText}\n\n${csv}`);
      await Share.share({
        message: `${mgmtText}\n\n${t('autoplan.exportIntro')}\n\n${csv}`,
      });
      Alert.alert(t('autoplan.mgmt.title'), t('autoplan.mgmt.done'));
    } catch {
      Alert.alert(t('autoplan.mgmt.title'), t('autoplan.mgmt.fail'));
    } finally {
      setSharingMgmt(false);
    }
  };

  const S = makeStyles(theme);
  const modeKpi = {
    cost: calcPlanKpi(scenarioMap.cost),
    balanced: calcPlanKpi(scenarioMap.balanced),
    fast: calcPlanKpi(scenarioMap.fast),
  };
  const bestMode: PlanMode = (['cost', 'balanced', 'fast'] as PlanMode[]).reduce(
    (best, current) => (modeKpi[current].score > modeKpi[best].score ? current : best),
    'balanced',
  );
  const changedCount = rows.filter(
    (r) =>
      r.suggestedTeamId &&
      (r.suggestedTeamId !== r.currentTeamId || String(r.currentStatus || '').toLowerCase() !== 'zaplanowane'),
  ).length;

  useEffect(() => {
    void loadAutoplanHistory().then(setHistory);
    void hasAutoplanDailyReminder().then(setReminderEnabled);
    void getAutoplanReminderTime().then(setReminderTimeState);
  }, []);

  const pickReminderPreset = async (hour: number, minute: number) => {
    const next = await setAutoplanReminderTime(hour, minute);
    setReminderTimeState(next);
    if (!reminderEnabled) return;
    setReminderBusy(true);
    try {
      await scheduleAutoplanDailyReminder(next.hour, next.minute);
      Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.rescheduled', { time: formatClock(next.hour, next.minute) }));
    } catch {
      Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.error'));
    } finally {
      setReminderBusy(false);
    }
  };

  const setupDailyReminder = async () => {
    setReminderBusy(true);
    try {
      const perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.permissionDenied'));
        return;
      }
      await scheduleAutoplanDailyReminder();
      const rt = await getAutoplanReminderTime();
      setReminderTimeState(rt);
      setReminderEnabled(true);
      Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.enabled', { time: formatClock(rt.hour, rt.minute) }));
    } catch {
      Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.error'));
    } finally {
      setReminderBusy(false);
    }
  };

  const disableDailyReminder = async () => {
    setReminderBusy(true);
    try {
      await cancelAutoplanDailyReminder();
      setReminderEnabled(false);
      Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.disabled'));
    } catch {
      Alert.alert(t('autoplan.reminder.title'), t('autoplan.reminder.error'));
    } finally {
      setReminderBusy(false);
    }
  };

  if (guard.ready && !guard.allowed) return <View style={S.center} />;
  if (!guard.ready || loading) return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title={t('autoplan.title')} />
      <ScrollView
        style={S.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        <Text style={S.hint}>{t('autoplan.hint')}</Text>
        <View style={S.rulesBox}>
          <Text style={S.rulesTitle}>{t('autoplan.rules.title')}</Text>
          <Text style={S.rulesHint}>{t('autoplan.rules.maxHint')}</Text>
          <TextInput
            style={S.rulesInput}
            keyboardType="number-pad"
            value={rulesMaxDraft}
            onChangeText={setRulesMaxDraft}
            placeholder="12"
          />
          <Text style={S.rulesHint}>{t('autoplan.rules.denyHint')}</Text>
          <TextInput
            style={[S.rulesInput, S.rulesInputMultiline]}
            value={rulesDenyDraft}
            onChangeText={setRulesDenyDraft}
            placeholder="warszawa, krakow"
            multiline
          />
          <TouchableOpacity
            style={[S.rulesSaveBtn, savingRules && S.applyBtnDisabled]}
            onPress={() => void persistAutoplanRules()}
            disabled={savingRules}
          >
            <Text style={S.rulesSaveTxt}>{savingRules ? t('autoplan.rules.saving') : t('autoplan.rules.save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.kpiLink} onPress={() => router.push('/kpi-tydzien' as never)}>
            <Text style={S.kpiLinkTxt}>{t('autoplan.kpiWeekCta')}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.accent} />
          </TouchableOpacity>
        </View>
        {!canApplyPlan ? <Text style={S.roleGate}>{t('autoplan.roleGate')}</Text> : null}
        <Text style={S.compareTitle}>{t('autoplan.compareTitle')}</Text>
        <View style={S.compareRow}>
          {(['cost', 'balanced', 'fast'] as PlanMode[]).map((m) => {
            const kpi = modeKpi[m];
            const active = mode === m;
            const best = bestMode === m;
            const modeLabel = m === 'cost' ? t('autoplan.mode.cost') : m === 'fast' ? t('autoplan.mode.fast') : t('autoplan.mode.balanced');
            return (
              <TouchableOpacity
                key={`cmp-${m}`}
                style={[S.compareCard, active && { borderColor: theme.accent }, best && { backgroundColor: theme.successBg }]}
                onPress={() => setMode(m)}
              >
                <View style={S.compareTop}>
                  <Text style={[S.compareMode, active && { color: theme.accent }]}>{modeLabel}</Text>
                  {best ? <Text style={S.bestTag}>{t('autoplan.bestTag')}</Text> : null}
                </View>
                <Text style={S.compareLine}>{t('autoplan.kpi.tasks')}: {kpi.tasks}</Text>
                <Text style={S.compareLine}>{t('autoplan.kpi.travelRisk')}: {kpi.travelRisk}</Text>
                <Text style={S.compareLine}>{t('autoplan.kpi.avgLoad')}: {kpi.avgLoad}</Text>
                <Text style={S.compareScore}>{t('autoplan.kpi.score')}: {kpi.score}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={S.modeRow}>
          {(['cost', 'balanced', 'fast'] as PlanMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[S.modeBtn, mode === m && { backgroundColor: theme.accent }]}
              onPress={() => setMode(m)}
            >
              <Text style={[S.modeTxt, mode === m && { color: theme.accentText }]}>
                {m === 'cost' ? t('autoplan.mode.cost') : m === 'fast' ? t('autoplan.mode.fast') : t('autoplan.mode.balanced')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={S.applyRow}>
          <View style={S.previewBox}>
            <Text style={S.previewText}>{t('autoplan.previewChanges', { count: changedCount })}</Text>
          </View>
          <TouchableOpacity
            style={[S.applyBtn, (applying || !canApplyPlan) && S.applyBtnDisabled]}
            onPress={applyCurrentPlan}
            disabled={applying || !canApplyPlan}
          >
            <Text style={S.applyBtnTxt}>{applying ? t('autoplan.applying') : t('autoplan.applyCta')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.rollbackBtn, (!lastApplied.length || rollingBack || !canApplyPlan) && S.applyBtnDisabled]}
            onPress={rollbackLastApply}
            disabled={!lastApplied.length || rollingBack || !canApplyPlan}
          >
            <Text style={S.rollbackBtnTxt}>{rollingBack ? t('autoplan.rollingBack') : t('autoplan.rollbackCta')}</Text>
          </TouchableOpacity>
        </View>
        <View style={S.kpiRow}>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>{t('autoplan.kpi.tasks')}</Text>
            <Text style={S.kpiValue}>{rows.length}</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>{t('autoplan.kpi.travelRisk')}</Text>
            <Text style={S.kpiValue}>{rows.reduce((acc, r) => acc + r.travelPenalty, 0)}</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>{t('autoplan.kpi.avgLoad')}</Text>
            <Text style={S.kpiValue}>
              {rows.length ? (rows.reduce((acc, r) => acc + r.loadScore, 0) / rows.length).toFixed(1) : '0.0'}
            </Text>
          </View>
        </View>
        <View style={S.historyBox}>
          <View style={S.historyTop}>
            <Text style={S.historyTitle}>{t('autoplan.historyTitle')}</Text>
            <View style={S.historyActions}>
              <TouchableOpacity
                style={[S.exportBtn, reminderBusy && S.applyBtnDisabled]}
                onPress={reminderEnabled ? disableDailyReminder : setupDailyReminder}
                disabled={reminderBusy}
              >
                <Text style={S.exportBtnTxt}>
                  {reminderBusy
                    ? t('autoplan.reminder.busy')
                    : reminderEnabled
                      ? t('autoplan.reminder.disableCta', { time: formatClock(reminderTime.hour, reminderTime.minute) })
                      : t('autoplan.reminder.enableCta', { time: formatClock(reminderTime.hour, reminderTime.minute) })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.exportBtn, sharingMgmt && S.applyBtnDisabled]} onPress={shareManagementBrief} disabled={sharingMgmt}>
                <Text style={S.exportBtnTxt}>{sharingMgmt ? t('autoplan.mgmt.sharing') : t('autoplan.mgmt.cta')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.exportBtn, exportingDaily && S.applyBtnDisabled]} onPress={exportDailyReport} disabled={exportingDaily}>
                <Text style={S.exportBtnTxt}>{exportingDaily ? t('autoplan.dailyExporting') : t('autoplan.dailyCta')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.exportBtn, exporting && S.applyBtnDisabled]} onPress={exportHistoryCsv} disabled={exporting}>
                <Text style={S.exportBtnTxt}>{exporting ? t('autoplan.exporting') : t('autoplan.exportCta')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={S.reminderTimeLabel}>{t('autoplan.reminder.timeLabel')}</Text>
          <View style={S.reminderPresetRow}>
            {REMINDER_PRESETS.map((p) => {
              const active = reminderTime.hour === p.hour && reminderTime.minute === p.minute;
              return (
                <TouchableOpacity
                  key={`${p.hour}-${p.minute}`}
                  style={[S.reminderPresetChip, active && { borderColor: theme.accent, backgroundColor: `${theme.accent}18` }]}
                  onPress={() => void pickReminderPreset(p.hour, p.minute)}
                  disabled={reminderBusy}
                >
                  <Text style={[S.reminderPresetTxt, active && { color: theme.accent }]}>{formatClock(p.hour, p.minute)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={S.reminderNudgeRow}>
            <TouchableOpacity
              style={[S.reminderNudgeBtn, reminderBusy && S.applyBtnDisabled]}
              onPress={() => {
                const s = shiftClockByMinutes(reminderTime.hour, reminderTime.minute, -15);
                void pickReminderPreset(s.hour, s.minute);
              }}
              disabled={reminderBusy}
            >
              <Text style={S.reminderNudgeTxt}>{t('autoplan.reminder.minus15')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.reminderNudgeBtn, reminderBusy && S.applyBtnDisabled]}
              onPress={() => {
                const s = shiftClockByMinutes(reminderTime.hour, reminderTime.minute, 15);
                void pickReminderPreset(s.hour, s.minute);
              }}
              disabled={reminderBusy}
            >
              <Text style={S.reminderNudgeTxt}>{t('autoplan.reminder.plus15')}</Text>
            </TouchableOpacity>
          </View>
          <View style={S.dailyBox}>
            <View
              style={[
                S.riskBadge,
                riskLevel === 'high'
                  ? { backgroundColor: theme.dangerBg }
                  : riskLevel === 'medium'
                    ? { backgroundColor: theme.warningBg }
                    : { backgroundColor: theme.successBg },
              ]}
            >
              <Text
                style={[
                  S.riskTxt,
                  riskLevel === 'high'
                    ? { color: theme.danger }
                    : riskLevel === 'medium'
                      ? { color: theme.warning }
                      : { color: theme.success },
                ]}
              >
                {t('autoplan.risk.title')}: {riskLabel}
              </Text>
            </View>
            <Text style={S.dailyTxt}>
              {t('autoplan.dailyHeader', { date: todayKey })} · {t('autoplan.dailySummaryTotal')}: {todayKpi.total} · {t('autoplan.dailySummaryApply')}: {todayKpi.applies} · {t('autoplan.dailySummaryRollback')}: {todayKpi.rollbacks}
            </Text>
            <Text style={S.dailyTxt}>
              {t('autoplan.dailySummaryOk')}: {todayKpi.ok} · {t('autoplan.dailySummaryQueued')}: {todayKpi.queued}
            </Text>
            <Text style={S.dailyReasonTxt}>{riskReason}</Text>
            <View style={S.actionBox}>
              <Text style={S.actionTitle}>{t('autoplan.risk.action.title')}</Text>
              <Text style={S.actionTxt}>{actionAdvice}</Text>
            </View>
          </View>
          {history.length === 0 ? (
            <Text style={S.historyEmpty}>{t('autoplan.historyEmpty')}</Text>
          ) : history.slice(0, 5).map((h) => (
            <Text key={h.id} style={S.historyLine}>
              {h.at.slice(0, 16).replace('T', ' ')} · {t(`autoplan.historyAction.${h.action}`)} · {t(`autoplan.mode.${h.mode}`)} · {h.changed}/{h.ok}+{h.queued} · {h.actor}
            </Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <View style={S.empty}>
            <Text style={S.emptyTxt}>{t('autoplan.empty')}</Text>
          </View>
        ) : rows.map((row, idx) => (
          <View key={`${row.taskId}-${idx}`} style={S.card}>
            <View style={S.top}>
              <Text style={S.main}>{t('autoplan.taskLabel', { id: row.taskId })}</Text>
              <View style={[S.prioBadge, row.priority >= 3 ? { backgroundColor: theme.dangerBg } : row.priority === 2 ? { backgroundColor: theme.warningBg } : { backgroundColor: theme.infoBg }]}>
                <Text style={[S.prioTxt, row.priority >= 3 ? { color: theme.danger } : row.priority === 2 ? { color: theme.warning } : { color: theme.info }]}>
                  {t('autoplan.priorityLabel', { value: row.priority })}
                </Text>
              </View>
            </View>
            <View style={S.line}><Ionicons name="person-outline" size={13} color={theme.textMuted} /><Text style={S.lineTxt}>{row.client}</Text></View>
            <View style={S.line}><Ionicons name="location-outline" size={13} color={theme.textMuted} /><Text style={S.lineTxt}>{row.city}</Text></View>
            <View style={S.line}><Ionicons name="people-outline" size={13} color={theme.accent} /><Text style={[S.lineTxt, { color: theme.accent, fontWeight: '700' }]}>{row.suggestedTeam}</Text></View>
            <Text style={S.reason}>
              {t('autoplan.currentAssignment', {
                team: teamNameById[row.currentTeamId] || (row.currentTeamId ? `#${row.currentTeamId}` : t('autoplan.noTeamAvailable')),
                status: row.currentStatus || '-',
              })}
            </Text>
            <Text style={S.reason}>{row.reason}</Text>
          </View>
        ))}
        <View style={{ height: 28 }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    scroll: { flex: 1 },
    hint: { fontSize: 13, color: theme.textMuted, padding: 16, paddingBottom: 8 },
    rulesBox: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    rulesTitle: { fontSize: 13, fontWeight: '800', color: theme.text, marginBottom: 8 },
    rulesHint: { fontSize: 11, color: theme.textMuted, marginBottom: 4 },
    rulesInput: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      padding: 10,
      color: theme.text,
      marginBottom: 10,
      backgroundColor: theme.surface2,
    },
    rulesInputMultiline: { minHeight: 64, textAlignVertical: 'top' as const },
    rulesSaveBtn: {
      backgroundColor: theme.info,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
      marginBottom: 8,
    },
    rulesSaveTxt: { color: theme.accentText, fontWeight: '700', fontSize: 13 },
    kpiLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    kpiLinkTxt: { color: theme.accent, fontWeight: '700', fontSize: 13 },
    roleGate: { color: theme.warning, fontSize: 12, fontWeight: '700', paddingHorizontal: 16, marginBottom: 8 },
    empty: { padding: 24, alignItems: 'center' },
    emptyTxt: { color: theme.textMuted, fontSize: 15 },
    modeRow: { paddingHorizontal: 16, marginBottom: 10, flexDirection: 'row', gap: 8 },
    modeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    modeTxt: { fontSize: 12, fontWeight: '700', color: theme.textMuted },
    applyRow: { paddingHorizontal: 16, marginBottom: 12 },
    previewBox: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 8,
      marginBottom: 8,
    },
    previewText: { color: theme.textSub, fontSize: 12, fontWeight: '700' },
    applyBtn: {
      backgroundColor: theme.accent,
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: 'center',
    },
    rollbackBtn: {
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      marginTop: 8,
    },
    rollbackBtnTxt: { color: theme.text, fontWeight: '700', fontSize: 12 },
    applyBtnDisabled: { opacity: 0.6 },
    applyBtnTxt: { color: theme.accentText, fontWeight: '800', fontSize: 13 },
    compareTitle: { paddingHorizontal: 16, marginBottom: 8, color: theme.text, fontSize: 13, fontWeight: '700' },
    compareRow: { paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8 },
    compareCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 8,
    },
    compareTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    compareMode: { fontSize: 12, fontWeight: '700', color: theme.text },
    bestTag: { fontSize: 10, fontWeight: '800', color: theme.success },
    compareLine: { fontSize: 10, color: theme.textSub, marginBottom: 1 },
    compareScore: { fontSize: 11, fontWeight: '800', color: theme.text, marginTop: 3 },
    kpiRow: { paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8 },
    kpiBox: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 10,
    },
    kpiLabel: { fontSize: 11, color: theme.textMuted },
    kpiValue: { fontSize: 18, fontWeight: '800', color: theme.text },
    historyBox: {
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 10,
    },
    historyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    historyActions: { flexDirection: 'row', gap: 6 },
    historyTitle: { color: theme.text, fontSize: 13, fontWeight: '800', marginBottom: 4 },
    reminderTimeLabel: { color: theme.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 6 },
    reminderPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 10 },
    reminderPresetChip: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    reminderPresetTxt: { color: theme.textSub, fontSize: 12, fontWeight: '700' },
    reminderNudgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    reminderNudgeBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      paddingVertical: 8,
      alignItems: 'center',
    },
    reminderNudgeTxt: { color: theme.text, fontSize: 12, fontWeight: '800' },
    exportBtn: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    exportBtnTxt: { color: theme.text, fontSize: 11, fontWeight: '700' },
    dailyBox: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      borderRadius: 8,
      padding: 8,
      marginBottom: 6,
    },
    dailyTxt: { color: theme.textSub, fontSize: 11, fontWeight: '700' },
    dailyReasonTxt: { color: theme.textMuted, fontSize: 11, marginTop: 4 },
    riskBadge: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginBottom: 6,
    },
    riskTxt: { fontSize: 11, fontWeight: '800' },
    actionBox: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 8,
      padding: 8,
    },
    actionTitle: { color: theme.text, fontSize: 11, fontWeight: '800', marginBottom: 2 },
    actionTxt: { color: theme.textSub, fontSize: 11, fontWeight: '700' },
    historyEmpty: { color: theme.textMuted, fontSize: 12 },
    historyLine: { color: theme.textSub, fontSize: 12, marginBottom: 2 },
    card: {
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    main: { color: theme.text, fontSize: 16, fontWeight: '700' },
    prioBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    prioTxt: { fontSize: 11, fontWeight: '700' },
    line: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
    lineTxt: { color: theme.textSub, fontSize: 14 },
    reason: { marginTop: 6, color: theme.textMuted, fontSize: 12 },
  });
}

