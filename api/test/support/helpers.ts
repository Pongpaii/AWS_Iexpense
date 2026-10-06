import { randomUUID } from 'node:crypto';
import type { HttpEvent, HttpResult } from '../../src/lib/http';

export const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

export interface CallOptions {
  sub?: string;
  body?: unknown;
  query?: Record<string, string>;
  id?: string;
}

export interface CallResult<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
  raw: string;
}

/** สร้าง event แบบ API Gateway HTTP API (payload v2) ที่ผ่าน JWT authorizer แล้ว */
export function makeEvent(routeKey: string, opts: CallOptions = {}): HttpEvent {
  const [, path = ''] = routeKey.split(' ');
  return {
    version: '2.0',
    routeKey,
    rawPath: path.replace('{id}', opts.id ?? ''),
    rawQueryString: new URLSearchParams(opts.query ?? {}).toString(),
    headers: { 'content-type': 'application/json' },
    queryStringParameters: opts.query,
    pathParameters: opts.id !== undefined ? { id: opts.id } : undefined,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      requestId: randomUUID(),
      routeKey,
      authorizer: {
        jwt: { claims: { sub: opts.sub ?? USER_A, username: opts.sub ?? USER_A }, scopes: [] },
        principalId: '',
        integrationLatency: 0,
      },
    },
  } as unknown as HttpEvent;
}

export function makeCaller(handler: (e: HttpEvent) => Promise<HttpResult>) {
  return async <T = Record<string, unknown>>(
    routeKey: string,
    opts: CallOptions = {},
  ): Promise<CallResult<T>> => {
    const res = await handler(makeEvent(routeKey, opts));
    const raw = typeof res.body === 'string' ? res.body : '';
    const isJson = String(res.headers?.['content-type'] ?? '').startsWith('application/json');
    return {
      status: res.statusCode ?? 0,
      body: (isJson && raw ? JSON.parse(raw) : raw) as T,
      headers: (res.headers ?? {}) as Record<string, string>,
      raw,
    };
  };
}

export function txBody(overrides: Record<string, unknown> = {}) {
  return {
    description: 'ข้าวมันไก่',
    amount: 50,
    type: 'expense',
    category: 'อาหาร',
    transactionDate: '2026-10-01',
    clientTimezone: 'Asia/Bangkok',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}
