import { computed, ref } from 'vue'
import { describeError, isOffline } from '../lib/api'
import { currentUserId } from '../lib/authSession'
import { api } from '../lib/backend'
import { fetchSettings, getCachedSettings, updateSettings } from '../lib/settingsStore'
import { transactionCategories, type TransactionCategory } from '../types/transaction'

export interface CategoryBudget {
  category: TransactionCategory
  /** งบต่อเดือน หน่วยบาท มากกว่า 0 เสมอ (ไม่ตั้งงบ = ไม่มี entry) */
  budget: number
}

export const CATEGORY_BUDGET_STORAGE_KEY = 'money-flow.category-budgets.v1'

/** ต้องตรงกับ MAX_CATEGORY_BUDGETS / MAX_SETTINGS_AMOUNT_BAHT ของ API */
export const MAX_CATEGORY_BUDGETS = 20
export const MAX_CATEGORY_BUDGET_AMOUNT = 100_000_000

const validCategories = new Set<string>(transactionCategories.map((option) => option.value))

/**
 * คัดเฉพาะ entry ที่ใช้งานได้จริง: หมวดต้องเป็นหมวดที่ระบบรู้จัก และงบต้องเป็นเลขบวก
 * ข้อมูลที่ผิดรูปถูกทิ้งเงียบ ๆ เพราะอาจมาจากเวอร์ชันเก่าหรือคนแก้ JSON ตรง ๆ
 */
export const normalizeCategoryBudgets = (value: unknown): CategoryBudget[] => {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: CategoryBudget[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue

    const { category, budget } = entry as { category?: unknown; budget?: unknown }
    if (typeof category !== 'string' || !validCategories.has(category)) continue
    if (seen.has(category)) continue

    const amount = Number(budget)
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_CATEGORY_BUDGET_AMOUNT) continue

    seen.add(category)
    // API เก็บงบเป็นบาทจำนวนเต็ม
    result.push({
      category: category as TransactionCategory,
      budget: Math.max(1, Math.round(amount)),
    })
    if (result.length >= MAX_CATEGORY_BUDGETS) break
  }

  // เรียงตามลำดับหมวดในระบบ เพื่อให้ payload เสถียรและ diff อ่านง่าย
  return result.sort(
    (a, b) =>
      transactionCategories.findIndex((option) => option.value === a.category) -
      transactionCategories.findIndex((option) => option.value === b.category),
  )
}

// --- state ระดับโมดูล: ทุกคอมโพเนนต์ที่เรียกใช้เห็นค่าชุดเดียวกัน ---
const budgets = ref<CategoryBudget[]>([])
const loading = ref(false)
const errorMessage = ref('')
/** คงไว้ให้คอมโพเนนต์เดิมใช้ได้ — ฝั่ง AWS ไม่มีขั้นตอน migration จึงเป็น false เสมอ */
const needsMigration = ref(false)
let loadPromise: Promise<void> | null = null
/** user ของข้อมูลที่อยู่ใน budgets ตอนนี้ ใช้ตรวจว่าต้องโหลดใหม่เมื่อสลับบัญชี */
let loadedUserId: string | null = null

const scopedKey = (userId: string) => `${CATEGORY_BUDGET_STORAGE_KEY}.${userId}`

