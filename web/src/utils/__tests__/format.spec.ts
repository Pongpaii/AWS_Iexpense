import { describe, expect, it } from 'vitest'
import { formatBaht, formatDate } from '../format'

/** ตัวเลขที่เหลืออยู่ในสตริง ใช้เลี่ยงการผูกเทสต์กับสัญลักษณ์ของ ICU แต่ละเวอร์ชัน */
const digitsOf = (value: string) => value.replace(/[^\d.]/g, '')

describe('formatBaht', () => {
  it('แสดงจำนวนเต็มโดยไม่มีทศนิยมส่วนเกิน', () => {
    expect(digitsOf(formatBaht(1200))).toBe('1200')
  })

  it('คงทศนิยมไว้เมื่อมีเศษสตางค์', () => {
    expect(digitsOf(formatBaht(85.5))).toBe('85.5')
    expect(digitsOf(formatBaht(85.25))).toBe('85.25')
  })

  it('ปัดทศนิยมเหลือไม่เกิน 2 ตำแหน่ง', () => {
    expect(digitsOf(formatBaht(10.129))).toBe('10.13')
  })

  it('ใส่ตัวคั่นหลักพัน', () => {
    expect(formatBaht(1234567)).toContain(',')
  })

  it('แสดงศูนย์ได้ ไม่คืนค่าว่าง', () => {
    expect(digitsOf(formatBaht(0))).toBe('0')
  })

  it('ทำเครื่องหมายค่าติดลบ', () => {
    const formatted = formatBaht(-500)

    expect(digitsOf(formatted)).toBe('500')
    expect(formatted).toMatch(/[-−(]/)
  })

  it('มีสัญลักษณ์สกุลเงินติดมาด้วย', () => {
    expect(formatBaht(100)).not.toBe('100')
  })
})

describe('formatDate', () => {
  it('คงวันที่ตามที่ระบุ ไม่เลื่อนเพราะ timezone', () => {
    // นี่คือเหตุผลที่ต้องต่อ 'T00:00:00' ก่อนสร้าง Date
    // ถ้า parse เป็น UTC วันที่จะเลื่อนไปหนึ่งวันในโซนที่ offset เป็นลบ
    expect(formatDate('2026-03-15')).toContain('15')
    expect(formatDate('2026-01-01')).toContain('1')
    expect(formatDate('2026-12-31')).toContain('31')
  })

  it('ให้ผลเหมือนกันทุกครั้งสำหรับ input เดียวกัน', () => {
    expect(formatDate('2026-03-15')).toBe(formatDate('2026-03-15'))
  })

  it('แยกความต่างของวันที่คนละวัน', () => {
    expect(formatDate('2026-03-15')).not.toBe(formatDate('2026-03-16'))
  })

  it('คืนค่าที่ไม่ว่างเปล่า', () => {
    expect(formatDate('2026-03-15').length).toBeGreaterThan(0)
  })
})
