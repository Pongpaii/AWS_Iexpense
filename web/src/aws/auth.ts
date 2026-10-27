import { Amplify } from 'aws-amplify'
import {
  confirmResetPassword,
  confirmSignIn,
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth'
import type { AppConfig } from './config'

/**
 * ห่อ aws-amplify v6 (Auth module อย่างเดียว) — ไม่ใช้ Hosted UI
 * login ด้วย SRP: รหัสผ่านไม่ถูกส่งออกจากเครื่องตรง ๆ
 */
export function configureAuth(cfg: AppConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cfg.userPoolId,
        userPoolClientId: cfg.userPoolClientId,
        loginWith: { email: true },
      },
    },
  })
}

export type LoginStep = 'DONE' | 'NEW_PASSWORD_REQUIRED' | 'RESET_PASSWORD_REQUIRED'

export interface SessionInfo {
  sub: string
  email: string
}

export async function login(email: string, password: string): Promise<LoginStep> {
  // ถ้ามี session ค้าง (เช่น token หมดอายุ) Amplify จะไม่ยอม signIn ซ้ำ
  await signOut().catch(() => undefined)
  const res = await signIn({ username: email.trim().toLowerCase(), password })
  return mapStep(res.nextStep.signInStep)
}

/** ครั้งแรกที่ login ด้วยรหัสผ่านชั่วคราว: ตั้งรหัสผ่านใหม่ */
export async function completeNewPassword(newPassword: string): Promise<LoginStep> {
  const res = await confirmSignIn({ challengeResponse: newPassword })
  return mapStep(res.nextStep.signInStep)
}

function mapStep(step: string): LoginStep {
  if (step === 'DONE') return 'DONE'
  if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') return 'NEW_PASSWORD_REQUIRED'
  if (step === 'RESET_PASSWORD') return 'RESET_PASSWORD_REQUIRED'
  throw new Error(`ขั้นตอนเข้าสู่ระบบที่ไม่รองรับ: ${step}`)
}

export async function logout(): Promise<void> {
  // global: เพิกถอน refresh token ที่ Cognito ด้วย (token revocation เปิดไว้ใน AuthStack)
  await signOut({ global: true }).catch(() => signOut())
}

export type SignUpStep = 'CONFIRM_SIGN_UP' | 'DONE'

/**
 * สมัครสมาชิกเอง: Cognito สร้างบัญชีสถานะ UNCONFIRMED แล้วส่งรหัสยืนยันทางอีเมล
 * ต้อง confirmRegistration ก่อนจึงจะ login ได้
 */
export async function register(email: string, password: string): Promise<SignUpStep> {
  const username = email.trim().toLowerCase()
  const res = await signUp({
    username,
    password,
    options: { userAttributes: { email: username } },
  })
  return res.nextStep.signUpStep === 'CONFIRM_SIGN_UP' ? 'CONFIRM_SIGN_UP' : 'DONE'
}

export async function confirmRegistration(email: string, code: string): Promise<void> {
  await confirmSignUp({ username: email.trim().toLowerCase(), confirmationCode: code.trim() })
}

export async function resendRegistrationCode(email: string): Promise<void> {
  await resendSignUpCode({ username: email.trim().toLowerCase() })
}

export async function requestPasswordReset(email: string): Promise<void> {
  await resetPassword({ username: email.trim().toLowerCase() })
}

export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await confirmResetPassword({
    username: email.trim().toLowerCase(),
    confirmationCode: code.trim(),
    newPassword,
  })
}

/**
 * access token สำหรับเรียก API — Amplify refresh ให้อัตโนมัติเมื่อใกล้หมดอายุ
 * forceRefresh=true ใช้เมื่อ API ตอบ 401; คืน null ถ้า refresh ไม่ได้ (ต้อง login ใหม่)
 */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  try {
    const { tokens } = await fetchAuthSession({ forceRefresh })
    return tokens?.accessToken?.toString() ?? null
  } catch {
    return null
  }
}

export async function currentSession(): Promise<SessionInfo | null> {
  try {
    const { tokens } = await fetchAuthSession()
    const sub = tokens?.accessToken?.payload.sub
    const email = tokens?.idToken?.payload.email
    if (typeof sub !== 'string') return null
    return { sub, email: typeof email === 'string' ? email : '' }
  } catch {
    return null
  }
}

/** แปลง error ของ Cognito/Amplify เป็นข้อความภาษาไทย */
export function authErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? ''
  switch (name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
    case 'PasswordResetRequiredException':
      return 'ต้องตั้งรหัสผ่านใหม่ก่อน กรุณาใช้ "ลืมรหัสผ่าน"'
    case 'UserNotConfirmedException':
      return 'บัญชียังไม่ได้ยืนยันอีเมล กรุณากรอกรหัสยืนยันที่ส่งไปทางอีเมล'
    case 'UsernameExistsException':
      return 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือใช้ "ลืมรหัสผ่าน"'
    case 'InvalidParameterException':
      return 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีเมลและรหัสผ่าน'
    case 'CodeDeliveryFailureException':
      return 'ส่งอีเมลรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่ภายหลัง'
    case 'EmptySignUpUsername':
    case 'EmptyConfirmSignUpUsername':
    case 'EmptyResendSignUpCodeUsername':
      return 'กรุณากรอกอีเมล'
    case 'EmptySignUpPassword':
      return 'กรุณากรอกรหัสผ่าน'
    case 'EmptyConfirmSignUpCode':
      return 'กรุณากรอกรหัสยืนยัน'
    case 'InvalidPasswordException':
      return 'รหัสผ่านไม่ตรงตามเงื่อนไข (อย่างน้อย 6 ตัวอักษร)'
    case 'CodeMismatchException':
      return 'รหัสยืนยันไม่ถูกต้อง'
    case 'ExpiredCodeException':
      return 'รหัสยืนยันหมดอายุ กรุณาขอรหัสใหม่'
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'
    case 'NetworkError':
      return 'เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'
    case 'EmptySignInUsername':
    case 'EmptyResetPasswordUsername':
      return 'กรุณากรอกอีเมล'
    case 'EmptySignInPassword':
      return 'กรุณากรอกรหัสผ่าน'
    default:
      if (err instanceof TypeError) return 'เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'
      return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'
  }
}

/** เงื่อนไขรหัสผ่านให้ตรงกับ password policy ใน AuthStack */
export const PASSWORD_MIN_LENGTH = 6

export function passwordProblems(pw: string): string[] {
  const out: string[] = []
  if (pw.length < PASSWORD_MIN_LENGTH) out.push(`อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`)
  return out
}
