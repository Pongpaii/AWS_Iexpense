import { describe, expect, it } from 'vitest'
import { makeTransaction } from '../../test-utils/factories'
import {
  buildPlanProgress,
  capExcludableCategories,
  dayKindForDate,
  defaultDailyCapSettings,
  formatKeywords,
  formatTimeWindow,
  isValidTimeOfDay,
  isWithinTimeWindow,
  matchPlanItem,
  parseKeywords,
  recordedMinutesOfDay,
  splitCountedExpenses,
  sumPlanItems,
  type CapPlanItem,
} from '../useDailyCap'

const planItem = (overrides: Partial<CapPlanItem> = {}): CapPlanItem => ({
  id: 'item-1',
  emoji: '🍜',
  label: 'ช่องทดสอบ',
  amount: 100,
  keywords: [],
  timeWindow: null,
  category: null,
  ...overrides,
})

/** created_at ที่ตรงกับวันของรายการ จึงถือว่าเวลาน่าเชื่อถือ */
const recordedAt = (isoDate: string, hours: number, minutes = 0) => {
  const at = new Date(`${isoDate}T00:00:00`)
  at.setHours(hours, minutes, 0, 0)
  return at.toISOString()
}

describe('dayKindForDate', () => {
  it('จ.-ศ. เป็นวันทำงาน', () => {
    // 2026-03-16 เป็นวันจันทร์
    expect(dayKindForDate('2026-03-16')).toBe('weekday')
    expect(dayKindForDate('2026-03-20')).toBe('weekday')
  })

  it('ส.-อา. เป็นวันหยุด', () => {
    // 2026-03-21 เสาร์ · 2026-03-22 อาทิตย์
    expect(dayKindForDate('2026-03-21')).toBe('weekend')
    expect(dayKindForDate('2026-03-22')).toBe('weekend')
  })
})

