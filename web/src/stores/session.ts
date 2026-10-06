import { reactive } from 'vue';
import type { SessionInfo } from '../auth/auth';

/** สถานะ login ระดับแอป ('demo' = โหมดทดลอง ไม่มี session จริง) */
export const session = reactive<{
  status: 'unknown' | 'signedOut' | 'signedIn' | 'demo';
  user: SessionInfo | null;
}>({ status: 'unknown', user: null });

export function setSignedIn(user: SessionInfo): void {
  session.status = 'signedIn';
  session.user = user;
}

export function setDemo(): void {
  session.status = 'demo';
  session.user = { sub: 'demo', email: 'โหมดทดลอง' };
}

export function setSignedOut(): void {
  session.status = 'signedOut';
  session.user = null;
}

/** เข้าหน้าที่ต้อง login ได้ (ผู้ใช้จริงหรือ demo) */
export const hasAccess = () => session.status === 'signedIn' || session.status === 'demo';
