import { computed, ref } from 'vue'
import { transactionCategories, type TransactionCategory } from '../types/transaction'

/**
 * หมวดที่ผู้ใช้สั่ง "ไม่ต้องแสดง" ในปฏิทินความร้อน เก็บเฉพาะบนอุปกรณ์
 *
 * ทำไมแยกจาก useForecastSettings และ useDailyCap: ปฏิทินใช้ดูพฤติกรรมรายวัน
 * ผู้ใช้มักอยากซ่อนก้อนใหญ่ที่จ่ายเดือนละครั้ง (ค่าหอ/ค่างวด) เพื่อให้เห็นว่า
 * วันไหน "ใช้จริง" เยอะ แต่ยังอยากให้สูตรคาดการณ์กับงบรายวันคิดตามเดิม
 */
export const HEATMAP_FILTER_STORAGE_KEY = 'money-flow.heatmap-filter.v1'

/** ซ่อนได้ทุกหมวดรวมเงินเดือน เพราะปฏิทินโชว์ทั้งรายรับและรายจ่ายในช่องเดียวกัน */
export const hideableCategories = transactionCategories

const isValidCategory = (value: unknown): value is TransactionCategory =>
  typeof value === 'string' && hideableCategories.some((option) => option.value === value)

const normalizeCategories = (value: unknown): TransactionCategory[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter(isValidCategory)
    .filter((category, index, list) => list.indexOf(category) === index)
}

const loadHiddenCategories = (): TransactionCategory[] => {
  if (typeof window === 'undefined') return []

  try {
    const stored = window.localStorage.getItem(HEATMAP_FILTER_STORAGE_KEY)
    if (!stored) return []
    return normalizeCategories(JSON.parse(stored) as unknown)
  } catch {
    return []
  }
}

const hidden = ref<TransactionCategory[]>(loadHiddenCategories())

export interface HeatmapFilterSaveResult {
  ok: boolean
  persisted: boolean
}

const persist = () => {
  try {
    window.localStorage.setItem(HEATMAP_FILTER_STORAGE_KEY, JSON.stringify(hidden.value))
    return true
  } catch {
    return false
  }
}

const setCategoryHidden = (
  category: TransactionCategory,
  isHidden: boolean,
): HeatmapFilterSaveResult => {
  if (!isValidCategory(category)) return { ok: false, persisted: false }

  const alreadyHidden = hidden.value.includes(category)
  if (isHidden === alreadyHidden) return { ok: true, persisted: true }

  hidden.value = isHidden
    ? [...hidden.value, category]
    : hidden.value.filter((item) => item !== category)

  return { ok: true, persisted: persist() }
}

const toggleCategoryHidden = (category: TransactionCategory) =>
  setCategoryHidden(category, !hidden.value.includes(category))

const showAllCategories = (): HeatmapFilterSaveResult => {
  hidden.value = []
  return { ok: true, persisted: persist() }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== HEATMAP_FILTER_STORAGE_KEY) return
    if (event.newValue === null) {
      hidden.value = []
      return
    }

    try {
      hidden.value = normalizeCategories(JSON.parse(event.newValue) as unknown)
    } catch {
      /* ค่าที่อ่านไม่ได้ ให้คงค่าปัจจุบันไว้ */
    }
  })
}

const hiddenCategories = computed(() => hidden.value)
const hasHiddenCategories = computed(() => hidden.value.length > 0)

/** ใช้ในเทสต์เพื่อคืนค่าเริ่มต้น ไม่ต้องเรียกจาก UI */
export const resetHeatmapFilter = () => {
  hidden.value = []
}

export const useHeatmapFilter = () => ({
  hiddenCategories,
  hasHiddenCategories,
  hideableCategories,
  isCategoryHidden: (category: TransactionCategory) => hidden.value.includes(category),
  setCategoryHidden,
  toggleCategoryHidden,
  showAllCategories,
})
