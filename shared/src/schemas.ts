import { z } from 'zod';
import { sortByCategoryPriority } from './categories';
import {
  MIN_TRANSACTION_DATE,
  isValidIsoDate,
  isValidIsoMonth,
  isValidTimeZone,
  maxTransactionDate,
} from './date';
import { charLength, sanitizeText } from './text';

// ข้อความ error เริ่มต้นของ Zod เป็นภาษาไทย (กรณีที่ไม่ได้กำหนดข้อความเอง)
z.config(z.locales.th());

/* -------------------------------------------------------------------------- */
/*                               Field builders                               */
/* -------------------------------------------------------------------------- */

const numberFmt = new Intl.NumberFormat('th-TH');

/** ข้อความ: ตัด control chars + trim แล้วตรวจความยาว (นับ code point) */
function sanitizedText(label: string, min: number, max: number) {
  return z.string({ error: `${label}ต้องเป็นข้อความ` }).transform((raw, ctx) => {
    const value = sanitizeText(raw);
    const len = charLength(value);
    if (len < min) {
      ctx.issues.push({ code: 'custom', input: raw, message: `กรุณากรอก${label}` });
      return z.NEVER;
    }
    if (len > max) {
      ctx.issues.push({
        code: 'custom',
        input: raw,
        message: `${label}ต้องไม่เกิน ${max} ตัวอักษร`,
      });
      return z.NEVER;
    }
    return value;
  });
}

/** ข้อความ optional: undefined/null/ค่าว่าง (หลัง trim) → null */
function nullableSanitizedText(label: string, max: number) {
  return z
    .string({ error: `${label}ต้องเป็นข้อความ` })
    .nullish()
    .transform((raw, ctx): string | null => {
      if (raw === null || raw === undefined) return null;
      const value = sanitizeText(raw);
      if (value === '') return null;
      if (charLength(value) > max) {
        ctx.issues.push({
          code: 'custom',
          input: raw,
          message: `${label}ต้องไม่เกิน ${max} ตัวอักษร`,
        });
        return z.NEVER;
      }
      return value;
    });
}

/** จำนวนเงินเป็นบาทจำนวนเต็ม 1..max (ไม่รับทศนิยม) */
function bahtAmount(label: string, maxBaht: number) {
  return z
    .number({ error: `${label}ต้องเป็นตัวเลข` })
    .refine(Number.isFinite, { error: `${label}ต้องเป็นตัวเลข`, abort: true })
    .refine(Number.isInteger, { error: `${label}ต้องเป็นจำนวนเต็ม (ไม่มีทศนิยม)`, abort: true })
    .refine((v) => v >= 1, { error: `${label}ต้องมากกว่า 0`, abort: true })
    .refine((v) => v <= maxBaht, {
      error: `${label}ต้องไม่เกิน ${numberFmt.format(maxBaht)} บาท`,
    });
}

/** error map สำหรับ strictObject: แจ้ง field ที่ไม่อนุญาต (เช่น idempotencyKey ตอนแก้ไข) */
const strictKeysError = (iss: z.core.$ZodRawIssue): string | undefined =>
  iss.code === 'unrecognized_keys'
    ? `ไม่อนุญาตให้ส่งหรือแก้ไขข้อมูล: ${iss.keys.join(', ')}`
    : undefined;

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/* -------------------------------------------------------------------------- */
/*                              Primitive fields                              */
/* -------------------------------------------------------------------------- */

export const MAX_TRANSACTION_AMOUNT_BAHT = 999_999_999;
export const MAX_SETTINGS_AMOUNT_BAHT = 100_000_000;
export const DEFAULT_MONTHLY_SALARY_BAHT = 17_000;
export const MAX_CATEGORY_BUDGETS = 20;
export const MAX_BULK_DELETE = 100;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

