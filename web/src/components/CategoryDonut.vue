<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Transaction, TransactionType } from '../types/transaction'
import { buildCategoryBreakdown, categoryPalette, formatPercent } from '../utils/categoryBreakdown'
import { formatBaht, formatDate } from '../utils/format'

const props = withDefaults(
  defineProps<{
    transactions: Transaction[]
    type?: TransactionType
    showTypeToggle?: boolean
    framed?: boolean
    eyebrow?: string
    title?: string
    emptyHint?: string
    showItemDate?: boolean
  }>(),
  {
    type: 'expense',
    showTypeToggle: false,
    framed: true,
    eyebrow: '',
    title: '',
    emptyHint: 'เมื่อมีรายการ ระบบจะแยกสัดส่วนตามหมวดหมู่ให้ทันที',
    showItemDate: true,
  },
)

const RADIUS = 44
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const activeType = ref<TransactionType>(props.type)
const selectedKey = ref<string | null>(null)

watch(
  () => props.type,
  (next) => {
    activeType.value = next
    selectedKey.value = null
  },
)

const breakdown = computed(() =>
  buildCategoryBreakdown(props.transactions, activeType.value, categoryPalette),
)
const slices = computed(() => breakdown.value.slices)
const total = computed(() => breakdown.value.total)

watch(slices, (next) => {
  if (selectedKey.value && !next.some(({ key }) => key === selectedKey.value))
    selectedKey.value = null
})

const selectedSlice = computed(
  () => slices.value.find(({ key }) => key === selectedKey.value) ?? null,
)

const segments = computed(() => {
  let start = 0
  return slices.value.map((slice) => {
    const length = (slice.percentage / 100) * CIRCUMFERENCE
    const segment = {
      ...slice,
      dashArray: `${length} ${Math.max(CIRCUMFERENCE - length, 0)}`,
      dashOffset: -((start / 100) * CIRCUMFERENCE),
    }
    start += slice.percentage
    return segment
  })
})

const typeLabel = computed(() => (activeType.value === 'expense' ? 'รายจ่าย' : 'รายรับ'))

const toggleSlice = (key: string) => {
  selectedKey.value = selectedKey.value === key ? null : key
}

const switchType = (next: TransactionType) => {
  if (activeType.value === next) return
  activeType.value = next
  selectedKey.value = null
}

const itemShare = (amount: number) => {
  const categoryTotal = selectedSlice.value?.amount ?? 0
  return categoryTotal > 0 ? (Number(amount) / categoryTotal) * 100 : 0
}
</script>

