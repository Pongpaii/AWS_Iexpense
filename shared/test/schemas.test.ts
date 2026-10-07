import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountDeleteSchema,
  achievementCreateSchema,
  bulkDeleteSchema,
  defaultSettings,
  formatZodError,
  monthlySummaryQuerySchema,
  settingsInputSchema,
  settingsSchema,
  settingsToInput,
  transactionCreateSchema,
  transactionListQuerySchema,
  transactionUpdateSchema,
  type TransactionCreateInput,
} from '../src/schemas';

const UUID = '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f';
const ULID = '01J9Z8X7W6V5T4S3R2Q1P0N9M8';

const valid = (): TransactionCreateInput => ({
  description: 'ข้าวมันไก่',
  amount: 50,
  type: 'expense',
  category: 'อาหาร',
  transactionDate: '2026-10-06',
  clientTimezone: 'Asia/Bangkok',
  idempotencyKey: UUID,
});

const firstMessage = (r: { success: boolean; error?: Parameters<typeof formatZodError>[0] }) =>
  r.error ? formatZodError(r.error).message : undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T04:39:40Z'));
});
afterEach(() => vi.useRealTimers());

describe('transactionCreateSchema', () => {
  it('ผ่าน และ amount เป็นบาทจำนวนเต็มตามที่ส่ง', () => {
    expect(transactionCreateSchema.parse({ ...valid(), amount: 1234 }).amount).toBe(1234);
  });

  it('amount มีทศนิยม → error ภาษาไทย', () => {
    const r = transactionCreateSchema.safeParse({ ...valid(), amount: 50.25 });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe('จำนวนเงินต้องเป็นจำนวนเต็ม (ไม่มีทศนิยม)');
  });

  it('ตัดช่องว่าง/control chars ของ description', () => {
    const out = transactionCreateSchema.parse({ ...valid(), description: '  กา\u0000แฟ \n' });
    expect(out.description).toBe('กาแฟ');
  });

  it.each([
    ['ว่าง', '   ', 'กรุณากรอกรายละเอียด'],
    ['มีแต่ control chars', '\u0000\u0001', 'กรุณากรอกรายละเอียด'],
    ['ยาวเกิน 120', 'ก'.repeat(121), 'รายละเอียดต้องไม่เกิน 120 ตัวอักษร'],
  ])('description %s → error', (_, description, msg) => {
    const r = transactionCreateSchema.safeParse({ ...valid(), description });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe(msg);
  });

  it('description 120 ตัวอักษรพอดีผ่าน', () => {
    expect(
      transactionCreateSchema.safeParse({ ...valid(), description: 'ก'.repeat(120) }).success,
    ).toBe(true);
  });

  it.each([0, -1, 0.5, 1_000_000_000, Number.NaN, Infinity])('amount %s ไม่ผ่าน', (amount) => {
    expect(transactionCreateSchema.safeParse({ ...valid(), amount }).success).toBe(false);
  });

  it('amount เป็น string ไม่ผ่าน', () => {
    expect(transactionCreateSchema.safeParse({ ...valid(), amount: '50' }).success).toBe(false);
  });

  it.each([1, 999_999_999])('amount %s ผ่าน', (amount) => {
    expect(transactionCreateSchema.safeParse({ ...valid(), amount }).success).toBe(true);
  });

  it('type ต้องเป็น income|expense', () => {
    expect(transactionCreateSchema.safeParse({ ...valid(), type: 'transfer' }).success).toBe(false);
  });

  it.each([undefined, null, '', '   '])('category %j → null', (category) => {
    expect(transactionCreateSchema.parse({ ...valid(), category }).category).toBeNull();
  });

  it('category ยาวเกิน 60 ไม่ผ่าน', () => {
    expect(
      transactionCreateSchema.safeParse({ ...valid(), category: 'ก'.repeat(61) }).success,
    ).toBe(false);
  });

  it.each([
    ['1970-01-01', true],
    ['1969-12-31', false],
    ['2027-10-06', true], // วันนี้ + 1 ปี
    ['2027-10-07', false],
    ['2026-02-30', false],
    ['06/10/2026', false],
  ])('transactionDate %s → %s', (transactionDate, ok) => {
    expect(transactionCreateSchema.safeParse({ ...valid(), transactionDate }).success).toBe(ok);
  });

  it('clientTimezone optional → null, ไม่ถูกต้อง/ยาวเกินไม่ผ่าน', () => {
    const { clientTimezone: _, ...noTz } = valid();
    expect(transactionCreateSchema.parse(noTz).clientTimezone).toBeNull();
    expect(
      transactionCreateSchema.safeParse({ ...valid(), clientTimezone: 'Nope/Zone' }).success,
    ).toBe(false);
    expect(
      transactionCreateSchema.safeParse({ ...valid(), clientTimezone: `Asia/${'A'.repeat(64)}` })
        .success,
    ).toBe(false);
  });

  it('idempotencyKey ต้องเป็น uuid', () => {
    expect(transactionCreateSchema.safeParse({ ...valid(), idempotencyKey: 'abc' }).success).toBe(
      false,
    );
    const { idempotencyKey: _, ...noKey } = valid();
    expect(transactionCreateSchema.safeParse(noKey).success).toBe(false);
  });

  it.each(['userId', 'createdAt', 'deletedAt', 'id'])('ห้ามส่ง field ของ server: %s', (key) => {
    const r = transactionCreateSchema.safeParse({ ...valid(), [key]: 'x' });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain(key);
  });
});

