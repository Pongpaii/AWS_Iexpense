import { computed, ref, watch } from 'vue'
import { describeError, isOffline } from '../lib/api'
import {
  api,
  fetchTransactions,
  isOfflineError,
  isPendingId,
  isTransientError,
  toCreateBody,
  toUpdateBody,
} from '../lib/backend'
import { validateTransactionInput } from '../schemas/transaction.schema'
import type { Transaction, TransactionInput } from '../types/transaction'
import type { HandleAuthError } from './useAuth'
import { useOfflineQueue } from './useOfflineQueue'

export interface UseTransactionsOptions {
  userId: () => string | null
  /** โหมดดูตัวอย่าง: อ่านได้ เขียนไม่ได้ */
  isDemoMode: () => boolean
  onMessage: (message: string) => void
  onError: (message: string) => void
  clearError: () => void
  handleAuthError: HandleAuthError
  /** เรียกหลังข้อมูลเปลี่ยน เพื่อให้ระบบความสำเร็จคำนวณใหม่ */
  onMutated: () => Promise<void> | void
  /** เรียกหลังลบรายการเดียวสำเร็จ เพื่อเปิดหน้าต่าง "เลิกทำ" */
  onDeleted: (transaction: Transaction) => void
  /** ล้างหน้าต่าง "เลิกทำ" ก่อนการลบหลายรายการหรือรีเซ็ต */
  onBeforeBulkChange: () => void
}

const OFFLINE_EDIT_MESSAGE = 'ออฟไลน์อยู่ แก้ไขรายการไม่ได้ กรุณาลองใหม่เมื่อกลับมาออนไลน์'
const OFFLINE_DELETE_MESSAGE = 'ออฟไลน์อยู่ ลบรายการไม่ได้ กรุณาลองใหม่เมื่อกลับมาออนไลน์'
export const SAVE_THROTTLE_MS = 1000
/** API ลบได้ครั้งละไม่เกิน 100 รายการ (MAX_BULK_DELETE) */
const BULK_DELETE_CHUNK = 100

const currentTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

const createIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** วันสุดท้ายของเดือน YYYY-MM */
const monthEnd = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  return `${yearMonth}-${String(last).padStart(2, '0')}`
}

/**
 * ศูนย์กลางของข้อมูลรายรับรายจ่าย: โหลด เพิ่ม แก้ ลบ และคิวออฟไลน์
 *
 * ทำไมยังดึงประวัติทั้งหมด: ยอดคงเหลือยกมา กราฟ ปฏิทินความร้อน และเงื่อนไข badge
 * คำนวณจากประวัติทั้งก้อนฝั่ง client เหมือนแอปเดิม (ดึงทีละหน้า วาดหน้าแรกก่อน)
 * timeout/retry/refresh token อยู่ใน aws/client.ts ทุก call จึงเช็คแค่ handleAuthError
 */
