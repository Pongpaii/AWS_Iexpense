import { describe, expect, it } from 'vitest';
import {
  budgetVsActual,
  categoryBreakdown,
  computeRunway,
  dailyCapStatus,
  dailyCashflow,
  expenseHeatmap,
  forecastMonth,
  spendingInsights,
  type TxLike,
} from '../src/lib/analytics';
import { currentStreak, evaluateBadges, longestStreak } from '../src/lib/achievements';

const tx = (
  transactionDate: string,
  amount: number,
  category: string | null = 'อาหาร',
  type: 'income' | 'expense' = 'expense',
): TxLike => ({ transactionDate, amount, category, type });

const cap = (over: Partial<Parameters<typeof dailyCapStatus>[0]> = {}) => ({
  enabled: true,
  amount: 300,
  subPlans: [],
  excludedCategories: ['ที่พัก'],
  ...over,
});

describe('dailyCashflow', () => {
  it('ครบทุกวันของเดือนและยอดสะสมถูกต้อง', () => {
    const f = dailyCashflow(
      [
        tx('2026-02-01', 17000, 'เงินเดือน', 'income'),
        tx('2026-02-01', 100),
        tx('2026-02-03', 50),
        tx('2026-03-01', 999),
      ],
      '2026-02',
    );
    expect(f).toHaveLength(28);
    expect(f[0]).toMatchObject({ income: 17000, expense: 100, net: 16900, cumulative: 16900 });
    expect(f[2]!.cumulative).toBe(16850);
    expect(f.at(-1)!.cumulative).toBe(16850);
  });
});

describe('categoryBreakdown', () => {
  it('อาหาร/เดินทาง อยู่ต้น, หมวดว่าง = ไม่ระบุหมวด, share รวม = 1', () => {
    const s = categoryBreakdown([
      tx('2026-10-01', 900, 'ช้อปปิ้ง'),
      tx('2026-10-01', 100, 'เดินทาง'),
      tx('2026-10-01', 50, 'อาหาร'),
      tx('2026-10-01', 30, null),
      tx('2026-10-01', 5000, 'เงินเดือน', 'income'),
    ]);
    expect(s.map((x) => x.category)).toEqual(['อาหาร', 'เดินทาง', 'ช้อปปิ้ง', 'ไม่ระบุหมวด']);
    expect(s.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1);
  });

  it('ไม่นับหมวดที่ยกเว้น', () => {
    const s = categoryBreakdown([tx('2026-10-01', 5000, 'ที่พัก'), tx('2026-10-01', 100)], {
      exclude: ['ที่พัก'],
    });
    expect(s).toEqual([{ category: 'อาหาร', total: 100, count: 1, share: 1 }]);
  });
});

describe('expenseHeatmap', () => {
  it('level 0–4 และไม่นับหมวดที่เลือก', () => {
    const h = expenseHeatmap(
      [tx('2026-10-01', 400), tx('2026-10-02', 100), tx('2026-10-03', 9000, 'ที่พัก')],
      '2026-10',
      ['ที่พัก'],
    );
    expect(h).toHaveLength(31);
    expect(h[0]).toMatchObject({ expense: 400, level: 4 });
    expect(h[1]).toMatchObject({ expense: 100, level: 1 });
    expect(h[2]).toMatchObject({ expense: 0, level: 0 });
  });
});

describe('computeRunway', () => {
  const txs = [
    tx('2026-10-06', 300, 'อาหาร'),
    tx('2026-10-01', 300, 'เดินทาง'),
    tx('2026-08-01', 99999),
  ];

  it('เงินพออยู่ได้กี่วันจากค่าเฉลี่ย 30 วัน (ไม่รวมนอกช่วง)', () => {
    const r = computeRunway({ balance: 6000, txs, today: '2026-10-06' });
    expect(r.avgDailyExpense).toBe(20); // 600 / 30
    expect(r.days).toBe(300);
    expect(r.runOutDate).toBe('2027-08-02');
    expect(r.categories.map((c) => c.category)).toEqual(['อาหาร', 'เดินทาง']);
  });

  it('คันโยก: ลดหมวดอาหาร 50% → อยู่ได้นานขึ้น', () => {
    const r = computeRunway({ balance: 6000, txs, today: '2026-10-06', levers: { อาหาร: 50 } });
    expect(r.avgDailyAfterCuts).toBe(15);
    expect(r.days).toBe(400);
    expect(r.daysBefore).toBe(300);
  });

  it('ไม่มีรายจ่าย → ไม่จำกัด; ยอดติดลบ → 0', () => {
    expect(computeRunway({ balance: 100, txs: [], today: '2026-10-06' }).days).toBeNull();
    expect(computeRunway({ balance: -5, txs, today: '2026-10-06' }).days).toBe(0);
  });
});

