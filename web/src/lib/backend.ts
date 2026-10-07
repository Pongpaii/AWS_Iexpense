import type {
  Transaction as ApiTransaction,
  TransactionCreateInput,
  TransactionUpdateInput,
} from '@money-flow/shared'
import { ApiClientError, createApiClient } from '../aws/client'
import { configureAuth, getAccessToken } from '../aws/auth'
import { loadConfig } from '../aws/config'
import { createEndpoints, type Endpoints } from '../aws/endpoints'
import type { Transaction, TransactionCategory, TransactionInput } from '../types/transaction'

/**
 * ชั้นเชื่อมระหว่างหน้าจอเดิม (ที่เคยคุยกับ Supabase) กับ AWS API
 *
 * หน้าจอยังใช้ Transaction แบบ snake_case เหมือนเดิม ไฟล์นี้แปลงไป-กลับกับ
 * รูปแบบของ API (camelCase, id เป็น ULID, จำนวนเงินเป็นบาทจำนวนเต็ม)
 * timeout / retry / refresh token อยู่ใน aws/client.ts แล้ว ที่นี่จึงไม่ต้อง retry ซ้ำ
 */

const config = loadConfig()

export const isBackendConfigured = config.ok
export const backendConfigError = config.ok ? '' : config.message

if (config.ok) configureAuth(config.config)

let sessionExpiredHandler: (() => void) | null = null

/** useAuth ลงทะเบียนไว้: เรียกเมื่อ refresh token ใช้ไม่ได้แล้ว */
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  sessionExpiredHandler = handler
}

export const api: Endpoints | null = config.ok
  ? createEndpoints(
      createApiClient({
        baseUrl: config.config.apiUrl,
        getToken: getAccessToken,
        onSessionExpired: () => sessionExpiredHandler?.(),
      }),
    )
  : null

/* ------------------------------- แปลงข้อมูล ------------------------------- */

export const PENDING_ID_PREFIX = 'pending:'

export const isPendingId = (id: string) => id.startsWith(PENDING_ID_PREFIX)

export const toUiTransaction = (t: ApiTransaction, userId: string): Transaction => ({
  id: t.id,
  user_id: userId,
  description: t.description,
  amount: t.amount,
  type: t.type,
  // API เก็บหมวดเป็นข้อความอิสระ หน้าจอใช้ชุดหมวดของตัวเอง หมวดที่ไม่รู้จักแสดงเป็นป้ายทั่วไป
  category: (t.category as TransactionCategory | null) ?? null,
  transaction_date: t.transactionDate,
  created_at: t.createdAt,
  idempotency_key: t.idempotencyKey,
  deleted_at: t.deletedAt,
  client_timezone: t.clientTimezone,
})

/** API รับเฉพาะบาทจำนวนเต็ม ฟอร์มตรวจแล้วแต่ปัดอีกชั้นกันค่าที่มาจากคิวเก่า */
const toBaht = (amount: number) => Math.round(Number(amount))

export const toCreateBody = (
  input: TransactionInput,
  idempotencyKey: string,
): TransactionCreateInput => ({
  description: input.description,
  amount: toBaht(input.amount),
  type: input.type,
  category: input.category,
  transactionDate: input.transaction_date,
  clientTimezone: input.client_timezone ?? null,
  idempotencyKey,
})

export const toUpdateBody = (input: TransactionInput): TransactionUpdateInput => ({
  description: input.description,
  amount: toBaht(input.amount),
  type: input.type,
  category: input.category,
  transactionDate: input.transaction_date,
})

/* --------------------------------- อ่านข้อมูล -------------------------------- */

/** API ให้หน้าละไม่เกิน 100 แถว */
const PAGE_SIZE = 100
/** กันลูปไม่จบถ้าเซิร์ฟเวอร์ตอบผิดปกติ: 100 * 1000 = 100,000 แถว */
const MAX_PAGES = 1000

export interface FetchOptions {
  from?: string
  to?: string
  /** เรียกเมื่อได้หน้าแรก ให้หน้าจอวาดได้ก่อนโหลดครบ */
  onFirstPage?: (rows: Transaction[]) => void
}

/** ดึงรายการทั้งหมดในช่วงที่กำหนด (ใหม่สุดก่อน) โดยไล่ cursor จนหมด */
export async function fetchTransactions(
  endpoints: Endpoints,
  userId: string,
  { from, to, onFirstPage }: FetchOptions = {},
): Promise<Transaction[]> {
  const rows: Transaction[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await endpoints.listTransactions({ from, to, cursor, limit: PAGE_SIZE })
    rows.push(...res.items.map((t) => toUiTransaction(t, userId)))
    if (page === 0) onFirstPage?.([...rows])
    if (!res.nextCursor) break
    cursor = res.nextCursor
  }
  return rows
}

/* ---------------------------------- error ---------------------------------- */

/** ปัญหาชั่วคราว (เน็ต/timeout/429/5xx): เก็บเข้าคิวหรือลองใหม่ภายหลังได้ */
export const isTransientError = (error: unknown) =>
  error instanceof ApiClientError ? error.transient : error instanceof TypeError

export const isOfflineError = (error: unknown) =>
  error instanceof ApiClientError && error.code === 'OFFLINE'

export const isUnauthorizedError = (error: unknown) =>
  error instanceof ApiClientError && (error.status === 401 || error.code === 'UNAUTHORIZED')

export const errorStatus = (error: unknown) => (error instanceof ApiClientError ? error.status : 0)

export { ApiClientError }
