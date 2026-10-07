import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeError,
  isAuthExpiredError,
  isOffline,
  isRetryableError,
  OfflineError,
  TimeoutError,
  withRetry,
} from '../api'

/** ควบคุม navigator.onLine ระหว่างเทสต์ */
const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true, writable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isOffline', () => {
  it('เป็น true เฉพาะเมื่อ navigator บอกว่าออฟไลน์', () => {
    setOnline(false)
    expect(isOffline()).toBe(true)

    setOnline(true)
    expect(isOffline()).toBe(false)
  })
})

describe('isRetryableError', () => {
  it('ลองใหม่เมื่อหมดเวลารอ', () => {
    expect(isRetryableError(new TimeoutError('test'))).toBe(true)
  })

  it('ไม่ลองใหม่เมื่อออฟไลน์ (ต้องรอเน็ตกลับมาก่อน)', () => {
    expect(isRetryableError(new OfflineError())).toBe(false)
  })

  it('ไม่ลองใหม่เมื่อถูกยกเลิก', () => {
    expect(isRetryableError(new DOMException('Aborted', 'AbortError'))).toBe(false)
  })

  it.each([500, 502, 503, 599, 429])('ลองใหม่เมื่อ status %i', (status) => {
    expect(isRetryableError({ status })).toBe(true)
  })

  it.each([400, 401, 403, 404, 409, 422])('ไม่ลองใหม่เมื่อ status %i', (status) => {
    expect(isRetryableError({ status })).toBe(false)
  })

  it.each(['40001', '40P01', '53300', '57014', '08006'])(
    'ลองใหม่เมื่อเจอ Postgres code ชั่วคราว %s',
    (code) => {
      expect(isRetryableError({ code })).toBe(true)
    },
  )

  it.each(['23514', '23505', '42501'])('ไม่ลองใหม่เมื่อข้อมูล/สิทธิ์ผิด %s', (code) => {
    expect(isRetryableError({ code })).toBe(false)
  })

  it('ลองใหม่เมื่อข้อความบอกว่าเป็นปัญหาเครือข่าย', () => {
    expect(isRetryableError(new Error('Failed to fetch'))).toBe(true)
    expect(isRetryableError(new Error('NetworkError when attempting to fetch'))).toBe(true)
  })

  it('ลองใหม่เมื่อเป็น TypeError จาก fetch ที่ยิงไม่ออก', () => {
    expect(isRetryableError(new TypeError('boom'))).toBe(true)
  })

  it('ไม่ลองใหม่เมื่อไม่มี error', () => {
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
  })
})

describe('isAuthExpiredError', () => {
  it.each([
    { status: 401 },
    { code: 'PGRST301' },
    { code: '42501' },
    new Error('JWT expired'),
    new Error('Invalid Refresh Token'),
    new Error('Auth session missing!'),
  ])('รู้ว่าเป็นปัญหาเซสชัน: %o', (error) => {
    expect(isAuthExpiredError(error)).toBe(true)
  })

  it.each([{ status: 500 }, { code: '23514' }, new Error('อะไรก็ไม่รู้')])(
    'ไม่ใช่ปัญหาเซสชัน: %o',
    (error) => {
      expect(isAuthExpiredError(error)).toBe(false)
    },
  )
})

describe('describeError', () => {
  it('บอกผู้ใช้ว่าออฟไลน์และจะซิงก์ให้ทีหลัง', () => {
    expect(describeError(new OfflineError())).toContain('ออฟไลน์')
  })

  it('บอกว่าเชื่อมต่อช้าเมื่อหมดเวลารอ', () => {
    expect(describeError(new TimeoutError())).toContain('ช้า')
  })

  it('บอกให้รอเมื่อถูก rate limit', () => {
    expect(describeError({ status: 429 })).toContain('ถี่')
  })

  it('บอกว่าเป็นปัญหาฝั่งเซิร์ฟเวอร์เมื่อเป็น 5xx', () => {
    expect(describeError({ status: 503 })).toContain('เซิร์ฟเวอร์')
  })

  it('บอกให้เข้าสู่ระบบใหม่เมื่อไม่มีสิทธิ์', () => {
    expect(describeError({ code: '42501' })).toContain('สิทธิ์')
  })

  it('ใช้ข้อความสำรองเมื่อไม่มี error', () => {
    expect(describeError(null, 'สำรอง')).toBe('สำรอง')
  })

  it('ส่งต่อข้อความของ error ที่ไม่รู้จัก', () => {
    expect(describeError(new Error('รายละเอียดเฉพาะ'))).toBe('รายละเอียดเฉพาะ')
  })
})

