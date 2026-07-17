import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Send from '@mui/icons-material/Send';
import Save from '@mui/icons-material/Save';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { localDateKey } from '../utils/localDateKey';

function ymdFromPlan(d) {
  if (!d) return '';
  return String(d).split('T')[0];
}

function tasksEndpoint(user) {
  return user?.rola === 'Dyrektor' || user?.rola === 'Administrator' ? '/tasks/wszystkie' : '/tasks';
}

export default function RaportDzienny() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [dataRaportu, setDataRaportu] = useState(() => localDateKey());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [reportId, setReportId] = useState(null);
  const [reportStatus, setReportStatus] = useState(null);
  const [opisPracy, setOpisPracy] = useState('');
  const [podpisUrl, setPodpisUrl] = useState('');
  const [zadania, setZadania] = useState([]);
  const [materialy, setMaterialy] = useState([]);

  const load = useCallback(async () => {
    const u = getLocalStorageJson('user', {});
    if (
      !getStoredToken() ||
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
      return;
    }
    setLoading(true);
    const token = getStoredToken();
    const h = authHeaders(token);
    try {
      const [zRes, rRes] = await Promise.all([
        api.get(tasksEndpoint(u), { headers: h }),
        api.get(`/raporty-dzienne?data=${encodeURIComponent(dataRaportu)}`, { headers: h }),
      ]);
      const zList = Array.isArray(zRes.data) ? zRes.data : zRes.data?.items || [];
      const dzis = zList.filter((z) => ymdFromPlan(z.data_planowana) === dataRaportu);

      const rArr = Array.isArray(rRes.data) ? rRes.data : [];
      if (rArr.length > 0) {
        const head = rArr[0];
        setReportId(head.id);
        setReportStatus(head.status || 'Roboczy');
        const detailRes = await api.get(`/raporty-dzienne/${head.id}`, { headers: h });
        const d = detailRes.data;
        setOpisPracy(d.opis_pracy || '');
        setPodpisUrl(d.podpis_url || '');
        setZadania(
          (d.zadania || []).map((z) => ({
            task_id: z.task_id,
            czas_minuty: String(z.czas_minuty ?? ''),
            uwagi: z.uwagi || '',
            _label: [z.klient_nazwa, z.adres].filter(Boolean).join(' · '),
          })),
        );
        setMaterialy(
          (d.materialy || []).map((m) => ({
            nazwa: m.nazwa || '',
            ilosc: String(m.ilosc ?? '1'),
            jednostka: m.jednostka || 'szt',
            koszt_jednostkowy: String(m.koszt_jednostkowy ?? '0'),
          })),
        );
      } else {
        setReportId(null);
        setReportStatus(null);
        setOpisPracy('');
        setPodpisUrl('');
        setZadania(
          dzis.map((z) => ({
            task_id: z.id,
            czas_minuty: '',
            uwagi: '',
            _label: [z.klient_nazwa, z.adres].filter(Boolean).join(' · '),
          })),
        );
        setMaterialy([]);
      }
    } catch (e) {
      console.error(e);
      showMsg(errorMessage(t('pages.dailyReport.errorLoad')));
    } finally {
      setLoading(false);
    }
  }, [dataRaportu, showMsg, t]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    const u = getLocalStorageJson('user', {});
    if (
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

  const updateZadanie = (idx, field, value) => {
    setZadania((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addMaterial = () => {
    setMaterialy((m) => [...m, { nazwa: '', ilosc: '1', jednostka: 'szt', koszt_jednostkowy: '0' }]);
  };

  const removeMaterial = (idx) => {
    setMaterialy((m) => m.filter((_, i) => i !== idx));
  };

  const updateMaterial = (idx, field, value) => {
    setMaterialy((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const payload = {
        data_raportu: dataRaportu,
        opis_pracy: opisPracy || null,
        podpis_url: podpisUrl || null,
        zadania: zadania.map((z) => ({
          task_id: z.task_id,
          czas_minuty: parseInt(z.czas_minuty, 10) || 0,
          uwagi: z.uwagi || null,
        })),
        materialy: materialy
          .filter((m) => m.nazwa.trim())
          .map((m) => ({
            nazwa: m.nazwa.trim(),
            ilosc: parseFloat(m.ilosc) || 1,
            jednostka: m.jednostka || 'szt',
            koszt_jednostkowy: parseFloat(m.koszt_jednostkowy) || 0,
          })),
      };
      const res = await api.post('/raporty-dzienne', payload, { headers: h });
      setReportId(res.data?.id ?? reportId);
      setReportStatus('Roboczy');
      showMsg(successMessage(t('pages.dailyReport.saved')));
      await load();
    } catch (e) {
      console.error(e);
      showMsg(errorMessage(e.response?.data?.error || t('pages.dailyReport.errorSave')));
    } finally {
      setSaving(false);
    }
  };

  const wyslij = async () => {
    if (!reportId) {
      showMsg(errorMessage(t('pages.dailyReport.saveFirst')));
      return;
    }
    if (!podpisUrl?.trim()) {
      showMsg(errorMessage(t('pages.dailyReport.needSignature')));
      return;
    }
    setSending(true);
    try {
      const token = getStoredToken();
      await api.post(`/raporty-dzienne/${reportId}/wyslij`, {}, { headers: authHeaders(token) });
      setReportStatus('Wyslany');
      showMsg(successMessage(t('pages.dailyReport.sent')));
      await load();
    } catch (e) {
      console.error(e);
      showMsg(errorMessage(e.response?.data?.error || t('pages.dailyReport.errorSend')));
    } finally {
      setSending(false);
    }
  };

  return (
    <Box className="app-shell raport-dzienny-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'var(--bg)' }}>
      <CommandSidebar active="reports" />
      <Box className="app-main raport-dzienny-main" sx={{ flex: 1, width: '100%', p: { xs: '14px 12px 24px', sm: '22px clamp(16px, 2.4vw, 30px) 32px' }, maxWidth: 1120, mx: 'auto', minWidth: 0 }}>
        <PageHeader variant="hero" title={t('pages.dailyReport.title')} subtitle={t('pages.dailyReport.subtitle')} />
        <StatusMessage message={msg} />
        <Stack className="raport-dzienny-toolbar" spacing={2} sx={{
          mb: 2,
          p: 2,
          border: '1px solid rgba(15,95,58,0.13)',
          borderRadius: '8px',
          bgcolor: '#fff',
          boxShadow: '0 10px 24px rgba(31,79,50,0.055)',
        }}>
          <TextField
            type="date"
            label={t('pages.dailyReport.reportDate')}
            value={dataRaportu}
            onChange={(e) => setDataRaportu(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            sx={{ maxWidth: 260 }}
          />
          {reportStatus && (
            <Typography variant="body2" color="text.secondary">
              {t('pages.dailyReport.status')}: <strong>{reportStatus}</strong>
            </Typography>
          )}
        </Stack>
        {loading ? (
          <Typography className="raport-dzienny-panel" color="text.secondary" sx={{ p: 3, border: '1px solid rgba(15,95,58,0.13)', borderRadius: '8px', bgcolor: '#fff' }}>
            {t('pages.dailyReport.loading')}
          </Typography>
        ) : (
          <Box className="raport-dzienny-panel" sx={{
            p: { xs: 1.5, sm: 2.5 },
            border: '1px solid rgba(15,95,58,0.13)',
            borderRadius: '8px',
            bgcolor: '#fff',
            boxShadow: '0 12px 30px rgba(31,79,50,0.065)',
          }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('pages.dailyReport.tasksSection')}
            </Typography>
            <Box className="raport-dzienny-table" sx={{ mb: 3, overflowX: 'auto', border: '1px solid rgba(15,95,58,0.1)', borderRadius: '8px' }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('pages.dailyReport.thTask')}</TableCell>
                  <TableCell width={120}>{t('pages.dailyReport.thMinutes')}</TableCell>
                  <TableCell>{t('pages.dailyReport.thNotes')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {zadania.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography color="text.secondary">{t('pages.dailyReport.noTasksDay')}</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  zadania.map((z, i) => (
                    <TableRow key={`${z.task_id}-${i}`}>
                      <TableCell>{z._label || `ID ${z.task_id}`}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={z.czas_minuty}
                          onChange={(e) => updateZadanie(i, 'czas_minuty', e.target.value)}
                          inputProps={{ inputMode: 'numeric' }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          value={z.uwagi}
                          onChange={(e) => updateZadanie(i, 'uwagi', e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('pages.dailyReport.materials')}
            </Typography>
            <Stack className="raport-dzienny-materials" spacing={1} sx={{ mb: 2 }}>
              {materialy.map((m, i) => (
                <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start" sx={{ p: 1.25, border: '1px solid rgba(15,95,58,0.1)', borderRadius: '8px', bgcolor: 'rgba(241,249,244,0.46)' }}>
                  <TextField
                    size="small"
                    label={t('pages.dailyReport.matName')}
                    value={m.nazwa}
                    onChange={(e) => updateMaterial(i, 'nazwa', e.target.value)}
                    sx={{ flex: 2, minWidth: 140 }}
                  />
                  <TextField
                    size="small"
                    label={t('pages.dailyReport.matQty')}
                    value={m.ilosc}
                    onChange={(e) => updateMaterial(i, 'ilosc', e.target.value)}
                    sx={{ width: 100 }}
                  />
                  <TextField
                    size="small"
                    label={t('pages.dailyReport.matUnit')}
                    value={m.jednostka}
                    onChange={(e) => updateMaterial(i, 'jednostka', e.target.value)}
                    sx={{ width: 100 }}
                  />
                  <TextField
                    size="small"
                    label={t('pages.dailyReport.matCost')}
                    value={m.koszt_jednostkowy}
                    onChange={(e) => updateMaterial(i, 'koszt_jednostkowy', e.target.value)}
                    sx={{ width: 120 }}
                  />
                  <IconButton aria-label="remove" onClick={() => removeMaterial(i)} size="small">
                    <DeleteOutline />
                  </IconButton>
                </Stack>
              ))}
              <Button startIcon={<Add />} onClick={addMaterial} size="small">
                {t('pages.dailyReport.addMaterial')}
              </Button>
            </Stack>

            <TextField
              label={t('pages.dailyReport.workDescription')}
              value={opisPracy}
              onChange={(e) => setOpisPracy(e.target.value)}
              fullWidth
              multiline
              minRows={3}
              sx={{ mb: 2 }}
            />
            <TextField
              label={t('pages.dailyReport.signatureUrl')}
              value={podpisUrl}
              onChange={(e) => setPodpisUrl(e.target.value)}
              fullWidth
              size="small"
              helperText={t('pages.dailyReport.signatureHint')}
              sx={{ mb: 2 }}
            />

            <Stack className="raport-dzienny-actions" direction="row" spacing={2} flexWrap="wrap">
              <Button variant="contained" startIcon={<Save />} onClick={save} disabled={saving}>
                {saving ? t('pages.dailyReport.saving') : t('pages.dailyReport.save')}
              </Button>
              <Button variant="outlined" startIcon={<Send />} onClick={wyslij} disabled={sending || !reportId}>
                {sending ? t('pages.dailyReport.sending') : t('pages.dailyReport.send')}
              </Button>
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
  );
}
