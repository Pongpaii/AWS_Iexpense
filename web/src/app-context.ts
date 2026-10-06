import { shallowRef } from 'vue';
import type { Router } from 'vue-router';
import { createApiClient } from './api/client';
import { createEndpoints, type Endpoints } from './api/endpoints';
import { configureAuth, currentSession, getAccessToken, logout } from './auth/auth';
import { loadConfig } from './config';
import { BADGES, evaluateBadges } from './lib/achievements';
import { addDays } from './lib/analytics';
import { shiftMonth, todayLocal } from './lib/date';
import { createOutbox } from './offline/outbox';
import { createMoneyStore, type MoneyStore } from './stores/money';
import { createProfileStore, type ProfileStore } from './stores/profile';
import { session, setDemo, setSignedIn, setSignedOut } from './stores/session';
import { showToast } from './stores/toast';

export const appConfig = loadConfig();
if (appConfig.ok) configureAuth(appConfig.config);

export const outbox = createOutbox();
let api: Endpoints | null = null;
let router: Router | null = null;

/** store ของผู้ใช้ที่ login อยู่ หรือของ demo (null = ยังไม่เข้าใช้งาน) */
export const moneyStore = shallowRef<MoneyStore | null>(null);
export const profileStore = shallowRef<ProfileStore | null>(null);

/** endpoint ที่ใช้อยู่ (จริงหรือ demo) */
export const activeApi = shallowRef<Endpoints | null>(null);

/** ป้องกัน open redirect: รับเฉพาะ path ภายในแอป */
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

function onSessionExpired() {
  if (session.status !== 'signedIn') return;
  endSession();
  showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', { kind: 'error' });
  const current = router?.currentRoute.value;
  if (current && current.name !== 'login') {
    void router?.push({ name: 'login', query: { redirect: current.fullPath } });
  }
}

export function attachRouter(r: Router) {
  router = r;
}

if (appConfig.ok) {
  api = createEndpoints(
    createApiClient({
      baseUrl: appConfig.config.apiUrl,
      getToken: getAccessToken,
      onSessionExpired,
    }),
  );
}

const onOnline = () => {
  const store = moneyStore.value;
  if (!store) return;
  store.setOnline(true);
  void store.sync().then(({ synced }) => {
    if (synced > 0) {
      showToast(`ซิงก์รายการที่บันทึกตอนออฟไลน์แล้ว ${synced} รายการ`, { kind: 'success' });
    }
  });
};
const onOffline = () => moneyStore.value?.setOnline(false);

function attach(endpoints: Endpoints, owner: string, readOnly: boolean) {
  activeApi.value = endpoints;
  moneyStore.value = createMoneyStore({
    api: endpoints,
    outbox,
    owner,
    readOnly,
    isOnline: readOnly ? () => true : undefined,
  });
  profileStore.value = createProfileStore({ api: endpoints, readOnly });
  void profileStore.value.loadSettings().catch(() => undefined);
  void profileStore.value.loadAchievements().catch(() => undefined);
}

/** เริ่ม session: สร้าง store ของ user นี้ + ฟัง online/offline + ซิงก์ outbox */
export function startSession(user: { sub: string; email: string }) {
  setSignedIn(user);
  if (!api) return;
  attach(api, user.sub, false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  if (navigator.onLine) onOnline();
}

/** Demo mode: ข้อมูลตัวอย่างในหน่วยความจำ อ่านอย่างเดียว ไม่เรียก API */
export async function startDemo() {
  const { createDemoEndpoints } = await import('./demo/demo');
  setDemo();
  attach(createDemoEndpoints(), 'demo', true);
}

export function endSession() {
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  moneyStore.value = null;
  profileStore.value = null;
  activeApi.value = null;
  delete document.documentElement.dataset.expenseColor;
  setSignedOut();
}

export async function restoreSession(): Promise<void> {
  if (!appConfig.ok) return setSignedOut();
  const user = await currentSession();
  if (user) startSession(user);
  else setSignedOut();
}

export async function signOutEverywhere(): Promise<void> {
  if (session.status === 'signedIn') await logout();
  endSession();
}

/** หลังลบบัญชี: ล้างข้อมูลในเครื่องของ user นี้ด้วย */
export async function clearLocalData(owner: string) {
  for (const e of await outbox.list(owner)) await outbox.remove(e.idempotencyKey);
}

/**
 * ตรวจ badge ใหม่ (เรียกหลังโหลดภาพรวม) — ดึงรายการ 60 วันล่าสุดเพื่อนับ streak
 * แจ้ง toast เมื่อได้ badge ใหม่
 */
export async function checkAchievements(): Promise<void> {
  const store = moneyStore.value;
  const profile = profileStore.value;
  const endpoints = activeApi.value;
  if (!store || !profile || !endpoints || !store.state.online) return;
  if (!profile.state.achievementsLoaded) await profile.loadAchievements();

  const today = todayLocal();
  const prevMonth = shiftMonth(today.slice(0, 7), -1);
  const [recent, balance, previous] = await Promise.all([
    store.fetchRange(addDays(today, -59), today),
    endpoints.balance(),
    endpoints.monthly(prevMonth),
  ]);
  const ids = evaluateBadges({
    today,
    transactionCount: balance.transactionCount,
    activeDates: recent.map((t) => t.transactionDate),
    recentTxs: recent,
    dailyCap: profile.state.settings.dailyCap,
    previousMonth: previous,
  });
  const fresh = await profile.award(ids);
  for (const id of fresh) {
    const b = BADGES.find((x) => x.id === id);
    if (b) showToast(`${b.icon} ได้รับเหรียญ "${b.title}"`, { kind: 'success' });
  }
}
