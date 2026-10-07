import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { makeTransaction } from '../../test-utils/factories'
import type { Transaction } from '../../types/transaction'
import TransactionList from '../TransactionList.vue'

type ListWrapper = VueWrapper<InstanceType<typeof TransactionList>>

const mountList = (props: Record<string, unknown> = {}): ListWrapper =>
  mount(TransactionList, {
    props: {
      transactions: [],
      loading: false,
      busyId: null,
      selectionMode: false,
      bulkBusy: false,
      emptyHint: 'ยังไม่มีรายการ ลองเพิ่มดู',
      ...props,
    },
  }) as ListWrapper

const manyTransactions = (count: number): Transaction[] =>
  Array.from({ length: count }, (_, index) =>
    makeTransaction({ id: `tx-${index + 1}`, description: `รายการ ${index + 1}` }),
  )

describe('TransactionList', () => {
  describe('สถานะของรายการ', () => {
    it('แสดงโครงระหว่างโหลด ไม่ใช่ข้อความว่างเปล่า', () => {
      const wrapper = mountList({ loading: true })

      expect(wrapper.findAll('.skeleton').length).toBeGreaterThan(0)
      expect(wrapper.find('.transaction-list').exists()).toBe(false)
    })

    it('แสดงคำแนะนำเมื่อยังไม่มีรายการ', () => {
      const wrapper = mountList({ emptyHint: 'เดือนนี้ยังไม่มีรายการ' })

      expect(wrapper.text()).toContain('เดือนนี้ยังไม่มีรายการ')
      expect(wrapper.find('.transaction-list').exists()).toBe(false)
    })

    it('แสดงรายการเมื่อมีข้อมูล', () => {
      const wrapper = mountList({ transactions: manyTransactions(3) })

      expect(wrapper.findAll('.transaction-item')).toHaveLength(3)
    })

    it('แสดงจำนวนรายการทั้งหมด ไม่ใช่แค่จำนวนที่วาด', () => {
      const wrapper = mountList({ transactions: manyTransactions(120) })

      expect(wrapper.find('.item-count').text()).toContain('120')
    })
  })

  describe('เนื้อหาของแต่ละแถว', () => {
    it('แสดงชื่อรายการและจำนวนเงิน', () => {
      const wrapper = mountList({
        transactions: [makeTransaction({ description: 'ค่าอาหารเช้า', amount: 65 })],
      })

      expect(wrapper.text()).toContain('ค่าอาหารเช้า')
      expect(wrapper.text()).toContain('65')
    })

    it('ใช้เครื่องหมายต่างกันระหว่างรายรับกับรายจ่าย', () => {
      const wrapper = mountList({
        transactions: [
          makeTransaction({ id: 'tx-1', type: 'income', amount: 100 }),
          makeTransaction({ id: 'tx-2', type: 'expense', amount: 100 }),
        ],
      })
      const amounts = wrapper.findAll('.transaction-amount strong')

      expect(amounts[0].text()).toContain('+')
      expect(amounts[1].text()).toContain('−')
    })

    it('แสดงหมวดหมู่เมื่อมี', () => {
      const wrapper = mountList({
        transactions: [makeTransaction({ category: 'อาหาร' })],
      })

      expect(wrapper.text()).toContain('อาหาร')
    })
  })

  describe('การแก้ไขและลบ', () => {
    it('ส่ง event edit พร้อมรายการที่กด', async () => {
      const transaction = makeTransaction({ description: 'ค่ากาแฟ' })
      const wrapper = mountList({ transactions: [transaction] })

      await wrapper.findAll('.icon-button')[0].trigger('click')

      expect(wrapper.emitted('edit')?.[0][0]).toEqual(transaction)
    })

    it('ส่ง event delete พร้อมรายการที่กด', async () => {
      const transaction = makeTransaction({ description: 'ค่ากาแฟ' })
      const wrapper = mountList({ transactions: [transaction] })

      await wrapper.find('.icon-button--danger').trigger('click')

      expect(wrapper.emitted('delete')?.[0][0]).toEqual(transaction)
    })

    it('ปิดปุ่มของแถวที่กำลังทำงานอยู่', () => {
      const wrapper = mountList({ transactions: manyTransactions(1), busyId: 'tx-1' })

      expect(wrapper.find('.icon-button--danger').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('กำลังลบ')
    })

    it('ซ่อนปุ่มแก้ไข/ลบในโหมดดูอย่างเดียว', () => {
      const wrapper = mountList({ transactions: manyTransactions(2), readOnly: true })

      expect(wrapper.findAll('.icon-button')).toHaveLength(0)
      expect(wrapper.find('.read-only-chip').exists()).toBe(true)
    })
  })

  describe('โหมดเลือกหลายรายการ', () => {
    it('แสดง checkbox ทุกแถวและซ่อนปุ่มรายแถว', () => {
      const wrapper = mountList({ transactions: manyTransactions(3), selectionMode: true })

      expect(wrapper.findAll('.select-checkbox')).toHaveLength(3)
      expect(wrapper.findAll('.icon-button')).toHaveLength(0)
    })

    it('ส่ง event bulkDelete พร้อม id ที่เลือกไว้', async () => {
      const wrapper = mountList({ transactions: manyTransactions(3), selectionMode: true })

      await wrapper.findAll('.select-checkbox input')[0].setValue(true)
      await wrapper.findAll('.select-checkbox input')[2].setValue(true)
      await wrapper.find('.selection-bar button').trigger('click')

      expect(wrapper.emitted('bulkDelete')?.[0][0]).toEqual(['tx-1', 'tx-3'])
    })

    it('ไม่ส่ง bulkDelete เมื่อยังไม่ได้เลือกอะไร', async () => {
      const wrapper = mountList({ transactions: manyTransactions(3), selectionMode: true })

      expect(wrapper.find('.selection-bar button').attributes('disabled')).toBeDefined()
    })

    it('เลือกทั้งหมดและยกเลิกทั้งหมดได้', async () => {
      const wrapper = mountList({ transactions: manyTransactions(3), selectionMode: true })

      await wrapper.find('.select-all-button').trigger('click')
      expect(wrapper.text()).toContain('เลือกแล้ว 3 รายการ')

      await wrapper.find('.select-all-button').trigger('click')
      expect(wrapper.text()).toContain('เลือกแล้ว 0 รายการ')
    })

    it('ส่ง event cancelSelection เมื่อกดเสร็จสิ้น', async () => {
      const wrapper = mountList({ transactions: manyTransactions(2), selectionMode: true })

      await wrapper.find('.cancel-select-button').trigger('click')

      expect(wrapper.emitted('cancelSelection')).toHaveLength(1)
    })

    it('ล้างรายการที่เลือกไว้เมื่อออกจากโหมดเลือก', async () => {
      const wrapper = mountList({ transactions: manyTransactions(3), selectionMode: true })
      await wrapper.findAll('.select-checkbox input')[0].setValue(true)

      await wrapper.setProps({ selectionMode: false })
      await wrapper.setProps({ selectionMode: true })

      expect(wrapper.text()).toContain('เลือกแล้ว 0 รายการ')
    })

    it('ตัด id ที่หายไปแล้วออกจากรายการที่เลือก', async () => {
      const wrapper = mountList({ transactions: manyTransactions(3), selectionMode: true })
      await wrapper.findAll('.select-checkbox input')[2].setValue(true)

      // แถวที่เลือกไว้ถูกลบไปแล้ว
      await wrapper.setProps({ transactions: manyTransactions(2) })

      expect(wrapper.text()).toContain('เลือกแล้ว 0 รายการ')
    })
  })

  describe('การวาดทีละหน้า', () => {
    it('วาดไม่เกิน pageSize ในครั้งแรก', () => {
      const wrapper = mountList({ transactions: manyTransactions(120), pageSize: 50 })

      expect(wrapper.findAll('.transaction-item')).toHaveLength(50)
    })

    it('บอกจำนวนที่เหลือบนปุ่มโหลดเพิ่ม', () => {
      const wrapper = mountList({ transactions: manyTransactions(120), pageSize: 50 })

      expect(wrapper.find('.load-more-button').text()).toContain('70')
    })

    it('วาดเพิ่มอีกหนึ่งหน้าเมื่อกดโหลดเพิ่ม', async () => {
      const wrapper = mountList({ transactions: manyTransactions(120), pageSize: 50 })

      await wrapper.find('.load-more-button').trigger('click')

      expect(wrapper.findAll('.transaction-item')).toHaveLength(100)
    })

    it('ซ่อนปุ่มเมื่อวาดครบทุกแถวแล้ว', async () => {
      const wrapper = mountList({ transactions: manyTransactions(60), pageSize: 50 })

      await wrapper.find('.load-more-button').trigger('click')

      expect(wrapper.findAll('.transaction-item')).toHaveLength(60)
      expect(wrapper.find('.load-more-button').exists()).toBe(false)
    })

    it('ไม่มีปุ่มเมื่อรายการน้อยกว่าหนึ่งหน้า', () => {
      const wrapper = mountList({ transactions: manyTransactions(10), pageSize: 50 })

      expect(wrapper.find('.load-more-button').exists()).toBe(false)
    })

    it('วาดทั้งหมดเมื่อ pageSize เป็น 0', () => {
      const wrapper = mountList({ transactions: manyTransactions(75), pageSize: 0 })

      expect(wrapper.findAll('.transaction-item')).toHaveLength(75)
      expect(wrapper.find('.load-more-button').exists()).toBe(false)
    })

    it('คงจำนวนที่ขยายไว้เมื่อมีรายการใหม่เข้ามา', async () => {
      const wrapper = mountList({ transactions: manyTransactions(120), pageSize: 50 })
      await wrapper.find('.load-more-button').trigger('click')

      await wrapper.setProps({ transactions: manyTransactions(121) })

      expect(wrapper.findAll('.transaction-item')).toHaveLength(100)
    })

    it('ไม่วาดเกินจำนวนที่มีจริงเมื่อรายการลดลง', async () => {
      const wrapper = mountList({ transactions: manyTransactions(120), pageSize: 50 })
      await wrapper.find('.load-more-button').trigger('click')

      await wrapper.setProps({ transactions: manyTransactions(70) })

      expect(wrapper.findAll('.transaction-item')).toHaveLength(70)
    })

    it('ไม่แสดงปุ่มโหลดเพิ่มระหว่างกำลังโหลด', () => {
      const wrapper = mountList({ transactions: manyTransactions(120), loading: true })

      expect(wrapper.find('.load-more-button').exists()).toBe(false)
    })
  })
})
