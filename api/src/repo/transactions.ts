import { createHash } from 'node:crypto';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  sortByCategoryPriority,
  type Balance,
  type BulkDeleteResult,
  type MonthlySummary,
  type Transaction,
  type TransactionCreate,
  type TransactionListQuery,
  type TransactionPage,
  type TransactionUpdate,
} from '@money-flow/shared';
import { ulid } from 'ulid';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import {
  ALL_SUM_SK,
  TX_PREFIX,
  ddb,
  idempSk,
  monthSumSk,
  pk,
  tableName,
  txIdSk,
  txSk,
  type Key,
} from '../lib/db';
import { cancellationCodes, isTransactionCanceled, mapDynamoError } from '../lib/dynamo-errors';
import { HttpError } from '../lib/http';
import {
  CAT_COUNT_PREFIX,
  CAT_TOTAL_PREFIX,
  deltasFor,
  toAddUpdate,
  type Contribution,
  type SummaryDeltas,
} from '../lib/summary';

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** รูปแบบ item ใน DynamoDB */
export interface TxItem extends Key {
  entity: 'TX';
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  category: string | null;
  transactionDate: string;
  clientTimezone: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** optimistic locking — เพิ่มทุกครั้งที่แก้ เพื่อให้ยอดสรุปไม่เพี้ยนเมื่อแก้พร้อมกัน */
  version: number;
  deletedAt?: string;
}

interface IdempItem extends Key {
  entity: 'IDEMP';
  txId: string;
  requestHash: string;
  createdAt: string;
}

export function toTransaction(item: TxItem): Transaction {
  return {
    id: item.id,
    description: item.description,
    amount: item.amount,
    type: item.type,
    category: item.category ?? null,
    transactionDate: item.transactionDate,
    clientTimezone: item.clientTimezone ?? null,
    idempotencyKey: item.idempotencyKey,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt ?? null,
  };
}

const contributionOf = (t: TxItem): Contribution => ({
  type: t.type,
  amount: t.amount,
  category: t.category ?? null,
  transactionDate: t.transactionDate,
});

function summaryUpdates(userId: string, deltas: SummaryDeltas): TransactItem[] {
  return [...deltas].map(([sk, attrs]) => ({
    Update: { TableName: tableName(), Key: { PK: pk(userId), SK: sk }, ...toAddUpdate(attrs) },
  }));
}

/** hash ของ payload เพื่อแยก "ส่งซ้ำ" (เหมือนเดิม) กับ "ใช้ key ซ้ำแต่ข้อมูลต่าง" */
function requestHash(input: TransactionCreate): string {
  const canonical = JSON.stringify([
    input.description,
    input.amount,
    input.type,
    input.category,
    input.transactionDate,
    input.clientTimezone,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

async function transact(items: TransactItem[]): Promise<void> {
  await ddb.send(new TransactWriteCommand({ TransactItems: items }));
}

/* --------------------------------- Reads --------------------------------- */

async function getItem<T>(key: Key): Promise<T | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: key, ConsistentRead: true }),
  );
  return res.Item as T | undefined;
}

/** หา transaction จาก id (ผ่าน pointer TXID#) — ไม่พบ/เป็นของ user อื่น → undefined */
export async function findTx(userId: string, id: string): Promise<TxItem | undefined> {
  const ptr = await getItem<{ txSk: string }>({ PK: pk(userId), SK: txIdSk(id) });
  if (!ptr) return undefined;
  return getItem<TxItem>({ PK: pk(userId), SK: ptr.txSk });
}

async function requireTx(userId: string, id: string): Promise<TxItem> {
  const tx = await findTx(userId, id);
  if (!tx) throw new HttpError('NOT_FOUND', 'ไม่พบรายการนี้');
  return tx;
}

/* -------------------------------- Create --------------------------------- */

