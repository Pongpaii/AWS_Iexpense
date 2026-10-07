import { describe, expect, it } from 'vitest'
import { makeTransaction } from '../../test-utils/factories'
import type { Transaction } from '../../types/transaction'
import { buildDailyBurnBreakdown } from '../forecast'
import { buildRunway, weeklyAverageDailyCap } from '../runway'

const TODAY = '2026-04-20'
const SALARY_DAY = 30

/** รายจ่ายหมวดเดิมทุกวันย้อนหลัง จำนวน `days` วัน (ไม่นับวันนี้เกินช่วง) */
const dailyExpenses = (
  days: number,
  amount: number,
  category: Transaction['category'],
  startDay = 1,
) =>
  Array.from({ length: days }, (_, index) =>
    makeTransaction({
      amount,
      category,
      transaction_date: `2026-04-${String(startDay + index).padStart(2, '0')}`,
      created_at: `2026-04-${String(startDay + index).padStart(2, '0')}T05:00:00.000Z`,
    }),
  )

const income = (amount: number, date = '2026-04-01') =>
  makeTransaction({ amount, type: 'income', category: 'เงินเดือน', transaction_date: date })

describe('weeklyAverageDailyCap', () => {
  it('เฉลี่ยวันทำงาน 5 วันกับวันหยุด 2 วัน', () => {
    expect(weeklyAverageDailyCap(350, 700)).toBeCloseTo((350 * 5 + 700 * 2) / 7, 2)
  })

  it('ค่าที่ใช้ไม่ได้ถือเป็นศูนย์', () => {
    expect(weeklyAverageDailyCap(Number.NaN, -10)).toBe(0)
  })
})

describe('buildDailyBurnBreakdown', () => {
  it('หมวดจำเป็นหารจำนวนวัน ส่วนหมวดเป็นก้อนคิดต่อเดือนแล้วหาร 30', () => {
    const breakdown = buildDailyBurnBreakdown({
      transactions: [
        ...dailyExpenses(10, 100, 'อาหาร', 11),
        makeTransaction({ amount: 3000, category: 'ช้อปปิ้ง', transaction_date: '2026-04-15' }),
      ],
      today: TODAY,
    })

    expect(breakdown.historyDays).toBe(10)
    // อาหาร 1,000 บาทใน 10 วัน = 100/วัน
    expect(breakdown.essentialPerDay).toBeCloseTo(100, 2)
    // ช้อปปิ้งก้อนเดียวถูก clamp เป็น 1 เดือน = 3,000/เดือน = 100/วัน
    expect(breakdown.irregularPerDay).toBeCloseTo(100, 2)
    expect(breakdown.totalPerDay).toBeCloseTo(200, 2)
  })

  it('อาหารกับการเดินทางขึ้นก่อนแม้ยอดน้อยกว่า', () => {
    const breakdown = buildDailyBurnBreakdown({
      transactions: [
        makeTransaction({ amount: 6000, category: 'ที่พัก', transaction_date: '2026-04-01' }),
        makeTransaction({ amount: 60, category: 'การเดินทาง', transaction_date: '2026-04-19' }),
        makeTransaction({ amount: 40, category: 'อาหาร', transaction_date: '2026-04-19' }),
      ],
      today: TODAY,
    })

    expect(breakdown.categories.map((item) => item.category)).toEqual([
      'อาหาร',
      'การเดินทาง',
      'ที่พัก',
    ])
  })

  it('หมวดที่กันออกไม่เข้าการคำนวณ', () => {
    const breakdown = buildDailyBurnBreakdown({
      transactions: [
        ...dailyExpenses(10, 100, 'อาหาร', 11),
        makeTransaction({ amount: 6000, category: 'ที่พัก', transaction_date: '2026-04-15' }),
      ],
      today: TODAY,
      excludedCategories: ['ที่พัก'],
    })

    expect(breakdown.categories.map((item) => item.category)).toEqual(['อาหาร'])
    expect(breakdown.totalPerDay).toBeCloseTo(100, 2)
  })
})

