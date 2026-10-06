import type {
  Balance,
  MonthlySummary,
  Transaction,
  TransactionCreateInput,
  TransactionUpdateInput,
} from '@money-flow/shared';
import { reactive, readonly } from 'vue';
import { ApiClientError } from '../api/client';
import type { Endpoints } from '../api/endpoints';
import { currentMonth, monthRange } from '../lib/date';
import { DEMO_READ_ONLY } from '../demo/messages';
import type { Outbox, OutboxEntry } from '../offline/outbox';

export const PAGE_SIZE = 50;

export interface MoneyState {
  month: string;
  items: Transaction[];
  nextCursor: string | null;
  pending: OutboxEntry[];
  balance: Balance | null;
  monthly: MonthlySummary | null;
  loadingList: boolean;
  loadingMore: boolean;
  loadingSummary: boolean;
  syncing: boolean;
  online: boolean;
  error: string | null;
}

export type AddResult = { status: 'saved'; transaction: Transaction } | { status: 'queued' };

const byNewest = (a: Transaction, b: Transaction) =>
  b.transactionDate.localeCompare(a.transactionDate) || b.id.localeCompare(a.id);

/**
 * state + action ของข้อมูลการเงิน — แยกจาก UI เพื่อทดสอบได้ง่าย
 * แก้/ลบได้เฉพาะตอนออนไลน์; เพิ่มรายการตอนออฟไลน์จะเข้า outbox แล้ว sync อัตโนมัติ
 */
