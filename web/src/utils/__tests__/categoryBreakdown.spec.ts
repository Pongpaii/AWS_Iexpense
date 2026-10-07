import { describe, expect, it } from 'vitest'
import { makeTransaction } from '../../test-utils/factories'
import { buildCategoryBreakdown, categoryPalette, formatPercent } from '../categoryBreakdown'

describe('buildCategoryBreakdown', () => {
  it('คืนผลว่างเมื่อไม่มีรายการ', () => {
    const result = buildCategoryBreakdown([], 'expense')

    expect(result.total).toBe(0)
    expect(result.slices).toEqual([])
  })

  it('นับเฉพาะรายการที่ตรงกับประเภทที่ขอ', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 100, category: 'อาหาร' }),
      makeTransaction({ type: 'income', amount: 5000, category: 'เงินเดือน' }),
    ]

    const expenses = buildCategoryBreakdown(transactions, 'expense')
    const income = buildCategoryBreakdown(transactions, 'income')

    expect(expenses.total).toBe(100)
    expect(expenses.slices).toHaveLength(1)
    expect(income.total).toBe(5000)
    expect(income.slices).toHaveLength(1)
  })

  it('รวมยอดของหมวดหมู่เดียวกันเข้าด้วยกัน', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 60, category: 'อาหาร' }),
      makeTransaction({ type: 'expense', amount: 40, category: 'อาหาร' }),
    ]

    const result = buildCategoryBreakdown(transactions, 'expense')

    expect(result.slices).toHaveLength(1)
    expect(result.slices[0].amount).toBe(100)
    expect(result.slices[0].items).toHaveLength(2)
  })

  it('เรียงหมวดหมู่จากยอดมากไปน้อย', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 50, category: 'อาหาร' }),
      makeTransaction({ type: 'expense', amount: 300, category: 'ที่พัก' }),
      makeTransaction({ type: 'expense', amount: 120, category: 'การเดินทาง' }),
    ]

    const result = buildCategoryBreakdown(transactions, 'expense')

    expect(result.slices.map(({ category }) => category)).toEqual(['ที่พัก', 'การเดินทาง', 'อาหาร'])
  })

  it('คำนวณสัดส่วนเป็นเปอร์เซ็นต์ที่รวมกันได้ 100', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 75, category: 'อาหาร' }),
      makeTransaction({ type: 'expense', amount: 25, category: 'ที่พัก' }),
    ]

    const result = buildCategoryBreakdown(transactions, 'expense')
    const totalPercentage = result.slices.reduce((sum, slice) => sum + slice.percentage, 0)

    expect(result.slices[0].percentage).toBeCloseTo(75)
    expect(result.slices[1].percentage).toBeCloseTo(25)
    expect(totalPercentage).toBeCloseTo(100)
  })

  it('จัดรายการที่ไม่มีหมวดหมู่ไว้กลุ่ม "ไม่ระบุหมวดหมู่"', () => {
    const transactions = [makeTransaction({ type: 'expense', amount: 80, category: null })]

    const result = buildCategoryBreakdown(transactions, 'expense')

    expect(result.slices[0].category).toBeNull()
    expect(result.slices[0].label).toBe('ไม่ระบุหมวดหมู่')
    expect(result.slices[0].emoji).toBeTruthy()
  })

  it('แยกกลุ่มไม่ระบุหมวดหมู่ออกจากหมวดหมู่ที่ระบุไว้', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 80, category: null }),
      makeTransaction({ type: 'expense', amount: 20, category: 'อาหาร' }),
    ]

    const result = buildCategoryBreakdown(transactions, 'expense')

    expect(result.slices).toHaveLength(2)
    expect(result.total).toBe(100)
  })

  it('เวียนใช้สีในจานสีเมื่อหมวดหมู่มากกว่าจำนวนสี', () => {
    const result = buildCategoryBreakdown(
      [makeTransaction({ type: 'expense', amount: 10, category: 'อาหาร' })],
      'expense',
    )

    expect(categoryPalette).toContain(result.slices[0].color)
  })

  it('เรียงรายการย่อยในแต่ละหมวดจากยอดมากไปน้อย', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 30, category: 'อาหาร' }),
      makeTransaction({ type: 'expense', amount: 90, category: 'อาหาร' }),
      makeTransaction({ type: 'expense', amount: 60, category: 'อาหาร' }),
    ]

    const result = buildCategoryBreakdown(transactions, 'expense')

    expect(result.slices[0].items.map(({ amount }) => amount)).toEqual([90, 60, 30])
  })

  it('รับ amount ที่มาเป็น string จาก Postgres numeric ได้', () => {
    // ไดรเวอร์บางตัวคืนคอลัมน์ numeric เป็น string
    const transactions = [
      makeTransaction({ type: 'expense', amount: '50.25' as unknown as number, category: 'อาหาร' }),
    ]

    const result = buildCategoryBreakdown(transactions, 'expense')

    expect(result.total).toBeCloseTo(50.25)
  })
})

describe('formatPercent', () => {
  it('ปัดเป็นจำนวนเต็มสำหรับค่าตั้งแต่ 1 ขึ้นไป', () => {
    expect(formatPercent(75.4)).toBe('75%')
    expect(formatPercent(100)).toBe('100%')
  })

  it('แสดงทศนิยม 1 ตำแหน่งสำหรับค่าที่น้อยกว่า 1 เพื่อไม่ให้กลายเป็น 0%', () => {
    expect(formatPercent(0.4)).toBe('0.4%')
  })

  it('แสดง 0% เมื่อค่าเป็นศูนย์', () => {
    expect(formatPercent(0)).toBe('0%')
  })
})
