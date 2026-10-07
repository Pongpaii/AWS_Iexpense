import { describe, expect, it } from 'vitest'
import type { CategoryBudget } from '../../composables/useCategoryBudgets'
import { makeTransaction } from '../../test-utils/factories'
import { buildBudgetComparison, buildBudgetPacing, sumAvailableBalance } from '../budgetComparison'

const MONTH = '2026-08'

const budgets: CategoryBudget[] = [
  { category: 'อาหาร', budget: 5000 },
  { category: 'การเดินทาง', budget: 1000 },
]

describe('buildBudgetComparison', () => {
  it('ยังไม่ได้ตั้งงบ = ไม่มีแถวให้เทียบ แต่ยังรู้ยอดจ่ายทั้งเดือน', () => {
    const summary = buildBudgetComparison(
      [makeTransaction({ category: 'อาหาร', amount: 300, transaction_date: '2026-08-04' })],
      [],
      MONTH,
    )

    expect(summary.items).toEqual([])
    expect(summary.totalBudget).toBe(0)
    expect(summary.monthTotal).toBe(300)
    expect(summary.noBudgetCategories).toHaveLength(1)
    expect(summary.noBudgetCategories[0].label).toBe('อาหาร')
  })

  it('หมวดที่ตั้งงบแต่ยังไม่มีรายการต้องแสดงด้วย', () => {
    const summary = buildBudgetComparison([], budgets, MONTH)

    expect(summary.items).toHaveLength(2)
    expect(summary.items.every((item) => item.actual === 0)).toBe(true)
    expect(summary.items.every((item) => item.status === 'under')).toBe(true)
    expect(summary.totalBudget).toBe(6000)
    expect(summary.totalRemaining).toBe(6000)
  })

  it('คำนวณ actual, remaining และ percentage จากรายการในเดือนนั้น', () => {
    const summary = buildBudgetComparison(
      [
        makeTransaction({ category: 'อาหาร', amount: 2000, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'อาหาร', amount: 500, transaction_date: '2026-08-20' }),
      ],
      budgets,
      MONTH,
    )

    const food = summary.items.find((item) => item.category === 'อาหาร')
    expect(food?.actual).toBe(2500)
    expect(food?.remaining).toBe(2500)
    expect(food?.percentage).toBeCloseTo(50)
    expect(food?.transactionCount).toBe(2)
    expect(food?.status).toBe('under')
  })

  it.each([
    [3999, 'under'],
    [4000, 'near'],
    [5000, 'near'],
    [5001, 'over'],
  ])('ยอด %i บาทจากงบ 5000 ได้สถานะ %s', (amount, expected) => {
    const summary = buildBudgetComparison(
      [makeTransaction({ category: 'อาหาร', amount, transaction_date: '2026-08-04' })],
      [{ category: 'อาหาร', budget: 5000 }],
      MONTH,
    )

    expect(summary.items[0].status).toBe(expected)
  })

  it('เกินงบแล้ว remaining ติดลบ และนับจำนวนหมวดที่เกิน', () => {
    const summary = buildBudgetComparison(
      [
        makeTransaction({ category: 'อาหาร', amount: 6000, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'การเดินทาง', amount: 100, transaction_date: '2026-08-04' }),
      ],
      budgets,
      MONTH,
    )

    const food = summary.items.find((item) => item.category === 'อาหาร')
    expect(food?.remaining).toBe(-1000)
    expect(summary.overBudgetCount).toBe(1)
    expect(summary.underBudgetCount).toBe(1)
    expect(summary.totalOverspend).toBe(1000)
    expect(summary.totalRemaining).toBe(900)
  })

  it('อาหารกับการเดินทางขึ้นก่อน แล้วที่เหลือเรียงจากใช้เกินสัดส่วนมากสุด', () => {
    const summary = buildBudgetComparison(
      [
        makeTransaction({ category: 'อาหาร', amount: 1000, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'การเดินทาง', amount: 900, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'ช้อปปิ้ง', amount: 1900, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'ที่พัก', amount: 100, transaction_date: '2026-08-04' }),
      ],
      [...budgets, { category: 'ช้อปปิ้ง', budget: 2000 }, { category: 'ที่พัก', budget: 4000 }],
      MONTH,
    )

    // การเดินทางใช้ไป 90% เทียบกับอาหาร 20% แต่ยังต้องอยู่หลังอาหารตามลำดับของแอป
    expect(summary.items.map((item) => item.category)).toEqual([
      'อาหาร',
      'การเดินทาง',
      'ช้อปปิ้ง',
      'ที่พัก',
    ])
  })

  it('ตัดรายการของเดือนอื่นและรายรับออก', () => {
    const summary = buildBudgetComparison(
      [
        makeTransaction({ category: 'อาหาร', amount: 1000, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'อาหาร', amount: 9000, transaction_date: '2026-07-31' }),
        makeTransaction({
          category: 'อาหาร',
          amount: 4000,
          type: 'income',
          transaction_date: '2026-08-04',
        }),
      ],
      budgets,
      MONTH,
    )

    expect(summary.items.find((item) => item.category === 'อาหาร')?.actual).toBe(1000)
    expect(summary.monthTotal).toBe(1000)
  })

  it('แยกหมวดที่จ่ายแต่ไม่มีงบ รวมถึงรายการที่ไม่ระบุหมวด', () => {
    const summary = buildBudgetComparison(
      [
        makeTransaction({ category: 'ช้อปปิ้ง', amount: 800, transaction_date: '2026-08-04' }),
        makeTransaction({ category: null, amount: 200, transaction_date: '2026-08-05' }),
        makeTransaction({ category: 'อาหาร', amount: 100, transaction_date: '2026-08-06' }),
      ],
      budgets,
      MONTH,
    )

    expect(summary.noBudgetCategories.map((entry) => entry.label)).toEqual([
      'ช้อปปิ้ง',
      'ไม่ระบุหมวดหมู่',
    ])
    expect(summary.noBudgetCategories[1].emoji).toBe('🏷️')
    expect(summary.monthTotal).toBe(1100)
    expect(summary.totalActual).toBe(100)
  })

  it('หมวดที่ยังไม่ตั้งงบก็ยกอาหาร/การเดินทางขึ้นก่อนแม้ยอดน้อยกว่า', () => {
    const summary = buildBudgetComparison(
      [
        makeTransaction({ category: 'ช้อปปิ้ง', amount: 5000, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'การเดินทาง', amount: 80, transaction_date: '2026-08-04' }),
        makeTransaction({ category: 'อาหาร', amount: 50, transaction_date: '2026-08-04' }),
      ],
      [],
      MONTH,
    )

    expect(summary.noBudgetCategories.map((entry) => entry.label)).toEqual([
      'อาหาร',
      'การเดินทาง',
      'ช้อปปิ้ง',
    ])
  })

  it('ไล่สีตาม palette ตามลำดับที่แสดง', () => {
    const summary = buildBudgetComparison([], budgets, MONTH, ['#111111', '#222222'])
    expect(summary.items.map((item) => item.color)).toEqual(['#111111', '#222222'])
  })
})

