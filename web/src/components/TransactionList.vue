<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getCategoryEmoji, type Transaction } from '../types/transaction'
import { formatBaht, formatDate } from '../utils/format'

const props = withDefaults(
  defineProps<{
    transactions: Transaction[]
    loading: boolean
    busyId: string | null
    selectionMode: boolean
    bulkBusy: boolean
    emptyHint: string
    readOnly?: boolean
    /** จำนวนแถวที่วาดต่อหนึ่งหน้า ตั้งเป็น 0 เพื่อวาดทั้งหมด */
    pageSize?: number
  }>(),
  { readOnly: false, pageSize: 50 },
)

const emit = defineEmits<{
  edit: [transaction: Transaction]
  delete: [transaction: Transaction]
  bulkDelete: [ids: string[]]
  cancelSelection: []
}>()

const selectedIds = ref<string[]>([])

/**
 * วาดทีละหน้าเพื่อไม่ให้ DOM บวมเมื่อประวัติยาวเป็นพันแถว
 * ข้อมูลทั้งหมดยังอยู่ใน props ครบ (ยอดสรุปจึงถูกต้อง) แค่จำกัดจำนวนที่ render
 */
const visibleCount = ref(props.pageSize > 0 ? props.pageSize : Number.POSITIVE_INFINITY)

const visibleTransactions = computed(() =>
  Number.isFinite(visibleCount.value)
    ? props.transactions.slice(0, visibleCount.value)
    : props.transactions,
)

const hiddenCount = computed(() =>
  Math.max(0, props.transactions.length - visibleTransactions.value.length),
)

const showMore = () => {
  const step = props.pageSize > 0 ? props.pageSize : props.transactions.length
  visibleCount.value = Math.min(visibleCount.value + step, props.transactions.length)
}

const resetVisibleCount = () => {
  visibleCount.value = props.pageSize > 0 ? props.pageSize : Number.POSITIVE_INFINITY
}

const allSelected = computed(
  () => props.transactions.length > 0 && selectedIds.value.length === props.transactions.length,
)

const isSelected = (id: string) => selectedIds.value.includes(id)

const toggleSelection = (id: string) => {
  selectedIds.value = isSelected(id)
    ? selectedIds.value.filter((selectedId) => selectedId !== id)
    : [...selectedIds.value, id]
}

const toggleAll = () => {
  selectedIds.value = allSelected.value ? [] : props.transactions.map(({ id }) => id)
}

const requestBulkDelete = () => {
  if (selectedIds.value.length === 0) return
  emit('bulkDelete', [...selectedIds.value])
}

watch(
  () => props.selectionMode,
  (enabled) => {
    if (!enabled) selectedIds.value = []
    // เข้า/ออกโหมดเลือก ชุดข้อมูลที่แสดงเปลี่ยนไปคนละชุด เริ่มนับหน้าใหม่
    resetVisibleCount()
  },
)

watch(
  () => props.transactions,
  (transactions) => {
    const availableIds = new Set(transactions.map(({ id }) => id))
    selectedIds.value = selectedIds.value.filter((id) => availableIds.has(id))

    // คงจำนวนที่ผู้ใช้กดขยายไว้ แต่ไม่ให้เกินจำนวนที่มีจริง
    if (Number.isFinite(visibleCount.value)) {
      const floor = props.pageSize > 0 ? props.pageSize : transactions.length
      visibleCount.value = Math.max(floor, Math.min(visibleCount.value, transactions.length))
    }
  },
)
</script>

