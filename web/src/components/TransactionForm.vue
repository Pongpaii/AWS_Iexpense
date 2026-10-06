<script setup lang="ts">
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  formatZodError,
  transactionCreateSchema,
  transactionUpdateSchema,
  type Transaction,
  type TransactionCreateInput,
  type TransactionUpdateInput,
} from '@money-flow/shared';
import { computed, nextTick, reactive, ref, useId, watch } from 'vue';
import { clientTimeZone, todayLocal } from '../lib/date';

const props = defineProps<{
  /** มีค่า = โหมดแก้ไข */
  editing?: Transaction | null;
  submitting?: boolean;
  /** โหมดแก้ไขต้องออนไลน์ */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  create: [input: TransactionCreateInput];
  update: [id: string, patch: TransactionUpdateInput];
  cancel: [];
}>();

const uid = useId();
const id = (name: string) => `${uid}-${name}`;
const formEl = ref<HTMLFormElement | null>(null);

const blank = () => ({
  type: 'expense' as 'income' | 'expense',
  description: '',
  amount: '' as string | number,
  category: '',
  transactionDate: todayLocal(),
});
const form = reactive(blank());
const errors = ref<Record<string, string>>({});
const formError = ref('');
/**
 * idempotencyKey สร้างครั้งเดียวต่อ "การกรอก 1 รายการ"
 * กดบันทึกซ้ำ/ลองใหม่หลัง error ใช้ key เดิม → server ไม่บันทึกซ้ำ
 */
let idempotencyKey = crypto.randomUUID();

const isEdit = computed(() => !!props.editing);
const categories = computed(() =>
  form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES,
);

watch(
  () => props.editing,
  (t) => {
    errors.value = {};
    formError.value = '';
    if (t) {
      Object.assign(form, {
        type: t.type,
        description: t.description,
        amount: String(t.amount),
        category: t.category ?? '',
        transactionDate: t.transactionDate,
      });
    } else {
      Object.assign(form, blank());
    }
  },
  { immediate: true },
);

/** เปลี่ยนประเภทแล้วหมวดเดิมไม่มีในรายการ → ล้าง */
watch(
  () => form.type,
  () => {
    if (form.category && !(categories.value as readonly string[]).includes(form.category)) {
      form.category = '';
    }
  },
);

function values() {
  return {
    description: form.description,
    // v-model บน type=number ให้ค่าเป็น number (หรือ '' เมื่อว่าง)
    amount: String(form.amount ?? '').trim() === '' ? Number.NaN : Number(form.amount),
    type: form.type,
    category: form.category || null,
    transactionDate: form.transactionDate,
  };
}

