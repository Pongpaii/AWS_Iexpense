<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDailyCap } from '../composables/useDailyCap'
import { useHeatmapFilter } from '../composables/useHeatmapFilter'
import { getCategoryEmoji, type Transaction, type TransactionCategory } from '../types/transaction'
import {
  getDaysInMonth,
  getFirstDayOfWeek,
  parseIsoMonth,
  shiftIsoMonth,
  toLocalIsoDate,
  weekdayLabelsMondayFirst,
} from '../utils/dateUtils'
import { formatBaht } from '../utils/format'

const props = defineProps<{
  /** รายการทั้งหมด ระบบจะคัดเฉพาะเดือนที่กำลังดูและเฉพาะรายจ่ายเอง */
  transactions: Transaction[]
  /** เดือนเริ่มต้นในรูปแบบ 'YYYY-MM' */
  month: string
}>()

const emit = defineEmits<{
  /** ผู้ใช้กดเลือกวัน (ส่ง 'YYYY-MM-DD') */
  selectDay: [date: string]
  /** ผู้ใช้เลื่อนเดือนในปฏิทิน */
  changeMonth: [month: string]
}>()

const { capEnabled, capForDate } = useDailyCap()
const {
  hiddenCategories,
  hasHiddenCategories,
  hideableCategories,
  isCategoryHidden,
  toggleCategoryHidden,
  showAllCategories,
} = useHeatmapFilter()

const filterOpen = ref(false)

/** รายการที่ปฏิทินนับจริง ตัดหมวดที่ผู้ใช้สั่งซ่อนออกก่อนคำนวณทุกอย่าง */
const visibleTransactions = computed(() => {
  if (!hasHiddenCategories.value) return props.transactions
  return props.transactions.filter(
    ({ category }) => category == null || !hiddenCategories.value.includes(category),
  )
})

const hiddenSummary = computed(() =>
  hiddenCategories.value.map((category) => `${getCategoryEmoji(category)} ${category}`).join(' · '),
)

const onToggleCategory = (category: TransactionCategory) => {
  toggleCategoryHidden(category)
}

const todayDate = toLocalIsoDate(new Date())
const todayMonth = todayDate.slice(0, 7)

const viewMonth = ref(parseIsoMonth(props.month) ? props.month : todayMonth)

watch(
  () => props.month,
  (next) => {
    if (parseIsoMonth(next) && next !== viewMonth.value) viewMonth.value = next
  },
)

const parsedMonth = computed(() => parseIsoMonth(viewMonth.value) ?? parseIsoMonth(todayMonth)!)

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(
    new Date(parsedMonth.value.year, parsedMonth.value.month - 1, 1),
  ),
)

const canGoNext = computed(() => viewMonth.value < todayMonth)

const goToMonth = (offset: number) => {
  const next = shiftIsoMonth(viewMonth.value, offset)
  if (next > todayMonth) return
  viewMonth.value = next
  emit('changeMonth', next)
}

interface DayTotals {
  expense: number
  income: number
  count: number
}

/** รวมยอดรายจ่าย/รายรับต่อวันของเดือนที่กำลังดู */
const totalsByDate = computed(() => {
  const prefix = viewMonth.value
  const map = new Map<string, DayTotals>()

  for (const transaction of visibleTransactions.value) {
    if (!transaction.transaction_date.startsWith(prefix)) continue

    const bucket = map.get(transaction.transaction_date) ?? { expense: 0, income: 0, count: 0 }
    const amount = Number(transaction.amount) || 0
    if (transaction.type === 'expense') bucket.expense += amount
    else bucket.income += amount
    bucket.count += 1
    map.set(transaction.transaction_date, bucket)
  }

  return map
})

/** ยอดรายจ่ายของวันที่มีการใช้เงิน เรียงจากน้อยไปมาก ใช้หา quartile */
const spentValues = computed(() =>
  [...totalsByDate.value.values()]
    .map(({ expense }) => expense)
    .filter((value) => value > 0)
    .sort((a, b) => a - b),
)

