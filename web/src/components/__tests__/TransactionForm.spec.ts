import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { makeTransaction } from '../../test-utils/factories'
import { DESCRIPTION_MAX_LENGTH } from '../../schemas/transaction.schema'
import TransactionForm from '../TransactionForm.vue'

type FormWrapper = VueWrapper<InstanceType<typeof TransactionForm>>

const mountForm = (props: Record<string, unknown> = {}): FormWrapper =>
  mount(TransactionForm, {
    props: { editing: null, busy: false, ...props },
  }) as FormWrapper

const fillValidForm = async (wrapper: FormWrapper) => {
  await wrapper.find('input[type="text"]').setValue('ค่าอาหารกลางวัน')
  await wrapper.find('input[type="number"]').setValue('85')
  await wrapper.find('input[type="date"]').setValue('2026-03-15')
}

const submit = (wrapper: FormWrapper) => wrapper.find('form').trigger('submit')

describe('TransactionForm', () => {
  describe('การส่งข้อมูล', () => {
    it('ส่งค่าที่ validate แล้วออกไปทาง event submit', async () => {
      const wrapper = mountForm()
      await fillValidForm(wrapper)
      await submit(wrapper)

      const submitted = wrapper.emitted('submit')
      expect(submitted).toHaveLength(1)
      expect(submitted?.[0][0]).toEqual({
        description: 'ค่าอาหารกลางวัน',
        amount: 85,
        type: 'expense',
        category: null,
        transaction_date: '2026-03-15',
      })
    })

    it('ตัดช่องว่างหัวท้ายของชื่อรายการ', async () => {
      const wrapper = mountForm()
      await wrapper.find('input[type="text"]').setValue('   ค่ากาแฟ   ')
      await wrapper.find('input[type="number"]').setValue('60')
      await submit(wrapper)

      expect((wrapper.emitted('submit')?.[0][0] as { description: string }).description).toBe(
        'ค่ากาแฟ',
      )
    })

    it('เริ่มต้นเป็นรายจ่าย และเปลี่ยนเป็นรายรับได้', async () => {
      const wrapper = mountForm()
      await fillValidForm(wrapper)
      await wrapper.find('input[type="radio"][value="income"]').setValue()
      await submit(wrapper)

      expect((wrapper.emitted('submit')?.[0][0] as { type: string }).type).toBe('income')
    })

    it('ส่งหมวดหมู่ที่เลือกไปด้วย', async () => {
      const wrapper = mountForm()
      await fillValidForm(wrapper)
      await wrapper.findAll('.category-button')[0].trigger('click')
      await submit(wrapper)

      expect((wrapper.emitted('submit')?.[0][0] as { category: string }).category).toBeTruthy()
    })

    it('กดหมวดหมู่เดิมซ้ำเพื่อยกเลิกการเลือก', async () => {
      const wrapper = mountForm()
      await fillValidForm(wrapper)
      const firstCategory = wrapper.findAll('.category-button')[0]

      await firstCategory.trigger('click')
      expect(firstCategory.attributes('aria-pressed')).toBe('true')

      await firstCategory.trigger('click')
      expect(firstCategory.attributes('aria-pressed')).toBe('false')

      await submit(wrapper)
      expect((wrapper.emitted('submit')?.[0][0] as { category: null }).category).toBeNull()
    })

    it('ใช้ defaultDate เป็นวันที่เริ่มต้น', async () => {
      const wrapper = mountForm({ defaultDate: '2026-02-01' })
      await wrapper.find('input[type="text"]').setValue('ค่าน้ำ')
      await wrapper.find('input[type="number"]').setValue('300')
      await submit(wrapper)

      expect(
        (wrapper.emitted('submit')?.[0][0] as { transaction_date: string }).transaction_date,
      ).toBe('2026-02-01')
    })
  })

  describe('การตรวจสอบข้อมูล', () => {
    it('ไม่ส่ง event และแสดง error เมื่อชื่อรายการว่าง', async () => {
      const wrapper = mountForm()
      await wrapper.find('input[type="number"]').setValue('100')
      await submit(wrapper)

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(wrapper.find('.field-error').exists()).toBe(true)
    })

    it('ไม่ส่ง event เมื่อจำนวนเงินเป็นศูนย์หรือติดลบ', async () => {
      const wrapper = mountForm()
      await wrapper.find('input[type="text"]').setValue('ค่าอะไรบางอย่าง')
      await wrapper.find('input[type="number"]').setValue('0')
      await submit(wrapper)

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(wrapper.text()).toContain('มากกว่า 0')
    })

    it('ไม่ส่ง event เมื่อยังไม่กรอกจำนวนเงิน', async () => {
      const wrapper = mountForm()
      await wrapper.find('input[type="text"]').setValue('ค่าอะไรบางอย่าง')
      await submit(wrapper)

      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('ผูก error กับ input ด้วย aria-invalid และ aria-describedby', async () => {
      const wrapper = mountForm()
      await wrapper.find('input[type="number"]').setValue('100')
      await submit(wrapper)

      const description = wrapper.find('input[type="text"]')
      expect(description.attributes('aria-invalid')).toBe('true')
      expect(description.attributes('aria-describedby')).toBe('form-error-description')
      expect(wrapper.find('#form-error-description').exists()).toBe(true)
    })

    it('ล้าง error ของ field นั้นทันทีที่ผู้ใช้เริ่มพิมพ์แก้', async () => {
      const wrapper = mountForm()
      await wrapper.find('input[type="number"]').setValue('100')
      await submit(wrapper)
      expect(wrapper.find('#form-error-description').exists()).toBe(true)

      await wrapper.find('input[type="text"]').setValue('ค่าอาหาร')

      expect(wrapper.find('#form-error-description').exists()).toBe(false)
    })

    it('จำกัดความยาวชื่อรายการที่ระดับ input ด้วย', () => {
      expect(mountForm().find('input[type="text"]').attributes('maxlength')).toBe(
        String(DESCRIPTION_MAX_LENGTH),
      )
    })
  })

  describe('การกันกดซ้ำ', () => {
    it('ไม่ส่ง event ซ้ำเมื่อกด submit รัว ๆ', async () => {
      const wrapper = mountForm()
      await fillValidForm(wrapper)

      await submit(wrapper)
      await submit(wrapper)
      await submit(wrapper)

      expect(wrapper.emitted('submit')).toHaveLength(1)
    })

    it('ปลดล็อกให้ส่งใหม่ได้หลังพ้นช่วงกันกดซ้ำ', async () => {
      vi.useFakeTimers()
      const wrapper = mountForm()
      await fillValidForm(wrapper)

      await submit(wrapper)
      await vi.advanceTimersByTimeAsync(1_000)
      await submit(wrapper)

      expect(wrapper.emitted('submit')).toHaveLength(2)
      vi.useRealTimers()
    })

    it('ปิดฟอร์มและปุ่มขณะกำลังบันทึก', () => {
      const wrapper = mountForm({ busy: true })

      expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
      expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('กำลังบันทึก')
    })

    it('ไม่ส่ง event เมื่อฟอร์มถูก disabled', async () => {
      const wrapper = mountForm({ disabled: true })
      await fillValidForm(wrapper)
      await submit(wrapper)

      expect(wrapper.emitted('submit')).toBeUndefined()
    })
  })

  describe('โหมดแก้ไข', () => {
    const editing = makeTransaction({
      description: 'ค่าเช่าห้อง',
      amount: 4_500,
      type: 'expense',
      category: 'ที่พัก',
      transaction_date: '2026-03-01',
    })

    it('เติมค่าเดิมลงในฟอร์ม', () => {
      const wrapper = mountForm({ editing })

      expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe(
        'ค่าเช่าห้อง',
      )
      expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('4500')
      expect((wrapper.find('input[type="date"]').element as HTMLInputElement).value).toBe(
        '2026-03-01',
      )
    })

    it('เปลี่ยนข้อความบนปุ่มและหัวเรื่องเป็นโหมดแก้ไข', () => {
      const wrapper = mountForm({ editing })

      expect(wrapper.text()).toContain('แก้ไขรายการ')
      expect(wrapper.find('button[type="submit"]').text()).toContain('บันทึกการแก้ไข')
    })

    it('มีปุ่มยกเลิกที่ส่ง event cancel', async () => {
      const wrapper = mountForm({ editing })
      await wrapper.find('.text-button').trigger('click')

      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('ไม่มีปุ่มยกเลิกในโหมดเพิ่มรายการใหม่', () => {
      expect(mountForm().find('.text-button').exists()).toBe(false)
    })

    it('ล้างฟอร์มเมื่อออกจากโหมดแก้ไข', async () => {
      const wrapper = mountForm({ editing })
      await wrapper.setProps({ editing: null })

      expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('')
    })
  })
})
