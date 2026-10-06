import {
  UNCATEGORIZED,
  sortByCategoryPriority,
  type Transaction,
  type UserSettings,
} from '@money-flow/shared';
import { monthRange } from './date';

/** รายการที่ใช้คำนวณ (Transaction หรือรายการรอซิงก์ก็ได้) */
export type TxLike = Pick<Transaction, 'amount' | 'type' | 'category' | 'transactionDate'>;

const catName = (c: string | null) => c ?? UNCATEGORIZED;
const pad = (n: number) => String(n).padStart(2, '0');

/** วันทั้งหมดของเดือน "YYYY-MM" */
export function daysOfMonth(month: string): string[] {
  const { to } = monthRange(month);
  const last = Number(to.slice(8));
  return Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** เพิ่ม/ลดวัน (UTC) */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* ------------------------------ กระแสเงินสด ------------------------------ */

export interface DayFlow {
  date: string;
  income: number;
  expense: number;
  net: number;
  /** ยอดสะสมตั้งแต่ต้นเดือน */
  cumulative: number;
}

export function dailyCashflow(txs: readonly TxLike[], month: string): DayFlow[] {
  const byDay = new Map<string, { income: number; expense: number }>();
  for (const t of txs) {
    if (!t.transactionDate.startsWith(month)) continue;
    const d = byDay.get(t.transactionDate) ?? { income: 0, expense: 0 };
    d[t.type] += t.amount;
    byDay.set(t.transactionDate, d);
  }
  let cumulative = 0;
  return daysOfMonth(month).map((date) => {
    const { income, expense } = byDay.get(date) ?? { income: 0, expense: 0 };
    cumulative += income - expense;
    return { date, income, expense, net: income - expense, cumulative };
  });
}

/* ------------------------------ สัดส่วนหมวด ------------------------------ */

export interface CategorySlice {
  category: string;
  total: number;
  count: number;
  share: number;
}

/** สัดส่วนรายจ่ายตามหมวด — อาหาร/เดินทาง อยู่ต้น ที่เหลือเรียงยอดมาก→น้อย */
export function categoryBreakdown(
  txs: readonly TxLike[],
  opts: { type?: 'income' | 'expense'; exclude?: readonly string[] } = {},
): CategorySlice[] {
  const type = opts.type ?? 'expense';
  const exclude = new Set(opts.exclude ?? []);
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    if (t.type !== type) continue;
    const c = catName(t.category);
    if (exclude.has(c)) continue;
    const v = map.get(c) ?? { total: 0, count: 0 };
    v.total += t.amount;
    v.count++;
    map.set(c, v);
  }
  const sum = [...map.values()].reduce((s, v) => s + v.total, 0);
  const rows = [...map].map(([category, v]) => ({
    category,
    ...v,
    share: sum ? v.total / sum : 0,
  }));
  return sortByCategoryPriority(
    rows,
    (r) => r.category,
    (a, b) => b.total - a.total,
  );
}

/* -------------------------------- Heatmap -------------------------------- */

export interface HeatCell {
  date: string;
  expense: number;
  /** 0 = ไม่มีรายจ่าย, 1–4 = น้อย→มาก */
  level: 0 | 1 | 2 | 3 | 4;
}

/** ปฏิทิน heatmap รายจ่ายรายวัน (ไม่นับหมวดที่เลือก เช่น ค่าที่พัก) */
export function expenseHeatmap(
  txs: readonly TxLike[],
  month: string,
  exclude: readonly string[] = [],
): HeatCell[] {
  const ex = new Set(exclude);
  const flows = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== 'expense' || !t.transactionDate.startsWith(month)) continue;
    if (ex.has(catName(t.category))) continue;
    flows.set(t.transactionDate, (flows.get(t.transactionDate) ?? 0) + t.amount);
  }
  const max = Math.max(0, ...flows.values());
  return daysOfMonth(month).map((date) => {
    const expense = flows.get(date) ?? 0;
    const level =
      expense === 0 || max === 0
        ? 0
        : (Math.min(4, Math.ceil((expense / max) * 4)) as 1 | 2 | 3 | 4);
    return { date, expense, level };
  });
}

/* --------------------------------- Runway -------------------------------- */

export interface RunwayCategory {
  category: string;
  /** รายจ่ายเฉลี่ยต่อวันของหมวดนี้ */
  daily: number;
  /** ลดลงกี่ % (คันโยก) */
  cut: number;
  dailyAfterCut: number;
}

export interface Runway {
  balance: number;
  windowDays: number;
  avgDailyExpense: number;
  avgDailyAfterCuts: number;
  /** null = ไม่มีรายจ่าย (อยู่ได้ไม่จำกัด); 0 = เงินหมดแล้ว */
  days: number | null;
  daysBefore: number | null;
  runOutDate: string | null;
  categories: RunwayCategory[];
}

