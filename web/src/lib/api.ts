/**
 * เครื่องมือเรื่องเครือข่ายที่หน้าจอใช้ร่วมกัน (ตรวจออฟไลน์, ข้อความ error ภาษาไทย, retry)
 *
 * การเรียก AWS API จริงมี timeout/retry ใน aws/client.ts อยู่แล้ว ไฟล์นี้คงไว้ให้ส่วนที่เหลือใช้ร่วมกัน
 * withRetry ใช้กับงานอื่นที่ไม่ผ่าน client นั้น เดิมเขียนไว้เพราะ fetch จะรอไปเรื่อย ๆ ถ้าเน็ตค้าง
 * ผู้ใช้จะเห็นสปินเนอร์หมุนไม่จบและไม่รู้ว่าต้องทำอะไร ไฟล์นี้ใส่ timeout
 * และ retry เฉพาะ error ที่ retry แล้วมีโอกาสสำเร็จจริง
 */

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_MAX_RETRIES = 3

export interface ApiResult<T> {
  data: T | null
  error: unknown
}

export interface WithRetryOptions {
  /** จำนวนครั้งที่ *ลองใหม่* (ไม่รวมครั้งแรก) */
  retries?: number
  timeoutMs?: number
  /** ตั้งชื่อไว้เพื่อให้ log อ่านรู้เรื่องเวลาไล่ปัญหา */
  label?: string
  signal?: AbortSignal
}

export class TimeoutError extends Error {
  constructor(label = 'request') {
    super(`หมดเวลารอการเชื่อมต่อ (${label})`)
    this.name = 'TimeoutError'
  }
}

export class OfflineError extends Error {
  constructor() {
    super('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')
    this.name = 'OfflineError'
  }
}

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const readCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return ''
  const candidate = error as { code?: unknown; status?: unknown }
  if (typeof candidate.code === 'string') return candidate.code
  if (typeof candidate.code === 'number') return String(candidate.code)
  if (typeof candidate.status === 'number') return String(candidate.status)
  return ''
}

const readMessage = (error: unknown): string => {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown }
    if (typeof message === 'string') return message
  }
  return ''
}

const readStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null
  const { status } = error as { status?: unknown }
  return typeof status === 'number' ? status : null
}

/**
 * Postgres/PostgREST codes ที่เกิดจากปัญหาชั่วคราว ไม่ใช่ข้อมูลผิด
 * 40001/40P01 = serialization/deadlock, 57014 = statement timeout,
 * 08xxx = connection problem, 53300 = too many connections
 */
const RETRYABLE_PG_CODES = new Set([
  '40001',
  '40P01',
  '53300',
  '57014',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
])

const NETWORK_MESSAGE_HINTS = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'connection closed',
  'econnreset',
  'etimedout',
  'socket hang up',
]

/** true = ลองใหม่มีโอกาสสำเร็จ, false = ข้อมูล/สิทธิ์ผิด ลองใหม่กี่ครั้งก็เหมือนเดิม */
export const isRetryableError = (error: unknown): boolean => {
  if (!error) return false
  if (error instanceof TimeoutError) return true
  if (error instanceof OfflineError) return false
  if (error instanceof DOMException && error.name === 'AbortError') return false

  const code = readCode(error)
  if (RETRYABLE_PG_CODES.has(code)) return true

  const status = readStatus(error)
  if (status === 429) return true
  if (status !== null && status >= 500 && status <= 599) return true
  // 4xx อื่น ๆ คือ client ผิดเอง ไม่ต้อง retry
  if (status !== null && status >= 400 && status < 500) return false

  const message = readMessage(error).toLowerCase()
  if (NETWORK_MESSAGE_HINTS.some((hint) => message.includes(hint))) return true

  // TypeError จาก fetch ที่ยิงไม่ออกเลย
  if (error instanceof TypeError) return true

  return false
}

