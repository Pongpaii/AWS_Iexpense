<script setup lang="ts">
import { computed } from 'vue'
import type { Transaction } from '../types/transaction'
import { formatBaht } from '../utils/format'

const props = defineProps<{
  transactions: Transaction[]
}>()

interface MonthlyTotal {
  key: string
  label: string
  income: number
  expense: number
}

const months = computed<MonthlyTotal[]>(() => {
  const now = new Date()

  const periods = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    return {
      key,
      label: new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(date),
      income: 0,
      expense: 0,
    }
  })

  const totalsByMonth = new Map(periods.map((period) => [period.key, period]))

  for (const transaction of props.transactions) {
    const month = totalsByMonth.get(transaction.transaction_date.slice(0, 7))
    if (month) month[transaction.type] += Number(transaction.amount)
  }

  return periods
})

const highestAmount = computed(() =>
  Math.max(0, ...months.value.flatMap((month) => [month.income, month.expense])),
)

const hasData = computed(() => highestAmount.value > 0)

const barHeight = (amount: number) => {
  if (amount <= 0 || highestAmount.value <= 0) return '0%'
  return `${Math.max((amount / highestAmount.value) * 100, 3)}%`
}
</script>

<template>
  <section class="chart-panel" aria-labelledby="cash-flow-chart-title">
    <div class="chart-heading">
      <div>
        <span class="chart-eyebrow">ภาพรวม</span>
        <h2 id="cash-flow-chart-title">รายรับ–รายจ่าย 6 เดือนล่าสุด</h2>
      </div>
      <div class="chart-legend" aria-label="คำอธิบายสี">
        <span><i class="legend-dot legend-dot--income"></i>รายรับ</span>
        <span><i class="legend-dot legend-dot--expense"></i>รายจ่าย</span>
      </div>
    </div>

    <div
      v-if="hasData"
      class="chart"
      role="img"
      aria-label="กราฟแท่งเปรียบเทียบรายรับและรายจ่ายย้อนหลัง 6 เดือน"
    >
      <div class="grid-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

      <div v-for="month in months" :key="month.key" class="month-group">
        <div class="bars">
          <div
            class="bar bar--income"
            :style="{ height: barHeight(month.income) }"
            :title="`${month.label} รายรับ ${formatBaht(month.income)}`"
          >
            <span class="sr-only">{{ month.label }} รายรับ {{ formatBaht(month.income) }}</span>
          </div>
          <div
            class="bar bar--expense"
            :style="{ height: barHeight(month.expense) }"
            :title="`${month.label} รายจ่าย ${formatBaht(month.expense)}`"
          >
            <span class="sr-only">{{ month.label }} รายจ่าย {{ formatBaht(month.expense) }}</span>
          </div>
        </div>
        <span class="month-label">{{ month.label }}</span>
      </div>
    </div>

    <div v-else class="chart-empty">
      <div class="chart-empty__icon" aria-hidden="true">▥</div>
      <div>
        <strong>กราฟจะปรากฏเมื่อมีข้อมูล</strong>
        <p>ลองเพิ่มรายรับหรือรายจ่ายอย่างน้อยหนึ่งรายการ</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.chart-panel {
  margin-top: 20px;
  padding: 25px 28px 22px;
  border: 1px solid var(--line);
  border-radius: 19px;
  background: var(--paper);
  box-shadow: 0 12px 40px rgba(23, 45, 36, 0.055);
}

.chart-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 25px;
}

.chart-eyebrow {
  color: #6c8a7e;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.chart-heading h2 {
  margin: 4px 0 0;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1.05rem;
}

.chart-legend {
  display: flex;
  align-items: center;
  gap: 17px;
  padding-top: 5px;
  color: #727c77;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.68rem;
}

.chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}

.legend-dot--income {
  background: #3f9e72;
}

.legend-dot--expense {
  background: var(--alert);
}

.chart {
  position: relative;
  display: grid;
  height: 230px;
  grid-template-columns: repeat(6, 1fr);
  gap: clamp(10px, 3vw, 38px);
  padding: 10px 14px 0;
  border-bottom: 1px solid #dfe4dd;
}

.grid-lines {
  position: absolute;
  inset: 10px 0 27px;
  display: flex;
  justify-content: space-between;
  flex-direction: column;
  pointer-events: none;
}

.grid-lines i {
  width: 100%;
  border-top: 1px dashed #e9ece7;
}

.month-group {
  position: relative;
  z-index: 1;
  display: grid;
  min-width: 0;
  grid-template-rows: 1fr 26px;
}

.bars {
  display: flex;
  min-height: 0;
  align-items: flex-end;
  justify-content: center;
  gap: clamp(4px, 0.8vw, 9px);
}

.bar {
  width: min(22px, 38%);
  min-height: 0;
  border-radius: 6px 6px 2px 2px;
  transition:
    height 0.45s ease,
    filter 0.2s;
  cursor: help;
}

.bar:hover {
  filter: brightness(0.88);
}

.bar--income {
  background: linear-gradient(180deg, #68bc8e, #319068);
}

.bar--expense {
  background: linear-gradient(180deg, var(--alert-soft), var(--alert-text));
}

.month-label {
  align-self: end;
  color: #89918d;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.67rem;
  text-align: center;
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
  font-size: 0.84rem;
}

.chart-empty p {
  margin: 3px 0 0;
  font-size: 0.72rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.chart-panel.compact-chart {
  display: flex;
  height: auto;
  min-height: 0;
  flex-direction: column;
  margin-top: 0;
  padding: 16px 16px 13px;
  border-radius: 16px;
}

.compact-chart .chart-heading {
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.compact-chart .chart-heading h2 {
  margin-top: 2px;
  font-size: 0.82rem;
}

.compact-chart .chart-eyebrow {
  font-size: 0.54rem;
}

.compact-chart .chart-legend {
  align-items: flex-end;
  flex-direction: column;
  gap: 3px;
  padding-top: 0;
  font-size: 0.57rem;
}

.compact-chart .legend-dot {
  width: 6px;
  height: 6px;
}

.compact-chart .chart {
  min-height: 145px;
  height: auto;
  flex: 1;
  gap: 6px;
  padding: 5px 2px 0;
}

.compact-chart .grid-lines {
  inset: 5px 0 24px;
}

.compact-chart .month-label {
  font-size: 0.56rem;
}

.compact-chart .bars {
  gap: 3px;
}

.compact-chart .bar {
  width: min(14px, 40%);
  border-radius: 4px 4px 1px 1px;
}

.compact-chart .chart-empty {
  min-height: 120px;
}

.compact-chart .chart-empty__icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
}

.compact-chart .chart-empty strong {
  font-size: 0.72rem;
}
.compact-chart .chart-empty p {
  font-size: 0.62rem;
}

@media (max-width: 580px) {
  .chart-panel {
    padding: 20px 16px 17px;
  }

  .chart-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
  }

  .chart {
    height: 200px;
    gap: 6px;
    padding-inline: 3px;
  }

  .bars {
    gap: 3px;
  }

  .month-label {
    font-size: 0.6rem;
  }
}
</style>
