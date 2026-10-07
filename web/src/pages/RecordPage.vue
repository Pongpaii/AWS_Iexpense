<script setup lang="ts">
import CategoryDonut from '../components/CategoryDonut.vue'
import DailyCapBar from '../components/DailyCapBar.vue'
import MoneyBuddy from '../components/MoneyBuddy.vue'
import StreakPill from '../components/StreakPill.vue'
import SummaryCards from '../components/SummaryCards.vue'
import TransactionForm from '../components/TransactionForm.vue'
import TransactionList from '../components/TransactionList.vue'
import type { Transaction, TransactionInput } from '../types/transaction'

defineProps<{
  transactions: Transaction[]
  recordTransactions: Transaction[]
  selectedDate: string
  isToday: boolean
  dateLabel: string
  formVersion: number
  saving: boolean
  loading: boolean
  busyId: string | null
  bulkBusy: boolean
  readOnly: boolean
  formDisabled: boolean
  recordBalance: number
  recordIncome: number
  recordExpense: number
  allBalance: number
  allIncome: number
  allExpense: number
}>()

const emit = defineEmits<{
  previousDay: []
  nextDay: []
  today: []
  showOverview: []
  submit: [value: TransactionInput]
  edit: [transaction: Transaction]
  delete: [transaction: Transaction]
  bulkDelete: [ids: string[]]
  cancelSelection: []
  openSettings: []
}>()
</script>

<template>
  <section class="app-page record-page">
    <header class="page-heading record-heading">
      <div>
        <span>{{ isToday ? 'Quick record' : 'บันทึกย้อนหลัง' }}</span>
        <h1>{{ isToday ? 'วันนี้จดอะไรบ้าง?' : dateLabel }}</h1>
      </div>

      <div class="record-heading-actions">
        <div class="day-navigation" role="group" aria-label="เปลี่ยนวันที่บันทึก">
          <button
            type="button"
            aria-label="วันก่อนหน้า"
            title="วันก่อนหน้า"
            @click="emit('previousDay')"
          >
            ‹
          </button>
          <button class="today-jump" type="button" :disabled="isToday" @click="emit('today')">
            {{ isToday ? 'วันนี้' : 'กลับวันนี้' }}
          </button>
          <button
            type="button"
            aria-label="วันถัดไป"
            title="วันถัดไป"
            :disabled="isToday"
            @click="emit('nextDay')"
          >
            ›
          </button>
        </div>
        <button class="text-link" type="button" @click="emit('showOverview')">ดูภาพรวม →</button>
      </div>
    </header>

    <StreakPill class="record-streak" :transactions="transactions" :persist="!readOnly" />

    <div class="record-grid">
      <TransactionForm
        :key="formVersion"
        class="dashboard-form"
        :editing="null"
        :busy="saving"
        :disabled="formDisabled"
        :default-date="selectedDate"
        @submit="emit('submit', $event)"
      />

      <section class="today-column" aria-label="รายการวันนี้">
        <DailyCapBar
          class="record-cap"
          :date="selectedDate"
          :transactions="recordTransactions"
          :is-today="isToday"
          @edit="emit('openSettings')"
        />

        <SummaryCards
          :loading="loading && transactions.length === 0"
          :balance="recordBalance"
          :income="recordIncome"
          :expense="recordExpense"
          :balance-label="isToday ? 'ยอดคงเหลือปัจจุบัน' : 'ยอดคงเหลือ ณ วันนั้น'"
          :income-label="isToday ? 'รายรับวันนี้' : 'รายรับวันนั้น'"
          :expense-label="isToday ? 'รายจ่ายวันนี้' : 'รายจ่ายวันนั้น'"
        />
        <TransactionList
          class="record-list"
          :transactions="recordTransactions"
          :loading="loading"
          :busy-id="busyId"
          :selection-mode="false"
          :bulk-busy="bulkBusy"
          :read-only="readOnly"
          :empty-hint="
            isToday ? 'วันนี้ยังไม่มีรายการ เริ่มจดจากฟอร์มได้เลย' : `${dateLabel} ยังไม่มีรายการ`
          "
          @edit="emit('edit', $event)"
          @delete="emit('delete', $event)"
          @bulk-delete="emit('bulkDelete', $event)"
          @cancel-selection="emit('cancelSelection')"
        />

        <CategoryDonut
          class="donut-card--wide record-donut"
          :transactions="recordTransactions"
          type="expense"
          show-type-toggle
          eyebrow="Daily breakdown"
          :title="isToday ? 'สัดส่วนหมวดหมู่วันนี้' : `สัดส่วนหมวดหมู่ ${dateLabel}`"
          :show-item-date="false"
          :empty-hint="
            isToday
              ? 'จดรายการของวันนี้แล้วกราฟวงกลมจะแยกสัดส่วนให้ทันที'
              : 'ยังไม่มีรายการของวันนั้น เลือกวันอื่นหรือเพิ่มรายการได้เลย'
          "
        />
      </section>

      <MoneyBuddy
        class="compact-buddy record-buddy"
        :income="allIncome"
        :expense="allExpense"
        :balance="allBalance"
        :transactions="transactions"
        scope-label="เงินทั้งหมด"
        @edit-salary="emit('openSettings')"
      />
    </div>
  </section>
