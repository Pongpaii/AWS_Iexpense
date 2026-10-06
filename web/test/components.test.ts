import { mount } from '@vue/test-utils';
import type { TransactionCreateInput } from '@money-flow/shared';
import { describe, expect, it } from 'vitest';
import SummaryCards from '../src/components/SummaryCards.vue';
import TransactionForm from '../src/components/TransactionForm.vue';
import TransactionList from '../src/components/TransactionList.vue';
import { makeTx } from './fake-api';

describe('TransactionForm', () => {
  async function fill(
    w: ReturnType<typeof mount>,
    v: { desc?: string; amount?: string; date?: string },
  ) {
    if (v.desc !== undefined) await w.find('input[type="text"]').setValue(v.desc);
    if (v.amount !== undefined) await w.find('input[type="number"]').setValue(v.amount);
    if (v.date !== undefined) await w.find('input[type="date"]').setValue(v.date);
  }

  it('ทุกช่องมี label ผูกกับ input', () => {
    const w = mount(TransactionForm);
    for (const input of w.findAll('input:not([type="radio"]), select')) {
      const id = input.attributes('id');
      expect(id, input.html()).toBeTruthy();
      expect(w.find(`label[for="${id}"]`).exists(), id).toBe(true);
    }
  });

  it('validation ภาษาไทยด้วย schema เดียวกับ server + aria-invalid', async () => {
    const w = mount(TransactionForm, { attachTo: document.body });
    await fill(w, { desc: '   ', amount: '12.5' });
    await w.find('form').trigger('submit');
    expect(w.text()).toContain('กรุณากรอกรายละเอียด');
    expect(w.text()).toContain('จำนวนเงินต้องเป็นจำนวนเต็ม (ไม่มีทศนิยม)');
    expect(w.find('input[type="text"]').attributes('aria-invalid')).toBe('true');
    expect(w.emitted('create')).toBeUndefined();
    w.unmount();
  });

  it('ส่งข้อมูลถูกต้อง → emit create พร้อม idempotencyKey; ส่งซ้ำใช้ key เดิม; reset → key ใหม่', async () => {
    const w = mount(TransactionForm);
    await fill(w, { desc: 'ก๋วยเตี๋ยว', amount: '45' });
    await w.find('select').setValue('อาหาร');
    await w.find('form').trigger('submit');
    await w.find('form').trigger('submit');
    const events = w.emitted('create') as [TransactionCreateInput][];
    expect(events).toHaveLength(2);
    expect(events[0]![0]).toMatchObject({
      description: 'ก๋วยเตี๋ยว',
      amount: 45,
      type: 'expense',
      category: 'อาหาร',
    });
    expect(events[0]![0].idempotencyKey).toBe(events[1]![0].idempotencyKey);

    (w.vm as unknown as { reset: () => void }).reset();
    await fill(w, { desc: 'ชา', amount: '20' });
    await w.find('form').trigger('submit');
    const third = (w.emitted('create') as [TransactionCreateInput][])[2]![0];
    expect(third.idempotencyKey).not.toBe(events[0]![0].idempotencyKey);
  });

  it('โหมดแก้ไข: ส่งเฉพาะ field ที่เปลี่ยน', async () => {
    const t = makeTx({ description: 'เดิม', amount: 100 });
    const w = mount(TransactionForm, { props: { editing: t } });
    expect(w.find('h2').text()).toBe('แก้ไขรายการ');
    await fill(w, { amount: '150' });
    await w.find('form').trigger('submit');
    expect(w.emitted('update')?.[0]).toEqual([t.id, { amount: 150 }]);
  });

  it('โหมดแก้ไขขณะออฟไลน์ → ปุ่มบันทึกถูกปิด', () => {
    const w = mount(TransactionForm, { props: { editing: makeTx(), disabled: true } });
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('แก้ไขได้เฉพาะตอนออนไลน์');
  });
});

