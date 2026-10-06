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
 * DELETE /account — ลบข้อมูลทั้งหมดก่อน แล้วค่อยลบ Cognito user
 * (ถ้า timeout กลางทาง ผู้ใช้ยัง login มาสั่งลบซ้ำได้)
 * Lambda นี้แยกออกมาเพื่อให้สิทธิ์ cognito-idp:AdminDeleteUser มีเฉพาะที่นี่
 */
export const handler = withErrorHandling(async (event) => {
  if (event.routeKey !== 'DELETE /account') return errorResponse('NOT_FOUND');
  const userId = getUserId(event);
  parseBody(event, accountDeleteSchema);

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
