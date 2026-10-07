import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type * as BackendModule from '../../lib/backend'
import { makeTransaction } from '../../test-utils/factories'
import type { TransactionInput } from '../../types/transaction'

const ULID = '01J9Z8X7W6V5T4S3R2Q1P0N9M8'

const apiTx = (overrides: Record<string, unknown> = {}) => ({
  id: ULID,
  description: 'กาแฟ',
  amount: 65,
  type: 'expense',
  category: 'อาหาร',
  transactionDate: '2026-03-15',
  clientTimezone: 'Asia/Bangkok',
  idempotencyKey: '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f',
  createdAt: '2026-03-15T05:00:00.000Z',
  updatedAt: '2026-03-15T05:00:00.000Z',
  deletedAt: null,
  ...overrides,
})

const pages: Array<{ items: unknown[]; nextCursor: string | null }> = []
const api = {
  listTransactions: vi.fn(async () => pages.shift() ?? { items: [], nextCursor: null }),
  createTransaction: vi.fn(async () => apiTx()),
  updateTransaction: vi.fn(async () => apiTx()),
  deleteTransaction: vi.fn(async () => apiTx()),
  restoreTransaction: vi.fn(async () => apiTx()),
  bulkDelete: vi.fn(async (ids: string[]) => ({ deleted: ids, notFound: [] })),
  balance: vi.fn(),
  monthly: vi.fn(),
}

class FakeApiError extends Error {
  constructor(
    readonly code: string,
    readonly transient: boolean,
  ) {
    super(code)
  }
}

vi.mock('../../lib/backend', async (importActual) => {
  const actual = await importActual<typeof BackendModule>()
  return {
    ...actual,
    api,
    isTransientError: (error: unknown) => error instanceof FakeApiError && error.transient,
    isOfflineError: (error: unknown) => error instanceof FakeApiError && error.code === 'OFFLINE',
  }
})

const offline = { value: false }
vi.mock('../../lib/api', () => ({
  describeError: (error: unknown) => String(error),
  isOffline: () => offline.value,
}))

const enqueue = vi.fn(() => true)
vi.mock('../useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    isOnline: ref(true),
    syncing: ref(false),
    lastError: ref(''),
    pendingCount: ref(0),
    pendingTransactions: ref([]),
    enqueue,
    flush: vi.fn(),
    clearForCurrentUser: vi.fn(),
  }),
}))

const { useTransactions } = await import('../useTransactions')

const input: TransactionInput = {
  description: 'กาแฟ',
  amount: 65,
  type: 'expense',
  category: 'อาหาร',
  transaction_date: '2026-03-15',
}

const createSubject = () => {
  const callbacks = {
    onMessage: vi.fn(),
    onError: vi.fn(),
    clearError: vi.fn(),
    handleAuthError: vi.fn().mockResolvedValue('unrelated'),
    onMutated: vi.fn().mockResolvedValue(undefined),
    onDeleted: vi.fn(),
    onBeforeBulkChange: vi.fn(),
  }
  const result = useTransactions({
    userId: () => 'user-1',
    isDemoMode: () => false,
    ...callbacks,
  })
  return { result, callbacks }
}

