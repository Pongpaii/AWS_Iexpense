import { monthOf } from '@money-flow/shared';
import { ALL_SUM_SK, monthSumSk } from './db';

/** ส่วนของ transaction ที่มีผลต่อยอดสรุป */
export interface Contribution {
  type: 'income' | 'expense';
  amount: number;
  category: string | null;
  transactionDate: string;
}

/** SK ของ summary item → (ชื่อ attribute → ค่าที่ต้อง ADD) */
export type SummaryDeltas = Map<string, Map<string, number>>;

export const CAT_TOTAL_PREFIX = 'cat|';
export const CAT_COUNT_PREFIX = 'cnt|';

/** ชื่อ attribute ของยอดรายหมวด เช่น "cat|expense|อาหาร" (หมวดว่าง = "") */
export const catTotalAttr = (type: string, category: string | null) =>
  `${CAT_TOTAL_PREFIX}${type}|${category ?? ''}`;
export const catCountAttr = (type: string, category: string | null) =>
  `${CAT_COUNT_PREFIX}${type}|${category ?? ''}`;

function add(deltas: SummaryDeltas, sk: string, attr: string, value: number) {
  let m = deltas.get(sk);
  if (!m) deltas.set(sk, (m = new Map()));
  m.set(attr, (m.get(attr) ?? 0) + value);
}

/** เพิ่มผลของ transaction (sign = +1 เพิ่ม, -1 ลบ) ลงใน deltas */
export function applyContribution(deltas: SummaryDeltas, c: Contribution, sign: 1 | -1): void {
  const month = monthSumSk(monthOf(c.transactionDate));
  for (const sk of [month, ALL_SUM_SK]) {
    add(deltas, sk, c.type, sign * c.amount);
    add(deltas, sk, 'count', sign);
  }
  add(deltas, month, catTotalAttr(c.type, c.category), sign * c.amount);
  add(deltas, month, catCountAttr(c.type, c.category), sign);
}

/** ตัด attribute ที่ delta = 0 และ SK ที่ไม่มีอะไรเปลี่ยน (เช่น แก้แค่ description) */
export function compactDeltas(deltas: SummaryDeltas): SummaryDeltas {
  const out: SummaryDeltas = new Map();
  for (const [sk, attrs] of deltas) {
    const nonZero = new Map([...attrs].filter(([, v]) => v !== 0));
    if (nonZero.size > 0) out.set(sk, nonZero);
  }
  return out;
}

export function deltasFor(changes: { contribution: Contribution; sign: 1 | -1 }[]): SummaryDeltas {
  const d: SummaryDeltas = new Map();
  for (const ch of changes) applyContribution(d, ch.contribution, ch.sign);
  return compactDeltas(d);
}

/** แปลง delta ของ 1 SK เป็น UpdateExpression แบบ ADD (atomic) */
export function toAddUpdate(attrs: Map<string, number>): {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, number>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};
  const parts: string[] = [];
  let i = 0;
  for (const [attr, v] of attrs) {
    names[`#a${i}`] = attr;
    values[`:v${i}`] = v;
    parts.push(`#a${i} :v${i}`);
    i++;
  }
  return {
    UpdateExpression: `ADD ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}
