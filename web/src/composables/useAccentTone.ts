import { computed, readonly, ref } from 'vue'

/**
 * สีของ "รายจ่าย / เกินงบ" ให้ผู้ใช้เลือกเอง
 *
 * ทำไมต้องเลือกได้: บางคนอ่านสีแดงเป็น "เตือนภัย" แล้วเครียดกับตัวเลขของตัวเอง
 * บางคนกลับต้องการสีแดงเพราะมันสะดุดตาและอ่านเร็วที่สุด ตัดสินใจแทนไม่ได้
 * จึงเก็บเป็น preference ของอุปกรณ์ แล้วทาทับ CSS token ชุด --alert-* ทั้งชุด
 *
 * ค่า default เป็นแดงเพื่อให้เหมือนที่ผู้ใช้เดิมคุ้นอยู่แล้ว
 */
export type AccentTone = 'red' | 'blue' | 'green'

export interface AccentToneOption {
  value: AccentTone
  label: string
  hint: string
  /** สีตัวอย่างบนปุ่มเลือก */
  swatch: string
}

interface AccentPalette {
  ink: string
  text: string
  base: string
  soft: string
  line: string
  tint: string
  muted: string
}

export const ACCENT_TONE_STORAGE_KEY = 'money-flow.accent-tone.v1'
const DEFAULT_TONE: AccentTone = 'red'

/**
 * ทุกเฉดผ่านการเช็กคอนทราสต์กับพื้นที่มันถูกใช้จริง (WCAG AA 4.5:1):
 * text/ink บนขาวและบน tint · ขาวบน base · ink บน line
 */
const ACCENT_PALETTES: Record<AccentTone, AccentPalette> = {
  red: {
    ink: '#8f2f27',
    text: '#b0453c',
    base: '#c0453c',
    soft: '#e08b83',
    line: '#f0cdc9',
    tint: '#fdf4f3',
    muted: '#85615d',
  },
  blue: {
    ink: '#1b4f7a',
    text: '#22608f',
    base: '#2f7bb0',
    soft: '#7fb3d8',
    line: '#cfe0ef',
    tint: '#f0f6fb',
    muted: '#5c7285',
  },
  green: {
    ink: '#1d5c3a',
    text: '#226b44',
    base: '#2f8355',
    soft: '#7cbd97',
    line: '#cbe6d7',
    tint: '#eff8f3',
    muted: '#55705f',
  },
}

export const accentToneOptions: readonly AccentToneOption[] = [
  {
    value: 'red',
    label: 'แดง',
    hint: 'สะดุดตาที่สุด เห็นทันทีว่าวันไหนใช้เกิน',
    swatch: ACCENT_PALETTES.red.base,
  },
  {
    value: 'blue',
    label: 'ฟ้า',
    hint: 'อ่านเป็นข้อมูล ไม่เหมือนถูกเตือน',
    swatch: ACCENT_PALETTES.blue.base,
  },
  {
    value: 'green',
    label: 'เขียว',
    hint: 'กลืนไปกับธีมแอป แต่จะใกล้สีรายรับ',
    swatch: ACCENT_PALETTES.green.base,
  },
]

const isAccentTone = (value: unknown): value is AccentTone =>
  value === 'red' || value === 'blue' || value === 'green'

const loadTone = (): AccentTone => {
  if (typeof window === 'undefined') return DEFAULT_TONE

  try {
    const stored = window.localStorage.getItem(ACCENT_TONE_STORAGE_KEY)
    return isAccentTone(stored) ? stored : DEFAULT_TONE
  } catch {
    return DEFAULT_TONE
  }
}

const tone = ref<AccentTone>(loadTone())
const readonlyTone = readonly(tone)

const applyTone = (value: AccentTone) => {
  if (typeof document === 'undefined') return

  const palette = ACCENT_PALETTES[value]
  const style = document.documentElement.style
  style.setProperty('--alert-ink', palette.ink)
  style.setProperty('--alert-text', palette.text)
  style.setProperty('--alert', palette.base)
  style.setProperty('--alert-soft', palette.soft)
  style.setProperty('--alert-line', palette.line)
  style.setProperty('--alert-tint', palette.tint)
  style.setProperty('--alert-muted', palette.muted)
}

/** เรียกก่อน mount เพื่อไม่ให้เห็นสีเริ่มต้นแวบก่อนสีที่ผู้ใช้เลือก */
export const initializeAccentTone = () => applyTone(tone.value)

export interface AccentToneSaveResult {
  ok: boolean
  persisted: boolean
}

const setAccentTone = (value: AccentTone): AccentToneSaveResult => {
  if (!isAccentTone(value)) return { ok: false, persisted: false }

  tone.value = value
  applyTone(value)

  try {
    window.localStorage.setItem(ACCENT_TONE_STORAGE_KEY, value)
    return { ok: true, persisted: true }
  } catch {
    return { ok: true, persisted: false }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== ACCENT_TONE_STORAGE_KEY) return

    const next = isAccentTone(event.newValue) ? event.newValue : DEFAULT_TONE
    tone.value = next
    applyTone(next)
  })
}

/** ใช้ในเทสต์เพื่อคืนค่าเริ่มต้น ไม่ต้องเรียกจาก UI */
export const resetAccentTone = () => {
  tone.value = DEFAULT_TONE
  applyTone(DEFAULT_TONE)
}

const activeSwatch = computed(
  () => accentToneOptions.find((option) => option.value === tone.value)?.swatch ?? '',
)

export const useAccentTone = () => ({
  accentTone: readonlyTone,
  accentToneOptions,
  activeSwatch,
  setAccentTone,
})
