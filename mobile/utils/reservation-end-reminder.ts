import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_DEFAULT = 'default';

/** Jednorazowe przypomnienie tego samego dnia (np. 18:00) — koniec dnia rezerwacji sprzętu. */
export async function tryScheduleReservationDayEndReminder(opts: {
  dateYmd: string;
  sprzetLabel: string;
}): Promise<void> {
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') return;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.dateYmd);
  if (!m) return;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const when = new Date(y, mo - 1, d, 18, 0, 0, 0);
  if (when.getTime() <= Date.now() + 60_000) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Rezerwacja sprzętu',
      body: `${opts.sprzetLabel} — koniec dnia (${opts.dateYmd}).`,
      data: { screen: '/rezerwacje-sprzetu', type: 'reservation_day_end' },
      ...(Platform.OS === 'android' ? { android: { channelId: ANDROID_DEFAULT } } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
    } as Notifications.DateTriggerInput,
  });
}
