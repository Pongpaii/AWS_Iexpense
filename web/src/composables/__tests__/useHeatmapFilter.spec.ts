import { beforeEach, describe, expect, it } from 'vitest'
import {
  HEATMAP_FILTER_STORAGE_KEY,
  resetHeatmapFilter,
  useHeatmapFilter,
} from '../useHeatmapFilter'

const {
  hiddenCategories,
  hasHiddenCategories,
  hideableCategories,
  isCategoryHidden,
  setCategoryHidden,
  toggleCategoryHidden,
  showAllCategories,
} = useHeatmapFilter()

beforeEach(() => {
  window.localStorage.clear()
  resetHeatmapFilter()
})

describe('useHeatmapFilter', () => {
  it('ค่าเริ่มต้นคือแสดงทุกหมวด', () => {
    expect(hiddenCategories.value).toEqual([])
    expect(hasHiddenCategories.value).toBe(false)
  })

  it('ซ่อนได้ทุกหมวดรวมเงินเดือน เพราะปฏิทินโชว์รายรับด้วย', () => {
    expect(hideableCategories.map((option) => option.value)).toContain('เงินเดือน')
    expect(setCategoryHidden('เงินเดือน', true).ok).toBe(true)
    expect(isCategoryHidden('เงินเดือน')).toBe(true)
  })

  it('ซ่อนหมวดแล้วจำค่าไว้ใน localStorage', () => {
    const result = setCategoryHidden('ที่พัก', true)

    expect(result).toEqual({ ok: true, persisted: true })
    expect(hiddenCategories.value).toEqual(['ที่พัก'])
    expect(hasHiddenCategories.value).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(HEATMAP_FILTER_STORAGE_KEY) ?? '[]')).toEqual([
      'ที่พัก',
    ])
  })

  it('ไม่เพิ่มหมวดซ้ำและเอากลับมาแสดงได้', () => {
    setCategoryHidden('อาหาร', true)
    setCategoryHidden('อาหาร', true)
    expect(hiddenCategories.value).toEqual(['อาหาร'])

    setCategoryHidden('อาหาร', false)
    expect(hiddenCategories.value).toEqual([])
  })

  it('toggle สลับสถานะของหมวดเดิม', () => {
    toggleCategoryHidden('การเดินทาง')
    expect(isCategoryHidden('การเดินทาง')).toBe(true)

    toggleCategoryHidden('การเดินทาง')
    expect(isCategoryHidden('การเดินทาง')).toBe(false)
  })

  it('ปฏิเสธหมวดที่ไม่มีในระบบ', () => {
    expect(setCategoryHidden('ยานอวกาศ' as never, true)).toEqual({ ok: false, persisted: false })
    expect(hiddenCategories.value).toEqual([])
  })

  it('showAllCategories ล้างรายการที่ซ่อนไว้ทั้งหมด', () => {
    setCategoryHidden('ที่พัก', true)
    setCategoryHidden('ช้อปปิ้ง', true)

    expect(showAllCategories()).toEqual({ ok: true, persisted: true })
    expect(hiddenCategories.value).toEqual([])
  })

  it('ซิงก์ข้ามแท็บ และกรองค่าขยะออกจาก storage event', () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: HEATMAP_FILTER_STORAGE_KEY,
        newValue: JSON.stringify(['ที่พัก', 'ที่พัก', 'ไม่มีหมวดนี้']),
      }),
    )

    expect(hiddenCategories.value).toEqual(['ที่พัก'])

    window.dispatchEvent(
      new StorageEvent('storage', { key: HEATMAP_FILTER_STORAGE_KEY, newValue: null }),
    )
    expect(hiddenCategories.value).toEqual([])
  })
})
