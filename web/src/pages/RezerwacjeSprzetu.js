import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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

const ACTIVE_STATUSES = new Set(['Zarezerwowane', 'Wydane']);

function todayYmd() {
  return new Date().toISOString().split('T')[0];
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function rowStart(row) {
  return String(row?.data_od || row?.data || '').slice(0, 10);
}

function rowEnd(row) {
  return String(row?.data_do || row?.data_od || row?.data || '').slice(0, 10);
}

function rowsOverlap(a, b) {
  const aStart = rowStart(a);
  const aEnd = rowEnd(a);
  const bStart = rowStart(b);
  const bEnd = rowEnd(b);
  return aStart && aEnd && bStart && bEnd && aStart <= bEnd && aEnd >= bStart;
}

function isActiveReservation(row) {
  return ACTIVE_STATUSES.has(row?.status);
}

function reservationTaskLabel(row) {
  if (!row?.task_id) return 'Bez zlecenia';
  return `#${row.task_id}${row.task_klient_nazwa ? ` ${row.task_klient_nazwa}` : ''}`;
}

function buildConflictIds(rows) {
  const ids = new Set();
  const active = (rows || []).filter(isActiveReservation);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (String(active[i].sprzet_id || '') !== String(active[j].sprzet_id || '')) continue;
      if (!rowsOverlap(active[i], active[j])) continue;
      ids.add(String(active[i].id));
      ids.add(String(active[j].id));
    }
  }
  return ids;
}

