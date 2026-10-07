import { defaultSettings, type UserSettings } from '@money-flow/shared'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  offline: false,
  server: null as UserSettings | null,
  getError: null as Error | null,
  putError: null as Error | null,
}

const getSettings = vi.fn(async () => {
  if (state.getError) throw state.getError
  return state.server ?? defaultSettings()
})
const putSettings = vi.fn(async (body: Record<string, unknown>) => {
  if (state.putError) throw state.putError
  const saved = { ...defaultSettings(), ...body, updatedAt: '2026-03-15T00:00:00.000Z' }
  state.server = saved as UserSettings
  return saved
})

vi.mock('../../lib/backend', () => ({ api: { getSettings, putSettings } }))

vi.mock('../../lib/api', () => ({
  describeError: (error: unknown) => String(error),
  isOffline: () => state.offline,
}))

const importSubject = async () => {
  const [subject, { currentUserId }, { resetSettingsStore }] = await Promise.all([
    import('../useCategoryBudgets'),
    import('../../lib/authSession'),
    import('../../lib/settingsStore'),
  ])
  resetSettingsStore()
  currentUserId.value = 'user-1'
  return { ...subject, currentUserId }
}

// import ครั้งแรกต้อง transform zod/shared ทั้งก้อน อาจเกิน timeout 5s ของเทสต์แรกเมื่อเครื่องยุ่ง
beforeAll(async () => {
  await importSubject()
}, 30_000)

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  state.offline = false
  state.server = null
  state.getError = null
  state.putError = null
  getSettings.mockClear()
  putSettings.mockClear()
})

describe('normalizeCategoryBudgets', () => {
  it('ทิ้ง entry ที่หมวดไม่รู้จัก งบไม่ใช่เลขบวก หรือรูปแบบผิด', async () => {
    const { normalizeCategoryBudgets } = await importSubject()

    expect(
      normalizeCategoryBudgets([
        { category: 'อาหาร', budget: 500 },
        { category: 'หมวดที่ไม่มีจริง', budget: 500 },
        { category: 'การเดินทาง', budget: 0 },
        { category: 'ช้อปปิ้ง', budget: -10 },
        { category: 'ที่พัก', budget: 'abc' },
        'ไม่ใช่ object',
        null,
      ]),
    ).toEqual([{ category: 'อาหาร', budget: 500 }])
  })

  it('ตัดหมวดซ้ำ เก็บค่าแรกไว้', async () => {
    const { normalizeCategoryBudgets } = await importSubject()

    expect(
      normalizeCategoryBudgets([
        { category: 'อาหาร', budget: 500 },
        { category: 'อาหาร', budget: 900 },
      ]),
    ).toEqual([{ category: 'อาหาร', budget: 500 }])
  })

  it('ปัดเป็นบาทจำนวนเต็ม เพราะ API ไม่รับทศนิยม', async () => {
    const { normalizeCategoryBudgets } = await importSubject()

    expect(normalizeCategoryBudgets([{ category: 'อาหาร', budget: 1234.6 }])).toEqual([
      { category: 'อาหาร', budget: 1235 },
    ])
  })

  it('เรียงตามลำดับหมวดในระบบ ไม่ใช่ลำดับที่ส่งเข้ามา', async () => {
    const { normalizeCategoryBudgets } = await importSubject()

    expect(
      normalizeCategoryBudgets([
        { category: 'สุขภาพ', budget: 100 },
        { category: 'อาหาร', budget: 200 },
      ]).map((item) => item.category),
    ).toEqual(['อาหาร', 'สุขภาพ'])
  })

  it('คืน array ว่างเมื่อค่าที่ได้ไม่ใช่ array', async () => {
    const { normalizeCategoryBudgets } = await importSubject()

    expect(normalizeCategoryBudgets(null)).toEqual([])
    expect(normalizeCategoryBudgets({ category: 'อาหาร' })).toEqual([])
  })

  it('จำกัดจำนวน entry ไม่ให้เกินเพดานของ API', async () => {
    const { normalizeCategoryBudgets, MAX_CATEGORY_BUDGETS } = await importSubject()
    const many = Array.from({ length: 30 }, (_, index) => ({
      category: index % 2 === 0 ? 'อาหาร' : 'การเดินทาง',
      budget: 100 + index,
    }))

    expect(normalizeCategoryBudgets(many).length).toBeLessThanOrEqual(MAX_CATEGORY_BUDGETS)
  })
})

