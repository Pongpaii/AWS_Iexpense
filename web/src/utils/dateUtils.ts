/**
 * Helper สำหรับจัดการวันที่แบบ ISO ('YYYY-MM-DD') โดยไม่พึ่ง timezone ของ Date
 * ใช้ร่วมกันระหว่าง streak counter และ heatmap calendar
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

/** แปลง Date เป็น 'YYYY-MM-DD' ตามเวลาท้องถิ่น (ไม่ใช่ UTC) */
export const toLocalIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_PATTERN.test(value)

/** 'YYYY-MM-DD' → จำนวนวันนับจาก epoch (คำนวณบน UTC เพื่อไม่ให้ DST ทำให้เพี้ยน) */
const isoToDayNumber = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

/** จำนวนวันนับจาก epoch → 'YYYY-MM-DD' */
const dayNumberToIso = (dayNumber: number) => {
  const date = new Date(dayNumber * MS_PER_DAY)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** เลื่อนวันที่ ISO ไปข้างหน้า/ข้างหลังตามจำนวนวันที่ระบุ */
export const shiftIsoDate = (isoDate: string, days: number) =>
  dayNumberToIso(isoToDayNumber(isoDate) + days)

/** จำนวนวันจาก `from` ถึง `to` (บวกเมื่อ to อยู่หลัง from) */
export const daysBetween = (from: string, to: string) => isoToDayNumber(to) - isoToDayNumber(from)

/** คัดเฉพาะวันที่ ISO ที่ถูกต้อง ตัดวันซ้ำ แล้วเรียงจากเก่าไปใหม่ */
const uniqueSortedDates = (dates: readonly string[]) => [...new Set(dates.filter(isIsoDate))].sort()

/**
 * นับวันติดต่อกันที่ยังไม่ขาด โดยเริ่มนับจาก `today` (หรือเมื่อวานถ้าวันนี้ยังไม่มีข้อมูล)
 * คืน 0 เมื่อวันล่าสุดที่มีข้อมูลเก่ากว่าเมื่อวาน
 */
export const getConsecutiveDays = (
  dates: readonly string[],
  today = toLocalIsoDate(new Date()),
): number => {
  const dayNumbers = new Set(uniqueSortedDates(dates).map(isoToDayNumber))
  if (dayNumbers.size === 0) return 0

  const todayNumber = isoToDayNumber(today)

  // วันนี้ยังไม่ได้จด แต่ถ้าเมื่อวานจดไว้ streak ยังไม่ตัด จึงเริ่มนับจากเมื่อวาน
  let anchor = dayNumbers.has(todayNumber)
    ? todayNumber
    : dayNumbers.has(todayNumber - 1)
      ? todayNumber - 1
      : null

  if (anchor === null) return 0

  let streak = 0
  while (dayNumbers.has(anchor)) {
    streak += 1
    anchor -= 1
  }

  return streak
}

/** ช่วงวันติดต่อกันที่ยาวที่สุดจากประวัติทั้งหมด */
export const getLongestConsecutive = (dates: readonly string[]): number => {
  const dayNumbers = uniqueSortedDates(dates).map(isoToDayNumber)
  if (dayNumbers.length === 0) return 0

  let longest = 1
  let run = 1

  for (let index = 1; index < dayNumbers.length; index += 1) {
    if (dayNumbers[index] === dayNumbers[index - 1] + 1) {
      run += 1
      longest = Math.max(longest, run)
    } else {
      run = 1
    }
  }

  return longest
}

/** จำนวนวันในเดือน โดย `month` นับ 1-12 */
export const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate()

/**
 * ตำแหน่งของวันที่ 1 ในตารางปฏิทินที่เริ่มสัปดาห์ด้วยวันจันทร์
 * คืน 0 เมื่อวันที่ 1 เป็นวันจันทร์ ถึง 6 เมื่อเป็นวันอาทิตย์ · `month` นับ 1-12
 */
export const getFirstDayOfWeek = (year: number, month: number) => {
  const sundayFirst = new Date(year, month - 1, 1).getDay()
  return (sundayFirst + 6) % 7
}

/** แยก 'YYYY-MM' ออกเป็นปีและเดือน (1-12) คืน null เมื่อรูปแบบไม่ถูกต้อง */
export const parseIsoMonth = (isoMonth: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(isoMonth)) return null
  const [year, month] = isoMonth.split('-').map(Number)
  return { year, month }
}

/** เลื่อนเดือน 'YYYY-MM' ไปข้างหน้า/ข้างหลัง */
export const shiftIsoMonth = (isoMonth: string, months: number) => {
  const parsed = parseIsoMonth(isoMonth)
  if (!parsed) return isoMonth
  const date = new Date(parsed.year, parsed.month - 1 + months, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** ชื่อวันแบบสั้นเริ่มจากวันจันทร์ ใช้เป็นหัวตารางปฏิทิน */
export const weekdayLabelsMondayFirst = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'] as const

/**
 * วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ (ISO 8601 เริ่มสัปดาห์วันจันทร์)
 * ใช้เป็นตัวแทนของสัปดาห์ในกราฟเทรนด์ เพราะเรียงลำดับได้ตรงกับเวลาจริง
 */
export const getIsoWeekStart = (isoDate: string) => {
  const dayNumber = isoToDayNumber(isoDate)
  // 1970-01-01 เป็นวันพฤหัส จึงบวก 3 ให้ modulo เริ่มนับที่วันจันทร์
  const weekday = ((dayNumber + 3) % 7) + 1
  return dayNumberToIso(dayNumber - (weekday - 1))
}

/**
 * เลขสัปดาห์แบบ ISO 8601 พร้อมปีของสัปดาห์นั้น
 * ปีที่คืนเป็น "ปีของสัปดาห์" ไม่ใช่ปีตามปฏิทิน เช่น 2027-01-01 (ศุกร์)
 * ยังนับเป็นสัปดาห์ที่ 53 ของปี 2026 เพราะวันพฤหัสของสัปดาห์นั้นอยู่ในปี 2026
 */
export const getIsoWeek = (isoDate: string) => {
  const dayNumber = isoToDayNumber(isoDate)
  const weekday = ((dayNumber + 3) % 7) + 1
  // ISO ตัดสินปีของสัปดาห์ด้วยวันพฤหัส เพราะเป็นวันกลางสัปดาห์
  const thursday = dayNumber - weekday + 4
  const year = new Date(thursday * MS_PER_DAY).getUTCFullYear()
  const januaryFirst = Math.floor(Date.UTC(year, 0, 1) / MS_PER_DAY)
  return { year, week: Math.floor((thursday - januaryFirst) / 7) + 1 }
}

/** คีย์สัปดาห์แบบเรียงลำดับได้ 'YYYY-Www' เช่น '2026-W35' */
export const getIsoWeekKey = (isoDate: string) => {
  const { year, week } = getIsoWeek(isoDate)
  return `${year}-W${String(week).padStart(2, '0')}`
}
