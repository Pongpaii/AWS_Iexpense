import { transactionSchema } from '@money-flow/shared'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientError, createApiClient, type ClientDeps } from '../client'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

function setup(
  responses: (Response | Error | (() => Promise<Response>))[],
  over: Partial<ClientDeps> = {},
) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next()
    return next
  })
  const sleeps: number[] = []
  const getToken = vi.fn(async (force: boolean) => (force ? 'fresh-token' : 'old-token'))
  const onSessionExpired = vi.fn()
  const client = createApiClient({
    baseUrl: 'https://api.example.com',
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    isOnline: () => true,
    getToken,
    onSessionExpired,
    ...over,
  })
  return { client, calls, sleeps, getToken, onSessionExpired, fetchMock }
}

describe('api client', () => {
  it('ส่ง Bearer token, JSON body และ query string', async () => {
    const { client, calls } = setup([json(200, { ok: true })])
    await client.request('POST', '/transactions', {
      body: { a: 1 },
      query: { limit: 50, from: '' },
    })
    expect(calls[0]!.url).toBe('https://api.example.com/transactions?limit=50')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer old-token')
    expect(headers['content-type']).toBe('application/json')
    expect(calls[0]!.init.body).toBe('{"a":1}')
  })

  it('retry แบบ exponential backoff เมื่อ 5xx แล้วสำเร็จ', async () => {
    const { client, sleeps, calls } = setup([json(503, {}), json(502, {}), json(200, { ok: 1 })])
    await expect(client.request('GET', '/x')).resolves.toEqual({ ok: 1 })
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([225, 450]) // equal jitter: base/2 + 0.5*base/2
  })

  it('retry เมื่อ 429 โดยเคารพ Retry-After', async () => {
    const { client, sleeps } = setup([json(429, {}, { 'retry-after': '2' }), json(200, {})])
    await client.request('GET', '/x')
    expect(sleeps).toEqual([2000])
  })

  it('retry เมื่อ network error', async () => {
    const { client, calls } = setup([new TypeError('Failed to fetch'), json(200, { ok: 1 })])
    await expect(client.request('GET', '/x')).resolves.toEqual({ ok: 1 })
    expect(calls).toHaveLength(2)
  })

  it('ไม่ retry 4xx และคืนข้อความไทยจาก server', async () => {
    const { client, calls } = setup([
      json(400, { code: 'VALIDATION_ERROR', message: 'จำนวนเงินต้องมากกว่า 0' }),
    ])
    const err = await client.request('POST', '/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiClientError)
    expect(err).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'จำนวนเงินต้องมากกว่า 0',
      status: 400,
    })
    expect(calls).toHaveLength(1)
  })

  it('5xx เกินจำนวน retry → error ภาษาไทย (transient)', async () => {
    const { client, calls } = setup([json(500, {}), json(500, {}), json(500, {}), json(500, {})])
    const err = (await client.request('GET', '/x').catch((e: unknown) => e)) as ApiClientError
    expect(calls).toHaveLength(4) // 1 + 3 retries
    expect(err.code).toBe('INTERNAL_ERROR')
    expect(err.transient).toBe(true)
  })

  it('retry:false → ไม่ลองซ้ำ (เช่น ลบบัญชี)', async () => {
    const { client, calls } = setup([json(500, {})])
    await expect(client.request('DELETE', '/account', { retry: false })).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it('timeout 10 วินาที → TIMEOUT', async () => {
    vi.useFakeTimers()
    const never = () =>
      new Promise<Response>((_, reject) => {
        // จำลอง fetch ที่ abort ได้
        setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 10_000)
      })
    const { client } = setup([never], { maxRetries: 0 })
    const p = client.request('GET', '/slow').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toMatchObject({ code: 'TIMEOUT' })
    vi.useRealTimers()
  })

  it('401 → refresh token แล้วลองใหม่ด้วย token ใหม่', async () => {
    const { client, calls, getToken, onSessionExpired } = setup([
      json(401, {}),
      json(200, { ok: 1 }),
    ])
    await expect(client.request('GET', '/x')).resolves.toEqual({ ok: 1 })
    expect(getToken).toHaveBeenLastCalledWith(true)
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer fresh-token',
    )
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('refresh ไม่สำเร็จ → onSessionExpired (ให้ login ใหม่)', async () => {
    const { client, onSessionExpired } = setup([json(401, {})], {
      getToken: async (force) => (force ? null : 'old'),
    })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('401 ซ้ำหลัง refresh → onSessionExpired', async () => {
    const { client, onSessionExpired } = setup([json(401, {}), json(401, {})])
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ status: 401 })
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('ออฟไลน์ → OFFLINE ทันทีโดยไม่เรียก fetch', async () => {
    const { client, fetchMock } = setup([], { isOnline: () => false })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validate response ด้วย Zod schema; รูปแบบผิด → BAD_RESPONSE', async () => {
    const { client } = setup([json(200, { id: 'nope' })])
    await expect(client.request('GET', '/x', { schema: transactionSchema })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    })
  })

  it('204 → undefined', async () => {
    const { client } = setup([new Response(null, { status: 204 })])
    await expect(client.request('DELETE', '/x')).resolves.toBeUndefined()
  })
})