<template>
  <section class="panel list-panel" :class="{ 'list-panel--selecting': selectionMode }">
    <div class="panel-heading list-heading">
      <div>
        <span class="eyebrow">{{ selectionMode ? 'จัดการข้อมูล' : 'ประวัติ' }}</span>
        <h2>{{ selectionMode ? `เลือกแล้ว ${selectedIds.length} รายการ` : 'รายการล่าสุด' }}</h2>
      </div>

      <div v-if="selectionMode" class="selection-tools">
        <button class="select-all-button" type="button" :disabled="bulkBusy" @click="toggleAll">
          {{ allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด' }}
        </button>
        <button
          class="cancel-select-button"
          type="button"
          :disabled="bulkBusy"
          @click="emit('cancelSelection')"
        >
          เสร็จสิ้น
        </button>
      </div>
      <div v-else class="list-meta">
        <span v-if="readOnly" class="read-only-chip">ดูอย่างเดียว</span>
        <span class="item-count">{{ transactions.length }} รายการ</span>
      </div>
    </div>

    <div v-if="selectionMode && transactions.length > 0" class="selection-bar">
      <span>แตะช่องด้านซ้ายเพื่อเลือกรายการ</span>
      <button
        type="button"
        :disabled="selectedIds.length === 0 || bulkBusy"
        @click="requestBulkDelete"
      >
        <span v-if="bulkBusy" class="spinner spinner--small" aria-hidden="true"></span>
        {{ bulkBusy ? 'กำลังลบ...' : `ลบที่เลือก (${selectedIds.length})` }}
      </button>
    </div>

    <ul v-if="loading" class="transaction-skeleton" role="status" aria-label="กำลังโหลดรายการ">
      <li v-for="row in 5" :key="row">
        <span class="skeleton skeleton--circle" style="width: 36px; height: 36px"></span>
        <span class="transaction-skeleton__copy">
          <span class="skeleton skeleton--text" :style="{ width: `${68 - row * 5}%` }"></span>
          <span class="skeleton skeleton--text" style="width: 34%; height: 8px"></span>
        </span>
        <span class="skeleton skeleton--text" style="width: 58px"></span>
      </li>
    </ul>

    <div v-else-if="transactions.length === 0" class="state-box">
      <div class="empty-icon" aria-hidden="true">₿</div>
      <h3>ยังไม่มีรายการ</h3>
      <p>{{ emptyHint }}</p>
    </div>

    <TransitionGroup v-else tag="ul" name="transaction" class="transaction-list">
      <li
        v-for="transaction in visibleTransactions"
        :key="transaction.id"
        class="transaction-item"
        :class="{
          'transaction-item--selecting': selectionMode,
          'is-selected': isSelected(transaction.id),
        }"
        @click="selectionMode && toggleSelection(transaction.id)"
      >
        <label v-if="selectionMode" class="select-checkbox" @click.stop>
          <input
            type="checkbox"
            :checked="isSelected(transaction.id)"
            :aria-label="`เลือก ${transaction.description}`"
            :disabled="bulkBusy"
            @change="toggleSelection(transaction.id)"
          />
          <span aria-hidden="true">✓</span>
        </label>

        <div
          class="transaction-icon"
          :class="`transaction-icon--${transaction.type}`"
          aria-hidden="true"
        >
          {{ transaction.type === 'income' ? '↗' : '↘' }}
        </div>

        <div class="transaction-info">
          <strong>{{ transaction.description }}</strong>
          <span>
            {{ formatDate(transaction.transaction_date) }}
            <template v-if="transaction.category">
              · {{ getCategoryEmoji(transaction.category) }} {{ transaction.category }}
            </template>
          </span>
        </div>

        <div class="transaction-amount" :class="`amount--${transaction.type}`">
          <strong>
            {{ transaction.type === 'income' ? '+' : '−' }}{{ formatBaht(transaction.amount) }}
          </strong>
          <span>{{ transaction.type === 'income' ? 'รายรับ' : 'รายจ่าย' }}</span>
        </div>

        <div v-if="!selectionMode && !readOnly" class="transaction-actions">
          <button
            class="icon-button"
            type="button"
            title="แก้ไขรายการ"
            :disabled="busyId === transaction.id"
            @click="emit('edit', transaction)"
          >
            แก้ไข
          </button>
          <button
            class="icon-button icon-button--danger"
            type="button"
            title="ลบรายการ"
            :disabled="busyId === transaction.id"
            @click="emit('delete', transaction)"
          >
            {{ busyId === transaction.id ? 'กำลังลบ' : 'ลบ' }}
          </button>
        </div>
      </li>
    </TransitionGroup>

    <button
      v-if="!loading && hiddenCount > 0"
      class="load-more-button"
      type="button"
      @click="showMore"
    >
      โหลดเพิ่ม
      <small>เหลืออีก {{ hiddenCount }} รายการ</small>
    </button>
  </section>
</template>

<style scoped>
.list-panel {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.list-panel .transaction-list {
  position: relative;
  min-height: 0;
  overflow-y: auto;
  padding-right: 3px;
  scrollbar-width: thin;
  scrollbar-color: #c9d5ce transparent;
}

.list-panel .state-box {
  flex: 1;
}

.transaction-skeleton {
  display: grid;
  gap: 18px;
  margin: 0;
  padding: 6px 0;
  list-style: none;
}

.transaction-skeleton li {
  display: grid;
  align-items: center;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 11px;
}

.transaction-skeleton__copy {
  display: grid;
  gap: 6px;
}

.load-more-button {
  display: flex;
  width: 100%;
  min-height: 38px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px dashed #cfdad4;
  border-radius: 10px;
  color: #2f6b50;
  background: #f7faf8;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.67rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.16s,
    background 0.16s;
}

.load-more-button:hover {
  border-color: #93aa9f;
  background: #eef5f1;
}

.load-more-button:focus-visible {
  outline: 3px solid rgba(47, 129, 92, 0.35);
  outline-offset: 2px;
}

.load-more-button small {
  color: #8b968f;
  font-size: 0.55rem;
  font-weight: 600;
}

.list-heading {
  align-items: center;
}

.list-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.read-only-chip {
  padding: 4px 8px;
  border: 1px solid var(--cheer-line);
  border-radius: 999px;
  color: var(--cheer-text);
  background: var(--cheer-tint);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.55rem;
  font-weight: 700;
  white-space: nowrap;
}

.selection-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.selection-tools button,
.selection-bar button {
  border-radius: 8px;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
}

.select-all-button,
.cancel-select-button {
  padding: 7px 9px;
  border: 1px solid #d7dfda;
  color: #50655b;
  background: #fff;
}

.cancel-select-button {
  color: #256347;
  background: #edf5f0;
}

.selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: -7px 0 10px;
  padding: 10px 12px;
  border-radius: 10px;
  color: #65736c;
  background: #f2f6f3;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.65rem;
}

.selection-bar button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 0;
  color: white;
  background: var(--alert);
}