async function focusFirstError() {
  await nextTick();
  formEl.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

async function onSubmit() {
  formError.value = '';
  const v = values();

  if (props.editing) {
    const t = props.editing;
    const patch: Record<string, unknown> = {};
    if (v.description.trim() !== t.description) patch.description = v.description;
    if (v.amount !== t.amount) patch.amount = v.amount;
    if (v.type !== t.type) patch.type = v.type;
    if (v.category !== t.category) patch.category = v.category;
    if (v.transactionDate !== t.transactionDate) patch.transactionDate = v.transactionDate;
    if (Object.keys(patch).length === 0) {
      formError.value = 'ยังไม่มีการเปลี่ยนแปลง';
      return;
    }
    const r = transactionUpdateSchema.safeParse(patch);
    if (!r.success) {
      errors.value = formatZodError(r.error).fields;
      return focusFirstError();
    }
    errors.value = {};
    emit('update', t.id, patch as TransactionUpdateInput);
    return;
  }

  const input: TransactionCreateInput = {
    ...v,
    clientTimezone: clientTimeZone(),
    idempotencyKey,
  };
  const r = transactionCreateSchema.safeParse(input);
  if (!r.success) {
    errors.value = formatZodError(r.error).fields;
    return focusFirstError();
  }
  errors.value = {};
  emit('create', input);
}

/** เรียกจาก parent เมื่อบันทึกสำเร็จ → ล้างฟอร์ม + key ใหม่ */
function reset() {
  Object.assign(form, { ...blank(), type: form.type, transactionDate: form.transactionDate });
  errors.value = {};
  formError.value = '';
  idempotencyKey = crypto.randomUUID();
}

function showError(message: string) {
  formError.value = message;
}

defineExpose({ reset, showError, focus: () => formEl.value?.querySelector('input')?.focus() });

const describedBy = (name: string, hint = false) =>
  [hint ? id(`${name}-hint`) : '', errors.value[name] ? id(`${name}-error`) : '']
    .filter(Boolean)
    .join(' ') || undefined;
</script>

<template>
  <form
    ref="formEl"
    class="card tx-form"
    novalidate
    :aria-labelledby="id('title')"
    @submit.prevent="onSubmit"
  >
    <h2 :id="id('title')">{{ isEdit ? 'แก้ไขรายการ' : 'เพิ่มรายการ' }}</h2>

    <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>

    <fieldset class="field type-toggle">
      <legend>ประเภท</legend>
      <label :class="{ active: form.type === 'expense' }">
        <input v-model="form.type" type="radio" name="type" value="expense" />
        รายจ่าย
      </label>
      <label :class="{ active: form.type === 'income' }">
        <input v-model="form.type" type="radio" name="type" value="income" />
        รายรับ
      </label>
    </fieldset>

    <div class="field">
      <label :for="id('description')">รายละเอียด</label>
      <input
        :id="id('description')"
        v-model="form.description"
        type="text"
        maxlength="120"
        autocomplete="off"
        required
        :aria-invalid="!!errors.description"
        :aria-describedby="describedBy('description')"
      />
      <span v-if="errors.description" :id="id('description-error')" class="field-error">
        {{ errors.description }}
      </span>
    </div>

    <div class="row">
      <div class="field">
        <label :for="id('amount')">จำนวนเงิน (บาท)</label>
        <input
          :id="id('amount')"
          v-model="form.amount"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          required
          :aria-invalid="!!errors.amount"
          :aria-describedby="describedBy('amount', true)"
        />
        <span :id="id('amount-hint')" class="field-hint">จำนวนเต็ม ไม่มีทศนิยม</span>
        <span v-if="errors.amount" :id="id('amount-error')" class="field-error">
          {{ errors.amount }}
        </span>
      </div>

      <div class="field">
        <label :for="id('date')">วันที่</label>
        <input
          :id="id('date')"
          v-model="form.transactionDate"
          type="date"
          min="1970-01-01"
          required
          :aria-invalid="!!errors.transactionDate"
          :aria-describedby="describedBy('transactionDate')"
        />
        <span v-if="errors.transactionDate" :id="id('transactionDate-error')" class="field-error">
          {{ errors.transactionDate }}
        </span>
      </div>
    </div>

    <div class="field">
      <label :for="id('category')">หมวดหมู่ <span class="field-hint">(ไม่บังคับ)</span></label>
      <select
        :id="id('category')"
        v-model="form.category"
        :aria-invalid="!!errors.category"
        :aria-describedby="describedBy('category')"
      >
        <option value="">ไม่ระบุ</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        <option
          v-if="form.category && !(categories as readonly string[]).includes(form.category)"
          :value="form.category"
        >
          {{ form.category }}
        </option>
      </select>
      <span v-if="errors.category" :id="id('category-error')" class="field-error">
        {{ errors.category }}
      </span>
    </div>

    <div class="actions">
      <button type="submit" class="btn" :disabled="submitting || (isEdit && disabled)">
        {{ submitting ? 'กำลังบันทึก…' : isEdit ? 'บันทึกการแก้ไข' : 'บันทึก' }}
      </button>
      <button v-if="isEdit" type="button" class="btn btn-secondary" @click="emit('cancel')">
        ยกเลิก
      </button>
    </div>
    <p v-if="isEdit && disabled" class="field-hint">แก้ไขได้เฉพาะตอนออนไลน์</p>
  </form>
</template>

<style scoped>
.tx-form {
  display: grid;
  gap: 0.875rem;
}
.row {
  display: grid;
  gap: 0.875rem;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
}
.type-toggle {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.type-toggle legend {
  margin-bottom: 0.25rem;
}
.type-toggle label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  padding: 0.25rem 1rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  font-weight: 500;
}
.type-toggle label.active {
  border-color: var(--primary);
  background: #ecfdf5;
  font-weight: 700;
}
.type-toggle input {
  width: 1.125rem;
  height: 1.125rem;
  accent-color: var(--primary);
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