<template>
  <section class="donut-card" :class="{ 'donut-card--framed': framed }">
    <header v-if="title || showTypeToggle" class="donut-card-heading">
      <div v-if="title">
        <span v-if="eyebrow">{{ eyebrow }}</span>
        <h2>{{ title }}</h2>
      </div>
      <div v-if="showTypeToggle" class="type-toggle" role="group" aria-label="เลือกชนิดของสัดส่วน">
        <button
          type="button"
          :class="{ active: activeType === 'expense' }"
          @click="switchType('expense')"
        >
          รายจ่าย
        </button>
        <button
          type="button"
          :class="{ active: activeType === 'income' }"
          @click="switchType('income')"
        >
          รายรับ
        </button>
      </div>
    </header>

    <div v-if="total > 0" class="donut-body">
      <div class="donut-visual">
        <svg viewBox="0 0 120 120" class="donut-svg" role="presentation">
          <g transform="rotate(-90 60 60)">
            <circle class="donut-track" cx="60" cy="60" :r="RADIUS" />
            <circle
              v-for="segment in segments"
              :key="segment.key"
              class="donut-segment"
              :class="{
                'is-selected': segment.key === selectedKey,
                'is-dimmed': selectedKey !== null && segment.key !== selectedKey,
              }"
              cx="60"
              cy="60"
              :r="RADIUS"
              :stroke="segment.color"
              :stroke-dasharray="segment.dashArray"
              :stroke-dashoffset="segment.dashOffset"
              @click="toggleSlice(segment.key)"
            >
              <title>
                {{ segment.label }} {{ formatBaht(segment.amount) }} ({{
                  formatPercent(segment.percentage)
                }})
              </title>
            </circle>
          </g>
        </svg>

        <div class="donut-center" aria-live="polite">
          <template v-if="selectedSlice">
            <small>{{ selectedSlice.emoji }} {{ selectedSlice.label }}</small>
            <strong>{{ formatBaht(selectedSlice.amount) }}</strong>
            <em>{{ formatPercent(selectedSlice.percentage) }} ของ{{ typeLabel }}</em>
          </template>
          <template v-else>
            <small>{{ typeLabel }}รวม</small>
            <strong>{{ formatBaht(total) }}</strong>
            <em>{{ slices.length }} หมวดหมู่</em>
          </template>
        </div>
      </div>

      <p class="donut-hint">
        {{
          selectedSlice
            ? 'กดหมวดเดิมอีกครั้งเพื่อดูภาพรวมทั้งหมด'
            : 'กดที่กราฟหรือรายการหมวดหมู่ เพื่อดูว่ามีรายการอะไรอยู่ในนั้น'
        }}
      </p>

      <ul class="donut-legend">
        <li v-for="slice in slices" :key="slice.key">
          <button
            type="button"
            class="legend-row"
            :class="{ 'is-selected': slice.key === selectedKey }"
            :aria-expanded="slice.key === selectedKey"
            @click="toggleSlice(slice.key)"
          >
            <span class="legend-name">
              <i :style="{ background: slice.color }" aria-hidden="true"></i>
              <b>{{ slice.emoji }} {{ slice.label }}</b>
              <em>{{ slice.items.length }} รายการ</em>
            </span>
            <span class="legend-value">
              <b>{{ formatBaht(slice.amount) }}</b>
              <small>{{ formatPercent(slice.percentage) }}</small>
              <i class="legend-caret" aria-hidden="true">▾</i>
            </span>
            <span class="legend-bar" aria-hidden="true">
              <i
                :style="{ width: `${Math.max(slice.percentage, 1.5)}%`, background: slice.color }"
              ></i>
            </span>
          </button>

          <ul v-if="slice.key === selectedKey" class="legend-items">
            <li v-for="item in slice.items" :key="item.id">
              <span class="item-main">
                <b>{{ item.description }}</b>
                <small v-if="showItemDate">{{ formatDate(item.transaction_date) }}</small>
              </span>
              <span class="item-value">
                <b>{{ formatBaht(Number(item.amount)) }}</b>
                <small>{{ formatPercent(itemShare(item.amount)) }} ของหมวด</small>
              </span>
            </li>
          </ul>
        </li>
      </ul>
    </div>

    <div v-else class="donut-empty">
      <div aria-hidden="true">◔</div>
      <strong>ยังไม่มี{{ typeLabel }}ในช่วงนี้</strong>
      <p>{{ emptyHint }}</p>
    </div>
  </section>
</template>