export const isoDateSchema = z
  .string({ error: 'วันที่ต้องเป็นข้อความ' })
  .refine(isValidIsoDate, { error: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD', abort: true });

export const isoMonthSchema = z
  .string({ error: 'เดือนต้องเป็นข้อความ' })
  .refine(isValidIsoMonth, { error: 'รูปแบบเดือนต้องเป็น YYYY-MM' });

export const transactionDateSchema = isoDateSchema.refine(
  (d) => d >= MIN_TRANSACTION_DATE && d <= maxTransactionDate(),
  { error: 'วันที่ต้องอยู่ระหว่าง 1970-01-01 ถึง 1 ปีนับจากวันนี้' },
);

/** ULID (Crockford base32, 26 ตัว) */
export const transactionIdSchema = z
  .string({ error: 'รหัสรายการไม่ถูกต้อง' })
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, { error: 'รหัสรายการไม่ถูกต้อง' });

export const transactionTypeSchema = z.enum(['income', 'expense'], {
  error: 'ประเภทต้องเป็นรายรับหรือรายจ่าย',
});

export const descriptionSchema = sanitizedText('รายละเอียด', 1, 120);
export const transactionCategorySchema = nullableSanitizedText('หมวดหมู่', 60);
export const transactionAmountSchema = bahtAmount('จำนวนเงิน', MAX_TRANSACTION_AMOUNT_BAHT);

export const clientTimezoneSchema = z
  .string({ error: 'เขตเวลาต้องเป็นข้อความ' })
  .max(64, { error: 'เขตเวลาต้องไม่เกิน 64 ตัวอักษร' })
  .refine(isValidTimeZone, { error: 'เขตเวลาไม่ถูกต้อง (ต้องเป็น IANA เช่น Asia/Bangkok)' })
  .nullish()
  .transform((v) => v ?? null);

export const idempotencyKeySchema = z.uuid({ error: 'idempotencyKey ต้องเป็น UUID' });

export const badgeIdSchema = z
  .string({ error: 'รหัสเหรียญต้องเป็นข้อความ' })
  .min(1, { error: 'กรุณาระบุรหัสเหรียญ' })
  .max(60, { error: 'รหัสเหรียญต้องไม่เกิน 60 ตัวอักษร' })
  .regex(/^[a-z0-9][a-z0-9_-]*$/, { error: 'รหัสเหรียญใช้ได้เฉพาะ a-z 0-9 _ -' });

/* -------------------------------------------------------------------------- */
/*                         Transaction: request bodies                        */
/* -------------------------------------------------------------------------- */

/** POST /transactions — `amount` เป็นบาทจำนวนเต็ม */
export const transactionCreateSchema = z.strictObject(
  {
    description: descriptionSchema,
    amount: transactionAmountSchema,
    type: transactionTypeSchema,
    category: transactionCategorySchema,
    transactionDate: transactionDateSchema,
    clientTimezone: clientTimezoneSchema,
    idempotencyKey: idempotencyKeySchema,
  },
  { error: strictKeysError },
);

export type TransactionCreateInput = z.input<typeof transactionCreateSchema>;
export type TransactionCreate = z.output<typeof transactionCreateSchema>;

/**
 * PATCH /transactions/{id} — ส่งเฉพาะ field ที่แก้
 * idempotencyKey / createdAt / deletedAt เป็นของ server แก้ไม่ได้ (strict → error)
 * category/clientTimezone: ไม่ส่ง = ไม่แก้, ส่ง null หรือ "" = ล้างค่า
 */
export const transactionUpdateSchema = z
  .strictObject(
    {
      description: descriptionSchema.optional(),
      amount: transactionAmountSchema.optional(),
      type: transactionTypeSchema.optional(),
      category: transactionCategorySchema.optional(),
      transactionDate: transactionDateSchema.optional(),
      clientTimezone: clientTimezoneSchema.optional(),
    },
    { error: strictKeysError },
  )
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    error: 'กรุณาระบุข้อมูลที่ต้องการแก้ไขอย่างน้อย 1 รายการ',
  })
  .transform(
    (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as typeof o,
  );

export type TransactionUpdateInput = z.input<typeof transactionUpdateSchema>;
export type TransactionUpdate = z.output<typeof transactionUpdateSchema>;

/** POST /transactions/bulk-delete — ตัด id ซ้ำออกให้ */
export const bulkDeleteSchema = z.strictObject(
  {
    ids: z
      .array(transactionIdSchema, { error: 'ids ต้องเป็นรายการ' })
      .min(1, { error: 'กรุณาเลือกอย่างน้อย 1 รายการ' })
      .max(MAX_BULK_DELETE, { error: `ลบได้ครั้งละไม่เกิน ${MAX_BULK_DELETE} รายการ` })
      .transform((ids) => [...new Set(ids)]),
  },
  { error: strictKeysError },
);
export type BulkDeleteInput = z.input<typeof bulkDeleteSchema>;

/* -------------------------------------------------------------------------- */
/*                          Transaction: query params                         */
/* -------------------------------------------------------------------------- */

/** GET /transactions?from=&to=&cursor=&limit= */
export const transactionListQuerySchema = z
  .object({
    from: z.preprocess(emptyToUndefined, isoDateSchema.optional()),
    to: z.preprocess(emptyToUndefined, isoDateSchema.optional()),
    cursor: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .max(1024, { error: 'cursor ไม่ถูกต้อง' })
        .regex(/^[A-Za-z0-9_-]+$/, { error: 'cursor ไม่ถูกต้อง' })
        .optional(),
    ),
    limit: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number({ error: 'limit ต้องเป็นตัวเลข' })
        .int({ error: 'limit ต้องเป็นจำนวนเต็ม' })
        .min(1, { error: 'limit ต้องอยู่ระหว่าง 1–100' })
        .max(MAX_PAGE_SIZE, { error: 'limit ต้องอยู่ระหว่าง 1–100' })
        .default(DEFAULT_PAGE_SIZE),
    ),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    error: 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด',
    path: ['from'],
  });
