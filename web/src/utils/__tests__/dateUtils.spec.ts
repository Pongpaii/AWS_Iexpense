import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  getConsecutiveDays,
  getDaysInMonth,
  getFirstDayOfWeek,
  getIsoWeek,
  getIsoWeekKey,
  getIsoWeekStart,
  getLongestConsecutive,
  isIsoDate,
  parseIsoMonth,
  shiftIsoDate,
  shiftIsoMonth,
  toLocalIsoDate,
  weekdayLabelsMondayFirst,
} from '../dateUtils'

describe('toLocalIsoDate', () => {
  it('ใช้เวลาท้องถิ่น ไม่ใช่ UTC', () => {
    // สร้างด้วย local constructor แล้วต้องได้วันเดิมกลับมาเสมอ
    expect(toLocalIsoDate(new Date(2026, 2, 15))).toBe('2026-03-15')
  })

  it('เติมศูนย์หน้าเดือนและวันที่เลขหลักเดียว', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('ไม่เลื่อนวันแม้เป็นเวลาใกล้เที่ยงคืน', () => {
    expect(toLocalIsoDate(new Date(2026, 2, 15, 23, 59, 59))).toBe('2026-03-15')
    expect(toLocalIsoDate(new Date(2026, 2, 15, 0, 0, 0))).toBe('2026-03-15')
  })
})

describe('isIsoDate', () => {
  it.each(['2026-03-15', '1999-12-31'])('รับรูปแบบที่ถูกต้อง: %s', (value) => {
    expect(isIsoDate(value)).toBe(true)
  })

  it.each(['2026-3-15', '15-03-2026', '2026/03/15', '', 'abc'])(
    'ปฏิเสธรูปแบบที่ผิด: %s',
    (value) => {
      expect(isIsoDate(value)).toBe(false)
    },
  )

  it('ปฏิเสธค่าที่ไม่ใช่ string', () => {
    expect(isIsoDate(20260315)).toBe(false)
    expect(isIsoDate(null)).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})

describe('shiftIsoDate', () => {
  it('เลื่อนไปข้างหน้าและข้างหลัง', () => {
    expect(shiftIsoDate('2026-03-15', 1)).toBe('2026-03-16')
    expect(shiftIsoDate('2026-03-15', -1)).toBe('2026-03-14')
  })

  it('ข้ามเดือนได้ถูกต้อง', () => {
    expect(shiftIsoDate('2026-03-31', 1)).toBe('2026-04-01')
    expect(shiftIsoDate('2026-04-01', -1)).toBe('2026-03-31')
  })

  it('ข้ามปีได้ถูกต้อง', () => {
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('รู้จักปีอธิกสุรทิน', () => {
    expect(shiftIsoDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftIsoDate('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('เลื่อน 0 วันแล้วได้ค่าเดิม', () => {
    expect(shiftIsoDate('2026-03-15', 0)).toBe('2026-03-15')
  })
})

describe('daysBetween', () => {
  it('เป็นบวกเมื่อปลายทางอยู่หลังต้นทาง', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14)
  })

  it('เป็นลบเมื่อปลายทางอยู่ก่อนต้นทาง', () => {
    expect(daysBetween('2026-03-15', '2026-03-01')).toBe(-14)
  })

  it('เป็นศูนย์เมื่อเป็นวันเดียวกัน', () => {
    expect(daysBetween('2026-03-15', '2026-03-15')).toBe(0)
  })

  it('นับข้ามปีถูกต้อง', () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
  })
})

describe('getConsecutiveDays', () => {
  it('คืน 0 เมื่อไม่มีข้อมูล', () => {
    expect(getConsecutiveDays([], '2026-03-15')).toBe(0)
  })

  it('นับจากวันนี้เมื่อวันนี้มีการบันทึก', () => {
    const dates = ['2026-03-13', '2026-03-14', '2026-03-15']

    expect(getConsecutiveDays(dates, '2026-03-15')).toBe(3)
  })

  it('ยังนับต่อเนื่องได้เมื่อวันนี้ยังไม่จดแต่เมื่อวานจดไว้', () => {
    const dates = ['2026-03-13', '2026-03-14']

    expect(getConsecutiveDays(dates, '2026-03-15')).toBe(2)
  })

  it('คืน 0 เมื่อวันล่าสุดเก่ากว่าเมื่อวาน (streak ขาดแล้ว)', () => {
    expect(getConsecutiveDays(['2026-03-10'], '2026-03-15')).toBe(0)
  })

  it('หยุดนับตรงวันที่ขาด', () => {
    const dates = ['2026-03-10', '2026-03-11', '2026-03-14', '2026-03-15']

    expect(getConsecutiveDays(dates, '2026-03-15')).toBe(2)
  })

  it('นับวันซ้ำเป็นวันเดียว', () => {
    const dates = ['2026-03-15', '2026-03-15', '2026-03-15', '2026-03-14']

    expect(getConsecutiveDays(dates, '2026-03-15')).toBe(2)
  })

  it('ไม่สนใจค่าที่รูปแบบไม่ถูกต้อง', () => {
    const dates = ['ไม่ใช่วันที่', '2026-03-15', '2026-03-14']

    expect(getConsecutiveDays(dates, '2026-03-15')).toBe(2)
  })

  it('ข้อมูลในอนาคตไม่ทำให้การนับจากวันนี้เพี้ยน', () => {
    const dates = ['2026-03-15', '2026-03-20']

    expect(getConsecutiveDays(dates, '2026-03-15')).toBe(1)
  })

  it('นับข้ามเดือนได้', () => {
    const dates = ['2026-02-27', '2026-02-28', '2026-03-01']

    expect(getConsecutiveDays(dates, '2026-03-01')).toBe(3)
  })
})

describe('getLongestConsecutive', () => {
  it('คืน 0 เมื่อไม่มีข้อมูล', () => {
    expect(getLongestConsecutive([])).toBe(0)
  })

  it('คืน 1 เมื่อมีวันเดียว', () => {
    expect(getLongestConsecutive(['2026-03-15'])).toBe(1)
  })

  it('หาช่วงที่ยาวที่สุดจากหลายช่วง', () => {
    const dates = [
      '2026-01-01',
      '2026-01-02',
      '2026-02-01',
      '2026-02-02',
      '2026-02-03',
      '2026-02-04',
      '2026-03-01',
    ]

    expect(getLongestConsecutive(dates)).toBe(4)
  })

  it('ไม่ขึ้นกับลำดับที่ส่งเข้ามา', () => {
    const shuffled = ['2026-03-03', '2026-03-01', '2026-03-02']

    expect(getLongestConsecutive(shuffled)).toBe(3)
  })

  it('นับวันซ้ำเป็นวันเดียว', () => {
    expect(getLongestConsecutive(['2026-03-01', '2026-03-01'])).toBe(1)
  })
})

describe('getDaysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('ปี %i เดือน %i มี %i วัน', (year, month, expected) => {
    expect(getDaysInMonth(year, month)).toBe(expected)
  })
})

describe('getFirstDayOfWeek', () => {
  it('คืน 0 เมื่อวันที่ 1 ตรงกับวันจันทร์', () => {
    // 1 มิถุนายน 2026 เป็นวันจันทร์
    expect(getFirstDayOfWeek(2026, 6)).toBe(0)
  })

  it('คืน 6 เมื่อวันที่ 1 ตรงกับวันอาทิตย์', () => {
    // 1 มีนาคม 2026 เป็นวันอาทิตย์
    expect(getFirstDayOfWeek(2026, 3)).toBe(6)
  })

  it('อยู่ในช่วง 0-6 เสมอ', () => {
    for (let month = 1; month <= 12; month += 1) {
      const offset = getFirstDayOfWeek(2026, month)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(6)
    }
  })
})

describe('parseIsoMonth', () => {
  it('แยกปีและเดือนออกมาได้', () => {
    expect(parseIsoMonth('2026-03')).toEqual({ year: 2026, month: 3 })
  })

  it.each(['2026-13', '2026-00', '2026-3', '2026/03', ''])(
    'คืน null เมื่อรูปแบบผิด: %s',
    (value) => {
      expect(parseIsoMonth(value)).toBeNull()
    },
  )
})

describe('shiftIsoMonth', () => {
  it('เลื่อนเดือนไปข้างหน้าและข้างหลัง', () => {
    expect(shiftIsoMonth('2026-03', 1)).toBe('2026-04')
    expect(shiftIsoMonth('2026-03', -1)).toBe('2026-02')
  })

  it('ข้ามปีได้ถูกต้อง', () => {
    expect(shiftIsoMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftIsoMonth('2026-01', -1)).toBe('2025-12')
  })

  it('คืนค่าเดิมเมื่อ input ผิดรูปแบบ', () => {
    expect(shiftIsoMonth('ไม่ใช่เดือน', 1)).toBe('ไม่ใช่เดือน')
  })
})

describe('weekdayLabelsMondayFirst', () => {
  it('มี 7 วันและเริ่มที่วันจันทร์', () => {
    expect(weekdayLabelsMondayFirst).toHaveLength(7)
    expect(weekdayLabelsMondayFirst[0]).toBe('จ')
    expect(weekdayLabelsMondayFirst[6]).toBe('อา')
  })
})

describe('getIsoWeekStart', () => {
  it('คืนวันจันทร์ของสัปดาห์นั้น', () => {
    // 26 ส.ค. 2026 เป็นวันพุธ สัปดาห์เริ่มวันจันทร์ที่ 24
    expect(getIsoWeekStart('2026-08-26')).toBe('2026-08-24')
  })

  it('วันจันทร์คืนตัวเอง และวันอาทิตย์ยังอยู่สัปดาห์เดิม', () => {
    expect(getIsoWeekStart('2026-08-24')).toBe('2026-08-24')
    expect(getIsoWeekStart('2026-08-30')).toBe('2026-08-24')
  })

  it('ข้ามเดือนและข้ามปีได้', () => {
    expect(getIsoWeekStart('2026-08-01')).toBe('2026-07-27')
    expect(getIsoWeekStart('2027-01-01')).toBe('2026-12-28')
  })
})

describe('getIsoWeek', () => {
  it('1 ม.ค. 2026 เป็นวันพฤหัส จึงเป็นสัปดาห์ที่ 1 ของปี 2026', () => {
    expect(getIsoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 })
  })

  it('ต้นปีที่ยังอยู่สัปดาห์สุดท้ายของปีก่อน ใช้ปีของสัปดาห์นั้น', () => {
    // 1 ม.ค. 2027 เป็นวันศุกร์ วันพฤหัสของสัปดาห์อยู่ในปี 2026
    expect(getIsoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 })
    expect(getIsoWeek('2026-12-31')).toEqual({ year: 2026, week: 53 })
  })

  it('ทุกวันในสัปดาห์เดียวกันได้เลขสัปดาห์เดียวกัน', () => {
    const week = getIsoWeek('2026-08-24')
    for (let offset = 0; offset < 7; offset += 1) {
      expect(getIsoWeek(shiftIsoDate('2026-08-24', offset))).toEqual(week)
    }
  })
})

describe('getIsoWeekKey', () => {
  it('เติมศูนย์ให้เลขสัปดาห์หลักเดียว', () => {
    expect(getIsoWeekKey('2026-01-01')).toBe('2026-W01')
  })

  it('เรียงลำดับตามเวลาได้ด้วยการเทียบ string', () => {
    const keys = ['2026-08-24', '2026-06-08', '2026-12-31'].map(getIsoWeekKey)
    expect([...keys].sort()).toEqual(['2026-W24', '2026-W35', '2026-W53'])
  })
})
