import type { CategoryBudget } from '../composables/useCategoryBudgets'
import {
  compareCategoryPriority,
  getCategoryEmoji,
  type Transaction,
  type TransactionCategory,
} from '../types/transaction'
import { categoryPalette } from './categoryBreakdown'

/** เกณฑ์เตือนก่อนเกินงบ: ใช้ถึง 80% ของงบแล้วถือว่าใกล้เต็ม */
export const BUDGET_NEAR_THRESHOLD = 80

export type BudgetStatus = 'under' | 'near' | 'over'

export interface BudgetVsActual {
  category: TransactionCategory
  label: string
  emoji: string
  color: string
  /** งบที่ตั้งไว้สำหรับเดือนนี้ */
  budget: number
  /** จ่ายจริงในเดือนที่เลือก */
  actual: number
  /** budget - actual · ติดลบ = เกินงบ */
  remaining: number
  /** actual / budget * 100 */
  percentage: number
  status: BudgetStatus
  transactionCount: number
}

export interface NoBudgetCategory {
  category: TransactionCategory | null
  label: string
  emoji: string
  actual: number
  transactionCount: number
}

export interface BudgetComparisonSummary {
  /** อาหาร → การเดินทาง → ที่เหลือเรียงจากใช้เกินงบมากสุดไปน้อยสุด */
  items: BudgetVsActual[]
  totalBudget: number
  /** จ่ายจริงเฉพาะหมวดที่ตั้งงบไว้ */
  totalActual: number
  overBudgetCount: number
  underBudgetCount: number
  /** เงินที่ยังเหลือรวมทุกหมวด · 0 เมื่อใช้เกินไปแล้วทั้งหมด */
  totalRemaining: number
  /** ใช้เกินไปเท่าไรรวมทุกหมวด */
  totalOverspend: number
  /** หมวดที่มีรายจ่ายแต่ไม่ได้ตั้งงบ · อาหาร/การเดินทางก่อน แล้วเรียงจากมากไปน้อย */
  noBudgetCategories: NoBudgetCategory[]
  /** จ่ายจริงทั้งเดือน รวมหมวดที่ไม่ได้ตั้งงบ */
  monthTotal: number
}

const statusOf = (percentage: number): BudgetStatus => {
  if (percentage > 100) return 'over'
  return percentage >= BUDGET_NEAR_THRESHOLD ? 'near' : 'under'
}

/** ยอมรับความคลาดเคลื่อนของจังหวะการใช้เงินได้กี่จุดเปอร์เซ็นต์ ก่อนจะบอกว่าเร็ว/ช้ากว่าเวลา */
const PACE_TOLERANCE_POINTS = 5

/** ใช้เร็วกว่าเวลา / พอดี / ช้ากว่าเวลา */
export type BudgetPace = 'ahead' | 'ontrack' | 'behind'

export interface BudgetPacing {
  /** เงินจริงที่มีอยู่ ณ วันนี้ = รายรับสะสม - รายจ่ายสะสมทั้งหมด */
  availableBalance: number
  /** งบที่เหลือตามแผน (ติดลบได้เมื่อใช้เกินไปแล้ว) */
  budgetRemaining: number
  /**
   * ใช้ได้จริงเท่าไร = ค่าที่น้อยกว่าระหว่างงบที่เหลือกับเงินที่มีจริง
   * งบเหลือ 5,000 แต่เงินในมือ 800 ก็ใช้ได้จริงแค่ 800
   */
  spendableNow: number
  /** true เมื่อเงินจริงเป็นตัวจำกัด ไม่ใช่งบ */
  limitedByBalance: boolean
  daysInMonth: number
  /** จำนวนวันที่ยังใช้เงินได้ นับวันนี้ด้วย · 0 เมื่อดูเดือนที่ผ่านไปแล้ว */
  daysLeft: number
  /** เกลี่ยเงินที่ใช้ได้จริงจนสิ้นเดือนแล้วได้วันละเท่าไร */
  dailyAllowance: number
  /** เดือนนี้เดินไปแล้วกี่เปอร์เซ็นต์ ใช้เทียบกับงบที่ใช้ไป */
  monthProgressPercent: number
  /** ใช้งบไปแล้วกี่เปอร์เซ็นต์ */
  budgetUsedPercent: number
  pace: BudgetPace
  isCurrentMonth: boolean
}

const daysInCalendarMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber, 0).getDate()
}

const pacingOf = (budgetUsedPercent: number, monthProgressPercent: number): BudgetPace => {
  if (budgetUsedPercent > monthProgressPercent + PACE_TOLERANCE_POINTS) return 'behind'
  if (budgetUsedPercent < monthProgressPercent - PACE_TOLERANCE_POINTS) return 'ahead'
  return 'ontrack'
}

/**
 * ยอดคงเหลือสะสมถึงวันที่กำหนด นับทุกหมวดตามจริง
 * ไม่ตัดตามเดือนที่เลือก เพราะเงินที่มีอยู่จริงคือผลของทุกเดือนที่ผ่านมา
 */
export const sumAvailableBalance = (transactions: Transaction[], today: string) =>
  transactions.reduce((balance, transaction) => {
    if (transaction.transaction_date > today) return balance

    const amount = Number(transaction.amount)
    if (!Number.isFinite(amount)) return balance

    return transaction.type === 'income' ? balance + amount : balance - amount
  }, 0)

