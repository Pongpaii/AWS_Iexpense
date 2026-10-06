/**
 * In-memory DynamoDB สำหรับทดสอบ — ต่อเข้ากับ aws-sdk-client-mock
 * รองรับเฉพาะ expression ที่ repository ใช้จริง (ถ้าเจอรูปแบบอื่นจะ throw เพื่อให้รู้ทันที)
 */
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

type Item = Record<string, unknown> & { PK: string; SK: string };
type Values = Record<string, unknown> | undefined;
type Names = Record<string, string> | undefined;

const keyOf = (k: { PK: unknown; SK: unknown }) => `${String(k.PK)}\u0000${String(k.SK)}`;
const clone = <T>(v: T): T => structuredClone(v);

export class FakeDynamo {
  readonly items = new Map<string, Item>();
  readonly mock = mockClient(DynamoDBDocumentClient);
  /** เรียกก่อนทุก write — ใช้จำลองการแก้ไขพร้อมกัน */
  beforeWrite?: () => void;
  transactCalls = 0;

  constructor() {
    this.mock.on(GetCommand).callsFake((i) => this.get(i));
    this.mock.on(PutCommand).callsFake((i) => this.single(() => this.put(i)));
    this.mock.on(DeleteCommand).callsFake((i) => this.single(() => this.delete(i)));
    this.mock.on(UpdateCommand).callsFake((i) => this.single(() => this.update(i)));
    this.mock.on(QueryCommand).callsFake((i) => this.query(i));
    this.mock.on(TransactWriteCommand).callsFake((i) => this.transact(i));
    this.mock.on(BatchGetCommand).callsFake((i) => this.batchGet(i));
    this.mock.on(BatchWriteCommand).callsFake((i) => this.batchWrite(i));
  }

  restore() {
    this.mock.restore();
  }

  /** items ของ user หนึ่ง (เรียงตาม SK) */
  partition(pk: string): Item[] {
    return [...this.items.values()].filter((i) => i.PK === pk).sort((a, b) => cmp(a.SK, b.SK));
  }

  /* ------------------------------ conditions ------------------------------ */

  private check(item: Item | undefined, expr: string | undefined, names: Names, values: Values) {
    if (!expr) return true;
    return expr.split(' AND ').every((raw) => {
      const term = raw.trim();
      let m = /^attribute_exists\((\S+)\)$/.exec(term);
      if (m) return item !== undefined && attr(item, m[1]!, names) !== undefined;
      m = /^attribute_not_exists\((\S+)\)$/.exec(term);
      if (m) return item === undefined || attr(item, m[1]!, names) === undefined;
      m = /^(\S+) = (:\w+)$/.exec(term);
      if (m) return item !== undefined && attr(item, m[1]!, names) === values?.[m[2]!];
      throw new Error(`FakeDynamo: unsupported condition "${term}"`);
    });
  }

  /* -------------------------------- writes -------------------------------- */

  private single(fn: () => () => void) {
    this.beforeWrite?.();
    const commit = fn();
    commit();
    return {};
  }

  private fail() {
    return new ConditionalCheckFailedException({
      message: 'The conditional request failed',
      $metadata: {},
    });
  }

  private put(i: {
    Item?: Item;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Names;
    ExpressionAttributeValues?: Values;
  }) {
    const item = i.Item!;
    if (
      !this.check(
        this.items.get(keyOf(item)),
        i.ConditionExpression,
        i.ExpressionAttributeNames,
        i.ExpressionAttributeValues,
      )
    )
      throw this.fail();
    return () => void this.items.set(keyOf(item), clone(item));
  }

  private delete(i: {
    Key?: Item;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Names;
    ExpressionAttributeValues?: Values;
  }) {
    const k = keyOf(i.Key!);
    if (
      !this.check(
        this.items.get(k),
        i.ConditionExpression,
        i.ExpressionAttributeNames,
        i.ExpressionAttributeValues,
      )
    )
      throw this.fail();
    return () => void this.items.delete(k);
  }

  private update(i: {
    Key?: Item;
    UpdateExpression?: string;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Names;
    ExpressionAttributeValues?: Values;
  }) {
    const k = keyOf(i.Key!);
    const current = this.items.get(k);
    if (
      !this.check(
        current,
        i.ConditionExpression,
        i.ExpressionAttributeNames,
        i.ExpressionAttributeValues,
      )
    )
      throw this.fail();
    const m = /^ADD (.+)$/.exec(i.UpdateExpression ?? '');
    if (!m) throw new Error(`FakeDynamo: unsupported update "${i.UpdateExpression}"`);
    const ops = m[1]!.split(', ').map((p) => {
      const [name, value] = p.trim().split(' ');
      return {
        name: resolveName(name!, i.ExpressionAttributeNames),
        value: i.ExpressionAttributeValues?.[value!],
      };
    });
    const seen = new Set<string>();
    for (const op of ops) {
      if (seen.has(op.name)) throw new Error('ValidationException: Two document paths overlap');
      seen.add(op.name);
      if (typeof op.value !== 'number') throw new Error('FakeDynamo: ADD supports numbers only');
    }
    return () => {
      const next: Item = current ? clone(current) : { PK: i.Key!.PK, SK: i.Key!.SK };
      for (const op of ops)
        next[op.name] = ((next[op.name] as number | undefined) ?? 0) + (op.value as number);
      this.items.set(k, next);
    };
  }

