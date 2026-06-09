import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import Refresh from '@mui/icons-material/Refresh';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { isTaskClosed, isTaskDone, isTaskInProgress } from '../utils/taskWorkflow';

const FIELD_ROLES = [
  'Dyrektor',
  'Administrator',
  'Kierownik',
  'Brygadzista',
  'Specjalista',
  'Pomocnik',
  'Pomocnik bez doświadczenia',
];

function isToday(isoLike) {
  if (!isoLike) return false;
  const normalized = String(isoLike).split('T')[0];
  return normalized === new Date().toISOString().split('T')[0];
}

function formatHour(hour) {
  return hour ? String(hour).slice(0, 5) : '--:--';
}

function formatPln(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} zł`;
}

function formatDuration(minutes, t) {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h <= 0) return t('pages.missionToday.timeMin', { m });
  if (m === 0) return t('pages.missionToday.timeH', { h });
  return t('pages.missionToday.timeHm', { h, m });
}

export default function MisjaDnia() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [tasks, setTasks] = useState([]);
  const [userRole, setUserRole] = useState('');
  const [teamDayPack, setTeamDayPack] = useState(null);
  const [teamDayLoading, setTeamDayLoading] = useState(false);
  const [teamDayBusy, setTeamDayBusy] = useState(false);

  const fetchTeamDayReport = useCallback(
    async (explicitRole) => {
      const role = explicitRole ?? userRole;
      if (role !== 'Brygadzista' && role !== 'Pomocnik') return;
      const token = getStoredToken();
      if (!token) return;
      const date = new Date().toISOString().split('T')[0];
      setTeamDayLoading(true);
      try {
        const res = await api.get(`/mobile/me/team-day-report?date=${date}`, { headers: authHeaders(token) });
        const data = res.data || {};
        const preview =
          data.day_preview && typeof data.day_preview === 'object'
            ? {
                cash_by_forma: Array.isArray(data.day_preview.cash_by_forma) ? data.day_preview.cash_by_forma : [],
                issues_count: Number(data.day_preview.issues_count) || 0,
              }
            : null;
        setTeamDayPack({
          report: data.report ?? null,
          lines: Array.isArray(data.lines) ? data.lines : [],
          day_preview: preview,
        });
      } catch {
        setTeamDayPack(null);
      } finally {
        setTeamDayLoading(false);
      }
    },
    [userRole],
  );

  const loadData = useCallback(async () => {
    setErr('');
    setInfoMsg('');
    try {
      const token = getStoredToken();
      const u = getLocalStorageJson('user');
      if (!token || !u) {
        navigate('/');
        return;
      }
      const ur = u.rola ?? '';
      setUserRole(ur);
      const endpoint = ur === 'Brygadzista' || ur === 'Pomocnik' ? '/tasks/moje' : '/tasks/wszystkie';
      const res = await api.get(endpoint, { headers: authHeaders(token) });
      setTasks(Array.isArray(res.data) ? res.data : []);
      if (ur === 'Brygadzista' || ur === 'Pomocnik') {
        await fetchTeamDayReport(ur);
      } else {
        setTeamDayPack(null);
      }
    } catch (e) {
      console.error(e);
      setErr(t('pages.missionToday.errorLoad'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigate, fetchTeamDayReport, t]);

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
    void loadData();
  }, [navigate, loadData]);

  const todayTasks = useMemo(
    () => tasks.filter((task) => isToday(task.data_planowana)),
    [tasks],
  );

  const activeNow = useMemo(
    () => todayTasks.filter((task) => isTaskInProgress(task.status)),
    [todayTasks],
  );

  const urgentToday = useMemo(
    () => todayTasks.filter((task) => task.priorytet === 'Pilny'),
    [todayTasks],
  );

  const completion = useMemo(() => {
    if (!todayTasks.length) return 0;
    const done = todayTasks.filter((task) => isTaskDone(task.status)).length;
    return Math.round((done / todayTasks.length) * 100);
  }, [todayTasks]);

  useEffect(() => {
    if (
      (userRole === 'Brygadzista' || userRole === 'Pomocnik') &&
      completion === 100 &&
      todayTasks.length > 0
    ) {
      void fetchTeamDayReport();
    }
  }, [userRole, completion, todayTasks.length, fetchTeamDayReport]);

  const remainingToday = useMemo(
    () => todayTasks.filter((task) => !isTaskClosed(task.status)),
    [todayTasks],
  );

  const etaMinutes = useMemo(() => {
    return remainingToday.reduce(
      (acc, task) => acc + (isTaskInProgress(task.status) ? 75 : 95),
      0,
    );
  }, [remainingToday]);

  const etaLabel = useMemo(() => {
    if (!remainingToday.length) return t('pages.missionToday.eta.dayClosed');
    if (etaMinutes <= 120) return t('pages.missionToday.eta.inReach');
    if (etaMinutes <= 240) return t('pages.missionToday.eta.midDay');
    return t('pages.missionToday.eta.heavyLoad');
  }, [etaMinutes, remainingToday.length, t]);

  const closeTeamDay = async () => {
    const token = getStoredToken();
    if (!token) return;
    const date = new Date().toISOString().split('T')[0];
    setTeamDayBusy(true);
    try {
      await api.post(
        '/mobile/me/team-day-close',
        { report_date: date },
        { headers: authHeaders(token) },
      );
      setErr('');
      setInfoMsg(t('pages.missionToday.teamDayOk'));
      await fetchTeamDayReport();
    } catch {
      setErr(t('pages.missionToday.teamDayErr'));
    } finally {
      setTeamDayBusy(false);
    }
  };

  if (loading) {
    return (
      <Box className="mission-day-loading" sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box className="mission-day-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <CommandSidebar active="schedule" />
      <Box className="mission-day-main" sx={{ flex: 1, p: 2, maxWidth: 960, mx: 'auto', width: '100%' }}>
        <Stack className="mission-day-header-row" direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }}>
          <PageHeader title={t('pages.missionToday.title')} subtitle={t('pages.missionToday.subtitle')} />
          <Button
            size="small"
            startIcon={<Refresh />}
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              setInfoMsg('');
              void loadData();
            }}
          >
            {t('pages.mobileReports.refresh')}
          </Button>
        </Stack>
        <StatusMessage message={err} tone="error" />
        <StatusMessage message={infoMsg} tone="success" />

        <Grid className="mission-day-kpis" container spacing={1} sx={{ mb: 2 }}>
          {[
            { label: t('pages.missionToday.kpi.tasksToday'), value: todayTasks.length },
            { label: t('pages.missionToday.kpi.inProgress'), value: activeNow.length },
            { label: t('pages.missionToday.kpi.urgent'), value: urgentToday.length },
            { label: t('pages.missionToday.kpi.dayProgress'), value: `${completion}%` },
          ].map((x) => (
            <Grid size={{ xs: 6, sm: 3 }} key={x.label}>
              <Card className="mission-day-kpi-card" variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="h5">{x.value}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {x.label}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('pages.missionToday.section.dayProgress')}
        </Typography>
        <LinearProgress className="mission-day-progress" variant="determinate" value={completion} sx={{ height: 10, borderRadius: 1, mb: 1 }} />
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('pages.missionToday.progress.completed', {
              done: todayTasks.length - remainingToday.length,
              total: todayTasks.length || 0,
            })}
          </Typography>
          <Typography variant="caption">{completion}%</Typography>
        </Stack>

        <Card className="mission-day-eta-card" variant="outlined" sx={{ mb: 2, bgcolor: 'action.hover' }}>
          <CardContent>
            <Typography variant="subtitle2" color="info.main">
              {t('pages.missionToday.eta.title')}
            </Typography>
            <Typography variant="h5">
              {remainingToday.length ? formatDuration(etaMinutes, t) : t('pages.missionToday.eta.zero')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {etaLabel} · {t('pages.missionToday.eta.remainingTasks', { count: remainingToday.length })}
            </Typography>
          </CardContent>
        </Card>

        {(userRole === 'Brygadzista' || userRole === 'Pomocnik') && (
          <Card className="mission-day-team-card" variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2">{t('pages.missionToday.teamDay.cashTitle')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('pages.missionToday.teamDay.cashSub')}
              </Typography>
              {teamDayLoading && !teamDayPack?.day_preview ? <CircularProgress size={22} /> : null}
              {teamDayPack?.day_preview ? (
                <>
                  {teamDayPack.day_preview.cash_by_forma.length === 0 ? (
                    <Typography color="text.secondary">{t('pages.missionToday.teamDay.cashEmpty')}</Typography>
                  ) : (
                    teamDayPack.day_preview.cash_by_forma.map((row, idx) => (
                      <Stack direction="row" justifyContent="space-between" key={`${row.forma_platnosc ?? 'x'}-${idx}`}>
                        <Typography variant="body2">
                          {row.forma_platnosc?.trim() || t('pages.missionToday.teamDay.cashOther')}
                        </Typography>
                        <Typography variant="body2">{formatPln(row.sum_kwota)}</Typography>
                      </Stack>
                    ))
                  )}
                  {teamDayPack.day_preview.cash_by_forma.length > 0 ? (
                    <Typography sx={{ mt: 1 }} variant="body2" fontWeight={600}>
                      {t('pages.missionToday.teamDay.cashTotal')}{' '}
                      {formatPln(
                        teamDayPack.day_preview.cash_by_forma.reduce((acc, r) => acc + (Number(r.sum_kwota) || 0), 0),
                      )}
                    </Typography>
                  ) : null}
                  {(teamDayPack.day_preview.issues_count ?? 0) > 0 ? (
                    <Typography color="warning.main" variant="body2" sx={{ mt: 1 }}>
                      {t('pages.missionToday.teamDay.cashIssues', {
                        count: teamDayPack.day_preview.issues_count ?? 0,
                      })}
                    </Typography>
                  ) : null}
                </>
              ) : !teamDayLoading ? (
                <Typography color="text.secondary">{t('pages.missionToday.teamDay.cashUnavailable')}</Typography>
              ) : null}
            </CardContent>
          </Card>
        )}

        {(userRole === 'Brygadzista' || userRole === 'Pomocnik') && todayTasks.length > 0 && completion === 100 ? (
          <Card className="mission-day-team-card" variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2">{t('pages.missionToday.teamDay.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('pages.missionToday.teamDay.sub')}
              </Typography>
              {teamDayLoading ? <CircularProgress size={22} sx={{ my: 1 }} /> : null}
              {!teamDayLoading && teamDayPack?.report ? (
                <Typography variant="body2">{t('pages.missionToday.teamDay.hasReport', { id: teamDayPack.report.id })}</Typography>
              ) : null}
              {!teamDayLoading && !teamDayPack?.report ? (
                <Typography color="text.secondary">{t('pages.missionToday.teamDay.noReport')}</Typography>
              ) : null}
              <Button
                variant="outlined"
                sx={{ mt: 1 }}
                disabled={teamDayBusy}
                onClick={() => void closeTeamDay()}
              >
                {teamDayBusy ? <CircularProgress size={18} /> : t('pages.missionToday.teamDay.btn')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('pages.missionToday.section.now')}
        </Typography>
        {activeNow.length === 0 ? (
          <Typography className="mission-day-empty" color="text.secondary" sx={{ mb: 2 }}>
            {t('pages.missionToday.emptyActive')}
          </Typography>
        ) : (
          <Stack className="mission-day-active-list" spacing={1} sx={{ mb: 2 }}>
            {activeNow.slice(0, 3).map((task) => (
              <Card
                className="mission-day-task-card"
                key={task.id}
                variant="outlined"
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/zlecenia/${task.id}`)}
              >
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography fontWeight={600}>
                    {task.klient_nazwa || t('pages.missionToday.taskFallback', { id: task.id })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatHour(task.godzina_rozpoczecia)} · {task.adres || t('pages.missionToday.noAddress')}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('pages.missionToday.section.todayPlan')}
        </Typography>
        {todayTasks.length === 0 ? (
          <Typography className="mission-day-empty" color="text.secondary" sx={{ mb: 2 }}>
            {t('pages.missionToday.emptyToday')}
          </Typography>
        ) : (
          <Stack className="mission-day-plan-list" spacing={1} sx={{ mb: 2 }}>
            {todayTasks.slice(0, 8).map((task) => (
              <Card
                className="mission-day-task-card"
                key={task.id}
                variant="outlined"
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/zlecenia/${task.id}`)}
              >
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <Typography variant="caption" sx={{ minWidth: 48 }}>
                      {formatHour(task.godzina_rozpoczecia)}
                    </Typography>
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={600}>
                        {task.klient_nazwa || t('pages.missionToday.taskFallback', { id: task.id })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {task.miasto || ''} {task.adres || ''}
                      </Typography>
                    </Box>
                    <Typography color={task.priorytet === 'Pilny' ? 'error.main' : 'text.secondary'} variant="body2">
                      {task.priorytet || task.status || '—'}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('pages.missionToday.section.quickActions')}
        </Typography>
        <Stack className="mission-day-actions" direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Button variant="outlined" onClick={() => navigate('/zlecenia')}>
            {t('pages.missionToday.action.orders')}
          </Button>
          <Button variant="outlined" onClick={() => navigate('/raporty/dzienny')}>
            {t('pages.missionToday.action.dailyReport')}
          </Button>
        </Stack>
        {['Kierownik', 'Dyrektor', 'Administrator'].includes(userRole) ? (
          <Stack className="mission-day-actions" direction="row" flexWrap="wrap" gap={1}>
            <Button variant="outlined" onClick={() => navigate('/harmonogram')}>
              {t('pages.missionToday.action.schedule')}
            </Button>
            <Button variant="outlined" onClick={() => navigate('/nowe-zlecenie')}>
              {t('pages.missionToday.action.newOrder')}
            </Button>
          </Stack>
        ) : null}
      </Box>
    </Box>
  );
}