describe('budgetVsActual', () => {
  it('สถานะ ok/warning/over + หมวดที่ไม่ได้ตั้งงบ, อาหาร/เดินทาง ก่อน', () => {
    const rows = budgetVsActual(
      [
        { category: 'ช้อปปิ้ง', budget: 1000 },
        { category: 'เดินทาง', budget: 100 },
        { category: 'อาหาร', budget: 1000 },
      ],
      [tx('2026-10-01', 850), tx('2026-10-01', 150, 'เดินทาง'), tx('2026-10-01', 70, 'บันเทิง')],
    );
    expect(rows.map((r) => [r.category, r.status])).toEqual([
      ['อาหาร', 'warning'],
      ['เดินทาง', 'over'],
      ['ช้อปปิ้ง', 'ok'],
      ['บันเทิง', 'unbudgeted'],
    ]);
    expect(rows[1]!.remaining).toBe(-50);
  });
});

describe('dailyCapStatus', () => {
  it('ไม่นับหมวดที่ยกเว้น และตรวจแผนย่อย', () => {
    const s = dailyCapStatus(
      cap({
        subPlans: [
          { category: 'เดินทาง', amount: 50 },
          { category: 'อาหาร', amount: 200 },
        ],
      }),
      [
        tx('2026-10-06', 250),
        tx('2026-10-06', 60, 'เดินทาง'),
        tx('2026-10-06', 5000, 'ที่พัก'),
        tx('2026-10-05', 999),
      ],
      '2026-10-06',
    );
    expect(s).toMatchObject({ counted: 310, excludedSpent: 5000, remaining: -10, over: true });
    expect(s.subPlans).toEqual([
      { category: 'อาหาร', plan: 200, spent: 250, over: true },
      { category: 'เดินทาง', plan: 50, spent: 60, over: true },
    ]);
  });
});

describe('forecast + insights (MoneyBuddy)', () => {
  it('คาดการณ์สิ้นเดือนจากค่าเฉลี่ยรายวัน', () => {
    const f = forecastMonth({
      month: '2026-10',
      today: '2026-10-10',
      monthTxs: [
        tx('2026-10-02', 1000),
        tx('2026-10-05', 1000),
        tx('2026-10-01', 17000, 'เงินเดือน', 'income'),
      ],
      balance: 15000,
    });
    expect(f).toMatchObject({
      daysElapsed: 10,
      daysInMonth: 31,
      spentSoFar: 2000,
      avgDailyExpense: 200,
    });
    expect(f.projectedExpense).toBe(6200);
    expect(f.projectedBalance).toBe(15000 - 200 * 21);
  });

  it('เดือนที่ผ่านไปแล้ว → ไม่มีวันที่เหลือ', () => {
    const f = forecastMonth({
      month: '2026-09',
      today: '2026-10-06',
      monthTxs: [tx('2026-09-10', 300)],
      balance: 100,
    });
    expect(f.daysElapsed).toBe(30);
    expect(f.projectedBalance).toBe(100);
  });

  it('insights ภาษาไทย: หมวดหลัก, เกินเงินเดือน, เกินงบ, ติดลบ', () => {
    const monthTxs = [tx('2026-10-01', 9000, 'ช้อปปิ้ง'), tx('2026-10-02', 1000)];
    const forecast = forecastMonth({
      month: '2026-10',
      today: '2026-10-05',
      monthTxs,
      balance: 100,
    });
    const ins = spendingInsights({
      monthTxs,
      forecast,
      settings: { monthlySalary: 17000, categoryBudgets: [{ category: 'ช้อปปิ้ง', budget: 2000 }] },
    });
    const ids = ins.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'top-category',
        'weekday',
        'over-salary',
        'over-budget',
        'negative-forecast',
      ]),
    );
    expect(ins.find((i) => i.id === 'top-category')!.text).toContain('ช้อปปิ้ง');
    expect(ins.find((i) => i.id === 'top-category')!.tone).toBe('warning');
  });
});

describe('streak + badges', () => {
  it('currentStreak นับถึงวันนี้หรือเมื่อวาน', () => {
    expect(currentStreak(['2026-10-04', '2026-10-05', '2026-10-06'], '2026-10-06')).toBe(3);
    expect(currentStreak(['2026-10-04', '2026-10-05'], '2026-10-06')).toBe(2);
    expect(currentStreak(['2026-10-01'], '2026-10-06')).toBe(0);
  });

  it('longestStreak ข้ามเดือน', () => {
    expect(longestStreak(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03'])).toBe(3);
  });

  it('evaluateBadges', () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-10-0${i + 1}`);
    const earned = evaluateBadges({
      today: '2026-10-07',
      transactionCount: 12,
      activeDates: dates,
      recentTxs: [tx('2026-10-06', 100), tx('2026-10-06', 5000, 'ที่พัก')],
      dailyCap: cap(),
      previousMonth: { income: 17000, expense: 12000, transactionCount: 20 },
    });
    expect(earned.sort()).toEqual(
      ['first-tx', 'saver-month', 'streak-3', 'streak-7', 'tx-10', 'within-cap'].sort(),
    );
  });
});
