<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCategoryBudgets, type CategoryBudget } from '../composables/useCategoryBudgets'
import {
  transactionCategories,
  type Transaction,
  type TransactionCategory,
} from '../types/transaction'
import { buildBudgetComparison, buildBudgetPacing } from '../utils/budgetComparison'
import { categoryPalette, formatPercent } from '../utils/categoryBreakdown'
import { toLocalIsoDate } from '../utils/dateUtils'
import { formatBaht } from '../utils/format'

const props = withDefaults(
  defineProps<{
    transactions: Transaction[]
    readOnly?: boolean
  }>(),
  { readOnly: false },
)

const { budgets, loading, errorMessage, needsMigration, hasBudgets, replaceBudgets, clearBudgets } =
  useCategoryBudgets()

const todayMonth = toLocalIsoDate(new Date()).slice(0, 7)
const selectedMonth = ref(todayMonth)
const monthValid = computed(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth.value))

const monthLabel = computed(() => {
  if (!monthValid.value) return ''
  const [year, month] = selectedMonth.value.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  )
})

const comparison = computed(() =>
  buildBudgetComparison(
    props.transactions,
    budgets.value,
    monthValid.value ? selectedMonth.value : todayMonth,
    categoryPalette,
  ),
)

/** ความกว้างของแถบ: เกินงบให้เต็มแถบ แล้วบอกส่วนเกินด้วยข้อความ ไม่ล้นออกนอกกรอบ */
const barWidth = (percentage: number) => `${Math.min(Math.max(percentage, 0), 100)}%`

const today = toLocalIsoDate(new Date())

/** งบที่เหลือชนกับเงินที่มีจริง เพื่อตอบว่า "ตอนนี้ใช้ได้อีกเท่าไร" */
const pacing = computed(() =>
  buildBudgetPacing(comparison.value, {
    transactions: props.transactions,
    month: monthValid.value ? selectedMonth.value : todayMonth,
    today,
  }),
)

const paceLabel = computed(() => {
  if (!pacing.value.isCurrentMonth) return 'สรุปแล้วของเดือนนั้น'
  if (pacing.value.pace === 'behind') return 'ใช้เร็วกว่าเวลา'
  if (pacing.value.pace === 'ahead') return 'ใช้ช้ากว่าเวลา'
  return 'พอดีกับเวลา'
})

const statusLabel = (status: string) =>
  status === 'over' ? 'เกินงบ' : status === 'near' ? 'ใกล้เต็ม' : 'ยังพอ'

// --- modal ตั้งงบ ---
const editorOpen = ref(false)
const drafts = ref<Record<string, number | string>>({})
const editorError = ref('')
const editorBusy = ref(false)

const syncDrafts = () => {
  const next: Record<string, number | string> = {}
  for (const option of transactionCategories) {
    const found = budgets.value.find((item) => item.category === option.value)
    next[option.value] = found ? found.budget : ''
  }
  drafts.value = next
}

watch(budgets, syncDrafts, { immediate: true, deep: true })

const openEditor = () => {
  syncDrafts()
  editorError.value = ''
  editorOpen.value = true
}

const closeEditor = () => {
  if (editorBusy.value) return
  editorOpen.value = false
}

const draftEntries = computed<CategoryBudget[]>(() =>
  transactionCategories
    .map((option) => ({
      category: option.value as TransactionCategory,
      budget: Number(drafts.value[option.value]),
    }))
    .filter((entry) => Number.isFinite(entry.budget) && entry.budget > 0),
)

const draftTotal = computed(() => draftEntries.value.reduce((sum, item) => sum + item.budget, 0))