/**
 * Runway: เงินคงเหลือพออยู่ได้อีกกี่วัน จากค่าเฉลี่ยรายจ่ายรายวันช่วง `windowDays` วันล่าสุด
 * levers = { หมวด: % ที่จะลด } เพื่อดูว่าถ้าลดหมวดนั้นจะอยู่ได้นานขึ้นเท่าไร
 */
export function computeRunway(input: {
  balance: number;
  txs: readonly TxLike[];
  today: string;
  windowDays?: number;
  levers?: Readonly<Record<string, number>>;
}): Runway {
  const windowDays = input.windowDays ?? 30;
  const from = addDays(input.today, -(windowDays - 1));
  const recent = input.txs.filter(
    (t) => t.type === 'expense' && t.transactionDate >= from && t.transactionDate <= input.today,
  );
  const slices = categoryBreakdown(recent);
  const categories = slices.map((s) => {
    const daily = s.total / windowDays;
    const cut = Math.min(100, Math.max(0, input.levers?.[s.category] ?? 0));
    return { category: s.category, daily, cut, dailyAfterCut: daily * (1 - cut / 100) };
  });
  const avgDailyExpense = categories.reduce((s, c) => s + c.daily, 0);
  const avgDailyAfterCuts = categories.reduce((s, c) => s + c.dailyAfterCut, 0);

  const daysFor = (perDay: number) =>
    input.balance <= 0 ? 0 : perDay <= 0 ? null : Math.floor(input.balance / perDay);
  const days = daysFor(avgDailyAfterCuts);
  return {
    balance: input.balance,
    windowDays,
    avgDailyExpense,
    avgDailyAfterCuts,
    days,
    daysBefore: daysFor(avgDailyExpense),
    runOutDate: days === null ? null : addDays(input.today, days),
    categories,
  };
}

/* ---------------------------- งบ vs จ่ายจริง ---------------------------- */

export interface BudgetRow {
  category: string;
  budget: number | null;
  actual: number;
  remaining: number | null;
  /** actual / budget (null ถ้าไม่ได้ตั้งงบ) */
  ratio: number | null;
  status: 'ok' | 'warning' | 'over' | 'unbudgeted';
}

export function budgetVsActual(
  budgets: UserSettings['categoryBudgets'],
  monthTxs: readonly TxLike[],
): BudgetRow[] {
  const spent = new Map(categoryBreakdown(monthTxs).map((s) => [s.category, s.total]));
  const rows: BudgetRow[] = budgets.map((b) => {
    const actual = spent.get(b.category) ?? 0;
    spent.delete(b.category);
    const ratio = actual / b.budget;
    return {
      category: b.category,
      budget: b.budget,
      actual,
      remaining: b.budget - actual,
      ratio,
      status: ratio > 1 ? 'over' : ratio >= 0.8 ? 'warning' : 'ok',
    };
  });
  for (const [category, actual] of spent) {
    rows.push({
      category,
      budget: null,
      actual,
      remaining: null,
      ratio: null,
      status: 'unbudgeted',
    });
  }
  // อาหาร/เดินทาง ก่อน → หมวดที่ตั้งงบ → หมวดที่ไม่ได้ตั้งงบ; ภายในกลุ่มเรียงยอดจ่ายมาก→น้อย
  return sortByCategoryPriority(
    rows,
    (r) => r.category,
    (a, b) => Number(a.budget === null) - Number(b.budget === null) || b.actual - a.actual,
  );
}

/* -------------------------------- งบรายวัน ------------------------------- */

export interface DailyCapStatus {
  enabled: boolean;
  cap: number | null;
  /** รายจ่ายวันนี้ที่นับเพดาน (ไม่รวมหมวดที่ยกเว้น) */
  counted: number;
  excludedSpent: number;
  remaining: number | null;
  over: boolean;
  subPlans: { category: string; plan: number; spent: number; over: boolean }[];
}

export function dailyCapStatus(
  cap: UserSettings['dailyCap'],
  txs: readonly TxLike[],
  day: string,
): DailyCapStatus {
  const ex = new Set(cap.excludedCategories);
  const todays = txs.filter((t) => t.type === 'expense' && t.transactionDate === day);
  let counted = 0;
  let excludedSpent = 0;
  const byCat = new Map<string, number>();
  for (const t of todays) {
    const c = catName(t.category);
    byCat.set(c, (byCat.get(c) ?? 0) + t.amount);
    if (ex.has(c)) excludedSpent += t.amount;
    else counted += t.amount;
  }
  const limit = cap.enabled ? cap.amount : null;
  return {
    enabled: cap.enabled,
    cap: limit,
    counted,
    excludedSpent,
    remaining: limit === null ? null : limit - counted,
    over: limit !== null && counted > limit,
    subPlans: sortByCategoryPriority(
      cap.subPlans.map((p) => {
        const spent = byCat.get(p.category) ?? 0;
        return { category: p.category, plan: p.amount, spent, over: spent > p.amount };
      }),
      (p) => p.category,
    ),
  };
}

/* ------------------------------- MoneyBuddy ------------------------------ */

export interface Insight {
  id: string;
  tone: 'good' | 'info' | 'warning';
  text: string;
}

