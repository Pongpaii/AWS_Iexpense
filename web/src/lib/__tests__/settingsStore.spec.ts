import { defaultSettings, type UserSettings } from '@money-flow/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSettings = vi.fn<() => Promise<UserSettings>>()
const putSettings = vi.fn<(body: Record<string, unknown>) => Promise<UserSettings>>()

vi.mock('../backend', () => ({ api: { getSettings, putSettings } }))

const { fetchSettings, resetSettingsStore, updateSettings } = await import('../settingsStore')

beforeEach(() => {
  resetSettingsStore()
  getSettings.mockReset().mockResolvedValue({ ...defaultSettings(), monthlySalary: 20000 })
  putSettings.mockReset().mockImplementation(async (body) => ({
    ...defaultSettings(),
    ...body,
    updatedAt: '2026-03-15T00:00:00.000Z',
  }))
})

describe('settingsStore', () => {
  it('ยังไม่เคยโหลด: GET ก่อนเพื่อไม่เขียนทับค่าอื่นด้วย default', async () => {
    await updateSettings('u1', (s) => ({ ...s, expenseColor: 'blue' }))

    expect(getSettings).toHaveBeenCalledOnce()
    expect(putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ monthlySalary: 20000, expenseColor: 'blue' }),
    )
    // PUT ต้องไม่มี updatedAt (strict schema ฝั่ง API)
    expect(putSettings.mock.calls[0][0]).not.toHaveProperty('updatedAt')
  })

  it('สองคำขอพร้อมกัน: ทำต่อคิว ค่าของทั้งคู่ไม่หาย', async () => {
    await fetchSettings('u1')

    await Promise.all([
      updateSettings('u1', (s) => ({ ...s, monthlySalary: 30000 })),
      updateSettings('u1', (s) => ({
        ...s,
        categoryBudgets: [{ category: 'อาหาร', budget: 3000 }],
      })),
    ])

    expect(putSettings).toHaveBeenCalledTimes(2)
    expect(putSettings.mock.calls[1][0]).toMatchObject({
      monthlySalary: 30000,
      categoryBudgets: [{ category: 'อาหาร', budget: 3000 }],
    })
  })

  it('คำขอที่ล้มเหลวไม่ทำให้คิวค้าง', async () => {
    await fetchSettings('u1')
    putSettings.mockRejectedValueOnce(new Error('500'))

    await expect(updateSettings('u1', (s) => s)).rejects.toThrow('500')
    await expect(updateSettings('u1', (s) => ({ ...s, monthlySalary: 1 }))).resolves.toMatchObject({
      monthlySalary: 1,
    })
  })

  it('สลับ user: ไม่เอาค่าของคนก่อนไปเขียนให้คนใหม่', async () => {
    await fetchSettings('u1')
    getSettings.mockResolvedValueOnce({ ...defaultSettings(), monthlySalary: 55555 })

    await updateSettings('u2', (s) => s)

    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(putSettings.mock.calls[0][0]).toMatchObject({ monthlySalary: 55555 })
  })
})
