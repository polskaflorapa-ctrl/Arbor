import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'crew_attendance_log_v1';
const MAX = 400;

export type AttendanceEntry = {
  id: string;
  dateYmd: string;
  teamId: string;
  teamName: string;
  present: boolean;
  note: string;
  actor: string;
  at: string;
};

export const loadAttendance = async (): Promise<AttendanceEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as AttendanceEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

export const upsertAttendance = async (entry: Omit<AttendanceEntry, 'id' | 'at'> & { id?: string }): Promise<void> => {
  const list = await loadAttendance();
  const id = entry.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const at = new Date().toISOString();
  const next: AttendanceEntry = {
    id,
    dateYmd: entry.dateYmd,
    teamId: entry.teamId,
    teamName: entry.teamName,
    present: entry.present,
    note: entry.note,
    actor: entry.actor,
    at,
  };
  const filtered = list.filter((e) => !(e.dateYmd === next.dateYmd && e.teamId === next.teamId));
  await AsyncStorage.setItem(KEY, JSON.stringify([next, ...filtered].slice(0, MAX)));
};

export const attendanceForDate = (list: AttendanceEntry[], dateYmd: string): AttendanceEntry[] =>
  list.filter((e) => e.dateYmd === dateYmd);