/**
 * ตอบคำถามว่า "ตอนนี้งบเหลือให้ใช้จริงเท่าไร"
 *
 * งบที่ตั้งไว้เป็นแค่แผน เงินที่มีอยู่จริงคือเพดานจริง จึงต้องเอาสองอย่างมาชนกัน
 * แล้วบอกค่าที่น้อยกว่า พร้อมเกลี่ยเป็นรายวันให้ตัดสินใจได้ทันทีในวันนี้
 */
export const buildBudgetPacing = (
  summary: BudgetComparisonSummary,
  options: { transactions: Transaction[]; month: string; today: string },
): BudgetPacing => {
  const { transactions, month, today } = options
  const availableBalance = sumAvailableBalance(transactions, today)
  const budgetRemaining = summary.totalBudget - summary.totalActual
  const spendableNow = Math.min(budgetRemaining, availableBalance)
  const daysInMonth = daysInCalendarMonth(month)
  const isCurrentMonth = today.slice(0, 7) === month

  // เดือนที่ผ่านไปแล้วไม่มีวันเหลือให้วางแผน · เดือนอนาคตถือว่ายังไม่เริ่มใช้
  const dayOfMonth = isCurrentMonth
    ? Number(today.slice(8, 10))
    : today.slice(0, 7) > month
      ? daysInMonth
      : 0
  const daysLeft = isCurrentMonth ? Math.max(daysInMonth - dayOfMonth + 1, 1) : 0
  const monthProgressPercent = (dayOfMonth / daysInMonth) * 100
  const budgetUsedPercent =
    summary.totalBudget > 0 ? (summary.totalActual / summary.totalBudget) * 100 : 0

  return {
    availableBalance,
    budgetRemaining,
    spendableNow,
    limitedByBalance: availableBalance < budgetRemaining,
    daysInMonth,
    daysLeft,
    dailyAllowance: daysLeft > 0 ? Math.max(spendableNow, 0) / daysLeft : 0,
    monthProgressPercent,
    budgetUsedPercent,
    pace: pacingOf(budgetUsedPercent, monthProgressPercent),
    isCurrentMonth,
  }
}

/**
 * เทียบงบรายหมวดกับรายจ่ายจริงของเดือนที่เลือก
 *
 * นับเฉพาะ type = 'expense' เพราะงบเป็นเรื่องของการใช้จ่าย
 * หมวดที่ตั้งงบไว้แต่ยังไม่มีรายการก็ต้องแสดง เพื่อให้เห็นว่างบยังว่างอยู่
 */
export const buildBudgetComparison = (
  transactions: Transaction[],
  budgets: CategoryBudget[],
  month: string,
  palette: readonly string[] = categoryPalette,
): BudgetComparisonSummary => {
  const spent = new Map<string, { amount: number; count: number }>()
  let monthTotal = 0

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue
    if (transaction.transaction_date.slice(0, 7) !== month) continue

    const amount = Number(transaction.amount)
    if (!Number.isFinite(amount)) continue

    const key = transaction.category ?? ''
    const group = spent.get(key) ?? { amount: 0, count: 0 }
    group.amount += amount
    group.count += 1
    spent.set(key, group)
    monthTotal += amount
  }

  const budgetedCategories = new Set(budgets.map((item) => item.category))

  const items = budgets
    .map((item) => {
      const actual = spent.get(item.category)?.amount ?? 0
      const percentage = item.budget > 0 ? (actual / item.budget) * 100 : 0

      return {
        category: item.category,
        label: item.category,
        emoji: getCategoryEmoji(item.category),
        color: '',
        budget: item.budget,
        actual,
        remaining: item.budget - actual,
        percentage,
        status: statusOf(percentage),
        transactionCount: spent.get(item.category)?.count ?? 0,
      }
    })
    .sort((a, b) => {
      // ค่าอาหารกับค่าเดินทางต้องอยู่หัวตารางงบเสมอ เพราะเป็นสองหมวดที่ลดได้จริงในวันนี้
      const byPriority = compareCategoryPriority(a.category, b.category)
      if (byPriority !== 0) return byPriority

      const byPercentage = b.percentage - a.percentage
      return byPercentage !== 0 ? byPercentage : b.budget - a.budget
    })
    .map((item, index) => ({ ...item, color: palette[index % palette.length] }))

  const noBudgetCategories = [...spent.entries()]
    .filter(([key]) => !budgetedCategories.has(key as TransactionCategory))
    .map(([key, group]) => ({
      category: (key || null) as TransactionCategory | null,
      label: key || 'ไม่ระบุหมวดหมู่',
      emoji: key ? getCategoryEmoji(key as TransactionCategory) : '🏷️',
      actual: group.amount,
      transactionCount: group.count,
    }))
    .sort((a, b) => compareCategoryPriority(a.category, b.category) || b.actual - a.actual)

  return {
    items,
    totalBudget: items.reduce((sum, item) => sum + item.budget, 0),
    totalActual: items.reduce((sum, item) => sum + item.actual, 0),
    overBudgetCount: items.filter((item) => item.status === 'over').length,
    underBudgetCount: items.filter((item) => item.status !== 'over').length,
    totalRemaining: items.reduce((sum, item) => sum + Math.max(item.remaining, 0), 0),
    totalOverspend: items.reduce((sum, item) => sum + Math.max(-item.remaining, 0), 0),
    noBudgetCategories,
    monthTotal,
  }
}
