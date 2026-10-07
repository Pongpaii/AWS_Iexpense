import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { makeTransaction } from '../../test-utils/factories'
import { withSetup } from '../../test-utils/withSetup'
import { useStreak } from '../useStreak'

const STREAK_STORAGE_KEY = 'money-flow.streak-best.v1'
const TODAY = new Date(2026, 2, 15, 10, 0, 0)

const datesToTransactions = (dates: string[]) =>
  dates.map((transaction_date) => makeTransaction({ transaction_date }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('useStreak', () => {
  it('เริ่มที่ 0 เมื่อยังไม่มีรายการ', () => {
    const { result, unmount } = withSetup(() => useStreak([]))

    expect(result.currentStreak.value).toBe(0)
    expect(result.level.value).toBe('idle')
    expect(result.hasRecordedToday.value).toBe(false)
    unmount()
  })

  it('นับวันติดต่อกันจนถึงวันนี้', () => {
    const transactions = datesToTransactions(['2026-03-13', '2026-03-14', '2026-03-15'])
    const { result, unmount } = withSetup(() => useStreak(transactions))

    expect(result.currentStreak.value).toBe(3)
    expect(result.hasRecordedToday.value).toBe(true)
    expect(result.atRisk.value).toBe(false)
    unmount()
  })

  it('ถือว่า streak ยังไม่ขาดแต่ "เสี่ยง" เมื่อวันนี้ยังไม่จด', () => {
    const transactions = datesToTransactions(['2026-03-13', '2026-03-14'])
    const { result, unmount } = withSetup(() => useStreak(transactions))

    expect(result.currentStreak.value).toBe(2)
    expect(result.hasRecordedToday.value).toBe(false)
    expect(result.atRisk.value).toBe(true)
    expect(result.hint.value).toContain('3')
    unmount()
  })

  it('รีเซ็ตเป็น 0 เมื่อขาดเกินหนึ่งวัน', () => {
    const { result, unmount } = withSetup(() => useStreak(datesToTransactions(['2026-03-10'])))

    expect(result.currentStreak.value).toBe(0)
    expect(result.atRisk.value).toBe(false)
    unmount()
  })

  it('คำนวณใหม่เมื่อรายการเปลี่ยน', async () => {
    const transactions = ref(datesToTransactions(['2026-03-14']))
    const { result, unmount } = withSetup(() => useStreak(transactions))

    expect(result.currentStreak.value).toBe(1)

    transactions.value = datesToTransactions(['2026-03-14', '2026-03-15'])

    expect(result.currentStreak.value).toBe(2)
    unmount()
  })

  describe('ระดับของ streak', () => {
    const streakOfLength = (length: number) =>
      datesToTransactions(
        Array.from({ length }, (_, index) => `2026-03-${String(15 - index).padStart(2, '0')}`),
      )

    it('starting เมื่อ 1-6 วัน', () => {
      const { result, unmount } = withSetup(() => useStreak(streakOfLength(3)))
      expect(result.level.value).toBe('starting')
      expect(result.icon.value).toBe('🔥')
      unmount()
    })

    it('hot เมื่อครบ 7 วัน', () => {
      const { result, unmount } = withSetup(() => useStreak(streakOfLength(7)))
      expect(result.level.value).toBe('hot')
      unmount()
    })

    it('diamond เมื่อครบ 30 วัน', () => {
      // ไล่ย้อนจาก 2026-03-15 ไป 30 วันจะข้ามเดือน จึงสร้างจากวันที่จริง
      const dates = Array.from({ length: 30 }, (_, index) => {
        const date = new Date(2026, 2, 15 - index)
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate(),
        ).padStart(2, '0')}`
      })

      const { result, unmount } = withSetup(() => useStreak(datesToTransactions(dates)))

      expect(result.currentStreak.value).toBe(30)
      expect(result.level.value).toBe('diamond')
      expect(result.icon.value).toBe('💎')
      unmount()
    })
  })

  describe('สถิติสูงสุด', () => {
    it('อย่างน้อยเท่ากับ streak ปัจจุบัน', () => {
      const { result, unmount } = withSetup(() =>
        useStreak(datesToTransactions(['2026-03-14', '2026-03-15'])),
      )

      expect(result.longestStreak.value).toBeGreaterThanOrEqual(result.currentStreak.value)
      unmount()
    })

    it('จำช่วงที่ยาวที่สุดในอดีตได้ แม้ตอนนี้จะขาดไปแล้ว', () => {
      const dates = [
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
        '2026-01-04',
        '2026-01-05',
        '2026-03-15',
      ]

      const { result, unmount } = withSetup(() => useStreak(datesToTransactions(dates)))

      expect(result.currentStreak.value).toBe(1)
      expect(result.longestStreak.value).toBe(5)
      unmount()
    })

    it('บันทึกสถิติสูงสุดลง localStorage เมื่อเปิด persist', () => {
      const dates = ['2026-03-13', '2026-03-14', '2026-03-15']
      const { unmount } = withSetup(() => useStreak(datesToTransactions(dates), { persist: true }))

      expect(localStorage.getItem(STREAK_STORAGE_KEY)).toBe('3')
      unmount()
    })

    it('ไม่เขียน localStorage เมื่อปิด persist (โหมดดูตัวอย่าง)', () => {
      const dates = ['2026-03-13', '2026-03-14', '2026-03-15']
      const { unmount } = withSetup(() => useStreak(datesToTransactions(dates), { persist: false }))

      expect(localStorage.getItem(STREAK_STORAGE_KEY)).toBeNull()
      unmount()
    })

    it('ใช้สถิติที่จำไว้เมื่อประวัติปัจจุบันสั้นกว่า', () => {
      localStorage.setItem(STREAK_STORAGE_KEY, '12')

      const { result, unmount } = withSetup(() =>
        useStreak(datesToTransactions(['2026-03-15']), { persist: true }),
      )

      expect(result.longestStreak.value).toBe(12)
      unmount()
    })

    it('ไม่ใช้สถิติที่จำไว้เมื่อปิด persist', () => {
      localStorage.setItem(STREAK_STORAGE_KEY, '12')

      const { result, unmount } = withSetup(() =>
        useStreak(datesToTransactions(['2026-03-15']), { persist: false }),
      )

      expect(result.longestStreak.value).toBe(1)
      unmount()
    })
  })

  it('อัปเดตวันที่เมื่อเวลาข้ามเที่ยงคืน', async () => {
    const transactions = datesToTransactions(['2026-03-15'])
    const { result, unmount } = withSetup(() => useStreak(transactions))

    expect(result.today.value).toBe('2026-03-15')

    vi.setSystemTime(new Date(2026, 2, 16, 0, 1, 0))
    await vi.advanceTimersByTimeAsync(61_000)

    expect(result.today.value).toBe('2026-03-16')
    // เมื่อวานจดไว้ streak จึงยังไม่ขาด แต่เข้าสถานะเสี่ยง
    expect(result.currentStreak.value).toBe(1)
    expect(result.atRisk.value).toBe(true)
    unmount()
  })

  it('หยุด interval เมื่อ unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const { unmount } = withSetup(() => useStreak([]))

    unmount()

    expect(clearSpy).toHaveBeenCalled()
  })
})
