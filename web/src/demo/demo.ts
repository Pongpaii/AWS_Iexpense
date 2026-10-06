import {
  defaultSettings,
  sortByCategoryPriority,
  type Transaction,
  type UserAchievement,
  type UserSettings,
} from '@money-flow/shared';
import { ApiClientError } from '../api/client';
import type { Endpoints } from '../api/endpoints';
import { addDays } from '../lib/analytics';
import { todayLocal } from '../lib/date';
import { DEMO_READ_ONLY } from './messages';

/**
 * Demo mode: ข้อมูลตัวอย่างในหน่วยความจำ อ่านอย่างเดียว ไม่เรียก API ใด ๆ
 * สุ่มแบบ deterministic (seed คงที่) เพื่อให้ทุกครั้งเห็นข้อมูลเหมือนกัน
 */

const readOnly = (): never => {
  throw new ApiClientError('FORBIDDEN', DEMO_READ_ONLY, 403);
};

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const ID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function demoId(n: number): string {
  let s = '';
  for (let i = 0; i < 26; i++) {
    s = ID_CHARS[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

const DAILY: [string, string, number, number][] = [
  // [หมวด, รายละเอียด, ต่ำสุด, สูงสุด]
  ['อาหาร', 'ข้าวกลางวัน', 45, 90],
  ['อาหาร', 'กาแฟ', 40, 75],
  ['อาหาร', 'ข้าวเย็น', 60, 150],
  ['เดินทาง', 'รถไฟฟ้า', 30, 60],
  ['เดินทาง', 'วินมอเตอร์ไซค์', 20, 40],
];
const OCCASIONAL: [string, string, number, number][] = [
  ['ช้อปปิ้ง', 'ของใช้ในบ้าน', 150, 600],
  ['บันเทิง', 'ดูหนัง', 180, 320],
  ['สุขภาพ', 'ร้านยา', 80, 300],
  ['อาหาร', 'ชาไข่มุก', 55, 85],
  ['บิล/สาธารณูปโภค', 'ค่าโทรศัพท์', 399, 399],
];

export function generateDemoTransactions(today: string = todayLocal()): Transaction[] {
  const rand = rng(20261006);
  const out: Transaction[] = [];
  let n = 1;
  const push = (
    date: string,
    description: string,
    amount: number,
    type: 'income' | 'expense',
    category: string,
  ) => {
    const ts = `${date}T05:00:00.000Z`;
    out.push({
      id: demoId(n++),
      description,
      amount,
      type,
      category,
      transactionDate: date,
      clientTimezone: 'Asia/Bangkok',
      idempotencyKey: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    });
  };

  for (let back = 75; back >= 0; back--) {
    const date = addDays(today, -back);
    const day = Number(date.slice(8));
    if (day === 1) {
      push(date, 'เงินเดือน', 17000, 'income', 'เงินเดือน');
      push(date, 'ค่าห้อง', 5500, 'expense', 'ที่พัก');
    }
    if (day === 15 && rand() > 0.3) push(date, 'งานฟรีแลนซ์', 2500, 'income', 'รายได้เสริม');
    if (rand() < 0.08) continue; // บางวันไม่ได้บันทึก (ให้ streak สมจริง)
    for (const [cat, desc, min, max] of DAILY) {
      if (rand() < 0.75) push(date, desc, Math.round(min + rand() * (max - min)), 'expense', cat);
    }
    if (rand() < 0.25) {
      const [cat, desc, min, max] = OCCASIONAL[Math.floor(rand() * OCCASIONAL.length)]!;
      push(date, desc, Math.round(min + rand() * (max - min)), 'expense', cat);
    }
  }
  return out.sort(
    (a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id.localeCompare(a.id),
  );
}

export function demoSettings(): UserSettings {
  return {
    ...defaultSettings(),
    dailyCap: {
      enabled: true,
      amount: 400,
      subPlans: [
        { category: 'อาหาร', amount: 250 },
        { category: 'เดินทาง', amount: 100 },
      ],
      excludedCategories: ['ที่พัก', 'บิล/สาธารณูปโภค'],
    },
    categoryBudgets: [
      { category: 'อาหาร', budget: 6000 },
      { category: 'เดินทาง', budget: 2000 },
      { category: 'ช้อปปิ้ง', budget: 1500 },
      { category: 'บันเทิง', budget: 800 },
    ],
    heatmapExcludedCategories: ['ที่พัก'],
  };
}

/** Endpoints แบบ in-memory — อ่านได้ทุกอย่าง เขียนไม่ได้ */
export function createDemoEndpoints(today: string = todayLocal()): Endpoints {
  const txs = generateDemoTransactions(today);
  const settings = demoSettings();
  const achievements: UserAchievement[] = [
    { badgeId: 'first-tx', earnedAt: `${addDays(today, -75)}T05:00:00.000Z` },
    { badgeId: 'tx-10', earnedAt: `${addDays(today, -72)}T05:00:00.000Z` },
  ];
  const sum = (list: Transaction[], type: string) =>
    list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);

  return {
    async listTransactions(q) {
      const items = txs.filter(
        (t) => (!q.from || t.transactionDate >= q.from) && (!q.to || t.transactionDate <= q.to),
      );
      const start = q.cursor ? Number(q.cursor) : 0;
      const limit = q.limit ?? 50;
      return {
        items: items.slice(start, start + limit),
        nextCursor: start + limit < items.length ? String(start + limit) : null,
      };
    },
    async balance() {
      const income = sum(txs, 'income');
      const expense = sum(txs, 'expense');
      return { income, expense, balance: income - expense, transactionCount: txs.length };
    },
    async monthly(month) {
      const list = txs.filter((t) => t.transactionDate.startsWith(month));
      const map = new Map<
        string,
        { category: string | null; type: 'income' | 'expense'; total: number; count: number }
      >();
      for (const t of list) {
        const k = `${t.type}|${t.category}`;
        const v = map.get(k) ?? { category: t.category, type: t.type, total: 0, count: 0 };
        v.total += t.amount;
        v.count++;
        map.set(k, v);
      }
      const income = sum(list, 'income');
      const expense = sum(list, 'expense');
      return {
        month,
        income,
        expense,
        balance: income - expense,
        transactionCount: list.length,
        byCategory: sortByCategoryPriority([...map.values()], (c) => c.category),
      };
    },
    getSettings: async () => structuredClone(settings),
    listAchievements: async () => structuredClone(achievements),
    exportData: async () => readOnly(),
    createTransaction: async () => readOnly(),
    updateTransaction: async () => readOnly(),
    deleteTransaction: async () => readOnly(),
    restoreTransaction: async () => readOnly(),
    bulkDelete: async () => readOnly(),
    putSettings: async () => readOnly(),
    addAchievement: async () => readOnly(),
    deleteAccount: async () => readOnly(),
  };
}
