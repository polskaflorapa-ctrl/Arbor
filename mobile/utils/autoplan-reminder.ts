import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Kanał Android — musi być zarejestrowany w `app/_layout.tsx` jako `autoplan`. */
export const AUTOPLAN_ANDROID_CHANNEL_ID = 'autoplan';

const REMINDER_ID_KEY = 'autoplan_daily_reminder_id_v1';
const REMINDER_TIME_KEY = 'autoplan_reminder_time_v1';

export const DEFAULT_REMINDER_HOUR = 17;
export const DEFAULT_REMINDER_MINUTE = 30;

export type ReminderTime = { hour: number; minute: number };

export const getAutoplanReminderTime = async (): Promise<ReminderTime> => {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_TIME_KEY);
    if (!raw) return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
    const parsed = JSON.parse(raw) as Partial<ReminderTime>;
    const hour = Number(parsed.hour);
    const minute = Number(parsed.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
    }
    const h = Math.min(23, Math.max(0, Math.floor(hour)));
    const m = Math.min(59, Math.max(0, Math.floor(minute)));
    return { hour: h, minute: m };
  } catch {
    return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
  }
};

export const setAutoplanReminderTime = async (hour: number, minute: number): Promise<ReminderTime> => {
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const m = Math.min(59, Math.max(0, Math.floor(minute)));
  const t: ReminderTime = { hour: h, minute: m };
  await AsyncStorage.setItem(REMINDER_TIME_KEY, JSON.stringify(t));
  return t;
};

export const scheduleAutoplanDailyReminder = async (hour?: number, minute?: number): Promise<string> => {
  const stored = await getAutoplanReminderTime();
  const h = hour ?? stored.hour;
  const mi = minute ?? stored.minute;

  const existingId = await AsyncStorage.getItem(REMINDER_ID_KEY);
  if (existingId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existingId);
    } catch {
      // Ignore stale id.
    }
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Autoplan: brief dzienny',
      body: 'Czas wyslac raport dzienny i brief zarzadowy.',
      data: { screen: '/autoplan-dnia', type: 'autoplan_daily_brief' },
      ...(Platform.OS === 'android'
        ? { android: { channelId: AUTOPLAN_ANDROID_CHANNEL_ID } }
        : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: h,
      minute: mi,
      repeats: true,
    } as Notifications.DailyTriggerInput,
  });

  await AsyncStorage.setItem(REMINDER_ID_KEY, id);
  return id;
};

export const cancelAutoplanDailyReminder = async (): Promise<void> => {
  const existingId = await AsyncStorage.getItem(REMINDER_ID_KEY);
  if (existingId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existingId);
    } catch {
      // Ignore stale id.
    }
  }
  await AsyncStorage.removeItem(REMINDER_ID_KEY);
};

export const hasAutoplanDailyReminder = async (): Promise<boolean> => {
  const id = await AsyncStorage.getItem(REMINDER_ID_KEY);
  return Boolean(id);
};
