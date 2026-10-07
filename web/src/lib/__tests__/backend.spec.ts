import { describe, expect, it, vi } from 'vitest'
import type { Endpoints } from '../../aws/endpoints'
import {
  ApiClientError,
  fetchTransactions,
  isPendingId,
  isTransientError,
  isUnauthorizedError,
  toCreateBody,
  toUiTransaction,
  toUpdateBody,
} from '../backend'

const apiTx = {
  id: '01J9Z8X7W6V5T4S3R2Q1P0N9M8',
  description: 'ข้าวมันไก่',
  amount: 50,
  type: 'expense' as const,
  category: 'อาหาร',
  transactionDate: '2026-10-06',
  clientTimezone: 'Asia/Bangkok',
  idempotencyKey: '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f',
  createdAt: '2026-10-06T05:00:00.000Z',
  updatedAt: '2026-10-06T05:00:00.000Z',
  deletedAt: null,
}

const input = {
  description: 'ข้าวมันไก่',
  amount: 50,
  type: 'expense' as const,
  category: 'อาหาร' as const,
  transaction_date: '2026-10-06',
  client_timezone: 'Asia/Bangkok',
}

describe('backend adapter', () => {
  it('แปลง Transaction ของ API เป็นรูปแบบของหน้าจอ', () => {
    expect(toUiTransaction(apiTx, 'user-1')).toEqual({
      id: apiTx.id,
      user_id: 'user-1',
      description: 'ข้าวมันไก่',
      amount: 50,
      type: 'expense',
      category: 'อาหาร',
      transaction_date: '2026-10-06',
      created_at: '2026-10-06T05:00:00.000Z',
      idempotency_key: apiTx.idempotencyKey,
      deleted_at: null,
      client_timezone: 'Asia/Bangkok',
    })
  })

  it('สร้าง body ของ POST/PATCH แบบ camelCase และปัดเป็นบาทจำนวนเต็ม', () => {
    expect(toCreateBody({ ...input, amount: 49.6 }, 'key')).toEqual({
      description: 'ข้าวมันไก่',
      amount: 50,
      type: 'expense',
      category: 'อาหาร',
      transactionDate: '2026-10-06',
      clientTimezone: 'Asia/Bangkok',
      idempotencyKey: 'key',
    })
    // PATCH ห้ามส่ง idempotencyKey/clientTimezone (strict schema)
    expect(toUpdateBody(input)).toEqual({
      description: 'ข้าวมันไก่',
      amount: 50,
      type: 'expense',
      category: 'อาหาร',
      transactionDate: '2026-10-06',
    })
  })

  it('ไล่ cursor จนหมด และเรียก onFirstPage ครั้งเดียว', async () => {
    const listTransactions = vi
      .fn()
      .mockResolvedValueOnce({ items: [apiTx], nextCursor: 'abc' })
      .mockResolvedValueOnce({ items: [apiTx], nextCursor: null })
    const onFirstPage = vi.fn()

    const rows = await fetchTransactions({ listTransactions } as unknown as Endpoints, 'u', {
      from: '2026-10-01',
      to: '2026-10-31',
      onFirstPage,
    })

    expect(rows).toHaveLength(2)
    expect(onFirstPage).toHaveBeenCalledOnce()
    expect(listTransactions).toHaveBeenNthCalledWith(2, {
      from: '2026-10-01',
      to: '2026-10-31',
      cursor: 'abc',
      limit: 100,
    })
  })

  it('จำแนก error: ชั่วคราว / หมดอายุ / แถวรอซิงก์', () => {
    expect(isTransientError(new ApiClientError('NETWORK', 'x'))).toBe(true)
    expect(isTransientError(new ApiClientError('INTERNAL_ERROR', 'x', 503))).toBe(true)
    expect(isTransientError(new ApiClientError('VALIDATION_ERROR', 'x', 400))).toBe(false)
    expect(isUnauthorizedError(new ApiClientError('UNAUTHORIZED', 'x', 401))).toBe(true)
    expect(isPendingId('pending:abc')).toBe(true)
    expect(isPendingId(apiTx.id)).toBe(false)
  })
})