describe('TransactionList', () => {
  const base = { pending: [], online: true, loading: false, loadingMore: false, hasMore: false };

  it('render ครั้งละ 50 แถว และ "แสดงเพิ่ม"', async () => {
    const items = Array.from({ length: 120 }, () => makeTx());
    const w = mount(TransactionList, { props: { ...base, items } });
    expect(w.findAll('[data-testid="tx-row"]')).toHaveLength(50);
    await w.find('.more button').trigger('click');
    expect(w.findAll('[data-testid="tx-row"]')).toHaveLength(100);
    await w.find('.more button').trigger('click');
    expect(w.findAll('[data-testid="tx-row"]')).toHaveLength(120);
    expect(w.find('.more').exists()).toBe(false);
  });

  it('แสดงครบที่โหลดแล้วแต่ server ยังมีต่อ → emit loadMore', async () => {
    const items = Array.from({ length: 50 }, () => makeTx());
    const w = mount(TransactionList, { props: { ...base, items, hasMore: true } });
    await w.find('.more button').trigger('click');
    expect(w.emitted('loadMore')).toHaveLength(1);
  });

  it('ออฟไลน์ → ปุ่มแก้ไข/ลบ/เลือกหลายรายการถูกปิด', () => {
    const w = mount(TransactionList, { props: { ...base, online: false, items: [makeTx()] } });
    const buttons = w.findAll('button').filter((b) => /แก้ไข|ลบ|เลือกหลายรายการ/.test(b.text()));
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) expect(b.attributes('disabled'), b.text()).toBeDefined();
  });

  it('ปุ่มมี aria-label บอกรายการ', () => {
    const w = mount(TransactionList, {
      props: { ...base, items: [makeTx({ description: 'ชาไข่มุก' })] },
    });
    expect(w.find('button[aria-label="ลบ ชาไข่มุก"]').exists()).toBe(true);
  });

  it('เลือกหลายรายการ → emit bulkRemove ids', async () => {
    const items = [makeTx(), makeTx(), makeTx()];
    const w = mount(TransactionList, { props: { ...base, items } });
    await w
      .findAll('button')
      .find((b) => b.text() === 'เลือกหลายรายการ')!
      .trigger('click');
    const checks = w.findAll('input[type="checkbox"]');
    await checks[0]!.setValue(true);
    await checks[2]!.setValue(true);
    await w
      .findAll('button')
      .find((b) => b.text().startsWith('ลบที่เลือก'))!
      .trigger('click');
    expect(w.emitted('bulkRemove')?.[0]?.[0]).toEqual([items[0]!.id, items[2]!.id]);
  });

  it('แสดงรายการรอซิงก์', () => {
    const w = mount(TransactionList, {
      props: {
        ...base,
        items: [],
        pending: [
          {
            idempotencyKey: 'k',
            owner: 'a',
            queuedAt: '',
            seq: 1,
            status: 'pending' as const,
            input: {
              description: 'ออฟไลน์',
              amount: 9,
              type: 'expense' as const,
              transactionDate: '2026-10-06',
              idempotencyKey: 'k',
            },
          },
        ],
      },
    });
    expect(w.text()).toContain('รอซิงก์');
    expect(w.text()).toContain('ออฟไลน์');
  });
});

describe('SummaryCards', () => {
  it('Skeleton ขณะโหลด + aria-busy', () => {
    const w = mount(SummaryCards, {
      props: { balance: null, monthly: null, month: '2026-10', loading: true },
    });
    expect(w.findAll('.skeleton')).toHaveLength(3);
    expect(w.find('section').attributes('aria-busy')).toBe('true');
  });

  it('แสดงยอดเป็นบาท', () => {
    const w = mount(SummaryCards, {
      props: {
        balance: { income: 17000, expense: 2134, balance: 14866, transactionCount: 3 },
        monthly: {
          month: '2026-10',
          income: 17000,
          expense: 1135,
          balance: 15865,
          transactionCount: 3,
          byCategory: [],
        },
        month: '2026-10',
        loading: false,
      },
    });
    expect(w.find('[data-testid="card-balance"]').text()).toContain('14,866');
    expect(w.find('[data-testid="card-expense"]').text()).toContain('1,135');
    expect(w.find('[data-testid="card-income"]').text()).toContain('ตุลาคม 2569');
  });
});
