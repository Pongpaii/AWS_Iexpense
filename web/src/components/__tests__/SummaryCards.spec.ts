import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SummaryCards from '../SummaryCards.vue'

const digitsOf = (value: string) => value.replace(/[^\d.]/g, '')

const mountCards = (props: Partial<InstanceType<typeof SummaryCards>['$props']> = {}) =>
  mount(SummaryCards, {
    props: { balance: 1_000, income: 3_000, expense: 2_000, ...props },
  })

describe('SummaryCards', () => {
  it('แสดงยอดคงเหลือ รายรับ และรายจ่ายทั้งสามใบ', () => {
    const wrapper = mountCards()
    const amounts = wrapper.findAll('.summary-card strong').map((node) => digitsOf(node.text()))

    expect(amounts).toHaveLength(3)
    expect(amounts).toContain('1000')
    expect(amounts).toContain('3000')
    expect(amounts).toContain('2000')
  })

  it('ใช้ป้ายกำกับเริ่มต้นเมื่อไม่ได้ระบุ', () => {
    const wrapper = mountCards()

    expect(wrapper.text()).toContain('ยอดคงเหลือ')
    expect(wrapper.text()).toContain('รายรับ')
    expect(wrapper.text()).toContain('รายจ่าย')
  })

  it('ใช้ป้ายกำกับที่ส่งเข้ามาแทนค่าเริ่มต้น', () => {
    const wrapper = mountCards({
      balanceLabel: 'ยอดคงเหลือปัจจุบัน',
      incomeLabel: 'รายรับวันนี้',
      expenseLabel: 'รายจ่ายวันนี้',
    })

    expect(wrapper.text()).toContain('ยอดคงเหลือปัจจุบัน')
    expect(wrapper.text()).toContain('รายรับวันนี้')
    expect(wrapper.text()).toContain('รายจ่ายวันนี้')
  })

  it('แสดงยอดติดลบได้ ไม่ตัดเครื่องหมายออก', () => {
    const wrapper = mountCards({ balance: -450 })

    expect(wrapper.text()).toMatch(/[-−(]/)
    expect(wrapper.text()).toContain('450')
  })

  it('แสดงศูนย์ ไม่ใช่ช่องว่าง', () => {
    const wrapper = mountCards({ balance: 0, income: 0, expense: 0 })
    const amounts = wrapper.findAll('.summary-card strong').map((node) => digitsOf(node.text()))

    expect(amounts).toEqual(['0', '0', '0'])
  })

  it('มี aria-label ให้ screen reader รู้ว่าเป็นส่วนสรุปยอด', () => {
    expect(mountCards().find('section').attributes('aria-label')).toBe('สรุปยอดเงิน')
  })

  describe('สถานะกำลังโหลด', () => {
    it('แสดงโครงแทนตัวเลขเมื่อ loading เป็น true', () => {
      const wrapper = mountCards({ loading: true })

      expect(wrapper.findAll('.skeleton').length).toBeGreaterThan(0)
      // ต้องไม่โชว์ 0 ระหว่างโหลด เพราะผู้ใช้จะเข้าใจว่าเงินหมด
      expect(wrapper.findAll('.summary-card strong')).toHaveLength(0)
    })

    it('ประกาศสถานะให้ screen reader ระหว่างโหลด', () => {
      const section = mountCards({ loading: true }).find('section')

      expect(section.attributes('role')).toBe('status')
      expect(section.attributes('aria-live')).toBe('polite')
    })

    it('กลับมาแสดงตัวเลขเมื่อโหลดเสร็จ', async () => {
      const wrapper = mountCards({ loading: true })

      await wrapper.setProps({ loading: false })

      expect(wrapper.findAll('.summary-card strong')).toHaveLength(3)
      expect(wrapper.findAll('.skeleton')).toHaveLength(0)
    })
  })
})
