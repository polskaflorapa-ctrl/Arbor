import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

const blankMaterial = {
  nazwa: '',
  jednostka: 'szt',
  sku: '',
  min_stan: '',
  koszt_jednostkowy: '',
  oddzial_id: '',
};

const blankMovement = {
  material_id: '',
  typ: 'przyjecie',
  ilosc: '',
  task_id: '',
  notatka: '',
};

function numberOrUndefined(value) {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export default function MagazynWeb() {
  const navigate = useNavigate();
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [materialForm, setMaterialForm] = useState(blankMaterial);
  const [movementForm, setMovementForm] = useState(blankMovement);
  const user = useMemo(() => readStoredUser(), []);
  const isDyrektor = ['Dyrektor', 'Prezes', 'Administrator'].includes(user?.rola);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await api.get('/magazyn/materialy', { headers: authHeaders(token) });
      const data = Array.isArray(res.data) ? res.data : res.data?.items ?? [];
      setItems(data);
      if (!movementForm.material_id && data[0]?.id) {
        setMovementForm((prev) => ({ ...prev, material_id: String(data[0].id) }));
      }
    } catch (err) {
      console.error(err);
      showMsg(errorMessage('Nie udalo sie pobrac magazynu materialow.'));
    } finally {
      setLoading(false);
    }
  }, [movementForm.material_id, showMsg]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    load();
  }, [navigate, load]);

  const totals = useMemo(() => {
    const low = items.filter((it) => it.stan_alert === 'low').length;
    const value = items.reduce((sum, it) => sum + (Number(it.stan) || 0) * (Number(it.koszt_jednostkowy) || 0), 0);
    return { count: items.length, low, value };
  }, [items]);

  const submitMaterial = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.post('/magazyn/materialy', {
        nazwa: materialForm.nazwa,
        jednostka: materialForm.jednostka || 'szt',
        sku: materialForm.sku || null,
        min_stan: numberOrUndefined(materialForm.min_stan) ?? 0,
        koszt_jednostkowy: numberOrUndefined(materialForm.koszt_jednostkowy),
        oddzial_id: isDyrektor ? numberOrUndefined(materialForm.oddzial_id) : undefined,
      }, { headers: authHeaders(token) });
      setMaterialForm(blankMaterial);
      showMsg(successMessage('Material dodany do magazynu.'));
      await load();
    } catch (err) {
      console.error(err);
      showMsg(errorMessage(err?.response?.data?.error || 'Nie udalo sie dodac materialu.'));
    } finally {
      setSaving(false);
    }
  };

  const submitMovement = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.post('/magazyn/ruchy', {
        material_id: Number(movementForm.material_id),
        typ: movementForm.typ,
        ilosc: Number(movementForm.ilosc),
        task_id: movementForm.typ === 'rozchod' ? numberOrUndefined(movementForm.task_id) : undefined,
        notatka: movementForm.notatka || null,
      }, { headers: authHeaders(token) });
      setMovementForm((prev) => ({ ...blankMovement, material_id: prev.material_id, typ: prev.typ }));
      showMsg(successMessage('Ruch magazynowy zapisany.'));
      await load();
    } catch (err) {
      console.error(err);
      showMsg(errorMessage(err?.response?.data?.error || 'Nie udalo sie zapisac ruchu magazynowego.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box className="app-shell warehouse-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'transparent' }}>
      <Sidebar />
      <Box component="main" className="app-main warehouse-main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader title="Magazyn materialow" subtitle="Stany, przyjecia i rozchod na zlecenie" />
        <StatusMessage message={msg} />

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <Chip label={`Kartoteki: ${totals.count}`} color="primary" variant="outlined" />
          <Chip label={`Niski stan: ${totals.low}`} color={totals.low ? 'warning' : 'success'} variant="outlined" />
          <Chip label={`Wartosc: ${totals.value.toFixed(2)} PLN`} variant="outlined" />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '360px 360px 1fr' }, gap: 2, alignItems: 'start' }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Nowy material</Typography>
              <Stack component="form" spacing={1.5} onSubmit={submitMaterial}>
                <TextField label="Nazwa" value={materialForm.nazwa} required onChange={(e) => setMaterialForm((p) => ({ ...p, nazwa: e.target.value }))} />
                <Stack direction="row" spacing={1}>
                  <TextField label="Jednostka" value={materialForm.jednostka} onChange={(e) => setMaterialForm((p) => ({ ...p, jednostka: e.target.value }))} />
                  <TextField label="SKU" value={materialForm.sku} onChange={(e) => setMaterialForm((p) => ({ ...p, sku: e.target.value }))} />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField label="Min. stan" type="number" value={materialForm.min_stan} onChange={(e) => setMaterialForm((p) => ({ ...p, min_stan: e.target.value }))} />
                  <TextField label="Koszt jedn." type="number" value={materialForm.koszt_jednostkowy} onChange={(e) => setMaterialForm((p) => ({ ...p, koszt_jednostkowy: e.target.value }))} />
                </Stack>
                {isDyrektor && (
                  <TextField label="Oddzial ID" type="number" value={materialForm.oddzial_id} onChange={(e) => setMaterialForm((p) => ({ ...p, oddzial_id: e.target.value }))} />
                )}
                <Button type="submit" variant="contained" disabled={saving}>Dodaj material</Button>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Ruch magazynowy</Typography>
              <Stack component="form" spacing={1.5} onSubmit={submitMovement}>
                <TextField select SelectProps={{ native: true }} label="Material" value={movementForm.material_id} required onChange={(e) => setMovementForm((p) => ({ ...p, material_id: e.target.value }))}>
                  {items.map((it) => <option key={it.id} value={String(it.id)}>{it.nazwa}</option>)}
                </TextField>
                <TextField select SelectProps={{ native: true }} label="Typ ruchu" value={movementForm.typ} onChange={(e) => setMovementForm((p) => ({ ...p, typ: e.target.value }))}>
                  <option value="przyjecie">Przyjecie</option>
                  <option value="rozchod">Rozchod na zlecenie</option>
                </TextField>
                <TextField label="Ilosc" type="number" value={movementForm.ilosc} required onChange={(e) => setMovementForm((p) => ({ ...p, ilosc: e.target.value }))} />
                {movementForm.typ === 'rozchod' && (
                  <TextField label="Zlecenie ID" type="number" value={movementForm.task_id} required onChange={(e) => setMovementForm((p) => ({ ...p, task_id: e.target.value }))} />
                )}
                <TextField label="Notatka" value={movementForm.notatka} onChange={(e) => setMovementForm((p) => ({ ...p, notatka: e.target.value }))} />
                <Button type="submit" variant="contained" disabled={saving || items.length === 0}>Zapisz ruch</Button>
              </Stack>
            </CardContent>
          </Card>

          <Stack spacing={1.5}>
            {loading ? (
              <Typography className="warehouse-state-panel">Ladowanie magazynu...</Typography>
            ) : items.length === 0 ? (
              <Typography className="warehouse-state-panel" color="text.secondary">Brak materialow w magazynie.</Typography>
            ) : (
              items.map((it) => (
                <Card className="warehouse-card" key={it.id} variant="outlined">
                  <CardContent>
                    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography fontWeight={700}>{it.nazwa}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {[it.sku ? `SKU ${it.sku}` : null, it.oddzial_nazwa, `min. ${it.min_stan || 0} ${it.jednostka}`].filter(Boolean).join(' · ')}
                        </Typography>
                      </Box>
                      <Chip label={it.stan_alert === 'low' ? 'Niski stan' : 'OK'} color={it.stan_alert === 'low' ? 'warning' : 'success'} size="small" />
                    </Stack>
                    <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
                      <Typography variant="h5">{Number(it.stan || 0).toLocaleString('pl-PL')} {it.jednostka}</Typography>
                      <Typography color="text.secondary" sx={{ alignSelf: 'center' }}>
                        {it.koszt_jednostkowy ? `${it.koszt_jednostkowy} PLN / ${it.jednostka}` : 'koszt nieustawiony'}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
