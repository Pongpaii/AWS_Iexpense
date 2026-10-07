import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetHeatmapFilter, useHeatmapFilter } from '../../composables/useHeatmapFilter'
import { makeTransaction } from '../../test-utils/factories'
import HeatmapCalendar from '../HeatmapCalendar.vue'

const { setCategoryHidden } = useHeatmapFilter()

const MONTH = '2026-03'

const transactions = [
  makeTransaction({ category: 'อาหาร', amount: 120, transaction_date: '2026-03-02' }),
  makeTransaction({ category: 'ที่พัก', amount: 5_000, transaction_date: '2026-03-05' }),
  makeTransaction({ category: 'การเดินทาง', amount: 80, transaction_date: '2026-03-05' }),
]

const digitsOf = (value: string) => value.replace(/[^\d]/g, '')

const mountCalendar = () => mount(HeatmapCalendar, { props: { transactions, month: MONTH } })

/** ยอด "รายจ่ายเดือนนี้" เป็นตัวเลขตัวแรกในแถบสถิติของการ์ด */
const monthExpenseText = (wrapper: ReturnType<typeof mountCalendar>) =>
  digitsOf(wrapper.findAll('.heatmap-stats b')[0].text())

beforeEach(() => {
  window.localStorage.clear()
  resetHeatmapFilter()
})

describe('HeatmapCalendar — ตัวกรองหมวดหมู่', () => {
  it('นับทุกหมวดเมื่อยังไม่ได้ซ่อนอะไร', () => {
    const wrapper = mountCalendar()

    expect(monthExpenseText(wrapper)).toBe('5200')
    expect(wrapper.text()).toContain('เลือกหมวดที่จะแสดง')
  })

  it('ซ่อนหมวดแล้วปฏิทินหยุดนับยอดของหมวดนั้น', async () => {
    const wrapper = mountCalendar()
    setCategoryHidden('ที่พัก', true)
    await wrapper.vm.$nextTick()

    expect(monthExpenseText(wrapper)).toBe('200')
    expect(wrapper.text()).toContain('ซ่อนอยู่ 1 หมวด')
    expect(wrapper.text()).toContain('ที่พัก')
  })

  it('กดปุ่มแล้วเปิดแผงให้ติ๊กหมวดได้ครบทุกหมวด', async () => {
    const wrapper = mountCalendar()

    expect(wrapper.find('.heatmap-filter__panel').exists()).toBe(false)
    await wrapper.find('.heatmap-filter__toggle').trigger('click')

    const chips = wrapper.findAll('.heatmap-chip')
    expect(chips.length).toBeGreaterThan(0)
    expect(wrapper.find('.heatmap-filter__panel').text()).toContain('อาหาร')
  })

  it('ติ๊กที่ชิปแล้วซ่อนหมวดนั้นทันที', async () => {
    const wrapper = mountCalendar()
    await wrapper.find('.heatmap-filter__toggle').trigger('click')

    const foodChip = wrapper.findAll('.heatmap-chip').find((chip) => chip.text().includes('อาหาร'))
    await foodChip!.find('input').setValue(true)

    expect(monthExpenseText(wrapper)).toBe('5080')
    expect(foodChip!.classes()).toContain('is-off')
  })
})
