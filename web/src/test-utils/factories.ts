import type { Transaction, TransactionCategory, TransactionType } from '../types/transaction'

let nextId = 1

/**
 * สร้าง Transaction สำหรับเทสต์ ระบุเฉพาะฟิลด์ที่เทสต์นั้นสนใจ
 * ที่เหลือใส่ค่าที่ถูกต้องให้อัตโนมัติ เพื่อให้เทสต์อ่านง่ายและไม่เปราะ
 */
export const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: overrides.id ?? `tx-${nextId++}`,
  user_id: 'user-1',
  description: 'รายการทดสอบ',
  amount: 100,
  type: 'expense' as TransactionType,
  category: null as TransactionCategory | null,
  transaction_date: '2026-03-15',
  created_at: '2026-03-15T05:00:00.000Z',
  ...overrides,
})

export const resetTransactionIds = () => {
  nextId = 1
}