export type TransactionListQuery = z.output<typeof transactionListQuerySchema>;

/** GET /summary/monthly?month=YYYY-MM */
export const monthlySummaryQuerySchema = z.object({ month: isoMonthSchema });

/** GET /export?format=csv|json */
export const exportQuerySchema = z.object({
  format: z.preprocess(
    emptyToUndefined,
    z.enum(['csv', 'json'], { error: 'format ต้องเป็น csv หรือ json' }).default('json'),
  ),
});

/* -------------------------------------------------------------------------- */
/*                        Transaction: response shapes                        */
/* -------------------------------------------------------------------------- */

const isoDateTime = z.iso.datetime();

export const transactionSchema = z.object({
  id: transactionIdSchema,
  description: z.string(),
  amount: z.number().int().positive(),
  type: transactionTypeSchema,
  category: z.string().nullable(),
  transactionDate: isoDateSchema,
  clientTimezone: z.string().nullable(),
  idempotencyKey: z.uuid(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});
export type Transaction = z.output<typeof transactionSchema>;

export const transactionPageSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});
export type TransactionPage = z.output<typeof transactionPageSchema>;

export const bulkDeleteResultSchema = z.object({
  deleted: z.array(transactionIdSchema),
  notFound: z.array(transactionIdSchema),
});
export type BulkDeleteResult = z.output<typeof bulkDeleteResultSchema>;

/* -------------------------------------------------------------------------- */
/*                                  Summaries                                 */
/* -------------------------------------------------------------------------- */

const bahtInt = z.number().int();

export const balanceSchema = z.object({
  income: bahtInt,
  expense: bahtInt,
  balance: bahtInt,
  transactionCount: z.number().int().nonnegative(),
});
export type Balance = z.output<typeof balanceSchema>;

export const categoryTotalSchema = z.object({
  category: z.string().nullable(),
  type: transactionTypeSchema,
  total: bahtInt,
  count: z.number().int().nonnegative(),
});

export const monthlySummarySchema = z.object({
  month: isoMonthSchema,
  income: bahtInt,
  expense: bahtInt,
  balance: bahtInt,
  transactionCount: z.number().int().nonnegative(),
  byCategory: z.array(categoryTotalSchema),
});
export type MonthlySummary = z.output<typeof monthlySummarySchema>;

/* -------------------------------------------------------------------------- */
/*                                UserSettings                                */
/* -------------------------------------------------------------------------- */

export const EXPENSE_COLORS = ['red', 'blue', 'green'] as const;
export type ExpenseColor = (typeof EXPENSE_COLORS)[number];

const budgetCategoryName = sanitizedText('ชื่อหมวด', 1, 40);
const excludedCategoryName = sanitizedText('ชื่อหมวด', 1, 60);
const settingsAmount = (label: string) => bahtAmount(label, MAX_SETTINGS_AMOUNT_BAHT);

const uniqueCategories = (items: { category: string }[]) =>
  new Set(items.map((i) => i.category)).size === items.length;

const excludedCategoriesSchema = z
  .array(excludedCategoryName)
  .max(20, { error: 'เลือกหมวดที่ไม่นับได้ไม่เกิน 20 หมวด' })
  .transform((list) => [...new Set(list)])
  .prefault([]);

/** เพดานรายวัน: วงเงิน/วัน + แผนย่อยรายหมวด + หมวดที่ไม่นับ (เช่น ค่าที่พัก) */
export const dailyCapInputSchema = z
  .strictObject(
    {
      enabled: z.boolean({ error: 'enabled ต้องเป็น true/false' }).default(false),
      amount: settingsAmount('เพดานรายวัน').nullable().default(null),
      subPlans: z
        .array(
          z.strictObject({ category: budgetCategoryName, amount: settingsAmount('งบแผนย่อย') }),
        )
        .max(10, { error: 'แผนย่อยได้ไม่เกิน 10 รายการ' })
        .refine(uniqueCategories, { error: 'หมวดในแผนย่อยต้องไม่ซ้ำกัน' })
        .prefault([]),
      excludedCategories: excludedCategoriesSchema,
    },
    { error: strictKeysError },
  )
  .refine((c) => !c.enabled || c.amount !== null, {
    error: 'กรุณาระบุเพดานรายวันเมื่อเปิดใช้งาน',
    path: ['amount'],
  })
  .refine(
    (c) => c.amount === null || c.subPlans.reduce((sum, p) => sum + p.amount, 0) <= c.amount,
    { error: 'ผลรวมแผนย่อยต้องไม่เกินเพดานรายวัน', path: ['subPlans'] },
  )
  .transform((c) => ({ ...c, subPlans: sortByCategoryPriority(c.subPlans, (p) => p.category) }));

