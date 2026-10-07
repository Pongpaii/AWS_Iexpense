<script setup lang="ts">
import { defineAsyncComponent, h } from 'vue'
import CategoryDonut from '../components/CategoryDonut.vue'
import SkeletonPanel from '../components/SkeletonPanel.vue'
import SummaryCards from '../components/SummaryCards.vue'
import TransactionList from '../components/TransactionList.vue'
import type { Transaction } from '../types/transaction'

type OverviewViewMode = 'month' | 'all'

const lazyPanel = (
  loader: () => Promise<unknown>,
  skeleton: { height?: number; rows?: number; variant?: 'chart' | 'list'; label: string },
) =>
  defineAsyncComponent({
    loader: loader as never,
    loadingComponent: { name: 'LazyPanelFallback', render: () => h(SkeletonPanel, skeleton) },
    delay: 120,
  })

const CashFlowChart = lazyPanel(() => import('../components/CashFlowChart.vue'), {
  height: 210,
  label: 'กำลังโหลดกราฟกระแสเงิน',
})
const ExpenseAnalytics = lazyPanel(() => import('../components/ExpenseAnalytics.vue'), {
  height: 260,
  label: 'กำลังโหลดบทวิเคราะห์รายจ่าย',
})
const HeatmapCalendar = lazyPanel(() => import('../components/HeatmapCalendar.vue'), {
  height: 200,
  label: 'กำลังโหลดปฏิทินการใช้จ่าย',
})

defineProps<{
  transactions: Transaction[]
  filteredTransactions: Transaction[]
  displayedTransactions: Transaction[]
  previousMonthTransactions: Transaction[]
  selectedMonth: string
  todayMonth: string
  viewMode: OverviewViewMode
  monthValid: boolean
  periodLabel: string
  emptyListHint: string
  balance: number
  income: number
  expense: number
  loading: boolean
  busyId: string | null
  bulkBusy: boolean
  selectionMode: boolean
  readOnly: boolean
  exportBusy: boolean
}>()

const emit = defineEmits<{
  'update:viewMode': [mode: OverviewViewMode]
  'update:selectedMonth': [month: string]
  selectDay: [date: string]
  export: []
  edit: [transaction: Transaction]
  delete: [transaction: Transaction]
  bulkDelete: [ids: string[]]
  cancelSelection: []
}>()

const changeHeatmapMonth = (month: string) => {
  emit('update:viewMode', 'month')
  emit('update:selectedMonth', month)
}
</script>