  private transact(i: { TransactItems?: Record<string, never>[] }) {
    this.transactCalls++;
    const list = i.TransactItems ?? [];
    if (list.length > 100)
      throw new Error('ValidationException: Member must have length less than or equal to 100');
    const keys = list.map((t) => {
      const op = (t.Put ?? t.Delete ?? t.Update ?? t.ConditionCheck) as unknown as {
        Item?: Item;
        Key?: Item;
      };
      return keyOf(op.Item ?? op.Key!);
    });
    if (new Set(keys).size !== keys.length) {
      throw new Error(
        'ValidationException: Transaction request cannot include multiple operations on one item',
      );
    }
    this.beforeWrite?.();

    const commits: (() => void)[] = [];
    const reasons = list.map((t) => {
      try {
        if (t.Put) commits.push(this.put(t.Put));
        else if (t.Delete) commits.push(this.delete(t.Delete));
        else if (t.Update) commits.push(this.update(t.Update));
        else if (t.ConditionCheck) {
          const c = t.ConditionCheck as {
            Key: Item;
            ConditionExpression: string;
            ExpressionAttributeNames?: Names;
            ExpressionAttributeValues?: Values;
          };
          if (
            !this.check(
              this.items.get(keyOf(c.Key)),
              c.ConditionExpression,
              c.ExpressionAttributeNames,
              c.ExpressionAttributeValues,
            )
          )
            throw this.fail();
        }
        return { Code: 'None' };
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) return { Code: 'ConditionalCheckFailed' };
        throw e;
      }
    });
    if (reasons.some((r) => r.Code !== 'None')) {
      throw new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: reasons,
      });
    }
    for (const c of commits) c();
    return {};
  }

  private batchWrite(i: { RequestItems?: Record<string, { DeleteRequest?: { Key: Item } }[]> }) {
    for (const reqs of Object.values(i.RequestItems ?? {})) {
      if (reqs.length > 25) throw new Error('ValidationException: too many items');
      for (const r of reqs) {
        if (!r.DeleteRequest) throw new Error('FakeDynamo: only DeleteRequest supported');
        this.items.delete(keyOf(r.DeleteRequest.Key));
      }
    }
    return { UnprocessedItems: {} };
  }

  /* --------------------------------- reads -------------------------------- */

  private get(i: { Key?: Item }) {
    const item = this.items.get(keyOf(i.Key!));
    return { Item: item ? clone(item) : undefined };
  }

  private batchGet(i: { RequestItems?: Record<string, { Keys: Item[] }> }) {
    const Responses: Record<string, Item[]> = {};
    for (const [table, req] of Object.entries(i.RequestItems ?? {})) {
      if (req.Keys.length > 100) throw new Error('ValidationException: too many keys');
      Responses[table] = req.Keys.flatMap((k) => {
        const item = this.items.get(keyOf(k));
        return item ? [clone(item)] : [];
      });
    }
    return { Responses, UnprocessedKeys: {} };
  }

  private query(i: {
    KeyConditionExpression?: string;
    FilterExpression?: string;
    ExpressionAttributeValues?: Values;
    ExpressionAttributeNames?: Names;
    ScanIndexForward?: boolean;
    Limit?: number;
    ExclusiveStartKey?: Item;
  }) {
    const v = i.ExpressionAttributeValues ?? {};
    const kce = i.KeyConditionExpression ?? '';
    let skMatch: (sk: string) => boolean;
    let m: RegExpExecArray | null;
    if (kce === 'PK = :pk') skMatch = () => true;
    else if ((m = /^PK = :pk AND begins_with\(SK, (:\w+)\)$/.exec(kce))) {
      const prefix = String(v[m[1]!]);
      skMatch = (sk) => sk.startsWith(prefix);
    } else if ((m = /^PK = :pk AND SK BETWEEN (:\w+) AND (:\w+)$/.exec(kce))) {
      const lo = String(v[m[1]!]);
      const hi = String(v[m[2]!]);
      skMatch = (sk) => cmp(sk, lo) >= 0 && cmp(sk, hi) <= 0;
    } else throw new Error(`FakeDynamo: unsupported key condition "${kce}"`);

    let rows = this.partition(String(v[':pk'])).filter((r) => skMatch(r.SK));
    if (i.ScanIndexForward === false) rows.reverse();
    if (i.ExclusiveStartKey) {
      const start = i.ExclusiveStartKey.SK as string;
      rows = rows.filter((r) =>
        i.ScanIndexForward === false ? cmp(r.SK, start) < 0 : cmp(r.SK, start) > 0,
      );
    }
    // เหมือน DynamoDB: Limit นับก่อน filter
    const evaluated = i.Limit ? rows.slice(0, i.Limit) : rows;
    const more = i.Limit !== undefined && rows.length > i.Limit;
    const items = evaluated.filter((r) =>
      this.check(r, i.FilterExpression, i.ExpressionAttributeNames, i.ExpressionAttributeValues),
    );
    const last = evaluated.at(-1);
    return {
      Items: items.map(clone),
      LastEvaluatedKey: more && last ? { PK: last.PK, SK: last.SK } : undefined,
    };
  }
}

function resolveName(token: string, names: Names): string {
  if (token.startsWith('#')) {
    const n = names?.[token];
    if (n === undefined) throw new Error(`FakeDynamo: missing name ${token}`);
    return n;
  }
  return token;
}

function attr(item: Item, token: string, names: Names): unknown {
  return item[resolveName(token, names)];
}

/** DynamoDB เรียง string ตาม UTF-8 bytes */
function cmp(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
