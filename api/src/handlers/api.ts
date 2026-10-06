import {
  achievementCreateSchema,
  achievementDeleteQuerySchema,
  bulkDeleteSchema,
  exportQuerySchema,
  monthlySummaryQuerySchema,
  settingsInputSchema,
  transactionCreateSchema,
  transactionIdSchema,
  transactionListQuerySchema,
  transactionUpdateSchema,
} from '@money-flow/shared';
import { toCsv } from '../lib/export';
import {
  HttpError,
  errorResponse,
  getUserId,
  json,
  parseBody,
  parseQuery,
  withErrorHandling,
  type HttpEvent,
  type HttpResult,
} from '../lib/http';
import { addAchievement, deleteAchievement, listAchievements } from '../repo/achievements';
import { getSettings, putSettings } from '../repo/settings';
import {
  bulkDeleteTransactions,
  createTransaction,
  deleteTransaction,
  getBalance,
  getMonthlySummary,
  listAllTransactions,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from '../repo/transactions';

type Route = (event: HttpEvent, userId: string) => Promise<HttpResult>;

/** id ใน path: รูปแบบผิด → 404 เหมือนไม่พบ (ไม่บอกใบ้โครงสร้างข้อมูล) */
function pathId(event: HttpEvent): string {
  const r = transactionIdSchema.safeParse(event.pathParameters?.id);
  if (!r.success) throw new HttpError('NOT_FOUND', 'ไม่พบรายการนี้');
  return r.data;
}

export const routes: Record<string, Route> = {
  'GET /transactions': async (e, uid) =>
    json(200, await listTransactions(uid, parseQuery(e, transactionListQuerySchema))),

  'POST /transactions': async (e, uid) => {
    const { transaction, replayed } = await createTransaction(
      uid,
      parseBody(e, transactionCreateSchema),
    );
    return json(
      replayed ? 200 : 201,
      transaction,
      replayed ? { 'idempotent-replayed': 'true' } : {},
    );
  },

  'PATCH /transactions/{id}': async (e, uid) => {
    const id = pathId(e);
    return json(200, await updateTransaction(uid, id, parseBody(e, transactionUpdateSchema)));
  },

  'DELETE /transactions/{id}': async (e, uid) => json(200, await deleteTransaction(uid, pathId(e))),

  'POST /transactions/{id}/restore': async (e, uid) =>
    json(200, await restoreTransaction(uid, pathId(e))),

  'POST /transactions/bulk-delete': async (e, uid) =>
    json(200, await bulkDeleteTransactions(uid, parseBody(e, bulkDeleteSchema).ids)),

  'GET /summary/balance': async (_e, uid) => json(200, await getBalance(uid)),

  'GET /summary/monthly': async (e, uid) =>
    json(200, await getMonthlySummary(uid, parseQuery(e, monthlySummaryQuerySchema).month)),

  'GET /settings': async (_e, uid) => json(200, await getSettings(uid)),

  'PUT /settings': async (e, uid) =>
    json(200, await putSettings(uid, parseBody(e, settingsInputSchema))),

  'GET /achievements': async (_e, uid) => json(200, { items: await listAchievements(uid) }),

  'POST /achievements': async (e, uid) => {
    const { achievement, created } = await addAchievement(
      uid,
      parseBody(e, achievementCreateSchema).badgeId,
    );
    return json(created ? 201 : 200, achievement);
  },

  'DELETE /achievements': async (e, uid) => {
    await deleteAchievement(uid, parseQuery(e, achievementDeleteQuerySchema).badgeId);
    return json(204, undefined);
  },

  'GET /export': async (e, uid) => {
    const { format } = parseQuery(e, exportQuerySchema);
    const transactions = await listAllTransactions(uid);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="money-flow-${stamp}.csv"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
        body: toCsv(transactions),
      };
    }
    const [settings, achievements] = await Promise.all([getSettings(uid), listAchievements(uid)]);
    return json(
      200,
      { exportedAt: new Date().toISOString(), transactions, settings, achievements },
      { 'content-disposition': `attachment; filename="money-flow-${stamp}.json"` },
    );
  },
};

export const handler = withErrorHandling(async (event) => {
  const route = routes[event.routeKey];
  if (!route) return errorResponse('NOT_FOUND');
  return route(event, getUserId(event));
});
