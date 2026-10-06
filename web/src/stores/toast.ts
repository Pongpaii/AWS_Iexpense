import { reactive } from 'vue';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void | Promise<void> };
  timeoutMs: number;
}

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const toasts = reactive<Toast[]>([]);

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/** แสดงข้อความแจ้งเตือน (อ่านโดย screen reader ผ่าน aria-live) */
export function showToast(
  message: string,
  opts: Partial<Omit<Toast, 'id' | 'message'>> = {},
): number {
  const toast: Toast = {
    id: ++seq,
    message,
    kind: opts.kind ?? 'info',
    action: opts.action,
    // มีปุ่ม (เช่น เลิกทำ) → ให้เวลานานขึ้น
    timeoutMs: opts.timeoutMs ?? (opts.action ? 8000 : 4000),
  };
  toasts.push(toast);
  if (toasts.length > 4) dismissToast(toasts[0]!.id);
  timers.set(
    toast.id,
    setTimeout(() => dismissToast(toast.id), toast.timeoutMs),
  );
  return toast.id;
}