<template>
  <section class="app-page overview-page">
    <section class="overview-panel" aria-labelledby="overview-title">
      <div class="overview-controls">
        <div class="overview-title">
          <div>
            <span>ภาพรวมย้อนหลัง</span>
            <h1 id="overview-title">{{ periodLabel }}</h1>
          </div>
          <small>{{ filteredTransactions.length }} รายการ</small>
        </div>

        <div class="overview-filter-controls">
          <div class="overview-tabs" role="group" aria-label="ช่วงเวลาของภาพรวม">
            <button
              type="button"
              :class="{ active: viewMode === 'month' }"
              @click="emit('update:viewMode', 'month')"
            >
              รายเดือน
            </button>
            <button
              type="button"
              :class="{ active: viewMode === 'all' }"
              @click="emit('update:viewMode', 'all')"
            >
              ทั้งหมด
            </button>
          </div>

          <label v-if="viewMode === 'month'" class="month-picker">
            <span>เลือกเดือน</span>
            <input
              :value="selectedMonth"
              type="month"
              :max="todayMonth"
              aria-label="เลือกเดือนที่ต้องการดู"
              @input="emit('update:selectedMonth', ($event.target as HTMLInputElement).value)"
            />
          </label>

          <button
            v-if="viewMode === 'month'"
            class="export-button"
            type="button"
            :disabled="exportBusy || !monthValid || filteredTransactions.length === 0"
            :title="
              !monthValid
                ? 'กรุณาเลือกเดือนให้ถูกต้อง'
                : filteredTransactions.length === 0
                  ? 'เดือนนี้ยังไม่มีข้อมูลให้ส่งออก'
                  : 'ส่งออกรายงานประจำเดือนเป็นไฟล์ CSV'
            "
            @click="emit('export')"
          >
            <span v-if="exportBusy" class="export-spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
            <span>{{ exportBusy ? 'กำลังสร้างไฟล์' : 'Export CSV' }}</span>
            <small v-if="!exportBusy">{{ filteredTransactions.length }} รายการ</small>
          </button>
        </div>
      </div>

      <SummaryCards
        :loading="loading && transactions.length === 0"
        :balance="balance"
        :income="income"
        :expense="expense"
        :balance-label="viewMode === 'month' ? 'ยอดคงเหลือสะสม' : 'ยอดคงเหลือทั้งหมด'"
        :income-label="viewMode === 'month' ? 'รายรับของเดือน' : 'รายรับทั้งหมด'"
        :expense-label="viewMode === 'month' ? 'รายจ่ายของเดือน' : 'รายจ่ายทั้งหมด'"
      />
    </section>

    <HeatmapCalendar
      class="overview-heatmap"
      :transactions="transactions"
      :month="monthValid ? selectedMonth : todayMonth"
      @select-day="emit('selectDay', $event)"
      @change-month="changeHeatmapMonth"
    />

    <div class="overview-workspace">
      <TransactionList
        class="overview-list"
        :transactions="displayedTransactions"
        :loading="loading"
        :busy-id="busyId"
        :selection-mode="selectionMode"
        :bulk-busy="bulkBusy"
        :read-only="readOnly"
        :empty-hint="emptyListHint"
        @edit="emit('edit', $event)"
        @delete="emit('delete', $event)"
        @bulk-delete="emit('bulkDelete', $event)"
        @cancel-selection="emit('cancelSelection')"
      />

      <div class="overview-analysis">
        <CashFlowChart class="compact-chart overview-chart" :transactions="transactions" />
        <div v-if="viewMode === 'month'" class="overview-insights">
          <ExpenseAnalytics
            :transactions="filteredTransactions"
            :previous-transactions="previousMonthTransactions"
            :month-label="periodLabel"
          />
        </div>
        <CategoryDonut
          v-else
          class="overview-donut"
          :transactions="filteredTransactions"
          type="expense"
          show-type-toggle
          eyebrow="All-time breakdown"
          title="สัดส่วนหมวดหมู่ทั้งหมด"
          empty-hint="เมื่อมีรายการในระบบ ระบบจะแยกสัดส่วนตามหมวดหมู่ให้ทันที"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.app-page {
  display: block;
}
.overview-title span {
  color: #71877d;
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.overview-title h1 {
  margin: 1px 0 0;
  color: var(--ink);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1rem;
}
.overview-heatmap {
  margin-top: 12px;
}
.overview-panel {
  display: grid;
  grid-template-columns: minmax(230px, 0.55fr) minmax(560px, 1.45fr);
  align-items: stretch;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 8px 24px rgba(23, 45, 36, 0.045);
}
.overview-controls {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
}
.overview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.overview-title small {
  padding: 4px 7px;
  border-radius: 999px;
  color: #61796e;
  background: #edf3ef;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.57rem;
  white-space: nowrap;
}
.overview-filter-controls {
  display: grid;
  grid-template-columns: minmax(130px, 0.85fr) minmax(150px, 1.15fr);
  align-items: end;
  gap: 7px;
}
.overview-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  padding: 3px;
  border-radius: 9px;
  background: #e9efeb;
}
.overview-tabs button {
  min-height: 34px;
  padding: 4px 7px;
  border: 0;
  border-radius: 7px;
  color: #728078;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.62rem;
  font-weight: 700;
}
.overview-tabs button.active {
  color: #20563e;
  background: #fff;
  box-shadow: 0 2px 7px rgba(25, 77, 59, 0.1);
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
  height: 40px;
  padding: 6px 9px;
  border: 1px solid #dce4de;
  border-radius: 9px;
  color: #294d3e;
  background: #fff;
  font:
    600 0.66rem 'Noto Sans Thai',
    sans-serif;
  color-scheme: light;
  outline: none;
  transition:
    border-color 0.16s,
    box-shadow 0.16s;
}
.month-picker input:focus {
  border-color: #6d9c83;
  box-shadow: 0 0 0 3px rgba(73, 137, 103, 0.12);
}
.export-button {
  display: flex;
  grid-column: 1 / -1;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 11px;
  border: 1px solid #194d3b;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #194d3b, #286b4f);
  box-shadow: 0 6px 16px rgba(25, 77, 59, 0.16);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.66rem;
  font-weight: 800;
  transition:
    transform 0.16s,
    box-shadow 0.16s,
    opacity 0.16s;
}
.export-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(25, 77, 59, 0.22);
}
.export-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
  box-shadow: none;
}
.export-button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
.export-button small {
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 999px;
  color: #194d3b;
  background: var(--lime);
  font-size: 0.52rem;
  font-weight: 800;
}
.export-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.overview-workspace {
  display: grid;
  grid-template-columns: minmax(480px, 1.4fr) minmax(320px, 0.75fr);
  align-items: start;
  gap: 12px;
  margin-top: 12px;
}
.overview-analysis {
  display: grid;
  min-width: 0;
  gap: 12px;
}
.overview-insights,
.overview-list,
.overview-chart,
.overview-donut {
  min-width: 0;
  height: auto;
}
@media (max-width: 1100px) {
  .overview-panel {
    grid-template-columns: 1fr;
  }
  .overview-controls {
    display: grid;
    grid-template-columns: 1fr minmax(260px, 0.7fr);
    align-items: center;
  }
}
@media (max-width: 780px) {
  .app-page {
    flex: none;
  }
  .overview-workspace {
    grid-template-columns: 1fr;
  }
  .overview-list,
  .overview-analysis,
  .overview-chart {
    height: auto;
  }
}
@media (max-width: 580px) {
  .overview-panel {
    gap: 8px;
    padding: 8px;
  }
  .overview-controls {
    grid-template-columns: 1fr;
  }
  .overview-filter-controls {
    grid-template-columns: 1fr;
  }
  .overview-analysis,
  .overview-workspace {
    gap: 9px;
  }
  .overview-workspace {
    margin-top: 9px;
  }
  .overview-heatmap {
    margin-top: 9px;
  }
}
</style>
