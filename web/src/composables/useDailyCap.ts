import { computed, readonly, ref } from 'vue'
import {
  transactionCategories,
  type Transaction,
  type TransactionCategory,
} from '../types/transaction'

/** วันทำงาน (จ.-ศ.) หรือวันหยุด (ส.-อา.) */
export type DayKind = 'weekday' | 'weekend'

/** ช่วงเวลาแบบ 'HH:MM' ข้ามเที่ยงคืนได้ (start มากกว่า end) */
export interface CapTimeWindow {
  start: string
  end: string
}

export interface CapPlanItem {
  id: string
  emoji: string
  label: string
  amount: number
  /** คำที่ใช้เลือกช่องภายในหมวดเดียวกัน เทียบกับชื่อรายการ */
  keywords: string[]
  /** ช่วงเวลาที่ถือว่าเป็นช่องนี้ ใช้เลือกช่องภายในหมวดเดียวกันเท่านั้น */
  timeWindow: CapTimeWindow | null
  /**
   * หมวดหมู่ที่ช่องนี้รับผิดชอบ เป็นตัวคัดกลุ่มก่อนคำและเวลา
   * null = ช่องรวม รับหมวดที่ไม่มีช่องเฉพาะของตัวเอง
   */
  category: TransactionCategory | null
}

export interface DailyCapProfile {
  /** เพดานรายจ่ายของวัน (บาท) */
  cap: number
  /** แผนค่าใช้จ่ายย่อยที่ตั้งใจใช้ในวันนั้น */
  items: CapPlanItem[]
}

export interface DailyCapSettings {
  enabled: boolean
  weekday: DailyCapProfile
  weekend: DailyCapProfile
  /**
   * หมวดที่ไม่ต้องเอามานับในงบรายวัน
   *
   * ทำไม: ค่าที่พัก ค่าบิล หรือค่าเรียนเป็นก้อนใหญ่ที่จ่ายเป็นรอบ ไม่ใช่เงินใช้ประจำวัน
   * ถ้าปล่อยให้เข้าหลอด งบวันนั้นจะแดงทั้งวันทั้งที่การใช้จ่ายรายวันยังปกติ
   * ยอดคงเหลือและสรุปยอดยังนับทุกหมวดตามจริง ตรงนี้กันแค่มุมมองงบรายวัน
   */
  excludedCategories: TransactionCategory[]
}

export const MAX_DAILY_CAP = 1_000_000
export const MAX_PLAN_ITEMS = 10

export const DAILY_CAP_STORAGE_KEY = 'money-flow.daily-cap.v1'

/** v1 จับคู่ด้วยเวลาก่อนหมวดหมู่ · v2 ใช้หมวดหมู่คัดกลุ่มก่อน · v3 กันหมวดออกจากงบได้ */
const CURRENT_VERSION = 3

export const dayKindLabels: Record<DayKind, string> = {
  weekday: 'วันทำงาน (จ.-ศ.)',
  weekend: 'วันหยุด (ส.-อา.)',
}

export const dayKindEmojis: Record<DayKind, string> = {
  weekday: '📅',
  weekend: '🌤️',
}

const breakfastKeywords = ['เช้า', 'breakfast']
const lunchKeywords = ['กลางวัน', 'เที่ยง', 'lunch']
const dinnerKeywords = ['เย็น', 'ค่ำ', 'dinner']

const breakfastWindow: CapTimeWindow = { start: '05:00', end: '11:59' }
const lunchWindow: CapTimeWindow = { start: '12:00', end: '14:59' }
const dinnerWindow: CapTimeWindow = { start: '15:00', end: '04:59' }