const submitEditor = async () => {
  const invalid = transactionCategories.some((option) => {
    const raw = drafts.value[option.value]
    if (raw === '' || raw === null || raw === undefined) return false
    const amount = Number(raw)
    return !Number.isFinite(amount) || amount < 0
  })

  if (invalid) {
    editorError.value = 'กรอกงบเป็นตัวเลขที่ไม่ติดลบ หรือเว้นว่างไว้ถ้าไม่จำกัด'
    return
  }

  editorBusy.value = true
  const saved = await replaceBudgets(draftEntries.value)
  editorBusy.value = false

  // ฐานข้อมูลยังไม่พร้อม = ค่าถูกเก็บในเครื่องแล้ว ปิดหน้าต่างแล้วให้แถบเตือนด้านบนอธิบายต่อ
  if (!saved && !needsMigration.value && errorMessage.value) {
    editorError.value = errorMessage.value
    return
  }
  editorOpen.value = false
}

const submitClear = async () => {
  editorBusy.value = true
  await clearBudgets()
  editorBusy.value = false
  syncDrafts()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && editorOpen.value) closeEditor()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <section class="chart-panel budget-panel" aria-labelledby="budget-chart-title">
    <header class="chart-heading">
      <div>
        <span class="chart-eyebrow">Budget tracking</span>
        <h2 id="budget-chart-title">งบประมาณ vs ค่าใช้จ่ายจริง</h2>
      </div>

      <div class="budget-controls">
        <label class="month-picker">
          <span>เลือกเดือน</span>
          <input
            v-model="selectedMonth"
            type="month"
            :max="todayMonth"
            aria-label="เลือกเดือนที่ต้องการเทียบงบ"
          />
        </label>
        <button
          type="button"
          class="budget-edit-button"
          :disabled="readOnly"
          :title="readOnly ? 'โหมดดูตัวอย่างแก้ไขไม่ได้' : 'ตั้งงบรายหมวด'"
          @click="openEditor"
        >
          ตั้งงบ
        </button>
      </div>
    </header>

    <p v-if="needsMigration" class="budget-alert" role="alert">{{ errorMessage }}</p>
    <p v-else-if="errorMessage" class="budget-alert budget-alert--soft" role="status">
      {{ errorMessage }}
    </p>

    <div v-if="hasBudgets" class="budget-body">
      <section class="budget-spendable" aria-label="งบที่ใช้ได้จริงตอนนี้">
        <div class="budget-spendable__main">
          <small>ตอนนี้ใช้ได้อีก</small>
          <strong :class="{ 'is-over': pacing.spendableNow < 0 }">
            {{ formatBaht(Math.max(pacing.spendableNow, 0)) }}
          </strong>
          <em v-if="pacing.isCurrentMonth">
            เหลืออีก {{ pacing.daysLeft }} วัน · วันละ {{ formatBaht(pacing.dailyAllowance) }}
          </em>
          <em v-else>เดือนนั้นจบแล้ว ตัวเลขนี้คือผลสรุป</em>
        </div>

        <ul class="budget-spendable__facts">
          <li>
            <small>งบที่เหลือตามแผน</small>
            <b :class="{ 'is-over': pacing.budgetRemaining < 0 }">
              {{ formatBaht(pacing.budgetRemaining) }}
            </b>
          </li>
          <li>
            <small>เงินคงเหลือสะสมจริง</small>
            <b :class="{ 'is-over': pacing.availableBalance < 0 }">
              {{ formatBaht(pacing.availableBalance) }}
            </b>
          </li>
          <li>
            <small>จังหวะการใช้</small>
            <b :class="`pace pace--${pacing.pace}`">{{ paceLabel }}</b>
          </li>
        </ul>

        <p class="budget-spendable__note">
          <template v-if="pacing.limitedByBalance">
            เงินจริงเหลือน้อยกว่างบที่ตั้งไว้ ตัวเลข “ใช้ได้อีก” จึงยึดเงินจริงเป็นเพดาน
          </template>
          <template v-else>
            ใช้งบไปแล้ว {{ formatPercent(pacing.budgetUsedPercent) }} ขณะที่เดือนเดินไป
            {{ formatPercent(pacing.monthProgressPercent) }}
          </template>
        </p>
      </section>

      <ul class="budget-summary">
        <li>
          <small>งบรวมของ{{ monthLabel }}</small>
          <strong>{{ formatBaht(comparison.totalBudget) }}</strong>
        </li>
        <li>
          <small>จ่ายจริงในหมวดที่ตั้งงบ</small>
          <strong>{{ formatBaht(comparison.totalActual) }}</strong>
        </li>
        <li :class="{ 'is-alert': comparison.overBudgetCount > 0 }">
          <small>เกินงบ</small>
          <strong>{{ comparison.overBudgetCount }} หมวด</strong>
        </li>
        <li :class="{ 'is-good': comparison.totalRemaining > 0 }">
          <small>ยังเหลือ</small>
          <strong>{{ formatBaht(comparison.totalRemaining) }}</strong>
        </li>
      </ul>

      <ul class="budget-rows">
        <li v-for="item in comparison.items" :key="item.category" class="budget-row">
          <div class="budget-row__head">
            <span class="budget-row__name">
              <b>{{ item.emoji }} {{ item.label }}</b>
              <em v-if="item.status === 'over'" aria-hidden="true">⚠️</em>
            </span>
            <span class="budget-row__value">
              <b>{{ formatBaht(item.actual) }}</b>
              <small>/ {{ formatBaht(item.budget) }}</small>
              <i :class="`badge badge--${item.status}`">{{ formatPercent(item.percentage) }}</i>
            </span>
          </div>

          <div
            class="budget-bar"
            role="progressbar"
            :aria-valuenow="Math.round(item.percentage)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${item.label} ใช้ไป ${formatPercent(item.percentage)} ของงบ`"
          >
            <i
              :class="`budget-bar__fill budget-bar__fill--${item.status}`"
              :style="{
                width: barWidth(item.percentage),
                background: item.status === 'under' ? item.color : undefined,
              }"
            ></i>
          </div>

          <small class="budget-row__note">
            <span :class="{ 'is-over': item.remaining < 0 }">
              {{
                item.remaining < 0
                  ? `เกินงบ ${formatBaht(-item.remaining)}`
                  : `เหลือ ${formatBaht(item.remaining)}`
              }}
            </span>
            · {{ statusLabel(item.status) }} · {{ item.transactionCount }} รายการ
          </small>
        </li>
      </ul>

      <div v-if="comparison.noBudgetCategories.length > 0" class="budget-unbudgeted">
        <strong>จ่ายแล้วแต่ยังไม่ได้ตั้งงบ</strong>
        <ul>
          <li v-for="entry in comparison.noBudgetCategories" :key="`nb-${entry.label}`">
            <span>{{ entry.emoji }} {{ entry.label }}</span>
            <b>{{ formatBaht(entry.actual) }}</b>
          </li>
        </ul>
      </div>
    </div>

    <div v-else-if="loading" class="chart-empty">
      <div class="chart-empty__icon" aria-hidden="true">⏳</div>
      <div>
        <strong>กำลังโหลดงบรายหมวด</strong>
        <p>รอสักครู่ ระบบกำลังอ่านค่าที่ตั้งไว้</p>
      </div>
    </div>

    <div v-else class="chart-empty budget-empty">
      <div class="chart-empty__icon" aria-hidden="true">🏦</div>
      <div>
        <strong>ตั้งงบรายหมวดเพื่อเริ่มเปรียบเทียบ</strong>
        <p>กำหนดเพดานของแต่ละหมวดต่อเดือน แล้วระบบจะบอกว่าหมวดไหนใกล้เต็มหรือเกินไปแล้ว</p>
        <button type="button" class="budget-cta" :disabled="readOnly" @click="openEditor">
          ตั้งงบเลย
        </button>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="editorOpen"
          class="modal-backdrop"
          role="presentation"
          @mousedown.self="closeEditor"
        >
          <section
            class="settings-modal budget-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-editor-title"
          >
            <header class="settings-header">
              <div>
                <span>งบรายหมวด</span>
                <h2 id="budget-editor-title">ตั้งเพดานต่อเดือน</h2>
              </div>
              <button
                type="button"
                class="close-button"
                aria-label="ปิดหน้าต่างตั้งงบ"
                :disabled="editorBusy"
                @click="closeEditor"
              >
                ×
              </button>
            </header>

            <form class="budget-form" @submit.prevent="submitEditor">
              <p class="budget-form__hint">เว้นว่างไว้ = ไม่จำกัดงบหมวดนั้น</p>

              <label
                v-for="option in transactionCategories"
                :key="option.value"
                class="budget-field"
              >
                <span>{{ option.emoji }} {{ option.value }}</span>
                <input
                  v-model="drafts[option.value]"
                  type="number"
                  min="0"
                  step="100"
                  inputmode="decimal"
                  placeholder="ไม่จำกัด"
                  :disabled="editorBusy"
                />
              </label>

              <p class="budget-form__total">
                <span>งบรวมที่จะบันทึก</span>
                <b>{{ formatBaht(draftTotal) }}</b>
              </p>

              <p v-if="editorError" class="budget-alert" role="alert">{{ editorError }}</p>

              <div class="budget-form__actions">
                <button
                  type="button"
                  class="budget-clear"
                  :disabled="editorBusy"
                  @click="submitClear"
                >
                  ล้างทั้งหมด
                </button>
                <button type="submit" class="budget-save" :disabled="editorBusy">
                  {{ editorBusy ? 'กำลังบันทึก' : 'บันทึก' }}
                </button>
              </div>
            </form>
          </section>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.chart-panel {
  padding: 20px 22px 18px;
  border: 1px solid var(--line);
  border-radius: 19px;
  background: var(--paper);
  box-shadow: 0 8px 24px rgba(23, 45, 36, 0.045);
}
.chart-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.chart-eyebrow {
  color: #71877d;
  font-size: 0.57rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.chart-heading h2 {
  margin: 3px 0 0;
  color: var(--ink);
  font:
    700 0.95rem 'Noto Sans Thai',
    sans-serif;
}

.budget-controls {
  display: flex;
  align-items: end;
  gap: 8px;
}
.month-picker {
  display: grid;
  min-width: 0;
  gap: 3px;
  color: #71877d;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.53rem;
  font-weight: 700;
}
.month-picker input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 6px 9px;
  border: 1px solid #dce4de;
  border-radius: 9px;
  color: #294d3e;
  background: #fff;
  font:
    600 0.64rem 'Noto Sans Thai',
    sans-serif;
  color-scheme: light;
  outline: none;
}
.month-picker input:focus {
  border-color: #6d9c83;
  box-shadow: 0 0 0 3px rgba(73, 137, 103, 0.12);
}