/** PUT /settings — แทนที่ทั้งก้อน; field ที่ไม่ส่งจะใช้ค่า default */
export const settingsInputSchema = z
  .strictObject(
    {
      monthlySalary: settingsAmount('เงินเดือน').prefault(DEFAULT_MONTHLY_SALARY_BAHT),
      dailyCap: dailyCapInputSchema.prefault({}),
      categoryBudgets: z
        .array(z.strictObject({ category: budgetCategoryName, budget: settingsAmount('งบหมวด') }))
        .max(MAX_CATEGORY_BUDGETS, { error: `ตั้งงบได้ไม่เกิน ${MAX_CATEGORY_BUDGETS} หมวด` })
        .refine(uniqueCategories, { error: 'หมวดในงบต้องไม่ซ้ำกัน' })
        .prefault([]),
      expenseColor: z
        .enum(EXPENSE_COLORS, { error: 'สีต้องเป็น แดง ฟ้า หรือ เขียว' })
        .default('red'),
      dailyReminder: z
        .strictObject({
          enabled: z.boolean().default(false),
          time: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'เวลาต้องเป็นรูปแบบ HH:mm' })
            .default('20:00'),
        })
        .prefault({}),
      heatmapExcludedCategories: excludedCategoriesSchema,
    },
    { error: strictKeysError },
  )
  .transform((s) => ({
    ...s,
    categoryBudgets: sortByCategoryPriority(s.categoryBudgets, (b) => b.category),
  }));

export type SettingsInput = z.input<typeof settingsInputSchema>;
export type SettingsData = z.output<typeof settingsInputSchema>;

/** Response ของ GET/PUT /settings (บาทจำนวนเต็ม) — รูปแบบเดียวกับ input + updatedAt */
export const settingsSchema = z.object({
  monthlySalary: z.number().int().positive(),
  dailyCap: z.object({
    enabled: z.boolean(),
    amount: z.number().int().positive().nullable(),
    subPlans: z.array(z.object({ category: z.string(), amount: z.number().int().positive() })),
    excludedCategories: z.array(z.string()),
  }),
  categoryBudgets: z.array(z.object({ category: z.string(), budget: z.number().int().positive() })),
  expenseColor: z.enum(EXPENSE_COLORS),
  dailyReminder: z.object({ enabled: z.boolean(), time: z.string() }),
  heatmapExcludedCategories: z.array(z.string()),
  updatedAt: isoDateTime.nullable(),
});
export type UserSettings = z.output<typeof settingsSchema>;

/** ค่าเริ่มต้นเมื่อผู้ใช้ยังไม่เคยบันทึก settings */
export function defaultSettings(): UserSettings {
  return { ...settingsInputSchema.parse({}), updatedAt: null };
}

/** settings → body สำหรับ PUT /settings (ตัด updatedAt ออก) */
export function settingsToInput({ updatedAt: _, ...rest }: UserSettings): SettingsInput {
  return structuredClone(rest);
}

/* -------------------------------------------------------------------------- */
/*                               UserAchievement                              */
/* -------------------------------------------------------------------------- */

/** POST /achievements */
export const achievementCreateSchema = z.strictObject(
  { badgeId: badgeIdSchema },
  { error: strictKeysError },
);

/** DELETE /achievements?badgeId= */
export const achievementDeleteQuerySchema = z.object({ badgeId: badgeIdSchema });

export const achievementSchema = z.object({
  badgeId: badgeIdSchema,
  earnedAt: isoDateTime,
});
export type UserAchievement = z.output<typeof achievementSchema>;

/* -------------------------------------------------------------------------- */
/*                                   Account                                  */
/* -------------------------------------------------------------------------- */

/** ข้อความที่ผู้ใช้ต้องพิมพ์ยืนยันก่อนลบบัญชี */
export const ACCOUNT_DELETE_CONFIRMATION = 'ลบบัญชี';

/** DELETE /account */
export const accountDeleteSchema = z.strictObject(
  {
    confirm: z.literal(ACCOUNT_DELETE_CONFIRMATION, {
      error: `กรุณาพิมพ์ "${ACCOUNT_DELETE_CONFIRMATION}" เพื่อยืนยัน`,
    }),
  },
  { error: strictKeysError },
);

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/** ดึงข้อความ error แรก (ภาษาไทย) และ map ราย field สำหรับแสดงในฟอร์ม */
export function formatZodError(error: z.ZodError): {
  message: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return { message: error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', fields };
}
