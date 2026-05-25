import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
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

function normalizeAttendanceItem(item: any, fallbackDate: string): AttendanceEntry {
  const teamId = String(item?.teamId ?? item?.team_id ?? '');
  return {
    id: String(item?.id || `${teamId}_${fallbackDate}`),
    dateYmd: String(item?.dateYmd || item?.date_ymd || fallbackDate),
    teamId,
    teamName: String(item?.teamName || item?.team_name || item?.nazwa || `Ekipa #${teamId}`),
    present: item?.present !== false,
    note: String(item?.note || ''),
    actor: String(item?.actor || item?.actor_name || ''),
    at: String(item?.at || item?.updated_at || item?.created_at || new Date().toISOString()),
  };
}

async function saveRemoteAttendance(auth: string, team: EkipaRow, entry: AttendanceEntry): Promise<AttendanceEntry> {
  const res = await fetch(`${API_URL}/ekipy/${team.id}/attendance`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateYmd: entry.dateYmd,
      present: entry.present,
      note: entry.note || '',
    }),
  });
  if (!res.ok) throw new Error('attendance_save_failed');
  const data = await res.json();
  return normalizeAttendanceItem(data?.item || entry, entry.dateYmd);
}

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

  const refreshAttendance = useCallback(async (auth?: string | null, date = dateYmd) => {
    if (auth) {
      try {
        const res = await fetch(`${API_URL}/ekipy/attendance?date=${encodeURIComponent(date)}`, {
          headers: { Authorization: `Bearer ${auth}` },
        });
        if (res.ok) {
          const data = await res.json();
          const remoteItems = Array.isArray(data?.items)
            ? data.items.map((item: any) => normalizeAttendanceItem(item, date))
            : [];
          setEntries(remoteItems);
          return;
        }
      } catch {
        // Offline fallback below.
      }
    }
    const list = await loadAttendance();
    setEntries(list);
  }, [dateYmd]);

  const loadEkipy = useCallback(async (auth: string) => {
    const res = await fetch(`${API_URL}/ekipy?include_delegacje=1`, { headers: { Authorization: `Bearer ${auth}` } });
    if (!res.ok) {
      setEkipy([]);
      return;
    }
    const d = await res.json();
    const items = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
    setEkipy(items.map((x: { id: number; nazwa: string }) => ({ id: x.id, nazwa: x.nazwa })));
  }, []);

  useEffect(() => {
    void (async () => {
      const { token: tok, user } = await getStoredSession();
      setToken(tok);
      const name = [String(user?.imie || ''), String(user?.nazwisko || '')].join(' ').trim();
      setActor(name || String(user?.rola || 'user'));
      if (tok) await loadEkipy(tok);
      await refreshAttendance(tok);
      setLoading(false);
    })();
  }, [loadEkipy, refreshAttendance]);

  useEffect(() => {
    if (!loading) void refreshAttendance(token, dateYmd);
  }, [dateYmd, loading, refreshAttendance, token]);

  const dayEntries = attendanceForDate(entries, dateYmd);
  const byTeam = new Map(dayEntries.map((e) => [e.teamId, e]));
  const confirmedCount = ekipy.filter((team) => byTeam.get(String(team.id))?.present ?? true).length;
  const absentCount = Math.max(0, ekipy.length - confirmedCount);

  const toggle = async (team: EkipaRow, present: boolean) => {
    const prev = byTeam.get(String(team.id));
    const entry: AttendanceEntry = {
      id: prev?.id || `${team.id}_${dateYmd}`,
      dateYmd,
      teamId: String(team.id),
      teamName: team.nazwa,
      present,
      note: notes[String(team.id)] ?? prev?.note ?? '',
      actor,
      at: new Date().toISOString(),
    };
    if (token) {
      try {
        const saved = await saveRemoteAttendance(token, team, entry);
        await upsertAttendance(saved);
        await refreshAttendance(token);
        return;
      } catch {
        // Keep the field workflow usable offline.
      }
    }
    await upsertAttendance(entry);
    await refreshAttendance(token);
  };

  const saveNote = async (team: EkipaRow) => {
    const prev = byTeam.get(String(team.id));
    const entry: AttendanceEntry = {
      id: prev?.id || `${team.id}_${dateYmd}`,
      dateYmd,
      teamId: String(team.id),
      teamName: team.nazwa,
      present: prev?.present ?? true,
      note: notes[String(team.id)] ?? prev?.note ?? '',
      actor,
      at: new Date().toISOString(),
    };
    if (token) {
      try {
        const saved = await saveRemoteAttendance(token, team, entry);
        await upsertAttendance(saved);
        await refreshAttendance(token);
        return;
      } catch {
        // Keep the note locally when the server is unavailable.
      }
    }
    await upsertAttendance(entry);
    await refreshAttendance(token);
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
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.headerIcon}>
          <Ionicons name="people-outline" size={22} color={theme.accent} />
        </View>
        <View style={S.headerTextBox}>
          <Text style={S.headerEyebrow}>Obecnosc brygad</Text>
          <Text style={S.headerTitle}>{t('crewAtt.title')}</Text>
          <Text style={S.headerSub}>Dzienna gotowosc ekip przed planowaniem prac.</Text>
        </View>
      </View>
      <View style={S.statsRow}>
        <View style={S.statCard}>
          <Ionicons name="calendar-outline" size={17} color={theme.accent} />
          <Text style={S.statValue}>{dateYmd.slice(5)}</Text>
          <Text style={S.statLabel}>Data</Text>
        </View>
        <View style={S.statCard}>
          <Ionicons name="checkmark-circle-outline" size={17} color={theme.success} />
          <Text style={S.statValue}>{confirmedCount}</Text>
          <Text style={S.statLabel}>Gotowe</Text>
        </View>
        <View style={[S.statCard, absentCount > 0 && { borderColor: theme.warning + '66' }]}>
          <Ionicons name="alert-circle-outline" size={17} color={absentCount > 0 ? theme.warning : theme.success} />
          <Text style={S.statValue}>{absentCount}</Text>
          <Text style={S.statLabel}>Braki</Text>
        </View>
      </View>
      <ScrollView style={S.scroll} contentContainerStyle={S.pad}>
        <Text style={S.hint}>{t('crewAtt.hint')}</Text>
        <Text style={S.lbl}>{t('crewAtt.date')}</Text>
        <TextInput style={S.inp} value={dateYmd} onChangeText={setDateYmd} />
        {!token ? <Text style={S.warn}>{t('crewAtt.noToken')}</Text> : null}
        {ekipy.map((e) => {
          const row = byTeam.get(String(e.id));
          const present = row?.present ?? true;
          return (
            <View key={e.id} style={[S.card, !present && { borderColor: theme.warning }]}>
              <View style={S.row}>
                <View style={S.teamBox}>
                  <View style={[S.teamIcon, { backgroundColor: present ? theme.successBg : theme.warningBg, borderColor: present ? theme.success : theme.warning }]}>
                    <Ionicons name={present ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={18} color={present ? theme.success : theme.warning} />
                  </View>
                  <Text style={S.team}>{e.nazwa}</Text>
                </View>
                <View style={S.swRow}>
                  <Text style={S.swLbl}>{t('crewAtt.present')}</Text>
                  <Switch
                    value={present}
                    onValueChange={(v) => void toggle(e, v)}
                    trackColor={{ true: theme.successBg, false: theme.warningBg }}
                    thumbColor={present ? theme.success : theme.warning}
                  />
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
    header: {
      backgroundColor: theme.cardBg,
      marginHorizontal: 14,
      marginTop: 12,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingTop: 18,
      paddingBottom: 16,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      ...shadowStyle(theme, {
        opacity: theme.shadowOpacity * 0.14,
        radius: theme.shadowRadius * 0.45,
        offsetY: 3,
        elevation: theme.cardElevation + 1,
      }),
    },
    backBtn: {
      width: 42,
      height: 42,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accentLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTextBox: { flex: 1, minWidth: 0 },
    headerEyebrow: {
      color: theme.textMuted,
      fontSize: 10,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0,
    },
    headerTitle: { color: theme.text, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 2 },
    headerSub: { color: theme.textSub, fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 2 },
    statsRow: {
      flexDirection: 'row',
      marginHorizontal: 14,
      marginBottom: 8,
      gap: 8,
    },
    statCard: {
      flex: 1,
      minHeight: 74,
      backgroundColor: theme.cardBg,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.cardBorder,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    statValue: { color: theme.text, fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
    statLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '800', textAlign: 'center' },
    scroll: { flex: 1 },
    pad: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 40 },
    hint: { fontSize: 13, color: theme.textMuted, marginBottom: 12, fontWeight: '700', lineHeight: 18 },
    lbl: { fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: '800' },
    inp: {
      borderWidth: 1,
      borderColor: theme.inputBorder,
      borderRadius: 14,
      padding: 12,
      marginBottom: 12,
      color: theme.text,
      backgroundColor: theme.inputBg,
      fontWeight: '700',
    },
    warn: { color: theme.warning, marginBottom: 12, fontSize: 13, fontWeight: '800' },
    card: {
      borderWidth: 1,
      borderColor: theme.cardBorder,
      backgroundColor: theme.cardBg,
      borderRadius: 18,
      padding: 14,
      marginBottom: 10,
      ...shadowStyle(theme, {
        opacity: theme.shadowOpacity * 0.08,
        radius: theme.shadowRadius * 0.28,
        offsetY: 1,
        elevation: Math.max(1, theme.cardElevation - 1),
      }),
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 },
    teamBox: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
    teamIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    team: { fontSize: 15, fontWeight: '900', color: theme.text, flex: 1 },
    swRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    swLbl: { fontSize: 12, color: theme.textMuted, fontWeight: '800' },
    empty: { color: theme.textMuted, fontSize: 14, fontWeight: '800' },
  });
}
