import type { Balance, MonthlySummary, Transaction, TransactionPage } from '@money-flow/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handlers/api';
import { FakeDynamo } from './support/fake-dynamo';
import { USER_A, USER_B, makeCaller, txBody } from './support/helpers';

const call = makeCaller(handler);
let db: FakeDynamo;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T05:00:00Z'));
  db = new FakeDynamo();
});
afterEach(() => {
  db.restore();
  vi.useRealTimers();
});

async function create(overrides: Record<string, unknown> = {}, sub = USER_A) {
  const res = await call<Transaction>('POST /transactions', { sub, body: txBody(overrides) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
const balance = async (sub = USER_A) => (await call<Balance>('GET /summary/balance', { sub })).body;
const monthly = async (month: string, sub = USER_A) =>
  (await call<MonthlySummary>('GET /summary/monthly', { sub, query: { month } })).body;

/** คำนวณยอดใหม่จาก TX items ทั้งหมด แล้วเทียบกับ summary items ที่อัปเดตแบบ atomic */
function expectSummariesConsistent(sub: string) {
  const items = db.partition(`USER#${sub}`);
  const live = items.filter((i) => i.SK.startsWith('TX#') && !i.deletedAt);
  const expected = new Map<string, Record<string, number>>();
  const bump = (sk: string, k: string, v: number) => {
    const m = expected.get(sk) ?? {};
    m[k] = (m[k] ?? 0) + v;
    expected.set(sk, m);
  };
  for (const t of live) {
    const month = `SUM#${String(t.transactionDate).slice(0, 7)}`;
    for (const sk of [month, 'SUM#ALL']) {
      bump(sk, String(t.type), t.amount as number);
      bump(sk, 'count', 1);
    }
    bump(month, `cat|${t.type}|${t.category ?? ''}`, t.amount as number);
    bump(month, `cnt|${t.type}|${t.category ?? ''}`, 1);
  }
  for (const s of items.filter((i) => i.SK.startsWith('SUM#'))) {
    const { PK: _p, SK, ...attrs } = s;
    const nonZero = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== 0));
    expect(nonZero, SK).toEqual(expected.get(SK) ?? {});
    expected.delete(SK);
  }
  expect([...expected.keys()]).toEqual([]);
}

describe('POST /transactions', () => {
  it('สร้างรายการ: 201, amount เป็นบาทจำนวนเต็ม, field ของ server ถูกเติม', async () => {
    const tx = await create({ amount: 1234 });
    expect(tx).toMatchObject({
      description: 'ข้าวมันไก่',
      amount: 1234,
      type: 'expense',
      category: 'อาหาร',
      transactionDate: '2026-10-01',
      deletedAt: null,
      createdAt: '2026-10-06T05:00:00.000Z',
    });
    expect(tx.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const stored = db.partition(`USER#${USER_A}`).find((i) => i.SK.startsWith('TX#'));
    expect(stored?.SK).toBe(`TX#2026-10-01#${tx.id}`);
    expect(stored?.amount).toBe(1234);
  });

  it('ไม่รับ userId จาก body (strict) และใช้ sub จาก JWT เท่านั้น', async () => {
    const res = await call('POST /transactions', { body: { ...txBody(), userId: USER_B } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.partition(`USER#${USER_B}`)).toEqual([]);
  });

  it('validation error ตอบ {code,message} ภาษาไทย', async () => {
    const res = await call('POST /transactions', { body: txBody({ amount: 10.5 }) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'จำนวนเงินต้องเป็นจำนวนเต็ม (ไม่มีทศนิยม)',
    });
  });
});

describe('idempotency', () => {
  it('ส่งซ้ำด้วย key + ข้อมูลเดิม → 200 รายการเดิม, บันทึกครั้งเดียว, ยอดไม่ซ้ำ', async () => {
    const body = txBody({ amount: 100 });
    const first = await call<Transaction>('POST /transactions', { body });
    const second = await call<Transaction>('POST /transactions', { body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(db.partition(`USER#${USER_A}`).filter((i) => i.SK.startsWith('TX#'))).toHaveLength(1);
    expect(await balance()).toEqual({
      income: 0,
      expense: 100,
      balance: -100,
      transactionCount: 1,
    });
  });

  it('key ตัวพิมพ์ใหญ่/เล็กต่างกันถือเป็น key เดียวกัน', async () => {
    const body = txBody();
    await call('POST /transactions', { body });
    const again = await call('POST /transactions', {
      body: { ...body, idempotencyKey: body.idempotencyKey.toUpperCase() },
    });
    expect(again.status).toBe(200);
  });

  it('key เดิมแต่ข้อมูลต่าง → 409 IDEMPOTENCY_CONFLICT', async () => {
    const body = txBody();
    await call('POST /transactions', { body });
    const res = await call('POST /transactions', { body: { ...body, amount: 999 } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await balance()).expense).toBe(50);
  });

  it('key เดียวกันคนละ user ไม่ชนกัน', async () => {
    const body = txBody();
    expect((await call('POST /transactions', { body, sub: USER_A })).status).toBe(201);
    expect((await call('POST /transactions', { body, sub: USER_B })).status).toBe(201);
  });

  it('replay หลังลบแล้วยังคืนรายการเดิม (ไม่สร้างใหม่)', async () => {
    const body = txBody();
    const first = await call<Transaction>('POST /transactions', { body });
    await call('DELETE /transactions/{id}', { id: first.body.id });
    const again = await call<Transaction>('POST /transactions', { body });
    expect(again.status).toBe(200);
    expect(again.body.deletedAt).not.toBeNull();
    expect((await balance()).transactionCount).toBe(0);
  });
});

describe('GET /transactions', () => {
  it('ใหม่สุดก่อน, ไม่รวมรายการที่ลบ, แบ่งหน้าด้วย cursor ครบทุกรายการไม่ซ้ำ', async () => {
    const dates = ['2026-09-01', '2026-09-15', '2026-10-01', '2026-10-02', '2026-10-03'];
    const created = [];
    for (const d of dates) created.push(await create({ transactionDate: d }));
    await call('DELETE /transactions/{id}', { id: created[3]!.id });

    const seen: Transaction[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await call<TransactionPage>('GET /transactions', {
        query: { limit: '2', ...(cursor ? { cursor } : {}) },
      });
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);

    expect(seen.map((t) => t.transactionDate)).toEqual([
      '2026-10-03',
      '2026-10-01',
      '2026-09-15',
      '2026-09-01',
    ]);
  });

  it('กรองด้วย from/to (รวมวันขอบ)', async () => {
    for (const d of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
      await create({ transactionDate: d });
    }
    const res = await call<TransactionPage>('GET /transactions', {
      query: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(res.body.items.map((t) => t.transactionDate)).toEqual(['2026-10-31', '2026-10-01']);
    expect(res.body.nextCursor).toBeNull();
  });

  it('cursor ปลอม/ผิดรูปแบบ → 400', async () => {
    const fake = Buffer.from(`SETTINGS`).toString('base64url');
    const res = await call('GET /transactions', { query: { cursor: fake } });
    expect(res.status).toBe(400);
  });

  it('cursor ของ user A ใช้กับ user B ได้แค่ข้อมูลของ B', async () => {
    await create({ transactionDate: '2026-10-01' });
    await create({ transactionDate: '2026-10-02' });
    const a = await call<TransactionPage>('GET /transactions', { query: { limit: '1' } });
    const b = await call<TransactionPage>('GET /transactions', {
      sub: USER_B,
      query: { cursor: a.body.nextCursor! },
    });
    expect(b.status).toBe(200);
    expect(b.body.items).toEqual([]);
  });
});

describe('PATCH /transactions/{id}', () => {
  it('แก้จำนวนเงิน/ประเภท → ยอดสรุปถูกต้อง', async () => {
    const tx = await create({ amount: 100 });
    const res = await call<Transaction>('PATCH /transactions/{id}', {
      id: tx.id,
      body: { amount: 300, type: 'income', category: 'รายได้เสริม' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 300, type: 'income', category: 'รายได้เสริม' });
    expect(await balance()).toEqual({ income: 300, expense: 0, balance: 300, transactionCount: 1 });
    expectSummariesConsistent(USER_A);
  });

  it('ย้ายวันข้ามเดือน → ย้าย SK, pointer และยอดรายเดือนทั้งสองเดือน', async () => {
    const tx = await create({ amount: 80, transactionDate: '2026-09-30' });
    const res = await call<Transaction>('PATCH /transactions/{id}', {
      id: tx.id,
      body: { transactionDate: '2026-10-01' },
    });
    expect(res.status).toBe(200);
    const sks = db.partition(`USER#${USER_A}`).map((i) => i.SK);
    expect(sks).toContain(`TX#2026-10-01#${tx.id}`);
    expect(sks).not.toContain(`TX#2026-09-30#${tx.id}`);
    expect((await monthly('2026-09')).expense).toBe(0);
    expect((await monthly('2026-10')).expense).toBe(80);
    // แก้ต่อได้หลังย้าย (pointer ถูกต้อง)
    const again = await call('PATCH /transactions/{id}', { id: tx.id, body: { amount: 90 } });
    expect(again.status).toBe(200);
    expectSummariesConsistent(USER_A);
  });

  it('แก้แค่ description → ไม่แตะ summary', async () => {
    const tx = await create();
    const before = db.transactCalls;
    await call('PATCH /transactions/{id}', { id: tx.id, body: { description: 'ข้าวขาหมู' } });
    expect(db.transactCalls).toBe(before + 1);
    expectSummariesConsistent(USER_A);
  });

  it('แก้ idempotencyKey/createdAt/deletedAt ไม่ได้', async () => {
    const tx = await create();
    for (const field of ['idempotencyKey', 'createdAt', 'deletedAt']) {
      const res = await call('PATCH /transactions/{id}', {
        id: tx.id,
        body: { [field]: '2026-01-01T00:00:00.000Z' },
      });
      expect(res.status, field).toBe(400);
    }
  });

  it('แก้รายการที่ลบแล้ว → 404', async () => {
    const tx = await create();
    await call('DELETE /transactions/{id}', { id: tx.id });
    const res = await call('PATCH /transactions/{id}', { id: tx.id, body: { amount: 1 } });
    expect(res.status).toBe(404);
  });

  it('มีคนแก้พร้อมกัน (version เปลี่ยน) → 409 และยอดไม่เพี้ยน', async () => {
    const tx = await create({ amount: 100 });
    db.beforeWrite = () => {
      const item = db.partition(`USER#${USER_A}`).find((i) => i.SK.startsWith('TX#'))!;
      item.version = (item.version as number) + 1;
      db.beforeWrite = undefined;
    };
    const res = await call('PATCH /transactions/{id}', { id: tx.id, body: { amount: 500 } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
    expect((await balance()).expense).toBe(100);
  });
});

describe('soft delete / restore', () => {
  it('ลบ → ยอดลด, ยังอยู่ใน DB พร้อม deletedAt; กู้คืน → ยอดกลับ', async () => {
    const tx = await create({ amount: 70 });
    const del = await call<Transaction>('DELETE /transactions/{id}', { id: tx.id });
    expect(del.status).toBe(200);
    expect(del.body.deletedAt).toBe('2026-10-06T05:00:00.000Z');
    expect(await balance()).toEqual({ income: 0, expense: 0, balance: 0, transactionCount: 0 });
    expect(db.partition(`USER#${USER_A}`).some((i) => i.SK === `TX#2026-10-01#${tx.id}`)).toBe(
      true,
    );
    expect((await monthly('2026-10')).byCategory).toEqual([]);

    const res = await call<Transaction>('POST /transactions/{id}/restore', { id: tx.id });
    expect(res.status).toBe(200);
    expect(res.body.deletedAt).toBeNull();
    expect((await balance()).expense).toBe(70);
    expectSummariesConsistent(USER_A);
  });

  it('ลบซ้ำ → 404; กู้คืนซ้ำ → 200 ไม่นับยอดซ้ำ', async () => {
    const tx = await create({ amount: 10 });
    await call('DELETE /transactions/{id}', { id: tx.id });
    expect((await call('DELETE /transactions/{id}', { id: tx.id })).status).toBe(404);
    await call('POST /transactions/{id}/restore', { id: tx.id });
    await call('POST /transactions/{id}/restore', { id: tx.id });
    expect((await balance()).expense).toBe(10);
  });

  it('id รูปแบบผิด/ไม่มีอยู่ → 404', async () => {
    expect((await call('DELETE /transactions/{id}', { id: 'abc' })).status).toBe(404);
    expect(
      (await call('DELETE /transactions/{id}', { id: '01J9Z8X7W6V5T4S3R2Q1P0N9M8' })).status,
    ).toBe(404);
  });
});

describe('POST /transactions/bulk-delete', () => {
  it('ลบหลายรายการ แยก deleted/notFound และยอดถูกต้อง', async () => {
    const a = await create({ amount: 10 });
    const b = await create({ amount: 20, transactionDate: '2026-09-01' });
    const c = await create({ amount: 30 });
    const other = await create({ amount: 99 }, USER_B);
    const missing = '01J9Z8X7W6V5T4S3R2Q1P0N9M8';
    const res = await call<{ deleted: string[]; notFound: string[] }>(
      'POST /transactions/bulk-delete',
      { body: { ids: [a.id, b.id, missing, other.id] } },
    );
    expect(res.status).toBe(200);
    expect(res.body.deleted.sort()).toEqual([a.id, b.id].sort());
    expect(res.body.notFound.sort()).toEqual([missing, other.id].sort());
    expect((await balance()).expense).toBe(c.amount);
    expect((await balance(USER_B)).expense).toBe(99);
    expectSummariesConsistent(USER_A);
  });

  it('100 รายการ (หลายชุด) และไม่เกิน limit ของ TransactWriteItems', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = i % 2 ? '09' : '10';
      ids.push((await create({ amount: 1, transactionDate: `2026-${month}-${day}` })).id);
    }
    const res = await call<{ deleted: string[] }>('POST /transactions/bulk-delete', {
      body: { ids },
    });
    expect(res.body.deleted).toHaveLength(100);
    expect(await balance()).toMatchObject({ expense: 0, transactionCount: 0 });
    expectSummariesConsistent(USER_A);
  });

  it('เกิน 100 → 400', async () => {
    const ids = Array.from({ length: 101 }, () => '01J9Z8X7W6V5T4S3R2Q1P0N9M8');
    expect((await call('POST /transactions/bulk-delete', { body: { ids } })).status).toBe(400);
  });
});

describe('สิทธิ์: user B เข้าถึงข้อมูล user A ไม่ได้ (404)', () => {
  it('PATCH / DELETE / restore รายการของคนอื่น → 404 และข้อมูล A ไม่เปลี่ยน', async () => {
    const tx = await create({ amount: 500 });
    const snapshot = JSON.stringify(db.partition(`USER#${USER_A}`));

    const patch = await call('PATCH /transactions/{id}', {
      sub: USER_B,
      id: tx.id,
      body: { amount: 1 },
    });
    const del = await call('DELETE /transactions/{id}', { sub: USER_B, id: tx.id });
    const restore = await call('POST /transactions/{id}/restore', { sub: USER_B, id: tx.id });
    for (const r of [patch, del, restore]) {
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(JSON.stringify(db.partition(`USER#${USER_A}`))).toBe(snapshot);
    expect(db.partition(`USER#${USER_B}`)).toEqual([]);
  });

  it('list / summary / export ของ B ไม่เห็นข้อมูล A', async () => {
    await create({ amount: 500, description: 'ความลับของ A' });
    const list = await call<TransactionPage>('GET /transactions', { sub: USER_B });
    expect(list.body.items).toEqual([]);
    expect(await balance(USER_B)).toEqual({
      income: 0,
      expense: 0,
      balance: 0,
      transactionCount: 0,
    });
    expect((await monthly('2026-10', USER_B)).byCategory).toEqual([]);
    const exp = await call('GET /export', { sub: USER_B, query: { format: 'csv' } });
    expect(exp.raw).not.toContain('ความลับของ A');
  });
});

describe('summary', () => {
  it('balance และ monthly by category; อาหาร/เดินทาง อยู่ต้น', async () => {
    await create({ amount: 17000, type: 'income', category: 'เงินเดือน' });
    await create({ amount: 900, category: 'ช้อปปิ้ง' });
    await create({ amount: 120, category: 'เดินทาง' });
    await create({ amount: 60, category: 'อาหาร' });
    await create({ amount: 40, category: 'อาหาร' });
    await create({ amount: 15, category: null });
    await create({ amount: 999, transactionDate: '2026-09-30' });

    expect(await balance()).toEqual({
      income: 17000,
      expense: 2134,
      balance: 14866,
      transactionCount: 7,
    });
    const m = await monthly('2026-10');
    expect(m).toMatchObject({
      month: '2026-10',
      income: 17000,
      expense: 1135,
      transactionCount: 6,
    });
    expect(m.byCategory.slice(0, 2)).toEqual([
      { category: 'อาหาร', type: 'expense', total: 100, count: 2 },
      { category: 'เดินทาง', type: 'expense', total: 120, count: 1 },
    ]);
    expect(m.byCategory).toContainEqual({ category: null, type: 'expense', total: 15, count: 1 });
    expect((await monthly('2026-08')).transactionCount).toBe(0);
  });

  it('month รูปแบบผิด → 400', async () => {
    expect((await call('GET /summary/monthly', { query: { month: '2026-13' } })).status).toBe(400);
  });

  it('สุ่มเพิ่ม/แก้/ลบ/กู้คืน 60 ครั้ง → summary ตรงกับการคำนวณใหม่ทุกครั้ง', async () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const cats = ['อาหาร', 'เดินทาง', 'ที่พัก', null];
    const ids: string[] = [];
    for (let step = 0; step < 60; step++) {
      const op = ids.length === 0 ? 0 : rand(4);
      const id = ids[rand(Math.max(ids.length, 1))]!;
      const fields = {
        amount: rand(5000) + 1,
        type: rand(3) === 0 ? 'income' : 'expense',
        category: cats[rand(cats.length)],
        transactionDate: `2026-${rand(2) ? '09' : '10'}-${String(rand(28) + 1).padStart(2, '0')}`,
      };
      if (op === 0) ids.push((await create(fields)).id);
      else if (op === 1) await call('PATCH /transactions/{id}', { id, body: fields });
      else if (op === 2) await call('DELETE /transactions/{id}', { id });
      else await call('POST /transactions/{id}/restore', { id });
    }
    expectSummariesConsistent(USER_A);
  });
});

describe('GET /export', () => {
  it('CSV: BOM, ภาษาไทย, กัน formula injection, ไม่รวมรายการที่ลบ', async () => {
    await create({ description: '=HYPERLINK("http://evil")', amount: 5 });
    const del = await create({ description: 'ลบแล้ว' });
    await call('DELETE /transactions/{id}', { id: del.id });
    const res = await call('GET /export', { query: { format: 'csv' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.raw.startsWith('\uFEFF')).toBe(true);
    expect(res.raw).toContain('วันที่,รายละเอียด');
    expect(res.raw).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.raw).not.toContain('ลบแล้ว');
  });

  it('JSON: transactions + settings + achievements', async () => {
    await create();
    const res = await call<{ transactions: unknown[]; settings: unknown; achievements: unknown[] }>(
      'GET /export',
    );
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.settings).toMatchObject({ monthlySalary: 17000 });
    expect(res.body.achievements).toEqual([]);
  });
});

describe('settings', () => {
  it('ยังไม่ตั้ง → default; PUT แล้ว GET ได้ค่าเดิม', async () => {
    const def = await call('GET /settings');
    expect(def.body).toMatchObject({ monthlySalary: 17000, updatedAt: null });
    const put = await call('PUT /settings', {
      body: {
        monthlySalary: 25000,
        categoryBudgets: [
          { category: 'ช้อปปิ้ง', budget: 2000 },
          { category: 'อาหาร', budget: 6000 },
        ],
        dailyCap: { enabled: true, amount: 400, excludedCategories: ['ที่พัก'] },
      },
    });
    expect(put.status).toBe(200);
    const got = await call<{ monthlySalary: number; categoryBudgets: { category: string }[] }>(
      'GET /settings',
    );
    expect(got.body.monthlySalary).toBe(25000);
    expect(got.body.categoryBudgets[0]?.category).toBe('อาหาร');
    expect((await call('GET /settings', { sub: USER_B })).body).toMatchObject({
      monthlySalary: 17000,
    });
  });

  it('ค่าผิด → 400 ภาษาไทย', async () => {
    const res = await call('PUT /settings', { body: { monthlySalary: 0 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'VALIDATION_ERROR', message: 'เงินเดือนต้องมากกว่า 0' });
  });
});

describe('achievements', () => {
  it('เพิ่ม 201 / ซ้ำ 200 (unique) / list / ลบ 204 / ลบซ้ำ 404 / แยก user', async () => {
    expect((await call('POST /achievements', { body: { badgeId: 'first-tx' } })).status).toBe(201);
    const dup = await call('POST /achievements', { body: { badgeId: 'first-tx' } });
    expect(dup.status).toBe(200);
    const list = await call<{ items: { badgeId: string }[] }>('GET /achievements');
    expect(list.body.items.map((b) => b.badgeId)).toEqual(['first-tx']);
    expect(
      (await call<{ items: unknown[] }>('GET /achievements', { sub: USER_B })).body.items,
    ).toEqual([]);
    expect(
      (await call('DELETE /achievements', { sub: USER_B, query: { badgeId: 'first-tx' } })).status,
    ).toBe(404);
    expect((await call('DELETE /achievements', { query: { badgeId: 'first-tx' } })).status).toBe(
      204,
    );
    expect((await call('DELETE /achievements', { query: { badgeId: 'first-tx' } })).status).toBe(
      404,
    );
  });
});

describe('routing / auth', () => {
  it('route ที่ไม่รู้จัก → 404 JSON', async () => {
    const res = await call('GET /nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ไม่มี sub → 401', async () => {
    const res = await call('GET /summary/balance', { sub: '' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
