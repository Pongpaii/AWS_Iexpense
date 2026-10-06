const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

export const MIN_TRANSACTION_DATE = '1970-01-01';

/** ตรวจว่าเป็น YYYY-MM-DD ที่มีอยู่จริงในปฏิทิน (เช่น 2025-02-29 ไม่ผ่าน) */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidIsoMonth(value: string): boolean {
  const m = ISO_MONTH.exec(value);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * วันที่สูงสุดที่ยอมรับ = วันนี้ (UTC) + 1 ปี
 * ใช้ UTC เพื่อให้ client/server ได้ผลเหมือนกัน ส่วนต่าง timezone ไม่มีผลเพราะมี margin 1 ปี
 */
export function maxTransactionDate(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
  return toIsoDate(d);
}

/** "2025-03-14" → "2025-03" */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** ตรวจ IANA timezone เช่น "Asia/Bangkok", "UTC" (ไม่รับ offset แบบ "+07:00") */
export function isValidTimeZone(tz: string): boolean {
  if (!/^(?:UTC|[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
