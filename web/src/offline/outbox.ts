import type { Transaction, TransactionCreateInput } from '@money-flow/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ApiClientError } from '../api/client';

/**
 * Offline queue (IndexedDB) สำหรับ "รายการใหม่" เท่านั้น
 * - key = idempotencyKey → ส่งซ้ำได้ปลอดภัย server ไม่บันทึกซ้ำ
 * - แยกตาม owner (sub) → ไม่ส่งรายการของ user หนึ่งในนามอีก user
 */
export interface OutboxEntry {
  idempotencyKey: string;
  owner: string;
  input: TransactionCreateInput;
  queuedAt: string;
  /** ลำดับการเข้าคิว (ไม่ซ้ำแม้เพิ่มใน ms เดียวกัน) → ซิงก์ตามลำดับที่ผู้ใช้บันทึก */
  seq: number;
  status: 'pending' | 'failed';
  error?: string;
}

interface OutboxDB extends DBSchema {
  outbox: { key: string; value: OutboxEntry; indexes: { byOwner: string } };
}

export interface FlushResult {
  synced: Transaction[];
  failed: OutboxEntry[];
  remaining: number;
}

export type Outbox = ReturnType<typeof createOutbox>;

export function createOutbox(dbName = 'money-flow') {
  let dbPromise: Promise<IDBPDatabase<OutboxDB>> | undefined;
  const db = () =>
    (dbPromise ??= openDB<OutboxDB>(dbName, 1, {
      upgrade(d) {
        const store = d.createObjectStore('outbox', { keyPath: 'idempotencyKey' });
        store.createIndex('byOwner', 'owner');
      },
    }));

  let flushing: Promise<FlushResult> | undefined;
  let lastSeq = 0;
  const nextSeq = () => (lastSeq = Math.max(Date.now() * 1000, lastSeq + 1));

  async function list(owner: string): Promise<OutboxEntry[]> {
    const all = await (await db()).getAllFromIndex('outbox', 'byOwner', owner);
    return all.sort((a, b) => a.seq - b.seq);
  }

  async function add(owner: string, input: TransactionCreateInput): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      idempotencyKey: input.idempotencyKey,
      owner,
      input,
      queuedAt: new Date().toISOString(),
      seq: nextSeq(),
      status: 'pending',
    };
    await (await db()).put('outbox', entry);
    return entry;
  }

  async function remove(key: string): Promise<void> {
    await (await db()).delete('outbox', key);
  }

  /** ส่งรายการที่ค้างทีละรายการตามลำดับ; หยุดเมื่อเจอปัญหาเครือข่าย (ไว้ลองใหม่) */
  async function runFlush(
    owner: string,
    send: (input: TransactionCreateInput) => Promise<Transaction>,
  ): Promise<FlushResult> {
    const synced: Transaction[] = [];
    const failed: OutboxEntry[] = [];
    const entries = (await list(owner)).filter((e) => e.status === 'pending');
    let i = 0;
    for (; i < entries.length; i++) {
      const entry = entries[i]!;
      try {
        synced.push(await send(entry.input));
        await remove(entry.idempotencyKey);
      } catch (err) {
        if (err instanceof ApiClientError && !err.transient && err.code !== 'UNAUTHORIZED') {
          // server ปฏิเสธถาวร (เช่น validation) → เก็บไว้ให้ผู้ใช้เห็นและเลือกทิ้ง
          const next: OutboxEntry = { ...entry, status: 'failed', error: err.message };
          await (await db()).put('outbox', next);
          failed.push(next);
          continue;
        }
        break;
      }
    }
    const remaining = (await list(owner)).filter((e) => e.status === 'pending').length;
    return { synced, failed, remaining };
  }

  function flush(owner: string, send: (input: TransactionCreateInput) => Promise<Transaction>) {
    // single-flight: กันส่งซ้อนกันเมื่อ online event มาพร้อมกับปุ่มซิงก์
    flushing ??= runFlush(owner, send).finally(() => {
      flushing = undefined;
    });
    return flushing;
  }

  return { list, add, remove, flush };
}