export interface Forecast {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  spentSoFar: number;
  incomeSoFar: number;
  avgDailyExpense: number;
  projectedExpense: number;
  /** ยอดคงเหลือทั้งหมดที่คาดว่าจะเหลือ ณ สิ้นเดือน */
  projectedBalance: number;
}

const WEEKDAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const baht = new Intl.NumberFormat('th-TH');

/**
 * คาดการณ์สิ้นเดือน: รายจ่ายที่ผ่านมา + (ค่าเฉลี่ยรายวัน × วันที่เหลือ)
 * ไม่นับรายรับในอนาคต (มองแบบระมัดระวัง)
 */
export function forecastMonth(input: {
  month: string;
  today: string;
  monthTxs: readonly TxLike[];
  balance: number;
}): Forecast {
  const days = daysOfMonth(input.month);
  const daysInMonth = days.length;
  const isCurrent = input.today.startsWith(input.month);
  const isPast = input.today > days[daysInMonth - 1]!;
  const daysElapsed = isPast ? daysInMonth : isCurrent ? Number(input.today.slice(8)) : 0;
  const inMonth = input.monthTxs.filter((t) => t.transactionDate.startsWith(input.month));
  const spentSoFar = inMonth.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const incomeSoFar = inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const avgDailyExpense = daysElapsed ? spentSoFar / daysElapsed : 0;
  const remainingDays = daysInMonth - daysElapsed;
  const futureSpend = avgDailyExpense * remainingDays;
  return {
    month: input.month,
    daysElapsed,
    daysInMonth,
    spentSoFar,
    incomeSoFar,
    avgDailyExpense,
    projectedExpense: Math.round(spentSoFar + futureSpend),
    projectedBalance: Math.round(input.balance - futureSpend),
  };
}

/** วิเคราะห์พฤติกรรมการใช้จ่ายเป็นข้อความสั้น ๆ ภาษาไทย */
export function spendingInsights(input: {
  monthTxs: readonly TxLike[];
  forecast: Forecast;
  settings: Pick<UserSettings, 'monthlySalary' | 'categoryBudgets'>;
}): Insight[] {
  const out: Insight[] = [];
  const expenses = input.monthTxs.filter((t) => t.type === 'expense');
  const { forecast: f, settings } = input;
  if (expenses.length === 0) {
    return [
      { id: 'empty', tone: 'info', text: 'ยังไม่มีรายจ่ายในเดือนนี้ ลองบันทึกรายการแรกดูนะ' },
    ];
  }

  const slices = categoryBreakdown(expenses);
  const top = [...slices].sort((a, b) => b.total - a.total)[0]!;
  out.push({
    id: 'top-category',
    tone: top.share > 0.5 ? 'warning' : 'info',
    text: `หมวดที่ใช้มากที่สุดคือ "${top.category}" ${Math.round(top.share * 100)}% ของรายจ่ายเดือนนี้`,
  });

  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const t of expenses)
    byWeekday[new Date(`${t.transactionDate}T00:00:00Z`).getUTCDay()]! += t.amount;
  const peak = byWeekday.indexOf(Math.max(...byWeekday));
  out.push({
    id: 'weekday',
    tone: 'info',
    text: `วัน${WEEKDAYS_TH[peak]}เป็นวันที่ใช้เงินมากที่สุด`,
  });

  if (f.daysElapsed > 0) {
    out.push({
      id: 'avg-daily',
      tone: 'info',
      text: `เฉลี่ยใช้วันละ ${baht.format(Math.round(f.avgDailyExpense))} บาท คาดว่าทั้งเดือนจะใช้ราว ${baht.format(f.projectedExpense)} บาท`,
    });
  }

  const salaryRatio = f.projectedExpense / settings.monthlySalary;
  if (salaryRatio > 1) {
    out.push({
      id: 'over-salary',
      tone: 'warning',
      text: `ถ้าใช้ในอัตรานี้ รายจ่ายจะเกินเงินเดือน ${Math.round((salaryRatio - 1) * 100)}%`,
    });
  } else {
    out.push({
      id: 'salary-share',
      tone: salaryRatio <= 0.7 ? 'good' : 'info',
      text: `คาดว่าจะใช้ ${Math.round(salaryRatio * 100)}% ของเงินเดือน${salaryRatio <= 0.7 ? ' เก็บออมได้ดี!' : ''}`,
    });
  }

  const over = budgetVsActual(settings.categoryBudgets, expenses).filter(
    (r) => r.status === 'over',
  );
  if (over.length) {
    out.push({
      id: 'over-budget',
      tone: 'warning',
      text: `เกินงบแล้ว: ${over.map((r) => r.category).join(', ')}`,
    });
  }

  if (f.projectedBalance < 0) {
    out.push({
      id: 'negative-forecast',
      tone: 'warning',
      text: `ระวัง! คาดว่าสิ้นเดือนยอดคงเหลือจะติดลบ ${baht.format(Math.abs(f.projectedBalance))} บาท`,
    });
  }
  return out;
}
