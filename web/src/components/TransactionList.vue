<script setup lang="ts">
import { formatBaht, type Transaction } from '@money-flow/shared';
import { computed, ref, watch } from 'vue';
import { formatThaiDate } from '../lib/date';
import type { OutboxEntry } from '../offline/outbox';

/** จำนวนแถวที่ render ต่อครั้ง (ลด DOM เมื่อมีรายการมาก) */
const RENDER_CHUNK = 50;

const props = defineProps<{
  items: readonly Transaction[];
  pending: readonly OutboxEntry[];
  online: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  edit: [t: Transaction];
  remove: [t: Transaction];
  bulkRemove: [ids: string[]];
  loadMore: [];
  discardPending: [key: string];
}>();

const visible = ref(RENDER_CHUNK);
const selected = ref(new Set<string>());
const selecting = ref(false);

// เปลี่ยนเดือน (items ถูกแทนทั้งชุด) → เริ่มนับใหม่และล้างการเลือก
watch(
  () => props.items.length === 0,
  (empty) => {
    if (empty) {
      visible.value = RENDER_CHUNK;
      selected.value = new Set();
    }
  },
);
watch(
  () => props.items,
  (items) => {
    const ids = new Set(items.map((t) => t.id));
    const next = new Set([...selected.value].filter((id) => ids.has(id)));
    if (next.size !== selected.value.size) selected.value = next;
  },
);

const shown = computed(() => props.items.slice(0, visible.value));
const canShowMore = computed(() => visible.value < props.items.length || props.hasMore);
const allShownSelected = computed(
  () => shown.value.length > 0 && shown.value.every((t) => selected.value.has(t.id)),
);

function showMore() {
  if (visible.value + RENDER_CHUNK > props.items.length && props.hasMore) emit('loadMore');
  visible.value += RENDER_CHUNK;
}

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAll() {
  selected.value = allShownSelected.value ? new Set() : new Set(shown.value.map((t) => t.id));
}

function exitSelecting() {
  selecting.value = false;
  selected.value = new Set();
}

function bulkRemove() {
  emit('bulkRemove', [...selected.value]);
  exitSelecting();
}

const amountText = (t: { type: string; amount: number }) =>
  `${t.type === 'income' ? '+' : '−'}${formatBaht(t.amount)}`;
</script>

<template>
  <section class="card list" aria-labelledby="tx-list-title">
    <div class="list-head">
      <h2 id="tx-list-title">รายการ</h2>
      <div class="head-actions">
        <template v-if="selecting">
          <button type="button" class="btn btn-secondary" @click="toggleAll">
            {{ allShownSelected ? 'ไม่เลือกทั้งหมด' : 'เลือกทั้งหมด' }}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="selected.size === 0 || !online || busy"
            @click="bulkRemove"
          >
            ลบที่เลือก ({{ selected.size }})
          </button>
          <button type="button" class="btn btn-secondary" @click="exitSelecting">ยกเลิก</button>
        </template>
        <button
          v-else
          type="button"
          class="btn btn-secondary"
          :disabled="items.length === 0 || !online"
          @click="selecting = true"
        >
          เลือกหลายรายการ
        </button>
      </div>
    </div>
    <p v-if="!online" class="field-hint">ออฟไลน์: เพิ่มรายการได้ แต่แก้ไข/ลบได้เมื่อออนไลน์</p>

    <!-- รายการที่รอซิงก์ (บันทึกตอนออฟไลน์) -->
    <ul v-if="pending.length" class="rows" aria-label="รายการที่รอซิงก์">
      <li v-for="p in pending" :key="p.idempotencyKey" class="row pending">
        <div class="main">
          <span class="desc">{{ p.input.description }}</span>
          <span class="meta">
            {{ formatThaiDate(p.input.transactionDate) }}
            <span v-if="p.input.category"> · {{ p.input.category }}</span>
            ·
            <strong v-if="p.status === 'failed'" class="failed">
              ซิงก์ไม่สำเร็จ: {{ p.error }}
            </strong>
            <span v-else class="badge">รอซิงก์</span>
          </span>
        </div>
        <span class="amount" :class="`amount-${p.input.type}`">{{ amountText(p.input) }}</span>
        <button
          type="button"
          class="btn btn-link"
          :aria-label="`ยกเลิกรายการที่รอซิงก์ ${p.input.description}`"
          @click="emit('discardPending', p.idempotencyKey)"
        >
          ทิ้ง
        </button>
      </li>
    </ul>

    <div v-if="loading" aria-busy="true" class="rows">
      <span class="visually-hidden">กำลังโหลดรายการ</span>
      <span v-for="n in 4" :key="n" class="skeleton row-skeleton" />
    </div>

    <p v-else-if="items.length === 0 && pending.length === 0" class="empty">
      ยังไม่มีรายการในเดือนนี้
    </p>

    <ul v-else class="rows">
      <li
        v-for="t in shown"
        :key="t.id"
        class="row"
        :class="{ selected: selected.has(t.id) }"
        data-testid="tx-row"
      >
        <label v-if="selecting" class="check">
          <input type="checkbox" :checked="selected.has(t.id)" @change="toggle(t.id)" />
          <span class="visually-hidden">เลือก {{ t.description }}</span>
        </label>
        <div class="main">
          <span class="desc">{{ t.description }}</span>
          <span class="meta">
            {{ formatThaiDate(t.transactionDate) }}
            <span v-if="t.category"> · {{ t.category }}</span>
          </span>
        </div>
        <span class="amount" :class="`amount-${t.type}`">
          <span class="visually-hidden">{{ t.type === 'income' ? 'รายรับ' : 'รายจ่าย' }}</span>
          {{ amountText(t) }}
        </span>
        <div v-if="!selecting" class="row-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="!online || busy"
            :aria-label="`แก้ไข ${t.description}`"
            @click="emit('edit', t)"
          >
            แก้ไข
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="!online || busy"
            :aria-label="`ลบ ${t.description}`"
            @click="emit('remove', t)"
          >
            ลบ
          </button>
        </div>
      </li>
    </ul>

    <div v-if="!loading && canShowMore" class="more">
      <button type="button" class="btn btn-secondary" :disabled="loadingMore" @click="showMore">
        {{ loadingMore ? 'กำลังโหลด…' : 'แสดงเพิ่ม' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.list {
  display: grid;
  gap: 0.5rem;
}
.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.list-head h2 {
  margin: 0;
}
.head-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
  border-bottom: 1px solid #e5e7eb;
}
.row.selected {
  background: #eff6ff;
}
.row.pending {
  background: var(--warning-bg);
  padding-inline: 0.5rem;
  border-radius: 0.375rem;
}
.check input {
  width: 1.375rem;
  height: 1.375rem;
}
.main {
  flex: 1;
  min-width: 0;
  display: grid;
}
.desc {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.meta {
  color: var(--muted);
  font-size: 0.875rem;
}
.badge {
  color: var(--warning-text);
  font-weight: 600;
}
.failed {
  color: var(--danger);
}
.amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.row-actions {
  display: flex;
  gap: 0.25rem;
}
.row-actions .btn {
  padding-inline: 0.75rem;
}
.row-skeleton {
  height: 3rem;
  margin-block: 0.25rem;
}
.empty {
  color: var(--muted);
  text-align: center;
  padding: 1.5rem 0;
}
.more {
  display: flex;
  justify-content: center;
}
@media (max-width: 30rem) {
  .row {
    flex-wrap: wrap;
  }
  .row-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
