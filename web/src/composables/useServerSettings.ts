import type { DailyCapPlan, UserSettings } from '@money-flow/shared'
import { ref } from 'vue'
import { describeError, isOffline } from '../lib/api'
import { api } from '../lib/backend'
import { fetchSettings, updateSettings } from '../lib/settingsStore'
import {
  applyServerDailyCap,
  cloneDailyCapSettings,
  DAILY_CAP_STORAGE_KEY,
  getDailyCapSnapshot,
  registerServerCapSaver,
  type DailyCapSettings,
} from './useDailyCap'
import {
  applyServerSalary,
  DEFAULT_MONTHLY_SALARY,
  registerServerSalarySaver,
  SALARY_STORAGE_KEY,
} from './useSalarySettings'

const LEGACY_MIGRATION_OWNER_KEY = 'money-flow.settings-migration-owner.v1'
const scopedKey = (base: string, userId: string) => `${base}.${userId}`

/** API เก็บเงินเดือนเป็นบาทจำนวนเต็ม 1..100,000,000 */
const toServerSalary = (amount: number) => Math.min(Math.max(Math.round(amount), 1), 100_000_000)

const canUseLegacyCache = (userId: string) => {
  try {
    const owner = window.localStorage.getItem(LEGACY_MIGRATION_OWNER_KEY)
    if (owner) return owner === userId
    window.localStorage.setItem(LEGACY_MIGRATION_OWNER_KEY, userId)
    return true
  } catch {
    return false
  }
}

const readCachedSalary = (userId: string | null) => {
  if (!userId) return DEFAULT_MONTHLY_SALARY
  try {
    const scoped = window.localStorage.getItem(scopedKey(SALARY_STORAGE_KEY, userId))
    const raw =
      scoped ?? (canUseLegacyCache(userId) ? window.localStorage.getItem(SALARY_STORAGE_KEY) : null)
    const amount = Number(raw)
    return Number.isFinite(amount) && amount > 0 && amount <= 100_000_000
      ? Math.round(amount * 100) / 100
      : DEFAULT_MONTHLY_SALARY
  } catch {
    return DEFAULT_MONTHLY_SALARY
  }
}

const readCachedCap = (userId: string | null): DailyCapSettings => {
  if (!userId) return getDailyCapSnapshot()
  try {
    const scoped = window.localStorage.getItem(scopedKey(DAILY_CAP_STORAGE_KEY, userId))
    const raw =
      scoped ??
      (canUseLegacyCache(userId) ? window.localStorage.getItem(DAILY_CAP_STORAGE_KEY) : null)
    return raw ? (JSON.parse(raw) as DailyCapSettings) : getDailyCapSnapshot()
  } catch {
    return getDailyCapSnapshot()
  }
}

/** แผนงบรายวันของหน้าจอ → field dailyCapPlan ของ API (รูปร่างเดียวกัน) */
const toServerPlan = (cap: DailyCapSettings): DailyCapPlan => cloneDailyCapSettings(cap)

/**
 * เงินเดือนและแผนงบรายวันบนเซิร์ฟเวอร์ (มี cache ใน localStorage แยกตาม user)
 * ออฟไลน์หรือเซิร์ฟเวอร์ล่ม ยังใช้ค่าที่จำไว้ในเครื่องได้
 */