export const useTransactions = (options: UseTransactionsOptions) => {
  /** แถวที่ยืนยันแล้วจากเซิร์ฟเวอร์ (หรือข้อมูลตัวอย่างในโหมด demo) */
  const serverTransactions = ref<Transaction[]>([])
  const editingTransaction = ref<Transaction | null>(null)
  /** เพิ่มค่าเพื่อบังคับ remount ฟอร์ม ทำให้ฟิลด์ที่ค้างอยู่ถูกล้าง */
  const formVersion = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const bulkBusy = ref(false)
  const busyId = ref<string | null>(null)
  const lastSaveTimestamp = ref(0)
  const serverBalance = ref(0)
  const monthlySummary = ref({ totalIncome: 0, totalExpense: 0 })

  const {
    isOnline,
    syncing: offlineSyncing,
    lastError: offlineQueueError,
    pendingCount: offlinePendingCount,
    pendingTransactions,
    enqueue: enqueueOffline,
    flush: flushOfflineQueue,
    clearForCurrentUser: clearOfflineQueue,
  } = useOfflineQueue({
    userId: options.userId,
    onSynced: async (count) => {
      await loadTransactions()
      await options.onMutated()
      options.onMessage(
        count === 1 ? 'ซิงก์รายการที่จดตอนออฟไลน์แล้ว' : `ซิงก์ ${count} รายการที่จดตอนออฟไลน์แล้ว`,
      )
    },
  })

  watch(offlineQueueError, (message) => {
    if (message) options.onError(message)
  })

  /**
   * มุมมองเดียวที่ทั้งหน้าจอใช้: แถวจริง + แถวที่ยังรอซิงก์
   * เรียงวันที่ใหม่สุดก่อน แล้วค่อย created_at เพื่อให้ยอดสรุปตรงกันทั้งตอนออฟไลน์และออนไลน์
   */
  const transactions = computed<Transaction[]>(() => {
    if (pendingTransactions.value.length === 0) return serverTransactions.value

    return [...pendingTransactions.value, ...serverTransactions.value].sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) {
        return a.transaction_date < b.transaction_date ? 1 : -1
      }
      return a.created_at < b.created_at ? 1 : -1
    })
  })

  /** แถวที่รอซิงก์แก้ไข/ลบไม่ได้ เพราะยังไม่มี id จริงบนเซิร์ฟเวอร์ */
  const isPendingRow = (transaction: Transaction) => isPendingId(transaction.id)

  const blockedInDemo = () => {
    if (!options.isDemoMode()) return false
    options.onError('โหมดดูตัวอย่างแก้ไขข้อมูลไม่ได้ เข้าสู่ระบบเพื่อบันทึกรายการจริง')
    return true
  }

  /** คืน true ถ้า error ถูกจัดการแล้ว (ออฟไลน์เงียบ ๆ หรือ session หมดอายุ) */
  const swallowError = async (error: unknown) => {
    if (isOfflineError(error)) return true
    return (await options.handleAuthError(error)) === 'expired'
  }

  const loadTransactions = async (): Promise<void> => {
    const currentUser = options.userId()
    if (!api || !currentUser) {
      serverTransactions.value = []
      return
    }

    loading.value = true
    options.clearError()
    try {
      const rows = await fetchTransactions(api, currentUser, {
        // เห็นก้อนแรกแล้วให้วาดเลย ไม่ต้องรอครบทุกหน้า
        onFirstPage: (first) => {
          if (options.userId() !== currentUser) return
          serverTransactions.value = first
          loading.value = false
        },
      })
      // ผู้ใช้อาจสลับบัญชีระหว่างรอ อย่าเอาข้อมูลคนก่อนมาแสดง
      if (options.userId() === currentUser) serverTransactions.value = rows
    } catch (error) {
      // ออฟไลน์ไม่ใช่เรื่องต้องตกใจ ข้อมูลที่โหลดไว้ก่อนหน้ายังอยู่บนหน้าจอ
      if (!(await swallowError(error))) {
        options.onError(`โหลดข้อมูลไม่สำเร็จ: ${describeError(error)}`)
      }
    } finally {
      loading.value = false
    }
  }

  const loadRange = async (from: string, to: string, label: string) => {
    const currentUser = options.userId()
    if (!api || !currentUser) return

    loading.value = true
    try {
      serverTransactions.value = await fetchTransactions(api, currentUser, { from, to })
    } catch (error) {
      if (!(await swallowError(error))) {
        options.onError(`${label}: ${describeError(error)}`)
      }
    } finally {
      loading.value = false
    }
  }

  const loadTransactionsByMonth = async (yearMonth: string): Promise<void> => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return
    await loadRange(`${yearMonth}-01`, monthEnd(yearMonth), 'โหลดข้อมูลรายเดือนไม่สำเร็จ')
  }

  const loadTransactionsByDate = async (isoDate: string): Promise<void> => {
    await loadRange(isoDate, isoDate, 'โหลดข้อมูลรายวันไม่สำเร็จ')
  }

  const loadBalance = async (): Promise<void> => {
    if (!api || !options.userId()) return
    try {
      serverBalance.value = (await api.balance()).balance
    } catch {
      // ยอดจากเซิร์ฟเวอร์เป็นของเสริม หน้าจอคำนวณเองจากรายการได้อยู่แล้ว
    }
  }

  const loadMonthlySummary = async (yearMonth: string): Promise<void> => {
    if (!api || !options.userId()) return
    try {
      const summary = await api.monthly(yearMonth)
      monthlySummary.value = { totalIncome: summary.income, totalExpense: summary.expense }
    } catch {
      // เหมือน loadBalance
    }
  }

  const saveTransaction = async (input: TransactionInput) => {
    if (saving.value) return

    const now = Date.now()
    if (now - lastSaveTimestamp.value < SAVE_THROTTLE_MS) {
      options.onError('กรุณารอสักครู่ก่อนบันทึกรายการถัดไป')
      return
    }

    if (blockedInDemo()) return
    const currentUser = options.userId()
    if (!api || !currentUser) return

    // ฟอร์ม validate มาแล้ว แต่นี่เป็นทางเข้าเดียวของการเขียนข้อมูล
    // จึงกันไว้อีกชั้นเผื่อมี caller อื่นในอนาคต
    const validated = validateTransactionInput(input)
    if (!validated.success || !validated.data) {
      options.onError(Object.values(validated.fieldErrors)[0] ?? 'ข้อมูลรายการไม่ถูกต้อง')
      return
    }

    const target = editingTransaction.value
    const operationKey = createIdempotencyKey()
    const payload: TransactionInput = target
      ? validated.data
      : { ...validated.data, client_timezone: currentTimezone() }
    lastSaveTimestamp.value = now

    // ออฟไลน์: การ "เพิ่ม" เก็บเข้าคิวไว้ก่อนได้ แต่การ "แก้" ต้องมีแถวจริงบนเซิร์ฟเวอร์
    if (isOffline()) {
      if (target) {
        options.onError(OFFLINE_EDIT_MESSAGE)
        return
      }

      if (enqueueOffline(payload, operationKey)) {
        formVersion.value += 1
        options.onMessage('ออฟไลน์อยู่ เก็บรายการไว้ในคิวแล้ว ระบบจะซิงก์ให้เมื่อกลับมาออนไลน์')
      }
      return
    }

    saving.value = true
    options.clearError()

    try {
      if (target) await api.updateTransaction(target.id, toUpdateBody(payload))
      else await api.createTransaction(toCreateBody(payload, operationKey))
    } catch (error) {
      saving.value = false

      // เน็ตหลุดกลางการบันทึกรายการใหม่: ไม่ทิ้งของที่ผู้ใช้พิมพ์มาแล้ว
      // ใช้ key เดิม ถ้าคำขอแรกไปถึงแล้ว เซิร์ฟเวอร์จะไม่สร้างซ้ำ
      if (!target && isTransientError(error)) {
        if (enqueueOffline(payload, operationKey)) {
          formVersion.value += 1
          options.onMessage('เน็ตหลุดตอนบันทึก เก็บรายการไว้ในคิวแล้ว ระบบจะซิงก์ให้ทีหลัง')
        }
        return
      }

      if ((await options.handleAuthError(error)) === 'expired') return
      options.onError(`บันทึกข้อมูลไม่สำเร็จ: ${describeError(error)}`)
      return
    }

    saving.value = false
    options.onMessage(target ? 'แก้ไขรายการเรียบร้อยแล้ว' : 'เพิ่มรายการเรียบร้อยแล้ว')
    editingTransaction.value = null
    formVersion.value += 1
    await loadTransactions()
    await options.onMutated()
  }

  const editTransaction = (transaction: Transaction) => {
    if (blockedInDemo()) return
    if (isPendingRow(transaction)) {
      options.onError('รายการนี้ยังรอซิงก์อยู่ แก้ไขได้เมื่อซิงก์เสร็จแล้ว')
      return
    }
    editingTransaction.value = transaction
  }

  const cancelEdit = () => {
    editingTransaction.value = null
  }

  const deleteTransaction = async (transaction: Transaction) => {
    if (busyId.value !== null || bulkBusy.value) return
    if (blockedInDemo()) return
    if (isPendingRow(transaction)) {
      options.onError('รายการนี้ยังรอซิงก์อยู่ ลบได้เมื่อซิงก์เสร็จแล้ว')
      return
    }
    if (isOffline()) {
      options.onError(OFFLINE_DELETE_MESSAGE)
      return
    }

    const currentUser = options.userId()
    if (
      !api ||
      !currentUser ||
      !window.confirm(`ต้องการลบ “${transaction.description}” ใช่หรือไม่?`)
    )
      return

    busyId.value = transaction.id
    options.clearError()

    try {
      // API ลบแบบ soft delete จึงกู้คืนได้ (ปุ่ม "เลิกทำ")
      await api.deleteTransaction(transaction.id)
      if (editingTransaction.value?.id === transaction.id) editingTransaction.value = null
      serverTransactions.value = serverTransactions.value.filter(
        (item) => item.id !== transaction.id,
      )
      options.onDeleted(transaction)
      await options.onMutated()
    } catch (error) {
      if ((await options.handleAuthError(error)) !== 'expired') {
        options.onError(`ลบข้อมูลไม่สำเร็จ: ${describeError(error)}`)
      }
    } finally {
      busyId.value = null
    }
  }

  /** เขียนรายการที่เพิ่งลบกลับเข้าไป ใช้โดย useUndoDelete */
  const restoreTransaction = async (transaction: Transaction): Promise<boolean> => {
    const currentUser = options.userId()
    if (!api || !currentUser) return false

    options.clearError()
    try {
      await api.restoreTransaction(transaction.id)
    } catch (error) {
      if ((await options.handleAuthError(error)) !== 'expired') {
        options.onError(`กู้คืนรายการไม่สำเร็จ: ${describeError(error)}`)
      }
      return false
    }

    await loadTransactions()
    await options.onMutated()
    options.onMessage('นำรายการกลับมาแล้ว')
    return true
  }

  /** ลบเป็นชุด ชุดละไม่เกิน 100 รายการ คืน id ที่หายไปจากเซิร์ฟเวอร์แล้ว */
  const bulkDelete = async (ids: string[]) => {
    const removed: string[] = []
    if (!api) return removed
    for (const part of chunk(ids, BULK_DELETE_CHUNK)) {
      const res = await api.bulkDelete(part)
      removed.push(...res.deleted, ...res.notFound)
    }
    return removed
  }

  const deleteSelectedTransactions = async (selectedIds: string[]) => {
    if (bulkBusy.value || busyId.value !== null) return
    if (blockedInDemo()) return
    if (isOffline()) {
      options.onError(OFFLINE_DELETE_MESSAGE)
      return
    }

    // แถวที่รอซิงก์ยังไม่มีอยู่บนเซิร์ฟเวอร์ จึงลบผ่าน API ไม่ได้
    const ids = selectedIds.filter((id) => !isPendingId(id))
    if (ids.length < selectedIds.length) {
      options.onError('รายการที่รอซิงก์จะถูกข้ามไป ลบได้เมื่อซิงก์เสร็จแล้ว')
    }

    const currentUser = options.userId()
    if (
      !api ||
      !currentUser ||
      ids.length === 0 ||
      !window.confirm(`ยืนยันลบธุรกรรมที่เลือก ${ids.length} รายการ? การดำเนินการนี้ย้อนกลับไม่ได้`)
    )
      return

    options.onBeforeBulkChange()
    bulkBusy.value = true
    options.clearError()

    let deleted = false
    try {
      const removed = new Set(await bulkDelete(ids))
      if (editingTransaction.value && removed.has(editingTransaction.value.id)) {
        editingTransaction.value = null
      }
      serverTransactions.value = serverTransactions.value.filter(({ id }) => !removed.has(id))
      await options.onMutated()
      options.onMessage(`ลบ ${ids.length} รายการเรียบร้อยแล้ว`)
      deleted = true
    } catch (error) {
      if ((await options.handleAuthError(error)) !== 'expired') {
        options.onError(`ลบรายการที่เลือกไม่สำเร็จ: ${describeError(error)}`)
        // บางชุดอาจลบไปแล้ว โหลดใหม่ให้หน้าจอตรงกับเซิร์ฟเวอร์
        await loadTransactions()
      }
    } finally {
      bulkBusy.value = false
    }
    return deleted
  }

  const resetAllTransactions = async () => {
    if (bulkBusy.value || busyId.value !== null) return false
    if (blockedInDemo()) return false
    if (isOffline()) {
      options.onError('ออฟไลน์อยู่ รีเซ็ตข้อมูลไม่ได้ กรุณาลองใหม่เมื่อกลับมาออนไลน์')
      return false
    }

    const currentUser = options.userId()
    if (!api || !currentUser || transactions.value.length === 0) return false

    options.onBeforeBulkChange()
    bulkBusy.value = true
    options.clearError()

    let reset = false
    try {
      // ดึงรายการล่าสุดจากเซิร์ฟเวอร์ก่อน เผื่อมีรายการที่เพิ่มจากอุปกรณ์อื่น
      const all = await fetchTransactions(api, currentUser)
      await bulkDelete(all.map(({ id }) => id))
      serverTransactions.value = []
      clearOfflineQueue()
      editingTransaction.value = null
      options.onMessage('รีเซ็ตข้อมูลทั้งหมดเรียบร้อยแล้ว')
      reset = true
    } catch (error) {
      if ((await options.handleAuthError(error)) !== 'expired') {
        options.onError(`รีเซ็ตข้อมูลไม่สำเร็จ: ${describeError(error)}`)
        await loadTransactions()
      }
    } finally {
      bulkBusy.value = false
    }
    return reset
  }

  /** ใส่ข้อมูลตัวอย่างสำหรับโหมดดูตัวอย่าง (ไม่แตะเซิร์ฟเวอร์) */
  const setTransactions = (rows: Transaction[]) => {
    serverTransactions.value = rows
  }

  /** ล้าง state ทั้งหมดของผู้ใช้คนก่อน ใช้ตอนออกจากระบบหรือสลับบัญชี */
  const resetState = () => {
    serverTransactions.value = []
    editingTransaction.value = null
    loading.value = false
    saving.value = false
    bulkBusy.value = false
    busyId.value = null
    lastSaveTimestamp.value = 0
    serverBalance.value = 0
    monthlySummary.value = { totalIncome: 0, totalExpense: 0 }
    formVersion.value += 1
  }

  return {
    transactions,
    serverTransactions,
    editingTransaction,
    formVersion,
    loading,
    saving,
    bulkBusy,
    busyId,
    isOnline,
    offlineSyncing,
    offlinePendingCount,
    serverBalance,
    monthlySummary,
    isPendingRow,
    loadTransactions,
    loadTransactionsByMonth,
    loadTransactionsByDate,
    loadBalance,
    loadMonthlySummary,
    saveTransaction,
    editTransaction,
    cancelEdit,
    deleteTransaction,
    restoreTransaction,
    deleteSelectedTransactions,
    resetAllTransactions,
    setTransactions,
    resetState,
    flushOfflineQueue,
    clearOfflineQueue,
  }
}
