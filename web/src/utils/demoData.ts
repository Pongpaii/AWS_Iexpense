import type { Transaction, TransactionCategory, TransactionType } from '../types/transaction'

export const DEMO_USER_ID = 'demo-user'
export const DEMO_USER_EMAIL = 'demo@moneyflow.app'

interface DemoEntry {
  day: number
  description: string
  amount: number
  type: TransactionType
  category: TransactionCategory | null
}

/** แบบแผนรายการของหนึ่งเดือน ใช้ซ้ำทุกเดือนแล้วปรับยอดเล็กน้อยตามเดือน */
const monthlyPlan: DemoEntry[] = [
  { day: 1, description: 'ค่าหอพัก', amount: 4500, type: 'expense', category: 'ที่พัก' },
  { day: 2, description: 'ค่าน้ำค่าไฟ', amount: 780, type: 'expense', category: 'บิลและบริการ' },
  {
    day: 3,
    description: 'ค่าเน็ตบ้าน + มือถือ',
    amount: 699,
    type: 'expense',
    category: 'บิลและบริการ',
  },
  { day: 4, description: 'ข้าวกลางวันร้านประจำ', amount: 65, type: 'expense', category: 'อาหาร' },
  { day: 5, description: 'เติมน้ำมัน', amount: 520, type: 'expense', category: 'การเดินทาง' },
  { day: 6, description: 'กาแฟกับขนม', amount: 120, type: 'expense', category: 'อาหาร' },
  { day: 7, description: 'ซื้อของใช้เข้าบ้าน', amount: 860, type: 'expense', category: 'ช้อปปิ้ง' },
  { day: 9, description: 'ข้าวเย็นกับเพื่อน', amount: 340, type: 'expense', category: 'อาหาร' },
  {
    day: 10,
    description: 'รับงานฟรีแลนซ์ทำเว็บ',
    amount: 3500,
    type: 'income',
    category: 'อื่น ๆ',
  },
  { day: 11, description: 'ค่ารถไฟฟ้า', amount: 186, type: 'expense', category: 'การเดินทาง' },
  { day: 12, description: 'วิตามินกับยาสามัญ', amount: 430, type: 'expense', category: 'สุขภาพ' },
  { day: 14, description: 'ดูหนังกับข้าวเย็น', amount: 520, type: 'expense', category: 'อื่น ๆ' },
  {
    day: 15,
    description: 'ข้าวกลางวันทั้งสัปดาห์',
    amount: 375,
    type: 'expense',
    category: 'อาหาร',
  },
  { day: 16, description: 'คอร์สเรียนออนไลน์', amount: 590, type: 'expense', category: 'การศึกษา' },
  { day: 18, description: 'ซื้อเสื้อผ้า', amount: 1290, type: 'expense', category: 'ช้อปปิ้ง' },
  {
    day: 19,
    description: 'ค่าแท็กซี่กลับบ้าน',
    amount: 210,
    type: 'expense',
    category: 'การเดินทาง',
  },
  { day: 21, description: 'ตรวจสุขภาพประจำปี', amount: 900, type: 'expense', category: 'สุขภาพ' },
  { day: 22, description: 'ชานมไข่มุก', amount: 85, type: 'expense', category: 'อาหาร' },
  {
    day: 24,
    description: 'เที่ยวทะเลสุดสัปดาห์',
    amount: 2400,
    type: 'expense',
    category: 'ท่องเที่ยว',
  },
  { day: 25, description: 'เงินเดือน', amount: 17000, type: 'income', category: 'เงินเดือน' },
  {
    day: 26,
    description: 'ค่าสตรีมมิ่งรายเดือน',
    amount: 279,
    type: 'expense',
    category: 'บิลและบริการ',
  },
  {
    day: 27,
    description: 'ข้าวเย็นฉลองเงินเดือนออก',
    amount: 680,
    type: 'expense',
    category: 'อาหาร',
  },
  { day: 28, description: 'ซื้อของฝากที่บ้าน', amount: 450, type: 'expense', category: 'ช้อปปิ้ง' },
]

/** รายการของ "วันนี้" เพื่อให้หน้าจดรายการมีข้อมูลให้ดูทันที */
const todayPlan: Omit<DemoEntry, 'day'>[] = [
  { description: 'กาแฟเช้าก่อนเข้างาน', amount: 75, type: 'expense', category: 'อาหาร' },
  { description: 'ข้าวกลางวันข้าวมันไก่', amount: 60, type: 'expense', category: 'อาหาร' },
  { description: 'ค่าวินมอเตอร์ไซค์', amount: 40, type: 'expense', category: 'การเดินทาง' },
  { description: 'ซื้อยาแก้แพ้', amount: 145, type: 'expense', category: 'สุขภาพ' },
  { description: 'สั่งของออนไลน์', amount: 390, type: 'expense', category: 'ช้อปปิ้ง' },
  { description: 'ขายของมือสอง', amount: 850, type: 'income', category: 'อื่น ๆ' },
]

const MONTHS_BACK = 5

/** ปรับยอดให้ต่างกันในแต่ละเดือนแบบคงที่ (ไม่สุ่ม) เพื่อให้กราฟดูมีชีวิต */
const varyAmount = (amount: number, monthOffset: number, index: number) => {
  if (amount >= 10_000) return amount
  const factor = 1 + (((index * 7 + monthOffset * 13) % 21) - 10) / 100
  return Math.round(amount * factor)
}

const toIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * สร้างชุดข้อมูลตัวอย่างย้อนหลัง 6 เดือนจนถึงวันนี้ ใช้เฉพาะในโหมดดูตัวอย่าง
 * ข้อมูลอยู่ในหน่วยความจำเท่านั้น ไม่มีการเขียนลงฐานข้อมูล
 */
export const createDemoTransactions = (referenceDate = new Date()): Transaction[] => {
  const today = toIsoDate(referenceDate)
  const transactions: Transaction[] = []
  let id = 1

  for (let monthOffset = MONTHS_BACK; monthOffset >= 0; monthOffset -= 1) {
    const monthDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() - monthOffset,
      1,
    )
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()

    monthlyPlan.forEach((entry, index) => {
      const day = Math.min(entry.day, daysInMonth)
      const transactionDate = toIsoDate(
        new Date(monthDate.getFullYear(), monthDate.getMonth(), day),
      )
      if (transactionDate >= today) return

      transactions.push({
        id: `demo-${id++}`,
        user_id: DEMO_USER_ID,
        description: entry.description,
        amount: varyAmount(entry.amount, monthOffset, index),
        type: entry.type,
        category: entry.category,
        transaction_date: transactionDate,
        created_at: `${transactionDate}T09:00:00.000Z`,
      })
    })
  }

  todayPlan.forEach((entry, index) => {
    transactions.push({
      id: `demo-${id++}`,
      user_id: DEMO_USER_ID,
      description: entry.description,
      amount: entry.amount,
      type: entry.type,
      category: entry.category,
      transaction_date: today,
      created_at: `${today}T${String(8 + index).padStart(2, '0')}:30:00.000Z`,
    })
  })

  return transactions.sort((a, b) => {
    const byDate = b.transaction_date.localeCompare(a.transaction_date)
    return byDate !== 0 ? byDate : b.created_at.localeCompare(a.created_at)
  })
}
