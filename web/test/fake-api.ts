import type {
  Transaction,
  TransactionCreateInput,
  TransactionUpdateInput,
} from '@money-flow/shared';
import { ApiClientError } from '../src/api/client';
import type { Endpoints } from '../src/api/endpoints';

let seq = 0;
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const fakeId = () => {
  seq++;
  let s = '';
  let n = seq;
  for (let i = 0; i < 26; i++) {
    s = ULID_CHARS[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
};

export function makeTx(over: Partial<Transaction> = {}): Transaction {
  const now = '2026-10-06T05:00:00.000Z';
  return {
    id: fakeId(),
    description: 'ข้าวมันไก่',
    amount: 50,
    type: 'expense',
    category: 'อาหาร',
    transactionDate: '2026-10-06',
    clientTimezone: 'Asia/Bangkok',
    idempotencyKey: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...over,
  };
}

/**
 * Fake API ในหน่วยความจำ — จำลองพฤติกรรม server (idempotency, soft delete, summary)
 * ใช้ทดสอบ store/component โดยไม่ต้องมี network
 */
export function createFakeApi() {
  const db = new Map<string, Transaction>();
  const byKey = new Map<string, string>();
  let failNext: ApiClientError | null = null;
  const calls: string[] = [];

  const take = () => {
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
  };
  const live = () => [...db.values()].filter((t) => !t.deletedAt);
  const sum = (list: Transaction[], type: string) =>
    list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);

  const api: Endpoints = {
    async listTransactions(q) {
      calls.push('list');
      take();
      const items = live()
        .filter(
          (t) => (!q.from || t.transactionDate >= q.from) && (!q.to || t.transactionDate <= q.to),
        )
        .sort(
          (a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id.localeCompare(a.id),
        );
      const start = q.cursor ? Number(q.cursor) : 0;
      const limit = q.limit ?? 50;
      const page = items.slice(start, start + limit);
      return {
        items: page,
        nextCursor: start + limit < items.length ? String(start + limit) : null,
      };
    },
    async createTransaction(input: TransactionCreateInput) {
      calls.push('create');
      take();
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return db.get(existing)!;
      const t = makeTx({
        description: input.description.trim(),
        amount: input.amount,
        type: input.type,
        category: input.category ?? null,
        transactionDate: input.transactionDate,
        idempotencyKey: input.idempotencyKey,
      });
      db.set(t.id, t);
      byKey.set(input.idempotencyKey, t.id);
      return t;
    },
    async updateTransaction(id: string, patch: TransactionUpdateInput) {
      calls.push('update');
      take();
      const t = db.get(id);
      if (!t || t.deletedAt) throw new ApiClientError('NOT_FOUND', 'ไม่พบรายการนี้', 404);
      const next = {
        ...t,
        ...patch,
        category: patch.category === undefined ? t.category : (patch.category ?? null),
      } as Transaction;
      db.set(id, next);
      return next;
    },
    async deleteTransaction(id) {
      calls.push('delete');
      take();
      const t = db.get(id);
      if (!t || t.deletedAt) throw new ApiClientError('NOT_FOUND', 'ไม่พบรายการนี้', 404);
      const next = { ...t, deletedAt: '2026-10-06T06:00:00.000Z' };
      db.set(id, next);
      return next;
    },
    async restoreTransaction(id) {
      calls.push('restore');
      take();
      const t = db.get(id)!;
      const next = { ...t, deletedAt: null };
      db.set(id, next);
      return next;
    },
    async bulkDelete(ids) {
      calls.push('bulkDelete');
      take();
      const deleted: string[] = [];
      const notFound: string[] = [];
      for (const id of ids) {
        const t = db.get(id);
        if (!t || t.deletedAt) notFound.push(id);
        else {
          db.set(id, { ...t, deletedAt: '2026-10-06T06:00:00.000Z' });
          deleted.push(id);
        }
      }
      return { deleted, notFound };
    },
    async balance() {
      calls.push('balance');
      take();
      const l = live();
      const income = sum(l, 'income');
      const expense = sum(l, 'expense');
      return { income, expense, balance: income - expense, transactionCount: l.length };
    },
    async monthly(month) {
      calls.push('monthly');
      take();
      const l = live().filter((t) => t.transactionDate.startsWith(month));
      const income = sum(l, 'income');
      const expense = sum(l, 'expense');
      return {
        month,
        income,
        expense,
        balance: income - expense,
        transactionCount: l.length,
        byCategory: [],
      };
    },
    async getSettings() {
      throw new Error('not used');
    },
    async putSettings() {
      throw new Error('not used');
    },
    async listAchievements() {
      return [];
    },
    async addAchievement(badgeId: string) {
      return { badgeId, earnedAt: '2026-10-06T05:00:00.000Z' };
    },
    async exportData() {
      return '';
    },
    async deleteAccount() {
      return undefined;
    },
  };

  return {
    api,
    db,
    calls,
    failOnce(err: ApiClientError) {
      failNext = err;
    },
  };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
