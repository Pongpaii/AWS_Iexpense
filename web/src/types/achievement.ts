import { transactionCategories, type Transaction } from './transaction'
import { getConsecutiveDays, getLongestConsecutive, isIsoDate } from '../utils/dateUtils'

export const badgeIds = [
  'first_record',
  'streak_7',
  'streak_30',
  'saver_1000',
  'saver_10000',
  'under_cap_5',
  'category_all',
  'night_owl',
  'early_bird',
  'century',
] as const

export type BadgeId = (typeof badgeIds)[number]

/** ข้อมูลที่ badge ทุกใบใช้ตัดสินว่าปลดล็อคได้แล้วหรือยัง */
export interface AchievementContext {
  transactions: readonly Transaction[]
  /** ยอดคงเหลือรวมทั้งหมด (รายรับ - รายจ่าย) */
  balance: number
  /** เปิดใช้เพดานรายจ่ายต่อวันอยู่หรือไม่ */
  capEnabled: boolean
  /** เพดานรายจ่ายของวันนั้น (บาท) */
  capForDate: (isoDate: string) => number
  /** วันที่ใช้เป็น "วันนี้" ในรูปแบบ YYYY-MM-DD */
  today: string
}

export interface BadgeDefinition {
  id: BadgeId
  name: string
  emoji: string
  /** อธิบายเงื่อนไขให้ผู้ใช้เห็นในหน้า gallery */
  requirement: string
  /** ข้อความสั้น ๆ ตอนปลดล็อคสำเร็จ */
  celebration: string
  /** true เมื่อเงื่อนไขครบแล้ว */
  isEarned: (context: AchievementContext) => boolean
}

export interface UnlockedAchievement {
  badgeId: BadgeId
  unlockedAt: string
}

const expensesOf = (transactions: readonly Transaction[]) =>
  transactions.filter(({ type }) => type === 'expense')

const recordedDatesOf = (transactions: readonly Transaction[]) =>
  transactions.map(({ transaction_date }) => transaction_date).filter(isIsoDate)

/** ชั่วโมงใน timezone ที่บันทึกมากับรายการ; fallback เป็น timezone ของอุปกรณ์ปัจจุบัน */
const recordedHour = (transaction: Transaction) => {
  if (!transaction.created_at) return null
  const stamp = new Date(transaction.created_at)
  if (Number.isNaN(stamp.getTime())) return null

  if (transaction.client_timezone) {
    try {
      const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: transaction.client_timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(stamp)
        .find((part) => part.type === 'hour')?.value
      if (hour !== undefined) return Number(hour)
    } catch {
      // Invalid legacy timezone values fall back to the current device timezone.
    }
  }

  return stamp.getHours()
}

/** จำนวนวันติดกันมากที่สุดที่รายจ่ายรวมไม่เกินเพดานของวันนั้น (นับเฉพาะวันที่มีการจด) */
const longestUnderCapRun = (context: AchievementContext) => {
  if (!context.capEnabled) return 0

  const spentByDate = new Map<string, number>()
  for (const transaction of expensesOf(context.transactions)) {
    if (!isIsoDate(transaction.transaction_date)) continue
    spentByDate.set(
      transaction.transaction_date,
      (spentByDate.get(transaction.transaction_date) ?? 0) + (Number(transaction.amount) || 0),
    )
  }

  const underCapDates: string[] = []
  for (const [date, spent] of spentByDate) {
    const cap = context.capForDate(date)
    if (cap > 0 && spent <= cap) underCapDates.push(date)
  }

  return getLongestConsecutive(underCapDates)
}

