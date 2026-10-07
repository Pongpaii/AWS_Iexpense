import {
  getCategoryEmoji,
  isPriorityCategory,
  type Transaction,
  type TransactionCategory,
} from '../types/transaction'
import { shiftIsoDate } from './dateUtils'
import {
  buildDailyBurnBreakdown,
  createFinancialForecast,
  FORECAST_HISTORY_DAYS,
  type ForecastConfidence,
} from './forecast'

/**
 * Runway = "เงินที่มีอยู่ตอนนี้อยู่ได้อีกกี่วัน"
 *
 * ต่างจากการ์ดคาดการณ์ 30 วันตรงที่ไม่ตอบว่า "สิ้นเดือนจะเหลือเท่าไร" แต่ตอบว่า
 * "ถ้าใช้จังหวะนี้ต่อไป เงินจะหมดวันไหน และต้องลดวันละเท่าไรจึงจะถึงวันเงินเดือน"
 * ซึ่งเป็นคำถามที่ตัดสินใจได้ทันทีในวันนี้
 */

/** เหลือเกินวันเงินเดือนไม่ถึงเท่านี้ ถือว่าเฉียดฉิว ยังไม่ปลอดภัย */
export const RUNWAY_BUFFER_DAYS = 3

export type RunwayStatus = 'insufficient' | 'safe' | 'watch' | 'risk'

/** ฉากทัศน์การใช้เงินสามแบบ เรียงจากประหยัดสุดไปหลวมสุด */
export type RunwayScenarioId = 'essential' | 'actual' | 'planned'

export interface RunwayScenario {
  id: RunwayScenarioId
  label: string
  hint: string
  /** เงินไหลออกวันละเท่าไรในฉากทัศน์นี้ */
  burnPerDay: number
  /** อยู่ได้อีกกี่วัน · null = คิดไม่ได้เพราะยังไม่รู้อัตราการใช้ */
  days: number | null
  /** วันที่เงินจะหมด · null เมื่อ days เป็น null */
  runsOutDate: string | null
  /** ถึงวันเงินเดือนถัดไปไหม */
  reachesSalary: boolean
  /** ขาดอีกกี่วันจึงจะถึงวันเงินเดือน (0 = ถึงแล้ว) */
  shortfallDays: number
  /** false = ยังไม่มีข้อมูลพอสำหรับฉากทัศน์นี้ เช่น ยังไม่เปิดงบรายวัน */
  available: boolean
}

export interface RunwayCategoryLever {
  category: TransactionCategory | null
  label: string
  emoji: string
  /** ส่วนแบ่งของหมวดนี้ในอัตราการใช้ต่อวัน */
  perDay: number
  /** สัดส่วนของ burn ทั้งหมด 0-1 */
  share: number
  /** ตัดหมวดนี้ออกหมด runway ยืดได้กี่วัน · null = ยืดได้ไม่จำกัด (ไม่เหลือรายจ่ายเลย) */
  extraDaysIfCut: number | null
  /** ลดหมวดนี้ครึ่งหนึ่ง ยืดได้กี่วัน · null = ยืดได้ไม่จำกัด */
  extraDaysIfHalved: number | null
  /** หมวดที่เกิดทุกวัน ตัดทิ้งทั้งหมดไม่ได้จริง แต่ลดได้ */
  isEssential: boolean
  /** หมวดที่ต้องแสดงขึ้นก่อนตามกฎของแอป */
  isPriority: boolean
  transactionCount: number
}