describe('transactionUpdateSchema', () => {
  it('แก้บาง field ได้ และไม่ใส่ key ที่ไม่ได้ส่ง', () => {
    expect(transactionUpdateSchema.parse({ amount: 10 })).toEqual({ amount: 10 });
  });

  it('category null / "" = ล้างค่า', () => {
    expect(transactionUpdateSchema.parse({ category: '' })).toEqual({ category: null });
    expect(transactionUpdateSchema.parse({ category: null })).toEqual({ category: null });
  });

  it('ต้องมีอย่างน้อย 1 field', () => {
    expect(transactionUpdateSchema.safeParse({}).success).toBe(false);
  });

  it.each(['idempotencyKey', 'createdAt', 'deletedAt', 'userId'])('แก้ %s ไม่ได้', (key) => {
    const r = transactionUpdateSchema.safeParse({ description: 'x', [key]: UUID });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain(key);
  });

  it('ใช้กฎ validation เดียวกับตอนสร้าง', () => {
    expect(transactionUpdateSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({ description: ' ' }).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({ transactionDate: '2030-01-01' }).success).toBe(
      false,
    );
  });
});

describe('bulkDeleteSchema', () => {
  it('ตัด id ซ้ำ', () => {
    expect(bulkDeleteSchema.parse({ ids: [ULID, ULID] }).ids).toEqual([ULID]);
  });
  it('1–100 รายการ และต้องเป็น ULID', () => {
    expect(bulkDeleteSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(bulkDeleteSchema.safeParse({ ids: Array(101).fill(ULID) }).success).toBe(false);
    expect(bulkDeleteSchema.safeParse({ ids: Array(100).fill(ULID) }).success).toBe(true);
    expect(bulkDeleteSchema.safeParse({ ids: ['not-ulid'] }).success).toBe(false);
  });
});

describe('query schemas', () => {
  it('list: default limit 50 และ coerce string', () => {
    expect(transactionListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(transactionListQuerySchema.parse({ limit: '20', from: '' }).limit).toBe(20);
  });
  it('list: limit นอกช่วง / from > to ไม่ผ่าน', () => {
    expect(transactionListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(
      transactionListQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success,
    ).toBe(false);
    expect(transactionListQuerySchema.safeParse({ cursor: 'a b' }).success).toBe(false);
  });
  it('monthly: YYYY-MM', () => {
    expect(monthlySummaryQuerySchema.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(monthlySummaryQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
  });
});

describe('settingsInputSchema', () => {
  it('ค่า default: เงินเดือน 17,000 บาท, สีแดง', () => {
    const d = defaultSettings();
    expect(d.monthlySalary).toBe(17_000);
    expect(d.expenseColor).toBe('red');
    expect(d.dailyCap).toEqual({
      enabled: false,
      amount: null,
      subPlans: [],
      excludedCategories: [],
    });
    expect(settingsSchema.safeParse(d).success).toBe(true);
  });

  it('monthlySalary ต้อง > 0, ≤ 100,000,000 และไม่มีทศนิยม', () => {
    expect(settingsInputSchema.safeParse({ monthlySalary: 17000.5 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ monthlySalary: 0 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ monthlySalary: 100_000_001 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ monthlySalary: 100_000_000 }).success).toBe(true);
  });

  it('categoryBudgets ≤ 20, ไม่ซ้ำ, ชื่อ 1–40, เรียง อาหาร/เดินทาง ก่อน', () => {
    const out = settingsInputSchema.parse({
      categoryBudgets: [
        { category: 'ช้อปปิ้ง', budget: 1000 },
        { category: 'เดินทาง', budget: 1500 },
        { category: 'อาหาร', budget: 6000 },
      ],
    });
    expect(out.categoryBudgets.map((b) => b.category)).toEqual(['อาหาร', 'เดินทาง', 'ช้อปปิ้ง']);
    expect(out.categoryBudgets[0]?.budget).toBe(6000);

    const many = Array.from({ length: 21 }, (_, i) => ({ category: `หมวด${i}`, budget: 1 }));
    expect(settingsInputSchema.safeParse({ categoryBudgets: many }).success).toBe(false);
    expect(
      settingsInputSchema.safeParse({
        categoryBudgets: [
          { category: 'อาหาร', budget: 1 },
          { category: ' อาหาร ', budget: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      settingsInputSchema.safeParse({ categoryBudgets: [{ category: 'ก'.repeat(41), budget: 1 }] })
        .success,
    ).toBe(false);
    expect(
      settingsInputSchema.safeParse({ categoryBudgets: [{ category: 'อาหาร', budget: 0 }] })
        .success,
    ).toBe(false);
  });

  it('dailyCap: เปิดใช้ต้องมีวงเงิน, ผลรวมแผนย่อยไม่เกินเพดาน', () => {
    expect(settingsInputSchema.safeParse({ dailyCap: { enabled: true } }).success).toBe(false);
    expect(
      settingsInputSchema.safeParse({
        dailyCap: {
          enabled: true,
          amount: 300,
          subPlans: [
            { category: 'อาหาร', amount: 200 },
            { category: 'เดินทาง', amount: 150 },
          ],
        },
      }).success,
    ).toBe(false);
    const ok = settingsInputSchema.parse({
      dailyCap: {
        enabled: true,
        amount: 400,
        subPlans: [
          { category: 'เดินทาง', amount: 150 },
          { category: 'อาหาร', amount: 200 },
        ],
        excludedCategories: ['ที่พัก', 'ที่พัก'],
      },
    });
    expect(ok.dailyCap.amount).toBe(400);
    expect(ok.dailyCap.subPlans[0]?.category).toBe('อาหาร');
    expect(ok.dailyCap.excludedCategories).toEqual(['ที่พัก']);
  });

  it('expenseColor รับเฉพาะ red/blue/green', () => {
    expect(settingsInputSchema.safeParse({ expenseColor: 'purple' }).success).toBe(false);
    expect(settingsInputSchema.parse({ expenseColor: 'green' }).expenseColor).toBe('green');
  });

  it('round-trip: settingsToInput → settingsInputSchema ได้ค่าเดิม', () => {
    const original = settingsInputSchema.parse({
      monthlySalary: 25000,
      dailyCap: { enabled: true, amount: 500, subPlans: [{ category: 'อาหาร', amount: 250 }] },
      categoryBudgets: [{ category: 'อาหาร', budget: 6000 }],
      dailyReminder: { enabled: true, time: '21:30' },
    });
    const again = settingsInputSchema.parse(settingsToInput({ ...original, updatedAt: null }));
    expect(again).toEqual(original);
  });
});

describe('achievement / account', () => {
  it('badgeId 1–60, a-z0-9_-', () => {
    expect(achievementCreateSchema.safeParse({ badgeId: 'streak-7' }).success).toBe(true);
    expect(achievementCreateSchema.safeParse({ badgeId: '' }).success).toBe(false);
    expect(achievementCreateSchema.safeParse({ badgeId: 'a'.repeat(61) }).success).toBe(false);
    expect(achievementCreateSchema.safeParse({ badgeId: 'BADGE#1' }).success).toBe(false);
  });
  it('ลบบัญชีต้องพิมพ์ยืนยัน', () => {
    expect(accountDeleteSchema.safeParse({ confirm: 'ลบบัญชี' }).success).toBe(true);
    expect(accountDeleteSchema.safeParse({ confirm: 'yes' }).success).toBe(false);
  });
});

describe('settings.dailyCapPlan', () => {
  const plan = () => ({
    enabled: true,
    excludedCategories: ['ที่พัก'],
    weekday: {
      cap: 320,
      items: [
        {
          id: 'weekday-lunch',
          emoji: '🍜',
          label: 'กลางวัน',
          amount: 70,
          keywords: ['เที่ยง'],
          timeWindow: { start: '12:00', end: '14:59' },
          category: 'อาหาร',
        },
      ],
    },
    weekend: { cap: 243.5, items: [] },
  });

  it('ค่าเริ่มต้นเป็น null (ยังไม่เคยบันทึก)', () => {
    expect(settingsInputSchema.parse({}).dailyCapPlan).toBeNull();
    expect(defaultSettings().dailyCapPlan).toBeNull();
  });

  it('รับแผนที่ถูกต้อง และ round-trip ผ่าน settingsSchema ได้', () => {
    const data = settingsInputSchema.parse({ dailyCapPlan: plan() });
    expect(data.dailyCapPlan).toEqual(plan());
    const res = settingsSchema.parse({ ...data, updatedAt: null });
    expect(res.dailyCapPlan).toEqual(plan());
  });

  it('response เก่าที่ไม่มี field นี้ → null', () => {
    const { dailyCapPlan: _, ...legacy } = defaultSettings();
    expect(settingsSchema.parse(legacy).dailyCapPlan).toBeNull();
  });

  it('ปฏิเสธเวลา/ช่องเกิน/คีย์แปลก', () => {
    const badTime = plan();
    badTime.weekday.items[0]!.timeWindow = { start: '25:00', end: '01:00' };
    expect(settingsInputSchema.safeParse({ dailyCapPlan: badTime }).success).toBe(false);

    const tooMany = plan();
    tooMany.weekday.items = Array.from({ length: 11 }, (_, i) => ({
      ...plan().weekday.items[0]!,
      id: `x${i}`,
    }));
    expect(settingsInputSchema.safeParse({ dailyCapPlan: tooMany }).success).toBe(false);

    expect(
      settingsInputSchema.safeParse({ dailyCapPlan: { ...plan(), hacked: true } }).success,
    ).toBe(false);
    expect(
      settingsInputSchema.safeParse({ dailyCapPlan: { ...plan(), weekday: { cap: 0, items: [] } } })
        .success,
    ).toBe(false);
  });
});