beforeEach(() => {
  pages.length = 0
  offline.value = false
  for (const fn of Object.values(api)) fn.mockClear()
  enqueue.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useTransactions', () => {
  it('ปฏิเสธการบันทึกซ้ำที่เร็วเกินไป และยอมให้บันทึกเมื่อครบ 1000ms', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))
    const { result, callbacks } = createSubject()

    await result.saveTransaction(input)
    await result.saveTransaction(input)

    expect(api.createTransaction).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith('กรุณารอสักครู่ก่อนบันทึกรายการถัดไป')

    vi.advanceTimersByTime(1000)
    await result.saveTransaction(input)

    expect(api.createTransaction).toHaveBeenCalledTimes(2)
  })

  it('ส่ง body แบบ camelCase พร้อม idempotencyKey ที่เป็น UUID', async () => {
    const { result } = createSubject()

    await result.saveTransaction(input)

    expect(api.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'กาแฟ',
        amount: 65,
        type: 'expense',
        category: 'อาหาร',
        transactionDate: '2026-03-15',
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    )
  })

  it('เน็ตหลุดกลางการบันทึก: เก็บเข้าคิวด้วย key เดิม ไม่ทิ้งข้อมูล', async () => {
    api.createTransaction.mockRejectedValueOnce(new FakeApiError('NETWORK', true))
    const { result, callbacks } = createSubject()

    await result.saveTransaction(input)

    const key = (api.createTransaction.mock.calls[0] as unknown as [{ idempotencyKey: string }])[0]
      .idempotencyKey
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ description: 'กาแฟ' }), key)
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('ไล่ cursor จนครบทุกหน้าและแปลงเป็นรูปแบบของหน้าจอ', async () => {
    pages.push(
      { items: [apiTx()], nextCursor: 'c1' },
      { items: [apiTx({ id: '01J9Z8X7W6V5T4S3R2Q1P0N9M9', amount: 100 })], nextCursor: null },
    )
    const { result } = createSubject()

    await result.loadTransactions()

    expect(api.listTransactions).toHaveBeenCalledTimes(2)
    expect(api.listTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }))
    expect(result.transactions.value).toHaveLength(2)
    expect(result.transactions.value[0]).toMatchObject({
      id: ULID,
      user_id: 'user-1',
      transaction_date: '2026-03-15',
      created_at: '2026-03-15T05:00:00.000Z',
    })
  })

  it.each([
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2026-12', '2026-12-01', '2026-12-31'],
  ])('ขอข้อมูลรายเดือน %s ด้วยช่วงวันที่แบบรวมทั้งสองฝั่ง', async (month, from, to) => {
    const { result } = createSubject()

    await result.loadTransactionsByMonth(month)

    expect(api.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ from, to }))
  })

  it('ลบแบบ soft delete และนำรายการออกจาก state หลังสำเร็จ', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    const transaction = makeTransaction({ id: ULID })
    const { result, callbacks } = createSubject()
    result.setTransactions([transaction])

    await result.deleteTransaction(transaction)

    expect(api.deleteTransaction).toHaveBeenCalledWith(ULID)
    expect(result.transactions.value).toEqual([])
    expect(callbacks.onDeleted).toHaveBeenCalledWith(transaction)
  })

  it('แถวที่รอซิงก์ (pending:) แก้/ลบไม่ได้', async () => {
    const pending = makeTransaction({ id: 'pending:abc' })
    const { result, callbacks } = createSubject()

    await result.deleteTransaction(pending)

    expect(api.deleteTransaction).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('รอซิงก์'))
  })

  it('ลบหลายรายการเป็นชุดละไม่เกิน 100 และข้ามแถวที่รอซิงก์', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`)
    const { result } = createSubject()
    result.setTransactions(ids.map((id) => makeTransaction({ id })))

    const ok = await result.deleteSelectedTransactions([...ids, 'pending:x'])

    expect(ok).toBe(true)
    expect(api.bulkDelete).toHaveBeenCalledTimes(2)
    expect((api.bulkDelete.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(100)
    expect((api.bulkDelete.mock.calls[1] as unknown as [string[]])[0]).toHaveLength(50)
    expect(result.transactions.value).toEqual([])
  })

  it('กู้คืนผ่าน POST /restore แล้วโหลดรายการใหม่', async () => {
    pages.push({ items: [apiTx()], nextCursor: null })
    const restored = makeTransaction({ id: ULID })
    const { result, callbacks } = createSubject()

    const success = await result.restoreTransaction(restored)

    expect(success).toBe(true)
    expect(api.restoreTransaction).toHaveBeenCalledWith(ULID)
    expect(result.transactions.value.map(({ id }) => id)).toEqual([ULID])
    expect(callbacks.onMutated).toHaveBeenCalledOnce()
    expect(callbacks.onMessage).toHaveBeenCalledWith('นำรายการกลับมาแล้ว')
  })

  it('session หมดอายุ: ไม่แสดง error ซ้ำ', async () => {
    api.listTransactions.mockRejectedValueOnce(new FakeApiError('UNAUTHORIZED', false))
    const { result, callbacks } = createSubject()
    callbacks.handleAuthError.mockResolvedValueOnce('expired')

    await result.loadTransactions()

    expect(callbacks.onError).not.toHaveBeenCalled()
  })
})
