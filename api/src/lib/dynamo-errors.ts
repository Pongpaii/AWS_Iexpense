import { HttpError } from './http';

const hasName = (err: unknown, ...names: string[]) =>
  typeof err === 'object' && err !== null && names.includes((err as { name?: string }).name ?? '');

export const isConditionalFailure = (err: unknown) =>
  hasName(err, 'ConditionalCheckFailedException');

export const isTransactionCanceled = (err: unknown) => hasName(err, 'TransactionCanceledException');

/** reason code ของแต่ละ item ใน TransactWriteItems ที่ถูกยกเลิก */
export function cancellationCodes(err: unknown): (string | undefined)[] {
  const reasons = (err as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return Array.isArray(reasons) ? reasons.map((r) => r.Code) : [];
}

/** error ชั่วคราวของ DynamoDB ที่ควรแจ้งผู้ใช้ให้ลองใหม่ แทนที่จะเป็น 500 */
export function mapDynamoError(err: unknown): never {
  if (
    hasName(
      err,
      'ProvisionedThroughputExceededException',
      'ThrottlingException',
      'RequestLimitExceeded',
    )
  ) {
    throw new HttpError('RATE_LIMITED');
  }
  if (hasName(err, 'TransactionConflictException')) throw new HttpError('CONFLICT');
  if (isTransactionCanceled(err)) {
    const codes = cancellationCodes(err);
    if (codes.includes('ThrottlingError')) throw new HttpError('RATE_LIMITED');
    if (codes.some((c) => c === 'ConditionalCheckFailed' || c === 'TransactionConflict')) {
      throw new HttpError('CONFLICT');
    }
  }
  throw err;
}
