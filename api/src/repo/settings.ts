import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { defaultSettings, type SettingsData, type UserSettings } from '@money-flow/shared';
import { SETTINGS_SK, ddb, pk, tableName } from '../lib/db';

export async function getSettings(userId: string): Promise<UserSettings> {
  const res = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: { PK: pk(userId), SK: SETTINGS_SK } }),
  );
  if (!res.Item) return defaultSettings();
  // เติม default ให้ field ที่เพิ่มใหม่ภายหลัง (เผื่อ item เก่า)
  const { data, updatedAt } = res.Item as { data: Partial<SettingsData>; updatedAt: string };
  return { ...defaultSettings(), ...data, updatedAt };
}

export async function putSettings(
  userId: string,
  data: SettingsData,
  now: Date = new Date(),
): Promise<UserSettings> {
  const updatedAt = now.toISOString();
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: pk(userId), SK: SETTINGS_SK, entity: 'SETTINGS', data, updatedAt },
    }),
  );
  return { ...data, updatedAt };
}