const readCache = (userId: string): CategoryBudget[] => {
  try {
    const raw = window.localStorage.getItem(scopedKey(userId))
    return raw ? normalizeCategoryBudgets(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

const writeCache = (userId: string, list: CategoryBudget[]) => {
  try {
    window.localStorage.setItem(scopedKey(userId), JSON.stringify(list))
  } catch {
    // ค่าในหน่วยความจำยังใช้ได้ ถ้า storage เขียนไม่ได้ก็ข้ามไป
  }
}

/**
 * อ่าน user ที่ล็อกอินอยู่ทุกครั้ง ไม่ cache ไว้
 * ถ้า cache ไว้ แล้วมีคนสลับบัญชีในเบราว์เซอร์เดียวกัน งบของคนก่อนจะถูกเขียนทับ
 */
const resolveUserId = async () => currentUserId.value

const handleError = (error: unknown, fallback: string) => {
  errorMessage.value = `${fallback}: ${describeError(error)}`
}

const load = async (force = false) => {
  const userId = await resolveUserId()
  // โหลดซ้ำเมื่อสั่ง force หรือเมื่อ user เปลี่ยน ไม่งั้นใช้ผลเดิมที่โหลดไว้แล้ว
  if (loadPromise && !force && loadedUserId === userId) return loadPromise

  loadedUserId = userId
  loadPromise = (async () => {
    if (!userId) {
      budgets.value = []
      return
    }

    budgets.value = readCache(userId)
    if (!api || isOffline()) return

    loading.value = true
    try {
      // useServerSettings โหลดไว้แล้วตอนเข้าระบบ ใช้ซ้ำได้ ไม่ต้องยิง GET อีกรอบ
      const cached = force ? null : getCachedSettings()
      const settings = cached ?? (await fetchSettings(userId))
      if (loadedUserId !== userId) return
      errorMessage.value = ''
      const serverBudgets = normalizeCategoryBudgets(settings.categoryBudgets)
      budgets.value = serverBudgets
      writeCache(userId, serverBudgets)
    } catch (error) {
      handleError(error, 'โหลดงบรายหมวดไม่สำเร็จ ใช้ค่าที่บันทึกในเครื่องแทน')
    } finally {
      loading.value = false
    }
  })()

  return loadPromise
}

const persist = async (next: CategoryBudget[]) => {
  const normalized = normalizeCategoryBudgets(next)
  const previous = budgets.value
  budgets.value = normalized

  const userId = await resolveUserId()
  if (userId) writeCache(userId, normalized)

  if (!api || !userId) return false
  if (isOffline()) {
    errorMessage.value =
      'ออฟไลน์อยู่ งบถูกเก็บไว้ในเครื่องแล้ว จะบันทึกขึ้นเซิร์ฟเวอร์เมื่อกลับมาออนไลน์'
    return false
  }

  try {
    await updateSettings(userId, (settings) => ({ ...settings, categoryBudgets: normalized }))
  } catch (error) {
    handleError(error, 'บันทึกงบรายหมวดไม่สำเร็จ')
    // คืนค่าเดิม ไม่ให้หน้าจอโชว์สิ่งที่เซิร์ฟเวอร์ไม่ได้รับ
    budgets.value = previous
    writeCache(userId, previous)
    return false
  }

  errorMessage.value = ''
  return true
}

/**
 * งบรายหมวดต่อเดือน เก็บใน settings.categoryBudgets ของ API
 *
 * ซิงก์ข้ามแท็บด้วย storage event แบบเดียวกับ preference อื่น ไม่ได้ใช้ realtime channel
 * เพราะการตั้งค่าเปลี่ยนน้อยมาก ไม่คุ้มกับการเปิด websocket ค้างไว้
 */
export const useCategoryBudgets = () => {
  void load()

  const getBudget = (category: TransactionCategory) =>
    budgets.value.find((item) => item.category === category)?.budget ?? null

  const setBudget = async (category: TransactionCategory, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return removeBudget(category)

    const capped = Math.min(Math.round(amount * 100) / 100, MAX_CATEGORY_BUDGET_AMOUNT)
    const others = budgets.value.filter((item) => item.category !== category)
    if (others.length >= MAX_CATEGORY_BUDGETS) {
      errorMessage.value = `ตั้งงบได้มากที่สุด ${MAX_CATEGORY_BUDGETS} หมวด`
      return false
    }

    return persist([...others, { category, budget: capped }])
  }

  const removeBudget = async (category: TransactionCategory) =>
    persist(budgets.value.filter((item) => item.category !== category))

  const replaceBudgets = async (next: CategoryBudget[]) => persist(next)

  const clearBudgets = async () => persist([])

  return {
    budgets,
    loading,
    errorMessage,
    needsMigration,
    hasBudgets: computed(() => budgets.value.length > 0),
    reload: () => load(true),
    getBudget,
    setBudget,
    removeBudget,
    replaceBudgets,
    clearBudgets,
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!loadedUserId || event.key !== scopedKey(loadedUserId)) return
    if (!event.newValue) {
      budgets.value = []
      return
    }
    try {
      budgets.value = normalizeCategoryBudgets(JSON.parse(event.newValue))
    } catch {
      // แท็บอื่นเขียนค่าที่อ่านไม่ออก ปล่อยให้ค่าที่มีอยู่ทำงานต่อ
    }
  })
}
