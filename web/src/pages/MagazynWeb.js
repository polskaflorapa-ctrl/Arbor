import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';
import { errorMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

export default function MagazynWeb() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const user = useMemo(() => readStoredUser(), []);
  const isDyrektor = user?.rola === 'Dyrektor';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await api.get('/flota/sprzet', { headers: authHeaders(token) });
      const data = Array.isArray(res.data) ? res.data : res.data?.items ?? [];
      setItems(data);
    } catch (err) {
      console.error(err);
      showMsg(errorMessage(t('pages.warehouse.errorLoad')));
    } finally {
      setLoading(false);
    }
  }, [showMsg, t]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    load();
  }, [navigate, load]);

  return (
    <Box className="app-shell warehouse-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'transparent' }}>
      <Sidebar />
      <Box component="main" className="app-main warehouse-main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader title={t('pages.warehouse.title')} subtitle={t('pages.warehouse.subtitle')} />
        <StatusMessage message={msg} />
        {loading ? (
          <Typography className="warehouse-state-panel">{t('pages.warehouse.loading')}</Typography>
        ) : items.length === 0 ? (
          <Typography className="warehouse-state-panel" color="text.secondary">{t('pages.warehouse.empty')}</Typography>
        ) : (
          <Stack className="warehouse-list" spacing={2} sx={{ maxWidth: 640 }}>
            {items.map((it) => (
              <Card className="warehouse-card" key={it.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <Typography fontWeight={600}>{it.nazwa}</Typography>
                    {it.typ && <Chip label={it.typ} size="small" variant="outlined" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {[
                      it.nr_seryjny ? `${t('pages.flota.fieldSerial')}: ${it.nr_seryjny}` : null,
                      it.ekipa_nazwa ? `${t('pages.flota.fieldTeam')}: ${it.ekipa_nazwa}` : null,
                      isDyrektor && it.oddzial_nazwa
                        ? `${t('pages.flota.fieldBranch')}: ${it.oddzial_nazwa}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
