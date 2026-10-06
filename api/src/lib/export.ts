import type { Transaction } from '@money-flow/shared';

const TYPE_TH = { income: 'รายรับ', expense: 'รายจ่าย' } as const;

/**
 * กัน CSV/formula injection: cell ที่ขึ้นต้นด้วย = + - @ tab CR จะถูกนำหน้าด้วย '
 * แล้ว quote ตาม RFC 4180
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV พร้อม BOM เพื่อให้ Excel อ่านภาษาไทยถูก */
export function toCsv(transactions: Transaction[]): string {
  const header = [
    'วันที่',
    'รายละเอียด',
    'ประเภท',
    'หมวดหมู่',
    'จำนวนเงิน (บาท)',
    'สร้างเมื่อ',
    'id',
  ];
  const rows = [...transactions]
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.id.localeCompare(b.id))
    .map((t) =>
      [t.transactionDate, t.description, TYPE_TH[t.type], t.category, t.amount, t.createdAt, t.id]
        .map(csvCell)
        .join(','),
    );
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}
