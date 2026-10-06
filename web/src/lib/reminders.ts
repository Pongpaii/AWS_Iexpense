import { Capacitor } from '@capacitor/core';

/**
 * แจ้งเตือนรายวันด้วย Capacitor Local Notifications (ทำงานในเครื่อง ไม่ใช้ SNS / ไม่มีค่าใช้จ่าย)
 * บนเว็บ/PWA ตั้งเวลาล่วงหน้าไม่ได้ → แจ้งผู้ใช้ว่าใช้ได้บนแอป Android
 */
const REMINDER_ID = 1001;

export const remindersSupported = () => Capacitor.isNativePlatform();

export type ReminderResult = 'scheduled' | 'cancelled' | 'denied' | 'unsupported';

export async function applyDailyReminder(r: {
  enabled: boolean;
  time: string;
}): Promise<ReminderResult> {
  if (!remindersSupported()) return 'unsupported';
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => undefined);
  if (!r.enabled) return 'cancelled';

  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return 'denied';

  const [hour, minute] = r.time.split(':').map(Number) as [number, number];
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title: 'Money Flow',
        body: 'อย่าลืมบันทึกรายรับรายจ่ายของวันนี้นะ 📒',
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
      },
    ],
  });
  return 'scheduled';
}
