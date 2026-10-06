import {
  achievementSchema,
  balanceSchema,
  bulkDeleteResultSchema,
  monthlySummarySchema,
  settingsSchema,
  transactionPageSchema,
  transactionSchema,
  type SettingsInput,
  type TransactionCreateInput,
  type TransactionUpdateInput,
} from '@money-flow/shared';
import { z } from 'zod';
import type { ApiClient } from './client';

const achievementListSchema = z.object({ items: z.array(achievementSchema) });

/** endpoint ทั้งหมด — response ถูก validate ด้วย schema เดียวกับ server */
export function createEndpoints(client: ApiClient) {
  const { request } = client;
  const tx = (id: string) => `/transactions/${encodeURIComponent(id)}`;

  return {
    listTransactions: (q: { from?: string; to?: string; cursor?: string; limit?: number }) =>
      request('GET', '/transactions', { query: q, schema: transactionPageSchema }),
    createTransaction: (body: TransactionCreateInput) =>
      request('POST', '/transactions', { body, schema: transactionSchema }),
    updateTransaction: (id: string, body: TransactionUpdateInput) =>
      request('PATCH', tx(id), { body, schema: transactionSchema }),
    deleteTransaction: (id: string) => request('DELETE', tx(id), { schema: transactionSchema }),
    restoreTransaction: (id: string) =>
      request('POST', `${tx(id)}/restore`, { schema: transactionSchema }),
    bulkDelete: (ids: string[]) =>
      request('POST', '/transactions/bulk-delete', {
        body: { ids },
        schema: bulkDeleteResultSchema,
      }),
    balance: () => request('GET', '/summary/balance', { schema: balanceSchema }),
    monthly: (month: string) =>
      request('GET', '/summary/monthly', { query: { month }, schema: monthlySummarySchema }),
    getSettings: () => request('GET', '/settings', { schema: settingsSchema }),
    putSettings: (body: SettingsInput) =>
      request('PUT', '/settings', { body, schema: settingsSchema }),
    listAchievements: async () =>
      (await request('GET', '/achievements', { schema: achievementListSchema })).items,
    addAchievement: (badgeId: string) =>
      request('POST', '/achievements', { body: { badgeId }, schema: achievementSchema }),
    exportData: (format: 'csv' | 'json') =>
      request<string>('GET', '/export', { query: { format }, text: true }),
    /** ไม่ retry: เป็นการกระทำที่ย้อนกลับไม่ได้ */
    deleteAccount: (confirm: string) =>
      request('DELETE', '/account', { body: { confirm }, retry: false }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
