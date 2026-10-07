import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { describeError, isOffline, sleep } from '../lib/api'
import { api, errorStatus, isTransientError, PENDING_ID_PREFIX, toCreateBody } from '../lib/backend'
import type { Transaction, TransactionInput } from '../types/transaction'

const STORAGE_KEY = 'moneyflow.offline-queue.v1'
/** กัน localStorage บวมถ้าผู้ใช้ออฟไลน์ยาวมาก */
const MAX_QUEUE_LENGTH = 200

/**
 * คิวรองรับแค่การ "เพิ่มรายการ" เท่านั้น
 *
 * เพราะนั่นคือเคสจริงบนมือถือ: อยู่หน้าร้าน เน็ตไม่มี แต่ต้องจดก่อนลืม
 * การแก้/ลบตอนออฟไลน์จะถูกบล็อกพร้อมข้อความ เพราะต้องอ้างอิง row id จริง
 * ถ้าปล่อยให้ทำได้จะเกิดเคสแก้แถวที่ยังไม่มีอยู่บนเซิร์ฟเวอร์
 */
export interface QueuedTransaction {
  queueId: string
  userId: string
  input: TransactionInput
  queuedAt: number
}

const createQueueId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()

  // UUID v4 fallback: API ต้องการ idempotencyKey เป็น UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

const readStorage = (): QueuedTransaction[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    // ข้อมูลใน localStorage แก้มือได้ จึงต้องกรองของที่รูปร่างไม่ถูกออก
    return parsed.filter((item): item is QueuedTransaction => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<QueuedTransaction>
      return (
        typeof candidate.queueId === 'string' &&
        typeof candidate.userId === 'string' &&
        typeof candidate.queuedAt === 'number' &&
        Boolean(candidate.input) &&
        typeof candidate.input === 'object'
      )
    })
  } catch {
    return []
  }
}

const writeStorage = (items: QueuedTransaction[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // โหมดส่วนตัวหรือ quota เต็ม: ยอมให้คิวอยู่แค่ในหน่วยความจำ ดีกว่าแอปพัง
  }
}

export interface UseOfflineQueueOptions {
  userId: () => string | null
  /** เรียกหลังซิงก์สำเร็จ เพื่อให้หน้าจอโหลดข้อมูลจริงจากเซิร์ฟเวอร์ */
  onSynced?: (syncedCount: number) => void | Promise<void>
}

export const useOfflineQueue = ({ userId, onSynced }: UseOfflineQueueOptions) => {
  const isOnline = ref(!isOffline())
  const queue = ref<QueuedTransaction[]>(readStorage())
  const syncing = ref(false)
  const lastError = ref('')

  const persist = () => writeStorage(queue.value)

  const pending = computed(() => {
    const currentUser = userId()
    if (!currentUser) return []
    return queue.value.filter((item) => item.userId === currentUser)
  })

  const pendingCount = computed(() => pending.value.length)

  /**
   * แปลงคิวเป็น Transaction ชั่วคราวเพื่อให้ผู้ใช้เห็นรายการที่จดไว้ทันที
   * id ขึ้นต้นด้วย pending: เพื่อแยกออกจาก ULID ของแถวจริง
   */
  const pendingTransactions = computed<Transaction[]>(() =>
    pending.value.map((item) => ({
      id: `${PENDING_ID_PREFIX}${item.queueId}`,
      user_id: item.userId,
      description: item.input.description,
      amount: item.input.amount,
      type: item.input.type,
      category: item.input.category,
      transaction_date: item.input.transaction_date,
      created_at: new Date(item.queuedAt).toISOString(),
      idempotency_key: item.queueId,
      deleted_at: null,
      client_timezone: item.input.client_timezone ?? null,
    })),
  )

  const enqueue = (input: TransactionInput, queueId = createQueueId()): boolean => {
    const currentUser = userId()
    if (!currentUser) return false

    if (queue.value.length >= MAX_QUEUE_LENGTH) {
      lastError.value = `คิวออฟไลน์เต็ม (${MAX_QUEUE_LENGTH} รายการ) กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อซิงก์ก่อน`
      return false
    }

    queue.value = [...queue.value, { queueId, userId: currentUser, input, queuedAt: Date.now() }]
    persist()
    lastError.value = ''
    return true
  }

  const removeFromQueue = (queueId: string) => {
    queue.value = queue.value.filter((item) => item.queueId !== queueId)
    persist()
  }

  const flush = async (): Promise<void> => {
    const currentUser = userId()
    if (syncing.value || !api || !currentUser || isOffline()) return

    const batch = queue.value.filter((item) => item.userId === currentUser)
    if (batch.length === 0) return

    const endpoints = api

    syncing.value = true
    lastError.value = ''
    let synced = 0
    const rejected: string[] = []

    try {
      for (const [index, item] of batch.entries()) {
        if (index > 0) await sleep(200)

        try {
          // queueId เป็น idempotencyKey: ถ้าครั้งก่อน timeout แต่บันทึกไปแล้ว
          // เซิร์ฟเวอร์จะคืนรายการเดิม (200) ไม่สร้างซ้ำ
          await endpoints.createTransaction(toCreateBody(item.input, item.queueId))
          removeFromQueue(item.queueId)
          synced += 1
          continue
        } catch (error) {
          const status = errorStatus(error)
          if (isTransientError(error) || status === 401 || status === 403) {
            // เน็ต/สิทธิ์มีปัญหาชั่วคราว ห้ามทิ้งข้อมูลที่ผู้ใช้จดไว้
            lastError.value = describeError(error, 'ซิงก์ข้อมูลออฟไลน์ไม่สำเร็จ')
            break
          }

          // เซิร์ฟเวอร์ปฏิเสธข้อมูลนี้ถาวร ถ้าเก็บไว้จะ retry วนไม่จบ
          removeFromQueue(item.queueId)
          rejected.push(item.input.description)
          lastError.value = `บันทึก “${item.input.description}” ไม่ได้: ${describeError(error)}`
        }
      }
    } finally {
      syncing.value = false
    }

    if (synced > 0) await onSynced?.(synced)
    if (rejected.length > 0 && !lastError.value) {
      lastError.value = `มี ${rejected.length} รายการที่เซิร์ฟเวอร์ปฏิเสธและถูกนำออกจากคิว`
    }
  }

  /** ล้างคิวของผู้ใช้ปัจจุบัน ใช้เวลากด reset ข้อมูลทั้งหมด */
  const clearForCurrentUser = () => {
    const currentUser = userId()
    if (!currentUser) return
    queue.value = queue.value.filter((item) => item.userId !== currentUser)
    persist()
    lastError.value = ''
  }

  const handleOnline = () => {
    isOnline.value = true
    void flush()
  }

  const handleOffline = () => {
    isOnline.value = false
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    isOnline.value = !isOffline()
    if (isOnline.value) void flush()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return {
    isOnline,
    syncing,
    lastError,
    pending,
    pendingCount,
    pendingTransactions,
    enqueue,
    flush,
    clearForCurrentUser,
  }
}
