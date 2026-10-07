import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as BackendModule from '../../lib/backend'
import { withSetup } from '../../test-utils/withSetup'
import type { TransactionInput } from '../../types/transaction'

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly transient: boolean,
  ) {
    super(`HTTP ${status}`)
  }
}

const createTransaction = vi.fn(async (_body: unknown) => ({}))

vi.mock('../../lib/backend', async (importActual) => {
  const actual = await importActual<typeof BackendModule>()
  return {
    ...actual,
    api: { createTransaction },
    isTransientError: (error: unknown) => error instanceof FakeApiError && error.transient,
    errorStatus: (error: unknown) => (error instanceof FakeApiError ? error.status : 0),
  }
})

vi.mock('../../lib/api', () => ({
  describeError: (error: unknown) => String(error),
  isOffline: () => false,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}))

const { useOfflineQueue } = await import('../useOfflineQueue')

const makeInput = (description: string): TransactionInput => ({
  description,
  amount: 50,
  type: 'expense',
  category: 'อาหาร',
  transaction_date: '2026-03-15',
})

beforeEach(() => {
  localStorage.clear()
  createTransaction.mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('useOfflineQueue', () => {
  it('ส่ง queueId เดิมเป็น idempotencyKey', async () => {
    const { result, unmount } = withSetup(() => useOfflineQueue({ userId: () => 'user-1' }))
    result.enqueue(makeInput('กาแฟ'))
    const queueId = result.pending.value[0].queueId

    await result.flush()

    expect(createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'กาแฟ',
        transactionDate: '2026-03-15',
        idempotencyKey: queueId,
      }),
    )
    expect(result.pendingCount.value).toBe(0)
    unmount()
  })

  it('แถวที่รอซิงก์ใช้ id แบบ pending: เพื่อแยกจาก ULID ของจริง', () => {
    const { result, unmount } = withSetup(() => useOfflineQueue({ userId: () => 'user-1' }))
    result.enqueue(makeInput('กาแฟ'))

    expect(result.pendingTransactions.value[0].id).toBe(
      `pending:${result.pending.value[0].queueId}`,
    )
    unmount()
  })

  it('error ชั่วคราว: เก็บรายการไว้ในคิว ไม่ทิ้งข้อมูล', async () => {
    createTransaction.mockRejectedValueOnce(new FakeApiError(503, true))
    const onSynced = vi.fn()
    const { result, unmount } = withSetup(() =>
      useOfflineQueue({ userId: () => 'user-1', onSynced }),
    )
    result.enqueue(makeInput('รายการค้าง'))

    await result.flush()

    expect(result.pendingCount.value).toBe(1)
    expect(onSynced).not.toHaveBeenCalled()
    expect(result.lastError.value).not.toBe('')
    unmount()
  })

  it('เซิร์ฟเวอร์ปฏิเสธถาวร (400): นำออกจากคิวพร้อมแจ้งผู้ใช้', async () => {
    createTransaction.mockRejectedValueOnce(new FakeApiError(400, false))
    const { result, unmount } = withSetup(() => useOfflineQueue({ userId: () => 'user-1' }))
    result.enqueue(makeInput('ข้อมูลผิด'))

    await result.flush()

    expect(result.pendingCount.value).toBe(0)
    expect(result.lastError.value).toContain('ข้อมูลผิด')
    expect(JSON.parse(localStorage.getItem('moneyflow.offline-queue.v1') ?? '[]')).toEqual([])
    unmount()
  })

  it('หน่วง 200ms ระหว่างแต่ละรายการ', async () => {
    vi.useFakeTimers()
    const { result, unmount } = withSetup(() => useOfflineQueue({ userId: () => 'user-1' }))
    result.enqueue(makeInput('รายการแรก'))
    result.enqueue(makeInput('รายการที่สอง'))

    const flushing = result.flush()
    await Promise.resolve()
    expect(createTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(199)
    expect(createTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await flushing
    expect(createTransaction).toHaveBeenCalledTimes(2)
    unmount()
  })
})
