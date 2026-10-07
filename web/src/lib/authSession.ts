import { ref } from 'vue'
import { currentSession } from '../aws/auth'

/** ข้อมูล session ที่หน้าจอใช้ (เฉพาะส่วนที่หน้าจอใช้จริง) */
export interface AuthSession {
  user: { id: string; email: string }
}

export type AuthEvent =
  | { type: 'signedIn'; session: AuthSession }
  | { type: 'signedOut' }
  /** Cognito: บัญชีที่ผู้ดูแลสร้างให้ ต้องตั้งรหัสผ่านใหม่ก่อนใช้งานครั้งแรก */
  | { type: 'newPasswordRequired' }

type Listener = (event: AuthEvent) => void

const listeners = new Set<Listener>()

/** user ที่ล็อกอินอยู่ตอนนี้ ให้ composable ระดับโมดูล (เช่น งบรายหมวด) อ่านได้ */
export const currentUserId = ref<string | null>(null)

export const onAuthEvent = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const emitAuthEvent = (event: AuthEvent) => {
  for (const listener of [...listeners]) listener(event)
}

/** อ่าน session ปัจจุบันจาก Amplify (ไม่มี = null) */
export const readSession = async (): Promise<AuthSession | null> => {
  const info = await currentSession()
  return info ? { user: { id: info.sub, email: info.email } } : null
}

/** หลังล็อกอิน/ตั้งรหัสผ่านสำเร็จ: อ่าน session แล้วแจ้งทุกคนที่ฟังอยู่ */
export const publishSignedIn = async () => {
  const session = await readSession()
  if (session) emitAuthEvent({ type: 'signedIn', session })
  return session
}
