import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Remove from '@mui/icons-material/Remove';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import { getStoredToken } from '../utils/storedToken';

const STORAGE_KEY = 'magazyn_local_items_v1';

function defaultSeed() {
  return [
    { id: '1', label: 'Piła spalinowa', qty: 4, minQty: 2 },
    { id: '2', label: 'Podkaszarka', qty: 6, minQty: 3 },
    { id: '3', label: 'Hełm + odzież', qty: 12, minQty: 10 },
  ];
}

function readItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultSeed();
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return defaultSeed();
    return p;
  } catch {
    return defaultSeed();
  }
}

function writeItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function MagazynWeb() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(() => {
    setItems(readItems());
  }, []);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    load();
  }, [navigate, load]);

  const setQty = async (id, delta) => {
    const next = items.map((i) =>
      i.id === id ? { ...i, qty: Math.max(0, (i.qty || 0) + delta) } : i,
    );
    writeItems(next);
    setItems(next);
  };

  const removeItem = (id) => {
    if (!window.confirm(t('pages.warehouse.removeBody'))) return;
    const next = items.filter((i) => i.id !== id);
    writeItems(next);
    setItems(next);
  };

  const addItem = () => {
    const label = newLabel.trim() || t('pages.warehouse.newPlaceholder');
    const id = `${Date.now()}`;
    const next = [...items, { id, label, qty: 0, minQty: 0 }];
    writeItems(next);
    setItems(next);
    setNewLabel('');
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'var(--bg)' }}>
      <Sidebar />
      <Box component="main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader title={t('pages.warehouse.title')} subtitle={t('pages.warehouse.subtitle')} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
          {t('pages.warehouse.hint')}
        </Typography>
        <Stack spacing={2} sx={{ maxWidth: 640 }}>
          {items.map((it) => {
            const low = it.minQty > 0 && it.qty < it.minQty;
            return (
              <Card
                key={it.id}
                variant="outlined"
                sx={{ borderColor: low ? 'error.main' : 'divider' }}
              >
                <CardContent>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Typography fontWeight={600}>{it.label}</Typography>
                    <IconButton size="small" color="error" onClick={() => removeItem(it.id)} aria-label={t('pages.warehouse.confirmRemove')}>
                      <DeleteOutline />
                    </IconButton>
                  </Stack>
                  <Typography variant="body2" color={low ? 'error' : 'text.secondary'} sx={{ mt: 0.5 }}>
                    {t('pages.warehouse.qty')}: {it.qty}
                    {it.minQty > 0 ? ` · ${t('pages.warehouse.minShort')}: ${it.minQty}` : ''}
                    {low ? ` — ${t('pages.warehouse.lowStock')}` : ''}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button size="small" variant="outlined" startIcon={<Remove />} onClick={() => setQty(it.id, -1)}>
                      −1
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => setQty(it.id, 1)}>
                      +1
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              fullWidth
              placeholder={t('pages.warehouse.newPlaceholder')}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <IconButton color="primary" onClick={addItem} aria-label={t('pages.warehouse.add')}>
              <Add />
            </IconButton>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