export async function createTransaction(
  userId: string,
  input: TransactionCreate,
  now: Date = new Date(),
): Promise<{ transaction: Transaction; replayed: boolean }> {
  const id = ulid(now.getTime());
  const ts = now.toISOString();
  const hash = requestHash(input);
  const item: TxItem = {
    PK: pk(userId),
    SK: txSk(input.transactionDate, id),
    entity: 'TX',
    id,
    description: input.description,
    amount: input.amount,
    type: input.type,
    category: input.category,
    transactionDate: input.transactionDate,
    clientTimezone: input.clientTimezone,
    idempotencyKey: input.idempotencyKey.toLowerCase(),
    createdAt: ts,
    updatedAt: ts,
    version: 1,
  };
  const idemp: IdempItem = {
    PK: pk(userId),
    SK: idempSk(input.idempotencyKey),
    entity: 'IDEMP',
    txId: id,
    requestHash: hash,
    createdAt: ts,
  };

  const IDEMP_INDEX = 0;
  try {
    await transact([
      {
        Put: {
          TableName: tableName(),
          Item: idemp,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: tableName(),
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: tableName(),
          Item: { PK: pk(userId), SK: txIdSk(id), entity: 'TXID', txSk: item.SK },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...summaryUpdates(userId, deltasFor([{ contribution: contributionOf(item), sign: 1 }])),
    ]);
    return { transaction: toTransaction(item), replayed: false };
  } catch (err) {
    if (
      isTransactionCanceled(err) &&
      cancellationCodes(err)[IDEMP_INDEX] === 'ConditionalCheckFailed'
    ) {
      return replay(userId, input, hash);
    }
    return mapDynamoError(err);
  }
}

/** idempotencyKey เคยใช้แล้ว: payload เดิม → คืนรายการเดิม; payload ต่าง → 409 */
async function replay(userId: string, input: TransactionCreate, hash: string) {
  const existing = await getItem<IdempItem>({ PK: pk(userId), SK: idempSk(input.idempotencyKey) });
  if (!existing) throw new HttpError('CONFLICT');
  if (existing.requestHash !== hash) throw new HttpError('IDEMPOTENCY_CONFLICT');
  const tx = await findTx(userId, existing.txId);
  if (!tx) throw new HttpError('CONFLICT');
  return { transaction: toTransaction(tx), replayed: true };
}

/* --------------------------------- List ---------------------------------- */

const MAX_QUERY_ROUNDS = 5;
const SK_MAX_SUFFIX = '#~'; // '~' มากกว่าทุกตัวอักษรใน ULID

export async function listTransactions(
  userId: string,
  q: TransactionListQuery,
): Promise<TransactionPage> {
  const lower = q.from ? `${TX_PREFIX}${q.from}#` : TX_PREFIX;
  const upper = q.to ? `${TX_PREFIX}${q.to}${SK_MAX_SUFFIX}` : `${TX_PREFIX}~`;

  let startSk = q.cursor ? decodeCursor(q.cursor) : undefined;
  if (startSk && (startSk < lower || startSk > upper)) {
    throw new HttpError('VALIDATION_ERROR', 'cursor ไม่ตรงกับช่วงวันที่');
  }

  const items: TxItem[] = [];
  let lastEvaluated: string | undefined;
  for (let round = 0; round < MAX_QUERY_ROUNDS && items.length < q.limit; round++) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lower AND :upper',
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: { ':pk': pk(userId), ':lower': lower, ':upper': upper },
        ScanIndexForward: false, // ใหม่สุดก่อน
        Limit: q.limit,
        ExclusiveStartKey: startSk ? { PK: pk(userId), SK: startSk } : undefined,
      }),
    );
    items.push(...((res.Items ?? []) as TxItem[]));
    lastEvaluated = res.LastEvaluatedKey?.SK as string | undefined;
    if (!lastEvaluated) break;
    startSk = lastEvaluated;
  }

  const page = items.slice(0, q.limit);
  // ถ้าได้เกิน limit ให้ cursor ชี้ที่ item สุดท้ายที่ส่งกลับ ไม่ใช่ท้าย page ของ DynamoDB
  const nextSk = items.length > q.limit ? page.at(-1)?.SK : lastEvaluated;
  return { items: page.map(toTransaction), nextCursor: nextSk ? encodeCursor(nextSk) : null };
}

