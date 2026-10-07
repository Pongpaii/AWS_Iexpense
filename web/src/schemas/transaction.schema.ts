import { z } from 'zod'
import { transactionCategories, type TransactionCategory } from '../types/transaction'

/**
 * ขอบเขตของข้อมูลต้องตรงกับ transactionCreateSchema ใน @money-flow/shared (ฝั่ง API)
 * ถ้าฝั่ง client ยอมให้กว้างกว่า ผู้ใช้จะเจอ error จากฐานข้อมูลที่อ่านไม่รู้เรื่อง
 */
export const DESCRIPTION_MAX_LENGTH = 120
export const AMOUNT_MAX = 999_999_999

const categoryValues = transactionCategories.map((option) => option.value) as [
  TransactionCategory,
  ...TransactionCategory[],
]

const isRealCalendarDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

export const transactionInputSchema = z.object({
  description: z
    .string({ error: 'กรุณากรอกรายละเอียด' })
    .trim()
    .min(1, 'กรุณากรอกรายละเอียด')
    .max(DESCRIPTION_MAX_LENGTH, `รายละเอียดยาวเกิน ${DESCRIPTION_MAX_LENGTH} ตัวอักษร`),

  amount: z
    .number({ error: 'กรุณากรอกจำนวนเงิน' })
    .refine(Number.isFinite, 'จำนวนเงินไม่ถูกต้อง')
    .refine((value) => value > 0, 'จำนวนเงินต้องมากกว่า 0')
    .refine((value) => value <= AMOUNT_MAX, 'จำนวนเงินเกินขีดจำกัด')
    // API เก็บเป็นบาทจำนวนเต็ม (ไม่มีสตางค์) บอกผู้ใช้ตรงนี้ดีกว่าโดนเซิร์ฟเวอร์ปฏิเสธ
    .refine(Number.isInteger, 'จำนวนเงินต้องเป็นจำนวนเต็ม (ไม่มีทศนิยม)'),

  type: z.enum(['income', 'expense'], { error: 'กรุณาเลือกประเภทรายการ' }),

  category: z.enum(categoryValues, { error: 'หมวดหมู่ไม่ถูกต้อง' }).nullable(),

  transaction_date: z
    .string({ error: 'กรุณาเลือกวันที่' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'รูปแบบวันที่ไม่ถูกต้อง')
    .refine(isRealCalendarDate, 'วันที่นี้ไม่มีอยู่จริง'),
})

export type ValidatedTransactionInput = z.infer<typeof transactionInputSchema>

/** ข้อความ error ต่อ field สำหรับผูกกับ input ในฟอร์ม */
export type TransactionFieldErrors = Partial<Record<keyof ValidatedTransactionInput, string>>

export interface TransactionValidationResult {
  success: boolean
  data?: ValidatedTransactionInput
  fieldErrors: TransactionFieldErrors
}

/**
 * validate แบบไม่ throw เพื่อให้ฟอร์มเอา error ไปแสดงข้าง field ได้ตรงจุด
 */
export const validateTransactionInput = (input: unknown): TransactionValidationResult => {
  const result = transactionInputSchema.safeParse(input)

  if (result.success) {
    return { success: true, data: result.data, fieldErrors: {} }
  }

  const fieldErrors: TransactionFieldErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof ValidatedTransactionInput | undefined
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
  }

  return { success: false, fieldErrors }
}
