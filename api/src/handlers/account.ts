import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { accountDeleteSchema } from '@money-flow/shared';
import {
  errorResponse,
  getUserId,
  json,
  parseBody,
  withErrorHandling,
  type HttpEvent,
} from '../lib/http';
import { deleteAllUserData } from '../repo/account';

const cognito = new CognitoIdentityProviderClient({ maxAttempts: 3 });

/** username ใน Cognito (pool ที่ login ด้วย email จะเป็น UUID เดียวกับ sub) */
function cognitoUsername(event: HttpEvent, sub: string): string {
  const claims = event.requestContext.authorizer.jwt.claims;
  const u = claims.username ?? claims['cognito:username'];
  return typeof u === 'string' && u !== '' ? u : sub;
}

/**
 * บัญชีทดลองที่ใช้ร่วมกันอยู่ใน Cognito group "demo" — ห้ามลบ ไม่งั้นคนถัดไปเข้าไม่ได้
 * HTTP API JWT authorizer ส่ง claim แบบ array เป็น string รูป "[demo admin]"
 */
function isDemoAccount(event: HttpEvent): boolean {
  const raw = event.requestContext.authorizer.jwt.claims['cognito:groups'];
  const groups = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.replace(/^\[|\]$/g, '').split(/[\s,]+/)
      : [];
  return groups.includes('demo');
}

/**
 * DELETE /account — ลบข้อมูลทั้งหมดก่อน แล้วค่อยลบ Cognito user
 * (ถ้า timeout กลางทาง ผู้ใช้ยัง login มาสั่งลบซ้ำได้)
 * Lambda นี้แยกออกมาเพื่อให้สิทธิ์ cognito-idp:AdminDeleteUser มีเฉพาะที่นี่
 */
export const handler = withErrorHandling(async (event) => {
  if (event.routeKey !== 'DELETE /account') return errorResponse('NOT_FOUND');
  const userId = getUserId(event);
  parseBody(event, accountDeleteSchema);
  if (isDemoAccount(event)) {
    return errorResponse('FORBIDDEN', 'บัญชีทดลองลบไม่ได้ สมัครบัญชีของตัวเองเพื่อลองฟีเจอร์นี้');
  }

  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error('USER_POOL_ID is not configured');

  const deletedItems = await deleteAllUserData(userId);
  try {
    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: cognitoUsername(event, userId),
      }),
    );
  } catch (err) {
    if (!(err instanceof UserNotFoundException)) throw err;
  }
  return json(200, { deletedItems });
});