/** ดึงทุกรายการที่ยังไม่ถูกลบ (สำหรับ export) */
export async function listAllTransactions(userId: string): Promise<Transaction[]> {
  const out: Transaction[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': TX_PREFIX },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((res.Items ?? []) as TxItem[]).map(toTransaction));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

/* --------------------------------- Update -------------------------------- */

const versionCondition = (t: TxItem) => ({
  ConditionExpression: 'attribute_exists(PK) AND version = :v',
  ExpressionAttributeValues: { ':v': t.version },
});

export async function updateTransaction(
  userId: string,
  id: string,
  patch: TransactionUpdate,
  now: Date = new Date(),
): Promise<Transaction> {
  const old = await requireTx(userId, id);
  if (old.deletedAt) throw new HttpError('NOT_FOUND', 'ไม่พบรายการนี้');

  const next: TxItem = {
    ...old,
    ...patch,
    updatedAt: now.toISOString(),
    version: old.version + 1,
  };
  next.SK = txSk(next.transactionDate, id);

  const deltas = deltasFor([
    { contribution: contributionOf(old), sign: -1 },
    { contribution: contributionOf(next), sign: 1 },
  ]);

  const items: TransactItem[] =
    next.SK === old.SK
      ? [{ Put: { TableName: tableName(), Item: next, ...versionCondition(old) } }]
      : [
          // เปลี่ยนวันที่ = เปลี่ยน SK: ลบของเดิม + สร้างใหม่ + ย้าย pointer
          {
            Delete: {
              TableName: tableName(),
              Key: { PK: old.PK, SK: old.SK },
              ...versionCondition(old),
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: next,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: { PK: pk(userId), SK: txIdSk(id), entity: 'TXID', txSk: next.SK },
            },
          },
        ];

  try {
    await transact([...items, ...summaryUpdates(userId, deltas)]);
  } catch (err) {
    mapDynamoError(err);
  }
  return toTransaction(next);
}

/* ------------------------- Soft delete / restore ------------------------- */

function softDeleteItems(tx: TxItem, now: Date) {
  const next: TxItem = {
    ...tx,
    deletedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    version: tx.version + 1,
  };
  const put: TransactItem = {
    Put: { TableName: tableName(), Item: next, ...versionCondition(tx) },
  };
  return { next, put, contribution: contributionOf(tx) };
}

export async function deleteTransaction(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<Transaction> {
  const tx = await requireTx(userId, id);
  if (tx.deletedAt) throw new HttpError('NOT_FOUND', 'ไม่พบรายการนี้');
  const { next, put, contribution } = softDeleteItems(tx, now);
  try {
    await transact([put, ...summaryUpdates(userId, deltasFor([{ contribution, sign: -1 }]))]);
  } catch (err) {
    mapDynamoError(err);
  }
  return toTransaction(next);
}

export async function restoreTransaction(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<Transaction> {
  const tx = await requireTx(userId, id);
  if (!tx.deletedAt) return toTransaction(tx); // กู้คืนซ้ำ = ไม่ทำอะไร
  const { deletedAt: _, ...rest } = tx;
  const next: TxItem = { ...rest, updatedAt: now.toISOString(), version: tx.version + 1 };
  try {
    await transact([
      { Put: { TableName: tableName(), Item: next, ...versionCondition(tx) } },
      ...summaryUpdates(userId, deltasFor([{ contribution: contributionOf(tx), sign: 1 }])),
    ]);
  } catch (err) {
    mapDynamoError(err);
  }
  return toTransaction(next);
}

/** ลบหลายรายการ: แบ่งเป็นชุดละ 25 (TransactWriteItems จำกัด 100 item และห้ามซ้ำ) */
const BULK_CHUNK = 25;

export async function bulkDeleteTransactions(
  userId: string,
  ids: string[],
  now: Date = new Date(),
): Promise<BulkDeleteResult> {
  const deleted: string[] = [];
  const notFound: string[] = [];

  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    const txs = await batchFindTx(userId, chunk);
    const live = chunk.flatMap((id) => {
      const tx = txs.get(id);
      if (!tx || tx.deletedAt) {
        notFound.push(id);
        return [];
      }
      return [tx];
    });
    if (live.length === 0) continue;

    const ops = live.map((tx) => softDeleteItems(tx, now));
    try {
      await transact([
        ...ops.map((o) => o.put),
        ...summaryUpdates(
          userId,
          deltasFor(ops.map((o) => ({ contribution: o.contribution, sign: -1 as const }))),
        ),
      ]);
      deleted.push(...live.map((t) => t.id));
    } catch (err) {
      if (!isTransactionCanceled(err)) mapDynamoError(err);
      // มีบางรายการถูกแก้พร้อมกัน → ลบทีละรายการแทน
      for (const tx of live) {
        try {
          await deleteTransaction(userId, tx.id, now);
          deleted.push(tx.id);
        } catch (e) {
          if (e instanceof HttpError && (e.code === 'NOT_FOUND' || e.code === 'CONFLICT')) {
            notFound.push(tx.id);
          } else throw e;
        }
      }
    }
  }
  return { deleted, notFound };
}

async function batchFindTx(userId: string, ids: string[]): Promise<Map<string, TxItem>> {
  const ptrs = await batchGet<{ SK: string; txSk: string }>(
    ids.map((id) => ({ PK: pk(userId), SK: txIdSk(id) })),
  );
  const txs = await batchGet<TxItem>(ptrs.map((p) => ({ PK: pk(userId), SK: p.txSk })));
  return new Map(txs.map((t) => [t.id, t]));
}

async function batchGet<T>(keys: Key[]): Promise<T[]> {
  const out: T[] = [];
  let pending: Key[] = keys;
  for (let attempt = 0; pending.length > 0 && attempt < 5; attempt++) {
    const res = await ddb.send(
      new BatchGetCommand({
        RequestItems: { [tableName()]: { Keys: pending, ConsistentRead: true } },
      }),
    );
    out.push(...((res.Responses?.[tableName()] ?? []) as T[]));
    pending = (res.UnprocessedKeys?.[tableName()]?.Keys ?? []) as Key[];
    if (pending.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
  }
  if (pending.length > 0) throw new HttpError('RATE_LIMITED');
  return out;
}

/* -------------------------------- Summaries ------------------------------ */

type SummaryItem = Record<string, unknown> & { income?: number; expense?: number; count?: number };

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export async function getBalance(userId: string): Promise<Balance> {
  const s = (await getItem<SummaryItem>({ PK: pk(userId), SK: ALL_SUM_SK })) ?? {};
  const income = num(s.income);
  const expense = num(s.expense);
  return { income, expense, balance: income - expense, transactionCount: num(s.count) };
}

export async function getMonthlySummary(userId: string, month: string): Promise<MonthlySummary> {
  const s = (await getItem<SummaryItem>({ PK: pk(userId), SK: monthSumSk(month) })) ?? {};
  const byCategory: MonthlySummary['byCategory'] = [];
  for (const [attr, value] of Object.entries(s)) {
    if (!attr.startsWith(CAT_TOTAL_PREFIX)) continue;
    const key = attr.slice(CAT_TOTAL_PREFIX.length);
    const sep = key.indexOf('|');
    const type = key.slice(0, sep) as 'income' | 'expense';
    const category = key.slice(sep + 1) || null;
    const count = num(s[`${CAT_COUNT_PREFIX}${key}`]);
    if (count <= 0) continue; // หมวดที่ลบหมดแล้ว
    byCategory.push({ category, type, total: num(value), count });
  }
  const income = num(s.income);
  const expense = num(s.expense);
  return {
    month,
    income,
    expense,
    balance: income - expense,
    transactionCount: num(s.count),
    byCategory: sortByCategoryPriority(
      byCategory.sort((a, b) => a.type.localeCompare(b.type) || b.total - a.total),
      (c) => c.category,
      () => 0, // คงลำดับจากยอดมาก→น้อย ภายในกลุ่มที่ไม่ใช่อาหาร/เดินทาง
    ),
  };
}
