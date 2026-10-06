import { HttpError } from './http';

const TX_SK = /^TX#\d{4}-\d{2}-\d{2}#[0-9A-HJKMNP-TV-Z]{26}$/;

/** cursor = base64url(SK) — มีแค่ SK, PK มาจาก JWT เสมอ จึงใช้ cursor ข้าม user ไม่ได้ */
export function encodeCursor(sk: string): string {
  return Buffer.from(sk, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const sk = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!TX_SK.test(sk)) throw new HttpError('VALIDATION_ERROR', 'cursor ไม่ถูกต้อง');
  return sk;
}