.budget-edit-button {
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid #194d3b;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #194d3b, #286b4f);
  font:
    800 0.62rem 'Noto Sans Thai',
    sans-serif;
  cursor: pointer;
  transition:
    transform 0.16s,
    box-shadow 0.16s,
    opacity 0.16s;
}
.budget-edit-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(25, 77, 59, 0.2);
}
.budget-edit-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.budget-alert {
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 1px solid var(--alert-line);
  border-radius: 10px;
  color: var(--alert-text);
  background: var(--alert-tint);
  font:
    600 0.58rem 'Noto Sans Thai',
    sans-serif;
}
.budget-alert--soft {
  border-color: rgba(63, 160, 171, 0.42);
  color: var(--watch-text);
  background: rgba(63, 160, 171, 0.1);
}

.budget-body {
  display: grid;
  gap: 13px;
}

.budget-spendable {
  display: grid;
  gap: 9px;
  padding: 12px 13px;
  border: 1px solid rgba(50, 131, 91, 0.3);
  border-radius: 14px;
  background: rgba(50, 131, 91, 0.05);
}
.budget-spendable__main {
  display: grid;
  gap: 2px;
}
.budget-spendable__main small {
  color: var(--muted);
  font:
    800 0.53rem 'Noto Sans Thai',
    sans-serif;
  letter-spacing: 0.04em;
}
.budget-spendable__main strong {
  color: #1f5c40;
  font:
    700 1.25rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
  line-height: 1.15;
}
.budget-spendable__main strong.is-over {
  color: var(--alert-text);
}
.budget-spendable__main em {
  color: #4a6a5b;
  font:
    700 0.58rem 'Noto Sans Thai',
    sans-serif;
  font-style: normal;
}
.budget-spendable__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.budget-spendable__facts li {
  display: grid;
  gap: 1px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface, #fff);
}
.budget-spendable__facts small {
  color: var(--muted);
  font:
    700 0.48rem 'Noto Sans Thai',
    sans-serif;
}
.budget-spendable__facts b {
  color: var(--ink);
  font:
    700 0.66rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
}
.budget-spendable__facts b.is-over {
  color: var(--alert-text);
}
.budget-spendable__facts b.pace--behind {
  color: var(--watch-text);
}
.budget-spendable__facts b.pace--ahead {
  color: #2c7a55;
}
.budget-spendable__note {
  margin: 0;
  color: #4a6a5b;
  font:
    600 0.53rem 'Noto Sans Thai',
    sans-serif;
  line-height: 1.45;
}