/** เมื่อไม่ได้เปิด daily cap จะแบ่งระดับด้วย quartile ของเดือนนั้นแทน */
const quartiles = computed(() => {
  const values = spentValues.value
  if (values.length === 0) return null

  const at = (ratio: number) =>
    values[Math.min(values.length - 1, Math.floor(values.length * ratio))]
  return { q1: at(0.25), q2: at(0.5), q3: at(0.75), max: values[values.length - 1] }
})

const usesCapScale = computed(() => capEnabled.value)

/** 0 = ไม่มีรายจ่าย · 1-4 = ไล่จากน้อยไปมาก · 5 = เกินเพดาน */
const levelForDate = (isoDate: string, spent: number) => {
  if (spent <= 0) return 0

  if (usesCapScale.value) {
    const cap = capForDate(isoDate)
    if (cap > 0) {
      const ratio = spent / cap
      if (ratio > 1) return 5
      if (ratio > 0.75) return 4
      if (ratio > 0.5) return 3
      if (ratio > 0.25) return 2
      return 1
    }
  }

  const scale = quartiles.value
  if (!scale) return 1
  if (spent > scale.q3) return 4
  if (spent > scale.q2) return 3
  if (spent > scale.q1) return 2
  return 1
}

interface HeatmapCell {
  key: string
  date: string | null
  day: number
  spent: number
  income: number
  count: number
  level: number
  isToday: boolean
  isFuture: boolean
  label: string
}

const dayFormatter = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' })

