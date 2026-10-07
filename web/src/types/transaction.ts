export type TransactionType = 'income' | 'expense'

export const transactionCategories = [
  { value: 'อาหาร', emoji: '🍜' },
  { value: 'การเดินทาง', emoji: '🚗' },
  { value: 'ช้อปปิ้ง', emoji: '🛍️' },
  { value: 'ท่องเที่ยว', emoji: '✈️' },
  { value: 'ที่พัก', emoji: '🏠' },
  { value: 'บิลและบริการ', emoji: '🧾' },
  { value: 'สุขภาพ', emoji: '💊' },
  { value: 'การศึกษา', emoji: '📚' },
  { value: 'เงินเดือน', emoji: '💰' },
  { value: 'อื่น ๆ', emoji: '✨' },
] as const

export type TransactionCategory = (typeof transactionCategories)[number]['value']

/**
 * หมวดที่ต้องขึ้นก่อนเสมอในทุกมุมมองที่เกี่ยวกับงบ
 *
 * ทำไม: อาหารกับการเดินทางเกิดทุกวันและเป็นสองหมวดที่ผู้ใช้ "ลดวันนี้ได้จริง"
 * ส่วนก้อนใหญ่อย่างค่าที่พักหรือบิลจ่ายเดือนละครั้ง เห็นก่อนก็ทำอะไรไม่ได้ในวันนี้
 * จึงต้องให้สองหมวดนี้อยู่หัวลิสต์ ไม่ปล่อยให้ตัวเลขก้อนใหญ่ดันมันตกไปท้ายตาราง
 */
export const priorityCategories = ['อาหาร', 'การเดินทาง'] as const

export type PriorityCategory = (typeof priorityCategories)[number]

export const isPriorityCategory = (
  category: TransactionCategory | null | undefined,
): category is PriorityCategory =>
  category != null && (priorityCategories as readonly string[]).includes(category)

/** ยิ่งเลขน้อยยิ่งขึ้นก่อน · หมวดนอกลิสต์ได้เลขท้ายสุดเท่ากันหมด */
export const categoryPriorityRank = (category: TransactionCategory | null | undefined) => {
  const index = (priorityCategories as readonly string[]).indexOf(category ?? '')
  return index === -1 ? priorityCategories.length : index
}

/**
 * comparator: อาหาร → การเดินทาง → ที่เหลือ
 * หมวดที่เหลือถือว่าเสมอกัน (คืน 0) ให้ตัวเรียกตัดสินลำดับต่อด้วยเกณฑ์ของตัวเอง
 */
export const compareCategoryPriority = (
  a: TransactionCategory | null | undefined,
  b: TransactionCategory | null | undefined,
) => categoryPriorityRank(a) - categoryPriorityRank(b)

export const getCategoryEmoji = (category: TransactionCategory | null | undefined) =>
  transactionCategories.find((option) => option.value === category)?.emoji ?? '🏷️'

/**
 * รูปแบบที่หน้าจอใช้ (คงชื่อ field แบบเดิมไว้ ให้คอมโพเนนต์ไม่ต้องแก้)
 * id = ULID จาก API · แถวที่รอซิงก์ออฟไลน์ใช้ id ขึ้นต้นด้วย `pending:`
 * amount = บาทจำนวนเต็ม (API ไม่รับทศนิยม)
 */
export interface Transaction {
  id: string
  user_id: string
  description: string
  amount: number
  type: TransactionType
  category: TransactionCategory | null
  transaction_date: string
  created_at: string
  idempotency_key?: string | null
  deleted_at?: string | null
  client_timezone?: string | null
}

export type TransactionInput = Pick<
  Transaction,
  'description' | 'amount' | 'type' | 'category' | 'transaction_date'
> & { client_timezone?: string | null }