</template>

<style scoped>
.app-page {
  display: block;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  gap: 14px;
  padding: 2px 3px 9px;
}
.page-heading span {
  color: #71877d;
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.page-heading h1 {
  margin: 1px 0 0;
  color: var(--ink);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1rem;
}
.text-link {
  padding: 6px 8px;
  border: 0;
  color: #356f54;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
}
.record-heading-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.day-navigation {
  display: flex;
  align-items: center;
  padding: 3px;
  border: 1px solid #dce4de;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 4px 13px rgba(25, 77, 59, 0.05);
}
.day-navigation button {
  display: grid;
  min-width: 30px;
  height: 30px;
  place-items: center;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  color: #426454;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1.05rem;
  font-weight: 700;
  transition:
    color 0.16s,
    background 0.16s,
    transform 0.16s;
}
.day-navigation button:hover:not(:disabled) {
  color: #174d36;
  background: #edf5f0;
}
.day-navigation .today-jump {
  min-width: 58px;
  border-inline: 1px solid #edf0ed;
  border-radius: 0;
  font-size: 0.61rem;
}
.day-navigation button:disabled {
  opacity: 0.4;
}
.record-streak {
  margin: 0 3px 11px;
}
.record-grid {
  display: grid;
  grid-template-columns: minmax(290px, 0.72fr) minmax(440px, 1.25fr) minmax(285px, 0.7fr);
  align-items: start;
  gap: 12px;
}
.dashboard-form,
.record-buddy,
.record-list,
.record-donut {
  min-width: 0;
  height: auto;
}
.today-column {
  display: grid;
  min-width: 0;
  grid-auto-rows: auto;
  gap: 10px;
}
@media (max-width: 1100px) {
  .record-grid {
    grid-template-columns: minmax(290px, 0.7fr) minmax(430px, 1.3fr);
  }
  .record-buddy {
    grid-column: 1 / -1;
  }
}
@media (max-width: 780px) {
  .app-page {
    flex: none;
  }
  .record-grid {
    grid-template-columns: 1fr;
  }
  .record-buddy {
    grid-column: auto;
  }
  .dashboard-form,
  .record-buddy,
  .record-list {
    height: auto;
  }
}
@media (max-width: 580px) {
  .page-heading {
    min-height: 44px;
  }
  .record-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 7px;
  }
  .record-heading-actions {
    justify-content: space-between;
  }
  .day-navigation {
    flex: 1;
  }
  .day-navigation .today-jump {
    flex: 1;
  }
  .record-grid,
  .today-column {
    gap: 9px;
  }
  .record-streak {
    margin: 0 1px 9px;
  }
}
</style>
