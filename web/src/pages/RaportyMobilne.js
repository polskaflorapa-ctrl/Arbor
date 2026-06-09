import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, CardContent, Grid, Stack, Typography } from '@mui/material';
import Refresh from '@mui/icons-material/Refresh';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

function fmtMoney(n) {
  const x = Number(n) || 0;
  return `${x.toFixed(2)} PLN`;
}

export default function RaportyMobilne() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [stats, setStats] = useState({
    total_tasks: 0,
    total_hours: 0,
    avg_margin_percent: 0,
    completed_tasks: 0,
    total_revenue: 0,
    total_cost: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const token = getStoredToken();
      const res = await api.get('/raporty/mobile', { headers: authHeaders(token) });
      setStats({
        total_tasks: Number(res.data?.total_tasks ?? 0),
        total_hours: Number(res.data?.total_hours ?? 0),
        avg_margin_percent: Number(res.data?.avg_margin_percent ?? 0),
        completed_tasks: Number(res.data?.completed_tasks ?? 0),
        total_revenue: Number(res.data?.total_revenue ?? 0),
        total_cost: Number(res.data?.total_cost ?? 0),
      });
    } catch (e) {
      console.error(e);
      setErr(t('pages.mobileReports.errorLoad'));
      setStats({
        total_tasks: 0,
        total_hours: 0,
        avg_margin_percent: 0,
        completed_tasks: 0,
        total_revenue: 0,
        total_cost: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    const u = getLocalStorageJson('user');
    if (
      !u ||
      ![
        'Dyrektor',
        'Administrator',
        'Kierownik',
        'Brygadzista',
        'Specjalista',
        'Pomocnik',
        'Pomocnik bez doświadczenia',
      ].includes(u.rola)
    ) {
      navigate('/dashboard');
      return;
    }
    load();
  }, [navigate, load]);

  const zysk = stats.total_revenue - stats.total_cost;

  const kpi = [
    { key: 'tasks', label: t('pages.mobileReports.kpiTasks'), value: String(stats.total_tasks) },
    { key: 'done', label: t('pages.mobileReports.kpiDone'), value: String(stats.completed_tasks) },
    { key: 'hours', label: t('pages.mobileReports.kpiHours'), value: `${stats.total_hours.toFixed(1)} h` },
    {
      key: 'margin',
      label: t('pages.mobileReports.kpiMargin'),
      value: `${stats.avg_margin_percent.toFixed(1)} %`,
    },
  ];

  return (
    <Box className="mobile-reports-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'var(--bg)' }}>
      <CommandSidebar active="reports" />
      <Box className="mobile-reports-main" sx={{ flex: 1, p: { xs: 2, sm: 3 }, maxWidth: 960 }}>
        <PageHeader title={t('pages.mobileReports.title')} subtitle={t('pages.mobileReports.subtitle')} />
        <StatusMessage message={err} tone="error" />
        <Stack className="mobile-reports-actions" direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button startIcon={<Refresh />} onClick={() => load()} disabled={loading} variant="outlined" size="small">
            {t('pages.mobileReports.refresh')}
          </Button>
        </Stack>
        {loading ? (
          <Typography color="text.secondary">{t('pages.mobileReports.loading')}</Typography>
        ) : (
          <>
            <Grid className="mobile-reports-kpis" container spacing={2} sx={{ mb: 3 }}>
              {kpi.map((item) => (
                <Grid size={{ xs: 12, sm: 6, md: 3 }} key={item.key}>
                  <Card className="mobile-reports-kpi-card" variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">
                        {item.label}
                      </Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>
                        {item.value}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
            <Card className="mobile-reports-summary" variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
                  {t('pages.mobileReports.summary')}
                </Typography>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{t('pages.mobileReports.revenue')}</Typography>
                    <Typography>{fmtMoney(stats.total_revenue)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">{t('pages.mobileReports.costs')}</Typography>
                    <Typography color="error.main">− {fmtMoney(stats.total_cost)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography fontWeight={700}>{t('pages.mobileReports.profit')}</Typography>
                    <Typography fontWeight={700} color={zysk >= 0 ? 'success.main' : 'error.main'}>
                      {fmtMoney(zysk)}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </Box>
  );
}