describe('sumPlanItems', () => {
  it('รวมยอดของทุกช่อง', () => {
    expect(sumPlanItems([{ amount: 65 }, { amount: 70 }, { amount: 70 }])).toBe(205)
  })

  it('คืน 0 เมื่อไม่มีช่อง', () => {
    expect(sumPlanItems([])).toBe(0)
  })

  it('ปัดเศษทศนิยมให้เหลือ 2 ตำแหน่ง ไม่ให้ float error โผล่', () => {
    expect(sumPlanItems([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
  })
})

describe('isValidTimeOfDay', () => {
  it.each(['00:00', '09:30', '23:59'])('รับเวลาที่ถูกต้อง: %s', (value) => {
    expect(isValidTimeOfDay(value)).toBe(true)
  })

  it.each(['24:00', '9:30', '23:60', '', 'เช้า'])('ปฏิเสธเวลาที่ผิด: %s', (value) => {
    expect(isValidTimeOfDay(value)).toBe(false)
  })
})

describe('isWithinTimeWindow', () => {
  const morning = { start: '05:00', end: '11:59' }
  const overnight = { start: '15:00', end: '04:59' }

  it('รับเวลาที่อยู่ในช่วงปกติ', () => {
    expect(isWithinTimeWindow(morning, 8 * 60)).toBe(true)
  })

  it('รับเวลาที่ตรงขอบช่วงพอดี', () => {
    expect(isWithinTimeWindow(morning, 5 * 60)).toBe(true)
    expect(isWithinTimeWindow(morning, 11 * 60 + 59)).toBe(true)
  })

  it('ปฏิเสธเวลาที่อยู่นอกช่วง', () => {
    expect(isWithinTimeWindow(morning, 4 * 60 + 59)).toBe(false)
    expect(isWithinTimeWindow(morning, 12 * 60)).toBe(false)
  })

  it('รองรับช่วงที่ข้ามเที่ยงคืน', () => {
    expect(isWithinTimeWindow(overnight, 20 * 60)).toBe(true)
    expect(isWithinTimeWindow(overnight, 2 * 60)).toBe(true)
    expect(isWithinTimeWindow(overnight, 10 * 60)).toBe(false)
  })
})

describe('formatTimeWindow', () => {
  it('แสดงช่วงเวลาด้วยขีดกลาง', () => {
    expect(formatTimeWindow({ start: '05:00', end: '11:59' })).toBe('05:00–11:59')
  })
})

describe('parseKeywords / formatKeywords', () => {
  it('แยกคำด้วยเครื่องหมายจุลภาคและตัดช่องว่าง', () => {
    expect(parseKeywords('เช้า, breakfast ,  มื้อเช้า')).toEqual(['เช้า', 'breakfast', 'มื้อเช้า'])
  })

  it('ตัดคำซ้ำและคำว่างออก', () => {
    expect(parseKeywords('เช้า,,เช้า,  ,เย็น')).toEqual(['เช้า', 'เย็น'])
  })

  it('จำกัดจำนวนคำไม่ให้บวมเกินไป', () => {
    const many = Array.from({ length: 20 }, (_, index) => `คำ${index}`).join(',')

    expect(parseKeywords(many).length).toBeLessThanOrEqual(8)
  })

  it('formatKeywords แปลงกลับเป็นข้อความที่แก้ต่อได้', () => {
    const keywords = parseKeywords('เช้า, เย็น')

    expect(parseKeywords(formatKeywords(keywords))).toEqual(keywords)
  })
})

describe('recordedMinutesOfDay', () => {
  it('คืนนาทีของวันเมื่อวันที่จดตรงกับวันของรายการ', () => {
    const transaction = makeTransaction({
      transaction_date: '2026-03-15',
      created_at: recordedAt('2026-03-15', 13, 30),
    })

    expect(recordedMinutesOfDay(transaction)).toBe(13 * 60 + 30)
  })

  it('คืน null เมื่อเป็นการจดย้อนหลัง (เวลาไม่ได้บอกอะไรเกี่ยวกับตอนใช้เงิน)', () => {
    const transaction = makeTransaction({
      transaction_date: '2026-03-10',
      created_at: recordedAt('2026-03-15', 13, 30),
    })

    expect(recordedMinutesOfDay(transaction)).toBeNull()
  })

  it('คืน null เมื่อ created_at ใช้การไม่ได้', () => {
    expect(recordedMinutesOfDay(makeTransaction({ created_at: '' }))).toBeNull()
    expect(recordedMinutesOfDay(makeTransaction({ created_at: 'ไม่ใช่เวลา' }))).toBeNull()
  })
})

describe('matchPlanItem', () => {
  const foodMorning = planItem({
    id: 'breakfast',
    label: 'เช้า',
    keywords: ['เช้า'],
    timeWindow: { start: '05:00', end: '11:59' },
    category: 'อาหาร',
  })
  const foodDinner = planItem({
    id: 'dinner',
    label: 'เย็น',
    keywords: ['เย็น'],
    timeWindow: { start: '15:00', end: '04:59' },
    category: 'อาหาร',
  })
  const commute = planItem({ id: 'commute', label: 'เดินทาง', category: 'การเดินทาง' })
  const catchAll = planItem({ id: 'other', label: 'อื่น ๆ', category: null })
  const items = [foodMorning, foodDinner, commute, catchAll]

  it('ใช้หมวดหมู่คัดกลุ่มก่อน แม้เวลาจะตรงกับช่องของหมวดอื่น', () => {
    // ค่าเดินทางตอนเช้าต้องเข้าช่องเดินทาง ไม่ใช่ช่องอาหารเช้า
    const transaction = makeTransaction({
      category: 'การเดินทาง',
      description: 'ค่ารถ',
      transaction_date: '2026-03-15',
      created_at: recordedAt('2026-03-15', 8),
    })

    expect(matchPlanItem(items, transaction)?.id).toBe('commute')
  })

  it('ใช้คำในชื่อรายการเลือกช่องย่อยภายในหมวดเดียวกัน', () => {
    // จดตอนเช้าแต่เขียนว่า "ข้าวเย็น" ให้เชื่อคำที่ผู้ใช้เขียน
    const transaction = makeTransaction({
      category: 'อาหาร',
      description: 'ข้าวเย็น',
      transaction_date: '2026-03-15',
      created_at: recordedAt('2026-03-15', 8),
    })

    expect(matchPlanItem(items, transaction)?.id).toBe('dinner')
  })

  it('ใช้เวลาเลือกช่องย่อยเมื่อชื่อรายการไม่ได้บอก', () => {
    const transaction = makeTransaction({
      category: 'อาหาร',
      description: 'ข้าวราดแกง',
      transaction_date: '2026-03-15',
      created_at: recordedAt('2026-03-15', 7),
    })

    expect(matchPlanItem(items, transaction)?.id).toBe('breakfast')
  })

  it('ส่งหมวดที่ไม่มีช่องเฉพาะไปที่ช่องรวม', () => {
    const transaction = makeTransaction({
      category: 'ช้อปปิ้ง',
      description: 'เสื้อยืด',
      transaction_date: '2026-03-15',
      created_at: recordedAt('2026-03-15', 14),
    })

    expect(matchPlanItem(items, transaction)?.id).toBe('other')
  })

  it('ใช้คำและเวลาได้เมื่อผู้ใช้ไม่ได้เลือกหมวดหมู่', () => {
    const transaction = makeTransaction({
      category: null,
      description: 'มื้อเย็นกับเพื่อน',
      transaction_date: '2026-03-15',
      created_at: recordedAt('2026-03-15', 19),
    })

    expect(matchPlanItem(items, transaction)?.id).toBe('dinner')
  })

  it('ลงช่องรวมเมื่อไม่มีทั้งหมวดหมู่ คำ และเวลาที่ใช้ตัดสินได้', () => {
    const transaction = makeTransaction({
      category: null,
      description: 'จ่ายอะไรไม่รู้',
      transaction_date: '2026-03-10',
      created_at: recordedAt('2026-03-15', 14),
    })

    expect(matchPlanItem(items, transaction)?.id).toBe('other')
  })

  it('คืน null เมื่อแผนไม่มีช่องเลย', () => {
    expect(matchPlanItem([], makeTransaction())).toBeNull()
  })
})

describe('buildPlanProgress', () => {
  const items = [
    planItem({ id: 'food', label: 'อาหาร', amount: 100, category: 'อาหาร' }),
    planItem({ id: 'other', label: 'อื่น ๆ', amount: 50, category: null }),
  ]

  it('ไม่นับรายรับ', () => {
    const transactions = [makeTransaction({ type: 'income', amount: 5_000, category: 'เงินเดือน' })]

    const progress = buildPlanProgress(items, transactions)

    expect(progress.items.every(({ spent }) => spent === 0)).toBe(true)
    expect(progress.unplanned).toBe(0)
  })

  it('รวมยอดเข้าช่องที่ตรงกัน', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: 40, category: 'อาหาร' }),
      makeTransaction({ type: 'expense', amount: 20, category: 'อาหาร' }),
    ]

    const progress = buildPlanProgress(items, transactions)
    const food = progress.items.find(({ item }) => item.id === 'food')

    expect(food?.spent).toBe(60)
    expect(food?.count).toBe(2)
    expect(food?.remaining).toBe(40)
  })

  it('นับรายจ่ายหนึ่งรายการเข้าช่องเดียวเท่านั้น', () => {
    const transactions = [makeTransaction({ type: 'expense', amount: 40, category: 'อาหาร' })]

    const progress = buildPlanProgress(items, transactions)
    const totalCounted = progress.items.reduce((sum, entry) => sum + entry.spent, 0)

    expect(totalCounted + progress.unplanned).toBe(40)
  })

  it('คิดเปอร์เซ็นต์และระดับของแต่ละช่อง', () => {
    const transactions = [makeTransaction({ type: 'expense', amount: 90, category: 'อาหาร' })]

    const food = buildPlanProgress(items, transactions).items.find(({ item }) => item.id === 'food')

    expect(food?.percent).toBe(90)
    expect(food?.level).toBe('warn')
  })

  it.each([
    [0, 'empty'],
    [30, 'safe'],
    [60, 'watch'],
    [85, 'warn'],
    [100, 'full'],
    [130, 'over'],
  ])('ยอด %i บาท จากเพดาน 100 ให้ระดับ %s', (amount, level) => {
    const transactions =
      amount === 0 ? [] : [makeTransaction({ type: 'expense', amount, category: 'อาหาร' })]

    const food = buildPlanProgress(items, transactions).items.find(({ item }) => item.id === 'food')

    expect(food?.level).toBe(level)
  })

  it('เก็บรายจ่ายที่จับคู่ไม่ได้ไว้เป็นยอดนอกแผน', () => {
    const foodOnly = [planItem({ id: 'food', amount: 100, category: 'อาหาร' })]
    const transactions = [makeTransaction({ type: 'expense', amount: 75, category: 'สุขภาพ' })]

    const progress = buildPlanProgress(foodOnly, transactions)

    expect(progress.unplanned).toBe(75)
    expect(progress.unplannedCount).toBe(1)
  })

  it('นับแยกว่ารายการนอกแผนกี่รายการที่ไม่มีเวลาให้ตัดสิน', () => {
    const foodOnly = [planItem({ id: 'food', amount: 100, category: 'อาหาร' })]
    const transactions = [
      makeTransaction({
        type: 'expense',
        amount: 75,
        category: 'สุขภาพ',
        transaction_date: '2026-03-10',
        created_at: recordedAt('2026-03-15', 14),
      }),
    ]

    expect(buildPlanProgress(foodOnly, transactions).unplannedWithoutTime).toBe(1)
  })
})