function selectParam(params, ...keys) {
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return '';
}

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
  const location = useLocation();
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth0, setViewMonth0] = useState(() => new Date().getMonth());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sprzet, setSprzet] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [form, setForm] = useState({
    data: todayYmd(),
    sprzet_id: '',
    ekipa_id: '',
    task_id: '',
    caly_dzien: true,
    status: 'Zarezerwowane',
  });

  const { from, to } = useMemo(() => monthRange(viewYear, viewMonth0), [viewYear, viewMonth0]);
  const queryParams = useMemo(() => new URLSearchParams(location.search || ''), [location.search]);
  const queryDate = selectParam(queryParams, 'date', 'prefData');
  const queryTask = selectParam(queryParams, 'task', 'prefZlecenie');
  const queryTeam = selectParam(queryParams, 'team', 'ekipa');
  const queryEquipment = selectParam(queryParams, 'equipment', 'sprzet').split(',')[0] || '';

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
    setEkipy(Array.isArray(eRes.data) ? eRes.data : eRes.data?.ekipy || []);
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

  useEffect(() => {
    if (isYmd(queryDate)) {
      const [year, month] = queryDate.split('-').map(Number);
      setViewYear(year);
      setViewMonth0(month - 1);
      setForm((prev) => ({ ...prev, data: queryDate }));
    }
    if (queryEquipment) {
      setEquipmentFilter(String(queryEquipment));
      setForm((prev) => ({ ...prev, sprzet_id: String(queryEquipment) }));
    }
    if (queryTeam) {
      setTeamFilter(String(queryTeam));
      setForm((prev) => ({ ...prev, ekipa_id: String(queryTeam) }));
    }
    if (queryTask) {
      setTaskFilter(String(queryTask));
      setStatusFilter('all');
      setForm((prev) => ({ ...prev, task_id: String(queryTask) }));
    }
    if (queryParams.get('open') === '1') {
      setModalOpen(true);
    }
  }, [queryDate, queryEquipment, queryParams, queryTask, queryTeam]);

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

  const conflictIds = useMemo(() => buildConflictIds(rows), [rows]);
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter === 'active' && !isActiveReservation(row)) return false;
      if (statusFilter !== 'active' && statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (equipmentFilter && String(row.sprzet_id || '') !== String(equipmentFilter)) return false;
      if (teamFilter && String(row.ekipa_id || '') !== String(teamFilter)) return false;
      if (taskFilter && String(row.task_id || '') !== String(taskFilter)) return false;
      return true;
    });
  }, [equipmentFilter, rows, statusFilter, taskFilter, teamFilter]);

  const summary = useMemo(() => {
    const active = rows.filter(isActiveReservation);
    const issued = rows.filter((row) => row.status === 'Wydane');
    const linkedTasks = new Set(rows.map((row) => row.task_id).filter(Boolean));
    return {
      total: rows.length,
      active: active.length,
      issued: issued.length,
      linkedTasks: linkedTasks.size,
      conflicts: conflictIds.size,
      visible: filteredRows.length,
    };
  }, [conflictIds.size, filteredRows.length, rows]);

  const openNewReservation = (patch = {}) => {
    setForm((prev) => ({
      ...prev,
      data: patch.data || prev.data || todayYmd(),
      sprzet_id: patch.sprzet_id || prev.sprzet_id || '',
      ekipa_id: patch.ekipa_id || prev.ekipa_id || '',
      task_id: patch.task_id || prev.task_id || taskFilter || '',
      status: patch.status || prev.status || 'Zarezerwowane',
    }));
    setModalOpen(true);
  };

  const clearFilters = () => {
    setStatusFilter('active');
    setEquipmentFilter('');
    setTeamFilter('');
    setTaskFilter('');
  };

  const openCalendarForRow = (row) => {
    const params = new URLSearchParams();
    params.set('tab', 'equipment');
    params.set('modal', '0');
    const date = rowStart(row);
    if (row.task_id) params.set('task', String(row.task_id));
    if (date) params.set('date', date);
    if (row.ekipa_id) params.set('team', String(row.ekipa_id));
    if (row.sprzet_id) params.set('equipment', String(row.sprzet_id));
    navigate(`/kalendarz-zasobow?${params.toString()}`);
  };

  const openTaskForRow = (row) => {
    if (!row?.task_id) return;
    navigate(`/zlecenia/${row.task_id}?focus=officePlan`);
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
      const taskId = Number(form.task_id);
      await api.post(
        '/flota/rezerwacje',
        {
          sprzet_id: Number(form.sprzet_id),
          ekipa_id: Number(form.ekipa_id),
          data_od: form.data,
          data_do: form.data,
          caly_dzien: form.caly_dzien,
          status: form.status,
          ...(Number.isFinite(taskId) && taskId > 0
            ? { task_id: taskId, notatki: `Plan zlecenia #${taskId}` }
            : {}),
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
    <Box className="equipment-res-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'var(--bg)' }}>
      <Sidebar />
      <Box component="main" className="equipment-res-main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader
          title={t('pages.equipmentReservations.title')}
          subtitle={t('pages.equipmentReservations.subtitle')}
          actions={(
            <>
              <Button
                variant="outlined"
                onClick={() => navigate(`/kalendarz-zasobow?tab=equipment&date=${encodeURIComponent(form.data || todayYmd())}&modal=0`)}
              >
                Kalendarz zasobow
              </Button>
              <Button variant="contained" startIcon={<Add />} onClick={() => openNewReservation()}>
                {t('pages.equipmentReservations.add')}
              </Button>
            </>
          )}
        />
        <StatusMessage message={msg} />
        <Stack className="equipment-res-monthbar" direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Button size="small" onClick={prevMonth} startIcon={<ChevronLeft />}>
            {t('pages.equipmentReservations.prevMonth')}
          </Button>
          <Typography sx={{ minWidth: 180, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel}</Typography>
          <Button size="small" onClick={nextMonth} endIcon={<ChevronRight />}>
            {t('pages.equipmentReservations.nextMonth')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 700 }}>
            Widoczne: {summary.visible}/{summary.total}
          </Typography>
        </Stack>

        <Box
          className="equipment-res-kpis"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 1.5,
            mb: 2,
          }}
        >
          {[
            ['Rezerwacje', summary.total],
            ['Aktywne', summary.active],
            ['Wydane', summary.issued],
            ['Ze zleceniem', summary.linkedTasks],
            ['Kolizje', summary.conflicts],
          ].map(([label, value]) => (
            <Box
              className="equipment-res-kpi-card"
              key={label}
              sx={{
                border: '1px solid var(--border)',
                borderRadius: 2,
                bgcolor: label === 'Kolizje' && value ? 'rgba(239,68,68,0.1)' : 'var(--surface-glass)',
                p: 1.5,
              }}
            >
              <Typography sx={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 800 }}>{label}</Typography>
              <Typography sx={{ color: label === 'Kolizje' && value ? '#dc2626' : 'var(--text)', fontSize: 24, fontWeight: 900 }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>

        <Stack
          className="equipment-res-filters"
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          alignItems={{ xs: 'stretch', md: 'center' }}
          sx={{ mb: 2, p: 1.5, border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--surface-glass)' }}
        >
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="active">Aktywne</MenuItem>
              <MenuItem value="all">Wszystkie</MenuItem>
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{statusLabel(s)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 190 }}>
            <InputLabel>Sprzet</InputLabel>
            <Select label="Sprzet" value={equipmentFilter} onChange={(e) => setEquipmentFilter(e.target.value)}>
              <MenuItem value="">Wszystkie</MenuItem>
              {sprzet.map((s) => (
                <MenuItem key={s.id} value={String(s.id)}>{s.nazwa || `#${s.id}`}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 190 }}>
            <InputLabel>Ekipa</InputLabel>
            <Select label="Ekipa" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <MenuItem value="">Wszystkie</MenuItem>
              {ekipy.map((e) => (
                <MenuItem key={e.id} value={String(e.id)}>{e.nazwa || `#${e.id}`}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Zlecenie"
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="ID"
            sx={{ maxWidth: 130 }}
          />
          <Button onClick={clearFilters}>Wyczysc</Button>
        </Stack>

        {loading ? (
          <Typography>{t('pages.equipmentReservations.loading')}</Typography>
        ) : filteredRows.length === 0 ? (
          <Typography color="text.secondary">{t('pages.equipmentReservations.empty')}</Typography>
        ) : (
          <Table className="equipment-res-table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Okres</TableCell>
                <TableCell>{t('pages.equipmentReservations.thEquipment')}</TableCell>
                <TableCell>{t('pages.equipmentReservations.thTeam')}</TableCell>
                <TableCell>Zlecenie</TableCell>
                <TableCell>{t('pages.equipmentReservations.thStatus')}</TableCell>
                <TableCell>{t('pages.equipmentReservations.thActions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.map((r) => (
                <TableRow
                  key={r.id}
                  sx={{
                    bgcolor: conflictIds.has(String(r.id)) ? 'rgba(239,68,68,0.08)' : undefined,
                    '& td': { borderColor: conflictIds.has(String(r.id)) ? 'rgba(239,68,68,0.22)' : undefined },
                  }}
                >
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{rowStart(r) || '-'}</Typography>
                    {rowEnd(r) && rowEnd(r) !== rowStart(r) ? (
                      <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>do {rowEnd(r)}</Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{r.sprzet_nazwa || r.nazwa_sprzetu || '—'}</TableCell>
                  <TableCell>{r.ekipa_nazwa || r.nazwa_ekipy || '—'}</TableCell>
                  <TableCell>
                    {r.task_id ? (
                      <Button size="small" onClick={() => openTaskForRow(r)}>
                        {reservationTaskLabel(r)}
                      </Button>
                    ) : (
                      <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>Bez zlecenia</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <span>{statusLabel(r.status)}</span>
                      {conflictIds.has(String(r.id)) ? (
                        <Typography sx={{ color: '#dc2626', fontSize: 12, fontWeight: 900 }}>Kolizja</Typography>
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <FormControl size="small" sx={{ minWidth: 150 }}>
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
                      <Button size="small" variant="outlined" onClick={() => openCalendarForRow(r)}>
                        Kalendarz
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog className="equipment-res-dialog" open={modalOpen} onClose={() => !saving && setModalOpen(false)} maxWidth="sm" fullWidth>
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
                <TextField
                  label="Zlecenie (opcjonalnie)"
                  value={form.task_id}
                  onChange={(e) => setForm((f) => ({ ...f, task_id: e.target.value.replace(/[^\d]/g, '') }))}
                  placeholder="ID zlecenia"
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
