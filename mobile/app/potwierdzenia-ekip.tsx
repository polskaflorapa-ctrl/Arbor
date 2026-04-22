import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import {
  attendanceForDate,
  loadAttendance,
  upsertAttendance,
  type AttendanceEntry,
} from '../utils/attendance-local';
import { getStoredSession } from '../utils/session';

type EkipaRow = { id: number; nazwa: string };

export default function PotwierdzeniaEkipScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/potwierdzenia-ekip');
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [actor, setActor] = useState('');
  const [dateYmd, setDateYmd] = useState(() => new Date().toISOString().slice(0, 10));
  const [ekipy, setEkipy] = useState<EkipaRow[]>([]);
  const [entries, setEntries] = useState<AttendanceEntry[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refreshLocal = useCallback(async () => {
    const list = await loadAttendance();
    setEntries(list);
  }, []);

  const loadEkipy = useCallback(async (auth: string) => {
    const res = await fetch(`${API_URL}/ekipy`, { headers: { Authorization: `Bearer ${auth}` } });
    if (!res.ok) {
      setEkipy([]);
      return;
    }
    const d = await res.json();
    setEkipy(Array.isArray(d) ? d.map((x: { id: number; nazwa: string }) => ({ id: x.id, nazwa: x.nazwa })) : []);
  }, []);

  useEffect(() => {
    void (async () => {
      const { token: tok, user } = await getStoredSession();
      setToken(tok);
      const name = [String(user?.imie || ''), String(user?.nazwisko || '')].join(' ').trim();
      setActor(name || String(user?.rola || 'user'));
      if (tok) await loadEkipy(tok);
      await refreshLocal();
      setLoading(false);
    })();
  }, [loadEkipy, refreshLocal]);

  const dayEntries = attendanceForDate(entries, dateYmd);
  const byTeam = new Map(dayEntries.map((e) => [e.teamId, e]));

  const toggle = async (team: EkipaRow, present: boolean) => {
    const prev = byTeam.get(String(team.id));
    await upsertAttendance({
      id: prev?.id,
      dateYmd,
      teamId: String(team.id),
      teamName: team.nazwa,
      present,
      note: notes[String(team.id)] ?? prev?.note ?? '',
      actor,
    });
    await refreshLocal();
  };

  const saveNote = async (team: EkipaRow) => {
    const prev = byTeam.get(String(team.id));
    await upsertAttendance({
      id: prev?.id,
      dateYmd,
      teamId: String(team.id),
      teamName: team.nazwa,
      present: prev?.present ?? true,
      note: notes[String(team.id)] ?? prev?.note ?? '',
      actor,
    });
    await refreshLocal();
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) return <View style={S.root} />;
  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title={t('crewAtt.title')} />
      <ScrollView style={S.scroll} contentContainerStyle={S.pad}>
        <Text style={S.hint}>{t('crewAtt.hint')}</Text>
        <Text style={S.lbl}>{t('crewAtt.date')}</Text>
        <TextInput style={S.inp} value={dateYmd} onChangeText={setDateYmd} />
        {!token ? <Text style={S.warn}>{t('crewAtt.noToken')}</Text> : null}
        {ekipy.map((e) => {
          const row = byTeam.get(String(e.id));
          const present = row?.present ?? true;
          return (
            <View key={e.id} style={S.card}>
              <View style={S.row}>
                <Text style={S.team}>{e.nazwa}</Text>
                <View style={S.swRow}>
                  <Text style={S.swLbl}>{t('crewAtt.present')}</Text>
                  <Switch value={present} onValueChange={(v) => void toggle(e, v)} />
                </View>
              </View>
              <Text style={S.lbl}>{t('crewAtt.note')}</Text>
              <TextInput
                style={S.inp}
                value={notes[String(e.id)] ?? row?.note ?? ''}
                onChangeText={(txt) => setNotes((prev) => ({ ...prev, [String(e.id)]: txt }))}
                placeholder={t('crewAtt.notePh')}
                onBlur={() => void saveNote(e)}
              />
            </View>
          );
        })}
        {ekipy.length === 0 ? <Text style={S.empty}>{t('crewAtt.noTeams')}</Text> : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg },
    scroll: { flex: 1 },
    pad: { padding: 16, paddingBottom: 40 },
    hint: { fontSize: 13, color: theme.textMuted, marginBottom: 12 },
    lbl: { fontSize: 12, color: theme.textMuted, marginBottom: 4 },
    inp: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
      color: theme.text,
      backgroundColor: theme.surface2,
    },
    warn: { color: theme.warning, marginBottom: 12, fontSize: 13 },
    card: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    team: { fontSize: 15, fontWeight: '700', color: theme.text, flex: 1 },
    swRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    swLbl: { fontSize: 12, color: theme.textMuted },
    empty: { color: theme.textMuted, fontSize: 14 },
  });
}