const createDefaultSettings = (): DailyCapSettings => ({
  enabled: true,
  excludedCategories: [],
  weekday: {
    cap: 320,
    items: [
      {
        id: 'weekday-breakfast',
        emoji: '🍜',
        label: 'เช้า',
        amount: 65,
        keywords: [...breakfastKeywords],
        timeWindow: { ...breakfastWindow },
        category: 'อาหาร',
      },
      {
        id: 'weekday-lunch',
        emoji: '🍜',
        label: 'กลางวัน',
        amount: 70,
        keywords: [...lunchKeywords],
        timeWindow: { ...lunchWindow },
        category: 'อาหาร',
      },
      {
        id: 'weekday-dinner',
        emoji: '🍜',
        label: 'เย็น',
        amount: 70,
        keywords: [...dinnerKeywords],
        timeWindow: { ...dinnerWindow },
        category: 'อาหาร',
      },
      {
        id: 'weekday-commute',
        emoji: '🚗',
        label: 'เดินทาง',
        amount: 77,
        keywords: [],
        timeWindow: null,
        category: 'การเดินทาง',
      },
      {
        id: 'weekday-other',
        emoji: '✨',
        label: 'อื่น ๆ',
        amount: 38,
        keywords: [],
        timeWindow: null,
        category: null,
      },
    ],
  },
  weekend: {
    cap: 243,
    items: [
      {
        id: 'weekend-breakfast',
        emoji: '🍜',
        label: 'เช้า',
        amount: 65,
        keywords: [...breakfastKeywords],
        timeWindow: { ...breakfastWindow },
        category: 'อาหาร',
      },
      {
        id: 'weekend-lunch',
        emoji: '🍜',
        label: 'กลางวัน',
        amount: 70,
        keywords: [...lunchKeywords],
        timeWindow: { ...lunchWindow },
        category: 'อาหาร',
      },
      {
        id: 'weekend-dinner',
        emoji: '🍜',
        label: 'เย็น',
        amount: 70,
        keywords: [...dinnerKeywords],
        timeWindow: { ...dinnerWindow },
        category: 'อาหาร',
      },
      {
        id: 'weekend-other',
        emoji: '✨',
        label: 'อื่น ๆ',
        amount: 38,
        keywords: [],
        timeWindow: null,
        category: null,
      },
    ],
  },
})

export const defaultDailyCapSettings = createDefaultSettings()

const defaultItemById = new Map(
  [...defaultDailyCapSettings.weekday.items, ...defaultDailyCapSettings.weekend.items].map(
    (item) => [item.id, item] as const,
  ),
)

export const MAX_PLAN_KEYWORDS = 8

export const parseKeywords = (input: string) =>
  input
    .split(',')
    .map((keyword) => keyword.trim().slice(0, 24))
    .filter((keyword, index, list) => keyword.length > 0 && list.indexOf(keyword) === index)
    .slice(0, MAX_PLAN_KEYWORDS)

export const formatKeywords = (keywords: readonly string[]) => keywords.join(', ')