describe('withRetry', () => {
  it('คืนผลลัพธ์ทันทีเมื่อสำเร็จรอบแรก', async () => {
    const operation = vi.fn().mockResolvedValue({ data: ['ok'], error: null })

    const result = await withRetry(operation)

    expect(result).toEqual({ data: ['ok'], error: null })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('ไม่ยิงเลยเมื่อออฟไลน์ และคืน OfflineError', async () => {
    setOnline(false)
    const operation = vi.fn()

    const result = await withRetry(operation)

    expect(operation).not.toHaveBeenCalled()
    expect(result.error).toBeInstanceOf(OfflineError)
  })

  it('ลองใหม่จนสำเร็จเมื่อ error เป็นแบบชั่วคราว', async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValueOnce({ data: 'สำเร็จ', error: null })

    const pending = withRetry(operation, { retries: 3 })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(operation).toHaveBeenCalledTimes(3)
    expect(result.data).toBe('สำเร็จ')
    expect(result.error).toBeNull()
  })

  it('หยุดทันทีเมื่อ error เป็นแบบที่ลองใหม่ก็ไม่ช่วย', async () => {
    const operation = vi.fn().mockResolvedValue({ data: null, error: { status: 400 } })

    const pending = withRetry(operation, { retries: 3 })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(operation).toHaveBeenCalledTimes(1)
    expect(result.error).toEqual({ status: 400 })
  })

  it('เลิกลองหลังครบจำนวนครั้งแล้วคืน error สุดท้าย', async () => {
    const operation = vi.fn().mockResolvedValue({ data: null, error: { status: 500 } })

    const pending = withRetry(operation, { retries: 2 })
    await vi.runAllTimersAsync()
    const result = await pending

    // ครั้งแรก + ลองใหม่ 2 ครั้ง
    expect(operation).toHaveBeenCalledTimes(3)
    expect(result.error).toEqual({ status: 500 })
  })

  it('คืน TimeoutError เมื่อ operation ค้างเกินเวลาที่กำหนด', async () => {
    const operation = vi.fn(() => new Promise<never>(() => {}))

    const pending = withRetry(operation, { retries: 0, timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_500)
    const result = await pending

    expect(result.error).toBeInstanceOf(TimeoutError)
  })

  it('จับ error ที่ operation throw ออกมา ไม่ปล่อยให้หลุดขึ้นไป', async () => {
    const operation = vi.fn().mockRejectedValue({ status: 403 })

    const pending = withRetry(operation, { retries: 1 })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.error).toEqual({ status: 403 })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('หยุดลองใหม่ทันทีถ้าเน็ตหลุดระหว่างรอ backoff', async () => {
    const operation = vi.fn().mockImplementation(() => {
      setOnline(false)
      return Promise.resolve({ data: null, error: { status: 500 } })
    })

    const pending = withRetry(operation, { retries: 3 })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(operation).toHaveBeenCalledTimes(1)
    expect(result.error).toBeInstanceOf(OfflineError)
  })

  it('เรียก operation ใหม่ทุกครั้ง (Supabase query builder ใช้ซ้ำไม่ได้)', async () => {
    let created = 0
    const operation = vi.fn(() => {
      created += 1
      return Promise.resolve({ data: null, error: { status: 500 } })
    })

    const pending = withRetry(operation, { retries: 2 })
    await vi.runAllTimersAsync()
    await pending

    expect(created).toBe(3)
  })

  it('ยกเลิกได้ผ่าน AbortSignal', async () => {
    const controller = new AbortController()
    const operation = vi.fn().mockResolvedValue({ data: null, error: { status: 500 } })

    const pending = withRetry(operation, { retries: 3, signal: controller.signal })
    controller.abort()
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.error).toBeInstanceOf(DOMException)
  })
})
