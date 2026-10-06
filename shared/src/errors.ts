export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** รูปแบบ error เดียวของทั้งระบบ */
export interface ApiError {
  code: ErrorCode;
  message: string;
}

/** ข้อความภาษาไทยมาตรฐาน (ใช้ทั้งฝั่ง api และเป็น fallback ฝั่ง web) */
export const ERROR_MESSAGES_TH: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  UNAUTHORIZED: 'กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',
  CONFLICT: 'ข้อมูลถูกเปลี่ยนแปลงไปแล้ว กรุณาลองใหม่',
  IDEMPOTENCY_CONFLICT: 'รายการนี้ถูกบันทึกไปแล้วด้วยข้อมูลที่ต่างกัน',
  PAYLOAD_TOO_LARGE: 'ข้อมูลมีขนาดใหญ่เกินไป',
  RATE_LIMITED: 'มีการใช้งานถี่เกินไป กรุณารอสักครู่',
  INTERNAL_ERROR: 'ระบบขัดข้อง กรุณาลองใหม่ภายหลัง',
};

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).message === 'string' &&
    (ERROR_CODES as readonly string[]).includes((value as ApiError).code)
  );
}