export function createMoneyStore(deps: {
  api: Endpoints;
  outbox: Outbox;
  owner: string;
  isOnline?: () => boolean;
  /** demo mode: อ่านอย่างเดียว ไม่มี outbox */
  readOnly?: boolean;
}) {
  const state = reactive<MoneyState>({
    month: currentMonth(),
    items: [],
    nextCursor: null,
    pending: [],
    balance: null,
    monthly: null,
    loadingList: false,
    loadingMore: false,
    loadingSummary: false,
    syncing: false,
    online: deps.isOnline?.() ?? navigator.onLine,
    error: null,
  });

  // กัน response ของเดือนเก่ามาทับเมื่อผู้ใช้เปลี่ยนเดือนเร็ว ๆ
  let loadToken = 0;

  const inMonth = (t: { transactionDate: string }) => t.transactionDate.startsWith(state.month);

  function requireWritable(): void {
    if (deps.readOnly) throw new ApiClientError('FORBIDDEN', DEMO_READ_ONLY, 403);
  }

  function requireOnline(): void {
    requireWritable();
    if (!state.online) {
      throw new ApiClientError('OFFLINE', 'แก้ไขหรือลบรายการได้เฉพาะตอนออนไลน์');
    }
  }

  async function refreshPending() {
    if (deps.readOnly) return;
    state.pending = await deps.outbox.list(deps.owner);
  }

  async function refreshSummary() {
    if (!state.online) return;
    state.loadingSummary = state.balance === null;
    try {
      const [balance, monthly] = await Promise.all([
        deps.api.balance(),
        deps.api.monthly(state.month),
      ]);
      state.balance = balance;
      state.monthly = monthly;
    } finally {
      state.loadingSummary = false;
    }
  }

  async function loadMonth(month: string = state.month) {
    const token = ++loadToken;
    state.month = month;
    state.items = [];
    state.nextCursor = null;
    state.monthly = null;
    state.error = null;
    await refreshPending();
    if (!state.online) return;

    state.loadingList = true;
    state.loadingSummary = true;
    try {
      const [page, balance, monthly] = await Promise.all([
        deps.api.listTransactions({ ...monthRange(month), limit: PAGE_SIZE }),
        deps.api.balance(),
        deps.api.monthly(month),
      ]);
      if (token !== loadToken) return;
      state.items = page.items;
      state.nextCursor = page.nextCursor;
      state.balance = balance;
      state.monthly = monthly;
    } catch (err) {
      if (token === loadToken) state.error = errorText(err);
      throw err;
    } finally {
      if (token === loadToken) {
        state.loadingList = false;
        state.loadingSummary = false;
      }
    }
  }

  async function loadMore() {
    if (!state.nextCursor || state.loadingMore || !state.online) return;
    const token = loadToken;
    state.loadingMore = true;
    try {
      const page = await deps.api.listTransactions({
        ...monthRange(state.month),
        cursor: state.nextCursor,
        limit: PAGE_SIZE,
      });
      if (token !== loadToken) return;
      const known = new Set(state.items.map((t) => t.id));
      state.items.push(...page.items.filter((t) => !known.has(t.id)));
      state.nextCursor = page.nextCursor;
    } finally {
      state.loadingMore = false;
    }
  }

  function upsert(t: Transaction) {
    const i = state.items.findIndex((x) => x.id === t.id);
    const keep = inMonth(t) && t.deletedAt === null;
    if (i !== -1 && !keep) state.items.splice(i, 1);
    else if (i !== -1) state.items[i] = t;
    else if (keep) state.items.push(t);
    state.items.sort(byNewest);
  }

  /** เพิ่มรายการ: ออนไลน์ → ส่งทันที; ออฟไลน์/เครือข่ายล่ม → เก็บลง outbox */
  async function add(input: TransactionCreateInput): Promise<AddResult> {
    requireWritable();
    if (state.online) {
      try {
        const transaction = await deps.api.createTransaction(input);
        upsert(transaction);
        void refreshSummary();
        return { status: 'saved', transaction };
      } catch (err) {
        if (!(err instanceof ApiClientError && err.transient)) throw err;
      }
    }
    await deps.outbox.add(deps.owner, input);
    await refreshPending();
    return { status: 'queued' };
  }

  async function update(id: string, patch: TransactionUpdateInput): Promise<Transaction> {
    requireOnline();
    const t = await deps.api.updateTransaction(id, patch);
    upsert(t);
    void refreshSummary();
    return t;
  }

  /** ลบ (soft delete) แล้วคืนฟังก์ชัน undo */
  async function remove(id: string): Promise<() => Promise<void>> {
    requireOnline();
    const t = await deps.api.deleteTransaction(id);
    upsert(t);
    void refreshSummary();
    return async () => {
      requireOnline();
      upsert(await deps.api.restoreTransaction(id));
      void refreshSummary();
    };
  }

  async function bulkRemove(
    ids: string[],
  ): Promise<{ deleted: string[]; undo: () => Promise<void> }> {
    requireOnline();
    const { deleted } = await deps.api.bulkDelete(ids);
    const gone = new Set(deleted);
    state.items = state.items.filter((t) => !gone.has(t.id));
    void refreshSummary();
    return {
      deleted,
      undo: async () => {
        requireOnline();
        // ไม่มี bulk-restore endpoint → กู้คืนทีละรายการ (ครั้งละไม่เกิน 100)
        const restored = await Promise.all(deleted.map((id) => deps.api.restoreTransaction(id)));
        restored.forEach(upsert);
        void refreshSummary();
      },
    };
  }

  /** ส่งรายการค้างใน outbox (เรียกเมื่อกลับมาออนไลน์ / เปิดแอป / กดซิงก์) */
  async function sync(): Promise<{ synced: number; failed: number }> {
    if (!state.online || deps.readOnly) return { synced: 0, failed: 0 };
    state.syncing = true;
    try {
      const res = await deps.outbox.flush(deps.owner, (input) => deps.api.createTransaction(input));
      res.synced.forEach(upsert);
      await refreshPending();
      if (res.synced.length > 0) await refreshSummary();
      return { synced: res.synced.length, failed: res.failed.length };
    } finally {
      state.syncing = false;
    }
  }

  async function discardPending(key: string) {
    await deps.outbox.remove(key);
    await refreshPending();
  }

  /** ดึงทุกรายการในช่วงวันที่ (สำหรับหน้าวิเคราะห์) — ไม่เก็บลง state */
  async function fetchRange(from: string, to: string, max = 3000): Promise<Transaction[]> {
    const out: Transaction[] = [];
    let cursor: string | undefined;
    do {
      const page = await deps.api.listTransactions({ from, to, cursor, limit: 100 });
      out.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && out.length < max);
    return out;
  }

  function setOnline(online: boolean) {
    state.online = online;
  }

  return {
    state: readonly(state) as Readonly<MoneyState>,
    loadMonth,
    loadMore,
    refreshSummary,
    add,
    update,
    remove,
    bulkRemove,
    sync,
    discardPending,
    setOnline,
    fetchRange,
    readOnly: !!deps.readOnly,
  };
}

export type MoneyStore = ReturnType<typeof createMoneyStore>;

function errorText(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'โหลดข้อมูลไม่สำเร็จ';
}
