/**
 * จำนวนเงินทั้งระบบเป็น "บาท" จำนวนเต็ม (integer) — ไม่มีทศนิยม ไม่มีหน่วยสตางค์
 * ทั้ง request, response และ DynamoDB ใช้ค่าเดียวกัน จึงไม่มีปัญหา float
 */

const thbFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** แสดงผลจำนวนเงิน เช่น 1234 → "฿1,234" */
export function formatBaht(amount: number): string {
  return thbFormatter.format(amount);
}

/** ตรวจว่าเป็นจำนวนเต็มบาทที่อยู่ในช่วง 1..max */
export function isWholeBaht(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= max;
}
