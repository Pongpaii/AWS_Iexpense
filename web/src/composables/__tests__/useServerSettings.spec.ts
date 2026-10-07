import { defaultSettings, type UserSettings } from '@money-flow/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  offline: false,
  server: null as UserSettings | null,
}
const getSettings = vi.fn(async () => state.server ?? defaultSettings())
const putSettings = vi.fn(async (body: Record<string, unknown>) => ({
  ...defaultSettings(),
  ...body,
  updatedAt: '2026-03-15T00:00:00.000Z',
}))

vi.mock('../../lib/backend', () => ({ api: { getSettings, putSettings } }))

vi.mock('../../lib/api', () => ({
  describeError: (error: unknown) => String(error),
  isOffline: () => state.offline,
}))

const capSettings = {
  enabled: true,
  excludedCategories: [],
  weekday: { cap: 300, items: [] },
  weekend: { cap: 250, items: [] },
}

const importSubject = async () => {
  const [
    { useServerSettings },
    { useSalarySettings, SALARY_STORAGE_KEY },
    { DAILY_CAP_STORAGE_KEY },
    { resetSettingsStore },
  ] = await Promise.all([
    import('../useServerSettings'),
    import('../useSalarySettings'),
    import('../useDailyCap'),
    import('../../lib/settingsStore'),
  ])
  resetSettingsStore()
  return { useServerSettings, useSalarySettings, SALARY_STORAGE_KEY, DAILY_CAP_STORAGE_KEY }
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  state.offline = false
  state.server = null
  getSettings.mockClear()
  putSettings.mockClear()
})

describe('useServerSettings', () => {
  it('โหลดเงินเดือนและแผนงบรายวันจากเซิร์ฟเวอร์ แล้วบันทึกลง cache', async () => {
    state.server = {
      ...defaultSettings(),
      monthlySalary: 42000,
      dailyCapPlan: capSettings,
      updatedAt: '2026-03-15T00:00:00.000Z',
    }
    const { useServerSettings, SALARY_STORAGE_KEY, DAILY_CAP_STORAGE_KEY } = await importSubject()
    const settings = useServerSettings(() => 'user-1')

    await settings.loadSettings()

    expect(getSettings).toHaveBeenCalledOnce()
    expect(putSettings).not.toHaveBeenCalled()
    expect(settings.serverSalary.value).toBe(42000)
    expect(localStorage.getItem(SALARY_STORAGE_KEY)).toBe('42000')
    expect(JSON.parse(localStorage.getItem(DAILY_CAP_STORAGE_KEY) ?? '{}')).toMatchObject(
      capSettings,
    )
  })

  it('ยังไม่เคยบันทึกบนเซิร์ฟเวอร์: ยกค่าในเครื่องขึ้นไป (ปัดเป็นบาทจำนวนเต็ม)', async () => {
    localStorage.setItem('money-flow.monthly-salary.v1', '31500.6')
    localStorage.setItem('money-flow.daily-cap.v1', JSON.stringify(capSettings))
    const { useServerSettings } = await importSubject()
    const settings = useServerSettings(() => 'user-1')

    await settings.loadSettings()

    expect(putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlySalary: 31501,
        dailyCapPlan: expect.objectContaining({ weekday: { cap: 300, items: [] } }),
      }),
    )
    expect(settings.serverSalary.value).toBe(31500.6)
    expect(settings.serverCapJson.value).toEqual(capSettings)
  })

  it('ใช้งาน cache โดยไม่เรียกเซิร์ฟเวอร์เมื่อออฟไลน์', async () => {
    state.offline = true
    localStorage.setItem('money-flow.monthly-salary.v1', '28000')
    localStorage.setItem('money-flow.daily-cap.v1', JSON.stringify(capSettings))
    const { useServerSettings } = await importSubject()
    const settings = useServerSettings(() => 'user-1')

    await settings.loadSettings()

    expect(getSettings).not.toHaveBeenCalled()
    expect(putSettings).not.toHaveBeenCalled()
    expect(settings.serverSalary.value).toBe(28000)
    expect(settings.serverCapJson.value).toEqual(capSettings)
  })

  it('บันทึกเงินเดือน: PUT ทั้งก้อนโดยคงค่าอื่นของเซิร์ฟเวอร์ไว้', async () => {
    state.server = {
      ...defaultSettings(),
      categoryBudgets: [{ category: 'อาหาร', budget: 3000 }],
      updatedAt: '2026-03-15T00:00:00.000Z',
    }
    const { useServerSettings, useSalarySettings, SALARY_STORAGE_KEY } = await importSubject()
    const settings = useServerSettings(() => 'user-1')

    const saveResult = useSalarySettings().saveMonthlySalary(45678)
    await flush()

    expect(saveResult).toEqual({ ok: true, persisted: true })
    expect(localStorage.getItem(SALARY_STORAGE_KEY)).toBe('45678')
    expect(settings.serverSalary.value).toBe(45678)
    expect(putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlySalary: 45678,
        categoryBudgets: [{ category: 'อาหาร', budget: 3000 }],
      }),
    )
  })
})
