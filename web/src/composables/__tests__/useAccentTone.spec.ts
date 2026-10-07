import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCENT_TONE_STORAGE_KEY,
  accentToneOptions,
  initializeAccentTone,
  resetAccentTone,
  useAccentTone,
} from '../useAccentTone'

const { accentTone, activeSwatch, setAccentTone } = useAccentTone()

const readVar = (name: string) => document.documentElement.style.getPropertyValue(name)

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('style')
  resetAccentTone()
})

describe('useAccentTone', () => {
  it('ค่าเริ่มต้นเป็นแดง เพราะเป็นสีที่ผู้ใช้เดิมคุ้นอยู่แล้ว', () => {
    expect(accentTone.value).toBe('red')
    expect(activeSwatch.value).toBe(
      accentToneOptions.find((option) => option.value === 'red')?.swatch,
    )
  })

  it('มีให้เลือกเฉพาะแดง ฟ้า เขียว', () => {
    expect(accentToneOptions.map((option) => option.value)).toEqual(['red', 'blue', 'green'])
  })

  it('เปลี่ยนสีแล้วทา CSS token ชุด --alert-* ใหม่ทั้งชุด', () => {
    setAccentTone('blue')

    expect(readVar('--alert')).toBe('#2f7bb0')
    expect(readVar('--alert-ink')).toBe('#1b4f7a')
    expect(readVar('--alert-text')).toBe('#22608f')
    expect(readVar('--alert-soft')).toBe('#7fb3d8')
    expect(readVar('--alert-line')).toBe('#cfe0ef')
    expect(readVar('--alert-tint')).toBe('#f0f6fb')
    expect(readVar('--alert-muted')).toBe('#5c7285')
  })

  it('จำค่าไว้ใน localStorage', () => {
    const result = setAccentTone('green')

    expect(result).toEqual({ ok: true, persisted: true })
    expect(accentTone.value).toBe('green')
    expect(window.localStorage.getItem(ACCENT_TONE_STORAGE_KEY)).toBe('green')
  })

  it('ปฏิเสธค่าที่ไม่รู้จักและคงสีเดิมไว้', () => {
    setAccentTone('blue')
    const result = setAccentTone('purple' as never)

    expect(result).toEqual({ ok: false, persisted: false })
    expect(accentTone.value).toBe('blue')
  })

  it('initializeAccentTone ทาสีที่เก็บไว้ตอนเปิดแอป', () => {
    setAccentTone('green')
    document.documentElement.removeAttribute('style')

    initializeAccentTone()

    expect(readVar('--alert')).toBe('#2f8355')
  })

  it('ซิงก์ข้ามแท็บผ่าน storage event และถอยไปแดงเมื่อค่าเสีย', () => {
    setAccentTone('green')

    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCENT_TONE_STORAGE_KEY, newValue: 'blue' }),
    )
    expect(accentTone.value).toBe('blue')
    expect(readVar('--alert')).toBe('#2f7bb0')

    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCENT_TONE_STORAGE_KEY, newValue: 'rainbow' }),
    )
    expect(accentTone.value).toBe('red')
  })

  it('ไม่สนใจ storage event ของคีย์อื่น', () => {
    setAccentTone('blue')

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'money-flow.something-else', newValue: 'green' }),
    )

    expect(accentTone.value).toBe('blue')
  })
})
