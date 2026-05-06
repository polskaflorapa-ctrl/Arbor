import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Add from '@mui/icons-material/Add';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

const STATUSES = ['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'];

function monthRange(y, m0) {
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m0 + 1)}-01`;
  const last = new Date(y, m0 + 1, 0).getDate();
  const to = `${y}-${pad(m0 + 1)}-${pad(last)}`;
  return { from, to };
}

export default function RezerwacjeSprzetu() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth0, setViewMonth0] = useState(() => new Date().getMonth());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sprzet, setSprzet] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    data: new Date().toISOString().split('T')[0],
    sprzet_id: '',
    ekipa_id: '',
    caly_dzien: true,
    status: 'Zarezerwowane',
  });

  const { from, to } = useMemo(() => monthRange(viewYear, viewMonth0), [viewYear, viewMonth0]);

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth0, 1);
    return d.toLocaleDateString(i18n.language === 'uk' ? 'uk-UA' : i18n.language === 'ru' ? 'ru-RU' : 'pl-PL', {
      month: 'long',
      year: 'numeric',
    });
  }, [viewYear, viewMonth0, i18n.language]);

  const loadLists = useCallback(async () => {
    const token = getStoredToken();
    const h = authHeaders(token);
    const [sRes, eRes] = await Promise.all([
      api.get('/flota/sprzet', { headers: h }),
      api.get('/ekipy', { headers: h }),
    ]);
    const sData = Array.isArray(sRes.data) ? sRes.data : sRes.data?.items || [];
    setSprzet(sData);
    setEkipy(Array.isArray(eRes.data) ? eRes.data : []);
  }, []);

  const loadReservations = useCallback(async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const res = await api.get(`/flota/rezerwacje?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        headers: h,
      });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (err.response?.status === 404) {
        showMsg(errorMessage(t('pages.equipmentReservations.notMigrated')));
        setRows([]);
      } else {
        console.error(err);
        showMsg(errorMessage(t('pages.equipmentReservations.errorLoad')));
        setRows([]);
      }
    } finally {
      setLoading(false);
    }
  }, [from, to, showMsg, t]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    loadLists().catch(() => {});
  }, [navigate, loadLists]);

  useEffect(() => {
    if (!getStoredToken()) return;
    loadReservations();
  }, [loadReservations]);

  const prevMonth = () => {
    if (viewMonth0 === 0) {
      setViewMonth0(11);
      setViewYear((y) => y - 1);
    } else setViewMonth0((m) => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth0 === 11) {
      setViewMonth0(0);
      setViewYear((y) => y + 1);
    } else setViewMonth0((m) => m + 1);
  };

  const statusLabel = (s) => {
    const map = {
      Zarezerwowane: t('pages.equipmentReservations.statusReserved'),
      Wydane: t('pages.equipmentReservations.statusIssued'),
      Zwrócone: t('pages.equipmentReservations.statusReturned'),
      Anulowane: t('pages.equipmentReservations.statusCancelled'),
    };
    return map[s] || s;
  };

  const changeStatus = async (id, status) => {
    try {
      const token = getStoredToken();
      await api.put(`/flota/rezerwacje/${id}/status`, { status }, { headers: authHeaders(token) });
      showMsg(successMessage('OK'));
      await loadReservations();
    } catch (err) {
      console.error(err);
      showMsg(errorMessage(err.response?.data?.error || t('pages.equipmentReservations.errorStatus')));
    }
  };

  const submitNew = async (e) => {
    e.preventDefault();
    if (!form.sprzet_id || !form.ekipa_id) {
      showMsg(errorMessage(t('pages.equipmentReservations.fillRequired')));
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      await api.post(
        '/flota/rezerwacje',
        {
          sprzet_id: Number(form.sprzet_id),
          ekipa_id: Number(form.ekipa_id),
          data_od: form.data,
          data_do: form.data,
          caly_dzien: form.caly_dzien,
          status: form.status,
        },
        { headers: h },
      );
      showMsg(successMessage('OK'));
      setModalOpen(false);
      await loadReservations();
    } catch (err) {
      console.error(err);
      const code = err.response?.data?.error;
      if (err.response?.status === 409) {
        showMsg(errorMessage(t('pages.equipmentReservations.conflict')));
      } else if (err.response?.status === 404) {
        showMsg(errorMessage(t('pages.equipmentReservations.notMigrated')));
      } else {
        showMsg(errorMessage(code || t('pages.equipmentReservations.errorSave')));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'var(--bg)' }}>
      <Sidebar />
      <Box component="main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader title={t('pages.equipmentReservations.title')} subtitle={t('pages.equipmentReservations.subtitle')} />
        <StatusMessage message={msg} />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Button size="small" onClick={prevMonth} startIcon={<ChevronLeft />}>
            {t('pages.equipmentReservations.prevMonth')}
          </Button>
          <Typography sx={{ minWidth: 180, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel}</Typography>
          <Button size="small" onClick={nextMonth} endIcon={<ChevronRight />}>
            {t('pages.equipmentReservations.nextMonth')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<Add />} onClick={() => setModalOpen(true)}>
            {t('pages.equipmentReservations.add')}
          </Button>
        </Stack>
        {loading ? (
          <Typography>{t('pages.equipmentReservations.loading')}</Typography>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary">{t('pages.equipmentReservations.empty')}</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('pages.equipmentReservations.thDate')}</TableCell>
                <TableCell>{t('pages.equipmentReservations.thEquipment')}</TableCell>
                <TableCell>{t('pages.equipmentReservations.thTeam')}</TableCell>
                <TableCell>{t('pages.equipmentReservations.thStatus')}</TableCell>
                <TableCell>{t('pages.equipmentReservations.thActions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{(r.data_od || r.data || '').toString().split('T')[0]}</TableCell>
                  <TableCell>{r.sprzet_nazwa || r.nazwa_sprzetu || '—'}</TableCell>
                  <TableCell>{r.ekipa_nazwa || r.nazwa_ekipy || '—'}</TableCell>
                  <TableCell>{statusLabel(r.status)}</TableCell>
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <Select
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <MenuItem key={s} value={s}>
                            {statusLabel(s)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={modalOpen} onClose={() => !saving && setModalOpen(false)} maxWidth="sm" fullWidth>
          <form onSubmit={submitNew}>
            <DialogTitle>{t('pages.equipmentReservations.modalTitle')}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  type="date"
                  label={t('pages.equipmentReservations.fieldDate')}
                  InputLabelProps={{ shrink: true }}
                  value={form.data}
                  onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                  fullWidth
                />
                <FormControl fullWidth>
                  <InputLabel>{t('pages.equipmentReservations.fieldEquipment')}</InputLabel>
                  <Select
                    label={t('pages.equipmentReservations.fieldEquipment')}
                    value={form.sprzet_id}
                    onChange={(e) => setForm((f) => ({ ...f, sprzet_id: e.target.value }))}
                  >
                    <MenuItem value="">{t('pages.equipmentReservations.selectEquipment')}</MenuItem>
                    {sprzet.map((s) => (
                      <MenuItem key={s.id} value={String(s.id)}>
                        {s.nazwa || `#${s.id}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>{t('pages.equipmentReservations.fieldTeam')}</InputLabel>
                  <Select
                    label={t('pages.equipmentReservations.fieldTeam')}
                    value={form.ekipa_id}
                    onChange={(e) => setForm((f) => ({ ...f, ekipa_id: e.target.value }))}
                  >
                    <MenuItem value="">{t('pages.equipmentReservations.selectTeam')}</MenuItem>
                    {ekipy.map((e) => (
                      <MenuItem key={e.id} value={String(e.id)}>
                        {e.nazwa || `#${e.id}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>{t('pages.equipmentReservations.fieldStatus')}</InputLabel>
                  <Select
                    label={t('pages.equipmentReservations.fieldStatus')}
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    {STATUSES.filter((s) => s !== 'Zwrócone' && s !== 'Anulowane').map((s) => (
                      <MenuItem key={s} value={s}>
                        {statusLabel(s)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.caly_dzien}
                      onChange={(e) => setForm((f) => ({ ...f, caly_dzien: e.target.checked }))}
                    />
                  }
                  label={t('pages.equipmentReservations.fullDay')}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={() => setModalOpen(false)} disabled={saving}>
                {t('pages.equipmentReservations.cancel')}
              </Button>
              <Button type="submit" variant="contained" disabled={saving}>
                {t('pages.equipmentReservations.save')}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Box>
    </Box>
  );
}
