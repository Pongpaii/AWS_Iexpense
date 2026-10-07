import type { Transaction } from '../types/transaction'

/**
 * สัดส่วน "ใช้ไปกี่ % ของรายรับ" ต้องคิดเป็นรอบเดือน ไม่ใช่ประวัติทั้งก้อน
 * เพราะรายรับสะสมทั้งชีวิตหารกับรายจ่ายสะสมทั้งชีวิตจะนิ่งอยู่ที่เลขเดิมตลอด
 * ผู้ใช้จึงอ่านไม่ออกว่าเดือนนี้ใช้เกินตัวหรือยัง
 */
export interface MonthSpendingSummary {
  /** เดือนที่คิด รูปแบบ 'YYYY-MM' */
  month: string
  /** รายรับที่บันทึกไว้จริงในเดือนนั้น */
  recordedIncome: number
  /** รายจ่ายที่บันทึกไว้จริงในเดือนนั้น */
  expense: number
  /** ฐานรายรับที่ใช้หาร มาจากรายรับที่บันทึกไว้หรือเงินเดือนที่ตั้งไว้ แล้วแต่ตัวไหนมากกว่า */
  incomeBase: number
  /** true เมื่อฐานมาจากเงินเดือนที่ตั้งไว้ เพราะเดือนนี้ยังบันทึกรายรับไม่ถึงยอดนั้น */
  usesSalaryBase: boolean
  hasIncomeBase: boolean
  /** เปอร์เซ็นต์ปัดเป็นจำนวนเต็ม เกิน 100 ได้เมื่อใช้เกินฐาน */
  ratio: number
}

interface MonthSpendingOptions {
  transactions: Transaction[]
  /** 'YYYY-MM' */
  month: string
  /** เงินเดือนที่ผู้ใช้ตั้งไว้ ใช้เป็นฐานสำรองตอนเงินเดือนรอบนี้ยังไม่เข้า */
  monthlySalary?: number
}

const sumMonth = (transactions: Transaction[], month: string, type: Transaction['type']) =>
  transactions.reduce((sum, transaction) => {
    if (transaction.type !== type) return sum
    if (transaction.transaction_date.slice(0, 7) !== month) return sum

    const amount = Number(transaction.amount)
    if (!Number.isFinite(amount) || amount <= 0) return sum

    return sum + amount
  }, 0)

export const summarizeMonthSpending = ({
  transactions,
  month,
  monthlySalary = 0,
}: MonthSpendingOptions): MonthSpendingSummary => {
  const recordedIncome = sumMonth(transactions, month, 'income')
  const expense = sumMonth(transactions, month, 'expense')
  const normalizedSalary = Number.isFinite(monthlySalary) && monthlySalary > 0 ? monthlySalary : 0

  // วันเงินเดือนอยู่ปลายเดือน ต้นเดือนจึงยังไม่มีรายรับบันทึกไว้เลย
  // ถ้าหารด้วยรายรับที่บันทึกจริงล้วนๆ ทุกต้นเดือนจะเด้งเป็น 100% ทันที
  const incomeBase = Math.max(recordedIncome, normalizedSalary)
  const hasIncomeBase = incomeBase > 0

  const ratio = hasIncomeBase ? Math.round((expense / incomeBase) * 100) : expense > 0 ? 100 : 0

  return {
    month,
    recordedIncome,
    expense,
    incomeBase,
    usesSalaryBase: hasIncomeBase && normalizedSalary > recordedIncome,
    hasIncomeBase,
    ratio,
  }
}
