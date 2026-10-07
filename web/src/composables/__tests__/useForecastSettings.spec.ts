import { beforeEach, describe, expect, it } from 'vitest'
import {
  FORECAST_SETTINGS_STORAGE_KEY,
  resetForecastSettings,
  useForecastSettings,
} from '../useForecastSettings'

const {
  encouragingMode,
  excludableCategories,
  excludedCategories,
  hasExcludedCategories,
  isCategoryExcluded,
  clearExcludedCategories,
  setCategoryExcluded,
  setEncouragingMode,
  toggleCategoryExcluded,
  toggleEncouragingMode,
} = useForecastSettings()

beforeEach(() => {
  window.localStorage.clear()
  resetForecastSettings()
})

describe('useForecastSettings', () => {
  it('ค่าเริ่มต้นคือรวมทุกหมวดและเปิดโหมดให้กำลังใจ', () => {
    expect(excludedCategories.value).toEqual([])
    expect(hasExcludedCategories.value).toBe(false)
    expect(encouragingMode.value).toBe(true)
  })

  it('ไม่ให้เลือกกันหมวดเงินเดือนเพราะเป็นรายรับ', () => {
    const selectable: string[] = excludableCategories.map((option) => option.value)

    expect(selectable).not.toContain('เงินเดือน')
    expect(setCategoryExcluded('เงินเดือน', true).ok).toBe(false)
    expect(excludedCategories.value).toEqual([])
  })

  it('กันหมวดที่พักออกแล้วจำค่าไว้ใน localStorage', () => {
    const result = setCategoryExcluded('ที่พัก', true)

    expect(result.ok).toBe(true)
    expect(result.persisted).toBe(true)
    expect(excludedCategories.value).toEqual(['ที่พัก'])
    expect(isCategoryExcluded('ที่พัก')).toBe(true)
    expect(hasExcludedCategories.value).toBe(true)

    const stored = JSON.parse(
      window.localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>
    expect(stored.excludedCategories).toEqual(['ที่พัก'])
  })

  it('ไม่เพิ่มหมวดซ้ำเมื่อสั่งกันออกสองครั้ง', () => {
    setCategoryExcluded('ที่พัก', true)
    setCategoryExcluded('ที่พัก', true)

    expect(excludedCategories.value).toEqual(['ที่พัก'])
  })

  it('สลับกันออกและเอากลับได้', () => {
    toggleCategoryExcluded('ที่พัก')
    expect(excludedCategories.value).toEqual(['ที่พัก'])

    toggleCategoryExcluded('ที่พัก')
    expect(excludedCategories.value).toEqual([])
  })

  it('รวมทุกหมวดกลับได้ในครั้งเดียว', () => {
    setCategoryExcluded('ที่พัก', true)
    setCategoryExcluded('การศึกษา', true)
    expect(excludedCategories.value).toHaveLength(2)

    clearExcludedCategories()
    expect(excludedCategories.value).toEqual([])
  })

  it('ปิดและเปิดโหมดให้กำลังใจได้', () => {
    setEncouragingMode(false)
    expect(encouragingMode.value).toBe(false)

    toggleEncouragingMode()
    expect(encouragingMode.value).toBe(true)
  })

  it('ทิ้งค่าที่อ่านไม่ได้จาก localStorage แล้วใช้ค่าเริ่มต้น', () => {
    window.localStorage.setItem(
      FORECAST_SETTINGS_STORAGE_KEY,
      JSON.stringify({ excludedCategories: ['ไม่มีหมวดนี้', 'ที่พัก'], encouragingMode: 'yes' }),
    )

    // จำลองการเปิดแอปใหม่ผ่าน storage event ซึ่งใช้ตัว normalize ตัวเดียวกับตอนโหลด
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: FORECAST_SETTINGS_STORAGE_KEY,
        newValue: window.localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY),
      }),
    )

    expect(excludedCategories.value).toEqual(['ที่พัก'])
    expect(encouragingMode.value).toBe(true)
  })
})