describe('sumAvailableBalance', () => {
  it('เป็นศูนย์เมื่อไม่มีรายการ', () => {
    expect(sumAvailableBalance([], '2026-08-15')).toBe(0)
  })

  it('รายรับหักรายจ่ายสะสมข้ามเดือน', () => {
    const transactions = [
      makeTransaction({ type: 'income', amount: 20_000, transaction_date: '2026-07-30' }),
      makeTransaction({ type: 'expense', amount: 4_000, transaction_date: '2026-08-02' }),
    ]

    expect(sumAvailableBalance(transactions, '2026-08-15')).toBe(16_000)
  })

  it('ไม่นับรายการที่ลงวันที่หลังวันที่อ้างอิง', () => {
    const transactions = [
      makeTransaction({ type: 'income', amount: 1_000, transaction_date: '2026-08-10' }),
      makeTransaction({ type: 'income', amount: 9_999, transaction_date: '2026-08-20' }),
    ]

    expect(sumAvailableBalance(transactions, '2026-08-15')).toBe(1_000)
  })
})

describe('buildBudgetPacing', () => {
  const pacingFor = (
    transactions: ReturnType<typeof makeTransaction>[],
    today = '2026-08-15',
    month = MONTH,
  ) =>
    buildBudgetPacing(buildBudgetComparison(transactions, budgets, month), {
      transactions,
      month,
      today,
    })

  it('งบที่เหลือตามแผนคืองบรวมหักจ่ายจริง', () => {
    const transactions = [
      makeTransaction({ type: 'income', amount: 30_000, transaction_date: '2026-08-01' }),
      makeTransaction({
        type: 'expense',
        amount: 2_000,
        category: 'อาหาร',
        transaction_date: '2026-08-05',
      }),
    ]

    const pacing = pacingFor(transactions)

    expect(pacing.budgetRemaining).toBe(4_000)
    expect(pacing.availableBalance).toBe(28_000)
  })

  it('ยึดเงินจริงเป็นเพดานเมื่อเงินเหลือน้อยกว่างบ', () => {
    // เงินจริงเหลือ 800 แต่งบยังเหลือ 6,000 → ใช้ได้จริงแค่ 800
    const transactions = [
      makeTransaction({ type: 'income', amount: 800, transaction_date: '2026-08-01' }),
    ]

    const pacing = pacingFor(transactions)

    expect(pacing.budgetRemaining).toBe(6_000)
    expect(pacing.availableBalance).toBe(800)
    expect(pacing.spendableNow).toBe(800)
    expect(pacing.limitedByBalance).toBe(true)
  })

  it('ยึดงบเป็นเพดานเมื่อเงินเหลือมากกว่างบ', () => {
    const transactions = [
      makeTransaction({ type: 'income', amount: 50_000, transaction_date: '2026-08-01' }),
    ]

    const pacing = pacingFor(transactions)

    expect(pacing.spendableNow).toBe(6_000)
    expect(pacing.limitedByBalance).toBe(false)
  })

  it('เกลี่ยเงินที่ใช้ได้จริงตามจำนวนวันที่เหลือ รวมวันนี้', () => {
    const transactions = [
      makeTransaction({ type: 'income', amount: 50_000, transaction_date: '2026-08-01' }),
    ]

    // 15 ส.ค. ของเดือน 31 วัน → เหลือ 17 วันรวมวันนี้
    const pacing = pacingFor(transactions, '2026-08-15')

    expect(pacing.daysInMonth).toBe(31)
    expect(pacing.daysLeft).toBe(17)
    expect(pacing.dailyAllowance).toBeCloseTo(6_000 / 17)
  })

  it('ไม่ให้เบี้ยรายวันติดลบเมื่อใช้เกินไปแล้ว', () => {
    const transactions = [
      makeTransaction({
        type: 'expense',
        amount: 9_000,
        category: 'อาหาร',
        transaction_date: '2026-08-05',
      }),
    ]

    const pacing = pacingFor(transactions)

    expect(pacing.spendableNow).toBeLessThan(0)
    expect(pacing.dailyAllowance).toBe(0)
  })

  it('บอกว่าใช้เร็วกว่าเวลาเมื่อสัดส่วนงบที่ใช้แซงวันที่ผ่านไป', () => {
    const transactions = [
      makeTransaction({
        type: 'expense',
        amount: 5_000,
        category: 'อาหาร',
        transaction_date: '2026-08-03',
      }),
    ]

    // ใช้งบไป 83% ขณะที่เดือนเดินไปแค่ ~16%
    const pacing = pacingFor(transactions, '2026-08-05')

    expect(pacing.pace).toBe('behind')
    expect(pacing.budgetUsedPercent).toBeCloseTo((5_000 / 6_000) * 100)
    expect(pacing.monthProgressPercent).toBeCloseTo((5 / 31) * 100)
  })

  it('บอกว่าใช้ช้ากว่าเวลาเมื่อยังใช้งบน้อยกว่าที่เวลาเดินไป', () => {
    const transactions = [
      makeTransaction({
        type: 'expense',
        amount: 300,
        category: 'อาหาร',
        transaction_date: '2026-08-03',
      }),
    ]

    expect(pacingFor(transactions, '2026-08-20').pace).toBe('ahead')
  })

  it('ถือว่าพอดีเมื่อสัดส่วนงบใกล้เคียงกับเวลาที่ผ่านไป', () => {
    const transactions = [
      makeTransaction({
        type: 'expense',
        amount: 3_000,
        category: 'อาหาร',
        transaction_date: '2026-08-03',
      }),
    ]

    // ใช้งบ 50% ณ วันที่ 16 ของเดือน 31 วัน (~51.6%)
    expect(pacingFor(transactions, '2026-08-16').pace).toBe('ontrack')
  })

  it('เดือนที่ผ่านไปแล้วไม่มีวันเหลือให้วางแผน', () => {
    const transactions = [
      makeTransaction({
        type: 'expense',
        amount: 1_000,
        category: 'อาหาร',
        transaction_date: '2026-08-03',
      }),
    ]

    const pacing = pacingFor(transactions, '2026-09-10')

    expect(pacing.isCurrentMonth).toBe(false)
    expect(pacing.daysLeft).toBe(0)
    expect(pacing.dailyAllowance).toBe(0)
    expect(pacing.monthProgressPercent).toBe(100)
  })

  it('รู้จำนวนวันของเดือนกุมภาพันธ์ปีอธิกสุรทิน', () => {
    const pacing = buildBudgetPacing(buildBudgetComparison([], budgets, '2028-02'), {
      transactions: [],
      month: '2028-02',
      today: '2028-02-10',
    })

    expect(pacing.daysInMonth).toBe(29)
    expect(pacing.daysLeft).toBe(20)
  })
})
