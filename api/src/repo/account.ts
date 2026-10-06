import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, pk, tableName, type Key } from '../lib/db';
import { HttpError } from '../lib/http';

/** ลบทุก item ใน partition ของ user (transaction, summary, settings, badge, idempotency) */
export async function deleteAllUserData(userId: string): Promise<number> {
  let deleted = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk(userId) },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: start,
      }),
    );
    const keys = (res.Items ?? []) as Key[];
    for (let i = 0; i < keys.length; i += 25) {
      await batchDelete(keys.slice(i, i + 25));
    }
    deleted += keys.length;
    start = res.LastEvaluatedKey;
  } while (start);
  return deleted;
}

async function batchDelete(keys: Key[]): Promise<void> {
  let pending = keys.map((k) => ({ DeleteRequest: { Key: { PK: k.PK, SK: k.SK } } }));
  for (let attempt = 0; pending.length > 0 && attempt < 6; attempt++) {
    const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [tableName()]: pending } }));
    pending = (res.UnprocessedItems?.[tableName()] ?? []) as typeof pending;
    if (pending.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
  }
  if (pending.length > 0) throw new HttpError('RATE_LIMITED');
}
