import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { readonly, ref } from 'vue'

export const DEFAULT_REMINDER_TIME = '21:00'

const REMINDER_ENABLED_STORAGE_KEY = 'money-flow.daily-reminder-enabled.v1'
const REMINDER_TIME_STORAGE_KEY = 'money-flow.daily-reminder-time.v1'
const REMINDER_NOTIFICATION_ID = 2100
const REMINDER_CHANNEL_ID = 'money-flow-daily-reminder'
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

const loadBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

const loadTime = () => {
  if (typeof window === 'undefined') return DEFAULT_REMINDER_TIME
  try {
    const value = window.localStorage.getItem(REMINDER_TIME_STORAGE_KEY)
    return value && TIME_PATTERN.test(value) ? value : DEFAULT_REMINDER_TIME
  } catch {
    return DEFAULT_REMINDER_TIME
  }
}

const reminderEnabled = ref(loadBoolean(REMINDER_ENABLED_STORAGE_KEY, false))
const reminderTime = ref(loadTime())
const reminderBusy = ref(false)
const isNativeReminderSupported = Capacitor.isNativePlatform()

export type ReminderUpdateResult =
  | { ok: true; persisted: boolean }
  | { ok: false; reason: 'unsupported' | 'permission-denied' | 'invalid-time' | 'native-error' }

const persistPreferences = (enabled: boolean, time: string) => {
  try {
    window.localStorage.setItem(REMINDER_ENABLED_STORAGE_KEY, String(enabled))
    window.localStorage.setItem(REMINDER_TIME_STORAGE_KEY, time)
    return true
  } catch {
    return false
  }
}

const createAndroidChannel = async () => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return

  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL_ID,
    name: 'เตือนจดรายจ่ายประจำวัน',
    description: 'แจ้งเตือนจาก Money Flow ให้บันทึกรายรับรายจ่ายประจำวัน',
    importance: 3,
    vibration: true,
  })
}

const cancelScheduledReminder = async () => {
  if (!Capacitor.isNativePlatform()) return
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_NOTIFICATION_ID }] })
}

const scheduleReminder = async (time: string) => {
  if (!Capacitor.isNativePlatform()) return
  const match = TIME_PATTERN.exec(time)
  if (!match) throw new Error('Invalid reminder time')

  const hour = Number(match[1])
  const minute = Number(match[2])
  await createAndroidChannel()
  await cancelScheduledReminder()
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_NOTIFICATION_ID,
        title: 'วันนี้จดรายจ่ายหรือยัง?',
        body: 'เปิด Money Flow แล้วบันทึกรายรับรายจ่ายของวันนี้กันนะ',
        channelId: REMINDER_CHANNEL_ID,
        iconColor: '#c9f06c',
        schedule: {
          on: { hour, minute },
          allowWhileIdle: true,
        },
      },
    ],
  })
}

export const updateDailyReminder = async (
  enabled: boolean,
  time: string,
): Promise<ReminderUpdateResult> => {
  if (!TIME_PATTERN.test(time)) return { ok: false, reason: 'invalid-time' }
  if (!Capacitor.isNativePlatform()) return { ok: false, reason: 'unsupported' }

  reminderBusy.value = true
  try {
    if (enabled) {
      let permission = await LocalNotifications.checkPermissions()
      if (permission.display !== 'granted') {
        permission = await LocalNotifications.requestPermissions()
      }
      if (permission.display !== 'granted') {
        reminderEnabled.value = false
        persistPreferences(false, time)
        return { ok: false, reason: 'permission-denied' }
      }
      await scheduleReminder(time)
    } else {
      await cancelScheduledReminder()
    }

    reminderEnabled.value = enabled
    reminderTime.value = time
    return { ok: true, persisted: persistPreferences(enabled, time) }
  } catch (error) {
    console.error('อัปเดตการแจ้งเตือนไม่สำเร็จ', error)
    return { ok: false, reason: 'native-error' }
  } finally {
    reminderBusy.value = false
  }
}

export const initializeDailyReminder = async () => {
  if (!Capacitor.isNativePlatform() || !reminderEnabled.value || reminderBusy.value) return

  reminderBusy.value = true
  try {
    const permission = await LocalNotifications.checkPermissions()
    if (permission.display === 'granted') {
      await scheduleReminder(reminderTime.value)
    } else {
      reminderEnabled.value = false
      persistPreferences(false, reminderTime.value)
    }
  } catch (error) {
    console.error('เตรียมการแจ้งเตือนรายวันไม่สำเร็จ', error)
  } finally {
    reminderBusy.value = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === REMINDER_ENABLED_STORAGE_KEY && event.newValue !== null) {
      reminderEnabled.value = event.newValue === 'true'
    }
    if (
      event.key === REMINDER_TIME_STORAGE_KEY &&
      event.newValue &&
      TIME_PATTERN.test(event.newValue)
    ) {
      reminderTime.value = event.newValue
    }
  })
}

export const useDailyReminder = () => ({
  reminderEnabled: readonly(reminderEnabled),
  reminderTime: readonly(reminderTime),
  reminderBusy: readonly(reminderBusy),
  isNativeReminderSupported,
  initializeDailyReminder,
  updateDailyReminder,
})
