<script setup lang="ts">
import { formatBaht } from '../utils/format'

withDefaults(
  defineProps<{
    balance: number
    income: number
    expense: number
    balanceLabel?: string
    incomeLabel?: string
    expenseLabel?: string
    /** true = ยังโหลดข้อมูลไม่เสร็จ ให้แสดงโครงแทนเลข 0 ที่จะทำให้เข้าใจผิด */
    loading?: boolean
  }>(),
  {
    balanceLabel: 'ยอดคงเหลือ',
    incomeLabel: 'รายรับ',
    expenseLabel: 'รายจ่าย',
    loading: false,
  },
)
</script>

<template>
  <section
    v-if="loading"
    class="summary-grid"
    role="status"
    aria-label="กำลังโหลดสรุปยอดเงิน"
    aria-live="polite"
  >
    <article v-for="card in 3" :key="card" class="summary-card summary-card--skeleton">
      <div class="skeleton skeleton--circle summary-skeleton__icon"></div>
      <div class="summary-skeleton__copy">
        <span class="skeleton skeleton--text" style="width: 72px"></span>
        <span class="skeleton skeleton--title" style="width: 108px"></span>
      </div>
    </article>
  </section>

  <section v-else class="summary-grid" aria-label="สรุปยอดเงิน">
    <article class="summary-card summary-card--balance">
      <div class="summary-card__icon" aria-hidden="true">฿</div>
      <div>
        <p>{{ balanceLabel }}</p>
        <strong>{{ formatBaht(balance) }}</strong>
      </div>
    </article>

    <article class="summary-card summary-card--income">
      <div class="summary-card__icon" aria-hidden="true">↗</div>
      <div>
        <p>{{ incomeLabel }}</p>
        <strong>{{ formatBaht(income) }}</strong>
      </div>
    </article>

    <article class="summary-card summary-card--expense">
      <div class="summary-card__icon" aria-hidden="true">↘</div>
      <div>
        <p>{{ expenseLabel }}</p>
        <strong>{{ formatBaht(expense) }}</strong>
      </div>
    </article>
  </section>
</template>

<style scoped>
.summary-card--skeleton {
  align-items: center;
}

.summary-skeleton__icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
}

.summary-skeleton__copy {
  display: grid;
  gap: 8px;
}
</style>
