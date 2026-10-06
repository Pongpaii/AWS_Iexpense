import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Document client เดียวต่อ container (reuse connection ข้าม invocation) */
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }), {
  marshallOptions: { removeUndefinedValues: true },
});

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error('TABLE_NAME is not configured');
  return name;
}

/* ------------------------------ Key builders ------------------------------ */
// PK ทุก item มาจาก JWT sub เท่านั้น → user หนึ่งเข้าถึง partition ของ user อื่นไม่ได้

export const pk = (userId: string) => `USER#${userId}`;
export const txSk = (date: string, id: string) => `TX#${date}#${id}`;
/** pointer: id → SK จริง (เพราะ SK มีวันที่ ซึ่งแก้ไขได้) */
export const txIdSk = (id: string) => `TXID#${id}`;
export const idempSk = (key: string) => `IDEMP#${key.toLowerCase()}`;
export const monthSumSk = (month: string) => `SUM#${month}`;
/** ยอดสะสมทั้งหมด (สำหรับ GET /summary/balance ใน 1 request) */
export const ALL_SUM_SK = 'SUM#ALL';
export const SETTINGS_SK = 'SETTINGS';
export const badgeSk = (badgeId: string) => `BADGE#${badgeId}`;

export const TX_PREFIX = 'TX#';
export const BADGE_PREFIX = 'BADGE#';

export interface Key {
  PK: string;
  SK: string;
}
