import { onBeforeUnmount, ref } from 'vue'
import { logout } from '../aws/auth'
import { describeError } from '../lib/api'
import {
  currentUserId,
  onAuthEvent,
  readSession,
  type AuthEvent,
  type AuthSession,
} from '../lib/authSession'
import { isBackendConfigured, isUnauthorizedError, setSessionExpiredHandler } from '../lib/backend'

/**
 * ผลของการเจอ error ที่อาจเกี่ยวกับ token
 * - unrelated: ไม่ใช่เรื่อง auth ให้ caller แสดง error ตามปกติ
 * - refreshed: ต่ออายุ token ได้แล้ว caller ควรลองทำงานเดิมซ้ำ
 * - expired: หลุดออกจากระบบแล้ว caller ไม่ต้องแสดง error อะไรเพิ่ม
 */
export type AuthErrorOutcome = 'unrelated' | 'refreshed' | 'expired'

export type HandleAuthError = (error: unknown) => Promise<AuthErrorOutcome>

export interface UseAuthOptions {
  onMessage: (message: string) => void
  onError: (message: string) => void
  /** มี session พร้อมใช้แล้ว: โหลดข้อมูลของผู้ใช้คนนี้ */
  onSessionActive: () => Promise<void> | void
  /** ไม่มี session หรือเปลี่ยนคน: ล้าง state ของคนก่อนหน้าให้หมด */
  onSessionCleared: () => void
  /** เข้าสู่ระบบสำเร็จ ใช้ปิดโหมดดูตัวอย่าง */
  onSignedIn?: () => void
  rememberReturnLocation: () => void
  restoreReturnLocation: () => void
  clearReturnLocation: () => void
}

/**
 * session ของ Cognito (ผ่าน Amplify)
 *
 * Amplify ต่ออายุ access token ให้เองทุกครั้งที่ขอ token และ aws/client.ts
 * ลอง refresh อีกรอบเมื่อเจอ 401 ถ้ายังไม่ได้จะเรียก session-expired handler
 * ที่ลงทะเบียนไว้ที่นี่ ผู้ใช้จึงหลุดเฉพาะตอนที่ refresh token หมดอายุจริง ๆ
 */
export const useAuth = (options: UseAuthOptions) => {
  const session = ref<AuthSession | null>(null)
  /** ยังไม่รู้สถานะล็อกอิน = ห้ามวาดหน้าจอไหนเลย ไม่งั้นจะเห็นหน้า login แวบหนึ่ง */
  const authReady = ref(!isBackendConfigured)
  const authError = ref('')
  /** true เมื่อถูกเด้งออกเพราะ token หมดอายุ ไม่ใช่เพราะกดออกจากระบบเอง */
  const sessionExpired = ref(false)
  const signingOut = ref(false)
  /** true เมื่อบัญชีต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน (รหัสชั่วคราวจากผู้ดูแล) */
  const passwordRecovery = ref(false)

  const userId = () => session.value?.user.id ?? null

  const setSession = (next: AuthSession | null) => {
    session.value = next
    currentUserId.value = next?.user.id ?? null
  }

  const expire = async () => {
    if (!session.value) return
    options.rememberReturnLocation()
    sessionExpired.value = true
    options.onSessionCleared()
    setSession(null)
    // ล้าง token ในเครื่อง (ไม่ global เพราะ refresh token ใช้ไม่ได้อยู่แล้ว)
    await logout().catch(() => undefined)
  }

  /** aws/client.ts refresh ให้แล้วก่อนจะโยน 401 ออกมา ถึงตรงนี้คือหมดอายุจริง */
  const handleAuthError: HandleAuthError = async (error) => {
    if (!isUnauthorizedError(error)) return 'unrelated'
    await expire()
    return 'expired'
  }

  const handleEvent = (event: AuthEvent) => {
    if (event.type === 'newPasswordRequired') {
      passwordRecovery.value = true
      return
    }

    const previousUserId = session.value?.user.id
    const next = event.type === 'signedIn' ? event.session : null
    setSession(next)
    authError.value = ''

    if (!next) {
      options.onSessionCleared()
      return
    }

    passwordRecovery.value = false
    options.onSignedIn?.()
    if (next.user.id !== previousUserId) {
      options.onSessionCleared()
      void options.onSessionActive()
    }
    if (sessionExpired.value) {
      sessionExpired.value = false
      options.restoreReturnLocation()
    }
  }

  const unsubscribe = onAuthEvent(handleEvent)
  setSessionExpiredHandler(() => void expire())

  const initialize = async () => {
    if (!isBackendConfigured) {
      authReady.value = true
      return
    }

    authReady.value = false
    authError.value = ''
    try {
      const current = await readSession()
      setSession(current)
      if (current) await options.onSessionActive()
    } catch (error) {
      setSession(null)
      authError.value = describeError(error, 'ตรวจสอบสถานะการเข้าสู่ระบบไม่สำเร็จ')
    } finally {
      authReady.value = true
    }
  }

  const signOut = async () => {
    if (!isBackendConfigured || signingOut.value) return

    signingOut.value = true
    try {
      // global: เพิกถอน refresh token ที่ Cognito ด้วย (ทำไม่ได้ก็ล้างในเครื่อง)
      await logout()
      setSession(null)
      // ออกจากระบบเองไม่ใช่เซสชันหมดอายุ จึงไม่ต้องพากลับหน้าเดิมตอนล็อกอินใหม่
      sessionExpired.value = false
      passwordRecovery.value = false
      options.clearReturnLocation()
      options.onSessionCleared()
    } catch (error) {
      options.onError(`ออกจากระบบไม่สำเร็จ: ${describeError(error)}`)
    } finally {
      signingOut.value = false
    }
  }

  /** PasswordResetScreen ตั้งรหัสสำเร็จแล้ว และ publish session ให้แล้ว */
  const finishPasswordRecovery = () => {
    passwordRecovery.value = false
    options.onMessage('ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว ครั้งต่อไปใช้รหัสนี้เข้าสู่ระบบได้เลย')
  }

  const cancelPasswordRecovery = async () => {
    passwordRecovery.value = false
    // ยังไม่ได้ล็อกอินเต็มตัว: ล้างขั้นตอนค้างใน Amplify ทิ้ง
    await logout().catch(() => undefined)
    setSession(null)
  }

  onBeforeUnmount(() => {
    unsubscribe()
    setSessionExpiredHandler(null)
  })

  return {
    session,
    authReady,
    authError,
    sessionExpired,
    signingOut,
    passwordRecovery,
    userId,
    initialize,
    signOut,
    handleAuthError,
    finishPasswordRecovery,
    cancelPasswordRecovery,
  }
}
