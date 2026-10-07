import { settingsToInput, type UserSettings } from '@money-flow/shared'
import { api } from './backend'

/**
 * แหล่งเดียวของการตั้งค่าบนเซิร์ฟเวอร์ (GET/PUT /settings)
 *
 * PUT ของ API แทนที่ทั้งก้อน แต่หน้าจอเดิมบันทึกทีละส่วน (เงินเดือน, งบรายวัน, งบรายหมวด)
 * จึงต้องถือค่าล่าสุดไว้แล้วแก้เฉพาะส่วนนั้น และเรียง PUT ให้ทำทีละคำขอ
 * ไม่งั้นสองคำขอที่ยิงพร้อมกันจะเขียนทับกันจนค่าของอีกฝ่ายหาย
 */

let current: UserSettings | null = null
let owner: string | null = null
let queue: Promise<unknown> = Promise.resolve()

export const getCachedSettings = () => current

/** ล้างเมื่อออกจากระบบ/สลับบัญชี */
export const resetSettingsStore = () => {
  current = null
  owner = null
  queue = Promise.resolve()
}

export async function fetchSettings(userId: string): Promise<UserSettings> {
  if (!api) throw new Error('backend not configured')
  const settings = await api.getSettings()
  current = settings
  owner = userId
  return settings
}

/**
 * แก้การตั้งค่าบางส่วนแล้ว PUT ทั้งก้อน — ทำต่อคิว และคืนค่าที่เซิร์ฟเวอร์บันทึกแล้ว
 * ถ้ายังไม่เคยโหลด (หรือเป็นของ user อื่น) จะ GET ก่อนเพื่อไม่ทับค่าอื่นด้วย default
 */
export function updateSettings(
  userId: string,
  patch: (settings: UserSettings) => UserSettings,
): Promise<UserSettings> {
  const run = async () => {
    if (!api) throw new Error('backend not configured')
    const base = current && owner === userId ? current : await fetchSettings(userId)
    const saved = await api.putSettings(settingsToInput(patch(base)))
    if (owner === userId) current = saved
    return saved
  }
  const next = queue.then(run, run)
  // คิวต้องเดินต่อแม้คำขอนี้ล้มเหลว
  queue = next.catch(() => undefined)
  return next
}
