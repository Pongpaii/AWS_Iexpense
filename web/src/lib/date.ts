import { isValidTimeZone } from '@money-flow/shared';

const pad = (n: number) => String(n).padStart(2, '0');

/** วันที่ปัจจุบันตามเวลาเครื่อง (ไม่ใช่ UTC) รูปแบบ YYYY-MM-DD */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(now: Date = new Date()): string {
  return todayLocal(now).slice(0, 7);
}

/** "2026-02" → { from: "2026-02-01", to: "2026-02-28" } */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

const monthFmt = new Intl.DateTimeFormat('th-TH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateFmt = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const weekdayFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' });

const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number?];
  return new Date(Date.UTC(y, m - 1, d ?? 1));
};

/** "2026-10" → "ตุลาคม 2569" */
export const formatThaiMonth = (month: string) => monthFmt.format(utc(month));
/** "2026-10-06" → "6 ต.ค. 69" */
export const formatThaiDate = (iso: string) => dateFmt.format(utc(iso));
export const formatWeekday = (iso: string) => weekdayFmt.format(utc(iso));

/** IANA timezone ของเครื่อง (ถ้าอ่านได้และผ่าน validation เดียวกับ server) */
export function clientTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length <= 64 && isValidTimeZone(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}
