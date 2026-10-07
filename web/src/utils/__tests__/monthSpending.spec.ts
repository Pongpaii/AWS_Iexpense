import { describe, expect, it } from 'vitest'
import { makeTransaction } from '../../test-utils/factories'
import { summarizeMonthSpending } from '../monthSpending'

const MONTH = '2026-09'

describe('summarizeMonthSpending', () => {
  it('นับเฉพาะรายการของเดือนที่ขอ ไม่เอาประวัติทั้งก้อนมารวม', () => {
    const summary = summarizeMonthSpending({
      transactions: [
        makeTransaction({ type: 'income', amount: 20_000, transaction_date: '2026-09-30' }),
        makeTransaction({ type: 'expense', amount: 5_000, transaction_date: '2026-09-10' }),
        // เดือนก่อนต้องไม่ถูกนับ
        makeTransaction({ type: 'income', amount: 20_000, transaction_date: '2026-08-30' }),
        makeTransaction({ type: 'expense', amount: 19_000, transaction_date: '2026-08-11' }),
      ],
      month: MONTH,
      monthlySalary: 20_000,
    })

    expect(summary.recordedIncome).toBe(20_000)
    expect(summary.expense).toBe(5_000)
    expect(summary.incomeBase).toBe(20_000)
    expect(summary.usesSalaryBase).toBe(false)
    expect(summary.ratio).toBe(25)
  })

  it('เงินเดือนรอบนี้ยังไม่เข้า ใช้เงินเดือนที่ตั้งไว้เป็นฐานแทน ไม่เด้งเป็น 100%', () => {
    const summary = summarizeMonthSpending({
      transactions: [
        makeTransaction({ type: 'expense', amount: 2_000, transaction_date: '2026-09-03' }),
      ],
      month: MONTH,
      monthlySalary: 20_000,
    })

    expect(summary.recordedIncome).toBe(0)
    expect(summary.incomeBase).toBe(20_000)
    expect(summary.usesSalaryBase).toBe(true)
    expect(summary.hasIncomeBase).toBe(true)
    expect(summary.ratio).toBe(10)
  })

  it('รายรับจริงมากกว่าเงินเดือนที่ตั้งไว้ ให้ใช้รายรับจริง', () => {
    const summary = summarizeMonthSpending({
      transactions: [
        makeTransaction({ type: 'income', amount: 20_000, transaction_date: '2026-09-01' }),
        makeTransaction({ type: 'income', amount: 5_000, transaction_date: '2026-09-15' }),
        makeTransaction({ type: 'expense', amount: 5_000, transaction_date: '2026-09-16' }),
      ],
      month: MONTH,
      monthlySalary: 20_000,
    })

    expect(summary.incomeBase).toBe(25_000)
    expect(summary.usesSalaryBase).toBe(false)
    expect(summary.ratio).toBe(20)
  })

  it('ใช้เกินฐานได้เกิน 100%', () => {
    const summary = summarizeMonthSpending({
      transactions: [
        makeTransaction({ type: 'expense', amount: 25_000, transaction_date: '2026-09-20' }),
      ],
      month: MONTH,
      monthlySalary: 20_000,
    })

    expect(summary.ratio).toBe(125)
  })

  it('ไม่มีทั้งรายรับและเงินเดือน: มีรายจ่าย = 100% ไม่มีรายจ่าย = 0%', () => {
    const spent = summarizeMonthSpending({
      transactions: [
        makeTransaction({ type: 'expense', amount: 300, transaction_date: '2026-09-02' }),
      ],
      month: MONTH,
      monthlySalary: 0,
    })
    const empty = summarizeMonthSpending({ transactions: [], month: MONTH })

    expect(spent.hasIncomeBase).toBe(false)
    expect(spent.ratio).toBe(100)
    expect(empty.ratio).toBe(0)
    expect(empty.expense).toBe(0)
  })

  it('ข้ามยอดที่ไม่ใช่ตัวเลขบวก', () => {
    const summary = summarizeMonthSpending({
      transactions: [
        makeTransaction({ type: 'expense', amount: Number.NaN, transaction_date: '2026-09-05' }),
        makeTransaction({ type: 'expense', amount: -100, transaction_date: '2026-09-06' }),
        makeTransaction({ type: 'expense', amount: 400, transaction_date: '2026-09-07' }),
      ],
      month: MONTH,
      monthlySalary: 4_000,
    })

    expect(summary.expense).toBe(400)
    expect(summary.ratio).toBe(10)
  })
})
