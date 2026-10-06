import type { UserSettings } from '@money-flow/shared';
import { addDays, dailyCapStatus, type TxLike } from './analytics';

/** นับวันติดต่อกันที่มีการบันทึก (นับถึงวันนี้ หรือเมื่อวานถ้าวันนี้ยังไม่บันทึก) */
export function currentStreak(dates: Iterable<string>, today: string): number {
  const set = new Set(dates);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function longestStreak(dates: Iterable<string>): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface BadgeDef {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export const BADGES: readonly BadgeDef[] = [
  { id: 'first-tx', title: 'ก้าวแรก', description: 'บันทึกรายการแรก', icon: '🌱' },
  { id: 'tx-10', title: 'เริ่มติดเป็นนิสัย', description: 'บันทึกครบ 10 รายการ', icon: '📒' },
  { id: 'tx-100', title: 'นักบันทึกตัวจริง', description: 'บันทึกครบ 100 รายการ', icon: '🏅' },
  { id: 'streak-3', title: 'ต่อเนื่อง 3 วัน', description: 'บันทึกติดต่อกัน 3 วัน', icon: '🔥' },
  { id: 'streak-7', title: 'ครบสัปดาห์', description: 'บันทึกติดต่อกัน 7 วัน', icon: '⚡' },
  { id: 'streak-30', title: 'วินัยเหล็ก', description: 'บันทึกติดต่อกัน 30 วัน', icon: '💎' },
  {
    id: 'within-cap',
    title: 'คุมงบรายวันได้',
    description: 'เมื่อวานใช้จ่ายไม่เกินเพดานรายวัน',
    icon: '🎯',
  },
  {
    id: 'saver-month',
    title: 'เดือนแห่งการออม',
    description: 'เดือนที่แล้วรายรับมากกว่ารายจ่าย',
    icon: '🐷',
  },
];

export interface BadgeContext {
  today: string;
  transactionCount: number;
  /** วันที่มีรายการ (ย้อนหลังอย่างน้อย 30 วัน) */
  activeDates: readonly string[];
  recentTxs: readonly TxLike[];
  dailyCap: UserSettings['dailyCap'];
  previousMonth: { income: number; expense: number; transactionCount: number } | null;
}

/** badge ที่ "ควรได้" ตามข้อมูลปัจจุบัน (ไม่ถอนคืนเมื่อเงื่อนไขหายไป) */
export function evaluateBadges(ctx: BadgeContext): string[] {
  const earned: string[] = [];
  const streak = Math.max(
    currentStreak(ctx.activeDates, ctx.today),
    longestStreak(ctx.activeDates),
  );
  if (ctx.transactionCount >= 1) earned.push('first-tx');
  if (ctx.transactionCount >= 10) earned.push('tx-10');
  if (ctx.transactionCount >= 100) earned.push('tx-100');
  if (streak >= 3) earned.push('streak-3');
  if (streak >= 7) earned.push('streak-7');
  if (streak >= 30) earned.push('streak-30');

  const yesterday = addDays(ctx.today, -1);
  const hadActivity = ctx.recentTxs.some((t) => t.transactionDate === yesterday);
  if (ctx.dailyCap.enabled && hadActivity) {
    const s = dailyCapStatus(ctx.dailyCap, ctx.recentTxs, yesterday);
    if (!s.over) earned.push('within-cap');
  }

  const pm = ctx.previousMonth;
  if (pm && pm.transactionCount > 0 && pm.income > pm.expense) earned.push('saver-month');
  return earned;
}
