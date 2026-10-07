<script setup lang="ts">
import { computed } from 'vue'
import type { Transaction } from '../types/transaction'
import { buildCategoryBreakdown, formatPercent } from '../utils/categoryBreakdown'
import { formatBaht } from '../utils/format'
import CategoryDonut from './CategoryDonut.vue'

const props = defineProps<{
  transactions: Transaction[]
  previousTransactions: Transaction[]
  monthLabel: string
}>()

const sumExpenses = (transactions: Transaction[]) =>
  transactions
    .filter(({ type }) => type === 'expense')
    .reduce((sum, { amount }) => sum + Number(amount), 0)

const currentTotal = computed(() => sumExpenses(props.transactions))
const previousTotal = computed(() => sumExpenses(props.previousTransactions))

const topCategory = computed(() => buildCategoryBreakdown(props.transactions, 'expense').slices[0])

const monthChange = computed(() => {
  const difference = currentTotal.value - previousTotal.value
  if (previousTotal.value === 0) return { difference, percentage: null }
  return { difference, percentage: (difference / previousTotal.value) * 100 }
})

const comparisonTone = computed(() => {
  if (monthChange.value.difference > 0) return 'increase'
  if (monthChange.value.difference < 0) return 'decrease'
  return 'neutral'
})
</script>

<template>
  <section class="analytics-panel" aria-labelledby="expense-analytics-title">
    <header class="analytics-heading">
      <div>
        <span>Expense insight</span>
        <h2 id="expense-analytics-title">วิเคราะห์ค่าใช้จ่าย {{ monthLabel }}</h2>
      </div>
      <div class="month-comparison" :class="comparisonTone">
        <strong v-if="monthChange.percentage !== null">
          {{ monthChange.difference > 0 ? '↑' : monthChange.difference < 0 ? '↓' : '–' }}
          {{ Math.abs(monthChange.percentage).toFixed(0) }}%
        </strong>
        <strong v-else>เดือนแรก</strong>
        <small>เทียบเดือนก่อน</small>
      </div>
    </header>

    <CategoryDonut
      :transactions="transactions"
      type="expense"
      :framed="false"
      empty-hint="เมื่อเพิ่มรายการรายจ่าย ระบบจะแยกสัดส่วนตามหมวดหมู่ให้ทันที"
    />

    <p v-if="topCategory" class="top-category">
      ใช้มากที่สุด <strong>{{ topCategory.emoji }} {{ topCategory.label }}</strong>
      {{ formatPercent(topCategory.percentage) }}
    </p>

    <footer v-if="currentTotal > 0" class="comparison-note" :class="comparisonTone">
      <span aria-hidden="true">{{
        comparisonTone === 'increase' ? '!' : comparisonTone === 'decrease' ? '✓' : '–'
      }}</span>
      <p v-if="previousTotal === 0">
        เดือนก่อนยังไม่มีรายจ่าย จึงเริ่มใช้เดือนนี้เป็นฐานเปรียบเทียบ
      </p>
      <p v-else-if="monthChange.difference > 0">
        ใช้จ่ายมากกว่าเดือนก่อน {{ formatBaht(monthChange.difference) }}
      </p>
      <p v-else-if="monthChange.difference < 0">
        ประหยัดกว่าเดือนก่อน {{ formatBaht(Math.abs(monthChange.difference)) }}
      </p>
      <p v-else>ค่าใช้จ่ายเท่ากับเดือนก่อน</p>
    </footer>
  </section>
</template>

<style scoped>
.analytics-panel {
  min-width: 0;
  padding: 17px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
  box-shadow: 0 8px 24px rgba(23, 45, 36, 0.045);
}
.analytics-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 15px;
}
.analytics-heading span {
  color: #71877d;
  font-size: 0.53rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.analytics-heading h2 {
  margin: 2px 0 0;
  font:
    700 0.86rem 'Noto Sans Thai',
    sans-serif;
}
.month-comparison {
  min-width: 76px;
  padding: 6px 8px;
  border-radius: 9px;
  background: #f0f4f1;
  text-align: right;
}
.month-comparison strong,
.month-comparison small {
  display: block;
  font-family: 'Noto Sans Thai', sans-serif;
}
.month-comparison strong {
  color: #65736c;
  font-size: 0.68rem;
}
.month-comparison small {
  color: #929b96;
  font-size: 0.5rem;
}
.month-comparison.increase strong {
  color: var(--alert-text);
}
.month-comparison.decrease strong {
  color: #32835b;
}
.top-category {
  margin: 10px 0 0;
  color: #7d8983;
  font:
    500 0.56rem 'Noto Sans Thai',
    sans-serif;
  text-align: center;
}
.top-category strong {
  color: #304b3e;
}
.comparison-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 9px;
  color: #64746c;
  background: #f0f4f1;
  font:
    500 0.57rem 'Noto Sans Thai',
    sans-serif;
}
.comparison-note span {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  place-items: center;
  border-radius: 6px;
  background: #e0e8e3;
  font-weight: 800;
}
.comparison-note p {
  margin: 0;
}
.comparison-note.increase {
  color: var(--alert-text);
  background: var(--alert-tint);
}
.comparison-note.increase span {
  background: var(--alert-line);
}
.comparison-note.decrease {
  color: #347454;
  background: #edf8f1;
}
.comparison-note.decrease span {
  background: #d5ebdd;
}
@media (max-width: 580px) {
  .analytics-panel {
    padding: 14px;
  }
}
</style>
