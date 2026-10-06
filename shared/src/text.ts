// ลบ control characters (Unicode general category Cc: U+0000–U+001F, U+007F–U+009F)
// รวมถึง bidi override/isolate (U+202A–U+202E, U+2066–U+2069) ที่ใช้ปลอมข้อความได้
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** NFC normalize → ลบ control chars → trim */
export function sanitizeText(input: string): string {
  return input.normalize('NFC').replace(CONTROL_CHARS, '').trim();
}

/** นับความยาวเป็น code point (emoji 1 ตัว = 1) แทน UTF-16 code unit */
export function charLength(input: string): number {
  let n = 0;
  for (const _ of input) n++;
  return n;
}