.spinner--small {
  width: 12px;
  height: 12px;
}

.transaction-item--selecting {
  grid-template-columns: 25px 42px minmax(110px, 1fr) auto;
  margin-inline: -8px;
  padding-inline: 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.transaction-item--selecting.is-selected {
  background: #f0f7f3;
}

.select-checkbox {
  position: relative;
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  cursor: pointer;
}

.select-checkbox input {
  position: absolute;
  width: 20px;
  height: 20px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.select-checkbox span {
  display: grid;
  width: 19px;
  height: 19px;
  place-items: center;
  border: 1.5px solid #bdc9c2;
  border-radius: 6px;
  color: transparent;
  background: white;
  font-size: 0.65rem;
  font-weight: 800;
  transition: all 0.15s;
}

.select-checkbox input:checked + span {
  color: white;
  border-color: #2f815c;
  background: #2f815c;
}

.transaction-enter-active,
.transaction-leave-active,
.transaction-move {
  transition:
    opacity 0.25s ease,
    transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.transaction-enter-from {
  opacity: 0;
  transform: translateX(-12px) scale(0.98);
}

.transaction-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.97);
}

.transaction-leave-active {
  position: absolute;
  width: calc(100% - 36px);
}

.transaction-item:not(.transaction-item--selecting) {
  transition:
    background 0.18s ease,
    transform 0.18s ease;
}

.transaction-item:not(.transaction-item--selecting):hover {
  padding-inline: 7px;
  border-radius: 10px;
  background: #f6f9f7;
  transform: translateX(2px);
}

@media (prefers-reduced-motion: reduce) {
  .transaction-enter-active,
  .transaction-leave-active,
  .transaction-move,
  .transaction-item {
    transition: none !important;
  }
}

@media (max-width: 580px) {
  .list-heading {
    align-items: flex-start;
  }
  .selection-tools {
    align-items: flex-end;
    flex-direction: column;
  }
  .selection-bar {
    align-items: stretch;
    flex-direction: column;
  }
  .selection-bar button {
    justify-content: center;
  }
  .transaction-item--selecting {
    grid-template-columns: 24px 40px minmax(90px, 1fr) auto;
  }
}
</style>
