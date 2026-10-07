import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { describeError } from '../lib/api'
import { api } from '../lib/backend'
import {
  badgeDefinitions,
  isBadgeId,
  type AchievementContext,
  type BadgeDefinition,
  type BadgeId,
  type UnlockedAchievement,
} from '../types/achievement'
import type { Transaction } from '../types/transaction'
import { toLocalIsoDate } from '../utils/dateUtils'
import { useDailyCap } from './useDailyCap'

/** badge ที่ปลดไว้ล่วงหน้าให้โหมดดูตัวอย่าง เพื่อให้เห็นทั้งสถานะปลดแล้วและยังล็อค */
const DEMO_UNLOCKED: BadgeId[] = ['first_record', 'streak_7', 'saver_1000', 'category_all']

export interface AchievementRow {
  badge: BadgeDefinition
  unlockedAt: string | null
  unlocked: boolean
}

export interface UseAchievementsOptions {
  transactions: MaybeRefOrGetter<readonly Transaction[]>
  /** ยอดคงเหลือรวมทั้งหมด ใช้ตัดสิน badge สายออม */
  balance: MaybeRefOrGetter<number>
  userId: MaybeRefOrGetter<string | null>
  demoMode: MaybeRefOrGetter<boolean>
}

export function useAchievements(options: UseAchievementsOptions) {
  const { capEnabled, capForDate } = useDailyCap()

  const unlocked = ref<UnlockedAchievement[]>([])
  const loading = ref(false)
  const errorMessage = ref('')
  /** คิว badge ที่เพิ่งปลดล็อค ให้ toast หยิบไปแสดงทีละใบ */
  const pending = ref<BadgeDefinition[]>([])

  const unlockedIds = computed(() => new Set(unlocked.value.map(({ badgeId }) => badgeId)))

  const context = computed<AchievementContext>(() => ({
    transactions: toValue(options.transactions),
    balance: toValue(options.balance),
    capEnabled: capEnabled.value,
    capForDate,
    today: toLocalIsoDate(new Date()),
  }))

  const rows = computed<AchievementRow[]>(() =>
    badgeDefinitions.map((badge) => {
      const record = unlocked.value.find(({ badgeId }) => badgeId === badge.id)
      return {
        badge,
        unlockedAt: record?.unlockedAt ?? null,
        unlocked: Boolean(record),
      }
    }),
  )

  const unlockedCount = computed(() => rows.value.filter(({ unlocked: done }) => done).length)
  const totalCount = badgeDefinitions.length
  const progressPercent = computed(() =>
    totalCount === 0 ? 0 : Math.round((unlockedCount.value / totalCount) * 100),
  )

  const reset = () => {
    unlocked.value = []
    pending.value = []
    errorMessage.value = ''
    loading.value = false
  }

  const loadDemoAchievements = () => {
    const now = new Date()
    unlocked.value = DEMO_UNLOCKED.map((badgeId, index) => {
      const stamp = new Date(now)
      stamp.setDate(stamp.getDate() - (DEMO_UNLOCKED.length - index) * 6)
      return { badgeId, unlockedAt: stamp.toISOString() }
    })
  }

  /** โหลด badge ที่ปลดไว้แล้วของผู้ใช้ปัจจุบัน */
  const loadAchievements = async () => {
    if (toValue(options.demoMode)) {
      loadDemoAchievements()
      return
    }

    const userId = toValue(options.userId)
    if (!api || !userId) {
      unlocked.value = []
      return
    }

    loading.value = true
    errorMessage.value = ''

    try {
      const rows = await api.listAchievements()
      // badge ที่เวอร์ชันนี้ไม่รู้จัก (เช่น จากต้นแบบรุ่นก่อน) ไม่ต้องแสดง
      unlocked.value = rows
        .filter((row) => isBadgeId(row.badgeId))
        .map((row) => ({ badgeId: row.badgeId as BadgeId, unlockedAt: row.earnedAt }))
    } catch (error) {
      errorMessage.value = `โหลดความสำเร็จไม่สำเร็จ: ${describeError(error)}`
    } finally {
      loading.value = false
    }
  }

  /**
   * ตรวจ badge ทุกใบที่ยังไม่ปลด ถ้าผ่านเงื่อนไขจะบันทึกลงฐานข้อมูลและเข้าคิว toast
   * เรียกได้หลังทุก CRUD ของ transaction · ปลอดภัยเมื่อเรียกซ้ำเพราะ API เก็บ badge ละหนึ่งรายการต่อผู้ใช้
   */
  const checkAchievements = async () => {
    const snapshot = context.value
    const already = unlockedIds.value

    const earned = badgeDefinitions.filter((badge) => {
      if (already.has(badge.id)) return false
      try {
        return badge.isEarned(snapshot)
      } catch {
        return false
      }
    })

    if (earned.length === 0) return []

    const demo = toValue(options.demoMode)
    const userId = toValue(options.userId)

    if (!demo && api && userId) {
      const endpoints = api
      try {
        // POST ซ้ำได้: ถ้ามีอยู่แล้วเซิร์ฟเวอร์ตอบ 200 พร้อมเวลาที่ได้ครั้งแรก
        await Promise.all(earned.map((badge) => endpoints.addAchievement(badge.id)))
      } catch (error) {
        // ปลดล็อคเป็นของแถม ถ้าเขียนไม่ได้ก็ไม่ควรรบกวนการบันทึกรายการหลัก
        errorMessage.value = `บันทึกความสำเร็จไม่สำเร็จ: ${describeError(error)}`
        return []
      }
    }

    const unlockedAt = new Date().toISOString()
    unlocked.value = [
      ...unlocked.value,
      ...earned.map((badge) => ({ badgeId: badge.id, unlockedAt })),
    ]
    pending.value = [...pending.value, ...earned]

    return earned
  }

  /** เอา badge ใบแรกในคิวออก (toast เรียกเมื่อแสดงจบ) */
  const dismissPending = () => {
    pending.value = pending.value.slice(1)
  }

  return {
    rows,
    unlocked,
    unlockedIds,
    unlockedCount,
    totalCount,
    progressPercent,
    loading,
    errorMessage,
    pending,
    currentPending: computed(() => pending.value[0] ?? null),
    loadAchievements,
    checkAchievements,
    dismissPending,
    reset,
  }
}
