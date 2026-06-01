import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import Add from '@mui/icons-material/Add';
import Remove from '@mui/icons-material/Remove';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

const blankMaterial = { nazwa: '', jednostka: 'szt', min_stan: '0', koszt_jednostkowy: '0', kategoria: '' };
const blankMove = { material_id: '', ilosc: '1', koszt_jednostkowy: '', task_id: '', notatki: '' };

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qty(value, unit) {
  return `${num(value).toLocaleString('pl-PL', { maximumFractionDigits: 3 })} ${unit || 'szt'}`;
}

export default function MagazynWeb() {
  const navigate = useNavigate();
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [material, setMaterial] = useState(blankMaterial);
  const [receipt, setReceipt] = useState(blankMove);
  const [issue, setIssue] = useState(blankMove);
  const user = useMemo(() => readStoredUser(), []);
  const isDyrektor = ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await api.get('/magazyn/materialy', { headers: authHeaders(token) });
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      showMsg(errorMessage(err.response?.data?.error || 'Nie udalo sie pobrac magazynu materialow.'));
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    load();
  }, [navigate, load]);

  const lowStock = items.filter((item) => item.niski_stan).length;
  const totalValue = items.reduce((sum, item) => sum + num(item.stan) * num(item.koszt_jednostkowy), 0);
  const selectedIssue = items.find((item) => String(item.id) === String(issue.material_id));

  const createMaterial = async (event) => {
    event.preventDefault();
    if (!material.nazwa.trim()) {
      showMsg(errorMessage('Podaj nazwe materialu.'));
      return;
    }
    try {
      const token = getStoredToken();
      await api.post('/magazyn/materialy', {
        ...material,
        min_stan: num(material.min_stan),
        koszt_jednostkowy: num(material.koszt_jednostkowy),
      }, { headers: authHeaders(token) });
      setMaterial(blankMaterial);
      showMsg(successMessage('Material dodany.'));
      await load();
    } catch (err) {
      console.error(err);
      showMsg(errorMessage(err.response?.data?.error || 'Nie udalo sie dodac materialu.'));
    }
  };

  const saveMove = async (kind, form, reset) => {
    if (!form.material_id || num(form.ilosc) <= 0) {
      showMsg(errorMessage('Wybierz material i ilosc wieksza od zera.'));
      return;
    }
    try {
      const token = getStoredToken();
      await api.post(`/magazyn/${kind}`, {
        material_id: Number(form.material_id),
        ilosc: num(form.ilosc),
        koszt_jednostkowy: form.koszt_jednostkowy === '' ? null : num(form.koszt_jednostkowy),
        task_id: form.task_id ? Number(form.task_id) : null,
        notatki: form.notatki || null,
      }, { headers: authHeaders(token) });
      reset(blankMove);
      showMsg(successMessage(kind === 'przyjecia' ? 'Przyjecie zapisane.' : 'Rozchod zapisany.'));
      await load();
    } catch (err) {
      console.error(err);
      const code = err.response?.data?.code || err.response?.data?.error;
      showMsg(errorMessage(code === 'WAREHOUSE_STOCK_UNDERFLOW' || code === 'magazyn_brak_stanu'
        ? 'Brak wystarczajacego stanu na magazynie.'
        : 'Nie udalo sie zapisac ruchu magazynowego.'));
    }
  };

  return (
    <Box className="app-shell warehouse-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'transparent' }}>
      <Sidebar />
      <Box component="main" className="app-main warehouse-main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader title="Magazyn materialow" subtitle="Stany, przyjecia i rozchod na zlecenie." />
        <StatusMessage message={msg} />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <Card className="warehouse-state-panel" variant="outlined"><CardContent><Typography variant="overline">Pozycje</Typography><Typography variant="h5" fontWeight={800}>{items.length}</Typography></CardContent></Card>
          <Card className="warehouse-state-panel" variant="outlined"><CardContent><Typography variant="overline">Niski stan</Typography><Typography variant="h5" fontWeight={800} color={lowStock ? 'warning.main' : 'success.main'}>{lowStock}</Typography></CardContent></Card>
          <Card className="warehouse-state-panel" variant="outlined"><CardContent><Typography variant="overline">Wartosc stanu</Typography><Typography variant="h5" fontWeight={800}>{totalValue.toFixed(2)} zl</Typography></CardContent></Card>
        </Stack>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="flex-start">
          <Stack spacing={2} sx={{ width: { xs: '100%', lg: 420 } }}>
            <Card className="warehouse-card" variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Nowy material</Typography>
                <Stack component="form" spacing={1.5} onSubmit={createMaterial}>
                  <TextField label="Nazwa" value={material.nazwa} onChange={(e) => setMaterial((f) => ({ ...f, nazwa: e.target.value }))} size="small" />
                  <Stack direction="row" spacing={1}>
                    <TextField label="Jednostka" value={material.jednostka} onChange={(e) => setMaterial((f) => ({ ...f, jednostka: e.target.value }))} size="small" />
                    <TextField label="Min. stan" type="number" value={material.min_stan} onChange={(e) => setMaterial((f) => ({ ...f, min_stan: e.target.value }))} size="small" />
                  </Stack>
                  <TextField label="Koszt jednostkowy" type="number" value={material.koszt_jednostkowy} onChange={(e) => setMaterial((f) => ({ ...f, koszt_jednostkowy: e.target.value }))} size="small" />
                  <TextField label="Kategoria" value={material.kategoria} onChange={(e) => setMaterial((f) => ({ ...f, kategoria: e.target.value }))} size="small" />
                  <Button type="submit" variant="contained" startIcon={<Add />}>Dodaj material</Button>
                </Stack>
              </CardContent>
            </Card>
            <Card className="warehouse-card" variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Przyjecie</Typography>
                <Stack spacing={1.5}>
                  <TextField select label="Material" value={receipt.material_id} onChange={(e) => setReceipt((f) => ({ ...f, material_id: e.target.value }))} size="small">
                    <MenuItem value="">Wybierz</MenuItem>
                    {items.map((item) => <MenuItem key={item.id} value={item.id}>{item.nazwa}</MenuItem>)}
                  </TextField>
                  <Stack direction="row" spacing={1}>
                    <TextField label="Ilosc" type="number" value={receipt.ilosc} onChange={(e) => setReceipt((f) => ({ ...f, ilosc: e.target.value }))} size="small" />
                    <TextField label="Koszt jedn." type="number" value={receipt.koszt_jednostkowy} onChange={(e) => setReceipt((f) => ({ ...f, koszt_jednostkowy: e.target.value }))} size="small" />
                  </Stack>
                  <TextField label="Notatki" value={receipt.notatki} onChange={(e) => setReceipt((f) => ({ ...f, notatki: e.target.value }))} size="small" />
                  <Button variant="outlined" startIcon={<Add />} onClick={() => saveMove('przyjecia', receipt, setReceipt)}>Zapisz przyjecie</Button>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
          <Stack spacing={2} sx={{ flex: 1, width: '100%' }}>
            <Card className="warehouse-card" variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Rozchod na zlecenie</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                  <TextField select label="Material" value={issue.material_id} onChange={(e) => setIssue((f) => ({ ...f, material_id: e.target.value }))} size="small" sx={{ minWidth: 220 }}>
                    <MenuItem value="">Wybierz</MenuItem>
                    {items.map((item) => <MenuItem key={item.id} value={item.id}>{item.nazwa} ({qty(item.stan, item.jednostka)})</MenuItem>)}
                  </TextField>
                  <TextField label="Ilosc" type="number" value={issue.ilosc} onChange={(e) => setIssue((f) => ({ ...f, ilosc: e.target.value }))} size="small" />
                  <TextField label="ID zlecenia" value={issue.task_id} onChange={(e) => setIssue((f) => ({ ...f, task_id: e.target.value.replace(/[^\d]/g, '') }))} size="small" />
                  <TextField label="Notatki" value={issue.notatki} onChange={(e) => setIssue((f) => ({ ...f, notatki: e.target.value }))} size="small" />
                  <Button variant="contained" color="warning" startIcon={<Remove />} onClick={() => saveMove('rozchody', issue, setIssue)}>Rozchod</Button>
                </Stack>
                {selectedIssue ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Dostepne: {qty(selectedIssue.stan, selectedIssue.jednostka)}</Typography> : null}
              </CardContent>
            </Card>
            {loading ? <Typography className="warehouse-state-panel">Ladowanie magazynu...</Typography> : null}
            {!loading && items.length === 0 ? <Typography className="warehouse-state-panel" color="text.secondary">Brak materialow w magazynie.</Typography> : null}
            {!loading && items.length > 0 ? (
              <Stack className="warehouse-list" spacing={1.5}>
                {items.map((item) => (
                  <Card className="warehouse-card" key={item.id} variant="outlined">
                    <CardContent>
                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                        <Box>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography fontWeight={800}>{item.nazwa}</Typography>
                            {item.kategoria ? <Chip label={item.kategoria} size="small" variant="outlined" /> : null}
                            {item.niski_stan ? <Chip label="Niski stan" size="small" color="warning" /> : null}
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Min: {qty(item.min_stan, item.jednostka)}
                            {isDyrektor && item.oddzial_nazwa ? ` - Oddzial: ${item.oddzial_nazwa}` : ''}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                          <Typography variant="h6" fontWeight={900}>{qty(item.stan, item.jednostka)}</Typography>
                          <Typography variant="body2" color="text.secondary">{num(item.koszt_jednostkowy).toFixed(2)} zl / {item.jednostka}</Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