describe('buildRunway', () => {
  /** เงินเข้า 10,000 · จ่ายอาหารวันละ 100 ต่อเนื่อง 40 วัน (ข้อมูลครบรอบ เชื่อค่าเฉลี่ยจริง) */
  const steadyTransactions = [
    income(10_000, '2026-03-12'),
    ...Array.from({ length: 40 }, (_, index) => {
      const date = new Date(2026, 2, 12 + index, 12)
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`
      return makeTransaction({
        amount: 100,
        category: 'อาหาร',
        transaction_date: iso,
        created_at: `${iso}T05:00:00.000Z`,
      })
    }),
  ]

  it('บอกจำนวนวันที่อยู่ได้และวันที่เงินหมดจากเงินคงเหลือจริง', () => {
    const runway = buildRunway({
      transactions: steadyTransactions,
      today: TODAY,
      monthlySalary: 10_000,
      salaryDay: SALARY_DAY,
    })

    // 10,000 - (40 วัน × 100) = 6,000 · ใช้วันละ 100 → 60 วัน
    expect(runway.balance).toBe(6_000)
    expect(runway.primary.burnPerDay).toBeCloseTo(100, 2)
    expect(runway.primary.days).toBe(60)
    expect(runway.primary.runsOutDate).toBe('2026-06-19')
    expect(runway.primary.reachesSalary).toBe(true)
    expect(runway.status).toBe('safe')
  })

  it('เงินไม่ถึงวันเงินเดือนต้องขึ้นสถานะเสี่ยงและบอกว่าต้องลดวันละเท่าไร', () => {
    const runway = buildRunway({
      transactions: [
        income(1_000, '2026-04-01'),
        ...dailyExpenses(10, 60, 'อาหาร', 10),
        ...dailyExpenses(10, 40, 'การเดินทาง', 10),
      ],
      today: TODAY,
      monthlySalary: 10_000,
      salaryDay: SALARY_DAY,
    })

    // เหลือ 1,000 - 1,000 = 0 บาท จึงอยู่ได้ 0 วัน
    expect(runway.balance).toBe(0)
    expect(runway.primary.days).toBe(0)
    expect(runway.daysUntilSalary).toBe(10)
    expect(runway.primary.shortfallDays).toBe(10)
    expect(runway.status).toBe('risk')
    expect(runway.targetDailySpend).toBe(0)
    expect(runway.requiredDailyCut).toBeGreaterThan(0)
  })

  it('ยังไม่มีรายจ่ายเลย = ยังสรุปไม่ได้', () => {
    const runway = buildRunway({
      transactions: [income(5_000, '2026-04-01')],
      today: TODAY,
      monthlySalary: 10_000,
      salaryDay: SALARY_DAY,
    })

    expect(runway.status).toBe('insufficient')
    expect(runway.primary.days).toBe(null)
    expect(runway.primary.runsOutDate).toBe(null)
  })

  it('ยอดติดลบถือเป็นความเสี่ยงทันทีไม่ว่าข้อมูลจะน้อยแค่ไหน', () => {
    const runway = buildRunway({
      transactions: [
        makeTransaction({ amount: 500, category: 'อาหาร', transaction_date: '2026-04-19' }),
      ],
      today: TODAY,
      monthlySalary: 10_000,
      salaryDay: SALARY_DAY,
    })

    expect(runway.balance).toBe(-500)
    expect(runway.status).toBe('risk')
  })

  it('ฉากทัศน์ "เฉพาะที่จำเป็น" ต้องอยู่ได้นานกว่าการใช้ตามจังหวะจริง', () => {
    const runway = buildRunway({
      transactions: [
        income(20_000, '2026-03-12'),
        ...dailyExpenses(20, 100, 'อาหาร', 1),
        ...dailyExpenses(20, 50, 'ช้อปปิ้ง', 1),
      ],
      today: TODAY,
      monthlySalary: 20_000,
      salaryDay: SALARY_DAY,
    })

    const essential = runway.scenarios.find((item) => item.id === 'essential')!
    const actual = runway.scenarios.find((item) => item.id === 'actual')!

    expect(essential.burnPerDay).toBeLessThan(actual.burnPerDay)
    expect(essential.days!).toBeGreaterThan(actual.days!)
    expect(runway.essentialShare).toBeGreaterThan(0.5)
  })

  it('ยังไม่เปิดงบรายวัน ฉากทัศน์ "ใช้เต็มงบ" ต้องปิดไว้', () => {
    const runway = buildRunway({
      transactions: steadyTransactions,
      today: TODAY,
      monthlySalary: 10_000,
      salaryDay: SALARY_DAY,
    })

    const planned = runway.scenarios.find((item) => item.id === 'planned')!
    expect(planned.available).toBe(false)
    expect(planned.days).toBe(null)
  })

  it('ส่งเพดานรายวันเข้ามาแล้วต้องคิด runway ตามงบนั้น', () => {
    const runway = buildRunway({
      transactions: steadyTransactions,
      today: TODAY,
      monthlySalary: 10_000,
      salaryDay: SALARY_DAY,
      plannedDailyBurn: 300,
    })

    const planned = runway.scenarios.find((item) => item.id === 'planned')!
    expect(planned.available).toBe(true)
    expect(planned.days).toBe(20)
  })

  it('คันโยกรายหมวดบอกว่าลด/ตัดแล้วยืดได้กี่วัน และผลรวมเท่ากับ burn พาดหัว', () => {
    const runway = buildRunway({
      transactions: [
        income(20_000, '2026-03-12'),
        ...dailyExpenses(20, 100, 'อาหาร', 1),
        ...dailyExpenses(20, 100, 'ช้อปปิ้ง', 1),
      ],
      today: TODAY,
      monthlySalary: 20_000,
      salaryDay: SALARY_DAY,
    })

    const total = runway.categories.reduce((sum, item) => sum + item.perDay, 0)
    expect(total).toBeCloseTo(runway.primary.burnPerDay, 1)

    const shopping = runway.categories.find((item) => item.category === 'ช้อปปิ้ง')!
    expect(shopping.isEssential).toBe(false)
    expect(shopping.extraDaysIfCut).toBeGreaterThan(0)

    const food = runway.categories.find((item) => item.category === 'อาหาร')!
    expect(food.isPriority).toBe(true)
    expect(food.extraDaysIfHalved).toBeGreaterThan(0)
  })

  it('กันหมวดออกแล้ว burn ต้องลดลง แต่เงินคงเหลือยังนับครบตามจริง', () => {
    const transactions = [
      income(20_000, '2026-03-12'),
      ...dailyExpenses(20, 100, 'อาหาร', 1),
      makeTransaction({ amount: 4_000, category: 'ที่พัก', transaction_date: '2026-04-01' }),
    ]

    const withRent = buildRunway({
      transactions,
      today: TODAY,
      monthlySalary: 20_000,
      salaryDay: SALARY_DAY,
    })
    const withoutRent = buildRunway({
      transactions,
      today: TODAY,
      monthlySalary: 20_000,
      salaryDay: SALARY_DAY,
      excludedCategories: ['ที่พัก'],
    })

    expect(withoutRent.balance).toBe(withRent.balance)
    expect(withoutRent.primary.burnPerDay).toBeLessThan(withRent.primary.burnPerDay)
    expect(withoutRent.excludedCategories).toEqual(['ที่พัก'])
    expect(withoutRent.categories.some((item) => item.category === 'ที่พัก')).toBe(false)
  })
})