.budget-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.budget-summary li {
  display: grid;
  gap: 2px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.budget-summary li.is-alert {
  border-color: var(--alert-line);
  background: var(--alert-tint);
}
.budget-summary li.is-good {
  border-color: rgba(50, 131, 91, 0.34);
  background: rgba(50, 131, 91, 0.06);
}
.budget-summary small {
  color: var(--muted);
  font:
    700 0.5rem 'Noto Sans Thai',
    sans-serif;
}
.budget-summary strong {
  color: var(--ink);
  font:
    700 0.72rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
}

.budget-rows {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.budget-row {
  display: grid;
  gap: 4px;
}
.budget-row__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.budget-row__name {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.budget-row__name b {
  overflow: hidden;
  color: var(--ink);
  font:
    700 0.62rem 'Noto Sans Thai',
    sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.budget-row__name em {
  font-style: normal;
  font-size: 0.62rem;
}
.budget-row__value {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
}
.budget-row__value b {
  color: var(--ink);
  font:
    700 0.64rem 'Manrope',
    sans-serif;
}
.budget-row__value small {
  color: var(--muted);
  font:
    600 0.55rem 'Manrope',
    sans-serif;
}
.badge {
  padding: 2px 6px;
  border-radius: 999px;
  font:
    800 0.5rem 'Manrope',
    sans-serif;
  font-style: normal;
}
.badge--under {
  color: #2b6a4b;
  background: rgba(50, 131, 91, 0.14);
}
.badge--near {
  color: var(--watch-ink);
  background: rgba(63, 160, 171, 0.2);
}
.badge--over {
  color: #fff;
  background: var(--alert);
}

.budget-bar {
  height: 38px;
  overflow: hidden;
  border-radius: 8px;
  background: #f0f4f1;
}
.budget-bar__fill {
  display: block;
  height: 100%;
  border-radius: 8px 0 0 8px;
  transition: width 0.45s ease;
}
.budget-bar__fill--near {
  background: var(--watch);
}
.budget-bar__fill--over {
  background: linear-gradient(90deg, var(--alert-soft), var(--alert));
  border-radius: 8px;
}
.budget-row__note {
  color: var(--muted);
  font:
    500 0.53rem 'Noto Sans Thai',
    sans-serif;
}
.budget-row__note .is-over {
  color: var(--alert-text);
  font-weight: 700;
}

.budget-unbudgeted {
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: 12px;
}
.budget-unbudgeted > strong {
  color: var(--ink);
  font:
    700 0.58rem 'Noto Sans Thai',
    sans-serif;
}
.budget-unbudgeted ul {
  display: grid;
  gap: 4px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.budget-unbudgeted li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.budget-unbudgeted span {
  color: var(--muted);
  font:
    600 0.55rem 'Noto Sans Thai',
    sans-serif;
}
.budget-unbudgeted b {
  color: var(--ink);
  font:
    700 0.55rem 'Manrope',
    sans-serif;
}

.chart-empty {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #7a8580;
  font-family: 'Noto Sans Thai', sans-serif;
}
.chart-empty__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 14px;
  color: #658276;
  background: #edf4f0;
  font-size: 1.2rem;
}
.chart-empty strong {
  color: var(--ink);
  font-size: 0.82rem;
}
.chart-empty p {
  max-width: 340px;
  margin: 3px 0 0;
  font-size: 0.68rem;
}
.budget-cta {
  margin-top: 9px;
  min-height: 34px;
  padding: 6px 14px;
  border: 1px solid #194d3b;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #194d3b, #286b4f);
  font:
    800 0.6rem 'Noto Sans Thai',
    sans-serif;
  cursor: pointer;
}
.budget-cta:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.modal-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  padding: 20px;
  place-items: center;
  background: rgba(10, 28, 21, 0.58);
  backdrop-filter: blur(5px);
}
.settings-modal {
  width: min(460px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--paper);
  box-shadow: 0 30px 90px rgba(7, 28, 19, 0.3);
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 15px;
  border-bottom: 1px solid var(--line);
}
.settings-header span {
  color: #698176;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.settings-header h2 {
  margin: 3px 0 0;
  color: var(--ink);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1.05rem;
}
.close-button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  border-radius: 10px;
  color: #68736e;
  background: #f1f4f1;
  font-size: 1.25rem;
  cursor: pointer;
}

.budget-form {
  display: grid;
  gap: 8px;
  padding: 18px 22px 22px;
}
.budget-form__hint {
  margin: 0 0 2px;
  color: var(--muted);
  font:
    500 0.55rem 'Noto Sans Thai',
    sans-serif;
}
.budget-field {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) 118px;
  gap: 10px;
}
.budget-field span {
  overflow: hidden;
  color: var(--ink);
  font:
    600 0.62rem 'Noto Sans Thai',
    sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.budget-field input {
  height: 36px;
  padding: 6px 9px;
  border: 1px solid #dce4de;
  border-radius: 9px;
  color: #294d3e;
  background: #fff;
  font:
    600 0.64rem 'Manrope',
    sans-serif;
  text-align: right;
  outline: none;
}
.budget-field input:focus {
  border-color: #6d9c83;
  box-shadow: 0 0 0 3px rgba(73, 137, 103, 0.12);
}
.budget-form__total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 6px 0 0;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}
.budget-form__total span {
  color: var(--muted);
  font:
    700 0.58rem 'Noto Sans Thai',
    sans-serif;
}
.budget-form__total b {
  color: var(--ink);
  font:
    700 0.72rem 'Manrope',
    sans-serif;
}
.budget-form__actions {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  margin-top: 4px;
}
.budget-clear {
  min-height: 40px;
  padding: 8px 13px;
  border: 1px solid var(--alert-line);
  border-radius: 10px;
  color: var(--alert-text);
  background: transparent;
  font:
    700 0.6rem 'Noto Sans Thai',
    sans-serif;
  cursor: pointer;
}
.budget-save {
  min-height: 40px;
  border: 1px solid #194d3b;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #194d3b, #286b4f);
  font:
    800 0.64rem 'Noto Sans Thai',
    sans-serif;
  cursor: pointer;
}
.budget-clear:disabled,
.budget-save:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .settings-modal,
.modal-leave-active .settings-modal {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .settings-modal,
.modal-leave-to .settings-modal {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 580px) {
  .chart-panel {
    padding: 16px 13px 14px;
    border-radius: 16px;
  }
  .chart-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 12px;
  }
  .budget-controls {
    display: grid;
    grid-template-columns: 1fr auto;
  }
  .budget-bar {
    height: 32px;
  }
  .modal-backdrop {
    align-items: end;
    padding: 0;
  }
  .settings-modal {
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
  }
  .budget-field {
    grid-template-columns: minmax(0, 1fr) 96px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .budget-bar__fill,
  .budget-edit-button {
    transition: none;
  }
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .settings-modal,
  .modal-leave-active .settings-modal {
    transition: none;
  }
}
</style>
