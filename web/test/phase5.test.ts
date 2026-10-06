import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { activeApi, moneyStore, profileStore, startDemo, endSession } from '../src/app-context';
import BudgetVsActual from '../src/components/analytics/BudgetVsActual.vue';
import CalendarHeatmap from '../src/components/analytics/CalendarHeatmap.vue';
import RunwayPanel from '../src/components/analytics/RunwayPanel.vue';
import { createDemoEndpoints, generateDemoTransactions } from '../src/demo/demo';
import { budgetVsActual, expenseHeatmap } from '../src/lib/analytics';
import { createProfileStore } from '../src/stores/profile';
import { session } from '../src/stores/session';
import AnalyticsView from '../src/views/AnalyticsView.vue';
import SettingsView from '../src/views/SettingsView.vue';
import { createFakeApi } from './fake-api';

const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<p />' } }],
  });

/** ให้ async component + promise ทั้งหมดทำงานเสร็จ */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
const mounted: VueWrapper[] = [];
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in test'));
});
afterEach(() => {
  // ถอด view ก่อนล้าง session (เหมือน App.vue ที่ถอด RouterView ก่อน)
  while (mounted.length) mounted.pop()!.unmount();
  fetchSpy.mockRestore();
  endSession();
});

describe('demo mode', () => {
  it('ข้อมูลตัวอย่าง deterministic มีทั้งรายรับและรายจ่าย ย้อนหลัง ~2.5 เดือน', () => {
    const a = generateDemoTransactions('2026-10-06');
    const b = generateDemoTransactions('2026-10-06');
    expect(a).toEqual(b);
    expect(a.some((t) => t.type === 'income')).toBe(true);
    expect(a.filter((t) => t.category === 'อาหาร').length).toBeGreaterThan(50);
    expect(a.every((t) => Number.isInteger(t.amount) && t.amount > 0)).toBe(true);
  });

  it('อ่านอย่างเดียว: ทุกการเขียนถูกปฏิเสธด้วยข้อความไทย', async () => {
    const api = createDemoEndpoints('2026-10-06');
    const writes = [
      () => api.createTransaction({} as never),
      () => api.updateTransaction('x', {}),
      () => api.deleteTransaction('x'),
      () => api.bulkDelete(['x']),
      () => api.putSettings({}),
      () => api.addAchievement('x'),
      () => api.deleteAccount('x'),
      () => api.exportData('csv'),
    ];
    for (const w of writes) {
      await expect(w()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('โหมดทดลอง'),
      });
    }
  });

  it('startDemo → store อ่านอย่างเดียว, ไม่มี outbox, ไม่เรียก network เลย', async () => {
    await startDemo();
    expect(session.status).toBe('demo');
    const store = moneyStore.value!;
    expect(store.readOnly).toBe(true);
    await store.loadMonth();
    expect(store.state.items.length).toBeGreaterThan(0);
    await expect(
      store.add({
        description: 'x',
        amount: 1,
        type: 'expense',
        transactionDate: '2026-10-06',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.state.pending).toEqual([]);
    await settle();
    expect(profileStore.value!.state.settings.dailyCap.enabled).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('หน้าวิเคราะห์ใน demo: แสดงครบทุกส่วนโดยไม่เรียก network', async () => {
    await startDemo();
    const w = mount(AnalyticsView, { global: { plugins: [router()] } });
    mounted.push(w);
    await settle();
    const text = w.text();
    expect(text).toContain('MoneyBuddy');
    expect(text).toContain('เงินพออยู่ได้อีก');
    expect(text).toContain('กระแสเงินสด');
    expect(text).toContain('สัดส่วนรายจ่ายตามหมวด');
    expect(w.findAll('[data-testid="heat-cell"]').length).toBeGreaterThanOrEqual(28);
    // tab: งบ vs จ่ายจริง → อาหาร/เดินทาง อยู่ต้น
    await w.find('#tab-budget').trigger('click');
    const rows = w.findAll('[data-testid="budget-row"]').map((r) => r.find('.cat').text());
    expect(rows.slice(0, 2)).toEqual(['อาหาร', 'เดินทาง']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(activeApi.value).not.toBeNull();
  });

  it('tablist รองรับคีย์บอร์ด (ลูกศรขวา)', async () => {
    await startDemo();
    const w = mount(AnalyticsView, { global: { plugins: [router()] }, attachTo: document.body });
    await settle();
    await w.find('#tab-runway').trigger('keydown', { key: 'ArrowRight' });
    expect(w.find('#tab-budget').attributes('aria-selected')).toBe('true');
    w.unmount();
  });
});

describe('analytics components', () => {
  it('BudgetVsActual: progressbar มี aria-valuetext และสถานะเกินงบ', () => {
    const rows = budgetVsActual(
      [{ category: 'อาหาร', budget: 100 }],
      [{ type: 'expense', amount: 150, category: 'อาหาร', transactionDate: '2026-10-01' }],
    );
    const w = mount(BudgetVsActual, { props: { rows }, global: { plugins: [router()] } });
    expect(w.text()).toContain('เกินงบ');
    expect(w.find('[role="progressbar"]').attributes('aria-valuetext')).toContain('150%');
  });

  it('CalendarHeatmap: เลือกหมวดที่ไม่นับ → emit', async () => {
    const cells = expenseHeatmap([], '2026-10');
    const w = mount(CalendarHeatmap, {
      props: { cells, categories: ['อาหาร', 'ที่พัก'], excluded: [] },
    });
    expect(w.findAll('[data-testid="heat-cell"]')).toHaveLength(31);
    await w.findAll('input[type="checkbox"]')[1]!.setValue(true);
    expect(w.emitted('update:excluded')?.[0]).toEqual([['ที่พัก']]);
  });

  it('RunwayPanel: คันโยกลด 50% → จำนวนวันเพิ่ม', async () => {
    const txs = [
      { type: 'expense' as const, amount: 600, category: 'อาหาร', transactionDate: '2026-10-06' },
    ];
    const w = mount(RunwayPanel, { props: { balance: 6000, recentTxs: txs, today: '2026-10-06' } });
    expect(w.find('.big strong').text()).toBe('300 วัน');
    await w.find('input[type="range"]').setValue('50');
    expect(w.find('.big strong').text()).toBe('600 วัน');
    expect(w.text()).toContain('นานขึ้น 300 วัน');
  });
});

describe('SettingsView', () => {
  function mountWith(readOnly = false) {
    const fake = createFakeApi();
    const saved: unknown[] = [];
    fake.api.getSettings = async () => (await import('@money-flow/shared')).defaultSettings();
    fake.api.putSettings = async (input) => {
      saved.push(input);
      const { settingsInputSchema } = await import('@money-flow/shared');
      return { ...settingsInputSchema.parse(input), updatedAt: '2026-10-06T05:00:00.000Z' };
    };
    activeApi.value = fake.api;
    profileStore.value = createProfileStore({ api: fake.api, readOnly });
    const w = mount(SettingsView, { global: { plugins: [router()] }, attachTo: document.body });
    return { w, saved };
  }

  it('validation ภาษาไทย (เงินเดือน 0) → ไม่บันทึก', async () => {
    const { w, saved } = mountWith();
    await w.find('input[type="number"]').setValue('0');
    await w.find('form').trigger('submit');
    await settle();
    expect(w.text()).toContain('เงินเดือนต้องมากกว่า 0');
    expect(saved).toEqual([]);
    w.unmount();
  });

  it('บันทึกงบรายหมวด + สีรายจ่าย → PUT และเปลี่ยนธีม', async () => {
    const { w, saved } = mountWith();
    await w
      .findAll('button')
      .find((b) => b.text().includes('เพิ่มงบหมวด'))!
      .trigger('click');
    const budgetInputs = w.findAll('#budgets input[type="number"]');
    await budgetInputs[0]!.setValue('6000');
    await w.find('input[value="blue"]').setValue(true);
    await w.find('form').trigger('submit');
    await settle();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      expenseColor: 'blue',
      categoryBudgets: [{ category: 'อาหาร', budget: 6000 }],
    });
    expect(document.documentElement.dataset.expenseColor).toBe('blue');
    w.unmount();
  });

  it('ปุ่มลบบัญชีเปิดได้เมื่อพิมพ์ยืนยันถูกต้องเท่านั้น', async () => {
    const { w } = mountWith();
    const btn = () => w.findAll('button').find((b) => b.text().includes('ลบบัญชีถาวร'))!;
    expect(btn().attributes('disabled')).toBeDefined();
    const confirm = w.findAll('input[type="text"]').at(-1)!;
    await confirm.setValue('ลบ');
    expect(btn().attributes('disabled')).toBeDefined();
    await confirm.setValue('ลบบัญชี');
    expect(btn().attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('demo: บันทึกไม่ได้', () => {
    const { w } = mountWith(true);
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('โหมดทดลอง');
    w.unmount();
  });
});