const cells = computed<HeatmapCell[]>(() => {
  const { year, month } = parsedMonth.value
  const leading = getFirstDayOfWeek(year, month)
  const dayCount = getDaysInMonth(year, month)
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const result: HeatmapCell[] = []

  for (let index = 0; index < leading; index += 1) {
    result.push({
      key: `pad-${index}`,
      date: null,
      day: 0,
      spent: 0,
      income: 0,
      count: 0,
      level: 0,
      isToday: false,
      isFuture: false,
      label: '',
    })
  }

  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${monthPrefix}-${String(day).padStart(2, '0')}`
    const totals = totalsByDate.value.get(date)
    const spent = totals?.expense ?? 0
    const dateLabel = dayFormatter.format(new Date(year, month - 1, day))

    result.push({
      key: date,
      date,
      day,
      spent,
      income: totals?.income ?? 0,
      count: totals?.count ?? 0,
      level: levelForDate(date, spent),
      isToday: date === todayDate,
      isFuture: date > todayDate,
      label: totals
        ? `${dateLabel} — ${formatBaht(spent)} (${totals.count} รายการ)`
        : `${dateLabel} — ยังไม่มีรายการ`,
    })
  }

  return result
})

const monthExpense = computed(() =>
  [...totalsByDate.value.values()].reduce((sum, { expense }) => sum + expense, 0),
)

const activeDayCount = computed(() => spentValues.value.length)

const busiestDay = computed(() => {
  let best: HeatmapCell | null = null
  for (const cell of cells.value) {
    if (!cell.date || cell.spent <= 0) continue
    if (!best || cell.spent > best.spent) best = cell
  }
  return best
})

const overCapDays = computed(() => cells.value.filter((cell) => cell.level === 5).length)

const hoveredCell = ref<HeatmapCell | null>(null)

const tooltipText = computed(() => hoveredCell.value?.label ?? '')

const selectDay = (cell: HeatmapCell) => {
  if (!cell.date || cell.isFuture) return
  emit('selectDay', cell.date)
}

const legendLabels = computed(() =>
  usesCapScale.value
    ? ['ไม่มีรายจ่าย', 'ไม่ถึง 25% ของเพดาน', '26-50%', '51-75%', '76-100%', 'เกินเพดาน']
    : ['ไม่มีรายจ่าย', 'ใช้น้อย', 'ค่อนข้างน้อย', 'ค่อนข้างมาก', 'ใช้มาก', 'ใช้มากสุด'],
)
</script>

<template>
  <section class="heatmap-card" aria-labelledby="heatmap-title">
    <header class="heatmap-head">
      <div class="heatmap-head__copy">
        <span class="eyebrow">Spending heatmap</span>
        <h2 id="heatmap-title">ปฏิทินความร้อนรายจ่าย</h2>
      </div>

      <div class="heatmap-nav" role="group" aria-label="เลื่อนเดือนของปฏิทิน">
        <button
          type="button"
          aria-label="เดือนก่อนหน้า"
          title="เดือนก่อนหน้า"
          @click="goToMonth(-1)"
        >
          ◀
        </button>
        <strong>{{ monthLabel }}</strong>
        <button
          type="button"
          aria-label="เดือนถัดไป"
          title="เดือนถัดไป"
          :disabled="!canGoNext"
          @click="goToMonth(1)"
        >
          ▶
        </button>
      </div>
    </header>

    <div class="heatmap-filter">
      <button
        class="heatmap-filter__toggle"
        type="button"
        :aria-expanded="filterOpen"
        aria-controls="heatmap-filter-panel"
        @click="filterOpen = !filterOpen"
      >
        {{
          hasHiddenCategories ? `ซ่อนอยู่ ${hiddenCategories.length} หมวด` : 'เลือกหมวดที่จะแสดง'
        }}
      </button>
      <small v-if="hasHiddenCategories">ไม่นับ {{ hiddenSummary }}</small>
    </div>

    <div v-if="filterOpen" id="heatmap-filter-panel" class="heatmap-filter__panel">
      <p>
        ติ๊กหมวดที่ไม่ต้องให้ปฏิทินนับ เช่น ค่าที่พักที่จ่ายก้อนเดียวทุกเดือน
        จะเห็นชัดขึ้นว่าวันไหนใช้จริงเยอะ
      </p>
      <div class="heatmap-chips">
        <label
          v-for="option in hideableCategories"
          :key="option.value"
          class="heatmap-chip"
          :class="{ 'is-off': isCategoryHidden(option.value) }"
        >
          <input
            type="checkbox"
            :checked="isCategoryHidden(option.value)"
            @change="onToggleCategory(option.value)"
          />
          <span>{{ option.emoji }} {{ option.value }}</span>
        </label>
      </div>
      <button v-if="hasHiddenCategories" type="button" @click="showAllCategories()">
        แสดงทุกหมวดเหมือนเดิม
      </button>
    </div>

    <div class="heatmap-stats">
      <span
        ><small>รายจ่ายเดือนนี้</small><b>{{ formatBaht(monthExpense) }}</b></span
      >
      <span
        ><small>วันที่มีรายจ่าย</small><b>{{ activeDayCount }} วัน</b></span
      >
      <span v-if="busiestDay"
        ><small>วันที่ใช้มากสุด</small
        ><b>{{ busiestDay.day }} — {{ formatBaht(busiestDay.spent) }}</b></span
      >
      <span v-if="usesCapScale && overCapDays > 0" class="heatmap-stats__warn">
        <small>วันที่เกินเพดาน</small><b>{{ overCapDays }} วัน</b>
      </span>
    </div>

    <div class="heatmap-weekdays" aria-hidden="true">
      <span v-for="label in weekdayLabelsMondayFirst" :key="label">{{ label }}</span>
    </div>

    <div class="heatmap-grid" role="grid" :aria-label="`ปฏิทินรายจ่าย ${monthLabel}`">
      <template v-for="cell in cells" :key="cell.key">
        <span v-if="!cell.date" class="heatmap-cell heatmap-cell--pad" aria-hidden="true"></span>

        <button
          v-else
          type="button"
          class="heatmap-cell"
          :class="[
            `heatmap-cell--level-${cell.level}`,
            {
              'heatmap-cell--today': cell.isToday,
              'heatmap-cell--future': cell.isFuture,
            },
          ]"
          :disabled="cell.isFuture"
          :title="cell.label"
          :aria-label="cell.label"
          @click="selectDay(cell)"
          @mouseenter="hoveredCell = cell"
          @mouseleave="hoveredCell = null"
          @focus="hoveredCell = cell"
          @blur="hoveredCell = null"
        >
          <span class="heatmap-cell__day">{{ cell.day }}</span>

          <span v-if="cell.spent > 0 || cell.income > 0" class="heatmap-cell__amounts">
            <span v-if="cell.spent > 0" class="heatmap-cell__expense">{{
              formatBaht(cell.spent)
            }}</span>
            <span v-if="cell.income > 0" class="heatmap-cell__income"
              >+{{ formatBaht(cell.income) }}</span
            >
          </span>
        </button>
      </template>
    </div>

    <p class="heatmap-tooltip" role="status" aria-live="polite">
      {{ tooltipText || 'ชี้หรือกดที่วันเพื่อดูยอดรายจ่าย แล้วกดเพื่อไปหน้าจดรายการของวันนั้น' }}
    </p>

    <footer class="heatmap-legend">
      <small>{{ usesCapScale ? 'เทียบกับเพดานรายจ่ายต่อวัน' : 'เทียบกันภายในเดือนนี้' }}</small>
      <div class="heatmap-legend__scale">
        <span>น้อย</span>
        <i
          v-for="(label, index) in legendLabels"
          :key="label"
          :class="`heatmap-swatch heatmap-swatch--${index}`"
          :title="label"
        ></i>
        <span>มาก</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.heatmap-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
  box-shadow: 0 8px 24px rgba(23, 45, 36, 0.045);
  font-family: 'Noto Sans Thai', sans-serif;
}

.heatmap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.heatmap-head__copy .eyebrow {
  color: #6c8a7e;
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.heatmap-head__copy h2 {
  margin: 2px 0 0;
  color: var(--ink);
  font-size: 0.92rem;
}

.heatmap-nav {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid #dce4de;
  border-radius: 10px;
  background: #fff;
}

.heatmap-nav strong {
  min-width: 118px;
  color: #20563e;
  font-size: 0.66rem;
  text-align: center;
}

.heatmap-nav button {
  display: grid;
  min-width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: #426454;
  background: transparent;
  font-size: 0.6rem;
  transition:
    color 0.16s,
    background 0.16s;
}

.heatmap-nav button:hover:not(:disabled) {
  color: #174d36;
  background: #edf5f0;
}

.heatmap-nav button:disabled {
  opacity: 0.35;
}

.heatmap-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.heatmap-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.heatmap-filter__toggle {
  padding: 5px 10px;
  border: 1px solid #dce4de;
  border-radius: 999px;
  color: #2f6b51;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  cursor: pointer;
}

.heatmap-filter small {
  color: var(--muted);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.55rem;
}

.heatmap-filter__panel {
  display: grid;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #f8fbf9;
}

.heatmap-filter__panel p {
  margin: 0;
  color: var(--muted);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.58rem;
  line-height: 1.55;
}

.heatmap-filter__panel > button {
  justify-self: start;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  color: #2f6b51;
  background: var(--green-light);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  cursor: pointer;
}

.heatmap-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.heatmap-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border: 1px solid #dbe4de;
  border-radius: 999px;
  color: #45534c;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
  font-weight: 600;
  cursor: pointer;
}

.heatmap-chip input {
  width: 12px;
  height: 12px;
  accent-color: #2f6b51;
}

.heatmap-chip.is-off {
  border-color: var(--alert-line);
  color: var(--alert-muted);
  background: var(--alert-tint);
  text-decoration: line-through;
}

.heatmap-chip:focus-within {
  outline: 3px solid rgba(41, 116, 79, 0.22);
  outline-offset: 1px;
}

.heatmap-stats span {
  display: grid;
  padding: 5px 9px;
  border-radius: 9px;
  background: #f1f5f2;
  line-height: 1.25;
}

.heatmap-stats small {
  color: var(--muted);
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.heatmap-stats b {
  color: #20563e;
  font-size: 0.66rem;
}

.heatmap-stats__warn {
  background: var(--alert-tint);
}

.heatmap-stats__warn b {
  color: var(--alert-ink);
}

.heatmap-weekdays,
.heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
}

.heatmap-weekdays span {
  color: var(--muted);
  font-size: 0.53rem;
  font-weight: 800;
  text-align: center;
}

.heatmap-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  min-height: 52px;
  padding: 3px 3px 4px;
  border: 1px solid #e8ece7;
  border-radius: 8px;
  color: #5c6b63;
  background: #f9fafb;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  overflow: hidden;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.heatmap-cell--pad {
  border: 0;
  background: transparent;
}

.heatmap-cell:not(:disabled):hover,
.heatmap-cell:not(:disabled):focus-visible {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(23, 45, 36, 0.14);
}

.heatmap-cell:focus-visible {
  outline: 2px solid #6d9c83;
  outline-offset: 2px;
}

.heatmap-cell--future {
  cursor: not-allowed;
  opacity: 0.4;
}

.heatmap-cell.heatmap-cell--today {
  border: 2px solid var(--green);
  padding: 2px 2px 3px;
}

.heatmap-cell__day {
  color: var(--muted);
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
  text-align: left;
  opacity: 0.75;
}

.heatmap-cell__amounts {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 0;
}

.heatmap-cell__expense,
.heatmap-cell__income {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.1;
}

.heatmap-cell__expense {
  color: var(--alert-text);
  font-size: 0.6rem;
  font-weight: 800;
}

.heatmap-cell__income {
  color: #15803d;
  font-size: 0.52rem;
  font-weight: 700;
}

/* พื้นหลังเป็นเพียงเฉดอ่อน ๆ ให้ตัวเลขเด่นกว่า */
.heatmap-cell--level-1 {
  border-color: #eaf4dc;
  background: #f4faea;
}
.heatmap-cell--level-2 {
  border-color: #dcefc4;
  background: #ebf7d8;
}
.heatmap-cell--level-3 {
  border-color: #cfe9ab;
  background: #e0f2c4;
}
.heatmap-cell--level-4 {
  border-color: var(--watch-line);
  background: var(--watch-tint);
}
.heatmap-cell--level-5 {
  border-color: var(--alert-line);
  background: var(--alert-tint);
}

.heatmap-cell--level-5 .heatmap-cell__expense {
  color: var(--alert-ink);
}

.heatmap-tooltip {
  margin: 0;
  min-height: 15px;
  color: var(--muted);
  font-size: 0.58rem;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 7px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}

.heatmap-legend small {
  color: var(--muted);
  font-size: 0.55rem;
}

.heatmap-legend__scale {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 0.53rem;
}

.heatmap-swatch {
  width: 13px;
  height: 13px;
  border: 1px solid #e2e6df;
  border-radius: 4px;
}

.heatmap-swatch--0 {
  border-color: #e8ece7;
  background: #f9fafb;
}
.heatmap-swatch--1 {
  border-color: #eaf4dc;
  background: #f4faea;
}
.heatmap-swatch--2 {
  border-color: #dcefc4;
  background: #ebf7d8;
}
.heatmap-swatch--3 {
  border-color: #cfe9ab;
  background: #e0f2c4;
}
.heatmap-swatch--4 {
  border-color: var(--watch-line);
  background: var(--watch-tint);
}
.heatmap-swatch--5 {
  border-color: var(--alert-line);
  background: var(--alert-tint);
}

@media (max-width: 580px) {
  .heatmap-card {
    padding: 11px;
  }
  .heatmap-head {
    align-items: stretch;
    flex-direction: column;
  }
  .heatmap-nav {
    justify-content: space-between;
  }
  .heatmap-nav strong {
    flex: 1;
  }
  .heatmap-weekdays,
  .heatmap-grid {
    gap: 4px;
  }
  .heatmap-cell {
    font-size: 0.55rem;
  }
  .heatmap-cell__expense {
    font-size: 0.55rem;
  }
  .heatmap-cell__income {
    font-size: 0.48rem;
  }
}

/* จอแคบมาก: ซ่อนบรรทัดรายรับ เหลือเลขวันกับรายจ่าย */
@media (max-width: 400px) {
  .heatmap-cell {
    min-height: 46px;
  }
  .heatmap-cell__income {
    display: none;
  }
  .heatmap-cell__expense {
    font-size: 0.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .heatmap-cell {
    transition: none;
  }
  .heatmap-cell:not(:disabled):hover,
  .heatmap-cell:not(:disabled):focus-visible {
    transform: none;
  }
}
</style>