export function useServerSettings(userId: () => string | null) {
  const initialUser = userId()
  const serverSalary = ref(readCachedSalary(initialUser))
  const serverCapJson = ref<DailyCapSettings>(readCachedCap(initialUser))
  const loading = ref(false)
  const errorMessage = ref('')

  const cacheSettings = (salary: number, cap: unknown) => {
    const currentUser = userId()
    applyServerSalary(salary)
    applyServerDailyCap(cap)
    serverSalary.value = salary
    serverCapJson.value = getDailyCapSnapshot()

    if (!currentUser) return
    try {
      window.localStorage.setItem(scopedKey(SALARY_STORAGE_KEY, currentUser), String(salary))
      window.localStorage.setItem(
        scopedKey(DAILY_CAP_STORAGE_KEY, currentUser),
        JSON.stringify(serverCapJson.value),
      )
    } catch {
      // ค่าในหน่วยความจำยังใช้ได้ ถ้า storage เขียนไม่ได้ก็ข้ามไป
    }
  }

  const save = async (patch: (settings: UserSettings) => UserSettings) => {
    const currentUser = userId()
    if (!api || !currentUser || isOffline()) return false

    try {
      await updateSettings(currentUser, patch)
      errorMessage.value = ''
      return true
    } catch (error) {
      errorMessage.value = `บันทึกการตั้งค่าบนเซิร์ฟเวอร์ไม่สำเร็จ: ${describeError(error)}`
      return false
    }
  }

  const loadSettings = async () => {
    const currentUser = userId()
    const cachedSalary = readCachedSalary(currentUser)
    const cachedCap = readCachedCap(currentUser)

    if (!api || !currentUser || isOffline()) {
      cacheSettings(cachedSalary, cachedCap)
      return
    }

    loading.value = true
    errorMessage.value = ''
    try {
      const settings = await fetchSettings(currentUser)

      if (settings.updatedAt === null) {
        // ยังไม่เคยบันทึกบนเซิร์ฟเวอร์: ยกค่าที่ตั้งไว้ในเครื่องขึ้นไป
        cacheSettings(cachedSalary, cachedCap)
        await save((s) => ({
          ...s,
          monthlySalary: toServerSalary(cachedSalary),
          dailyCapPlan: toServerPlan(getDailyCapSnapshot()),
        }))
      } else if (settings.dailyCapPlan === null) {
        // มีการตั้งค่าแล้วแต่ยังไม่มีแผนงบรายวันแบบละเอียด: ใช้ของในเครื่องแล้วเก็บขึ้นไป
        cacheSettings(settings.monthlySalary, cachedCap)
        await save((s) => ({ ...s, dailyCapPlan: toServerPlan(getDailyCapSnapshot()) }))
      } else {
        cacheSettings(settings.monthlySalary, settings.dailyCapPlan)
      }
    } catch (error) {
      cacheSettings(cachedSalary, cachedCap)
      errorMessage.value = `โหลดการตั้งค่าไม่สำเร็จ ใช้ค่าที่บันทึกในเครื่องแทน: ${describeError(error)}`
    } finally {
      loading.value = false
    }
  }

  const saveSalary = async (amount: number) => {
    serverSalary.value = amount
    const currentUser = userId()
    if (currentUser) {
      try {
        window.localStorage.setItem(scopedKey(SALARY_STORAGE_KEY, currentUser), String(amount))
      } catch {
        // ยังบันทึกขึ้นเซิร์ฟเวอร์ต่อได้แม้ cache ในเครื่องใช้ไม่ได้
      }
    }
    return save((s) => ({ ...s, monthlySalary: toServerSalary(amount) }))
  }

  const saveCapSettings = async (settings: DailyCapSettings) => {
    serverCapJson.value = cloneDailyCapSettings(settings)
    const currentUser = userId()
    if (currentUser) {
      try {
        window.localStorage.setItem(
          scopedKey(DAILY_CAP_STORAGE_KEY, currentUser),
          JSON.stringify(settings),
        )
      } catch {
        // ยังบันทึกขึ้นเซิร์ฟเวอร์ต่อได้แม้ cache ในเครื่องใช้ไม่ได้
      }
    }
    return save((s) => ({ ...s, dailyCapPlan: toServerPlan(settings) }))
  }

  registerServerSalarySaver(async (amount) => {
    await saveSalary(amount)
  })
  registerServerCapSaver(async (settings) => {
    // updateSettings เรียงคิวให้อยู่แล้ว ส่ง snapshot เพื่อไม่ให้ค่าที่แก้ต่อทีหลังหลุดเข้าไป
    await saveCapSettings(cloneDailyCapSettings(settings))
  })

  return {
    serverSalary,
    serverCapJson,
    loading,
    errorMessage,
    loadSettings,
    saveSalary,
    saveCapSettings,
  }
}
