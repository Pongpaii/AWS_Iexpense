import { ERROR_MESSAGES_TH, isApiError, type ErrorCode } from '@money-flow/shared'
import type { z } from 'zod'

/** error ฝั่ง client ที่ไม่ได้มาจาก server */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT' | 'OFFLINE' | 'BAD_RESPONSE'

const CLIENT_MESSAGES: Record<Exclude<ClientErrorCode, ErrorCode>, string> = {
  NETWORK: 'เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต',
  TIMEOUT: 'เซิร์ฟเวอร์ตอบช้าเกินไป กรุณาลองใหม่',
  OFFLINE: 'ขณะนี้ออฟไลน์',
  BAD_RESPONSE: 'ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง',
}

export class ApiClientError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number = 0,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }

  /** ปัญหาชั่วคราว: เก็บเข้า offline queue / ลองใหม่ภายหลังได้ */
  get transient(): boolean {
    return (
      this.code === 'NETWORK' ||
      this.code === 'TIMEOUT' ||
      this.code === 'OFFLINE' ||
      this.status === 429 ||
      this.status >= 500
    )
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message
  return ERROR_MESSAGES_TH.INTERNAL_ERROR
}

export interface ClientDeps {
  baseUrl: string
  getToken: (forceRefresh: boolean) => Promise<string | null>
  /** refresh token ล้มเหลว → ต้อง login ใหม่ */
  onSessionExpired: () => void
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  isOnline?: () => boolean
  timeoutMs?: number
  maxRetries?: number
}

export interface RequestOptions<S extends z.ZodType | undefined> {
  body?: unknown
  query?: Record<string, string | number | undefined>
  /** validate response ด้วย Zod (shared schema เดียวกับ server) */
  schema?: S
  /** false = ห้าม retry (เช่น ลบบัญชี) */
  retry?: boolean
  /** คืน text แทน JSON (เช่น CSV export) */
  text?: boolean
}

export type ApiClient = ReturnType<typeof createApiClient>

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * fetch wrapper:
 * - timeout 10s ต่อครั้ง
 * - retry แบบ exponential backoff + jitter เฉพาะ network error / timeout / 429 / 5xx
 * - 401 → refresh token แล้วลองใหม่ 1 ครั้ง; ยังไม่ได้ → onSessionExpired
 */
export function createApiClient(deps: ClientDeps) {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const sleep = deps.sleep ?? defaultSleep
  const random = deps.random ?? Math.random
  const isOnline = deps.isOnline ?? (() => navigator.onLine)
  const timeoutMs = deps.timeoutMs ?? 10_000
  const maxRetries = deps.maxRetries ?? 3

  function backoff(attempt: number, retryAfter: string | null): number {
    const header = retryAfter ? Number(retryAfter) * 1000 : NaN
    if (Number.isFinite(header) && header > 0) return Math.min(header, 10_000)
    const base = Math.min(300 * 2 ** attempt, 4_000)
    return base / 2 + random() * (base / 2) // "equal jitter"
  }

  async function once(method: string, url: string, token: string | null, body: unknown) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const headers: Record<string, string> = {}
      if (token) headers.authorization = `Bearer ${token}`
      if (body !== undefined) headers['content-type'] = 'application/json'
      return await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch (err) {
      if (ctrl.signal.aborted) throw new ApiClientError('TIMEOUT', CLIENT_MESSAGES.TIMEOUT)
      void err
      throw new ApiClientError('NETWORK', CLIENT_MESSAGES.NETWORK)
    } finally {
      clearTimeout(timer)
    }
  }

  async function toError(res: Response): Promise<ApiClientError> {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    if (isApiError(body)) return new ApiClientError(body.code, body.message, res.status)
    const code: ErrorCode =
      res.status === 401
        ? 'UNAUTHORIZED'
        : res.status === 403
          ? 'FORBIDDEN'
          : res.status === 404
            ? 'NOT_FOUND'
            : res.status === 429
              ? 'RATE_LIMITED'
              : res.status === 413
                ? 'PAYLOAD_TOO_LARGE'
                : res.status >= 500
                  ? 'INTERNAL_ERROR'
                  : 'VALIDATION_ERROR'
    return new ApiClientError(code, ERROR_MESSAGES_TH[code], res.status)
  }

  async function request<T = unknown, S extends z.ZodType | undefined = undefined>(
    method: string,
    path: string,
    opts: RequestOptions<S> = {},
  ): Promise<S extends z.ZodType ? z.output<S> : T> {
    if (!isOnline()) throw new ApiClientError('OFFLINE', CLIENT_MESSAGES.OFFLINE)

    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    const url = `${deps.baseUrl}${path}${qs.size ? `?${qs}` : ''}`
    const retries = opts.retry === false ? 0 : maxRetries

    let token = await deps.getToken(false)
    let refreshed = false
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await once(method, url, token, opts.body)
      } catch (err) {
        if (attempt < retries) {
          await sleep(backoff(attempt, null))
          continue
        }
        throw err
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true
        token = await deps.getToken(true)
        if (token) {
          attempt-- // refresh ไม่นับเป็น retry
          continue
        }
      }
      if (res.status === 401) {
        deps.onSessionExpired()
        throw new ApiClientError('UNAUTHORIZED', ERROR_MESSAGES_TH.UNAUTHORIZED, 401)
      }

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(backoff(attempt, res.headers.get('retry-after')))
          continue
        }
        throw await toError(res)
      }

      if (res.status === 204) return undefined as never
      if (opts.text) return (await res.text()) as never
      let data: unknown
      try {
        data = await res.json()
      } catch {
        throw new ApiClientError('BAD_RESPONSE', CLIENT_MESSAGES.BAD_RESPONSE, res.status)
      }
      if (!opts.schema) return data as never
      const parsed = opts.schema.safeParse(data)
      if (!parsed.success) {
        throw new ApiClientError('BAD_RESPONSE', CLIENT_MESSAGES.BAD_RESPONSE, res.status)
      }
      return parsed.data as never
    }
  }

  return { request }
}
