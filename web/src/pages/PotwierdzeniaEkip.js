import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';
import { errorMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';

const STORAGE_KEY = 'crew_attendance_log_v1';
const MAX_ENTRIES = 400;

function todayYmd() {
  return new Date().toISOString().split('T')[0];
}

function readLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota errors */
  }
}

function upsertEntry(log, entry) {
  const filtered = log.filter(
    (e) => !(e.dateYmd === entry.dateYmd && String(e.teamId) === String(entry.teamId))
  );
  return [entry, ...filtered].slice(0, MAX_ENTRIES);
}

export default function PotwierdzeniaEkip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message: msg, showMessage: showMsg } = useTimedMessage();

  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState([]);
  const [actor, setActor] = useState('');

  // Derive per-team state from log for the selected date
  function getTeamEntry(teamId) {
    return log.find(
      (e) => e.dateYmd === selectedDate && String(e.teamId) === String(teamId)
    );
  }

  const loadEkipy = useCallback(async () => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    setLoading(true);
    try {
      const res = await api.get('/ekipy', { headers: authHeaders(token) });
      setEkipy(Array.isArray(res.data) ? res.data : []);
    } catch {
      showMsg(errorMessage(t('pages.crewAtt.errorLoad')));
    } finally {
      setLoading(false);
    }
  }, [navigate, showMsg, t]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = readStoredUser();
    if (u) {
      const name = u.imie && u.nazwisko ? `${u.imie} ${u.nazwisko}` : (u.rola || '');
      setActor(name);
    }
    setLog(readLog());
    loadEkipy();
  }, [navigate, loadEkipy]);

  function handleToggle(ekipa) {
    const existing = getTeamEntry(ekipa.id);
    const wasPresent = existing ? existing.present : true;
    const newEntry = {
      id: `${ekipa.id}_${selectedDate}_${Date.now()}`,
      dateYmd: selectedDate,
      teamId: ekipa.id,
      teamName: ekipa.nazwa,
      present: !wasPresent,
      note: existing?.note || '',
      actor,
      at: new Date().toISOString(),
    };
    const newLog = upsertEntry(log, newEntry);
    writeLog(newLog);
    setLog(newLog);
  }

  function handleNoteSave(ekipa, note) {
    const existing = getTeamEntry(ekipa.id);
    const newEntry = {
      id: `${ekipa.id}_${selectedDate}_${Date.now()}`,
      dateYmd: selectedDate,
      teamId: ekipa.id,
      teamName: ekipa.nazwa,
      present: existing ? existing.present : true,
      note,
      actor,
      at: new Date().toISOString(),
    };
    const newLog = upsertEntry(log, newEntry);
    writeLog(newLog);
    setLog(newLog);
  }

  // Stats for the selected date
  const dateEntries = log.filter((e) => e.dateYmd === selectedDate);
  const confirmedSet = new Set(dateEntries.filter((e) => e.present).map((e) => String(e.teamId)));
  const absentSet = new Set(dateEntries.filter((e) => !e.present).map((e) => String(e.teamId)));
  // Teams without an entry default to present=true
  const totalTeams = ekipy.length;
  const confirmedCount = ekipy.filter(
    (e) => confirmedSet.has(String(e.id)) || (!confirmedSet.has(String(e.id)) && !absentSet.has(String(e.id)))
  ).length;
  const absentCount = ekipy.filter((e) => absentSet.has(String(e.id))).length;

  return (
    <Box className="app-shell" sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'transparent' }}>
      <Sidebar />
      <Box component="main" className="app-main" sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        <PageHeader
          title={t('pages.crewAtt.title')}
          subtitle={t('pages.crewAtt.subtitle')}
          icon={<PeopleIcon />}
        />

        <StatusMessage message={msg} style={{ marginBottom: 16 }} />

        {/* Date picker + hint */}
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <TextField
            label={t('pages.crewAtt.date')}
            type="date"
            size="small"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 180 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {t('pages.crewAtt.hint')}
          </Typography>
        </Stack>

        {/* Stats bar */}
        <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
          <Chip
            label={`${t('pages.crewAtt.total')}: ${totalTeams}`}
            variant="outlined"
            size="small"
          />
          <Chip
            label={`${t('pages.crewAtt.confirmed')}: ${confirmedCount}`}
            color="success"
            size="small"
          />
          <Chip
            label={`${t('pages.crewAtt.absent')}: ${absentCount}`}
            color="error"
            size="small"
          />
        </Stack>

        {/* Team list */}
        {loading ? (
          <Typography color="text.secondary">{t('pages.crewAtt.loading')}</Typography>
        ) : ekipy.length === 0 ? (
          <Typography color="text.secondary">{t('pages.crewAtt.noTeams')}</Typography>
        ) : (
          <Stack spacing={1.5}>
            {ekipy.map((ekipa, idx) => {
              const entry = getTeamEntry(ekipa.id);
              const present = entry ? entry.present : true;
              const note = entry?.note || '';
              return (
                <Card
                  key={ekipa.id}
                  variant="outlined"
                  sx={{
                    borderColor: present ? 'success.main' : 'error.main',
                    borderWidth: 1.5,
                    transition: 'border-color 0.2s',
                  }}
                >
                  <CardContent sx={{ pb: '12px !important', pt: 1.5 }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={2}
                      sx={{ flexWrap: 'wrap', gap: 1 }}
                    >
                      {/* Team name + index */}
                      <Box sx={{ flex: 1, minWidth: 140 }}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {idx + 1}. {ekipa.nazwa}
                        </Typography>
                        {ekipa.brygadzista_imie && (
                          <Typography variant="caption" color="text.secondary">
                            {ekipa.brygadzista_imie} {ekipa.brygadzista_nazwisko || ''}
                          </Typography>
                        )}
                      </Box>

                      {/* Switch */}
                      <FormControlLabel
                        control={
                          <Switch
                            checked={present}
                            onChange={() => handleToggle(ekipa)}
                            color="success"
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2" color={present ? 'success.main' : 'error.main'} fontWeight={600}>
                            {t('pages.crewAtt.present')}
                          </Typography>
                        }
                        sx={{ m: 0 }}
                      />
                    </Stack>

                    <Divider sx={{ my: 1 }} />

                    {/* Note field */}
                    <TextField
                      label={t('pages.crewAtt.note')}
                      placeholder={t('pages.crewAtt.notePh')}
                      defaultValue={note}
                      size="small"
                      fullWidth
                      multiline
                      maxRows={3}
                      key={`${ekipa.id}_${selectedDate}`}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (entry?.note || '').trim()) {
                          handleNoteSave(ekipa, val);
                        }
                      }}
                      sx={{ mt: 0.5 }}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