/** ข้อความภาษาไทยสำหรับโชว์ผู้ใช้ ไม่โยน stack trace ใส่หน้าจอ */
export const describeError = (
  error: unknown,
  fallback = 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง',
): string => {
  if (!error) return fallback
  if (error instanceof OfflineError) return 'ออฟไลน์อยู่ ระบบจะซิงก์ให้เมื่อกลับมาออนไลน์'
  if (error instanceof TimeoutError) return 'เชื่อมต่อช้าเกินไป กรุณาลองอีกครั้ง'
  // ApiClientError จาก aws/client.ts: ข้อความเป็นภาษาไทยที่เซิร์ฟเวอร์/ไคลเอนต์ตั้งไว้แล้ว
  if (error instanceof Error && error.name === 'ApiClientError' && error.message)
    return error.message

  const status = readStatus(error)
  if (status === 429) return 'ส่งคำขอถี่เกินไป รอสักครู่แล้วลองอีกครั้ง'
  if (status !== null && status >= 500) return 'เซิร์ฟเวอร์มีปัญหาชั่วคราว กรุณาลองอีกครั้ง'

  const code = readCode(error)
  if (code === '42501') return 'ไม่มีสิทธิ์ทำรายการนี้ กรุณาเข้าสู่ระบบใหม่'
  if (code === '23505' || code === '23514')
    return 'ข้อมูลไม่ถูกต้องตามเงื่อนไข กรุณาตรวจสอบอีกครั้ง'
  if (code === 'PGRST301' || code === '401') return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'

  const message = readMessage(error).toLowerCase()
  if (NETWORK_MESSAGE_HINTS.some((hint) => message.includes(hint))) {
    return 'เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'
  }

  return readMessage(error) || fallback
}

/** true เมื่อ error บอกว่า token ใช้ไม่ได้แล้ว ต้องให้ผู้ใช้ล็อกอินใหม่ */
export const isAuthExpiredError = (error: unknown): boolean => {
  const status = readStatus(error)
  const code = readCode(error)
  const message = readMessage(error).toLowerCase()

  if (status === 401) return true
  if (code === 'PGRST301' || code === '42501') return true

  return (
    message.includes('jwt expired') ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('session missing') ||
    message.includes('token is expired')
  )
}

/**
 * เรียก operation พร้อม timeout และ retry แบบ exponential backoff + jitter
 *
 * operation ต้องสร้าง promise ใหม่ทุกครั้งที่ถูกเรียก (ส่ง arrow function เข้ามา)
 * เพราะ promise ใช้ซ้ำไม่ได้
 */
export async function withRetry<T>(
  operation: () => PromiseLike<ApiResult<T>>,
  options: WithRetryOptions = {},
): Promise<ApiResult<T>> {
  const {
    retries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    label = 'request',
    signal,
  } = options

  if (isOffline()) {
    return { data: null, error: new OfflineError() }
  }

  let lastError: unknown = new Error('ไม่สามารถทำรายการได้')

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      return { data: null, error: new DOMException('Aborted', 'AbortError') }
    }

    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await Promise.race([
        Promise.resolve(operation()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TimeoutError(label)), timeoutMs)
        }),
      ])

      if (!result.error) return result

      lastError = result.error
      if (!isRetryableError(result.error) || attempt === retries) return result
    } catch (thrown) {
      lastError = thrown
      if (!isRetryableError(thrown) || attempt === retries) {
        return { data: null, error: thrown }
      }
    } finally {
      clearTimeout(timer)
    }

    // 1s, 2s, 4s ... บวก jitter กันหลาย client ยิงพร้อมกันหลังเน็ตกลับมา
    const backoff = 1000 * 2 ** attempt
    const jitter = Math.random() * 250

    try {
      await sleep(backoff + jitter, signal)
    } catch {
      return { data: null, error: new DOMException('Aborted', 'AbortError') }
    }

    if (isOffline()) {
      return { data: null, error: new OfflineError() }
    }
  }

  return { data: null, error: lastError }
}