describe('useCategoryBudgets', () => {
  it('โหลดค่าจากเซิร์ฟเวอร์และเก็บ cache ตาม user', async () => {
    state.server = {
      ...defaultSettings(),
      categoryBudgets: [{ category: 'อาหาร', budget: 4200 }],
      updatedAt: '2026-03-15T00:00:00.000Z',
    }
    const { useCategoryBudgets, CATEGORY_BUDGET_STORAGE_KEY } = await importSubject()

    const store = useCategoryBudgets()
    await store.reload()

    expect(getSettings).toHaveBeenCalled()
    expect(store.budgets.value).toEqual([{ category: 'อาหาร', budget: 4200 }])
    expect(store.hasBudgets.value).toBe(true)
    expect(localStorage.getItem(`${CATEGORY_BUDGET_STORAGE_KEY}.user-1`)).toBe(
      JSON.stringify([{ category: 'อาหาร', budget: 4200 }]),
    )
  })

  it('ยังไม่ล็อกอิน = ไม่ยิงเซิร์ฟเวอร์ และไม่มีงบ', async () => {
    const { useCategoryBudgets, currentUserId } = await importSubject()
    currentUserId.value = null

    const store = useCategoryBudgets()
    await store.reload()

    expect(getSettings).not.toHaveBeenCalled()
    expect(store.budgets.value).toEqual([])
    expect(store.hasBudgets.value).toBe(false)
  })

  it('setBudget บันทึกขึ้นเซิร์ฟเวอร์โดยคงการตั้งค่าอื่นไว้', async () => {
    state.server = { ...defaultSettings(), monthlySalary: 30000, updatedAt: null }
    const { useCategoryBudgets } = await importSubject()
    const store = useCategoryBudgets()
    await store.reload()

    const saved = await store.setBudget('อาหาร', 3500)

    expect(saved).toBe(true)
    expect(putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlySalary: 30000,
        categoryBudgets: [{ category: 'อาหาร', budget: 3500 }],
      }),
    )
    expect(store.getBudget('อาหาร')).toBe(3500)
    expect(store.getBudget('การเดินทาง')).toBeNull()
  })

  it('setBudget ด้วยยอด 0 หรือติดลบ = ถอดงบหมวดนั้นออก', async () => {
    const { useCategoryBudgets } = await importSubject()
    const store = useCategoryBudgets()
    await store.reload()
    await store.setBudget('อาหาร', 3500)

    await store.setBudget('อาหาร', 0)

    expect(store.budgets.value).toEqual([])
  })

  it('removeBudget เอาออกเฉพาะหมวดที่ระบุ', async () => {
    const { useCategoryBudgets } = await importSubject()
    const store = useCategoryBudgets()
    await store.reload()
    await store.replaceBudgets([
      { category: 'อาหาร', budget: 1000 },
      { category: 'การเดินทาง', budget: 500 },
    ])

    await store.removeBudget('อาหาร')

    expect(store.budgets.value).toEqual([{ category: 'การเดินทาง', budget: 500 }])
  })

  it('บันทึกไม่สำเร็จแล้วคืนค่าเดิม ไม่โชว์สิ่งที่เซิร์ฟเวอร์ไม่ได้รับ', async () => {
    const { useCategoryBudgets } = await importSubject()
    const store = useCategoryBudgets()
    await store.reload()
    await store.setBudget('อาหาร', 1000)

    state.putError = new Error('เซิร์ฟเวอร์ล่ม')
    const saved = await store.setBudget('การเดินทาง', 700)

    expect(saved).toBe(false)
    expect(store.budgets.value).toEqual([{ category: 'อาหาร', budget: 1000 }])
    expect(store.errorMessage.value).toContain('บันทึกงบรายหมวดไม่สำเร็จ')
  })

  it('ออฟไลน์ = เก็บลงเครื่องแล้วบอกผู้ใช้ ไม่ยิงเซิร์ฟเวอร์', async () => {
    const { useCategoryBudgets, CATEGORY_BUDGET_STORAGE_KEY } = await importSubject()
    const store = useCategoryBudgets()
    await store.reload()

    state.offline = true
    const saved = await store.setBudget('อาหาร', 2200)

    expect(saved).toBe(false)
    expect(putSettings).not.toHaveBeenCalled()
    expect(store.budgets.value).toEqual([{ category: 'อาหาร', budget: 2200 }])
    expect(localStorage.getItem(`${CATEGORY_BUDGET_STORAGE_KEY}.user-1`)).toContain('2200')
    expect(store.errorMessage.value).toContain('ออฟไลน์')
  })

  it('อ่าน cache ในเครื่องได้เมื่อเซิร์ฟเวอร์ตอบไม่ได้', async () => {
    const { useCategoryBudgets, CATEGORY_BUDGET_STORAGE_KEY } = await importSubject()
    localStorage.setItem(
      `${CATEGORY_BUDGET_STORAGE_KEY}.user-1`,
      JSON.stringify([{ category: 'ที่พัก', budget: 8000 }]),
    )
    state.getError = new Error('เชื่อมต่อไม่ได้')

    const store = useCategoryBudgets()
    await store.reload()

    expect(store.budgets.value).toEqual([{ category: 'ที่พัก', budget: 8000 }])
    expect(store.errorMessage.value).toContain('ใช้ค่าที่บันทึกในเครื่องแทน')
  })

  it('clearBudgets ล้างทั้งหมดและบันทึก array ว่าง', async () => {
    const { useCategoryBudgets } = await importSubject()
    const store = useCategoryBudgets()
    await store.reload()
    await store.setBudget('อาหาร', 1000)

    await store.clearBudgets()

    expect(store.budgets.value).toEqual([])
    expect(putSettings).toHaveBeenLastCalledWith(expect.objectContaining({ categoryBudgets: [] }))
  })
})
