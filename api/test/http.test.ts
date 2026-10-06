import { transactionCreateSchema } from '@money-flow/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  MAX_BODY_BYTES,
  getUserId,
  parseBody,
  withErrorHandling,
  type HttpEvent,
} from '../src/lib/http';

const SUB = '11111111-2222-3333-4444-555555555555';

function event(overrides: Partial<HttpEvent> = {}, ...subArg: [unknown?]): HttpEvent {
  const sub = subArg.length ? subArg[0] : SUB;
  return {
    version: '2.0',
    routeKey: 'POST /transactions',
    rawPath: '/transactions',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      requestId: 'req-1',
      authorizer: { jwt: { claims: { sub }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
    ...overrides,
  } as HttpEvent;
}

describe('getUserId', () => {
  it('อ่านจาก JWT claim sub', () => {
    expect(getUserId(event())).toBe(SUB);
  });

  it('ไม่สนใจ userId ใน body/query', () => {
    const e = event({
      body: JSON.stringify({ userId: 'attacker' }),
      queryStringParameters: { userId: 'attacker' },
    });
    expect(getUserId(e)).toBe(SUB);
  });

  it.each([undefined, '', 'not-a-uuid', 123])('sub = %j → UNAUTHORIZED', (sub) => {
    expect(() => getUserId(event({}, sub))).toThrowError(HttpError);
  });
});

describe('parseBody', () => {
  it('JSON เสีย → VALIDATION_ERROR ภาษาไทย', () => {
    expect(() => parseBody(event({ body: '{bad' }), transactionCreateSchema)).toThrowError(
      'รูปแบบข้อมูล JSON ไม่ถูกต้อง',
    );
  });

  it('body ใหญ่เกิน → PAYLOAD_TOO_LARGE', () => {
    const e = event({ body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(() => parseBody(e, transactionCreateSchema)).toThrowError(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
    );
  });

  it('รองรับ base64 body', () => {
    const body = Buffer.from(
      JSON.stringify({
        description: 'ชา',
        amount: 25,
        type: 'expense',
        transactionDate: '2024-01-01',
        idempotencyKey: '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f',
      }),
    ).toString('base64');
    const out = parseBody(event({ body, isBase64Encoded: true }), transactionCreateSchema);
    expect(out.amount).toBe(25);
  });
});

describe('withErrorHandling', () => {
  it('HttpError → JSON {code,message}', async () => {
    const h = withErrorHandling(async () => {
      throw new HttpError('NOT_FOUND');
    });
    const res = await h(event());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({
      code: 'NOT_FOUND',
      message: 'ไม่พบข้อมูลที่ต้องการ',
    });
  });

  it('error ไม่คาดคิด → 500 โดยไม่ leak stack/message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = withErrorHandling(async () => {
      throw new Error('ConditionalCheckFailed at secret-table arn:aws:dynamodb:...');
    });
    const res = await h(event());
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret-table');
    expect(res.body).not.toContain('at ');
    expect(JSON.parse(res.body as string).code).toBe('INTERNAL_ERROR');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
