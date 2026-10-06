import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import type * as AppContext from '../src/app-context';
import type * as AuthModule from '../src/auth/auth';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  completeNewPassword: vi.fn(),
  currentSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));
const ctx = vi.hoisted(() => ({ startSession: vi.fn() }));

vi.mock('../src/auth/auth', async (orig) => ({
  ...(await orig<typeof AuthModule>()),
  ...auth,
}));
vi.mock('../src/app-context', async () => {
  const { safeRedirect } = await vi.importActual<typeof AppContext>('../src/app-context');
  return {
    appConfig: { ok: true },
    safeRedirect,
    startSession: ctx.startSession,
  };
});

import LoginView from '../src/views/LoginView.vue';

async function mountLogin(query = '') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<p>home</p>' } },
      { path: '/login', component: LoginView },
      { path: '/:p(.*)*', component: { template: '<p>other</p>' } },
    ],
  });
  await router.push(`/login${query}`);
  const w = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body });
  return { w, router };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentSession.mockResolvedValue({ sub: 'abc', email: 'a@example.com' });
});

describe('LoginView', () => {
  it('login สำเร็จ → startSession และกลับไปหน้าเดิม (redirect)', async () => {
    auth.login.mockResolvedValue('DONE');
    const { w, router } = await mountLogin('?redirect=/settings');
    await w.find('input[type="email"]').setValue('a@example.com');
    await w.find('input[type="password"]').setValue('Secret12345');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(auth.login).toHaveBeenCalledWith('a@example.com', 'Secret12345');
    expect(ctx.startSession).toHaveBeenCalledWith({ sub: 'abc', email: 'a@example.com' });
    expect(router.currentRoute.value.fullPath).toBe('/settings');
    w.unmount();
  });

  it('redirect ภายนอก (open redirect) ถูกเปลี่ยนเป็น /', async () => {
    auth.login.mockResolvedValue('DONE');
    const { w, router } = await mountLogin('?redirect=//evil.example.com');
    await w.find('input[type="email"]').setValue('a@example.com');
    await w.find('input[type="password"]').setValue('x');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/');
    w.unmount();
  });

  it('รหัสผ่านชั่วคราว → ขั้นตั้งรหัสผ่านใหม่ (ตรวจ policy ก่อนส่ง)', async () => {
    auth.login.mockResolvedValue('NEW_PASSWORD_REQUIRED');
    auth.completeNewPassword.mockResolvedValue('DONE');
    const { w } = await mountLogin();
    await w.find('input[type="email"]').setValue('a@example.com');
    await w.find('input[type="password"]').setValue('Temp!123');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('h1').text()).toBe('ตั้งรหัสผ่านใหม่');
    expect(document.activeElement).toBe(w.find('h1').element);

    const [pw, confirm] = w.findAll('input[type="password"]');
    await pw!.setValue('short');
    await confirm!.setValue('short');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain('อย่างน้อย 10 ตัวอักษร');
    expect(auth.completeNewPassword).not.toHaveBeenCalled();

    await pw!.setValue('NewPassword1');
    await confirm!.setValue('NewPassword1');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(auth.completeNewPassword).toHaveBeenCalledWith('NewPassword1');
    expect(ctx.startSession).toHaveBeenCalled();
    w.unmount();
  });

  it('รหัสผ่านผิด → ข้อความไทยใน role=alert', async () => {
    auth.login.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAuthorizedException' }));
    const { w } = await mountLogin();
    await w.find('input[type="email"]').setValue('a@example.com');
    await w.find('input[type="password"]').setValue('wrong');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(ctx.startSession).not.toHaveBeenCalled();
    w.unmount();
  });

  it('ลืมรหัสผ่าน → ส่งรหัส → ตั้งรหัสใหม่ด้วยรหัสยืนยัน', async () => {
    const { w } = await mountLogin();
    await w
      .findAll('button')
      .find((b) => b.text() === 'ลืมรหัสผ่าน?')!
      .trigger('click');
    await w.find('input[type="email"]').setValue('a@example.com');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('a@example.com');
    expect(w.find('h1').text()).toContain('รหัสยืนยัน');

    await w.find('input[autocomplete="one-time-code"]').setValue('123456');
    const [pw, confirm] = w.findAll('input[type="password"]');
    await pw!.setValue('BrandNewPw1');
    await confirm!.setValue('BrandNewPw1');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(auth.confirmPasswordReset).toHaveBeenCalledWith(
      'a@example.com',
      '123456',
      'BrandNewPw1',
    );
    expect(w.find('h1').text()).toBe('เข้าสู่ระบบ');
    w.unmount();
  });
});
