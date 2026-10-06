import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { UserAchievement } from '@money-flow/shared';
import { BADGE_PREFIX, badgeSk, ddb, pk, tableName } from '../lib/db';
import { isConditionalFailure } from '../lib/dynamo-errors';
import { HttpError } from '../lib/http';

/** จำนวนเหรียญสูงสุดต่อ user (กัน item บวมจาก client ที่ผิดพลาด) */
export const MAX_BADGES = 200;

export async function listAchievements(userId: string): Promise<UserAchievement[]> {
  const out: UserAchievement[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': BADGE_PREFIX },
        ExclusiveStartKey: start,
      }),
    );
    for (const i of res.Items ?? []) out.push({ badgeId: i.badgeId, earnedAt: i.earnedAt });
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

/** badge unique ต่อ user: ได้ซ้ำ → คืนอันเดิม (idempotent) */
export async function addAchievement(
  userId: string,
  badgeId: string,
  now: Date = new Date(),
): Promise<{ achievement: UserAchievement; created: boolean }> {
  const existing = await listAchievements(userId);
  const found = existing.find((a) => a.badgeId === badgeId);
  if (found) return { achievement: found, created: false };
  if (existing.length >= MAX_BADGES) {
    throw new HttpError('VALIDATION_ERROR', `เก็บเหรียญได้ไม่เกิน ${MAX_BADGES} เหรียญ`);
  }

  const achievement = { badgeId, earnedAt: now.toISOString() };
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName(),
        Item: { PK: pk(userId), SK: badgeSk(badgeId), entity: 'BADGE', ...achievement },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return { achievement, created: true };
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    // แข่งกันสร้าง: อีก request สร้างไปแล้ว
    const again = (await listAchievements(userId)).find((a) => a.badgeId === badgeId);
    if (!again) throw new HttpError('CONFLICT');
    return { achievement: again, created: false };
  }
}

export async function deleteAchievement(userId: string, badgeId: string): Promise<void> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: tableName(),
        Key: { PK: pk(userId), SK: badgeSk(badgeId) },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    if (isConditionalFailure(err)) throw new HttpError('NOT_FOUND', 'ไม่พบเหรียญนี้');
    throw err;
  }
}
