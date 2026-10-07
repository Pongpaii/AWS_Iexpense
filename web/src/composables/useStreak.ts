import { computed, onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { Transaction } from '../types/transaction'
import { getConsecutiveDays, getLongestConsecutive, toLocalIsoDate } from '../utils/dateUtils'

const STREAK_STORAGE_KEY = 'money-flow.streak-best.v1'

/** ระดับของ streak ใช้เลือกไอคอนและเอฟเฟกต์ */
export type StreakLevel = 'idle' | 'starting' | 'hot' | 'diamond'

const loadStoredBest = () => {
  if (typeof window === 'undefined') return 0

  try {
    const stored = Number(window.localStorage.getItem(STREAK_STORAGE_KEY))
    return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0
  } catch {
    return 0
  }
}

const storeBest = (value: number) => {
  try {
    window.localStorage.setItem(STREAK_STORAGE_KEY, String(value))
  } catch {
    // localStorage ปิดอยู่ก็ไม่เป็นไร ค่าจริงคำนวณจาก transactions ได้เสมอ
  }
}

/**
 * นับวันติดต่อกันที่มีการบันทึกอย่างน้อย 1 รายการ
 * คำนวณสดจาก transactions ทุกครั้ง (localStorage เก็บเฉพาะสถิติสูงสุดที่เคยเห็น)
 */
export function useStreak(
  transactions: MaybeRefOrGetter<readonly Transaction[]>,
  options: { persist?: MaybeRefOrGetter<boolean> } = {},
) {
  const today = ref(toLocalIsoDate(new Date()))

  // เผื่อผู้ใช้เปิดแอปค้างข้ามเที่ยงคืน ตรวจวันที่ใหม่ทุก ๆ นาที
  const dayWatcher =
    typeof window === 'undefined'
      ? undefined
      : window.setInterval(() => {
          const now = toLocalIsoDate(new Date())
          if (now !== today.value) today.value = now
        }, 60_000)

  onBeforeUnmount(() => {
    if (dayWatcher !== undefined) window.clearInterval(dayWatcher)
  })

  const recordedDates = computed(() =>
    toValue(transactions).map(({ transaction_date }) => transaction_date),
  )

  const currentStreak = computed(() => getConsecutiveDays(recordedDates.value, today.value))

  const bestFromHistory = computed(() =>
    Math.max(getLongestConsecutive(recordedDates.value), currentStreak.value),
  )

  const rememberedBest = ref(loadStoredBest())

  const longestStreak = computed(() =>
    toValue(options.persist ?? true)
      ? Math.max(bestFromHistory.value, rememberedBest.value)
      : bestFromHistory.value,
  )

  // จำสถิติสูงสุดไว้ใน localStorage เผื่อผู้ใช้ลบรายการเก่าออกไปแล้ว
  watch(
    [bestFromHistory, () => toValue(options.persist ?? true)],
    ([best, persist]) => {
      if (!persist || best <= rememberedBest.value) return
      rememberedBest.value = best
      storeBest(best)
    },
    { immediate: true },
  )

  const hasRecordedToday = computed(() => recordedDates.value.includes(today.value))

  /** true เมื่อ streak ยังไม่ขาดแต่วันนี้ยังไม่ได้จด (ต้องจดวันนี้ถึงจะต่อได้) */
  const atRisk = computed(() => currentStreak.value > 0 && !hasRecordedToday.value)

  const level = computed<StreakLevel>(() => {
    if (currentStreak.value <= 0) return 'idle'
    if (currentStreak.value >= 30) return 'diamond'
    if (currentStreak.value >= 7) return 'hot'
    return 'starting'
  })

  const icon = computed(() => (level.value === 'diamond' ? '💎' : '🔥'))

  const headline = computed(() => {
    if (currentStreak.value <= 0) return 'เริ่มนับวันนี้!'
    if (atRisk.value) return 'ยังรักษา streak อยู่!'
    return `${currentStreak.value} วันติดต่อกัน`
  })

  const hint = computed(() => {
    if (currentStreak.value <= 0) return 'จดรายการแรกของวันนี้เพื่อเริ่มนับวันติดต่อกัน'
    if (atRisk.value) return `จดวันนี้เพื่อต่อ streak เป็น ${currentStreak.value + 1} วัน`
    if (currentStreak.value >= 30) return 'ครบเดือนแบบไม่พลาดวันเลย เก่งมาก'
    if (currentStreak.value >= 7) return 'ทำต่อเนื่องเกินสัปดาห์แล้ว รักษาไว้นะ'
    return 'จดต่ออีกไม่กี่วันก็ครบสัปดาห์แล้ว'
  })

  return {
    today,
    currentStreak,
    longestStreak,
    hasRecordedToday,
    atRisk,
    level,
    icon,
    headline,
    hint,
  }
}