export const createPlanItemId = () =>
  `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const normalizeAmount = (value: unknown, max: number) => {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > max) return null
  return Math.round(amount * 100) / 100
}

const normalizeCap = (value: unknown) => {
  const cap = normalizeAmount(value, MAX_DAILY_CAP)
  if (cap === null || cap <= 0) return null
  return cap
}

const normalizeKeywords = (value: readonly unknown[]) =>
  parseKeywords(value.filter((keyword): keyword is string => typeof keyword === 'string').join(','))

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const isValidTimeOfDay = (value: string) => TIME_PATTERN.test(value)

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const formatTimeWindow = (window: CapTimeWindow) => `${window.start}–${window.end}`

/** true เมื่อนาทีที่ให้มาอยู่ในช่วง รองรับช่วงที่ข้ามเที่ยงคืน เช่น 15:00–04:59 */
export const isWithinTimeWindow = (window: CapTimeWindow, minutesOfDay: number) => {
  const start = toMinutes(window.start)
  const end = toMinutes(window.end)
  return start <= end
    ? minutesOfDay >= start && minutesOfDay <= end
    : minutesOfDay >= start || minutesOfDay <= end
}

const normalizeTimeWindow = (value: unknown): CapTimeWindow | null => {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.start !== 'string' || typeof raw.end !== 'string') return null
  if (!isValidTimeOfDay(raw.start) || !isValidTimeOfDay(raw.end)) return null
  return { start: raw.start, end: raw.end }
}

const normalizeCategory = (value: unknown): TransactionCategory | null => {
  if (typeof value !== 'string') return null
  return transactionCategories.some((option) => option.value === value)
    ? (value as TransactionCategory)
    : null
}

const normalizeItem = (value: unknown, index: number): CapPlanItem | null => {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const amount = normalizeAmount(raw.amount, MAX_DAILY_CAP)
  if (amount === null) return null

  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 24) : ''
  const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim().slice(0, 4) : ''
  const id =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 48) : `plan-${index}`
  const preset = defaultItemById.get(id)

  // ข้อมูลที่บันทึกไว้ก่อนมีตัวจับคู่ จะยังไม่มีฟิลด์ keywords ให้ย้อนใช้ค่าเริ่มต้นของช่องนั้น
  const keywords = Array.isArray(raw.keywords)
    ? normalizeKeywords(raw.keywords)
    : [...(preset?.keywords ?? [])]

  const category = normalizeCategory('category' in raw ? raw.category : (preset?.category ?? null))

  const timeWindow =
    'timeWindow' in raw
      ? normalizeTimeWindow(raw.timeWindow)
      : preset?.timeWindow
        ? { ...preset.timeWindow }
        : null

  return {
    id,
    emoji: emoji || '💸',
    label: label || `รายการที่ ${index + 1}`,
    amount,
    keywords,
    timeWindow,
    category,
  }
}

const normalizeProfile = (value: unknown, fallback: DailyCapProfile): DailyCapProfile => {
  if (typeof value !== 'object' || value === null)
    return { cap: fallback.cap, items: [...fallback.items] }
  const raw = value as Record<string, unknown>

  const items = Array.isArray(raw.items)
    ? raw.items
        .slice(0, MAX_PLAN_ITEMS)
        .map((item, index) => normalizeItem(item, index))
        .filter((item): item is CapPlanItem => item !== null)
    : [...fallback.items]

  return {
    cap: normalizeCap(raw.cap) ?? fallback.cap,
    items,
  }
}

/** หมวดที่กันออกจากงบรายวันได้ · ไม่รวมเงินเดือนเพราะเป็นรายรับ ไม่เคยเข้าหลอดงบ */
export const capExcludableCategories = transactionCategories.filter(
  (option) => option.value !== 'เงินเดือน',
)

const normalizeExcludedCategories = (value: unknown): TransactionCategory[] => {
  if (!Array.isArray(value)) return []

  return value
    .filter(
      (item): item is TransactionCategory =>
        typeof item === 'string' && capExcludableCategories.some((option) => option.value === item),
    )
    .filter((category, index, list) => list.indexOf(category) === index)
}

const normalizeSettings = (value: unknown): DailyCapSettings => {
  const fallback = createDefaultSettings()
  if (typeof value !== 'object' || value === null) return fallback
  const raw = value as Record<string, unknown>

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    excludedCategories: normalizeExcludedCategories(raw.excludedCategories),
    weekday: normalizeProfile(raw.weekday, fallback.weekday),
    weekend: normalizeProfile(raw.weekend, fallback.weekend),
  }
}

/**
 * ค่าที่บันทึกจาก v1 ยังไม่ผูกหมวดหมู่กับช่องมื้ออาหาร (เก็บเป็น null)
 * ถ้าปล่อยไว้ ช่องเหล่านั้นจะกลายเป็นช่องรวมและดูดรายจ่ายหมวดอื่นเข้ามา
 * จึงเติมหมวดหมู่จากค่าเริ่มต้นของช่องเดิมให้ก่อนใช้งาน
 */
const migrateStoredPayload = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const raw = value as Record<string, unknown>
  if (Number(raw.version) >= CURRENT_VERSION) return raw

  const migrateProfile = (profileValue: unknown) => {
    if (typeof profileValue !== 'object' || profileValue === null) return profileValue
    const profile = profileValue as Record<string, unknown>
    if (!Array.isArray(profile.items)) return profile

    return {
      ...profile,
      items: profile.items.map((itemValue) => {
        if (typeof itemValue !== 'object' || itemValue === null) return itemValue
        const item = itemValue as Record<string, unknown>
        if (item.category) return item

        const preset = typeof item.id === 'string' ? defaultItemById.get(item.id) : undefined
        return preset ? { ...item, category: preset.category } : item
      }),
    }
  }

  return {
    ...raw,
    version: CURRENT_VERSION,
    weekday: migrateProfile(raw.weekday),
    weekend: migrateProfile(raw.weekend),
  }
}

const parseStored = (stored: string) =>
  normalizeSettings(migrateStoredPayload(JSON.parse(stored) as unknown))

const loadSettings = (): DailyCapSettings => {
  if (typeof window === 'undefined') return createDefaultSettings()

  try {
    const stored = window.localStorage.getItem(DAILY_CAP_STORAGE_KEY)
    if (!stored) return createDefaultSettings()
    return parseStored(stored)
  } catch {
    return createDefaultSettings()
  }
}

const settings = ref<DailyCapSettings>(loadSettings())
const readonlySettings = readonly(settings)

export interface CapSaveResult {
  ok: boolean
  persisted: boolean
  reason?: 'invalid-cap' | 'invalid-item' | 'invalid-time'
}

let serverCapSaver: ((value: DailyCapSettings) => void | Promise<void>) | null = null

const persist = (): boolean => {
  let persisted: boolean
  try {
    window.localStorage.setItem(
      DAILY_CAP_STORAGE_KEY,
      JSON.stringify({ version: CURRENT_VERSION, ...settings.value }),
    )
    persisted = true
  } catch {
    persisted = false
  }

  void serverCapSaver?.(settings.value)
  return persisted
}

/** จ.-ศ. คืน 'weekday' · ส.-อา. คืน 'weekend' */
export const dayKindForDate = (isoDate: string): DayKind => {
  const day = new Date(`${isoDate}T12:00:00`).getDay()
  return day === 0 || day === 6 ? 'weekend' : 'weekday'
}

export const sumPlanItems = (items: readonly Pick<CapPlanItem, 'amount'>[]) =>
  Math.round(items.reduce((total, item) => total + Number(item.amount || 0), 0) * 100) / 100

export interface PlanItemProgress {
  item: CapPlanItem
  /** ยอดที่จ่ายไปแล้วในช่องนี้ */
  spent: number
  /** จำนวนรายการที่จับคู่เข้าช่องนี้ */
  count: number
  remaining: number
  ratio: number
  percent: number
  level: 'empty' | 'safe' | 'watch' | 'warn' | 'full' | 'over'
}

export interface DailyPlanProgress {
  items: PlanItemProgress[]
  /** รายจ่ายที่จับคู่กับช่องในแผนไม่ได้ */
  unplanned: number
  unplannedCount: number
  /** จำนวนรายการนอกแผนที่ไม่มีเวลาให้ใช้ตัดสิน (จดย้อนหลัง) */
  unplannedWithoutTime: number
}

const progressLevel = (spent: number, target: number): PlanItemProgress['level'] => {
  if (spent <= 0) return 'empty'
  if (target <= 0) return 'over'
  const ratio = spent / target
  if (ratio > 1) return 'over'
  if (ratio >= 1) return 'full'
  if (ratio >= 0.8) return 'warn'
  if (ratio >= 0.5) return 'watch'
  return 'safe'
}

const toLocalIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type MatchableTransaction = Pick<
  Transaction,
  'description' | 'category' | 'created_at' | 'transaction_date'
>

/**
 * นาทีของวันที่กดบันทึกรายการนี้ (0-1439)
 *
 * ใช้ได้เฉพาะเมื่อวันที่ของรายการตรงกับวันที่กดบันทึก ถ้าเป็นการจดย้อนหลัง
 * เวลาใน created_at เป็นเวลาที่นั่งจดไม่ใช่เวลาที่ใช้เงิน จึงคืน null
 */
export const recordedMinutesOfDay = (transaction: MatchableTransaction): number | null => {
  if (!transaction.created_at) return null

  const created = new Date(transaction.created_at)
  if (Number.isNaN(created.getTime())) return null
  if (toLocalIsoDate(created) !== transaction.transaction_date) return null

  return created.getHours() * 60 + created.getMinutes()
}

const matchByKeyword = (items: readonly CapPlanItem[], description: string) =>
  items.find((item) =>
    item.keywords.some((keyword) => keyword && description.includes(keyword.toLowerCase())),
  ) ?? null

const matchByTime = (items: readonly CapPlanItem[], minutesOfDay: number | null) =>
  minutesOfDay === null
    ? null
    : (items.find((item) => item.timeWindow && isWithinTimeWindow(item.timeWindow, minutesOfDay)) ??
      null)

/**
 * เลือกช่องภายในกลุ่มที่หมวดหมู่ตรงกันแล้ว
 * 1. คำในชื่อรายการ (ผู้ใช้เขียนเองชัดที่สุด เช่น "ข้าวเย็น")
 * 2. ช่วงเวลาที่กดบันทึก
 * 3. ช่องที่ไม่ผูกเวลา (รับทุกเวลาของหมวดนั้น)
 * 4. ถ้าหมวดนั้นมีช่องเดียว ก็เข้าช่องนั้น
 */
const pickWithinGroup = (
  group: readonly CapPlanItem[],
  description: string,
  minutesOfDay: number | null,
): CapPlanItem | null => {
  if (!group.length) return null

  return (
    matchByKeyword(group, description) ??
    matchByTime(group, minutesOfDay) ??
    group.find((item) => item.timeWindow === null) ??
    (group.length === 1 ? group[0] : null)
  )
}

/**
 * หาช่องในแผนที่รายจ่ายนี้ควรถูกนับ โดยยึด "หมวดหมู่" เป็นหลัก
 *
 * - หมวดหมู่คัดกลุ่มก่อน: ค่าอาหารเข้าช่องอาหาร ค่าเดินทางเข้าช่องเดินทาง
 *   ไม่ว่าจะจ่ายกี่โมงก็ตาม
 * - เวลากับคำในชื่อรายการใช้เลือกช่องย่อย "ภายในหมวดเดียวกัน" เท่านั้น
 *   เช่น อาหารมีช่องเช้า/กลางวัน/เย็น
 * - หมวดที่ไม่มีช่องเฉพาะจะไปรวมที่ช่องรวม (ช่องที่ไม่ผูกหมวดหมู่)
 *
 * รายจ่ายหนึ่งรายการนับได้ช่องเดียว ผลรวมจึงไม่ซ้อนกัน
 */
export const matchPlanItem = (
  items: readonly CapPlanItem[],
  transaction: MatchableTransaction,
): CapPlanItem | null => {
  const description = (transaction.description ?? '').toLowerCase()
  const minutes = recordedMinutesOfDay(transaction)
  const category = transaction.category ?? null
  const catchAll = items.filter((item) => item.category === null)

  // ไม่ได้เลือกหมวดหมู่ไว้ ใช้ได้แค่คำกับเวลา ถ้ายังไม่รู้ก็ลงช่องรวม
  if (category === null) {
    return (
      matchByKeyword(items, description) ??
      matchByTime(items, minutes) ??
      pickWithinGroup(catchAll, description, minutes)
    )
  }

  const sameCategory = items.filter((item) => item.category === category)
  return sameCategory.length
    ? pickWithinGroup(sameCategory, description, minutes)
    : pickWithinGroup(catchAll, description, minutes)
}

/** ช่องในแผนที่ตรงกับเวลาปัจจุบัน ใช้ทำเครื่องหมาย "ตอนนี้" */
export const activePlanItemAt = (items: readonly CapPlanItem[], at: Date = new Date()) => {
  const minutes = at.getHours() * 60 + at.getMinutes()
  return (
    items.find((item) => item.timeWindow && isWithinTimeWindow(item.timeWindow, minutes)) ?? null
  )
}

/** สรุปว่าแต่ละช่องในแผนใช้ไปเท่าไรจากรายจ่ายของวันนั้น */
export const buildPlanProgress = (
  items: readonly CapPlanItem[],
  transactions: readonly Transaction[],
): DailyPlanProgress => {
  const spentById = new Map<string, { spent: number; count: number }>()
  let unplanned = 0
  let unplannedCount = 0
  let unplannedWithoutTime = 0

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue
    const amount = Number(transaction.amount) || 0
    const matched = matchPlanItem(items, transaction)

    if (!matched) {
      unplanned += amount
      unplannedCount += 1
      if (recordedMinutesOfDay(transaction) === null) unplannedWithoutTime += 1
      continue
    }

    const bucket = spentById.get(matched.id) ?? { spent: 0, count: 0 }
    bucket.spent += amount
    bucket.count += 1
    spentById.set(matched.id, bucket)
  }

  const round = (value: number) => Math.round(value * 100) / 100

  return {
    items: items.map((item) => {
      const bucket = spentById.get(item.id) ?? { spent: 0, count: 0 }
      const spent = round(bucket.spent)
      const target = Number(item.amount) || 0
      const ratio = target > 0 ? spent / target : spent > 0 ? Infinity : 0

      return {
        item,
        spent,
        count: bucket.count,
        remaining: round(target - spent),
        ratio,
        percent: Number.isFinite(ratio) ? Math.round(ratio * 100) : 999,
        level: progressLevel(spent, target),
      }
    }),
    unplanned: round(unplanned),
    unplannedCount,
    unplannedWithoutTime,
  }
}

export interface CountedExpenses {
  /** รายจ่ายที่ต้องนับในงบรายวัน */
  counted: Transaction[]
  /** ยอดรวมของหมวดที่ถูกกันออก ใช้บอกผู้ใช้ว่ากันไปเท่าไร */
  excludedTotal: number
  excludedCount: number
}

/**
 * แยกรายจ่ายของวันออกเป็น "นับในงบ" กับ "กันออก"
 *
 * ยอดที่กันออกไม่ได้หายไปจากแอป แค่ไม่เข้าหลอดงบรายวัน ยอดคงเหลือและการ์ดสรุป
 * ยังคิดจากรายการทุกหมวดตามจริงเสมอ
 */
export const splitCountedExpenses = (
  transactions: readonly Transaction[],
  excludedCategories: readonly TransactionCategory[] = [],
): CountedExpenses => {
  const excluded = new Set<TransactionCategory>(excludedCategories)
  const counted: Transaction[] = []
  let excludedTotal = 0
  let excludedCount = 0

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue

    if (transaction.category != null && excluded.has(transaction.category)) {
      excludedTotal += Number(transaction.amount) || 0
      excludedCount += 1
      continue
    }

    counted.push(transaction)
  }

  return { counted, excludedTotal: Math.round(excludedTotal * 100) / 100, excludedCount }
}

const setCapEnabled = (enabled: boolean): CapSaveResult => {
  settings.value = { ...settings.value, enabled }
  return { ok: true, persisted: persist() }
}

const saveProfile = (kind: DayKind, profile: DailyCapProfile): CapSaveResult => {
  const cap = normalizeCap(profile.cap)
  if (cap === null) return { ok: false, persisted: false, reason: 'invalid-cap' }

  const items: CapPlanItem[] = []
  for (const [index, item] of profile.items.slice(0, MAX_PLAN_ITEMS).entries()) {
    const amount = normalizeAmount(item.amount, MAX_DAILY_CAP)
    if (amount === null) return { ok: false, persisted: false, reason: 'invalid-item' }

    const timeWindow = item.timeWindow ? normalizeTimeWindow(item.timeWindow) : null
    if (item.timeWindow && timeWindow === null) {
      return { ok: false, persisted: false, reason: 'invalid-time' }
    }

    items.push({
      id: item.id || createPlanItemId(),
      emoji: (item.emoji || '').trim().slice(0, 4) || '💸',
      label: (item.label || '').trim().slice(0, 24) || `รายการที่ ${index + 1}`,
      amount,
      keywords: normalizeKeywords(item.keywords ?? []),
      timeWindow,
      category: normalizeCategory(item.category),
    })
  }

  settings.value = { ...settings.value, [kind]: { cap, items } }
  return { ok: true, persisted: persist() }
}

const resetProfile = (kind: DayKind): CapSaveResult => {
  const defaults = createDefaultSettings()
  settings.value = { ...settings.value, [kind]: defaults[kind] }
  return { ok: true, persisted: persist() }
}

const setCapCategoryExcluded = (
  category: TransactionCategory,
  excluded: boolean,
): CapSaveResult => {
  if (!capExcludableCategories.some((option) => option.value === category)) {
    return { ok: false, persisted: false }
  }

  const current = settings.value.excludedCategories
  if (excluded === current.includes(category)) return { ok: true, persisted: true }

  settings.value = {
    ...settings.value,
    excludedCategories: excluded
      ? [...current, category]
      : current.filter((item) => item !== category),
  }
  return { ok: true, persisted: persist() }
}

const toggleCapCategoryExcluded = (category: TransactionCategory) =>
  setCapCategoryExcluded(category, !settings.value.excludedCategories.includes(category))

const clearCapExcludedCategories = (): CapSaveResult => {
  if (settings.value.excludedCategories.length === 0) return { ok: true, persisted: true }
  settings.value = { ...settings.value, excludedCategories: [] }
  return { ok: true, persisted: persist() }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== DAILY_CAP_STORAGE_KEY) return
    if (event.newValue === null) {
      settings.value = createDefaultSettings()
      return
    }

    try {
      settings.value = parseStored(event.newValue)
    } catch {
      /* ค่าที่อ่านไม่ได้ ให้คงค่าปัจจุบันไว้ */
    }
  })
}

const capEnabled = computed(() => settings.value.enabled)
const capExcludedCategories = computed(() => settings.value.excludedCategories)
const hasCapExcludedCategories = computed(() => settings.value.excludedCategories.length > 0)

const clonePlanItem = (item: CapPlanItem): CapPlanItem => ({
  ...item,
  keywords: [...item.keywords],
  timeWindow: item.timeWindow ? { ...item.timeWindow } : null,
})

/** สำเนาโปรไฟล์แบบแก้ไขได้ ใช้เป็น draft ในหน้าตั้งค่า */
const cloneProfile = (kind: DayKind): DailyCapProfile => ({
  cap: settings.value[kind].cap,
  items: settings.value[kind].items.map(clonePlanItem),
})

export const applyServerDailyCap = (value: unknown) => {
  settings.value = normalizeSettings(value)
  try {
    window.localStorage.setItem(
      DAILY_CAP_STORAGE_KEY,
      JSON.stringify({ version: CURRENT_VERSION, ...settings.value }),
    )
  } catch {
    // Keep the server value in memory when local cache is unavailable.
  }
}

export const cloneDailyCapSettings = (value: DailyCapSettings): DailyCapSettings => ({
  enabled: value.enabled,
  excludedCategories: [...(value.excludedCategories ?? [])],
  weekday: {
    cap: value.weekday.cap,
    items: value.weekday.items.map(clonePlanItem),
  },
  weekend: {
    cap: value.weekend.cap,
    items: value.weekend.items.map(clonePlanItem),
  },
})

export const getDailyCapSnapshot = (): DailyCapSettings => cloneDailyCapSettings(settings.value)

export const registerServerCapSaver = (
  saver: ((value: DailyCapSettings) => void | Promise<void>) | null,
) => {
  serverCapSaver = saver
}

export const useDailyCap = () => ({
  capSettings: readonlySettings,
  capEnabled,
  capExcludedCategories,
  hasCapExcludedCategories,
  capExcludableCategories,
  isCapCategoryExcluded: (category: TransactionCategory) =>
    settings.value.excludedCategories.includes(category),
  setCapCategoryExcluded,
  toggleCapCategoryExcluded,
  clearCapExcludedCategories,
  splitCountedExpenses,
  profileForKind: (kind: DayKind) => settings.value[kind],
  profileForDate: (isoDate: string) => settings.value[dayKindForDate(isoDate)],
  capForDate: (isoDate: string) => settings.value[dayKindForDate(isoDate)].cap,
  cloneProfile,
  dayKindForDate,
  sumPlanItems,
  buildPlanProgress,
  matchPlanItem,
  activePlanItemAt,
  setCapEnabled,
  saveProfile,
  resetProfile,
})
