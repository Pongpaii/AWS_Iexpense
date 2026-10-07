import { computed, readonly, ref } from 'vue'
import { transactionCategories, type TransactionCategory } from '../types/transaction'

/**
 * การตั้งค่าหน้า "คาดการณ์ 30 วัน" เก็บไว้เฉพาะบนอุปกรณ์
 *
 * ทำไมต้องมี: ค่าที่พักหรือค่างวดที่จ่ายก้อนเดียวทุกเดือน ทำให้ตัวเลขแนวโน้มดูน่ากลัว
 * เกินกว่าที่จะใช้ตัดสินใจรายวันได้ ผู้ใช้จึงควรเลือกได้ว่าจะกันหมวดไหนออกจากสูตร
 * และเลือกได้ว่าอยากให้น้องถุงเงินพูดแบบให้กำลังใจแค่ไหน
 */
export interface ForecastSettings {
  /** หมวดที่ไม่เอามาคิดในสูตรคาดการณ์ (ยอดคงเหลือจริงยังนับครบ) */
  excludedCategories: TransactionCategory[]
  /** true = เลี่ยงคำขู่และเน้นทางออก แทนการโชว์ยอดติดลบเป็นพระเอก */
  encouragingMode: boolean
}

export const FORECAST_SETTINGS_STORAGE_KEY = 'money-flow.forecast-settings.v1'

/** หมวดที่กันออกได้ ไม่รวมเงินเดือนเพราะเป็นรายรับ ไม่ได้อยู่ในสูตรรายจ่ายอยู่แล้ว */
export const excludableCategories = transactionCategories.filter(
  (option) => option.value !== 'เงินเดือน',
)

const createDefaultSettings = (): ForecastSettings => ({
  excludedCategories: [],
  encouragingMode: true,
})

const isValidCategory = (value: unknown): value is TransactionCategory =>
  typeof value === 'string' && excludableCategories.some((option) => option.value === value)

const normalizeSettings = (value: unknown): ForecastSettings => {
  const fallback = createDefaultSettings()
  if (typeof value !== 'object' || value === null) return fallback
  const raw = value as Record<string, unknown>

  const excludedCategories = Array.isArray(raw.excludedCategories)
    ? raw.excludedCategories
        .filter(isValidCategory)
        .filter((category, index, list) => list.indexOf(category) === index)
    : fallback.excludedCategories

  return {
    excludedCategories,
    encouragingMode:
      typeof raw.encouragingMode === 'boolean' ? raw.encouragingMode : fallback.encouragingMode,
  }
}

const loadSettings = (): ForecastSettings => {
  if (typeof window === 'undefined') return createDefaultSettings()

  try {
    const stored = window.localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY)
    if (!stored) return createDefaultSettings()
    return normalizeSettings(JSON.parse(stored) as unknown)
  } catch {
    return createDefaultSettings()
  }
}

const settings = ref<ForecastSettings>(loadSettings())
const readonlySettings = readonly(settings)

const persist = () => {
  try {
    window.localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify(settings.value))
    return true
  } catch {
    return false
  }
}

export interface ForecastSettingSaveResult {
  ok: boolean
  persisted: boolean
}

const setCategoryExcluded = (
  category: TransactionCategory,
  excluded: boolean,
): ForecastSettingSaveResult => {
  if (!isValidCategory(category)) return { ok: false, persisted: false }

  const current = settings.value.excludedCategories
  const alreadyExcluded = current.includes(category)
  if (excluded === alreadyExcluded) return { ok: true, persisted: true }

  settings.value = {
    ...settings.value,
    excludedCategories: excluded
      ? [...current, category]
      : current.filter((item) => item !== category),
  }

  return { ok: true, persisted: persist() }
}

const toggleCategoryExcluded = (category: TransactionCategory) =>
  setCategoryExcluded(category, !settings.value.excludedCategories.includes(category))

const clearExcludedCategories = (): ForecastSettingSaveResult => {
  settings.value = { ...settings.value, excludedCategories: [] }
  return { ok: true, persisted: persist() }
}

const setEncouragingMode = (enabled: boolean): ForecastSettingSaveResult => {
  settings.value = { ...settings.value, encouragingMode: enabled }
  return { ok: true, persisted: persist() }
}

const toggleEncouragingMode = () => setEncouragingMode(!settings.value.encouragingMode)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== FORECAST_SETTINGS_STORAGE_KEY) return
    if (event.newValue === null) {
      settings.value = createDefaultSettings()
      return
    }

    try {
      settings.value = normalizeSettings(JSON.parse(event.newValue) as unknown)
    } catch {
      /* ค่าที่อ่านไม่ได้ ให้คงค่าปัจจุบันไว้ */
    }
  })
}

const excludedCategories = computed(() => settings.value.excludedCategories)
const encouragingMode = computed(() => settings.value.encouragingMode)
const hasExcludedCategories = computed(() => settings.value.excludedCategories.length > 0)

/** ใช้ในเทสต์เพื่อคืนค่าเริ่มต้น ไม่ต้องเรียกจาก UI */
export const resetForecastSettings = () => {
  settings.value = createDefaultSettings()
}

export const useForecastSettings = () => ({
  forecastSettings: readonlySettings,
  excludedCategories,
  encouragingMode,
  hasExcludedCategories,
  excludableCategories,
  isCategoryExcluded: (category: TransactionCategory) =>
    settings.value.excludedCategories.includes(category),
  setCategoryExcluded,
  toggleCategoryExcluded,
  clearExcludedCategories,
  setEncouragingMode,
  toggleEncouragingMode,
})
