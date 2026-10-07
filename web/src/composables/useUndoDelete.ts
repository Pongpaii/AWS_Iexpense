import { onBeforeUnmount, ref } from 'vue'
import type { Transaction } from '../types/transaction'

/** ระยะเวลาที่ปุ่ม "เลิกทำ" ยังกดได้หลังลบ */
const UNDO_WINDOW_MS = 6500

export interface UseUndoDeleteOptions {
  /**
   * เขียนรายการกลับเข้าฐานข้อมูล คืน true ถ้าสำเร็จ
   * ตัว composable ไม่คุยกับ API เอง เพื่อให้ทดสอบได้โดยไม่ต้องมีเน็ต
   */
  restore: (transaction: Transaction) => Promise<boolean>
  windowMs?: number
}

/**
 * หน้าต่าง "เลิกทำ" หลังลบรายการ
 *
 * เหตุผลที่ต้องมี: การลบเป็นการทำลายข้อมูลและกดพลาดได้ง่ายบนมือถือ
 * แต่ก็ไม่อยากถาม confirm ทุกครั้งจนน่ารำคาญ
 */
export const useUndoDelete = ({ restore, windowMs = UNDO_WINDOW_MS }: UseUndoDeleteOptions) => {
  const deletedTransaction = ref<Transaction | null>(null)
  const undoBusy = ref(false)
  let undoTimer: ReturnType<typeof setTimeout> | undefined

  const clearUndo = () => {
    clearTimeout(undoTimer)
    undoTimer = undefined
    deletedTransaction.value = null
  }

  const offerUndo = (transaction: Transaction) => {
    clearTimeout(undoTimer)
    deletedTransaction.value = transaction
    undoTimer = setTimeout(() => {
      deletedTransaction.value = null
      undoTimer = undefined
    }, windowMs)
  }

  const undoDelete = async () => {
    const transaction = deletedTransaction.value
    if (undoBusy.value || !transaction) return

    undoBusy.value = true
    try {
      if (await restore(transaction)) clearUndo()
    } finally {
      undoBusy.value = false
    }
  }

  onBeforeUnmount(() => clearTimeout(undoTimer))

  return { deletedTransaction, undoBusy, clearUndo, offerUndo, undoDelete }
}