export const badgeDefinitions: readonly BadgeDefinition[] = [
  {
    id: 'first_record',
    name: 'บันทึกแรก',
    emoji: '📝',
    requirement: 'บันทึกรายการแรกสำเร็จ',
    celebration: 'เริ่มต้นแล้ว! จดต่อไปเรื่อย ๆ นะ',
    isEarned: ({ transactions }) => transactions.length >= 1,
  },
  {
    id: 'streak_7',
    name: 'ขยัน 7 วัน',
    emoji: '🔥',
    requirement: 'บันทึกติดต่อกันครบ 7 วัน',
    celebration: 'หนึ่งสัปดาห์ไม่พลาดเลย',
    isEarned: ({ transactions, today }) =>
      getConsecutiveDays(recordedDatesOf(transactions), today) >= 7 ||
      getLongestConsecutive(recordedDatesOf(transactions)) >= 7,
  },
  {
    id: 'streak_30',
    name: 'ไม่พลาดเดือน',
    emoji: '💎',
    requirement: 'บันทึกติดต่อกันครบ 30 วัน',
    celebration: 'ครบ 30 วันติด วินัยระดับเพชร',
    isEarned: ({ transactions, today }) =>
      getConsecutiveDays(recordedDatesOf(transactions), today) >= 30 ||
      getLongestConsecutive(recordedDatesOf(transactions)) >= 30,
  },
  {
    id: 'saver_1000',
    name: 'ออม 1,000',
    emoji: '🐷',
    requirement: 'ยอดคงเหลือถึง 1,000 บาท',
    celebration: 'กระปุกเริ่มหนักแล้ว',
    isEarned: ({ balance }) => balance >= 1_000,
  },
  {
    id: 'saver_10000',
    name: 'ออม 10,000',
    emoji: '🏦',
    requirement: 'ยอดคงเหลือถึง 10,000 บาท',
    celebration: 'หลักหมื่นแล้ว เก็บต่อได้อีก',
    isEarned: ({ balance }) => balance >= 10_000,
  },
  {
    id: 'under_cap_5',
    name: 'ประหยัดจ่ายจริง',
    emoji: '🛡️',
    requirement: 'ใช้ไม่เกินเพดานรายจ่ายต่อวัน ติดกัน 5 วัน (ต้องเปิดใช้เพดานก่อน)',
    celebration: 'คุมงบได้ 5 วันติด อยู่หมัด',
    isEarned: (context) => longestUnderCapRun(context) >= 5,
  },
  {
    id: 'category_all',
    name: 'ครบทุกหมวด',
    emoji: '🌈',
    requirement: `เคยบันทึกครบทั้ง ${transactionCategories.length} หมวดหมู่ อย่างน้อยหมวดละ 1 ครั้ง`,
    celebration: 'สะสมครบทุกหมวดหมู่แล้ว',
    isEarned: ({ transactions }) => {
      const used = new Set<string>()
      for (const { category } of transactions) {
        if (category) used.add(category)
      }
      return transactionCategories.every(({ value }) => used.has(value))
    },
  },
  {
    id: 'night_owl',
    name: 'นกฮูก',
    emoji: '🦉',
    requirement: 'บันทึกรายการหลัง 23:00 น.',
    celebration: 'จดดึกขนาดนี้ ขยันจริง',
    isEarned: ({ transactions }) =>
      transactions.some((transaction) => {
        const hour = recordedHour(transaction)
        return hour !== null && hour >= 23
      }),
  },
  {
    id: 'early_bird',
    name: 'ตื่นเช้าจัง',
    emoji: '🐔',
    requirement: 'บันทึกรายการก่อน 06:00 น.',
    celebration: 'ตื่นก่อนไก่ จดก่อนใคร',
    isEarned: ({ transactions }) =>
      transactions.some((transaction) => {
        const hour = recordedHour(transaction)
        return hour !== null && hour < 6
      }),
  },
  {
    id: 'century',
    name: 'ร้อยรายการ',
    emoji: '💯',
    requirement: 'บันทึกครบ 100 รายการ',
    celebration: 'ครบ 100 รายการแล้ว สายจดตัวจริง',
    isEarned: ({ transactions }) => transactions.length >= 100,
  },
]

export const badgeById = new Map<BadgeId, BadgeDefinition>(
  badgeDefinitions.map((badge) => [badge.id, badge]),
)

export const isBadgeId = (value: unknown): value is BadgeId =>
  typeof value === 'string' && badgeIds.includes(value as BadgeId)
