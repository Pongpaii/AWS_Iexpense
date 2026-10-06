<script setup lang="ts">
import {
  ACCOUNT_DELETE_CONFIRMATION,
  EXPENSE_CATEGORIES,
  MAX_CATEGORY_BUDGETS,
  PRIORITY_CATEGORIES,
  formatZodError,
  settingsInputSchema,
  settingsToInput,
  type SettingsInput,
} from '@money-flow/shared';
import { computed, nextTick, reactive, ref, useId, watch } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../api/client';
import { activeApi, clearLocalData, endSession, profileStore } from '../app-context';
import { applyDailyReminder, remindersSupported } from '../lib/reminders';
import { session } from '../stores/session';
import { showToast } from '../stores/toast';

type Form = {
  monthlySalary: number | '';
  expenseColor: 'red' | 'blue' | 'green';
  dailyCap: {
    enabled: boolean;
    amount: number | '' | null;
    subPlans: { category: string; amount: number | '' }[];
    excludedCategories: string[];
  };
  categoryBudgets: { category: string; budget: number | '' }[];
  dailyReminder: { enabled: boolean; time: string };
  heatmapExcludedCategories: string[];
};

const router = useRouter();
const uid = useId();
const id = (n: string) => `${uid}-${n}`;
const profile = computed(() => profileStore.value!);
const readOnly = computed(() => profile.value.readOnly);

const form = reactive<Form>(toForm(settingsToInput(profile.value.state.settings)));
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const formEl = ref<HTMLFormElement | null>(null);

function toForm(s: SettingsInput): Form {
  return JSON.parse(
    JSON.stringify({
      monthlySalary: s.monthlySalary ?? 17000,
      expenseColor: s.expenseColor ?? 'red',
      dailyCap: {
        enabled: s.dailyCap?.enabled ?? false,
        amount: s.dailyCap?.amount ?? null,
        subPlans: s.dailyCap?.subPlans ?? [],
        excludedCategories: s.dailyCap?.excludedCategories ?? [],
      },
      categoryBudgets: s.categoryBudgets ?? [],
      dailyReminder: s.dailyReminder ?? { enabled: false, time: '20:00' },
      heatmapExcludedCategories: s.heatmapExcludedCategories ?? [],
    }),
  ) as Form;
}

// settings โหลดเสร็จทีหลัง → เติมฟอร์ม (ถ้ายังไม่ได้แก้)
watch(
  () => profileStore.value?.state.settings,
  (s) => {
    if (s) Object.assign(form, toForm(settingsToInput(s)));
  },
);

const COLORS = [
  { value: 'red', label: 'แดง', hex: '#b91c1c' },
  { value: 'blue', label: 'ฟ้า', hex: '#1d4ed8' },
  { value: 'green', label: 'เขียว', hex: '#15803d' },
] as const;

const err = (path: string) => errors.value[path];
const num = (v: number | '' | null) => (v === '' ? Number.NaN : v);

function toInput(): unknown {
  return {
    monthlySalary: num(form.monthlySalary),
    expenseColor: form.expenseColor,
    dailyCap: {
      enabled: form.dailyCap.enabled,
      amount:
        form.dailyCap.amount === '' || form.dailyCap.amount === null ? null : form.dailyCap.amount,
      subPlans: form.dailyCap.subPlans.map((p) => ({
        category: p.category,
        amount: num(p.amount),
      })),
      excludedCategories: form.dailyCap.excludedCategories,
    },
    categoryBudgets: form.categoryBudgets.map((b) => ({
      category: b.category,
      budget: num(b.budget),
    })),
    dailyReminder: form.dailyReminder,
    heatmapExcludedCategories: form.heatmapExcludedCategories,
  };
}

function addBudget() {
  const used = new Set(form.categoryBudgets.map((b) => b.category));
  const next = [...PRIORITY_CATEGORIES, ...EXPENSE_CATEGORIES].find((c) => !used.has(c)) ?? '';
  form.categoryBudgets.push({ category: next, budget: '' });
}
function addSubPlan() {
  const used = new Set(form.dailyCap.subPlans.map((p) => p.category));
  const next = PRIORITY_CATEGORIES.find((c) => !used.has(c)) ?? '';
  form.dailyCap.subPlans.push({ category: next, amount: '' });
}