export interface RunwaySummary {
  today: string
  /** เงินที่มีอยู่จริง ณ วันนี้ นับทุกหมวดตามจริง */
  balance: number
  status: RunwayStatus
  /** ฉากทัศน์ที่ใช้เป็นพระเอกของหน้า = ตามพฤติกรรมจริง */
  primary: RunwayScenario
  scenarios: RunwayScenario[]
  nextSalaryDate: string
  daysUntilSalary: number
  /** เกลี่ยเงินที่มีให้ถึงวันเงินเดือน ได้วันละเท่าไร */
  targetDailySpend: number
  /** ต้องลดจากจังหวะตอนนี้วันละเท่าไร (0 = ไม่ต้องลด) */
  requiredDailyCut: number
  /** ต้องประหยัดรวมอีกเท่าไรจึงจะถึงวันเงินเดือน */
  requiredTotalCut: number
  /** สัดส่วนค่าอาหาร + ค่าเดินทางในอัตราการใช้ต่อวัน 0-1 */
  essentialShare: number
  essentialPerDay: number
  /** เรียงหมวดจำเป็นขึ้นก่อน แล้วค่อยจากมากไปน้อย */
  categories: RunwayCategoryLever[]
  historyDays: number
  expenseRecordCount: number
  hasSpendingData: boolean
  confidence: ForecastConfidence
  /** true = ตัวเลขยังผสมค่าอ้างอิงจากเงินเดือนอยู่ ยังไม่เชื่อข้อมูลจริงเต็มร้อย */
  isEstimateBlended: boolean
  /** ยอดคงเหลือที่คาดว่าจะเหลือตอนก่อนเงินเดือนออก (ติดลบได้) */
  balanceBeforeSalary: number
  excludedCategories: TransactionCategory[]
}