describe('defaultDailyCapSettings', () => {
  it('เปิดใช้งานไว้เป็นค่าเริ่มต้น', () => {
    expect(defaultDailyCapSettings.enabled).toBe(true)
  })

  it('ยอดรวมของแผนย่อยไม่เกินเพดานของวัน', () => {
    for (const kind of ['weekday', 'weekend'] as const) {
      const profile = defaultDailyCapSettings[kind]
      expect(sumPlanItems(profile.items)).toBeLessThanOrEqual(profile.cap)
    }
  })

  it('มีช่องรวมไว้รับหมวดที่ไม่มีช่องเฉพาะ', () => {
    for (const kind of ['weekday', 'weekend'] as const) {
      expect(defaultDailyCapSettings[kind].items.some((item) => item.category === null)).toBe(true)
    }
  })
})

describe('splitCountedExpenses', () => {
  const transactions = [
    makeTransaction({ amount: 120, category: 'อาหาร' }),
    makeTransaction({ amount: 60, category: 'การเดินทาง' }),
    makeTransaction({ amount: 4500, category: 'ที่พัก' }),
    makeTransaction({ amount: 300, category: 'บิลและบริการ' }),
    makeTransaction({ amount: 17_000, type: 'income', category: 'เงินเดือน' }),
  ]

  it('ไม่ระบุหมวดที่กันออก = นับรายจ่ายทุกรายการ', () => {
    const result = splitCountedExpenses(transactions)

    expect(result.counted).toHaveLength(4)
    expect(result.excludedTotal).toBe(0)
    expect(result.excludedCount).toBe(0)
  })

  it('กันหมวดที่เลือกออกจากงบ และบอกยอดที่กันไป', () => {
    const result = splitCountedExpenses(transactions, ['ที่พัก', 'บิลและบริการ'])

    expect(result.counted.map((item) => item.category)).toEqual(['อาหาร', 'การเดินทาง'])
    expect(result.excludedTotal).toBe(4800)
    expect(result.excludedCount).toBe(2)
  })

  it('รายการที่ไม่ระบุหมวดยังนับในงบเสมอ', () => {
    const result = splitCountedExpenses(
      [makeTransaction({ amount: 90, category: null })],
      ['ที่พัก'],
    )

    expect(result.counted).toHaveLength(1)
  })

  it('งบที่กันหมวดไว้ ต้องไม่ดึงรายจ่ายหมวดนั้นเข้าช่องรวม', () => {
    const items = [
      planItem({ id: 'food', category: 'อาหาร', amount: 200 }),
      planItem({ id: 'other', category: null, amount: 100 }),
    ]
    const { counted } = splitCountedExpenses(
      [
        makeTransaction({ amount: 150, category: 'อาหาร' }),
        makeTransaction({ amount: 4500, category: 'ที่พัก' }),
      ],
      ['ที่พัก'],
    )

    const progress = buildPlanProgress(items, counted)
    expect(progress.items.find((row) => row.item.id === 'other')?.spent).toBe(0)
    expect(progress.unplanned).toBe(0)
  })
})

describe('excludedCategories ในค่าเริ่มต้น', () => {
  it('เริ่มต้นนับทุกหมวด', () => {
    expect(defaultDailyCapSettings.excludedCategories).toEqual([])
  })

  it('เงินเดือนไม่อยู่ในรายการที่กันออกได้ เพราะเป็นรายรับ', () => {
    const values = capExcludableCategories.map((option) => option.value as string)
    expect(values).not.toContain('เงินเดือน')
    expect(values).toContain('ที่พัก')
  })
})