<style scoped>
.donut-card {
  min-width: 0;
}
.donut-card--framed {
  padding: 17px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
  box-shadow: 0 8px 24px rgba(23, 45, 36, 0.045);
}
.donut-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 13px;
}
.donut-card-heading span {
  color: #71877d;
  font-size: 0.53rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.donut-card-heading h2 {
  margin: 2px 0 0;
  font:
    700 0.86rem 'Noto Sans Thai',
    sans-serif;
  color: var(--ink);
}

.type-toggle {
  display: flex;
  padding: 3px;
  border-radius: 9px;
  background: #e9efeb;
}
.type-toggle button {
  min-height: 27px;
  padding: 3px 10px;
  border: 0;
  border-radius: 7px;
  color: #728078;
  background: transparent;
  font:
    700 0.58rem 'Noto Sans Thai',
    sans-serif;
}
.type-toggle button.active {
  color: #20563e;
  background: #fff;
  box-shadow: 0 2px 7px rgba(25, 77, 59, 0.1);
}

.donut-body {
  display: grid;
  gap: 10px;
}
.donut-visual {
  position: relative;
  display: grid;
  width: 152px;
  place-items: center;
  margin: 0 auto;
}
.donut-svg {
  width: 152px;
  height: 152px;
}
.donut-track {
  fill: none;
  stroke: #eaefeb;
  stroke-width: 15;
}
.donut-segment {
  fill: none;
  stroke-width: 15;
  cursor: pointer;
  transition:
    stroke-width 0.18s ease,
    opacity 0.18s ease,
    stroke-dasharray 0.4s ease;
}
.donut-segment:hover {
  stroke-width: 19;
}
.donut-segment.is-selected {
  stroke-width: 20;
}
.donut-segment.is-dimmed {
  opacity: 0.3;
}

.donut-center {
  position: absolute;
  display: grid;
  width: 92px;
  justify-items: center;
  gap: 1px;
  text-align: center;
  pointer-events: none;
}
.donut-center small {
  overflow: hidden;
  max-width: 100%;
  color: #849089;
  font:
    600 0.5rem 'Noto Sans Thai',
    sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.donut-center strong {
  color: #263e33;
  font:
    700 0.69rem 'Noto Sans Thai',
    sans-serif;
}
.donut-center em {
  color: #93a09a;
  font:
    500 0.46rem 'Noto Sans Thai',
    sans-serif;
  font-style: normal;
}

.donut-hint {
  margin: 0;
  color: #8b968f;
  font:
    500 0.52rem 'Noto Sans Thai',
    sans-serif;
  text-align: center;
}

.donut-legend {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.legend-row {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s,
    border-color 0.16s;
}
.legend-row:hover {
  background: #f2f6f3;
}
.legend-row.is-selected {
  border-color: #d7e4dc;
  background: #f0f6f2;
}
.legend-row:focus-visible {
  outline: 3px solid rgba(73, 137, 103, 0.22);
  outline-offset: 1px;
}
.legend-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.legend-name i {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
}
.legend-name b {
  overflow: hidden;
  color: #46584f;
  font:
    700 0.6rem 'Noto Sans Thai',
    sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-name em {
  flex: 0 0 auto;
  color: #96a09b;
  font:
    500 0.5rem 'Noto Sans Thai',
    sans-serif;
  font-style: normal;
}
.legend-value {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.legend-value b {
  color: #334d41;
  font:
    700 0.61rem 'Noto Sans Thai',
    sans-serif;
}
.legend-value small {
  min-width: 26px;
  color: #8d9792;
  font:
    600 0.55rem 'Noto Sans Thai',
    sans-serif;
  text-align: right;
}
.legend-caret {
  color: #9aa5a0;
  font-size: 0.5rem;
  font-style: normal;
  transition: transform 0.18s ease;
}
.legend-row.is-selected .legend-caret {
  transform: rotate(180deg);
}
.legend-bar {
  grid-column: 1 / -1;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf0ee;
}
.legend-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.4s ease;
}

.legend-items {
  display: grid;
  gap: 4px;
  margin: 5px 0 4px;
  padding: 7px 8px;
  border-left: 2px solid #dbe6e0;
  border-radius: 0 9px 9px 0;
  background: #f7faf8;
  list-style: none;
}
.legend-items li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.item-main {
  display: grid;
  min-width: 0;
}
.item-main b {
  overflow: hidden;
  color: #43554c;
  font:
    600 0.58rem 'Noto Sans Thai',
    sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-main small {
  color: #98a29d;
  font:
    500 0.48rem 'Noto Sans Thai',
    sans-serif;
}
.item-value {
  display: grid;
  justify-items: end;
  white-space: nowrap;
}
.item-value b {
  color: #2f4a3d;
  font:
    700 0.58rem 'Noto Sans Thai',
    sans-serif;
}
.item-value small {
  color: #98a29d;
  font:
    500 0.46rem 'Noto Sans Thai',
    sans-serif;
}

.donut-empty {
  display: flex;
  min-height: 175px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  color: #7b8781;
  font-family: 'Noto Sans Thai', sans-serif;
  text-align: center;
}
.donut-empty > div {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  color: #56816c;
  background: #edf4f0;
  font-size: 1.1rem;
}
.donut-empty strong {
  color: #30483d;
  font-size: 0.72rem;
}
.donut-empty p {
  max-width: 300px;
  margin: 0;
  font-size: 0.57rem;
}

@media (min-width: 700px) {
  .donut-card--wide .donut-body {
    grid-template-columns: 168px minmax(0, 1fr);
    align-items: start;
    column-gap: 18px;
  }
  .donut-card--wide .donut-hint {
    grid-column: 1;
    margin-top: -4px;
  }
  .donut-card--wide .donut-legend {
    grid-row: 1 / span 2;
    grid-column: 2;
  }
}

@media (max-width: 580px) {
  .donut-card--framed {
    padding: 14px;
  }
  .donut-visual,
  .donut-svg {
    width: 138px;
  }
  .donut-svg {
    height: 138px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .donut-segment,
  .legend-bar i,
  .legend-caret {
    transition: none;
  }
}
</style>
