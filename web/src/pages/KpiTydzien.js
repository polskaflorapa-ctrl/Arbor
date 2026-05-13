import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import api from '../api';
import { getStoredToken } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { loadAutoplanHistory, startOfWeekUtc } from '../utils/autoplanShared';

const FIELD_ROLES = [
  'Dyrektor',
  'Administrator',
  'Kierownik',
  'Brygadzista',
  'Specjalista',
  'Pomocnik',
  'Pomocnik bez doświadczenia',
];

const PERIOD_ORDER = ['week', 'month', 'half_year', 'year'];
const PERIOD_SHORT = {
  week: 'Tydzień',
  month: 'Miesiąc',
  half_year: 'Półrocze',
  year: 'Rok',
};

function formatMoney(value) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatHours(value) {
  return `${(Number(value) || 0).toFixed(1)} h`;
}

function PeriodCard({ period }) {
  const winner = period?.winner;
  const items = Array.isArray(period?.items) ? period.items.slice(0, 5) : [];
  return (
    <Card variant="outlined" sx={{ flex: '1 1 420px', borderRadius: 1.5 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mb: 1 }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {PERIOD_SHORT[period.key] || period.key}
            </Typography>
            <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
              {period.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {period.from} - {period.to}
            </Typography>
          </Box>
          {winner ? <Chip label={`#1 ${winner.ekipa_nazwa}`} color="success" variant="outlined" /> : null}
        </Stack>

        {winner ? (
          <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1.5 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Box>
                <Typography variant="subtitle1" fontWeight={800}>
                  {winner.ekipa_nazwa}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {winner.oddzial_nazwa || 'Oddział'} {winner.brygadzista_nazwa ? `· ${winner.brygadzista_nazwa}` : ''}
                </Typography>
              </Box>
              <Typography variant="h4" color="primary" fontWeight={900}>
                {winner.score}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, winner.completion_rate || 0)}
              sx={{ mt: 1.5, height: 6, borderRadius: 1 }}
            />
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>
              <Chip size="small" label={`${winner.completed_tasks}/${winner.total_tasks} zleceń`} />
              <Chip size="small" label={formatMoney(winner.revenue)} />
              <Chip size="small" label={formatHours(winner.logged_hours || winner.planned_hours)} />
              <Chip size="small" label={`${winner.photos_count} zdjęć`} />
              {winner.issues_count ? <Chip size="small" color="warning" label={`${winner.issues_count} problemów`} /> : null}
            </Stack>
          </Box>
        ) : (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Brak zakończonych danych w tym okresie.
          </Typography>
        )}

        {items.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Ekipa</TableCell>
                <TableCell align="right">Pkt</TableCell>
                <TableCell align="right">Zlecenia</TableCell>
                <TableCell align="right">Wartość</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.team_id}>
                  <TableCell>{row.rank}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {row.ekipa_nazwa}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.oddzial_nazwa || 'Oddział'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{row.score}</TableCell>
                  <TableCell align="right">
                    {row.completed_tasks}/{row.total_tasks}
                  </TableCell>
                  <TableCell align="right">{formatMoney(row.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function KpiTydzien() {
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    setHistory(loadAutoplanHistory());
    setLoading(true);
    setError('');
    api
      .get('/raporty/ranking-brygad')
      .then((res) => setRanking(res.data))
      .catch((err) => setError(err?.response?.data?.error || 'Nie udało się pobrać rankingu brygad.'))
      .finally(() => setLoading(false));
  }, [navigate]);

  const historyStats = useMemo(() => {
    const wsIso = startOfWeekUtc(new Date()).toISOString();
    const filtered = history.filter((h) => h.at >= wsIso);
    return {
      filtered,
      applies: filtered.filter((h) => h.action === 'apply').length,
      rollbacks: filtered.filter((h) => h.action === 'rollback').length,
      okSum: filtered.reduce((a, h) => a + h.ok, 0),
      qSum: filtered.reduce((a, h) => a + h.queued, 0),
    };
  }, [history]);

  const periods = ranking?.periods || {};

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Sidebar />
      <Box sx={{ flex: 1, p: 2, maxWidth: 1280, mx: 'auto', width: '100%' }}>
        <PageHeader
          title="Liga brygad"
          subtitle="Ranking najlepszych ekip tygodnia, miesiąca, półrocza i roku"
        />

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : (
          <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
            {PERIOD_ORDER.map((key) => (
              <PeriodCard key={key} period={periods[key] || { key, label: PERIOD_SHORT[key], items: [] }} />
            ))}
          </Stack>
        )}

        <Card variant="outlined" sx={{ borderRadius: 1.5 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 0.5 }}>
              Ślad autoplanu w tym tygodniu
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Techniczny licznik zmian planu, pomocny do oceny pracy biura.
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
              <Chip label={`Wpisy: ${historyStats.filtered.length}`} />
              <Chip label={`Apply: ${historyStats.applies}`} />
              <Chip label={`Rollback: ${historyStats.rollbacks}`} />
              <Chip label={`Online OK: ${historyStats.okSum}`} />
              <Chip label={`Offline queued: ${historyStats.qSum}`} />
            </Stack>
            {historyStats.filtered.length === 0 ? (
              <Typography color="text.secondary">Brak wpisów w tym tygodniu.</Typography>
            ) : (
              <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontSize: 12, overflow: 'auto', maxHeight: 220 }}>
                {historyStats.filtered.slice(0, 30).map((h) => (
                  <div key={h.id}>
                    {h.at.slice(0, 16).replace('T', ' ')} · {h.action} · {h.mode} · {h.changed}/{h.ok}+{h.queued}
                  </div>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
