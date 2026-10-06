import type { TransactionCreateInput } from '@money-flow/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import { createOutbox } from '../src/offline/outbox';
import { createMoneyStore } from '../src/stores/money';
import { createFakeApi, flush, makeTx } from './fake-api';

const OWNER = 'user-a';
let dbn = 0;

const input = (over: Partial<TransactionCreateInput> = {}): TransactionCreateInput => ({
  description: 'กาแฟ',
  amount: 60,
  type: 'expense',
  category: 'อาหาร',
  transactionDate: '2026-10-06',
  idempotencyKey: crypto.randomUUID(),
  ...over,
});

function setup() {
  const fake = createFakeApi();
  const outbox = createOutbox(`test-${++dbn}`);
  let online = true;
  const store = createMoneyStore({
    api: fake.api,
    outbox,
    owner: OWNER,
    isOnline: () => online,
  });
  return {
    fake,
    outbox,
    store,
    goOffline: () => {
      online = false;
      store.setOnline(false);
    },
    goOnline: () => {
      online = true;
      store.setOnline(true);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
});

describe('outbox (IndexedDB)', () => {
  it('เก็บแยกตาม owner และเรียงตามเวลา', async () => {
    const box = createOutbox(`test-${++dbn}`);
    await box.add('a', input({ description: '1' }));
    await box.add('b', input({ description: 'ของ b' }));
    await box.add('a', input({ description: '2' }));
    expect((await box.list('a')).map((e) => e.input.description)).toEqual(['1', '2']);
    expect(await box.list('b')).toHaveLength(1);
  });

  it('flush: สำเร็จ→ลบออก, validation error→failed, network error→หยุดไว้ลองใหม่', async () => {
    const box = createOutbox(`test-${++dbn}`);
    const ok = input({ description: 'ok' });
    const bad = input({ description: 'bad' });
    const later = input({ description: 'later' });
    const afterNet = input({ description: 'after' });
    for (const i of [ok, bad, later, afterNet]) await box.add(OWNER, i);

    const send = vi.fn(async (i: TransactionCreateInput) => {
      if (i === bad || i.description === 'bad') {
        throw new ApiClientError('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', 400);
      }
      if (i.description === 'later') throw new ApiClientError('NETWORK', 'net');
      return makeTx({ description: i.description });
    });
    const res = await box.flush(OWNER, send);
    expect(res.synced.map((t) => t.description)).toEqual(['ok']);
    expect(res.failed.map((e) => e.input.description)).toEqual(['bad']);
    expect(res.remaining).toBe(2); // later + after ยังรอ
    expect(send).toHaveBeenCalledTimes(3); // หยุดที่ network error ไม่ส่ง 'after'
    const left = await box.list(OWNER);
    expect(left.find((e) => e.input.description === 'bad')?.status).toBe('failed');
  });

  it('flush พร้อมกัน 2 ครั้ง → ส่งแค่ชุดเดียว (single-flight)', async () => {
    const box = createOutbox(`test-${++dbn}`);
    await box.add(OWNER, input());
    const send = vi.fn(async () => makeTx());
    const [a, b] = await Promise.all([box.flush(OWNER, send), box.flush(OWNER, send)]);
    expect(a).toBe(b);
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('money store', () => {
  it('loadMonth: โหลดรายการ + balance + monthly พร้อมกัน', async () => {
    const { fake, store } = setup();
    await fake.api.createTransaction(input({ amount: 100 }));
    await fake.api.createTransaction(input({ amount: 7, transactionDate: '2026-09-30' }));
    await store.loadMonth('2026-10');
    expect(store.state.items).toHaveLength(1);
    expect(store.state.balance?.expense).toBe(107);
    expect(store.state.monthly?.expense).toBe(100);
    expect(store.state.loadingList).toBe(false);
  });

  it('loadMore ต่อ cursor ไม่ซ้ำ', async () => {
    const { fake, store } = setup();
    for (let i = 0; i < 120; i++) await fake.api.createTransaction(input({ amount: i + 1 }));
    await store.loadMonth('2026-10');
    expect(store.state.items).toHaveLength(50);
    await store.loadMore();
    await store.loadMore();
    expect(store.state.items).toHaveLength(120);
    expect(new Set(store.state.items.map((t) => t.id)).size).toBe(120);
    expect(store.state.nextCursor).toBeNull();
  });

  it('add ออนไลน์ → บันทึกและอัปเดตยอด', async () => {
    const { store } = setup();
    await store.loadMonth('2026-10');
    const r = await store.add(input({ amount: 40 }));
    expect(r.status).toBe('saved');
    expect(store.state.items).toHaveLength(1);
    await flush();
    expect(store.state.balance?.expense).toBe(40);
  });

  it('add ออฟไลน์ → เข้า outbox, กลับมาออนไลน์ sync โดย idempotencyKey ไม่ซ้ำ', async () => {
    const { fake, store, goOffline, goOnline } = setup();
    await store.loadMonth('2026-10');
    goOffline();
    const i = input({ amount: 25 });
    expect((await store.add(i)).status).toBe('queued');
    expect(store.state.pending).toHaveLength(1);
    expect(fake.calls).not.toContain('create');

    goOnline();
    // จำลอง: request แรกไปถึง server แล้วแต่ response หาย → ส่งซ้ำด้วย key เดิม
    await fake.api.createTransaction(i);
    const res = await store.sync();
    expect(res.synced).toBe(1);
    expect(store.state.pending).toHaveLength(0);
    expect([...fake.db.values()]).toHaveLength(1); // ไม่บันทึกซ้ำ
  });

  it('add ออนไลน์แต่ network ล่ม → เข้า outbox แทนการทิ้งข้อมูล', async () => {
    const { fake, store } = setup();
    await store.loadMonth('2026-10');
    fake.failOnce(new ApiClientError('NETWORK', 'net'));
    expect((await store.add(input())).status).toBe('queued');
    expect(store.state.pending).toHaveLength(1);
  });

  it('add validation error จาก server → throw (ไม่เข้า outbox)', async () => {
    const { fake, store } = setup();
    fake.failOnce(new ApiClientError('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', 400));
    await expect(store.add(input())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(store.state.pending).toHaveLength(0);
  });

  it('แก้/ลบขณะออฟไลน์ → ปฏิเสธโดยไม่เรียก API', async () => {
    const { fake, store, goOffline } = setup();
    const t = await fake.api.createTransaction(input());
    goOffline();
    fake.calls.length = 0;
    await expect(store.update(t.id, { amount: 1 })).rejects.toMatchObject({ code: 'OFFLINE' });
    await expect(store.remove(t.id)).rejects.toMatchObject({ code: 'OFFLINE' });
    await expect(store.bulkRemove([t.id])).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(fake.calls).toEqual([]);
  });

  it('remove → undo กู้คืนรายการและยอด', async () => {
    const { fake, store } = setup();
    const t = await fake.api.createTransaction(input({ amount: 70 }));
    await store.loadMonth('2026-10');
    const undo = await store.remove(t.id);
    expect(store.state.items).toHaveLength(0);
    await flush();
    expect(store.state.balance?.expense).toBe(0);
    await undo();
    await flush();
    expect(store.state.items.map((x) => x.id)).toEqual([t.id]);
    expect(store.state.balance?.expense).toBe(70);
  });

  it('bulkRemove → undo กู้คืนทั้งหมด', async () => {
    const { fake, store } = setup();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await fake.api.createTransaction(input())).id);
    await store.loadMonth('2026-10');
    const { deleted, undo } = await store.bulkRemove(ids);
    expect(deleted).toHaveLength(3);
    expect(store.state.items).toHaveLength(0);
    await undo();
    expect(store.state.items).toHaveLength(3);
  });

  it('update ย้ายวันออกนอกเดือน → หายจากรายการเดือนนี้', async () => {
    const { fake, store } = setup();
    const t = await fake.api.createTransaction(input());
    await store.loadMonth('2026-10');
    await store.update(t.id, { transactionDate: '2026-09-01' });
    expect(store.state.items).toHaveLength(0);
  });

  it('เปลี่ยนเดือนเร็ว ๆ → response เก่าไม่ทับเดือนใหม่', async () => {
    const { fake, store } = setup();
    await fake.api.createTransaction(input({ transactionDate: '2026-09-10' }));
    const p1 = store.loadMonth('2026-09');
    const p2 = store.loadMonth('2026-10');
    await Promise.all([p1, p2]);
    expect(store.state.month).toBe('2026-10');
    expect(store.state.items).toHaveLength(0);
  });
});