async function onSave() {
  if (readOnly.value) {
    showToast('โหมดทดลองแก้ไขการตั้งค่าไม่ได้');
    return;
  }
  const input = toInput();
  const r = settingsInputSchema.safeParse(input);
  if (!r.success) {
    errors.value = formatZodError(r.error).fields;
    await nextTick();
    formEl.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    showToast(formatZodError(r.error).message, { kind: 'error' });
    return;
  }
  errors.value = {};
  saving.value = true;
  try {
    const saved = await profile.value.saveSettings(input as SettingsInput);
    Object.assign(form, toForm(settingsToInput(saved)));
    showToast('บันทึกการตั้งค่าแล้ว', { kind: 'success' });
    const rem = await applyDailyReminder(saved.dailyReminder);
    if (rem === 'denied')
      showToast('ไม่ได้รับอนุญาตให้แจ้งเตือน กรุณาเปิดในการตั้งค่าเครื่อง', { kind: 'error' });
  } catch (e) {
    showToast(errorMessage(e), { kind: 'error' });
  } finally {
    saving.value = false;
  }
}

/* ------------------------------ ข้อมูลของฉัน ------------------------------ */
const exporting = ref(false);
async function onExport(format: 'csv' | 'json') {
  if (readOnly.value) {
    showToast('โหมดทดลองส่งออกข้อมูลไม่ได้');
    return;
  }
  exporting.value = true;
  try {
    const body = await activeApi.value!.exportData(format);
    const blob = new Blob([body], {
      type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `money-flow-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    showToast(errorMessage(e), { kind: 'error' });
  } finally {
    exporting.value = false;
  }
}

/* ------------------------------- Danger zone ------------------------------ */
const confirmText = ref('');
const deleting = ref(false);
async function onDeleteAccount() {
  if (confirmText.value !== ACCOUNT_DELETE_CONFIRMATION || readOnly.value) return;
  if (!window.confirm('ลบบัญชีและข้อมูลทั้งหมดถาวร? การกระทำนี้ย้อนกลับไม่ได้')) return;
  deleting.value = true;
  try {
    const owner = session.user?.sub;
    await activeApi.value!.deleteAccount(confirmText.value);
    if (owner) await clearLocalData(owner);
    endSession();
    await router.replace({ name: 'login' });
    showToast('ลบบัญชีและข้อมูลทั้งหมดแล้ว');
  } catch (e) {
    showToast(errorMessage(e), { kind: 'error' });
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="settings">
    <h1>ตั้งค่า</h1>
    <p v-if="readOnly" class="form-error" role="status">โหมดทดลอง: ดูได้แต่บันทึกไม่ได้</p>

    <datalist :id="id('cats')">
      <option v-for="c in EXPENSE_CATEGORIES" :key="c" :value="c" />
    </datalist>

    <form ref="formEl" class="stack" novalidate @submit.prevent="onSave">
      <section class="card stack" aria-labelledby="s-salary">
        <h2 id="s-salary">เงินเดือน</h2>
        <div class="field">
          <label :for="id('salary')">เงินเดือน (บาท/เดือน)</label>
          <input
            :id="id('salary')"
            v-model.number="form.monthlySalary"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            :aria-invalid="!!err('monthlySalary')"
            :aria-describedby="err('monthlySalary') ? id('salary-e') : undefined"
          />
          <span v-if="err('monthlySalary')" :id="id('salary-e')" class="field-error">{{
            err('monthlySalary')
          }}</span>
        </div>
      </section>

      <section class="card stack" aria-labelledby="s-color">
        <h2 id="s-color">สีรายจ่าย / เกินงบ</h2>
        <fieldset class="colors">
          <legend class="visually-hidden">เลือกสี</legend>
          <label
            v-for="c in COLORS"
            :key="c.value"
            class="color"
            :class="{ active: form.expenseColor === c.value }"
          >
            <input v-model="form.expenseColor" type="radio" name="expenseColor" :value="c.value" />
            <i class="dot" :style="{ background: c.hex }" aria-hidden="true" />
            {{ c.label }}
          </label>
        </fieldset>
      </section>

      <section id="daily-cap" class="card stack" aria-labelledby="s-cap">
        <h2 id="s-cap">เพดานรายวัน</h2>
        <label class="check">
          <input v-model="form.dailyCap.enabled" type="checkbox" />
          เปิดใช้เพดานรายวัน
        </label>
        <div class="field">
          <label :for="id('cap')">เพดานต่อวัน (บาท)</label>
          <input
            :id="id('cap')"
            v-model.number="form.dailyCap.amount"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            :aria-invalid="!!err('dailyCap.amount')"
            :aria-describedby="err('dailyCap.amount') ? id('cap-e') : undefined"
          />
          <span v-if="err('dailyCap.amount')" :id="id('cap-e')" class="field-error">{{
            err('dailyCap.amount')
          }}</span>
        </div>

        <fieldset class="chips">
          <legend>หมวดที่ไม่นับในเพดาน (เช่น ค่าที่พัก)</legend>
          <label v-for="c in EXPENSE_CATEGORIES" :key="c" class="chip">
            <input v-model="form.dailyCap.excludedCategories" type="checkbox" :value="c" />
            {{ c }}
          </label>
        </fieldset>

        <h3>แผนย่อยรายหมวด</h3>
        <p v-if="err('dailyCap.subPlans')" class="field-error" role="alert">
          {{ err('dailyCap.subPlans') }}
        </p>
        <ul class="rows">
          <li v-for="(p, i) in form.dailyCap.subPlans" :key="i" class="row">
            <div class="field">
              <label :for="id(`sp-c-${i}`)">หมวด</label>
              <input
                :id="id(`sp-c-${i}`)"
                v-model="p.category"
                :list="id('cats')"
                maxlength="40"
                :aria-invalid="!!err(`dailyCap.subPlans.${i}.category`)"
              />
            </div>
            <div class="field">
              <label :for="id(`sp-a-${i}`)">บาท/วัน</label>
              <input
                :id="id(`sp-a-${i}`)"
                v-model.number="p.amount"
                type="number"
                inputmode="numeric"
                min="1"
                step="1"
                :aria-invalid="!!err(`dailyCap.subPlans.${i}.amount`)"
              />
            </div>
            <button
              type="button"
              class="btn btn-secondary"
              :aria-label="`ลบแผนย่อย ${p.category}`"
              @click="form.dailyCap.subPlans.splice(i, 1)"
            >
              ลบ
            </button>
          </li>
        </ul>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="form.dailyCap.subPlans.length >= 10"
          @click="addSubPlan"
        >
          + เพิ่มแผนย่อย
        </button>
      </section>

      <section id="budgets" class="card stack" aria-labelledby="s-budget">
        <h2 id="s-budget">งบรายหมวด (ต่อเดือน)</h2>
        <p class="field-hint">หมวด "อาหาร" และ "เดินทาง" จะแสดงเป็นอันดับแรกเสมอ</p>
        <p v-if="err('categoryBudgets')" class="field-error" role="alert">
          {{ err('categoryBudgets') }}
        </p>
        <ul class="rows">
          <li v-for="(b, i) in form.categoryBudgets" :key="i" class="row">
            <div class="field">
              <label :for="id(`b-c-${i}`)">หมวด</label>
              <input
                :id="id(`b-c-${i}`)"
                v-model="b.category"
                :list="id('cats')"
                maxlength="40"
                :aria-invalid="!!err(`categoryBudgets.${i}.category`)"
              />
              <span v-if="err(`categoryBudgets.${i}.category`)" class="field-error">{{
                err(`categoryBudgets.${i}.category`)
              }}</span>
            </div>
            <div class="field">
              <label :for="id(`b-a-${i}`)">งบ (บาท)</label>
              <input
                :id="id(`b-a-${i}`)"
                v-model.number="b.budget"
                type="number"
                inputmode="numeric"
                min="1"
                step="1"
                :aria-invalid="!!err(`categoryBudgets.${i}.budget`)"
              />
              <span v-if="err(`categoryBudgets.${i}.budget`)" class="field-error">{{
                err(`categoryBudgets.${i}.budget`)
              }}</span>
            </div>
            <button
              type="button"
              class="btn btn-secondary"
              :aria-label="`ลบงบ ${b.category}`"
              @click="form.categoryBudgets.splice(i, 1)"
            >
              ลบ
            </button>
          </li>
        </ul>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="form.categoryBudgets.length >= MAX_CATEGORY_BUDGETS"
          @click="addBudget"
        >
          + เพิ่มงบหมวด
        </button>
      </section>

      <section class="card stack" aria-labelledby="s-remind">
        <h2 id="s-remind">แจ้งเตือนรายวัน</h2>
        <label class="check">
          <input v-model="form.dailyReminder.enabled" type="checkbox" />
          เตือนให้บันทึกรายการทุกวัน
        </label>
        <div class="field">
          <label :for="id('time')">เวลา</label>
          <input
            :id="id('time')"
            v-model="form.dailyReminder.time"
            type="time"
            :aria-invalid="!!err('dailyReminder.time')"
          />
        </div>
        <p v-if="!remindersSupported()" class="field-hint">
          การแจ้งเตือนทำงานบนแอป Android (บนเว็บจะบันทึกค่าไว้แต่ไม่แจ้งเตือน)
        </p>
      </section>

      <div class="save-bar">
        <button type="submit" class="btn" :disabled="saving || readOnly">
          {{ saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า' }}
        </button>
      </div>
    </form>

    <section class="card stack" aria-labelledby="s-data">
      <h2 id="s-data">ข้อมูลของฉัน</h2>
      <p>ส่งออกรายการทั้งหมดของคุณ</p>
      <div class="actions">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="exporting || readOnly"
          @click="onExport('csv')"
        >
          ส่งออก CSV
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="exporting || readOnly"
          @click="onExport('json')"
        >
          ส่งออก JSON
        </button>
      </div>
    </section>

    <section class="card stack danger" aria-labelledby="s-danger">
      <h2 id="s-danger">โซนอันตราย</h2>
      <p>ลบบัญชีจะลบรายการ การตั้งค่า เหรียญรางวัล และบัญชีผู้ใช้ทั้งหมดอย่างถาวร</p>
      <div class="field">
        <label :for="id('confirm')">พิมพ์ "{{ ACCOUNT_DELETE_CONFIRMATION }}" เพื่อยืนยัน</label>
        <input
          :id="id('confirm')"
          v-model="confirmText"
          type="text"
          autocomplete="off"
          :disabled="readOnly"
        />
      </div>
      <button
        type="button"
        class="btn btn-danger"
        :disabled="confirmText !== ACCOUNT_DELETE_CONFIRMATION || deleting || readOnly"
        @click="onDeleteAccount"
      >
        {{ deleting ? 'กำลังลบ…' : 'ลบบัญชีถาวร' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: grid;
  gap: 1rem;
}
.settings h1 {
  margin: 0;
}
.stack {
  display: grid;
  gap: 0.75rem;
}
.card h2 {
  font-size: 1.125rem;
  margin: 0;
}
h3 {
  font-size: 1rem;
  margin: 0.5rem 0 0;
}
.colors,
.chips {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.chips legend {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
.color,
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0.25rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}
.color.active {
  border-color: var(--text);
  border-width: 2px;
  font-weight: 700;
}
.dot {
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 50%;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
}
.check input,
.chip input {
  width: 1.25rem;
  height: 1.25rem;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.row {
  display: grid;
  grid-template-columns: 2fr 1fr auto;
  gap: 0.5rem;
  align-items: end;
}
@media (max-width: 30rem) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
  .row .btn {
    grid-column: span 2;
  }
}
.save-bar {
  position: sticky;
  bottom: 0;
  padding: 0.75rem 0;
  background: linear-gradient(transparent, var(--bg) 30%);
}
.save-bar .btn {
  width: 100%;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.danger {
  border: 2px solid #fecaca;
}
.danger h2 {
  color: var(--danger);
}
</style>