export interface RunwayOptions {
  transactions: Transaction[]
  today: string
  monthlySalary: number
  salaryDay: number
  /** เพดานรายวันที่ผู้ใช้ตั้งไว้เอง · 0 หรือไม่ส่ง = ยังไม่ได้เปิดใช้งบรายวัน */
  plannedDailyBurn?: number
  /** หมวดที่กันออกจากการคาดการณ์ (ยอดเงินคงเหลือยังนับครบตามจริง) */
  excludedCategories?: readonly TransactionCategory[]
  historyDays?: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** จำนวนวันที่เงินก้อนนี้อยู่ได้ · null เมื่อยังไม่รู้อัตราการใช้ */
const runwayDays = (balance: number, burnPerDay: number) =>
  burnPerDay > 0 ? Math.floor(Math.max(balance, 0) / burnPerDay) : null

/** ยืดได้กี่วันถ้าลด burn ลงเท่านี้ · null = ไม่มีรายจ่ายเหลือแล้ว จึงยืดได้ไม่จำกัด */
const extraDaysFromCut = (balance: number, burnPerDay: number, cut: number) => {
  const baseline = runwayDays(balance, burnPerDay)
  if (baseline === null) return 0

  const reduced = runwayDays(balance, burnPerDay - cut)
  if (reduced === null) return null
  return Math.max(0, reduced - baseline)
}

export const buildRunway = ({
  transactions,
  today,
  monthlySalary,
  salaryDay,
  plannedDailyBurn = 0,
  excludedCategories = [],
  historyDays: windowDays = FORECAST_HISTORY_DAYS,
}: RunwayOptions): RunwaySummary => {
  const forecast = createFinancialForecast({
    transactions,
    monthlySalary,
    salaryDay,
    today,
    excludedCategories,
  })
  const breakdown = buildDailyBurnBreakdown({
    transactions,
    today,
    historyDays: windowDays,
    excludedCategories,
  })

  const balance = round2(forecast.currentBalance)
  const actualBurn = round2(forecast.averageDailyExpense)

  /**
   * ตอนข้อมูลน้อย forecast จะถ่วงค่าเฉลี่ยเข้าหาค่าอ้างอิงจากเงินเดือน ทำให้
   * ผลรวมรายหมวดไม่เท่ากับตัวเลขพาดหัว จึงย่อ/ขยายรายหมวดตามสัดส่วนเดียวกัน
   * เพื่อให้ "ตัดหมวดนี้ออกยืดได้กี่วัน" คิดจากฐานเดียวกับพาดหัวเสมอ
   */
  const burnScale = breakdown.totalPerDay > 0 ? actualBurn / breakdown.totalPerDay : 0
  const essentialPerDay = round2(breakdown.essentialPerDay * burnScale)
  const essentialShare = actualBurn > 0 ? Math.min(1, essentialPerDay / actualBurn) : 0

  const daysUntilSalary = forecast.daysUntilSalary
  const buildScenario = (
    id: RunwayScenarioId,
    label: string,
    hint: string,
    burnPerDay: number,
    available: boolean,
  ): RunwayScenario => {
    const days = available ? runwayDays(balance, burnPerDay) : null
    const reachesSalary = days === null ? available : days >= daysUntilSalary

    return {
      id,
      label,
      hint,
      burnPerDay: round2(burnPerDay),
      days,
      runsOutDate: days === null ? null : shiftIsoDate(today, days),
      reachesSalary,
      shortfallDays: days === null ? 0 : Math.max(0, daysUntilSalary - days),
      available,
    }
  }

  const scenarios: RunwayScenario[] = [
    buildScenario(
      'essential',
      'เฉพาะที่จำเป็น',
      'นับแค่ค่าอาหารกับค่าเดินทาง ตัดที่เหลือออกทั้งหมด',
      essentialPerDay,
      forecast.hasSpendingData && essentialPerDay > 0,
    ),
    buildScenario(
      'actual',
      'ใช้ตามจังหวะตอนนี้',
      'ค่าเฉลี่ยที่จ่ายจริงต่อวัน',
      actualBurn,
      forecast.hasSpendingData && actualBurn > 0,
    ),
    buildScenario(
      'planned',
      'ใช้เต็มงบที่ตั้งไว้',
      'เพดานรายวันที่ตั้งไว้เอง เฉลี่ยวันทำงานกับวันหยุด',
      plannedDailyBurn,
      plannedDailyBurn > 0,
    ),
  ]

  const primary = scenarios.find((scenario) => scenario.id === 'actual') as RunwayScenario

  const targetDailySpend =
    daysUntilSalary > 0 ? Math.max(balance, 0) / daysUntilSalary : Math.max(balance, 0)
  const requiredDailyCut = Math.max(0, actualBurn - targetDailySpend)

  const categories: RunwayCategoryLever[] = breakdown.categories.map((item) => {
    const perDay = round2(item.perDay * burnScale)
    return {
      category: item.category,
      label: item.label,
      emoji: item.category ? getCategoryEmoji(item.category) : '🏷️',
      perDay,
      share: actualBurn > 0 ? perDay / actualBurn : 0,
      extraDaysIfCut: extraDaysFromCut(balance, actualBurn, perDay),
      extraDaysIfHalved: extraDaysFromCut(balance, actualBurn, perDay / 2),
      isEssential: item.isEssential,
      isPriority: isPriorityCategory(item.category),
      transactionCount: item.count,
    }
  })

  let status: RunwayStatus = 'safe'
  if (balance < 0) {
    status = 'risk'
  } else if (!forecast.hasSpendingData || primary.days === null) {
    status = 'insufficient'
  } else if (primary.days < daysUntilSalary) {
    status = 'risk'
  } else if (primary.days < daysUntilSalary + RUNWAY_BUFFER_DAYS) {
    status = 'watch'
  }

  return {
    today,
    balance,
    status,
    primary,
    scenarios,
    nextSalaryDate: forecast.nextSalaryDate,
    daysUntilSalary,
    targetDailySpend: round2(targetDailySpend),
    requiredDailyCut: round2(requiredDailyCut),
    requiredTotalCut: round2(requiredDailyCut * daysUntilSalary),
    essentialShare,
    essentialPerDay,
    categories,
    historyDays: breakdown.historyDays,
    expenseRecordCount: breakdown.expenseRecordCount,
    hasSpendingData: forecast.hasSpendingData,
    confidence: forecast.confidence,
    isEstimateBlended: forecast.isEstimateBlended,
    balanceBeforeSalary: round2(forecast.balanceBeforeSalary),
    excludedCategories: forecast.excludedCategories,
  }
}

/**
 * เพดานรายวันเฉลี่ยจากงบที่ตั้งไว้ (วันทำงาน 5 วัน + วันหยุด 2 วันต่อสัปดาห์)
 * แยกออกมาเป็นฟังก์ชัน pure เพื่อเทสต์ได้ และให้ composable ส่งค่าเข้ามาเท่านั้น
 */
export const weeklyAverageDailyCap = (weekdayCap: number, weekendCap: number) => {
  const weekday = Number.isFinite(weekdayCap) && weekdayCap > 0 ? weekdayCap : 0
  const weekend = Number.isFinite(weekendCap) && weekendCap > 0 ? weekendCap : 0
  return round2((weekday * 5 + weekend * 2) / 7)
}
