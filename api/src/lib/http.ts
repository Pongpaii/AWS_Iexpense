import {
  ERROR_MESSAGES_TH,
  HTTP_STATUS_BY_CODE,
  formatZodError,
  type ApiError,
  type ErrorCode,
} from '@money-flow/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import type { z } from 'zod';

export type HttpEvent = APIGatewayProxyEventV2WithJWTAuthorizer;
export type HttpResult = APIGatewayProxyStructuredResultV2;

/** ขนาด body สูงสุดที่ยอมรับ (bulk-delete 100 ULID ≈ 3KB, settings ≈ 5KB) */
export const MAX_BODY_BYTES = 32 * 1024;

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

/** error ที่ตั้งใจส่งให้ผู้ใช้ — message ต้องเป็นภาษาไทยและไม่มีข้อมูลภายใน */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = ERROR_MESSAGES_TH[code],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResult {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, ...headers },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

export function errorResponse(code: ErrorCode, message?: string): HttpResult {
  const body: ApiError = { code, message: message ?? ERROR_MESSAGES_TH[code] };
  return json(HTTP_STATUS_BY_CODE[code], body);
}

/**
 * userId มาจาก JWT claim `sub` ที่ API Gateway ตรวจลายเซ็นแล้วเท่านั้น
 * ไม่อ่านจาก body/query/header ใด ๆ
 */
export function getUserId(event: HttpEvent): string {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(sub)) {
    throw new HttpError('UNAUTHORIZED');
  }
  return sub;
}

/** อ่าน JSON body อย่างปลอดภัย (จำกัดขนาด, รองรับ base64) แล้ว validate ด้วย Zod */
export function parseBody<S extends z.ZodType>(event: HttpEvent, schema: S): z.output<S> {
  let raw = event.body ?? '';
  if (event.isBase64Encoded && raw) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new HttpError('PAYLOAD_TOO_LARGE');

  let data: unknown;
  try {
    data = raw === '' ? {} : JSON.parse(raw);
  } catch {
    throw new HttpError('VALIDATION_ERROR', 'รูปแบบข้อมูล JSON ไม่ถูกต้อง');
  }
  return validate(schema, data);
}

export function parseQuery<S extends z.ZodType>(event: HttpEvent, schema: S): z.output<S> {
  return validate(schema, event.queryStringParameters ?? {});
}

export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError('VALIDATION_ERROR', formatZodError(result.error).message);
  }
  return result.data;
}

/**
 * ห่อ handler: แปลง HttpError → JSON `{code,message}`; error อื่น log ภายในแล้วตอบ 500
 * โดยไม่ส่ง stack trace/รายละเอียดออกไป
 */
export function withErrorHandling(
  handler: (event: HttpEvent) => Promise<HttpResult>,
): (event: HttpEvent) => Promise<HttpResult> {
  return async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.code, err.message);
      console.error(
        JSON.stringify({
          level: 'error',
          requestId: event.requestContext?.requestId,
          routeKey: event.routeKey,
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        }),
      );
      return errorResponse('INTERNAL_ERROR');
    }
  };
}
