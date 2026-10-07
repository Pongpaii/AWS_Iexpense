import { describe, expect, it } from 'vitest'
import { AMOUNT_MAX, DESCRIPTION_MAX_LENGTH, validateTransactionInput } from '../transaction.schema'

const validInput = {
  description: 'ค่าอาหารกลางวัน',
  amount: 85,
  type: 'expense' as const,
  category: 'อาหาร' as const,
  transaction_date: '2026-03-15',
}

describe('validateTransactionInput', () => {
  it('ผ่านเมื่อข้อมูลถูกต้องครบถ้วน', () => {
    const result = validateTransactionInput(validInput)

    expect(result.success).toBe(true)
    expect(result.data).toEqual(validInput)
    expect(result.fieldErrors).toEqual({})
  })

  it('ยอมรับ category เป็น null (หมวดหมู่ไม่บังคับ)', () => {
    const result = validateTransactionInput({ ...validInput, category: null })

    expect(result.success).toBe(true)
    expect(result.data?.category).toBeNull()
  })

  describe('description', () => {
    it('ตัดช่องว่างหัวท้ายออกก่อนบันทึก', () => {
      const result = validateTransactionInput({ ...validInput, description: '  ค่ากาแฟ  ' })

      expect(result.success).toBe(true)
      expect(result.data?.description).toBe('ค่ากาแฟ')
    })

    it('ปฏิเสธข้อความที่มีแต่ช่องว่าง', () => {
      const result = validateTransactionInput({ ...validInput, description: '    ' })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.description).toBeTruthy()
    })

    it(`ปฏิเสธข้อความยาวเกิน ${DESCRIPTION_MAX_LENGTH} ตัวอักษร`, () => {
      const result = validateTransactionInput({
        ...validInput,
        description: 'ก'.repeat(DESCRIPTION_MAX_LENGTH + 1),
      })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.description).toBeTruthy()
    })

    it(`ยอมรับข้อความยาวเท่ากับ ${DESCRIPTION_MAX_LENGTH} ตัวอักษรพอดี`, () => {
      const result = validateTransactionInput({
        ...validInput,
        description: 'ก'.repeat(DESCRIPTION_MAX_LENGTH),
      })

      expect(result.success).toBe(true)
    })
  })

  describe('amount', () => {
    it.each([0, -1, -0.01])('ปฏิเสธจำนวนเงินที่ไม่เป็นบวก: %s', (amount) => {
      const result = validateTransactionInput({ ...validInput, amount })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.amount).toBeTruthy()
    })

    it('ปฏิเสธ NaN (เกิดเมื่อผู้ใช้ยังไม่กรอกจำนวนเงิน)', () => {
      const result = validateTransactionInput({ ...validInput, amount: Number.NaN })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.amount).toBeTruthy()
    })

    it('ปฏิเสธ Infinity', () => {
      const result = validateTransactionInput({
        ...validInput,
        amount: Number.POSITIVE_INFINITY,
      })

      expect(result.success).toBe(false)
    })

    it('ปฏิเสธจำนวนเงินที่เกินเพดาน', () => {
      const result = validateTransactionInput({ ...validInput, amount: AMOUNT_MAX + 1 })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.amount).toBeTruthy()
    })

    it('ยอมรับจำนวนเงินที่เท่ากับเพดานพอดี', () => {
      const result = validateTransactionInput({ ...validInput, amount: AMOUNT_MAX })

      expect(result.success).toBe(true)
    })

    it('ปฏิเสธทศนิยม เพราะ API เก็บเป็นบาทจำนวนเต็ม', () => {
      const result = validateTransactionInput({ ...validInput, amount: 10.25 })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.amount).toBeTruthy()
    })

    it('ยอมรับจำนวนเต็ม', () => {
      const result = validateTransactionInput({ ...validInput, amount: 10 })

      expect(result.success).toBe(true)
    })
  })

  describe('type', () => {
    it.each(['income', 'expense'])('ยอมรับประเภท %s', (type) => {
      const result = validateTransactionInput({ ...validInput, type })

      expect(result.success).toBe(true)
    })

    it('ปฏิเสธประเภทที่ไม่รู้จัก', () => {
      const result = validateTransactionInput({ ...validInput, type: 'transfer' })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.type).toBeTruthy()
    })
  })

  describe('category', () => {
    it('ปฏิเสธหมวดหมู่ที่ไม่มีอยู่ในรายการ', () => {
      const result = validateTransactionInput({ ...validInput, category: 'คริปโต' })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.category).toBeTruthy()
    })
  })

  describe('transaction_date', () => {
    it.each(['15-03-2026', '2026/03/15', '2026-3-5', '2026-13-01', '2026-00-10', ''])(
      'ปฏิเสธรูปแบบวันที่ที่ไม่ถูกต้อง: %s',
      (transaction_date) => {
        const result = validateTransactionInput({ ...validInput, transaction_date })

        expect(result.success).toBe(false)
        expect(result.fieldErrors.transaction_date).toBeTruthy()
      },
    )

    it('ปฏิเสธวันที่ที่รูปแบบถูกแต่ไม่มีอยู่จริง (30 กุมภาพันธ์)', () => {
      const result = validateTransactionInput({ ...validInput, transaction_date: '2026-02-30' })

      expect(result.success).toBe(false)
      expect(result.fieldErrors.transaction_date).toBeTruthy()
    })

    it('ยอมรับ 29 กุมภาพันธ์ในปีอธิกสุรทิน', () => {
      const result = validateTransactionInput({ ...validInput, transaction_date: '2028-02-29' })

      expect(result.success).toBe(true)
    })

    it('ปฏิเสธ 29 กุมภาพันธ์ในปีที่ไม่ใช่อธิกสุรทิน', () => {
      const result = validateTransactionInput({ ...validInput, transaction_date: '2026-02-29' })

      expect(result.success).toBe(false)
    })
  })

  it('รายงาน error ของทุก field ที่ผิดพร้อมกัน', () => {
    const result = validateTransactionInput({
      description: '',
      amount: -5,
      type: 'nope',
      category: 'ไม่มีจริง',
      transaction_date: 'พรุ่งนี้',
    })

    expect(result.success).toBe(false)
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      'amount',
      'category',
      'description',
      'transaction_date',
      'type',
    ])
  })

  it('ปฏิเสธ input ที่ไม่ใช่ object โดยไม่ throw', () => {
    expect(() => validateTransactionInput(null)).not.toThrow()
    expect(validateTransactionInput(null).success).toBe(false)
    expect(validateTransactionInput('ข้อความ').success).toBe(false)
  })
})
