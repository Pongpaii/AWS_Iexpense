import {
  getCategoryEmoji,
  type Transaction,
  type TransactionCategory,
  type TransactionType,
} from '../types/transaction'
import { categoryPalette } from './categoryBreakdown'

/** สิ่งที่ผู้ใช้จ่ายซ้ำ ๆ รวมรายการที่ชื่อเหมือนกันเข้าเป็นก้อนเดียว */
export interface SpendingHabit {
  /** ไอดีคงที่ที่คิดจากชื่อ ใช้จำตำแหน่งฟองข้ามการวาดใหม่ */
  id: number
  name: string
  count: number
  total: number
  lastDate: string
  category: TransactionCategory | null
}

export interface HabitGroup {
  key: string
  label: string
  emoji: string
  color: string
  habits: SpendingHabit[]
  count: number
  total: number
}

export interface SpendingHabitSummary {
  groups: HabitGroup[]
  habitCount: number
  transactionCount: number
}

const UNCATEGORIZED_KEY = '__uncategorized__'

/** djb2 แบบสั้น ให้ไอดีตัวเลขที่คงที่จากชื่อเดียวกันทุกครั้ง */
const hashName = (value: string) => {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

/** ชื่อที่ต่างกันแค่ตัวพิมพ์หรือช่องว่าง ถือว่าเป็นสิ่งเดียวกัน */
const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export const buildSpendingHabits = (
  transactions: Transaction[],
  type: TransactionType,
  palette: readonly string[] = categoryPalette,
): SpendingHabitSummary => {
  const habits = new Map<string, SpendingHabit & { categoryKey: string }>()
  let transactionCount = 0

  for (const transaction of transactions) {
    if (transaction.type !== type) continue

    const categoryKey = transaction.category ?? UNCATEGORIZED_KEY
    const mapKey = `${categoryKey}::${normalizeName(transaction.description)}`
    const amount = Number(transaction.amount)
    const existing = habits.get(mapKey)
    transactionCount += 1

    if (existing) {
      existing.count += 1
      existing.total += amount
      if (transaction.transaction_date > existing.lastDate) {
        existing.lastDate = transaction.transaction_date
      }
      continue
    }

    habits.set(mapKey, {
      id: hashName(mapKey),
      name: transaction.description.trim(),
      count: 1,
      total: amount,
      lastDate: transaction.transaction_date,
      category: transaction.category,
      categoryKey,
    })
  }

  const grouped = new Map<string, HabitGroup>()

  for (const habit of habits.values()) {
    const group = grouped.get(habit.categoryKey) ?? {
      key: habit.categoryKey,
      label: habit.category ?? 'ไม่ระบุหมวดหมู่',
      emoji: habit.category ? getCategoryEmoji(habit.category) : '🏷️',
      color: palette[0] ?? '#398d67',
      habits: [],
      count: 0,
      total: 0,
    }

    group.habits.push({
      id: habit.id,
      name: habit.name,
      count: habit.count,
      total: habit.total,
      lastDate: habit.lastDate,
      category: habit.category,
    })
    group.count += habit.count
    group.total += habit.total
    grouped.set(habit.categoryKey, group)
  }

  // เรียงหมวดที่ใช้บ่อยที่สุดไว้ก่อน แล้วให้สีตามลำดับเดียวกับกราฟวงกลม
  const groups = [...grouped.values()]
    .sort((left, right) => right.count - left.count || right.total - left.total)
    .map((group, index) => ({
      ...group,
      color: palette[index % palette.length],
      habits: group.habits.sort(
        (left, right) => right.count - left.count || right.total - left.total,
      ),
    }))

  return {
    groups,
    habitCount: habits.size,
    transactionCount,
  }
}
