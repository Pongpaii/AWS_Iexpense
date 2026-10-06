import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler as accountHandler } from '../src/handlers/account';
import { handler as apiHandler } from '../src/handlers/api';
import { FakeDynamo } from './support/fake-dynamo';
import { USER_A, USER_B, makeCaller, txBody } from './support/helpers';

const api = makeCaller(apiHandler);
const account = makeCaller(accountHandler);
const cognito = mockClient(CognitoIdentityProviderClient);
let db: FakeDynamo;

beforeEach(() => {
  db = new FakeDynamo();
  cognito.reset();
  cognito.on(AdminDeleteUserCommand).resolves({});
});
afterEach(() => db.restore());

describe('DELETE /account', () => {
  it('ต้องพิมพ์ยืนยัน', async () => {
    const res = await account('DELETE /account', { body: { confirm: 'yes' } });
    expect(res.status).toBe(400);
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
  });

  it('ลบข้อมูลทั้งหมดของตัวเอง + Cognito user; ข้อมูล user อื่นไม่ถูกแตะ', async () => {
    for (let i = 0; i < 30; i++) await api('POST /transactions', { body: txBody() });
    await api('PUT /settings', { body: { monthlySalary: 20000 } });
    await api('POST /achievements', { body: { badgeId: 'first-tx' } });
    await api('POST /transactions', { sub: USER_B, body: txBody() });
    const bBefore = JSON.stringify(db.partition(`USER#${USER_B}`));

    const res = await account('DELETE /account', { body: { confirm: 'ลบบัญชี' } });
    expect(res.status).toBe(200);
    expect(db.partition(`USER#${USER_A}`)).toEqual([]);
    expect(JSON.stringify(db.partition(`USER#${USER_B}`))).toBe(bBefore);

    const calls = cognito.commandCalls(AdminDeleteUserCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({
      UserPoolId: 'ap-southeast-1_TEST',
      Username: USER_A,
    });
  });

  it('route อื่นที่หลงมา → 404', async () => {
    expect((await account('GET /account')).status).toBe(404);
  });
});
