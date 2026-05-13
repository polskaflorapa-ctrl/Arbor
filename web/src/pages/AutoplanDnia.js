import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getAppFlagSync } from '../utils/appRemoteFlagsWeb';
import { isTaskClosed } from '../utils/taskWorkflow';
import {
  DEFAULT_AUTOPLAN_RULES,
  appendAutoplanHistory,
  buildPlan,
  calcPlanKpi,
  loadAutoplanHistory,
  loadAutoplanRules,
  saveAutoplanRules,
} from '../utils/autoplanShared';

const FIELD_ROLES = [
  'Dyrektor',
  'Administrator',
  'Kierownik',
  'Brygadzista',
  'Specjalista',
  'Pomocnik',
  'Pomocnik bez doświadczenia',
];

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AutoplanDnia() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [mode, setMode] = useState('balanced');
  const [rows, setRows] = useState([]);
  const [scenarioMap, setScenarioMap] = useState({ cost: [], balanced: [], fast: [] });
  const [applying, setApplying] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [lastApplied, setLastApplied] = useState([]);
  const [history, setHistory] = useState([]);
  const [rulesMaxDraft, setRulesMaxDraft] = useState(String(DEFAULT_AUTOPLAN_RULES.maxTasksPerTeam));
  const [rulesDenyDraft, setRulesDenyDraft] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [userRola, setUserRola] = useState('');

  const tr = useCallback(
    (short) =>
      ({
        unknownClient: t('pages.autoplanDay.labels.unknownClient'),
        unknownCity: t('pages.autoplanDay.labels.unknownCity'),
        noTeamAvailable: t('pages.autoplanDay.labels.noTeamAvailable'),
        reasonNoTeam: t('pages.autoplanDay.labels.reasonNoTeam'),
        reasonCityBlocked: t('pages.autoplanDay.labels.reasonCityBlocked'),
        reasonPriority: t('pages.autoplanDay.labels.reasonPriority'),
        reasonLoad: t('pages.autoplanDay.labels.reasonLoad'),
        reasonOverload: t('pages.autoplanDay.labels.reasonOverload'),
        reasonCityMatch: t('pages.autoplanDay.labels.reasonCityMatch'),
        reasonCostMode: t('pages.autoplanDay.labels.reasonCostMode'),
        reasonFastMode: t('pages.autoplanDay.labels.reasonFastMode'),
      })[short] || short,
    [t],
  );

  const load = useCallback(async () => {
    const token = getStoredToken();
    const u = getLocalStorageJson('user');
    setUserRola(String(u?.rola ?? ''));
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setErr('');
    try {
      const rulesSnapshot = loadAutoplanRules();
      setRulesMaxDraft(String(rulesSnapshot.maxTasksPerTeam));
      setRulesDenyDraft(rulesSnapshot.cityDenylist.join(', '));

      const headers = authHeaders(token);
      const [tasksRes, teamsRes] = await Promise.all([
        api.get('/tasks/wszystkie', { headers }),
        api.get('/ekipy', { headers }),
      ]);
      const tasksData = Array.isArray(tasksRes.data) ? tasksRes.data : [];
      const teamsData = Array.isArray(teamsRes.data) ? teamsRes.data : [];

      const tasks = tasksData
        .filter((x) => x && x.id != null && !isTaskClosed(x.status))
        .map((x) => ({
          id: x.id,
          klient_nazwa: x.klient_nazwa,
          miasto: x.miasto,
          adres: x.adres,
          priorytet: x.priorytet,
          status: x.status,
          data_planowana: x.data_planowana,
          ekipa_id: x.ekipa_id,
        }));

      const teams = teamsData.map((x) => ({
        id: x.id,
        nazwa: x.nazwa || `#${x.id}`,
        oddzial_nazwa: x.oddzial_nazwa,
      }));
      const costPlan = buildPlan(tasks, teams, tr, 'cost', rulesSnapshot);
      const balancedPlan = buildPlan(tasks, teams, tr, 'balanced', rulesSnapshot);
      const fastPlan = buildPlan(tasks, teams, tr, 'fast', rulesSnapshot);
      setScenarioMap({ cost: costPlan, balanced: balancedPlan, fast: fastPlan });
    } catch (e) {
      console.error(e);
      setErr(t('pages.autoplanDay.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [tr, t]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    const u = getLocalStorageJson('user');
    if (!u || !FIELD_ROLES.includes(u.rola)) {
      navigate('/dashboard');
      return;
    }
    void load();
  }, [navigate, load]);

  useEffect(() => {
    setHistory(loadAutoplanHistory());
  }, []);

  const modeKpi = useMemo(
    () => ({
      cost: calcPlanKpi(scenarioMap.cost),
      balanced: calcPlanKpi(scenarioMap.balanced),
      fast: calcPlanKpi(scenarioMap.fast),
    }),
    [scenarioMap],
  );

  const bestMode = useMemo(() => {
    return ['cost', 'balanced', 'fast'].reduce((best, current) =>
      modeKpi[current].score > modeKpi[best].score ? current : best,
    'balanced');
  }, [modeKpi]);

  useEffect(() => {
    setRows(mode === 'cost' ? scenarioMap.cost : mode === 'fast' ? scenarioMap.fast : scenarioMap.balanced);
  }, [mode, scenarioMap]);

  const canApplyPlan =
    ['Dyrektor', 'Administrator', 'Kierownik'].includes(userRola) ||
    (getAppFlagSync('autoplanRelaxApplyRoles') && ['Brygadzista', 'Specjalista'].includes(userRola));

  const changedCount = rows.filter(
    (r) =>
      r.suggestedTeamId &&
      (r.suggestedTeamId !== r.currentTeamId || String(r.currentStatus || '').toLowerCase() !== 'zaplanowane'),
  ).length;

  const persistAutoplanRules = async () => {
    const maxParsed = parseInt(rulesMaxDraft, 10);
    const max = Number.isFinite(maxParsed)
      ? Math.min(50, Math.max(1, maxParsed))
      : DEFAULT_AUTOPLAN_RULES.maxTasksPerTeam;
    const deny = rulesDenyDraft
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    setSavingRules(true);
    try {
      saveAutoplanRules({ maxTasksPerTeam: max, cityDenylist: deny });
      setInfo(t('pages.autoplanDay.rulesSaved'));
      await load();
    } finally {
      setSavingRules(false);
    }
  };

  const applyCurrentPlan = async () => {
    const token = getStoredToken();
    const u = getLocalStorageJson('user');
    if (!token || !u) return;
    const rola = String(u.rola ?? '');
    const okRola =
      ['Dyrektor', 'Administrator', 'Kierownik'].includes(rola) ||
      (getAppFlagSync('autoplanRelaxApplyRoles') && ['Brygadzista', 'Specjalista'].includes(rola));
    if (!okRola) {
      window.alert(t('pages.autoplanDay.roleGate'));
      return;
    }
    const activeRows = scenarioMap[mode];
    const actionable = activeRows.filter(
      (r) =>
        r.suggestedTeamId &&
        (r.suggestedTeamId !== r.currentTeamId || String(r.currentStatus || '').toLowerCase() !== 'zaplanowane'),
    );
    if (!actionable.length) {
      window.alert(t('pages.autoplanDay.applyNothing'));
      return;
    }
    if (!window.confirm(t('pages.autoplanDay.applyConfirm', { count: actionable.length }))) return;

    setApplying(true);
    let ok = 0;
    let queued = 0;
    const appliedSnapshot = [];
    const headers = authHeaders(token);
    for (const row of actionable) {
      const body = { ekipa_id: Number(row.suggestedTeamId), status: 'Zaplanowane' };
      try {
        const res = await api.put(`/tasks/${row.taskId}`, body, { headers });
        if (res.status >= 200 && res.status < 300) {
          ok += 1;
          appliedSnapshot.push({
            taskId: row.taskId,
            prevTeamId: row.currentTeamId,
            prevStatus: row.currentStatus,
          });
        } else {
          queued += 1;
        }
      } catch {
        queued += 1;
      }
    }
    setApplying(false);
    setLastApplied(appliedSnapshot);
    const actor = [String(u.imie || ''), String(u.nazwisko || '')].join(' ').trim() || String(u.rola || 'user');
    const hist = appendAutoplanHistory({
      action: 'apply',
      mode,
      ok,
      queued,
      changed: actionable.length,
      actor,
    });
    setHistory(hist);
    window.alert(t('pages.autoplanDay.applyResultBody', { ok, queued }));
    await load();
  };

  const rollbackLastApply = async () => {
    if (!lastApplied.length) {
      window.alert(t('pages.autoplanDay.rollbackNothing'));
      return;
    }
    const token = getStoredToken();
    const u = getLocalStorageJson('user');
    if (!token || !u) return;
    const rola = String(u.rola ?? '');
    const okRola =
      ['Dyrektor', 'Administrator', 'Kierownik'].includes(rola) ||
      (getAppFlagSync('autoplanRelaxApplyRoles') && ['Brygadzista', 'Specjalista'].includes(rola));
    if (!okRola) {
      window.alert(t('pages.autoplanDay.roleGate'));
      return;
    }
    if (!window.confirm(t('pages.autoplanDay.rollbackConfirm', { count: lastApplied.length }))) return;

    const rollbackCount = lastApplied.length;
    setRollingBack(true);
    let ok = 0;
    let queued = 0;
    const headers = authHeaders(token);
    for (const ch of lastApplied) {
      const body = { ekipa_id: ch.prevTeamId ? Number(ch.prevTeamId) : null, status: ch.prevStatus || 'Nowe' };
      try {
        const res = await api.put(`/tasks/${ch.taskId}`, body, { headers });
        if (res.status >= 200 && res.status < 300) ok += 1;
        else queued += 1;
      } catch {
        queued += 1;
      }
    }
    setRollingBack(false);
    setLastApplied([]);
    const actor = [String(u.imie || ''), String(u.nazwisko || '')].join(' ').trim() || String(u.rola || 'user');
    const hist = appendAutoplanHistory({
      action: 'rollback',
      mode,
      ok,
      queued,
      changed: rollbackCount,
      actor,
    });
    setHistory(hist);
    window.alert(t('pages.autoplanDay.rollbackResultBody', { ok, queued }));
    await load();
  };

  const exportHistoryCsv = () => {
    if (!history.length) {
      window.alert(t('pages.autoplanDay.historyEmpty'));
      return;
    }
    const header = 'at,action,mode,changed,ok,queued,actor';
    const rowsCsv = history.map((h) =>
      [h.at, h.action, h.mode, String(h.changed), String(h.ok), String(h.queued), String(h.actor).replace(/,/g, ' ')].join(
        ',',
      ),
    );
    const csv = [header, ...rowsCsv].join('\n');
    downloadText('autoplan-history.csv', csv);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(csv);
    }
    setInfo(t('pages.autoplanDay.exportDone'));
  };

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayHistory = history.filter((h) => h.at.slice(0, 10) === todayKey);
  const todayKpi = todayHistory.reduce(
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
  const riskLevel =
    offlineRate >= 0.35 || rollbackRate >= 0.35 ? 'high' : offlineRate >= 0.2 || rollbackRate >= 0.2 ? 'medium' : 'low';

  if (loading) {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Sidebar />
      <Box sx={{ flex: 1, p: 2, maxWidth: 1100, mx: 'auto', width: '100%' }}>
        <PageHeader title={t('pages.autoplanDay.title')} subtitle={t('pages.autoplanDay.subtitle')} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('pages.autoplanDay.hint')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('pages.autoplanDay.reminderWebHint')}
        </Typography>

        <Button size="small" sx={{ mb: 2 }} onClick={() => navigate('/raporty/kpi-tydzien')}>
          {t('pages.autoplanDay.linkKpiWeek')}
        </Button>

        <StatusMessage message={err} tone="error" />
        <StatusMessage message={info} tone="success" />

        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2">{t('pages.autoplanDay.rulesTitle')}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                label={t('pages.autoplanDay.rulesMax')}
                value={rulesMaxDraft}
                onChange={(e) => setRulesMaxDraft(e.target.value)}
              />
              <TextField
                size="small"
                fullWidth
                label={t('pages.autoplanDay.rulesDeny')}
                value={rulesDenyDraft}
                onChange={(e) => setRulesDenyDraft(e.target.value)}
              />
              <Button variant="outlined" disabled={savingRules} onClick={() => void persistAutoplanRules()}>
                {savingRules ? <CircularProgress size={18} /> : t('pages.autoplanDay.rulesSave')}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mb: 2 }}>
          <Tab label={`${t('pages.autoplanDay.mode.cost')} (${modeKpi.cost.score})`} value="cost" />
          <Tab label={`${t('pages.autoplanDay.mode.balanced')} (${modeKpi.balanced.score})`} value="balanced" />
          <Tab label={`${t('pages.autoplanDay.mode.fast')} (${modeKpi.fast.score})`} value="fast" />
        </Tabs>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {t('pages.autoplanDay.bestMode', { mode: t(`pages.autoplanDay.mode.${bestMode}`) })}
        </Typography>

        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Button variant="contained" disabled={!canApplyPlan || applying} onClick={() => void applyCurrentPlan()}>
            {applying ? <CircularProgress size={20} color="inherit" /> : t('pages.autoplanDay.applyCta')}
          </Button>
          <Button variant="outlined" disabled={!canApplyPlan || rollingBack} onClick={() => void rollbackLastApply()}>
            {rollingBack ? <CircularProgress size={20} /> : t('pages.autoplanDay.rollbackCta')}
          </Button>
          <Typography variant="body2" sx={{ alignSelf: 'center' }}>
            {t('pages.autoplanDay.previewChanges', { count: changedCount })}
          </Typography>
        </Stack>

        {todayKpi.total > 0 ? (
          <Card variant="outlined" sx={{ mb: 2, bgcolor: 'action.hover' }}>
            <CardContent>
              <Typography variant="subtitle2">{t('pages.autoplanDay.riskTitle')}</Typography>
              <Chip
                size="small"
                label={
                  riskLevel === 'high'
                    ? t('pages.autoplanDay.risk.high')
                    : riskLevel === 'medium'
                      ? t('pages.autoplanDay.risk.medium')
                      : t('pages.autoplanDay.risk.low')
                }
                color={riskLevel === 'high' ? 'error' : riskLevel === 'medium' ? 'warning' : 'success'}
                sx={{ my: 1 }}
              />
              <Typography variant="body2">
                {offlineRate >= rollbackRate
                  ? t('pages.autoplanDay.risk.reasonOffline', { value: `${Math.round(offlineRate * 100)}%` })
                  : t('pages.autoplanDay.risk.reasonRollback', { value: `${Math.round(rollbackRate * 100)}%` })}
              </Typography>
            </CardContent>
          </Card>
        ) : null}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('pages.autoplanDay.compareTitle')}
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          {['cost', 'balanced', 'fast'].map((m) => (
            <Card key={m} variant={m === bestMode ? 'elevation' : 'outlined'} sx={{ flex: 1, minWidth: 160 }}>
              <CardContent sx={{ py: 1 }}>
                <Typography variant="caption">{t(`pages.autoplanDay.mode.${m}`)}</Typography>
                <Typography variant="body2">
                  {t('pages.autoplanDay.kpi.tasks')}: {modeKpi[m].tasks}
                </Typography>
                <Typography variant="body2">
                  {t('pages.autoplanDay.kpi.score')}: {modeKpi[m].score}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>

        <Typography variant="subtitle2">{t('pages.autoplanDay.tableTitle')}</Typography>
        {rows.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {t('pages.autoplanDay.empty')}
          </Typography>
        ) : (
          <Box sx={{ overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 2 }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <Box component="thead" sx={{ bgcolor: 'action.hover' }}>
                <Box component="tr">
                  {['ID', t('pages.autoplanDay.col.client'), t('pages.autoplanDay.col.city'), t('pages.autoplanDay.col.suggested'), t('pages.autoplanDay.col.reason')].map((h) => (
                    <Box component="th" key={h} sx={{ textAlign: 'left', p: 1, fontWeight: 600 }}>
                      {h}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.slice(0, 80).map((r) => (
                  <Box component="tr" key={r.taskId}>
                    <Box component="td" sx={{ p: 1, verticalAlign: 'top' }}>
                      {r.taskId}
                    </Box>
                    <Box component="td" sx={{ p: 1, verticalAlign: 'top' }}>
                      {r.client}
                    </Box>
                    <Box component="td" sx={{ p: 1, verticalAlign: 'top' }}>
                      {r.city}
                    </Box>
                    <Box component="td" sx={{ p: 1, verticalAlign: 'top' }}>
                      {r.suggestedTeam || '—'}
                    </Box>
                    <Box component="td" sx={{ p: 1, verticalAlign: 'top', color: 'text.secondary' }}>
                      {r.reason}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <Typography variant="subtitle2">{t('pages.autoplanDay.historyTitle')}</Typography>
          <Button size="small" onClick={() => exportHistoryCsv()}>
            {t('pages.autoplanDay.exportCta')}
          </Button>
        </Stack>
        <Box component="pre" sx={{ m: 0, mt: 1, p: 2, bgcolor: 'action.hover', borderRadius: 1, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
          {history.slice(0, 20).map((h) => (
            <div key={h.id}>
              {h.at} {h.action} {h.mode} ok={h.ok} q={h.queued}
            </div>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
